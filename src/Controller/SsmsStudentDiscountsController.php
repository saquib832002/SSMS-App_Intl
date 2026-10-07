<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsStudentDiscounts Controller
 *
 * Combined "StudentDiscountScreen" — filter → find students → select student
 * → edit per-fee-item discounts → save.
 *
 * All logic lives in add() so the URL /ssms-student-discounts/add is the
 * canonical screen (matching the app pattern).
 *
 * @property \App\Model\Table\SsmsStudentDiscountsTable $SsmsStudentDiscounts
 */
class SsmsStudentDiscountsController extends AppController
{
    // =========================================================================
    // ADD — combined StudentDiscountScreen
    // =========================================================================

    public function add()
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $db         = ConnectionManager::get('default');

        // ── Dropdown data ─────────────────────────────────────────────────────
        $ssmsSessions = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions
             WHERE  ssms_client_code=:cc ORDER BY session_id DESC",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        $ssmsClasses = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes
             WHERE  ssms_client_code=:cc ORDER BY class_name",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        $ssmsBranchList = $db->execute(
            "SELECT branch_id, branch_name FROM ssms_branch
             WHERE  ssms_client_code=:cc ORDER BY branch_name",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        // ── State ─────────────────────────────────────────────────────────────
        $sessionId       = null;
        $classId         = null;
        $branchId        = null;
        $sectionId       = null;
        $ssmsSections    = [];
        $students        = [];
        $studentsLoaded  = false;
        $enrollmentId    = null;
        $selectedStudent = null;
        $discounts       = [];
        $discountsLoaded = false;

        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $sessionId = !empty($d['session_id']) ? (int)$d['session_id'] : null;
            $classId   = !empty($d['class_id'])   ? (int)$d['class_id']   : null;
            $branchId  = !empty($d['branch_id'])  ? (int)$d['branch_id']  : null;
            $sectionId = !empty($d['section_id']) ? (int)$d['section_id'] : null;

            $action = $d['_action'] ?? '';

            // ── Load sections for selected class ──────────────────────────────
            if ($classId) {
                $ssmsSections = $db->execute(
                    "SELECT section_id, section_name FROM ssms_sections
                     WHERE  class_id=:cls AND ssms_client_code=:cc ORDER BY section_name",
                    ['cls' => $classId, 'cc' => $clientCode]
                )->fetchAll('assoc');
            }

            // ─ FIND STUDENTS ──────────────────────────────────────────────────
            if (in_array($action, ['find_students', 'load_discounts', 'save'], true)
                && $sessionId && $classId) {

                $sql  = "SELECT e.enrollment_id, e.roll_number,
                                CONCAT(r.student_first_name, ' ', COALESCE(r.student_last_name,'')) AS student_name,
                                e.class_id, c.class_name,
                                e.section_id, s.section_name,
                                e.branch_id, b.branch_name
                         FROM   ssms_student_enrollment e
                         LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                         LEFT JOIN ssms_classes  c ON c.class_id   = e.class_id
                         LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                         LEFT JOIN ssms_branch   b ON b.branch_id  = e.branch_id
                         WHERE  e.session_id=:sid AND e.class_id=:cls
                           AND  e.ssms_client_code=:cc AND e.status='Active'";
                $params = ['sid' => $sessionId, 'cls' => $classId, 'cc' => $clientCode];

                if ($branchId)  { $sql .= " AND e.branch_id=:bid";    $params['bid']   = $branchId; }
                if ($sectionId) { $sql .= " AND e.section_id=:secid"; $params['secid'] = $sectionId; }
                $sql .= " ORDER BY student_name";

                $students       = $db->execute($sql, $params)->fetchAll('assoc');
                $studentsLoaded = true;
            }

            // ─ LOAD DISCOUNTS ─────────────────────────────────────────────────
            if (in_array($action, ['load_discounts', 'save'], true)
                && !empty($d['enrollment_id'])) {

                $enrollmentId    = $d['enrollment_id'];
                $selectedStudent = null;
                foreach ($students as $st) {
                    if ((string)$st['enrollment_id'] === (string)$enrollmentId) {
                        $selectedStudent = $st;
                        break;
                    }
                }

                // All active fee items
                $feeItems = $db->execute(
                    "SELECT fee_item_id, fee_item_name, fee_type, is_mandatory
                     FROM   ssms_fee_items
                     WHERE  ssms_client_code=:cc AND status='Active'
                     ORDER BY is_mandatory DESC, fee_item_name",
                    ['cc' => $clientCode]
                )->fetchAll('assoc');

                // Existing discounts for this student/session
                $existing = $db->execute(
                    "SELECT fee_item_id, discount_percent, discount_amount, reason
                     FROM   ssms_student_discounts
                     WHERE  enrollment_id=:eid AND session_id=:sid AND ssms_client_code=:cc",
                    ['eid' => $enrollmentId, 'sid' => $sessionId, 'cc' => $clientCode]
                )->fetchAll('assoc');
                $exIdx = [];
                foreach ($existing as $ex) { $exIdx[$ex['fee_item_id']] = $ex; }

                foreach ($feeItems as $fi) {
                    $ex = $exIdx[$fi['fee_item_id']] ?? null;
                    $discounts[] = [
                        'fee_item_id'      => $fi['fee_item_id'],
                        'fee_item_name'    => $fi['fee_item_name'],
                        'fee_type'         => $fi['fee_type'] ?? '',
                        'is_mandatory'     => $fi['is_mandatory'] ?? 'Yes',
                        'discount_percent' => $ex ? (float)$ex['discount_percent'] : 0,
                        'reason'           => $ex['reason'] ?? '',
                    ];
                }
                $discountsLoaded = true;
            }

            // ─ SAVE ───────────────────────────────────────────────────────────
            if ($action === 'save' && !empty($d['enrollment_id']) && $sessionId) {
                $items = $d['discounts'] ?? [];
                $now   = date('Y-m-d H:i:s');
                $effClassId  = $selectedStudent['class_id']  ?? $classId;
                $effBranchId = $selectedStudent['branch_id'] ?? $branchId;

                $db->begin();
                try {
                    foreach ($items as $feeItemId => $row) {
                        $pct    = max(0, min(100, (float)($row['discount_percent'] ?? 0)));
                        $reason = trim($row['reason'] ?? '');
                        $db->execute(
                            "INSERT INTO ssms_student_discounts
                                (enrollment_id, fee_item_id, session_id, class_id, branch_id,
                                 discount_percent, discount_amount, reason, ssms_client_code, created, modified)
                             VALUES (?,?,?,?,?,?,0,?,?,?,?)
                             ON DUPLICATE KEY UPDATE
                                discount_percent=VALUES(discount_percent),
                                discount_amount=VALUES(discount_amount),
                                reason=VALUES(reason),
                                modified=VALUES(modified)",
                            [$d['enrollment_id'], $feeItemId, $sessionId, $effClassId, $effBranchId,
                             $pct, $reason, $clientCode, $now, $now]
                        );
                    }
                    $db->commit();
                    $this->Flash->success('Discounts saved successfully.');
                } catch (\Exception $e) {
                    $db->rollback();
                    Log::error('saveStudentDiscounts: ' . $e->getMessage());
                    $this->Flash->error('Save failed: ' . $e->getMessage());
                }

                // Reload after save
                return $this->redirect([
                    'action' => 'add',
                    '?'      => [
                        'session_id'    => $sessionId,
                        'class_id'      => $classId,
                        'branch_id'     => $branchId  ?? '',
                        'section_id'    => $sectionId ?? '',
                        'enrollment_id' => $d['enrollment_id'],
                    ],
                ]);
            }
        }

        // ── Handle GET redirect after save ────────────────────────────────────
        if ($this->request->is('get')) {
            $q         = $this->request->getQueryParams();
            $sessionId = !empty($q['session_id'])    ? (int)$q['session_id']    : null;
            $classId   = !empty($q['class_id'])      ? (int)$q['class_id']      : null;
            $branchId  = !empty($q['branch_id'])     ? (int)$q['branch_id']     : null;
            $sectionId = !empty($q['section_id'])    ? (int)$q['section_id']    : null;
            $enrollmentId = $q['enrollment_id'] ?? null;

            if ($classId) {
                $ssmsSections = $db->execute(
                    "SELECT section_id, section_name FROM ssms_sections
                     WHERE  class_id=:cls AND ssms_client_code=:cc ORDER BY section_name",
                    ['cls' => $classId, 'cc' => $clientCode]
                )->fetchAll('assoc');
            }

            if ($sessionId && $classId) {
                $sql    = "SELECT e.enrollment_id, e.roll_number,
                                  CONCAT(r.student_first_name, ' ', COALESCE(r.student_last_name,'')) AS student_name,
                                  e.class_id, c.class_name, e.section_id, s.section_name,
                                  e.branch_id, b.branch_name
                           FROM   ssms_student_enrollment e
                           LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                           LEFT JOIN ssms_classes  c ON c.class_id   = e.class_id
                           LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                           LEFT JOIN ssms_branch   b ON b.branch_id  = e.branch_id
                           WHERE  e.session_id=:sid AND e.class_id=:cls
                             AND  e.ssms_client_code=:cc AND e.status='Active'";
                $params = ['sid' => $sessionId, 'cls' => $classId, 'cc' => $clientCode];
                if ($branchId)  { $sql .= " AND e.branch_id=:bid";    $params['bid']   = $branchId; }
                if ($sectionId) { $sql .= " AND e.section_id=:secid"; $params['secid'] = $sectionId; }
                $sql        .= " ORDER BY student_name";
                $students    = $db->execute($sql, $params)->fetchAll('assoc');
                $studentsLoaded = true;
            }

            if ($enrollmentId && $sessionId) {
                foreach ($students as $st) {
                    if ((string)$st['enrollment_id'] === (string)$enrollmentId) {
                        $selectedStudent = $st; break;
                    }
                }
                $feeItems = $db->execute(
                    "SELECT fee_item_id, fee_item_name, fee_type, is_mandatory
                     FROM   ssms_fee_items
                     WHERE  ssms_client_code=:cc AND status='Active'
                     ORDER BY is_mandatory DESC, fee_item_name",
                    ['cc' => $clientCode]
                )->fetchAll('assoc');
                $existing = $db->execute(
                    "SELECT fee_item_id, discount_percent, reason
                     FROM   ssms_student_discounts
                     WHERE  enrollment_id=:eid AND session_id=:sid AND ssms_client_code=:cc",
                    ['eid' => $enrollmentId, 'sid' => $sessionId, 'cc' => $clientCode]
                )->fetchAll('assoc');
                $exIdx = [];
                foreach ($existing as $ex) { $exIdx[$ex['fee_item_id']] = $ex; }
                foreach ($feeItems as $fi) {
                    $ex = $exIdx[$fi['fee_item_id']] ?? null;
                    $discounts[] = [
                        'fee_item_id'      => $fi['fee_item_id'],
                        'fee_item_name'    => $fi['fee_item_name'],
                        'fee_type'         => $fi['fee_type'] ?? '',
                        'is_mandatory'     => $fi['is_mandatory'] ?? 'Yes',
                        'discount_percent' => $ex ? (float)$ex['discount_percent'] : 0,
                        'reason'           => $ex['reason'] ?? '',
                    ];
                }
                $discountsLoaded = true;
            }
        }

        $this->set(compact(
            'ssmsSessions', 'ssmsClasses', 'ssmsBranchList', 'ssmsSections',
            'sessionId', 'classId', 'branchId', 'sectionId',
            'students', 'studentsLoaded',
            'enrollmentId', 'selectedStudent',
            'discounts', 'discountsLoaded'
        ));
    }

    // =========================================================================
    // GET SECTIONS — AJAX JSON endpoint
    // =========================================================================

    public function getSections()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $classId    = $this->request->getQuery('class_id');

        $sections = [];
        if ($classId) {
            $db       = ConnectionManager::get('default');
            $sections = $db->execute(
                "SELECT section_id, section_name FROM ssms_sections
                 WHERE  class_id=:cls AND ssms_client_code=:cc ORDER BY section_name",
                ['cls' => (int)$classId, 'cc' => $clientCode]
            )->fetchAll('assoc');
        }

        $this->response = $this->response->withType('application/json');
        $this->response->getBody()->write(json_encode($sections));
        return $this->response;
    }

    // =========================================================================
    // INDEX — redirect to add
    // =========================================================================

    public function index()
    {
        return $this->redirect(['action' => 'add']);
    }

    // =========================================================================
    // VIEW / EDIT / DELETE — kept minimal; real UX is add()
    // =========================================================================

    public function view($id = null)
    {
        $ssmsStudentDiscount = $this->SsmsStudentDiscounts->get($id, contain: ['SsmsFeeItems']);
        $this->set(compact('ssmsStudentDiscount'));
    }

    public function edit($id = null)
    {
        return $this->redirect(['action' => 'add']);
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $rec = $this->SsmsStudentDiscounts->get($id);
        if ($this->SsmsStudentDiscounts->delete($rec)) {
            $this->Flash->success('Discount deleted.');
        } else {
            $this->Flash->error('Could not delete. Please try again.');
        }
        return $this->redirect(['action' => 'add']);
    }
}
