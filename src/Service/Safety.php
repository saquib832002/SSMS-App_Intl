<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Safety: visitor management and authorised pick-up.
 *
 * Visitors (reception): sign in with name, phone, purpose, the person they visit, ID (type + last 4 only), vehicle,
 * badge and photo; the host gets a push; the watch list refuses (deny) or flags (alert) people; "on site now" is the
 * evacuation list; expected visitors get a pass code; everyone still in is signed out by the night clean-up; personal
 * details are removed after the school's retention period.
 *
 * Pick-up (gate / office): the people allowed to collect a child are the student's guardians (can_pickup) plus
 * pick-up-only persons (drivers, nannies, one-off persons with a date window and a pick-up code), each with a photo.
 * Handing a child over is checked (photo / ID / code), written to the late / early log (ssms_student_arrivals, kind
 * early | pickup) and the family is told. Someone not allowed is refused, logged and the office and family are alerted;
 * collecting with someone not on the list needs the "approve" permission and a reason. Parents see and add their own
 * pick-up persons (the school approves, or not, per its rules) and one-off persons with a code.
 *
 * Permissions: Roles › "Visitors & safe pick-up" (module safety): view = see, edit = sign in / hand over,
 * approve = settings, watch list, approve parents' persons, hand over to someone not on the list, export = CSV,
 * delete = remove visit records.
 */
class Safety
{
    public const PURPOSES = ['meeting' => 'Meeting', 'parent' => 'Parent visit', 'pickup' => 'Collecting a student', 'delivery' => 'Delivery',
        'contractor' => 'Contractor / maintenance', 'interview' => 'Interview', 'official' => 'Official / inspection', 'event' => 'Event', 'other' => 'Other'];
    public const ID_TYPES = ['national_id' => 'National ID', 'passport' => 'Passport', 'driving_licence' => 'Driving licence',
        'residence' => 'Residence permit', 'work_id' => 'Work ID', 'other' => 'Other ID'];
    public const PICKUP_RELATIONS = ['mother' => 'Mother', 'father' => 'Father', 'guardian' => 'Guardian', 'grandparent' => 'Grandparent',
        'step_parent' => 'Step-parent', 'sibling' => 'Brother / sister', 'aunt_uncle' => 'Aunt / uncle', 'driver' => 'Driver',
        'nanny' => 'Nanny / helper', 'family_friend' => 'Family friend / neighbour', 'other' => 'Other'];
    public const METHODS = ['photo' => 'Photo matched', 'id' => 'ID checked', 'code' => 'Pick-up code', 'known' => 'Known to staff', 'override' => 'Not on the list (approved)'];
    public const DEFAULTS = ['require_photo' => 0, 'require_id' => 0, 'visitor_rules' => '', 'notify_host' => 1, 'retention_days' => 90,
        'parent_pickup' => 'approve', 'temp_code' => 1];
    public const MAX_PERSONS = 15;
    public const MAX_PHOTO = 5 * 1048576;

    /** Tests: send pushes at once. */
    public static bool $sendNow = true;
    /** Tests: where photos go (default <web root>/clients/<school>/Safety/). */
    public static ?string $photoRoot = null;

    private static array $cache = [];

    public static function resetCache(): void
    {
        self::$cache = [];
    }

    // ── Who is asking ───────────────────────────────────────────────────────

    /** Staff: Roles › Visitors & safe pick-up. */
    public static function access(string $client, array $actor): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $role = $role === 'teacher' ? 'user' : $role;
        $user = (string)($actor['user'] ?? '');
        if ($client === '' || $user === '' || !in_array($role, Permissions::BASE_ROLES, true)) {
            throw new \DomainException('Not allowed.');
        }
        $owner = $role === 'owner';
        $grid = $owner ? [] : Permissions::forUser($client, $role, $actor['custom_role'] ?? null);
        $g = fn(string $k) => $owner || !empty($grid['safety'][$k]);
        $st = self::one('SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $client]);

        return ['client' => $client, 'user' => $user, 'role' => $role, 'staff_id' => $st && $st['staff_id'] ? (int)$st['staff_id'] : null,
                'view' => $g('view'), 'edit' => $g('edit'), 'approve' => $g('approve'), 'delete' => $g('delete'), 'export' => $g('export'),
                'lift' => in_array($role, ['owner', 'admin'], true)];
    }

    private static function need(array $a, string $kind): void
    {
        if (empty($a[$kind])) {
            $what = ['view' => 'see visitors and pick-ups', 'edit' => 'sign visitors in or hand children over', 'approve' => 'change this (it needs the "approve" permission)',
                     'export' => 'export the visitor log', 'delete' => 'delete visitor records'][$kind];
            throw new \DomainException("You don't have permission to {$what}. Ask the school owner if you need it (Roles › Visitors & safe pick-up).");
        }
    }

    /** A parent and one of their children. */
    public static function parentAccess(string $client, array $actor, string $eid): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $user = (string)($actor['user'] ?? '');
        if ($role !== 'parent' || $user === '') {
            throw new \DomainException('Only parents can manage who collects their child.');
        }
        $eid = trim($eid);
        if ($eid === '' || !in_array($eid, StudentLeave::myEnrollmentIds($client, 'parent', $user, null), true)) {
            throw new \DomainException('This child is not linked to your account.');
        }
        $stu = self::student($client, $eid);
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }

        return ['client' => $client, 'user' => $user, 'role' => 'parent', 'eid' => $eid, 'student' => $stu];
    }

    // ── Settings ────────────────────────────────────────────────────────────

    public static function settings(string $c): array
    {
        if (isset(self::$cache['set|' . $c])) {
            return self::$cache['set|' . $c];
        }
        $s = self::DEFAULTS;
        try {
            $r = self::one('SELECT * FROM ssms_safety_settings WHERE ssms_client_code = ?', [$c]);
            if ($r) {
                foreach (array_keys(self::DEFAULTS) as $k) {
                    $s[$k] = in_array($k, ['visitor_rules', 'parent_pickup'], true) ? (string)($r[$k] ?? '') : (int)$r[$k];
                }
            }
        } catch (\Throwable $e) {
        }
        if (!in_array($s['parent_pickup'], ['approve', 'direct', 'off'], true)) {
            $s['parent_pickup'] = 'approve';
        }

        return self::$cache['set|' . $c] = $s;
    }

    public static function saveSettings(array $a, array $d): array
    {
        self::need($a, 'approve');
        $s = self::settings($a['client']);
        foreach (['require_photo', 'require_id', 'notify_host', 'temp_code'] as $k) {
            if (array_key_exists($k, $d)) {
                $s[$k] = self::flag($d[$k]) ? 1 : 0;
            }
        }
        if (array_key_exists('visitor_rules', $d)) {
            $s['visitor_rules'] = mb_substr(trim((string)$d['visitor_rules']), 0, 3000);
        }
        if (array_key_exists('retention_days', $d)) {
            $v = trim((string)$d['retention_days']);
            if (!ctype_digit($v) || (int)$v < 30 || (int)$v > 3650) {
                throw new \DomainException('Keep visitor details for 30 – 3650 days.');
            }
            $s['retention_days'] = (int)$v;
        }
        if (array_key_exists('parent_pickup', $d)) {
            if (!in_array((string)$d['parent_pickup'], ['approve', 'direct', 'off'], true)) {
                throw new \DomainException('Choose how parents may add pick-up persons.');
            }
            $s['parent_pickup'] = (string)$d['parent_pickup'];
        }
        self::db()->execute('INSERT INTO ssms_safety_settings (ssms_client_code, require_photo, require_id, visitor_rules, notify_host, retention_days, parent_pickup, temp_code, modified, modified_by)
            VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE require_photo = VALUES(require_photo), require_id = VALUES(require_id), visitor_rules = VALUES(visitor_rules),
            notify_host = VALUES(notify_host), retention_days = VALUES(retention_days), parent_pickup = VALUES(parent_pickup), temp_code = VALUES(temp_code),
            modified = VALUES(modified), modified_by = VALUES(modified_by)',
            [$a['client'], $s['require_photo'], $s['require_id'], $s['visitor_rules'] !== '' ? $s['visitor_rules'] : null, $s['notify_host'], $s['retention_days'],
             $s['parent_pickup'], $s['temp_code'], self::now(), $a['user']]);
        unset(self::$cache['set|' . $a['client']]);

        return self::settings($a['client']);
    }

    public static function options(): array
    {
        return ['purposes' => self::PURPOSES, 'id_types' => self::ID_TYPES, 'relations' => self::PICKUP_RELATIONS, 'methods' => self::METHODS];
    }

    // ── Visitors ────────────────────────────────────────────────────────────

    /** Reception: on site now, expected today, left, refused. */
    public static function visitorsToday(array $a, ?string $date = null): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $date = self::date($c, $date);
        $rows = self::q('SELECT * FROM ssms_visits WHERE ssms_client_code = ? AND (visit_date = ? OR status = ?) ORDER BY COALESCE(signed_in_at, created) DESC', [$c, $date, 'in']);
        $out = ['onsite' => [], 'expected' => [], 'left' => [], 'denied' => []];
        foreach ($rows as $r) {
            $v = self::visitView($c, $r);
            if ($r['status'] === 'in') {
                $out['onsite'][] = $v;
            } elseif (substr((string)$r['visit_date'], 0, 10) !== $date) {
                continue;
            } elseif ($r['status'] === 'expected') {
                $out['expected'][] = $v;
            } elseif ($r['status'] === 'out') {
                $out['left'][] = $v;
            } elseif ($r['status'] === 'denied') {
                $out['denied'][] = $v;
            }
        }
        usort($out['expected'], fn($l, $r) => strcmp((string)$l['expected_time'], (string)$r['expected_time']));

        return $out + ['date' => $date, 'today' => self::today($c), 'counts' => array_map('count', $out), 'settings' => self::publicSettings($c),
                       'can' => self::can($a), 'options' => self::options()];
    }

    /** Fill the form for someone who came before (by phone) and check the watch list. */
    public static function lookupVisitor(array $a, string $phone): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $p10 = self::last10($phone);
        if ($p10 === null) {
            return ['found' => null, 'visits' => 0, 'watch' => null];
        }
        $r = self::one('SELECT * FROM ssms_visits WHERE ssms_client_code = ? AND phone_last10 = ? AND purged = 0 ORDER BY id DESC LIMIT 1', [$c, $p10]);
        $n = (int)(self::one("SELECT COUNT(*) n FROM ssms_visits WHERE ssms_client_code = ? AND phone_last10 = ? AND status IN ('in','out')", [$c, $p10])['n'] ?? 0);
        $w = self::watchHit($c, $r['name'] ?? '', $p10, null);

        return ['found' => $r ? ['name' => $r['name'], 'company' => $r['company'], 'id_type' => $r['id_type'], 'vehicle_no' => $r['vehicle_no'],
                                 'last_visit' => substr((string)$r['visit_date'], 0, 10)] : null,
                'visits' => $n, 'watch' => $w ? ['level' => $w['level']] + ($a['approve'] ? ['reason' => $w['reason']] : []) : null];
    }

    /**
     * Sign a visitor in (or an expected visitor: $d['visit_id']). Watch list "deny" → refused (logged, office told)
     * unless someone with "approve" lets them in with a reason ($d['override_reason']).
     */
    public static function signIn(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $s = self::settings($c);
        $expected = null;
        $override = trim((string)($d['override_reason'] ?? ''));
        if (!empty($d['visit_id'])) {
            // an expected visitor (a refusal is logged as its own row, so the booking stays open for an "approve" override)
            $expected = self::one("SELECT * FROM ssms_visits WHERE id = ? AND ssms_client_code = ? AND status = 'expected'", [(int)$d['visit_id'], $c]);
            if (!$expected) {
                throw new \DomainException('This expected visit is no longer open.');
            }
            // what reception did not fill in comes from the booking (the phone is needed for the watch list)
            foreach (['name', 'phone', 'purpose', 'host_staff_id', 'host_name', 'company', 'enrollment_id', 'note', 'id_type', 'id_last4', 'vehicle_no'] as $k) {
                if (trim((string)($d[$k] ?? '')) === '' && $expected[$k] !== null && $expected[$k] !== '') {
                    $d[$k] = $expected[$k];
                }
            }
        }
        $v = self::visitFields($c, $d);
        if ($s['require_id'] && ($v['id_type'] === null || $v['id_last4'] === null)) {
            throw new \DomainException('Check the visitor\'s ID and enter its type and last 4 characters.');
        }
        if ($s['visitor_rules'] !== '' && !self::flag($d['agreed_rules'] ?? false)) {
            throw new \DomainException('The visitor needs to agree to the school\'s visitor rules.');
        }
        if ($v['phone_last10'] !== null && self::one("SELECT 1 x FROM ssms_visits WHERE ssms_client_code = ? AND phone_last10 = ? AND status = 'in' LIMIT 1", [$c, $v['phone_last10']])) {
            throw new \DomainException('Someone with this phone number is already signed in. Sign them out first.');
        }
        $local = self::localNow($c);
        $today = substr($local, 0, 10);
        $hit = self::watchHit($c, $v['name'], $v['phone_last10'], $v['id_last4']);
        if ($hit && $hit['level'] === 'deny' && !($a['approve'] && $override !== '')) {
            $id = self::insertVisit($c, array_merge($v, ['visit_date' => $today, 'status' => 'denied', 'watch_level' => 'deny', 'signed_in_by' => $a['user'], 'signed_in_at' => $local,
                'note' => self::clip(trim('Refused at the door (watch list).' . ($v['note'] ? ' ' . $v['note'] : '')), 500)]), null);
            self::alertOffice($c, 'visit-denied:' . $id, fn() => ['title' => Locale::t($c, 'Visitor refused'),
                'body' => Locale::t($c, '{name} was refused entry at {time} (on the watch list).', ['name' => $v['name'], 'time' => Locale::time($c, substr($local, 11, 5))])]);
            self::send($c);

            return ['denied' => true, 'message' => Locale::t($c, 'Do not let this person in. They are on the school\'s watch list – the office has been told.')
                . ($a['approve'] && $hit['reason'] ? ' ' . $hit['reason'] : ''), 'visit' => self::visitView($c, self::visitRow($c, $id))];
        }
        $badge = $v['badge_no'] ?? null;
        if ($badge === null) {
            $badge = (string)(1 + (int)(self::one("SELECT COUNT(*) n FROM ssms_visits WHERE ssms_client_code = ? AND visit_date = ? AND status IN ('in','out')", [$c, $today])['n'] ?? 0));
        }
        $fields = array_merge($v, ['visit_date' => $today, 'status' => 'in', 'badge_no' => $badge, 'agreed_rules' => self::flag($d['agreed_rules'] ?? false) ? 1 : 0,
            'watch_level' => $hit['level'] ?? null, 'signed_in_at' => $local, 'signed_in_by' => $a['user']]);
        if ($hit && $hit['level'] === 'deny') {
            $fields['note'] = self::clip('Let in despite the watch list by ' . $a['user'] . ': ' . $override . ($v['note'] ? ' · ' . $v['note'] : ''), 500);
        }
        $id = self::insertVisit($c, $fields, $expected);
        $visit = self::visitView($c, self::visitRow($c, $id));
        if ($hit) {
            self::alertOffice($c, 'visit-watch:' . $id, fn() => ['title' => Locale::t($c, 'Watch list: visitor signed in'),
                'body' => Locale::t($c, '{name} signed in at {time} to see {host}.', ['name' => $v['name'], 'time' => Locale::time($c, substr($local, 11, 5)),
                    'host' => $visit['host'] ?: Locale::t($c, self::PURPOSES[$v['purpose']])])]);
        }
        if ($s['notify_host'] && $v['host_staff_id']) {
            Notify::toUsers($c, 'visit-arrived:' . $id, self::usersOfStaff($c, $v['host_staff_id']), fn() => [
                'title' => Locale::t($c, 'Your visitor has arrived'),
                'body' => Locale::t($c, '{name} is at reception ({time}).', ['name' => $v['name'] . ($v['company'] ? ' (' . $v['company'] . ')' : ''), 'time' => Locale::time($c, substr($local, 11, 5))]),
            ], ['event' => 'school', 'screen' => 'MyVisitors']);
        }
        self::send($c);

        return ['denied' => false, 'visit' => $visit, 'watch' => $hit ? ['level' => $hit['level']] : null];
    }

    public static function signOut(array $a, int $id): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $r = self::visitRow($c, $id);
        if (!$r || $r['status'] !== 'in') {
            throw new \DomainException('This visitor is not signed in.');
        }
        self::db()->execute("UPDATE ssms_visits SET status = 'out', signed_out_at = ?, signed_out_by = ?, modified = ? WHERE id = ? AND ssms_client_code = ? AND status = 'in'",
            [self::localNow($c), $a['user'], self::now(), $id, $c]);

        return ['visit' => self::visitView($c, self::visitRow($c, $id))];
    }

    /** End of the day: everyone still in. */
    public static function signOutAll(array $a): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $n = self::db()->execute("UPDATE ssms_visits SET status = 'out', signed_out_at = ?, signed_out_by = ?, modified = ? WHERE ssms_client_code = ? AND status = 'in'",
            [self::localNow($c), $a['user'], self::now(), $c])->rowCount();

        return ['signed_out' => $n];
    }

    /**
     * Expect a visitor (any staff member for their own visitors; reception for anyone). Returns a 6-digit pass code
     * once – only its hash is kept.
     */
    public static function expectVisitor(array $a, array $d): array
    {
        $c = $a['client'];
        $own = !$a['edit'] || self::flag($d['mine'] ?? false);   // "My visitors": always the caller's own visitor
        if ($own && !$a['staff_id']) {
            throw new \DomainException('Your account is not linked to a staff record.');
        }
        $date = self::date($c, (string)($d['date'] ?? ''));
        if ($date < self::today($c) || $date > date('Y-m-d', strtotime(self::today($c) . ' +90 days'))) {
            throw new \DomainException('Choose a day from today up to 90 days ahead.');
        }
        $time = trim((string)($d['time'] ?? ''));
        if ($time !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) {
            throw new \DomainException('Enter the time as HH:MM.');
        }
        if ($own) {
            $d['host_staff_id'] = $a['staff_id'];
        }
        // one guest (name) or a group (names: list or one per line) – the whole group shares one pass code
        $names = $d['names'] ?? null;
        if (is_string($names)) {
            $names = preg_split('/\r\n|\r|\n/', $names);
        }
        $names = is_array($names) ? array_values(array_filter(array_map(fn($n) => trim((string)$n), $names), fn($n) => $n !== '')) : [];
        if (!$names) {
            $names = [(string)($d['name'] ?? '')];
        }
        if (count($names) > 30) {
            throw new \DomainException('Up to 30 guests can share one pass code.');
        }
        $rows = [];
        foreach ($names as $k => $n) {
            // the phone (and note) belong to the person who booked / leads the group
            $rows[] = self::visitFields($c, ['name' => $n] + ($k === 0 ? $d : array_diff_key($d, array_flip(['phone', 'id_type', 'id_last4', 'badge_no']))));
        }
        $code = self::freshVisitCode($c);
        $ids = [];
        foreach ($rows as $v) {
            $ids[] = self::insertVisit($c, $v + ['visit_date' => $date, 'status' => 'expected', 'expected_time' => $time !== '' ? $time : null,
                'pass_code_hash' => self::codeHash($c, $code), 'created_by' => $a['user']], null);
        }
        $visits = array_map(fn($id) => self::visitView($c, self::visitRow($c, $id)), $ids);

        return ['visit' => $visits[0], 'visits' => $visits, 'code' => $code];
    }

    /** A 6-digit code that no open booking uses (so a code always finds exactly one group). */
    private static function freshVisitCode(string $c): string
    {
        for ($i = 0; $i < 20; $i++) {
            $code = self::newCode();
            if (!self::one("SELECT 1 x FROM ssms_visits WHERE ssms_client_code = ? AND pass_code_hash = ? AND status = 'expected' LIMIT 1", [$c, self::codeHash($c, $code)])) {
                return $code;
            }
        }

        return $code;
    }

    /** A new pass code for a booking (and the other guests of its group); the old code stops working. */
    public static function newVisitCode(array $a, int $id): array
    {
        $c = $a['client'];
        $r = self::visitRow($c, $id);
        if (!$r || $r['status'] !== 'expected') {
            throw new \DomainException('This visit is not expected any more.');
        }
        if (!$a['edit'] && (!$a['staff_id'] || (int)$r['host_staff_id'] !== (int)$a['staff_id'])) {
            throw new \DomainException('You can only do this for your own visitors.');
        }
        $code = self::freshVisitCode($c);
        $hash = self::codeHash($c, $code);
        if ($r['pass_code_hash']) {
            self::db()->execute("UPDATE ssms_visits SET pass_code_hash = ?, modified = ? WHERE ssms_client_code = ? AND pass_code_hash = ? AND status = 'expected'",
                [$hash, self::now(), $c, $r['pass_code_hash']]);
        } else {
            self::db()->execute('UPDATE ssms_visits SET pass_code_hash = ?, modified = ? WHERE id = ? AND ssms_client_code = ?', [$hash, self::now(), $id, $c]);
        }
        $group = self::q("SELECT * FROM ssms_visits WHERE ssms_client_code = ? AND pass_code_hash = ? AND status = 'expected' ORDER BY id", [$c, $hash]);

        return ['code' => $code, 'visits' => array_map(fn($x) => self::visitView($c, $x), $group)];
    }

    /** Reception: the visitor shows their pass code. */
    public static function findByCode(array $a, string $code): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $code = preg_replace('/\D/', '', $code);
        if (strlen($code) !== 6) {
            throw new \DomainException('Enter the 6-digit pass code.');
        }
        $rows = self::q("SELECT * FROM ssms_visits WHERE ssms_client_code = ? AND pass_code_hash = ? AND status = 'expected' AND visit_date = ? ORDER BY id",
            [$c, self::codeHash($c, $code), self::today($c)]);
        if (!$rows) {
            throw new \DomainException('No visitor is expected today with this code.');
        }
        $visits = array_map(fn($r) => self::visitView($c, $r), $rows);

        return ['visit' => $visits[0], 'visits' => $visits];
    }

    public static function cancelExpected(array $a, int $id): array
    {
        $c = $a['client'];
        $r = self::visitRow($c, $id);
        if (!$r || $r['status'] !== 'expected') {
            throw new \DomainException('This visit is not expected any more.');
        }
        if (!$a['edit'] && (!$a['staff_id'] || (int)$r['host_staff_id'] !== (int)$a['staff_id'])) {
            throw new \DomainException('You can only cancel your own visitors.');
        }
        self::db()->execute("UPDATE ssms_visits SET status = 'cancelled', modified = ? WHERE id = ? AND ssms_client_code = ?", [self::now(), $id, $c]);

        return ['visit' => self::visitView($c, self::visitRow($c, $id))];
    }

    /** A staff member's own visitors (expected and recent). */
    public static function myVisitors(array $a): array
    {
        $c = $a['client'];
        if (!$a['staff_id']) {
            return ['visits' => [], 'linked' => false, 'today' => self::today($c)];
        }
        $from = date('Y-m-d', strtotime(self::today($c) . ' -14 days'));
        $rows = self::q("SELECT * FROM ssms_visits WHERE ssms_client_code = ? AND host_staff_id = ? AND visit_date >= ? AND status IN ('expected','in','out','no_show')
                          ORDER BY visit_date DESC, COALESCE(signed_in_at, created) DESC LIMIT 100", [$c, $a['staff_id'], $from]);

        return ['visits' => array_map(fn($r) => self::visitView($c, $r, false), $rows), 'linked' => true, 'today' => self::today($c), 'options' => self::options()];
    }

    /** History with search; $f: from, to, q, status, page. */
    public static function history(array $a, array $f): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        [$sql, $p] = self::historyWhere($c, $f);
        $page = max(1, (int)($f['page'] ?? 1));
        $total = (int)(self::one('SELECT COUNT(*) n FROM ssms_visits WHERE ' . $sql, $p)['n'] ?? 0);
        $rows = self::q('SELECT * FROM ssms_visits WHERE ' . $sql . ' ORDER BY visit_date DESC, COALESCE(signed_in_at, created) DESC LIMIT 50 OFFSET ' . (($page - 1) * 50), $p);

        return ['visits' => array_map(fn($r) => self::visitView($c, $r), $rows), 'total' => $total, 'page' => $page, 'pages' => max(1, (int)ceil($total / 50))];
    }

    /** CSV of the log (export permission). */
    public static function exportCsv(array $a, array $f): string
    {
        self::need($a, 'export');
        $c = $a['client'];
        [$sql, $p] = self::historyWhere($c, $f);
        $h = fopen('php://temp', 'w+');
        fwrite($h, "\xEF\xBB\xBF");   // Excel: UTF-8
        fputcsv($h, ['Date', 'Status', 'Name', 'Phone', 'Company', 'Purpose', 'Host', 'Student', 'ID type', 'ID last 4', 'Vehicle', 'Badge', 'Signed in', 'Signed out', 'Note']);
        foreach (self::q('SELECT * FROM ssms_visits WHERE ' . $sql . ' ORDER BY visit_date, signed_in_at LIMIT 20000', $p) as $r) {
            $v = self::visitView($c, $r);
            fputcsv($h, array_map([self::class, 'csvSafe'], [$v['date'], $v['status'], $v['name'], (string)$r['phone'], (string)$v['company'], self::PURPOSES[$v['purpose']] ?? $v['purpose'],
                $v['host'], $v['student'] ?? '', self::ID_TYPES[$v['id_type']] ?? (string)$v['id_type'], (string)$v['id_last4'], (string)$v['vehicle_no'], (string)$v['badge_no'],
                (string)$v['signed_in_at'], (string)$v['signed_out_at'], (string)$v['note']]));
        }
        rewind($h);
        $out = (string)stream_get_contents($h);
        fclose($h);

        return $out;
    }

    /** No spreadsheet formulas from what visitors typed. */
    public static function csvSafe($v): string
    {
        $v = (string)$v;

        return $v !== '' && in_array($v[0], ['=', '+', '-', '@', "\t", "\r"], true) ? "'" . $v : $v;
    }

    public static function deleteVisit(array $a, int $id): array
    {
        self::need($a, 'delete');
        $c = $a['client'];
        $r = self::visitRow($c, $id);
        if (!$r) {
            throw new \DomainException('Not found.');
        }
        self::removePhoto($c, $r['photo_name']);
        self::db()->execute('DELETE FROM ssms_visits WHERE id = ? AND ssms_client_code = ?', [$id, $c]);

        return ['deleted' => $id, 'name' => (string)$r['name']];
    }

    // ── Watch list ──────────────────────────────────────────────────────────

    public static function watchlist(array $a): array
    {
        self::need($a, 'approve');

        return ['people' => array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'phone_last10' => $r['phone_last10'], 'id_last4' => $r['id_last4'],
            'level' => $r['level'], 'reason' => $r['reason'], 'created_by' => $r['created_by'], 'created' => $r['created']],
            self::q('SELECT * FROM ssms_visitor_watchlist WHERE ssms_client_code = ? AND active = 1 ORDER BY name', [$a['client']]))];
    }

    public static function saveWatch(array $a, array $d): array
    {
        self::need($a, 'approve');
        $c = $a['client'];
        $name = self::clip($d['name'] ?? '', 120);
        if ($name === null || mb_strlen($name) < 2) {
            throw new \DomainException('Enter the person\'s name.');
        }
        $p10 = self::last10((string)($d['phone'] ?? ''));
        $id4 = self::idLast4((string)($d['id_last4'] ?? ''));
        $level = (string)($d['level'] ?? 'deny') === 'alert' ? 'alert' : 'deny';
        $reason = self::clip($d['reason'] ?? '', 300);
        $id = (int)($d['id'] ?? 0);
        $now = self::now();
        if ($id) {
            if (!self::one('SELECT 1 x FROM ssms_visitor_watchlist WHERE id = ? AND ssms_client_code = ?', [$id, $c])) {
                throw new \DomainException('Not found.');
            }
            self::db()->execute('UPDATE ssms_visitor_watchlist SET name = ?, phone_last10 = ?, id_last4 = ?, level = ?, reason = ?, active = 1, modified = ? WHERE id = ? AND ssms_client_code = ?',
                [$name, $p10, $id4, $level, $reason, $now, $id, $c]);
        } else {
            self::db()->execute('INSERT INTO ssms_visitor_watchlist (ssms_client_code, name, phone_last10, id_last4, level, reason, created_by, created, modified) VALUES (?,?,?,?,?,?,?,?,?)',
                [$c, $name, $p10, $id4, $level, $reason, $a['user'], $now, $now]);
        }

        return self::watchlist($a);
    }

    public static function removeWatch(array $a, int $id): array
    {
        self::need($a, 'approve');
        self::db()->execute('UPDATE ssms_visitor_watchlist SET active = 0, modified = ? WHERE id = ? AND ssms_client_code = ?', [self::now(), $id, $a['client']]);

        return self::watchlist($a);
    }

    /** Strongest match: same phone, or same ID last 4 with the same name, or same name when the entry has neither. */
    private static function watchHit(string $c, string $name, ?string $p10, ?string $id4): ?array
    {
        try {
            $rows = self::q('SELECT * FROM ssms_visitor_watchlist WHERE ssms_client_code = ? AND active = 1', [$c]);
        } catch (\Throwable $e) {
            return null;
        }
        $n = self::norm($name);
        $best = null;
        foreach ($rows as $w) {
            $same = $n !== '' && self::norm((string)$w['name']) === $n;
            $hit = ($p10 !== null && $w['phone_last10'] !== null && $w['phone_last10'] === $p10)
                || ($id4 !== null && $w['id_last4'] !== null && $w['id_last4'] === $id4 && $same)
                || ($same && $w['phone_last10'] === null && $w['id_last4'] === null);
            if ($hit && (!$best || ($best['level'] === 'alert' && $w['level'] === 'deny'))) {
                $best = $w;
            }
        }

        return $best;
    }

    // ── Pick-up ─────────────────────────────────────────────────────────────

    /** Gate: find a student by name, roll number, admission / enrollment number. */
    public static function searchStudents(array $a, string $q): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $q = trim($q);
        if (mb_strlen($q) < 2) {
            return ['students' => []];
        }
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $rows = self::q("SELECT e.enrollment_id, e.registration_id, e.roll_number, e.class_id, e.section_id, r.student_first_name, r.student_last_name, r.student_photo, c.class_name, s.section_name
                           FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                           LEFT JOIN ssms_classes c ON c.class_id = e.class_id LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                          WHERE e.ssms_client_code = ? AND COALESCE(e.status, 'active') = 'active'
                            AND e.session_id = (SELECT MAX(e2.session_id) FROM ssms_student_enrollment e2 WHERE e2.ssms_client_code = e.ssms_client_code AND e2.registration_id = e.registration_id
                                                AND COALESCE(e2.status, 'active') = 'active')
                            AND (CONCAT(COALESCE(r.student_first_name,''), ' ', COALESCE(r.student_last_name,'')) LIKE ? OR e.enrollment_id = ? OR e.registration_id = ? OR e.roll_number = ?)
                          ORDER BY r.student_first_name, r.student_last_name LIMIT 25", [$c, $like, $q, $q, $q]);

        return ['students' => array_map(fn($r) => self::studentView($r), $rows)];
    }

    /** Gate: the child, who may collect them (with photos), who may not, and today's situation. */
    public static function pickupCard(array $a, string $eid): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $stu = self::student($c, $eid);
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }
        $today = self::today($c);
        $allowed = [];
        $blocked = [];
        $pending = [];
        $expired = [];
        foreach (self::personRows($c, $stu['registration_id']) as $r) {
            $p = self::personView($c, $r, true);
            if (!$p['can_pickup']) {
                $blocked[] = $p;
            } elseif ($p['status'] === 'pending') {
                $pending[] = $p;
            } elseif ($p['status'] !== 'approved') {
                continue;
            } elseif (!$p['valid_today']) {
                $expired[] = $p;
            } elseif (self::blockedMatch($c, $stu['registration_id'], (string)$r['name'], $r['phone_last10'] ?? null, (int)$r['id'])) {
                $p['restriction_note'] = trim(($p['restriction_note'] ?? '') . ' ' . Locale::t($c, 'Same name or mobile number as a person who is NOT allowed to collect.'));
                $p['can_pickup'] = false;
                $blocked[] = $p;
            } else {
                $allowed[] = $p;
            }
        }
        $done = self::one("SELECT a.*, g.name gname FROM ssms_student_arrivals a LEFT JOIN ssms_student_guardians g ON g.id = a.guardian_id
                            WHERE a.ssms_client_code = ? AND a.enrollment_id = ? AND a.event_date = ? AND a.kind IN ('early','pickup') ORDER BY a.id DESC LIMIT 1", [$c, $eid, $today]);
        $req = self::one("SELECT * FROM ssms_student_leave_requests WHERE ssms_client_code = ? AND enrollment_id = ? AND status = 'approved' AND request_type = 'early_pickup'
                           AND from_date <= ? AND to_date >= ? ORDER BY id DESC LIMIT 1", [$c, $eid, $today, $today], true);
        $att = self::one('SELECT attendance FROM student_attendance WHERE ssms_client_code = ? AND enrollment_id = ? AND attendance_date = ? LIMIT 1', [$c, $eid, $today], true);

        return ['student' => $stu, 'allowed' => $allowed, 'blocked' => $blocked, 'pending' => $pending, 'expired' => $expired,
                'collected' => $done ? ['time' => substr((string)$done['event_time'], 0, 5), 'by' => (string)($done['picked_up_by'] ?? $done['gname'] ?? ''),
                                        'kind' => $done['kind'], 'method' => $done['verify_method']] : null,
                'early_request' => $req ? ['time' => substr((string)($req['time_at'] ?? ''), 0, 5), 'by' => (string)($req['pickup_person'] ?? ''),
                                           'reason' => (string)($req['reason'] ?? '')] : null,
                'attendance' => $att ? strtoupper((string)$att['attendance']) : null,
                'kind' => self::defaultKind($c), 'can' => self::can($a), 'options' => self::options()];
    }

    /**
     * Hand a child over. $d: enrollment_id, guardian_id, method (photo | id | code | known), code, note, kind (early | pickup)
     * – or someone not on the list: name, relation, override_reason (needs "approve").
     */
    public static function recordPickup(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $eid = trim((string)($d['enrollment_id'] ?? ''));
        $stu = self::student($c, $eid);
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }
        $local = self::localNow($c);
        $today = substr($local, 0, 10);
        // two gate tablets at the same moment: one hand-over per child per day
        $lock = 'ssms_pickup_' . md5($c . '|' . $eid);
        if ((int)(self::one('SELECT GET_LOCK(?, 5) l', [$lock])['l'] ?? 0) !== 1) {
            throw new \DomainException('Another hand-over of this child is being saved. Please try again.');
        }
        try {
            return self::recordPickupLocked($a, $d, $stu, $eid, $local, $today);
        } finally {
            self::one('SELECT RELEASE_LOCK(?) l', [$lock]);
        }
    }

    private static function recordPickupLocked(array $a, array $d, array $stu, string $eid, string $local, string $today): array
    {
        $c = $a['client'];
        $prev = self::one("SELECT picked_up_by, event_time FROM ssms_student_arrivals WHERE ssms_client_code = ? AND enrollment_id = ? AND event_date = ? AND kind IN ('early','pickup') LIMIT 1",
            [$c, $eid, $today]);
        if ($prev) {
            throw new \DomainException(Locale::t($c, '{student} was already collected today at {time} by {person}.',
                ['student' => $stu['name'], 'time' => Locale::time($c, substr((string)$prev['event_time'], 0, 5)), 'person' => (string)$prev['picked_up_by']]));
        }
        $kind = in_array((string)($d['kind'] ?? ''), ['early', 'pickup'], true) ? (string)$d['kind'] : self::defaultKind($c);
        $note = self::clip($d['note'] ?? '', 255);
        $gid = (int)($d['guardian_id'] ?? 0);
        $override = '';
        if ($gid) {
            $r = self::one('SELECT * FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ? AND registration_id = ?', [$gid, $c, $stu['registration_id']]);
            if (!$r) {
                throw new \DomainException('This person is not on the student\'s list.');
            }
            $p = self::personView($c, $r, true);
            if (!$p['can_pickup']) {
                self::refuse($a, $stu, $p['name'], $p['relation'], 'Not allowed to collect' . ($p['restriction_note'] ? ': ' . $p['restriction_note'] : ''));
                throw new \DomainException(Locale::t($c, '{name} is NOT allowed to collect {student}. Do not hand the child over – the office and the family have been told.',
                    ['name' => $p['name'], 'student' => $stu['name']]));
            }
            if ($p['status'] !== 'approved') {
                throw new \DomainException('This person is waiting for the office to approve them.');
            }
            $bm = self::blockedMatch($c, $stu['registration_id'], (string)$r['name'], $r['phone_last10'] ?? null, $gid);
            if ($bm) {
                self::refuse($a, $stu, $p['name'], $p['relation'], 'Matches a person not allowed to collect' . ($bm['restriction_note'] ? ': ' . $bm['restriction_note'] : ''));
                throw new \DomainException(Locale::t($c, '{name} is NOT allowed to collect {student}. Do not hand the child over – the office and the family have been told.',
                    ['name' => $p['name'], 'student' => $stu['name']]));
            }
            if (!$p['valid_today']) {
                throw new \DomainException(Locale::t($c, '{name} may only collect between {from} and {until}.',
                    ['name' => $p['name'], 'from' => $p['from'] ? Locale::date($c, $p['from'], 'medium') : '…', 'until' => $p['until'] ? Locale::date($c, $p['until'], 'medium') : '…']));
            }
            $method = (string)($d['method'] ?? 'photo');
            if (!isset(self::METHODS[$method]) || $method === 'override') {
                throw new \DomainException('Choose how the person was checked.');
            }
            if ($p['needs_code']) {
                $code = preg_replace('/\D/', '', (string)($d['code'] ?? ''));
                if ($code === '' || !hash_equals((string)$r['pickup_code_hash'], self::codeHash($c, $code))) {
                    throw new \DomainException('The pick-up code is not right. Ask the person for the code the parent gave them.');
                }
                $method = 'code';
            }
            $who = $p['name'];
            $relation = $p['relation_label'];
        } else {
            self::need($a, 'approve');
            $who = self::clip($d['name'] ?? '', 100);
            $override = self::clip($d['override_reason'] ?? '', 255) ?? '';
            if ($who === null || mb_strlen($who) < 2 || $override === '') {
                throw new \DomainException('Enter who is collecting the child and why (e.g. the parent phoned and confirmed).');
            }
            $w = self::watchHit($c, $who, null, null);
            if ($w && $w['level'] === 'deny') {
                self::refuse($a, $stu, $who, (string)($d['relation'] ?? ''), 'On the watch list');
                throw new \DomainException(Locale::t($c, '{name} is NOT allowed to collect {student}. Do not hand the child over – the office and the family have been told.',
                    ['name' => $who, 'student' => $stu['name']]));
            }
            foreach (self::personRows($c, $stu['registration_id']) as $r) {
                if (!(int)$r['can_pickup'] && self::norm((string)$r['name']) === self::norm($who)) {
                    self::refuse($a, $stu, $who, (string)($d['relation'] ?? ''), 'Not allowed to collect');
                    throw new \DomainException(Locale::t($c, '{name} is NOT allowed to collect {student}. Do not hand the child over – the office and the family have been told.',
                        ['name' => $who, 'student' => $stu['name']]));
                }
            }
            $relation = self::PICKUP_RELATIONS[(string)($d['relation'] ?? '')] ?? self::clip($d['relation'] ?? '', 40);
            $method = 'override';
        }
        $req = self::one("SELECT id FROM ssms_student_leave_requests WHERE ssms_client_code = ? AND enrollment_id = ? AND status = 'approved' AND request_type = 'early_pickup'
                           AND from_date <= ? AND to_date >= ? ORDER BY id DESC LIMIT 1", [$c, $eid, $today, $today], true);
        self::db()->execute('INSERT INTO ssms_student_arrivals (ssms_client_code, enrollment_id, class_id, section_id, event_date, kind, event_time, reason, picked_up_by, relation,
                request_id, recorded_by, created, guardian_id, verify_method, override_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$c, $eid, $stu['class_id'], $stu['section_id'], $today, $kind, substr($local, 11, 8), $note, mb_substr((string)$who, 0, 100), $relation ? mb_substr((string)$relation, 0, 40) : null,
             $req ? (int)$req['id'] : null, mb_substr($a['user'], 0, 100), self::now(), $gid ?: null, $method, $override !== '' ? $override : null]);
        $id = (int)self::one('SELECT LAST_INSERT_ID() id')['id'];
        if ($method === 'override') {
            $vars = ['student' => $stu['name'], 'person' => $who, 'time' => Locale::time($c, substr($local, 11, 5)), 'reason' => $override];
            self::alertOffice($c, 'pickup-override:' . $id, fn() => ['title' => Locale::t($c, 'Collected by someone not on the list'),
                'body' => Locale::t($c, '{student} was collected at {time} by {person}, who is not on the pick-up list. Reason: {reason}', $vars)]);
            self::send($c);
        }
        // the family hears about it through the usual "early pick-up / collected" notification (Notify::scanArrivals,
        // run by the notification worker within a minute)

        return ['pickup' => self::pickupView($c, self::one('SELECT * FROM ssms_student_arrivals WHERE id = ?', [$id]))];
    }

    /** Gate: someone tried to collect a child and was refused (not on the list / not allowed). */
    public static function refusePickup(array $a, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $stu = self::student($c, trim((string)($d['enrollment_id'] ?? '')));
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }
        $name = self::clip($d['name'] ?? '', 120);
        if ($name === null || mb_strlen($name) < 2) {
            throw new \DomainException('Enter the person\'s name.');
        }
        $id = self::refuse($a, $stu, $name, (string)($d['relation'] ?? ''), self::clip($d['reason'] ?? '', 300) ?? 'Not on the pick-up list', $d);

        return ['visit' => self::visitView($c, self::visitRow($c, $id))];
    }

    private static function refuse(array $a, array $stu, string $name, string $relation, string $reason, array $d = []): int
    {
        $c = $a['client'];
        $local = self::localNow($c);
        $v = self::visitFields($c, ['name' => $name, 'phone' => $d['phone'] ?? null, 'purpose' => 'pickup', 'enrollment_id' => $stu['enrollment_id'],
            'id_type' => $d['id_type'] ?? null, 'id_last4' => $d['id_last4'] ?? null, 'vehicle_no' => $d['vehicle_no'] ?? null,
            'note' => trim('Refused at pick-up: ' . $reason . ($relation !== '' ? ' (' . $relation . ')' : ''))]);
        $id = self::insertVisit($c, $v + ['visit_date' => substr($local, 0, 10), 'status' => 'denied', 'signed_in_by' => $a['user'], 'signed_in_at' => $local], null);
        $vars = ['student' => $stu['name'], 'name' => $name, 'time' => Locale::time($c, substr($local, 11, 5))];
        $render = fn() => ['title' => Locale::t($c, 'Pick-up refused'),
            'body' => Locale::t($c, '{name} tried to collect {student} at {time} and was refused. Please contact the school if you have questions.', $vars)];
        self::alertOffice($c, 'pickup-refused:' . $id, $render);
        Notify::toUsers($c, 'pickup-refused:' . $id, Notify::familyUsers($c, $stu['enrollment_id']), $render, ['event' => 'school', 'screen' => 'MyPickup', 'enrollment_id' => $stu['enrollment_id']]);
        self::send($c);

        return $id;
    }

    /** Pick-ups of a day (and, for one class / section, who is still waiting). */
    public static function pickupLog(array $a, ?string $date, int $classId = 0, int $sectionId = 0): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $date = self::date($c, $date);
        $sql = "SELECT a.*, TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) student_name, c.class_name, s.section_name
                  FROM ssms_student_arrivals a LEFT JOIN ssms_student_enrollment e ON e.enrollment_id = a.enrollment_id AND e.ssms_client_code = a.ssms_client_code
                  LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                  LEFT JOIN ssms_classes c ON c.class_id = a.class_id LEFT JOIN ssms_sections s ON s.section_id = a.section_id
                 WHERE a.ssms_client_code = ? AND a.event_date = ? AND a.kind IN ('early','pickup')";
        $p = [$c, $date];
        if ($classId) {
            $sql .= ' AND a.class_id = ?';
            $p[] = $classId;
            if ($sectionId) {
                $sql .= ' AND a.section_id = ?';
                $p[] = $sectionId;
            }
        }
        $done = array_map(fn($r) => self::pickupView($c, $r), self::q($sql . ' ORDER BY a.event_time DESC', $p));
        $refused = array_map(fn($r) => self::visitView($c, $r), self::q("SELECT * FROM ssms_visits WHERE ssms_client_code = ? AND visit_date = ? AND purpose = 'pickup' AND status = 'denied' ORDER BY id DESC", [$c, $date]));
        $waiting = [];
        if ($classId) {
            $collected = array_flip(array_column($done, 'enrollment_id'));
            $sq = "SELECT e.enrollment_id, e.registration_id, e.roll_number, e.class_id, e.section_id, r.student_first_name, r.student_last_name, r.student_photo, c.class_name, s.section_name
                     FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                     LEFT JOIN ssms_classes c ON c.class_id = e.class_id LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                    WHERE e.ssms_client_code = ? AND COALESCE(e.status,'active') = 'active' AND e.class_id = ?" . ($sectionId ? ' AND e.section_id = ?' : '')
                . ' AND e.session_id = (SELECT MAX(e2.session_id) FROM ssms_student_enrollment e2 WHERE e2.ssms_client_code = e.ssms_client_code AND e2.class_id = e.class_id)';
            $absent = [];
            foreach (self::q("SELECT enrollment_id FROM student_attendance WHERE ssms_client_code = ? AND attendance_date = ? AND UPPER(attendance) IN ('A','L')", [$c, $date], true) as $x) {
                $absent[(string)$x['enrollment_id']] = true;
            }
            foreach (self::q($sq . ' ORDER BY e.roll_number + 0, r.student_first_name', $sectionId ? [$c, $classId, $sectionId] : [$c, $classId]) as $r) {
                if (!isset($collected[(string)$r['enrollment_id']])) {
                    $waiting[] = self::studentView($r) + ['absent' => isset($absent[(string)$r['enrollment_id']])];
                }
            }
        }

        return ['date' => $date, 'collected' => $done, 'refused' => $refused, 'waiting' => $waiting];
    }

    // ── Pick-up persons (office) ────────────────────────────────────────────

    public static function persons(array $a, string $eid): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $stu = self::student($c, $eid);
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }

        $persons = array_map(function ($r) use ($c, $stu) {
            $p = self::personView($c, $r, true);
            // same as the gate: someone with the name / mobile of a person who may NOT collect is refused there too
            $p['lookalike'] = $p['can_pickup'] && (bool)self::blockedMatch($c, $stu['registration_id'], (string)$r['name'], $r['phone_last10'] ?? null, (int)$r['id']);

            return $p;
        }, self::personRows($c, $stu['registration_id']));

        return ['student' => $stu, 'persons' => $persons,
                'can' => self::can($a), 'options' => self::options(), 'settings' => self::publicSettings($c)];
    }

    /**
     * Add a pick-up-only person (driver, nanny, one-off) or change one; for a guardian from the student record only the
     * pick-up details (allowed, note, ID, window). Taking a restriction away needs the owner / an admin.
     */
    public static function savePerson(array $a, string $eid, array $d): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $stu = self::student($c, $eid);
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }
        $id = (int)($d['id'] ?? 0);
        $old = $id ? self::one('SELECT * FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ? AND registration_id = ?', [$id, $c, $stu['registration_id']]) : null;
        if ($id && !$old) {
            throw new \DomainException('This person is not on the student\'s list.');
        }
        $f = self::personFields($c, $d, $old);
        $canPickup = array_key_exists('can_pickup', $d) ? self::flag($d['can_pickup']) : ($old ? (int)$old['can_pickup'] === 1 : true);
        $noteGiven = array_key_exists('restriction_note', $d);
        $note = $noteGiven ? self::clip($d['restriction_note'], 500) : ($old['restriction_note'] ?? null);
        $restricted = !$canPickup || trim((string)$note) !== '';
        $unblocked = $old && !(int)$old['can_pickup'] && $canPickup;
        $noteGone = $old && trim((string)$old['restriction_note']) !== '' && trim((string)$note) === '';
        if (($unblocked || $noteGone) && !$a['lift']) {
            throw new \DomainException('Only the owner or an admin can lift a collection restriction.');
        }
        $now = self::now();
        if ($old) {
            $pickupOnly = (int)$old['pickup_only'] === 1;
            $set = ['can_pickup' => $canPickup ? 1 : 0, 'restriction_note' => $note, 'id_type' => $f['id_type'], 'id_last4' => $f['id_last4'],
                    'pickup_from' => $f['pickup_from'], 'pickup_until' => $f['pickup_until']];
            if ($restricted) {
                $set['app_access'] = 0;   // same rule as the student record: restricted people lose app sign-in
            }
            if ($pickupOnly) {
                $set += ['name' => $f['name'], 'relation' => $f['relation'], 'phone' => $f['phone'], 'phone_last10' => $f['phone_last10']];
            }
            self::db()->execute('UPDATE ssms_student_guardians SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($set))) . ', modified = ? WHERE id = ? AND ssms_client_code = ?',
                array_merge(array_values($set), [$now, $id, $c]));
        } else {
            if ($canPickup && !$a['lift'] && self::blockedMatch($c, $stu['registration_id'], $f['name'], $f['phone_last10'])) {
                throw new \DomainException('This person matches someone who is NOT allowed to collect the child. Only the owner or an admin can change that.');
            }
            if (count(self::personRows($c, $stu['registration_id'])) >= self::MAX_PERSONS + StudentRecord::MAX_GUARDIANS) {
                throw new \DomainException('This student already has the most pick-up persons allowed.');
            }
            self::db()->execute('INSERT INTO ssms_student_guardians (ssms_client_code, registration_id, name, relation, phone, phone_last10, is_primary, lives_with, can_pickup, app_access,
                    gets_notices, restriction_note, sort_order, created_by, created, modified, id_type, id_last4, pickup_from, pickup_until, pickup_status, pickup_only, added_by_role,
                    approved_by, approved_at) VALUES (?,?,?,?,?,?,0,0,?,0,0,?,99,?,?,?,?,?,?,?,?,1,?,?,?)',
                [$c, $stu['registration_id'], $f['name'], $f['relation'], $f['phone'], $f['phone_last10'], $canPickup ? 1 : 0, $note, $a['user'], $now, $now,
                 $f['id_type'], $f['id_last4'], $f['pickup_from'], $f['pickup_until'], 'approved', $a['role'], $a['user'], $now]);
            $id = (int)self::one('SELECT LAST_INSERT_ID() id')['id'];
        }
        $code = null;
        if (self::flag($d['new_code'] ?? false)) {
            $code = self::setCode($c, $id);
        }

        return ['person' => self::personView($c, self::personRow($c, $id), true), 'code' => $code];
    }

    /** Approve / refuse a person a parent added. */
    public static function approvePerson(array $a, int $id, bool $ok): array
    {
        self::need($a, 'approve');
        $c = $a['client'];
        $r = self::personRow($c, $id);
        if (!$r || $r['pickup_status'] !== 'pending') {
            throw new \DomainException('This person is not waiting for approval.');
        }
        self::db()->execute('UPDATE ssms_student_guardians SET pickup_status = ?, approved_by = ?, approved_at = ?, modified = ? WHERE id = ? AND ssms_client_code = ?',
            [$ok ? 'approved' : 'rejected', $a['user'], self::now(), self::now(), $id, $c]);
        $eids = array_column(self::q("SELECT enrollment_id FROM ssms_student_enrollment WHERE ssms_client_code = ? AND registration_id = ? AND COALESCE(status,'active') = 'active'",
            [$c, (string)$r['registration_id']]), 'enrollment_id');
        foreach ($eids as $eid) {
            Notify::toUsers($c, 'pickup-person:' . $id . ':' . ($ok ? 'ok' : 'no'), Notify::familyUsers($c, (string)$eid), fn() => [
                'title' => $ok ? Locale::t($c, 'Pick-up person approved') : Locale::t($c, 'Pick-up person not approved'),
                'body' => $ok ? Locale::t($c, '{name} can now collect your child. Please make sure they bring an ID.', ['name' => $r['name']])
                    : Locale::t($c, 'The school did not approve {name} to collect your child. Please contact the office.', ['name' => $r['name']]),
            ], ['event' => 'school', 'screen' => 'MyPickup', 'enrollment_id' => (string)$eid]);
        }
        self::send($c);

        return ['person' => self::personView($c, self::personRow($c, $id), true)];
    }

    /** Remove a pick-up-only person; for a guardian: no longer allowed to collect (kept in the record). */
    public static function removePerson(array $a, int $id): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $r = self::personRow($c, $id);
        if (!$r) {
            throw new \DomainException('Not found.');
        }
        if ((int)$r['pickup_only'] === 1) {
            self::removePhoto($c, $r['photo_name']);
            self::db()->execute('DELETE FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ?', [$id, $c]);

            return ['removed' => $id, 'name' => (string)$r['name']];
        }
        throw new \DomainException('This is a guardian from the student record. To stop them collecting, switch off "May collect" (and add a note).');
    }

    /** A row for this child that is NOT allowed to collect, with the same name or mobile number. */
    private static function blockedMatch(string $c, string $regId, string $name, ?string $p10, int $exceptId = 0): ?array
    {
        $n = self::norm($name);
        foreach (self::personRows($c, $regId) as $r) {
            if ((int)$r['can_pickup'] || (int)$r['id'] === $exceptId) {
                continue;
            }
            if (($n !== '' && self::norm((string)$r['name']) === $n) || ($p10 !== null && (string)$r['phone_last10'] === $p10)) {
                return $r;
            }
        }

        return null;
    }

    public static function newCode(): string
    {
        return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    private static function setCode(string $c, int $id): string
    {
        $code = self::newCode();
        self::db()->execute('UPDATE ssms_student_guardians SET pickup_code_hash = ?, modified = ? WHERE id = ? AND ssms_client_code = ?', [self::codeHash($c, $code), self::now(), $id, $c]);

        return $code;
    }

    // ── Parents ─────────────────────────────────────────────────────────────

    public static function myPickup(array $p): array
    {
        $c = $p['client'];
        $s = self::settings($c);
        $persons = [];
        foreach (self::personRows($c, $p['student']['registration_id']) as $r) {
            if (!(int)$r['can_pickup'] || trim((string)$r['restriction_note']) !== '') {
                continue;   // restricted people are never shown to parents (same as the student record)
            }
            $v = self::personView($c, $r, false);
            $v['mine'] = (int)$r['pickup_only'] === 1 && (string)$r['added_by_role'] === 'parent';
            $persons[] = $v;
        }
        $hist = array_map(fn($r) => self::pickupView($c, $r, false),
            self::q("SELECT * FROM ssms_student_arrivals WHERE ssms_client_code = ? AND enrollment_id = ? AND kind IN ('early','pickup') ORDER BY event_date DESC, event_time DESC LIMIT 30",
                [$c, $p['eid']]));

        return ['student' => array_intersect_key($p['student'], array_flip(['enrollment_id', 'name', 'class_label'])), 'persons' => $persons, 'history' => $hist,
                'mode' => $s['parent_pickup'], 'temp_code' => (bool)$s['temp_code'], 'today' => self::today($c), 'options' => ['relations' => self::PICKUP_RELATIONS, 'id_types' => self::ID_TYPES]];
    }

    /**
     * A parent adds someone. One-off (dates given): valid at once, with a pick-up code (if the school uses codes).
     * Regular person: waits for the school's approval (or is valid at once, per the school's rules).
     */
    public static function addMyPerson(array $p, array $d): array
    {
        $c = $p['client'];
        $s = self::settings($c);
        if ($s['parent_pickup'] === 'off') {
            throw new \DomainException('Your school adds pick-up persons itself. Please contact the office.');
        }
        $f = self::personFields($c, $d, null);
        $oneOff = $f['pickup_from'] !== null || $f['pickup_until'] !== null;
        if ($oneOff) {
            if ($f['pickup_until'] === null) {
                $f['pickup_until'] = $f['pickup_from'];
            }
            if ($f['pickup_from'] === null) {
                $f['pickup_from'] = self::today($c);
            }
            if ($f['pickup_from'] < self::today($c) || (strtotime($f['pickup_until']) - strtotime($f['pickup_from'])) > 31 * 86400) {
                throw new \DomainException('A one-off person can be added from today for up to a month.');
            }
        }
        if (self::blockedMatch($c, $p['student']['registration_id'], $f['name'], $f['phone_last10'])) {
            throw new \DomainException('This person cannot be added. Please contact the school office.');
        }
        $mine = array_filter(self::personRows($c, $p['student']['registration_id']), fn($r) => (int)$r['pickup_only'] === 1 && $r['added_by_role'] === 'parent');
        if (count($mine) >= self::MAX_PERSONS) {
            throw new \DomainException('You have added the most pick-up persons allowed. Remove someone first.');
        }
        $status = $oneOff || $s['parent_pickup'] === 'direct' ? 'approved' : 'pending';
        $now = self::now();
        self::db()->execute('INSERT INTO ssms_student_guardians (ssms_client_code, registration_id, name, relation, phone, phone_last10, is_primary, lives_with, can_pickup, app_access,
                gets_notices, restriction_note, sort_order, created_by, created, modified, id_type, id_last4, pickup_from, pickup_until, pickup_status, pickup_only, added_by_role)
             VALUES (?,?,?,?,?,?,0,0,1,0,0,NULL,99,?,?,?,?,?,?,?,?,1,?)',
            [$c, $p['student']['registration_id'], $f['name'], $f['relation'], $f['phone'], $f['phone_last10'], $p['user'], $now, $now, $f['id_type'], $f['id_last4'],
             $f['pickup_from'], $f['pickup_until'], $status, 'parent']);
        $id = (int)self::one('SELECT LAST_INSERT_ID() id')['id'];
        $code = $oneOff && $s['temp_code'] ? self::setCode($c, $id) : null;
        if ($status === 'pending') {
            self::alertOffice($c, 'pickup-pending:' . $id, fn() => ['title' => Locale::t($c, 'Pick-up person to approve'),
                'body' => Locale::t($c, 'A parent of {student} added {name} ({relation}) as a pick-up person.', ['student' => $p['student']['name'], 'name' => $f['name'],
                    'relation' => Locale::t($c, self::PICKUP_RELATIONS[$f['relation']] ?? $f['relation'])])], ['screen' => 'PickupDesk', 'enrollment_id' => $p['eid']]);
            self::send($c);
        }

        return ['person' => self::personView($c, self::personRow($c, $id), false) + ['mine' => true], 'code' => $code, 'status' => $status];
    }

    public static function removeMyPerson(array $p, int $id): array
    {
        $c = $p['client'];
        $r = self::personRow($c, $id);
        if (!$r || $r['registration_id'] !== $p['student']['registration_id'] || (int)$r['pickup_only'] !== 1 || $r['added_by_role'] !== 'parent') {
            throw new \DomainException('You can only remove people you added yourself. Please contact the office for others.');
        }
        self::removePhoto($c, $r['photo_name']);
        self::db()->execute('DELETE FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ?', [$id, $c]);

        return ['removed' => $id];
    }

    /** New code for a one-off person the parent added (the old one stops working). */
    public static function newMyCode(array $p, int $id): array
    {
        $c = $p['client'];
        $r = self::personRow($c, $id);
        if (!$r || $r['registration_id'] !== $p['student']['registration_id'] || $r['added_by_role'] !== 'parent' || (int)$r['pickup_only'] !== 1) {
            throw new \DomainException('You can only do this for people you added yourself.');
        }
        if (!self::settings($c)['temp_code'] || $r['pickup_until'] === null) {
            throw new \DomainException('This person does not use a pick-up code.');
        }

        return ['code' => self::setCode($c, $id)];
    }

    /** May this parent change the photo of this person (people they added)? */
    public static function parentOwnsPerson(array $p, int $id): bool
    {
        $r = self::personRow($p['client'], $id);

        return $r && $r['registration_id'] === $p['student']['registration_id'] && (int)$r['pickup_only'] === 1 && $r['added_by_role'] === 'parent';
    }

    // ── Photos ──────────────────────────────────────────────────────────────

    /** $type: visit | person. Staff need edit; parents only for people they added (checked by the caller). */
    public static function setPhoto(string $c, string $type, int $id, string $tmp): array
    {
        try {
            [$table, $row] = self::photoTarget($c, $type, $id);
            if (!$row) {
                throw new \DomainException('Not found.');
            }
            $name = self::storePhoto($c, $tmp, $type === 'visit' ? 'v' . $id : 'p' . $id);
            self::db()->execute("UPDATE $table SET photo_name = ?, modified = ? WHERE id = ? AND ssms_client_code = ?", [$name, self::now(), $id, $c]);
            self::removePhoto($c, $row['photo_name']);

            return ['photo' => true];
        } finally {
            if (is_file($tmp)) {
                @unlink($tmp);
            }
        }
    }

    /** → [path, mime]; $parent = only people the parent can see (not restricted). */
    public static function photoFile(string $c, string $type, int $id, ?array $parent = null): array
    {
        [, $row] = self::photoTarget($c, $type, $id);
        if (!$row || !$row['photo_name']) {
            throw new \DomainException('No photo.');
        }
        if ($parent !== null && ($type !== 'person' || $row['registration_id'] !== $parent['student']['registration_id'] || !(int)$row['can_pickup']
                || trim((string)$row['restriction_note']) !== '')) {
            throw new \DomainException('Not allowed.');
        }
        $path = self::photoDir($c) . basename((string)$row['photo_name']);
        if (!is_file($path)) {
            throw new \DomainException('The photo is missing on the server.');
        }

        return [$path, self::imageMime($path) ?: 'image/jpeg'];
    }

    private static function photoTarget(string $c, string $type, int $id): array
    {
        if ($type === 'visit') {
            return ['ssms_visits', self::visitRow($c, $id)];
        }
        if ($type === 'person') {
            return ['ssms_student_guardians', self::personRow($c, $id)];
        }
        throw new \DomainException('Unknown photo.');
    }

    private static function storePhoto(string $c, string $tmp, string $prefix): string
    {
        if (!is_file($tmp) || ($size = (int)filesize($tmp)) <= 0) {
            throw new \DomainException('Take or choose a photo.');
        }
        if ($size > self::MAX_PHOTO) {
            throw new \DomainException('The photo is too big (the limit is 5 MB).');
        }
        $mime = self::imageMime($tmp);
        $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic'][$mime] ?? null;
        if ($ext === null) {
            throw new \DomainException('Use a photo (JPG, PNG, WebP or HEIC).');
        }
        $dir = self::photoDir($c);
        $name = $prefix . '_' . bin2hex(random_bytes(16)) . '.' . $ext;
        if (!@rename($tmp, $dir . $name) && !@copy($tmp, $dir . $name)) {
            throw new \RuntimeException('Could not store the photo.');
        }
        @chmod($dir . $name, 0600);

        return $name;
    }

    private static function removePhoto(string $c, $name): void
    {
        if ($name) {
            $p = self::photoDir($c) . basename((string)$name);
            if (is_file($p)) {
                @unlink($p);
            }
        }
    }

    /** <web root>/clients/<school>/Safety/ – no direct links (only through the app, after a permission check). */
    public static function photoDir(string $c): string
    {
        $root = self::$photoRoot ?? (StudentRecord::webRoot() . DIRECTORY_SEPARATOR . 'clients');
        $dir = rtrim($root, '/\\') . DIRECTORY_SEPARATOR . preg_replace('/[^A-Za-z0-9_-]/', '_', $c) . DIRECTORY_SEPARATOR . 'Safety' . DIRECTORY_SEPARATOR;
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create the photo folder.');
        }
        if (!is_file($dir . '.htaccess')) {
            @file_put_contents($dir . '.htaccess', "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
        }
        if (!is_file($dir . 'index.html')) {
            @file_put_contents($dir . 'index.html', '');
        }

        return $dir;
    }

    private static function imageMime(string $path): string
    {
        $head = (string)@file_get_contents($path, false, null, 0, 12);
        if (str_starts_with($head, "\xFF\xD8\xFF")) {
            return 'image/jpeg';
        }
        if (str_starts_with($head, "\x89PNG")) {
            return 'image/png';
        }
        if (substr($head, 0, 4) === 'RIFF' && substr($head, 8, 4) === 'WEBP') {
            return 'image/webp';
        }
        if (substr($head, 4, 4) === 'ftyp' && in_array(substr($head, 8, 4), ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'], true)) {
            return 'image/heic';
        }

        return '';
    }

    // ── Daily clean-up (from Notify::scan) ──────────────────────────────────

    /**
     * Once a day: visitors still "in" from earlier days are closed, expected visitors who never came are "no show",
     * visitor details older than the retention period are removed (photo too), one-off pick-up persons whose window
     * ended over 30 days ago are removed.
     */
    public static function daily(string $c): void
    {
        try {
            $today = self::today($c);
            $db = self::db();
            $db->execute('INSERT IGNORE INTO ssms_safety_settings (ssms_client_code) VALUES (?)', [$c]);
            if ($db->execute('UPDATE ssms_safety_settings SET daily_on = ? WHERE ssms_client_code = ? AND (daily_on IS NULL OR daily_on < ?)', [$today, $c, $today])->rowCount() < 1) {
                return;
            }
            unset(self::$cache['set|' . $c]);
            $now = self::now();
            $db->execute("UPDATE ssms_visits SET status = 'out', auto_out = 1, modified = ? WHERE ssms_client_code = ? AND status = 'in' AND visit_date < ?", [$now, $c, $today]);
            $db->execute("UPDATE ssms_visits SET status = 'no_show', modified = ? WHERE ssms_client_code = ? AND status = 'expected' AND visit_date < ?", [$now, $c, $today]);
            $cut = date('Y-m-d', strtotime($today . ' -' . self::settings($c)['retention_days'] . ' days'));
            // visits older than the retention period are deleted from the database, photo files too
            // (in batches; a big backlog is finished over the next days)
            $old = self::q("SELECT id, photo_name FROM ssms_visits WHERE ssms_client_code = ? AND visit_date < ? AND status <> 'expected' LIMIT 5000", [$c, $cut]);
            foreach ($old as $r) {
                self::removePhoto($c, $r['photo_name']);
            }
            foreach (array_chunk(array_map(fn($r) => (int)$r['id'], $old), 500) as $ids) {
                $db->execute('DELETE FROM ssms_visits WHERE ssms_client_code = ? AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', array_merge([$c], $ids));
            }
            $old = date('Y-m-d', strtotime($today . ' -30 days'));
            foreach (self::q('SELECT id, photo_name FROM ssms_student_guardians WHERE ssms_client_code = ? AND pickup_only = 1 AND pickup_until IS NOT NULL AND pickup_until < ?', [$c, $old]) as $r) {
                self::removePhoto($c, $r['photo_name']);
                $db->execute('DELETE FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ?', [(int)$r['id'], $c]);
            }
        } catch (\Throwable $e) {
            if (!str_contains($e->getMessage(), "doesn't exist") && !str_contains($e->getMessage(), 'Unknown column')) {
                Log::warning("Safety daily {$c}: " . $e->getMessage());
            }
        }
    }

    /** Privacy: a student's record is erased → their pick-up persons' photos and visits about them go too. */
    public static function eraseFor(string $c, string $reg, array $eids): void
    {
        try {
            foreach (self::q('SELECT photo_name FROM ssms_student_guardians WHERE ssms_client_code = ? AND registration_id = ? AND photo_name IS NOT NULL', [$c, $reg]) as $r) {
                self::removePhoto($c, $r['photo_name']);
            }
            if ($eids) {
                $in = implode(',', array_fill(0, count($eids), '?'));
                foreach (self::q("SELECT id, photo_name FROM ssms_visits WHERE ssms_client_code = ? AND enrollment_id IN ($in)", array_merge([$c], $eids)) as $r) {
                    self::removePhoto($c, $r['photo_name']);
                }
                self::db()->execute("DELETE FROM ssms_visits WHERE ssms_client_code = ? AND enrollment_id IN ($in)", array_merge([$c], $eids));
            }
        } catch (\Throwable $e) {
        }
    }

    // ── Views / helpers ─────────────────────────────────────────────────────

    private static function can(array $a): array
    {
        return array_intersect_key($a, array_flip(['view', 'edit', 'approve', 'delete', 'export', 'lift']));
    }

    private static function publicSettings(string $c): array
    {
        $s = self::settings($c);

        return $s;
    }

    /** early before the end of the school day (School settings), pickup after. */
    private static function defaultKind(string $c): string
    {
        $end = null;
        try {
            $r = self::one('SELECT school_end_time FROM ssms_school_settings WHERE client_code = ?', [$c]);
            $end = $r && $r['school_end_time'] ? substr((string)$r['school_end_time'], 0, 5) : null;
        } catch (\Throwable $e) {
        }
        if (!$end) {
            return 'pickup';
        }
        $now = substr(self::localNow($c), 11, 5);

        return $now < date('H:i', strtotime('2000-01-01 ' . $end . ':00') - 15 * 60) ? 'early' : 'pickup';
    }

    private static function visitFields(string $c, array $d): array
    {
        $name = self::clip($d['name'] ?? '', 120);
        if ($name === null || mb_strlen($name) < 2) {
            throw new \DomainException('Enter the visitor\'s name.');
        }
        $phoneRaw = trim((string)($d['phone'] ?? ''));
        $p10 = self::last10($phoneRaw);
        if ($phoneRaw !== '' && $p10 === null) {
            throw new \DomainException('The phone number does not look right.');
        }
        $purpose = (string)($d['purpose'] ?? 'meeting');
        if (!isset(self::PURPOSES[$purpose])) {
            throw new \DomainException('Choose why they are visiting.');
        }
        $host = (int)($d['host_staff_id'] ?? 0) ?: null;
        if ($host && !self::one("SELECT 1 x FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?", [$host, $c])) {
            throw new \DomainException('Choose a staff member of this school.');
        }
        $eid = trim((string)($d['enrollment_id'] ?? '')) ?: null;
        if ($eid && !self::student($c, $eid)) {
            throw new \DomainException('Student not found.');
        }
        $idType = (string)($d['id_type'] ?? '');
        $idType = isset(self::ID_TYPES[$idType]) ? $idType : null;
        $id4 = self::idLast4((string)($d['id_last4'] ?? ''));

        return ['name' => $name, 'phone' => $phoneRaw !== '' ? mb_substr($phoneRaw, 0, 30) : null, 'phone_last10' => $p10, 'company' => self::clip($d['company'] ?? '', 120),
                'purpose' => $purpose, 'host_staff_id' => $host, 'host_name' => $host ? null : self::clip($d['host_name'] ?? '', 120), 'enrollment_id' => $eid,
                'id_type' => $idType, 'id_last4' => $idType ? $id4 : null, 'vehicle_no' => self::clip(strtoupper((string)($d['vehicle_no'] ?? '')), 30),
                'badge_no' => self::clip($d['badge_no'] ?? '', 20), 'note' => self::clip($d['note'] ?? '', 500)];
    }

    private static function insertVisit(string $c, array $f, ?array $expected): int
    {
        $now = self::now();
        if ($expected) {
            $set = $f;
            $set['pass_code_hash'] = null;
            self::db()->execute('UPDATE ssms_visits SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($set))) . ', modified = ? WHERE id = ? AND ssms_client_code = ?',
                array_merge(array_values($set), [$now, (int)$expected['id'], $c]));

            return (int)$expected['id'];
        }
        $cols = array_keys($f);
        self::db()->execute('INSERT INTO ssms_visits (ssms_client_code, ' . implode(', ', $cols) . ', created, modified) VALUES (?, ' . implode(', ', array_fill(0, count($cols), '?')) . ', ?, ?)',
            array_merge([$c], array_values($f), [$now, $now]));

        return (int)self::one('SELECT LAST_INSERT_ID() id')['id'];
    }

    private static function visitRow(string $c, int $id): ?array
    {
        return self::one('SELECT * FROM ssms_visits WHERE id = ? AND ssms_client_code = ?', [$id, $c]);
    }

    private static function visitView(string $c, array $r, bool $full = true): array
    {
        $staff = self::staffMap($c);
        $host = $r['host_staff_id'] ? ($staff[(int)$r['host_staff_id']] ?? '') : (string)($r['host_name'] ?? '');
        $stu = $r['enrollment_id'] ? self::student($c, (string)$r['enrollment_id']) : null;
        $v = ['id' => (int)$r['id'], 'date' => substr((string)$r['visit_date'], 0, 10), 'status' => (string)$r['status'], 'name' => (string)$r['name'],
              'company' => $r['company'], 'purpose' => (string)$r['purpose'], 'host_staff_id' => $r['host_staff_id'] ? (int)$r['host_staff_id'] : null, 'host' => $host,
              'enrollment_id' => $r['enrollment_id'], 'student' => $stu ? $stu['name'] . ' (' . $stu['class_label'] . ')' : null,
              'expected_time' => $r['expected_time'], 'signed_in_at' => $r['signed_in_at'], 'signed_out_at' => $r['signed_out_at'], 'auto_out' => (int)$r['auto_out'] === 1,
              'badge_no' => $r['badge_no'], 'photo' => (bool)$r['photo_name'], 'photo_v' => $r['photo_name'] ? substr(md5((string)$r['photo_name']), 0, 8) : null, 'purged' => (int)$r['purged'] === 1,
              'has_code' => $r['status'] === 'expected' && !empty($r['pass_code_hash']), 'group' => $r['status'] === 'expected' && !empty($r['pass_code_hash']) ? substr(md5((string)$r['pass_code_hash']), 0, 10) : null];
        if ($full) {
            $v += ['phone' => $r['phone'], 'id_type' => $r['id_type'], 'id_last4' => $r['id_last4'], 'vehicle_no' => $r['vehicle_no'], 'note' => $r['note'],
                   'watch_level' => $r['watch_level'], 'agreed_rules' => (int)$r['agreed_rules'] === 1, 'signed_in_by' => $r['signed_in_by'], 'signed_out_by' => $r['signed_out_by']];
        }

        return $v;
    }

    private static function historyWhere(string $c, array $f): array
    {
        $sql = 'ssms_client_code = ?';
        $p = [$c];
        $from = self::date($c, (string)($f['from'] ?? ''), date('Y-m-d', strtotime(self::today($c) . ' -30 days')));
        $to = self::date($c, (string)($f['to'] ?? ''));
        if ($to < $from) {
            [$from, $to] = [$to, $from];
        }
        $sql .= ' AND visit_date BETWEEN ? AND ?';
        array_push($p, $from, $to);
        if (!empty($f['status']) && in_array($f['status'], ['expected', 'in', 'out', 'denied', 'cancelled', 'no_show'], true)) {
            $sql .= ' AND status = ?';
            $p[] = $f['status'];
        }
        $q = trim((string)($f['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            $sql .= ' AND (name LIKE ? OR company LIKE ? OR vehicle_no LIKE ? OR phone_last10 = ?)';
            array_push($p, $like, $like, $like, (string)self::last10($q));
        }

        return [$sql, $p];
    }

    private static function student(string $c, string $eid): ?array
    {
        if ($eid === '') {
            return null;
        }
        $k = 'stu|' . $c . '|' . $eid;
        if (array_key_exists($k, self::$cache)) {
            return self::$cache[$k];
        }
        $r = self::one("SELECT e.enrollment_id, e.registration_id, e.roll_number, e.class_id, e.section_id, r.student_first_name, r.student_last_name, r.student_photo, c.class_name, s.section_name
                          FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                          LEFT JOIN ssms_classes c ON c.class_id = e.class_id LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                         WHERE e.ssms_client_code = ? AND e.enrollment_id = ? AND COALESCE(e.status, 'active') = 'active' LIMIT 1", [$c, $eid]);

        return self::$cache[$k] = $r ? self::studentView($r) : null;
    }

    private static function studentView(array $r): array
    {
        $cls = trim((string)($r['class_name'] ?? ''));
        $sec = trim((string)($r['section_name'] ?? ''));

        return ['enrollment_id' => (string)$r['enrollment_id'], 'registration_id' => (string)$r['registration_id'], 'roll_number' => (string)($r['roll_number'] ?? ''),
                'class_id' => $r['class_id'] !== null ? (int)$r['class_id'] : null, 'section_id' => $r['section_id'] !== null ? (int)$r['section_id'] : null,
                'name' => trim($r['student_first_name'] . ' ' . $r['student_last_name']), 'photo' => (string)($r['student_photo'] ?? ''),
                'class_label' => $sec !== '' ? $cls . ' – ' . $sec : $cls];
    }

    private static function personRows(string $c, string $reg): array
    {
        return self::q('SELECT * FROM ssms_student_guardians WHERE ssms_client_code = ? AND registration_id = ? ORDER BY pickup_only, is_primary DESC, sort_order, id', [$c, $reg]);
    }

    private static function personRow(string $c, int $id): ?array
    {
        return self::one('SELECT * FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ?', [$id, $c]);
    }

    private static function personView(string $c, array $r, bool $staff): array
    {
        $today = self::today($c);
        $from = $r['pickup_from'] ? substr((string)$r['pickup_from'], 0, 10) : null;
        $until = $r['pickup_until'] ? substr((string)$r['pickup_until'], 0, 10) : null;
        $s = self::settings($c);
        $v = ['id' => (int)$r['id'], 'name' => (string)$r['name'], 'relation' => (string)$r['relation'],
              'relation_label' => self::PICKUP_RELATIONS[$r['relation']] ?? StudentRecord::RELATIONS[$r['relation']] ?? ucfirst((string)$r['relation']),
              'phone' => $r['phone'], 'photo' => (bool)$r['photo_name'], 'photo_v' => $r['photo_name'] ? substr(md5((string)$r['photo_name']), 0, 8) : null, 'id_type' => $r['id_type'], 'id_last4' => $r['id_last4'],
              'from' => $from, 'until' => $until, 'one_off' => $until !== null, 'valid_today' => ($from === null || $from <= $today) && ($until === null || $until >= $today),
              'ended' => $until !== null && $until < $today, 'status' => (string)$r['pickup_status'], 'pickup_only' => (int)$r['pickup_only'] === 1,
              'guardian' => (int)$r['pickup_only'] !== 1, 'is_primary' => (int)$r['is_primary'] === 1, 'can_pickup' => (int)$r['can_pickup'] === 1,
              'needs_code' => $s['temp_code'] && $until !== null && (string)$r['pickup_code_hash'] !== '' && $r['pickup_code_hash'] !== null,
              'added_by' => (string)($r['added_by_role'] ?? '') === 'parent' ? 'parent' : 'school'];
        if ($staff) {
            $v['restriction_note'] = $r['restriction_note'];
        }

        return $v;
    }

    private static function personFields(string $c, array $d, ?array $old): array
    {
        $only = !$old || (int)$old['pickup_only'] === 1;
        $name = $only ? self::clip($d['name'] ?? '', 150) : (string)$old['name'];
        if ($name === null || mb_strlen($name) < 2) {
            throw new \DomainException('Enter the person\'s name.');
        }
        $relation = $only ? (string)($d['relation'] ?? 'other') : (string)$old['relation'];
        if ($only && !isset(self::PICKUP_RELATIONS[$relation])) {
            $relation = 'other';
        }
        $phoneRaw = $only ? trim((string)($d['phone'] ?? '')) : (string)$old['phone'];
        $p10 = self::last10($phoneRaw);
        if ($only && $phoneRaw !== '' && $p10 === null) {
            throw new \DomainException('The phone number does not look right.');
        }
        if ($only && $phoneRaw === '') {
            throw new \DomainException('Add the person\'s mobile number (the school may need to call them).');
        }
        $idType = array_key_exists('id_type', $d) ? (string)$d['id_type'] : (string)($old['id_type'] ?? '');
        $idType = isset(self::ID_TYPES[$idType]) ? $idType : null;
        $id4 = array_key_exists('id_last4', $d) ? self::idLast4((string)$d['id_last4']) : ($old['id_last4'] ?? null);
        $from = array_key_exists('from', $d) ? self::optDate((string)$d['from']) : ($old['pickup_from'] ?? null);
        $until = array_key_exists('until', $d) ? self::optDate((string)$d['until']) : ($old['pickup_until'] ?? null);
        if ($from && $until && $until < $from) {
            throw new \DomainException('The last day must be on or after the first day.');
        }

        return ['name' => $name, 'relation' => $relation, 'phone' => $phoneRaw !== '' ? mb_substr($phoneRaw, 0, 30) : null, 'phone_last10' => $p10,
                'id_type' => $idType, 'id_last4' => $idType ? $id4 : null, 'pickup_from' => $from ? substr((string)$from, 0, 10) : null, 'pickup_until' => $until ? substr((string)$until, 0, 10) : null];
    }

    private static function pickupView(string $c, array $r, bool $staff = true): array
    {
        $v = ['id' => (int)$r['id'], 'enrollment_id' => (string)$r['enrollment_id'], 'date' => substr((string)$r['event_date'], 0, 10), 'time' => substr((string)$r['event_time'], 0, 5),
              'kind' => (string)$r['kind'], 'by' => (string)($r['picked_up_by'] ?? ''), 'relation' => (string)($r['relation'] ?? ''),
              'method' => (string)($r['verify_method'] ?? ''), 'student' => (string)($r['student_name'] ?? ''),
              'class_label' => trim((string)($r['class_name'] ?? '') . (($r['section_name'] ?? '') !== '' ? ' – ' . $r['section_name'] : ''))];
        if ($staff) {
            $v += ['recorded_by' => (string)($r['recorded_by'] ?? ''), 'override_reason' => $r['override_reason'] ?? null, 'note' => $r['reason'] ?? null];
        }

        return $v;
    }

    /** Active staff: id → name. */
    public static function staffMap(string $c): array
    {
        if (isset(self::$cache['staff|' . $c])) {
            return self::$cache['staff|' . $c];
        }
        $out = [];
        foreach (self::q("SELECT staff_id, first_name, last_name FROM ssms_staff WHERE ssms_client_code = ? AND COALESCE(hired,'Y') IN ('Y','Yes','yes','1','y')
                           AND LOWER(TRIM(COALESCE(resigned,'N'))) IN ('n','no','0','') ORDER BY first_name, last_name", [$c]) as $r) {
            $out[(int)$r['staff_id']] = trim($r['first_name'] . ' ' . $r['last_name']);
        }

        return self::$cache['staff|' . $c] = $out;
    }

    public static function staffList(array $a): array
    {
        return ['staff' => array_map(fn($id, $n) => ['staff_id' => $id, 'name' => $n], array_keys(self::staffMap($a['client'])), self::staffMap($a['client']))];
    }

    private static function usersOfStaff(string $c, int $sid): array
    {
        return array_column(self::q("SELECT ssms_user_name FROM sawera_ssms_users WHERE ssms_client_code = ? AND staff_id = ? AND LOWER(TRIM(COALESCE(ssms_user_status,''))) = 'active'
                                       AND LOWER(COALESCE(ssms_user_role,'')) NOT IN ('parent','student')", [$c, $sid]), 'ssms_user_name');
    }

    /** Owner, and anyone whose role may approve in Visitors & safe pick-up. */
    public static function managers(string $c): array
    {
        $out = [];
        foreach (self::q("SELECT ssms_user_name, ssms_user_role, custom_role_id FROM sawera_ssms_users WHERE ssms_client_code = ? AND LOWER(TRIM(COALESCE(ssms_user_status,''))) = 'active'", [$c]) as $u) {
            $role = strtolower(trim((string)$u['ssms_user_role']));
            $role = $role === 'teacher' ? 'user' : $role;
            if (!in_array($role, Permissions::BASE_ROLES, true)) {
                continue;
            }
            try {
                if ($role === 'owner' || !empty(Permissions::forUser($c, $role, $u['custom_role_id'] ?? null)['safety']['approve'])) {
                    $out[] = (string)$u['ssms_user_name'];
                }
            } catch (\Throwable $e) {
            }
        }

        return $out;
    }

    private static function alertOffice(string $c, string $ref, callable $render, array $data = []): void
    {
        Notify::toUsers($c, $ref, self::managers($c), $render, $data + ['event' => 'school', 'screen' => 'VisitorDesk']);
    }

    private static function send(string $c): void
    {
        if (self::$sendNow) {
            try {
                Notify::pushNow($c);
            } catch (\Throwable $e) {
                Log::warning('Safety send: ' . $e->getMessage());
            }
        }
    }

    private static function codeHash(string $c, string $code): string
    {
        return hash_hmac('sha256', $c . '|' . $code, \Cake\Utility\Security::getSalt());
    }

    private static function last10(string $phone): ?string
    {
        $d = preg_replace('/\D/', '', $phone);

        return strlen($d) >= 6 ? substr($d, -10) : null;
    }

    private static function idLast4(string $v): ?string
    {
        $v = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $v));

        return $v !== '' ? substr($v, -4) : null;
    }

    private static function norm(string $s): string
    {
        return trim(preg_replace('/\s+/u', ' ', mb_strtolower($s)));
    }

    private static function flag($v): bool
    {
        return $v === true || $v === 1 || in_array(strtolower(trim((string)$v)), ['1', 'true', 'yes', 'on'], true);
    }

    private static function clip($s, int $n): ?string
    {
        $s = trim((string)preg_replace('/\s+/u', ' ', (string)$s));

        return $s === '' ? null : mb_substr($s, 0, $n);
    }

    private static function date(string $c, ?string $d, ?string $default = null): string
    {
        $d = trim((string)$d);
        if ($d === '') {
            return $default ?? self::today($c);
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4))) {
            throw new \DomainException('Choose a date.');
        }

        return $d;
    }

    private static function optDate(string $d): ?string
    {
        $d = trim($d);
        if ($d === '') {
            return null;
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4))) {
            throw new \DomainException('Choose a date.');
        }

        return $d;
    }

    private static function today(string $c): string
    {
        return Locale::today($c);
    }

    private static function localNow(string $c): string
    {
        return Locale::now($c);
    }

    private static function now(): string
    {
        return AccountSecurity::now();
    }

    private static function q(string $sql, array $p = [], bool $soft = false): array
    {
        try {
            return self::db()->execute($sql, $p)->fetchAll('assoc');
        } catch (\Throwable $e) {
            if ($soft) {
                return [];   // an optional table (e.g. leave requests) is not installed
            }
            throw $e;
        }
    }

    private static function one(string $sql, array $p = [], bool $soft = false): ?array
    {
        try {
            $r = self::db()->execute($sql, $p)->fetch('assoc');
        } catch (\Throwable $e) {
            if ($soft) {
                return null;
            }
            throw $e;
        }

        return $r ?: null;
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
