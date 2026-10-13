<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Grading;
use App\Service\ReportCards;
use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Mailer\Mailer;

/**
 * ReportCardApi – configurable grading + report cards (JSON, JWT protected).
 *
 * Grading scales (owner / admin):
 *   GET  /ReportCardApi/scales                 school scales + presets
 *   POST /ReportCardApi/saveScale              { id?, name, scale_type, show_gpa, is_default, bands[] }
 *   POST /ReportCardApi/addPresetScale         { preset, is_default? }
 *   POST /ReportCardApi/setDefaultScale        { id }
 *   POST /ReportCardApi/deleteScale            { id }
 * Report card set-up (owner / admin):
 *   GET  /ReportCardApi/plans?sessionId=        report cards (+ their exams & weights)
 *   POST /ReportCardApi/savePlan               { id?, name, session_id, class_id, scale_id, template, …, terms[] }
 *   POST /ReportCardApi/deletePlan             { id }
 *   POST /ReportCardApi/publishPlan            { id, published }
 * Teachers / staff:
 *   GET  /ReportCardApi/commentSheet?planId=&classId=&sectionId=
 *   POST /ReportCardApi/saveComments           { planId, enrollmentId, comments: [{subject_id, comment}] }
 *   GET  /ReportCardApi/classReports?planId=&classId=&sectionId=   students + overall result
 *   GET  /ReportCardApi/reportCard?planId=&enrollmentId=           full report card data
 *   POST /ReportCardApi/emailReportCard        { planId, enrollmentId, pdfBase64, email? }
 * Students / parents:
 *   GET  /ReportCardApi/myReportCards          published report cards for me / my children
 */
class ReportCardApiController extends AppController
{
    private const SETUP = ['owner', 'admin'];
    private const STAFF = ['owner', 'admin', 'user', 'teacher', 'staff', 'principal', 'accountant'];
    private const MAX_PDF_BYTES = 8 * 1024 * 1024;

    // ── Grading scales ─────────────────────────────────────────────────────

    public function scales()
    {
        $this->request->allowMethod(['get']);
        $code = $this->_client();
        $presets = [];
        foreach (Grading::presets() as $key => $p) {
            $presets[] = ['key' => $key, 'name' => $p['name'], 'note' => $p['note'], 'scale_type' => $p['scale_type'],
                          'show_gpa' => (bool)$p['show_gpa'], 'bands' => $p['bands']];
        }

        return $this->_out(['status' => true, 'data' => [
            'scales'  => Grading::scales($code),
            'presets' => $presets,
            'builtin' => Grading::builtin(),
        ]]);
    }

    public function saveScale()
    {
        return $this->_setup(fn($d) => ['scale' => Grading::saveScale($this->_client(), $d)]);
    }

    public function addPresetScale()
    {
        return $this->_setup(fn($d) => ['scale' => Grading::createFromPreset(
            $this->_client(), (string)($d['preset'] ?? ''), !empty($d['is_default'])
        )]);
    }

    public function setDefaultScale()
    {
        return $this->_setup(function ($d) {
            Grading::setDefault($this->_client(), (int)($d['id'] ?? 0));

            return ['scales' => Grading::scales($this->_client())];
        });
    }

    public function deleteScale()
    {
        return $this->_setup(function ($d) {
            Grading::deleteScale($this->_client(), (int)($d['id'] ?? 0));

            return ['scales' => Grading::scales($this->_client())];
        });
    }

    // ── Report card plans ─────────────────────────────────────────────────

    public function plans()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $sid = (int)$this->request->getQuery('sessionId') ?: null;

        return $this->_out(['status' => true, 'data' => ReportCards::plans($this->_client(), $sid)]);
    }

    public function savePlan()
    {
        return $this->_setup(fn($d) => ['plan' => ReportCards::savePlan($this->_client(), $d)]);
    }

    public function deletePlan()
    {
        return $this->_setup(function ($d) {
            ReportCards::deletePlan($this->_client(), (int)($d['id'] ?? 0));

            return [];
        });
    }

    public function publishPlan()
    {
        return $this->_setup(fn($d) => ['plan' => ReportCards::publish(
            $this->_client(), (int)($d['id'] ?? 0), !empty($d['published']) && $d['published'] !== 'false'
        )]);
    }

    // ── Comments ───────────────────────────────────────────────────────────

    public function commentSheet()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $code = $this->_client();
        $plan = ReportCards::plan($code, (int)$this->request->getQuery('planId'));
        $cls  = (int)$this->request->getQuery('classId');
        if (!$plan || $cls <= 0) {
            return $this->_out(['status' => false, 'message' => 'Choose a report card and a class.'], 422);
        }
        $students = ReportCards::students($code, $plan, $cls, (int)$this->request->getQuery('sectionId') ?: null,
            (int)$this->request->getQuery('branchId') ?: null);
        $comments = ReportCards::comments($code, $plan['id'], array_map(fn($s) => (string)$s['enrollment_id'], $students));
        foreach ($students as &$s) {
            $c = $comments[(string)$s['enrollment_id']] ?? [];
            $s['comments'] = (object)$c;
            $s['comment_count'] = count($c);
            unset($s['email_address'], $s['mobile_number']);
        }

        return $this->_out(['status' => true, 'data' => [
            'plan'     => $plan,
            'subjects' => ReportCards::subjects($code, $plan, $cls),
            'students' => $students,
        ]]);
    }

    public function saveComments()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $d = (array)$this->request->getData();
        try {
            $n = ReportCards::saveComments($this->_client(), (int)($d['planId'] ?? 0), trim((string)($d['enrollmentId'] ?? '')),
                (array)($d['comments'] ?? []), $this->_user());
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }

        return $this->_out(['status' => true, 'saved' => $n]);
    }

    // ── Report cards ───────────────────────────────────────────────────────

    public function classReports()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $code = $this->_client();
        $plan = ReportCards::plan($code, (int)$this->request->getQuery('planId'));
        $cls  = (int)$this->request->getQuery('classId');
        if (!$plan || $cls <= 0) {
            return $this->_out(['status' => false, 'message' => 'Choose a report card and a class.'], 422);
        }
        $sec      = (int)$this->request->getQuery('sectionId') ?: null;
        $students = ReportCards::students($code, $plan, $cls, $sec, (int)$this->request->getQuery('branchId') ?: null);
        $sends    = ReportCards::lastSends($code, $plan['id']);
        $out      = [];
        foreach ($students as $s) {
            $eid = (string)$s['enrollment_id'];
            try {
                $rc = ReportCards::compute($code, $plan['id'], $eid, false);
                $ov = $rc['overall'];
            } catch (\Throwable $e) {
                Log::error("ReportCardApi classReports {$eid}: " . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
                $ov = ['percent' => null, 'grade' => null, 'result' => 'Could not calculate', 'gpa' => null,
                       'error' => $e->getMessage()];
            }
            $out[] = [
                'enrollment_id' => $eid,
                'roll_number'   => $s['roll_number'],
                'student_name'  => $s['student_name'],
                'email'         => (string)$s['email_address'],
                'percent'       => $ov['percent'],
                'grade'         => $ov['grade'],
                'gpa'           => $ov['gpa'] ?? null,
                'result'        => $ov['result'],
                'last_sent'     => $sends[$eid] ?? null,
                'error'         => $ov['error'] ?? null,
            ];
        }
        if (!empty($plan['show_rank'])) {
            $ranks = ReportCards::classRanks($code, $plan, $cls, $sec);
            foreach ($out as &$o) {
                $o['rank'] = $ranks['ranks'][$o['enrollment_id']] ?? null;
            }
        }

        $coverage = ReportCards::examCoverage($code, $plan, $cls, array_map(fn($s) => (string)$s['enrollment_id'], $students));

        return $this->_out(['status' => true, 'data' => ['plan' => $plan, 'students' => $out, 'coverage' => $coverage]]);
    }

    public function reportCard()
    {
        $this->request->allowMethod(['get']);
        $code = $this->_client();
        $pid  = (int)$this->request->getQuery('planId');
        $eid  = trim((string)$this->request->getQuery('enrollmentId'));
        $plan = ReportCards::plan($code, $pid);
        $stu  = $eid !== '' ? ReportCards::enrollment($code, $eid) : null;
        if (!$plan || !$stu) {
            return $this->_out(['status' => false, 'message' => 'Report card not found.'], 404);
        }
        if (!$this->_isRole(self::STAFF)) {
            // students / parents: only their own, and only once published
            if (!$plan['is_published'] || !$this->_mayView($stu)) {
                return $this->_out(['status' => false, 'message' => 'This report card is not available yet.'], 403);
            }
        }
        try {
            $data = ReportCards::compute($code, $pid, $eid);
        } catch (\DomainException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }
        $data['school'] = $this->_school($code);

        return $this->_out(['status' => true, 'data' => $data]);
    }

    /**
     * The app renders the PDF (same template the staff member previewed) and sends it here;
     * the server emails it to the parent with the school as the sender.
     */
    public function emailReportCard()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $code = $this->_client();
        $d    = (array)$this->request->getData();
        $pid  = (int)($d['planId'] ?? 0);
        $eid  = trim((string)($d['enrollmentId'] ?? ''));
        $plan = ReportCards::plan($code, $pid);
        $stu  = $eid !== '' ? ReportCards::enrollment($code, $eid) : null;
        if (!$plan || !$stu) {
            return $this->_out(['status' => false, 'message' => 'Report card not found.'], 404);
        }
        $email = trim((string)($d['email'] ?? '')) ?: trim((string)$stu['email_address']);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->_out(['status' => false, 'code' => 'NO_EMAIL',
                'message' => 'No valid email address on the student record.'], 422);
        }
        $pdf = base64_decode((string)($d['pdfBase64'] ?? ''), true);
        if ($pdf === false || strncmp($pdf, '%PDF', 4) !== 0 || strlen($pdf) > self::MAX_PDF_BYTES) {
            return $this->_out(['status' => false, 'message' => 'The report card PDF is missing or too large.'], 422);
        }
        $school   = $this->_school($code);
        $schoolNm = (string)($school['ssms_client_header_text'] ?: $school['ssms_client_name'] ?: 'School');
        $from     = filter_var((string)$school['ssms_client_email'], FILTER_VALIDATE_EMAIL)
            ? (string)$school['ssms_client_email'] : (string)env('EMAIL_FROM_ADDRESS', 'admin@sawera.info');
        $h    = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
        $file = preg_replace('/[^A-Za-z0-9_-]+/', '_', 'Report_Card_' . $stu['student_name']) . '.pdf';
        $tmp  = tempnam(sys_get_temp_dir(), 'rc');
        file_put_contents($tmp, $pdf);
        $html = '<p>Dear Parent,</p>'
            . '<p>Please find attached the <strong>' . $h($plan['name']) . '</strong> for <strong>'
            . $h($stu['student_name']) . '</strong> (' . $h(trim($stu['class_name'] . ' ' . ($stu['section_name'] ?? ''))) . ').</p>'
            . '<p>Thank you,<br>' . $h($schoolNm) . '</p>';
        try {
            (new Mailer('default'))
                ->setFrom([$from => $schoolNm])
                ->setTo($email)
                ->setSubject($plan['name'] . ' – ' . $stu['student_name'])
                ->setEmailFormat('html')
                ->setAttachments([$file => ['file' => $tmp, 'mimetype' => 'application/pdf']])
                ->deliver($html);
            ReportCards::logSend($code, $pid, $eid, $email, 'sent', null, $this->_user());
        } catch (\Throwable $e) {
            Log::error('emailReportCard: ' . $e->getMessage());
            ReportCards::logSend($code, $pid, $eid, $email, 'failed', $e->getMessage(), $this->_user());

            return $this->_out(['status' => false, 'message' => 'The email could not be sent. Please try again later.'], 502);
        } finally {
            @unlink($tmp);
        }

        return $this->_out(['status' => true, 'message' => "Report card emailed to {$email}.", 'email' => $email]);
    }

    public function myReportCards()
    {
        $this->request->allowMethod(['get']);
        $code = $this->_client();
        $out  = [];
        foreach ($this->_myEnrollments() as $stu) {
            foreach (ReportCards::publishedFor($code, $stu) as $p) {
                $out[] = $p + [
                    'enrollment_id' => (string)$stu['enrollment_id'],
                    'student_name'  => $stu['student_name'],
                    'class_name'    => trim(($stu['class_name'] ?? '') . ' ' . ($stu['section_name'] ?? '')),
                ];
            }
        }

        return $this->_out(['status' => true, 'data' => $out]);
    }

    // ── internals ──────────────────────────────────────────────────────────

    /** Owner/admin POST action with JSON body; maps validation errors to 422. */
    private function _setup(callable $fn)
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(self::SETUP)) {
            return $this->_out(['status' => false, 'message' => 'Only the school owner or an admin can change this.'], 403);
        }
        try {
            $data = $fn((array)$this->request->getData());
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error('ReportCardApi: ' . $e->getMessage());

            return $this->_out(['status' => false, 'message' => 'Something went wrong. Please try again.'], 500);
        }

        return $this->_out(['status' => true, 'data' => $data]);
    }

    private function _school(string $code): array
    {
        $r = ConnectionManager::get('default')->execute(
            'SELECT ssms_client_name, ssms_client_header_text, logo_name, ssms_client_address,
                    ssms_client_phone, ssms_client_email
               FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1',
            [$code]
        )->fetch('assoc');

        return $r ?: ['ssms_client_name' => '', 'ssms_client_header_text' => '', 'logo_name' => null,
                      'ssms_client_address' => '', 'ssms_client_phone' => '', 'ssms_client_email' => ''];
    }

    /** Enrollments the logged-in student / parent may see. */
    private function _myEnrollments(): array
    {
        $code = $this->_client();
        $role = $this->_role();
        $ids  = [];
        if ($role === 'student') {
            $eid = trim((string)($this->request->getAttribute('jwt_enrollment_id') ?: $this->_user()));
            if ($eid !== '') {
                $ids[] = $eid;
            }
        } elseif ($role === 'parent') {
            $mobile = $this->_parentMobile();
            if (strlen($mobile) >= 6) {
                $rows = ConnectionManager::get('default')->execute(
                    "SELECT e.enrollment_id FROM ssms_student_enrollment e
                       JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                      WHERE e.ssms_client_code = ? AND COALESCE(e.status, 'active') = 'active'
                        AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(r.mobile_number,'+',''),' ',''),'-',''),'(',''),')',''), 10) = ?",
                    [$code, $mobile]
                )->fetchAll('assoc');
                $ids = array_map(fn($r) => (string)$r['enrollment_id'], $rows);
                // guardians the school gave app sign-in (Student record › Guardians)
                $ids = array_merge($ids, \App\Service\StudentRecord::guardianEnrollments($code, $mobile));
            }
        }
        $out = [];
        foreach (array_unique($ids) as $id) {
            $s = ReportCards::enrollment($code, $id);
            if ($s) {
                $out[] = $s;
            }
        }

        return $out;
    }

    private function _mayView(array $stu): bool
    {
        foreach ($this->_myEnrollments() as $s) {
            if ((string)$s['enrollment_id'] === (string)$stu['enrollment_id']) {
                return true;
            }
        }

        return false;
    }

    private function _parentMobile(): string
    {
        $user = $this->_user();
        $row  = ConnectionManager::get('default')->execute(
            'SELECT mobile_number FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$user, $this->_client()]
        )->fetch('assoc');

        return substr(preg_replace('/\D/', '', (string)($row['mobile_number'] ?? '') ?: $user), -10);
    }

    private function _client(): string
    {
        return strtoupper(trim((string)$this->request->getAttribute('jwt_client_code')));
    }

    private function _role(): string
    {
        return strtolower(trim((string)$this->request->getAttribute('jwt_role')));
    }

    private function _user(): string
    {
        // jwt_user can be empty for parent tokens – the app sends the username as a header (same as getLinkedStudents)
        return (string)($this->request->getAttribute('jwt_user') ?: $this->request->getHeaderLine('ssmsUserName'));
    }

    private function _isRole(array $roles): bool
    {
        return in_array($this->_role(), $roles, true);
    }

    private function _out(array $data, int $status = 200)
    {
        $this->autoRender = false;

        return $this->response
            ->withStatus($status)
            ->withType('application/json')
            ->withStringBody((string)json_encode($data));
    }
}
