<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Event\EventInterface;
use Cake\Log\Log;
use Cake\Mailer\Mailer;

/**
 * StudentPortalController
 *
 * Public registration — no client_code in URL.
 * The school is resolved from enrollment_id + email + DOB.
 *
 * Routes:
 *   GET/POST  /StudentPortal/register          — self-registration (public)
 *   GET       /StudentPortal/dashboard         — student home (session-auth)
 *   GET       /StudentPortal/logout            — clear sp_* session
 *
 * Login uses the shared /SaweraSsmsUsers/login page.
 */
class StudentPortalController extends AppController
{
    public function beforeFilter(EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->Authentication->addUnauthenticatedActions(['register']);
    }

    // =========================================================================
    // REGISTER  —  public, no login required
    // =========================================================================

    public function register(): void
    {
        $errors  = [];
        $success = false;

        if ($this->request->is('post')) {
            $data = $this->request->getData();

            $enrollmentId = strtoupper(trim((string)($data['enrollment_id']  ?? '')));
            $email        = strtolower(trim((string)($data['email_address']  ?? '')));
            $dob          = trim((string)($data['student_dob']               ?? ''));  // YYYY-MM-DD
            $role         = in_array($data['role'] ?? '', ['Student', 'Parent'], true)
                            ? $data['role'] : 'Student';

            // ── Basic validation ──────────────────────────────────────────────
            if ($enrollmentId === '') $errors[] = 'Enrollment number is required.';
            if ($email === '')        $errors[] = 'Email address is required.';
            if ($dob === '')          $errors[] = 'Date of birth is required.';

            if (empty($errors)) {
                $db = ConnectionManager::get('default');

                // ── Resolve school + verify identity ──────────────────────────
                // Match enrollment_id + email + DOB across all schools
                $enrollment = $db->execute(
                    "SELECT e.enrollment_id, e.status AS enrollment_status, e.ssms_client_code,
                            e.branch_id, e.class_id, e.session_id,
                            r.student_first_name, r.student_last_name,
                            r.email_address, r.student_dob
                     FROM ssms_student_enrollment e
                     INNER JOIN ssms_student_registration r
                             ON r.registration_id = e.registration_id
                     WHERE e.enrollment_id          = ?
                       AND LOWER(r.email_address)   = ?
                       AND DATE(r.student_dob)      = ?
                     LIMIT 1",
                    [$enrollmentId, $email, $dob]
                )->fetchAssoc();

                if (empty($enrollment)) {
                    $errors[] = 'No matching enrollment found. Please check your Enrollment Number, Email, and Date of Birth.';
                } elseif (!in_array(strtolower($enrollment['enrollment_status'] ?? ''), ['active', 'approved'], true)) {
                    $errors[] = 'Your enrollment is not active. Please contact the school office.';
                } else {
                    $clientCode = $enrollment['ssms_client_code'];

                    // ── Check for existing account ────────────────────────────
                    $existing = $db->execute(
                        "SELECT ssms_user_name FROM sawera_ssms_users
                         WHERE ssms_client_code = ? AND ssms_user_name = ?
                         LIMIT 1",
                        [$clientCode, $enrollmentId]
                    )->fetchAssoc();

                    if (!empty($existing)) {
                        $errors[] = 'An account already exists for this enrollment number. Please use the <a href="/SaweraSsmsUsers/login">login page</a>.';
                    } else {
                        // ── Create account ────────────────────────────────────
                        $plainPassword = $this->_generatePassword();
                        $hashedPw      = crypt($plainPassword, '$2y$10$iusesomecrazystrings22');
                        $firstName     = $enrollment['student_first_name'];
                        $lastName      = $enrollment['student_last_name'];
                        $now           = date('Y-m-d H:i:s');

                        // Fetch institute name for email
                        $institute = $db->execute(
                            "SELECT ssms_client_header_text FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                            [$clientCode]
                        )->fetchAssoc();
                        $instituteName = $institute['ssms_client_header_text'] ?? 'Your School';

                        try {
                            $db->execute(
                                "INSERT INTO sawera_ssms_users (
                                    ssms_user_name, ssms_user_firstname, ssms_user_lastname,
                                    ssms_user_password, ssms_user_image, ssms_user_role,
                                    ssms_user_email, mobile_number, user_dob,
                                    branch_id, ssms_user_status, ssms_client_code,
                                    validationCode, validationStatus, created, modified
                                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                [
                                    $enrollmentId,          // username = enrollment ID
                                    $firstName,
                                    $lastName,
                                    $hashedPw,
                                    '',
                                    $role,                  // 'Student' or 'Parent'
                                    $email,
                                    '',
                                    $dob,
                                    $enrollment['branch_id'],
                                    'active',
                                    $clientCode,
                                    '',
                                    'Verified',
                                    $now,
                                    $now,
                                ]
                            );

                            $this->_sendWelcomeEmail(
                                email:         $email,
                                firstName:     $firstName,
                                enrollmentId:  $enrollmentId,
                                password:      $plainPassword,
                                role:          $role,
                                instituteName: $instituteName,
                            );

                            $success = true;
                            Log::info("StudentPortal: account created — {$enrollmentId} ({$role}) at {$clientCode}");

                        } catch (\Throwable $e) {
                            Log::error('StudentPortal register error: ' . $e->getMessage());
                            $errors[] = 'Account creation failed. Please try again or contact the school office.';
                        }
                    }
                }
            }
        }

        $this->set(compact('errors', 'success'));
    }

    // =========================================================================
    // DASHBOARD  —  requires session (Student / Parent role)
    // =========================================================================

    public function dashboard(): void
    {
        $session = $this->request->getSession();

        // Guard: only Student / Parent roles
        $role = $session->read('ssms_user_role');
        if (!in_array($role, ['Student', 'Parent'], true)) {
            $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
            return;
        }

        $db           = ConnectionManager::get('default');
        $clientCode   = $session->read('ssms_client_code');
        // username = enrollment_id for Student/Parent accounts
        $enrollmentId = $session->read('ssms_user_name');

        // Student info
        $student = $db->execute(
            "SELECT r.student_first_name, r.student_last_name, r.email_address,
                    r.mobile_number, r.student_dob, r.student_gender,
                    c.class_name, b.branch_name, s.session_name, e.status AS enrollment_status
             FROM ssms_student_enrollment e
             INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
             INNER JOIN ssms_classes  c ON c.class_id   = e.class_id
             INNER JOIN ssms_branch   b ON b.branch_id  = e.branch_id
             INNER JOIN ssms_sessions s ON s.session_id = e.session_id
             WHERE e.enrollment_id = ? AND e.ssms_client_code = ?
             ORDER BY e.session_id DESC LIMIT 1",
            [$enrollmentId, $clientCode]
        )->fetchAssoc();

        // Fee dues — mirrors the main fee-due query in SsmsFeePaidDetailsController
        $today = date('Y-m-d');
        $feeDues = $db->execute(
            "SELECT
                fs.fee_id,
                fs.fee_item_id,
                fs.month_no,
                fs.due_date,
                fi.fee_item_name,
                fs.fee_amount,
                COALESCE(sd.discount_amount, 0)  AS discount_amount,
                COALESCE(fi.tax_percent, 0)       AS tax_percent,
                ROUND(
                    (fs.fee_amount - COALESCE(sd.discount_amount,0))
                    + ROUND((fs.fee_amount - COALESCE(sd.discount_amount,0)) * COALESCE(fi.tax_percent,0) / 100, 2),
                2) AS net_fee_amount,
                COALESCE(paid_agg.total_fee_paid, 0) AS paid,
                ROUND(
                    (fs.fee_amount - COALESCE(sd.discount_amount,0)
                     + ROUND((fs.fee_amount - COALESCE(sd.discount_amount,0)) * COALESCE(fi.tax_percent,0) / 100, 2))
                    - COALESCE(paid_agg.total_fee_paid, 0),
                2) AS balance
             FROM ssms_student_enrollment e
             INNER JOIN ssms_fee_structure fs
                     ON fs.class_id        = e.class_id
                    AND fs.session_id      = e.session_id
                    AND fs.ssms_client_code = e.ssms_client_code
             INNER JOIN ssms_fee_items fi
                     ON fi.fee_item_id = fs.fee_item_id
                    AND fi.category    = 'Academic'
             LEFT JOIN ssms_student_discounts sd
                    ON sd.enrollment_id    = ?
                   AND sd.fee_item_id      = fs.fee_item_id
                   AND sd.session_id       = fs.session_id
                   AND sd.ssms_client_code = fs.ssms_client_code
             LEFT JOIN (
                 SELECT fp.fee_id, fp.fee_item_id,
                        SUM(fp.paid_amount - COALESCE(fp.late_fee,0)) AS total_fee_paid
                 FROM   ssms_fee_paid_details fp
                 WHERE  fp.enrollment_id = ?
                   AND  fp.paid_amount   > 0
                 GROUP BY fp.fee_id, fp.fee_item_id
             ) paid_agg ON paid_agg.fee_id = fs.fee_id AND paid_agg.fee_item_id = fs.fee_item_id
             WHERE e.enrollment_id    = ?
               AND e.ssms_client_code = ?
               AND fs.due_date        <= ?
               AND fs.fee_id = (
                   SELECT MIN(fs2.fee_id)
                   FROM   ssms_fee_structure fs2
                   WHERE  fs2.fee_item_id      = fs.fee_item_id
                     AND  fs2.month_no         = fs.month_no
                     AND  fs2.class_id         = fs.class_id
                     AND  fs2.session_id       = fs.session_id
                     AND  fs2.ssms_client_code = fs.ssms_client_code
               )
             HAVING balance > 0
             ORDER BY FIELD(fs.month_no,'Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'), fi.fee_item_name",
            [$enrollmentId, $enrollmentId, $enrollmentId, $clientCode, $today]
        )->fetchAll('assoc');

        // Recent receipts
        $receipts = $db->execute(
            "SELECT receipt_number, SUM(paid_amount) AS total_paid,
                    payment_date, payment_method
             FROM ssms_fee_paid_details
             WHERE enrollment_id = ? AND ssms_client_code = ?
             GROUP BY receipt_number, payment_date, payment_method
             ORDER BY payment_date DESC LIMIT 10",
            [$enrollmentId, $clientCode]
        )->fetchAll('assoc');

        // Institute info
        $institute = $db->execute(
            "SELECT ssms_client_header_text, logo_name FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();

        $this->set(compact('student', 'feeDues', 'receipts', 'institute', 'clientCode', 'enrollmentId', 'role'));
    }

    // =========================================================================
    // ATTENDANCE
    // =========================================================================

    public function attendance(): void
    {
        $session      = $this->request->getSession();
        $role         = $session->read('ssms_user_role');
        if (!in_array($role, ['Student', 'Parent'], true)) {
            $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
            return;
        }

        $db           = ConnectionManager::get('default');
        $clientCode   = $session->read('ssms_client_code');
        $enrollmentId = $session->read('ssms_user_name');

        // Monthly summary
        $monthlySummary = $db->execute(
            "SELECT
                 DATE_FORMAT(attendance_date, '%Y-%m') AS ym,
                 DATE_FORMAT(attendance_date, '%b %Y') AS month_label,
                 COUNT(CASE WHEN attendance = 'P' THEN 1 END) AS present,
                 COUNT(CASE WHEN attendance = 'L' THEN 1 END) AS absent,
                 COUNT(CASE WHEN attendance = 'H' THEN 1 END) AS holiday,
                 COUNT(*)                                       AS total_days
             FROM student_attendance
             WHERE enrollment_id = ? AND ssms_client_code = ?
             GROUP BY DATE_FORMAT(attendance_date, '%Y-%m')
             ORDER BY ym DESC
             LIMIT 12",
            [$enrollmentId, $clientCode]
        )->fetchAll('assoc');

        // Recent 30 days detail
        $recentAttendance = $db->execute(
            "SELECT attendance_date, attendance,
                    DAYNAME(attendance_date) AS day_name
             FROM student_attendance
             WHERE enrollment_id = ? AND ssms_client_code = ?
               AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             ORDER BY attendance_date DESC",
            [$enrollmentId, $clientCode]
        )->fetchAll('assoc');

        // Overall totals
        $overallTotals = $db->execute(
            "SELECT
                 COUNT(CASE WHEN attendance = 'P' THEN 1 END) AS total_present,
                 COUNT(CASE WHEN attendance = 'L' THEN 1 END) AS total_absent,
                 COUNT(CASE WHEN attendance = 'H' THEN 1 END) AS total_holiday,
                 COUNT(*) AS total_days
             FROM student_attendance
             WHERE enrollment_id = ? AND ssms_client_code = ?",
            [$enrollmentId, $clientCode]
        )->fetchAssoc();

        $this->set(compact('monthlySummary', 'recentAttendance', 'overallTotals', 'enrollmentId'));
    }

    // =========================================================================
    // RESULTS
    // =========================================================================

    public function results(): void
    {
        $session      = $this->request->getSession();
        $role         = $session->read('ssms_user_role');
        if (!in_array($role, ['Student', 'Parent'], true)) {
            $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
            return;
        }

        $db           = ConnectionManager::get('default');
        $clientCode   = $session->read('ssms_client_code');
        $enrollmentId = $session->read('ssms_user_name');

        // All marks grouped by session → exam → subject
        $rawMarks = $db->execute(
            "SELECT
                 ss.session_name,
                 se.exam_name,
                 sub.subject_name,
                 sm.total_marks,
                 COALESCE(mm.max_marks, 0) AS max_marks,
                 sm.session_id,
                 sm.exam_id
             FROM ssms_marks sm
             JOIN ssms_exams    se  ON se.exam_id    = sm.exam_id
             JOIN ssms_sessions ss  ON ss.session_id = sm.session_id
             JOIN ssms_subjects sub ON sub.subject_id = sm.subject_id
             LEFT JOIN ssms_max_marks mm
                    ON  mm.subject_id       = sm.subject_id
                    AND mm.class_id         = sm.class_id
                    AND mm.ssms_client_code = sm.ssms_client_code
             WHERE sm.enrollment_id    = ?
               AND sm.ssms_client_code = ?
             ORDER BY sm.session_id DESC, se.exam_name, sub.subject_name",
            [$enrollmentId, $clientCode]
        )->fetchAll('assoc');

        // Pivot: session_name → exam_name → [subjects]
        $results = [];
        foreach ($rawMarks as $row) {
            $sess = $row['session_name'];
            $exam = $row['exam_name'];
            if (!isset($results[$sess])) $results[$sess] = [];
            if (!isset($results[$sess][$exam])) $results[$sess][$exam] = [];
            $results[$sess][$exam][] = $row;
        }

        $this->set(compact('results', 'enrollmentId'));
    }

    // =========================================================================
    // TIMETABLE  —  student's own class timetable
    // =========================================================================

    public function timetable(): void
    {
        $session      = $this->request->getSession();
        $role         = $session->read('ssms_user_role');
        if (!in_array($role, ['Student', 'Parent'], true)) {
            $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
            return;
        }

        $db           = ConnectionManager::get('default');
        $clientCode   = $session->read('ssms_client_code');
        $enrollmentId = $session->read('ssms_user_name');

        // Fetch student's current class_id, section_id, session_id
        $enrollment = $db->execute(
            "SELECT e.class_id, e.section_id, e.session_id,
                    c.class_name, sec.section_name, s.session_name
             FROM ssms_student_enrollment e
             INNER JOIN ssms_classes   c   ON c.class_id    = e.class_id
             INNER JOIN ssms_sections  sec ON sec.section_id = e.section_id
             INNER JOIN ssms_sessions  s   ON s.session_id  = e.session_id
             WHERE e.enrollment_id = ? AND e.ssms_client_code = ?
             ORDER BY e.session_id DESC LIMIT 1",
            [$enrollmentId, $clientCode]
        )->fetchAssoc();

        $grid = [];
        $periods = [];

        if ($enrollment) {
            $classId   = (int)$enrollment['class_id'];
            $sectionId = (int)$enrollment['section_id'];
            $sessionId = (int)$enrollment['session_id'];

            // Load periods
            $periods = $db->execute(
                "SELECT * FROM ssms_periods WHERE ssms_client_code = ? ORDER BY period_number",
                [$clientCode]
            )->fetchAll('assoc');

            // Load timetable for this class-section
            $rows = $db->execute(
                "SELECT t.day_of_week, t.period_id, t.room,
                        sub.subject_name,
                        CONCAT(st.first_name,' ',st.last_name) AS staff_name
                 FROM ssms_timetable t
                 LEFT JOIN ssms_subjects sub ON sub.subject_id = t.subject_id AND sub.ssms_client_code = t.ssms_client_code
                 LEFT JOIN ssms_staff    st  ON st.staff_id    = t.staff_id   AND st.ssms_client_code  = t.ssms_client_code
                 WHERE t.ssms_client_code = ? AND t.session_id = ?
                   AND t.class_id = ? AND t.section_id = ?",
                [$clientCode, $sessionId, $classId, $sectionId]
            )->fetchAll('assoc');

            foreach ($rows as $r) {
                $grid[(int)$r['day_of_week']][(int)$r['period_id']] = $r;
            }
        }

        $days = [1=>'Monday',2=>'Tuesday',3=>'Wednesday',4=>'Thursday',5=>'Friday',6=>'Saturday'];

        $this->set(compact('enrollment', 'periods', 'grid', 'days', 'enrollmentId'));
    }

    // =========================================================================
    // LOGOUT
    // =========================================================================

    public function logout(): void
    {
        $this->Authentication->logout();
        $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private function _generatePassword(int $length = 10): string
    {
        $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789@#';
        $pw    = '';
        $max   = strlen($chars) - 1;
        for ($i = 0; $i < $length; $i++) {
            $pw .= $chars[random_int(0, $max)];
        }
        return $pw;
    }

    private function _sendWelcomeEmail(
        string $email,
        string $firstName,
        string $enrollmentId,
        string $password,
        string $role,
        string $instituteName
    ): void {
        try {
            $loginUrl = (string)\Cake\Routing\Router::url(
                ['controller' => 'SaweraSsmsUsers', 'action' => 'login'],
                true
            );

            $mailer = new Mailer('default');
            $mailer->setTo($email)
                   ->setSubject("{$instituteName} — Your Student Portal Account")
                   ->setEmailFormat('html')
                   ->setViewVars([
                       'instituteName' => $instituteName,
                       'firstName'     => $firstName,
                       'enrollmentId'  => $enrollmentId,
                       'password'      => $password,
                       'role'          => $role,
                       'loginUrl'      => $loginUrl,
                   ]);

            $mailer->viewBuilder()
                   ->setTemplate('student_welcome')
                   ->setLayout('default');

            $mailer->send();

            Log::info("StudentPortal welcome email sent to {$email} for {$enrollmentId}");
        } catch (\Throwable $e) {
            Log::error('StudentPortal welcome email failed: ' . $e->getMessage());
        }
    }
}
