<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Parent absence notes, student leave, late arrivals and early pickups.
 *
 * Parents (or students) send a request: absence (today / past – "absence note"),
 * leave (planned days off), late arrival or early pickup. Teachers / admins
 * approve or reject it. Approved leave shows on the attendance screen; late
 * arrivals and early pickups are recorded by staff when they happen
 * (a late arrival also marks the day's attendance as "L").
 */
class StudentLeave
{
    public const TYPES      = ['absence', 'leave', 'late_arrival', 'early_pickup'];
    public const REASONS    = ['Sick', 'Medical appointment', 'Family', 'Travel', 'Religious / cultural', 'Other'];
    public const ADMINS     = ['owner', 'admin', 'principal'];
    public const FINAL      = ['owner', 'principal'];   // second-level approvers for long leave
    public const DEFAULT_PRINCIPAL_DAYS = 3;            // leave longer than this needs principal / owner too
    public const STAFF      = ['owner', 'admin', 'principal', 'user', 'teacher', 'staff'];
    public const MAX_DAYS   = 60;   // longest single leave request
    public const PAST_DAYS  = 30;   // absence notes up to 30 days after the fact

    /** Push sender (overridable in tests): fn(array $messages): void */
    public static $push = null;

    // ── Who is the child? ───────────────────────────────────────────────────

    /** Enrollment IDs a student / parent may act for. */
    public static function myEnrollmentIds(string $clientCode, string $role, string $user, ?string $jwtEnrollment): array
    {
        if ($role === 'student') {
            $eid = trim((string)($jwtEnrollment ?: $user));

            return $eid !== '' && self::enrollment($clientCode, $eid) ? [$eid] : [];
        }
        if ($role !== 'parent') {
            return [];
        }
        $row = self::db()->execute(
            'SELECT mobile_number FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$user, $clientCode]
        )->fetch('assoc');
        $mobile = substr(preg_replace('/\D/', '', (string)($row['mobile_number'] ?? '') ?: $user), -10);
        if (strlen($mobile) < 6) {
            return [];
        }
        // last 10 digits of the admission-form mobile, however it was typed (same as the portal's child list)
        $rows = self::db()->execute(
            "SELECT e.enrollment_id, r.mobile_number FROM ssms_student_enrollment e
               JOIN ssms_student_registration r ON r.registration_id = e.registration_id
              WHERE e.ssms_client_code = ? AND COALESCE(e.status, 'active') = 'active' AND TRIM(r.mobile_number) LIKE ?",
            [$clientCode, '%' . substr($mobile, -1)]
        )->fetchAll('assoc');
        $ids = [];
        foreach ($rows as $r) {
            if (substr(preg_replace('/\D/', '', (string)$r['mobile_number']), -10) === $mobile) {
                $ids[] = (string)$r['enrollment_id'];
            }
        }
        // guardians the school gave app sign-in (Student record › Guardians)
        foreach (StudentRecord::guardianEnrollments($clientCode, $mobile) as $eid) {
            $ids[] = $eid;
        }

        return array_values(array_unique($ids));
    }

    public static function enrollment(string $clientCode, string $enrollmentId): ?array
    {
        $row = self::db()->execute(
            "SELECT e.enrollment_id, e.roll_number, e.class_id, e.section_id, e.session_id, e.branch_id,
                    TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) AS student_name,
                    c.class_name, sec.section_name
               FROM ssms_student_enrollment e
               JOIN ssms_student_registration r ON r.registration_id = e.registration_id
          LEFT JOIN ssms_classes  c   ON c.class_id     = e.class_id
          LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
              WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1",
            [$enrollmentId, $clientCode]
        )->fetch('assoc');

        return $row ?: null;
    }

    // ── Settings ────────────────────────────────────────────────────────────

    /** Leave/absence longer than this many days also needs principal or owner approval (0 = never). */
    public static function principalDays(string $clientCode): int
    {
        try {
            $r = self::db()->execute(
                'SELECT principal_days FROM ssms_student_leave_settings WHERE ssms_client_code = ? LIMIT 1',
                [$clientCode]
            )->fetch('assoc');
            if ($r) {
                return max(0, (int)$r['principal_days']);
            }
        } catch (\Throwable $e) {
        }

        return self::DEFAULT_PRINCIPAL_DAYS;
    }

    public static function setPrincipalDays(string $clientCode, int $days, string $by): int
    {
        if ($days < 0 || $days > 60) {
            throw new \InvalidArgumentException('Enter a number of days between 0 and 60 (0 = teacher approval is enough).');
        }
        self::db()->execute(
            'INSERT INTO ssms_student_leave_settings (ssms_client_code, principal_days, updated_by, modified) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE principal_days = VALUES(principal_days), updated_by = VALUES(updated_by), modified = VALUES(modified)',
            [$clientCode, $days, mb_substr($by, 0, 100), date('Y-m-d H:i:s')]
        );

        return $days;
    }

    /** Does this request need the second (principal / owner) approval? */
    public static function needsFinal(string $type, int $days, int $threshold): bool
    {
        return $threshold > 0 && in_array($type, ['absence', 'leave'], true) && $days > $threshold;
    }

    // ── Requests ────────────────────────────────────────────────────────────

    /**
     * Create a request. Staff-created requests (e.g. a parent phoned the office) are approved straight away.
     * $d = { enrollment_id, request_type, from_date, to_date?, time_at?, reason_category?, reason?, pickup_person? }
     */
    /** Validate + normalise a request (shared by submit and update). */
    private static function validateInput(string $clientCode, array $d, string $role, string $today, int $excludeId = 0): array
    {
        $today = $today ?? Locale::today($clientCode);
        $eid   = trim((string)($d['enrollment_id'] ?? ''));
        $stu   = $eid !== '' ? self::enrollment($clientCode, $eid) : null;
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }
        $type = (string)($d['request_type'] ?? '');
        if (!in_array($type, self::TYPES, true)) {
            throw new \InvalidArgumentException('Choose what the request is for.');
        }
        $from = self::date((string)($d['from_date'] ?? ''));
        if (!$from) {
            throw new \InvalidArgumentException('Please choose a date.');
        }
        $to = in_array($type, ['absence', 'leave'], true) ? (self::date((string)($d['to_date'] ?? '')) ?: $from) : $from;
        if ($to < $from) {
            throw new \InvalidArgumentException('The end date is before the start date.');
        }
        $days = (int)((strtotime($to) - strtotime($from)) / 86400) + 1;
        if ($days > self::MAX_DAYS) {
            throw new \InvalidArgumentException('A request can cover at most ' . self::MAX_DAYS . ' days.');
        }
        $staff = in_array($role, self::STAFF, true);
        if (!$staff && $from < date('Y-m-d', strtotime($today . ' -' . self::PAST_DAYS . ' days'))) {
            throw new \InvalidArgumentException('Absence notes can be sent up to ' . self::PAST_DAYS . ' days after the absence.');
        }
        if (!$staff && in_array($type, ['leave', 'late_arrival', 'early_pickup'], true) && $from < $today) {
            throw new \InvalidArgumentException('That date has passed – please send an absence note instead.');
        }
        // Only real school days count (weekly off days from School Settings and holidays are skipped).
        $schoolDays = in_array($type, ['absence', 'leave'], true)
            ? count(self::schoolDays($clientCode, $from, $to, (int)$stu['class_id'])['days'])
            : 1;
        if ($schoolDays === 0) {
            throw new \InvalidArgumentException('These dates are all weekly off days or holidays – no leave is needed.');
        }
        $time = null;
        if (in_array($type, ['late_arrival', 'early_pickup'], true)) {
            $time = self::time((string)($d['time_at'] ?? ''));
            if (!$time) {
                throw new \InvalidArgumentException($type === 'late_arrival' ? 'Please enter the expected arrival time.' : 'Please enter the pickup time.');
            }
        }
        $pickup = mb_substr(trim((string)($d['pickup_person'] ?? '')), 0, 100);
        if ($type === 'early_pickup' && $pickup === '') {
            throw new \InvalidArgumentException('Please say who will collect the child.');
        }
        $cat    = in_array($d['reason_category'] ?? '', self::REASONS, true) ? $d['reason_category'] : 'Other';
        $reason = mb_substr(trim((string)($d['reason'] ?? '')), 0, 1000);
        if ($cat === 'Other' && $reason === '') {
            throw new \InvalidArgumentException('Please add a short reason.');
        }
        // Same child, same type, overlapping dates, still open → duplicate
        $dup = self::db()->execute(
            "SELECT id FROM ssms_student_leave_requests
              WHERE ssms_client_code = ? AND enrollment_id = ? AND request_type = ?
                AND status IN ('pending','teacher_approved','approved') AND from_date <= ? AND to_date >= ? AND id <> ? LIMIT 1",
            [$clientCode, $eid, $type, $to, $from, $excludeId]
        )->fetch('assoc');
        if ($dup) {
            throw new \DomainException('There is already a request for these dates.');
        }

        return compact('eid', 'stu', 'type', 'from', 'to', 'days', 'schoolDays', 'time', 'cat', 'reason', 'pickup', 'staff');
    }

    public static function submit(string $clientCode, array $d, string $by, string $role, ?string $today = null): array
    {
        $today = $today ?? Locale::today($clientCode);
        extract(self::validateInput($clientCode, $d, $role, $today));
        $now       = date('Y-m-d H:i:s');
        $needFinal = self::needsFinal($type, $schoolDays, self::principalDays($clientCode));
        $isFinal   = in_array($role, self::FINAL, true);
        // Parents → pending. Staff entry → approved, except a long leave entered by a teacher/admin,
        // which still needs the principal or owner (first level counts as done).
        $status = !$staff ? 'pending' : (($needFinal && !$isFinal) ? 'teacher_approved' : 'approved');
        $who    = mb_substr($by, 0, 100);
        $db     = self::db();
        $db->execute(
            'INSERT INTO ssms_student_leave_requests
                (ssms_client_code, enrollment_id, class_id, section_id, session_id, request_type, from_date, to_date,
                 time_at, reason_category, reason, pickup_person, status, needs_final, school_days, submitted_by, submitted_role,
                 first_approved_by, first_approved_at, reviewed_by, reviewed_at, created, modified)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$clientCode, $eid, $stu['class_id'], $stu['section_id'], $stu['session_id'], $type, $from, $to,
             $time, $cat, $reason ?: null, $pickup ?: null, $status, $needFinal ? 1 : 0, $schoolDays, $who, mb_substr($role, 0, 20),
             $staff ? $who : null, $staff ? $now : null,
             $status === 'approved' ? $who : null, $status === 'approved' ? $now : null, $now, $now]
        );
        $id  = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetch('assoc')['id'];
        $req = self::get($clientCode, $id);
        if (!$staff) {
            self::notifyStaff($clientCode, $req);
        } elseif ($status === 'teacher_approved') {
            self::notifyFinal($clientCode, $req);
        }
        self::syncAttendance($clientCode, $id);
        $req = self::get($clientCode, $id);

        return $req;
    }

    public static function get(string $clientCode, int $id): ?array
    {
        $rows = self::list($clientCode, ['id' => $id]);

        return $rows[0] ?? null;
    }

    /**
     * Filters: id, status, enrollment_ids[], class_id, section_id, date (covers), from, to, scope (teacher scope rows)
     */
    public static function list(string $clientCode, array $f = []): array
    {
        $sql = "SELECT q.*, TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) AS student_name,
                       e.roll_number, c.class_name, sec.section_name
                  FROM ssms_student_leave_requests q
             LEFT JOIN ssms_student_enrollment e ON e.enrollment_id = q.enrollment_id AND e.ssms_client_code = q.ssms_client_code
             LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id
             LEFT JOIN ssms_classes  c   ON c.class_id     = q.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = q.section_id
                 WHERE q.ssms_client_code = ?";
        $p = [$clientCode];
        if (!empty($f['id'])) {
            $sql .= ' AND q.id = ?';
            $p[]  = (int)$f['id'];
        }
        if (!empty($f['status']) && $f['status'] !== 'all') {
            if ($f['status'] === 'open') {          // waiting for anyone: teacher or principal/owner
                $sql .= " AND q.status IN ('pending','teacher_approved')";
            } else {
                $sql .= ' AND q.status = ?';
                $p[]  = (string)$f['status'];
            }
        }
        if (array_key_exists('enrollment_ids', $f)) {
            if (!$f['enrollment_ids']) {
                return [];
            }
            $sql .= ' AND q.enrollment_id IN (' . implode(',', array_fill(0, count($f['enrollment_ids']), '?')) . ')';
            array_push($p, ...array_values($f['enrollment_ids']));
        }
        if (!empty($f['class_id'])) {
            $sql .= ' AND q.class_id = ?';
            $p[]  = (int)$f['class_id'];
        }
        if (!empty($f['section_id'])) {
            $sql .= ' AND q.section_id = ?';
            $p[]  = (int)$f['section_id'];
        }
        if (!empty($f['date'])) {
            $sql .= ' AND q.from_date <= ? AND q.to_date >= ?';
            $p[]  = $f['date'];
            $p[]  = $f['date'];
        }
        if (!empty($f['scope'])) {   // teacher: only own classes/sections
            $or = [];
            foreach ($f['scope'] as $s) {
                if ($s['section_id']) {
                    $or[] = '(q.class_id = ? AND q.section_id = ?)';
                    $p[]  = (int)$s['class_id'];
                    $p[]  = (int)$s['section_id'];
                } else {
                    $or[] = 'q.class_id = ?';
                    $p[]  = (int)$s['class_id'];
                }
            }
            $sql .= ' AND (' . implode(' OR ', $or) . ')';
        }
        $sql .= " ORDER BY (q.status IN ('pending','teacher_approved')) DESC, q.from_date DESC, q.id DESC LIMIT " . (int)($f['limit'] ?? 200);
        $rows = self::db()->execute($sql, $p)->fetchAll('assoc');

        return array_map([self::class, 'cast'], $rows);
    }

    /**
     * Approve / reject. Long leave (needs_final) goes pending → teacher_approved → approved:
     * a teacher/admin approval is the first level; the principal or owner gives the final one
     * (if they approve a pending long leave directly, both levels are done at once).
     */
    public static function review(string $clientCode, int $id, string $decision, string $by, ?string $note, string $role = 'owner'): array
    {
        $req = self::get($clientCode, $id);
        if (!$req) {
            throw new \DomainException('Request not found.');
        }
        if (!in_array($decision, ['approved', 'rejected'], true)) {
            throw new \InvalidArgumentException('Unknown decision.');
        }
        if ($req['status'] === 'cancelled') {
            throw new \DomainException('The parent has cancelled this request.');
        }
        if (!in_array($req['status'], ['pending', 'teacher_approved'], true)) {
            throw new \DomainException('This request has already been decided.');
        }
        $isFinal = in_array($role, self::FINAL, true);
        if ($req['status'] === 'teacher_approved' && !$isFinal) {
            throw new \DomainException('Already approved by a teacher – now waiting for the principal or owner.');
        }
        $now  = date('Y-m-d H:i:s');
        $who  = mb_substr($by, 0, 100);
        $note = $note !== null && trim($note) !== '' ? mb_substr(trim($note), 0, 255) : null;
        $db   = self::db();

        if ($decision === 'approved' && $req['needs_final'] && !$isFinal) {
            // first level only
            $db->execute(
                "UPDATE ssms_student_leave_requests SET status = 'teacher_approved', first_approved_by = ?, first_approved_at = ?,
                        first_note = ?, modified = ? WHERE id = ?",
                [$who, $now, $note, $now, $id]
            );
            $req = self::get($clientCode, $id);
            self::notifyFinal($clientCode, $req);

            return $req;
        }
        $db->execute(
            'UPDATE ssms_student_leave_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, modified = ?,
                    first_approved_by = COALESCE(first_approved_by, IF(? = \'approved\', ?, NULL)),
                    first_approved_at = COALESCE(first_approved_at, IF(? = \'approved\', ?, NULL))
              WHERE id = ?',
            [$decision, $who, $now, $note, $now, $decision, $who, $decision, $now, $id]
        );
        self::syncAttendance($clientCode, $id);
        $req = self::get($clientCode, $id);
        self::notifySubmitter($clientCode, $req);

        return $req;
    }

    /** Parent cancels: any pending request, or an approved one that hasn't started yet. */
    public static function cancel(string $clientCode, int $id, array $allowedEnrollments, ?string $today = null): array
    {
        $today = $today ?? Locale::today($clientCode);
        $req   = self::get($clientCode, $id);
        if (!$req || !in_array($req['enrollment_id'], $allowedEnrollments, true)) {
            throw new \DomainException('Request not found.');
        }
        if (!(in_array($req['status'], ['pending', 'teacher_approved'], true) || ($req['status'] === 'approved' && $req['from_date'] > $today))) {
            throw new \DomainException('This request can no longer be cancelled.');
        }
        self::db()->execute(
            "UPDATE ssms_student_leave_requests SET status = 'cancelled', modified = ? WHERE id = ?",
            [date('Y-m-d H:i:s'), $id]
        );
        self::syncAttendance($clientCode, $id);

        return self::get($clientCode, $id);
    }

    /** Staff cancel any request that is still active (even an approved leave already under way). */
    public static function staffCancel(string $clientCode, int $id, string $by, ?string $note = null, array $scope = []): array
    {
        $req = $scope ? (self::list($clientCode, ['id' => $id, 'scope' => $scope, 'status' => 'all'])[0] ?? null) : self::get($clientCode, $id);
        if (!$req) {
            throw new \DomainException('Request not found.');
        }
        if (in_array($req['status'], ['cancelled', 'rejected'], true)) {
            throw new \DomainException('This request is already closed.');
        }
        $now = date('Y-m-d H:i:s');
        self::db()->execute(
            "UPDATE ssms_student_leave_requests SET status = 'cancelled', reviewed_by = ?, reviewed_at = ?,
                    review_note = COALESCE(?, review_note), modified = ? WHERE id = ?",
            [mb_substr($by, 0, 100), $now, $note !== null && trim($note) !== '' ? mb_substr(trim($note), 0, 255) : null, $now, $id]
        );
        self::syncAttendance($clientCode, $id);
        $req = self::get($clientCode, $id);
        self::notifySubmitter($clientCode, $req);

        return $req;
    }

    /**
     * Edit a request (dates, times, reason …). The student cannot change.
     *  - Parent: only while pending / waiting for principal → goes back to pending for a fresh approval.
     *  - Staff: any active request; an approved leave stays approved (attendance is re-synced),
     *    unless it now needs the principal/owner and the editor is not one.
     * $allowed = enrollments the parent may edit (null for staff).
     */
    public static function update(string $clientCode, int $id, array $d, string $by, string $role, ?array $allowed = null, ?string $today = null): array
    {
        $today = $today ?? Locale::today($clientCode);
        $req   = self::get($clientCode, $id);
        if (!$req || ($allowed !== null && !in_array($req['enrollment_id'], $allowed, true))) {
            throw new \DomainException('Request not found.');
        }
        $staff = in_array($role, self::STAFF, true);
        if (in_array($req['status'], ['cancelled', 'rejected'], true)) {
            throw new \DomainException('This request is closed – please send a new one.');
        }
        if (!$staff && !in_array($req['status'], ['pending', 'teacher_approved'], true)) {
            throw new \DomainException('This request is already approved – cancel it and send a new one, or ask the school.');
        }
        $d['enrollment_id'] = $req['enrollment_id'];
        $d['request_type']  = $d['request_type'] ?? $req['request_type'];
        // staff editing an approved past leave must not trip the parent date rules
        $v = self::validateInput($clientCode, $d, $staff ? $role : 'parent', $today, $id);

        $needFinal = self::needsFinal($v['type'], $v['schoolDays'], self::principalDays($clientCode));
        $isFinal   = in_array($role, self::FINAL, true);
        $status    = $req['status'];
        $firstBy   = $req['first_approved_by'];
        $firstAt   = $req['first_approved_at'];
        if (!$staff) {
            $status  = 'pending';      // parent changed it → approve again
            $firstBy = null;
            $firstAt = null;
        } elseif ($status === 'approved' && $needFinal && !$req['needs_final'] && !$isFinal) {
            $status  = 'teacher_approved';   // now long enough to need the principal / owner
            $firstBy = mb_substr($by, 0, 100);
            $firstAt = date('Y-m-d H:i:s');
        }
        $now = date('Y-m-d H:i:s');
        self::db()->execute(
            'UPDATE ssms_student_leave_requests SET request_type = ?, from_date = ?, to_date = ?, time_at = ?, reason_category = ?,
                    reason = ?, pickup_person = ?, status = ?, needs_final = ?, school_days = ?, first_approved_by = ?,
                    first_approved_at = ?, modified = ? WHERE id = ?',
            [$v['type'], $v['from'], $v['to'], $v['time'], $v['cat'], $v['reason'] ?: null, $v['pickup'] ?: null,
             $status, $needFinal ? 1 : 0, $v['schoolDays'], $firstBy, $firstAt, $now, $id]
        );
        self::syncAttendance($clientCode, $id);
        $req = self::get($clientCode, $id);
        if (!$staff) {
            self::notifyStaff($clientCode, $req);
        } elseif ($status === 'teacher_approved' && $req['status'] === 'teacher_approved') {
            self::notifyFinal($clientCode, $req);
        }

        return $req;
    }

    // ── Attendance sync ─────────────────────────────────────────────────────

    /**
     * Keep attendance in line with a leave/absence request:
     *  - approved  → every school day in the range is marked "L" (Leave); weekends and holidays are skipped
     *  - anything else (pending, cancelled, edited dates …) → the days this request marked go back to
     *    what they were before (or the row is removed if the request created it), unless another
     *    approved leave still covers that day.
     * Idempotent: safe to call after any change. Each changed day is remembered in ssms_student_leave_days.
     */
    public static function syncAttendance(string $clientCode, int $id): void
    {
        $req = self::get($clientCode, $id);
        if (!$req) {
            return;
        }
        try {
            self::revertDays($clientCode, $req);
            if ($req['status'] === 'approved' && in_array($req['request_type'], ['absence', 'leave'], true)) {
                self::applyDays($clientCode, $req);
            }
        } catch (\Throwable $e) {
            Log::warning("StudentLeave syncAttendance #{$id}: " . $e->getMessage());
        }
    }

    private static function applyDays(string $clientCode, array $req): void
    {
        $db       = self::db();
        $stu      = self::enrollment($clientCode, $req['enrollment_id']) ?? [];
        $now      = date('Y-m-d H:i:s');
        // weekly off days + holidays are never marked as leave
        foreach (self::schoolDays($clientCode, $req['from_date'], $req['to_date'], (int)$req['class_id'])['days'] as $date) {
            $row = $db->execute(
                'SELECT id, attendance FROM student_attendance WHERE enrollment_id = ? AND attendance_date = ? AND ssms_client_code = ? LIMIT 1',
                [$req['enrollment_id'], $date, $clientCode]
            )->fetch('assoc');
            if ($row && strtoupper((string)$row['attendance']) === 'H') {
                continue;
            }
            if ($row && strtoupper((string)$row['attendance']) === 'L') {
                continue;   // already leave (teacher or another request) – nothing to undo later
            }
            if ($row) {
                $db->execute('UPDATE student_attendance SET attendance = ?, modified = ? WHERE id = ?', ['L', $now, $row['id']]);
            } else {
                $db->execute(
                    'INSERT INTO student_attendance (enrollment_id, class_id, section_id, attendance_date, attendance,
                            ssms_client_code, branch_id, session_id, roll_number, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    [$req['enrollment_id'], $stu['class_id'] ?? $req['class_id'], $stu['section_id'] ?? $req['section_id'], $date, 'L',
                     $clientCode, $stu['branch_id'] ?? null, $stu['session_id'] ?? $req['session_id'], $stu['roll_number'] ?? null, $now, $now]
                );
            }
            $db->execute(
                'INSERT INTO ssms_student_leave_days (request_id, ssms_client_code, enrollment_id, att_date, prev_status, inserted, created)
                 VALUES (?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE prev_status = VALUES(prev_status), inserted = VALUES(inserted)',
                [$req['id'], $clientCode, $req['enrollment_id'], $date, $row ? $row['attendance'] : null, $row ? 0 : 1, $now]
            );
        }
    }

    private static function revertDays(string $clientCode, array $req): void
    {
        $db   = self::db();
        $days = $db->execute(
            'SELECT * FROM ssms_student_leave_days WHERE request_id = ? AND ssms_client_code = ?',
            [$req['id'], $clientCode]
        )->fetchAll('assoc');
        $now = date('Y-m-d H:i:s');
        foreach ($days as $d) {
            // Still covered by this request's (unchanged, approved) dates? → keep, nothing to do.
            $stillMine = $req['status'] === 'approved' && in_array($req['request_type'], ['absence', 'leave'], true)
                && $d['att_date'] >= $req['from_date'] && $d['att_date'] <= $req['to_date'];
            if ($stillMine) {
                continue;
            }
            // Another approved leave covers the day → hand the day over to it.
            $other = $db->execute(
                "SELECT id FROM ssms_student_leave_requests
                  WHERE ssms_client_code = ? AND enrollment_id = ? AND id <> ? AND status = 'approved'
                    AND request_type IN ('absence','leave') AND from_date <= ? AND to_date >= ? LIMIT 1",
                [$clientCode, $req['enrollment_id'], $req['id'], $d['att_date'], $d['att_date']]
            )->fetch('assoc');
            if ($other) {
                $db->execute('UPDATE ssms_student_leave_days SET request_id = ? WHERE id = ?', [$other['id'], $d['id']]);
                continue;
            }
            $row = $db->execute(
                'SELECT id, attendance FROM student_attendance WHERE enrollment_id = ? AND attendance_date = ? AND ssms_client_code = ? LIMIT 1',
                [$d['enrollment_id'], $d['att_date'], $clientCode]
            )->fetch('assoc');
            // Only undo if nobody has changed the day since (still "L")
            if ($row && strtoupper((string)$row['attendance']) === 'L') {
                if ((int)$d['inserted'] === 1 || $d['prev_status'] === null || $d['prev_status'] === '') {
                    $db->execute('DELETE FROM student_attendance WHERE id = ?', [$row['id']]);
                } else {
                    $db->execute('UPDATE student_attendance SET attendance = ?, modified = ? WHERE id = ?', [$d['prev_status'], $now, $row['id']]);
                }
            }
            $db->execute('DELETE FROM ssms_student_leave_days WHERE id = ?', [$d['id']]);
        }
    }

    /** @var array<string,array> per-school week settings (request cache) */
    private static array $weekCache = [];

    /**
     * Off days of the week from School Settings, ISO 1 (Mon) … 7 (Sun).
     * A day is off when it is in weekend_days, or when working_days is set and the day is not in it.
     * Defaults: working Mon–Fri, weekend Sat+Sun.
     */
    public static function offWeekdays(string $clientCode): array
    {
        if (isset(self::$weekCache[$clientCode])) {
            return self::$weekCache[$clientCode];
        }
        $working = '1,2,3,4,5';
        $weekend = '6,7';
        try {
            $r = self::db()->execute(
                'SELECT working_days, weekend_days FROM ssms_school_settings WHERE client_code = ? LIMIT 1', [$clientCode]
            )->fetch('assoc');
            if ($r) {
                $working = (string)($r['working_days'] ?? '');
                $weekend = (string)($r['weekend_days'] ?? '');
            }
        } catch (\Throwable $e) {
        }
        $parse = static fn(string $v) => array_values(array_filter(array_map('intval', explode(',', $v)), fn($n) => $n >= 1 && $n <= 7));
        $work  = $parse($working);
        $off   = $parse($weekend);
        if ($work) {
            foreach (range(1, 7) as $n) {
                if (!in_array($n, $work, true) && !in_array($n, $off, true)) {
                    $off[] = $n;
                }
            }
        }
        sort($off);

        return self::$weekCache[$clientCode] = $off;
    }

    /**
     * School days between two dates (inclusive) for a class.
     * Skips weekly off days (School Settings), school holidays (Events with type "holiday",
     * including multi-day ones) and days already marked "H" for the class.
     * → { days: ['Y-m-d', …], skipped: [{date, why: 'weekend'|'holiday', name?}] }
     */
    public static function schoolDays(string $clientCode, string $from, string $to, int $classId = 0): array
    {
        $off  = self::offWeekdays($clientCode);
        $hol  = [];
        try {
            $rows = self::db()->execute(
                "SELECT event_title, event_date, COALESCE(event_end_date, event_date) AS end_date
                   FROM ssms_school_events
                  WHERE ssms_client_code = ? AND event_type = 'holiday'
                    AND event_date <= ? AND COALESCE(event_end_date, event_date) >= ?",
                [$clientCode, $to, $from]
            )->fetchAll('assoc');
            foreach ($rows as $h) {
                for ($t = strtotime(substr($h['event_date'], 0, 10)); $t <= strtotime(substr($h['end_date'], 0, 10)); $t += 86400) {
                    $hol[date('Y-m-d', $t)] = (string)$h['event_title'];
                }
            }
        } catch (\Throwable $e) {
        }
        if ($classId > 0) {
            try {
                $rows = self::db()->execute(
                    "SELECT DISTINCT attendance_date FROM student_attendance
                      WHERE ssms_client_code = ? AND class_id = ? AND attendance_date BETWEEN ? AND ? AND UPPER(attendance) = 'H'",
                    [$clientCode, $classId, $from, $to]
                )->fetchAll('assoc');
                foreach ($rows as $r) {
                    $hol[substr((string)$r['attendance_date'], 0, 10)] = $hol[substr((string)$r['attendance_date'], 0, 10)] ?? 'Holiday';
                }
            } catch (\Throwable $e) {
            }
        }
        $days = [];
        $skip = [];
        for ($t = strtotime($from); $t <= strtotime($to); $t += 86400) {
            $d = date('Y-m-d', $t);
            if (in_array((int)date('N', $t), $off, true)) {
                $skip[] = ['date' => $d, 'why' => 'weekend'];
            } elseif (isset($hol[$d])) {
                $skip[] = ['date' => $d, 'why' => 'holiday', 'name' => $hol[$d]];
            } else {
                $days[] = $d;
            }
        }

        return ['days' => $days, 'skipped' => $skip];
    }

    /** For the request forms: how many school days a range is, and which days are skipped. */
    public static function countDays(string $clientCode, string $enrollmentId, string $from, string $to): array
    {
        $stu = self::enrollment($clientCode, $enrollmentId);
        $f   = self::date($from);
        $t   = self::date($to) ?: $f;
        if (!$stu || !$f || $t < $f || (strtotime($t) - strtotime($f)) / 86400 >= self::MAX_DAYS) {
            return ['school_days' => 0, 'calendar_days' => 0, 'skipped' => [], 'needs_principal' => false];
        }
        $c = self::schoolDays($clientCode, $f, $t, (int)$stu['class_id']);
        $n = count($c['days']);

        return [
            'school_days'     => $n,
            'calendar_days'   => (int)((strtotime($t) - strtotime($f)) / 86400) + 1,
            'skipped'         => $c['skipped'],
            'needs_principal' => self::needsFinal('leave', $n, self::principalDays($clientCode)),
            'principal_days'  => self::principalDays($clientCode),
        ];
    }

    /** For tests. */
    public static function resetCache(): void
    {
        self::$weekCache = [];
    }

    // ── Gate / office log ───────────────────────────────────────────────────

    /**
     * Record a late arrival or early pickup. Late arrival also marks the day as "L" in attendance.
     * $d = { enrollment_id, kind: late|early, date?, time, reason?, picked_up_by?, relation?, request_id? }
     */
    public static function recordArrival(string $clientCode, array $d, string $by, ?string $today = null): array
    {
        $eid = trim((string)($d['enrollment_id'] ?? ''));
        $stu = $eid !== '' ? self::enrollment($clientCode, $eid) : null;
        if (!$stu) {
            throw new \DomainException('Student not found.');
        }
        $kind = (string)($d['kind'] ?? '');
        if (!in_array($kind, ['late', 'early'], true)) {
            throw new \InvalidArgumentException('Choose late arrival or early pickup.');
        }
        $date = self::date((string)($d['date'] ?? '')) ?: ($today ?? Locale::today($clientCode));
        $time = self::time((string)($d['time'] ?? ''));
        if (!$time) {
            throw new \InvalidArgumentException('Please enter the time.');
        }
        $who = mb_substr(trim((string)($d['picked_up_by'] ?? '')), 0, 100);
        if ($kind === 'early' && $who === '') {
            throw new \InvalidArgumentException('Please enter who collected the child.');
        }
        $reqId = (int)($d['request_id'] ?? 0) ?: null;
        if (!$reqId) {   // link to the parent's approved request for that day, if any
            $r = self::db()->execute(
                "SELECT id FROM ssms_student_leave_requests
                  WHERE ssms_client_code = ? AND enrollment_id = ? AND status = 'approved'
                    AND request_type = ? AND from_date <= ? AND to_date >= ? ORDER BY id DESC LIMIT 1",
                [$clientCode, $eid, $kind === 'late' ? 'late_arrival' : 'early_pickup', $date, $date]
            )->fetch('assoc');
            $reqId = $r ? (int)$r['id'] : null;
        }
        $now = date('Y-m-d H:i:s');
        $db  = self::db();
        $db->execute(
            'INSERT INTO ssms_student_arrivals (ssms_client_code, enrollment_id, class_id, section_id, event_date, kind,
                    event_time, reason, picked_up_by, relation, request_id, recorded_by, created)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$clientCode, $eid, $stu['class_id'], $stu['section_id'], $date, $kind, $time,
             mb_substr(trim((string)($d['reason'] ?? '')), 0, 255) ?: null, $who ?: null,
             mb_substr(trim((string)($d['relation'] ?? '')), 0, 40) ?: null, $reqId, mb_substr($by, 0, 100), $now]
        );
        $id = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetch('assoc')['id'];

        if ($kind === 'late') {
            // The child is in school → Present ("L" means Leave in attendance). Only fills in a missing
            // day or turns an Absent into Present; never overrides Leave or Holiday.
            self::markAttendance($clientCode, $stu, $date, 'P', $now);
        }

        return self::arrivals($clientCode, ['id' => $id])[0] ?? [];
    }

    public static function arrivals(string $clientCode, array $f = []): array
    {
        $sql = "SELECT a.*, TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) AS student_name,
                       e.roll_number, c.class_name, sec.section_name
                  FROM ssms_student_arrivals a
             LEFT JOIN ssms_student_enrollment e ON e.enrollment_id = a.enrollment_id AND e.ssms_client_code = a.ssms_client_code
             LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id
             LEFT JOIN ssms_classes  c   ON c.class_id     = a.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = a.section_id
                 WHERE a.ssms_client_code = ?";
        $p = [$clientCode];
        if (empty($f['id']) && empty($f['kind'])) {
            $sql .= " AND a.kind <> 'pickup'";   // after-school hand-overs at the gate (Safety) are not late / early events
        }
        foreach (['id' => 'a.id', 'date' => 'a.event_date', 'class_id' => 'a.class_id', 'section_id' => 'a.section_id', 'kind' => 'a.kind'] as $k => $col) {
            if (!empty($f[$k])) {
                $sql .= " AND $col = ?";
                $p[]  = $f[$k];
            }
        }
        if (array_key_exists('enrollment_ids', $f)) {
            if (!$f['enrollment_ids']) {
                return [];
            }
            $sql .= ' AND a.enrollment_id IN (' . implode(',', array_fill(0, count($f['enrollment_ids']), '?')) . ')';
            array_push($p, ...array_values($f['enrollment_ids']));
        }
        $rows = self::db()->execute($sql . ' ORDER BY a.event_date DESC, a.event_time DESC LIMIT 200', $p)->fetchAll('assoc');

        return array_map(static function ($r) {
            $r['id']         = (int)$r['id'];
            $r['event_time'] = substr((string)$r['event_time'], 0, 5);

            return $r;
        }, $rows);
    }

    /**
     * For the attendance screen: who is on approved leave / coming late / leaving early on a day.
     * → [enrollment_id => { leave?, late?, early?, pending? }]
     */
    public static function dayStatus(string $clientCode, int $classId, ?int $sectionId, string $date): array
    {
        $f = ['class_id' => $classId, 'date' => $date, 'status' => 'all'];
        if ($sectionId) {
            $f['section_id'] = $sectionId;
        }
        $out = [];
        foreach (self::list($clientCode, $f) as $q) {
            if (!in_array($q['status'], ['approved', 'pending', 'teacher_approved'], true)) {
                continue;
            }
            $e = $q['enrollment_id'];
            if ($q['status'] !== 'approved') {
                $out[$e]['pending'][] = ['id' => $q['id'], 'request_type' => $q['request_type'], 'time_at' => $q['time_at']];
                continue;
            }
            $key = ['absence' => 'leave', 'leave' => 'leave', 'late_arrival' => 'late', 'early_pickup' => 'early'][$q['request_type']];
            $out[$e][$key] = [
                'request_id' => $q['id'], 'type' => $q['request_type'], 'time' => $q['time_at'],
                'reason' => $q['reason_category'], 'note' => $q['reason'], 'pickup_person' => $q['pickup_person'],
                'from_date' => $q['from_date'], 'to_date' => $q['to_date'],
            ];
        }
        $af = ['date' => $date, 'class_id' => $classId];
        if ($sectionId) {
            $af['section_id'] = $sectionId;
        }
        foreach (self::arrivals($clientCode, $af) as $a) {
            $key = $a['kind'] === 'late' ? 'late' : 'early';
            $out[$a['enrollment_id']][$key] = ($out[$a['enrollment_id']][$key] ?? []) + [
                'recorded' => true, 'recorded_time' => $a['event_time'], 'picked_up_by' => $a['picked_up_by'],
            ];
        }

        return $out;
    }

    /** Teacher scope: [{class_id, section_id}] from subject-teacher assignments; [] = no limit. */
    public static function teacherScope(string $clientCode, string $role, string $user): array
    {
        if (in_array($role, self::ADMINS, true)) {
            return [];
        }
        try {
            $rows = self::db()->execute(
                'SELECT DISTINCT st.class_id, st.section_id FROM ssms_subject_teacher st
                   JOIN sawera_ssms_users u ON u.staff_id = st.staff_id AND u.ssms_client_code = st.ssms_client_code
                  WHERE u.ssms_user_name = ? AND st.ssms_client_code = ?',
                [$user, $clientCode]
            )->fetchAll('assoc');
        } catch (\Throwable $e) {
            return [];
        }

        return array_map(fn($r) => ['class_id' => (int)$r['class_id'], 'section_id' => $r['section_id'] ? (int)$r['section_id'] : null], $rows);
    }

    /** Requests waiting for this person: teachers → pending; principal/owner → pending + teacher-approved. */
    public static function pendingCount(string $clientCode, array $scope, string $role = 'user'): int
    {
        $status = in_array($role, self::FINAL, true) ? 'open' : 'pending';

        return count(self::list($clientCode, ['status' => $status, 'scope' => $scope, 'limit' => 500]));
    }

    // ── internals ────────────────────────────────────────────────────────────

    private static function markAttendance(string $clientCode, array $stu, string $date, string $status, string $now): void
    {
        try {
            $db  = self::db();
            $row = $db->execute(
                'SELECT id, attendance FROM student_attendance WHERE enrollment_id = ? AND attendance_date = ? AND ssms_client_code = ? LIMIT 1',
                [$stu['enrollment_id'], $date, $clientCode]
            )->fetch('assoc');
            if ($row) {
                if (in_array(strtoupper((string)$row['attendance']), ['A', ''], true)) {
                    $db->execute('UPDATE student_attendance SET attendance = ?, modified = ? WHERE id = ?', [$status, $now, $row['id']]);
                }
            } else {
                $db->execute(
                    'INSERT INTO student_attendance (enrollment_id, class_id, section_id, attendance_date, attendance,
                            ssms_client_code, branch_id, session_id, roll_number, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    [$stu['enrollment_id'], $stu['class_id'], $stu['section_id'], $date, $status, $clientCode,
                     $stu['branch_id'], $stu['session_id'], $stu['roll_number'], $now, $now]
                );
            }
        } catch (\Throwable $e) {
            Log::warning('StudentLeave markAttendance: ' . $e->getMessage());
        }
    }

    private static function notifyStaff(string $clientCode, array $req): void
    {
        // written per phone, in the language of the person signed in on it
        $label = fn() => Locale::t($clientCode, self::typeLabel($req['request_type']));
        $when  = fn() => $req['from_date'] === $req['to_date'] ? Locale::date($clientCode, $req['from_date'])
            : Locale::date($clientCode, $req['from_date']) . ' – ' . Locale::date($clientCode, $req['to_date']);
        try {
            $rows = self::db()->execute(
                "SELECT DISTINCT p.push_token, p.username FROM ssms_user_presence p
                   JOIN sawera_ssms_users u ON u.ssms_user_name = p.username AND u.ssms_client_code = p.client_code
                  WHERE p.client_code = ? AND p.push_token IS NOT NULL AND p.push_token <> ''
                    AND (LOWER(u.ssms_user_role) IN ('owner','admin','principal')
                         OR u.staff_id IN (SELECT st.staff_id FROM ssms_subject_teacher st
                                            WHERE st.ssms_client_code = ? AND st.class_id = ?
                                              AND (st.section_id IS NULL OR st.section_id = ?)))",
                [$clientCode, $clientCode, $req['class_id'], $req['section_id']]
            )->fetchAll('assoc');
        } catch (\Throwable $e) {
            return;
        }
        $msgs = array_map(fn($r) => Locale::withLang(Locale::langFor($clientCode, $r['username'] ?? null), fn() => [
            'to' => $r['push_token'], 'sound' => 'default',
            'title' => Locale::t($clientCode, '{type} request – {student}', ['type' => $label(), 'student' => $req['student_name']]),
            'body'  => trim($when() . ' · ' . Locale::t($clientCode, (string)$req['reason_category']) . ($req['reason'] ? ": {$req['reason']}" : '')),
            'data'  => ['screen' => 'StudentLeave'],
        ]), $rows);
        self::send($msgs);
    }

    /** Long leave approved by a teacher → tell the principal(s) and owner(s). */
    private static function notifyFinal(string $clientCode, array $req): void
    {
        try {
            $rows = self::db()->execute(
                "SELECT DISTINCT p.push_token, p.username FROM ssms_user_presence p
                   JOIN sawera_ssms_users u ON u.ssms_user_name = p.username AND u.ssms_client_code = p.client_code
                  WHERE p.client_code = ? AND p.push_token IS NOT NULL AND p.push_token <> ''
                    AND LOWER(u.ssms_user_role) IN ('owner','principal')",
                [$clientCode]
            )->fetchAll('assoc');
        } catch (\Throwable $e) {
            return;
        }
        self::send(array_map(fn($r) => Locale::withLang(Locale::langFor($clientCode, $r['username'] ?? null), fn() => [
            'to' => $r['push_token'], 'sound' => 'default',
            'title' => Locale::t($clientCode, 'Leave needs your approval – {student}', ['student' => $req['student_name']]),
            'body'  => Locale::t($clientCode, '{days} school days ({from} – {to}) · approved by {name}', ['days' => $req['school_days'],
                'from' => Locale::date($clientCode, $req['from_date']), 'to' => Locale::date($clientCode, $req['to_date']), 'name' => $req['first_approved_by']]),
            'data'  => ['screen' => 'StudentLeave'],
        ]), $rows));
    }

    private static function notifySubmitter(string $clientCode, array $req): void
    {
        if (empty($req['submitted_by'])) {
            return;
        }
        try {
            $row = self::db()->execute(
                'SELECT push_token FROM ssms_user_presence WHERE username = ? AND client_code = ? LIMIT 1',
                [$req['submitted_by'], $clientCode]
            )->fetch('assoc');
        } catch (\Throwable $e) {
            return;
        }
        if (empty($row['push_token'])) {
            return;
        }
        $prev = Locale::useLang(Locale::langFor($clientCode, (string)$req['submitted_by']));   // the parent's own language
        $label = Locale::t($clientCode, self::typeLabel($req['request_type']));
        $msg = [
            'to' => $row['push_token'], 'sound' => 'default',
            'title' => $req['status'] === 'approved' ? Locale::t($clientCode, '{type} request approved ✓', ['type' => $label])
                                                     : Locale::t($clientCode, '{type} request not approved', ['type' => $label]),
            'body'  => $req['student_name'] . ' · ' . Locale::date($clientCode, $req['from_date']) . ($req['review_note'] ? " – {$req['review_note']}" : ''),
            'data'  => ['screen' => 'MyAbsences'],
        ];
        Locale::endLang($prev);
        self::send([$msg]);
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
            $ch = curl_init('https://exp.host/--/api/v2/push/send');
            curl_setopt_array($ch, [
                CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($messages), CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 5,
                CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
            ]);
            curl_exec($ch);
            curl_close($ch);
        } catch (\Throwable $e) {
            Log::warning('StudentLeave push: ' . $e->getMessage());
        }
    }

    public static function typeLabel(string $t): string
    {
        return ['absence' => 'Absence', 'leave' => 'Leave', 'late_arrival' => 'Late arrival', 'early_pickup' => 'Early pickup'][$t] ?? $t;
    }

    private static function cast(array $r): array
    {
        $r['id']        = (int)$r['id'];
        $r['class_id']  = $r['class_id'] !== null ? (int)$r['class_id'] : null;
        $r['section_id'] = $r['section_id'] !== null ? (int)$r['section_id'] : null;
        $r['time_at']   = $r['time_at'] ? substr((string)$r['time_at'], 0, 5) : null;
        $r['days']      = (int)((strtotime($r['to_date']) - strtotime($r['from_date'])) / 86400) + 1;
        $r['needs_final'] = (int)($r['needs_final'] ?? 0) === 1;
        $r['school_days'] = isset($r['school_days']) && $r['school_days'] !== null ? (int)$r['school_days'] : $r['days'];

        return $r;
    }

    private static function date(string $s): ?string
    {
        $s = trim($s);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
            return null;
        }
        [$y, $m, $d] = array_map('intval', explode('-', $s));

        return checkdate($m, $d, $y) ? $s : null;
    }

    private static function time(string $s): ?string
    {
        $s = strtoupper(trim($s));
        if (preg_match('/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/', $s, $m)) {
            $h = (int)$m[1];
            if (!empty($m[3])) {
                if ($h < 1 || $h > 12) {
                    return null;
                }
                $h = $h % 12 + ($m[3] === 'PM' ? 12 : 0);
            }
            if ($h <= 23 && (int)$m[2] <= 59) {
                return sprintf('%02d:%02d:00', $h, (int)$m[2]);
            }
        }

        return null;
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
