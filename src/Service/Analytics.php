<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * Analytics dashboard – attendance trends, at-risk students, fee collection against
 * what is due (and the school's own targets), and class performance comparison.
 *
 * Everything is calculated from the existing records:
 *   attendance  student_attendance (P present, A absent, L approved leave, H holiday). Attendance % =
 *               present ÷ (present + absent) – leave and holidays are not counted against the
 *               student, the same rule as the report cards.
 *   fees        ssms_fee_structure (+ discounts, tax) for what is due, ssms_fee_paid_details for payments
 *   marks       ssms_marks against ssms_max_marks (the exam's own max, else the class default, else 100)
 *
 * Who sees what (Roles & permissions):
 *   Reports & analytics · view   opens the dashboard; teachers with "own classes only" see their classes
 *   Attendance · view            attendance trends and the attendance part of at-risk
 *   Exams · view                 class performance and the marks part of at-risk
 *   Fees · view (whole school)   fee collection and the fees part of at-risk – never for own-classes roles
 *   Reports & analytics · edit   thresholds and monthly collection targets
 *   Reports & analytics · export the at-risk list as a spreadsheet (CSV)
 */
class Analytics
{
    public const DEFAULTS = [
        'att_warn'      => 85,   // attendance below this % → watch
        'att_critical'  => 75,   // attendance below this % → at risk
        'absent_streak' => 3,    // this many school days absent in a row (most recent)
        'pass_pct'      => 40,   // overall / subject pass mark %
        'drop_pct'      => 15,   // fall in overall % from the previous exam
        'fail_subjects' => 2,    // failing this many subjects in the latest exam
        'overdue_days'  => 30,   // fees overdue for more than this many days
        'min_days'      => 5,    // ignore attendance % until this many days are marked
    ];
    public const LIMITS = [
        'att_warn' => [1, 100], 'att_critical' => [1, 100], 'absent_streak' => [2, 30], 'pass_pct' => [1, 100],
        'drop_pct' => [1, 100], 'fail_subjects' => [1, 20], 'overdue_days' => [0, 365], 'min_days' => [1, 60],
    ];
    public const MAX_RANGE_DAYS = 400;

    // ── Who is asking and what they asked for ───────────────────────────────

    /**
     * $actor = [user, role, custom_role]; $f = session_id, branch_id, class_id, section_id, from, to, exam_id
     * → context used by every report.
     */
    public static function context(string $client, array $actor, array $f = []): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $role = $role === 'teacher' ? 'user' : $role;
        $user = (string)($actor['user'] ?? '');
        if ($user === '' || in_array($role, ['parent', 'student', ''], true) || !in_array($role, Permissions::BASE_ROLES, true)) {
            throw new \DomainException('Not allowed.');
        }
        $owner = $role === 'owner';
        $grid = $owner ? [] : Permissions::forUser($client, $role, $actor['custom_role'] ?? null);
        $g = fn(string $m, string $k) => $owner || !empty($grid[$m][$k]);
        if (!$g('analytics', 'view')) {
            throw new \DomainException("You don't have permission to see reports & analytics. Ask the school owner if you need it.");
        }
        $own = !$owner && Permissions::ownClassesOnly($client, $role, $actor['custom_role'] ?? null);
        $scope = null;
        if ($own) {
            $scope = self::ownScope($client, $role, $user);   // [] = no classes assigned → an empty dashboard
        }
        $sessions = self::sessions($client);
        $current = null;
        foreach ($sessions as $s) {
            if ($s['current']) {
                $current = $s['id'];
            }
        }
        $sessionId = (int)($f['session_id'] ?? 0) ?: ($current ?? ($sessions[0]['id'] ?? 0));
        if ($sessionId && $sessions && !in_array($sessionId, array_column($sessions, 'id'), true)) {
            throw new \InvalidArgumentException('Session not found.');
        }
        $today = substr(Meetings::now($client), 0, 10);
        [$from, $to, $start] = self::range($client, $sessionId, $sessionId === $current, $today, $f['from'] ?? null, $f['to'] ?? null);

        $classId = (int)($f['class_id'] ?? 0) ?: null;
        $sectionId = (int)($f['section_id'] ?? 0) ?: null;
        if ($sectionId && !$classId) {
            $r = self::db()->execute('SELECT class_id FROM ssms_sections WHERE section_id = ? AND ssms_client_code = ?', [$sectionId, $client])->fetch('assoc');
            $classId = $r ? (int)$r['class_id'] : null;
        }
        if ($scope !== null && ($classId || $sectionId)) {
            $ok = false;
            foreach ($scope as $sc) {
                if ((int)$sc['class_id'] === (int)$classId && (!$sectionId || !$sc['section_id'] || (int)$sc['section_id'] === $sectionId)) {
                    $ok = true;
                }
            }
            if (!$ok) {
                throw new \DomainException('You can only see your own classes.');
            }
        }

        return [
            'client' => $client, 'role' => $role, 'user' => $user, 'own' => $own, 'scope' => $scope,
            'can' => [
                'attendance' => $g('attendance', 'view'),
                'exams'      => $g('exams', 'view'),
                'fees'       => !$own && $g('fees', 'view'),
                'edit'       => $g('analytics', 'edit'),
                'export'     => $g('analytics', 'export'),
            ],
            'session_id' => $sessionId, 'current_session' => $current, 'sessions' => $sessions, 'today' => $today,
            'from' => $from, 'to' => $to, 'session_start' => $start, 'class_id' => $classId, 'section_id' => $sectionId,
            'branch_id' => (int)($f['branch_id'] ?? 0) ?: null, 'exam_id' => (int)($f['exam_id'] ?? 0) ?: null,
            'settings' => self::settings($client),
        ];
    }

    /** Classes a teacher teaches a subject in, plus the sections they are class teacher of. */
    private static function ownScope(string $client, string $role, string $user): array
    {
        $scope = [];
        try {
            foreach (self::q('SELECT DISTINCT st.class_id, st.section_id FROM ssms_subject_teacher st
                                JOIN sawera_ssms_users u ON u.staff_id = st.staff_id AND u.ssms_client_code = st.ssms_client_code
                               WHERE u.ssms_user_name = ? AND st.ssms_client_code = ?', [$user, $client]) as $r) {
                $scope[] = ['class_id' => (int)$r['class_id'], 'section_id' => $r['section_id'] ? (int)$r['section_id'] : null];
            }
        } catch (\Throwable $e) {
        }
        try {
            foreach (self::q('SELECT s.class_id, s.section_id FROM ssms_sections s
                                JOIN sawera_ssms_users u ON u.staff_id = s.staff_id AND u.ssms_client_code = s.ssms_client_code
                               WHERE u.ssms_user_name = ? AND s.ssms_client_code = ? AND s.staff_id IS NOT NULL', [$user, $client]) as $r) {
                $scope[] = ['class_id' => (int)$r['class_id'], 'section_id' => (int)$r['section_id']];
            }
        } catch (\Throwable $e) {
        }
        $out = [];
        foreach ($scope as $sc) {
            $out[$sc['class_id'] . '|' . (int)$sc['section_id']] = $sc;
        }

        return array_values($out);
    }

    public static function sessions(string $client): array
    {
        try {
            return array_map(fn($r) => ['id' => (int)$r['session_id'], 'name' => (string)$r['session_name'],
                    'current' => strtoupper((string)($r['is_current'] ?? '')) === 'Y'],
                self::q('SELECT session_id, session_name, is_current FROM ssms_sessions WHERE ssms_client_code = ? ORDER BY session_id DESC', [$client]));
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** Date range: the request's, or the school year (from the session start month) up to today. */
    private static function range(string $client, int $sessionId, bool $isCurrent, string $today, $from, $to): array
    {
        $valid = fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && \DateTime::createFromFormat('Y-m-d', $d)->format('Y-m-d') === $d;
        if ($from !== null && $from !== '' && !$valid($from)) {
            throw new \InvalidArgumentException('The start date must be YYYY-MM-DD.');
        }
        if ($to !== null && $to !== '' && !$valid($to)) {
            throw new \InvalidArgumentException('The end date must be YYYY-MM-DD.');
        }
        $m = 4;
        try {
            $r = self::db()->execute('SELECT session_start_month FROM ssms_school_settings WHERE client_code = ? LIMIT 1', [$client])->fetch('assoc');
            $m = max(1, min(12, (int)($r['session_start_month'] ?? 4)));
        } catch (\Throwable $e) {
        }
        if ($isCurrent || !$sessionId) {
            $y = (int)substr($today, 0, 4);
            $start = sprintf('%04d-%02d-01', $y, $m);
            if ($start > $today) {
                $start = sprintf('%04d-%02d-01', $y - 1, $m);
            }
            $defFrom = $start;
            $defTo = $today;
        } else {
            // a past session: the days its attendance was taken
            $r = self::db()->execute('SELECT MIN(attendance_date) a, MAX(attendance_date) b FROM student_attendance WHERE ssms_client_code = ? AND session_id = ?',
                [$client, $sessionId])->fetch('assoc');
            if ($r && $r['a']) {
                $defFrom = substr((string)$r['a'], 0, 10);
                $defTo = substr((string)$r['b'], 0, 10);
            } else {
                // no attendance: the year in its name ("2024-25"), else its first fee due date, else a year ago
                $y = null;
                try {
                    $n = self::db()->execute('SELECT session_name FROM ssms_sessions WHERE session_id = ? AND ssms_client_code = ?', [$sessionId, $client])->fetch('assoc');
                    if ($n && preg_match('/\b(20\d{2})\b/', (string)$n['session_name'], $mm)) {
                        $y = (int)$mm[1];
                    }
                    if (!$y) {
                        $d = self::db()->execute('SELECT MIN(due_date) d FROM ssms_fee_structure WHERE session_id = ? AND ssms_client_code = ?', [$sessionId, $client])->fetch('assoc');
                        if ($d && $d['d']) {
                            $y = (int)substr((string)$d['d'], 0, 4) - ((int)substr((string)$d['d'], 5, 2) < $m ? 1 : 0);
                        }
                    }
                } catch (\Throwable $e) {
                }
                $defFrom = $y ? sprintf('%04d-%02d-01', $y, $m) : date('Y-m-d', strtotime($today . ' -365 days'));
                $defTo = $y ? min($today, date('Y-m-d', strtotime($defFrom . ' +1 year -1 day'))) : $today;
            }
        }
        // first month of that school year (for monthly targets)
        $fy = (int)substr($defFrom, 0, 4);
        $sessionStart = sprintf('%04d-%02d', (int)substr($defFrom, 5, 2) >= $m ? $fy : $fy - 1, $m);
        $from = $from ?: $defFrom;
        $to = $to ?: $defTo;
        if ($to > $today) {
            $to = $today;
        }
        if ($from > $to) {
            throw new \InvalidArgumentException('The start date must be on or before the end date.');
        }
        if ((strtotime($to) - strtotime($from)) / 86400 > self::MAX_RANGE_DAYS) {
            $from = date('Y-m-d', strtotime($to . ' -' . self::MAX_RANGE_DAYS . ' days'));
        }

        return [$from, $to, $sessionStart];
    }

    /** SQL + params limiting enrollments (alias e) to the request and the person's classes. */
    private static function where(array $c, string $alias = 'e'): array
    {
        $sql = "$alias.ssms_client_code = ? AND $alias.session_id = ? AND COALESCE($alias.status, 'active') = 'active'";
        $p = [$c['client'], $c['session_id']];
        if ($c['class_id']) {
            $sql .= " AND $alias.class_id = ?";
            $p[] = $c['class_id'];
        }
        if ($c['section_id']) {
            $sql .= " AND $alias.section_id = ?";
            $p[] = $c['section_id'];
        }
        if ($c['branch_id']) {
            $sql .= " AND $alias.branch_id = ?";
            $p[] = $c['branch_id'];
        }
        if ($c['scope'] !== null) {
            if (!$c['scope']) {
                return ['1 = 0', []];
            }
            $or = [];
            foreach ($c['scope'] as $s) {
                if ($s['section_id']) {
                    $or[] = "($alias.class_id = ? AND $alias.section_id = ?)";
                    $p[] = (int)$s['class_id'];
                    $p[] = (int)$s['section_id'];
                } else {
                    $or[] = "$alias.class_id = ?";
                    $p[] = (int)$s['class_id'];
                }
            }
            $sql .= ' AND (' . implode(' OR ', $or) . ')';
        }

        return [$sql, $p];
    }

    // ── Overview ────────────────────────────────────────────────────────────

    public static function overview(array $c): array
    {
        [$w, $p] = self::where($c);
        $students = (int)(self::db()->execute("SELECT COUNT(*) n FROM ssms_student_enrollment e WHERE $w", $p)->fetch('assoc')['n'] ?? 0);
        $out = ['students' => $students, 'cards' => []];
        if ($c['can']['attendance']) {
            $period = self::attTotals($c, $c['from'], $c['to']);
            $wkTo = $c['to'];
            $wkFrom = date('Y-m-d', strtotime($wkTo . ' -6 days'));
            $prevTo = date('Y-m-d', strtotime($wkFrom . ' -1 day'));
            $prevFrom = date('Y-m-d', strtotime($prevTo . ' -6 days'));
            $week = self::attTotals($c, $wkFrom, $wkTo);
            $prev = self::attTotals($c, $prevFrom, $prevTo);
            $today = self::attTotals($c, $c['today'], $c['today']);
            $out['attendance'] = ['period_pct' => $period['pct'], 'week_pct' => $week['pct'], 'prev_week_pct' => $prev['pct'],
                'change' => $week['pct'] !== null && $prev['pct'] !== null ? round($week['pct'] - $prev['pct'], 1) : null,
                'today_pct' => $today['pct'], 'today_marked' => $today['marked'], 'week_from' => $wkFrom, 'week_to' => $wkTo,
                'ends_today' => $c['to'] === $c['today']];
        }
        if ($c['can']['fees']) {
            $f = self::feeTotals($c);
            $out['fees'] = ['due_to_date' => $f['due_to_date'], 'outstanding' => $f['outstanding'], 'collected_period' => $f['collected_period'],
                'collection_rate' => $f['collection_rate'], 'currency' => self::currency($c['client'])];
        }
        if ($c['can']['exams']) {
            $exams = self::exams($c);
            if ($exams) {
                $last = self::mainExam($exams);
                $res = self::examResults($c, $last['id']);
                $pcts = array_column($res, 'pct');
                $pass = count(array_filter($pcts, fn($x) => $x >= $c['settings']['pass_pct']));
                $out['exams'] = ['exam' => $last, 'avg_pct' => $pcts ? round(array_sum($pcts) / count($pcts), 1) : null,
                    'pass_rate' => $pcts ? round($pass * 100 / count($pcts), 1) : null, 'students' => count($pcts)];
            }
        }
        $risk = self::atRisk($c, true);
        $out['at_risk'] = ['critical' => $risk['counts']['critical'], 'watch' => $risk['counts']['watch']];

        return $out;
    }

    // ── Attendance ──────────────────────────────────────────────────────────

    private static function attTotals(array $c, string $from, string $to): array
    {
        [$w, $p] = self::where($c);
        $r = self::db()->execute("SELECT SUM(a.attendance = 'P') pr, SUM(a.attendance = 'A') ab, SUM(a.attendance = 'L') lv
                FROM student_attendance a JOIN ssms_student_enrollment e ON e.enrollment_id = a.enrollment_id AND e.ssms_client_code = a.ssms_client_code
               WHERE $w AND a.attendance_date BETWEEN ? AND ? AND a.attendance IN ('P','A','L')", array_merge($p, [$from, $to]))->fetch('assoc');
        $pr = (int)($r['pr'] ?? 0);
        $ab = (int)($r['ab'] ?? 0);
        $lv = (int)($r['lv'] ?? 0);
        $m = $pr + $ab;   // school days the students were expected in (leave is excused)

        return ['present' => $pr, 'absent' => $ab, 'leave' => $lv, 'marked' => $m, 'pct' => $m ? round($pr * 100 / $m, 1) : null];
    }

    public static function attendance(array $c): array
    {
        if (!$c['can']['attendance']) {
            throw new \DomainException("You don't have permission to see attendance.");
        }
        [$w, $p] = self::where($c);
        $base = "FROM student_attendance a JOIN ssms_student_enrollment e ON e.enrollment_id = a.enrollment_id AND e.ssms_client_code = a.ssms_client_code
                 WHERE $w AND a.attendance_date BETWEEN ? AND ? AND a.attendance IN ('P','A','L')";
        $bp = array_merge($p, [$c['from'], $c['to']]);
        $days = self::q("SELECT a.attendance_date d, SUM(a.attendance = 'P') pr, SUM(a.attendance = 'A') ab, SUM(a.attendance = 'L') lv $base
                          GROUP BY a.attendance_date ORDER BY a.attendance_date", $bp);
        $series = [];
        $weekly = count($days) > 62;
        foreach ($days as $r) {
            $d = substr((string)$r['d'], 0, 10);
            $key = $weekly ? date('Y-m-d', strtotime($d . ' -' . ((int)date('N', strtotime($d)) - 1) . ' days')) : $d;   // Monday of the week
            if (!isset($series[$key])) {
                $series[$key] = ['date' => $key, 'present' => 0, 'absent' => 0, 'leave' => 0];
            }
            $series[$key]['present'] += (int)$r['pr'];
            $series[$key]['absent'] += (int)$r['ab'];
            $series[$key]['leave'] += (int)$r['lv'];
        }
        foreach ($series as &$s) {
            $m = $s['present'] + $s['absent'];
            $s['pct'] = $m ? round($s['present'] * 100 / $m, 1) : null;
        }
        unset($s);
        $byClass = array_map(function ($r) {
            $m = (int)$r['pr'] + (int)$r['ab'];

            return ['class_id' => (int)$r['class_id'], 'section_id' => $r['section_id'] !== null ? (int)$r['section_id'] : null,
                    'name' => trim(($r['class_name'] ?? 'Class') . ' ' . ($r['section_name'] ?? '')), 'students' => (int)$r['st'],
                    'pct' => $m ? round((int)$r['pr'] * 100 / $m, 1) : null, 'absent' => (int)$r['ab']];
        }, self::q("SELECT e.class_id, e.section_id, c.class_name, sec.section_name, COUNT(DISTINCT a.enrollment_id) st,
                           SUM(a.attendance = 'P') pr, SUM(a.attendance = 'A') ab, SUM(a.attendance = 'L') lv
                      FROM student_attendance a JOIN ssms_student_enrollment e ON e.enrollment_id = a.enrollment_id AND e.ssms_client_code = a.ssms_client_code
                 LEFT JOIN ssms_classes c ON c.class_id = e.class_id
                 LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
                     WHERE $w AND a.attendance_date BETWEEN ? AND ? AND a.attendance IN ('P','A','L')
                  GROUP BY e.class_id, e.section_id, c.class_name, sec.section_name", $bp));
        usort($byClass, fn($a, $b) => ($a['pct'] ?? 101) <=> ($b['pct'] ?? 101));
        $names = [2 => 'Mon', 3 => 'Tue', 4 => 'Wed', 5 => 'Thu', 6 => 'Fri', 7 => 'Sat', 1 => 'Sun'];
        $byDay = [];
        foreach (self::q("SELECT DAYOFWEEK(a.attendance_date) dw, SUM(a.attendance = 'P') pr, SUM(a.attendance IN ('P','A')) m $base GROUP BY DAYOFWEEK(a.attendance_date)", $bp) as $r) {
            $byDay[(int)$r['dw']] = ['day' => $names[(int)$r['dw']] ?? '?', 'pct' => (int)$r['m'] ? round((int)$r['pr'] * 100 / (int)$r['m'], 1) : null, 'marked' => (int)$r['m']];
        }
        $weekdays = [];
        foreach ([2, 3, 4, 5, 6, 7, 1] as $dw) {
            if (isset($byDay[$dw])) {
                $weekdays[] = $byDay[$dw];
            }
        }
        $tot = self::attTotals($c, $c['from'], $c['to']);
        $low = array_values(array_filter(self::studentAttendance($c), fn($s) => $s['pct'] !== null && $s['pct'] < $c['settings']['att_warn']));
        usort($low, fn($a, $b) => $a['pct'] <=> $b['pct']);

        return ['totals' => $tot, 'series' => array_values($series), 'bucket' => $weekly ? 'week' : 'day', 'by_class' => $byClass,
                'by_weekday' => $weekdays, 'low' => array_slice($low, 0, 100), 'low_count' => count($low)];
    }

    /** Attendance % per student over the range (only students with at least min_days marked). */
    private static function studentAttendance(array $c): array
    {
        [$w, $p] = self::where($c);
        $out = [];
        foreach (self::q("SELECT e.enrollment_id, SUM(a.attendance = 'P') pr, SUM(a.attendance = 'A') ab, SUM(a.attendance = 'L') lv
                            FROM student_attendance a JOIN ssms_student_enrollment e ON e.enrollment_id = a.enrollment_id AND e.ssms_client_code = a.ssms_client_code
                           WHERE $w AND a.attendance_date BETWEEN ? AND ? AND a.attendance IN ('P','A','L')
                        GROUP BY e.enrollment_id", array_merge($p, [$c['from'], $c['to']])) as $r) {
            $m = (int)$r['pr'] + (int)$r['ab'];
            $out[(string)$r['enrollment_id']] = ['enrollment_id' => (string)$r['enrollment_id'], 'marked' => $m, 'absent' => (int)$r['ab'],
                'pct' => $m >= $c['settings']['min_days'] ? round((int)$r['pr'] * 100 / $m, 1) : null];
        }
        self::names($c['client'], $out);

        return array_values($out);
    }

    // ── At-risk students ────────────────────────────────────────────────────

    /**
     * Students who need attention, with the reasons. "critical" = at risk, "watch" = keep an eye on.
     * Reasons: low attendance, absent several days in a row, failing / falling marks, overdue fees.
     */
    public static function atRisk(array $c, bool $countsOnly = false, ?int $limit = 500): array
    {
        $s = $c['settings'];
        $flags = [];
        $add = function (string $eid, string $kind, string $level, string $text, $value = null) use (&$flags) {
            $flags[$eid][] = ['kind' => $kind, 'level' => $level, 'text' => $text, 'value' => $value];
        };
        if ($c['can']['attendance']) {
            foreach (self::studentAttendance($c) as $r) {
                if ($r['pct'] !== null && $r['pct'] < $s['att_critical']) {
                    $add($r['enrollment_id'], 'attendance', 'critical', 'Attendance ' . $r['pct'] . '%', $r['pct']);
                } elseif ($r['pct'] !== null && $r['pct'] < $s['att_warn']) {
                    $add($r['enrollment_id'], 'attendance', 'watch', 'Attendance ' . $r['pct'] . '%', $r['pct']);
                }
            }
            foreach (self::absentStreaks($c) as $eid => $n) {
                if ($n >= $s['absent_streak']) {
                    $add((string)$eid, 'streak', $n >= $s['absent_streak'] * 2 ? 'critical' : 'watch', 'Absent ' . $n . ' days in a row', $n);
                }
            }
        }
        if ($c['can']['exams']) {
            // each student's own latest exam (and the one before it) – classes sit different exams
            // only the exams that are someone's latest or second-latest are worked out
            $exams = self::exams($c);
            [$w, $p] = self::where($c);
            $lastTwo = [];
            foreach (self::q("SELECT m.enrollment_id, m.exam_id FROM ssms_marks m
                                JOIN ssms_student_enrollment e ON e.enrollment_id = m.enrollment_id AND e.ssms_client_code = m.ssms_client_code
                               WHERE $w AND (m.session_id = e.session_id OR m.session_id IS NULL)
                            GROUP BY m.enrollment_id, m.exam_id ORDER BY m.enrollment_id, m.exam_id DESC", $p) as $row) {
                $k = (string)$row['enrollment_id'];
                if (count($lastTwo[$k] ?? []) < 2) {
                    $lastTwo[$k][] = (int)$row['exam_id'];
                }
            }
            $needed = array_flip(array_merge([], ...array_values($lastTwo ?: [[]])));
            $exams = array_values(array_filter($exams, fn($ex) => isset($needed[$ex['id']])));
            $res = [];
            foreach ($exams as $ex) {
                $res[$ex['id']] = self::examResults($c, $ex['id']);
            }
            $mine = [];
            foreach ($exams as $ex) {
                foreach ($res[$ex['id']] as $eid => $r) {
                    $mine[(string)$eid][] = [$ex, $r];
                }
            }
            foreach ($mine as $eid => $list) {
                [$last, $r] = $list[count($list) - 1];
                if ($r['pct'] < $s['pass_pct']) {
                    $add((string)$eid, 'marks', 'critical', $last['name'] . ': ' . $r['pct'] . '% overall', $r['pct']);
                } elseif (count($list) > 1) {
                    // compare the subjects both exams had, so a one-subject quiz isn't compared with a full exam
                    [$prevEx, $p] = $list[count($list) - 2];
                    $g1 = $m1 = $g0 = $m0 = 0.0;
                    foreach ($r['raw'] as $sid => [$got, $mx]) {
                        if (isset($p['raw'][$sid])) {
                            $g1 += $got; $m1 += $mx;
                            $g0 += $p['raw'][$sid][0]; $m0 += $p['raw'][$sid][1];
                        }
                    }
                    if ($m1 > 0 && $m0 > 0) {
                        $now = round($g1 * 100 / $m1, 1);
                        $before = round($g0 * 100 / $m0, 1);
                        if ($before - $now >= $s['drop_pct']) {
                            $add((string)$eid, 'marks', 'watch', 'Marks fell ' . round($before - $now, 1) . ' points (' . $prevEx['name'] . ' ' . $before . '% → ' . $last['name'] . ' ' . $now . '%)',
                                round($before - $now, 1));
                        }
                    }
                }
                if ($r['failed_subjects'] >= $s['fail_subjects']) {
                    $add((string)$eid, 'subjects', $r['failed_subjects'] >= $s['fail_subjects'] + 2 ? 'critical' : 'watch',
                        $last['name'] . ': below pass mark in ' . $r['failed_subjects'] . ' subjects', $r['failed_subjects']);
                }
            }
        }
        if ($c['can']['fees']) {
            $cur = self::currency($c['client']);
            foreach (self::overdue($c, $s['overdue_days']) as $eid => $o) {
                $add((string)$eid, 'fees', $o['days'] > $s['overdue_days'] * 3 ? 'critical' : 'watch',
                    'Fees overdue ' . Locale::money($c['client'], $o['amount']) . ' (' . $o['days'] . ' days)', $o['amount']);
            }
        }
        $list = [];
        $counts = ['critical' => 0, 'watch' => 0];
        foreach ($flags as $eid => $f) {
            $crit = count(array_filter($f, fn($x) => $x['level'] === 'critical'));
            $level = $crit || count($f) >= 3 ? 'critical' : 'watch';
            $counts[$level]++;
            $list[$eid] = ['enrollment_id' => (string)$eid, 'level' => $level, 'score' => $crit * 3 + (count($f) - $crit), 'reasons' => $f];
        }
        if ($countsOnly) {
            return ['counts' => $counts];
        }
        self::names($c['client'], $list);
        $list = array_values($list);
        usort($list, fn($a, $b) => [$b['score'], $a['name'] ?? ''] <=> [$a['score'], $b['name'] ?? '']);

        return ['counts' => $counts, 'students' => $limit ? array_slice($list, 0, $limit) : $list, 'total' => count($list), 'settings' => $s,
                'checks' => array_keys(array_filter(['attendance' => $c['can']['attendance'], 'marks' => $c['can']['exams'], 'fees' => $c['can']['fees']]))];
    }

    /** Most recent run of absences per student (approved leave days are skipped, a present day ends the run). */
    private static function absentStreaks(array $c): array
    {
        [$w, $p] = self::where($c);
        $since = date('Y-m-d', strtotime($c['to'] . ' -45 days'));
        $out = [];
        $done = [];
        foreach (self::q("SELECT a.enrollment_id, a.attendance FROM student_attendance a
                            JOIN ssms_student_enrollment e ON e.enrollment_id = a.enrollment_id AND e.ssms_client_code = a.ssms_client_code
                           WHERE $w AND a.attendance_date BETWEEN ? AND ? AND a.attendance IN ('P','A','L')
                        ORDER BY a.enrollment_id, a.attendance_date DESC", array_merge($p, [max($since, $c['from']), $c['to']])) as $r) {
            $eid = (string)$r['enrollment_id'];
            if (isset($done[$eid]) || strtoupper((string)$r['attendance']) === 'L') {
                continue;
            }
            if (strtoupper((string)$r['attendance']) === 'A') {
                $out[$eid] = ($out[$eid] ?? 0) + 1;
            } else {
                $done[$eid] = true;
            }
        }

        return $out;
    }

    // ── Fees ────────────────────────────────────────────────────────────────

    /** Net amount of a fee structure row after the student's discount, plus tax – the same rule as the fee-due screens. */
    private const NET_DUE = "ROUND(GREATEST(0, fs.fee_amount - COALESCE(sd.discount_amount, 0))
            + ROUND(GREATEST(0, fs.fee_amount - COALESCE(sd.discount_amount, 0)) * COALESCE(fi.tax_percent, 0) / 100, 2), 2)";

    private static function dueJoin(): string
    {
        return "FROM ssms_student_enrollment e
                JOIN ssms_fee_structure fs ON fs.class_id = e.class_id AND fs.session_id = e.session_id AND fs.ssms_client_code = e.ssms_client_code
                JOIN ssms_fee_items fi ON fi.fee_item_id = fs.fee_item_id AND fi.category = 'Academic'
           LEFT JOIN ssms_student_discounts sd ON sd.enrollment_id = e.enrollment_id AND sd.fee_item_id = fs.fee_item_id
                     AND sd.session_id = fs.session_id AND sd.ssms_client_code = fs.ssms_client_code";
    }

    /** One structure row per fee item and month (several branches can repeat it) – as the fee-due screens do. */
    private static function dueOnce(): string
    {
        return " AND fs.fee_id = (SELECT MIN(fs2.fee_id) FROM ssms_fee_structure fs2
                  WHERE fs2.fee_item_id = fs.fee_item_id AND fs2.month_no <=> fs.month_no AND fs2.class_id = fs.class_id
                    AND fs2.session_id = fs.session_id AND fs2.ssms_client_code = fs.ssms_client_code)";
    }

    /** Fee cash paid (late fee excluded), counted unless the payment was rejected. */
    private const PAID_OK = "fp.paid_amount > 0 AND COALESCE(fp.admin_review, '') NOT IN ('Rejected', 'rejected', 'Declined')";

    private static function feeTotals(array $c): array
    {
        [$w, $p] = self::where($c);
        $upto = min($c['to'], $c['today']);
        $due = (float)(self::db()->execute('SELECT SUM(' . self::NET_DUE . ') v ' . self::dueJoin() . " WHERE $w AND fs.due_date <= ?" . self::dueOnce(), array_merge($p, [$upto]))->fetch('assoc')['v'] ?? 0);
        $out = self::outstandingRows($c, $upto);
        $outstanding = array_sum(array_column($out, 'outstanding'));
        $col = self::db()->execute("SELECT SUM(CASE WHEN fi.category = 'Academic' THEN fp.paid_amount - COALESCE(fp.late_fee, 0) ELSE 0 END) acad,
                   SUM(CASE WHEN COALESCE(fi.category, '') <> 'Academic' THEN fp.paid_amount - COALESCE(fp.late_fee, 0) ELSE 0 END) other,
                   SUM(COALESCE(fp.late_fee, 0)) late,
                   SUM(CASE WHEN fp.admin_review IN ('Pending', 'Under Review') THEN fp.paid_amount ELSE 0 END) pending
              FROM ssms_fee_paid_details fp JOIN ssms_student_enrollment e ON e.enrollment_id = fp.enrollment_id AND e.ssms_client_code = fp.ssms_client_code
         LEFT JOIN ssms_fee_items fi ON fi.fee_item_id = fp.fee_item_id
             WHERE $w AND " . self::PAID_OK . ' AND DATE(COALESCE(fp.payment_date, fp.fee_paid_date)) BETWEEN ? AND ?', array_merge($p, [$c['from'], $c['to']]))->fetch('assoc');

        return ['due_to_date' => round($due, 2), 'outstanding' => round($outstanding, 2),
                'collected_period' => round((float)($col['acad'] ?? 0), 2), 'other_collected' => round((float)($col['other'] ?? 0), 2),
                'late_fees' => round((float)($col['late'] ?? 0), 2), 'awaiting_approval' => round((float)($col['pending'] ?? 0), 2),
                'collection_rate' => $due > 0 ? round(max(0, $due - $outstanding) * 100 / $due, 1) : null, 'upto' => $upto];
    }

    /** What each student still owes on academic fees due on or before $upto. */
    private static function outstandingRows(array $c, string $upto): array
    {
        [$w, $p] = self::where($c);
        $rows = self::q('SELECT e.enrollment_id, e.class_id, e.section_id, MIN(CASE WHEN x.owed > 0.009 THEN x.due_date END) oldest, SUM(GREATEST(0, x.owed)) outstanding, SUM(x.net) due
              FROM (SELECT e.enrollment_id, e.class_id, e.section_id, fs.fee_id, fs.due_date, ' . self::NET_DUE . ' net,
                           ' . self::NET_DUE . " - COALESCE((SELECT SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) FROM ssms_fee_paid_details fp
                                        WHERE fp.enrollment_id = e.enrollment_id AND fp.fee_id = fs.fee_id AND fp.ssms_client_code = e.ssms_client_code AND " . self::PAID_OK . '), 0) owed
                    ' . self::dueJoin() . " WHERE $w AND fs.due_date <= ?" . self::dueOnce() . ") x
              JOIN ssms_student_enrollment e ON e.enrollment_id = x.enrollment_id AND e.ssms_client_code = ?
          GROUP BY e.enrollment_id, e.class_id, e.section_id", array_merge($p, [$upto, $c['client']]));

        return array_map(fn($r) => ['enrollment_id' => (string)$r['enrollment_id'], 'class_id' => (int)$r['class_id'],
            'section_id' => $r['section_id'] !== null ? (int)$r['section_id'] : null, 'due' => round((float)$r['due'], 2),
            'outstanding' => round((float)$r['outstanding'], 2), 'oldest' => $r['oldest'] ? substr((string)$r['oldest'], 0, 10) : null], $rows);
    }

    /** enrollment_id => academic fees still owed on dues up to $upto (used by admit-card rules). */
    public static function outstandingFor(string $client, int $sessionId, array $eids, string $upto): array
    {
        $out = [];
        foreach (array_chunk(array_values(array_unique(array_map('strval', $eids))), 500) as $chunk) {
            $in = implode(',', array_fill(0, count($chunk), '?'));
            foreach (self::q('SELECT x.enrollment_id, SUM(GREATEST(0, x.owed)) o
                  FROM (SELECT e.enrollment_id, ' . self::NET_DUE . " - COALESCE((SELECT SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) FROM ssms_fee_paid_details fp
                                    WHERE fp.enrollment_id = e.enrollment_id AND fp.fee_id = fs.fee_id AND fp.ssms_client_code = e.ssms_client_code AND " . self::PAID_OK . '), 0) owed
                        ' . self::dueJoin() . " WHERE e.ssms_client_code = ? AND e.session_id = ? AND e.enrollment_id IN ($in) AND fs.due_date <= ?" . self::dueOnce() . ') x
              GROUP BY x.enrollment_id', array_merge([$client, $sessionId], $chunk, [$upto])) as $r) {
                $out[(string)$r['enrollment_id']] = round((float)$r['o'], 2);
            }
        }

        return $out;
    }

    /**
     * Fee rows still owed, one per enrollment and fee month, with a due date in [$fromDue, $toDue]
     * (current-session academic fees, as on the fee screens). Used by the fee reminders.
     * @return list<array{enrollment_id:string, due_date:string, owed:float}>
     */
    public static function owedItems(string $client, int $sessionId, string $fromDue, string $toDue): array
    {
        $rows = self::q('SELECT x.enrollment_id, x.due_date, x.owed
              FROM (SELECT e.enrollment_id, fs.due_date, ' . self::NET_DUE . " - COALESCE((SELECT SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) FROM ssms_fee_paid_details fp
                                WHERE fp.enrollment_id = e.enrollment_id AND fp.fee_id = fs.fee_id AND fp.ssms_client_code = e.ssms_client_code AND " . self::PAID_OK . '), 0) owed
                    ' . self::dueJoin() . " WHERE e.ssms_client_code = ? AND e.session_id = ? AND COALESCE(e.status, 'active') = 'active'
                      AND fs.due_date BETWEEN ? AND ?" . self::dueOnce() . ') x
             WHERE x.owed > 0.009', [$client, $sessionId, $fromDue, $toDue]);

        return array_map(fn($r) => ['enrollment_id' => (string)$r['enrollment_id'], 'due_date' => substr((string)$r['due_date'], 0, 10), 'owed' => round((float)$r['owed'], 2)], $rows);
    }

    /** enrollment_id => [amount, days] for fees overdue more than $days. */
    private static function overdue(array $c, int $days): array
    {
        $out = [];
        foreach (self::outstandingRows($c, date('Y-m-d', strtotime($c['today'] . ' -' . $days . ' days'))) as $r) {
            if ($r['outstanding'] > 0.009 && $r['oldest']) {
                $out[$r['enrollment_id']] = ['amount' => $r['outstanding'], 'days' => (int)((strtotime($c['today']) - strtotime($r['oldest'])) / 86400)];
            }
        }

        return $out;
    }

    public static function fees(array $c): array
    {
        if (!$c['can']['fees']) {
            throw new \DomainException($c['own'] ? 'Fee figures are shown to the school office only.' : "You don't have permission to see fees.");
        }
        [$w, $p] = self::where($c);
        $months = [];
        for ($m = substr($c['from'], 0, 7); $m <= substr($c['to'], 0, 7); $m = date('Y-m', strtotime($m . '-01 +1 month'))) {
            $months[$m] = ['month' => $m, 'due' => 0.0, 'collected' => 0.0, 'other' => 0.0, 'target' => null];
        }
        foreach (self::q('SELECT DATE_FORMAT(fs.due_date, \'%Y-%m\') ym, SUM(' . self::NET_DUE . ') v ' . self::dueJoin()
            . " WHERE $w AND fs.due_date BETWEEN ? AND ?" . self::dueOnce() . " GROUP BY DATE_FORMAT(fs.due_date, '%Y-%m')", array_merge($p, [substr($c['from'], 0, 7) . '-01', $c['to']])) as $r) {
            if (isset($months[$r['ym']])) {
                $months[$r['ym']]['due'] = round((float)$r['v'], 2);
            }
        }
        foreach (self::q("SELECT DATE_FORMAT(COALESCE(fp.payment_date, fp.fee_paid_date), '%Y-%m') ym,
                    SUM(CASE WHEN fi.category = 'Academic' THEN fp.paid_amount - COALESCE(fp.late_fee, 0) ELSE 0 END) acad,
                    SUM(CASE WHEN COALESCE(fi.category, '') <> 'Academic' THEN fp.paid_amount - COALESCE(fp.late_fee, 0) ELSE 0 END) other
               FROM ssms_fee_paid_details fp JOIN ssms_student_enrollment e ON e.enrollment_id = fp.enrollment_id AND e.ssms_client_code = fp.ssms_client_code
          LEFT JOIN ssms_fee_items fi ON fi.fee_item_id = fp.fee_item_id
              WHERE $w AND " . self::PAID_OK . " AND DATE(COALESCE(fp.payment_date, fp.fee_paid_date)) BETWEEN ? AND ?
           GROUP BY DATE_FORMAT(COALESCE(fp.payment_date, fp.fee_paid_date), '%Y-%m')", array_merge($p, [$c['from'], $c['to']])) as $r) {
            if (isset($months[$r['ym']])) {
                $months[$r['ym']]['collected'] = round((float)$r['acad'], 2);
                $months[$r['ym']]['other'] = round((float)$r['other'], 2);
            }
        }
        // targets are school-wide, so they are only shown without a class / branch filter
        $targets = self::targets($c['client'], (int)$c['session_id']);
        $whole = !$c['class_id'] && !$c['section_id'] && !$c['branch_id'];
        foreach ($months as $k => &$m) {
            $m['target'] = $whole && isset($targets[$k]) ? (float)$targets[$k] : null;
        }
        unset($m);
        $tot = self::feeTotals($c);
        $rows = self::outstandingRows($c, $tot['upto']);
        $byClass = [];
        foreach ($rows as $r) {
            $k = $r['class_id'] . '|' . (int)$r['section_id'];
            if (!isset($byClass[$k])) {
                $byClass[$k] = ['class_id' => $r['class_id'], 'section_id' => $r['section_id'], 'due' => 0.0, 'outstanding' => 0.0, 'students' => 0, 'owing' => 0];
            }
            $byClass[$k]['due'] += $r['due'];
            $byClass[$k]['outstanding'] += $r['outstanding'];
            $byClass[$k]['students']++;
            $byClass[$k]['owing'] += $r['outstanding'] > 0.009 ? 1 : 0;
        }
        foreach ($byClass as &$b) {
            $b['name'] = self::className($c['client'], $b['class_id'], $b['section_id']);
            $b['due'] = round($b['due'], 2);
            $b['outstanding'] = round($b['outstanding'], 2);
            $b['rate'] = $b['due'] > 0 ? round(max(0, $b['due'] - $b['outstanding']) * 100 / $b['due'], 1) : null;
        }
        unset($b);
        $byClass = array_values($byClass);
        usort($byClass, fn($a, $b) => ($a['rate'] ?? 101) <=> ($b['rate'] ?? 101));
        $methods = array_map(fn($r) => ['method' => $r['m'] ?: 'Other', 'amount' => round((float)$r['v'], 2), 'count' => (int)$r['n']], self::q(
            "SELECT COALESCE(NULLIF(TRIM(fp.payment_method), ''), 'Other') m, SUM(fp.paid_amount) v, COUNT(*) n
               FROM ssms_fee_paid_details fp JOIN ssms_student_enrollment e ON e.enrollment_id = fp.enrollment_id AND e.ssms_client_code = fp.ssms_client_code
              WHERE $w AND " . self::PAID_OK . " AND DATE(COALESCE(fp.payment_date, fp.fee_paid_date)) BETWEEN ? AND ?
           GROUP BY COALESCE(NULLIF(TRIM(fp.payment_method), ''), 'Other') ORDER BY v DESC", array_merge($p, [$c['from'], $c['to']])));
        $owing = array_filter($rows, fn($r) => $r['outstanding'] > 0.009);
        usort($owing, fn($a, $b) => $b['outstanding'] <=> $a['outstanding']);
        $top = [];
        foreach (array_slice($owing, 0, 25) as $r) {
            $top[$r['enrollment_id']] = $r + ['days' => $r['oldest'] ? (int)((strtotime($c['today']) - strtotime($r['oldest'])) / 86400) : 0];
        }
        self::names($c['client'], $top);

        return ['currency' => self::currency($c['client']), 'totals' => $tot, 'months' => array_values($months), 'by_class' => $byClass,
                'by_method' => $methods, 'top_owing' => array_values($top), 'owing_count' => count($owing), 'targets_shown' => $whole];
    }

    // ── Class performance ───────────────────────────────────────────────────

    /** Exams with marks in this session (for the people in scope), oldest first. */
    public static function exams(array $c): array
    {
        [$w, $p] = self::where($c);
        return array_map(fn($r) => ['id' => (int)$r['exam_id'], 'name' => $r['exam_name'] ?: ('Exam ' . $r['exam_id']), 'students' => (int)$r['n']], self::q(
            "SELECT m.exam_id, x.exam_name, COUNT(DISTINCT m.enrollment_id) n FROM ssms_marks m
               JOIN ssms_student_enrollment e ON e.enrollment_id = m.enrollment_id AND e.ssms_client_code = m.ssms_client_code
          LEFT JOIN ssms_exams x ON x.exam_id = m.exam_id
              WHERE $w AND (m.session_id = e.session_id OR m.session_id IS NULL)
           GROUP BY m.exam_id, x.exam_name ORDER BY m.exam_id", $p));
    }

    /** The most recent exam most of the students sat (a quiz for one class shouldn't stand for the school). */
    private static function mainExam(array $exams): array
    {
        $most = max(array_column($exams, 'students'));
        $pick = $exams[count($exams) - 1];
        foreach ($exams as $ex) {
            if ($ex['students'] * 2 >= $most) {
                $pick = $ex;
            }
        }

        return $pick;
    }

    /** enrollment_id => [pct, got, max, failed_subjects, class_id, section_id] for one exam. */
    private static function examResults(array $c, int $examId): array
    {
        [$w, $p] = self::where($c);
        $rows = self::q("SELECT m.enrollment_id, e.class_id, e.section_id, m.subject_id,
                    COALESCE(m.total_marks, COALESCE(m.theory_marks, 0) + COALESCE(m.internal_marks, 0) + COALESCE(m.practical_marks, 0)) total_marks,
                    COALESCE((SELECT COALESCE(mm.max_marks, COALESCE(mm.theory_max_marks, 0) + COALESCE(mm.internal_max_marks, 0) + COALESCE(mm.practical_max_marks, 0))
                                FROM ssms_max_marks mm WHERE mm.subject_id = m.subject_id AND mm.class_id = m.class_id AND mm.ssms_client_code = m.ssms_client_code
                                 AND (mm.exam_id = m.exam_id OR mm.exam_id IS NULL OR mm.exam_id = 0)
                            ORDER BY (mm.exam_id IS NULL OR mm.exam_id = 0) ASC LIMIT 1), 100) mx
               FROM ssms_marks m JOIN ssms_student_enrollment e ON e.enrollment_id = m.enrollment_id AND e.ssms_client_code = m.ssms_client_code
              WHERE $w AND m.exam_id = ? AND (m.total_marks IS NOT NULL OR m.theory_marks IS NOT NULL OR m.internal_marks IS NOT NULL OR m.practical_marks IS NOT NULL)", array_merge($p, [$examId]));
        $out = [];
        $pass = $c['settings']['pass_pct'];
        foreach ($rows as $r) {
            $mx = (float)$r['mx'];
            if ($mx <= 0) {
                continue;
            }
            $eid = (string)$r['enrollment_id'];
            if (!isset($out[$eid])) {
                $out[$eid] = ['got' => 0.0, 'max' => 0.0, 'failed_subjects' => 0, 'subjects' => 0, 'class_id' => (int)$r['class_id'],
                              'section_id' => $r['section_id'] !== null ? (int)$r['section_id'] : null, 'by_subject' => [], 'raw' => []];
            }
            $got = (float)$r['total_marks'];
            $out[$eid]['got'] += $got;
            $out[$eid]['max'] += $mx;
            $out[$eid]['subjects']++;
            $sp = $got * 100 / $mx;
            $out[$eid]['by_subject'][(int)$r['subject_id']] = $sp;
            $out[$eid]['raw'][(int)$r['subject_id']] = [$got, $mx];
            if ($sp < $pass) {
                $out[$eid]['failed_subjects']++;
            }
        }
        foreach ($out as &$o) {
            $o['pct'] = $o['max'] > 0 ? round($o['got'] * 100 / $o['max'], 1) : 0.0;
        }
        unset($o);

        return $out;
    }

    public static function performance(array $c): array
    {
        if (!$c['can']['exams']) {
            throw new \DomainException("You don't have permission to see exam results.");
        }
        $exams = self::exams($c);
        if (!$exams) {
            return ['exams' => [], 'exam' => null, 'classes' => [], 'subjects' => [], 'trend' => [], 'pass_pct' => $c['settings']['pass_pct']];
        }
        $ids = array_column($exams, 'id');
        $examId = $c['exam_id'] && in_array($c['exam_id'], $ids, true) ? $c['exam_id'] : self::mainExam($exams)['id'];
        $pass = $c['settings']['pass_pct'];
        $res = self::examResults($c, $examId);
        $classes = [];
        $subj = [];
        foreach ($res as $r) {
            $k = $r['class_id'] . '|' . (int)$r['section_id'];
            $classes[$k]['pcts'][] = $r['pct'];
            $classes[$k]['class_id'] = $r['class_id'];
            $classes[$k]['section_id'] = $r['section_id'];
            foreach ($r['by_subject'] as $sid => $sp) {
                $subj[$sid]['all'][] = $sp;
                $subj[$sid]['by'][$k][] = $sp;
            }
        }
        $classOut = [];
        foreach ($classes as $k => $x) {
            $pc = $x['pcts'];
            sort($pc);
            $n = count($pc);
            $classOut[$k] = ['key' => $k, 'class_id' => $x['class_id'], 'section_id' => $x['section_id'], 'name' => self::className($c['client'], $x['class_id'], $x['section_id']),
                'students' => $n, 'avg_pct' => round(array_sum($pc) / $n, 1), 'median_pct' => round($n % 2 ? $pc[intdiv($n, 2)] : ($pc[$n / 2 - 1] + $pc[$n / 2]) / 2, 1),
                'top_pct' => round(max($pc), 1), 'pass_rate' => round(count(array_filter($pc, fn($v) => $v >= $pass)) * 100 / $n, 1),
                'below_pass' => count(array_filter($pc, fn($v) => $v < $pass))];
        }
        uasort($classOut, fn($a, $b) => $b['avg_pct'] <=> $a['avg_pct']);
        $subjects = [];
        $names = self::subjectNames($c['client'], array_keys($subj));
        foreach ($subj as $sid => $x) {
            $row = ['subject_id' => $sid, 'name' => $names[$sid] ?? ('Subject ' . $sid), 'avg_pct' => round(array_sum($x['all']) / count($x['all']), 1),
                    'pass_rate' => round(count(array_filter($x['all'], fn($v) => $v >= $pass)) * 100 / count($x['all']), 1), 'by_class' => []];
            foreach ($x['by'] as $k => $v) {
                $row['by_class'][$k] = round(array_sum($v) / count($v), 1);
            }
            $subjects[] = $row;
        }
        usort($subjects, fn($a, $b) => $a['avg_pct'] <=> $b['avg_pct']);
        // trend: each class's average across the session's exams (up to the last 8)
        $trend = [];
        foreach (array_slice($exams, -8) as $ex) {
            $r = $ex['id'] === $examId ? $res : self::examResults($c, $ex['id']);
            $by = [];
            foreach ($r as $x) {
                $by[$x['class_id'] . '|' . (int)$x['section_id']][] = $x['pct'];
            }
            $pt = ['exam_id' => $ex['id'], 'exam' => $ex['name'], 'classes' => []];
            foreach ($by as $k => $v) {
                $pt['classes'][$k] = round(array_sum($v) / count($v), 1);
            }
            $pts = array_merge(...array_values($by ?: [[]]));
            $pt['overall'] = $pts ? round(array_sum($pts) / count($pts), 1) : null;
            $trend[] = $pt;
        }

        return ['exams' => $exams, 'exam' => $exams[array_search($examId, $ids, true)], 'classes' => array_values($classOut), 'subjects' => $subjects,
                'trend' => $trend, 'pass_pct' => $pass];
    }

    // ── Filters ─────────────────────────────────────────────────────────────

    /** Sessions, classes / sections (only the person's own when "own classes only") and branches. */
    public static function filters(array $c): array
    {
        $classes = [];
        try {
            foreach (self::q('SELECT c.class_id, c.class_name, s.section_id, s.section_name FROM ssms_classes c
                           LEFT JOIN ssms_sections s ON s.class_id = c.class_id AND s.ssms_client_code = c.ssms_client_code
                               WHERE c.ssms_client_code = ? ORDER BY c.class_id, s.section_name', [$c['client']]) as $r) {
                $cid = (int)$r['class_id'];
                $sid = $r['section_id'] !== null ? (int)$r['section_id'] : null;
                if ($c['scope'] !== null) {
                    $in = false;
                    foreach ($c['scope'] as $sc) {
                        if ((int)$sc['class_id'] === $cid && (!$sc['section_id'] || ($sid !== null && (int)$sc['section_id'] === $sid))) {
                            $in = true;
                        }
                    }
                    if (!$in) {
                        continue;
                    }
                }
                if (!isset($classes[$cid])) {
                    $classes[$cid] = ['class_id' => $cid, 'name' => (string)$r['class_name'], 'sections' => []];
                }
                if ($sid !== null) {
                    $classes[$cid]['sections'][] = ['section_id' => $sid, 'name' => (string)$r['section_name']];
                }
            }
        } catch (\Throwable $e) {
        }
        $branches = [];
        if ($c['scope'] === null) {
            try {
                $branches = array_map(fn($r) => ['branch_id' => (int)$r['branch_id'], 'name' => (string)$r['branch_name']],
                    self::q('SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_name', [$c['client']]));
            } catch (\Throwable $e) {
            }
        }

        return ['sessions' => $c['sessions'], 'session_id' => $c['session_id'], 'current_session' => $c['current_session'],
                'classes' => array_values($classes), 'branches' => count($branches) > 1 ? $branches : [],
                'from' => $c['from'], 'to' => $c['to'], 'today' => $c['today'], 'own' => $c['own'], 'can' => $c['can'],
                'settings' => $c['settings'], 'currency' => $c['can']['fees'] ? self::currency($c['client']) : null];
    }

    // ── Settings & targets ──────────────────────────────────────────────────

    public static function settings(string $client): array
    {
        $s = self::DEFAULTS;
        try {
            $cc = self::db()->execute('SELECT country_code FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc');
            if (strtoupper((string)($cc['country_code'] ?? '')) === 'IN') {
                $s['pass_pct'] = 33;   // the usual Indian board pass mark
            }
        } catch (\Throwable $e) {
        }
        try {
            $r = self::db()->execute('SELECT settings_json FROM ssms_analytics_settings WHERE ssms_client_code = ?', [$client])->fetch('assoc');
            $saved = $r && $r['settings_json'] ? json_decode((string)$r['settings_json'], true) : [];
            foreach (self::DEFAULTS as $k => $_) {
                if (isset($saved[$k]) && is_numeric($saved[$k])) {
                    $s[$k] = (int)$saved[$k];
                }
            }
        } catch (\Throwable $e) {
            // table not created yet – defaults
        }

        return $s;
    }

    public static function targets(string $client, int $sessionId): array
    {
        try {
            $r = self::db()->execute('SELECT targets_json FROM ssms_analytics_settings WHERE ssms_client_code = ?', [$client])->fetch('assoc');
            $t = $r && $r['targets_json'] ? json_decode((string)$r['targets_json'], true) : [];

            return is_array($t[(string)$sessionId] ?? null) ? $t[(string)$sessionId] : [];
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** Save thresholds and / or this session's monthly targets ({"2026-04": 150000, …}; empty = no target). */
    public static function saveSettings(array $c, array $d): array
    {
        if (!$c['can']['edit']) {
            throw new \DomainException("You don't have permission to change analytics settings.");
        }
        $s = self::settings($c['client']);
        $changed = [];
        foreach ((array)($d['settings'] ?? []) as $k => $v) {
            if (!isset(self::DEFAULTS[$k])) {
                continue;
            }
            if (!is_numeric($v)) {
                throw new \InvalidArgumentException("$k must be a number.");
            }
            [$lo, $hi] = self::LIMITS[$k];
            $v = (int)round((float)$v);
            if ($v < $lo || $v > $hi) {
                throw new \InvalidArgumentException("$k must be between $lo and $hi.");
            }
            if ($s[$k] !== $v) {
                $changed[] = $k;
            }
            $s[$k] = $v;
        }
        if ($s['att_critical'] > $s['att_warn']) {
            throw new \InvalidArgumentException('The "at risk" attendance level must be at or below the "watch" level.');
        }
        $all = [];
        try {
            $r = self::db()->execute('SELECT targets_json FROM ssms_analytics_settings WHERE ssms_client_code = ?', [$c['client']])->fetch('assoc');
            $all = $r && $r['targets_json'] ? (json_decode((string)$r['targets_json'], true) ?: []) : [];
        } catch (\Throwable $e) {
        }
        if (array_key_exists('targets', $d)) {
            if (!$c['can']['fees']) {
                throw new \DomainException('Only people who can see fees can set collection targets.');
            }
            $t = [];
            foreach ((array)$d['targets'] as $ym => $amt) {
                if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string)$ym)) {
                    throw new \InvalidArgumentException('Target months must look like 2026-04.');
                }
                if ($amt === '' || $amt === null) {
                    continue;
                }
                if (!is_numeric($amt) || (float)$amt < 0 || (float)$amt > 1e12) {
                    throw new \InvalidArgumentException("The target for $ym must be a positive amount.");
                }
                $t[(string)$ym] = round((float)$amt, 2);
            }
            ksort($t);
            $all[(string)$c['session_id']] = $t;
            $changed[] = 'targets';
        }
        $now = AccountSecurity::now();
        self::db()->execute('INSERT INTO ssms_analytics_settings (ssms_client_code, settings_json, targets_json, updated_by, modified) VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), targets_json = VALUES(targets_json), updated_by = VALUES(updated_by), modified = VALUES(modified)',
            [$c['client'], json_encode($s), json_encode($all), mb_substr($c['user'], 0, 100), $now]);

        return ['settings' => $s, 'targets' => $all[(string)$c['session_id']] ?? [], 'changed' => $changed];
    }

    /** At-risk list as CSV text. */
    public static function atRiskCsv(array $c): string
    {
        if (!$c['can']['export']) {
            throw new \DomainException("You don't have permission to export reports.");
        }
        $r = self::atRisk($c, false, null);
        $cell = function ($v) {
            $v = (string)$v;
            if ($v !== '' && strpbrk($v[0], '=+-@') !== false) {
                $v = "'" . $v;   // stop spreadsheet formulas
            }

            return '"' . str_replace('"', '""', $v) . '"';
        };
        $lines = [implode(',', array_map($cell, ['Student', 'Class', 'Roll', 'Enrollment ID', 'Level', 'Reasons']))];
        foreach ($r['students'] as $s) {
            $lines[] = implode(',', array_map($cell, [$s['name'] ?? '', $s['class_name'] ?? '', $s['roll_number'] ?? '', $s['enrollment_id'],
                $s['level'] === 'critical' ? 'At risk' : 'Watch', implode('; ', array_column($s['reasons'], 'text'))]));
        }

        return "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n";
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** Adds name, class_name, roll_number, registration_id to rows keyed by enrollment_id. */
    private static function names(string $client, array &$rows): void
    {
        if (!$rows) {
            return;
        }
        foreach (array_chunk(array_keys($rows), 500) as $chunk) {
            $in = implode(',', array_fill(0, count($chunk), '?'));
            foreach (self::q("SELECT e.enrollment_id, e.registration_id, e.roll_number, r.student_first_name, r.student_last_name, c.class_name, s.section_name
                                FROM ssms_student_enrollment e
                                JOIN ssms_student_registration r ON r.registration_id = e.registration_id AND r.ssms_client_code = e.ssms_client_code
                           LEFT JOIN ssms_classes c ON c.class_id = e.class_id
                           LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                               WHERE e.ssms_client_code = ? AND e.enrollment_id IN ($in)", array_merge([$client], array_map('strval', $chunk))) as $r) {
                $k = (string)$r['enrollment_id'];
                if (isset($rows[$k])) {
                    $rows[$k]['name'] = trim($r['student_first_name'] . ' ' . $r['student_last_name']);
                    $rows[$k]['class_name'] = trim(($r['class_name'] ?? '') . ' ' . ($r['section_name'] ?? ''));
                    $rows[$k]['roll_number'] = $r['roll_number'];
                    $rows[$k]['registration_id'] = $r['registration_id'];
                }
            }
        }
    }

    private static function className(string $client, ?int $classId, ?int $sectionId): string
    {
        static $cache = [];
        $k = $client . '|' . $classId . '|' . $sectionId;
        if (!isset($cache[$k])) {
            $c = $classId ? self::db()->execute('SELECT class_name FROM ssms_classes WHERE class_id = ?', [$classId])->fetch('assoc') : null;
            $s = $sectionId ? self::db()->execute('SELECT section_name FROM ssms_sections WHERE section_id = ?', [$sectionId])->fetch('assoc') : null;
            $cache[$k] = trim(($c['class_name'] ?? 'Class ' . $classId) . ' ' . ($s['section_name'] ?? ''));
        }

        return $cache[$k];
    }

    private static function subjectNames(string $client, array $ids): array
    {
        if (!$ids) {
            return [];
        }
        $in = implode(',', array_fill(0, count($ids), '?'));

        return array_column(self::q("SELECT subject_id, subject_name FROM ssms_subjects WHERE subject_id IN ($in)", array_map('intval', $ids)), 'subject_name', 'subject_id');
    }

    /** The school's currency symbol (Region & formats). */
    public static function currency(string $client): string
    {
        try {
            return Locale::get($client)['currency_symbol'];
        } catch (\Throwable $e) {
            return '';
        }
    }

    private static function q(string $sql, array $p): array
    {
        return self::db()->execute($sql, $p)->fetchAll('assoc');
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
