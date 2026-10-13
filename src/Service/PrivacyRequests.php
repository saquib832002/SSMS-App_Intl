<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Data requests: copy of data (export), correction, deletion.
 *
 * - Parents (for their children), students and staff (for themselves) ask from the app; the office can
 *   log a request that came by e-mail or on paper. GDPR allows one month, so every request has a due date.
 * - Export: generated straight away → ZIP (readable summary.html + one JSON file per kind of record),
 *   kept outside the web root, downloadable for 7 days by the requester only.
 * - Deletion: an admin reviews what will be deleted and what must be kept (fees, academic records),
 *   the OWNER approves (two-step code), then a 7-day cancel window, then personal details are removed.
 *   Records the law says to keep stay, with the name replaced ("Former student #…").
 *
 * Table: ssms_privacy_requests
 */
class PrivacyRequests
{
    public const TYPES = ['export', 'correction', 'delete'];
    public const DUE_DAYS = 30;
    public const DOWNLOAD_DAYS = 7;
    public const CANCEL_DAYS = 7;
    public const ADMINS = ['owner', 'admin'];

    // ── Create ──────────────────────────────────────────────────────────────

    /**
     * $d: type, subject_type (student|staff), subject_id, details, channel (app|office), requester_name (office)
     * Requester must be allowed to ask for this person unless logged by the office (admins).
     */
    public static function create(string $client, string $user, string $role, array $d, ?string $jwtEnrollment = null): array
    {
        $type = (string)($d['type'] ?? '');
        if (!in_array($type, self::TYPES, true)) {
            throw new \InvalidArgumentException('Choose what you are asking for.');
        }
        $office = ($d['channel'] ?? 'app') === 'office';
        if ($office && !in_array($role, self::ADMINS, true)) {
            throw new \DomainException('Only the owner or an admin can log a request received by e-mail or on paper.');
        }
        [$stype, $sid] = self::subjectFor($client, $user, $role, $d, $office, $jwtEnrollment);
        $details = trim((string)($d['details'] ?? ''));
        if ($type === 'correction' && $details === '') {
            throw new \InvalidArgumentException('Tell the school what is wrong and what it should be.');
        }
        if ($type === 'export' && !$office) {
            $recent = self::db()->execute(
                "SELECT id FROM ssms_privacy_requests WHERE ssms_client_code = ? AND subject_id = ? AND type = 'export'
                   AND created > ? AND status NOT IN ('rejected','cancelled') LIMIT 1",
                [$client, $sid, date('Y-m-d H:i:s', AccountSecurity::time() - 30 * 86400)]
            )->fetch('assoc');
            if ($recent) {
                throw new \DomainException('A copy was already made in the last 30 days. You can download it from "My requests".');
            }
        }
        $open = self::db()->execute(
            "SELECT id FROM ssms_privacy_requests WHERE ssms_client_code = ? AND subject_id = ? AND type = ?
               AND status IN ('pending','in_review','scheduled') LIMIT 1", [$client, $sid, $type]
        )->fetch('assoc');
        if ($open && $type !== 'export') {
            throw new \DomainException('There is already an open request of this kind. The school will reply soon.');
        }
        $now = AccountSecurity::now();
        self::db()->execute(
            'INSERT INTO ssms_privacy_requests (ssms_client_code, type, subject_type, subject_id, subject_name, requested_by,
                    requester_name, channel, details, status, due_date, created, modified)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$client, $type, $stype, $sid, mb_substr(self::subjectName($client, $stype, $sid), 0, 150), mb_substr($user, 0, 100),
             mb_substr(trim((string)($d['requester_name'] ?? '')), 0, 150) ?: null, $office ? 'office' : 'app',
             mb_substr($details, 0, 2000) ?: null, 'pending', date('Y-m-d', AccountSecurity::time() + self::DUE_DAYS * 86400), $now, $now]
        );
        $id  = (int)self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'];
        if ($type === 'export') {
            try {
                self::generateExport($client, $id);
            } catch (\Throwable $e) {
                Log::error("Privacy export #{$id}: " . $e->getMessage());
            }
        }

        return self::get($client, $id);
    }

    /** → [subject_type, subject_id] the requester may ask about */
    private static function subjectFor(string $client, string $user, string $role, array $d, bool $office, ?string $jwtEnrollment): array
    {
        $stype = ($d['subject_type'] ?? 'student') === 'staff' ? 'staff' : 'student';
        $sid   = trim((string)($d['subject_id'] ?? ''));
        if ($office) {
            if ($sid === '' || self::subjectName($client, $stype, $sid) === '') {
                throw new \InvalidArgumentException('Choose the student or staff member the request is about.');
            }

            return [$stype, $sid];
        }
        if ($role === 'parent' || $role === 'student') {
            $mine = StudentLeave::myEnrollmentIds($client, $role, $user, $jwtEnrollment);
            if ($sid === '' && count($mine) === 1) {
                $sid = $mine[0];
            }
            if (!in_array($sid, $mine, true)) {
                throw new \DomainException('You can only ask about your own child.');
            }

            return ['student', $sid];
        }
        $staffId = self::db()->execute('SELECT staff_id FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$user, $client])->fetch('assoc')['staff_id'] ?? null;
        if (!$staffId) {
            throw new \DomainException('Your login is not linked to a staff record. Ask the office to log the request for you.');
        }

        return ['staff', (string)$staffId];
    }

    public static function subjectName(string $client, string $stype, string $sid): string
    {
        try {
            if ($stype === 'staff') {
                $r = self::db()->execute(
                    "SELECT TRIM(CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,''))) n FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?",
                    [$sid, $client])->fetch('assoc');
            } else {
                $r = self::db()->execute(
                    "SELECT TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) n
                       FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                      WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1", [$sid, $client])->fetch('assoc');
            }

            return $r ? ((string)$r['n'] ?: $sid) : '';
        } catch (\Throwable $e) {
            return '';
        }
    }

    // ── Read ────────────────────────────────────────────────────────────────

    public static function get(string $client, int $id): array
    {
        $r = self::db()->execute('SELECT * FROM ssms_privacy_requests WHERE id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Request not found.');
        }

        return self::cast($r);
    }

    public static function mine(string $client, string $user): array
    {
        return array_map([self::class, 'cast'], self::db()->execute(
            'SELECT * FROM ssms_privacy_requests WHERE ssms_client_code = ? AND requested_by = ? AND channel = ? ORDER BY id DESC LIMIT 50',
            [$client, $user, 'app']
        )->fetchAll('assoc'));
    }

    /** status: open | done | all */
    public static function list(string $client, string $status = 'open'): array
    {
        $w = $status === 'open' ? " AND status IN ('pending','in_review','scheduled','ready')"
           : ($status === 'done' ? " AND status IN ('done','rejected','cancelled','expired')" : '');

        return array_map([self::class, 'cast'], self::db()->execute(
            'SELECT * FROM ssms_privacy_requests WHERE ssms_client_code = ?' . $w . ' ORDER BY (status = \'scheduled\') DESC, due_date ASC, id DESC LIMIT 300',
            [$client]
        )->fetchAll('assoc'));
    }

    public static function openCount(string $client): int
    {
        try {
            return (int)self::db()->execute("SELECT COUNT(*) n FROM ssms_privacy_requests WHERE ssms_client_code = ? AND status IN ('pending','in_review','scheduled') AND type <> 'export'",
                [$client])->fetch('assoc')['n'];
        } catch (\Throwable $e) {
            return 0;
        }
    }

    // ── Export ──────────────────────────────────────────────────────────────

    public static function generateExport(string $client, int $id): array
    {
        $req  = self::get($client, $id);
        $data = $req['subject_type'] === 'staff' ? self::collectStaff($client, $req['subject_id'])
              : self::collectStudent($client, $req['subject_id'], self::requesterLevel($client, (string)($req['requested_by'] ?? '')));
        $dir  = self::dir();
        $base = 'export_' . $id . '_' . bin2hex(random_bytes(8));
        $name = 'Data_' . preg_replace('/[^A-Za-z0-9]+/', '_', $req['subject_name'] ?: $req['subject_id']) . '_' . date('Y-m-d', AccountSecurity::time());
        $html = self::summaryHtml($req, $data);
        if (class_exists(\ZipArchive::class)) {
            $path = $dir . $base . '.zip';
            $zip  = new \ZipArchive();
            if ($zip->open($path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
                throw new \RuntimeException('Could not create the export file.');
            }
            $zip->addFromString('summary.html', $html);
            $zip->addFromString('README.txt', "Copy of personal data held by the school, made on " . date('j M Y', AccountSecurity::time())
                . ".\nsummary.html is easy to read. The .json files hold the same records in a machine-readable form.\n");
            foreach ($data as $section => $rows) {
                $zip->addFromString(preg_replace('/[^a-z0-9_]/', '', $section) . '.json', json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR));
            }
            $zip->close();
            $fname = $name . '.zip';
        } else {
            $path = $dir . $base . '.html';
            file_put_contents($path, $html);
            $fname = $name . '.html';
        }
        self::db()->execute(
            "UPDATE ssms_privacy_requests SET status = 'ready', file_path = ?, file_name = ?, file_expires = ?, handled_at = ?, modified = ? WHERE id = ?",
            [basename($path), $fname, date('Y-m-d H:i:s', AccountSecurity::time() + self::DOWNLOAD_DAYS * 86400), AccountSecurity::now(), AccountSecurity::now(), $id]
        );

        return self::get($client, $id);
    }

    /** → [absolute path, download name] for the requester (or an admin for office-logged requests) */
    public static function downloadPath(string $client, int $id, string $user, string $role): array
    {
        $r = self::db()->execute('SELECT * FROM ssms_privacy_requests WHERE id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Request not found.');
        }
        if ($r['file_expires'] && strtotime((string)$r['file_expires']) < AccountSecurity::time()) {
            throw new \DomainException('The download link has expired. Ask for a new copy.');
        }
        $mayDownload = $r['requested_by'] === $user || ($r['channel'] === 'office' && in_array($role, self::ADMINS, true));
        if (!$mayDownload) {
            throw new \DomainException('Only the person who asked can download this copy.');
        }
        if ($r['status'] !== 'ready' || !$r['file_path']) {
            throw new \DomainException('This copy is not ready, or the download link has expired.');
        }
        $path = self::dir() . basename((string)$r['file_path']);
        if (!is_file($path)) {
            throw new \DomainException('The file has expired. Ask for a new copy.');
        }

        return [$path, (string)$r['file_name']];
    }

    /** 'student' when a student asked for their own copy, otherwise the family view ('parent'). */
    private static function requesterLevel(string $client, string $user): string
    {
        $r = self::db()->execute('SELECT ssms_user_role FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$user, $client])->fetch('assoc');

        return strtolower(trim((string)($r['ssms_user_role'] ?? ''))) === 'student' ? 'student' : 'parent';
    }

    private static function collectStudent(string $client, string $eid, string $level = 'parent'): array
    {
        $reg = self::db()->execute(
            'SELECT r.* FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
              WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1', [$eid, $client])->fetch('assoc');
        $regId = $reg['registration_id'] ?? null;
        $eids  = $regId ? array_column(self::q('SELECT enrollment_id FROM ssms_student_enrollment WHERE registration_id = ? AND ssms_client_code = ?',
            [$regId, $client]), 'enrollment_id') : [$eid];
        $eids  = $eids ?: [$eid];
        $in    = implode(',', array_fill(0, count($eids), '?'));
        $p     = array_merge($eids, [$client]);

        return array_filter([
            'profile'          => $reg ? [self::clean($reg)] : [],
            'enrollments'      => self::q("SELECT e.*, c.class_name, s.section_name FROM ssms_student_enrollment e
                                     LEFT JOIN ssms_classes c ON c.class_id = e.class_id LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                                     WHERE e.enrollment_id IN ($in) AND e.ssms_client_code = ?", $p),
            'attendance'       => self::q("SELECT attendance_date, attendance, class_id FROM student_attendance WHERE enrollment_id IN ($in) AND ssms_client_code = ? ORDER BY attendance_date", $p),
            'marks'            => self::q("SELECT m.exam_id, x.exam_name, m.subject_id, sb.subject_name, m.theory_marks, m.practical_marks, m.internal_marks, m.total_marks
                                     FROM ssms_marks m LEFT JOIN ssms_exams x ON x.exam_id = m.exam_id LEFT JOIN ssms_subjects sb ON sb.subject_id = m.subject_id
                                     WHERE m.enrollment_id IN ($in) AND m.ssms_client_code = ?", $p),
            'fees_paid'        => self::q("SELECT receipt_number, fee_paid_date, payment_date, paid_amount, fee_paid_amount, late_fee, discount_amount, balance_amount, payment_method
                                     FROM ssms_fee_paid_details WHERE enrollment_id IN ($in) AND ssms_client_code = ? ORDER BY fee_paid_date", $p),
            'discounts'        => self::q("SELECT * FROM ssms_student_discount WHERE enrollment_id IN ($in) AND ssms_client_code = ?", $p),
            'leave_and_notes'  => self::q("SELECT request_type, from_date, to_date, time_at, reason_category, reason, status, created FROM ssms_student_leave_requests
                                     WHERE enrollment_id IN ($in) AND ssms_client_code = ?", $p),
            'late_early'       => self::q("SELECT kind, event_date, event_time, reason, picked_up_by, relation FROM ssms_student_arrivals
                                     WHERE enrollment_id IN ($in) AND ssms_client_code = ?", $p),
            'report_comments'  => self::q("SELECT * FROM ssms_report_card_comments WHERE enrollment_id IN ($in) AND ssms_client_code = ?", $p),
            'hostel'           => self::q("SELECT * FROM ssms_hostel_enrollment WHERE enrollment_id IN ($in) AND ssms_client_code = ?", $p),
            'transport'        => self::q("SELECT * FROM ssms_transport_enrollment WHERE enrollment_id IN ($in) AND ssms_client_code = ?", $p),
            'app_accounts'     => self::q("SELECT ssms_user_name, ssms_user_role, ssms_user_email, mobile_number, ssms_user_status, created, last_login_date
                                     FROM sawera_ssms_users WHERE ssms_user_name IN ($in) AND ssms_client_code = ?", $p),
            'consents'         => self::q("SELECT t.title, c.version, c.granted, c.method, c.given_by, c.created FROM ssms_consents c
                                     JOIN ssms_consent_types t ON t.id = c.type_id WHERE c.subject_id IN ($in) AND c.ssms_client_code = ? ORDER BY c.id", $p),
            'meetings'         => Meetings::exportFor($client, $eids, $level),
        ] + ($regId ? StudentRecord::exportFor($client, (string)$regId, $level) : []), fn($v) => $v !== []);
    }

    private static function collectStaff(string $client, string $staffId): array
    {
        $users = self::q('SELECT ssms_user_name FROM sawera_ssms_users WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client]);
        $un    = array_column($users, 'ssms_user_name') ?: ['-'];
        $in    = implode(',', array_fill(0, count($un), '?'));

        return array_filter([
            'profile'          => array_map([self::class, 'clean'], self::q('SELECT * FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client])),
            'attendance'       => self::q('SELECT att_date, status, check_in, check_out, late_minutes, method FROM ssms_staff_attendance
                                     WHERE staff_id = ? AND ssms_client_code = ? ORDER BY att_date', [$staffId, $client]),
            'leave'            => self::q('SELECT la.from_date, la.to_date, la.days, la.reason, la.status, lt.name leave_type FROM ssms_leave_applications la
                                     LEFT JOIN ssms_leave_types lt ON lt.id = la.leave_type_id WHERE la.staff_id = ?', [$staffId]),
            'payslips'         => self::q('SELECT * FROM fin_payroll WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client]),
            'salary_structure' => self::q('SELECT * FROM fin_salary_structures WHERE staff_id = ? AND ssms_client_code = ?', [$staffId, $client]),
            'app_accounts'     => self::q("SELECT ssms_user_name, ssms_user_role, ssms_user_email, mobile_number, ssms_user_status, created, last_login_date
                                     FROM sawera_ssms_users WHERE ssms_user_name IN ($in) AND ssms_client_code = ?", array_merge($un, [$client])),
            'sign_ins'         => self::q("SELECT device, platform, app_version, created, last_seen FROM ssms_user_sessions WHERE username IN ($in) AND ssms_client_code = ?",
                                     array_merge($un, [$client])),
            'consents'         => self::q("SELECT t.title, c.version, c.granted, c.method, c.created FROM ssms_consents c
                                     JOIN ssms_consent_types t ON t.id = c.type_id WHERE c.subject_id IN ($in) AND c.ssms_client_code = ?", array_merge($un, [$client])),
        ], fn($v) => $v !== []);
    }

    private static function summaryHtml(array $req, array $data): string
    {
        $h  = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $o  = '<!doctype html><meta charset="utf-8"><title>Your data</title><style>body{font-family:Arial,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#111}'
            . 'h1{font-size:22px}h2{font-size:16px;margin-top:28px;border-bottom:2px solid #5b21b6;padding-bottom:4px}table{border-collapse:collapse;width:100%;font-size:12px}'
            . 'th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f0ff}.m{color:#666;font-size:13px}</style>';
        $o .= '<h1>Personal data: ' . $h($req['subject_name']) . '</h1><p class="m">Made on ' . $h(date('j M Y', AccountSecurity::time()))
            . ' for request #' . (int)$req['id'] . '. Each section lists the records the school holds.</p>';
        $labels = ['profile' => 'Profile', 'enrollments' => 'Classes', 'attendance' => 'Attendance', 'marks' => 'Marks', 'fees_paid' => 'Fees paid',
                   'discounts' => 'Fee discounts', 'leave_and_notes' => 'Leave & absence notes', 'late_early' => 'Late arrivals & early pickups',
                   'report_comments' => 'Report card comments', 'hostel' => 'Hostel', 'transport' => 'Transport', 'app_accounts' => 'App accounts',
                   'consents' => 'Consents', 'guardians' => 'Guardians', 'emergency_contacts' => 'Emergency contacts',
                   'medical' => 'Medical & allergies', 'documents' => 'Documents', 'custom_fields' => 'Other details', 'meetings' => 'Parent–teacher meetings', 'leave' => 'Leave', 'payslips' => 'Payslips', 'salary_structure' => 'Salary', 'sign_ins' => 'Sign-ins'];
        foreach ($data as $sec => $rows) {
            $o .= '<h2>' . $h($labels[$sec] ?? $sec) . ' (' . count($rows) . ')</h2>';
            if ($sec === 'profile') {
                $o .= '<table>';
                foreach ($rows[0] as $k => $v) {
                    if ($v !== null && $v !== '') {
                        $o .= '<tr><th>' . $h(str_replace('_', ' ', (string)$k)) . '</th><td>' . $h(is_scalar($v) ? $v : json_encode($v)) . '</td></tr>';
                    }
                }
                $o .= '</table>';
                continue;
            }
            $cols = array_keys($rows[0]);
            $o   .= '<table><tr>' . implode('', array_map(fn($c) => '<th>' . $h(str_replace('_', ' ', (string)$c)) . '</th>', $cols)) . '</tr>';
            foreach (array_slice($rows, 0, 2000) as $r) {
                $o .= '<tr>' . implode('', array_map(fn($c) => '<td>' . $h(is_scalar($r[$c] ?? '') ? ($r[$c] ?? '') : json_encode($r[$c])) . '</td>', $cols)) . '</tr>';
            }
            $o .= '</table>';
        }

        return $o;
    }

    // ── Admin handling ──────────────────────────────────────────────────────

    /** What a deletion would remove and keep (shown before approval). */
    public static function plan(string $client, int $id): array
    {
        $r   = self::get($client, $id);
        $ret = AccountSecurity::settings($client)['retention'];
        $blocker = null;
        if ($r['subject_type'] === 'student') {
            $active = self::db()->execute(
                "SELECT e2.enrollment_id FROM ssms_student_enrollment e
                   JOIN ssms_student_enrollment e2 ON e2.registration_id = e.registration_id AND e2.ssms_client_code = e.ssms_client_code
                  WHERE e.enrollment_id = ? AND e.ssms_client_code = ? AND COALESCE(e2.status,'active') = 'active' LIMIT 1",
                [$r['subject_id'], $client])->fetch('assoc');
            if ($active) {
                $blocker = 'This student is still enrolled. Mark the student as left before deleting their data.';
            }
            $delete = ['Photo, ID card and uploaded documents', 'Guardians, emergency contacts, medical & allergy details, extra fields',
                       'Phone numbers, e-mail, home address, parents\' details, birth details',
                       'App login for the student', 'Leave and absence notes, late-arrival / early-pickup records',
                       'Hostel and transport details', 'Teacher comments on report cards'];
            $keep = [
                ['what' => 'Fee receipts and payments', 'why' => 'Tax and accounting law', 'years' => $ret['fees']],
                ['what' => 'Marks, report cards and class history', 'why' => 'School record (transcripts)', 'years' => $ret['academic']],
                ['what' => 'Attendance', 'why' => 'School record', 'years' => $ret['attendance']],
                ['what' => 'Consent history', 'why' => 'Proof of what was agreed', 'years' => null],
            ];
        } else {
            $active = self::db()->execute(
                "SELECT 1 FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ? AND hired IN ('Y','Yes','yes','1')
                   AND (resigned IS NULL OR TRIM(resigned) = '' OR LOWER(TRIM(resigned)) IN ('n','no','0')) LIMIT 1",
                [$r['subject_id'], $client])->fetch('assoc');
            if ($active) {
                $blocker = 'This person still works here. Mark them as resigned before deleting their data.';
            }
            $delete = ['Photo, ID proof, address proof, experience letter', 'Phone, e-mail, address, parents\' names, birth date',
                       'App login', 'Check-in locations'];
            $keep = [
                ['what' => 'Payslips and salary records', 'why' => 'Tax and employment law', 'years' => $ret['payroll']],
                ['what' => 'Attendance and leave', 'why' => 'Employment record', 'years' => $ret['attendance']],
                ['what' => 'Consent history', 'why' => 'Proof of what was agreed', 'years' => null],
            ];
        }

        return ['request' => $r, 'will_delete' => $delete, 'will_keep' => $keep, 'blocker' => $blocker,
                'name_after' => ($r['subject_type'] === 'staff' ? 'Former staff #' : 'Former student #') . self::shortRef($r['subject_id'])];
    }

    /** Owner approves → scheduled (cancel possible for 7 days). */
    public static function approveDelete(string $client, int $id, string $by): array
    {
        $plan = self::plan($client, $id);
        if ($plan['request']['type'] !== 'delete' || !in_array($plan['request']['status'], ['pending', 'in_review'], true)) {
            throw new \DomainException('This request can\'t be approved now.');
        }
        if ($plan['blocker']) {
            throw new \DomainException($plan['blocker']);
        }
        self::db()->execute("UPDATE ssms_privacy_requests SET status = 'scheduled', delete_after = ?, handled_by = ?, handled_at = ?, modified = ? WHERE id = ?",
            [date('Y-m-d H:i:s', AccountSecurity::time() + self::CANCEL_DAYS * 86400), mb_substr($by, 0, 100), AccountSecurity::now(), AccountSecurity::now(), $id]);

        return self::get($client, $id);
    }

    /** status → in_review | done (correction) | rejected | cancelled */
    public static function setStatus(string $client, int $id, string $status, string $by, ?string $note): array
    {
        $r = self::get($client, $id);
        $allowed = [
            'in_review' => ['pending'],
            'done'      => ['pending', 'in_review'],
            'rejected'  => ['pending', 'in_review'],
            'cancelled' => ['pending', 'in_review', 'scheduled'],
        ];
        if (!isset($allowed[$status]) || !in_array($r['status'], $allowed[$status], true)) {
            throw new \DomainException('This request can\'t be changed that way now.');
        }
        if ($status === 'done' && $r['type'] === 'delete') {
            throw new \DomainException('Deletions are finished by approving them.');
        }
        if (in_array($status, ['rejected'], true) && trim((string)$note) === '') {
            throw new \InvalidArgumentException('Say why, so the person knows (e.g. the law requires keeping these records).');
        }
        self::db()->execute('UPDATE ssms_privacy_requests SET status = ?, decision_note = COALESCE(?, decision_note), handled_by = ?, handled_at = ?, modified = ? WHERE id = ?',
            [$status, $note !== null && trim($note) !== '' ? mb_substr(trim($note), 0, 1000) : null, mb_substr($by, 0, 100), AccountSecurity::now(), AccountSecurity::now(), $id]);

        return self::get($client, $id);
    }

    /** Requester withdraws their own open request. */
    public static function withdraw(string $client, int $id, string $user): array
    {
        $r = self::get($client, $id);
        if ($r['requested_by'] !== $user) {
            throw new \DomainException('You can only withdraw your own request.');
        }

        return self::setStatus($client, $id, 'cancelled', $user, 'Withdrawn by the requester');
    }

    /**
     * Housekeeping: run due deletions, expire downloads. Safe to call often.
     * → ['deleted' => n, 'expired' => n]
     */
    public static function runDue(?string $client = null): array
    {
        $out = ['deleted' => 0, 'expired' => 0];
        try {
            $rows = self::db()->execute(
                "SELECT * FROM ssms_privacy_requests WHERE status = 'scheduled' AND delete_after <= ?" . ($client ? ' AND ssms_client_code = ?' : ''),
                $client ? [AccountSecurity::now(), $client] : [AccountSecurity::now()]
            )->fetchAll('assoc');
            foreach ($rows as $r) {
                try {
                    $done = $r['subject_type'] === 'staff'
                        ? self::anonymiseStaff((string)$r['ssms_client_code'], (string)$r['subject_id'])
                        : self::anonymiseStudent((string)$r['ssms_client_code'], (string)$r['subject_id']);
                    self::db()->execute("UPDATE ssms_privacy_requests SET status = 'done', subject_name = ?, decision_note = ?, modified = ? WHERE id = ?",
                        [($r['subject_type'] === 'staff' ? 'Former staff #' : 'Former student #') . self::shortRef((string)$r['subject_id']), mb_substr('Deleted: ' . implode(', ', $done), 0, 1000), AccountSecurity::now(), $r['id']]);
                    Audit::log((string)$r['ssms_client_code'], 'privacy.deletion_done', ['category' => 'privacy', 'actor' => 'system',
                        'entity_type' => $r['subject_type'], 'entity_id' => self::shortRef((string)$r['subject_id']),
                        'summary' => 'Personal data deleted (request #' . $r['id'] . ')', 'changes' => ['removed' => $done]]);
                    $out['deleted']++;
                } catch (\Throwable $e) {
                    Log::error('Privacy deletion #' . $r['id'] . ': ' . $e->getMessage());
                }
            }
            $exp = self::db()->execute(
                "SELECT id, file_path FROM ssms_privacy_requests WHERE status = 'ready' AND file_expires < ?" . ($client ? ' AND ssms_client_code = ?' : ''),
                $client ? [AccountSecurity::now(), $client] : [AccountSecurity::now()]
            )->fetchAll('assoc');
            foreach ($exp as $e) {
                $p = self::dir() . basename((string)$e['file_path']);
                if (is_file($p)) {
                    @unlink($p);
                }
                self::db()->execute("UPDATE ssms_privacy_requests SET status = 'expired', file_path = NULL, modified = ? WHERE id = ?", [AccountSecurity::now(), $e['id']]);
                $out['expired']++;
            }
        } catch (\Throwable $e) {
            Log::warning('PrivacyRequests runDue: ' . $e->getMessage());
        }

        return $out;
    }

    // ── Anonymisers ─────────────────────────────────────────────────────────

    private const STUDENT_PERSONAL = [
        'student_middle_name', 'email_address', 'mobile_number', 'student_dob', 'student_birth_place', 'student_nationality',
        'student_physically_challenged', 'previous_school', 'student_c_address_line_1', 'student_c_address_line_2', 'student_c_address_city',
        'student_c_address_state', 'student_c_address_zip', 'student_c_address_homephone', 'student_p_address_line_1', 'student_p_address_line_2',
        'student_p_address_city', 'student_p_address_state', 'student_p_address_zip', 'student_p_address_homephone', 'student_father_name',
        'father_qualification', 'father_age', 'father_occupation', 'student_mother_name', 'mother_qualification', 'mother_age', 'mother_occupation',
        'student_image', 'student_photo', 'dob_cert', 'prev_marksheet', 'prev_slc', 'caste', 'religion', 'aadhar_number', 'blood_group',
        'guardian_name', 'guardian_mobile', 'guardian_email', 'medical_notes', 'allergies', 'father_mobile', 'mother_mobile', 'father_email', 'mother_email',
    ];
    private const STAFF_PERSONAL = [
        'email_address', 'mobile_number', 'address', 'state', 'father_name', 'mother_name', 'date_of_birth', 'staff_photo', 'id_proof',
        'address_proof', 'experience_letter', 'expected_salary', 'aadhar_number', 'pan_number', 'bank_account_no', 'bank_ifsc',
    ];

    /** Removes personal details; keeps fees / marks / attendance linked to "Former student #…". → list of what was removed */
    public static function anonymiseStudent(string $client, string $eid): array
    {
        $reg = self::db()->execute('SELECT registration_id FROM ssms_student_enrollment WHERE enrollment_id = ? AND ssms_client_code = ? LIMIT 1',
            [$eid, $client])->fetch('assoc');
        if (!$reg) {
            throw new \RuntimeException('Student not found.');
        }
        $regId = $reg['registration_id'];
        try {
            $regRow = self::db()->execute('SELECT email_address, mobile_number FROM ssms_student_registration WHERE registration_id = ? AND ssms_client_code = ? LIMIT 1',
                [$regId, $client])->fetch('assoc') ?: [];
        } catch (\Throwable $e) {
            $regRow = [];
        }
        $regEmail = (string)($regRow['email_address'] ?? '');
        $regPhones = array_filter([(string)($regRow['mobile_number'] ?? '')]);
        try {
            foreach (self::q('SELECT phone FROM ssms_student_guardians WHERE registration_id = ? AND ssms_client_code = ?', [$regId, $client]) as $g) {
                $regPhones[] = (string)$g['phone'];
            }
        } catch (\Throwable $e) {
        }
        $eids  = array_column(self::q('SELECT enrollment_id FROM ssms_student_enrollment WHERE registration_id = ? AND ssms_client_code = ?', [$regId, $client]), 'enrollment_id');
        $done  = [];
        $set   = self::blankSet('ssms_student_registration', self::STUDENT_PERSONAL);
        $set['student_first_name'] = 'Former';
        $set['student_last_name']  = 'student #' . self::shortRef($eid);
        self::update('ssms_student_registration', $set, 'registration_id = ? AND ssms_client_code = ?', [$regId, $client]);
        $done[] = 'profile details';
        $in = implode(',', array_fill(0, count($eids), '?'));
        $p  = array_merge($eids, [$client]);
        foreach ([
            ["DELETE FROM ssms_user_language WHERE username IN ($in) AND ssms_client_code = ?", 'language choice'],
            ["DELETE FROM sawera_ssms_users WHERE ssms_user_name IN ($in) AND ssms_client_code = ? AND LOWER(ssms_user_role) = 'student'", 'student login'],
            ["DELETE FROM ssms_student_leave_requests WHERE enrollment_id IN ($in) AND ssms_client_code = ?", 'leave notes'],
            ["DELETE FROM ssms_student_arrivals WHERE enrollment_id IN ($in) AND ssms_client_code = ?", 'late / early records'],
            ["DELETE FROM ssms_report_card_comments WHERE enrollment_id IN ($in) AND ssms_client_code = ?", 'report comments'],
            ["DELETE FROM ssms_hostel_enrollment WHERE enrollment_id IN ($in) AND ssms_client_code = ?", 'hostel details'],
            ["DELETE FROM ssms_transport_enrollment WHERE enrollment_id IN ($in) AND ssms_client_code = ?", 'transport details'],
        ] as [$sql, $label]) {
            try {
                self::db()->execute($sql, $p);
                $done[] = $label;
            } catch (\Throwable $e) {
            }
        }
        // notifications: the student's own inbox and phones, and messages about this child in the parents' inbox
        Notify::eraseUsers($client, $eids);
        Calendar::eraseUsers($client, $eids);   // their calendar link
        if (Notify::eraseStudents($client, $eids, [$regEmail], $regPhones)) {
            $done[] = 'notifications';
        }
        if (Meetings::eraseFor($client, $eids)) {
            $done[] = 'parent–teacher meeting bookings';
        }
        // guardians, emergency contacts, medical, uploaded documents (files too) and extra fields
        Safety::eraseFor($client, (string)$regId, $eids);   // pick-up persons' photos, visits about the child
        BusTracking::eraseFor($client, $eids);              // bus boardings
        foreach (StudentRecord::eraseFor($client, (string)$regId) as $label) {
            $done[] = $label;
        }

        return $done;
    }

    public static function anonymiseStaff(string $client, string $staffId): array
    {
        $set = self::blankSet('ssms_staff', self::STAFF_PERSONAL);
        $set['first_name'] = 'Former';
        $set['last_name']  = 'staff #' . self::shortRef($staffId);
        self::update('ssms_staff', $set, 'staff_id = ? AND ssms_client_code = ?', [$staffId, $client]);
        $done = ['profile details'];
        try {
            $users = array_column(self::q("SELECT ssms_user_name FROM sawera_ssms_users WHERE staff_id = ? AND ssms_client_code = ? AND LOWER(ssms_user_role) <> 'owner'",
                [$staffId, $client]), 'ssms_user_name');
            if ($users) {
                Notify::eraseUsers($client, $users);
                Calendar::eraseUsers($client, $users);
                $done[] = 'notifications';
            }
        } catch (\Throwable $e) {
        }
        foreach ([
            ['UPDATE ssms_staff_attendance SET lat = NULL, lng = NULL WHERE staff_id = ? AND ssms_client_code = ?', 'check-in locations'],
            ["DELETE l FROM ssms_user_language l JOIN sawera_ssms_users u ON u.ssms_user_name = l.username AND u.ssms_client_code = l.ssms_client_code
               WHERE u.staff_id = ? AND u.ssms_client_code = ? AND LOWER(u.ssms_user_role) <> 'owner'", 'language choice'],
            ["DELETE FROM sawera_ssms_users WHERE staff_id = ? AND ssms_client_code = ? AND LOWER(ssms_user_role) <> 'owner'", 'app login'],
        ] as [$sql, $label]) {
            try {
                self::db()->execute($sql, [$staffId, $client]);
                $done[] = $label;
            } catch (\Throwable $e) {
            }
        }

        return $done;
    }

    /** column => blank value, for the listed columns that exist (NULL if allowed, else '' / 0 / 1900-01-01) */
    private static function blankSet(string $table, array $cols): array
    {
        $out = [];
        foreach (self::db()->execute("SHOW COLUMNS FROM `$table`")->fetchAll('assoc') as $c) {
            if (!in_array($c['Field'], $cols, true)) {
                continue;
            }
            if ($c['Null'] === 'YES') {
                $out[$c['Field']] = null;
            } elseif (preg_match('/int|decimal|float|double/i', $c['Type'])) {
                $out[$c['Field']] = 0;
            } elseif (preg_match('/date/i', $c['Type'])) {
                $out[$c['Field']] = '1900-01-01';
            } else {
                $out[$c['Field']] = '';
            }
        }

        return $out;
    }

    private static function update(string $table, array $set, string $where, array $p): void
    {
        if (!$set) {
            return;
        }
        $cols = implode(', ', array_map(fn($c) => "`$c` = ?", array_keys($set)));
        self::db()->execute("UPDATE `$table` SET $cols WHERE $where", array_merge(array_values($set), $p));
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    public static function shortRef(string $id): string
    {
        return strtoupper(substr(hash('sha256', $id), 0, 6));
    }

    private static function q(string $sql, array $p): array
    {
        try {
            return array_map([self::class, 'clean'], self::db()->execute($sql, $p)->fetchAll('assoc'));
        } catch (\Throwable $e) {
            return [];
        }
    }

    private static function clean(array $r): array
    {
        foreach ($r as $k => $v) {
            if (stripos((string)$k, 'password') !== false || in_array($k, ['validationCode', 'validationStatus', 'ssms_client_code'], true)) {
                unset($r[$k]);
            }
        }

        return $r;
    }

    private static function cast(array $r): array
    {
        $r['id']        = (int)$r['id'];
        $r['days_left'] = $r['due_date'] ? (int)floor((strtotime((string)$r['due_date']) - strtotime(date('Y-m-d', AccountSecurity::time()))) / 86400) : null;
        $r['has_file']  = !empty($r['file_path']) && $r['status'] === 'ready';
        unset($r['file_path']);

        return $r;
    }

    private static function dir(): string
    {
        $d = (defined('TMP') ? TMP : sys_get_temp_dir() . DIRECTORY_SEPARATOR) . 'privacy_exports' . DIRECTORY_SEPARATOR;
        if (!is_dir($d)) {
            @mkdir($d, 0700, true);
            @file_put_contents($d . '.htaccess', "Require all denied\nDeny from all\n");
        }

        return $d;
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
