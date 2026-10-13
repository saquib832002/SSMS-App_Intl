<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Staff attendance.
 *
 *  - Staff check in / out from the app (optionally with the rotating office code
 *    shown on the office screen, so check-in only works on site).
 *  - Admin marks or corrects any day (P present, A absent, HD half day, L leave, H holiday).
 *  - Approved staff leave (ssms_leave_applications) marks its school days "L";
 *    cancelling the leave puts the days back.
 *  - Monthly report: working days, present, late, half days, paid / unpaid leave,
 *    absent, not marked and **payable days** – used to pre-fill payroll.
 *
 * School days = School Settings working / weekend days minus holidays (School Events),
 * the same calendar as student leave (StudentLeave::schoolDays).
 */
class StaffAttendance
{
    public const STATUSES = ['P', 'A', 'HD', 'L', 'H'];
    public const ADMINS   = ['owner', 'admin', 'principal'];
    public const CODE_WINDOW = 60;   // office code changes every 60 seconds

    public const QR_PREFIX = 'MMA1';  // QR on the office screen = "MMA1:<school>:<code>"
    public const REMIND_WINDOW = 180; // minutes after start + grace in which reminders are still sent

    /** Clock for tests: fn(): int (unix time) */
    public static $now = null;

    /** Push sender (overridable in tests): fn(array $messages): void */
    public static $push = null;

    private static function time(): int
    {
        return is_callable(self::$now) ? (int)(self::$now)() : time();
    }

    // ── Settings ────────────────────────────────────────────────────────────

    public static function settings(string $clientCode): array
    {
        $r = null;
        try {
            $r = self::db()->execute(
                'SELECT * FROM ssms_staff_attendance_settings WHERE ssms_client_code = ? LIMIT 1', [$clientCode]
            )->fetch('assoc') ?: null;
        } catch (\Throwable $e) {
        }
        $phase2 = $r !== null && array_key_exists('remind_staff', $r);
        if ($r === null) {
            try {
                self::db()->execute('SELECT remind_staff FROM ssms_staff_attendance_settings LIMIT 0');
                $phase2 = true;
            } catch (\Throwable $e) {
            }
        }
        $start = '08:00';
        try {
            $s = self::db()->execute(
                'SELECT school_start_time, school_end_time FROM ssms_school_settings WHERE client_code = ? LIMIT 1', [$clientCode]
            )->fetch('assoc');
            if (!empty($s['school_start_time'])) {
                $start = substr((string)$s['school_start_time'], 0, 5);
            }
        } catch (\Throwable $e) {
        }

        return [
            'school_start'        => $start,
            'late_grace_minutes'  => (int)($r['late_grace_minutes'] ?? 10),
            'half_day_after'      => !empty($r['half_day_after']) ? substr((string)$r['half_day_after'], 0, 5) : null,
            'require_office_code' => (int)($r['require_office_code'] ?? 0) === 1,
            'self_checkin'        => (int)($r['self_checkin'] ?? 1) === 1,
            // phase 2 (2026_10_staff_checkin_gps_qr.sql)
            'allow_qr'            => (int)($r['allow_qr'] ?? 1) === 1,
            'require_location'    => (int)($r['require_location'] ?? 0) === 1,
            // location, or the office code / QR when GPS fails (2026_10_staff_checkin_fallback.sql)
            'location_or_code'    => (int)($r['location_or_code'] ?? 0) === 1,
            'geo_lat'             => isset($r['geo_lat']) ? (float)$r['geo_lat'] : null,
            'geo_lng'             => isset($r['geo_lng']) ? (float)$r['geo_lng'] : null,
            'geo_radius_m'        => (int)($r['geo_radius_m'] ?? 150),
            'location_set'        => isset($r['geo_lat'], $r['geo_lng']),
            'remind_staff'        => (int)($r['remind_staff'] ?? 0) === 1,
            'phase2'              => $phase2,   // false = run 2026_10_staff_checkin_gps_qr.sql
        ];
    }

    public static function saveSettings(string $clientCode, array $d, string $by): array
    {
        $grace = (int)($d['late_grace_minutes'] ?? 10);
        if ($grace < 0 || $grace > 240) {
            throw new \InvalidArgumentException('Grace time must be between 0 and 240 minutes.');
        }
        $half = trim((string)($d['half_day_after'] ?? ''));
        if ($half !== '' && !preg_match('/^\d{1,2}:\d{2}$/', $half)) {
            throw new \InvalidArgumentException('Half-day time must look like 10:30.');
        }
        self::db()->execute(
            'INSERT INTO ssms_staff_attendance_settings
                (ssms_client_code, late_grace_minutes, half_day_after, require_office_code, self_checkin, office_secret, updated_by, modified)
             VALUES (?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE late_grace_minutes = VALUES(late_grace_minutes), half_day_after = VALUES(half_day_after),
                    require_office_code = VALUES(require_office_code), self_checkin = VALUES(self_checkin),
                    updated_by = VALUES(updated_by), modified = VALUES(modified),
                    office_secret = COALESCE(office_secret, VALUES(office_secret))',
            [$clientCode, $grace, $half !== '' ? $half . ':00' : null, !empty($d['require_office_code']) ? 1 : 0,
             !isset($d['self_checkin']) || !empty($d['self_checkin']) ? 1 : 0, bin2hex(random_bytes(16)),
             mb_substr($by, 0, 100), date('Y-m-d H:i:s')]
        );

        // phase 2: QR, GPS, reminders
        $p2 = array_intersect_key($d, array_flip(['allow_qr', 'require_location', 'geo_radius_m', 'remind_staff', 'location_or_code']));
        if ($p2) {
            $cur    = self::settings($clientCode);
            $radius = (int)($d['geo_radius_m'] ?? $cur['geo_radius_m']);
            if ($radius < 30 || $radius > 5000) {
                throw new \InvalidArgumentException('Distance must be between 30 and 5000 metres.');
            }
            $needLoc = array_key_exists('require_location', $d) ? !empty($d['require_location']) : $cur['require_location'];
            if ($needLoc && !$cur['location_set']) {
                throw new \InvalidArgumentException('Set the school location first (tap "Use my current location" while at school).');
            }
            try {
                self::db()->execute(
                    'UPDATE ssms_staff_attendance_settings SET allow_qr = ?, require_location = ?, geo_radius_m = ?, remind_staff = ?
                      WHERE ssms_client_code = ?',
                    [array_key_exists('allow_qr', $d) ? (!empty($d['allow_qr']) ? 1 : 0) : (int)$cur['allow_qr'],
                     $needLoc ? 1 : 0, $radius,
                     array_key_exists('remind_staff', $d) ? (!empty($d['remind_staff']) ? 1 : 0) : (int)$cur['remind_staff'],
                     $clientCode]
                );
            } catch (\Throwable $e) {
                Log::error('StaffAttendance saveSettings phase 2: ' . $e->getMessage());
                throw new \DomainException('Run the database update 2026_10_staff_checkin_gps_qr.sql first.');
            }
            if (array_key_exists('location_or_code', $d)) {
                $either = !empty($d['location_or_code']) && $needLoc ? 1 : 0;
                try {
                    self::db()->execute(
                        'UPDATE ssms_staff_attendance_settings SET location_or_code = ? WHERE ssms_client_code = ?', [$either, $clientCode]
                    );
                } catch (\Throwable $e) {
                    if ($either) {
                        Log::error('StaffAttendance saveSettings fallback: ' . $e->getMessage());
                        throw new \DomainException('Run the database update 2026_10_staff_checkin_fallback.sql first.');
                    }
                }
            }
        }

        return self::settings($clientCode);
    }

    /** Admin standing at school: remember where the school is. */
    public static function setLocation(string $clientCode, $lat, $lng, string $by): array
    {
        if (!is_numeric($lat) || !is_numeric($lng) || abs((float)$lat) > 90 || abs((float)$lng) > 180
            || ((float)$lat == 0.0 && (float)$lng == 0.0)) {
            throw new \InvalidArgumentException('Could not read your location. Turn on location and try again.');
        }
        self::secret($clientCode);   // makes sure the settings row exists
        try {
            self::db()->execute(
                'UPDATE ssms_staff_attendance_settings SET geo_lat = ?, geo_lng = ?, updated_by = ?, modified = ? WHERE ssms_client_code = ?',
                [round((float)$lat, 7), round((float)$lng, 7), mb_substr($by, 0, 100), date('Y-m-d H:i:s'), $clientCode]
            );
        } catch (\Throwable $e) {
            Log::error('StaffAttendance setLocation: ' . $e->getMessage());
            throw new \DomainException('Run the database update 2026_10_staff_checkin_gps_qr.sql first.');
        }

        return self::settings($clientCode);
    }

    /** Distance in metres between two points (haversine). */
    public static function distance(float $lat1, float $lng1, float $lat2, float $lng2): int
    {
        $r = 6371000;
        $a = sin(deg2rad($lat2 - $lat1) / 2) ** 2
           + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin(deg2rad($lng2 - $lng1) / 2) ** 2;

        return (int)round(2 * $r * asin(min(1, sqrt($a))));
    }

    // ── Office code (kiosk screen) ─────────────────────────────────────────

    private static function secret(string $clientCode): string
    {
        $r = self::db()->execute(
            'SELECT office_secret FROM ssms_staff_attendance_settings WHERE ssms_client_code = ? LIMIT 1', [$clientCode]
        )->fetch('assoc');
        if (!empty($r['office_secret'])) {
            return (string)$r['office_secret'];
        }
        $sec = bin2hex(random_bytes(16));
        self::db()->execute(
            'INSERT INTO ssms_staff_attendance_settings (ssms_client_code, office_secret, modified) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE office_secret = COALESCE(office_secret, VALUES(office_secret))',
            [$clientCode, $sec, date('Y-m-d H:i:s')]
        );

        return (string)self::db()->execute(
            'SELECT office_secret FROM ssms_staff_attendance_settings WHERE ssms_client_code = ?', [$clientCode]
        )->fetch('assoc')['office_secret'];
    }

    private static function codeFor(string $clientCode, int $window): string
    {
        $h = hash_hmac('sha256', $clientCode . '|' . $window, self::secret($clientCode));

        return str_pad((string)(hexdec(substr($h, 0, 8)) % 1000000), 6, '0', STR_PAD_LEFT);
    }

    /** → { code, expires_in, qr } for the office screen (qr = text to draw as a QR code) */
    public static function officeCode(string $clientCode): array
    {
        $t    = self::time();
        $w    = intdiv($t, self::CODE_WINDOW);
        $code = self::codeFor($clientCode, $w);

        return [
            'code'       => $code,
            'expires_in' => self::CODE_WINDOW - ($t % self::CODE_WINDOW),
            'qr'         => self::settings($clientCode)['allow_qr'] ? self::QR_PREFIX . ':' . $clientCode . ':' . $code : null,
        ];
    }

    /** Typed code "123 456" or scanned QR "MMA1:SCHOOL:123456" → [code, scanned?] */
    private static function parseCode(string $clientCode, string $raw): array
    {
        $raw = trim($raw);
        if (stripos($raw, self::QR_PREFIX . ':') === 0) {
            $parts = explode(':', $raw);
            if (count($parts) !== 3 || strtoupper($parts[1]) !== strtoupper($clientCode)) {
                throw new \InvalidArgumentException('This QR code is for a different school.');
            }

            return [$parts[2], true];
        }

        return [$raw, false];
    }

    private static function codeValid(string $clientCode, string $code): bool
    {
        $code = preg_replace('/\D/', '', $code);
        $w    = intdiv(self::time(), self::CODE_WINDOW);
        foreach ([$w, $w - 1] as $x) {      // current or the one that just expired
            if (hash_equals(self::codeFor($clientCode, $x), $code)) {
                return true;
            }
        }

        return false;
    }

    // ── Who is this staff member? ──────────────────────────────────────────

    public static function staffIdForUser(string $clientCode, string $user): ?int
    {
        $r = self::db()->execute(
            'SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$user, $clientCode]
        )->fetch('assoc');

        return !empty($r['staff_id']) ? (int)$r['staff_id'] : null;
    }

    /** Active staff (hired, not resigned). */
    public static function staffList(string $clientCode): array
    {
        return self::db()->execute(
            "SELECT s.staff_id, TRIM(CONCAT(COALESCE(s.first_name,''),' ',COALESCE(s.last_name,''))) AS staff_name,
                    s.mobile_number, s.branch_id
               FROM ssms_staff s
              WHERE s.ssms_client_code = ?
                AND s.hired IN ('Y','Yes','yes','1')
                AND (s.resigned IS NULL OR TRIM(s.resigned) = '' OR LOWER(TRIM(s.resigned)) IN ('n','no','0'))
              ORDER BY s.first_name, s.last_name",
            [$clientCode]
        )->fetchAll('assoc');
    }

    // ── Check in / out ─────────────────────────────────────────────────────

    /**
     * $code: typed office code or scanned QR text.
     * $where: ['lat' =>, 'lng' =>, 'accuracy' => metres] from the phone (needed when the school requires location).
     */
    public static function checkIn(string $clientCode, int $staffId, ?string $code = null, array $where = []): array
    {
        $set = self::settings($clientCode);
        if (!$set['self_checkin']) {
            throw new \DomainException('Self check-in is turned off – the office marks attendance.');
        }
        [$code, $scanned] = self::parseCode($clientCode, (string)$code);
        // "location, or the code if GPS fails": a valid code / QR replaces the location check
        $either  = $set['location_or_code'] && $set['require_location'] && !$set['require_office_code'];
        $hasCode = preg_replace('/\D/', '', $code) !== '';
        $codeOk  = false;
        if ($set['require_office_code'] || $scanned || ($either && $hasCode)) {
            $codeOk = self::codeValid($clientCode, $code);
        }
        if (($set['require_office_code'] || $scanned || ($either && $hasCode)) && !$codeOk) {
            throw new \InvalidArgumentException($scanned
                ? 'This QR code has expired – scan the code on the office screen again.'
                : 'That code is not right or has expired – enter the code shown on the office screen.');
        }
        // location
        $lat = isset($where['lat']) && is_numeric($where['lat']) ? (float)$where['lat'] : null;
        $lng = isset($where['lng']) && is_numeric($where['lng']) ? (float)$where['lng'] : null;
        $dist = null;
        if ($lat !== null && $lng !== null && $set['location_set']) {
            $dist = self::distance($lat, $lng, $set['geo_lat'], $set['geo_lng']);
        }
        $orCode = $either ? ' Or check in with the office code / QR instead.' : '';
        if ($set['require_location'] && $set['location_set'] && !($either && $codeOk)) {
            if ($dist === null) {
                throw new \InvalidArgumentException('Turn on location so the app can check you are at school.' . $orCode);
            }
            // allow for the phone's GPS accuracy (at most 100 m extra)
            $slack = min(100, max(0, (int)($where['accuracy'] ?? 0)));
            if ($dist - $slack > $set['geo_radius_m']) {
                throw new \InvalidArgumentException(
                    'You seem to be about ' . self::niceDistance($dist) . ' from school. Check in when you are at school '
                    . '(within ' . $set['geo_radius_m'] . ' m). If you are at school, step outside or near a window and try again.'
                    . $orCode
                );
            }
        }
        $t    = self::time();
        $date = date('Y-m-d', $t);
        $time = date('H:i:s', $t);
        $row  = self::row($clientCode, $staffId, $date);
        if ($row && $row['check_in']) {
            throw new \DomainException('You already checked in at ' . substr((string)$row['check_in'], 0, 5) . '.');
        }
        // late / half day
        $startTs = strtotime($date . ' ' . $set['school_start'] . ':00');
        $late    = max(0, (int)floor(($t - $startTs) / 60) - $set['late_grace_minutes']);
        $lateMin = $late > 0 ? (int)floor(($t - $startTs) / 60) : 0;
        $status  = ($set['half_day_after'] && $time > $set['half_day_after'] . ':00') ? 'HD' : 'P';
        $method  = $scanned ? 'qr' : ($codeOk ? 'code' : ($set['require_location'] && $dist !== null ? 'gps' : 'app'));
        $geo     = [$lat !== null ? round($lat, 7) : null, $lng !== null ? round($lng, 7) : null, $dist];
        $now     = date('Y-m-d H:i:s', $t);
        if ($row) {
            self::db()->execute(
                'UPDATE ssms_staff_attendance SET status = ?, check_in = ?, method = ?, late_minutes = ?,
                        leave_application_id = IF(leave_half = 1, leave_application_id, NULL), modified = ? WHERE id = ?',
                [$row['leave_half'] ? 'L' : $status, $time, $method, $lateMin, $now, $row['id']]
            );
            $id = $row['id'];
        } else {
            self::db()->execute(
                'INSERT INTO ssms_staff_attendance (ssms_client_code, staff_id, att_date, status, check_in, method, late_minutes, marked_by, created, modified)
                 VALUES (?,?,?,?,?,?,?,?,?,?)',
                [$clientCode, $staffId, $date, $status, $time, $method, $lateMin, 'self', $now, $now]
            );
            $id = self::row($clientCode, $staffId, $date)['id'];
        }
        if ($geo[0] !== null) {
            try {
                self::db()->execute('UPDATE ssms_staff_attendance SET lat = ?, lng = ?, distance_m = ? WHERE id = ?', [...$geo, $id]);
            } catch (\Throwable $e) {
                // phase-2 columns not there yet
            }
        }

        Cover::attendanceChanged($clientCode, Locale::today($clientCode));   // was marked absent → cover no longer needed (the school's date)
        return self::row($clientCode, $staffId, $date);
    }

    public static function checkOut(string $clientCode, int $staffId): array
    {
        $t    = self::time();
        $date = date('Y-m-d', $t);
        $row  = self::row($clientCode, $staffId, $date);
        if (!$row || !$row['check_in']) {
            throw new \DomainException('Check in first.');
        }
        if ($row['check_out']) {
            throw new \DomainException('You already checked out at ' . substr((string)$row['check_out'], 0, 5) . '.');
        }
        self::db()->execute(
            'UPDATE ssms_staff_attendance SET check_out = ?, modified = ? WHERE id = ?',
            [date('H:i:s', $t), date('Y-m-d H:i:s', $t), $row['id']]
        );

        return self::row($clientCode, $staffId, $date);
    }

    // ── Admin marking ──────────────────────────────────────────────────────

    /** Whole staff list for a day, with any record + leave. */
    public static function day(string $clientCode, string $date): array
    {
        $rows = self::db()->execute(
            'SELECT * FROM ssms_staff_attendance WHERE ssms_client_code = ? AND att_date = ?', [$clientCode, $date]
        )->fetchAll('assoc');
        $by = [];
        foreach ($rows as $r) {
            $by[(int)$r['staff_id']] = self::cast($r);
        }
        $cal    = StudentLeave::schoolDays($clientCode, $date, $date);
        $school = count($cal['days']) === 1;
        $out    = [];
        foreach (self::staffList($clientCode) as $s) {
            $out[] = $s + ['record' => $by[(int)$s['staff_id']] ?? null];
        }

        return ['date' => $date, 'school_day' => $school, 'off_reason' => $cal['skipped'][0] ?? null, 'staff' => $out];
    }

    /** $marks = [{staff_id, status, note?, check_in?, check_out?}] */
    public static function mark(string $clientCode, string $date, array $marks, string $by): int
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new \InvalidArgumentException('Choose a date.');
        }
        $valid = array_column(self::staffList($clientCode), 'staff_id');
        $valid = array_map('intval', $valid);
        $n     = 0;
        $now   = date('Y-m-d H:i:s');
        foreach ($marks as $m) {
            $sid = (int)($m['staff_id'] ?? 0);
            $st  = strtoupper(trim((string)($m['status'] ?? '')));
            if (!in_array($sid, $valid, true) || !in_array($st, self::STATUSES, true)) {
                continue;
            }
            $ci   = self::hhmm($m['check_in'] ?? null);
            $co   = self::hhmm($m['check_out'] ?? null);
            $note = mb_substr(trim((string)($m['note'] ?? '')), 0, 255) ?: null;
            $row  = self::row($clientCode, $sid, $date);
            if ($row) {
                // a manual change takes the day away from the leave sync
                self::db()->execute(
                    'UPDATE ssms_staff_attendance SET status = ?, check_in = COALESCE(?, check_in), check_out = COALESCE(?, check_out),
                            note = COALESCE(?, note), method = IF(method IS NULL OR method = \'leave\', \'manual\', method),
                            leave_application_id = IF(? = \'L\', leave_application_id, NULL), marked_by = ?, modified = ? WHERE id = ?',
                    [$st, $ci, $co, $note, $st, mb_substr($by, 0, 100), $now, $row['id']]
                );
            } else {
                self::db()->execute(
                    'INSERT INTO ssms_staff_attendance (ssms_client_code, staff_id, att_date, status, check_in, check_out, method, note, marked_by, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    [$clientCode, $sid, $date, $st, $ci, $co, 'manual', $note, mb_substr($by, 0, 100), $now, $now]
                );
            }
            $n++;
        }
        if ($n > 0) {
            Cover::attendanceChanged($clientCode, $date);   // teacher cover: someone marked present again no longer needs cover
        }

        return $n;
    }

    // ── Leave link ─────────────────────────────────────────────────────────

    /**
     * Keep attendance in line with a staff leave application (call after approve / reject / cancel).
     * Approved → its school days become "L" (half-day leave counts half). Otherwise the days it
     * marked go back to what they were, unless someone changed them since.
     */
    public static function syncLeave(string $clientCode, int $applicationId): void
    {
        self::syncLeaveDays($clientCode, $applicationId);
        // teacher cover: cancel covers no longer needed, tell the office about periods to cover
        Cover::leaveChanged($clientCode, $applicationId);
    }

    private static function syncLeaveDays(string $clientCode, int $applicationId): void
    {
        try {
            $app = self::db()->execute(
                'SELECT la.*, s.ssms_client_code FROM ssms_leave_applications la
                   JOIN ssms_staff s ON s.staff_id = la.staff_id
                  WHERE la.id = ? AND s.ssms_client_code = ? LIMIT 1',
                [$applicationId, $clientCode]
            )->fetch('assoc');
            if (!$app) {
                return;
            }
            $db  = self::db();
            $now = date('Y-m-d H:i:s');
            // revert days this application marked
            $rows = $db->execute(
                'SELECT * FROM ssms_staff_attendance WHERE ssms_client_code = ? AND leave_application_id = ?',
                [$clientCode, $applicationId]
            )->fetchAll('assoc');
            $keep = $app['status'] === 'approved'
                ? array_flip(StudentLeave::schoolDays($clientCode, (string)$app['from_date'], (string)$app['to_date'])['days'])
                : [];
            foreach ($rows as $r) {
                if (isset($keep[(string)$r['att_date']])) {
                    continue;
                }
                if ($r['status'] === 'L' && !$r['check_in']) {
                    if ($r['prev_status'] === null || $r['prev_status'] === '') {
                        $db->execute('DELETE FROM ssms_staff_attendance WHERE id = ?', [$r['id']]);
                    } else {
                        $db->execute(
                            'UPDATE ssms_staff_attendance SET status = prev_status, prev_status = NULL, leave_application_id = NULL,
                                    leave_half = 0, method = \'manual\', modified = ? WHERE id = ?',
                            [$now, $r['id']]
                        );
                    }
                } else {
                    $db->execute('UPDATE ssms_staff_attendance SET leave_application_id = NULL, leave_half = 0, modified = ? WHERE id = ?', [$now, $r['id']]);
                }
            }
            if ($app['status'] !== 'approved') {
                return;
            }
            $half = (int)($app['is_half_day'] ?? 0) === 1 ? 1 : 0;
            foreach (array_keys($keep) as $date) {
                $row = self::row($clientCode, (int)$app['staff_id'], $date);
                if ($row && ((int)$row['leave_application_id'] === $applicationId || in_array($row['status'], ['H', 'P', 'HD'], true) && $row['check_in'])) {
                    continue;   // already ours, or the person actually came in
                }
                if ($row) {
                    $db->execute(
                        'UPDATE ssms_staff_attendance SET prev_status = status, status = \'L\', leave_application_id = ?, leave_half = ?,
                                method = \'leave\', modified = ? WHERE id = ?',
                        [$applicationId, $half, $now, $row['id']]
                    );
                } else {
                    $db->execute(
                        'INSERT INTO ssms_staff_attendance (ssms_client_code, staff_id, att_date, status, method, leave_application_id,
                                leave_half, marked_by, created, modified)
                         VALUES (?,?,?,\'L\',\'leave\',?,?,\'leave\',?,?)',
                        [$clientCode, (int)$app['staff_id'], $date, $applicationId, $half, $now, $now]
                    );
                }
            }
        } catch (\Throwable $e) {
            Log::warning("StaffAttendance syncLeave #{$applicationId}: " . $e->getMessage());
        }
    }

    // ── Monthly report / payroll ───────────────────────────────────────────

    /**
     * Month summary per staff member.
     * payable_days = working days − absent − unpaid leave − ½ × half days
     * (days not marked are counted as worked, but listed so the office can fix them).
     */
    public static function month(string $clientCode, string $ym, ?int $onlyStaff = null): array
    {
        if (!preg_match('/^\d{4}-\d{2}$/', $ym)) {
            throw new \InvalidArgumentException('Choose a month.');
        }
        $from  = $ym . '-01';
        $to    = date('Y-m-t', strtotime($from));
        $today = date('Y-m-d', self::time());
        $cal   = StudentLeave::schoolDays($clientCode, $from, $to);
        $work  = $cal['days'];
        $isWork = array_flip($work);
        $past  = array_values(array_filter($work, fn($d) => $d <= $today));

        $rows = self::db()->execute(
            "SELECT a.*, COALESCE(lt.is_paid, 1) AS leave_paid, lt.name AS leave_type, lt.abbreviation AS leave_abbr
               FROM ssms_staff_attendance a
          LEFT JOIN ssms_leave_applications la ON la.id = a.leave_application_id
          LEFT JOIN ssms_leave_types lt ON lt.id = la.leave_type_id
              WHERE a.ssms_client_code = ? AND a.att_date BETWEEN ? AND ?" . ($onlyStaff ? ' AND a.staff_id = ?' : ''),
            $onlyStaff ? [$clientCode, $from, $to, $onlyStaff] : [$clientCode, $from, $to]
        )->fetchAll('assoc');
        $by = [];
        foreach ($rows as $r) {
            $by[(int)$r['staff_id']][(string)$r['att_date']] = $r;
        }
        $staff = self::staffList($clientCode);
        if ($onlyStaff) {
            $staff = array_values(array_filter($staff, fn($s) => (int)$s['staff_id'] === $onlyStaff));
        }
        $out = [];
        foreach ($staff as $s) {
            $sid = (int)$s['staff_id'];
            $c   = ['present' => 0, 'late' => 0, 'half_days' => 0, 'leave_paid' => 0.0, 'leave_unpaid' => 0.0,
                    'absent' => 0, 'holiday' => 0, 'not_marked' => 0, 'late_minutes' => 0];
            $days = [];
            foreach ($by[$sid] ?? [] as $d => $r) {
                if (!isset($isWork[$d])) {
                    continue;   // weekly off / holiday – not a working day
                }
                $days[$d] = ['status' => $r['status'], 'check_in' => $r['check_in'] ? substr((string)$r['check_in'], 0, 5) : null,
                             'check_out' => $r['check_out'] ? substr((string)$r['check_out'], 0, 5) : null,
                             'late_minutes' => (int)$r['late_minutes'], 'leave_type' => $r['leave_type'], 'half' => (int)$r['leave_half'] === 1];
                switch ($r['status']) {
                    case 'P':
                        $c['present']++;
                        if ((int)$r['late_minutes'] > 0) {
                            $c['late']++;
                            $c['late_minutes'] += (int)$r['late_minutes'];
                        }
                        break;
                    case 'HD':
                        $c['half_days']++;
                        break;
                    case 'L':
                        $amt  = (int)$r['leave_half'] === 1 ? 0.5 : 1.0;
                        $paid = self::leavePaid($r);
                        $c[$paid ? 'leave_paid' : 'leave_unpaid'] += $amt;
                        if ($amt < 1) {
                            $c['present']++;   // came for the other half
                        }
                        break;
                    case 'A':
                        $c['absent']++;
                        break;
                    case 'H':
                        $c['holiday']++;
                        break;
                }
            }
            foreach ($past as $d) {
                if (!isset($days[$d])) {
                    $c['not_marked']++;
                }
            }
            $W = count($work);
            $c['working_days'] = $W;
            $c['payable_days'] = max(0, round($W - $c['absent'] - $c['leave_unpaid'] - 0.5 * $c['half_days'], 1));
            $out[] = ['staff_id' => $sid, 'staff_name' => $s['staff_name']] + $c + ['days' => $days];
        }

        return [
            'month'        => $ym,
            'working_days' => count($work),
            'days_so_far'  => count($past),
            'off_days'     => $cal['skipped'],
            'staff'        => $out,
        ];
    }

    /** staff_id => payable days (for payroll) + working days. */
    public static function payrollDays(string $clientCode, string $ym): array
    {
        $m   = self::month($clientCode, $ym);
        $map = [];
        foreach ($m['staff'] as $s) {
            $map[$s['staff_id']] = $s['payable_days'];
        }

        return ['working_days' => $m['working_days'], 'payable' => $map];
    }

    // ── Reminder: "you haven't checked in yet" ─────────────────────────────

    /**
     * Push a reminder to staff who have not checked in by school start + grace.
     * Sent once per person per day, only on school days, only within REMIND_WINDOW minutes
     * after the due time, and not to anyone already marked (leave, absent, …) or on approved leave.
     * Safe to call often (office screen, app opens, scheduled task). Returns how many people were reminded.
     */
    public static function remindNotCheckedIn(string $clientCode): int
    {
        try {
            $set = self::settings($clientCode);
            if (!$set['remind_staff'] || !$set['self_checkin']) {
                return 0;
            }
            $t    = self::time();
            $date = date('Y-m-d', $t);
            $due  = strtotime($date . ' ' . $set['school_start'] . ':00') + 60 * $set['late_grace_minutes'];
            if ($t < $due || $t > $due + 60 * self::REMIND_WINDOW) {
                return 0;
            }
            if (count(StudentLeave::schoolDays($clientCode, $date, $date)['days']) !== 1) {
                return 0;   // weekend / holiday
            }
            $rows = self::db()->execute(
                "SELECT s.staff_id, s.first_name, p.push_token
                   FROM ssms_staff s
                   JOIN sawera_ssms_users u ON u.staff_id = s.staff_id AND u.ssms_client_code = s.ssms_client_code
                   JOIN ssms_user_presence p ON p.username = u.ssms_user_name AND p.client_code = s.ssms_client_code
                  WHERE s.ssms_client_code = ?
                    AND s.hired IN ('Y','Yes','yes','1')
                    AND (s.resigned IS NULL OR TRIM(s.resigned) = '' OR LOWER(TRIM(s.resigned)) IN ('n','no','0'))
                    AND p.push_token IS NOT NULL AND p.push_token <> ''
                    AND NOT EXISTS (SELECT 1 FROM ssms_staff_attendance a
                                     WHERE a.ssms_client_code = s.ssms_client_code AND a.staff_id = s.staff_id AND a.att_date = ?)
                    AND NOT EXISTS (SELECT 1 FROM ssms_leave_applications la
                                     WHERE la.staff_id = s.staff_id AND la.status = 'approved' AND ? BETWEEN la.from_date AND la.to_date)
                    AND NOT EXISTS (SELECT 1 FROM ssms_staff_checkin_reminders r
                                     WHERE r.ssms_client_code = s.ssms_client_code AND r.staff_id = s.staff_id AND r.rem_date = ?)",
                [$clientCode, $date, $date, $date]
            )->fetchAll('assoc');
            $by = [];
            foreach ($rows as $r) {
                $by[(int)$r['staff_id']]['name']     = $r['first_name'];
                $by[(int)$r['staff_id']]['tokens'][] = $r['push_token'];
            }
            $msgs = [];
            $n    = 0;
            foreach ($by as $sid => $x) {
                // claim the reminder first, so two requests at the same moment don't both send it
                $claimed = self::db()->execute(
                    'INSERT IGNORE INTO ssms_staff_checkin_reminders (ssms_client_code, staff_id, rem_date, sent_at) VALUES (?,?,?,?)',
                    [$clientCode, $sid, $date, date('Y-m-d H:i:s', $t)]
                )->rowCount();
                if ($claimed < 1) {
                    continue;
                }
                $n++;
                foreach (array_unique($x['tokens']) as $tok) {
                    // in the language of the person signed in on that phone
                    $msgs[] = Locale::withLang(Locale::langForToken($clientCode, $tok), fn() => [
                        'to'    => $tok, 'sound' => 'default',
                        'title' => Locale::t($clientCode, "You haven't checked in yet"),
                        'body'  => Locale::t($clientCode, 'Hi {name}, school started at {time}. Open the app to check in – ignore this if you are off today.',
                                   ['name' => trim((string)$x['name']), 'time' => Locale::time($clientCode, (string)$set['school_start'])]),
                        'data'  => ['screen' => 'MyCheckIn'],
                    ]);
                }
            }
            self::send($msgs);

            return $n;
        } catch (\Throwable $e) {
            Log::warning("StaffAttendance remind {$clientCode}: " . $e->getMessage());

            return 0;
        }
    }

    /** All schools that turned reminders on (for the scheduled task). → [client_code => reminded] */
    public static function remindAll(): array
    {
        $out = [];
        try {
            $codes = self::db()->execute(
                'SELECT ssms_client_code FROM ssms_staff_attendance_settings WHERE remind_staff = 1'
            )->fetchAll('assoc');
        } catch (\Throwable $e) {
            return $out;
        }
        foreach ($codes as $c) {
            $out[$c['ssms_client_code']] = self::remindNotCheckedIn((string)$c['ssms_client_code']);
        }

        return $out;
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
            foreach (array_chunk($messages, 100) as $chunk) {   // Expo accepts up to 100 per request
                $ch = curl_init('https://exp.host/--/api/v2/push/send');
                curl_setopt_array($ch, [
                    CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($chunk), CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 5,
                    CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
                ]);
                curl_exec($ch);
                curl_close($ch);
            }
        } catch (\Throwable $e) {
            Log::warning('StaffAttendance push: ' . $e->getMessage());
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static function niceDistance(int $m): string
    {
        return $m >= 1000 ? round($m / 1000, 1) . ' km' : $m . ' m';
    }

    /** Leave type is unpaid when marked so, or named like "Leave without pay" / LWP / LOP. */
    private static function leavePaid(array $r): bool
    {
        if ((int)($r['leave_paid'] ?? 1) === 0) {
            return false;
        }
        $n = strtolower((string)($r['leave_type'] ?? '') . ' ' . (string)($r['leave_abbr'] ?? ''));

        return !preg_match('/without pay|unpaid|loss of pay|\blwp\b|\blop\b/', $n);
    }

    public static function row(string $clientCode, int $staffId, string $date): ?array
    {
        $r = self::db()->execute(
            'SELECT * FROM ssms_staff_attendance WHERE ssms_client_code = ? AND staff_id = ? AND att_date = ? LIMIT 1',
            [$clientCode, $staffId, $date]
        )->fetch('assoc');

        return $r ? self::cast($r) : null;
    }

    public static function myMonth(string $clientCode, int $staffId, string $ym): array
    {
        $m = self::month($clientCode, $ym, $staffId);

        return ['summary' => $m['staff'][0] ?? null, 'working_days' => $m['working_days'], 'off_days' => $m['off_days']];
    }

    private static function cast(array $r): array
    {
        $r['id']           = (int)$r['id'];
        $r['staff_id']     = (int)$r['staff_id'];
        $r['late_minutes'] = (int)$r['late_minutes'];
        $r['leave_half']   = (int)$r['leave_half'];
        $r['leave_application_id'] = $r['leave_application_id'] !== null ? (int)$r['leave_application_id'] : null;
        if (array_key_exists('distance_m', $r)) {
            $r['distance_m'] = $r['distance_m'] !== null ? (int)$r['distance_m'] : null;
        }
        foreach (['check_in', 'check_out'] as $k) {
            $r[$k] = $r[$k] ? substr((string)$r[$k], 0, 5) : null;
        }

        return $r;
    }

    private static function hhmm($v): ?string
    {
        $v = trim((string)$v);

        return preg_match('/^(\d{1,2}):(\d{2})$/', $v, $m) && (int)$m[1] < 24 && (int)$m[2] < 60
            ? sprintf('%02d:%02d:00', $m[1], $m[2]) : null;
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
