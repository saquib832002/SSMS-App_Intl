<?php
namespace App\Controller;
use Cake\Datasource\ConnectionManager;
use App\Controller\AppController;
use Cake\Log\Log;

class SsmsStudentEnrollmentController extends AppController
{
    // ── Index ──────────────────────────────────────────────────────────────
    public function index()
    {
        $session = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $ssmsStudentEnrollment = $connection->execute(
            "SELECT se.*, sr.student_first_name, sr.student_last_name, sr.registration_id as reg_id,
                    cl.class_name, sec.section_name, ses.session_name
             FROM ssms_student_enrollment se
             JOIN ssms_student_registration sr ON se.registration_id = sr.registration_id
             JOIN ssms_classes cl ON se.class_id = cl.class_id
             JOIN ssms_sections sec ON se.section_id = sec.section_id
             JOIN ssms_sessions ses ON se.session_id = ses.session_id
             WHERE sr.ssms_client_code = ?",
            [$session->read('ssms_client_code')]
        );
        $this->set(compact('ssmsStudentEnrollment'));
    }

    // ── Enrolled Students ──────────────────────────────────────────────────
    public function enrolledStudents()
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');
        $role       = $session->read('ssms_user_role');
        $branchId   = $session->read('branch_id');
        $staffId    = $session->read('staff_id');

        // Read filters from GET params
        $sessionId    = $this->request->getQuery('session_id') ?: null;
        $classId      = $this->request->getQuery('class_id')   ?: null;
        $sectionId    = $this->request->getQuery('section_id') ?: null;
        $branchFilter = $this->request->getQuery('branch_id')  ?: null;
        $page         = max(1, (int)($this->request->getQuery('page') ?? 1));
        $perPage      = 25;

        $joins  = " FROM ssms_student_enrollment se
                    JOIN ssms_student_registration sr ON se.registration_id = sr.registration_id
                    JOIN ssms_classes cl ON se.class_id = cl.class_id
                    JOIN ssms_sections sec ON se.section_id = sec.section_id
                    JOIN ssms_sessions ses ON se.session_id = ses.session_id
                    LEFT JOIN ssms_branch sb ON se.branch_id = sb.branch_id";

        $where  = " WHERE sr.ssms_client_code = ? AND (se.status = 'active' OR se.status IS NULL)";
        $params = [$clientCode];

        if ($sessionId)    { $where .= " AND se.session_id = ?";  $params[] = $sessionId; }
        if ($classId)      { $where .= " AND se.class_id = ?";    $params[] = $classId; }
        if ($sectionId)    { $where .= " AND se.section_id = ?";  $params[] = $sectionId; }
        if ($branchFilter) { $where .= " AND se.branch_id = ?";   $params[] = $branchFilter; }

        if ($role === 'user') {
            // Only students in classes/sections where this staff member is assigned as teacher.
            // No branch_id filter here — staff assignments are independent of branch.
            $where .= " AND EXISTS (
                            SELECT 1 FROM ssms_subject_teacher sst
                            WHERE sst.staff_id = ?
                              AND sst.class_id = se.class_id
                              AND sst.section_id = se.section_id
                              AND sst.ssms_client_code = sr.ssms_client_code
                        )";
            $params[] = $staffId;
        } elseif ($role === 'admin') {
            $where .= " AND se.branch_id = ?";
            $params[] = $branchId;
        }

        // Total count for pagination
        $total      = (int)$connection->execute("SELECT COUNT(*)" . $joins . $where, $params)->fetchColumn(0);
        $totalPages = max(1, (int)ceil($total / $perPage));
        $page       = min($page, $totalPages);
        $offset     = ($page - 1) * $perPage;

        $select = "SELECT sr.registration_id, sr.student_first_name, sr.student_last_name,
                          sr.student_father_name, sr.student_photo, sr.admission_number,
                          se.ssms_client_code,
                          se.enrollment_id, se.branch_id, sb.branch_name,
                          cl.class_id, cl.class_name,
                          sec.section_id, sec.section_name,
                          ses.session_id, ses.session_name";

        $ssmsStudentEnrollment = $connection->execute(
            $select . $joins . $where . " ORDER BY sr.student_first_name ASC LIMIT $perPage OFFSET $offset",
            $params
        )->fetchAll('assoc');

        $ssmsSessions = $connection->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE active='Yes' AND ssms_client_code = ? ORDER BY session_name",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsClasses = $connection->execute(
            "SELECT DISTINCT sc.class_id, sc.class_name FROM ssms_student_enrollment se
             JOIN ssms_classes sc ON se.class_id = sc.class_id
             WHERE sc.ssms_client_code = ? ORDER BY sc.class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsSections = $connection->execute(
            "SELECT DISTINCT sc.section_id, sc.section_name FROM ssms_student_enrollment se
             JOIN ssms_sections sc ON se.section_id = sc.section_id
             WHERE sc.ssms_client_code = ? ORDER BY sc.section_name",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsBranches = $connection->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_name",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact(
            'ssmsStudentEnrollment', 'ssmsClasses', 'ssmsSections', 'ssmsSessions', 'ssmsBranches',
            'sessionId', 'classId', 'sectionId', 'branchFilter',
            'page', 'totalPages', 'total', 'perPage', 'role'
        ));
    }

    // ── Enrolled Classes ───────────────────────────────────────────────────
    public function enrolledClasses()
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');
        $role       = $session->read('ssms_user_role');
        $branchId   = $session->read('branch_id');
        $staffId    = $session->read('staff_id');

        $base = "SELECT sb.branch_id, sb.branch_name, ses.session_id, ses.session_name,
                        sc.class_id, sc.class_name, sec.section_id, sec.section_name,
                        COUNT(*) AS TOTAL_STUDENT
                 FROM ssms_student_enrollment se
                 JOIN ssms_classes sc ON se.class_id = sc.class_id
                 JOIN ssms_sections sec ON se.section_id = sec.section_id
                 JOIN ssms_sessions ses ON se.session_id = ses.session_id
                 JOIN ssms_branch sb ON sb.branch_id = se.branch_id
                 WHERE sc.ssms_client_code = ? AND (se.status = 'active' OR se.status IS NULL)";
        $params = [$clientCode];

        if ($role === 'user') {
            // No branch_id filter — staff assignments are independent of branch.
            $base .= " AND EXISTS (
                           SELECT 1 FROM ssms_subject_teacher sst
                           WHERE sst.staff_id = ?
                             AND sst.class_id = se.class_id
                             AND sst.section_id = se.section_id
                             AND sst.ssms_client_code = sc.ssms_client_code
                       )";
            $params[] = $staffId;
        } elseif ($role === 'admin') {
            $base .= " AND se.branch_id = ?";
            $params[] = $branchId;
        }

        $base .= " GROUP BY sb.branch_id, sb.branch_name, ses.session_id, ses.session_name,
                             sc.class_id, sc.class_name, sec.section_id, sec.section_name
                   ORDER BY sc.class_name";

        $ssmsStudentEnrollment = $connection->execute($base, $params)->fetchAll('assoc');
        $this->set(compact('ssmsStudentEnrollment', 'role'));
    }

    // ── View ───────────────────────────────────────────────────────────────
    public function view($id = null)
    {
        $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->get($id, [
            'contain' => ['SsmsStudentRegistration', 'SsmsClasses', 'SsmsSessions'],
        ]);
        $this->set('ssmsStudentEnrollment', $ssmsStudentEnrollment);
    }

    // ── Student Enroll Details ─────────────────────────────────────────────
    public function studentEnrollDetails($id = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');

        $ssmsStudentEnrollment = $connection->execute(
            "SELECT *, sr.created AS registration_date, se.created AS enrollment_date
             FROM ssms_student_enrollment se
             JOIN ssms_student_registration sr ON se.registration_id = sr.registration_id
             JOIN ssms_classes cl ON se.class_id = cl.class_id
             JOIN ssms_sections sec ON se.section_id = sec.section_id
             JOIN ssms_branch sb ON sr.branch_id = sb.branch_id
             WHERE sr.ssms_client_code = ? AND se.enrollment_id = ?",
            [$session->read('ssms_client_code'), $id]
        );

        $ssmsStudentSessionsAttended = $connection->execute(
            "SELECT ses.session_name, sc.class_name, sec.section_name, en.status
             FROM ssms_student_enrollment en
             JOIN ssms_sessions ses ON en.session_id = ses.session_id
             JOIN ssms_sections sec ON sec.section_id = en.section_id
             JOIN ssms_classes sc ON en.class_id = sc.class_id
             WHERE en.ssms_client_code = ? AND en.enrollment_id = ?
             ORDER BY ses.session_name DESC",
            [$session->read('ssms_client_code'), $id]
        );

        $this->set(compact('ssmsStudentEnrollment', 'ssmsStudentSessionsAttended'));
    }

    // ── Add ────────────────────────────────────────────────────────────────
    public function add()
    {
        $session = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');

        $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->newEmptyEntity();

        if ($this->request->is('post')) {
            $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->patchEntity(
                $ssmsStudentEnrollment, $this->request->getData()
            );
            if ($this->SsmsStudentEnrollment->save($ssmsStudentEnrollment)) {
                $this->Flash->success(__('Enrollment saved.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('Could not save enrollment. Please try again.'));
        }

        $ssmsSessions = $this->SsmsStudentEnrollment->SsmsSessions->find()
            ->select(['session_id', 'session_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->all()->combine('session_id', 'session_name')->toArray();

        $ssmsClasses = $this->SsmsStudentEnrollment->SsmsClasses->find()
            ->select(['class_id', 'class_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->all()->combine('class_id', 'class_name')->toArray();

        $ssmsSections = $this->SsmsStudentEnrollment->SsmsSections->find()
            ->select(['section_id', 'section_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->all()->combine('section_id', 'section_name')->toArray();

        $this->set(compact('ssmsStudentEnrollment', 'ssmsSessions', 'ssmsClasses', 'ssmsSections'));
    }

    // ── Enroll (main wizard) ───────────────────────────────────────────────
    public function enroll(?string $registration_id = null)
    {
        $session            = $this->request->getSession();
        $userRole           = (string)$session->read('ssms_user_role');
        $clientCode         = (string)$session->read('ssms_client_code');
        $branchIdFromSession = $session->read('branch_id');

        if (!in_array($userRole, ['admin', 'owner'], true)) {
            $this->Flash->error(__('You are not authorised to view this page.'));
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $StudentRegistrationTable = $this->fetchTable('SsmsStudentRegistration');
        $ClassesTable  = $this->fetchTable('SsmsClasses');
        $SessionsTable = $this->fetchTable('SsmsSessions');
        $SectionsTable = $this->fetchTable('SsmsSections');
        $BranchTable   = $this->fetchTable('SsmsBranch');

        $detailsFromRegistation = $StudentRegistrationTable->get($registration_id, ['contain' => []]);
        $enrollmentNum  = $this->getEnrollmentNumber($registration_id);
        $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->newEmptyEntity();

        if ($this->request->is('post')) {
            $data       = $this->request->getData();
            $sessionId  = $data['session_id']   ?? null;
            $classId    = $data['class_id']      ?? null;
            $sectionId  = $data['section_id']    ?? null;
            $branchId   = $data['branch_id']     ?? null;
            $courseMedium = $data['course_medium'] ?? null;

            //if ($this->checkFeeDefinedForClassAndSession($sessionId, $classId, $branchId)) {
                if (empty($enrollmentNum)) {
                   $enrollmentNum = $this->generateEnrollmentNumber();
                }

                if (!$this->enrollmentExistForASession($registration_id, $classId, $sectionId, $sessionId, $branchId)) {
                    if ($this->getClassHeadCount($classId, $sectionId, $sessionId, $branchId) < $this->getSectionStudentLimit($sectionId)) {
                        $nextRollNum = $this->getNextRollNumber($classId, $sectionId, $sessionId, $branchId);
                        $connection  = ConnectionManager::get('default');

                        try {
                            $connection->insert('ssms_student_enrollment', [
                                'enrollment_id'   => $enrollmentNum,
                                'roll_number'     => $nextRollNum,
                                'course_medium'   => $courseMedium,
                                'ssms_client_code'=> $clientCode,
                                'session_id'      => $sessionId,
                                'class_id'        => $classId,
                                'section_id'      => $sectionId,
                                'registration_id' => $registration_id,
                                'branch_id'       => $branchId,
                                'status'          => 'active',
                            ]);

                           // $this->insertAllFees($sessionId, $classId, $enrollmentNum, $registration_id, $branchId, 'SCH');

                            $connection->update('ssms_student_registration',
                                ['enroll_status' => 'enrolled'],
                                ['ssms_client_code' => $clientCode, 'registration_id' => $registration_id]
                            );

                            $this->Flash->success(__('Student enrolled successfully.'));
                            return $this->redirect([
                                'controller' => 'SsmsFeePaidDetails',
                                'action'     => 'feeCollection',
                                $enrollmentNum, $classId, $branchId,
                            ]);
                        } catch (\Exception $e) {
                            Log::write('error', $e->getMessage());
                            $this->Flash->error(__('Enrollment could not be saved. Please try again.'));
                        }
                    } else {
                        $this->Flash->error(__('No seat available in this section. Please choose another section.'));
                    }
                } else {
                    $this->Flash->error(__('This student is already enrolled for this session.'));
                }
            } 
            //else {
            //    $this->Flash->error(__('No fees defined for this class/session. Please set up the fee structure first.'));
            //}
        //}

        $ssmsClasses = $ClassesTable->find()->select(['class_id','class_name'])
            ->where(['ssms_client_code' => $clientCode])->orderBy(['class_name'=>'ASC'])
            ->all()->combine('class_id','class_name')->toArray();

        $ssmsSessions = $SessionsTable->find()->select(['session_id','session_name'])
            ->where(['ssms_client_code' => $clientCode])->orderBy(['session_name'=>'ASC'])
            ->all()->combine('session_id','session_name')->toArray();

        // Load all sections with class_id so the view can filter by selected class
        $ssmsSections = $SectionsTable->find()
            ->select(['section_id', 'section_name', 'class_id'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['section_name' => 'ASC'])
            ->all()
            ->toArray();

        $ssmsBranch = $BranchTable->find()->select(['branch_id','branch_name'])
            ->where(array_filter(['ssms_client_code' => $clientCode, 'branch_id' => $userRole === 'admin' ? $branchIdFromSession : null]))
            ->orderBy(['branch_name'=>'ASC'])->all()->combine('branch_id','branch_name')->toArray();

        $this->set(compact('ssmsStudentEnrollment','detailsFromRegistation','ssmsSessions','ssmsClasses','ssmsSections','ssmsBranch','enrollmentNum'));
    }

    // ── Bulk Enroll ────────────────────────────────────────────────────────
    public function bulkEnroll()
    {
        $this->request->allowMethod(['post']);
        $session    = $this->request->getSession();
        $userRole   = (string)$session->read('ssms_user_role');
        $clientCode = (string)$session->read('ssms_client_code');

        if (!in_array($userRole, ['admin', 'owner'], true)) {
            $this->Flash->error('You are not authorised to perform bulk enrollment.');
            return $this->redirect(['controller' => 'SsmsStudentRegistration', 'action' => 'registeredStudents']);
        }

        $data      = $this->request->getData();
        $regIds    = array_filter((array)($data['registration_ids'] ?? []));
        $sessionId = $data['session_id']   ?? null;
        $classId   = $data['class_id']     ?? null;
        $sectionId = $data['section_id']   ?? null;
        $branchId  = $data['branch_id']    ?? null;
        $medium    = $data['course_medium'] ?? null;

        if (empty($regIds)) {
            $this->Flash->error('No students selected.');
            return $this->redirect(['controller' => 'SsmsStudentRegistration', 'action' => 'registeredStudents']);
        }

        $connection = ConnectionManager::get('default');
        $enrolled = 0; $skipped = 0; $skipDetails = [];

        foreach ($regIds as $regId) {
            // Already enrolled in this session/class/section?
            if ($this->enrollmentExistForASession($regId, $classId, $sectionId, $sessionId, $branchId)) {
                $skipped++;
                $skipDetails[] = "$regId: already enrolled";
                continue;
            }
            // Section capacity check
            if ($this->getClassHeadCount($classId, $sectionId, $sessionId, $branchId) >= $this->getSectionStudentLimit($sectionId)) {
                $skipped++;
                $skipDetails[] = "$regId: section full";
                continue;
            }
            $enrollmentNum = $this->getEnrollmentNumber($regId) ?: $this->generateEnrollmentNumber();
            $nextRollNum   = $this->getNextRollNumber($classId, $sectionId, $sessionId, $branchId);
            try {
                $connection->insert('ssms_student_enrollment', [
                    'enrollment_id'    => $enrollmentNum,
                    'roll_number'      => $nextRollNum,
                    'course_medium'    => $medium,
                    'ssms_client_code' => $clientCode,
                    'session_id'       => $sessionId,
                    'class_id'         => $classId,
                    'section_id'       => $sectionId,
                    'registration_id'  => $regId,
                    'branch_id'        => $branchId,
                    'status'           => 'active',
                ]);
                $connection->update('ssms_student_registration',
                    ['enroll_status' => 'enrolled'],
                    ['ssms_client_code' => $clientCode, 'registration_id' => $regId]
                );
                $enrolled++;
            } catch (\Exception $e) {
                $skipped++;
                $msg = $e->getMessage();
                $skipDetails[] = "$regId: " . (stripos($msg, '1062') !== false ? 'duplicate' : substr($msg, 0, 80));
            }
        }

        if ($enrolled > 0) {
            $this->Flash->success("$enrolled student(s) enrolled successfully." . ($skipped ? " $skipped skipped." : ''));
        } else {
            $this->Flash->error('No students were enrolled.');
        }
        if (!empty($skipDetails)) {
            $this->Flash->error('Skipped: ' . implode(' | ', $skipDetails));
        }
        return $this->redirect(['controller' => 'SsmsStudentRegistration', 'action' => 'registeredStudents']);
    }

    // ── Edit ───────────────────────────────────────────────────────────────
    public function edit($id = null)
    {
        $session = $this->request->getSession();

        if ($session->read('ssms_user_role') === 'user') {
            $this->Flash->error(__('You are not authorized to do this.'));
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $clientCode = $session->read('ssms_client_code');
        $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->get($id, ['contain' => []]);

        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->patchEntity(
                $ssmsStudentEnrollment, $this->request->getData()
            );
            if ($this->SsmsStudentEnrollment->save($ssmsStudentEnrollment)) {
                $this->Flash->success(__('Enrollment updated.'));
                return $this->redirect(['action' => 'enrolledClasses']);
            }
            $this->Flash->error(__('Could not save. Please try again.'));
        }

        $ssmsClasses = $this->SsmsStudentEnrollment->SsmsClasses->find()
            ->select(['class_id','class_name'])->where(['ssms_client_code'=>$clientCode])
            ->orderBy(['class_name'=>'ASC'])->all()->combine('class_id','class_name')->toArray();

        $ssmsSessions = $this->SsmsStudentEnrollment->SsmsSessions->find()
            ->select(['session_id','session_name'])->where(['ssms_client_code'=>$clientCode])
            ->all()->combine('session_id','session_name')->toArray();

        // Fetch sections WITH class_id so the template can filter by selected class
        $ssmsSections = $this->SsmsStudentEnrollment->SsmsSections->find()
            ->select(['section_id', 'section_name', 'class_id'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['section_name' => 'ASC'])
            ->all()->toArray();

        $ssmsBranch = $this->SsmsStudentEnrollment->SsmsBranch->find()
            ->select(['branch_id','branch_name'])->where(['ssms_client_code'=>$clientCode])
            ->all()->combine('branch_id','branch_name')->toArray();

        $this->set(compact('ssmsStudentEnrollment','ssmsClasses','ssmsSessions','ssmsSections','ssmsBranch'));
    }

    // ── Delete ─────────────────────────────────────────────────────────────
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->get($id);
        if ($this->SsmsStudentEnrollment->delete($ssmsStudentEnrollment)) {
            $this->Flash->success(__('Enrollment deleted.'));
        } else {
            $this->Flash->error(__('Could not delete enrollment.'));
        }
        return $this->redirect(['action' => 'index']);
    }

    // ── Generate Enrollment Number ─────────────────────────────────────────
    public function generateEnrollmentNumber()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $prefix     = 'E' . $clientCode;
        $year       = date('Y');

        $last = $this->SsmsStudentEnrollment->find()
            ->select(['enrollment_id'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderByDesc('enrollment_id')
            ->limit(1)
            ->first();

        if ($last) {
            $pieces    = explode('-', $last->enrollment_id);
            $lastYear  = $pieces[1] ?? '';
            $thirdPart = ($year === $lastYear)
                ? str_pad((int)($pieces[2] ?? 0) + 1, 4, '0', STR_PAD_LEFT)
                : '0001';
        } else {
            $thirdPart = '0001';
        }

        return "$prefix-$year-$thirdPart";
    }

    // ── Helper: Next Roll Number ───────────────────────────────────────────
    protected function getNextRollNumber($classId, $sectionId, $sessionId, $branchId)
    {
        $session = $this->request->getSession();
        $last = $this->SsmsStudentEnrollment->find()
            ->select(['roll_number'])
            ->where([
                'ssms_client_code' => $session->read('ssms_client_code'),
                'class_id'   => $classId,
                'section_id' => $sectionId,
                'session_id' => $sessionId,
                'status'     => 'active',
                'branch_id'  => $branchId,
            ])
            ->orderByDesc('enrollment_id')
            ->limit(1)
            ->first();

        return $last
            ? str_pad((int)$last->roll_number + 1, 3, '0', STR_PAD_LEFT)
            : '001';
    }

    // ── Helper: Class Head Count ───────────────────────────────────────────
    protected function getClassHeadCount($classId, $sectionId, $sessionId, $branchId)
    {
        $session = $this->request->getSession();
        return $this->SsmsStudentEnrollment->find()
            ->where([
                'ssms_client_code' => $session->read('ssms_client_code'),
                'class_id'   => $classId,
                'section_id' => $sectionId,
                'session_id' => $sessionId,
                'branch_id'  => $branchId,
            ])
            ->count();
    }

    // ── Helper: Enrollment Exists for Session ──────────────────────────────
    protected function enrollmentExistForASession($regId, $classId, $sectionId, $sessionId, $branchId)
    {
        $session = $this->request->getSession();
        return $this->SsmsStudentEnrollment->find()
            ->where([
                'ssms_client_code' => $session->read('ssms_client_code'),
                'class_id'         => $classId,
                'section_id'       => $sectionId,
                'session_id'       => $sessionId,
                'registration_id'  => $regId,
                'branch_id'        => $branchId,
            ])
            ->count() > 0;
    }

    // ── Helper: Get Enrollment Number for existing student ─────────────────
    protected function getEnrollmentNumber($regId)
    {
        $session = $this->request->getSession();
        $row = $this->SsmsStudentEnrollment->find()
            ->select(['enrollment_id'])
            ->where([
                'ssms_client_code' => $session->read('ssms_client_code'),
                'registration_id'  => $regId,
            ])
            ->orderByDesc('enrollment_id')
            ->first();

        return $row ? $row->enrollment_id : null;
    }

    // ── Helper: Insert All Fees ────────────────────────────────────────────
    protected function insertAllFees($sessionId, $classId, $enrollmentNum, $regId, $branchId, $feeFor)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $feeItems = $connection->execute(
            "SELECT fi.fee_item_id, fi.fee_id, fs.fee_amount
             FROM ssms_fee_items fi
             JOIN ssms_fee_structure fs ON fi.fee_item_id = fs.fee_item_id
             WHERE fi.fee_for = ? AND fs.class_id = ? AND fs.session_id = ?
               AND fi.ssms_client_code = ? AND fs.branch_id = ?",
            [$feeFor, $classId, $sessionId, $clientCode, $branchId]
        );

        foreach ($feeItems as $row) {
            $result = $connection->execute(
                "INSERT INTO ssms_fee_paid_details
                 (receipt_number, fee_amount, late_fee, balance_amount, ssms_client_code,
                  session_id, class_id, branch_id, enrollment_id, registration_id,
                  fee_item_id, enrolled, ssms_user_name, fee_id)
                 VALUES (0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'Yes', ?, ?)",
                [
                    $row['fee_amount'], $row['fee_amount'], $clientCode,
                    $sessionId, $classId, $branchId, $enrollmentNum, $regId,
                    $row['fee_item_id'], $session->read('ssms_user_name'), $row['fee_id'],
                ]
            );
            if (!$result) {
                $this->Flash->error(__('A fee detail could not be inserted. Please check fee setup.'));
            }
        }
    }

    // ── Student ID Card ────────────────────────────────────────────────────
    public function studentIdCard($sessionId, $classId, $enrollmentNum = null)
    {
        $sess       = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $sess->read('ssms_client_code');

        $student = $connection->execute(
            "SELECT se.enrollment_id, se.ssms_client_code, se.roll_number,
                    sr.registration_id, sr.student_photo, sr.student_dob,
                    sr.student_first_name, sr.student_last_name,
                    cl.class_name, sec.section_name, ses.session_name,
                    scl.ssms_client_name, scl.ssms_client_header_text,
                    scl.ssms_client_address, scl.ssms_client_city, scl.logo_name
             FROM ssms_student_enrollment se
             JOIN ssms_student_registration sr ON sr.registration_id = se.registration_id
             JOIN ssms_classes cl             ON cl.class_id         = se.class_id
             JOIN ssms_sections sec           ON sec.section_id      = se.section_id
             JOIN ssms_sessions ses           ON ses.session_id      = se.session_id
             JOIN ssms_clients scl            ON scl.ssms_client_code = se.ssms_client_code
             WHERE se.ssms_client_code = ? AND se.class_id = ? AND se.enrollment_id = ?",
            [$clientCode, $classId, $enrollmentNum]
        )->fetchAssoc();

        $this->set(compact('student', 'clientCode'));
    }

    // ── Class ID Cards ─────────────────────────────────────────────────────
    public function classIdCards($sessionId, $classId, $sectionId, $branchId)
    {
        $sess       = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $sess->read('ssms_client_code');

        $students = $connection->execute(
            "SELECT se.enrollment_id, se.ssms_client_code,
                    sr.registration_id, sr.student_photo,
                    sr.student_first_name, sr.student_last_name, sr.student_dob,
                    cl.class_name, sec.section_name, ses.session_name
             FROM   ssms_student_enrollment se
             JOIN   ssms_student_registration sr  ON sr.registration_id = se.registration_id
             JOIN   ssms_classes cl               ON cl.class_id        = se.class_id
             JOIN   ssms_sections sec             ON sec.section_id     = se.section_id
             JOIN   ssms_sessions ses             ON ses.session_id     = se.session_id
             WHERE  se.ssms_client_code = ? AND se.class_id = ? AND se.session_id = ?
               AND  se.section_id = ? AND se.branch_id = ? AND se.status = 'active'
             ORDER  BY sr.student_first_name ASC, sr.student_last_name ASC",
            [$clientCode, $classId, $sessionId, $sectionId, $branchId]
        )->fetchAll('assoc');

        // School info for card header
        $schoolRow = $connection->execute(
            "SELECT ssms_client_name, ssms_client_header_text,
                    ssms_client_address, ssms_client_city, logo_name
             FROM   ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();

        $this->set(compact('students', 'schoolRow', 'clientCode',
            'sessionId', 'classId', 'sectionId', 'branchId'));
    }

    // ── Check Fee Defined ──────────────────────────────────────────────────
    protected function checkFeeDefinedForClassAndSession($sessionId, $classId, $branchId)
    {
        $session = $this->request->getSession();
        $SsmsFeeStructure = $this->fetchTable('SsmsFeeStructure');
        return $SsmsFeeStructure->find()
            ->where([
                'ssms_client_code' => $session->read('ssms_client_code'),
                'class_id'   => $classId,
                'session_id' => $sessionId,
                'branch_id'  => $branchId,
            ])
            ->count() > 0;
    }

    // ── Get Section Student Limit ──────────────────────────────────────────
    protected function getSectionStudentLimit($sectionId)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $result = $connection->execute(
            "SELECT capacity FROM ssms_sections WHERE ssms_client_code = ? AND section_id = ?",
            [$session->read('ssms_client_code'), $sectionId]
        );
        foreach ($result as $row) { return (int)$row['capacity']; }
        return 9999;
    }

    // ── Search Student ─────────────────────────────────────────────────────
    public function searchStudent()
    {
        $session = $this->request->getSession();
        if ($this->request->is('post')) {
            $q = $this->request->getData('registration_id');
            $connection = ConnectionManager::get('default');
            $searchResults = $connection->execute(
                "SELECT * FROM ssms_student_enrollment se
                 JOIN ssms_student_registration sr ON se.registration_id = sr.registration_id
                 JOIN ssms_classes cl ON se.class_id = cl.class_id
                 JOIN ssms_sections sec ON se.section_id = sec.section_id
                 JOIN ssms_sessions ses ON se.session_id = ses.session_id
                 WHERE sr.ssms_client_code = ?
                   AND (sr.registration_id = ? OR se.enrollment_id = ?
                        OR sr.student_first_name LIKE ? OR sr.student_last_name LIKE ?)
                   AND se.status = 'active'",
                [$session->read('ssms_client_code'), $q, $q, "%$q%", "%$q%"]
            );
            $this->set(compact('searchResults'));
        }
    }

    // ── Update Roll Numbers ────────────────────────────────────────────────
    public function updateRollNumber()
    {
        log::error("I am in updateRollNumber functions");
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');
        $role       = strtolower((string)$session->read('ssms_user_role'));

        // Admin / Owner only
        if (!in_array($role, ['admin', 'owner'], true)) {
            $this->Flash->error('Only admins and owners can update roll numbers.');
            return $this->redirect('/');
        }

        // Dropdown data
        $branches = $connection->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=? ORDER BY branch_name",
            [$clientCode]
        )->fetchAll('assoc');

        $sessions = $connection->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=? ORDER BY session_id DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $classes = $connection->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=? ORDER BY class_name",
            [$clientCode]
        )->fetchAll('assoc');

        // Read filters
        $branchId  = $this->request->getQuery('branch_id')  ?: null;
        $sessionId = $this->request->getQuery('session_id') ?: null;
        $classId   = $this->request->getQuery('class_id')   ?: null;
        $sectionId = $this->request->getQuery('section_id') ?: null;

        $sections = [];
        if ($classId) {
            $sections = $connection->execute(
                "SELECT section_id, section_name FROM ssms_sections WHERE class_id=? AND ssms_client_code=? ORDER BY section_name",
                [$classId, $clientCode]
            )->fetchAll('assoc');
        }

        $students = [];
        $loaded   = false;

        // ── AJAX: Save one roll number ─────────────────────────────────────
        if ($this->request->is('post') && $this->request->getQuery('ajax') === '1') {
            $this->autoRender = false;
            $this->response = $this->response->withType('application/json');
            $d              = $this->request->getData();
            $registrationId = trim((string)($d['registration_id'] ?? ''));
            $rollNumber     = trim((string)($d['roll_number'] ?? ''));

            if ($registrationId === '') {
                $this->response = $this->response->withStringBody(json_encode(['ok' => false, 'msg' => 'Invalid ID']));
                return $this->response;
            }
            $d2        = $this->request->getData();
            $sid2      = trim((string)($d2['session_id']  ?? ''));
            $cid2      = trim((string)($d2['class_id']    ?? ''));
            $secid2    = trim((string)($d2['section_id']  ?? ''));
            $bid2      = trim((string)($d2['branch_id']   ?? ''));
            $stmt = $connection->execute(
                "UPDATE ssms_student_enrollment SET roll_number=?
                 WHERE registration_id=? AND ssms_client_code=?
                   AND session_id=? AND class_id=? AND section_id=? AND branch_id=?",
                [$rollNumber !== '' ? $rollNumber : null, $registrationId, $clientCode,
                 $sid2, $cid2, $secid2, $bid2]
            );
            $rows = $stmt->rowCount();
            $this->response = $this->response->withStringBody(json_encode(['ok' => true, 'rows' => $rows]));
            return $this->response;
        }

        // ── POST: Save all roll numbers ────────────────────────────────────
        if ($this->request->is('post')) {
            $d       = $this->request->getData();
            $rolls   = $d['rolls'] ?? [];
            $sid     = trim((string)($d['session_id']  ?? ''));
            $cid     = trim((string)($d['class_id']    ?? ''));
            $secid   = trim((string)($d['section_id']  ?? ''));
            $bid     = trim((string)($d['branch_id']   ?? ''));
            $updated = 0;
            foreach ($rolls as $registrationId => $rollNumber) {
                $registrationId = trim((string)$registrationId);
                $rollNumber     = trim((string)$rollNumber);
                if ($registrationId === '') continue;
                $stmt = $connection->execute(
                    "UPDATE ssms_student_enrollment SET roll_number=?
                     WHERE registration_id=? AND ssms_client_code=?
                       AND session_id=? AND class_id=? AND section_id=? AND branch_id=?",
                    [$rollNumber !== '' ? $rollNumber : null, $registrationId, $clientCode,
                     $sid, $cid, $secid, $bid]
                );
                $updated += $stmt->rowCount();
            }
            $this->Flash->success("Roll numbers updated for $updated student(s).");
            return $this->redirect([
                'action' => 'updateRollNumber',
                '?' => ['branch_id'=>$bid,'session_id'=>$sid,'class_id'=>$cid,'section_id'=>$secid],
            ]);
        }

        // ── GET: Load students if all filters set ──────────────────────────
        if ($branchId && $sessionId && $classId && $sectionId) {
            $students = $connection->execute(
                "SELECT se.enrollment_id, se.roll_number,
                        CONCAT(sr.student_first_name, ' ', sr.student_last_name) AS student_name,
                        sr.registration_id
                 FROM   ssms_student_enrollment se
                 JOIN   ssms_student_registration sr ON sr.registration_id = se.registration_id
                 WHERE  se.ssms_client_code=? AND se.branch_id=? AND se.session_id=?
                   AND  se.class_id=? AND se.section_id=? AND se.status='active'
                 ORDER  BY CAST(se.roll_number AS UNSIGNED) ASC, sr.student_first_name ASC",
                [$clientCode, $branchId, $sessionId, $classId, $sectionId]
            )->fetchAll('assoc');
            $loaded = true;
        }

        $this->set(compact('branches','sessions','classes','sections','students',
                           'branchId','sessionId','classId','sectionId','loaded'));
    }
}
