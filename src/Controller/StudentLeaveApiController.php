<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\StudentLeave;
use Cake\Log\Log;

/**
 * StudentLeaveApi – parent absence notes, student leave, late arrival & early pickup (JWT protected).
 *
 * Parents / students:
 *   GET  /StudentLeaveApi/myChildren          children I can send requests for
 *   GET  /StudentLeaveApi/myRequests          my children's requests (+ late/early log)
 *   POST /StudentLeaveApi/submit              { enrollment_id, request_type, from_date, to_date?, time_at?,
 *                                               reason_category, reason?, pickup_person? }
 *   GET  /StudentLeaveApi/countDays?enrollmentId=&from=&to=   school days in a range (preview)
 *   POST /StudentLeaveApi/cancel              { id }   (staff: any active request, attendance restored)
 *   POST /StudentLeaveApi/update              { id, … same fields as submit }
 * Staff (teachers see their own classes, admins see all):
 *   GET  /StudentLeaveApi/requests?status=&classId=&sectionId=&date=
 *   POST /StudentLeaveApi/review              { id, decision: approved|rejected, note? }
 *   POST /StudentLeaveApi/submit              staff entry (e.g. parent phoned) → approved immediately
 *   GET  /StudentLeaveApi/dayStatus?classId=&sectionId=&date=   for the attendance screen
 *   POST /StudentLeaveApi/recordArrival       { enrollment_id, kind: late|early, date?, time, reason?, picked_up_by?, relation? }
 *   GET  /StudentLeaveApi/arrivals?date=&classId=&sectionId=
 *   GET  /StudentLeaveApi/pendingCount
 *   GET  /StudentLeaveApi/searchStudents?q=   find a student by name / roll / enrollment no.
 *   GET  /StudentLeaveApi/settings / POST saveSettings { principal_days }
 * Long leave (more than principal_days, set per school) needs two approvals:
 * class teacher / admin first, then the principal or owner.
 */
class StudentLeaveApiController extends AppController
{
    // ── Parents / students ────────────────────────────────────────────────

    public function myChildren()
    {
        $this->request->allowMethod(['get']);
        $code = $this->_client();
        $out  = [];
        foreach ($this->_mine() as $eid) {
            $s = StudentLeave::enrollment($code, $eid);
            if ($s) {
                $out[] = ['enrollment_id' => $eid, 'student_name' => $s['student_name'],
                          'class_name' => trim(($s['class_name'] ?? '') . ' ' . ($s['section_name'] ?? '')), 'roll_number' => $s['roll_number']];
            }
        }

        return $this->_out(['status' => true, 'data' => $out, 'reasons' => StudentLeave::REASONS]);
    }

    public function myRequests()
    {
        $this->request->allowMethod(['get']);
        $mine = $this->_mine();

        return $this->_out(['status' => true, 'data' => [
            'requests' => StudentLeave::list($this->_client(), ['enrollment_ids' => $mine, 'status' => 'all', 'limit' => 100]),
            'arrivals' => StudentLeave::arrivals($this->_client(), ['enrollment_ids' => $mine]),
        ]]);
    }

    public function submit()
    {
        $this->request->allowMethod(['post']);
        $d    = (array)$this->request->getData();
        $role = $this->_role();
        $staff = in_array($role, StudentLeave::STAFF, true);
        if (!$staff && !in_array(trim((string)($d['enrollment_id'] ?? '')), $this->_mine(), true)) {
            return $this->_out(['status' => false, 'message' => 'You can only send requests for your own children.'], 403);
        }

        return $this->_try(fn() => ['request' => StudentLeave::submit($this->_client(), $d, $this->_user(), $role)]);
    }

    /** Parent: own pending / not-yet-started requests. Staff: any active request of their classes (attendance is restored). */
    public function cancel()
    {
        $this->request->allowMethod(['post']);
        $d = (array)$this->request->getData();
        if ($this->_staff()) {
            $scope = StudentLeave::teacherScope($this->_client(), $this->_role(), $this->_user());

            return $this->_try(fn() => ['request' => StudentLeave::staffCancel(
                $this->_client(), (int)($d['id'] ?? 0), $this->_user(), isset($d['note']) ? (string)$d['note'] : null, $scope
            )]);
        }

        return $this->_try(fn() => ['request' => StudentLeave::cancel($this->_client(), (int)($d['id'] ?? 0), $this->_mine())]);
    }

    /** POST /StudentLeaveApi/update { id, request_type?, from_date, to_date?, time_at?, reason_category, reason?, pickup_person? } */
    public function update()
    {
        $this->request->allowMethod(['post']);
        $d  = (array)$this->request->getData();
        $id = (int)($d['id'] ?? 0);
        if ($this->_staff()) {
            $scope = StudentLeave::teacherScope($this->_client(), $this->_role(), $this->_user());
            if ($scope && !StudentLeave::list($this->_client(), ['id' => $id, 'scope' => $scope, 'status' => 'all'])) {
                return $this->_out(['status' => false, 'message' => 'This student is not in one of your classes.'], 403);
            }

            return $this->_try(fn() => ['request' => StudentLeave::update($this->_client(), $id, $d, $this->_user(), $this->_role())]);
        }

        return $this->_try(fn() => ['request' => StudentLeave::update($this->_client(), $id, $d, $this->_user(), $this->_role(), $this->_mine())]);
    }

    /**
     * GET /StudentLeaveApi/countDays?enrollmentId=&from=&to=
     * Live preview for the forms: school days in the range (weekly off days + holidays skipped).
     */
    public function countDays()
    {
        $this->request->allowMethod(['get']);
        $q   = $this->request->getQueryParams();
        $eid = trim((string)($q['enrollmentId'] ?? ''));
        if (!$this->_staff() && !in_array($eid, $this->_mine(), true)) {
            return $this->_forbidden();
        }

        return $this->_out(['status' => true, 'data' => StudentLeave::countDays(
            $this->_client(), $eid, (string)($q['from'] ?? ''), (string)($q['to'] ?? '')
        )]);
    }

    // ── Staff ──────────────────────────────────────────────────────────────

    public function requests()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_staff()) {
            return $this->_forbidden();
        }
        $q = $this->request->getQueryParams();
        $status = (string)($q['status'] ?? 'pending');
        if ($status === 'pending' && in_array($this->_role(), StudentLeave::FINAL, true)) {
            $status = 'open';   // principal / owner also see leave already approved by a teacher
        }
        $f = [
            'status'     => $status,
            'class_id'   => (int)($q['classId'] ?? 0) ?: null,
            'section_id' => (int)($q['sectionId'] ?? 0) ?: null,
            'date'       => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($q['date'] ?? '')) ? $q['date'] : null,
            'scope'      => StudentLeave::teacherScope($this->_client(), $this->_role(), $this->_user()),
        ];

        return $this->_out(['status' => true, 'data' => StudentLeave::list($this->_client(), $f)]);
    }

    public function review()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_staff()) {
            return $this->_forbidden();
        }
        $d     = (array)$this->request->getData();
        $id    = (int)($d['id'] ?? 0);
        $scope = StudentLeave::teacherScope($this->_client(), $this->_role(), $this->_user());
        if ($scope && !StudentLeave::list($this->_client(), ['id' => $id, 'scope' => $scope, 'status' => 'all'])) {
            return $this->_out(['status' => false, 'message' => 'This student is not in one of your classes.'], 403);
        }

        return $this->_try(fn() => ['request' => StudentLeave::review(
            $this->_client(), $id, (string)($d['decision'] ?? ''), $this->_user(), isset($d['note']) ? (string)$d['note'] : null,
            $this->_role()
        )]);
    }

    public function dayStatus()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_staff()) {
            return $this->_forbidden();
        }
        $q    = $this->request->getQueryParams();
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($q['date'] ?? '')) ? $q['date'] : $this->schoolToday();

        return $this->_out(['status' => true, 'data' => (object)StudentLeave::dayStatus(
            $this->_client(), (int)($q['classId'] ?? 0), (int)($q['sectionId'] ?? 0) ?: null, $date
        )]);
    }

    public function recordArrival()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_staff()) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => ['arrival' => StudentLeave::recordArrival(
            $this->_client(), (array)$this->request->getData(), $this->_user()
        )]);
    }

    public function arrivals()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_staff()) {
            return $this->_forbidden();
        }
        $q = $this->request->getQueryParams();
        $f = ['date' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($q['date'] ?? '')) ? $q['date'] : $this->schoolToday()];
        if (!empty($q['classId'])) {
            $f['class_id'] = (int)$q['classId'];
        }
        if (!empty($q['sectionId'])) {
            $f['section_id'] = (int)$q['sectionId'];
        }

        return $this->_out(['status' => true, 'data' => StudentLeave::arrivals($this->_client(), $f)]);
    }

    public function pendingCount()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_staff()) {
            return $this->_out(['status' => true, 'data' => ['pending' => 0]]);
        }
        $scope = StudentLeave::teacherScope($this->_client(), $this->_role(), $this->_user());

        return $this->_out(['status' => true, 'data' => ['pending' => StudentLeave::pendingCount($this->_client(), $scope, $this->_role())]]);
    }

    /** GET /StudentLeaveApi/settings → { principal_days, can_edit, is_final_approver } */
    public function settings()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_staff()) {
            return $this->_forbidden();
        }

        return $this->_out(['status' => true, 'data' => [
            'principal_days'    => StudentLeave::principalDays($this->_client()),
            'can_edit'          => in_array($this->_role(), StudentLeave::ADMINS, true),
            'is_final_approver' => in_array($this->_role(), StudentLeave::FINAL, true),
        ]]);
    }

    /** POST /StudentLeaveApi/saveSettings { principal_days } – owner / admin / principal */
    public function saveSettings()
    {
        $this->request->allowMethod(['post']);
        if (!in_array($this->_role(), StudentLeave::ADMINS, true)) {
            return $this->_out(['status' => false, 'message' => 'Only the owner, principal or an admin can change this.'], 403);
        }
        $d = (array)$this->request->getData();

        return $this->_try(fn() => ['principal_days' => StudentLeave::setPrincipalDays(
            $this->_client(), (int)($d['principal_days'] ?? -1), $this->_user()
        )]);
    }

    public function searchStudents()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_staff()) {
            return $this->_forbidden();
        }
        $q = trim((string)$this->request->getQuery('q'));
        if (mb_strlen($q) < 2) {
            return $this->_out(['status' => true, 'data' => []]);
        }
        $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
        $rows = \Cake\Datasource\ConnectionManager::get('default')->execute(
            "SELECT e.enrollment_id, e.roll_number, c.class_name, sec.section_name,
                    TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) AS student_name
               FROM ssms_student_enrollment e
               JOIN ssms_student_registration r ON r.registration_id = e.registration_id
          LEFT JOIN ssms_classes c ON c.class_id = e.class_id
          LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
              WHERE e.ssms_client_code = ?
                AND (CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,'')) LIKE ?
                     OR e.enrollment_id LIKE ? OR e.roll_number = ?)
              ORDER BY student_name LIMIT 25",
            [$this->_client(), $like, $like, $q]
        )->fetchAll('assoc');

        return $this->_out(['status' => true, 'data' => $rows]);
    }

    // ── internals ──────────────────────────────────────────────────────────

    private function _mine(): array
    {
        return StudentLeave::myEnrollmentIds($this->_client(), $this->_role(), $this->_user(),
            (string)($this->request->getAttribute('jwt_enrollment_id') ?? ''));
    }

    private function _staff(): bool
    {
        return in_array($this->_role(), StudentLeave::STAFF, true);
    }

    private function _forbidden()
    {
        return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
    }

    private function _try(callable $fn)
    {
        try {
            return $this->_out(['status' => true, 'data' => $fn()]);
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error('StudentLeaveApi: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());

            return $this->_out(['status' => false, 'message' => 'Something went wrong. Please try again.'], 500);
        }
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

    private function _out(array $data, int $status = 200)
    {
        $this->autoRender = false;

        return $this->response->withStatus($status)->withType('application/json')->withStringBody((string)json_encode($data));
    }
}
