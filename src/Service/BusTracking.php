<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Live bus tracking.
 *
 * The driver's phone (the app login linked to the route's driver in Transport › Assignments) starts a trip –
 * morning pick-up (to school) or afternoon drop (from school) – and sends its position every few seconds.
 * From the positions the server works out which stop the bus is at, which stops are next and when the bus
 * will reach them, and tells families: trip started, bus is near (minutes or metres), bus at your stop, and –
 * when the driver / attendant marks students – got on, got off / reached school, not on the bus.
 *
 * Parents and students see the bus of their own child's route, only while a trip is running.
 * The office sees every bus (Roles › Transport, view); ending trips, linking driver logins and the rules need edit.
 *
 * Reused: ssms_transport_routes / _stops / _vehicles / _drivers / _assignments / _enrollments.
 * New: ssms_transport_trips / _trip_points / _trip_stops / _boardings / _settings (+ drivers.username).
 */
class BusTracking
{
    public const DEFAULTS = ['near_minutes' => 5, 'near_meters' => 1000, 'stop_radius' => 100, 'alert_start' => 1, 'alert_near' => 1,
                             'alert_arrived' => 1, 'alert_board' => 1, 'keep_days' => 30, 'idle_minutes' => 90, 'auto_trips' => 1];
    /** Bus phone / GPS tracker: trips start and end by themselves in these windows (school's local time). */
    public const WINDOWS = ['morning_from' => '06:00', 'morning_to' => '10:30', 'afternoon_from' => '12:00', 'afternoon_to' => '19:00'];
    public const MODES = ['driver' => "Driver's phone (app login)", 'phone' => 'Bus phone (paired with a QR code, no login)', 'gps' => 'GPS tracker device'];
    /** Parents can switch these off for themselves (stored in ssms_notify_prefs, channel push). */
    public const ALERTS = ['bus_trip' => 'Trip started', 'bus_near' => 'Bus is near', 'bus_stop' => 'Bus at my stop', 'bus_board' => 'Got on / got off the bus'];
    public const DIRECTIONS = ['pickup' => 'Morning pick-up (to school)', 'drop' => 'Afternoon drop (from school)'];
    /** A position older than this is "not live" any more (seconds). */
    public const STALE = 120;
    /** Speed used before the bus has moved enough to measure it (m/s ≈ 22 km/h). */
    public const DEFAULT_SPEED = 6.0;
    /** Roads are longer than the straight line between stops. */
    public const ROAD_FACTOR = 1.3;
    public const MAX_POINTS = 120;
    /** How many of the next stops (in order) the bus can be found at. */
    public const WINDOW = 2;

    /** Tests: send pushes at once. */
    public static bool $sendNow = true;
    private static array $cache = [];

    public static function resetCache(): void
    {
        self::$cache = [];
    }

    // ── Who is asking ───────────────────────────────────────────────────────

    /** Staff. driver_ids: the transport drivers this login is (linked login, or the same mobile number). */
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
        $g = fn(string $k) => $owner || !empty($grid['transport'][$k]);

        return ['client' => $client, 'user' => $user, 'role' => $role, 'view' => $g('view'), 'edit' => $g('edit'),
                'driver_ids' => self::driverIdsFor($client, $user)];
    }

    /** Parents / students: the children of this account. */
    public static function familyAccess(string $client, array $actor): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $user = (string)($actor['user'] ?? '');
        if (!in_array($role, ['parent', 'student'], true) || $user === '') {
            throw new \DomainException('Not allowed.');
        }

        return ['client' => $client, 'user' => $user, 'role' => $role,
                'eids' => StudentLeave::myEnrollmentIds($client, $role, $user, $actor['enrollment_id'] ?? null)];
    }

    private static function need(array $a, string $kind): void
    {
        if (empty($a[$kind])) {
            throw new \DomainException($kind === 'view'
                ? "You don't have permission to see the buses. Ask the school owner if you need it (Roles › Transport)."
                : "You don't have permission to change this. Ask the school owner if you need it (Roles › Transport, edit).");
        }
    }

    public static function driverIdsFor(string $c, string $user): array
    {
        try {
            $u = self::one('SELECT mobile_number FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1', [$user, $c]);
            $m = substr(preg_replace('/\D/', '', (string)($u['mobile_number'] ?? '')), -10);
            $ids = [];
            foreach (self::q("SELECT driver_id, username, mobile_number FROM ssms_transport_drivers WHERE ssms_client_code = ? AND COALESCE(status,'active') = 'active'", [$c]) as $d) {
                $linked = trim((string)$d['username']);
                if ($linked !== '' ? strcasecmp($linked, $user) === 0
                    : (strlen($m) >= 8 && substr(preg_replace('/\D/', '', (string)$d['mobile_number']), -10) === $m)) {
                    $ids[] = (int)$d['driver_id'];
                }
            }

            return $ids;
        } catch (\Throwable $e) {
            return [];
        }
    }

    // ── Settings ────────────────────────────────────────────────────────────

    public static function settings(string $c): array
    {
        if (isset(self::$cache['set|' . $c])) {
            return self::$cache['set|' . $c];
        }
        $s = self::DEFAULTS;
        try {
            $r = self::one('SELECT * FROM ssms_transport_settings WHERE ssms_client_code = ?', [$c]);
            foreach (array_keys(self::DEFAULTS) as $k) {
                if ($r && isset($r[$k])) {
                    $s[$k] = (int)$r[$k];
                }
            }
        } catch (\Throwable $e) {
            $r = null;
        }
        foreach (self::WINDOWS as $k => $def) {
            $s[$k] = $r && !empty($r[$k]) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string)$r[$k]) ? (string)$r[$k] : $def;
        }

        return self::$cache['set|' . $c] = $s;
    }

    public static function saveSettings(array $a, array $d): array
    {
        self::need($a, 'edit');
        $s = self::settings($a['client']);
        $ranges = ['near_minutes' => [1, 30], 'near_meters' => [100, 5000], 'stop_radius' => [30, 500], 'keep_days' => [7, 365], 'idle_minutes' => [20, 360]];
        foreach ($ranges as $k => [$lo, $hi]) {
            if (array_key_exists($k, $d)) {
                $v = trim((string)$d[$k]);
                if (!ctype_digit($v) || (int)$v < $lo || (int)$v > $hi) {
                    throw new \DomainException(Locale::t($a['client'], 'Enter a number from {lo} to {hi}.', ['lo' => $lo, 'hi' => $hi]));
                }
                $s[$k] = (int)$v;
            }
        }
        foreach (['alert_start', 'alert_near', 'alert_arrived', 'alert_board', 'auto_trips'] as $k) {
            if (array_key_exists($k, $d)) {
                $s[$k] = self::flag($d[$k]) ? 1 : 0;
            }
        }
        foreach (array_keys(self::WINDOWS) as $k) {
            if (array_key_exists($k, $d)) {
                $v = trim((string)$d[$k]);
                if (preg_match('/^(\d):(\d\d)$/', $v)) {
                    $v = '0' . $v;
                }
                if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) {
                    throw new \DomainException('Enter the times as HH:MM.');
                }
                $s[$k] = $v;
            }
        }
        if ($s['morning_from'] >= $s['morning_to'] || $s['afternoon_from'] >= $s['afternoon_to'] || $s['morning_to'] > $s['afternoon_from']) {
            throw new \DomainException('The morning window must end before the afternoon window starts, and each must start before it ends.');
        }
        $cols = array_merge(array_keys(self::DEFAULTS), array_keys(self::WINDOWS));
        self::db()->execute('INSERT INTO ssms_transport_settings (ssms_client_code, ' . implode(', ', $cols) . ', modified, modified_by) VALUES (?' . str_repeat(', ?', count($cols)) . ', ?, ?)
            ON DUPLICATE KEY UPDATE ' . implode(', ', array_map(fn($k) => "$k = VALUES($k)", $cols)) . ', modified = VALUES(modified), modified_by = VALUES(modified_by)',
            array_merge([$a['client']], array_map(fn($k) => $s[$k], $cols), [self::now(), $a['user']]));
        unset(self::$cache['set|' . $a['client']]);

        return self::settings($a['client']);
    }

    // ── Drivers' app logins ─────────────────────────────────────────────────

    public static function drivers(array $a): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $users = self::q("SELECT ssms_user_name, ssms_user_firstname, ssms_user_lastname, mobile_number, ssms_user_role FROM sawera_ssms_users
                           WHERE ssms_client_code = ? AND LOWER(TRIM(COALESCE(ssms_user_status,''))) = 'active' AND LOWER(COALESCE(ssms_user_role,'')) NOT IN ('parent','student')
                           ORDER BY ssms_user_firstname, ssms_user_name", [$c]);
        $byMobile = [];
        foreach ($users as $u) {
            $m = substr(preg_replace('/\D/', '', (string)$u['mobile_number']), -10);
            if (strlen($m) >= 8) {
                $byMobile[$m][] = $u['ssms_user_name'];
            }
        }
        $out = [];
        foreach (self::q("SELECT * FROM ssms_transport_drivers WHERE ssms_client_code = ? ORDER BY driver_name", [$c]) as $d) {
            $linked = trim((string)$d['username']);
            $m = substr(preg_replace('/\D/', '', (string)$d['mobile_number']), -10);
            $auto = $linked === '' && strlen($m) >= 8 ? ($byMobile[$m] ?? []) : [];
            $out[] = ['driver_id' => (int)$d['driver_id'], 'name' => (string)$d['driver_name'], 'mobile' => $d['mobile_number'], 'status' => (string)($d['status'] ?? 'active'),
                      'username' => $linked !== '' ? $linked : null, 'auto_username' => $auto[0] ?? null];
        }

        return ['drivers' => $out, 'logins' => array_map(fn($u) => ['username' => $u['ssms_user_name'],
            'name' => trim(($u['ssms_user_firstname'] ?? '') . ' ' . ($u['ssms_user_lastname'] ?? '')) ?: $u['ssms_user_name'], 'role' => strtolower((string)$u['ssms_user_role'])], $users)];
    }

    public static function linkDriver(array $a, int $driverId, string $username): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        if (!self::one('SELECT 1 x FROM ssms_transport_drivers WHERE driver_id = ? AND ssms_client_code = ?', [$driverId, $c])) {
            throw new \DomainException('Driver not found.');
        }
        $username = trim($username);
        if ($username !== '' && !self::one("SELECT 1 x FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? AND LOWER(COALESCE(ssms_user_role,'')) NOT IN ('parent','student')
                                              AND LOWER(TRIM(COALESCE(ssms_user_status,''))) = 'active'", [$username, $c])) {
            throw new \DomainException('Choose an active staff login of this school.');
        }
        self::db()->execute('UPDATE ssms_transport_drivers SET username = ?, modified = ? WHERE driver_id = ? AND ssms_client_code = ?',
            [$username !== '' ? $username : null, self::now(), $driverId, $c]);

        return self::drivers($a);
    }

    // ── Driver ──────────────────────────────────────────────────────────────

    /** The routes this login drives (all routes for transport edit), with today's trips. */
    public static function driverHome(array $a): array
    {
        $c = $a['client'];
        $sess = self::currentSession($c);
        $rows = self::q("SELECT a.route_id, a.vehicle_id, a.driver_id, r.route_name, v.vehicle_number, d.driver_name
                           FROM ssms_transport_assignments a JOIN ssms_transport_routes r ON r.route_id = a.route_id
                           LEFT JOIN ssms_transport_vehicles v ON v.vehicle_id = a.vehicle_id LEFT JOIN ssms_transport_drivers d ON d.driver_id = a.driver_id
                          WHERE a.ssms_client_code = ? AND a.session_id = ? AND COALESCE(r.status,'active') = 'active' ORDER BY r.route_name", [$c, $sess]);
        $routes = [];
        foreach ($rows as $r) {
            $mine = in_array((int)$r['driver_id'], $a['driver_ids'], true);
            if (!$mine && !$a['edit']) {
                continue;
            }
            $routes[(int)$r['route_id']] = ['route_id' => (int)$r['route_id'], 'route_name' => (string)$r['route_name'], 'vehicle_number' => $r['vehicle_number'],
                'driver_name' => $r['driver_name'], 'mine' => $mine, 'stops' => 0, 'stops_on_map' => 0, 'trips' => []];
        }
        if ($routes) {
            $in = implode(',', array_keys($routes));
            foreach (self::q("SELECT route_id, COUNT(*) n, SUM(latitude IS NOT NULL AND longitude IS NOT NULL AND latitude <> 0) m FROM ssms_transport_stops WHERE ssms_client_code = ? AND route_id IN ($in) GROUP BY route_id", [$c]) as $s) {
                $routes[(int)$s['route_id']]['stops'] = (int)$s['n'];
                $routes[(int)$s['route_id']]['stops_on_map'] = (int)$s['m'];
            }
            foreach (self::q("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id IN ($in) AND trip_date = ? ORDER BY id", [$c, self::today($c)]) as $t) {
                $routes[(int)$t['route_id']]['trips'][] = self::tripBrief($c, $t);
            }
        }

        return ['routes' => array_values($routes), 'linked' => (bool)$a['driver_ids'], 'today' => self::today($c),
                'suggested' => (int)Locale::now($c, 'G') < 12 ? 'pickup' : 'drop', 'directions' => self::DIRECTIONS, 'settings' => self::settings($c)];
    }

    private static function canDrive(array $a, int $routeId): array
    {
        $c = $a['client'];
        $as = self::one("SELECT a.*, r.route_name FROM ssms_transport_assignments a JOIN ssms_transport_routes r ON r.route_id = a.route_id
                          WHERE a.ssms_client_code = ? AND a.route_id = ? AND a.session_id = ? LIMIT 1", [$c, $routeId, self::currentSession($c)]);
        if (!$as) {
            throw new \DomainException('This route has no bus and driver for this school year. Set it in Transport › Assignments.');
        }
        if (!$a['edit'] && !in_array((int)$as['driver_id'], $a['driver_ids'], true)) {
            throw new \DomainException('You are not the driver of this route. Ask the office to link your login to the driver (Transport › Live buses › Drivers).');
        }

        return $as;
    }

    /** Start (or resume) today's trip of a route in one direction. */
    public static function startTrip(array $a, int $routeId, string $direction): array
    {
        $c = $a['client'];
        if (!isset(self::DIRECTIONS[$direction])) {
            throw new \DomainException('Choose morning pick-up or afternoon drop.');
        }
        $as = self::canDrive($a, $routeId);
        $today = self::today($c);
        $now = self::now();
        // left running from an earlier day (phone switched off): close it
        foreach (self::q("SELECT id FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id = ? AND status = 'running' AND trip_date < ?", [$c, $routeId, $today]) as $old) {
            self::closeTrip($c, (int)$old['id'], 'idle', null);
        }
        $run = self::one("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id = ? AND status = 'running' LIMIT 1", [$c, $routeId]);
        if ($run && $run['direction'] === $direction) {
            return ['trip' => self::tripFull($c, $run, true), 'resumed' => true];
        }
        if ($run) {
            throw new \DomainException(Locale::t($c, 'The {direction} trip of this route is still running. End it first.',
                ['direction' => Locale::t($c, self::DIRECTIONS[$run['direction']] ?? $run['direction'])]));
        }
        return self::createTrip($c, $as, $direction, $a['user'], 'driver');
    }

    /** A new trip of a route (assignment row $as) in one direction; families are told it started. */
    private static function createTrip(string $c, array $as, string $direction, string $by, string $source): array
    {
        $routeId = (int)$as['route_id'];
        $today = self::today($c);
        $now = self::now();
        $stops = self::routeStops($c, $routeId);
        if (!$stops) {
            throw new \DomainException('This route has no stops yet. Add them in Transport › Routes.');
        }
        try {
            self::db()->execute('INSERT INTO ssms_transport_trips (ssms_client_code, route_id, vehicle_id, driver_id, session_id, direction, trip_date, status, run_key, started_at, started_by, source, created, modified)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$c, $routeId, $as['vehicle_id'] ? (int)$as['vehicle_id'] : null, $as['driver_id'] ? (int)$as['driver_id'] : null,
                (int)$as['session_id'], $direction, $today, 'running', $c . '|' . $routeId, $now, $by, $source, $now, $now]);
        } catch (\Throwable $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {   // two phones started it at the same moment
                $run = self::one("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id = ? AND status = 'running' LIMIT 1", [$c, $routeId]);
                if ($run) {
                    return ['trip' => self::tripFull($c, $run, true), 'resumed' => true];
                }
            }
            throw $e;
        }
        $id = (int)self::one('SELECT LAST_INSERT_ID() id')['id'];
        $ordered = $direction === 'pickup' ? $stops : array_reverse($stops);
        foreach (array_values($ordered) as $i => $s) {
            self::db()->execute('INSERT INTO ssms_transport_trip_stops (trip_id, stop_id, seq) VALUES (?,?,?)', [$id, (int)$s['stop_id'], $i + 1]);
        }
        self::db()->execute('UPDATE ssms_transport_trips SET next_stop_id = ? WHERE id = ?', [(int)$ordered[array_key_first($ordered)]['stop_id'], $id]);
        $trip = self::tripRow($c, $id);
        if (self::settings($c)['alert_start']) {
            $route = (string)$as['route_name'];
            self::alert($c, $trip, 'bus_trip', self::dayRef($trip, 'start'), self::riders($c, $trip), fn() => [
                'title' => Locale::t($c, 'Bus on the way'),
                'body' => $direction === 'pickup' ? Locale::t($c, 'The {route} bus has started the morning pick-up.', ['route' => $route])
                    : Locale::t($c, 'The {route} bus has left school.', ['route' => $route]),
            ]);
        }

        return ['trip' => self::tripFull($c, $trip, true), 'resumed' => false];
    }

    /**
     * Positions from the driver's phone: [{lat, lng, speed?, heading?, accuracy?, t (ms since 1970)}].
     * Returns where the bus is on the route; `ended` tells the phone to stop sending.
     */
    public static function ping(array $a, int $tripId, array $points, ?float $phoneNowMs = null): array
    {
        $c = $a['client'];
        $trip = self::tripRow($c, $tripId);
        if (!$trip) {
            throw new \DomainException('Trip not found.');
        }
        self::mayRun($a, $trip);
        if ($trip['status'] !== 'running') {
            return ['ended' => true, 'accepted' => 0];
        }
        $good = self::cleanPoints($points, strtotime((string)$trip['started_at']) - 300, $phoneNowMs);

        return ['ended' => false, 'accepted' => self::pingTrip($c, $trip, $good), 'trip' => self::tripFull($c, self::tripRow($c, $tripId), false)];
    }

    /**
     * Usable positions, oldest first: [{lat, lng, ts, acc, speed (m/s), heading}]. Not before $minTs, not in the future,
     * not rough (> 500 m), not 0,0. $phoneNowMs: the sender's clock, to correct times that are clearly off.
     */
    private static function cleanPoints(array $points, int $minTs, ?float $phoneNowMs): array
    {
        $nowTs = AccountSecurity::time();
        // the phone's clock may be off by minutes: move its times by the difference (only when it is clearly off)
        $skew = $phoneNowMs !== null && $phoneNowMs > 0 ? $nowTs - (int)floor($phoneNowMs / 1000) : 0;
        $skew = abs($skew) > 30 && abs($skew) < 86400 ? $skew : 0;
        $startTs = $minTs + 300;
        $good = [];
        foreach (array_slice($points, 0, self::MAX_POINTS) as $p) {
            if (!is_array($p) || !is_numeric($p['lat'] ?? null) || !is_numeric($p['lng'] ?? null)) {
                continue;
            }
            $lat = (float)$p['lat'];
            $lng = (float)$p['lng'];
            $ts = is_numeric($p['t'] ?? null) ? (int)floor((float)$p['t'] / 1000) : $nowTs;
            if ($skew && ($ts > $nowTs + 120 || $ts < $startTs - 300)) {
                $ts += $skew;   // GPS times are usually right even when the phone's clock is not: only fix the ones that are clearly off
            }
            $acc = is_numeric($p['accuracy'] ?? null) ? (int)round((float)$p['accuracy']) : null;
            if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180 || ($lat == 0.0 && $lng == 0.0) || $ts > $nowTs + 120 || $ts < $startTs - 300
                || ($acc !== null && $acc > 500)) {
                continue;
            }
            $good[] = ['lat' => $lat, 'lng' => $lng, 'ts' => min($ts, $nowTs), 'acc' => $acc,
                       'speed' => is_numeric($p['speed'] ?? null) && (float)$p['speed'] >= 0 ? min(99.0, (float)$p['speed']) : null,
                       'heading' => is_numeric($p['heading'] ?? null) && (float)$p['heading'] >= 0 ? ((int)round((float)$p['heading'])) % 360 : null];
        }
        usort($good, fn($x, $y) => $x['ts'] <=> $y['ts']);

        return $good;
    }

    /** Store a trip's new positions and work out stops / arrival times / alerts. Returns how many were stored. */
    private static function pingTrip(string $c, array $trip, array $good): int
    {
        $tripId = (int)$trip['id'];
        $lastTs = $trip['last_at'] ? strtotime((string)$trip['last_at']) : 0;
        $now = self::now();
        $fresh = [];
        $vals = [];
        foreach ($good as $p) {
            array_push($vals, $tripId, $p['lat'], $p['lng'], $p['speed'], $p['heading'], $p['acc'], date('Y-m-d H:i:s', $p['ts']), $now);
            if ($p['ts'] >= $lastTs) {
                $fresh[] = $p;   // older ones (sent late after no signal) are kept for the history only
            }
        }
        if ($good) {
            self::db()->execute('INSERT INTO ssms_transport_trip_points (trip_id, lat, lng, speed, heading, accuracy, recorded_at, created) VALUES '
                . implode(',', array_fill(0, count($good), '(?,?,?,?,?,?,?,?)')), $vals);
        }
        if ($fresh) {
            $last = end($fresh);
            self::db()->execute('UPDATE ssms_transport_trips SET last_lat = ?, last_lng = ?, last_speed = ?, last_heading = ?, last_accuracy = ?, last_at = ?, points = points + ?, modified = ? WHERE id = ?',
                [$last['lat'], $last['lng'], $last['speed'], $last['heading'], $last['acc'], date('Y-m-d H:i:s', $last['ts']), count($good), $now, $tripId]);
            self::progress($c, self::tripRow($c, $tripId), $fresh);
        } elseif ($good) {
            self::db()->execute('UPDATE ssms_transport_trips SET points = points + ?, modified = ? WHERE id = ?', [count($good), $now, $tripId]);
        }

        return count($good);
    }

    /** Mark a student on this trip: boarded | dropped | absent | clear. */
    public static function markStudent(array $a, int $tripId, string $eid, string $status): array
    {
        $c = $a['client'];
        $trip = self::tripRow($c, $tripId);
        if (!$trip) {
            throw new \DomainException('Trip not found.');
        }
        self::mayRun($a, $trip);
        if (!in_array($status, ['boarded', 'dropped', 'absent', 'clear'], true)) {
            throw new \DomainException('Choose got on, got off or not on the bus.');
        }
        $rider = null;
        foreach (self::riders($c, $trip) as $r) {
            if ($r['enrollment_id'] === $eid) {
                $rider = $r;
            }
        }
        if (!$rider) {
            throw new \DomainException('This student does not travel on this route.');
        }
        if ($trip['status'] !== 'running' && (strtotime((string)$trip['ended_at']) < AccountSecurity::time() - 3600)) {
            throw new \DomainException('This trip ended. Changes are possible up to an hour after the end.');
        }
        $old = self::one('SELECT * FROM ssms_transport_boardings WHERE trip_id = ? AND enrollment_id = ?', [$tripId, $eid]);
        $now = self::now();
        if ($status === 'clear') {
            self::db()->execute('DELETE FROM ssms_transport_boardings WHERE trip_id = ? AND enrollment_id = ?', [$tripId, $eid]);

            return ['students' => self::tripStudents($c, self::tripRow($c, $tripId))];
        }
        $stopId = $status === 'absent' ? ($rider['stop_id'] ?? self::currentStopId($c, $trip)) : (self::currentStopId($c, $trip) ?? $rider['stop_id']);
        self::db()->execute('INSERT INTO ssms_transport_boardings (trip_id, enrollment_id, ssms_client_code, status, stop_id, boarded_at, dropped_at, marked_by, modified) VALUES (?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE status = VALUES(status), stop_id = VALUES(stop_id), boarded_at = COALESCE(VALUES(boarded_at), boarded_at),
                                    dropped_at = VALUES(dropped_at), marked_by = VALUES(marked_by), modified = VALUES(modified)',
            [$tripId, $eid, $c, $status, $stopId, $status === 'boarded' ? $now : ($status === 'dropped' ? ($old['boarded_at'] ?? null) : null),
             $status === 'dropped' ? $now : null, $a['user'], $now]);
        if ($status === 'absent') {
            self::db()->execute('UPDATE ssms_transport_boardings SET boarded_at = NULL WHERE trip_id = ? AND enrollment_id = ?', [$tripId, $eid]);
        }
        if (self::settings($c)['alert_board'] && (!$old || $old['status'] !== $status)) {
            $stopName = self::stopName($c, $stopId);
            $time = Locale::time($c, self::localHm($c, $now));
            $v = ['student' => $rider['name'], 'stop' => $stopName, 'time' => $time];
            $pick = $trip['direction'] === 'pickup';
            $render = match ($status) {
                'boarded' => fn() => ['title' => Locale::t($c, '{student} got on the bus', $v), 'body' => Locale::t($c, '{student} got on the bus at {time} ({stop}).', $v)],
                'dropped' => $pick ? fn() => ['title' => Locale::t($c, 'Reached school', $v), 'body' => Locale::t($c, '{student} reached school by bus at {time}.', $v)]
                    : fn() => ['title' => Locale::t($c, '{student} got off the bus', $v), 'body' => Locale::t($c, '{student} got off the bus at {stop} at {time}.', $v)],
                default => $pick ? fn() => ['title' => Locale::t($c, 'Not on the bus', $v), 'body' => Locale::t($c, '{student} did not get on the bus at {stop} today.', $v)]
                    : fn() => ['title' => Locale::t($c, 'Not on the bus', $v), 'body' => Locale::t($c, '{student} is not on the bus home today.', $v)],
            };
            self::alert($c, $trip, 'bus_board', 'bus-board:' . $tripId . ':' . $eid . ':' . $status . ':' . substr(md5($now), 0, 6), [$rider], $render);
        }

        return ['students' => self::tripStudents($c, self::tripRow($c, $tripId))];
    }

    /**
     * End a trip. On the drop trip, students still marked "on the bus" must be checked first (force = 1 after the
     * driver has looked: nobody left on the bus). On the morning trip, students on the bus are marked "reached school".
     */
    public static function endTrip(array $a, int $tripId, bool $force = false): array
    {
        $c = $a['client'];
        $trip = self::tripRow($c, $tripId);
        if (!$trip) {
            throw new \DomainException('Trip not found.');
        }
        $office = !in_array((int)$trip['driver_id'], $a['driver_ids'], true) && $trip['started_by'] !== $a['user'];
        if ($office) {
            self::need($a, 'edit');
        }
        if ($trip['status'] !== 'running') {
            return ['ended' => true, 'trip' => self::tripBrief($c, $trip)];
        }
        $onBus = array_values(array_filter(self::tripStudents($c, $trip), fn($s) => $s['status'] === 'boarded'));
        if ($trip['direction'] === 'drop' && $onBus && !$force) {
            return ['ended' => false, 'check' => true, 'on_bus' => array_map(fn($s) => ['enrollment_id' => $s['enrollment_id'], 'name' => $s['name']], $onBus),
                    'message' => Locale::t($c, 'These students are still marked on the bus. Check the bus and mark them got off before you end the trip.')];
        }
        if ($trip['direction'] === 'pickup' && !$office) {   // the driver ends it at school; the office ends forgotten trips (hours later)
            $send = self::$sendNow;
            self::$sendNow = false;
            try {
                foreach ($onBus as $s) {
                    self::markStudent(array_merge($a, ['edit' => true]), $tripId, $s['enrollment_id'], 'dropped');
                }
            } finally {
                self::$sendNow = $send;
            }
            self::send($c);
        }
        self::closeTrip($c, $tripId, $office ? 'office' : 'driver', $a['user']);

        return ['ended' => true, 'trip' => self::tripBrief($c, self::tripRow($c, $tripId))];
    }

    private static function closeTrip(string $c, int $id, string $reason, ?string $by): void
    {
        $now = self::now();
        self::db()->execute("UPDATE ssms_transport_trips SET status = 'ended', run_key = NULL, ended_at = ?, ended_by = ?, end_reason = ?, next_stop_id = NULL, modified = ? WHERE id = ? AND ssms_client_code = ? AND status = 'running'",
            [$now, $by, $reason, $now, $id, $c]);
        self::db()->execute("UPDATE ssms_transport_trip_stops SET status = 'left', left_at = COALESCE(left_at, ?) WHERE trip_id = ? AND status = 'arrived'", [$now, $id]);
    }

    private static function mayRun(array $a, array $trip): void
    {
        if (!$a['edit'] && !in_array((int)$trip['driver_id'], $a['driver_ids'], true) && $trip['started_by'] !== $a['user']) {
            throw new \DomainException('You are not the driver of this trip.');
        }
    }

    /** The driver's trip screen: stops in order with times, the students to pick up / drop at each. */
    public static function driverTrip(array $a, int $tripId): array
    {
        $c = $a['client'];
        $trip = self::tripRow($c, $tripId);
        if (!$trip) {
            throw new \DomainException('Trip not found.');
        }
        self::mayRun($a, $trip);

        return ['trip' => self::tripFull($c, $trip, true)];
    }

    // ── Working out where the bus is ────────────────────────────────────────

    /** Stop arrivals / departures from each new position, then the arrival times and "bus is near" alerts. */
    private static function progress(string $c, array $trip, array $points): void
    {
        $s = self::settings($c);
        $tid = (int)$trip['id'];
        $radius = (float)$s['stop_radius'];
        $stops = self::tripStopRows($tid);
        foreach ($points as $p) {
            if ($p['acc'] !== null && $p['acc'] > max(150, $radius * 2)) {
                continue;   // too rough to say "at the stop"
            }
            $t = date('Y-m-d H:i:s', $p['ts']);
            // only the next stops in order can be reached (a bus on its way out to the first stop drives past later ones)
            $window = [];
            foreach ($stops as $st) {
                if ($st['status'] === 'pending' && $st['lat'] !== null && count($window) < self::WINDOW) {
                    $window[] = $st['stop_id'];
                }
            }
            $firstPending = $window[0] ?? null;
            foreach ($stops as $k => $st) {
                if ($st['lat'] === null) {
                    continue;
                }
                $d = self::dist($p['lat'], $p['lng'], $st['lat'], $st['lng']);
                if ($st['status'] === 'pending' && !in_array($st['stop_id'], $window, true)) {
                    // a later stop (earlier ones skipped – nobody to pick up, another road): only when the bus really
                    // stops there (slow, or a second position inside the circle); driving past on the way out does not count
                    $stopped = $d <= $radius && ($p['speed'] !== null ? $p['speed'] < 2 : ($st['min'] !== null && $st['min'] <= $radius));
                    if (!$stopped) {
                        if ($st['min'] === null || $d < $st['min']) {
                            $stops[$k]['min'] = (int)round($d);
                            $stops[$k]['min_dirty'] = true;
                        }
                        continue;
                    }
                }
                if ($st['status'] === 'pending' && $st['stop_id'] === $firstPending && $d > $radius && $st['min'] !== null && $st['min'] <= 3 * $radius && $d > $st['min'] + 100) {
                    // came close (the stop's map point is a little off the road) and is now driving away: driven past
                    foreach ($stops as $j => $o) {
                        if ($o['status'] === 'pending' && $o['seq'] <= $st['seq']) {
                            $stops[$j]['status'] = 'passed';
                            self::db()->execute("UPDATE ssms_transport_trip_stops SET status = 'passed' WHERE trip_id = ? AND stop_id = ?", [$tid, $o['stop_id']]);
                        }
                    }
                    continue;
                }
                if ($st['status'] === 'pending' && ($st['min'] === null || $d < $st['min'])) {
                    $stops[$k]['min'] = (int)round($d);
                    $stops[$k]['min_dirty'] = true;
                    $st['min'] = (int)round($d);
                }
                if ($st['status'] === 'arrived' && $d > $radius + 40) {
                    $stops[$k]['status'] = 'left';
                    self::db()->execute("UPDATE ssms_transport_trip_stops SET status = 'left', left_at = ? WHERE trip_id = ? AND stop_id = ?", [$t, $tid, $st['stop_id']]);
                } elseif ($st['status'] === 'pending' && $d <= $radius) {
                    foreach ($stops as $j => $o) {
                        if ($o['status'] === 'arrived' && $j !== $k) {   // one stop at a time
                            $stops[$j]['status'] = 'left';
                            self::db()->execute("UPDATE ssms_transport_trip_stops SET status = 'left', left_at = ? WHERE trip_id = ? AND stop_id = ?", [$t, $tid, $o['stop_id']]);
                        }
                        if ($o['status'] === 'pending' && $o['seq'] < $st['seq']) {   // driven past without stopping (or no map point)
                            $stops[$j]['status'] = 'passed';
                            self::db()->execute("UPDATE ssms_transport_trip_stops SET status = 'passed' WHERE trip_id = ? AND stop_id = ?", [$tid, $o['stop_id']]);
                        }
                    }
                    $stops[$k]['status'] = 'arrived';
                    self::db()->execute("UPDATE ssms_transport_trip_stops SET status = 'arrived', arrived_at = ?, near_at = COALESCE(near_at, ?) WHERE trip_id = ? AND stop_id = ?", [$t, $t, $tid, $st['stop_id']]);
                    if ($s['alert_arrived']) {
                        $name = $st['name'];
                        self::alert($c, $trip, 'bus_stop', self::dayRef($trip, 'at:' . $st['stop_id']), self::waiting($c, $trip, (int)$st['stop_id']), fn() => [
                            'title' => Locale::t($c, 'Bus at your stop'), 'body' => Locale::t($c, 'The bus has reached {stop}.', ['stop' => $name])]);
                    }
                    if ($st['near_at'] === null) {
                        $stops[$k]['near_at'] = $t;
                    }
                }
            }
        }
        foreach ($stops as $st) {
            if (!empty($st['min_dirty'])) {
                self::db()->execute('UPDATE ssms_transport_trip_stops SET min_dist = ? WHERE trip_id = ? AND stop_id = ?', [$st['min'], $tid, $st['stop_id']]);
            }
        }
        // speed while moving (last 5 minutes of positions)
        $last = end($points);
        $win = self::q('SELECT lat, lng, recorded_at FROM ssms_transport_trip_points WHERE trip_id = ? AND recorded_at >= ? ORDER BY recorded_at', [$tid, date('Y-m-d H:i:s', $last['ts'] - 300)]);
        $avg = $trip['avg_speed'] !== null ? (float)$trip['avg_speed'] : null;
        if (count($win) >= 2) {
            $dist = 0.0;
            for ($i = 1; $i < count($win); $i++) {
                $dist += self::dist((float)$win[$i - 1]['lat'], (float)$win[$i - 1]['lng'], (float)$win[$i]['lat'], (float)$win[$i]['lng']);
            }
            $secs = strtotime((string)end($win)['recorded_at']) - strtotime((string)$win[0]['recorded_at']);
            if ($secs >= 30 && $dist / $secs >= 1.5) {   // standing at a stop or in a jam: keep the last moving speed
                $v = max(2.5, min(22.0, $dist / $secs));
                $avg = $avg === null ? $v : round(0.6 * $v + 0.4 * $avg, 2);
            }
        }
        // next stop, arrival times, "bus is near"
        $speed = $avg ?? self::DEFAULT_SPEED;
        $next = null;
        $maxDone = 0;
        foreach ($stops as $st) {
            if ($st['status'] !== 'pending') {
                $maxDone = max($maxDone, $st['seq']);
            }
        }
        $cum = 0.0;
        $prev = ['lat' => $last['lat'], 'lng' => $last['lng']];
        $nowTs = AccountSecurity::time();
        $dwell = 0;
        foreach ($stops as $st) {
            if ($st['status'] !== 'pending' || $st['seq'] < $maxDone) {
                continue;
            }
            if ($st['lat'] === null) {
                continue;   // no map point: no time for it
            }
            $next ??= $st['stop_id'];
            $leg = self::dist($prev['lat'], $prev['lng'], $st['lat'], $st['lng']);
            $straight = $cum === 0.0 ? $leg : null;
            $cum += $leg * ($cum === 0.0 ? 1.15 : self::ROAD_FACTOR);
            $etaSecs = (int)round($cum / $speed) + $dwell;
            $dwell += 30;   // each stop on the way
            $prev = $st;
            $old = $st['raw']['eta_at'] ? strtotime((string)$st['raw']['eta_at']) : null;
            if ($old === null || abs($old - ($nowTs + $etaSecs)) >= 60) {
                self::db()->execute('UPDATE ssms_transport_trip_stops SET eta_at = ? WHERE trip_id = ? AND stop_id = ?', [date('Y-m-d H:i:s', $nowTs + $etaSecs), $tid, $st['stop_id']]);
            }
            if ($st['near_at'] === null && $s['alert_near'] && ($etaSecs <= $s['near_minutes'] * 60 || ($straight !== null && $straight <= $s['near_meters']))) {
                self::db()->execute('UPDATE ssms_transport_trip_stops SET near_at = ? WHERE trip_id = ? AND stop_id = ? AND near_at IS NULL', [self::now(), $tid, $st['stop_id']]);
                $min = max(1, (int)round($etaSecs / 60));
                $name = $st['name'];
                self::alert($c, $trip, 'bus_near', self::dayRef($trip, 'near:' . $st['stop_id']), self::waiting($c, $trip, (int)$st['stop_id']), fn() => [
                    'title' => Locale::t($c, 'Bus is near'),
                    'body' => $etaSecs < 90 ? Locale::t($c, 'The bus is almost at {stop}.', ['stop' => $name])
                        : Locale::t($c, 'The bus is about {n} min from {stop}.', ['n' => $min, 'stop' => $name])]);
            }
        }
        self::db()->execute('UPDATE ssms_transport_trips SET next_stop_id = ?, avg_speed = ? WHERE id = ?', [$next, $avg, $tid]);
    }

    private static function currentStopId(string $c, array $trip): ?int
    {
        $r = self::one("SELECT stop_id FROM ssms_transport_trip_stops WHERE trip_id = ? AND status IN ('arrived','left','passed') ORDER BY (status = 'arrived') DESC, seq DESC LIMIT 1", [(int)$trip['id']]);

        return $r ? (int)$r['stop_id'] : null;
    }

    // ── Parents / students ──────────────────────────────────────────────────

    /** My child's bus: route, stops, driver, vehicle, and – while a trip runs – where it is and when it reaches our stop. */
    public static function myBus(array $f, string $eid): array
    {
        $c = $f['client'];
        $eid = trim($eid) !== '' ? trim($eid) : (string)($f['eids'][0] ?? '');
        if ($eid === '' || !in_array($eid, $f['eids'], true)) {
            throw new \DomainException('This child is not linked to your account.');
        }
        $te = self::one("SELECT * FROM ssms_transport_enrollments WHERE ssms_client_code = ? AND CAST(enrollment_id AS CHAR) = ? AND status = 'active' AND session_id = ?
                          ORDER BY created DESC LIMIT 1", [$c, $eid, self::currentSession($c)]);
        $stu = StudentLeave::enrollment($c, $eid);
        $base = ['student' => ['enrollment_id' => $eid, 'name' => (string)($stu['student_name'] ?? $eid)], 'today' => self::today($c), 'alerts' => self::myAlerts($f)];
        if (!$te) {
            return $base + ['enrolled' => false];
        }
        $routeId = (int)$te['route_id'];
        $route = self::one('SELECT route_id, route_name, start_point, end_point FROM ssms_transport_routes WHERE route_id = ? AND ssms_client_code = ?', [$routeId, $c]);
        $as = self::one("SELECT a.vehicle_id, a.driver_id, v.vehicle_number, v.vehicle_name, d.driver_name, d.mobile_number FROM ssms_transport_assignments a
                           LEFT JOIN ssms_transport_vehicles v ON v.vehicle_id = a.vehicle_id LEFT JOIN ssms_transport_drivers d ON d.driver_id = a.driver_id
                          WHERE a.ssms_client_code = ? AND a.route_id = ? AND a.session_id = ? LIMIT 1", [$c, $routeId, (int)$te['session_id']]);
        $type = self::normType((string)$te['transport_type']);
        $pick = (int)($te['pickup_stop_id'] ?: $te['stop_id']);
        $drop = (int)($te['dropoff_stop_id'] ?: $te['stop_id']);
        $myStops = ['pickup' => $type === 'drop' || !$pick ? null : $pick, 'drop' => $type === 'pickup' || !$drop ? null : $drop];
        $stops = array_map(fn($s) => ['stop_id' => (int)$s['stop_id'], 'name' => (string)$s['stop_name'], 'order' => (int)$s['stop_order'],
            'lat' => $s['latitude'] !== null ? (float)$s['latitude'] : null, 'lng' => $s['longitude'] !== null ? (float)$s['longitude'] : null,
            'pickup_time' => $s['pickup_time'] ? substr((string)$s['pickup_time'], 0, 5) : null, 'dropoff_time' => $s['dropoff_time'] ? substr((string)$s['dropoff_time'], 0, 5) : null],
            self::routeStops($c, $routeId));
        $trips = self::q('SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id = ? AND trip_date = ? ORDER BY id', [$c, $routeId, self::today($c)]);
        $live = null;
        $done = [];
        foreach ($trips as $t) {
            $dir = (string)$t['direction'];
            if ($myStops[$dir] === null) {
                continue;   // this child does not use this direction
            }
            $b = self::one('SELECT status, boarded_at, dropped_at, stop_id FROM ssms_transport_boardings WHERE trip_id = ? AND enrollment_id = ?', [(int)$t['id'], $eid]);
            $mine = self::one('SELECT * FROM ssms_transport_trip_stops WHERE trip_id = ? AND stop_id = ?', [(int)$t['id'], $myStops[$dir]]);
            $view = ['trip_id' => (int)$t['id'], 'direction' => $dir, 'status' => (string)$t['status'],
                'started_at' => self::localHm($c, (string)$t['started_at']), 'ended_at' => $t['ended_at'] ? self::localHm($c, (string)$t['ended_at']) : null,
                'me' => $b ? ['status' => $b['status'], 'boarded_at' => $b['boarded_at'] ? self::localHm($c, (string)$b['boarded_at']) : null,
                               'dropped_at' => $b['dropped_at'] ? self::localHm($c, (string)$b['dropped_at']) : null] : null,
                'my_stop' => $mine ? self::stopState($c, $mine) : null];
            if ($t['status'] === 'running') {
                $age = $t['last_at'] ? AccountSecurity::time() - strtotime((string)$t['last_at']) : null;
                $view['bus'] = $t['last_lat'] !== null && $age !== null && $age < 1800
                    ? ['lat' => (float)$t['last_lat'], 'lng' => (float)$t['last_lng'], 'heading' => $t['last_heading'] !== null ? (int)$t['last_heading'] : null,
                       'speed_kmh' => $t['last_speed'] !== null ? (int)round((float)$t['last_speed'] * 3.6) : null, 'age' => $age, 'live' => $age <= self::STALE,
                       'at' => self::localHm($c, (string)$t['last_at'])] : null;
                $view['next_stop'] = $t['next_stop_id'] ? self::stopName($c, (int)$t['next_stop_id']) : null;
                $view['state'] = self::familyState($view, $dir);
                $live = $view;
            } else {
                $done[] = $view;
            }
        }

        return $base + ['enrolled' => true, 'route' => ['route_id' => $routeId, 'name' => (string)($route['route_name'] ?? ''), 'from' => $route['start_point'] ?? null, 'to' => $route['end_point'] ?? null],
            'vehicle' => $as ? trim(($as['vehicle_number'] ?? '') . ($as['vehicle_name'] ? ' · ' . $as['vehicle_name'] : '')) : null,
            'driver' => $as && $as['driver_name'] ? ['name' => (string)$as['driver_name'], 'phone' => $as['mobile_number'] ?: null] : null,
            'type' => $type, 'my_stops' => $myStops, 'stops' => $stops, 'live' => $live, 'trips_today' => $done];
    }

    /** What the parent screen says: not started / on the way (n min) / near / at our stop / passed / on board. */
    private static function familyState(array $v, string $dir): string
    {
        $me = $v['me']['status'] ?? null;
        if ($me === 'dropped') {
            return 'dropped';
        }
        if ($me === 'absent') {
            return 'absent';
        }
        if ($me === 'boarded' && $dir === 'pickup') {
            return 'on_board';   // afternoon: on board, the family still wants to know when the bus reaches the stop
        }
        $st = $v['my_stop']['status'] ?? 'pending';
        if ($st === 'arrived') {
            return 'at_stop';
        }
        if (in_array($st, ['left', 'passed'], true)) {
            return 'passed';
        }

        return !empty($v['my_stop']['near']) ? 'near' : 'on_way';
    }

    private static function stopState(string $c, array $r): array
    {
        $eta = $r['eta_at'] ? strtotime((string)$r['eta_at']) - AccountSecurity::time() : null;

        return ['stop_id' => (int)$r['stop_id'], 'seq' => (int)$r['seq'], 'status' => (string)$r['status'], 'near' => $r['near_at'] !== null,
                'eta_min' => $r['status'] === 'pending' && $eta !== null ? max(0, (int)round($eta / 60)) : null,
                'eta_at' => $r['status'] === 'pending' && $r['eta_at'] ? self::localHm($c, (string)$r['eta_at']) : null,
                'arrived_at' => $r['arrived_at'] ? self::localHm($c, (string)$r['arrived_at']) : null, 'left_at' => $r['left_at'] ? self::localHm($c, (string)$r['left_at']) : null];
    }

    /** Parents' own alert choices. */
    public static function myAlerts(array $f): array
    {
        $off = [];
        try {
            foreach (self::q("SELECT event FROM ssms_notify_prefs WHERE ssms_client_code = ? AND username = ? AND channel = 'push' AND event LIKE 'bus\\_%'", [$f['client'], $f['user']]) as $r) {
                $off[$r['event']] = true;
            }
        } catch (\Throwable $e) {
        }

        return array_map(fn($k) => ['key' => $k, 'label' => self::ALERTS[$k], 'on' => empty($off[$k])], array_keys(self::ALERTS));
    }

    public static function setMyAlert(array $f, string $key, bool $on): array
    {
        if (!isset(self::ALERTS[$key])) {
            throw new \DomainException('Unknown alert.');
        }
        if ($on) {
            self::db()->execute("DELETE FROM ssms_notify_prefs WHERE ssms_client_code = ? AND username = ? AND event = ? AND channel = 'push'", [$f['client'], $f['user'], $key]);
        } else {
            self::db()->execute("INSERT IGNORE INTO ssms_notify_prefs (ssms_client_code, username, event, channel, modified) VALUES (?,?,?,'push',?)", [$f['client'], $f['user'], $key, self::now()]);
        }

        return ['alerts' => self::myAlerts($f)];
    }

    // ── Office ──────────────────────────────────────────────────────────────

    /** All buses today: running first, with where they are and how many students are on board. */
    public static function live(array $a): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $sess = self::currentSession($c);
        $trips = self::q("SELECT t.*, r.route_name, v.vehicle_number, d.driver_name, d.mobile_number FROM ssms_transport_trips t
                            JOIN ssms_transport_routes r ON r.route_id = t.route_id LEFT JOIN ssms_transport_vehicles v ON v.vehicle_id = t.vehicle_id
                            LEFT JOIN ssms_transport_drivers d ON d.driver_id = t.driver_id
                           WHERE t.ssms_client_code = ? AND t.trip_date = ? ORDER BY (t.status = 'running') DESC, r.route_name, t.id", [$c, self::today($c)]);
        $out = [];
        foreach ($trips as $t) {
            $b = self::tripBrief($c, $t);
            $counts = self::one("SELECT SUM(status = 'boarded') onb, SUM(status = 'dropped') off, SUM(status = 'absent') abs FROM ssms_transport_boardings WHERE trip_id = ?", [(int)$t['id']]);
            $out[] = $b + ['route_name' => (string)$t['route_name'], 'vehicle_number' => $t['vehicle_number'], 'driver_name' => $t['driver_name'], 'driver_phone' => $t['mobile_number'],
                           'on_board' => (int)($counts['onb'] ?? 0), 'dropped' => (int)($counts['off'] ?? 0), 'absent' => (int)($counts['abs'] ?? 0),
                           'riders' => count(self::riders($c, $t))];
        }
        $idle = self::q("SELECT r.route_id, r.route_name, v.vehicle_number, d.driver_name FROM ssms_transport_assignments a JOIN ssms_transport_routes r ON r.route_id = a.route_id
                           LEFT JOIN ssms_transport_vehicles v ON v.vehicle_id = a.vehicle_id LEFT JOIN ssms_transport_drivers d ON d.driver_id = a.driver_id
                          WHERE a.ssms_client_code = ? AND a.session_id = ? AND COALESCE(r.status,'active') = 'active'
                            AND r.route_id NOT IN (SELECT route_id FROM ssms_transport_trips WHERE ssms_client_code = ? AND status = 'running')
                          ORDER BY r.route_name", [$c, $sess, $c]);

        // buses with a bus phone / GPS tracker that are not on a trip: where they were last seen (last 30 minutes)
        $parked = [];
        foreach (self::q("SELECT v.* FROM ssms_transport_vehicles v WHERE v.ssms_client_code = ? AND v.tracking_mode IN ('phone','gps') AND v.last_seen >= ?
                            AND v.vehicle_id NOT IN (SELECT vehicle_id FROM ssms_transport_trips WHERE ssms_client_code = ? AND status = 'running' AND vehicle_id IS NOT NULL)",
                     [$c, date('Y-m-d H:i:s', AccountSecurity::time() - 1800), $c]) as $v) {
            $parked[] = self::vehicleView($c, $v) + ['lat' => (float)$v['last_lat'], 'lng' => (float)$v['last_lng']];
        }

        return ['trips' => $out, 'not_running' => array_map(fn($r) => ['route_id' => (int)$r['route_id'], 'route_name' => (string)$r['route_name'],
            'vehicle_number' => $r['vehicle_number'], 'driver_name' => $r['driver_name']], $idle), 'parked' => $parked, 'can' => ['edit' => (bool)$a['edit']], 'today' => self::today($c)];
    }

    /** One trip for the office: stops, students and the path driven. */
    public static function trip(array $a, int $id): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $t = self::tripRow($c, $id);
        if (!$t) {
            throw new \DomainException('Trip not found.');
        }
        $pts = self::q('SELECT lat, lng FROM ssms_transport_trip_points WHERE trip_id = ? ORDER BY recorded_at', [$id]);
        $step = max(1, (int)ceil(count($pts) / 400));
        $path = [];
        foreach ($pts as $i => $p) {
            if ($i % $step === 0 || $i === count($pts) - 1) {
                $path[] = [(float)$p['lat'], (float)$p['lng']];
            }
        }

        return ['trip' => self::tripFull($c, $t, true), 'path' => $path, 'can' => ['edit' => (bool)$a['edit']]];
    }

    // ── Views ───────────────────────────────────────────────────────────────

    private static function tripBrief(string $c, array $t): array
    {
        $age = $t['last_at'] ? AccountSecurity::time() - strtotime((string)$t['last_at']) : null;

        return ['trip_id' => (int)$t['id'], 'route_id' => (int)$t['route_id'], 'direction' => (string)$t['direction'], 'status' => (string)$t['status'],
                'started_at' => self::localHm($c, (string)$t['started_at']), 'ended_at' => $t['ended_at'] ? self::localHm($c, (string)$t['ended_at']) : null,
                'end_reason' => $t['end_reason'], 'started_by' => $t['started_by'],
                'bus' => $t['last_lat'] !== null ? ['lat' => (float)$t['last_lat'], 'lng' => (float)$t['last_lng'], 'heading' => $t['last_heading'] !== null ? (int)$t['last_heading'] : null,
                    'speed_kmh' => $t['last_speed'] !== null ? (int)round((float)$t['last_speed'] * 3.6) : null, 'accuracy' => $t['last_accuracy'] !== null ? (int)$t['last_accuracy'] : null,
                    'age' => $age, 'live' => $t['status'] === 'running' && $age !== null && $age <= self::STALE, 'at' => self::localHm($c, (string)$t['last_at'])] : null,
                'next_stop' => $t['next_stop_id'] ? self::stopName($c, (int)$t['next_stop_id']) : null];
    }

    private static function tripFull(string $c, array $t, bool $students): array
    {
        $stops = [];
        foreach (self::tripStopRows((int)$t['id']) as $st) {
            $stops[] = ['stop_id' => $st['stop_id'], 'name' => $st['name'], 'lat' => $st['lat'], 'lng' => $st['lng'], 'time' => $st[$t['direction'] === 'pickup' ? 'pickup_time' : 'dropoff_time']]
                + self::stopState($c, $st['raw']);
        }
        $route = self::one('SELECT route_name FROM ssms_transport_routes WHERE route_id = ?', [(int)$t['route_id']]);
        $out = self::tripBrief($c, $t) + ['route_name' => (string)($route['route_name'] ?? ''), 'stops' => $stops, 'settings' => self::settings($c)];
        if ($students) {
            $out['students'] = self::tripStudents($c, $t);
        }

        return $out;
    }

    /** Students of the trip with their stop for this direction and what was marked. */
    private static function tripStudents(string $c, array $trip): array
    {
        $out = [];
        foreach (self::riders($c, $trip) as $r) {
            $out[] = ['enrollment_id' => $r['enrollment_id'], 'name' => $r['name'], 'class_label' => $r['class_label'], 'stop_id' => $r['stop_id'],
                      'stop_name' => $r['stop_name'], 'status' => $r['status'], 'boarded_at' => $r['boarded_at'] ? self::localHm($c, $r['boarded_at']) : null,
                      'dropped_at' => $r['dropped_at'] ? self::localHm($c, $r['dropped_at']) : null, 'phone' => $r['phone']];
        }

        return $out;
    }

    /**
     * Students who ride this trip (their route, this direction), optionally only those of one stop.
     * [{enrollment_id, name, class_label, stop_id, stop_name, status, boarded_at, dropped_at, phone}]
     */
    private static function riders(string $c, array $trip, ?int $stopId = null): array
    {
        $key = 'roster|' . $trip['id'];
        $dir = (string)$trip['direction'];
        if (!isset(self::$cache[$key])) {
            $col = $dir === 'pickup' ? 'te.pickup_stop_id' : 'te.dropoff_stop_id';
            $rows = self::q("SELECT CAST(te.enrollment_id AS CHAR) eid, COALESCE($col, te.stop_id) sid, te.transport_type,
                                    TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) name, r.mobile_number,
                                    TRIM(CONCAT(COALESCE(c.class_name,''), IF(sec.section_name IS NULL OR sec.section_name = '', '', CONCAT(' – ', sec.section_name)))) class_label,
                                    st.stop_name, st.stop_order
                               FROM ssms_transport_enrollments te
                               JOIN ssms_student_enrollment e ON CAST(e.enrollment_id AS CHAR) = CAST(te.enrollment_id AS CHAR) AND e.ssms_client_code = te.ssms_client_code
                               JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                               LEFT JOIN ssms_classes c ON c.class_id = e.class_id LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
                               LEFT JOIN ssms_transport_stops st ON st.stop_id = COALESCE($col, te.stop_id)
                              WHERE te.ssms_client_code = ? AND te.route_id = ? AND te.status = 'active' AND te.session_id = ? AND COALESCE(e.status,'active') = 'active'
                              ORDER BY st.stop_order, name", [$c, (int)$trip['route_id'], (int)$trip['session_id']]);
            self::$cache[$key] = array_values(array_filter($rows, function ($r) use ($dir) {
                $type = self::normType((string)$r['transport_type']);

                return $type === 'both' || $type === $dir;
            }));
        }
        $marks = [];
        foreach (self::q('SELECT * FROM ssms_transport_boardings WHERE trip_id = ?', [(int)$trip['id']]) as $b) {
            $marks[(string)$b['enrollment_id']] = $b;
        }
        $list = [];
        foreach (self::$cache[$key] as $r) {
            $sid = $r['sid'] !== null ? (int)$r['sid'] : null;
            if ($stopId !== null && $sid !== $stopId) {
                continue;
            }
            $m = $marks[$r['eid']] ?? null;
            $list[] = ['enrollment_id' => $r['eid'], 'name' => $r['name'] !== '' ? $r['name'] : $r['eid'], 'class_label' => $r['class_label'],
                       'stop_id' => $sid, 'stop_name' => $r['stop_name'], 'status' => $m['status'] ?? null,
                       'boarded_at' => $m['boarded_at'] ?? null, 'dropped_at' => $m['dropped_at'] ?? null, 'phone' => $r['mobile_number'] ?: null];
        }

        return $list;
    }

    private static function dayRef(array $trip, string $what): string
    {
        return 'bus:' . $trip['route_id'] . ':' . $trip['direction'] . ':' . $trip['trip_date'] . ':' . $what;
    }

    /** Families still waiting at a stop: morning – not yet on the bus or marked absent; afternoon – not yet off / absent. */
    private static function waiting(string $c, array $trip, int $stopId): array
    {
        $skip = $trip['direction'] === 'pickup' ? ['absent', 'boarded', 'dropped'] : ['absent', 'dropped'];
        $list = array_values(array_filter(self::riders($c, $trip, $stopId), fn($r) => !in_array($r['status'], $skip, true)));
        if ($list) {   // marked absent / on leave at school today (afternoon: they are not going home by bus)
            try {
                $in = implode(',', array_fill(0, count($list), '?'));
                $away = array_column(self::q("SELECT enrollment_id FROM student_attendance WHERE ssms_client_code = ? AND attendance_date = ? AND UPPER(attendance) IN ('A','L')
                                               AND enrollment_id IN ($in)", array_merge([$c, (string)$trip['trip_date']], array_column($list, 'enrollment_id'))), 'enrollment_id');
                $list = array_values(array_filter($list, fn($r) => !in_array($r['enrollment_id'], array_map('strval', $away), true)));
            } catch (\Throwable $e) {
            }
        }

        return $list;
    }

    private static function normType(string $t): string
    {
        $t = strtolower(trim($t));

        return in_array($t, ['drop', 'dropoff', 'drop_off', 'drop-off'], true) ? 'drop' : ($t === 'pickup' ? 'pickup' : 'both');
    }

    /** Families of these riders get one message each (a family with two children at one stop: once). */
    private static function alert(string $c, array $trip, string $kind, string $ref, array $riders, callable $render): void
    {
        $users = [];
        foreach ($riders as $r) {
            foreach (Notify::familyUsers($c, (string)$r['enrollment_id']) as $u) {
                $users[$u] = (string)$r['enrollment_id'];
            }
        }
        if (!$users) {
            return;
        }
        try {
            $in = implode(',', array_fill(0, count($users), '?'));
            foreach (self::q("SELECT username FROM ssms_notify_prefs WHERE ssms_client_code = ? AND event = ? AND channel = 'push' AND username IN ($in)",
                         array_merge([$c, $kind], array_map('strval', array_keys($users)))) as $p) {
                unset($users[$p['username']]);
            }
        } catch (\Throwable $e) {
        }
        $byChild = [];
        foreach ($users as $u => $eid) {
            $byChild[$eid][] = (string)$u;
        }
        foreach ($byChild as $eid => $list) {
            Notify::toUsers($c, $ref, $list, $render, ['event' => 'school', 'screen' => 'LiveBus', 'enrollment_id' => (string)$eid]);
        }
        self::send($c);
    }

    private static function send(string $c): void
    {
        if (self::$sendNow) {
            try {
                Notify::pushNow($c);
            } catch (\Throwable $e) {
                Log::warning('Bus alert: ' . $e->getMessage());
            }
        }
    }

    // ── Clean-up (from Notify::scan, every few minutes) ─────────────────────

    public static function tick(string $c): void
    {
        try {
            $s = self::settings($c);
            if ($s['auto_trips']) {   // bus phone / tracker trips also end when no position comes any more (ignition off at school)
                foreach (self::q("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND status = 'running' AND COALESCE(source,'driver') <> 'driver'", [$c]) as $t) {
                    self::autoEnd($c, $t);
                }
            }
            $cut = date('Y-m-d H:i:s', AccountSecurity::time() - $s['idle_minutes'] * 60);
            foreach (self::q("SELECT id FROM ssms_transport_trips WHERE ssms_client_code = ? AND status = 'running' AND COALESCE(last_at, started_at) < ?", [$c, $cut]) as $t) {
                self::closeTrip($c, (int)$t['id'], 'idle', null);
            }
            $today = self::today($c);
            $db = self::db();
            $db->execute('INSERT IGNORE INTO ssms_transport_settings (ssms_client_code) VALUES (?)', [$c]);
            if ($db->execute('UPDATE ssms_transport_settings SET maint_on = ? WHERE ssms_client_code = ? AND (maint_on IS NULL OR maint_on < ?)', [$today, $c, $today])->rowCount() < 1) {
                return;
            }
            $old = date('Y-m-d', strtotime($today . ' -' . $s['keep_days'] . ' days'));
            $ids = array_map(fn($r) => (int)$r['id'], self::q('SELECT id FROM ssms_transport_trips WHERE ssms_client_code = ? AND trip_date < ? AND points > 0 LIMIT 2000', [$c, $old]));
            foreach (array_chunk($ids, 200) as $chunk) {
                $in = implode(',', $chunk);
                $db->execute("DELETE FROM ssms_transport_trip_points WHERE trip_id IN ($in)");
                $db->execute("UPDATE ssms_transport_trips SET points = 0, last_lat = NULL, last_lng = NULL WHERE id IN ($in)");
            }
        } catch (\Throwable $e) {
            if (!str_contains($e->getMessage(), "doesn't exist") && !str_contains($e->getMessage(), 'Unknown column')) {
                Log::warning("Bus tick {$c}: " . $e->getMessage());
            }
        }
    }

    /** Privacy: a student's record is erased. */
    public static function eraseFor(string $c, array $eids): void
    {
        if (!$eids) {
            return;
        }
        try {
            $in = implode(',', array_fill(0, count($eids), '?'));
            self::db()->execute("DELETE FROM ssms_transport_boardings WHERE ssms_client_code = ? AND enrollment_id IN ($in)", array_merge([$c], array_map('strval', $eids)));
        } catch (\Throwable $e) {
        }
    }

    // ── Buses: how each one is tracked ──────────────────────────────────────

    /** Office: every bus with its tracking mode, paired phone / tracker, routes and last position. */
    public static function vehicles(array $a): array
    {
        self::need($a, 'view');
        $c = $a['client'];
        $routes = [];
        foreach (self::q("SELECT a.vehicle_id, r.route_name FROM ssms_transport_assignments a JOIN ssms_transport_routes r ON r.route_id = a.route_id
                           WHERE a.ssms_client_code = ? AND a.session_id = ? ORDER BY r.route_name", [$c, self::currentSession($c)]) as $r) {
            $routes[(int)$r['vehicle_id']][] = (string)$r['route_name'];
        }
        $out = [];
        foreach (self::q('SELECT * FROM ssms_transport_vehicles WHERE ssms_client_code = ? ORDER BY vehicle_number', [$c]) as $v) {
            $out[] = self::vehicleView($c, $v) + ['routes' => $routes[(int)$v['vehicle_id']] ?? []];
        }

        return ['vehicles' => $out, 'modes' => self::MODES, 'can' => ['edit' => (bool)$a['edit']], 'gps' => $a['edit'] ? self::gpsSetup($c) : null];
    }

    private static function vehicleView(string $c, array $v): array
    {
        $seen = $v['last_seen'] ? AccountSecurity::time() - strtotime((string)$v['last_seen']) : null;

        return ['vehicle_id' => (int)$v['vehicle_id'], 'number' => (string)$v['vehicle_number'], 'name' => $v['vehicle_name'],
                'mode' => isset(self::MODES[(string)($v['tracking_mode'] ?? '')]) ? (string)$v['tracking_mode'] : 'driver', 'tracker_id' => $v['tracker_id'] ?? null,
                'paired' => !empty($v['device_token_hash']), 'device_name' => $v['device_name'] ?? null,
                'paired_at' => !empty($v['device_paired_at']) ? Locale::date($c, (new \DateTimeImmutable('@' . strtotime((string)$v['device_paired_at'])))->setTimezone(Locale::tz($c))->format('Y-m-d'), 'medium') : null,
                'last_seen' => $seen, 'last_seen_at' => $v['last_seen'] ? self::localHm($c, (string)$v['last_seen']) : null];
    }

    private static function vehicleRow(string $c, int $id): ?array
    {
        return self::one('SELECT * FROM ssms_transport_vehicles WHERE vehicle_id = ? AND ssms_client_code = ?', [$id, $c]);
    }

    /** Choose how a bus is tracked; for a GPS tracker also its id (IMEI / unique id as the tracker platform shows it). */
    public static function setVehicleMode(array $a, int $vehicleId, string $mode, string $trackerId = ''): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $v = self::vehicleRow($c, $vehicleId);
        if (!$v) {
            throw new \DomainException('Bus not found.');
        }
        if (!isset(self::MODES[$mode])) {
            throw new \DomainException('Choose how this bus is tracked.');
        }
        $trackerId = trim($trackerId);
        if ($mode === 'gps') {
            if (!preg_match('/^[A-Za-z0-9._:-]{3,40}$/', $trackerId)) {
                throw new \DomainException('Enter the tracker ID (its IMEI or the unique ID shown in the tracking platform).');
            }
            if (self::one('SELECT 1 x FROM ssms_transport_vehicles WHERE ssms_client_code = ? AND tracker_id = ? AND vehicle_id <> ?', [$c, $trackerId, $vehicleId])) {
                throw new \DomainException('Another bus already uses this tracker ID.');
            }
        }
        $keepPhone = $mode === 'phone';
        if ($mode !== (string)$v['tracking_mode']) {
            self::closeDeviceTrips($c, $vehicleId, $a['user']);
        }
        self::db()->execute('UPDATE ssms_transport_vehicles SET tracking_mode = ?, tracker_id = ?, device_token_hash = IF(?, device_token_hash, NULL), device_name = IF(?, device_name, NULL),
                device_paired_at = IF(?, device_paired_at, NULL), pair_code_hash = NULL, pair_code_until = NULL, modified = ? WHERE vehicle_id = ? AND ssms_client_code = ?',
            [$mode, $mode === 'gps' ? $trackerId : null, $keepPhone ? 1 : 0, $keepPhone ? 1 : 0, $keepPhone ? 1 : 0, self::now(), $vehicleId, $c]);

        return ['vehicle' => self::vehicleView($c, self::vehicleRow($c, $vehicleId))];
    }

    /**
     * A one-time code (30 minutes) to pair a phone with this bus. The phone scans the QR code (or the code is typed
     * with the school code) on its "Bus phone" screen; no login is needed on that phone afterwards.
     */
    public static function pairCode(array $a, int $vehicleId): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        $v = self::vehicleRow($c, $vehicleId);
        if (!$v) {
            throw new \DomainException('Bus not found.');
        }
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code = '';
        for ($i = 0; $i < 8; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $until = date('Y-m-d H:i:s', AccountSecurity::time() + 1800);
        self::db()->execute("UPDATE ssms_transport_vehicles SET tracking_mode = 'phone', tracker_id = NULL, pair_code_hash = ?, pair_code_until = ?, modified = ? WHERE vehicle_id = ? AND ssms_client_code = ?",
            [hash('sha256', $c . '|' . $code), $until, self::now(), $vehicleId, $c]);

        return ['code' => $code, 'school' => $c, 'qr' => 'MMA-BUS|' . $c . '|' . $code, 'valid_until' => self::localHm($c, $until),
                'vehicle' => self::vehicleView($c, self::vehicleRow($c, $vehicleId))];
    }

    public static function unpair(array $a, int $vehicleId): array
    {
        self::need($a, 'edit');
        $c = $a['client'];
        if (!self::vehicleRow($c, $vehicleId)) {
            throw new \DomainException('Bus not found.');
        }
        self::closeDeviceTrips($c, $vehicleId, $a['user']);
        self::db()->execute('UPDATE ssms_transport_vehicles SET device_token_hash = NULL, device_name = NULL, device_paired_at = NULL, pair_code_hash = NULL, pair_code_until = NULL, modified = ?
                              WHERE vehicle_id = ? AND ssms_client_code = ?', [self::now(), $vehicleId, $c]);

        return ['vehicle' => self::vehicleView($c, self::vehicleRow($c, $vehicleId))];
    }

    /** A bus phone / tracker trip still running on this bus ends when the office changes how the bus is tracked. */
    private static function closeDeviceTrips(string $c, int $vehicleId, ?string $by): void
    {
        foreach (self::q("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND vehicle_id = ? AND status = 'running' AND COALESCE(source,'driver') <> 'driver'", [$c, $vehicleId]) as $t) {
            self::finishTrip($c, $t, (string)($by ?? 'office'));
        }
    }

    /** The school's secret forwarding address for GPS trackers (created on first use). */
    public static function gpsSetup(string $c, bool $renew = false): array
    {
        self::db()->execute('INSERT IGNORE INTO ssms_transport_settings (ssms_client_code) VALUES (?)', [$c]);
        $key = (string)(self::one('SELECT gps_key FROM ssms_transport_settings WHERE ssms_client_code = ?', [$c])['gps_key'] ?? '');
        if ($key === '' || $renew) {
            $key = bin2hex(random_bytes(12));
            self::db()->execute('UPDATE ssms_transport_settings SET gps_key = ? WHERE ssms_client_code = ?', [$key, $c]);
        }

        return ['path' => '/hooks/bus/gps/' . rawurlencode($c) . '/' . $key];
    }

    public static function newGpsKey(array $a): array
    {
        self::need($a, 'edit');

        return self::gpsSetup($a['client'], true);
    }

    // ── The bus phone (no login: its own key) ───────────────────────────────

    /** Pair this phone with a bus: school code + one-time code (from the QR). Returns the phone's key – shown once. */
    public static function devicePair(string $c, string $code, string $deviceName): array
    {
        $c = strtoupper(trim($c));
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code));
        if ($c === '' || strlen($code) !== 8) {
            throw new \DomainException('Scan the QR code from the office, or enter the school code and the 8-character pairing code.');
        }
        self::schoolAllowed($c);
        $hash = hash('sha256', $c . '|' . $code);
        $v = self::one('SELECT * FROM ssms_transport_vehicles WHERE ssms_client_code = ? AND pair_code_hash = ? AND pair_code_until >= ? LIMIT 1', [$c, $hash, self::now()]);
        if (!$v) {
            // only wrong codes are counted and slowed down (a right code always works, so nobody can block a school's pairing)
            $s = self::one('SELECT pair_fails, pair_fail_at FROM ssms_transport_settings WHERE ssms_client_code = ?', [$c]);
            if ($s && $s['pair_fail_at'] && strtotime((string)$s['pair_fail_at']) > AccountSecurity::time() - 900 && (int)$s['pair_fails'] >= 10) {
                throw new \DomainException('Too many wrong codes. Wait 15 minutes and ask the office for a new code.');
            }
            self::db()->execute('INSERT IGNORE INTO ssms_transport_settings (ssms_client_code) VALUES (?)', [$c]);
            self::db()->execute('UPDATE ssms_transport_settings SET pair_fails = IF(pair_fail_at IS NOT NULL AND pair_fail_at > ?, pair_fails + 1, 1), pair_fail_at = ? WHERE ssms_client_code = ?',
                [date('Y-m-d H:i:s', AccountSecurity::time() - 900), self::now(), $c]);
            throw new \DomainException('This pairing code is wrong or has expired. Ask the office for a new one.');
        }
        $token = $c . '.' . bin2hex(random_bytes(24));
        $used = self::db()->execute("UPDATE ssms_transport_vehicles SET tracking_mode = 'phone', device_token_hash = ?, device_name = ?, device_paired_at = ?, pair_code_hash = NULL, pair_code_until = NULL, modified = ?
                              WHERE vehicle_id = ? AND ssms_client_code = ? AND pair_code_hash = ? AND pair_code_until >= ?",
            [hash('sha256', $token), mb_substr(trim($deviceName) !== '' ? trim($deviceName) : 'Phone', 0, 80), self::now(), self::now(), (int)$v['vehicle_id'], $c, $hash, self::now()])->rowCount();
        if ($used !== 1) {   // another phone used the same code a moment earlier
            throw new \DomainException('This pairing code is wrong or has expired. Ask the office for a new one.');
        }

        return ['token' => $token] + self::deviceHome($c, self::vehicleRow($c, (int)$v['vehicle_id']));
    }

    /** The bus of this phone key, or an error the phone shows (and then asks to pair again). */
    public static function deviceVehicle(string $token): array
    {
        $token = trim($token);
        $c = strstr($token, '.', true);
        if ($c === false || $c === '' || strlen($token) < 30) {
            throw new \DomainException('This phone is not paired with a bus.');
        }
        $v = self::one("SELECT * FROM ssms_transport_vehicles WHERE ssms_client_code = ? AND device_token_hash = ? AND tracking_mode = 'phone' LIMIT 1", [$c, hash('sha256', $token)]);
        if (!$v) {
            throw new \DomainException('This phone is no longer paired with a bus. Ask the office for a new pairing code.');
        }
        self::schoolAllowed($c);

        return [$c, $v];
    }

    /** What the bus phone shows: the bus, its routes, the trip now (stops for the map) and the trip windows. */
    public static function deviceHome(string $c, array $v): array
    {
        $trip = self::one("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND vehicle_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1", [$c, (int)$v['vehicle_id']]);
        $routes = array_map(fn($r) => ['route_id' => (int)$r['route_id'], 'route_name' => (string)$r['route_name']], self::vehicleRoutes($c, (int)$v['vehicle_id']));
        $s = self::settings($c);
        $school = self::one('SELECT ssms_client_header_text n FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$c]);

        return ['school' => ['code' => $c, 'name' => (string)($school['n'] ?? $c)], 'vehicle' => self::vehicleView($c, $v), 'routes' => $routes,
                'trip' => $trip ? self::tripFull($c, $trip, false) : null, 'auto' => (bool)$s['auto_trips'],
                'windows' => array_intersect_key($s, self::WINDOWS), 'now' => Locale::now($c, 'H:i'), 'window' => self::windowNow($c)];
    }

    /** Positions from the bus phone or a GPS tracker. Starts / ends trips by itself in the trip windows. */
    public static function vehiclePing(string $c, array $v, array $points, ?float $phoneNowMs, string $source): array
    {
        $vid = (int)$v['vehicle_id'];
        $good = self::cleanPoints($points, AccountSecurity::time() - 6 * 3600, $phoneNowMs);
        $prev = $v['last_lat'] !== null && $v['last_seen'] ? ['lat' => (float)$v['last_lat'], 'lng' => (float)$v['last_lng'], 'ts' => strtotime((string)$v['last_seen']),
                                                                      'speed' => isset($v['last_speed']) && $v['last_speed'] !== null ? (float)$v['last_speed'] : null] : null;
        if ($good) {
            $last = end($good);
            if (!$prev || $last['ts'] >= $prev['ts']) {
                self::db()->execute('UPDATE ssms_transport_vehicles SET last_lat = ?, last_lng = ?, last_seen = ?, last_speed = ? WHERE vehicle_id = ? AND ssms_client_code = ?',
                    [$last['lat'], $last['lng'], date('Y-m-d H:i:s', $last['ts']), $last['speed'], $vid, $c]);
            }
        }
        $trip = self::one("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND vehicle_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1", [$c, $vid]);
        $s = self::settings($c);
        $dir = self::windowNow($c);
        if (!$trip && $good && $s['auto_trips'] && $dir) {
            $trip = self::autoStart($c, $v, $dir, $good, $prev, $source);
        }
        if (!$trip) {
            return ['trip' => null, 'accepted' => 0, 'window' => $dir];
        }
        $accepted = self::pingTrip($c, $trip, array_values(array_filter($good, fn($p) => $p['ts'] >= strtotime((string)$trip['started_at']) - 300)));
        $trip = self::tripRow($c, (int)$trip['id']);
        if ($s['auto_trips'] && $trip['source'] !== 'driver' && self::autoEnd($c, $trip)) {
            $trip = self::tripRow($c, (int)$trip['id']);
        }

        return ['trip' => $trip['status'] === 'running' ? self::tripFull($c, $trip, false) : null, 'accepted' => $accepted, 'window' => $dir,
                'ended' => $trip['status'] !== 'running'];
    }

    /** The bus phone starts / ends a trip by hand (an extra run, or the school day is different). */
    public static function deviceTrip(string $c, array $v, string $action, string $direction, int $routeId = 0): array
    {
        $vid = (int)$v['vehicle_id'];
        $run = self::one("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND vehicle_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1", [$c, $vid]);
        if ($run && ($run['source'] ?? 'driver') === 'driver') {
            throw new \DomainException('The driver is running this trip in the app. The driver or the office ends it.');
        }
        if ($action === 'end') {
            if ($run) {
                self::checkOffBus($c, $run);
                self::finishTrip($c, $run, 'bus phone');
            }

            return self::deviceHome($c, self::vehicleRow($c, $vid));
        }
        if (!isset(self::DIRECTIONS[$direction])) {
            throw new \DomainException('Choose morning pick-up or afternoon drop.');
        }
        if ($run && $run['direction'] === $direction && (!$routeId || (int)$run['route_id'] === $routeId)) {
            return self::deviceHome($c, self::vehicleRow($c, $vid));
        }
        if ($run) {
            self::checkOffBus($c, $run);
            self::finishTrip($c, $run, 'bus phone');
        }
        $routes = self::vehicleRoutes($c, $vid);
        if ($routeId) {
            $routes = array_values(array_filter($routes, fn($r) => (int)$r['route_id'] === $routeId));
        }
        if (!$routes) {
            throw new \DomainException('This bus has no route this school year. Set it in Transport › Assignments.');
        }
        if (count($routes) > 1 && !$routeId) {
            throw new \DomainException('This bus has more than one route. Choose the route.');
        }
        $other = self::one("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id = ? AND status = 'running' LIMIT 1", [$c, (int)$routes[0]['route_id']]);
        if ($other && ($other['source'] ?? 'driver') === 'driver') {
            throw new \DomainException('The driver is running this trip in the app. The driver or the office ends it.');
        }
        if ($other) {
            self::checkOffBus($c, $other);
            self::finishTrip($c, $other, 'bus phone');
        }
        self::createTrip($c, $routes[0], $direction, 'bus phone', 'phone');

        return self::deviceHome($c, self::vehicleRow($c, $vid));
    }

    /**
     * Positions forwarded by a GPS tracker platform. Accepts Traccar's JSON forwarding ({position, device}) – one
     * position or a list – and the simple OsmAnd-style query (?id=&lat=&lon=&timestamp=&speed=&bearing=&accuracy=).
     * Speeds from trackers are in knots. Returns [status, message].
     */
    public static function gpsHook(string $c, string $key, array $query, $json): array
    {
        $c = strtoupper(trim($c));
        $row = self::one('SELECT gps_key FROM ssms_transport_settings WHERE ssms_client_code = ?', [$c]);
        if (!$row || (string)$row['gps_key'] === '' || !hash_equals((string)$row['gps_key'], $key)) {
            return [403, 'forbidden'];
        }
        try {
            self::schoolAllowed($c);
        } catch (\Throwable $e) {
            return [403, 'school not active'];
        }
        $items = [];
        $add = function (string $id, $lat, $lng, $time, $speedKnots, $course, $acc) use (&$items) {
            if ($id === '' || !is_numeric($lat) || !is_numeric($lng)) {
                return;
            }
            $ts = is_numeric($time) ? ((float)$time > 1e11 ? (float)$time : (float)$time * 1000) : (($t = strtotime((string)$time)) ? $t * 1000 : null);
            $items[$id][] = ['lat' => (float)$lat, 'lng' => (float)$lng, 't' => $ts, 'speed' => is_numeric($speedKnots) ? (float)$speedKnots * 0.514444 : null,
                             'heading' => is_numeric($course) ? (float)$course : null, 'accuracy' => is_numeric($acc) && (float)$acc > 0 ? (float)$acc : null];
        };
        $list = is_array($json) ? (isset($json['position']) || isset($json['device']) || isset($json['location']) ? [$json] : (array_is_list($json) ? $json : [])) : [];
        foreach ($list as $j) {
            if (isset($j['location']) && is_array($j['location'])) {   // Traccar Client app (JSON): speed in m/s
                $co = $j['location']['coords'] ?? [];
                $sp = $co['speed'] ?? null;
                $add((string)($j['device_id'] ?? ''), $co['latitude'] ?? null, $co['longitude'] ?? null, $j['location']['timestamp'] ?? null,
                    is_numeric($sp) && (float)$sp >= 0 ? (float)$sp / 0.514444 : null, $co['heading'] ?? null, $co['accuracy'] ?? null);
                continue;
            }
            $pos = $j['position'] ?? [];
            $dev = $j['device'] ?? [];
            $add((string)($dev['uniqueId'] ?? $pos['deviceId'] ?? ''), $pos['latitude'] ?? null, $pos['longitude'] ?? null, $pos['fixTime'] ?? $pos['deviceTime'] ?? null,
                $pos['speed'] ?? null, $pos['course'] ?? null, $pos['accuracy'] ?? null);
        }
        if (!$list && isset($query['id'])) {
            $add((string)$query['id'], $query['lat'] ?? null, $query['lon'] ?? ($query['lng'] ?? null), $query['timestamp'] ?? null, $query['speed'] ?? null,
                $query['bearing'] ?? ($query['heading'] ?? null), $query['accuracy'] ?? null);
        }
        if (!$items) {
            return [400, 'no position'];
        }
        $done = 0;
        foreach ($items as $id => $pts) {
            $v = self::one("SELECT * FROM ssms_transport_vehicles WHERE ssms_client_code = ? AND tracker_id = ? AND tracking_mode = 'gps' LIMIT 1", [$c, $id]);
            if ($v) {
                self::vehiclePing($c, $v, $pts, null, 'gps');
                $done++;
            }
        }

        return [200, $done ? 'ok' : 'unknown tracker'];
    }

    /** morning → pickup, afternoon → drop, otherwise null (school's local time). */
    private static function windowNow(string $c): ?string
    {
        $s = self::settings($c);
        $t = Locale::now($c, 'H:i');
        if ($t >= $s['morning_from'] && $t < $s['morning_to']) {
            return 'pickup';
        }
        if ($t >= $s['afternoon_from'] && $t < $s['afternoon_to']) {
            return 'drop';
        }

        return null;
    }

    /** This bus's routes this school year (assignment rows with route_name). */
    private static function vehicleRoutes(string $c, int $vid): array
    {
        return self::q("SELECT a.*, r.route_name FROM ssms_transport_assignments a JOIN ssms_transport_routes r ON r.route_id = a.route_id
                         WHERE a.ssms_client_code = ? AND a.vehicle_id = ? AND a.session_id = ? AND COALESCE(r.status,'active') = 'active' ORDER BY r.route_name",
            [$c, $vid, self::currentSession($c)]);
    }

    /** The bus is moving in a trip window and has not done this run today: start it (the route with the nearest stop). */
    private static function autoStart(string $c, array $v, string $dir, array $good, ?array $prev, string $source): ?array
    {
        // only fairly exact positions count (a parked bus "jumps" with a poor GPS fix); speed must be seen twice in a row
        $fine = array_values(array_filter($good, fn($p) => $p['acc'] === null || $p['acc'] <= 60));
        if (!$fine) {
            return null;
        }
        $last = end($fine);
        $first = $prev && $last['ts'] - $prev['ts'] <= 600 ? $prev + ['acc' => null] : $fine[0];
        $fast = array_values(array_filter($fine, fn($p) => $p['speed'] !== null && $p['speed'] >= 2.5));
        $moving = count($fast) >= 2 || ($fast && $prev && $last['ts'] - $prev['ts'] <= 600 && ($prev['speed'] ?? 0) >= 2.5)
            || self::dist($first['lat'], $first['lng'], $last['lat'], $last['lng']) >= 150 + (int)($first['acc'] ?? 0) + (int)($last['acc'] ?? 0);
        if (!$moving) {
            return null;
        }
        $best = null;
        $bestD = INF;
        foreach (self::vehicleRoutes($c, (int)$v['vehicle_id']) as $as) {
            $rid = (int)$as['route_id'];
            if (self::one("SELECT 1 x FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id = ? AND direction = ? AND trip_date = ? LIMIT 1", [$c, $rid, $dir, self::today($c)])) {
                continue;   // already done today (ended by the driver, the office or by itself): not again by itself
            }
            $d = INF;
            foreach (self::routeStops($c, $rid) as $st) {
                if ($st['latitude'] !== null && $st['longitude'] !== null && ((float)$st['latitude'] != 0.0 || (float)$st['longitude'] != 0.0)) {
                    $d = min($d, self::dist($last['lat'], $last['lng'], (float)$st['latitude'], (float)$st['longitude']));
                }
            }
            if ($best === null || $d < $bestD) {
                [$best, $bestD] = [$as, $d];
            }
        }
        if (!$best) {
            return null;
        }
        $other = self::one("SELECT * FROM ssms_transport_trips WHERE ssms_client_code = ? AND route_id = ? AND status = 'running' LIMIT 1", [$c, (int)$best['route_id']]);
        if ($other && ($other['source'] ?? 'driver') === 'driver') {
            return null;   // a driver is running this route in the app
        }
        if ($other) {
            self::finishTrip($c, $other, $source === 'gps' ? 'GPS tracker' : 'bus phone');   // the morning run left open
        }
        try {
            $r = self::createTrip($c, $best, $dir, $source === 'gps' ? 'GPS tracker' : 'bus phone', $source);
        } catch (\Throwable $e) {
            return null;   // no stops on the route yet
        }

        return self::tripRow($c, (int)$r['trip']['trip_id']);
    }

    /** Every stop done and 10 minutes since the last one, or the window is long over: end the trip by itself. */
    private static function autoEnd(string $c, array $trip): bool
    {
        $rows = self::q('SELECT ts.status, ts.arrived_at, ts.left_at, s.latitude, s.longitude FROM ssms_transport_trip_stops ts LEFT JOIN ssms_transport_stops s ON s.stop_id = ts.stop_id
                          WHERE ts.trip_id = ? ORDER BY ts.seq', [(int)$trip['id']]);
        $mapped = array_values(array_filter($rows, fn($r) => $r['latitude'] !== null && $r['longitude'] !== null && ((float)$r['latitude'] != 0.0 || (float)$r['longitude'] != 0.0)));
        $done = $mapped && !array_filter($mapped, fn($r) => $r['status'] === 'pending');
        if ($done && $trip['direction'] === 'drop' && array_filter(self::tripStudents($c, $trip), fn($s) => $s['status'] === 'boarded')) {
            $done = false;   // a child is still marked on the bus: wait (the office sees it on the live map)
        }
        $lastAt = 0;
        foreach ($mapped as $r) {
            $lastAt = max($lastAt, $r['left_at'] ? strtotime((string)$r['left_at']) : 0, $r['arrived_at'] ? strtotime((string)$r['arrived_at']) : 0);
        }
        $now = AccountSecurity::time();
        $s = self::settings($c);
        [$from, $to] = $trip['direction'] === 'pickup' ? [$s['morning_from'], $s['morning_to']] : [$s['afternoon_from'], $s['afternoon_to']];
        $limit = date('H:i', strtotime('2000-01-01 ' . $to . ' +30 minutes'));   // half an hour after the window
        $began = self::localHm($c, (string)$trip['started_at']);
        $windowOver = $limit > $to && $began >= $from && $began < $to          // trips started by hand outside the times end at the last stop / when idle
            && Locale::now($c, 'H:i') >= $limit && $now - strtotime((string)$trip['started_at']) > 1800;
        if (($done && $lastAt && $now - $lastAt >= 600) || $windowOver) {
            self::finishTrip($c, $trip, $trip['source'] === 'gps' ? 'GPS tracker' : 'bus phone');

            return true;
        }

        return false;
    }

    /** An afternoon trip is not ended from the bus phone while children are still marked on the bus. */
    private static function checkOffBus(string $c, array $trip): void
    {
        if ($trip['direction'] !== 'drop') {
            return;
        }
        $names = array_map(fn($s) => $s['name'], array_filter(self::tripStudents($c, $trip), fn($s) => $s['status'] === 'boarded'));
        if ($names) {
            throw new \DomainException(Locale::t($c, 'Still marked on the bus: {names}. Check the bus – the office can end the trip.', ['names' => implode(', ', $names)]));
        }
    }

    /** End a trip that has no driver to check the bus: morning – children marked on the bus reached school. */
    private static function finishTrip(string $c, array $trip, string $by): void
    {
        if ($trip['direction'] === 'pickup') {
            $send = self::$sendNow;
            self::$sendNow = false;
            try {
                foreach (self::riders($c, $trip) as $r) {
                    if ($r['status'] === 'boarded') {
                        self::markStudent(['client' => $c, 'user' => $by, 'edit' => true, 'driver_ids' => []], (int)$trip['id'], $r['enrollment_id'], 'dropped');
                    }
                }
            } finally {
                self::$sendNow = $send;
            }
            self::send($c);
        }
        self::closeTrip($c, (int)$trip['id'], 'auto', $by);
    }

    /** Device / tracker requests: the school is active and has Transport. */
    private static function schoolAllowed(string $c): void
    {
        $r = self::one('SELECT ssms_client_status, ssms_client_expiry_date FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$c]);
        if (!$r || strtolower(trim((string)($r['ssms_client_status'] ?? ''))) === 'inactive') {
            throw new \DomainException('This school account is not active.');
        }
        try {
            $ent = Entitlements::forClient($c);
        } catch (\Throwable $e) {
            return;
        }
        if (!Entitlements::allows($ent, 'transport')) {
            throw new \DomainException('Live bus tracking is not part of this school\'s plan.');
        }
        $exp = substr((string)($r['ssms_client_expiry_date'] ?? ''), 0, 10);
        if (!Entitlements::isSubscription($ent) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $exp) && $exp > '1900-01-01' && $exp < self::today($c)) {
            throw new \DomainException('This school account has expired.');
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /** Stops of a route in pick-up order (stop_order). */
    private static function routeStops(string $c, int $routeId): array
    {
        return self::q('SELECT * FROM ssms_transport_stops WHERE ssms_client_code = ? AND route_id = ? ORDER BY stop_order, stop_id', [$c, $routeId]);
    }

    private static function tripStopRows(int $tid): array
    {
        $out = [];
        foreach (self::q('SELECT ts.*, s.stop_name, s.latitude, s.longitude, s.pickup_time, s.dropoff_time FROM ssms_transport_trip_stops ts
                            LEFT JOIN ssms_transport_stops s ON s.stop_id = ts.stop_id WHERE ts.trip_id = ? ORDER BY ts.seq', [$tid]) as $r) {
            $has = $r['latitude'] !== null && $r['longitude'] !== null && ((float)$r['latitude'] != 0.0 || (float)$r['longitude'] != 0.0);
            $out[] = ['stop_id' => (int)$r['stop_id'], 'seq' => (int)$r['seq'], 'status' => (string)$r['status'], 'near_at' => $r['near_at'],
                      'min' => $r['min_dist'] !== null ? (int)$r['min_dist'] : null,
                      'name' => (string)($r['stop_name'] ?? ''), 'lat' => $has ? (float)$r['latitude'] : null, 'lng' => $has ? (float)$r['longitude'] : null,
                      'pickup_time' => $r['pickup_time'] ? substr((string)$r['pickup_time'], 0, 5) : null, 'dropoff_time' => $r['dropoff_time'] ? substr((string)$r['dropoff_time'], 0, 5) : null,
                      'raw' => $r];
        }

        return $out;
    }

    private static function stopName(string $c, ?int $id): string
    {
        if (!$id) {
            return '';
        }

        return (string)(self::one('SELECT stop_name FROM ssms_transport_stops WHERE stop_id = ? AND ssms_client_code = ?', [$id, $c])['stop_name'] ?? '');
    }

    private static function tripRow(string $c, int $id): ?array
    {
        return self::one('SELECT * FROM ssms_transport_trips WHERE id = ? AND ssms_client_code = ?', [$id, $c]);
    }

    /** Metres between two points. */
    public static function dist(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371000.0;
        $p1 = deg2rad($lat1);
        $p2 = deg2rad($lat2);
        $dp = $p2 - $p1;
        $dl = deg2rad($lng2 - $lng1);
        $h = sin($dp / 2) ** 2 + cos($p1) * cos($p2) * sin($dl / 2) ** 2;

        return 2 * $r * asin(min(1.0, sqrt($h)));
    }

    /** Server time → the school's HH:MM. */
    private static function localHm(string $c, string $utc): string
    {
        return (new \DateTimeImmutable('@' . strtotime($utc)))->setTimezone(Locale::tz($c))->format('H:i');
    }

    public static function currentSession(string $c): int
    {
        $r = self::one("SELECT session_id FROM ssms_sessions WHERE ssms_client_code = ? ORDER BY (UPPER(COALESCE(is_current,'')) = 'Y') DESC, session_id DESC LIMIT 1", [$c]);

        return $r ? (int)$r['session_id'] : 0;
    }

    private static function flag($v): bool
    {
        return $v === true || $v === 1 || in_array(strtolower(trim((string)$v)), ['1', 'true', 'yes', 'on'], true);
    }

    private static function today(string $c): string
    {
        return Locale::today($c);
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
