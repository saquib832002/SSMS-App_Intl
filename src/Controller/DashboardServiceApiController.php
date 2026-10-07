<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\AppController;

class DashboardServiceApiController extends AppController
{
     public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
	}
    public function dashboard()
        {
            $this->request->allowMethod(['get']);

            // Debug log (correct way)
            \Cake\Log\Log::error("Dashboard API hit");

            $ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');

            try {
                // Load Tables
                $StudentsTable = $this->fetchTable('SsmsStudentEnrollment');
                $TeacherTable = $this->fetchTable('SaweraSsmsUsers');
                $BranchTable = $this->fetchTable('SsmsBranch');
                $AttendanceTable = $this->fetchTable('StudentAttendance');

                // 🏫 School name
                $db = \Cake\Datasource\ConnectionManager::get('default');
                $clientRow = $db->execute(
                    "SELECT ssms_client_header_text, logo_name FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                    [$ssmsClientCode]
                )->fetchAssoc();
                $schoolName = $clientRow['ssms_client_header_text'] ?? '';
                $logoName   = $clientRow['logo_name'] ?? '';

                // 📊 Students Count
                $students = $StudentsTable->find()
                    ->where(['ssms_client_code' => $ssmsClientCode])
                    ->count();

                // 👨‍🏫 Teachers Count
                $teachers = $TeacherTable->find()
                    ->where(['ssms_client_code' => $ssmsClientCode, 'ssms_user_role' => 'user']) // Adjust role if necessary
                    ->count();

                // 🏫 Branches Count
                $branches = $BranchTable->find()
                    ->where(['ssms_client_code' => $ssmsClientCode])
                    ->count();

                // 🏛️ Classes & Sections
                $classRow = $db->execute(
                    "SELECT COUNT(*) AS cnt FROM ssms_classes WHERE ssms_client_code = ?",
                    [$ssmsClientCode]
                )->fetchAssoc();
                $classes = (int)($classRow['cnt'] ?? 0);

                $sectionRow = $db->execute(
                    "SELECT COUNT(*) AS cnt FROM ssms_sections WHERE ssms_client_code = ?",
                    [$ssmsClientCode]
                )->fetchAssoc();
                $sections = (int)($sectionRow['cnt'] ?? 0);

                // 📈 Today's Attendance %
                $today = date('Y-m-d');

                $totalAttendance = $AttendanceTable->find()
                    ->where([
                        'ssms_client_code'  => $ssmsClientCode,
                        'attendance_date'   => $today,
                    ])
                    ->count();

                $presentCount = $AttendanceTable->find()
                    ->where([
                        'ssms_client_code'  => $ssmsClientCode,
                        'attendance_date'   => $today,
                        'attendance'        => 'P',
                    ])
                    ->count();

                $attendancePercentage = $totalAttendance > 0
                    ? round(($presentCount / $totalAttendance) * 100)
                    : 0;

                // ✅ Final Response
                $response = [
                    'students'   => (int)$students,
                    'teachers'   => (int)$teachers,
                    'branches'   => (int)$branches,
                    'classes'    => $classes,
                    'sections'   => $sections,
                    'attendance' => (int)$attendancePercentage,
                    'schoolName' => $schoolName,
                    'logoName'  => $logoName,
                ];

                $response = [
                    'success' => true,
                    'data' => $response
                ];
                return $this->response->withType('application/json')
                                     ->withStringBody(json_encode($response));
            } catch (\Exception $e) {

                \Cake\Log\Log::error($e->getMessage());

                 $response = [
                    'success' => false,
                    'data' => "error"
                ];
                
                return $this->response->withType('application/json')
                                     ->withStringBody(json_encode($response));
            }
        }
}