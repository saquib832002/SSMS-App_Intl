<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Utility\Security;

/**
 * Calendar sync: a private iCal (webcal) link per person for Google Calendar, Outlook and Apple Calendar,
 * and an optional public link per school (events and holidays, e.g. for the school website).
 *
 * Everything comes from data the school already has:
 *   events / holidays   ssms_school_events (parents and students only see those "visible to students / parents")
 *   exams               ssms_exam_datesheet (published) – a child's class / the classes a teacher teaches / all for the office
 *   meetings            ssms_ptm_bookings (parents: booked meetings) / ssms_ptm_sessions (teachers: own sessions)
 *   homework            ssms_homework due dates of the child's class (off unless chosen)
 *   duties              ssms_exam_duties of published seating plans
 *   cover               ssms_cover_assignments given to the teacher
 *   leave               the person's own approved staff leave
 * Calendar apps fetch the link every few hours, so changes in the app show up there by themselves.
 */
class Calendar
{
    /** what => [label, for parents/students, for staff, default on] */
    public const WHAT = [
        'events'   => ['School events', 1, 1, 1],
        'holidays' => ['Holidays', 1, 1, 1],
        'exams'    => ['Exam timetable', 1, 1, 1],
        'meetings' => ['Parent–teacher meetings', 1, 1, 1],
        'homework' => ['Homework due dates', 1, 0, 0],
        'duties'   => ['My exam duties', 0, 1, 1],
        'cover'    => ['My cover periods', 0, 1, 1],
        'leave'    => ['My leave', 0, 1, 1],
    ];
    /** Module (Entitlements) each part belongs to. */
    private const MODULE_OF = ['events' => 'NoticeApi', 'holidays' => 'NoticeApi', 'exams' => 'DatesheetApi', 'meetings' => 'MeetingApi',
                               'homework' => 'HomeworkApi', 'duties' => 'ExamLogisticsApi', 'cover' => 'CoverApi', 'leave' => 'LeaveApi'];
    private const OFFICE = ['owner', 'admin', 'principal'];
    private const PORTAL = ['parent', 'student'];

    /** Tests: today's window (days back / ahead). */
    public const BACK = 60;
    public const AHEAD = 400;

    // ── Who is asking ───────────────────────────────────────────────────────

    public static function access(string $client, array $actor): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $role = $role === 'teacher' ? 'user' : $role;
        $user = (string)($actor['user'] ?? '');
        if ($client === '' || $user === '' || (!in_array($role, Permissions::BASE_ROLES, true) && !in_array($role, self::PORTAL, true))) {
            throw new \DomainException('Not allowed.');
        }
        $portal = in_array($role, self::PORTAL, true);
        $staffId = null;
        $school = false;
        $grid = null;
        if (!$portal) {
            $r = self::one('SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $client]);
            $staffId = $r && $r['staff_id'] ? (int)$r['staff_id'] : null;
            $grid = $role === 'owner' ? null : Permissions::forUser($client, $role, $actor['custom_role'] ?? null);
            $school = $role === 'owner' || !empty($grid['notices']['edit']);
        }

        return ['client' => $client, 'user' => $user, 'role' => $role, 'portal' => $portal, 'staff_id' => $staffId, 'notices_view' => !$portal && ($role === 'owner' || !empty($grid['notices']['view'])),
                'enrollment' => $role === 'student' ? trim((string)($actor['enrollment'] ?? '')) ?: $user : null, 'school' => $school];
    }

    /** The parts this person can put in their calendar (and which ones the school has). */
    public static function options(array $a): array
    {
        $ent = Entitlements::forClient($a['client']);
        $out = [];
        foreach (self::WHAT as $k => [$label, $portal, $staff, $def]) {
            if (!($a['portal'] ? $portal : $staff)) {
                continue;
            }
            if (in_array($k, ['duties', 'cover', 'leave'], true) && !$a['staff_id']) {
                continue;   // not linked to a staff record
            }
            if ($k === 'meetings' && !$a['portal'] && !$a['staff_id']) {
                continue;
            }
            if (!Entitlements::allows($ent, Entitlements::moduleFor(self::MODULE_OF[$k], ''))) {
                continue;
            }
            $out[] = ['key' => $k, 'label' => $label, 'default' => (bool)$def];
        }

        return $out;
    }

    // ── My link ─────────────────────────────────────────────────────────────

    public static function myFeed(array $a): array
    {
        $opts = self::options($a);
        $row = self::row($a['client'], 'user', $a['user']);

        return ['options' => $opts, 'feed' => $row ? self::view($a['client'], $row, $opts) : null, 'school' => $a['school'] ? self::schoolFeed($a) : null];
    }

    /** Turn the link on (first time) or change what is in it. */
    public static function saveFeed(array $a, ?array $include): array
    {
        $opts = self::options($a);
        if (!$opts) {
            throw new \DomainException('Calendar sync is not part of your school\'s plan.');
        }
        $allowed = array_column($opts, 'key');
        $inc = $include === null ? array_column(array_filter($opts, fn($o) => $o['default']), 'key') : array_values(array_intersect($allowed, array_map('strval', $include)));
        if (!$inc) {
            throw new \DomainException('Choose at least one thing to show in your calendar.');
        }
        $row = self::row($a['client'], 'user', $a['user']);
        $now = self::now();
        if ($row) {
            self::db()->execute('UPDATE ssms_calendar_feeds SET include_what = ?, enrollment_id = COALESCE(?, enrollment_id), modified = ? WHERE id = ?',
                [implode(',', $inc), $a['enrollment'], $now, (int)$row['id']]);
        } else {
            self::db()->execute('INSERT INTO ssms_calendar_feeds (ssms_client_code, kind, username, enrollment_id, account_ref, nonce, include_what, created, created_by, modified) VALUES (?,?,?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE include_what = VALUES(include_what), modified = VALUES(modified)',
                [$a['client'], 'user', $a['user'], $a['enrollment'], self::accountRef($a['client'], $a['user']), bin2hex(random_bytes(16)), implode(',', $inc), $now, $a['user'], $now]);
        }

        return self::myFeed($a);
    }

    /** A new link: the old one stops working at once (e.g. it was shared by mistake). */
    public static function resetFeed(array $a): array
    {
        $row = self::row($a['client'], 'user', $a['user']);
        if (!$row) {
            throw new \DomainException('You have no calendar link yet.');
        }
        self::db()->execute('UPDATE ssms_calendar_feeds SET nonce = ?, modified = ?, last_used = NULL, uses = 0 WHERE id = ?', [bin2hex(random_bytes(16)), self::now(), (int)$row['id']]);

        return self::myFeed($a);
    }

    public static function removeFeed(array $a): array
    {
        self::db()->execute("DELETE FROM ssms_calendar_feeds WHERE ssms_client_code = ? AND kind = 'user' AND username = ?", [$a['client'], $a['user']]);

        return self::myFeed($a);
    }

    // ── The school's public link (events and holidays for everyone) ─────────

    public static function schoolFeed(array $a): array
    {
        self::needSchool($a);
        $row = self::row($a['client'], 'school', '');

        return ['feed' => $row ? self::view($a['client'], $row, []) : null];
    }

    /** $op: on | reset | off */
    public static function setSchoolFeed(array $a, string $op): array
    {
        self::needSchool($a);
        $c = $a['client'];
        $row = self::row($c, 'school', '');
        $now = self::now();
        if ($op === 'off') {
            self::db()->execute("DELETE FROM ssms_calendar_feeds WHERE ssms_client_code = ? AND kind = 'school'", [$c]);
        } elseif ($op === 'on' || $op === 'reset') {
            if ($row) {
                if ($op === 'reset') {
                    self::db()->execute('UPDATE ssms_calendar_feeds SET nonce = ?, modified = ?, last_used = NULL, uses = 0 WHERE id = ?', [bin2hex(random_bytes(16)), $now, (int)$row['id']]);
                }
            } else {
                self::db()->execute('INSERT INTO ssms_calendar_feeds (ssms_client_code, kind, username, nonce, include_what, created, created_by, modified) VALUES (?,?,?,?,?,?,?,?)
                    ON DUPLICATE KEY UPDATE modified = VALUES(modified)',
                    [$c, 'school', '', bin2hex(random_bytes(16)), 'events,holidays', $now, $a['user'], $now]);
            }
        } else {
            throw new \DomainException('Unknown action.');
        }

        return self::schoolFeed($a);
    }

    private static function needSchool(array $a): void
    {
        if (empty($a['school'])) {
            throw new \DomainException("You don't have permission to manage the school calendar link. Ask the school owner if you need it.");
        }
    }

    // ── The feed itself (public URL, no sign-in: the signature in the link is the key) ──

    /**
     * $token = "{id}-{signature}" (".ics" allowed). → [http status, body, etag]
     * 404 for anything unknown, reset, removed, or a person who no longer has an active account.
     */
    public static function feed(string $token): array
    {
        $token = preg_replace('/\.ics$/i', '', trim($token));
        if (!preg_match('/^(\d{1,10})-([A-Za-z0-9_-]{32})$/', $token, $m)) {
            return [404, 'Not found', null];
        }
        $row = self::one('SELECT * FROM ssms_calendar_feeds WHERE id = ?', [(int)$m[1]]);
        if (!$row || !hash_equals(self::sign($row), $m[2])) {
            return [404, 'Not found', null];
        }
        $c = (string)$row['ssms_client_code'];
        $ent = Entitlements::forClient($c);
        if (!Entitlements::allows($ent, Entitlements::moduleFor('NoticeApi', '')) || !self::schoolOpen($c, $ent)) {
            return [404, 'Not found', null];
        }
        if ($row['kind'] === 'school') {
            $a = ['client' => $c, 'user' => '', 'role' => 'public', 'portal' => true, 'staff_id' => null, 'enrollment' => null, 'school' => false, 'public' => true];
            $include = ['events', 'holidays'];
            $lang = null;
            $name = Notify::school($c)['name'];
        } else {
            // the same rule as signing in: an active account – and the very account the link was made for
            $u = self::one("SELECT ssms_user_role, staff_id, custom_role_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? AND LOWER(TRIM(ssms_user_status)) = 'active' LIMIT 1",
                [(string)$row['username'], $c]);
            if (!$u || !hash_equals((string)$row['account_ref'], self::accountRef($c, (string)$row['username']))) {
                return [404, 'Not found', null];
            }
            try {
                $a = self::access($c, ['user' => (string)$row['username'], 'role' => (string)$u['ssms_user_role'], 'custom_role' => $u['custom_role_id'],
                                       'enrollment' => $row['enrollment_id']]);
            } catch (\DomainException $e) {
                return [404, 'Not found', null];
            }
            $a['public'] = false;
            // only what this person may still have (role or plan changes take effect at once)
            $include = array_values(array_intersect(array_column(self::options($a), 'key'), explode(',', (string)$row['include_what'])));
            $lang = Locale::langFor($c, (string)$row['username']);
            $name = Notify::school($c)['name'];
        }
        $body = Locale::withLang($lang, fn() => self::build($a, $include, $name));
        // usage (at most once an hour, so a busy calendar app doesn't write every time)
        try {
            self::db()->execute('UPDATE ssms_calendar_feeds SET uses = uses + 1, last_used = ? WHERE id = ? AND (last_used IS NULL OR last_used < ?)',
                [self::now(), (int)$row['id'], date('Y-m-d H:i:s', AccountSecurity::time() - 3600)]);
        } catch (\Throwable $e) {
        }

        // DTSTAMP changes every second: leave it out so an unchanged calendar answers "304 not modified"
        return [200, $body, '"' . md5(preg_replace('/^DTSTAMP:.*$/m', '', $body)) . '"'];
    }

    /** The events for one person (also used by the app's preview). */
    public static function events(array $a, array $include): array
    {
        $c = $a['client'];
        $today = Locale::today($c);
        $from = date('Y-m-d', strtotime($today . ' -' . self::BACK . ' days'));
        $to = date('Y-m-d', strtotime($today . ' +' . self::AHEAD . ' days'));
        $out = [];
        $want = array_flip($include);
        if (isset($want['events']) || isset($want['holidays'])) {
            $out = array_merge($out, self::schoolEvents($a, $from, $to, isset($want['events']), isset($want['holidays'])));
        }
        $children = $a['portal'] && empty($a['public']) ? self::children($a) : [];
        $part = function (string $k, callable $fn) use (&$out, $want) {
            if (isset($want[$k])) {
                try {
                    $out = array_merge($out, $fn());
                } catch (\Throwable $e) {
                    Log::warning("Calendar {$k}: " . $e->getMessage());   // e.g. that feature's tables are not installed
                }
            }
        };
        $part('exams', fn() => $a['portal'] ? self::childExams($c, $children, $from, $to) : self::staffExams($a, $from, $to));
        $part('meetings', fn() => $a['portal'] ? self::childMeetings($c, $children, $from, $to) : self::staffMeetings($a, $from, $to));
        $part('homework', fn() => self::homework($c, $children, $from, $to));
        $part('duties', fn() => self::duties($a, $from, $to));
        $part('cover', fn() => self::covers($a, $from, $to));
        $part('leave', fn() => self::leave($a, $from, $to));
        usort($out, fn($l, $r) => strcmp($l['sort'], $r['sort']) ?: strcmp($l['uid'], $r['uid']));

        return $out;
    }

    /** Next events for the app ("what will be in my calendar"). */
    public static function preview(array $a, ?array $include = null): array
    {
        $opts = self::options($a);
        $row = self::row($a['client'], 'user', $a['user']);
        $inc = $include ?? ($row ? explode(',', (string)$row['include_what']) : array_column(array_filter($opts, fn($o) => $o['default']), 'key'));
        $inc = array_values(array_intersect(array_column($opts, 'key'), $inc));
        $a['public'] = false;
        $today = Locale::today($a['client']);
        $list = array_values(array_filter(Locale::withLang(Locale::langFor($a['client'], $a['user']), fn() => self::events($a, $inc)), fn($e) => ($e['end_date'] ?? $e['date']) >= $today));

        return ['events' => array_map(fn($e) => array_intersect_key($e, array_flip(['kind', 'title', 'date', 'end_date', 'start', 'end', 'where'])), array_slice($list, 0, 30)),
                'total' => count($list)];
    }

    /**
     * The dashboard's "Upcoming" card: school events and holidays together with the person's exams,
     * parent–teacher meetings and (staff) exam duties, cover periods and leave – next $days days, soonest first.
     * Homework has its own card. Staff: one exam on one day in several classes is a single line.
     */
    public static function upcoming(array $a, int $limit = 20, int $days = 90, ?string $child = null): array
    {
        $c = $a['client'];
        $a['only_child'] = $child !== null && trim($child) !== '' ? trim($child) : null;   // the child picked on the parent dashboard
        $inc = array_values(array_diff(array_column(self::options($a), 'key'), ['homework']));
        $a['public'] = false;
        $today = Locale::today($c);
        $until = date('Y-m-d', strtotime($today . ' +' . max(1, min(400, $days)) . ' days'));
        $all = Locale::withLang(Locale::langFor($c, $a['user']), function () use ($a, $inc, $today, $until, $c) {
            $list = array_values(array_filter(self::events($a, $inc), fn($e) => $e['end_date'] >= $today && $e['date'] <= $until));
            if ($a['portal']) {
                return $list;
            }
            $out = [];
            $group = [];
            foreach ($list as $e) {
                if ($e['kind'] === 'exam' && isset($e['exam'])) {
                    $k = $e['date'] . '|' . $e['exam'];
                    if (isset($group[$k])) {
                        $out[$group[$k]]['n']++;
                        continue;
                    }
                    $group[$k] = count($out);
                    $e['n'] = 1;
                }
                $out[] = $e;
            }
            foreach ($out as &$e) {
                if (($e['n'] ?? 1) > 1) {
                    $e['title'] = Locale::t($c, '{exam}: {n} exams', ['exam' => $e['exam'], 'n' => $e['n']]);
                    $e['where'] = '';
                    $e['end'] = null;
                }
            }
            unset($e);

            return $out;
        });
        $items = array_map(function ($e) {
            $v = array_intersect_key($e, array_flip(['kind', 'title', 'date', 'end_date', 'start', 'end', 'where', 'cat']));
            if (isset($e['event'])) {
                $v['event'] = $e['event'];
            }

            return $v;
        }, $all);

        return ['items' => array_slice($items, 0, max(1, min(50, $limit))), 'total' => count($items), 'today' => $today];
    }

    // ── Parts ───────────────────────────────────────────────────────────────

    private static function schoolEvents(array $a, string $from, string $to, bool $events, bool $holidays): array
    {
        $c = $a['client'];
        $types = [];
        if ($events) {
            $types[] = 'event';
        }
        if ($holidays) {
            $types[] = 'holiday';
        }
        $sql = 'SELECT event_id, event_title, event_type, event_category, event_date, event_end_date, event_description, event_color, is_public, updated_at
                  FROM ssms_school_events WHERE ssms_client_code = ? AND event_date <= ? AND COALESCE(event_end_date, event_date) >= ?
                   AND event_type IN (' . implode(',', array_fill(0, count($types), '?')) . ')';
        if ($a['portal'] || empty($a['notices_view'])) {
            $sql .= ' AND COALESCE(is_public, 1) = 1';   // staff-only events stay with staff who may see notices & events
        }
        $out = [];
        foreach (self::q($sql . ' ORDER BY event_date', array_merge([$c, $to, $from], $types)) as $r) {
            $hol = $r['event_type'] === 'holiday';
            $start = substr((string)$r['event_date'], 0, 10);
            if (!self::validDate($start)) {
                continue;
            }
            $end = $r['event_end_date'] && self::validDate(substr((string)$r['event_end_date'], 0, 10)) ? substr((string)$r['event_end_date'], 0, 10) : $start;
            $out[] = self::allDay('event-' . $r['event_id'], $hol ? 'holiday' : 'event',
                $hol ? Locale::t($c, 'Holiday: {name}', ['name' => (string)$r['event_title']]) : (string)$r['event_title'],
                $start, max($start, $end), trim((string)($r['event_description'] ?? '')), '', (string)($r['event_category'] ?: ($hol ? 'Holiday' : 'Event')), $hol, $r['updated_at'] ?? null);
            // the school's own row (the dashboard shows it as before and lets the office edit it)
            $out[count($out) - 1]['event'] = ['event_id' => (int)$r['event_id'], 'event_title' => (string)$r['event_title'], 'event_type' => (string)$r['event_type'],
                'event_category' => (string)($r['event_category'] ?? ''), 'event_date' => $start, 'event_end_date' => $r['event_end_date'] ? max($start, $end) : null,
                'event_description' => (string)($r['event_description'] ?? ''), 'event_color' => (string)($r['event_color'] ?? ''), 'is_public' => (int)($r['is_public'] ?? 1)];
        }

        return $out;
    }

    private static function childExams(string $c, array $children, string $from, string $to): array
    {
        $out = [];
        $many = count($children) > 1;
        foreach ($children as $ch) {
            foreach (self::q('SELECT d.datesheet_id, d.exam_date, d.start_time, d.end_time, d.venue, d.notes, x.exam_name, s.subject_name, d.updated_at
                                FROM ssms_exam_datesheet d JOIN ssms_exams x ON x.exam_id = d.exam_id LEFT JOIN ssms_subjects s ON s.subject_id = d.subject_id
                               WHERE d.ssms_client_code = ? AND d.class_id = ? AND d.is_published = 1 AND (d.branch_id = 0 OR d.branch_id = ?)
                                 AND (d.session_id = 0 OR d.session_id = ?) AND d.exam_date BETWEEN ? AND ?',
                [$c, $ch['class_id'], $ch['branch_id'], $ch['session_id'], $from, $to]) as $r) {
                $t = Locale::t($c, '{subject} exam ({exam})', ['subject' => (string)($r['subject_name'] ?? ''), 'exam' => (string)($r['exam_name'] ?? '')]);
                $out[] = self::timed('exam-' . $r['datesheet_id'] . '-' . $ch['eid'], 'exam', ($many ? $ch['name'] . ': ' : '') . $t, substr((string)$r['exam_date'], 0, 10),
                    $r['start_time'], $r['end_time'], trim((string)($r['notes'] ?? '')), (string)($r['venue'] ?? ''), 'Exam', $c, $r['updated_at'] ?? null);
            }
        }

        return $out;
    }

    private static function staffExams(array $a, string $from, string $to): array
    {
        $c = $a['client'];
        $sql = 'SELECT d.datesheet_id, d.exam_date, d.start_time, d.end_time, d.venue, d.class_id, x.exam_name, s.subject_name, cl.class_name, d.updated_at
                  FROM ssms_exam_datesheet d JOIN ssms_exams x ON x.exam_id = d.exam_id LEFT JOIN ssms_subjects s ON s.subject_id = d.subject_id
                  LEFT JOIN ssms_classes cl ON cl.class_id = d.class_id
                 WHERE d.ssms_client_code = ? AND d.is_published = 1 AND d.exam_date BETWEEN ? AND ?';
        $p = [$c, $from, $to];
        if (!in_array($a['role'], self::OFFICE, true)) {
            $classes = $a['staff_id'] ? array_values(array_unique(array_map(fn($x) => (int)$x['class_id'], Meetings::teacherClasses($c, (int)$a['staff_id'])))) : [];
            if (!$classes) {
                return [];
            }
            $sql .= ' AND d.class_id IN (' . implode(',', array_fill(0, count($classes), '?')) . ')';
            $p = array_merge($p, $classes);
            $br = (int)(self::one('SELECT branch_id FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?', [(int)$a['staff_id'], $c])['branch_id'] ?? 0);
            if ($br > 0) {
                $sql .= ' AND (d.branch_id = 0 OR d.branch_id = ?)';   // the teacher's own branch
                $p[] = $br;
            }
        }
        $out = [];
        if (in_array($a['role'], self::OFFICE, true)) {
            $sql .= ' AND d.exam_date >= ?';   // whole school: only the last two weeks of the past
            $p[] = max($from, date('Y-m-d', strtotime(Locale::today($c) . ' -14 days')));
        }
        foreach (self::q($sql . ' ORDER BY d.exam_date < ? , d.exam_date, d.start_time LIMIT 3000', array_merge($p, [Locale::today($c)])) as $r) {
            $out[] = self::timed('exam-' . $r['datesheet_id'], 'exam', Locale::t($c, 'Exam: {class} – {subject} ({exam})',
                ['class' => (string)($r['class_name'] ?? ''), 'subject' => (string)($r['subject_name'] ?? ''), 'exam' => (string)($r['exam_name'] ?? '')]),
                substr((string)$r['exam_date'], 0, 10), $r['start_time'], $r['end_time'], '', (string)($r['venue'] ?? ''), 'Exam', $c, $r['updated_at'] ?? null);
            $out[count($out) - 1]['exam'] = (string)($r['exam_name'] ?? '');   // the dashboard puts one exam's classes on a day together
        }

        return $out;
    }

    private static function childMeetings(string $c, array $children, string $from, string $to): array
    {
        if (!$children) {
            return [];
        }
        $byId = [];
        foreach ($children as $ch) {
            $byId[$ch['eid']] = $ch;
        }
        $in = implode(',', array_fill(0, count($byId), '?'));
        $out = [];
        foreach (self::q("SELECT b.id, b.enrollment_id, sl.start_at, sl.end_at, se.title, se.mode, se.location, st.first_name, st.last_name, b.modified
                            FROM ssms_ptm_bookings b JOIN ssms_ptm_slots sl ON sl.id = b.slot_id JOIN ssms_ptm_sessions se ON se.id = b.session_id
                            LEFT JOIN ssms_staff st ON st.staff_id = se.staff_id AND st.ssms_client_code = se.ssms_client_code
                           WHERE b.ssms_client_code = ? AND b.active = 1 AND b.enrollment_id IN ($in) AND se.status <> 'cancelled' AND sl.start_at BETWEEN ? AND ?",
            array_merge([$c], array_keys($byId), [$from . ' 00:00:00', $to . ' 23:59:59'])) as $r) {
            $teacher = trim($r['first_name'] . ' ' . $r['last_name']);
            $t = Locale::t($c, 'Meeting with {teacher}', ['teacher' => $teacher ?: (string)$r['title']]);
            if (count($byId) > 1 && isset($byId[(string)$r['enrollment_id']])) {
                $t = $byId[(string)$r['enrollment_id']]['name'] . ': ' . $t;
            }
            $out[] = self::timed('ptm-booking-' . $r['id'], 'meeting', $t, substr((string)$r['start_at'], 0, 10), substr((string)$r['start_at'], 11, 5),
                substr((string)$r['end_at'], 11, 5), (string)$r['title'], self::meetingWhere($c, $r), 'Meeting', $c, $r['modified'] ?? null);
        }

        return $out;
    }

    private static function staffMeetings(array $a, string $from, string $to): array
    {
        if (!$a['staff_id']) {
            return [];
        }
        $c = $a['client'];
        $out = [];
        foreach (self::q("SELECT se.*, (SELECT COUNT(*) FROM ssms_ptm_bookings b WHERE b.session_id = se.id AND b.active = 1) booked
                            FROM ssms_ptm_sessions se WHERE se.ssms_client_code = ? AND se.staff_id = ? AND se.status <> 'cancelled' AND se.meet_date BETWEEN ? AND ?",
            [$c, (int)$a['staff_id'], $from, $to]) as $r) {
            $out[] = self::timed('ptm-session-' . $r['id'], 'meeting', Locale::t($c, '{title} (parent meetings)', ['title' => (string)$r['title']]),
                substr((string)$r['meet_date'], 0, 10), $r['start_time'], $r['end_time'], Locale::t($c, '{n} booked', ['n' => (int)$r['booked']]),
                self::meetingWhere($c, $r), 'Meeting', $c, $r['modified'] ?? null);
        }

        return $out;
    }

    private static function meetingWhere(string $c, array $r): string
    {
        $mode = (string)($r['mode'] ?? '');
        $loc = trim((string)($r['location'] ?? ''));
        if ($mode === 'video') {
            return $loc !== '' ? $loc : Locale::t($c, 'Video call');
        }
        if ($mode === 'phone') {
            return Locale::t($c, 'Phone call');
        }

        return $loc;
    }

    private static function homework(string $c, array $children, string $from, string $to): array
    {
        $out = [];
        $many = count($children) > 1;
        foreach ($children as $ch) {
            foreach (self::q("SELECT id, subject_name, title, due_date FROM ssms_homework
                               WHERE ssms_client_code = ? AND class_id = ? AND (section_id IS NULL OR section_id = 0 OR section_id = ?)
                                 AND (session_id IS NULL OR session_id = 0 OR session_id = ?) AND COALESCE(status,'active') = 'active'
                                 AND due_date BETWEEN ? AND ?", [$c, $ch['class_id'], $ch['section_id'], $ch['session_id'], $from, $to]) as $r) {
                $t = Locale::t($c, 'Homework due: {subject} – {title}', ['subject' => (string)($r['subject_name'] ?? ''), 'title' => (string)$r['title']]);
                $d = substr((string)$r['due_date'], 0, 10);
                $out[] = self::allDay('homework-' . $r['id'] . '-' . $ch['eid'], 'homework', ($many ? $ch['name'] . ': ' : '') . $t, $d, $d, '', '', 'Homework', true, null);
            }
        }

        return $out;
    }

    private static function duties(array $a, string $from, string $to): array
    {
        $c = $a['client'];
        $out = [];
        foreach (self::q("SELECT d.id, d.duty_role, p.exam_date, p.start_time, p.end_time, x.exam_name, h.name hall, h.location, p.modified
                            FROM ssms_exam_duties d JOIN ssms_exam_seat_plans p ON p.plan_id = d.plan_id JOIN ssms_exam_halls h ON h.hall_id = d.hall_id
                            LEFT JOIN ssms_exams x ON x.exam_id = p.exam_id
                           WHERE d.ssms_client_code = ? AND d.staff_id = ? AND p.status = 'published' AND p.exam_date BETWEEN ? AND ?",
            [$c, (int)$a['staff_id'], $from, $to]) as $r) {
            $out[] = self::timed('duty-' . $r['id'], 'duty', Locale::t($c, 'Exam duty: {hall} ({exam})', ['hall' => (string)$r['hall'], 'exam' => (string)($r['exam_name'] ?? '')]),
                substr((string)$r['exam_date'], 0, 10), $r['start_time'], $r['end_time'], $r['duty_role'] === 'chief' ? Locale::t($c, 'Chief invigilator') : '',
                trim((string)$r['hall'] . ($r['location'] ? ', ' . $r['location'] : '')), 'Exam duty', $c, $r['modified'] ?? null);
        }

        return $out;
    }

    private static function covers(array $a, string $from, string $to): array
    {
        $c = $a['client'];
        $out = [];
        foreach (self::q("SELECT ca.id, ca.cover_date, p.start_time, p.end_time, p.period_name, cl.class_name, sec.section_name, sb.subject_name, st.first_name, st.last_name, ca.note, t.room, ca.modified
                            FROM ssms_cover_assignments ca LEFT JOIN ssms_periods p ON p.period_id = ca.period_id
                            LEFT JOIN ssms_classes cl ON cl.class_id = ca.class_id LEFT JOIN ssms_sections sec ON sec.section_id = ca.section_id
                            LEFT JOIN ssms_class_subjects cs ON cs.id = ca.class_subject_id LEFT JOIN ssms_subjects sb ON sb.subject_id = cs.subject_id
                            LEFT JOIN ssms_staff st ON st.staff_id = ca.absent_staff_id LEFT JOIN ssms_timetable t ON t.timetable_id = ca.timetable_id
                           WHERE ca.ssms_client_code = ? AND ca.hold_staff_id = ? AND ca.kind = 'cover' AND ca.cover_date BETWEEN ? AND ?",
            [$c, (int)$a['staff_id'], $from, $to]) as $r) {
            $class = trim((string)$r['class_name'] . ($r['section_name'] ? ' – ' . $r['section_name'] : ''));
            $out[] = self::timed('cover-' . $r['id'], 'cover', Locale::t($c, 'Cover: {class} {subject}', ['class' => $class, 'subject' => (string)($r['subject_name'] ?? '')]),
                substr((string)$r['cover_date'], 0, 10), $r['start_time'], $r['end_time'],
                trim(Locale::t($c, 'For {teacher}', ['teacher' => trim($r['first_name'] . ' ' . $r['last_name'])]) . ($r['note'] ? "\n" . $r['note'] : '')),
                (string)($r['room'] ?? ''), 'Cover', $c, $r['modified'] ?? null);
        }

        return $out;
    }

    private static function leave(array $a, string $from, string $to): array
    {
        $c = $a['client'];
        $out = [];
        foreach (self::q("SELECT la.id, la.from_date, la.to_date, la.is_half_day, la.half_day_slot, lt.name type_name, la.approved_at
                            FROM ssms_leave_applications la JOIN ssms_staff st ON st.staff_id = la.staff_id AND st.ssms_client_code = ?
                            LEFT JOIN ssms_leave_types lt ON lt.id = la.leave_type_id
                           WHERE la.staff_id = ? AND LOWER(la.status) IN ('approved','approve') AND la.from_date <= ? AND la.to_date >= ?",
            [$c, (int)$a['staff_id'], $to, $from]) as $r) {
            $half = (int)$r['is_half_day'] === 1 ? strtolower((string)$r['half_day_slot']) : '';
            // only "On leave": the kind of leave (sick …) is not sent to Google / Outlook
            $t = Locale::t($c, 'On leave') . ($half === 'morning' ? ' – ' . Locale::t($c, 'morning') : ($half === 'afternoon' ? ' – ' . Locale::t($c, 'afternoon') : ''));
            $s = substr((string)$r['from_date'], 0, 10);
            $e = substr((string)$r['to_date'], 0, 10);
            if (!self::validDate($s)) {
                continue;
            }
            $out[] = self::allDay('leave-' . $r['id'], 'leave', $t, $s, self::validDate($e) ? max($s, $e) : $s, '', '', 'Leave', false, null);
        }

        return $out;
    }

    /** A parent's / student's children: class, section, branch, session and first name. */
    private static function children(array $a): array
    {
        $c = $a['client'];
        $ids = $a['role'] === 'student'
            ? (($a['enrollment'] && self::one("SELECT 1 x FROM ssms_student_enrollment WHERE ssms_client_code = ? AND enrollment_id = ? AND COALESCE(status,'active') = 'active'", [$c, (string)$a['enrollment']]))
                ? [(string)$a['enrollment']] : [])
            : StudentLeave::myEnrollmentIds($c, $a['role'], $a['user'], null);
        if (!empty($a['only_child'])) {
            $ids = in_array($a['only_child'], $ids, true) ? [$a['only_child']] : [];   // only one of their own children
        }
        if (!$ids) {
            return [];
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $out = [];
        foreach (self::q("SELECT e.enrollment_id, e.class_id, e.section_id, COALESCE(e.branch_id, 0) branch_id, COALESCE(e.session_id, 0) session_id, r.student_first_name
                            FROM ssms_student_enrollment e LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                           WHERE e.ssms_client_code = ? AND e.enrollment_id IN ($in)", array_merge([$c], $ids)) as $r) {
            $out[] = ['eid' => (string)$r['enrollment_id'], 'class_id' => (int)$r['class_id'], 'section_id' => (int)$r['section_id'], 'branch_id' => (int)$r['branch_id'],
                      'session_id' => (int)$r['session_id'], 'name' => trim((string)$r['student_first_name']) ?: (string)$r['enrollment_id']];
        }

        return $out;
    }

    // ── iCalendar ───────────────────────────────────────────────────────────

    private static function allDay(string $uid, string $kind, string $title, string $start, string $end, string $desc, string $where, string $cat, bool $free, $modified): array
    {
        return ['uid' => $uid, 'kind' => $kind, 'title' => $title, 'date' => $start, 'end_date' => $end, 'start' => null, 'end' => null,
                'desc' => $desc, 'where' => $where, 'cat' => $cat, 'free' => $free, 'modified' => $modified, 'sort' => $start . ' 00:00'];
    }

    /** A timed event in the school's local time; no (valid) time → all day. */
    private static function timed(string $uid, string $kind, string $title, string $date, $start, $end, string $desc, string $where, string $cat, string $c, $modified): array
    {
        $s = self::hm($start);
        $e = self::hm($end);
        if ($s === '') {
            return self::allDay($uid, $kind, $title, $date, $date, $desc, $where, $cat, false, $modified);
        }
        if ($e === '' || $e <= $s) {
            $e = date('H:i', strtotime('2000-01-01 ' . $s) + 3600);   // unknown length: an hour
            if ($e <= $s) {
                $e = '23:59';
            }
        }

        return ['uid' => $uid, 'kind' => $kind, 'title' => $title, 'date' => $date, 'end_date' => $date, 'start' => $s, 'end' => $e,
                'desc' => $desc, 'where' => $where, 'cat' => $cat, 'free' => false, 'modified' => $modified, 'sort' => $date . ' ' . $s];
    }

    private static function build(array $a, array $include, string $school): string
    {
        $c = $a['client'];
        $tz = Locale::tz($c);
        $host = parse_url((string)env('APP_URL', 'https://managemyacademy.com/'), PHP_URL_HOST) ?: 'managemyacademy.com';
        $stamp = gmdate('Ymd\THis\Z', AccountSecurity::time());
        $utc = function (string $date, string $hm) use ($tz) {
            return (new \DateTimeImmutable($date . ' ' . $hm . ':00', $tz))->setTimezone(new \DateTimeZone('UTC'))->format('Ymd\THis\Z');
        };
        $name = !empty($a['public']) ? $school : $school . ' – ' . Locale::t($c, 'My calendar');
        $L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ManageMyAcademy//School calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
              'X-WR-CALNAME:' . self::esc($name), 'X-WR-TIMEZONE:' . $tz->getName(), 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
        foreach (self::events($a, $include) as $e) {
            $L[] = 'BEGIN:VEVENT';
            $L[] = 'UID:' . $e['uid'] . '.' . strtolower(preg_replace('/[^A-Za-z0-9]/', '', $c)) . '@' . $host;
            $L[] = 'DTSTAMP:' . $stamp;
            if ($e['start'] === null) {
                $L[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', $e['date']);
                $L[] = 'DTEND;VALUE=DATE:' . date('Ymd', strtotime($e['end_date'] . ' +1 day'));   // the end date is exclusive
            } else {
                $L[] = 'DTSTART:' . $utc($e['date'], $e['start']);
                $L[] = 'DTEND:' . $utc($e['date'], $e['end']);
            }
            $L[] = 'SUMMARY:' . self::esc($e['title']);
            if ($e['desc'] !== '') {
                $L[] = 'DESCRIPTION:' . self::esc($e['desc']);
            }
            if ($e['where'] !== '') {
                $L[] = 'LOCATION:' . self::esc($e['where']);
            }
            $L[] = 'CATEGORIES:' . self::esc($e['cat']);
            if ($e['free']) {
                $L[] = 'TRANSP:TRANSPARENT';
            }
            $L[] = 'END:VEVENT';
        }
        $L[] = 'END:VCALENDAR';

        return implode("\r\n", array_map([self::class, 'fold'], $L)) . "\r\n";
    }

    /** Text value: backslash, ; , and new lines escaped; control characters removed. */
    public static function esc(string $s): string
    {
        $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', str_replace(["\r\n", "\r"], "\n", mb_scrub($s, 'UTF-8'))) ?? '';

        return str_replace(['\\', ';', ',', "\n"], ['\\\\', '\\;', '\\,', '\\n'], $s);
    }

    /** Lines longer than 75 octets go on (space-started) continuation lines, never inside a UTF-8 character. */
    public static function fold(string $line): string
    {
        if (strlen($line) <= 75) {
            return $line;
        }
        $out = [];
        $cur = '';
        $max = 75;
        foreach (preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
            if (strlen($cur) + strlen($ch) > $max) {
                $out[] = $cur;
                $cur = ' ';
                $max = 75;
            }
            $cur .= $ch;
        }
        $out[] = $cur;

        return implode("\r\n", $out);
    }

    // ── Links ───────────────────────────────────────────────────────────────

    private static function sign(array $row): string
    {
        $raw = hash_hmac('sha256', 'cal|' . $row['id'] . '|' . $row['ssms_client_code'] . '|' . $row['kind'] . '|' . (string)$row['username'] . '|' . $row['nonce'],
            Security::getSalt(), true);

        return substr(rtrim(strtr(base64_encode($raw), '+/', '-_'), '='), 0, 32);
    }

    private static function view(string $c, array $row, array $opts): array
    {
        $url = rtrim((string)env('APP_URL', 'https://managemyacademy.com/'), '/') . '/cal/' . $row['id'] . '-' . self::sign($row) . '.ics';
        $webcal = preg_replace('#^https?://#i', 'webcal://', $url);
        $school = Notify::school($c)['name'];
        $name = $row['kind'] === 'school' ? $school : $school . ' – ' . Locale::t($c, 'My calendar');

        return ['url' => $url, 'webcal' => $webcal,
                'google' => 'https://calendar.google.com/calendar/r?cid=' . rawurlencode($webcal),
                'outlook' => 'https://outlook.live.com/calendar/0/addfromweb?url=' . rawurlencode($url) . '&name=' . rawurlencode($name),
                'outlook_work' => 'https://outlook.office.com/calendar/0/addfromweb?url=' . rawurlencode($url) . '&name=' . rawurlencode($name),
                'include' => array_values(array_filter(explode(',', (string)$row['include_what']))),
                'created' => $row['created'], 'last_used' => $row['last_used'], 'public_url' => str_starts_with($url, 'https://') && !self::privateHost($url)];
    }

    /** A link on a local / private address (a test server) can't be reached by Google or Outlook. */
    private static function privateHost(string $url): bool
    {
        $h = (string)parse_url($url, PHP_URL_HOST);
        if ($h === '' || $h === 'localhost' || str_ends_with($h, '.local') || str_ends_with($h, '.test')) {
            return true;
        }

        return filter_var($h, FILTER_VALIDATE_IP) !== false && filter_var($h, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
    }

    private static function row(string $c, string $kind, string $user): ?array
    {
        $r = self::one('SELECT * FROM ssms_calendar_feeds WHERE ssms_client_code = ? AND kind = ? AND username = ? LIMIT 1', [$c, $kind, $user]);
        if ($r && $kind === 'user' && !hash_equals((string)$r['account_ref'], self::accountRef($c, $user))) {
            // left over from an earlier account with the same username: never shown or reused
            self::db()->execute('DELETE FROM ssms_calendar_feeds WHERE id = ?', [(int)$r['id']]);

            return null;
        }

        return $r;
    }

    /** Privacy: a person's account is erased → their link goes too. */
    public static function eraseUsers(string $c, array $users): void
    {
        if (!$users) {
            return;
        }
        try {
            self::db()->execute("DELETE FROM ssms_calendar_feeds WHERE ssms_client_code = ? AND kind = 'user' AND username IN (" . implode(',', array_fill(0, count($users), '?')) . ')',
                array_merge([$c], array_values($users)));
        } catch (\Throwable $e) {
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /** Which account a username is right now (so a deleted-and-remade username never gets the old link). */
    private static function accountRef(string $c, string $user): string
    {
        $u = self::one('SELECT created, ssms_user_role, staff_id, ssms_user_password FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $c]);
        if (!$u) {
            return '';
        }
        $kind = in_array(strtolower(trim((string)$u['ssms_user_role'])), self::PORTAL, true) ? 'portal' : 'staff:' . (int)$u['staff_id'];
        // when the account was made; older accounts without that date: their password hash (a remade account has another)
        $when = (string)($u['created'] ?? '') !== '' ? (string)$u['created'] : 'p:' . sha1((string)$u['ssms_user_password']);

        return substr(sha1($c . '|' . $user . '|' . $when . '|' . $kind), 0, 40);
    }

    /** Same as signing in: the school is not switched off and (legacy plans) not expired. */
    private static function schoolOpen(string $c, array $ent): bool
    {
        $r = self::one('SELECT ssms_client_status, ssms_client_expiry_date FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$c]);
        if (!$r || strtolower(trim((string)($r['ssms_client_status'] ?? ''))) === 'inactive') {
            return false;
        }
        $exp = substr((string)($r['ssms_client_expiry_date'] ?? ''), 0, 10);

        return Entitlements::isSubscription($ent) || !self::validDate($exp) || $exp >= Locale::today($c);
    }

    private static function validDate(string $d): bool
    {
        return (bool)preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m) && checkdate((int)$m[2], (int)$m[3], (int)$m[1]) && (int)$m[1] > 1900;
    }

    private static function hm($t): string
    {
        return preg_match('/^(\d{1,2}):(\d{2})/', trim((string)$t), $m) && (int)$m[1] < 24 && (int)$m[2] < 60 ? str_pad($m[1], 2, '0', STR_PAD_LEFT) . ':' . $m[2] : '';
    }

    private static function now(): string
    {
        return AccountSecurity::now();
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
