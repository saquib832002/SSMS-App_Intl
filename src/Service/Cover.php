<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Teacher cover & substitution.
 *
 * Who is away on a date comes from data the school already keeps:
 *   - approved staff leave (ssms_leave_applications; half days → morning / afternoon periods),
 *   - staff attendance marked A (absent) or L (leave) for that day,
 *   - exam invigilation duties (ssms_exam_duties) – only the periods that overlap the sitting,
 *   - "away" marked here by the office (training, trip …; whole day or some periods).
 * Their periods in the timetable (current session, that weekday) need cover. The office picks a free
 * teacher from a ranked list (same subject, teaches the class, class teacher, same branch, fewest covers),
 * or lets "Suggest for all" fill the day within the school's limits. The cover teacher gets a bell + push,
 * can accept or decline; the office hears about declines, and gets a morning message while periods are open.
 * When the absence goes away (leave cancelled, marked present, away removed) future covers are cancelled
 * and the cover teacher is told.
 */
class Cover
{
    public const REASONS = ['leave', 'absent', 'away', 'exam_duty'];
    public const DEFAULTS = ['max_per_day' => 2, 'max_per_week' => 6, 'notify_teacher' => 1, 'allow_decline' => 1, 'alert_on' => 1, 'alert_time' => '07:00'];

    /** Tests switch this off: send the pushes at once (true) or leave them for the worker. */
    public static bool $sendNow = true;

    private static array $cache = [];

    public static function resetCache(): void
    {
        self::$cache = [];
    }

    // ── Who is asking ───────────────────────────────────────────────────────

    /** $actor = [user, role, custom_role]. view = see the cover sheet, edit = arrange cover (Roles › Timetable). */
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
        $g = fn(string $k) => $owner || !empty($grid['timetable'][$k]);
        $staff = self::one('SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $client]);

        return ['client' => $client, 'user' => $user, 'role' => $role, 'staff_id' => $staff && $staff['staff_id'] ? (int)$staff['staff_id'] : null,
                'view' => $g('view'), 'edit' => $g('edit')];
    }

    private static function need(array $a, string $kind): void
    {
        if (empty($a[$kind])) {
            throw new \DomainException($kind === 'edit'
                ? "You don't have permission to arrange cover. Ask the school owner if you need it (Roles › Timetable › Edit)."
                : "You don't have permission to see the cover sheet. Ask the school owner if you need it.");
        }
    }

    // ── Settings ────────────────────────────────────────────────────────────

    public static function settings(string $client): array
    {
        if (isset(self::$cache['settings|' . $client])) {
            return self::$cache['settings|' . $client];
        }
        $r = null;
        try {
            $r = self::one('SELECT * FROM ssms_cover_settings WHERE ssms_client_code = ?', [$client]);
        } catch (\Throwable $e) {
        }
        $s = self::DEFAULTS;
        if ($r) {
            foreach (array_keys(self::DEFAULTS) as $k) {
                $s[$k] = $k === 'alert_time' ? (string)$r[$k] : (int)$r[$k];
            }
        }

        return self::$cache['settings|' . $client] = $s;
    }

    public static function saveSettings(array $a, array $d): array
    {
        self::need($a, 'edit');
        $s = self::settings($a['client']);
        foreach (['max_per_day' => 8, 'max_per_week' => 40] as $k => $max) {
            if (array_key_exists($k, $d)) {
                $v = trim((string)$d[$k]);
                if ($v === '' || !ctype_digit($v) || (int)$v > $max) {
                    throw new \DomainException($k === 'max_per_day' ? "Cover periods a day must be 0 – {$max} (0 = no limit)." : "Cover periods a week must be 0 – {$max} (0 = no limit).");
                }
                $s[$k] = (int)$v;
            }
        }
        foreach (['notify_teacher', 'allow_decline', 'alert_on'] as $k) {
            if (array_key_exists($k, $d)) {
                $s[$k] = !empty($d[$k]) && $d[$k] !== 'false' ? 1 : 0;
            }
        }
        if (array_key_exists('alert_time', $d)) {
            $t = trim((string)$d['alert_time']);
            if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t)) {
                throw new \DomainException('Enter the morning message time as HH:MM (24-hour), e.g. 07:00.');
            }
            $s['alert_time'] = $t;
        }
        self::db()->execute('INSERT INTO ssms_cover_settings (ssms_client_code, max_per_day, max_per_week, notify_teacher, allow_decline, alert_on, alert_time, modified, modified_by)
            VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE max_per_day = VALUES(max_per_day), max_per_week = VALUES(max_per_week), notify_teacher = VALUES(notify_teacher),
            allow_decline = VALUES(allow_decline), alert_on = VALUES(alert_on), alert_time = VALUES(alert_time), modified = VALUES(modified), modified_by = VALUES(modified_by)',
            [$a['client'], $s['max_per_day'], $s['max_per_week'], $s['notify_teacher'], $s['allow_decline'], $s['alert_on'], $s['alert_time'], self::now(), $a['user']]);
        unset(self::$cache['settings|' . $a['client']]);

        return $s;
    }

    // ── The day ─────────────────────────────────────────────────────────────

    /** Everything about one date: who is away, their periods and cover, open count, staff to pick from. */
    public static function day(array $a, ?string $date = null): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $date = self::date($c, $date);
        $x = self::ctx($c, $date);
        if ($x['school_day'] && $date >= self::today($c)) {
            if (self::reconcile($x) > 0) {
                $x = self::ctx($c, $date, true);
            }
        }
        $absent = [];
        foreach ($x['absent'] as $sid => $reasons) {
            $absent[$sid] = ['staff_id' => $sid, 'name' => $x['staff'][$sid]['name'] ?? ('#' . $sid), 'reasons' => array_map(fn($r) => array_diff_key($r, ['periods' => 1]), $reasons), 'slots' => []];
        }
        if (!$a['edit']) {
            // view only (e.g. teachers): who is away and why in general terms – not the kind of leave
            foreach ($absent as &$p) {
                $p['reasons'] = array_map(fn($r) => ['type' => $r['type'], 'label' => $r['type'] === 'exam_duty' ? $r['label'] : '', 'half' => $r['half'] ?? null], $p['reasons']);
            }
            unset($p);
        }
        foreach ($x['needs'] as $tid => $n) {
            $slot = self::slotView($x, $x['slots'][$tid]);
            $as = $x['rows'][$tid] ?? null;
            $slot['cover'] = $as ? self::rowView($x, $as) : null;
            $slot['reason'] = $n['reason'];
            $slot['state'] = self::state($x, $tid);
            $absent[$n['staff_id']]['slots'][] = $slot;
        }
        foreach ($absent as &$p) {
            usort($p['slots'], fn($l, $r) => $l['period_number'] <=> $r['period_number'] ?: strcmp($l['class_label'], $r['class_label']));
            $p['open'] = count(array_filter($p['slots'], fn($s) => $s['state'] === 'open'));
        }
        unset($p);
        $absent = array_values($absent);
        usort($absent, fn($l, $r) => ($r['open'] <=> $l['open']) ?: strcmp($l['name'], $r['name']));
        $staff = array_values(array_map(fn($s) => ['staff_id' => $s['staff_id'], 'name' => $s['name']], $x['staff']));

        return ['date' => $date, 'today' => self::today($c), 'school_day' => $x['school_day'], 'off' => $x['off'], 'session_id' => $x['session_id'],
                'can_edit' => (bool)$a['edit'], 'absent' => $absent, 'pending_leave' => $a['edit'] ? $x['pending'] : [],
                'away' => array_values(array_map(fn($w) => $w + ['name' => $x['staff'][$w['staff_id']]['name'] ?? ''], $a['edit'] ? $x['away'] : [])),
                'summary' => self::summary($x) + ['teachers' => count($absent)],
                'periods' => array_values(array_map(fn($p) => ['period_id' => $p['period_id'], 'period_number' => $p['period_number'], 'name' => $p['period_name'],
                    'start' => self::hm($p['start_time']), 'end' => self::hm($p['end_time'])], array_filter($x['periods'], fn($p) => !$p['is_break']))),
                'staff' => $a['edit'] ? $staff : [], 'settings' => self::settings($c)];
    }

    /** Free teachers for one period, best first, and who is not free and why. */
    public static function suggest(array $a, ?string $date, int $timetableId): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $date = self::date($c, $date);
        $x = self::ctx($c, $date);
        if (!isset($x['needs'][$timetableId])) {
            throw new \DomainException('This period does not need cover: its teacher is not away that day.');
        }
        $r = self::rank($x, $x['slots'][$timetableId]);
        if (!$a['edit']) {
            foreach ($r['busy'] as &$b) {
                if (in_array($b['why'], ['leave', 'away', 'absent'], true)) {
                    $b['detail'] = '';   // not the kind of leave / why someone is away
                }
            }
            unset($b);
        }
        $as = $x['rows'][$timetableId] ?? null;

        return ['slot' => self::slotView($x, $x['slots'][$timetableId]) + ['cover' => $as ? self::rowView($x, $as) : null],
                'candidates' => $r['free'], 'busy' => $r['busy'], 'settings' => self::settings($c)];
    }

    /**
     * Give a period to a teacher ($staffId), or mark it "no cover" ($staffId null: self-study, merged class …).
     * Over the school's daily / weekly limit → ['confirm' => message] unless $force.
     */
    public static function assign(array $a, ?string $date, int $timetableId, ?int $staffId, ?string $note = null, bool $force = false): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $date = self::date($c, $date, true);
        $x = self::ctx($c, $date, true);
        if (!isset($x['needs'][$timetableId])) {
            throw new \DomainException('This period does not need cover: its teacher is not away that day.');
        }
        $slot = $x['slots'][$timetableId];
        $note = self::clip($note, 255);
        if ($staffId) {
            $r = self::rank($x, $slot);
            $cand = null;
            foreach ($r['free'] as $f) {
                if ($f['staff_id'] === $staffId) {
                    $cand = $f;
                }
            }
            if (!$cand) {
                foreach ($r['busy'] as $b) {
                    if ($b['staff_id'] === $staffId) {
                        throw new \DomainException(Locale::t($c, '{name} is not free then: {why}.', ['name' => $b['name'], 'why' => self::whyText($c, $b)]));
                    }
                }
                throw new \DomainException('Choose a teacher of this school.');
            }
            if ($cand['over_limit'] && !$force) {
                return ['confirm' => Locale::t($c, '{name} already has {n} cover periods (limit {limit}). Give this one too?',
                    ['name' => $cand['name'], 'n' => $cand['over_limit']['n'], 'limit' => $cand['over_limit']['limit']])];
            }
        }
        $sent = self::write($x, $slot, $staffId, $note, $a['user']);
        self::flush($c, $sent);
        $x = self::ctx($c, $date, true);

        return ['slot' => self::slotView($x, $x['slots'][$timetableId]) + ['cover' => isset($x['rows'][$timetableId]) ? self::rowView($x, $x['rows'][$timetableId]) : null],
                'summary' => self::summary($x)];
    }

    /** Take a cover (or "no cover") off a period again. */
    public static function unassign(array $a, ?string $date, int $timetableId): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $date = self::date($c, $date, true);
        $x = self::ctx($c, $date, true);
        $row = $x['rows'][$timetableId] ?? null;
        if (!$row) {
            throw new \DomainException('Nothing is arranged for this period.');
        }
        $msgs = [];
        self::db()->execute('DELETE FROM ssms_cover_assignments WHERE id = ? AND ssms_client_code = ?', [(int)$row['id'], $c]);
        if ($row['hold_staff_id'] && isset($x['slots'][$timetableId])) {
            $msgs[] = ['to' => (int)$row['cover_staff_id'], 'type' => 'cancel', 'slot' => self::slotView($x, $x['slots'][$timetableId]), 'date' => $date, 'id' => (int)$row['id']];
        }
        self::flush($c, $msgs);
        $x = self::ctx($c, $date, true);

        return ['removed' => self::rowView($x, $row), 'summary' => self::summary($x)];
    }

    /**
     * "Suggest for all": fill every open period of the day with the best free teacher within the limits.
     * $apply false = only show the plan. $chosen = the plan the person saw ([[timetable_id, staff_id] …]):
     * exactly that is stored, skipping any period / teacher that changed meanwhile.
     */
    public static function autoAssign(array $a, ?string $date, bool $apply, ?array $chosen = null): array
    {
        self::need($a, $apply ? 'edit' : 'view');
        $c = $a['client'];
        $date = self::date($c, $date, $apply);
        $x = self::ctx($c, $date, true);
        $plan = [];
        $unfilled = [];
        $msgs = [];
        $pickFor = function (array $slot, ?int $want) use (&$x): ?array {
            foreach (self::rank($x, $slot)['free'] as $f) {
                if (!$f['over_limit'] && ($want === null || $f['staff_id'] === $want)) {
                    return $f;
                }
            }

            return null;
        };
        if ($chosen !== null) {
            $order = [];
            $want = [];
            foreach ($chosen as $p) {
                $tid = (int)($p['timetable_id'] ?? 0);
                if ($tid && isset($x['needs'][$tid]) && !isset($want[$tid])) {
                    $order[] = $tid;
                    $want[$tid] = (int)($p['staff_id'] ?? 0);
                }
            }
        } else {
            $order = array_keys(array_filter($x['needs'], fn($n, $tid) => self::state($x, $tid) === 'open', ARRAY_FILTER_USE_BOTH));
            // hardest first: the period with the fewest free teachers, then the earliest
            $count = [];
            foreach ($order as $tid) {
                $count[$tid] = count(array_filter(self::rank($x, $x['slots'][$tid])['free'], fn($f) => !$f['over_limit']));
            }
            usort($order, fn($l, $r) => ($count[$l] <=> $count[$r]) ?: ($x['slots'][$l]['period_number'] <=> $x['slots'][$r]['period_number']) ?: ($l <=> $r));
        }
        try {
            foreach ($order as $tid) {
                $slot = $x['slots'][$tid];
                $view = self::slotView($x, $slot);
                $best = self::state($x, $tid) === 'open' ? $pickFor($slot, $chosen !== null ? $want[$tid] : null) : null;
                if (!$best) {
                    $unfilled[] = $view;
                    continue;
                }
                if ($apply) {
                    try {
                        $msgs = array_merge($msgs, self::write($x, $slot, $best['staff_id'], null, $a['user'], true));
                    } catch (\DomainException $e) {
                        $unfilled[] = $view;   // someone changed it meanwhile
                        $x = self::ctx($c, $date, true);
                        continue;
                    }
                } else {
                    self::hold($x, $slot, $best['staff_id']);   // so the next period sees this teacher as busy / loaded
                }
                $plan[] = $view + ['staff_id' => $best['staff_id'], 'name' => $best['name'], 'score' => $best['score'], 'reasons' => $best['reasons']];
            }
        } finally {
            if ($apply) {
                self::flush($c, $msgs);
            }
        }
        if ($apply) {
            $x = self::ctx($c, $date, true);
        }
        usort($plan, fn($l, $r) => $l['period_number'] <=> $r['period_number'] ?: strcmp($l['class_label'], $r['class_label']));

        return ['applied' => $apply, 'plan' => $plan, 'unfilled' => $unfilled, 'summary' => self::summary($x)];
    }

    // ── Away (marked by the office) ─────────────────────────────────────────

    public static function markAway(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $date = self::date($c, (string)($d['date'] ?? ''), true);
        $sid = (int)($d['staff_id'] ?? 0);
        $st = self::one("SELECT staff_id, first_name, last_name FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?", [$sid, $c]);
        if (!$st) {
            throw new \DomainException('Choose a teacher of this school.');
        }
        $from = isset($d['from_period']) && $d['from_period'] !== '' && $d['from_period'] !== null ? (int)$d['from_period'] : null;
        $to = isset($d['to_period']) && $d['to_period'] !== '' && $d['to_period'] !== null ? (int)$d['to_period'] : null;
        if ($from !== null && $to === null) {
            $to = $from;
        }
        if ($to !== null && $from === null) {
            $from = $to;
        }
        if ($from !== null && ($from < 0 || $to < $from)) {
            throw new \DomainException('The last period must be the same as or after the first.');
        }
        $reason = self::clip($d['reason'] ?? null, 120);
        self::db()->execute('INSERT INTO ssms_cover_absences (ssms_client_code, staff_id, absent_date, from_period, to_period, reason, created_by, created) VALUES (?,?,?,?,?,?,?,?)',
            [$c, $sid, $date, $from, $to, $reason, $a['user'], self::now()]);
        $id = (int)self::one('SELECT LAST_INSERT_ID() id', [])['id'];
        self::resetCache();

        return ['id' => $id, 'name' => trim($st['first_name'] . ' ' . $st['last_name']), 'date' => $date, 'from_period' => $from, 'to_period' => $to, 'reason' => $reason,
                'day' => self::day($a, $date)];
    }

    public static function removeAway(array $a, int $id): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $w = self::one('SELECT * FROM ssms_cover_absences WHERE id = ? AND ssms_client_code = ?', [$id, $c]);
        if (!$w) {
            throw new \DomainException('Not found.');
        }
        self::db()->execute('DELETE FROM ssms_cover_absences WHERE id = ? AND ssms_client_code = ?', [$id, $c]);
        $date = substr((string)$w['absent_date'], 0, 10);
        self::resetCache();
        if ($date >= self::today($c)) {
            self::reconcile(self::ctx($c, $date, true));
        }

        return ['removed' => $id, 'staff_id' => (int)$w['staff_id'], 'date' => $date, 'day' => self::day($a, $date)];
    }

    // ── Teachers' own view ──────────────────────────────────────────────────

    /** My cover periods: upcoming (and the last two weeks). */
    public static function myCovers(array $a): array
    {
        $c = $a['client'];
        $s = self::settings($c);
        if (!$a['staff_id']) {
            return ['covers' => [], 'allow_decline' => (bool)$s['allow_decline'], 'today' => self::today($c), 'linked' => false];
        }
        $today = self::today($c);
        $from = date('Y-m-d', strtotime($today . ' -14 days'));
        // covers no longer needed (the teacher is back …) go first
        foreach (self::q("SELECT DISTINCT cover_date d FROM ssms_cover_assignments WHERE ssms_client_code = ? AND hold_staff_id = ? AND cover_date >= ? ORDER BY cover_date LIMIT 20",
            [$c, (int)$a['staff_id'], $today]) as $r) {
            self::reconcile(self::ctx($c, substr((string)$r['d'], 0, 10), true));
        }
        $rows = self::q("SELECT ca.*, p.period_number, p.period_name, p.start_time, p.end_time, c.class_name, sec.section_name, sb.subject_name, st.first_name, st.last_name, t.room
                           FROM ssms_cover_assignments ca
                           LEFT JOIN ssms_periods p ON p.period_id = ca.period_id
                           LEFT JOIN ssms_classes c ON c.class_id = ca.class_id
                           LEFT JOIN ssms_sections sec ON sec.section_id = ca.section_id
                           LEFT JOIN ssms_class_subjects cs ON cs.id = ca.class_subject_id
                           LEFT JOIN ssms_subjects sb ON sb.subject_id = cs.subject_id
                           LEFT JOIN ssms_staff st ON st.staff_id = ca.absent_staff_id
                           LEFT JOIN ssms_timetable t ON t.timetable_id = ca.timetable_id
                          WHERE ca.ssms_client_code = ? AND ca.cover_staff_id = ? AND ca.kind = 'cover' AND ca.cover_date >= ?
                          ORDER BY ca.cover_date, p.period_number LIMIT 300", [$c, (int)$a['staff_id'], $from]);
        $now = self::nowLocal($c);
        $out = array_map(function ($r) use ($today, $now) {
            $d = substr((string)$r['cover_date'], 0, 10);
            $started = $d < $today || ($d === $today && self::hm($r['start_time']) !== '' && self::hm($r['start_time']) <= substr($now, 11, 5));

            return ['id' => (int)$r['id'], 'date' => $d, 'period_number' => (int)$r['period_number'], 'period_name' => (string)$r['period_name'],
                    'start' => self::hm($r['start_time']), 'end' => self::hm($r['end_time']),
                    'class_label' => self::label($r['class_name'], $r['section_name']), 'subject' => (string)($r['subject_name'] ?? ''), 'room' => (string)($r['room'] ?? ''),
                    'for' => trim($r['first_name'] . ' ' . $r['last_name']), 'status' => (string)$r['status'], 'note' => (string)($r['note'] ?? ''),
                    'response_note' => (string)($r['response_note'] ?? ''), 'past' => $started];
        }, $rows);

        return ['covers' => $out, 'allow_decline' => (bool)$s['allow_decline'], 'today' => $today, 'linked' => true];
    }

    /** The cover teacher says yes / can't. A "can't" frees the period and tells the office. */
    public static function respond(array $a, int $id, bool $accept, ?string $note = null): array
    {
        $c = $a['client'];
        if (!$a['staff_id']) {
            throw new \DomainException('Your account is not linked to a staff record.');
        }
        $r = self::one("SELECT * FROM ssms_cover_assignments WHERE id = ? AND ssms_client_code = ? AND cover_staff_id = ? AND kind = 'cover'", [$id, $c, (int)$a['staff_id']]);
        if (!$r) {
            throw new \DomainException('This cover period is no longer yours.');
        }
        if ($r['status'] === 'declined') {
            throw new \DomainException('You have already said you cannot take this period.');
        }
        $date = substr((string)$r['cover_date'], 0, 10);
        $p = self::one('SELECT start_time FROM ssms_periods WHERE period_id = ?', [(int)$r['period_id']]);
        $today = self::today($c);
        $started = $date < $today || ($date === $today && $p && self::hm($p['start_time']) <= substr(self::nowLocal($c), 11, 5));
        $note = self::clip($note, 255);
        // the office may have given it to someone else since the list was opened: only change it if it is still this teacher's
        $mine = " WHERE id = ? AND ssms_client_code = ? AND cover_staff_id = ? AND hold_staff_id = ? AND status IN ('assigned','accepted')";
        if ($accept) {
            $n = self::db()->execute("UPDATE ssms_cover_assignments SET status = 'accepted', response_note = ?, responded_at = ?, modified = ?" . $mine,
                [$note, self::now(), self::now(), $id, $c, (int)$a['staff_id'], (int)$a['staff_id']])->rowCount();
            if ($n < 1 && !self::one("SELECT 1 x FROM ssms_cover_assignments WHERE id = ? AND ssms_client_code = ? AND hold_staff_id = ? AND status = 'accepted'", [$id, $c, (int)$a['staff_id']])) {
                throw new \DomainException('This cover period is no longer yours.');
            }

            return ['id' => $id, 'status' => 'accepted'];
        }
        if (!self::settings($c)['allow_decline']) {
            throw new \DomainException('Your school does not allow declining cover. Please speak to the office.');
        }
        if ($started) {
            throw new \DomainException('This period has already started. Please speak to the office.');
        }
        $n = self::db()->execute("UPDATE ssms_cover_assignments SET status = 'declined', hold_staff_id = NULL, response_note = ?, responded_at = ?, modified = ?" . $mine,
            [$note, self::now(), self::now(), $id, $c, (int)$a['staff_id'], (int)$a['staff_id']])->rowCount();
        if ($n < 1) {
            throw new \DomainException('This cover period is no longer yours.');
        }
        try {   // kept for the month report even when the period is given to someone else later
            self::db()->execute('INSERT INTO ssms_cover_declines (ssms_client_code, assignment_id, cover_date, timetable_id, staff_id, note, created) VALUES (?,?,?,?,?,?,?)',
                [$c, $id, $date, (int)$r['timetable_id'], (int)$a['staff_id'], $note, self::now()]);
        } catch (\Throwable $e) {
        }
        self::resetCache();
        $x = self::ctx($c, $date, true);
        $slot = isset($x['slots'][(int)$r['timetable_id']]) ? self::slotView($x, $x['slots'][(int)$r['timetable_id']]) : null;
        $who = $x['staff'][(int)$a['staff_id']]['name'] ?? $a['user'];
        if ($slot) {
            $vars = ['teacher' => $who, 'class' => $slot['class_label'], 'period' => $slot['period_name'] ?: ('#' . $slot['period_number']),
                     'date' => Locale::date($c, $date, 'medium'), 'note' => $note ?? ''];
            Notify::toUsers($c, 'cover-declined:' . $id . ':' . $r['modified'], self::managers($c), fn() => [
                'title' => Locale::t($c, 'Cover declined'),
                'body' => Locale::t($c, '{teacher} cannot take {class}, {period} on {date}. Please choose someone else.', $vars) . ($note ? ' “' . $note . '”' : ''),
            ], ['event' => 'school', 'screen' => 'Cover', 'date' => $date]);
            self::send($c);
        }

        return ['id' => $id, 'status' => 'declined'];
    }

    /** A teacher's real day: own periods (minus those they are away for) plus cover periods. Used for class reminders. */
    public static function myDay(array $a, ?string $date = null): array
    {
        $c = $a['client'];
        $date = self::date($c, $date);
        if (!$a['staff_id']) {
            return ['date' => $date, 'slots' => [], 'linked' => false];
        }
        $me = (int)$a['staff_id'];
        $x = self::ctx($c, $date, true);
        if ($x['school_day'] && $date >= self::today($c) && self::reconcile($x) > 0) {
            $x = self::ctx($c, $date, true);
        }
        $out = [];
        if ($x['school_day']) {
            foreach ($x['slots'] as $tid => $s) {
                if ($s['staff_id'] === $me && !isset($x['needs'][$tid])) {
                    $out[] = self::slotView($x, $s) + ['kind' => 'own'];
                }
            }
        }
        foreach ($x['rows'] as $tid => $r) {
            if ((int)$r['hold_staff_id'] === $me && isset($x['slots'][$tid], $x['needs'][$tid])) {
                $out[] = self::slotView($x, $x['slots'][$tid]) + ['kind' => 'cover', 'cover_id' => (int)$r['id'], 'status' => $r['status'],
                    'for' => $x['staff'][(int)$r['absent_staff_id']]['name'] ?? ''];
            }
        }
        usort($out, fn($l, $r) => $l['period_number'] <=> $r['period_number']);

        return ['date' => $date, 'slots' => $out, 'linked' => true, 'school_day' => $x['school_day'], 'away' => isset($x['absent'][$me])];
    }

    // ── Report ──────────────────────────────────────────────────────────────

    /** Month: per teacher, cover periods taken, periods others covered for them, declines. */
    public static function report(array $a, string $ym): array
    {
        self::need($a, 'edit');   // per-teacher numbers: for the people who arrange cover
        $c = $a['client'];
        if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $ym)) {
            throw new \DomainException('Choose a month.');
        }
        $from = $ym . '-01';
        $to = date('Y-m-t', strtotime($from));
        $staff = self::staffMap($c, true);
        $per = [];
        $row = function (int $sid) use (&$per, $staff) {
            $per[$sid] ??= ['staff_id' => $sid, 'name' => $staff[$sid]['name'] ?? ('#' . $sid), 'covered' => 0, 'covered_for_them' => 0, 'no_cover' => 0, 'declined' => 0];
        };
        $byReason = array_fill_keys(self::REASONS, 0);
        $total = ['cover' => 0, 'free' => 0, 'declined' => 0];
        foreach (self::q("SELECT cover_staff_id, absent_staff_id, kind, status, reason FROM ssms_cover_assignments WHERE ssms_client_code = ? AND cover_date BETWEEN ? AND ?", [$c, $from, $to]) as $r) {
            $ab = (int)$r['absent_staff_id'];
            $row($ab);
            if ($r['status'] === 'declined') {
                continue;   // counted from the declines below (also those given to someone else later)
            }
            if (isset($byReason[$r['reason']])) {
                $byReason[$r['reason']]++;
            }
            if ($r['kind'] === 'free') {
                $total['free']++;
                $per[$ab]['no_cover']++;
            } else {
                $total['cover']++;
                $per[$ab]['covered_for_them']++;
                $row((int)$r['cover_staff_id']);
                $per[(int)$r['cover_staff_id']]['covered']++;
            }
        }
        try {
            foreach (self::q('SELECT staff_id, COUNT(*) n FROM ssms_cover_declines WHERE ssms_client_code = ? AND cover_date BETWEEN ? AND ? GROUP BY staff_id', [$c, $from, $to]) as $r) {
                $row((int)$r['staff_id']);
                $per[(int)$r['staff_id']]['declined'] += (int)$r['n'];
                $total['declined'] += (int)$r['n'];
            }
        } catch (\Throwable $e) {
        }
        $list = array_values($per);
        usort($list, fn($l, $r) => ($r['covered'] <=> $l['covered']) ?: strcmp($l['name'], $r['name']));

        return ['month' => $ym, 'teachers' => $list, 'totals' => $total, 'by_reason' => $byReason];
    }

    // ── Hooks ───────────────────────────────────────────────────────────────

    /**
     * Staff leave approved / rejected / cancelled (called from StaffAttendance::syncLeave).
     * Cancels future covers that are no longer needed and, for an approved leave in the next weeks,
     * tells the office how many periods need cover.
     */
    public static function leaveChanged(string $client, int $applicationId): void
    {
        try {
            $l = self::one('SELECT la.*, st.first_name, st.last_name FROM ssms_leave_applications la JOIN ssms_staff st ON st.staff_id = la.staff_id
                             WHERE la.id = ? AND st.ssms_client_code = ? LIMIT 1', [$applicationId, $client]);
            if (!$l) {
                return;
            }
            $today = self::today($client);
            $from = max($today, substr((string)$l['from_date'], 0, 10));
            $to = min(substr((string)$l['to_date'], 0, 10), date('Y-m-d', strtotime($today . ' +30 days')));
            self::resetCache();
            // every date that already has cover for this teacher (the leave may have moved / got shorter / been cancelled)
            $dates = [];
            foreach (self::q('SELECT DISTINCT cover_date d FROM ssms_cover_assignments WHERE ssms_client_code = ? AND cover_date >= ? AND (leave_application_id = ? OR absent_staff_id = ?)',
                [$client, $today, $applicationId, (int)$l['staff_id']]) as $r) {
                $dates[substr((string)$r['d'], 0, 10)] = false;
            }
            $leaveDays = $from <= $to ? StudentLeave::schoolDays($client, $from, $to)['days'] : [];
            foreach ($leaveDays as $d) {
                $dates[$d] = true;
            }
            ksort($dates);
            $open = 0;
            $first = null;
            foreach ($dates as $d => $count) {
                $x = self::ctx($client, $d, true);
                if ($x['rows'] && self::reconcile($x) > 0) {
                    $x = self::ctx($client, $d, true);
                }
                if (!$count) {
                    continue;
                }
                foreach ($x['needs'] as $tid => $n) {
                    if ($n['staff_id'] === (int)$l['staff_id'] && !isset($x['rows'][$tid])) {
                        $open++;
                        $first ??= $d;
                    }
                }
            }
            if (strtolower((string)$l['status']) === 'approved' && $open > 0) {
                $vars = ['teacher' => trim($l['first_name'] . ' ' . $l['last_name']), 'n' => $open,
                         'dates' => $l['from_date'] === $l['to_date'] ? Locale::date($client, $l['from_date'], 'medium')
                             : Locale::date($client, $l['from_date'], 'medium') . ' – ' . Locale::date($client, $l['to_date'], 'medium')];
                Notify::toUsers($client, 'cover-leave:' . $applicationId . ':' . substr(sha1((string)$l['approved_at'] . $l['from_date'] . $l['to_date']), 0, 10),
                    self::managers($client), fn() => ['title' => Locale::t($client, 'Cover needed'),
                        'body' => Locale::t($client, '{teacher} is on leave ({dates}): {n} periods need a cover teacher.', $vars)],
                    ['event' => 'school', 'screen' => 'Cover', 'date' => $first]);
                self::send($client);
            }
        } catch (\Throwable $e) {
            Log::warning("Cover leaveChanged #{$applicationId}: " . $e->getMessage());
        }
    }

    /** Staff attendance saved for a day (marked present again, checked in …): drop covers no longer needed. */
    public static function attendanceChanged(string $client, string $date): void
    {
        try {
            if ($date < self::today($client)) {
                return;
            }
            self::resetCache();
            $x = self::ctx($client, $date, true);
            if ($x['rows']) {
                self::reconcile($x);
            }
        } catch (\Throwable $e) {
            if (!str_contains($e->getMessage(), "doesn't exist")) {
                Log::warning("Cover attendanceChanged {$client} {$date}: " . $e->getMessage());
            }
        }
    }

    /** Once a school day, after the school's time: tell the office how many periods still have no cover. */
    public static function morningAlert(string $client): void
    {
        try {
            $s = self::settings($client);
            if (!$s['alert_on']) {
                return;
            }
            $now = self::nowLocal($client);
            $today = substr($now, 0, 10);
            if (substr($now, 11, 5) < $s['alert_time']) {
                return;
            }
            $db = self::db();
            $db->execute('INSERT IGNORE INTO ssms_cover_settings (ssms_client_code) VALUES (?)', [$client]);
            if ($db->execute('UPDATE ssms_cover_settings SET alerted_on = ? WHERE ssms_client_code = ? AND (alerted_on IS NULL OR alerted_on < ?)', [$today, $client, $today])->rowCount() < 1) {
                return;   // already done today (or another worker is doing it)
            }
            $x = self::ctx($client, $today, true);
            if (!$x['school_day']) {
                return;
            }
            if ($x['rows'] && self::reconcile($x) > 0) {
                $x = self::ctx($client, $today, true);
            }
            if (!$x['needs']) {
                return;
            }
            $open = self::summary($x)['open'];
            if ($open < 1) {
                return;
            }
            Notify::toUsers($client, 'cover-open:' . $today, self::managers($client), fn() => [
                'title' => Locale::t($client, 'Periods need cover today'),
                'body' => Locale::t($client, '{n} periods today still have no cover teacher.', ['n' => $open]),
            ], ['event' => 'school', 'screen' => 'Cover', 'date' => $today]);
        } catch (\Throwable $e) {
            if (!str_contains($e->getMessage(), "doesn't exist")) {   // before the migration: stay quiet
                Log::warning("Cover morningAlert {$client}: " . $e->getMessage());
            }
        }
    }

    // ── Engine ──────────────────────────────────────────────────────────────

    /**
     * Everything for one date, loaded once:
     *   slots   – the timetable that weekday (one per class / section / period; branch rows win over old rows without a branch)
     *   absent  – staff_id → reasons [type, label, periods (null = all day) …]
     *   needs   – timetable_id → [staff_id, reason] for periods whose teacher is away
     *   rows    – timetable_id → stored cover decision
     */
    private static function ctx(string $c, string $date, bool $fresh = false): array
    {
        $key = $c . '|' . $date;
        if (!$fresh && isset(self::$cache[$key])) {
            return self::$cache[$key];
        }
        $periods = [];
        foreach (self::q('SELECT period_id, period_number, period_name, start_time, end_time, is_break FROM ssms_periods WHERE ssms_client_code = ? ORDER BY period_number', [$c]) as $p) {
            $p['period_id'] = (int)$p['period_id'];
            $p['period_number'] = (int)$p['period_number'];
            $p['is_break'] = (int)$p['is_break'] === 1;
            $periods[$p['period_id']] = $p;
        }
        $sd = StudentLeave::schoolDays($c, $date, $date);
        $schoolDay = (bool)$sd['days'];
        $off = $schoolDay ? null : ($sd['skipped'][0] ?? null);
        $session = self::session($c);
        $staff = self::staffMap($c);
        $x = ['client' => $c, 'date' => $date, 'periods' => $periods, 'school_day' => $schoolDay, 'off' => $off, 'session_id' => $session,
              'staff' => $staff, 'slots' => [], 'absent' => [], 'needs' => [], 'rows' => [], 'pending' => [], 'away' => [],
              'mid' => self::midday($c, $periods), 'teaching' => [], 'hold' => []];
        // timetable that weekday
        $dow = (int)date('N', strtotime($date));
        $days = $dow === 7 ? [7, 0] : [$dow];
        if ($session !== null) {
            $best = [];
            foreach (self::q('SELECT t.timetable_id, t.class_id, t.section_id, t.branch_id, t.period_id, t.class_subject_id, t.staff_id, t.room,
                                     cs.subject_id, sb.subject_name, c.class_name, sec.section_name, sec.staff_id class_teacher
                                FROM ssms_timetable t
                                LEFT JOIN ssms_class_subjects cs ON cs.id = t.class_subject_id
                                LEFT JOIN ssms_subjects sb ON sb.subject_id = cs.subject_id
                                LEFT JOIN ssms_classes c ON c.class_id = t.class_id
                                LEFT JOIN ssms_sections sec ON sec.section_id = t.section_id
                               WHERE t.ssms_client_code = ? AND t.session_id = ? AND t.day_of_week IN (' . implode(',', $days) . ')', [$c, $session]) as $t) {
                $pid = (int)$t['period_id'];
                if (!isset($periods[$pid]) || $periods[$pid]['is_break']) {
                    continue;
                }
                $k = (int)$t['class_id'] . '|' . (int)$t['section_id'] . '|' . $pid;
                $hasBranch = (int)$t['branch_id'] > 0;
                if (isset($best[$k]) && (int)$best[$k]['branch_id'] > 0 && !$hasBranch) {
                    continue;   // the branch's own row wins over an old row without a branch
                }
                $best[$k] = $t;
            }
            foreach ($best as $t) {
                if (!(int)$t['staff_id']) {
                    continue;
                }
                $pid = (int)$t['period_id'];
                $tid = (int)$t['timetable_id'];
                $x['slots'][$tid] = ['timetable_id' => $tid, 'class_id' => (int)$t['class_id'], 'section_id' => $t['section_id'] !== null ? (int)$t['section_id'] : null,
                    'branch_id' => (int)$t['branch_id'] ?: null, 'period_id' => $pid, 'period_number' => $periods[$pid]['period_number'],
                    'class_subject_id' => $t['class_subject_id'] !== null ? (int)$t['class_subject_id'] : null, 'subject_id' => $t['subject_id'] !== null ? (int)$t['subject_id'] : null,
                    'subject' => (string)($t['subject_name'] ?? ''), 'class_label' => self::label($t['class_name'], $t['section_name']),
                    'class_teacher' => (int)$t['class_teacher'] ?: null, 'staff_id' => (int)$t['staff_id'], 'room' => (string)($t['room'] ?? '')];
                $x['teaching'][(int)$t['staff_id']][$pid] = $tid;
            }
        }
        // who is away
        $all = null;
        $add = function (int $sid, array $r) use (&$x) {
            $x['absent'][$sid][] = $r;
        };
        $leaveIds = [];
        foreach (self::q("SELECT la.id, la.staff_id, la.from_date, la.to_date, la.is_half_day, la.half_day_slot, la.status, lt.name type_name
                            FROM ssms_leave_applications la JOIN ssms_staff st ON st.staff_id = la.staff_id AND st.ssms_client_code = ?
                            LEFT JOIN ssms_leave_types lt ON lt.id = la.leave_type_id
                           WHERE LOWER(la.status) IN ('approved','approve','pending') AND la.from_date <= ? AND la.to_date >= ?", [$c, $date, $date]) as $l) {
            $sid = (int)$l['staff_id'];
            if (strtolower((string)$l['status']) === 'pending') {
                $x['pending'][] = ['leave_id' => (int)$l['id'], 'staff_id' => $sid, 'name' => $staff[$sid]['name'] ?? ('#' . $sid),
                    'from' => substr((string)$l['from_date'], 0, 10), 'to' => substr((string)$l['to_date'], 0, 10), 'type' => (string)($l['type_name'] ?? '')];
                continue;
            }
            $half = (int)$l['is_half_day'] === 1 ? strtolower((string)$l['half_day_slot']) : '';
            $add($sid, ['type' => 'leave', 'leave_id' => (int)$l['id'], 'label' => (string)($l['type_name'] ?? ''), 'half' => in_array($half, ['morning', 'afternoon'], true) ? $half : null,
                'periods' => self::halfPeriods($x, $half)]);
            $leaveIds[(int)$l['id']] = true;
        }
        try {
            foreach (self::q("SELECT staff_id, status, leave_application_id FROM ssms_staff_attendance WHERE ssms_client_code = ? AND att_date = ? AND status IN ('A','L')", [$c, $date]) as $r) {
                if ($r['status'] === 'L' && $r['leave_application_id'] && isset($leaveIds[(int)$r['leave_application_id']])) {
                    continue;   // the leave itself is already counted (with its half day)
                }
                if ($r['status'] === 'L' && $r['leave_application_id']) {
                    continue;   // marked by a leave that is no longer approved – syncLeave puts it right
                }
                $add((int)$r['staff_id'], ['type' => $r['status'] === 'A' ? 'absent' : 'leave', 'label' => '', 'half' => null, 'periods' => $all]);
            }
        } catch (\Throwable $e) {
        }
        foreach (self::q('SELECT id, staff_id, from_period, to_period, reason FROM ssms_cover_absences WHERE ssms_client_code = ? AND absent_date = ? ORDER BY id', [$c, $date]) as $w) {
            $ps = null;
            if ($w['from_period'] !== null) {
                $ps = [];
                foreach ($periods as $p) {
                    if ($p['period_number'] >= (int)$w['from_period'] && $p['period_number'] <= (int)$w['to_period']) {
                        $ps[$p['period_id']] = true;
                    }
                }
            }
            $add((int)$w['staff_id'], ['type' => 'away', 'away_id' => (int)$w['id'], 'label' => (string)($w['reason'] ?? ''), 'half' => null, 'periods' => $ps,
                'from_period' => $w['from_period'] !== null ? (int)$w['from_period'] : null, 'to_period' => $w['to_period'] !== null ? (int)$w['to_period'] : null]);
            $x['away'][] = ['id' => (int)$w['id'], 'staff_id' => (int)$w['staff_id'], 'from_period' => $w['from_period'] !== null ? (int)$w['from_period'] : null,
                'to_period' => $w['to_period'] !== null ? (int)$w['to_period'] : null, 'reason' => (string)($w['reason'] ?? '')];
        }
        try {
            $duty = [];
            foreach (self::q('SELECT d.staff_id, p.start_time, p.end_time, h.name hall FROM ssms_exam_duties d JOIN ssms_exam_seat_plans p ON p.plan_id = d.plan_id
                               LEFT JOIN ssms_exam_halls h ON h.hall_id = d.hall_id WHERE d.ssms_client_code = ? AND p.exam_date = ?', [$c, $date]) as $d) {
                [$s0, $e0] = self::window($d['start_time'], $d['end_time']);
                foreach ($periods as $p) {
                    if ($p['is_break']) {
                        continue;
                    }
                    [$s1, $e1] = self::window(self::hm($p['start_time']), self::hm($p['end_time']));
                    if ($s1 < $e0 && $s0 < $e1) {
                        $duty[(int)$d['staff_id']]['periods'][$p['period_id']] = true;
                        $duty[(int)$d['staff_id']]['hall'] = (string)($d['hall'] ?? '');
                    }
                }
            }
            foreach ($duty as $sid => $d) {
                $add($sid, ['type' => 'exam_duty', 'label' => $d['hall'], 'half' => null, 'periods' => $d['periods']]);
            }
        } catch (\Throwable $e) {
            // exam logistics not installed
        }
        // periods that need cover
        if ($schoolDay) {
            foreach ($x['slots'] as $tid => $s) {
                $why = self::awayAt($x, $s['staff_id'], $s['period_id']);
                if ($why !== null) {
                    $x['needs'][$tid] = ['staff_id' => $s['staff_id'], 'reason' => $why['type'], 'leave_id' => $why['leave_id'] ?? null];
                }
            }
        }
        foreach (self::q('SELECT * FROM ssms_cover_assignments WHERE ssms_client_code = ? AND cover_date = ?', [$c, $date]) as $r) {
            $x['rows'][(int)$r['timetable_id']] = $r;
            if ($r['hold_staff_id']) {
                $x['hold'][(int)$r['hold_staff_id']][(int)$r['period_id']] = (int)$r['timetable_id'];
            }
        }
        // loads for fairness
        $x['day_load'] = [];
        $x['week_load'] = [];
        $x['month_load'] = [];
        foreach ($x['hold'] as $sid => $ps) {
            $x['day_load'][$sid] = count($ps);
        }
        $mon = date('Y-m-d', strtotime($date . ' -' . ($dow - 1) . ' days'));
        $sun = date('Y-m-d', strtotime($mon . ' +6 days'));
        foreach (self::q("SELECT hold_staff_id s, COUNT(*) n FROM ssms_cover_assignments WHERE ssms_client_code = ? AND hold_staff_id IS NOT NULL AND cover_date BETWEEN ? AND ? GROUP BY hold_staff_id", [$c, $mon, $sun]) as $r) {
            $x['week_load'][(int)$r['s']] = (int)$r['n'];
        }
        foreach (self::q("SELECT hold_staff_id s, COUNT(*) n FROM ssms_cover_assignments WHERE ssms_client_code = ? AND hold_staff_id IS NOT NULL AND cover_date BETWEEN ? AND ? GROUP BY hold_staff_id",
            [$c, substr($date, 0, 8) . '01', date('Y-m-t', strtotime($date))]) as $r) {
            $x['month_load'][(int)$r['s']] = (int)$r['n'];
        }

        return self::$cache[$key] = $x;
    }

    /** Why staff member $sid is away at a period (first matching reason), or null. */
    private static function awayAt(array $x, int $sid, int $pid): ?array
    {
        foreach ($x['absent'][$sid] ?? [] as $r) {
            if ($r['periods'] === null || isset($r['periods'][$pid])) {
                return $r;
            }
        }

        return null;
    }

    /** Periods of a half day: morning = periods starting before the middle of the school day. null = whole day. */
    private static function halfPeriods(array $x, string $half): ?array
    {
        if (!in_array($half, ['morning', 'afternoon'], true) || $x['mid'] === null) {
            return null;
        }
        $out = [];
        foreach ($x['periods'] as $p) {
            $s = self::minutes(self::hm($p['start_time']));
            if ($s === null) {
                continue;
            }
            if (($half === 'morning') === ($s < $x['mid'])) {
                $out[$p['period_id']] = true;
            }
        }

        return $out;
    }

    private static function midday(string $c, array $periods): ?int
    {
        $s = null;
        $e = null;
        foreach ($periods as $p) {
            $a = self::minutes(self::hm($p['start_time']));
            $b = self::minutes(self::hm($p['end_time']));
            if ($a !== null) {
                $s = $s === null ? $a : min($s, $a);
            }
            if ($b !== null) {
                $e = $e === null ? $b : max($e, $b);
            }
        }
        if ($s === null || $e === null || $e <= $s) {
            try {
                $r = self::one('SELECT school_start_time, school_end_time FROM ssms_school_settings WHERE client_code = ?', [$c]);
                $s = self::minutes(self::hm($r['school_start_time'] ?? ''));
                $e = self::minutes(self::hm($r['school_end_time'] ?? ''));
            } catch (\Throwable $ex) {
            }
        }

        return $s !== null && $e !== null && $e > $s ? intdiv($s + $e, 2) : null;
    }

    /**
     * Rank everyone for one period. free = can take it (best first), busy = cannot (and why).
     * Score: same subject +30, teaches this class +20, class teacher +15, same branch +10,
     * −15 per cover that day, −5 per cover that week, −3 per period taught that day; no timetable at all −10.
     */
    private static function rank(array &$x, array $slot): array
    {
        $c = $x['client'];
        $know = self::knowledge($c, $x['session_id']);
        $s = self::settings($c);
        $pid = $slot['period_id'];
        $declined = [];
        $row = $x['rows'][$slot['timetable_id']] ?? null;
        if ($row && $row['status'] === 'declined' && $row['cover_staff_id']) {
            $declined[(int)$row['cover_staff_id']] = true;
        }
        $free = [];
        $busy = [];
        foreach ($x['staff'] as $sid => $st) {
            if ($sid === $slot['staff_id']) {
                continue;
            }
            if ($slot['branch_id'] && $st['branch_id'] && $st['branch_id'] !== $slot['branch_id']) {
                continue;   // another branch / campus
            }
            $why = null;
            if (($a = self::awayAt($x, $sid, $pid)) !== null) {
                $why = ['why' => $a['type'], 'detail' => $a['label'] ?? ''];
            } elseif (isset($x['hold'][$sid][$pid]) && $x['hold'][$sid][$pid] !== $slot['timetable_id']) {
                $other = $x['slots'][$x['hold'][$sid][$pid]] ?? null;
                $why = ['why' => 'covering', 'detail' => $other['class_label'] ?? ''];
            } elseif (isset($x['teaching'][$sid][$pid]) && !isset($x['needs'][$x['teaching'][$sid][$pid]])) {
                $why = ['why' => 'teaching', 'detail' => $x['slots'][$x['teaching'][$sid][$pid]]['class_label'] ?? ''];
            } elseif (isset($declined[$sid])) {
                $why = ['why' => 'declined', 'detail' => ''];
            }
            if ($why) {
                $busy[] = ['staff_id' => $sid, 'name' => $st['name']] + $why;
                continue;
            }
            $score = 0;
            $reasons = [];
            $k = $know[$sid] ?? ['subjects' => [], 'classes' => [], 'any' => false];
            if ($slot['subject_id'] && isset($k['subjects'][$slot['subject_id']])) {
                $score += 30;
                $reasons[] = ['code' => 'same_subject', 'subject' => $slot['subject']];
            }
            if (isset($k['classes'][$slot['class_id'] . '|' . (int)$slot['section_id']])) {
                $score += 20;
                $reasons[] = ['code' => 'teaches_class'];
            }
            if ($slot['class_teacher'] === $sid) {
                $score += 15;
                $reasons[] = ['code' => 'class_teacher'];
            }
            if ($slot['branch_id'] && $st['branch_id'] === $slot['branch_id']) {
                $score += 10;
                $reasons[] = ['code' => 'same_branch'];
            }
            $day = $x['day_load'][$sid] ?? 0;
            $week = $x['week_load'][$sid] ?? 0;
            if ($row && (int)$row['hold_staff_id'] === $sid) {
                $day = max(0, $day - 1);   // this very period is already theirs: not one more
                $week = max(0, $week - 1);
            }
            $teach = count(array_filter(array_keys($x['teaching'][$sid] ?? []), fn($p) => self::awayAt($x, $sid, $p) === null));
            if (!$k['any'] && !$teach) {
                $score -= 10;
                $reasons[] = ['code' => 'no_timetable'];
            }
            $score -= 15 * $day + 5 * $week + 3 * $teach;
            $reasons[] = ['code' => 'load', 'today' => $day, 'week' => $week, 'teaching' => $teach];
            $over = null;
            if ($s['max_per_day'] > 0 && $day >= $s['max_per_day']) {
                $over = ['n' => $day, 'limit' => $s['max_per_day'], 'per' => 'day'];
            } elseif ($s['max_per_week'] > 0 && $week >= $s['max_per_week']) {
                $over = ['n' => $week, 'limit' => $s['max_per_week'], 'per' => 'week'];
            }
            $free[] = ['staff_id' => $sid, 'name' => $st['name'], 'score' => $score, 'reasons' => $reasons, 'today' => $day, 'week' => $week,
                       'teaching_today' => $teach, 'month' => $x['month_load'][$sid] ?? 0, 'over_limit' => $over];
        }
        usort($free, fn($l, $r) => ((bool)$l['over_limit'] <=> (bool)$r['over_limit']) ?: ($r['score'] <=> $l['score']) ?: ($l['month'] <=> $r['month']) ?: strcmp($l['name'], $r['name']));
        usort($busy, fn($l, $r) => strcmp($l['name'], $r['name']));

        return ['free' => $free, 'busy' => $busy];
    }

    /** What each teacher teaches this session: subjects, class|section (timetable + Subject Teachers). */
    private static function knowledge(string $c, ?int $session): array
    {
        $key = 'know|' . $c . '|' . $session;
        if (isset(self::$cache[$key])) {
            return self::$cache[$key];
        }
        $k = [];
        if ($session !== null) {
            foreach (self::q('SELECT DISTINCT t.staff_id, cs.subject_id, t.class_id, t.section_id FROM ssms_timetable t LEFT JOIN ssms_class_subjects cs ON cs.id = t.class_subject_id
                               WHERE t.ssms_client_code = ? AND t.session_id = ? AND t.staff_id IS NOT NULL', [$c, $session]) as $r) {
                $sid = (int)$r['staff_id'];
                $k[$sid]['any'] = true;
                if ($r['subject_id']) {
                    $k[$sid]['subjects'][(int)$r['subject_id']] = true;
                }
                $k[$sid]['classes'][(int)$r['class_id'] . '|' . (int)$r['section_id']] = true;
            }
        }
        try {
            foreach (self::q('SELECT staff_id, subject_id, class_id, section_id FROM ssms_subject_teacher WHERE ssms_client_code = ? AND staff_id IS NOT NULL', [$c]) as $r) {
                $sid = (int)$r['staff_id'];
                $k[$sid]['any'] ??= false;
                if ($r['subject_id']) {
                    $k[$sid]['subjects'][(int)$r['subject_id']] = true;
                }
                $k[$sid]['classes'][(int)$r['class_id'] . '|' . (int)$r['section_id']] = true;
            }
        } catch (\Throwable $e) {
        }
        foreach ($k as &$v) {
            $v += ['subjects' => [], 'classes' => [], 'any' => false];
        }
        unset($v);

        return self::$cache[$key] = $k;
    }

    /** Store one decision; returns the messages to send. */
    private static function write(array &$x, array $slot, ?int $staffId, ?string $note, string $by, bool $quiet = false): array
    {
        $c = $x['client'];
        $tid = $slot['timetable_id'];
        $old = $x['rows'][$tid] ?? null;
        $n = $x['needs'][$tid];
        $now = self::now();
        $msgs = [];
        if ($old && $old['hold_staff_id'] && (int)$old['hold_staff_id'] !== (int)$staffId) {
            $msgs[] = ['to' => (int)$old['hold_staff_id'], 'type' => 'cancel', 'slot' => self::slotView($x, $slot), 'date' => $x['date'], 'id' => (int)$old['id']];
        }
        $same = $old && $old['hold_staff_id'] && (int)$old['hold_staff_id'] === (int)$staffId;
        $vals = [$slot['period_id'], $slot['class_id'], $slot['section_id'], $slot['branch_id'], $slot['class_subject_id'], $n['staff_id'], $staffId, $staffId,
                 $staffId ? 'cover' : 'free', $n['reason'], $n['leave_id'], $note, $by];
        try {
            if ($old) {
                // keep the answer when only the note changes; a new teacher starts again at "assigned"
                self::db()->execute('UPDATE ssms_cover_assignments SET period_id = ?, class_id = ?, section_id = ?, branch_id = ?, class_subject_id = ?, absent_staff_id = ?,
                        cover_staff_id = ?, hold_staff_id = ?, kind = ?, reason = ?, leave_application_id = ?, note = ?, assigned_by = ?, modified = ?'
                        . ($same ? '' : ", status = 'assigned', response_note = NULL, responded_at = NULL") . ' WHERE id = ?',
                    array_merge($vals, [$now, (int)$old['id']]));
            } else {
                self::db()->execute("INSERT INTO ssms_cover_assignments (period_id, class_id, section_id, branch_id, class_subject_id, absent_staff_id, cover_staff_id, hold_staff_id,
                        kind, reason, leave_application_id, note, assigned_by, ssms_client_code, cover_date, timetable_id, status, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'assigned',?,?)", array_merge($vals, [$c, $x['date'], $tid, $now, $now]));
            }
        } catch (\Throwable $e) {
            if (str_contains($e->getMessage(), 'Duplicate entry') || str_contains($e->getMessage(), '1062')) {
                self::resetCache();
                throw new \DomainException(str_contains($e->getMessage(), 'uq_cover_teacher')
                    ? 'This teacher was just given another class at the same time. Refresh and choose again.'
                    : 'Someone else just arranged this period. Refresh and try again.');
            }
            throw $e;
        }
        $row = self::one('SELECT * FROM ssms_cover_assignments WHERE ssms_client_code = ? AND cover_date = ? AND timetable_id = ?', [$c, $x['date'], $tid]);
        if ($old && $old['hold_staff_id']) {
            unset($x['hold'][(int)$old['hold_staff_id']][$slot['period_id']]);
            $x['day_load'][(int)$old['hold_staff_id']] = max(0, ($x['day_load'][(int)$old['hold_staff_id']] ?? 1) - 1);
            $x['week_load'][(int)$old['hold_staff_id']] = max(0, ($x['week_load'][(int)$old['hold_staff_id']] ?? 1) - 1);
        }
        $x['rows'][$tid] = $row;
        if ($staffId) {
            self::hold($x, $slot, $staffId);
            if (!$same) {
                $msgs[] = ['to' => $staffId, 'type' => 'assign', 'slot' => self::slotView($x, $slot), 'date' => $x['date'], 'id' => (int)$row['id'],
                           'for' => $x['staff'][$n['staff_id']]['name'] ?? '', 'note' => $note];
            }
        }
        self::$cache[$c . '|' . $x['date']] = $x;

        return $msgs;
    }

    private static function hold(array &$x, array $slot, int $staffId): void
    {
        $x['hold'][$staffId][$slot['period_id']] = $slot['timetable_id'];
        $x['day_load'][$staffId] = ($x['day_load'][$staffId] ?? 0) + 1;
        $x['week_load'][$staffId] = ($x['week_load'][$staffId] ?? 0) + 1;
        $x['month_load'][$staffId] = ($x['month_load'][$staffId] ?? 0) + 1;
    }

    /**
     * Covers that are no longer needed (the teacher is back, the timetable changed) are removed for periods
     * that have not started yet, and the cover teacher is told. Returns how many were removed.
     */
    private static function reconcile(array $x): int
    {
        if (!$x['school_day']) {
            return 0;   // never wipe a day's covers because it (perhaps by mistake) shows as a holiday / weekend
        }
        $c = $x['client'];
        $today = self::today($c);
        $nowHm = substr(self::nowLocal($c), 11, 5);
        $msgs = [];
        $gone = 0;
        foreach ($x['rows'] as $tid => $r) {
            if (isset($x['needs'][$tid])) {
                if ((int)$r['absent_staff_id'] !== $x['needs'][$tid]['staff_id'] || (string)$r['reason'] !== $x['needs'][$tid]['reason']) {
                    self::db()->execute('UPDATE ssms_cover_assignments SET absent_staff_id = ?, reason = ?, leave_application_id = ?, modified = ? WHERE id = ?',
                        [$x['needs'][$tid]['staff_id'], $x['needs'][$tid]['reason'], $x['needs'][$tid]['leave_id'], self::now(), (int)$r['id']]);
                }
                continue;
            }
            $p = $x['periods'][(int)$r['period_id']] ?? null;
            if ($x['date'] < $today || ($x['date'] === $today && $p && self::hm($p['start_time']) !== '' && self::hm($p['start_time']) <= $nowHm)) {
                continue;   // already started: keep it as a record
            }
            self::db()->execute('DELETE FROM ssms_cover_assignments WHERE id = ?', [(int)$r['id']]);
            $gone++;
            if ($r['hold_staff_id']) {
                $slot = isset($x['slots'][$tid]) ? self::slotView($x, $x['slots'][$tid]) : self::storedSlot($x, $r);
                $msgs[] = ['to' => (int)$r['hold_staff_id'], 'type' => 'cancel', 'slot' => $slot, 'date' => $x['date'], 'id' => (int)$r['id']];
            }
        }
        if ($gone) {
            self::resetCache();
            self::flush($c, $msgs);
        }

        return $gone;
    }

    /** Bell + push to cover teachers: one message per teacher (several periods are listed together). */
    private static function flush(string $c, array $msgs): void
    {
        if (!$msgs) {
            return;
        }
        $s = self::settings($c);
        if (!$s['notify_teacher']) {
            return;   // the school tells cover teachers itself
        }
        $today = self::today($c);
        $nowHm = substr(self::nowLocal($c), 11, 5);
        $by = [];
        foreach ($msgs as $m) {
            if ($m['date'] < $today || ($m['date'] === $today && $m['slot']['start'] !== '' && $m['slot']['start'] <= $nowHm)) {
                continue;   // a record for a period already started / past: nobody needs to be told
            }
            $by[$m['to'] . '|' . $m['type'] . '|' . $m['date']][] = $m;
        }
        foreach ($by as $list) {
            $to = $list[0]['to'];
            $users = self::usersOfStaff($c, $to);
            if (!$users) {
                continue;
            }
            $type = $list[0]['type'];
            $date = $list[0]['date'];
            $ref = 'cover-' . $type . ':' . $date . ':' . $to . ':' . substr(sha1(self::now() . json_encode($list)), 0, 16);
            usort($list, fn($l, $r) => $l['slot']['period_number'] <=> $r['slot']['period_number']);
            Notify::toUsers($c, $ref, $users, function () use ($c, $list, $type, $date) {
                $per = fn($m) => trim(($m['slot']['period_name'] ?: ('#' . $m['slot']['period_number'])) . ($m['slot']['start'] ? ' (' . Locale::time($c, $m['slot']['start']) . ')' : ''));
                $cls = fn($m) => trim($m['slot']['class_label'] . ($m['slot']['subject'] ? ' – ' . $m['slot']['subject'] : ''));
                $lines = array_map(fn($m) => $per($m) . ': ' . $cls($m), $list);
                $d = Locale::date($c, $date, 'long');
                if ($type === 'cancel') {
                    return ['title' => Locale::t($c, 'Cover cancelled'),
                            'body' => Locale::t($c, 'You are no longer needed for cover on {date}:', ['date' => $d]) . ' ' . implode('; ', $lines) . '.'];
                }
                $for = $list[0]['for'] ?? '';
                $body = count($list) === 1
                    ? Locale::t($c, 'Please cover {class} on {date}, {period}{for}.', ['class' => $cls($list[0]),
                        'date' => $d, 'period' => $per($list[0]), 'for' => $for !== '' ? ' ' . Locale::t($c, '(for {teacher})', ['teacher' => $for]) : ''])
                    : Locale::t($c, 'You have {n} cover periods on {date}:', ['n' => count($list), 'date' => $d]) . ' ' . implode('; ', $lines) . '.';
                if (count($list) === 1 && !empty($list[0]['note'])) {
                    $body .= ' “' . $list[0]['note'] . '”';
                }

                return ['title' => Locale::t($c, 'Cover period'), 'body' => $body];
            }, ['event' => 'school', 'screen' => 'MyCovers', 'date' => $date]);
        }
        self::send($c);
    }

    private static function send(string $c): void
    {
        if (!self::$sendNow) {
            return;
        }
        try {
            Notify::pushNow($c);
        } catch (\Throwable $e) {
            Log::warning('Cover send: ' . $e->getMessage());
        }
    }

    // ── Views ───────────────────────────────────────────────────────────────

    private static function slotView(array $x, array $s): array
    {
        $p = $x['periods'][$s['period_id']] ?? null;

        return ['timetable_id' => $s['timetable_id'], 'period_id' => $s['period_id'], 'period_number' => $s['period_number'],
                'period_name' => (string)($p['period_name'] ?? ''), 'start' => self::hm($p['start_time'] ?? ''), 'end' => self::hm($p['end_time'] ?? ''),
                'class_id' => $s['class_id'], 'section_id' => $s['section_id'], 'class_label' => $s['class_label'], 'subject' => $s['subject'], 'room' => $s['room'],
                'branch_id' => $s['branch_id'], 'teacher_id' => $s['staff_id'], 'teacher' => $x['staff'][$s['staff_id']]['name'] ?? ''];
    }

    /** A stored row whose timetable slot is gone (for the "cancelled" message). */
    private static function storedSlot(array $x, array $r): array
    {
        $p = $x['periods'][(int)$r['period_id']] ?? null;
        $cl = self::one('SELECT c.class_name, s.section_name FROM ssms_classes c LEFT JOIN ssms_sections s ON s.section_id = ? WHERE c.class_id = ?', [(int)$r['section_id'], (int)$r['class_id']]);

        return ['timetable_id' => (int)$r['timetable_id'], 'period_id' => (int)$r['period_id'], 'period_number' => (int)($p['period_number'] ?? 0),
                'period_name' => (string)($p['period_name'] ?? ''), 'start' => self::hm($p['start_time'] ?? ''), 'end' => self::hm($p['end_time'] ?? ''),
                'class_label' => self::label($cl['class_name'] ?? '', $cl['section_name'] ?? ''), 'subject' => '', 'room' => ''];
    }

    private static function rowView(array $x, array $r): array
    {
        $cs = $r['cover_staff_id'] ? (int)$r['cover_staff_id'] : null;
        $conflict = self::conflict($x, $r);

        return ['id' => (int)$r['id'], 'kind' => (string)$r['kind'], 'status' => (string)$r['status'], 'staff_id' => $cs,
                'name' => $cs ? ($x['staff'][$cs]['name'] ?? self::staffName($x['client'], $cs)) : '', 'note' => (string)($r['note'] ?? ''),
                'response_note' => (string)($r['response_note'] ?? ''), 'responded_at' => $r['responded_at'], 'assigned_by' => (string)($r['assigned_by'] ?? ''),
                'conflict' => $conflict];
    }

    private static function summary(array $x): array
    {
        $o = ['periods' => count($x['needs']), 'covered' => 0, 'free' => 0, 'open' => 0];
        foreach (array_keys($x['needs']) as $tid) {
            $o[self::state($x, $tid)]++;
        }

        return $o;
    }

    /** open = nobody (or declined, or the cover teacher is now away / teaching then), free = "no cover", covered. */
    private static function state(array $x, int $tid): string
    {
        $r = $x['rows'][$tid] ?? null;
        if (!$r || $r['status'] === 'declined') {
            return 'open';
        }
        if ($r['kind'] === 'free') {
            return 'free';
        }

        return self::conflict($x, $r) ? 'open' : 'covered';
    }

    /** The cover teacher can no longer take it: away themselves, or now teaching their own class then. */
    private static function conflict(array $x, array $r): ?array
    {
        $cs = $r['hold_staff_id'] ? (int)$r['hold_staff_id'] : null;
        if (!$cs) {
            return null;
        }
        $pid = (int)$r['period_id'];
        if (($a = self::awayAt($x, $cs, $pid)) !== null) {
            return ['why' => $a['type'], 'detail' => ''];
        }
        if (isset($x['teaching'][$cs][$pid]) && !isset($x['needs'][$x['teaching'][$cs][$pid]])) {
            return ['why' => 'teaching', 'detail' => $x['slots'][$x['teaching'][$cs][$pid]]['class_label'] ?? ''];
        }

        return null;
    }

    private static function whyText(string $c, array $b): string
    {
        $d = (string)($b['detail'] ?? '');

        return match ($b['why']) {
            'teaching' => Locale::t($c, 'teaching {class}', ['class' => $d]),
            'covering' => Locale::t($c, 'already covering {class}', ['class' => $d]),
            'leave' => Locale::t($c, 'on leave'),
            'absent' => Locale::t($c, 'absent'),
            'away' => Locale::t($c, 'away') . ($d !== '' ? ' (' . $d . ')' : ''),
            'exam_duty' => Locale::t($c, 'on exam duty') . ($d !== '' ? ' (' . $d . ')' : ''),
            'declined' => Locale::t($c, 'said they cannot take it'),
            default => (string)$b['why'],
        };
    }

    // ── Look-ups ────────────────────────────────────────────────────────────

    /** Active staff of the school: staff_id → [staff_id, name, branch_id]. $all includes those who left (for reports). */
    private static function staffMap(string $c, bool $all = false): array
    {
        $key = 'staff|' . $c . '|' . (int)$all;
        if (isset(self::$cache[$key])) {
            return self::$cache[$key];
        }
        $sql = 'SELECT staff_id, first_name, last_name, branch_id FROM ssms_staff WHERE ssms_client_code = ?';
        if (!$all) {
            $sql .= " AND COALESCE(hired, 'Y') IN ('Y','Yes','yes','1','y') AND LOWER(TRIM(COALESCE(resigned, 'N'))) IN ('n','no','0','')";
        }
        $out = [];
        foreach (self::q($sql . ' ORDER BY first_name, last_name', [$c]) as $r) {
            $out[(int)$r['staff_id']] = ['staff_id' => (int)$r['staff_id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name']), 'branch_id' => (int)$r['branch_id'] ?: null];
        }

        return self::$cache[$key] = $out;
    }

    private static function staffName(string $c, int $sid): string
    {
        $r = self::one('SELECT first_name, last_name FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?', [$sid, $c]);

        return $r ? trim($r['first_name'] . ' ' . $r['last_name']) : '#' . $sid;
    }

    /** The current session (marked current, else the newest that has a timetable). */
    private static function session(string $c): ?int
    {
        $key = 'session|' . $c;
        if (array_key_exists($key, self::$cache)) {
            return self::$cache[$key];
        }
        $r = null;
        try {
            $r = self::one("SELECT session_id FROM ssms_sessions WHERE ssms_client_code = ? AND UPPER(COALESCE(is_current,'')) = 'Y' ORDER BY session_id DESC LIMIT 1", [$c]);
            if ($r && !self::one('SELECT 1 x FROM ssms_timetable WHERE ssms_client_code = ? AND session_id = ? LIMIT 1', [$c, (int)$r['session_id']])) {
                $r = null;
            }
        } catch (\Throwable $e) {
        }
        if (!$r) {
            $r = self::one('SELECT MAX(session_id) session_id FROM ssms_timetable WHERE ssms_client_code = ?', [$c]);
        }

        return self::$cache[$key] = ($r && $r['session_id'] !== null ? (int)$r['session_id'] : null);
    }

    /** Accounts of a staff member (to send them the message). */
    private static function usersOfStaff(string $c, int $sid): array
    {
        return array_column(self::q("SELECT ssms_user_name FROM sawera_ssms_users WHERE ssms_client_code = ? AND staff_id = ? AND COALESCE(ssms_user_status,'active') = 'active'
                                       AND LOWER(COALESCE(ssms_user_role,'')) NOT IN ('parent','student')", [$c, $sid]), 'ssms_user_name');
    }

    /** People who arrange cover: owner, and anyone whose role may edit the timetable. */
    public static function managers(string $c): array
    {
        $out = [];
        foreach (self::q("SELECT ssms_user_name, ssms_user_role, custom_role_id FROM sawera_ssms_users WHERE ssms_client_code = ? AND COALESCE(ssms_user_status,'active') = 'active'", [$c]) as $u) {
            $role = strtolower(trim((string)$u['ssms_user_role']));
            $role = $role === 'teacher' ? 'user' : $role;
            if (!in_array($role, Permissions::BASE_ROLES, true)) {
                continue;
            }
            if ($role === 'owner') {
                $out[] = (string)$u['ssms_user_name'];
                continue;
            }
            try {
                $g = Permissions::forUser($c, $role, $u['custom_role_id'] ?? null);
                if (!empty($g['timetable']['edit'])) {
                    $out[] = (string)$u['ssms_user_name'];
                }
            } catch (\Throwable $e) {
            }
        }

        return $out;
    }

    // ── Small helpers ───────────────────────────────────────────────────────

    /** A valid date (default today). $change = for changes: not more than 7 days back or 90 ahead. */
    private static function date(string $c, ?string $d, bool $change = false): string
    {
        $today = self::today($c);
        $d = trim((string)$d);
        if ($d === '') {
            return $today;
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4))) {
            throw new \DomainException('Choose a date.');
        }
        if ($change && ($d < date('Y-m-d', strtotime($today . ' -7 days')) || $d > date('Y-m-d', strtotime($today . ' +90 days')))) {
            throw new \DomainException('Cover can be arranged from a week ago up to 90 days ahead.');
        }

        return $d;
    }

    private static function today(string $c): string
    {
        return Locale::today($c);
    }

    private static function nowLocal(string $c): string
    {
        return Locale::now($c);
    }

    private static function now(): string
    {
        return AccountSecurity::now();
    }

    private static function hm($t): string
    {
        return preg_match('/^(\d{1,2}):(\d{2})/', (string)$t, $m) ? str_pad($m[1], 2, '0', STR_PAD_LEFT) . ':' . $m[2] : '';
    }

    private static function minutes(string $hm): ?int
    {
        return preg_match('/^(\d{2}):(\d{2})$/', $hm, $m) ? (int)$m[1] * 60 + (int)$m[2] : null;
    }

    private static function window($s, $e): array
    {
        $a = self::minutes(self::hm($s));
        $b = self::minutes(self::hm($e));
        if ($a === null) {
            return [0, 24 * 60];
        }

        return [$a, $b !== null && $b > $a ? $b : $a + 180];
    }

    private static function label($class, $section): string
    {
        $class = trim((string)$class);
        $section = trim((string)$section);

        return $section !== '' ? $class . ' – ' . $section : $class;
    }

    private static function clip($s, int $n): ?string
    {
        $s = trim(preg_replace('/\s+/u', ' ', (string)$s));

        return $s === '' ? null : mb_substr($s, 0, $n);
    }

    private static function q(string $sql, array $p = []): array
    {
        return self::db()->execute($sql, $p)->fetchAll('assoc');
    }

    private static function one(string $sql, array $p = []): ?array
    {
        $r = self::db()->execute($sql, $p)->fetch('assoc');

        return $r ?: null;
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
