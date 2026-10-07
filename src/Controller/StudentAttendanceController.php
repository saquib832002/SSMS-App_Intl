<?php
namespace App\Controller;
use Cake\Datasource\ConnectionManager;
use App\Controller\AppController;

class StudentAttendanceController extends AppController
{
    // ── Index ──────────────────────────────────────────────────────────────
    public function index()
    {
        $session = $this->request->getSession();
        $query = $this->StudentAttendance->find()
            ->contain(['SsmsSessions', 'SsmsClasses', 'SsmsSections'])
            ->where(['StudentAttendance.ssms_client_code' => $session->read('ssms_client_code')]);
        $studentAttendances = $this->paginate($query);
        $this->set(compact('studentAttendances'));
    }

    // ── Attendance List ────────────────────────────────────────────────────
    public function attendanceList($classId = null, $sectionId = null, $bId = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        if ($this->request->is(['patch', 'post', 'put'])) {
            $classId   = $this->request->getData('class_id');
            $sectionId = $this->request->getData('section_id');
            $bId       = $this->request->getData('branch_id');
            return $this->redirect(['controller' => 'StudentAttendance', 'action' => 'attendanceList', $classId, $sectionId, $bId]);
        }

        $ssmsClasses = $connection->execute(
            "SELECT DISTINCT sc.class_id, sc.class_name
             FROM ssms_student_enrollment se
             JOIN ssms_classes sc ON se.class_id = sc.class_id
             WHERE sc.ssms_client_code = ? ORDER BY sc.class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsSections = $connection->execute(
            "SELECT DISTINCT sc.section_id, sc.section_name, sc.class_id
             FROM ssms_student_enrollment se
             JOIN ssms_sections sc ON se.section_id = sc.section_id
             WHERE sc.ssms_client_code = ? ORDER BY sc.section_name",
            [$clientCode]
        )->fetchAll('assoc');

        $role = $session->read('ssms_user_role');
        $ssmsBranchList = $this->fetchTable('SsmsBranch')->find()
            ->select(['branch_id', 'branch_name'])
            ->where(array_filter([
                'ssms_client_code' => $clientCode,
                'branch_id'        => ($role === 'admin') ? $session->read('branch_id') : null,
            ]))
            ->all()->toArray();

        // Fetch current-month attendance data when all filters are set
        $columnHeader = $presentDetails = $daysaArray = $leaveDataArray = $holidayDataArray = null;
        $currentYear  = (int)date('Y');
        $currentMonth = (int)date('n');
        if ($classId && $sectionId && $bId) {
            $returnValues     = $this->getAttendaceQuery($classId, $sectionId, $bId, $currentYear, $currentMonth);
            $columnHeader     = $returnValues[1];
            $daysaArray       = $returnValues[2];
            $leaveDataArray   = $returnValues[3];
            $holidayDataArray = $returnValues[4];
            $presentDetails   = $connection->execute($returnValues[0])->fetchAll('assoc');
        }

        $this->set(compact(
            'ssmsClasses', 'ssmsSections', 'ssmsBranchList',
            'classId', 'sectionId', 'bId',
            'columnHeader', 'presentDetails', 'daysaArray', 'leaveDataArray', 'holidayDataArray',
            'currentYear', 'currentMonth'
        ));
    }

    // ── Monthly Attendance ─────────────────────────────────────────────────
    public function monthlyAttendance($classId = null, $sectionId = null, $bId = null, $year = null, $month = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        if ($this->request->is(['patch', 'post', 'put'])) {
            $classId   = $this->request->getData('class_id');
            $sectionId = $this->request->getData('section_id');
            $bId       = $this->request->getData('branch_id');
            $year      = $this->request->getData('yearName');
            $month     = $this->request->getData('monthName');
            return $this->redirect(['action' => 'monthlyAttendance', $classId, $sectionId, $bId, $year, $month]);
        }

        $ssmsClasses = $connection->execute(
            "SELECT DISTINCT sc.class_id, sc.class_name
             FROM ssms_student_enrollment se
             JOIN ssms_classes sc ON se.class_id = sc.class_id
             WHERE sc.ssms_client_code = ? ORDER BY sc.class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsSections = $connection->execute(
            "SELECT DISTINCT sc.section_id, sc.section_name, sc.class_id
             FROM ssms_student_enrollment se
             JOIN ssms_sections sc ON se.section_id = sc.section_id
             WHERE sc.ssms_client_code = ? ORDER BY sc.section_name",
            [$clientCode]
        )->fetchAll('assoc');

        $role = $session->read('ssms_user_role');
        $ssmsBranchList = $this->fetchTable('SsmsBranch')->find()
            ->select(['branch_id', 'branch_name'])
            ->where(array_filter([
                'ssms_client_code' => $clientCode,
                'branch_id'        => ($role === 'admin') ? $session->read('branch_id') : null,
            ]))
            ->all()->toArray();

        // School name
        $schoolNameRow = $connection->execute(
            "SELECT ssms_client_name FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetch('assoc');
        $schoolName = $schoolNameRow['ssms_client_name'] ?? '';

        // Resolve selected names for report header
        $selectedClassName   = '';
        $selectedSectionName = '';
        $selectedBranchName  = '';
        if ($classId) {
            foreach ($ssmsClasses as $c) {
                if ($c['class_id'] == $classId) { $selectedClassName = $c['class_name']; break; }
            }
        }
        if ($sectionId) {
            foreach ($ssmsSections as $s) {
                if ($s['section_id'] == $sectionId) { $selectedSectionName = $s['section_name']; break; }
            }
        }
        if ($bId) {
            foreach ($ssmsBranchList as $b) {
                if ($b->branch_id == $bId) { $selectedBranchName = $b->branch_name; break; }
            }
        }

        // When filter params are present, fetch the attendance data
        $columnHeader = $presentDetails = $daysaArray = $leaveDataArray = $holidayDataArray = null;
        if ($classId && $sectionId && $bId && $year && $month) {
            $returnValues     = $this->getAttendaceQuery($classId, $sectionId, $bId, $year, $month);
            $columnHeader     = $returnValues[1];
            $daysaArray       = $returnValues[2];
            $leaveDataArray   = $returnValues[3];
            $holidayDataArray = $returnValues[4];
            $presentDetails   = $connection->execute($returnValues[0])->fetchAll('assoc');
        }

        $this->set(compact(
            'ssmsClasses', 'ssmsSections', 'ssmsBranchList',
            'classId', 'sectionId', 'bId', 'year', 'month',
            'columnHeader', 'presentDetails', 'daysaArray', 'leaveDataArray', 'holidayDataArray',
            'schoolName', 'selectedClassName', 'selectedSectionName', 'selectedBranchName'
        ));
    }

    // ── Generate Attendance Sheet (PDF) ───────────────────────────────────
    public function generateAttendanceSheet($classId = null, $sectionId = null, $bId = null, $year = null, $month = null)
    {
        if (!$classId || !$sectionId || !$bId) {
            $this->Flash->error(__('Please select class, section and branch first.'));
            return $this->redirect(['controller' => 'StudentAttendance', 'action' => 'monthlyAttendance']);
        }

        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $returnValues    = $this->getAttendaceQuery($classId, $sectionId, $bId, $year, $month);
        $columnHeaders   = $returnValues[1];
        $daysaArray      = $returnValues[2];
        $leaveDataArray  = $returnValues[3];
        $holidayDataArray= $returnValues[4];
        $presentDetails  = $connection->execute($returnValues[0]);

        $getQuery = "SELECT sc.class_id, sc.class_name, sb.branch_name, sec.section_name
                     FROM student_attendance sa
                     JOIN ssms_classes sc ON sa.class_id = sc.class_id
                     JOIN ssms_branch sb ON sb.branch_id = sa.branch_id
                     JOIN ssms_sections sec ON sec.section_id = sa.section_id
                     WHERE sa.ssms_client_code = ? AND sb.branch_id = ? AND sc.class_id = ? AND sec.section_id = ?";
        $studentClassDetails = $connection->execute($getQuery, [$clientCode, $bId, $classId, $sectionId]);

        $className = $sectionName = $branchName = '';
        foreach ($studentClassDetails as $student) {
            $className   = $student['class_name'];
            $sectionName = $student['section_name'];
            $branchName  = $student['branch_name'];
        }

        require_once $_SERVER['DOCUMENT_ROOT'] . '/fpdf/fpdf.php';

        $clientDetails = $connection->execute(
            "SELECT * FROM ssms_clients WHERE ssms_client_code = ?", [$clientCode]
        );
        $clientName = $clientAddress = $clientEmail = $clientPhone = '';
        $clientLogoName = $clientCityStatZip = $clientCurrency = '';
        foreach ($clientDetails as $cd) {
            $clientName        = $cd['ssms_client_name'];
            $clientLogoName    = $cd['logo_name'];
            $clientAddress     = $cd['ssms_client_address'];
            $clientEmail       = $cd['ssms_client_email'];
            $clientPhone       = $cd['ssms_client_phone'];
            $clientCityStatZip = $cd['ssms_client_city'] . ', ' . $cd['ssms_client_state'] . ' - ' . $cd['ssms_client_zip'];
            break;
        }

        $pdf = new \FPDF('L', 'mm', 'A4');
        $pdf->SetFillColor(255, 0, 0);
        $pdf->AddPage();
        $pdf->SetFont('Arial', 'B', 14);
        $pdf->Image($_SERVER['DOCUMENT_ROOT'] . '/clients/' . $clientCode . '/' . $clientLogoName, 80, 10, 24, 16);
        $pdf->Cell(120, 5, '', 0, 0);
        $pdf->Cell(50,  5, $clientName, 0, 0, 'C');
        $pdf->Cell(200, 5, '', 0, 1);
        $pdf->SetFont('Times', '', 12);
        $pdf->Cell(110, 5, '', 0, 0);
        $pdf->Cell(60,  5, $clientAddress, 0, 0, 'C');
        $pdf->Cell(80,  5, '', 0, 1);
        $pdf->Cell(110, 5, '', 0, 0);
        $pdf->Cell(60,  5, $clientCityStatZip, 0, 0, 'C');
        $pdf->Cell(80,  5, '', 0, 1);
        $pdf->Cell(110, 5, '', 0, 1);
        $pdf->SetTextColor(0, 0, 128);
        $pdf->Cell(100, 5, '', 0, 0);
        $pdf->SetFont('Arial', 'B', 16);
        $pdf->Cell(80,  5, 'ATTENDANCE SHEET', 0, 1, 'C');
        $pdf->SetFont('Times', '', 12);
        $pdf->SetTextColor(0, 0, 0);
        $pdf->SetFont('Times', 'B', 12);
        $pdf->Cell(20, 5, '', 0, 1);
        $pdf->Cell(30, 5, '', 0, 0);
        $pdf->Cell(40, 5, 'Class : ' . $className, 0, 0);
        $pdf->Cell(50, 5, 'Branch : ' . $branchName, 0, 0);
        $pdf->Cell(50, 5, 'Section : ' . $sectionName, 0, 0);
        $pdf->Cell(25, 5, 'Year : ' . $year, 0, 0);
        $pdf->Cell(25, 5, 'Month : ' . $month, 0, 1);
        $pdf->Cell(110, 5, '', 0, 1);

        $pdf->SetFont('Arial', '', 10);
        $i = 0;
        $pdf->Cell(20, 5, '', 0, 0);
        foreach ($columnHeaders as $header) {
            if ($i === 0)
                $pdf->Cell(32, 5, 'Enrollment#/Date->', 1, 0);
            else
                $pdf->Cell(6, 5, $header, 1, 0);
            $i++;
        }
        $pdf->Cell(12, 5, 'Total', 1, 1);

        $pdf->Cell(20, 5, '', 0, 0);
        $j = 1;
        foreach ($presentDetails as $dataRow) {
            $total = -1; $present = 0; $absent = 0; $i = -1;
            foreach ($columnHeaders as $columnheading) {
                if ($dataRow[$columnheading] == '1') {
                    $pdf->SetFillColor(255, 0, 0);
                    $pdf->SetTextColor(0, 120, 0);
                    $pdf->Cell(6, 5, 'P', 1, 0);
                    $pdf->SetTextColor(0, 8, 100);
                    $present++;
                } elseif ($dataRow[$columnheading] == '0') {
                    if ($leaveDataArray[$j][$i + 1] == '1') {
                        $pdf->SetTextColor(255, 8, 100);
                        $pdf->Cell(6, 5, 'L', 1, 0);
                        $pdf->SetTextColor(0, 8, 100);
                    } elseif ($holidayDataArray[$j][$i + 1] == '1') {
                        $pdf->SetTextColor(255, 8, 100);
                        $pdf->Cell(6, 5, 'H', 1, 0);
                        $pdf->SetTextColor(0, 8, 100);
                        $pdf->SetFillColor(255, 0, 0);
                        $total--;
                    } elseif ($daysaArray[$i] == 'Sunday') {
                        $pdf->SetFillColor(100, 120, 100);
                        $pdf->SetTextColor(0, 0, 128);
                        $pdf->Cell(6, 5, 'S', 1, 0, 'C', true);
                        $total--;
                        $pdf->SetTextColor(0, 8, 100);
                        $pdf->SetFillColor(255, 0, 0);
                    } else {
                        $pdf->SetFillColor(255, 0, 0);
                        $pdf->SetTextColor(255, 8, 100);
                        $pdf->Cell(6, 5, 'A', 1, 0);
                        $pdf->SetTextColor(0, 8, 100);
                        $absent++;
                        $pdf->SetFillColor(255, 0, 0);
                    }
                } elseif ($dataRow[$columnheading] == 'L') {
                    $pdf->SetTextColor(0, 120, 0);
                    $pdf->Cell(6, 5, 'L', 1, 0);
                    $pdf->SetTextColor(0, 8, 100);
                    $present++;
                } else {
                    $pdf->Cell(32, 5, $dataRow[$columnheading], 1, 0);
                    $pdf->SetFillColor(255, 0, 0);
                }
                $total++;
                $i++;
            }
            $pdf->SetFillColor(255, 0, 0);
            $pdf->Cell(12, 5, $present . '/' . $total, 1, 1);
            $pdf->Cell(20, 5, '', 0, 0);
            $j++;
        }

        $pdf->Output();
    }

    // ── Get Class Sections (AJAX) ──────────────────────────────────────────
    public function getClassSections()
    {
        $session  = $this->request->getSession();
        $classId  = $this->request->getQuery('class_id');
        $response = [];

        if ($this->request->getQuery('session_id') && $classId) {
            $ssmsSections = $this->StudentAttendance->SsmsSections->find()
                ->select(['section_id', 'section_name'])
                ->where([
                    'ssms_client_code' => $session->read('ssms_client_code'),
                    'class_id'         => $classId,
                ])
                ->all();
            $response = json_encode($ssmsSections);
        }

        $this->set(compact('response'));
    }

    // ── View ───────────────────────────────────────────────────────────────
    public function view($id = null)
    {
        $studentAttendance = $this->StudentAttendance->get($id, contain: ['SsmsSessions', 'SsmsClasses', 'SsmsSections']);
        $this->set('studentAttendance', $studentAttendance);
    }

    // ── Add ────────────────────────────────────────────────────────────────
    public function add()
    {
        $session = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $studentAttendance = $this->StudentAttendance->newEmptyEntity();

        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code']  = $clientCode;
            $data['attendance_date']   = date('Y-m-d', strtotime($data['attendance_date'] ?? 'now'));
            $studentAttendance = $this->StudentAttendance->patchEntity($studentAttendance, $data);
            if ($this->StudentAttendance->save($studentAttendance)) {
                $this->Flash->success(__('The student attendance has been saved.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The student attendance could not be saved. Please, try again.'));
        }

        $ssmsSessions = $this->StudentAttendance->SsmsSessions->find('list')
            ->where(['ssms_client_code' => $clientCode]);
        $ssmsClasses  = $this->StudentAttendance->SsmsClasses->find('list')
            ->where(['ssms_client_code' => $clientCode]);
        $ssmsSections = $this->StudentAttendance->SsmsSections->find('list')
            ->where(['ssms_client_code' => $clientCode]);

        $this->set(compact('studentAttendance', 'ssmsSessions', 'ssmsClasses', 'ssmsSections'));
    }

    // ── Edit ───────────────────────────────────────────────────────────────
    public function edit($id = null)
    {
        $session = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');

        $studentAttendance = $this->StudentAttendance->get($id, contain: ['SsmsSessions', 'SsmsClasses', 'SsmsSections']);

        if ($this->request->is(['patch', 'post', 'put'])) {
            $data = $this->request->getData();
            $data['attendance_date'] = date('Y-m-d', strtotime($data['attendance_date'] ?? 'now'));
            $studentAttendance = $this->StudentAttendance->patchEntity($studentAttendance, $data);
            if ($this->StudentAttendance->save($studentAttendance)) {
                $this->Flash->success(__('The student attendance has been saved.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The student attendance could not be saved. Please, try again.'));
        }

        $ssmsSessions = $this->StudentAttendance->SsmsSessions->find('list')
            ->where(['ssms_client_code' => $clientCode]);
        $ssmsClasses  = $this->StudentAttendance->SsmsClasses->find('list')
            ->where(['ssms_client_code' => $clientCode]);
        $ssmsSections = $this->StudentAttendance->SsmsSections->find('list')
            ->where(['ssms_client_code' => $clientCode]);

        $this->set(compact('studentAttendance', 'ssmsSessions', 'ssmsClasses', 'ssmsSections'));
    }

    // ── Delete ─────────────────────────────────────────────────────────────
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $studentAttendance = $this->StudentAttendance->get($id);
        if ($this->StudentAttendance->delete($studentAttendance)) {
            $this->Flash->success(__('The student attendance has been deleted.'));
        } else {
            $this->Flash->error(__('The student attendance could not be deleted. Please, try again.'));
        }
        return $this->redirect(['action' => 'index']);
    }

    // ── Attendance (take attendance for a class) ───────────────────────────
    public function attendance($class_id = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $clsId = $this->request->getQuery('clsId');
        $sesId = $this->request->getQuery('sesId');
        $secId = $this->request->getQuery('secId');
        $bId   = $this->request->getQuery('bId');

        if ($clsId && $sesId && $secId) {
            $studentListForClass = $connection->execute(
                "SELECT sr.student_first_name, sr.student_last_name,
                        se.enrollment_id, se.roll_number,
                        cl.class_name, sec.section_name, ses.session_name
                 FROM ssms_student_enrollment se
                 JOIN ssms_student_registration sr ON sr.registration_id = se.registration_id
                 JOIN ssms_classes cl     ON se.class_id   = cl.class_id
                 JOIN ssms_sections sec   ON se.section_id = sec.section_id
                 JOIN ssms_sessions ses   ON se.session_id = ses.session_id
                 WHERE se.ssms_client_code = ?
                   AND cl.class_id   = ?
                   AND ses.session_id = ?
                   AND sec.section_id = ?
                   AND se.status = 'active'
                   AND se.branch_id = ?
                 ORDER BY se.roll_number ASC",
                [$clientCode, $clsId, $sesId, $secId, $bId]
            )->fetchAll('assoc');
            $this->set(compact('studentListForClass'));

            if ($this->request->is(['patch', 'post', 'put'])) {
                $data        = $this->request->getData();
                $enrollIds   = $data['enrollment_id'] ?? [];
                $rollNumbers = $data['roll_number']    ?? [];
                $attendances = $data['attendance']     ?? [];
                $attDate     = date('Y-m-d', strtotime($data['attendance_date'] ?? 'now'));
                $flag = true;

                foreach ($enrollIds as $i => $enrollId) {
                    $record = $this->StudentAttendance->newEmptyEntity();
                    $record = $this->StudentAttendance->patchEntity($record, [
                        'ssms_client_code' => $clientCode,
                        'attendance_date'  => $attDate,
                        'class_id'         => $clsId,
                        'session_id'       => $sesId,
                        'section_id'       => $secId,
                        'branch_id'        => $bId,
                        'enrollment_id'    => $enrollId,
                        'roll_number'      => $rollNumbers[$i] ?? null,
                        'attendance'       => $attendances[$i] ?? null,
                    ]);
                    if (!$this->StudentAttendance->save($record)) {
                        $flag = false;
                    }
                }

                if ($flag) {
                    $this->Flash->success(__('The student attendance has been saved.'));
                } else {
                    $this->Flash->error(__('The student attendance could not be saved. Please, try again.'));
                }
            }
        }
    }

    // ── Get Attendance Query (helper) ──────────────────────────────────────
    public function getAttendaceQuery($classId, $sectionId, $bId, $year, $month)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $columnHeader  = ['enrollment_id'];
        $daysaArray    = [];
        $number        = cal_days_in_month(CAL_GREGORIAN, (int)$month, (int)$year);
        $presentQuery  = null;
        $leaveQuery    = null;
        $holidayQuery  = null;
        $selectBase    = "SELECT se.enrollment_id, ";

        for ($i = $number; $i >= 1; $i--) {
            $column    = date('Y-m-d', strtotime("$year-$month-$number -" . ($i - 1) . ' days'));
            $shortDate = date('d', strtotime("$year-$month-$number -" . ($i - 1) . ' days'));
            $dayValue  = date('l', strtotime("$year-$month-$number -" . ($i - 1) . ' days'));

            $presentQuery  .= " COUNT(CASE WHEN DATE_FORMAT(attendance_date,'%Y-%m-%d')='$column' AND attendance='P' THEN 1 ELSE NULL END) AS '$shortDate'";
            $leaveQuery    .= " COUNT(CASE WHEN DATE_FORMAT(attendance_date,'%Y-%m-%d')='$column' AND attendance='L' THEN 1 ELSE NULL END) AS '$shortDate'";
            $holidayQuery  .= " COUNT(CASE WHEN DATE_FORMAT(attendance_date,'%Y-%m-%d')='$column' AND attendance='H' THEN 1 ELSE NULL END) AS '$shortDate'";

            if ($i !== 1) {
                $presentQuery .= ', ';
                $leaveQuery   .= ', ';
                $holidayQuery .= ', ';
            }

            array_push($columnHeader, $shortDate);
            array_push($daysaArray, $dayValue);
        }

        $partQuery = " FROM ssms_student_enrollment se
                       LEFT JOIN student_attendance sa ON se.enrollment_id = sa.enrollment_id
                       WHERE se.ssms_client_code = '$clientCode'
                         AND se.class_id = $classId
                         AND se.section_id = $sectionId
                         AND (se.status = 'active' OR se.status IS NULL)
                         AND se.branch_id = $bId
                       GROUP BY se.enrollment_id
                       ORDER BY se.enrollment_id";

        $presentQuery  = $selectBase . $presentQuery  . $partQuery;
        $leaveQuery    = $selectBase . $leaveQuery    . $partQuery;
        $holidayQuery  = $selectBase . $holidayQuery  . $partQuery;

        $leaveDetails   = $connection->execute($leaveQuery);
        $holidayDetails = $connection->execute($holidayQuery);

        $leaveDataArray   = [[]];
        $holidayDataArray = [[]];

        foreach ($leaveDetails as $row) {
            $tmp = [];
            foreach ($columnHeader as $h) { $tmp[] = $row[$h]; }
            $leaveDataArray[] = $tmp;
        }
        foreach ($holidayDetails as $row) {
            $tmp = [];
            foreach ($columnHeader as $h) { $tmp[] = $row[$h]; }
            $holidayDataArray[] = $tmp;
        }

        return [$presentQuery, $columnHeader, $daysaArray, $leaveDataArray, $holidayDataArray];
    }
}
