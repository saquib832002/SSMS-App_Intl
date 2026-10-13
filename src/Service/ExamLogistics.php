<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Exam logistics – exam halls, seating plans, invigilation duties and admit cards / hall tickets.
 *
 * Built on the existing date sheet (ssms_exam_datesheet: exam × class × subject → date & time):
 * every distinct date + start time of an exam is a "sitting". A seating plan seats the students of
 * the classes sitting that paper across the chosen halls; invigilators are assigned per hall; the
 * admit card lists the student's papers with the hall and seat from published plans.
 *
 * Roles & permissions › "Exam halls, seating & admit cards" (module exam_logistics):
 *   view     see halls, plans, duties, admit-card lists      (teachers: read-only + their own duties)
 *   edit     halls, generate / change plans, assign duties, admit-card rules
 *   approve  publish plans, publish admit cards, withhold / allow a student's card
 *   delete   delete halls and plans
 *   export   print hall tickets in bulk
 */
class ExamLogistics
{
    public const MODES = ['mixed' => 'Mix classes (neighbours from different classes)', 'class' => 'Class by class'];
    public const SPACINGS = ['all' => 'Every seat', 'alternate' => 'Every other seat in a row', 'checker' => 'Chessboard (no one in front or beside)'];
    public const ROLES = ['chief' => 'Chief invigilator', 'invigilator' => 'Invigilator', 'reliever' => 'Reliever'];
    public const MAX_ROWS = 40;
    public const MAX_COLS = 30;

    /** tests: replace the push sender */
    public static $push = null;

    // ── Access ──────────────────────────────────────────────────────────────

    /** $actor = [user, role, custom_role] → what this person may do. Parents / students are refused. */
    public static function access(string $client, array $actor): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $role = $role === 'teacher' ? 'user' : $role;
        $user = (string)($actor['user'] ?? '');
        if ($user === '' || !in_array($role, Permissions::BASE_ROLES, true)) {
            throw new \DomainException('Not allowed.');
        }
        $owner = $role === 'owner';
        $grid = $owner ? [] : Permissions::forUser($client, $role, $actor['custom_role'] ?? null);
        $g = fn(string $k) => $owner || !empty($grid['exam_logistics'][$k]);
        $staff = self::db()->execute('SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $client])->fetch('assoc');

        return ['client' => $client, 'user' => $user, 'role' => $role, 'staff_id' => $staff && $staff['staff_id'] ? (int)$staff['staff_id'] : null,
                'view' => $g('view'), 'edit' => $g('edit'), 'approve' => $g('approve'), 'delete' => $g('delete'), 'export' => $g('export')];
    }

    private static function need(array $a, string $kind): void
    {
        if (empty($a[$kind])) {
            $what = ['view' => 'see exam halls, seating and admit cards', 'edit' => 'change exam halls, seating or duties',
                     'approve' => 'publish seating plans or admit cards', 'delete' => 'delete exam halls or seating plans',
                     'export' => 'print hall tickets'][$kind];
            throw new \DomainException("You don't have permission to $what. Ask the school owner if you need it.");
        }
    }

    public static function today(string $client): string
    {
        return substr(Meetings::now($client), 0, 10);
    }

    /** Exams, sessions (current first), branches and what this person can do. */
    public static function setup(array $a): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $sessions = Analytics::sessions($c);
        $current = null;
        foreach ($sessions as $s) {
            if ($s['current']) {
                $current = $s['id'];
            }
        }
        $branches = [];
        try {
            $branches = array_map(fn($r) => ['branch_id' => (int)$r['branch_id'], 'name' => (string)$r['branch_name']],
                self::q('SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_name', [$c]));
        } catch (\Throwable $e) {
        }

        return ['exams' => self::exams($c), 'sessions' => $sessions, 'current_session' => $current ?? ($sessions[0]['id'] ?? null),
                'branches' => count($branches) > 1 ? $branches : [], 'halls' => count(self::halls($a)),
                'can' => array_intersect_key($a, array_flip(['view', 'edit', 'approve', 'delete', 'export'])) + ['has_staff' => $a['staff_id'] !== null],
                'modes' => self::MODES, 'spacings' => self::SPACINGS, 'roles' => self::ROLES, 'today' => self::today($c),
                'school' => self::school($c, false)];
    }

    public static function exams(string $client): array
    {
        return array_map(fn($r) => ['exam_id' => (int)$r['exam_id'], 'name' => (string)$r['exam_name']],
            self::q('SELECT exam_id, exam_name FROM ssms_exams WHERE ssms_client_code = ? ORDER BY exam_id DESC', [$client]));
    }

    private static function exam(string $client, int $examId): array
    {
        $r = self::db()->execute('SELECT exam_id, exam_name FROM ssms_exams WHERE exam_id = ? AND ssms_client_code = ?', [$examId, $client])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Exam not found.');
        }

        return ['exam_id' => (int)$r['exam_id'], 'name' => (string)$r['exam_name']];
    }

    private static function session(string $client, int $sessionId): array
    {
        foreach (Analytics::sessions($client) as $s) {
            if ($s['id'] === $sessionId) {
                return $s;
            }
        }
        throw new \InvalidArgumentException('School year (session) not found.');
    }

    // ── Halls ───────────────────────────────────────────────────────────────

    /** "A".."Z", "AA".. for row numbers 1, 2, … */
    public static function rowLabel(int $r): string
    {
        $s = '';
        while ($r > 0) {
            $m = ($r - 1) % 26;
            $s = chr(65 + $m) . $s;
            $r = intdiv($r - 1, 26);
        }

        return $s;
    }

    public static function seatLabel(int $r, int $c): string
    {
        return self::rowLabel($r) . $c;
    }

    /** "A3, b5" → [[1,3],[2,5]] (validated against the hall size) */
    private static function parseBlocked(string $text, int $rows, int $cols): array
    {
        $out = [];
        foreach (preg_split('/[\s,;]+/', strtoupper(trim($text)), -1, PREG_SPLIT_NO_EMPTY) as $tok) {
            if (!preg_match('/^([A-Z]{1,2})(\d{1,3})$/', $tok, $m)) {
                throw new \InvalidArgumentException("\"$tok\" isn't a seat. Use row letter + desk number, e.g. A3.");
            }
            $r = 0;
            foreach (str_split($m[1]) as $ch) {
                $r = $r * 26 + (ord($ch) - 64);
            }
            $c = (int)$m[2];
            if ($r < 1 || $r > $rows || $c < 1 || $c > $cols) {
                throw new \InvalidArgumentException("Seat $tok is outside the hall ($rows rows × $cols desks).");
            }
            $out[$r . '-' . $c] = [$r, $c];
        }

        return array_values($out);
    }

    private static function castHall(array $r): array
    {
        $rows = (int)$r['seat_rows'];
        $cols = (int)$r['seat_cols'];
        $blocked = [];
        try {
            $blocked = self::parseBlocked((string)($r['blocked'] ?? ''), $rows, $cols);
        } catch (\Throwable $e) {
        }

        return ['hall_id' => (int)$r['hall_id'], 'name' => (string)$r['name'], 'location' => $r['location'], 'branch_id' => (int)$r['branch_id'],
                'rows' => $rows, 'cols' => $cols, 'blocked' => array_map(fn($x) => self::seatLabel($x[0], $x[1]), $blocked),
                'capacity' => $rows * $cols - count($blocked), 'active' => (int)$r['active'] === 1];
    }

    public static function halls(array $a, bool $all = false, ?int $branchId = null): array
    {
        self::need($a, 'view');
        $sql = 'SELECT * FROM ssms_exam_halls WHERE ssms_client_code = ?';
        $p = [$a['client']];
        if (!$all) {
            $sql .= ' AND active = 1';
        }
        if ($branchId) {
            $sql .= ' AND (branch_id = 0 OR branch_id = ?)';
            $p[] = $branchId;
        }
        $out = array_map([self::class, 'castHall'], self::q($sql . ' ORDER BY name', $p));
        foreach ($out as &$h) {
            $h['plans'] = (int)(self::db()->execute('SELECT COUNT(DISTINCT plan_id) n FROM ssms_exam_seats WHERE hall_id = ? AND ssms_client_code = ?', [$h['hall_id'], $a['client']])->fetch('assoc')['n'] ?? 0);
        }
        unset($h);

        return $out;
    }

    private static function hall(string $client, int $id): array
    {
        $r = self::db()->execute('SELECT * FROM ssms_exam_halls WHERE hall_id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Exam hall not found.');
        }

        return self::castHall($r);
    }

    public static function saveHall(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $id = (int)($d['hall_id'] ?? 0);
        $name = self::text($d['name'] ?? '', 80);
        if ($name === '') {
            throw new \InvalidArgumentException('Give the hall a name, e.g. "Room 12" or "Main hall".');
        }
        $rows = (int)($d['rows'] ?? 0);
        $cols = (int)($d['cols'] ?? 0);
        if ($rows < 1 || $rows > self::MAX_ROWS || $cols < 1 || $cols > self::MAX_COLS) {
            throw new \InvalidArgumentException('Rows must be 1–' . self::MAX_ROWS . ' and desks per row 1–' . self::MAX_COLS . '.');
        }
        $blocked = self::parseBlocked((string)($d['blocked'] ?? ''), $rows, $cols);
        if (count($blocked) >= $rows * $cols) {
            throw new \InvalidArgumentException('Every seat is blocked – the hall would hold no one.');
        }
        $blockedTxt = implode(', ', array_map(fn($x) => self::seatLabel($x[0], $x[1]), $blocked));
        $dupe = self::db()->execute('SELECT hall_id FROM ssms_exam_halls WHERE ssms_client_code = ? AND name = ? AND hall_id <> ?', [$c, $name, $id])->fetch('assoc');
        if ($dupe) {
            throw new \InvalidArgumentException('Another hall already has this name.');
        }
        $active = array_key_exists('active', $d) ? (!empty($d['active']) ? 1 : 0) : 1;
        $now = AccountSecurity::now();
        if ($id) {
            $old = self::hall($c, $id);
            // seats already given out must still exist
            $used = self::q('SELECT s.seat_row, s.seat_col, p.plan_id, p.exam_date FROM ssms_exam_seats s JOIN ssms_exam_seat_plans p ON p.plan_id = s.plan_id
                              WHERE s.hall_id = ? AND s.ssms_client_code = ? AND p.exam_date >= ?', [$id, $c, self::today($c)]);
            $blockedSet = array_flip(array_map(fn($x) => $x[0] . '-' . $x[1], $blocked));
            foreach ($used as $u) {
                if ((int)$u['seat_row'] > $rows || (int)$u['seat_col'] > $cols || isset($blockedSet[$u['seat_row'] . '-' . $u['seat_col']])) {
                    throw new \InvalidArgumentException('Seat ' . self::seatLabel((int)$u['seat_row'], (int)$u['seat_col']) . ' is used by the seating plan for ' . $u['exam_date']
                        . '. Regenerate that plan without this hall first, or keep the hall size.');
                }
            }
            if (!$active && $used) {
                throw new \InvalidArgumentException('This hall is used by an upcoming seating plan, so it can\'t be switched off yet.');
            }
            self::db()->execute('UPDATE ssms_exam_halls SET name = ?, location = ?, branch_id = ?, seat_rows = ?, seat_cols = ?, blocked = ?, active = ?, modified = ? WHERE hall_id = ? AND ssms_client_code = ?',
                [$name, self::text($d['location'] ?? '', 120) ?: null, array_key_exists('branch_id', $d) ? max(0, (int)$d['branch_id']) : $old['branch_id'], $rows, $cols, $blockedTxt ?: null, $active, $now, $id, $c]);
        } else {
            self::db()->execute('INSERT INTO ssms_exam_halls (ssms_client_code, branch_id, name, location, seat_rows, seat_cols, blocked, active, created, modified) VALUES (?,?,?,?,?,?,?,?,?,?)',
                [$c, max(0, (int)($d['branch_id'] ?? 0)), $name, self::text($d['location'] ?? '', 120) ?: null, $rows, $cols, $blockedTxt ?: null, $active, $now, $now]);
            $id = self::lastId();
        }

        return ['hall' => self::hall($c, $id), 'is_new' => empty($d['hall_id'])];
    }

    /** Deletes an unused hall; a hall that seating plans refer to is switched off instead. */
    public static function deleteHall(array $a, int $id): array
    {
        self::need($a, 'delete');
        $h = self::hall($a['client'], $id);
        $used = (int)(self::db()->execute('SELECT COUNT(*) n FROM ssms_exam_seats WHERE hall_id = ? AND ssms_client_code = ?', [$id, $a['client']])->fetch('assoc')['n'] ?? 0);
        if ($used) {
            $upcoming = self::db()->execute('SELECT 1 FROM ssms_exam_seats s JOIN ssms_exam_seat_plans p ON p.plan_id = s.plan_id WHERE s.hall_id = ? AND s.ssms_client_code = ? AND p.exam_date >= ? LIMIT 1',
                [$id, $a['client'], self::today($a['client'])])->fetch('assoc');
            if ($upcoming) {
                throw new \InvalidArgumentException('This hall is used by an upcoming seating plan. Regenerate that plan without it first.');
            }
            self::db()->execute('UPDATE ssms_exam_halls SET active = 0, modified = ? WHERE hall_id = ? AND ssms_client_code = ?', [AccountSecurity::now(), $id, $a['client']]);

            return ['hall' => $h, 'deleted' => false, 'message' => 'Past seating plans use this hall, so it was switched off instead of deleted.'];
        }
        self::db()->execute('DELETE FROM ssms_exam_halls WHERE hall_id = ? AND ssms_client_code = ?', [$id, $a['client']]);

        return ['hall' => $h, 'deleted' => true, 'message' => 'Hall deleted.'];
    }

    // ── Sittings (from the date sheet) ──────────────────────────────────────

    private static function hm($t): string
    {
        return preg_match('/^(\d{1,2}):(\d{2})/', (string)$t, $m) ? sprintf('%02d:%s', (int)$m[1], $m[2]) : '';
    }

    /** Date-sheet rows for an exam in a session / branch (0 in the date sheet = every session / branch). */
    private static function sheet(string $client, int $examId, int $sessionId, int $branchId, ?array $classIds = null): array
    {
        $sql = 'SELECT d.datesheet_id, d.class_id, d.subject_id, d.branch_id, d.exam_date, d.start_time, d.end_time, d.venue, d.is_published, c.class_name, s.subject_name
                  FROM ssms_exam_datesheet d
             LEFT JOIN ssms_classes c ON c.class_id = d.class_id
             LEFT JOIN ssms_subjects s ON s.subject_id = d.subject_id
                 WHERE d.ssms_client_code = ? AND d.exam_id = ? AND (d.session_id = 0 OR d.session_id = ?)';
        $p = [$client, $examId, $sessionId];
        if ($branchId) {
            $sql .= ' AND (d.branch_id = 0 OR d.branch_id = ?)';
            $p[] = $branchId;
        }
        if ($classIds !== null) {
            if (!$classIds) {
                return [];
            }
            $sql .= ' AND d.class_id IN (' . implode(',', array_fill(0, count($classIds), '?')) . ')';
            $p = array_merge($p, array_map('intval', $classIds));
        }
        // a row for this session / branch wins over a "0 = all" row for the same class + subject (specific rows come last)
        $rows = self::q($sql . ' ORDER BY (d.session_id <> 0), (d.branch_id <> 0), d.datesheet_id', $p);
        $best = [];
        foreach ($rows as $r) {
            $k = $r['class_id'] . '|' . $r['subject_id'] . ($branchId ? '' : '|' . (int)($r['branch_id'] ?? 0));
            $best[$k] = $r;
        }
        $out = array_values($best);
        usort($out, fn($x, $y) => [(string)$x['exam_date'], self::hm($x['start_time']), (string)($x['class_name'] ?? '')] <=> [(string)$y['exam_date'], self::hm($y['start_time']), (string)($y['class_name'] ?? '')]);

        return $out;
    }

    /** Does the exam's date sheet give some branches their own dates? Then seating is done branch by branch. */
    private static function branchRows(string $client, int $examId, int $sessionId): bool
    {
        return (bool)self::db()->execute('SELECT 1 FROM ssms_exam_datesheet WHERE ssms_client_code = ? AND exam_id = ? AND (session_id = 0 OR session_id = ?) AND branch_id <> 0 LIMIT 1',
            [$client, $examId, $sessionId])->fetch('assoc');
    }

    private static function needBranch(string $client, int $examId, int $sessionId, int $branchId): void
    {
        if (!$branchId && self::branchRows($client, $examId, $sessionId)) {
            throw new \DomainException('This exam\'s date sheet has different dates for some branches. Choose a branch to see its sittings and make seating plans.');
        }
    }

    /** Active students of a class (optionally one section) in the session, roll order. */
    private static function students(string $client, int $sessionId, int $branchId, array $groups): array
    {
        if (!$groups) {
            return [];
        }
        $or = [];
        $p = [$client, $sessionId];
        foreach ($groups as $g) {
            if (!empty($g['section_id'])) {
                $or[] = '(e.class_id = ? AND e.section_id = ?)';
                $p[] = (int)$g['class_id'];
                $p[] = (int)$g['section_id'];
            } else {
                $or[] = 'e.class_id = ?';
                $p[] = (int)$g['class_id'];
            }
        }
        $sql = "SELECT e.enrollment_id, e.registration_id, e.class_id, e.section_id, e.branch_id, e.roll_number, r.student_first_name, r.student_last_name,
                       c.class_name, sec.section_name
                  FROM ssms_student_enrollment e
                  JOIN ssms_student_registration r ON r.registration_id = e.registration_id AND r.ssms_client_code = e.ssms_client_code
             LEFT JOIN ssms_classes c ON c.class_id = e.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
                 WHERE e.ssms_client_code = ? AND e.session_id = ? AND COALESCE(e.status, 'active') = 'active' AND (" . implode(' OR ', $or) . ')';
        if ($branchId) {
            $sql .= ' AND e.branch_id = ?';
            $p[] = $branchId;
        }
        $rows = self::q($sql . ' ORDER BY e.class_id, sec.section_name, CAST(e.roll_number AS UNSIGNED), e.roll_number, r.student_first_name', $p);

        return array_map(fn($r) => ['enrollment_id' => (string)$r['enrollment_id'], 'registration_id' => (string)$r['registration_id'], 'class_id' => (int)$r['class_id'],
            'section_id' => $r['section_id'] !== null ? (int)$r['section_id'] : null, 'roll' => (string)($r['roll_number'] ?? ''),
            'name' => trim($r['student_first_name'] . ' ' . $r['student_last_name']),
            'class_name' => trim(($r['class_name'] ?? '') . ' ' . ($r['section_name'] ?? '')), 'class_only' => (string)($r['class_name'] ?? ('Class ' . $r['class_id'])),
            'branch_id' => (int)($r['branch_id'] ?? 0)], $rows);
    }

    /** Every date + start time in the exam's date sheet, with the classes sitting it and its seating plan. */
    public static function sittings(array $a, int $examId, int $sessionId, int $branchId = 0): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $exam = self::exam($c, $examId);
        self::session($c, $sessionId);
        self::needBranch($c, $examId, $sessionId, $branchId);
        $out = [];
        foreach (self::sheet($c, $examId, $sessionId, $branchId) as $r) {
            $k = $r['exam_date'] . ' ' . self::hm($r['start_time']);
            if (!isset($out[$k])) {
                $out[$k] = ['key' => $k, 'exam_date' => substr((string)$r['exam_date'], 0, 10), 'start_time' => self::hm($r['start_time']),
                            'end_time' => self::hm($r['end_time']) ?: null, 'classes' => [], 'published' => true, 'plan' => null];
            }
            $cid = (int)$r['class_id'];
            if (!isset($out[$k]['classes'][$cid])) {
                $out[$k]['classes'][$cid] = ['class_id' => $cid, 'name' => (string)($r['class_name'] ?? 'Class ' . $cid), 'subjects' => [], 'students' => 0, 'sections' => []];
            }
            $out[$k]['classes'][$cid]['subjects'][] = (string)($r['subject_name'] ?? 'Subject ' . $r['subject_id']);
            $out[$k]['published'] = $out[$k]['published'] && (int)$r['is_published'] === 1;
            if (self::hm($r['end_time']) > (string)$out[$k]['end_time']) {
                $out[$k]['end_time'] = self::hm($r['end_time']);
            }
        }
        // students per class / section
        foreach ($out as &$s) {
            foreach ($s['classes'] as &$cl) {
                $sql = "SELECT e.section_id, sec.section_name, COUNT(*) n FROM ssms_student_enrollment e LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
                         WHERE e.ssms_client_code = ? AND e.session_id = ? AND e.class_id = ? AND COALESCE(e.status, 'active') = 'active'";
                $p = [$c, $sessionId, $cl['class_id']];
                if ($branchId) {
                    $sql .= ' AND e.branch_id = ?';
                    $p[] = $branchId;
                }
                foreach (self::q($sql . ' GROUP BY e.section_id, sec.section_name ORDER BY sec.section_name', $p) as $x) {
                    $cl['sections'][] = ['section_id' => $x['section_id'] !== null ? (int)$x['section_id'] : null, 'name' => (string)($x['section_name'] ?? ''), 'students' => (int)$x['n']];
                    $cl['students'] += (int)$x['n'];
                }
            }
            unset($cl);
            $s['classes'] = array_values($s['classes']);
            $s['students'] = array_sum(array_column($s['classes'], 'students'));
        }
        unset($s);
        // plans
        foreach (self::q('SELECT p.*, (SELECT COUNT(*) FROM ssms_exam_seats x WHERE x.plan_id = p.plan_id) seated,
                                 (SELECT COUNT(*) FROM ssms_exam_duties d WHERE d.plan_id = p.plan_id) duties
                            FROM ssms_exam_seat_plans p WHERE p.ssms_client_code = ? AND p.exam_id = ? AND p.session_id = ? AND p.branch_id = ?',
            [$c, $examId, $sessionId, $branchId]) as $p) {
            $k = substr((string)$p['exam_date'], 0, 10) . ' ' . $p['start_time'];
            $summary = ['plan_id' => (int)$p['plan_id'], 'status' => $p['status'], 'seated' => (int)$p['seated'], 'duties' => (int)$p['duties'],
                        'halls' => count((array)json_decode((string)$p['halls_json'], true))];
            if (isset($out[$k])) {
                $out[$k]['plan'] = $summary;
            } else {
                // the date sheet changed after the plan was made – keep showing the plan so it can be fixed or deleted
                $out[$k] = ['key' => $k, 'exam_date' => substr((string)$p['exam_date'], 0, 10), 'start_time' => $p['start_time'], 'end_time' => $p['end_time'],
                            'classes' => [], 'students' => 0, 'published' => false, 'plan' => $summary, 'orphan' => true];
            }
        }
        ksort($out);

        return ['exam' => $exam, 'session_id' => $sessionId, 'branch_id' => $branchId, 'sittings' => array_values($out), 'today' => self::today($c)];
    }

    // ── Seating plans ───────────────────────────────────────────────────────

    /** Usable seats of a hall in fill order (row by row), after blocked seats and spacing. */
    private static function usableSeats(array $h, string $spacing): array
    {
        $blocked = array_flip($h['blocked']);
        $out = [];
        for ($r = 1; $r <= $h['rows']; $r++) {
            for ($col = 1; $col <= $h['cols']; $col++) {
                if (isset($blocked[self::seatLabel($r, $col)])) {
                    continue;
                }
                if ($spacing === 'alternate' && $col % 2 === 0) {
                    continue;
                }
                if ($spacing === 'checker' && ($r + $col) % 2 === 1) {
                    continue;
                }
                $out[] = [$r, $col];
            }
        }

        return $out;
    }

    /**
     * Create or redo the seating plan for one sitting.
     * d: exam_id, session_id, branch_id, exam_date, start_time, end_time, classes [{class_id, section_id?}], hall_ids [..], mode, spacing
     */
    public static function generatePlan(array $a, array $d): array
    {
        self::need($a, 'edit');
        // one generation per school and day at a time: the "already has a seat" check and the save must not interleave
        $lock = 'ssms_seat_' . md5($a['client'] . '|' . (string)($d['exam_date'] ?? ''));
        $got = self::db()->execute('SELECT GET_LOCK(?, 15) l', [$lock])->fetch('assoc');
        if ((int)($got['l'] ?? 0) !== 1) {
            throw new \DomainException('Someone else is making a seating plan for this day. Try again in a moment.');
        }
        try {
            return self::generatePlanLocked($a, $d);
        } finally {
            self::db()->execute('SELECT RELEASE_LOCK(?)', [$lock]);
        }
    }

    private static function generatePlanLocked(array $a, array $d): array
    {
        $c = $a['client'];
        $examId = (int)($d['exam_id'] ?? 0);
        $sessionId = (int)($d['session_id'] ?? 0);
        $branchId = max(0, (int)($d['branch_id'] ?? 0));
        self::exam($c, $examId);
        self::session($c, $sessionId);
        self::needBranch($c, $examId, $sessionId, $branchId);
        $date = (string)($d['exam_date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || \DateTime::createFromFormat('Y-m-d', $date)->format('Y-m-d') !== $date) {
            throw new \InvalidArgumentException('Exam date must be YYYY-MM-DD.');
        }
        $start = self::hm($d['start_time'] ?? '');
        $end = self::hm($d['end_time'] ?? '') ?: null;
        if ($start === '') {
            throw new \InvalidArgumentException('This paper has no start time. Set the time in the date sheet first, so seating and invigilator duties don\'t clash.');
        }
        if ($end !== null && $end <= $start) {
            throw new \InvalidArgumentException('The end time must be after the start time.');
        }
        $mode = isset(self::MODES[$d['mode'] ?? '']) ? $d['mode'] : 'mixed';
        $spacing = isset(self::SPACINGS[$d['spacing'] ?? '']) ? $d['spacing'] : 'all';
        $groups = [];
        foreach ((array)($d['classes'] ?? []) as $g) {
            $cid = (int)($g['class_id'] ?? 0);
            if ($cid) {
                $groups[$cid . '|' . (int)($g['section_id'] ?? 0)] = ['class_id' => $cid, 'section_id' => (int)($g['section_id'] ?? 0) ?: null];
            }
        }
        if (!$groups) {
            throw new \InvalidArgumentException('Choose at least one class to seat.');
        }
        // a whole class makes its single sections redundant
        foreach ($groups as $k => $g) {
            if ($g['section_id'] && isset($groups[$g['class_id'] . '|0'])) {
                unset($groups[$k]);
            }
        }
        $groups = array_values($groups);
        $hallIds = array_values(array_unique(array_map('intval', (array)($d['hall_ids'] ?? []))));
        if (!$hallIds) {
            throw new \InvalidArgumentException('Choose at least one exam hall.');
        }
        $halls = [];
        foreach ($hallIds as $hid) {
            $h = self::hall($c, $hid);
            if (!$h['active']) {
                throw new \InvalidArgumentException($h['name'] . ' is switched off.');
            }
            if ($branchId && $h['branch_id'] && $h['branch_id'] !== $branchId) {
                throw new \InvalidArgumentException($h['name'] . ' belongs to another branch.');
            }
            $halls[] = $h;
        }
        $students = self::students($c, $sessionId, $branchId, $groups);
        if (!$students) {
            throw new \InvalidArgumentException('No active students in the chosen classes.');
        }
        $plan = self::db()->execute('SELECT * FROM ssms_exam_seat_plans WHERE ssms_client_code = ? AND exam_id = ? AND session_id = ? AND branch_id = ? AND exam_date = ? AND start_time = ?',
            [$c, $examId, $sessionId, $branchId, $date, $start])->fetch('assoc');
        if ($plan && $plan['status'] === 'published') {
            throw new \DomainException('This seating plan is published. Unpublish it before generating it again (students may already have seen their seats).');
        }
        // nobody can sit two papers at once
        $planId = $plan ? (int)$plan['plan_id'] : 0;
        $eids = array_column($students, 'enrollment_id');
        $clash = [];
        [$w0, $w1] = self::window(['start_time' => $start, 'end_time' => $end]);
        foreach (array_chunk($eids, 500) as $chunk) {
            $in = implode(',', array_fill(0, count($chunk), '?'));
            foreach (self::q("SELECT s.enrollment_id, p.exam_date, p.start_time, p.end_time, h.name FROM ssms_exam_seats s JOIN ssms_exam_seat_plans p ON p.plan_id = s.plan_id
                               JOIN ssms_exam_halls h ON h.hall_id = s.hall_id
                              WHERE s.ssms_client_code = ? AND p.exam_date = ? AND p.plan_id <> ? AND s.enrollment_id IN ($in)",
                array_merge([$c, $date, $planId], $chunk)) as $x) {
                [$x0, $x1] = self::window($x);
                if ($x0 < $w1 && $w0 < $x1) {
                    $clash[] = $x;
                }
            }
        }
        if ($clash) {
            throw new \InvalidArgumentException(count($clash) . ' of these students already have a seat at this time in another seating plan (e.g. ' . $clash[0]['name']
                . '). Remove them from that plan or choose other classes.');
        }
        // seats
        $places = [];
        foreach ($halls as $h) {
            foreach (self::usableSeats($h, $spacing) as [$r, $col]) {
                $places[] = [$h['hall_id'], $r, $col];
            }
        }
        if (count($students) > count($places)) {
            throw new \InvalidArgumentException('Not enough seats: ' . count($students) . ' students, but the chosen halls hold ' . count($places)
                . ' with "' . self::SPACINGS[$spacing] . '". Add a hall or use closer spacing.');
        }
        $alloc = self::allocate($students, $places, $mode);
        $now = AccountSecurity::now();
        self::tx(function () use ($c, $plan, &$planId, $examId, $sessionId, $branchId, $date, $start, $end, $mode, $spacing, $groups, $hallIds, $alloc, $a, $now) {
            if ($plan) {
                $locked = self::db()->execute('SELECT status FROM ssms_exam_seat_plans WHERE plan_id = ? FOR UPDATE', [$planId])->fetch('assoc');
                if (($locked['status'] ?? '') === 'published') {
                    throw new \DomainException('This seating plan was just published by someone else.');
                }
                self::db()->execute('UPDATE ssms_exam_seat_plans SET end_time = ?, mode = ?, spacing = ?, classes_json = ?, halls_json = ?, students = ?, modified = ? WHERE plan_id = ?',
                    [$end, $mode, $spacing, json_encode($groups), json_encode($hallIds), count($alloc), $now, $planId]);
                self::db()->execute('DELETE FROM ssms_exam_seats WHERE plan_id = ?', [$planId]);
                // invigilators of halls no longer in the plan go too
                $in = implode(',', array_fill(0, count($hallIds), '?'));
                self::db()->execute("DELETE FROM ssms_exam_duties WHERE plan_id = ? AND hall_id NOT IN ($in)", array_merge([$planId], $hallIds));
            } else {
                self::db()->execute('INSERT INTO ssms_exam_seat_plans (ssms_client_code, exam_id, session_id, branch_id, exam_date, start_time, end_time, mode, spacing, classes_json, halls_json, students, status, created_by, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    [$c, $examId, $sessionId, $branchId, $date, $start, $end, $mode, $spacing, json_encode($groups), json_encode($hallIds), count($alloc), 'draft', mb_substr($a['user'], 0, 100), $now, $now]);
                $planId = self::lastId();
            }
            foreach (array_chunk($alloc, 200) as $chunk) {
                $vals = [];
                $p = [];
                foreach ($chunk as $x) {
                    $vals[] = '(?,?,?,?,?,?,?,?,?)';
                    array_push($p, $planId, $c, $x['enrollment_id'], $x['class_id'], $x['section_id'], $x['hall_id'], $x['row'], $x['col'], $x['seat_no']);
                }
                self::db()->execute('INSERT INTO ssms_exam_seats (plan_id, ssms_client_code, enrollment_id, class_id, section_id, hall_id, seat_row, seat_col, seat_no) VALUES ' . implode(',', $vals), $p);
            }
        });

        return ['plan' => self::plan($a, $planId), 'is_new' => !$plan];
    }

    /**
     * Seat students. "class": class after class in roll order. "mixed": each seat takes the class with the most students
     * left that differs from the student beside (left) and in front – so neighbours write different papers.
     */
    private static function allocate(array $students, array $places, string $mode): array
    {
        $queues = [];
        foreach ($students as $s) {
            $queues[$s['class_id']][] = $s;
        }
        $out = [];
        $at = [];           // hall|row|col => class_id
        $lastInRow = [];    // hall|row => class_id of the previous seat filled in that row
        $seatNo = [];
        $i = 0;
        foreach ($places as [$hid, $r, $col]) {
            if (!$queues) {
                break;
            }
            if ($mode === 'class') {
                $cid = array_key_first($queues);
            } else {
                $left = $lastInRow[$hid . '|' . $r] ?? null;
                $front = $at[$hid . '|' . ($r - 1) . '|' . $col] ?? null;
                $order = array_keys($queues);
                usort($order, fn($x, $y) => [count($queues[$y]), $x] <=> [count($queues[$x]), $y]);
                $cid = null;
                foreach ($order as $k) {
                    if ($k !== $left && $k !== $front) {
                        $cid = $k;
                        break;
                    }
                }
                if ($cid === null) {
                    foreach ($order as $k) {
                        if ($k !== $left) {
                            $cid = $k;
                            break;
                        }
                    }
                }
                $cid = $cid ?? $order[0];
            }
            $s = array_shift($queues[$cid]);
            if (!$queues[$cid]) {
                unset($queues[$cid]);
            }
            $seatNo[$hid] = ($seatNo[$hid] ?? 0) + 1;
            $at[$hid . '|' . $r . '|' . $col] = $s['class_id'];
            $lastInRow[$hid . '|' . $r] = $s['class_id'];
            $out[] = $s + ['hall_id' => $hid, 'row' => $r, 'col' => $col, 'seat_no' => $seatNo[$hid]];
            $i++;
        }

        return $out;
    }

    private static function planRow(string $client, int $id): array
    {
        $p = self::db()->execute('SELECT * FROM ssms_exam_seat_plans WHERE plan_id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc');
        if (!$p) {
            throw new \InvalidArgumentException('Seating plan not found.');
        }

        return $p;
    }

    /** A plan with every hall's seat grid, door lists (class → roll range) and invigilators. */
    public static function plan(array $a, int $id): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $p = self::planRow($c, $id);
        $exam = self::exam($c, (int)$p['exam_id']);
        $hallIds = array_map('intval', (array)json_decode((string)$p['halls_json'], true));
        $seats = self::q("SELECT s.*, r.student_first_name, r.student_last_name, e.roll_number, e.registration_id, cl.class_name, sec.section_name
                            FROM ssms_exam_seats s
                            JOIN ssms_student_enrollment e ON e.enrollment_id = s.enrollment_id AND e.ssms_client_code = s.ssms_client_code
                            JOIN ssms_student_registration r ON r.registration_id = e.registration_id AND r.ssms_client_code = e.ssms_client_code
                       LEFT JOIN ssms_classes cl ON cl.class_id = s.class_id
                       LEFT JOIN ssms_sections sec ON sec.section_id = s.section_id
                           WHERE s.plan_id = ? ORDER BY s.hall_id, s.seat_row, s.seat_col", [$id]);
        $byHall = [];
        foreach ($seats as $s) {
            $byHall[(int)$s['hall_id']][] = ['enrollment_id' => (string)$s['enrollment_id'], 'name' => trim($s['student_first_name'] . ' ' . $s['student_last_name']),
                'class_id' => (int)$s['class_id'], 'class_name' => trim(($s['class_name'] ?? '') . ' ' . ($s['section_name'] ?? '')), 'class_only' => (string)($s['class_name'] ?? 'Class ' . $s['class_id']), 'roll' => (string)($s['roll_number'] ?? ''),
                'row' => (int)$s['seat_row'], 'col' => (int)$s['seat_col'], 'label' => self::seatLabel((int)$s['seat_row'], (int)$s['seat_col']), 'seat_no' => (int)$s['seat_no']];
        }
        $duties = self::dutyRows($c, $id);
        $halls = [];
        foreach ($hallIds as $hid) {
            try {
                $h = self::hall($c, $hid);
            } catch (\Throwable $e) {
                continue;
            }
            $list = $byHall[$hid] ?? [];
            $door = [];
            foreach ($list as $s) {
                $k = $s['class_name'];
                if (!isset($door[$k])) {
                    $door[$k] = ['class_name' => $k, 'count' => 0, 'rolls' => []];
                }
                $door[$k]['count']++;
                $door[$k]['rolls'][] = $s['roll'];
            }
            foreach ($door as &$dd) {
                $nums = array_filter($dd['rolls'], 'is_numeric');
                usort($dd['rolls'], fn($x, $y) => [is_numeric($x) ? (int)$x : PHP_INT_MAX, $x] <=> [is_numeric($y) ? (int)$y : PHP_INT_MAX, $y]);
                $dd['from'] = $dd['rolls'][0] ?? '';
                $dd['to'] = end($dd['rolls']) ?: '';
                $dd['numeric'] = count($nums) === count($dd['rolls']);
                unset($dd['rolls']);
            }
            unset($dd);
            $h['seats'] = $list;
            $h['used'] = count($list);
            $h['usable'] = count(self::usableSeats($h, (string)$p['spacing']));
            $h['door'] = array_values($door);
            $h['duties'] = array_values(array_filter($duties, fn($x) => $x['hall_id'] === $hid));
            $halls[] = $h;
        }
        $classes = (array)json_decode((string)$p['classes_json'], true);
        $names = [];
        foreach ($classes as $g) {
            $names[] = self::className($c, (int)$g['class_id'], $g['section_id'] ? (int)$g['section_id'] : null, !$g['section_id']);
        }

        return ['plan_id' => (int)$p['plan_id'], 'exam' => $exam, 'session_id' => (int)$p['session_id'], 'branch_id' => (int)$p['branch_id'],
                'exam_date' => substr((string)$p['exam_date'], 0, 10), 'start_time' => $p['start_time'], 'end_time' => $p['end_time'],
                'mode' => $p['mode'], 'spacing' => $p['spacing'], 'classes' => $classes, 'class_names' => $names, 'hall_ids' => $hallIds,
                'status' => $p['status'], 'students' => count($seats), 'halls' => $halls, 'duties' => count($duties),
                'can' => ['edit' => $a['edit'], 'approve' => $a['approve'], 'delete' => $a['delete'], 'export' => $a['export']]];
    }

    /** Move a student to another seat of the plan; if someone sits there, they swap. */
    public static function moveSeat(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $id = (int)($d['plan_id'] ?? 0);
        $p = self::planRow($c, $id);
        $eid = (string)($d['enrollment_id'] ?? '');
        $hid = (int)($d['hall_id'] ?? 0);
        $r = (int)($d['row'] ?? 0);
        $col = (int)($d['col'] ?? 0);
        if (!in_array($hid, array_map('intval', (array)json_decode((string)$p['halls_json'], true)), true)) {
            throw new \InvalidArgumentException('That hall isn\'t part of this seating plan.');
        }
        $h = self::hall($c, $hid);
        if ($r < 1 || $r > $h['rows'] || $col < 1 || $col > $h['cols'] || in_array(self::seatLabel($r, $col), $h['blocked'], true)) {
            throw new \InvalidArgumentException('That seat doesn\'t exist or is blocked.');
        }
        $swapWith = null;
        self::tx(function () use ($id, $eid, $hid, $r, $col, &$swapWith) {
            $me = self::db()->execute('SELECT * FROM ssms_exam_seats WHERE plan_id = ? AND enrollment_id = ? FOR UPDATE', [$id, $eid])->fetch('assoc');
            if (!$me) {
                throw new \InvalidArgumentException('This student isn\'t in the seating plan.');
            }
            $other = self::db()->execute('SELECT * FROM ssms_exam_seats WHERE plan_id = ? AND hall_id = ? AND seat_row = ? AND seat_col = ? FOR UPDATE', [$id, $hid, $r, $col])->fetch('assoc');
            if ($other && (int)$other['id'] === (int)$me['id']) {
                return;
            }
            if ($other) {
                $swapWith = (string)$other['enrollment_id'];
                // park, then swap (the seat place is unique)
                self::db()->execute('UPDATE ssms_exam_seats SET seat_row = 0, seat_col = 0 WHERE id = ?', [$me['id']]);
                self::db()->execute('UPDATE ssms_exam_seats SET hall_id = ?, seat_row = ?, seat_col = ?, seat_no = ? WHERE id = ?',
                    [$me['hall_id'], $me['seat_row'], $me['seat_col'], $me['seat_no'], $other['id']]);
                self::db()->execute('UPDATE ssms_exam_seats SET hall_id = ?, seat_row = ?, seat_col = ?, seat_no = ? WHERE id = ?',
                    [$hid, $r, $col, $other['seat_no'], $me['id']]);
            } else {
                $no = (int)(self::db()->execute('SELECT COALESCE(MAX(seat_no), 0) + 1 n FROM ssms_exam_seats WHERE plan_id = ? AND hall_id = ?', [$id, $hid])->fetch('assoc')['n'] ?? 1);
                self::db()->execute('UPDATE ssms_exam_seats SET hall_id = ?, seat_row = ?, seat_col = ?, seat_no = ? WHERE id = ?', [$hid, $r, $col, $no, $me['id']]);
            }
        });
        self::db()->execute('UPDATE ssms_exam_seat_plans SET modified = ? WHERE plan_id = ?', [AccountSecurity::now(), $id]);
        $view = self::plan($a, $id);
        $told = 0;
        if ($p['status'] === 'published') {
            // the moved student and whoever they swapped with
            $who = [];
            foreach ($view['halls'] as $h) {
                foreach ($h['seats'] as $st) {
                    if ($st['enrollment_id'] === $eid || ($h['hall_id'] === $hid && $st['row'] === $r && $st['col'] === $col) || ($swapWith !== null && $st['enrollment_id'] === $swapWith)) {
                        $who[$st['enrollment_id']] = $h['name'] . ' ' . $st['label'];
                    }
                }
            }
            // the words are written per phone, in that family's language
            $when = fn() => Locale::date($c, (string)$p['exam_date'], 'long') . ($p['start_time'] ? ' ' . Locale::time($c, $p['start_time']) : '');
            foreach ($who as $e => $where) {
                $told += self::notifyParents($c, (int)$p['exam_id'], [$e],
                    fn() => [Locale::t($c, 'Exam seat changed'), Locale::t($c, 'New seat for {when}: {seat}.', ['when' => $when(), 'seat' => $where])]);
            }
        }

        return ['plan' => $view, 'notified' => $told];
    }

    public static function publishPlan(array $a, int $id, bool $publish): array
    {
        self::need($a, 'approve');
        $c = $a['client'];
        $p = self::planRow($c, $id);
        if ($publish && !(int)(self::db()->execute('SELECT COUNT(*) n FROM ssms_exam_seats WHERE plan_id = ?', [$id])->fetch('assoc')['n'] ?? 0)) {
            throw new \InvalidArgumentException('Nobody is seated yet – generate the plan first.');
        }
        self::db()->execute('UPDATE ssms_exam_seat_plans SET status = ?, modified = ? WHERE plan_id = ? AND ssms_client_code = ?', [$publish ? 'published' : 'draft', AccountSecurity::now(), $id, $c]);
        $sent = 0;
        if ($publish && $p['status'] !== 'published') {
            $sent = self::notifyDuties($c, $id);
        }

        return ['plan' => self::plan($a, $id), 'notified' => $sent];
    }

    public static function deletePlan(array $a, int $id): array
    {
        self::need($a, 'delete');
        $c = $a['client'];
        $p = self::planRow($c, $id);
        self::tx(function () use ($id) {
            self::db()->execute('DELETE FROM ssms_exam_seats WHERE plan_id = ?', [$id]);
            self::db()->execute('DELETE FROM ssms_exam_duties WHERE plan_id = ?', [$id]);
            self::db()->execute('DELETE FROM ssms_exam_seat_plans WHERE plan_id = ?', [$id]);
        });

        return ['deleted' => true, 'exam_date' => substr((string)$p['exam_date'], 0, 10), 'start_time' => $p['start_time']];
    }

    // ── Invigilation ────────────────────────────────────────────────────────

    private static function dutyRows(string $client, int $planId): array
    {
        return array_map(fn($r) => ['id' => (int)$r['id'], 'hall_id' => (int)$r['hall_id'], 'staff_id' => (int)$r['staff_id'],
            'name' => trim($r['first_name'] . ' ' . $r['last_name']), 'role' => $r['duty_role'], 'role_label' => self::ROLES[$r['duty_role']] ?? $r['duty_role']],
            self::q("SELECT d.*, st.first_name, st.last_name FROM ssms_exam_duties d
                       JOIN ssms_staff st ON st.staff_id = d.staff_id AND st.ssms_client_code = d.ssms_client_code
                      WHERE d.plan_id = ? AND d.ssms_client_code = ? ORDER BY FIELD(d.duty_role, 'chief', 'invigilator', 'reliever'), st.first_name", [$planId, $client]));
    }

    /** Minutes since midnight; a sitting with no end time is taken as 3 hours. */
    private static function window(array $p): array
    {
        $toMin = fn($t) => preg_match('/^(\d{2}):(\d{2})$/', (string)$t, $m) ? (int)$m[1] * 60 + (int)$m[2] : null;
        $s = $toMin($p['start_time']);
        $e = $toMin($p['end_time']);
        if ($s === null) {
            return [0, 24 * 60];   // time unknown → the whole day
        }

        return [$s, $e !== null && $e > $s ? $e : $s + 180];
    }

    /** Staff who could invigilate this sitting, with why some can't (or shouldn't). */
    private static function staffFor(string $client, array $p): array
    {
        $date = substr((string)$p['exam_date'], 0, 10);
        [$s0, $e0] = self::window($p);
        $sql = "SELECT staff_id, first_name, last_name, branch_id FROM ssms_staff WHERE ssms_client_code = ? AND COALESCE(hired, 'Y') = 'Y' AND COALESCE(resigned, 'N') <> 'Y'";
        $par = [$client];
        if ((int)$p['branch_id']) {
            $sql .= ' AND (branch_id IS NULL OR branch_id = 0 OR branch_id = ?)';
            $par[] = (int)$p['branch_id'];
        }
        $staff = self::q($sql . ' ORDER BY first_name, last_name', $par);
        // busy elsewhere at the same time
        $busy = [];
        foreach (self::q('SELECT d.staff_id, p.plan_id, p.start_time, p.end_time, p.exam_date, h.name FROM ssms_exam_duties d JOIN ssms_exam_seat_plans p ON p.plan_id = d.plan_id
                            JOIN ssms_exam_halls h ON h.hall_id = d.hall_id
                           WHERE d.ssms_client_code = ? AND p.exam_date = ? AND p.plan_id <> ?', [$client, $date, (int)$p['plan_id']]) as $x) {
            [$s1, $e1] = self::window($x);
            if ($s1 < $e0 && $s0 < $e1) {
                $busy[(int)$x['staff_id']] = 'On duty in ' . $x['name'] . ' at ' . ($x['start_time'] ?: 'that time');
            }
        }
        // approved leave covering the day
        $leave = [];
        try {
            foreach (self::q("SELECT l.staff_id FROM ssms_leave_applications l JOIN ssms_staff st ON st.staff_id = l.staff_id AND st.ssms_client_code = ?
                               WHERE LOWER(l.status) IN ('approved', 'approve') AND l.from_date <= ? AND l.to_date >= ?", [$client, $date, $date]) as $x) {
                $leave[(int)$x['staff_id']] = true;
            }
        } catch (\Throwable $e) {
        }
        // teachers of the papers being written (only a warning – schools often allow it)
        $teaches = [];
        $groups = (array)json_decode((string)$p['classes_json'], true);
        $classIds = array_values(array_unique(array_map(fn($g) => (int)$g['class_id'], $groups)));
        $subjects = [];
        foreach (self::sheet($client, (int)$p['exam_id'], (int)$p['session_id'], (int)$p['branch_id'], $classIds) as $r) {
            if (substr((string)$r['exam_date'], 0, 10) === $date && self::hm($r['start_time']) === (string)$p['start_time']) {
                $subjects[] = [(int)$r['class_id'], (int)$r['subject_id'], (string)($r['subject_name'] ?? '')];
            }
        }
        foreach ($subjects as [$cid, $sid, $sname]) {
            foreach (self::q('SELECT DISTINCT staff_id FROM ssms_subject_teacher WHERE ssms_client_code = ? AND class_id = ? AND subject_id = ?', [$client, $cid, $sid]) as $x) {
                $teaches[(int)$x['staff_id']] = 'Teaches ' . $sname . ' (being written)';
            }
        }
        // load in this exam
        $load = [];
        foreach (self::q('SELECT d.staff_id, COUNT(*) n FROM ssms_exam_duties d JOIN ssms_exam_seat_plans p ON p.plan_id = d.plan_id
                           WHERE d.ssms_client_code = ? AND p.exam_id = ? AND p.session_id = ? GROUP BY d.staff_id', [$client, (int)$p['exam_id'], (int)$p['session_id']]) as $x) {
            $load[(int)$x['staff_id']] = (int)$x['n'];
        }

        return array_map(function ($r) use ($busy, $leave, $teaches, $load) {
            $id = (int)$r['staff_id'];

            return ['staff_id' => $id, 'name' => trim($r['first_name'] . ' ' . $r['last_name']), 'load' => $load[$id] ?? 0,
                    'busy' => $busy[$id] ?? null, 'on_leave' => isset($leave[$id]), 'teaches' => $teaches[$id] ?? null];
        }, $staff);
    }

    public static function duties(array $a, int $planId): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $p = self::planRow($c, $planId);
        $plan = self::plan($a, $planId);
        $staff = self::staffFor($c, $p);
        $here = [];
        foreach (self::dutyRows($c, $planId) as $d) {
            $here[$d['staff_id']] = $d['hall_id'];
        }
        foreach ($staff as &$s) {
            $s['assigned_hall'] = $here[$s['staff_id']] ?? null;
        }
        unset($s);

        return ['plan' => $plan, 'staff' => $staff];
    }

    public static function assignDuty(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $planId = (int)($d['plan_id'] ?? 0);
        $p = self::planRow($c, $planId);
        $hid = (int)($d['hall_id'] ?? 0);
        if (!in_array($hid, array_map('intval', (array)json_decode((string)$p['halls_json'], true)), true)) {
            throw new \InvalidArgumentException('That hall isn\'t part of this seating plan.');
        }
        $staffId = (int)($d['staff_id'] ?? 0);
        $role = isset(self::ROLES[$d['role'] ?? '']) ? $d['role'] : 'invigilator';
        $who = null;
        foreach (self::staffFor($c, $p) as $s) {
            if ($s['staff_id'] === $staffId) {
                $who = $s;
            }
        }
        if (!$who) {
            throw new \InvalidArgumentException('Staff member not found (or has left).');
        }
        if ($who['busy']) {
            throw new \InvalidArgumentException($who['name'] . ' is already busy: ' . $who['busy'] . '.');
        }
        if ($who['on_leave'] && empty($d['force'])) {
            throw new \DomainException($who['name'] . ' is on approved leave that day.');
        }
        $warnings = $who['teaches'] ? [$who['teaches']] : [];
        $now = AccountSecurity::now();
        self::tx(function () use ($c, $planId, $hid, $staffId, $role, $a, $now) {
            // one hall per person per sitting
            self::db()->execute('DELETE FROM ssms_exam_duties WHERE plan_id = ? AND staff_id = ? AND hall_id <> ?', [$planId, $staffId, $hid]);
            if ($role === 'chief') {
                self::db()->execute("UPDATE ssms_exam_duties SET duty_role = 'invigilator' WHERE plan_id = ? AND hall_id = ? AND duty_role = 'chief' AND staff_id <> ?", [$planId, $hid, $staffId]);
            }
            self::db()->execute('INSERT INTO ssms_exam_duties (ssms_client_code, plan_id, hall_id, staff_id, duty_role, created_by, created) VALUES (?,?,?,?,?,?,?)
                                 ON DUPLICATE KEY UPDATE duty_role = VALUES(duty_role)', [$c, $planId, $hid, $staffId, $role, mb_substr($a['user'], 0, 100), $now]);
        });
        if ($p['status'] === 'published') {
            self::notifyDuties($c, $planId, $staffId);
        }

        return ['duties' => self::duties($a, $planId), 'warnings' => $warnings, 'staff' => $who['name']];
    }

    public static function removeDuty(array $a, int $id): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $r = self::db()->execute('SELECT plan_id FROM ssms_exam_duties WHERE id = ? AND ssms_client_code = ?', [$id, $c])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Duty not found.');
        }
        self::db()->execute('DELETE FROM ssms_exam_duties WHERE id = ? AND ssms_client_code = ?', [$id, $c]);

        return ['duties' => self::duties($a, (int)$r['plan_id'])];
    }

    /**
     * Fill every hall up to $perHall invigilators (one more for halls over 40 students when $extraBig):
     * fewest duties in this exam first, never someone busy or on leave, and teachers of the paper only if no one else is free.
     */
    public static function autoAssign(array $a, int $planId, int $perHall = 2): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $p = self::planRow($c, $planId);
        $perHall = max(1, min(4, $perHall));
        $plan = self::plan($a, $planId);
        $staff = self::staffFor($c, $p);
        $taken = [];
        foreach ($plan['halls'] as $h) {
            foreach ($h['duties'] as $d) {
                $taken[$d['staff_id']] = true;
            }
        }
        $pool = array_values(array_filter($staff, fn($s) => !$s['busy'] && !$s['on_leave'] && !isset($taken[$s['staff_id']])));
        usort($pool, fn($x, $y) => [$x['teaches'] ? 1 : 0, $x['load'], $x['staff_id']] <=> [$y['teaches'] ? 1 : 0, $y['load'], $y['staff_id']]);
        $added = 0;
        $short = [];
        $now = AccountSecurity::now();
        foreach ($plan['halls'] as $h) {
            if (!$h['used']) {
                continue;
            }
            $need = $perHall - count($h['duties']);
            $hasChief = (bool)array_filter($h['duties'], fn($d) => $d['role'] === 'chief');
            while ($need > 0 && $pool) {
                $s = array_shift($pool);
                $role = $hasChief ? 'invigilator' : 'chief';
                $hasChief = true;
                self::db()->execute('INSERT IGNORE INTO ssms_exam_duties (ssms_client_code, plan_id, hall_id, staff_id, duty_role, created_by, created) VALUES (?,?,?,?,?,?,?)',
                    [$c, $planId, $h['hall_id'], $s['staff_id'], $role, mb_substr($a['user'], 0, 100), $now]);
                $added++;
                $need--;
                if ($p['status'] === 'published') {
                    self::notifyDuties($c, $planId, $s['staff_id']);
                }
            }
            if ($need > 0) {
                $short[] = $h['name'];
            }
        }

        return ['duties' => self::duties($a, $planId), 'added' => $added, 'short' => $short];
    }

    /** A teacher's own duties in published plans (from a week ago on). */
    public static function myDuties(string $client, string $user): array
    {
        $staff = self::db()->execute('SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $client])->fetch('assoc');
        if (!$staff || !$staff['staff_id']) {
            return ['duties' => [], 'has_staff' => false];
        }
        $since = date('Y-m-d', strtotime(self::today($client) . ' -7 days'));
        $rows = self::q("SELECT d.id, d.plan_id, d.hall_id, d.duty_role, p.exam_date, p.start_time, p.end_time, p.exam_id, x.exam_name, h.name hall, h.location,
                                (SELECT COUNT(*) FROM ssms_exam_seats s WHERE s.plan_id = p.plan_id AND s.hall_id = d.hall_id) students
                           FROM ssms_exam_duties d JOIN ssms_exam_seat_plans p ON p.plan_id = d.plan_id
                           JOIN ssms_exam_halls h ON h.hall_id = d.hall_id
                      LEFT JOIN ssms_exams x ON x.exam_id = p.exam_id
                          WHERE d.ssms_client_code = ? AND d.staff_id = ? AND p.status = 'published' AND p.exam_date >= ?
                       ORDER BY p.exam_date, p.start_time", [$client, (int)$staff['staff_id'], $since]);
        $out = [];
        foreach ($rows as $r) {
            $with = array_values(array_filter(self::dutyRows($client, (int)$r['plan_id']), fn($x) => $x['hall_id'] === (int)$r['hall_id'] && $x['staff_id'] !== (int)$staff['staff_id']));
            $out[] = ['id' => (int)$r['id'], 'plan_id' => (int)$r['plan_id'], 'exam' => (string)($r['exam_name'] ?? ''), 'exam_date' => substr((string)$r['exam_date'], 0, 10),
                      'start_time' => $r['start_time'], 'end_time' => $r['end_time'], 'hall' => (string)$r['hall'], 'location' => $r['location'],
                      'role' => $r['duty_role'], 'role_label' => self::ROLES[$r['duty_role']] ?? $r['duty_role'], 'students' => (int)$r['students'],
                      'with' => array_map(fn($x) => $x['name'] . ($x['role'] === 'chief' ? ' (chief)' : ''), $with)];
        }

        return ['duties' => $out, 'has_staff' => true, 'today' => self::today($client)];
    }

    /** Everyone's duties for an exam (for the printed roster). */
    public static function roster(array $a, int $examId, int $sessionId, int $branchId = 0): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $exam = self::exam($c, $examId);
        $rows = self::q("SELECT p.plan_id, p.exam_date, p.start_time, p.end_time, p.status, h.name hall, d.duty_role, st.first_name, st.last_name, st.staff_id
                           FROM ssms_exam_duties d JOIN ssms_exam_seat_plans p ON p.plan_id = d.plan_id
                           JOIN ssms_exam_halls h ON h.hall_id = d.hall_id
                           JOIN ssms_staff st ON st.staff_id = d.staff_id AND st.ssms_client_code = d.ssms_client_code
                          WHERE d.ssms_client_code = ? AND p.exam_id = ? AND p.session_id = ? AND p.branch_id = ?
                       ORDER BY p.exam_date, p.start_time, h.name, FIELD(d.duty_role, 'chief', 'invigilator', 'reliever')", [$c, $examId, $sessionId, $branchId]);
        $load = [];
        foreach ($rows as $r) {
            $n = trim($r['first_name'] . ' ' . $r['last_name']);
            $load[$n] = ($load[$n] ?? 0) + 1;
        }
        arsort($load);

        return ['exam' => $exam, 'rows' => array_map(fn($r) => ['exam_date' => substr((string)$r['exam_date'], 0, 10), 'start_time' => $r['start_time'], 'end_time' => $r['end_time'],
                    'hall' => $r['hall'], 'role' => self::ROLES[$r['duty_role']] ?? $r['duty_role'], 'name' => trim($r['first_name'] . ' ' . $r['last_name']), 'published' => $r['status'] === 'published'], $rows),
                'load' => array_map(fn($n, $k) => ['name' => $k, 'duties' => $n], array_values($load), array_keys($load))];
    }

    private static function notifyDuties(string $client, int $planId, ?int $onlyStaff = null): int
    {
        $p = self::planRow($client, $planId);
        $exam = self::exam($client, (int)$p['exam_id']);
        $msgs = [];
        foreach (self::dutyRows($client, $planId) as $d) {
            if ($onlyStaff !== null && $d['staff_id'] !== $onlyStaff) {
                continue;
            }
            $h = self::hall($client, $d['hall_id']);
            foreach (Meetings::tokensOfStaff($client, $d['staff_id']) as $t) {
                // in the language of the person signed in on that phone
                $msgs[] = Locale::withLang(Locale::langForToken($client, $t), fn() => ['to' => $t, 'sound' => 'default', 'title' => Locale::t($client, 'Exam duty: {hall}', ['hall' => $h['name']]),
                           'body' => $exam['name'] . ' · ' . Locale::date($client, (string)$p['exam_date'], 'long') . ($p['start_time'] ? ', ' . Locale::time($client, $p['start_time']) : '')
                                     . ' · ' . Locale::t($client, (string)$d['role_label']), 'data' => ['type' => 'exam_duty', 'plan_id' => $planId, 'screen' => 'MyExamDuties'], 'channelId' => 'chat']);
            }
        }
        self::send($msgs);

        return count($msgs);
    }

    // ── Admit cards / hall tickets ──────────────────────────────────────────

    public static function admitSettings(string $client, int $examId, int $sessionId): array
    {
        $r = null;
        try {
            $r = self::db()->execute('SELECT * FROM ssms_exam_admit_settings WHERE ssms_client_code = ? AND exam_id = ? AND session_id = ?', [$client, $examId, $sessionId])->fetch('assoc');
        } catch (\Throwable $e) {
        }

        return ['instructions' => $r['instructions'] ?? self::defaultInstructions(), 'rule_fees' => (int)($r['rule_fees'] ?? 0) === 1,
                'fee_tolerance' => (float)($r['fee_tolerance'] ?? 0), 'rule_attendance' => isset($r['rule_attendance']) && $r['rule_attendance'] !== null ? (int)$r['rule_attendance'] : null,
                'show_photo' => (int)($r['show_photo'] ?? 1) === 1, 'published' => (int)($r['published'] ?? 0) === 1, 'published_at' => $r['published_at'] ?? null];
    }

    public static function defaultInstructions(): string
    {
        return "Bring this admit card to every paper.\nBe in the exam hall 15 minutes before the start.\nSit only in the seat shown for you.\n"
             . "Phones, smart watches and notes are not allowed in the hall.\nWrite your roll number on every answer sheet.";
    }

    public static function saveAdmitSettings(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $examId = (int)($d['exam_id'] ?? 0);
        $sessionId = (int)($d['session_id'] ?? 0);
        self::exam($c, $examId);
        self::session($c, $sessionId);
        $att = $d['rule_attendance'] ?? null;
        if ($att !== null && $att !== '') {
            if (!is_numeric($att) || (int)$att < 1 || (int)$att > 100) {
                throw new \InvalidArgumentException('Minimum attendance must be 1–100%, or empty for no rule.');
            }
            $att = (int)$att;
        } else {
            $att = null;
        }
        $tol = (float)($d['fee_tolerance'] ?? 0);
        if ($tol < 0 || $tol > 1e9) {
            throw new \InvalidArgumentException('The fee allowance must be zero or more.');
        }
        $instr = self::text($d['instructions'] ?? '', 3000, true);
        self::db()->execute('INSERT INTO ssms_exam_admit_settings (ssms_client_code, exam_id, session_id, instructions, rule_fees, fee_tolerance, rule_attendance, show_photo, modified)
                             VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE instructions = VALUES(instructions), rule_fees = VALUES(rule_fees), fee_tolerance = VALUES(fee_tolerance),
                             rule_attendance = VALUES(rule_attendance), show_photo = VALUES(show_photo), modified = VALUES(modified)',
            [$c, $examId, $sessionId, $instr, !empty($d['rule_fees']) ? 1 : 0, round($tol, 2), $att, array_key_exists('show_photo', $d) ? (!empty($d['show_photo']) ? 1 : 0) : 1, AccountSecurity::now()]);

        return ['settings' => self::admitSettings($c, $examId, $sessionId)];
    }

    /** enrollment_id => row of ssms_exam_admit_cards */
    private static function cardRows(string $client, int $examId, int $sessionId): array
    {
        $out = [];
        try {
            foreach (self::q('SELECT * FROM ssms_exam_admit_cards WHERE ssms_client_code = ? AND exam_id = ? AND session_id = ?', [$client, $examId, $sessionId]) as $r) {
                $out[(string)$r['enrollment_id']] = $r;
            }
        } catch (\Throwable $e) {
        }

        return $out;
    }

    /** Eligibility of each student: rules (fees, attendance) and the office's decision. */
    private static function eligibility(string $client, int $examId, int $sessionId, array $students): array
    {
        $set = self::admitSettings($client, $examId, $sessionId);
        $rows = self::cardRows($client, $examId, $sessionId);
        $eids = array_column($students, 'enrollment_id');
        $today = self::today($client);
        $owed = $set['rule_fees'] ? Analytics::outstandingFor($client, $sessionId, $eids, $today) : [];
        $att = [];
        if ($set['rule_attendance'] !== null && $eids) {
            foreach (array_chunk($eids, 500) as $chunk) {
                $in = implode(',', array_fill(0, count($chunk), '?'));
                foreach (self::q("SELECT enrollment_id, SUM(UPPER(attendance) = 'P') pr, SUM(UPPER(attendance) = 'A') ab FROM student_attendance
                                   WHERE ssms_client_code = ? AND session_id = ? AND attendance_date <= ? AND enrollment_id IN ($in) GROUP BY enrollment_id",
                    array_merge([$client, $sessionId, $today], $chunk)) as $r) {
                    $m = (int)$r['pr'] + (int)$r['ab'];
                    $att[(string)$r['enrollment_id']] = $m >= 5 ? round((int)$r['pr'] * 100 / $m, 1) : null;
                }
            }
        }
        $cur = Analytics::currency($client);
        $out = [];
        foreach ($students as $s) {
            $eid = $s['enrollment_id'];
            $reasons = [];
            if ($set['rule_fees'] && ($owed[$eid] ?? 0) > $set['fee_tolerance'] + 0.009) {
                $reasons[] = 'Fees due ' . Locale::money($client, $owed[$eid]);
            }
            if ($set['rule_attendance'] !== null && isset($att[$eid]) && $att[$eid] < $set['rule_attendance']) {
                $reasons[] = 'Attendance ' . $att[$eid] . '% (needs ' . $set['rule_attendance'] . '%)';
            }
            $row = $rows[$eid] ?? null;
            $override = $row['override'] ?? null;
            $status = $override === 'allow' ? 'eligible' : ($override === 'withhold' ? 'withheld' : ($reasons ? 'withheld' : 'eligible'));
            $out[$eid] = $s + ['status' => $status, 'reasons' => $reasons, 'override' => $override, 'note' => $row['reason'] ?? null,
                               'ticket_no' => $row['ticket_no'] ?? null, 'viewed_at' => $row['viewed_at'] ?? null, 'fees_due' => $owed[$eid] ?? 0.0, 'attendance' => $att[$eid] ?? null];
        }

        return $out;
    }

    private static function classesInSession(string $client, int $sessionId, ?int $classId, ?int $sectionId): array
    {
        if ($classId) {
            return [['class_id' => $classId, 'section_id' => $sectionId]];
        }

        return array_map(fn($r) => ['class_id' => (int)$r['class_id'], 'section_id' => null],
            self::q("SELECT DISTINCT class_id FROM ssms_student_enrollment WHERE ssms_client_code = ? AND session_id = ? AND COALESCE(status, 'active') = 'active'", [$client, $sessionId]));
    }

    /** Office view: rules, publish state and every student's status (optionally one class / section). */
    public static function admitList(array $a, int $examId, int $sessionId, ?int $classId = null, ?int $sectionId = null): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $exam = self::exam($c, $examId);
        $sess = self::session($c, $sessionId);
        $students = self::students($c, $sessionId, 0, self::classesInSession($c, $sessionId, $classId, $sectionId));
        $list = array_values(self::eligibility($c, $examId, $sessionId, $students));
        if (!$a['edit'] && !$a['approve']) {
            // view-only staff see who has a card, not families' fee dues or attendance
            foreach ($list as &$x) {
                $x['reasons'] = [];
                $x['fees_due'] = null;
                $x['attendance'] = null;
                $x['note'] = null;
            }
            unset($x);
        }
        $withSchedule = [];
        foreach (self::sheet($c, $examId, $sessionId, 0) as $r) {
            if ((int)$r['is_published'] === 1) {
                $withSchedule[(int)$r['class_id']] = true;
            }
        }
        $noSchedule = [];
        foreach ($list as $s) {
            if (!isset($withSchedule[$s['class_id']])) {
                $noSchedule[$s['class_id']] = $s['class_only'];
            }
        }
        $classes = [];
        foreach (self::q("SELECT DISTINCT e.class_id, c.class_name FROM ssms_student_enrollment e LEFT JOIN ssms_classes c ON c.class_id = e.class_id
                           WHERE e.ssms_client_code = ? AND e.session_id = ? AND COALESCE(e.status, 'active') = 'active' ORDER BY e.class_id", [$c, $sessionId]) as $r) {
            $classes[] = ['class_id' => (int)$r['class_id'], 'name' => (string)($r['class_name'] ?? 'Class ' . $r['class_id'])];
        }

        return ['exam' => $exam, 'session' => $sess, 'settings' => self::admitSettings($c, $examId, $sessionId), 'students' => $list,
                'counts' => ['eligible' => count(array_filter($list, fn($s) => $s['status'] === 'eligible')), 'withheld' => count(array_filter($list, fn($s) => $s['status'] === 'withheld')),
                             'viewed' => count(array_filter($list, fn($s) => !empty($s['viewed_at'])))],
                'no_schedule' => array_values($noSchedule), 'classes' => $classes, 'currency' => Analytics::currency($c),
                'can' => ['edit' => $a['edit'], 'approve' => $a['approve'], 'export' => $a['export']]];
    }

    /** The office allows a card despite the rules, withholds it, or goes back to the rules (null). */
    public static function setAdmitOverride(array $a, array $d): array
    {
        self::need($a, 'approve');
        $c = $a['client'];
        $examId = (int)($d['exam_id'] ?? 0);
        $sessionId = (int)($d['session_id'] ?? 0);
        self::exam($c, $examId);
        $eid = (string)($d['enrollment_id'] ?? '');
        $stu = self::db()->execute('SELECT enrollment_id FROM ssms_student_enrollment WHERE enrollment_id = ? AND ssms_client_code = ? AND session_id = ?', [$eid, $c, $sessionId])->fetch('assoc');
        if (!$stu) {
            throw new \InvalidArgumentException('Student not found in this school year.');
        }
        $ov = $d['override'] ?? null;
        $ov = in_array($ov, ['allow', 'withhold'], true) ? $ov : null;
        $reason = self::text($d['reason'] ?? '', 200);
        if ($ov === 'withhold' && $reason === '') {
            throw new \InvalidArgumentException('Say why the admit card is withheld – parents see this reason.');
        }
        self::db()->execute('INSERT INTO ssms_exam_admit_cards (ssms_client_code, exam_id, session_id, enrollment_id, override, reason, modified) VALUES (?,?,?,?,?,?,?)
                             ON DUPLICATE KEY UPDATE override = VALUES(override), reason = VALUES(reason), modified = VALUES(modified)',
            [$c, $examId, $sessionId, $eid, $ov, $reason ?: null, AccountSecurity::now()]);
        $settings = self::admitSettings($c, $examId, $sessionId);
        if ($settings['published'] && $ov === 'allow') {
            self::issueTickets($c, $examId, $sessionId);
            self::notifyParents($c, $examId, [$eid]);
        }
        $one = self::students($c, $sessionId, 0, [['class_id' => (int)self::db()->execute('SELECT class_id FROM ssms_student_enrollment WHERE enrollment_id = ? AND ssms_client_code = ?', [$eid, $c])->fetch('assoc')['class_id'], 'section_id' => null]]);
        $one = array_values(array_filter($one, fn($s) => $s['enrollment_id'] === $eid));

        return ['student' => $one ? array_values(self::eligibility($c, $examId, $sessionId, $one))[0] : null];
    }

    /** Hall-ticket numbers for every student of the session that has none yet, in class / section / roll order. */
    private static function issueTickets(string $client, int $examId, int $sessionId): int
    {
        $students = self::students($client, $sessionId, 0, self::classesInSession($client, $sessionId, null, null));
        $rows = self::cardRows($client, $examId, $sessionId);
        $n = 0;
        $now = AccountSecurity::now();
        self::tx(function () use ($client, $examId, $sessionId, $students, $rows, &$n, $now) {
            self::db()->execute('SELECT ssms_client_code FROM ssms_exam_admit_settings WHERE ssms_client_code = ? AND exam_id = ? AND session_id = ? FOR UPDATE', [$client, $examId, $sessionId]);
            $max = 0;
            foreach (self::q('SELECT ticket_no FROM ssms_exam_admit_cards WHERE ssms_client_code = ? AND exam_id = ? AND session_id = ? AND ticket_no IS NOT NULL', [$client, $examId, $sessionId]) as $r) {
                if (preg_match('/-(\d+)$/', (string)$r['ticket_no'], $m)) {
                    $max = max($max, (int)$m[1]);
                }
            }
            foreach ($students as $s) {
                if (!empty($rows[$s['enrollment_id']]['ticket_no'])) {
                    continue;
                }
                $max++;
                $ticket = sprintf('E%d-%d-%04d', $examId, $sessionId, $max);
                self::db()->execute('INSERT INTO ssms_exam_admit_cards (ssms_client_code, exam_id, session_id, enrollment_id, ticket_no, issued_at, modified) VALUES (?,?,?,?,?,?,?)
                                     ON DUPLICATE KEY UPDATE ticket_no = COALESCE(ticket_no, VALUES(ticket_no)), issued_at = COALESCE(issued_at, VALUES(issued_at))',
                    [$client, $examId, $sessionId, $s['enrollment_id'], $ticket, $now, $now]);
                $n++;
            }
        });

        return $n;
    }

    public static function publishAdmit(array $a, int $examId, int $sessionId, bool $publish): array
    {
        self::need($a, 'approve');
        $c = $a['client'];
        self::exam($c, $examId);
        self::session($c, $sessionId);
        $before = self::admitSettings($c, $examId, $sessionId);
        $now = AccountSecurity::now();
        self::db()->execute('INSERT INTO ssms_exam_admit_settings (ssms_client_code, exam_id, session_id, instructions, published, published_at, published_by, modified)
                             VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE published = VALUES(published), published_at = VALUES(published_at), published_by = VALUES(published_by), modified = VALUES(modified)',
            [$c, $examId, $sessionId, $before['instructions'], $publish ? 1 : 0, $publish ? $now : null, $publish ? mb_substr($a['user'], 0, 100) : null, $now]);
        $issued = 0;
        $notified = 0;
        if ($publish) {
            $issued = self::issueTickets($c, $examId, $sessionId);
            if (!$before['published']) {
                $students = self::students($c, $sessionId, 0, self::classesInSession($c, $sessionId, null, null));
                $ok = array_keys(array_filter(self::eligibility($c, $examId, $sessionId, $students), fn($s) => $s['status'] === 'eligible'));
                $notified = self::notifyParents($c, $examId, array_map('strval', $ok));
            }
        }

        return ['settings' => self::admitSettings($c, $examId, $sessionId), 'issued' => $issued, 'notified' => $notified];
    }

    /** $text: fn() => [title, body], called per phone in that family's language (default: admit card ready). */
    private static function notifyParents(string $client, int $examId, array $eids, ?callable $text = null): int
    {
        $exam = self::exam($client, $examId);
        $msgs = [];
        $seen = [];
        foreach ($eids as $eid) {
            $tokens = Meetings::tokensOfParents($client, (string)$eid);
            if (!$tokens) {
                continue;
            }
            $stu = StudentLeave::enrollment($client, (string)$eid);
            $name = $stu ? trim((string)$stu['student_name']) : '';
            foreach ($tokens as $t) {
                if (isset($seen[$t . '|' . $eid])) {
                    continue;
                }
                $seen[$t . '|' . $eid] = true;
                $msgs[] = Locale::withLang(Locale::langForToken($client, $t), function () use ($t, $text, $client, $name, $exam, $examId, $eid) {
                    [$title, $body] = $text ? $text() : [Locale::t($client, 'Admit card ready'), Locale::t($client, 'the admit card (hall ticket) is in the app.')];

                    return ['to' => $t, 'sound' => 'default', 'title' => $title . ($name !== '' ? ' – ' . $name : ''), 'body' => $exam['name'] . ': ' . $body,
                            'data' => ['type' => 'admit_card', 'exam_id' => $examId, 'enrollment_id' => (string)$eid, 'screen' => 'MyAdmitCard'], 'channelId' => 'chat'];
                });
            }
        }
        self::send($msgs);

        return count($msgs);
    }

    /** Full admit cards (for printing or the parent app). $students = rows from students()/eligibility(). */
    private static function cards(string $client, int $examId, int $sessionId, array $students, bool $photos): array
    {
        if (!$students) {
            return [];
        }
        $exam = self::exam($client, $examId);
        $sess = self::session($client, $sessionId);
        $set = self::admitSettings($client, $examId, $sessionId);
        $school = self::school($client);
        // timetables per branch + class (published date sheet only; a branch's own rows win over "all branches")
        $sheet = [];
        foreach (array_unique(array_map(fn($s) => (int)($s['branch_id'] ?? 0), $students)) as $bid) {
            foreach (self::sheet($client, $examId, $sessionId, $bid) as $r) {
                if ((int)$r['is_published'] !== 1 || ($bid === 0 && (int)($r['branch_id'] ?? 0) !== 0)) {
                    continue;
                }
                $sheet[$bid][(int)$r['class_id']][] = ['subject' => (string)($r['subject_name'] ?? ''), 'exam_date' => substr((string)$r['exam_date'], 0, 10),
                    'start_time' => self::hm($r['start_time']) ?: null, 'end_time' => self::hm($r['end_time']) ?: null, 'venue' => $r['venue'] ?: null];
            }
        }
        // seats from published plans
        $eids = array_column($students, 'enrollment_id');
        $seats = [];
        foreach (array_chunk($eids, 500) as $chunk) {
            $in = implode(',', array_fill(0, count($chunk), '?'));
            foreach (self::q("SELECT s.enrollment_id, s.seat_row, s.seat_col, s.seat_no, p.exam_date, p.start_time, h.name, h.location FROM ssms_exam_seats s
                               JOIN ssms_exam_seat_plans p ON p.plan_id = s.plan_id JOIN ssms_exam_halls h ON h.hall_id = s.hall_id
                              WHERE s.ssms_client_code = ? AND p.exam_id = ? AND p.session_id = ? AND p.status = 'published' AND s.enrollment_id IN ($in)",
                array_merge([$client, $examId, $sessionId], $chunk)) as $x) {
                $seats[(string)$x['enrollment_id']][substr((string)$x['exam_date'], 0, 10) . ' ' . $x['start_time']] = ['hall' => (string)$x['name'], 'location' => $x['location'],
                    'seat' => self::seatLabel((int)$x['seat_row'], (int)$x['seat_col']), 'seat_no' => (int)$x['seat_no']];
            }
        }
        // student details
        $info = [];
        foreach (array_chunk($eids, 500) as $chunk) {
            $in = implode(',', array_fill(0, count($chunk), '?'));
            foreach (self::q("SELECT e.enrollment_id, r.student_father_name, r.student_mother_name, r.student_dob, r.student_photo, r.registration_id
                                FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id AND r.ssms_client_code = e.ssms_client_code
                               WHERE e.ssms_client_code = ? AND e.enrollment_id IN ($in)", array_merge([$client], $chunk)) as $x) {
                $info[(string)$x['enrollment_id']] = $x;
            }
        }
        $out = [];
        foreach ($students as $s) {
            $eid = $s['enrollment_id'];
            $i = $info[$eid] ?? [];
            $papers = [];
            foreach ($sheet[(int)($s['branch_id'] ?? 0)][$s['class_id']] ?? [] as $pp) {
                $seat = $seats[$eid][$pp['exam_date'] . ' ' . ($pp['start_time'] ?? '')] ?? null;
                $papers[] = $pp + ['hall' => $seat['hall'] ?? null, 'seat' => $seat['seat'] ?? null, 'location' => $seat['location'] ?? null];
            }
            usort($papers, fn($x, $y) => [$x['exam_date'], $x['start_time'] ?? ''] <=> [$y['exam_date'], $y['start_time'] ?? '']);
            $out[] = ['enrollment_id' => $eid, 'ticket_no' => $s['ticket_no'] ?? null, 'status' => $s['status'] ?? 'eligible',
                      'name' => $s['name'], 'class_name' => $s['class_name'], 'roll' => $s['roll'], 'registration_id' => $s['registration_id'],
                      'father' => $i['student_father_name'] ?? null, 'mother' => $i['student_mother_name'] ?? null,
                      'dob' => !empty($i['student_dob']) ? substr((string)$i['student_dob'], 0, 10) : null,
                      'photo' => $photos && $set['show_photo'] && !empty($i['student_photo'])
                          ? self::dataUri('clients/' . $client . '/Students/' . basename((string)$i['registration_id']) . '/' . basename((string)$i['student_photo'])) : null,
                      'papers' => $papers];
        }

        return ['exam' => $exam, 'session' => $sess, 'school' => $school, 'instructions' => $set['instructions'], 'show_photo' => $set['show_photo'], 'cards' => $out];
    }

    /** Office: printable hall tickets for a class / section (eligible students, or everyone with ?all). */
    public static function printCards(array $a, int $examId, int $sessionId, ?int $classId, ?int $sectionId, bool $includeWithheld = false, bool $photos = true): array
    {
        self::need($a, 'export');
        $c = $a['client'];
        if (!$classId) {
            throw new \InvalidArgumentException('Choose a class to print.');
        }
        if (!self::admitSettings($c, $examId, $sessionId)['published']) {
            throw new \DomainException('Publish the admit cards first – that gives every student a hall-ticket number.');
        }
        $students = self::students($c, $sessionId, 0, [['class_id' => $classId, 'section_id' => $sectionId]]);
        $list = array_values(self::eligibility($c, $examId, $sessionId, $students));
        if (array_filter($list, fn($s) => empty($s['ticket_no']))) {
            self::issueTickets($c, $examId, $sessionId);   // students who joined after publishing
            $list = array_values(self::eligibility($c, $examId, $sessionId, $students));
        }
        if (!$includeWithheld) {
            $list = array_values(array_filter($list, fn($s) => $s['status'] === 'eligible'));
        }
        if (count($list) > 120) {
            $photos = false;   // keep the reply small; the app prints in batches anyway
        }

        return self::cards($c, $examId, $sessionId, $list, $photos) ?: ['cards' => []];
    }

    /**
     * Parents / students: admit cards of a child for published exams in the child's school year.
     * Withheld cards come back without the ticket, with the reason.
     */
    public static function myAdmitCards(string $client, string $role, string $user, ?string $jwtEnrollment, ?string $enrollmentId): array
    {
        $kids = Meetings::myChildren($client, $role, $user, $jwtEnrollment);
        if (!$kids) {
            throw new \DomainException('No student is linked to this account.');
        }
        $eid = $enrollmentId && in_array($enrollmentId, $kids, true) ? $enrollmentId : null;
        if ($enrollmentId && !$eid) {
            throw new \DomainException('Not allowed.');
        }
        $eid = $eid ?? $kids[0];
        $stu = StudentLeave::enrollment($client, $eid);
        if (!$stu) {
            throw new \InvalidArgumentException('Student not found.');
        }
        $sessionId = (int)$stu['session_id'];
        $base = self::students($client, $sessionId, 0, [['class_id' => (int)$stu['class_id'], 'section_id' => $stu['section_id'] !== null ? (int)$stu['section_id'] : null]]);
        $base = array_values(array_filter($base, fn($s) => $s['enrollment_id'] === $eid));
        $out = [];
        try {
            $published = self::q('SELECT s.exam_id, s.published_at, x.exam_name FROM ssms_exam_admit_settings s JOIN ssms_exams x ON x.exam_id = s.exam_id AND x.ssms_client_code = s.ssms_client_code
                                   WHERE s.ssms_client_code = ? AND s.session_id = ? AND s.published = 1 ORDER BY s.published_at DESC', [$client, $sessionId]);
        } catch (\Throwable $e) {
            $published = [];
        }
        foreach ($published as $p) {
            $examId = (int)$p['exam_id'];
            $el = $base ? array_values(self::eligibility($client, $examId, $sessionId, $base)) : [];
            if (!$el) {
                continue;
            }
            $me = $el[0];
            if ($me['status'] === 'eligible' && empty($me['ticket_no'])) {
                self::issueTickets($client, $examId, $sessionId);   // joined after the cards were published
                $me = array_values(self::eligibility($client, $examId, $sessionId, $base))[0];
            }
            if ($me['status'] !== 'eligible') {
                $out[] = ['exam' => ['exam_id' => $examId, 'name' => (string)$p['exam_name']], 'status' => 'withheld',
                          'reason' => $me['note'] ?: ($me['reasons'] ? implode('; ', $me['reasons']) : 'Please contact the school office.')];
                continue;
            }
            $card = self::cards($client, $examId, $sessionId, [$me], true);
            $out[] = ['exam' => $card['exam'], 'status' => 'eligible', 'session' => $card['session'], 'school' => $card['school'],
                      'instructions' => $card['instructions'], 'show_photo' => $card['show_photo'], 'card' => $card['cards'][0]];
            self::db()->execute('UPDATE ssms_exam_admit_cards SET viewed_at = COALESCE(viewed_at, ?) WHERE ssms_client_code = ? AND exam_id = ? AND session_id = ? AND enrollment_id = ?',
                [AccountSecurity::now(), $client, $examId, $sessionId, $eid]);
        }

        return ['enrollment_id' => $eid, 'children' => $kids, 'exams' => $out];
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** School name, address, logo and principal's signature (images as data: URIs so printing works offline). */
    /**
     * The school's letterhead – the same details the fee slips and mark sheets print: header text (else the
     * school name), address with city / state / PIN, phone, email; logo and principal's signature as data: URIs.
     */
    private static function school(string $client, bool $images = true): array
    {
        $r = self::db()->execute('SELECT * FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc') ?: [];
        $t = fn($k) => trim((string)($r[$k] ?? ''));
        $out = ['name' => ($t('ssms_client_header_text') ?: $t('ssms_client_name')) ?: $client,
                'address' => implode(', ', array_filter([$t('ssms_client_address'), $t('ssms_client_city'), $t('ssms_client_state'), $t('ssms_client_zip')])) ?: null,
                'phone' => $t('ssms_client_phone') ?: null, 'email' => $t('ssms_client_email') ?: null, 'logo' => null, 'signature' => null];
        if (!$images) {
            return $out;
        }
        if ($t('logo_name') !== '') {
            $out['logo'] = self::dataUri('clients/' . $client . '/' . basename($t('logo_name')));
        }
        try {
            $s = self::db()->execute('SELECT principal_signature FROM ssms_school_settings WHERE client_code = ? LIMIT 1', [$client])->fetch('assoc');
            if ($s && !empty($s['principal_signature'])) {
                $out['signature'] = self::dataUri('clients/' . $client . '/' . basename((string)$s['principal_signature']));
            }
        } catch (\Throwable $e) {
        }

        return $out;
    }

    /** Letterhead for the printouts made in the app (seating charts, sign-in sheets, duty roster). */
    public static function letterhead(array $a): array
    {
        self::need($a, 'view');

        return ['school' => self::school($a['client'])];
    }

    private static function dataUri(string $rel): ?string
    {
        try {
            $path = StudentRecord::webRoot() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (!is_file($path) || filesize($path) > 600 * 1024) {
                return null;
            }
            $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
            $mime = ['png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'][$ext] ?? 'image/jpeg';

            return 'data:' . $mime . ';base64,' . base64_encode((string)file_get_contents($path));
        } catch (\Throwable $e) {
            return null;
        }
    }

    private static function className(string $client, int $classId, ?int $sectionId, bool $all = false): string
    {
        $c = self::db()->execute('SELECT class_name FROM ssms_classes WHERE class_id = ?', [$classId])->fetch('assoc');
        $s = $sectionId ? self::db()->execute('SELECT section_name FROM ssms_sections WHERE section_id = ?', [$sectionId])->fetch('assoc') : null;

        return trim(($c['class_name'] ?? 'Class ' . $classId) . ' ' . ($s['section_name'] ?? '')) . ($all ? ' (all sections)' : '');
    }

    private static function send(array $messages): void
    {
        if (!$messages) {
            return;
        }
        Notify::mirror($messages);   // also in the person's in-app inbox
        if (is_callable(self::$push)) {
            (self::$push)($messages);

            return;
        }
        try {
            foreach (array_chunk($messages, 90) as $chunk) {
                $ch = curl_init('https://exp.host/--/api/v2/push/send');
                curl_setopt_array($ch, [
                    CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($chunk), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5,
                    CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
                ]);
                curl_exec($ch);
                curl_close($ch);
            }
        } catch (\Throwable $e) {
            Log::warning('ExamLogistics push: ' . $e->getMessage());
        }
    }

    private static function tx(callable $fn): void
    {
        $db = self::db();
        if (method_exists($db, 'transactional')) {
            $db->transactional(function () use ($fn) {
                $fn();

                return true;
            });

            return;
        }
        $db->execute('START TRANSACTION');
        try {
            $fn();
            $db->execute('COMMIT');
        } catch (\Throwable $e) {
            $db->execute('ROLLBACK');
            throw $e;
        }
    }

    private static function text($v, int $max, bool $multiline = false): string
    {
        $v = is_scalar($v) ? (string)$v : '';
        $v = preg_replace($multiline ? '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u' : '/[\x00-\x1F\x7F]/u', '', $v) ?? '';

        return mb_substr(trim($v), 0, $max);
    }

    private static function lastId(): int
    {
        return (int)(self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'] ?? 0);
    }

    private static function q(string $sql, array $p = []): array
    {
        return self::db()->execute($sql, $p)->fetchAll('assoc');
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
