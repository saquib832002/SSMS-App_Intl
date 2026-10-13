<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Parent–teacher meeting booking.
 *
 *  Teachers (or the office for them) publish a session: a date, a time window and a slot
 *  length – the system cuts it into slots. Parents of students in the teacher's classes see
 *  the open slots and book one per child per session. Booking and cancelling close
 *  `closes_hours` before a slot. Reminders go out the day before and about an hour before
 *  (bin/cake meeting_reminders, plus whenever someone opens the meetings screens).
 *
 * All times are the school's local time (ssms_clients.timezone, India → Asia/Kolkata).
 *
 * Permissions (Roles & permissions › Parent–teacher meetings):
 *   view  – see sessions;  edit – publish / change your own sessions, mark meetings;
 *   approve – manage every teacher's sessions (office);  delete – cancel any teacher's session.
 * Parents and students are limited to their own children.
 */
class Meetings
{
    public const MODES = ['in_person' => 'In person', 'video' => 'Video call', 'phone' => 'Phone call'];
    public const MAX_SLOTS = 120;
    public const STAFF_ROLES = ['owner', 'admin', 'principal', 'user', 'teacher', 'staff', 'accountant'];

    /** tests: replace the push sender / fix the time zone */
    public static $push = null;
    public static $tzOverride = null;

    // ── Time ────────────────────────────────────────────────────────────────

    public static function tz(string $client): \DateTimeZone
    {
        if (self::$tzOverride) {
            return new \DateTimeZone(self::$tzOverride);
        }

        return Locale::tz($client);   // Region & formats: saved time zone, else the country's
    }

    /** The school's local "now" as Y-m-d H:i:s. */
    public static function now(string $client): string
    {
        return (new \DateTimeImmutable('@' . AccountSecurity::time()))->setTimezone(self::tz($client))->format('Y-m-d H:i:s');
    }

    /** Unix time of a school-local "Y-m-d H:i:s" (DST-safe: uses the school's zone, not the server's). */
    public static function localTs(string $client, string $localDateTime): int
    {
        try {
            return (new \DateTimeImmutable($localDateTime, self::tz($client)))->getTimestamp();
        } catch (\Throwable $e) {
            return (int)strtotime($localDateTime);
        }
    }

    private static function minutesUntil(string $client, string $localDateTime): int
    {
        return (int)floor((self::localTs($client, $localDateTime) - AccountSecurity::time()) / 60);
    }

    /** Run $fn in one database transaction (rows locked with FOR UPDATE stay locked until it ends). */
    private static function tx(callable $fn)
    {
        $db = self::db();
        if (method_exists($db, 'transactional')) {
            // CakePHP: nests safely and rolls back (re-throwing) on any exception
            $out = null;
            $db->transactional(function () use ($fn, &$out) {
                $out = $fn();

                return true;
            });

            return $out;
        }
        self::db()->execute('START TRANSACTION');
        try {
            $out = $fn();
            self::db()->execute('COMMIT');

            return $out;
        } catch (\Throwable $e) {
            try {
                self::db()->execute('ROLLBACK');
            } catch (\Throwable $e2) {
            }
            throw $e;
        }
    }

    // ── Who is asking ───────────────────────────────────────────────────────

    /** $actor = [user, role, custom_role] → what this staff member may do. */
    public static function staffAccess(string $client, array $actor): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $role = $role === 'teacher' ? 'user' : $role;
        if (!in_array($role, self::STAFF_ROLES, true) || (string)($actor['user'] ?? '') === '') {
            throw new \DomainException('Not allowed.');
        }
        $owner = $role === 'owner';
        $grid = $owner ? [] : Permissions::forUser($client, $role, $actor['custom_role'] ?? null);
        $g = fn(string $k) => $owner || !empty($grid['meetings'][$k]);
        if (!$g('view')) {
            throw new \DomainException("You don't have permission to see parent–teacher meetings. Ask the school owner if you need it.");
        }

        return ['role' => $role, 'user' => (string)$actor['user'], 'staff_id' => self::staffIdOf($client, (string)$actor['user']),
                'edit' => $g('edit'), 'all' => $g('approve'), 'delete' => $g('delete')];
    }

    public static function staffIdOf(string $client, string $user): ?int
    {
        $r = self::db()->execute('SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $client])->fetch('assoc');

        return !empty($r['staff_id']) ? (int)$r['staff_id'] : null;
    }

    /** Classes / sections a teacher teaches (subject teacher) or looks after (class teacher). */
    public static function teacherClasses(string $client, int $staffId): array
    {
        $out = [];
        try {
            foreach (self::q('SELECT DISTINCT class_id, section_id FROM ssms_subject_teacher WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client]) as $r) {
                $out[(int)$r['class_id'] . '|' . (int)$r['section_id']] = ['class_id' => (int)$r['class_id'], 'section_id' => $r['section_id'] ? (int)$r['section_id'] : null];
            }
        } catch (\Throwable $e) {
        }
        try {
            foreach (self::q('SELECT section_id, class_id FROM ssms_sections WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client]) as $r) {
                $out[(int)$r['class_id'] . '|' . (int)$r['section_id']] = ['class_id' => (int)$r['class_id'], 'section_id' => (int)$r['section_id']];
            }
        } catch (\Throwable $e) {
        }

        return array_values($out);
    }

    /** Teachers the office can publish sessions for. */
    public static function teachers(string $client): array
    {
        return array_map(fn($r) => ['staff_id' => (int)$r['staff_id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name'])], self::q(
            "SELECT staff_id, first_name, last_name FROM ssms_staff WHERE ssms_client_code = ?
                AND (hired IS NULL OR hired IN ('Y','Yes','yes','1'))
                AND (resigned IS NULL OR TRIM(resigned) = '' OR LOWER(TRIM(resigned)) IN ('n','no','0'))
              ORDER BY first_name, last_name", [$client]));
    }

    // ── Sessions (staff) ────────────────────────────────────────────────────

    /**
     * Create or change a session. Times can only change while nobody has booked; other
     * details (title, place, note, booking cut-off, open/closed) can change any time.
     */
    public static function saveSession(string $client, array $acc, array $d): array
    {
        if (!$acc['edit'] && !$acc['all']) {
            throw new \DomainException("You don't have permission to publish meeting slots.");
        }
        $id = (int)($d['id'] ?? 0);
        $old = $id ? self::sessionRow($client, $id) : null;
        if ($id && !$old) {
            throw new \InvalidArgumentException('Session not found.');
        }
        $staffId = (int)($d['staff_id'] ?? ($old['staff_id'] ?? $acc['staff_id'] ?? 0));
        if (!$staffId) {
            throw new \DomainException('Your user account isn\'t linked to a staff record, so you can\'t publish slots. Ask the office to link it, or to publish slots for you.');
        }
        $mine = $acc['staff_id'] !== null && $staffId === (int)$acc['staff_id'];
        if (!$mine && !$acc['all']) {
            throw new \DomainException('You can only publish slots for yourself.');
        }
        if ($old && (int)$old['staff_id'] !== $staffId) {
            throw new \DomainException('A session can\'t be moved to another teacher. Cancel it and publish a new one.');
        }
        if ($old && $old['status'] === 'cancelled') {
            throw new \DomainException('This session was cancelled.');
        }
        if (!self::db()->execute('SELECT 1 FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client])->fetch('assoc')) {
            throw new \InvalidArgumentException('Teacher not found.');
        }
        $title = self::text($d['title'] ?? ($old['title'] ?? ''), 150) ?: 'Parent–teacher meeting';
        $mode = (string)($d['mode'] ?? ($old['mode'] ?? 'in_person'));
        if (!isset(self::MODES[$mode])) {
            throw new \InvalidArgumentException('Choose how the meeting happens.');
        }
        $location = self::text($d['location'] ?? ($old['location'] ?? ''), 300);
        if ($mode === 'video' && $location !== '' && !preg_match('#^https://#i', $location)) {
            throw new \InvalidArgumentException('For a video call, paste the meeting link (starting with https://).');
        }
        $closes = (int)($d['closes_hours'] ?? ($old['closes_hours'] ?? 12));
        if ($closes < 0 || $closes > 168) {
            throw new \InvalidArgumentException('Booking can close between 0 and 168 hours (7 days) before a slot.');
        }
        $status = (string)($d['status'] ?? ($old['status'] ?? 'open'));
        if (!in_array($status, ['open', 'closed'], true)) {
            throw new \InvalidArgumentException('Status must be open or closed.');
        }
        $note = self::text($d['note_for_parents'] ?? ($old['note_for_parents'] ?? ''), 1000);
        $audience = self::audience($client, array_key_exists('audience', $d) ? $d['audience'] : ($old ? json_decode((string)$old['audience'], true) : null));
        $savedAud = $old && $old['audience'] ? json_decode((string)$old['audience'], true) : null;
        $audChanged = !$old || json_encode($audience) !== json_encode(is_array($savedAud) ? self::audience($client, $savedAud) : null);
        if ($audience !== null && !$acc['all'] && $audChanged) {
            // a teacher can only open slots to classes they teach (their own sections of each class)
            $mineCls = self::teacherClasses($client, $staffId);
            $narrow = [];
            foreach ($audience as $a) {
                $hit = false;
                foreach ($mineCls as $m) {
                    if ($m['class_id'] === $a['class_id'] && ($a['section_id'] === null || $m['section_id'] === null || $m['section_id'] === $a['section_id'])) {
                        $narrow[$m['class_id'] . '|' . (int)($a['section_id'] ?? $m['section_id'])] = ['class_id' => $m['class_id'], 'section_id' => $a['section_id'] ?? $m['section_id']];
                        $hit = true;
                    }
                }
                if (!$hit) {
                    throw new \DomainException('You can only open slots to classes you teach. Ask the office to publish for other classes.');
                }
            }
            $audience = array_values($narrow);
        }

        // timing
        $date = (string)($d['meet_date'] ?? ($old['meet_date'] ?? ''));
        $start = substr((string)($d['start_time'] ?? ($old['start_time'] ?? '')), 0, 5);
        $end = substr((string)($d['end_time'] ?? ($old['end_time'] ?? '')), 0, 5);
        $slot = (int)($d['slot_minutes'] ?? ($old['slot_minutes'] ?? 10));
        $gap = (int)($d['gap_minutes'] ?? ($old['gap_minutes'] ?? 0));
        $dt = \DateTime::createFromFormat('Y-m-d', $date);
        if (!$dt || $dt->format('Y-m-d') !== $date) {
            throw new \InvalidArgumentException('Choose the meeting date.');
        }
        foreach (['Start time' => $start, 'End time' => $end] as $lbl => $t) {
            if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t)) {
                throw new \InvalidArgumentException("$lbl must be like 15:30.");
            }
        }
        if ($slot < 5 || $slot > 120) {
            throw new \InvalidArgumentException('A slot can be 5 to 120 minutes long.');
        }
        if ($gap < 0 || $gap > 60) {
            throw new \InvalidArgumentException('The break between slots can be 0 to 60 minutes.');
        }
        if ($end <= $start) {
            throw new \InvalidArgumentException('The end time must be after the start time.');
        }
        $timingChanged = !$old || $old['meet_date'] !== $date || substr((string)$old['start_time'], 0, 5) !== $start
            || substr((string)$old['end_time'], 0, 5) !== $end || (int)$old['slot_minutes'] !== $slot || (int)$old['gap_minutes'] !== $gap;
        $slots = self::cut($date, $start, $end, $slot, $gap);
        if ($timingChanged) {
            if (!$slots) {
                throw new \InvalidArgumentException('The time window is shorter than one slot.');
            }
            if (count($slots) > self::MAX_SLOTS) {
                throw new \InvalidArgumentException('That makes ' . count($slots) . ' slots; the limit is ' . self::MAX_SLOTS . '. Use longer slots or a shorter window.');
            }
            if (self::minutesUntil($client, $date . ' ' . $start . ':00') <= 0) {
                throw new \InvalidArgumentException('The session must start in the future.');
            }
            if ($old && self::activeBookings($client, $id) > 0) {
                throw new \DomainException('Parents have already booked this session, so its date and times can\'t change. Change the details, or cancel the session and publish a new one.');
            }
            $clash = self::db()->execute(
                "SELECT title, start_time, end_time FROM ssms_ptm_sessions WHERE ssms_client_code = ? AND staff_id = ? AND meet_date = ? AND status <> 'cancelled'
                    AND id <> ? AND start_time < ? AND end_time > ? LIMIT 1",
                [$client, $staffId, $date, $id, $end . ':00', $start . ':00'])->fetch('assoc');
            if ($clash) {
                throw new \DomainException('This teacher already has "' . $clash['title'] . '" from ' . substr((string)$clash['start_time'], 0, 5) . ' to '
                    . substr((string)$clash['end_time'], 0, 5) . ' that day.');
            }
        }

        $id = self::tx(function () use ($client, $acc, $old, $id, $timingChanged, $slots, $staffId, $title, $date, $start, $end, $slot, $gap, $mode, $location, $audience, $closes, $note, $status) {
        if ($old) {
            // lock the session so no booking can slip in while the slots are rebuilt
            self::db()->execute('SELECT id FROM ssms_ptm_sessions WHERE id = ? AND ssms_client_code = ? FOR UPDATE', [$id, $client]);
            if ($timingChanged && self::activeBookings($client, $id) > 0) {
                throw new \DomainException('Parents have already booked this session, so its date and times can\'t change. Change the details, or cancel the session and publish a new one.');
            }
        }
        $now = AccountSecurity::now();
        $vals = ['staff_id' => $staffId, 'title' => $title, 'meet_date' => $date, 'start_time' => $start . ':00', 'end_time' => $end . ':00',
                 'slot_minutes' => $slot, 'gap_minutes' => $gap, 'mode' => $mode, 'location' => $location !== '' ? $location : null,
                 'audience' => $audience !== null ? json_encode($audience) : null, 'closes_hours' => $closes,
                 'note_for_parents' => $note !== '' ? $note : null, 'status' => $status];
        if ($old) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($vals)));
            self::db()->execute("UPDATE ssms_ptm_sessions SET $set, modified = ? WHERE id = ? AND ssms_client_code = ?", array_merge(array_values($vals), [$now, $id, $client]));
        } else {
            $cols = array_keys($vals);
            self::db()->execute('INSERT INTO ssms_ptm_sessions (ssms_client_code, ' . implode(', ', $cols) . ', created_by, created, modified) VALUES (?, '
                . implode(', ', array_fill(0, count($cols), '?')) . ', ?, ?, ?)', array_merge([$client], array_values($vals), [mb_substr($acc['user'], 0, 100), $now, $now]));
            $id = self::lastId();
        }
        if ($timingChanged) {
            // keep rows that cancelled bookings point to (history) and blocked times; drop the rest
            $existing = [];
            foreach (self::q('SELECT sl.id, sl.start_at, sl.status, (SELECT COUNT(*) FROM ssms_ptm_bookings b WHERE b.slot_id = sl.id) refs
                               FROM ssms_ptm_slots sl WHERE sl.session_id = ? AND sl.ssms_client_code = ?', [$id, $client]) as $r) {
                $existing[(string)$r['start_at']] = $r;
            }
            foreach ($slots as [$a, $b]) {
                if (isset($existing[$a])) {
                    $e = $existing[$a];
                    self::db()->execute('UPDATE ssms_ptm_slots SET end_at = ?, status = ? WHERE id = ? AND ssms_client_code = ?',
                        [$b, $e['status'] === 'blocked' ? 'blocked' : 'open', (int)$e['id'], $client]);
                    unset($existing[$a]);
                } else {
                    self::db()->execute('INSERT INTO ssms_ptm_slots (ssms_client_code, session_id, start_at, end_at, status) VALUES (?, ?, ?, ?, ?)', [$client, $id, $a, $b, 'open']);
                }
            }
            foreach ($existing as $e) {
                if ((int)$e['refs'] > 0) {
                    self::db()->execute("UPDATE ssms_ptm_slots SET status = 'retired' WHERE id = ? AND ssms_client_code = ?", [(int)$e['id'], $client]);
                } else {
                    self::db()->execute('DELETE FROM ssms_ptm_slots WHERE id = ? AND ssms_client_code = ?', [(int)$e['id'], $client]);
                }
            }
        }

        return $id;
        });

        return ['session' => self::session($client, $id, $acc), 'is_new' => !$old];
    }

    /** [[start, end], …] local Y-m-d H:i:s */
    public static function cut(string $date, string $start, string $end, int $slot, int $gap): array
    {
        // wall-clock arithmetic in UTC, so a daylight-saving change on the server can't skip or repeat slots
        $utc = new \DateTimeZone('UTC');
        $out = [];
        $t = (new \DateTimeImmutable("$date $start:00", $utc))->getTimestamp();
        $stop = (new \DateTimeImmutable("$date $end:00", $utc))->getTimestamp();
        $fmt = fn(int $x) => (new \DateTimeImmutable('@' . $x))->setTimezone($utc)->format('Y-m-d H:i:s');
        while ($t + $slot * 60 <= $stop && count($out) <= self::MAX_SLOTS) {
            $out[] = [$fmt($t), $fmt($t + $slot * 60)];
            $t += ($slot + $gap) * 60;
        }

        return $out;
    }

    /** null = the teacher's own classes; otherwise a checked list of {class_id, section_id|null}. */
    private static function audience(string $client, $raw): ?array
    {
        if ($raw === null || $raw === '' || $raw === []) {
            return null;
        }
        if (is_string($raw)) {
            $raw = json_decode($raw, true);
        }
        if (!is_array($raw)) {
            throw new \InvalidArgumentException('Choose the classes.');
        }
        $out = [];
        foreach ($raw as $a) {
            $c = (int)($a['class_id'] ?? 0);
            $s = isset($a['section_id']) && $a['section_id'] !== '' && $a['section_id'] !== null ? (int)$a['section_id'] : null;
            if (!$c || !self::db()->execute('SELECT 1 FROM ssms_classes WHERE class_id = ? AND (ssms_client_code = ? OR ssms_client_code IS NULL)', [$c, $client])->fetch('assoc')) {
                throw new \InvalidArgumentException('One of the classes was not found.');
            }
            if ($s !== null && !self::db()->execute('SELECT 1 FROM ssms_sections WHERE section_id = ? AND class_id = ? AND ssms_client_code = ?', [$s, $c, $client])->fetch('assoc')) {
                throw new \InvalidArgumentException('One of the sections was not found.');
            }
            $out[$c . '|' . (int)$s] = ['class_id' => $c, 'section_id' => $s];
        }

        return array_values($out) ?: null;
    }

    public static function cancelSession(string $client, array $acc, int $id, string $reason): array
    {
        $s = self::sessionRow($client, $id);
        if (!$s) {
            throw new \InvalidArgumentException('Session not found.');
        }
        $mine = $acc['staff_id'] !== null && (int)$s['staff_id'] === (int)$acc['staff_id'];
        if (!(($mine && $acc['edit']) || $acc['delete'])) {
            throw new \DomainException('Only the teacher, or someone allowed to cancel any session, can cancel this one.');
        }
        $reason = self::text($reason, 300);
        $books = self::tx(function () use ($client, $id, $acc, $reason) {
            $cur = self::db()->execute('SELECT status FROM ssms_ptm_sessions WHERE id = ? AND ssms_client_code = ? FOR UPDATE', [$id, $client])->fetch('assoc');
            if (($cur['status'] ?? '') === 'cancelled') {
                throw new \DomainException('This session is already cancelled.');
            }
            $now = AccountSecurity::now();
            $books = self::q("SELECT b.*, sl.start_at FROM ssms_ptm_bookings b JOIN ssms_ptm_slots sl ON sl.id = b.slot_id
                               WHERE b.session_id = ? AND b.ssms_client_code = ? AND b.active = 1 AND b.status = 'booked'", [$id, $client]);
            self::db()->execute("UPDATE ssms_ptm_bookings SET status = 'cancelled', active = NULL, cancelled_by = ?, cancelled_by_role = ?, cancel_reason = ?, modified = ?
                                  WHERE session_id = ? AND ssms_client_code = ? AND active = 1 AND status = 'booked'",
                [mb_substr($acc['user'], 0, 100), $acc['role'], $reason ?: 'Session cancelled', $now, $id, $client]);
            self::db()->execute("UPDATE ssms_ptm_slots SET status = 'open' WHERE session_id = ? AND ssms_client_code = ? AND status = 'booked'", [$id, $client]);
            self::db()->execute("UPDATE ssms_ptm_sessions SET status = 'cancelled', cancel_reason = ?, modified = ? WHERE id = ? AND ssms_client_code = ?", [$reason ?: null, $now, $id, $client]);

            return $books;
        });
        $teacher = self::staffName($client, (int)$s['staff_id']);
        $msgs = [];
        foreach ($books as $b) {
            foreach (self::familyTokens($client, $b) as $tok) {
                $msgs[] = Locale::withLang(Locale::langForToken($client, $tok), fn() => self::msg($tok, Locale::t($client, 'Meeting cancelled'), Locale::t($client, 'Your meeting with {teacher} on {when} was cancelled.', ['teacher' => $teacher, 'when' => self::when($b['start_at'], $client)])
                    . ($reason ? ' ' . $reason : '') . ' ' . Locale::t($client, 'Please book another time if needed.')));
            }
        }
        self::send($msgs);

        return ['cancelled_bookings' => count($books), 'session' => $s];
    }

    /** Sessions for the staff screen: mine, or every teacher's (office). */
    public static function staffSessions(string $client, array $acc, array $f = []): array
    {
        $now = self::now($client);
        $sql = "SELECT s.*, st.first_name, st.last_name,
                       (SELECT COUNT(*) FROM ssms_ptm_slots x WHERE x.session_id = s.id AND x.status <> 'retired') slots,
                       (SELECT COUNT(*) FROM ssms_ptm_bookings b WHERE b.session_id = s.id AND b.active = 1) booked
                  FROM ssms_ptm_sessions s LEFT JOIN ssms_staff st ON st.staff_id = s.staff_id AND st.ssms_client_code = s.ssms_client_code
                 WHERE s.ssms_client_code = ?";
        $p = [$client];
        $scope = (string)($f['scope'] ?? 'mine');
        if ($scope !== 'all' || !$acc['all']) {
            $sql .= ' AND s.staff_id = ?';
            $p[] = (int)($acc['staff_id'] ?? 0);
        }
        if (($f['when'] ?? 'upcoming') === 'past') {
            $sql .= ' AND s.meet_date < ? ORDER BY s.meet_date DESC, s.start_time DESC LIMIT 200';
        } else {
            $sql .= ' AND s.meet_date >= ? ORDER BY s.meet_date, s.start_time LIMIT 300';
        }
        $p[] = substr($now, 0, 10);

        return array_map(fn($r) => self::castSession($client, $r), self::q($sql, $p));
    }

    /** One session with every slot and its booking (staff). */
    public static function session(string $client, int $id, array $acc): array
    {
        $r = self::db()->execute('SELECT s.*, st.first_name, st.last_name FROM ssms_ptm_sessions s
                LEFT JOIN ssms_staff st ON st.staff_id = s.staff_id AND st.ssms_client_code = s.ssms_client_code
               WHERE s.id = ? AND s.ssms_client_code = ?', [$id, $client])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Session not found.');
        }
        $mine = $acc['staff_id'] !== null && (int)$r['staff_id'] === (int)$acc['staff_id'];
        if (!$mine && !$acc['all']) {
            throw new \DomainException('You can only see your own sessions.');
        }
        $s = self::castSession($client, $r);
        $s['can_manage'] = ($mine && $acc['edit']) || $acc['all'];
        $s['slot_list'] = array_map(function ($x) use ($client) {
            $slot = ['id' => (int)$x['id'], 'start_at' => $x['start_at'], 'end_at' => $x['end_at'], 'status' => $x['status'], 'booking' => null];
            if ($x['b_id']) {
                $slot['booking'] = ['id' => (int)$x['b_id'], 'enrollment_id' => $x['enrollment_id'], 'student_name' => trim($x['student_first_name'] . ' ' . $x['student_last_name']),
                    'class_name' => trim(($x['class_name'] ?? '') . ' ' . ($x['section_name'] ?? '')), 'parent_name' => $x['parent_name'], 'parent_phone' => $x['parent_phone'],
                    'topic' => $x['topic'], 'status' => $x['b_status'], 'teacher_note' => $x['teacher_note'], 'booked_by_role' => $x['booked_by_role']];
            }

            return $slot;
        }, self::q("SELECT sl.*, b.id b_id, b.enrollment_id, b.parent_name, b.parent_phone, b.topic, b.status b_status, b.teacher_note, b.booked_by_role,
                           r.student_first_name, r.student_last_name, c.class_name, sec.section_name
                      FROM ssms_ptm_slots sl
                 LEFT JOIN ssms_ptm_bookings b ON b.slot_id = sl.id AND b.active = 1
                 LEFT JOIN ssms_student_enrollment e ON e.enrollment_id = b.enrollment_id AND e.ssms_client_code = sl.ssms_client_code
                 LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id AND r.ssms_client_code = sl.ssms_client_code
                 LEFT JOIN ssms_classes c ON c.class_id = e.class_id
                 LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
                     WHERE sl.session_id = ? AND sl.ssms_client_code = ? AND sl.status <> 'retired' ORDER BY sl.start_at", [$id, $client]));

        return $s;
    }

    /** Block a free slot (e.g. a break) or open it again. */
    public static function setSlot(string $client, array $acc, int $slotId, bool $block): array
    {
        $sl = self::db()->execute('SELECT * FROM ssms_ptm_slots WHERE id = ? AND ssms_client_code = ?', [$slotId, $client])->fetch('assoc');
        if (!$sl) {
            throw new \InvalidArgumentException('Slot not found.');
        }
        $s = self::sessionRow($client, (int)$sl['session_id']);
        self::mayManage($acc, $s);
        $n = self::db()->execute('UPDATE ssms_ptm_slots SET status = ? WHERE id = ? AND ssms_client_code = ? AND status = ?', [$block ? 'blocked' : 'open', $slotId, $client, $block ? 'open' : 'blocked'])->rowCount();
        if ($n < 1) {
            throw new \DomainException($sl['status'] === 'booked' ? 'This slot is booked. Cancel the booking first.' : 'The slot has already changed. Pull to refresh.');
        }

        return self::session($client, (int)$sl['session_id'], $acc);
    }

    /** Mark a meeting held / missed and keep a private note. */
    public static function markBooking(string $client, array $acc, int $bookingId, ?string $status, ?string $note): array
    {
        $b = self::bookingRow($client, $bookingId);
        if (!$b || (int)$b['active'] !== 1) {
            throw new \InvalidArgumentException('Booking not found.');
        }
        self::mayManage($acc, self::sessionRow($client, (int)$b['session_id']));
        $vals = [];
        if ($status !== null && $status !== '') {
            if (!in_array($status, ['booked', 'attended', 'no_show'], true)) {
                throw new \InvalidArgumentException('Choose held, missed or booked.');
            }
            if ($status !== 'booked' && self::minutesUntil($client, (string)$b['start_at']) > 0) {
                throw new \DomainException('You can mark the meeting once its time has started.');
            }
            $vals['status'] = $status;
        }
        if ($note !== null) {
            $vals['teacher_note'] = self::text($note, 4000) ?: null;
        }
        if ($vals) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($vals)));
            self::db()->execute("UPDATE ssms_ptm_bookings SET $set, modified = ? WHERE id = ? AND ssms_client_code = ?", array_merge(array_values($vals), [AccountSecurity::now(), $bookingId, $client]));
        }

        return self::session($client, (int)$b['session_id'], $acc);
    }

    // ── Parents ─────────────────────────────────────────────────────────────

    /** The children this parent / student account can book for (same rule as absence notes). */
    public static function myChildren(string $client, string $role, string $user, ?string $jwtEnrollment): array
    {
        return StudentLeave::myEnrollmentIds($client, $role, $user, $jwtEnrollment);
    }

    /** Sessions a child can book: teachers of the child's class / section, open, in the future. */
    public static function available(string $client, string $enrollmentId, ?string $bookedBy = null): array
    {
        $stu = StudentLeave::enrollment($client, $enrollmentId);
        if (!$stu) {
            throw new \InvalidArgumentException('Student not found.');
        }
        $now = self::now($client);
        $rows = self::q("SELECT s.*, st.first_name, st.last_name FROM ssms_ptm_sessions s
                           JOIN ssms_staff st ON st.staff_id = s.staff_id AND st.ssms_client_code = s.ssms_client_code
                          WHERE s.ssms_client_code = ? AND s.status = 'open' AND s.meet_date >= ?
                          ORDER BY s.meet_date, s.start_time", [$client, substr($now, 0, 10)]);
        $out = [];
        foreach ($rows as $r) {
            if (!self::inAudience($client, $r, (int)$stu['class_id'], $stu['section_id'] !== null ? (int)$stu['section_id'] : null)) {
                continue;
            }
            $sess = self::castSession($client, $r, false);
            $sess['subjects'] = self::subjectsFor($client, (int)$r['staff_id'], (int)$stu['class_id'], $stu['section_id'] !== null ? (int)$stu['section_id'] : null);
            $mine = self::db()->execute("SELECT b.id, sl.start_at, sl.end_at FROM ssms_ptm_bookings b JOIN ssms_ptm_slots sl ON sl.id = b.slot_id
                    WHERE b.session_id = ? AND b.enrollment_id = ? AND b.active = 1 LIMIT 1", [(int)$r['id'], $enrollmentId])->fetch('assoc');
            $sess['my_booking'] = $mine ? ['id' => (int)$mine['id'], 'start_at' => $mine['start_at'], 'end_at' => $mine['end_at']] : null;
            $closeMin = (int)$r['closes_hours'] * 60;
            $sess['free_slots'] = array_values(array_map(fn($x) => ['id' => (int)$x['id'], 'start_at' => $x['start_at'], 'end_at' => $x['end_at']],
                array_filter(self::q("SELECT id, start_at, end_at FROM ssms_ptm_slots WHERE session_id = ? AND ssms_client_code = ? AND status = 'open' ORDER BY start_at",
                    [(int)$r['id'], $client]), fn($x) => self::minutesUntil($client, (string)$x['start_at']) >= max(1, $closeMin))));
            if (!$sess['free_slots'] && !$sess['my_booking']) {
                continue;   // nothing to book and nothing booked
            }
            // the video link is only given to people who have booked
            if ($sess['mode'] === 'video' && !$sess['my_booking']) {
                $sess['location'] = null;
            }
            $out[] = $sess;
        }

        return ['student' => ['enrollment_id' => $enrollmentId, 'name' => $stu['student_name'],
                              'class_name' => trim(($stu['class_name'] ?? '') . ' ' . ($stu['section_name'] ?? ''))], 'sessions' => $out];
    }

    /**
     * Book a slot for a child. Parents: their own children. Staff who manage the session can
     * book for any student in its classes (e.g. a parent who phoned).
     */
    public static function book(string $client, int $slotId, string $enrollmentId, string $by, string $byRole, ?string $topic, ?array $staffAcc = null): array
    {
        $sl = self::db()->execute('SELECT sl.*, s.status s_status, s.closes_hours, s.staff_id, s.audience, s.title FROM ssms_ptm_slots sl
                JOIN ssms_ptm_sessions s ON s.id = sl.session_id WHERE sl.id = ? AND sl.ssms_client_code = ?', [$slotId, $client])->fetch('assoc');
        if (!$sl) {
            throw new \InvalidArgumentException('That time is no longer available.');
        }
        if ($staffAcc !== null) {
            self::mayManage($staffAcc, self::sessionRow($client, (int)$sl['session_id']));
        }
        if ($sl['s_status'] !== 'open') {
            throw new \DomainException('Booking for this session is closed.');
        }
        $stu = StudentLeave::enrollment($client, $enrollmentId);
        if (!$stu) {
            throw new \InvalidArgumentException('Student not found.');
        }
        if (!self::inAudience($client, $sl, (int)$stu['class_id'], $stu['section_id'] !== null ? (int)$stu['section_id'] : null)) {
            throw new \DomainException('This teacher\'s meetings are for other classes.');
        }
        $mins = self::minutesUntil($client, (string)$sl['start_at']);
        if ($staffAcc === null && $mins < (int)$sl['closes_hours'] * 60) {
            throw new \DomainException('Booking for this time has closed.');
        }
        if ($mins <= 0) {
            throw new \DomainException('This time has already passed.');
        }
        $already = self::db()->execute('SELECT 1 FROM ssms_ptm_bookings WHERE session_id = ? AND enrollment_id = ? AND active = 1', [(int)$sl['session_id'], $enrollmentId])->fetch('assoc');
        if ($already) {
            throw new \DomainException($stu['student_name'] . ' already has a meeting in this session. Cancel it first to choose another time.');
        }
        [$pName, $pPhone] = self::parentContact($client, $by, $byRole, $stu);
        try {
            $byStaff = $staffAcc !== null;
            $id = self::tx(function () use ($client, $sl, $slotId, $enrollmentId, $by, $byRole, $pName, $pPhone, $topic, $byStaff) {
                // the session row is locked, so it can't be cancelled or re-timed while we book
                $cur = self::db()->execute('SELECT * FROM ssms_ptm_sessions WHERE id = ? AND ssms_client_code = ? FOR UPDATE', [(int)$sl['session_id'], $client])->fetch('assoc');
                if (($cur['status'] ?? '') !== 'open') {
                    throw new \DomainException('Booking for this session is closed.');
                }
                // read again under the lock: the teacher may have changed classes or the cut-off a moment ago
                $stu = StudentLeave::enrollment($client, $enrollmentId);
                if (!$stu || !self::inAudience($client, $cur, (int)$stu['class_id'], $stu['section_id'] !== null ? (int)$stu['section_id'] : null)) {
                    throw new \DomainException('This teacher\'s meetings are for other classes.');
                }
                $slotNow = self::db()->execute('SELECT start_at FROM ssms_ptm_slots WHERE id = ? AND ssms_client_code = ?', [$slotId, $client])->fetch('assoc');
                if (!$slotNow) {
                    throw new \DomainException('Sorry, that time has just been taken or changed. Please choose another.');
                }
                $minsNow = self::minutesUntil($client, (string)$slotNow['start_at']);
                if ($minsNow <= 0 || (!$byStaff && $minsNow < (int)$cur['closes_hours'] * 60)) {
                    throw new \DomainException('Booking for this time has closed.');
                }
                // claim the slot – only one request can win
                $won = self::db()->execute("UPDATE ssms_ptm_slots SET status = 'booked' WHERE id = ? AND ssms_client_code = ? AND status = 'open'", [$slotId, $client])->rowCount();
                if ($won < 1) {
                    throw new \DomainException('Sorry, that time has just been taken or changed. Please choose another.');
                }
                $now = AccountSecurity::now();
                self::db()->execute(
                    'INSERT INTO ssms_ptm_bookings (ssms_client_code, session_id, slot_id, enrollment_id, registration_id, booked_by, booked_by_role, parent_name, parent_phone,
                         topic, status, active, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
                    [$client, (int)$sl['session_id'], $slotId, $enrollmentId, self::regOf($client, $enrollmentId), mb_substr($by, 0, 100), mb_substr($byRole, 0, 20),
                     $pName, $pPhone, self::text($topic ?? '', 500) ?: null, 'booked', $now, $now]
                );

                return self::lastId();
            });
        } catch (\Throwable $e) {
            if (stripos($e->getMessage(), 'Duplicate') !== false) {
                throw new \DomainException($stu['student_name'] . ' already has a meeting in this session.');
            }
            throw $e;
        }
        $msgs = [];
        foreach (self::tokensOfStaff($client, (int)$sl['staff_id']) as $tok) {
            $msgs[] = Locale::withLang(Locale::langForToken($client, $tok), fn() => self::msg($tok, Locale::t($client, 'New meeting booked'), Locale::t($client, "{student}'s parent booked {when}", ['student' => $stu['student_name'], 'when' => self::when($sl['start_at'], $client)])
                . ($topic ? ' – ' . mb_substr(self::text($topic, 80), 0, 80) : ''), ['screen' => 'Meetings']));
        }
        if ($staffAcc !== null) {
            foreach (self::tokensOfParents($client, $enrollmentId) as $tok) {
                $msgs[] = Locale::withLang(Locale::langForToken($client, $tok), fn() => self::msg($tok, Locale::t($client, 'Meeting booked for you'), Locale::t($client, 'The school booked a meeting with {teacher} on {when} about {student}.',
                    ['teacher' => self::staffName($client, (int)$sl['staff_id']), 'when' => self::when($sl['start_at'], $client), 'student' => $stu['student_name']]), ['screen' => 'MyMeetings']));
            }
        }
        self::send($msgs);

        return self::bookingView($client, $id, $staffAcc !== null);
    }

    /** Cancel a booking. Parents: their own children, until the booking cut-off. Staff: the session's teacher or the office. */
    public static function cancelBooking(string $client, int $bookingId, string $by, string $byRole, ?string $reason, ?array $staffAcc, array $myChildren = []): array
    {
        $b = self::bookingRow($client, $bookingId);
        if (!$b || (int)$b['active'] !== 1) {
            throw new \InvalidArgumentException('Booking not found.');
        }
        if ($staffAcc !== null) {
            self::mayManage($staffAcc, self::sessionRow($client, (int)$b['session_id']));
        } else {
            if (!in_array((string)$b['enrollment_id'], $myChildren, true)) {
                throw new \DomainException('You can only cancel your own child\'s meetings.');
            }
            $mins = self::minutesUntil($client, (string)$b['start_at']);
            if ($mins < max(1, (int)$b['closes_hours']) * 60) {
                throw new \DomainException('It\'s too close to the meeting to cancel in the app. Please call the school.');
            }
        }
        if ($b['status'] !== 'booked') {
            throw new \DomainException('This meeting has already been marked as ' . ($b['status'] === 'attended' ? 'held' : 'missed') . '.');
        }
        $now = AccountSecurity::now();
        $done = self::db()->execute("UPDATE ssms_ptm_bookings SET status = 'cancelled', active = NULL, cancelled_by = ?, cancelled_by_role = ?, cancel_reason = ?, modified = ?
                              WHERE id = ? AND ssms_client_code = ? AND active = 1 AND status = 'booked'",
            [mb_substr($by, 0, 100), mb_substr($byRole, 0, 20), self::text($reason ?? '', 300) ?: null, $now, $bookingId, $client])->rowCount();
        if ($done < 1) {
            throw new \DomainException('This meeting has already been cancelled.');
        }
        // free the slot – unless someone else has booked it in the meantime
        self::db()->execute("UPDATE ssms_ptm_slots SET status = 'open' WHERE id = ? AND ssms_client_code = ? AND status = 'booked'
                               AND NOT EXISTS (SELECT 1 FROM ssms_ptm_bookings x WHERE x.slot_id = ? AND x.active = 1)", [(int)$b['slot_id'], $client, (int)$b['slot_id']]);
        $stu = StudentLeave::enrollment($client, (string)$b['enrollment_id']);
        $name = $stu['student_name'] ?? null;
        $msgs = [];
        if ($staffAcc !== null) {
            foreach (self::familyTokens($client, $b) as $tok) {
                $msgs[] = Locale::withLang(Locale::langForToken($client, $tok), fn() => self::msg($tok, Locale::t($client, 'Meeting cancelled'), Locale::t($client, 'Your meeting with {teacher} on {when} was cancelled by the school.',
                    ['teacher' => self::staffName($client, (int)$b['staff_id']), 'when' => self::when($b['start_at'], $client)]) . ($reason ? ' ' . self::text($reason, 120) : ''), ['screen' => 'MyMeetings']));
            }
        } else {
            foreach (self::tokensOfStaff($client, (int)$b['staff_id']) as $tok) {
                $msgs[] = Locale::withLang(Locale::langForToken($client, $tok), fn() => self::msg($tok, Locale::t($client, 'Meeting cancelled'), Locale::t($client, "{student}'s parent cancelled {when}.", ['student' => $name ?? Locale::t($client, 'A student'), 'when' => self::when($b['start_at'], $client)]), ['screen' => 'Meetings']));
            }
        }
        self::send($msgs);

        return ['booking_id' => $bookingId, 'student' => $name, 'start_at' => $b['start_at'], 'session_id' => (int)$b['session_id']];
    }

    /** Upcoming and recent meetings of a parent's children. */
    public static function myBookings(string $client, array $children, bool $withTopic = true): array
    {
        if (!$children) {
            return [];
        }
        $in = implode(',', array_fill(0, count($children), '?'));
        $since = date('Y-m-d H:i:s', strtotime(self::now($client)) - 30 * 86400);
        $rows = self::q("SELECT b.id FROM ssms_ptm_bookings b JOIN ssms_ptm_slots sl ON sl.id = b.slot_id
                          WHERE b.ssms_client_code = ? AND b.enrollment_id IN ($in) AND sl.start_at >= ?
                          ORDER BY sl.start_at DESC LIMIT 100", array_merge([$client], $children, [$since]));

        return array_map(function ($r) use ($client, $withTopic) {
            $v = self::bookingView($client, (int)$r['id'], false);
            if (!$withTopic) {
                $v['topic'] = null;   // students don't see what their parent wrote
            }

            return $v;
        }, $rows);
    }

    /** A booking as the parent sees it (no teacher note). */
    public static function bookingView(string $client, int $id, bool $forStaff): array
    {
        $b = self::bookingRow($client, $id);
        $stu = StudentLeave::enrollment($client, (string)$b['enrollment_id']);
        $mins = self::minutesUntil($client, (string)$b['start_at']);
        $out = ['id' => (int)$b['id'], 'session_id' => (int)$b['session_id'], 'title' => $b['title'], 'teacher' => self::staffName($client, (int)$b['staff_id']),
                'start_at' => $b['start_at'], 'end_at' => $b['end_at'], 'mode' => $b['mode'], 'mode_label' => self::MODES[$b['mode']] ?? $b['mode'],
                'location' => $b['status'] === 'cancelled' ? null : $b['location'], 'note_for_parents' => $b['note_for_parents'], 'status' => $b['status'], 'topic' => $b['topic'],
                'cancel_reason' => $b['cancel_reason'], 'cancelled_by_role' => $b['cancelled_by_role'],
                'student' => ['enrollment_id' => $b['enrollment_id'], 'name' => $stu['student_name'] ?? '',
                              'class_name' => trim(($stu['class_name'] ?? '') . ' ' . ($stu['section_name'] ?? ''))],
                'upcoming' => $mins > 0, 'can_cancel' => (int)$b['active'] === 1 && $b['status'] === 'booked' && $mins >= max(1, (int)$b['closes_hours']) * 60];
        if ($forStaff) {
            $out['teacher_note'] = $b['teacher_note'];
        }

        return $out;
    }

    // ── Reminders ───────────────────────────────────────────────────────────

    /**
     * Day-before and hour-before reminders to the parent who booked and to the teacher.
     * Each is sent once (claimed in the database first). Safe to run as often as you like.
     */
    public static function remindDue(?string $client = null): int
    {
        // schools with something to remind (wide window in server time, wide enough for any time zone)
        $utc = fn(int $t) => (new \DateTimeImmutable('@' . $t))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        if ($client !== null) {
            $codes = [$client];
        } else {
            $codes = array_column(self::q("SELECT DISTINCT b.ssms_client_code FROM ssms_ptm_bookings b JOIN ssms_ptm_slots sl ON sl.id = b.slot_id
                    WHERE b.active = 1 AND b.status = 'booked' AND (b.reminded_day_at IS NULL OR b.reminded_hour_at IS NULL)
                      AND sl.start_at BETWEEN ? AND ?", [$utc(AccountSecurity::time() - 15 * 3600), $utc(AccountSecurity::time() + 39 * 3600)]), 'ssms_client_code');
        }
        $rows = [];
        foreach ($codes as $code) {
            // exactly the next 24 h on that school's own clock – meetings that already started are never in the list
            $from = self::now((string)$code);
            $to = (new \DateTimeImmutable('@' . (AccountSecurity::time() + 24 * 3600 + 300)))->setTimezone(self::tz((string)$code))->format('Y-m-d H:i:s');
            foreach (self::q("SELECT b.*, sl.start_at, s.staff_id, s.mode, s.location, s.title FROM ssms_ptm_bookings b
                      JOIN ssms_ptm_slots sl ON sl.id = b.slot_id JOIN ssms_ptm_sessions s ON s.id = b.session_id
                     WHERE b.ssms_client_code = ? AND b.active = 1 AND b.status = 'booked' AND s.status <> 'cancelled'
                       AND (b.reminded_day_at IS NULL OR b.reminded_hour_at IS NULL)
                       AND sl.start_at > ? AND sl.start_at <= ? ORDER BY sl.start_at LIMIT 2000", [$code, $from, $to]) as $r) {
                $rows[] = $r;
            }
        }
        $sent = 0;
        foreach ($rows as $b) {
            $code = (string)$b['ssms_client_code'];
            $mins = self::minutesUntil($code, (string)$b['start_at']);
            $kind = null;
            if ($mins > 0 && $mins <= 75 && $b['reminded_hour_at'] === null) {
                $kind = 'hour';
            } elseif ($mins > 75 && $mins <= 24 * 60 && $b['reminded_day_at'] === null
                && (AccountSecurity::time() - strtotime((string)$b['created'])) > 3600) {   // not right after booking (both server time)
                $kind = 'day';
            }
            if ($kind === null) {
                continue;
            }
            $col = $kind === 'hour' ? 'reminded_hour_at' : 'reminded_day_at';
            $claimed = self::db()->execute("UPDATE ssms_ptm_bookings SET $col = ? WHERE id = ? AND ssms_client_code = ? AND $col IS NULL", [AccountSecurity::now(), (int)$b['id'], $code])->rowCount();
            if ($claimed < 1) {
                continue;
            }
            if ($kind === 'hour') {
                // the day reminder is no longer useful once the hour one has gone
                self::db()->execute('UPDATE ssms_ptm_bookings SET reminded_day_at = COALESCE(reminded_day_at, ?) WHERE id = ? AND ssms_client_code = ?', [AccountSecurity::now(), (int)$b['id'], $code]);
            }
            $stu = StudentLeave::enrollment($code, (string)$b['enrollment_id']);
            $teacher = self::staffName($code, (int)$b['staff_id']);
            // written per phone, in that person's language
            $where = fn() => $b['mode'] === 'in_person' ? ($b['location'] ? ' – ' . $b['location'] : '') : ' (' . Locale::t($code, (string)(self::MODES[$b['mode']] ?? '')) . ')';
            $whenTxt = fn() => $kind === 'hour' ? Locale::t($code, 'at {time}', ['time' => Locale::time($code, substr((string)$b['start_at'], 11, 5))]) : self::when((string)$b['start_at'], $code);
            $msgs = [];
            foreach (self::familyTokens($code, $b) as $tok) {
                $msgs[] = Locale::withLang(Locale::langForToken($code, $tok), fn() => self::msg($tok, Locale::t($code, $kind === 'hour' ? 'Meeting soon' : 'Meeting reminder'),
                    Locale::t($code, 'Meeting with {teacher} about {student} {when}', ['teacher' => $teacher, 'student' => $stu['student_name'] ?? Locale::t($code, 'your child'), 'when' => $whenTxt()]) . $where() . '.', ['screen' => 'MyMeetings']));
            }
            foreach (self::tokensOfStaff($code, (int)$b['staff_id']) as $tok) {
                $msgs[] = Locale::withLang(Locale::langForToken($code, $tok), fn() => self::msg($tok, Locale::t($code, $kind === 'hour' ? 'Meeting soon' : 'Meeting reminder'),
                    Locale::t($code, "Meeting with {student}'s parent {when}.", ['student' => $stu['student_name'] ?? Locale::t($code, 'a student'), 'when' => $whenTxt()]), ['screen' => 'Meetings']));
            }
            self::send($msgs);
            $sent++;
        }

        return $sent;
    }

    /** At most once a minute per school, when someone opens the meetings screens. */
    public static function remindIfDue(string $client): void
    {
        try {
            $file = (defined('TMP') ? TMP : sys_get_temp_dir() . DIRECTORY_SEPARATOR) . 'ptm_remind_' . preg_replace('/[^A-Za-z0-9_-]/', '', $client);
            $t = @filemtime($file);
            if ($t !== false && AccountSecurity::time() - $t < 60) {
                return;
            }
            @touch($file);
            self::remindDue($client);
        } catch (\Throwable $e) {
            Log::warning('Meetings reminders: ' . $e->getMessage());
        }
    }

    // ── Privacy ─────────────────────────────────────────────────────────────

    public static function exportFor(string $client, array $enrollmentIds, string $level = 'parent'): array
    {
        if (!$enrollmentIds) {
            return [];
        }
        try {
            $in = implode(',', array_fill(0, count($enrollmentIds), '?'));

            return array_map(fn($r) => ['date' => $r['start_at'], 'teacher' => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')),
                'meeting' => $r['title'], 'status' => $r['status'], 'topic' => $level === 'student' ? null : $r['topic']], self::q(
                "SELECT b.status, b.topic, sl.start_at, s.title, st.first_name, st.last_name FROM ssms_ptm_bookings b
                   JOIN ssms_ptm_slots sl ON sl.id = b.slot_id JOIN ssms_ptm_sessions s ON s.id = b.session_id
              LEFT JOIN ssms_staff st ON st.staff_id = s.staff_id AND st.ssms_client_code = s.ssms_client_code
                  WHERE b.enrollment_id IN ($in) AND b.ssms_client_code = ? ORDER BY sl.start_at", array_merge($enrollmentIds, [$client])));
        } catch (\Throwable $e) {
            return [];
        }
    }

    public static function eraseFor(string $client, array $enrollmentIds): bool
    {
        if (!$enrollmentIds) {
            return false;
        }
        try {
            $in = implode(',', array_fill(0, count($enrollmentIds), '?'));
            $p = array_merge($enrollmentIds, [$client]);
            self::db()->execute("UPDATE ssms_ptm_slots sl JOIN ssms_ptm_bookings b ON b.slot_id = sl.id AND b.active = 1
                                    SET sl.status = 'open' WHERE b.enrollment_id IN ($in) AND b.ssms_client_code = ?", $p);
            self::db()->execute("DELETE FROM ssms_ptm_bookings WHERE enrollment_id IN ($in) AND ssms_client_code = ?", $p);

            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static function mayManage(array $acc, ?array $s): void
    {
        if (!$s) {
            throw new \InvalidArgumentException('Session not found.');
        }
        $mine = $acc['staff_id'] !== null && (int)$s['staff_id'] === (int)$acc['staff_id'];
        if (!(($mine && $acc['edit']) || $acc['all'])) {
            throw new \DomainException('Only the teacher or the school office can change this session.');
        }
    }

    private static function inAudience(string $client, array $session, int $classId, ?int $sectionId): bool
    {
        $aud = $session['audience'] ? json_decode((string)$session['audience'], true) : null;
        if (!is_array($aud) || !$aud) {
            $aud = self::teacherClasses($client, (int)$session['staff_id']);
        }
        foreach ($aud as $a) {
            if ((int)$a['class_id'] === $classId && (empty($a['section_id']) || (int)$a['section_id'] === (int)$sectionId)) {
                return true;
            }
        }

        return false;
    }

    private static function subjectsFor(string $client, int $staffId, int $classId, ?int $sectionId): array
    {
        $out = [];
        try {
            $sec = self::db()->execute('SELECT staff_id FROM ssms_sections WHERE section_id = ? AND ssms_client_code = ?', [(int)$sectionId, $client])->fetch('assoc');
            if ($sec && (int)$sec['staff_id'] === $staffId) {
                $out[] = 'Class teacher';
            }
            foreach (self::q('SELECT DISTINCT sb.subject_name FROM ssms_subject_teacher t JOIN ssms_subjects sb ON sb.subject_id = t.subject_id
                               WHERE t.staff_id = ? AND t.class_id = ? AND (t.section_id = ? OR t.section_id IS NULL OR t.section_id = 0) AND t.ssms_client_code = ?',
                [$staffId, $classId, (int)$sectionId, $client]) as $r) {
                $out[] = $r['subject_name'];
            }
        } catch (\Throwable $e) {
        }

        return array_values(array_unique(array_filter($out)));
    }

    private static function parentContact(string $client, string $by, string $byRole, array $stu): array
    {
        $r = self::db()->execute('SELECT ssms_user_firstname, ssms_user_lastname, mobile_number FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$by, $client])->fetch('assoc');
        if (in_array(strtolower($byRole), ['parent', 'student'], true) && $r) {
            return [mb_substr(trim(($r['ssms_user_firstname'] ?? '') . ' ' . ($r['ssms_user_lastname'] ?? '')), 0, 150) ?: null, mb_substr((string)($r['mobile_number'] ?: $by), 0, 30) ?: null];
        }
        // booked by staff: the admission-form contact
        $reg = self::db()->execute('SELECT r.student_father_name, r.student_mother_name, r.mobile_number FROM ssms_student_enrollment e
               JOIN ssms_student_registration r ON r.registration_id = e.registration_id WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1',
            [$stu['enrollment_id'], $client])->fetch('assoc');

        return [mb_substr((string)($reg['student_father_name'] ?: ($reg['student_mother_name'] ?? '')), 0, 150) ?: null, mb_substr((string)($reg['mobile_number'] ?? ''), 0, 30) ?: null];
    }

    private static function regOf(string $client, string $eid): ?string
    {
        $r = self::db()->execute('SELECT registration_id FROM ssms_student_enrollment WHERE enrollment_id = ? AND ssms_client_code = ? LIMIT 1', [$eid, $client])->fetch('assoc');

        return $r ? (string)$r['registration_id'] : null;
    }

    private static function activeBookings(string $client, int $sessionId): int
    {
        return (int)(self::db()->execute('SELECT COUNT(*) n FROM ssms_ptm_bookings WHERE session_id = ? AND ssms_client_code = ? AND active = 1', [$sessionId, $client])->fetch('assoc')['n'] ?? 0);
    }

    private static function sessionRow(string $client, int $id): ?array
    {
        return self::db()->execute('SELECT * FROM ssms_ptm_sessions WHERE id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc') ?: null;
    }

    private static function bookingRow(string $client, int $id): ?array
    {
        return self::db()->execute('SELECT b.*, sl.start_at, sl.end_at, s.staff_id, s.title, s.mode, s.location, s.note_for_parents, s.closes_hours
                FROM ssms_ptm_bookings b JOIN ssms_ptm_slots sl ON sl.id = b.slot_id JOIN ssms_ptm_sessions s ON s.id = b.session_id
               WHERE b.id = ? AND b.ssms_client_code = ?', [$id, $client])->fetch('assoc') ?: null;
    }

    private static function castSession(string $client, array $r, bool $staff = true): array
    {
        $aud = $r['audience'] ? json_decode((string)$r['audience'], true) : null;
        $out = ['id' => (int)$r['id'], 'staff_id' => (int)$r['staff_id'], 'teacher' => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')),
                'title' => $r['title'], 'meet_date' => $r['meet_date'], 'start_time' => substr((string)$r['start_time'], 0, 5), 'end_time' => substr((string)$r['end_time'], 0, 5),
                'slot_minutes' => (int)$r['slot_minutes'], 'gap_minutes' => (int)$r['gap_minutes'], 'mode' => $r['mode'], 'mode_label' => self::MODES[$r['mode']] ?? $r['mode'],
                'location' => $r['location'], 'closes_hours' => (int)$r['closes_hours'], 'note_for_parents' => $r['note_for_parents'], 'status' => $r['status']];
        if ($staff) {
            $out['audience'] = is_array($aud) ? $aud : null;
            $out['audience_label'] = self::audienceLabel($client, is_array($aud) ? $aud : null, (int)$r['staff_id']);
            $out['cancel_reason'] = $r['cancel_reason'] ?? null;
            if (isset($r['slots'])) {
                $out['slots'] = (int)$r['slots'];
                $out['booked'] = (int)$r['booked'];
            }
        }

        return $out;
    }

    private static function audienceLabel(string $client, ?array $aud, int $staffId): string
    {
        $list = $aud ?: self::teacherClasses($client, $staffId);
        if (!$list) {
            return $aud === null ? 'Teacher\'s classes (none assigned yet)' : '—';
        }
        $names = [];
        foreach ($list as $a) {
            $c = self::db()->execute('SELECT class_name FROM ssms_classes WHERE class_id = ?', [(int)$a['class_id']])->fetch('assoc');
            $s = !empty($a['section_id']) ? self::db()->execute('SELECT section_name FROM ssms_sections WHERE section_id = ?', [(int)$a['section_id']])->fetch('assoc') : null;
            $names[] = trim(($c['class_name'] ?? '?') . ' ' . ($s['section_name'] ?? ''));
        }
        sort($names);

        return ($aud === null ? 'My classes: ' : '') . implode(', ', array_unique($names));
    }

    public static function staffName(string $client, int $staffId): string
    {
        $r = self::db()->execute('SELECT first_name, last_name FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client])->fetch('assoc');

        return $r ? trim($r['first_name'] . ' ' . $r['last_name']) : 'the teacher';
    }

    /** "Fri 14 Nov, 3:30 PM" */
    public static function when(string $localDateTime, ?string $client = null): string
    {
        $t = strtotime($localDateTime);

        if ($client !== null && $client !== '') {
            return Locale::date($client, $t, 'long') . ', ' . Locale::time($client, date('H:i', $t));   // Region & formats
        }

        return date('D j M, g:i A', $t);
    }

    // push

    /** Every phone the person is signed in on: the chat presence token and the devices registered for notifications. */
    public static function tokensOfUser(string $client, string $user): array
    {
        $out = [];
        try {
            $out = array_column(self::q("SELECT push_token FROM ssms_user_presence WHERE username = ? AND client_code = ?
                    AND push_token IS NOT NULL AND push_token <> ''", [$user, $client]), 'push_token');
        } catch (\Throwable $e) {
        }
        try {
            // a phone now registered to someone else (shared phone, signed in with another account) is not this person's
            if ($out) {
                $in = implode(',', array_fill(0, count($out), '?'));
                $other = array_column(self::q("SELECT token FROM ssms_push_tokens WHERE token IN ($in) AND NOT (ssms_client_code = ? AND username = ?)",
                    array_merge($out, [$client, $user])), 'token');
                $out = array_diff($out, $other);
            }
            foreach (self::q('SELECT token FROM ssms_push_tokens WHERE ssms_client_code = ? AND username = ?', [$client, $user]) as $r) {
                $out[] = $r['token'];
            }
        } catch (\Throwable $e) {
            // notifications table not created yet
        }

        return array_values(array_unique(array_filter(array_map('strval', $out))));
    }

    public static function tokensOfStaff(string $client, int $staffId): array
    {
        try {
            return array_values(array_unique(array_column(self::q("SELECT p.push_token FROM sawera_ssms_users u
                    JOIN ssms_user_presence p ON p.username = u.ssms_user_name AND p.client_code = u.ssms_client_code
                   WHERE u.staff_id = ? AND u.ssms_client_code = ? AND p.push_token IS NOT NULL AND p.push_token <> ''", [$staffId, $client]), 'push_token')));
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** Who to tell about a booking: the parent who booked it, or – when staff booked it – the child's parents. */
    private static function familyTokens(string $client, array $b): array
    {
        $tokens = in_array(strtolower((string)$b['booked_by_role']), ['parent', 'student'], true)
            ? self::tokensOfUser($client, (string)$b['booked_by'])
            : self::tokensOfParents($client, (string)$b['enrollment_id']);
        $staff = isset($b['staff_id']) ? self::tokensOfStaff($client, (int)$b['staff_id']) : [];

        return array_values(array_diff(array_unique($tokens), $staff));   // never the teacher's own phone as "the parent"
    }

    /** Parent accounts linked to a child: the admission-form mobile, or guardians given app sign-in. */
    public static function tokensOfParents(string $client, string $enrollmentId): array
    {
        $out = [];
        foreach (self::parentUsers($client, $enrollmentId) as $u) {
            foreach (self::tokensOfUser($client, $u) as $t) {
                $out[] = $t;
            }
        }

        return array_values(array_unique($out));
    }

    /** User names of the parent accounts linked to a child (admission-form mobile, or guardians with app sign-in). */
    public static function parentUsers(string $client, string $enrollmentId): array
    {
        try {
            $raw = [];
            $r = self::db()->execute('SELECT r.mobile_number FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                   WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1', [$enrollmentId, $client])->fetch('assoc');
            $raw[] = (string)($r['mobile_number'] ?? '');
            try {
                foreach (self::q("SELECT g.phone, g.phone_last10 FROM ssms_student_guardians g JOIN ssms_student_enrollment e ON e.registration_id = g.registration_id
                        AND e.ssms_client_code = g.ssms_client_code WHERE e.enrollment_id = ? AND g.ssms_client_code = ? AND g.app_access = 1 AND g.can_pickup = 1
                        AND COALESCE(g.restriction_note, '') = ''", [$enrollmentId, $client]) as $g) {
                    $raw[] = (string)($g['phone'] ?: $g['phone_last10']);
                }
            } catch (\Throwable $e) {
                // guardians table not created yet
            }
            // the same number is often typed differently: "+971 50 999 9999" on the form, "050 999 9999" on the account
            $country = Messaging::country($client);
            $out = [];
            foreach (array_unique(array_filter($raw, fn($x) => strlen(preg_replace('/\D/', '', $x)) >= 6)) as $x) {
                $ph = substr(preg_replace('/\D/', '', $x), -10);
                $e164 = MessagingCountries::e164($x, $country);
                foreach (self::q("SELECT ssms_user_name, mobile_number FROM sawera_ssms_users WHERE ssms_client_code = ? AND LOWER(ssms_user_role) = 'parent'
                                    AND (ssms_user_name LIKE ? OR mobile_number LIKE ?)", [$client, '%' . substr($ph, -4), '%' . substr($ph, -4)]) as $u) {
                    $num = (string)($u['mobile_number'] ?: $u['ssms_user_name']);
                    if (substr(preg_replace('/\D/', '', $num), -10) === $ph || ($e164 !== null && MessagingCountries::e164($num, $country) === $e164)) {
                        $out[] = (string)$u['ssms_user_name'];
                    }
                }
            }

            return array_values(array_unique($out));
        } catch (\Throwable $e) {
            return [];
        }
    }

    private static function msg(string $to, string $title, string $body, array $data = []): array
    {
        return ['to' => $to, 'sound' => 'default', 'title' => $title, 'body' => $body, 'data' => $data + ['type' => 'ptm'], 'channelId' => 'chat'];
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
            Log::warning('Meetings push: ' . $e->getMessage());
        }
    }

    private static function text($v, int $max): string
    {
        $v = is_scalar($v) ? (string)$v : '';

        return mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? ''), 0, $max);
    }

    private static function lastId(): int
    {
        return (int)(self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'] ?? 0);
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
