<?php
declare(strict_types=1);
namespace App\Controller;
use Cake\Log\Log;

/**
 * ExamServiceApiController
 * File: src/Controller/ExamServiceApiController.php
 *
 * DB Table: ssms_exams
 *   exam_id          INT AUTO_INCREMENT PK
 *   exam_name        VARCHAR(150) NOT NULL
 *   ssms_client_code VARCHAR(50)  NOT NULL
 *   created          DATETIME
 *   modified         DATETIME
 *
 * Routes (add to config/routes.php):
 *   $builder->get('/ExamServiceApi/getExams',           ['controller'=>'ExamServiceApi','action'=>'getExams']);
 *   $builder->post('/ExamServiceApi/createExam',        ['controller'=>'ExamServiceApi','action'=>'createExam']);
 *   $builder->post('/ExamServiceApi/updateExam/:id',    ['controller'=>'ExamServiceApi','action'=>'updateExam'])->setPass(['id']);
 *   $builder->delete('/ExamServiceApi/deleteExam/:id',  ['controller'=>'ExamServiceApi','action'=>'deleteExam'])->setPass(['id']);
 *
 * Add 'ExamServiceApi' to:
 *   AppController.$apiControllers
 *   JwtAuthMiddleware API_PREFIXES  → '/ExamServiceApi/'
 *   Application.php CSRF regex      → ExamServiceApi
 */
class ExamServiceApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->response = $this->response->withType('application/json');
    }

    private function getClientCode(): string
    {
        return $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? '';
    }

    private function isAdminOrOwner(): bool
    {
        $role = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
        return in_array($role, ['admin', 'owner'], true);
    }

    private function jsonOk(array $data): void
    {
        $this->set(array_merge(['status' => true], $data));
        $this->viewBuilder()->setOption('serialize',
            array_keys(array_merge(['status' => true], $data))
        );
    }

    private function jsonError(int $status, string $message): void
    {
        $this->response = $this->response->withStatus($status);
        $this->set(['status' => false, 'message' => $message]);
        $this->viewBuilder()->setOption('serialize', ['status', 'message']);
    }

    // =========================================================================
    // GET /ExamServiceApi/getSchoolInfo
    // Returns ssms_client_header_text and logo_name from ssms_clients
    // =========================================================================
    public function getSchoolInfo(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $db  = $this->getTableLocator()->get('SsmsClients')->getConnection();
        $row = $db->execute(
            "SELECT ssms_client_header_text, logo_name, ssms_client_name,
                    ssms_client_address, ssms_client_phone, ssms_client_email
             FROM   ssms_clients
             WHERE  ssms_client_code = ?
             LIMIT  1",
            [$clientCode]
        )->fetchAssoc();

        if (!$row) { $this->jsonError(404, 'Client not found.'); return; }
        $this->jsonOk(['data' => $row]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getExams
    // =========================================================================
    public function getExams(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $db   = $this->getTableLocator()->get('SsmsExams')->getConnection();
        $rows = $db->execute(
            "SELECT exam_id, exam_name, COALESCE(exam_category,'Annual') AS exam_category,
                    is_released, ssms_client_code, created, modified
             FROM   ssms_exams
             WHERE  ssms_client_code = ?
             ORDER  BY exam_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    // =========================================================================
    // POST /ExamServiceApi/createExam
    // =========================================================================
    public function createExam(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $examName     = trim((string)($this->request->getData('exam_name')     ?? ''));
        $examCategory = trim((string)($this->request->getData('exam_category') ?? 'Annual'));
        $rawReleased  = $this->request->getData('is_released');
        $isReleased   = ($rawReleased === 1 || $rawReleased === true || $rawReleased === '1') ? '1' : '0';
        $validCats    = ['Annual', 'Term', 'Major', 'Minor', 'Weekly', 'Monthly'];
        if (!$examName) { $this->jsonError(422, 'exam_name is required.'); return; }
        if (!in_array($examCategory, $validCats, true)) $examCategory = 'Annual';

        $db = $this->getTableLocator()->get('SsmsExams')->getConnection();

        // Duplicate check
        $dup = $db->execute(
            "SELECT exam_id FROM ssms_exams
             WHERE LOWER(exam_name) = LOWER(?) AND ssms_client_code = ?",
            [$examName, $clientCode]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, "Exam \"{$examName}\" already exists.");
            return;
        }

        $now = date('Y-m-d H:i:s');
        $db->execute(
            "INSERT INTO ssms_exams (exam_name, exam_category, is_released, ssms_client_code, created, modified)
             VALUES (?, ?, ?, ?, ?, ?)",
            [$examName, $examCategory, $isReleased, $clientCode, $now, $now]
        );
        $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createExam [{$clientCode}] id={$newId} name={$examName} cat={$examCategory}");
        $this->jsonOk(['message' => 'Exam created successfully.', 'exam_id' => $newId]);
    }

    // =========================================================================
    // POST /ExamServiceApi/updateExam/:id
    // =========================================================================
    public function updateExam(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $examName     = trim((string)($this->request->getData('exam_name')     ?? ''));
        $examCategory = trim((string)($this->request->getData('exam_category') ?? 'Annual'));
        $rawReleased  = $this->request->getData('is_released');
        $isReleased   = ($rawReleased === 1 || $rawReleased === true || $rawReleased === '1') ? '1' : '0';
        $validCats    = ['Annual', 'Term', 'Major', 'Minor', 'Weekly', 'Monthly'];
        if (!$examName) { $this->jsonError(422, 'exam_name is required.'); return; }
        if (!in_array($examCategory, $validCats, true)) $examCategory = 'Annual';

        $db = $this->getTableLocator()->get('SsmsExams')->getConnection();

        $existing = $db->execute(
            "SELECT exam_id FROM ssms_exams WHERE exam_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Exam not found.'); return; }

        // Duplicate check excluding self
        $dup = $db->execute(
            "SELECT exam_id FROM ssms_exams
             WHERE LOWER(exam_name) = LOWER(?) AND ssms_client_code = ? AND exam_id != ?",
            [$examName, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, "Exam \"{$examName}\" already exists.");
            return;
        }

        $db->execute(
            "UPDATE ssms_exams SET exam_name = ?, exam_category = ?, is_released = ?, modified = ?
             WHERE exam_id = ? AND ssms_client_code = ?",
            [$examName, $examCategory, $isReleased, date('Y-m-d H:i:s'), $id, $clientCode]
        );

        Log::info("updateExam [{$clientCode}] id={$id} name={$examName} cat={$examCategory} released={$isReleased}");
        $this->jsonOk(['message' => 'Exam updated successfully.', 'exam_id' => $id]);
    }

    // =========================================================================
    // DELETE /ExamServiceApi/deleteExam/:id
    // =========================================================================
    public function deleteExam(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db       = $this->getTableLocator()->get('SsmsExams')->getConnection();
        $existing = $db->execute(
            "SELECT exam_id, exam_name FROM ssms_exams
             WHERE exam_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Exam not found.'); return; }

        $db->execute(
            "DELETE FROM ssms_exams WHERE exam_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteExam [{$clientCode}] id={$id} name={$existing['exam_name']}");
        $this->jsonOk(['message' => 'Exam deleted successfully.']);
    }

    // =========================================================================
    // POST /ExamServiceApi/toggleExamRelease/:id
    // Flips is_released between 0 and 1
    // =========================================================================
    public function toggleExamRelease(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db = $this->getTableLocator()->get('SsmsExams')->getConnection();

        $existing = $db->execute(
            "SELECT exam_id, exam_name, is_released
             FROM   ssms_exams
             WHERE  exam_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Exam not found.'); return; }

        $newValue = $existing['is_released'] ? 0 : 1;
        $db->execute(
            "UPDATE ssms_exams SET is_released = ?, modified = ?
             WHERE  exam_id = ? AND ssms_client_code = ?",
            [$newValue, date('Y-m-d H:i:s'), $id, $clientCode]
        );

        $msg = $newValue ? 'Exam released to students.' : 'Exam hidden from students.';
        Log::info("toggleExamRelease [{$clientCode}] id={$id} is_released={$newValue}");
        $this->jsonOk(['message' => $msg, 'is_released' => $newValue]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getClientInfo
    // Returns school name, header text and logo for marksheet header
    // =========================================================================
    public function getClientInfo(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $db  = $this->getTableLocator()->get('SsmsClients')->getConnection();
        $row = $db->execute(
            "SELECT ssms_client_name, ssms_client_header_text,
                    ssms_client_address, ssms_client_city,
                    ssms_client_state, ssms_client_phone,
                    ssms_client_email, logo_name
             FROM   ssms_clients
             WHERE  ssms_client_code = ?
             LIMIT  1",
            [$clientCode]
        )->fetchAssoc();

        if (!$row) { $this->jsonError(404, 'Client not found.'); return; }
        $this->jsonOk(['data' => $row]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getStudentsForMarksheet
    // Returns enrolled students for marksheet — only classId + examId required
    // (no subjectId needed — marksheet covers all subjects)
    // =========================================================================
    public function getStudentsForMarksheet(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $examId    = $this->request->getQuery('examId');
        $classId   = $this->request->getQuery('classId');
        $sessionId = $this->request->getQuery('sessionId');
        $sectionId = $this->request->getQuery('sectionId');
        $branchId  = $this->request->getQuery('branchId');

        if (!$classId || !$examId) {
            $this->jsonError(422, 'classId and examId are required.');
            return;
        }

        $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();

        $sql  = "SELECT DISTINCT
                    e.enrollment_id,
                    e.roll_number,
                    e.class_id,
                    e.section_id,
                    e.session_id,
                    e.branch_id,
                    r.student_first_name,
                    r.student_last_name,
                    CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name
                 FROM   ssms_student_enrollment e
                 JOIN   ssms_student_registration r ON r.registration_id = e.registration_id
                 -- Only include students who have at least one mark for this exam
                 INNER JOIN ssms_marks m ON m.enrollment_id = e.enrollment_id
                    AND m.exam_id = ? AND m.ssms_client_code = ?
                 WHERE  e.ssms_client_code = ?
                   AND  e.class_id = ?";

        $bind = [(int)$examId, $clientCode, $clientCode, (int)$classId];

        if (!empty($sectionId)) { $sql .= " AND e.section_id = ?"; $bind[] = (int)$sectionId; }
        if (!empty($sessionId)) { $sql .= " AND e.session_id = ?"; $bind[] = (int)$sessionId; }
        if (!empty($branchId))  { $sql .= " AND e.branch_id  = ?"; $bind[] = (int)$branchId;  }

        $sql .= " ORDER BY CAST(e.roll_number AS UNSIGNED) ASC, r.student_first_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getStudentsForMarks
    // Returns enrolled students with existing marks (if any) for a given
    // branch/exam/session/class/section/subject combination
    // =========================================================================
    public function getStudentsForMarks(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $branchId  = $this->request->getQuery('branchId');
        $examId    = $this->request->getQuery('examId');
        $sessionId = $this->request->getQuery('sessionId');
        $classId   = $this->request->getQuery('classId');
        $sectionId = $this->request->getQuery('sectionId');
        $subjectId = $this->request->getQuery('subjectId');

        if (!$classId || !$examId || !$subjectId) {
            $this->jsonError(422, 'classId, examId and subjectId are required.');
            return;
        }

        $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();

        // Get enrolled students (joined with registration for name/roll)
        $sql  = "SELECT
                    e.enrollment_id,
                    r.registration_id,
                    e.roll_number,
                    e.class_id,
                    e.section_id,
                    e.session_id,
                    e.branch_id,
                    r.student_first_name,
                    r.student_last_name,
                    CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                    -- Existing marks (LEFT JOIN — NULL if not yet entered)
                    m.id              AS marks_id,
                    m.theory_absent,
                    m.internal_absent,
                    m.practical_absent,
                    m.theory_marks,
                    m.internal_marks,
                    m.practical_marks,
                    m.total_marks
                 FROM   ssms_student_enrollment e
                 JOIN   ssms_student_registration r
                        ON r.registration_id   = e.registration_id
                        AND r.ssms_client_code = ?
                        AND r.enroll_status    = 'enrolled'
                 LEFT JOIN ssms_marks m ON m.enrollment_id = e.enrollment_id
                    AND m.exam_id    = ?
                    AND m.subject_id = ?
                    AND m.ssms_client_code = ?
                 WHERE  e.ssms_client_code = ?
                   AND  e.status           = 'active'
                   AND  e.class_id         = ?";

        $bind = [$clientCode, (int)$examId, (int)$subjectId, $clientCode, $clientCode, (int)$classId];

        if (!empty($sectionId)) { $sql .= " AND e.section_id = ?"; $bind[] = (int)$sectionId; }
        if (!empty($sessionId)) { $sql .= " AND e.session_id = ?"; $bind[] = (int)$sessionId; }
        if (!empty($branchId))  { $sql .= " AND e.branch_id  = ?"; $bind[] = (int)$branchId;  }

        $sql .= " ORDER BY CAST(e.roll_number AS UNSIGNED) ASC, r.student_first_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    // =========================================================================
    // POST /ExamServiceApi/saveMarks
    // Bulk upsert — accepts array of student mark rows
    // Payload: { exam_id, subject_id, session_id, class_id, section_id,
    //            branch_id, marks: [{ enrollment_id, theory_marks,
    //            internal_marks, practical_marks, total_marks }] }
    // =========================================================================
    public function saveMarks(): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        // CakePHP 5: force JSON input parsing when Content-Type is application/json
        $body = $this->request->getData();

        // If getData() returns empty, try parsing raw input directly
        if (empty($body)) {
            $rawInput = file_get_contents('php://input');
            $body     = json_decode($rawInput, true) ?? [];
            Log::debug("saveMarks: getData() was empty, parsed raw input: " . substr($rawInput, 0, 200));
        }

        $examId    = !empty($body['exam_id'])    ? (int)$body['exam_id']    : null;
        $subjectId = !empty($body['subject_id']) ? (int)$body['subject_id'] : null;
        $sessionId = !empty($body['session_id']) ? (int)$body['session_id'] : null;
        $classId   = !empty($body['class_id'])   ? (int)$body['class_id']   : null;
        $sectionId = !empty($body['section_id']) ? (int)$body['section_id'] : null;
        $branchId  = !empty($body['branch_id'])  ? (int)$body['branch_id']  : null;
        $marksArr  = $body['marks'] ?? [];

        Log::debug("saveMarks received: exam={$examId} subject={$subjectId} class={$classId} marksCount=" . count($marksArr));
        Log::debug("saveMarks first row: " . json_encode($marksArr[0] ?? 'empty'));

        if (!$examId)    { $this->jsonError(422, 'exam_id is required.');    return; }
        if (!$subjectId) { $this->jsonError(422, 'subject_id is required.'); return; }
        if (!$classId)   { $this->jsonError(422, 'class_id is required.');   return; }
        if (empty($marksArr)) { $this->jsonError(422, 'marks array is empty.'); return; }

        // Determine role for update restriction
        $callerRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));

        $db  = $this->getTableLocator()->get('SsmsMarks')->getConnection();
        $now = date('Y-m-d H:i:s');
        $saved = 0;

        // ── Fetch max marks — exam-specific first (exam_id set), fall back to
        //    class-level (exam_id IS NULL) ────────────────────────────────────
        $maxRow = $db->execute(
            "SELECT theory_max_marks, internal_max_marks, practical_max_marks, max_marks
             FROM   ssms_max_marks
             WHERE  class_id = ? AND subject_id = ? AND ssms_client_code = ?
               AND  (exam_id = ? OR exam_id IS NULL OR exam_id = 0)
             ORDER  BY (exam_id IS NULL OR exam_id = 0) ASC
             LIMIT  1",
            [$classId, $subjectId, $clientCode, $examId]
        )->fetchAssoc();

        $maxTheory    = $maxRow ? (float)$maxRow['theory_max_marks']    : null;
        $maxInternal  = $maxRow ? (float)$maxRow['internal_max_marks']  : null;
        $maxPractical = $maxRow ? (float)$maxRow['practical_max_marks'] : null;

        try {
        foreach ($marksArr as $row) {
            $enrollmentId    = !empty($row['enrollment_id']) ? trim((string)$row['enrollment_id']) : null;
            $theoryAbsent    = !empty($row['theory_absent'])   ? 1 : 0;
            $internalAbsent  = !empty($row['internal_absent']) ? 1 : 0;
            $practicalAbsent = !empty($row['practical_absent'])? 1 : 0;

            // Absent component → NULL marks (strict policy: 0 obtained, max still counts in denominator)
            $theoryMarks    = $theoryAbsent    ? null : (isset($row['theory_marks'])    ? (float)$row['theory_marks']    : null);
            $internalMarks  = $internalAbsent  ? null : (isset($row['internal_marks'])  ? (float)$row['internal_marks']  : null);
            $practicalMarks = $practicalAbsent ? null : (isset($row['practical_marks']) ? (float)$row['practical_marks'] : null);
            // Total = sum of present components only (absent component treated as 0)
            $totalMarks = ($theoryMarks ?? 0) + ($internalMarks ?? 0) + ($practicalMarks ?? 0);
            // If all three are absent, store total as NULL
            if ($theoryAbsent && $internalAbsent && $practicalAbsent) {
                $totalMarks = null;
            }

            if (!$enrollmentId) {
                Log::debug("saveMarks: skipping row — no enrollment_id: " . json_encode($row));
                continue;
            }

            // ── Backend max marks validation (skip absent components) ─────────
            if (!$theoryAbsent && $maxTheory !== null && $theoryMarks !== null && $theoryMarks > $maxTheory) {
                $this->jsonError(422, "Theory marks ({$theoryMarks}) exceed maximum ({$maxTheory}) for reg {$enrollmentId}.");
                return;
            }
            if (!$internalAbsent && $maxInternal !== null && $internalMarks !== null && $internalMarks > $maxInternal) {
                $this->jsonError(422, "Internal marks ({$internalMarks}) exceed maximum ({$maxInternal}) for reg {$enrollmentId}.");
                return;
            }
            if (!$practicalAbsent && $maxPractical !== null && $practicalMarks !== null && $practicalMarks > $maxPractical) {
                $this->jsonError(422, "Practical marks ({$practicalMarks}) exceed maximum ({$maxPractical}) for reg {$enrollmentId}.");
                return;
            }

            // Check if marks row already exists
            $existing = $db->execute(
                "SELECT id FROM ssms_marks
                 WHERE enrollment_id = ? AND exam_id = ? AND subject_id = ? AND ssms_client_code = ?",
                [$enrollmentId, $examId, $subjectId, $clientCode]
            )->fetchAssoc();

            if ($existing) {
                // User role may not update existing marks
                if ($callerRole === 'user') {
                    Log::info("saveMarks: BLOCKED update by user role for reg={$enrollmentId}");
                    $this->jsonError(403, 'Marks for this student have already been submitted and are locked. Only an admin can update them.');
                    return;
                }
                // UPDATE
                $db->execute(
                    "UPDATE ssms_marks
                     SET theory_marks=?, internal_marks=?, practical_marks=?, total_marks=?,
                         theory_absent=?, internal_absent=?, practical_absent=?, modified=?
                     WHERE id=?",
                    [$theoryMarks, $internalMarks, $practicalMarks, $totalMarks,
                     $theoryAbsent, $internalAbsent, $practicalAbsent, $now, $existing['id']]
                );
                Log::debug("saveMarks: UPDATED id={$existing['id']} reg={$enrollmentId} absent=T{$theoryAbsent}/I{$internalAbsent}/P{$practicalAbsent}");
            } else {
                // INSERT
                $db->execute(
                    "INSERT INTO ssms_marks
                        (enrollment_id, exam_id, subject_id, session_id,
                         class_id, section_id, branch_id,
                         theory_marks, internal_marks, practical_marks, total_marks,
                         theory_absent, internal_absent, practical_absent,
                         ssms_client_code, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [
                        $enrollmentId, $examId, $subjectId, $sessionId,
                        $classId, $sectionId, $branchId,
                        $theoryMarks, $internalMarks, $practicalMarks, $totalMarks,
                        $theoryAbsent, $internalAbsent, $practicalAbsent,
                        $clientCode, $now, $now,
                    ]
                );
                Log::debug("saveMarks: INSERTED reg={$enrollmentId} absent=T{$theoryAbsent}/I{$internalAbsent}/P{$practicalAbsent}");
            }
            $saved++;
        }
        } catch (\Exception $e) {
            Log::error("saveMarks DB error: " . $e->getMessage());
            $this->jsonError(500, 'Database error: ' . $e->getMessage());
            return;
        }

        Log::info("saveMarks [{$clientCode}] exam={$examId} subject={$subjectId} saved={$saved}");
        $this->jsonOk(['message' => "{$saved} student mark(s) saved successfully.", 'saved' => $saved]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getStudentsWithMarks
    // Returns distinct students who have marks entered for exam/session/class
    // =========================================================================
    public function getStudentsWithMarks(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $examId    = $this->request->getQuery('examId');
        $sessionId = $this->request->getQuery('sessionId');
        $classId   = $this->request->getQuery('classId');
        $sectionId = $this->request->getQuery('sectionId');
        $branchId  = $this->request->getQuery('branchId');

        if (!$examId || !$classId) {
            $this->jsonError(422, 'examId and classId are required.');
            return;
        }

        $db  = $this->getTableLocator()->get('SsmsMarks')->getConnection();
        $sql = "SELECT DISTINCT
                    m.enrollment_id,
                    e.roll_number,
                    CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                    r.student_first_name,
                    r.student_last_name
                FROM ssms_marks m
                JOIN ssms_student_enrollment e ON e.enrollment_id = m.enrollment_id
                JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                WHERE m.ssms_client_code = ? AND m.exam_id = ? AND m.class_id = ?";
        $bind = [$clientCode, (int)$examId, (int)$classId];

        if (!empty($sectionId)) { $sql .= " AND m.section_id = ?"; $bind[] = (int)$sectionId; }
        if (!empty($sessionId)) { $sql .= " AND m.session_id = ?"; $bind[] = (int)$sessionId; }
        if (!empty($branchId))  { $sql .= " AND m.branch_id  = ?"; $bind[] = (int)$branchId;  }
        $sql .= " ORDER BY CAST(e.roll_number AS UNSIGNED) ASC, r.student_first_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
        $this->jsonOk(['data' => $rows]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getMarksheet
    // Returns full marksheet for one student — all subjects with marks + max marks
    // =========================================================================
    public function getMarksheet(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode   = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $enrollmentId = $this->request->getQuery('enrollmentId');
        $examId       = $this->request->getQuery('examId');
        $sessionId    = $this->request->getQuery('sessionId');
        $classId      = $this->request->getQuery('classId');
        $branchId     = $this->request->getQuery('branchId');

        if (!$enrollmentId || !$examId || !$classId) {
            $this->jsonError(422, 'enrollmentId, examId and classId are required.');
            return;
        }

        $db = $this->getTableLocator()->get('SsmsMarks')->getConnection();

        // Student info
        $student = $db->execute(
            "SELECT
                e.enrollment_id, e.roll_number, e.class_id, e.section_id, e.session_id,
                r.student_first_name, r.student_last_name,
                r.registration_id,
                CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                c.class_name,
                sec.section_name,
                ses.session_name,
                b.branch_name,
                b.branch_address
             FROM   ssms_student_enrollment e
             JOIN   ssms_student_registration r ON r.registration_id = e.registration_id
             LEFT JOIN ssms_classes  c   ON c.class_id    = e.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
             LEFT JOIN ssms_sessions ses ON ses.session_id = e.session_id
             LEFT JOIN ssms_branch b   ON b.branch_id   = e.branch_id
             WHERE  e.enrollment_id = ? AND e.ssms_client_code = ?",
            [$enrollmentId, $clientCode]
        )->fetchAssoc();

        if (!$student) { $this->jsonError(404, 'Student not found.'); return; }

        // Exam info
        $exam = $db->execute(
            "SELECT exam_id, exam_name FROM ssms_exams WHERE exam_id = ? AND ssms_client_code = ?",
            [(int)$examId, $clientCode]
        )->fetchAssoc();

        // All marks for this student + exam — joined with subject + max marks.
        // Scalar subquery on ssms_max_marks prevents duplicate rows when both an
        // exam-specific row AND a class-level (exam_id IS NULL) row exist.
        $marks = $db->execute(
            "SELECT
                m.subject_id,
                sub.subject_name,
                COALESCE(cs.subject_code, '') AS subject_code,
                m.theory_absent,
                m.internal_absent,
                m.practical_absent,
                COALESCE(m.theory_marks,   0) AS theory_marks,
                COALESCE(m.internal_marks, 0) AS internal_marks,
                COALESCE(m.practical_marks,0) AS practical_marks,
                COALESCE(m.total_marks,
                    COALESCE(m.theory_marks,0) + COALESCE(m.internal_marks,0) + COALESCE(m.practical_marks,0),
                    0)                          AS total_marks,
                mm.theory_max_marks,
                mm.internal_max_marks,
                mm.practical_max_marks,
                COALESCE(
                    mm.max_marks,
                    COALESCE(mm.theory_max_marks,0)
                      + COALESCE(mm.internal_max_marks,0)
                      + COALESCE(mm.practical_max_marks,0),
                    0)                          AS subject_max_marks
             FROM   ssms_marks m
             JOIN   ssms_subjects sub ON sub.subject_id = m.subject_id
             LEFT JOIN ssms_class_subjects cs
                    ON  cs.subject_id       = m.subject_id
                    AND cs.class_id         = m.class_id
                    AND cs.ssms_client_code = m.ssms_client_code
             LEFT JOIN ssms_max_marks mm
                    ON  mm.id = (
                        SELECT id FROM ssms_max_marks
                        WHERE  subject_id       = m.subject_id
                          AND  class_id         = m.class_id
                          AND  ssms_client_code = m.ssms_client_code
                          AND  (exam_id = m.exam_id OR exam_id IS NULL OR exam_id = 0)
                        ORDER BY (exam_id IS NULL OR exam_id = 0) ASC
                        LIMIT 1
                    )
             WHERE  m.enrollment_id    = ?
               AND  m.exam_id          = ?
               AND  m.ssms_client_code = ?
             ORDER  BY sub.subject_name ASC",
            [$enrollmentId, (int)$examId, $clientCode]
        )->fetchAll('assoc');

        // Totals — strict absent policy is implicit:
        // Absent components have NULL marks → COALESCE'd to 0, so total_marks already reflects 0 for absent parts.
        // Subject max always counts toward the denominator regardless of absence.
        $totalObtained = array_sum(array_column($marks, 'total_marks'));
        $totalMax      = array_sum(array_column($marks, 'subject_max_marks'));
        $percentage    = $totalMax > 0 ? round(($totalObtained / $totalMax) * 100, 2) : 0;

        // Grade
        $grade = match(true) {
            $percentage >= 90 => 'A+',
            $percentage >= 80 => 'A',
            $percentage >= 70 => 'B+',
            $percentage >= 60 => 'B',
            $percentage >= 50 => 'C',
            $percentage >= 40 => 'D',
            default           => 'F',
        };

        $this->jsonOk([
            'data' => [
                'student'        => $student,
                'exam'           => $exam,
                'marks'          => $marks,
                'total_obtained' => $totalObtained,
                'total_max'      => $totalMax,
                'percentage'     => $percentage,
                'grade'          => $grade,
            ]
        ]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getClassMarksMatrix
    // Returns all students' marks for an exam+class in a pivot/matrix format
    // Params: examId*, classId*, sessionId, sectionId, branchId
    // =========================================================================
    public function getClassMarksMatrix(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $examId    = $this->request->getQuery('examId');
        $classId   = $this->request->getQuery('classId');
        $sessionId = $this->request->getQuery('sessionId');
        $sectionId = $this->request->getQuery('sectionId');
        $branchId  = $this->request->getQuery('branchId');

        if (!$examId || !$classId) {
            $this->jsonError(422, 'examId and classId are required.');
            return;
        }

        $db = $this->getTableLocator()->get('SsmsMarks')->getConnection();

        $sql  = "SELECT
                    e.enrollment_id,
                    e.roll_number,
                    m.section_id,
                    COALESCE(sec.section_name, '') AS section_name,
                    CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                    m.subject_id,
                    sub.subject_name,
                    COALESCE(cs.subject_code, '') AS subject_code,
                    m.theory_absent,
                    m.internal_absent,
                    m.practical_absent,
                    m.theory_marks,
                    m.internal_marks,
                    m.practical_marks,
                    COALESCE(m.total_marks,
                        COALESCE(m.theory_marks,0) + COALESCE(m.internal_marks,0) + COALESCE(m.practical_marks,0),
                        0) AS total_marks,
                    COALESCE(mm_exam.theory_max_marks,    mm_cls.theory_max_marks)    AS theory_max_marks,
                    COALESCE(mm_exam.internal_max_marks,  mm_cls.internal_max_marks)  AS internal_max_marks,
                    COALESCE(mm_exam.practical_max_marks, mm_cls.practical_max_marks) AS practical_max_marks,
                    COALESCE(
                        mm_exam.max_marks,
                        mm_cls.max_marks,
                        COALESCE(mm_exam.theory_max_marks,    mm_cls.theory_max_marks,    0)
                          + COALESCE(mm_exam.internal_max_marks,  mm_cls.internal_max_marks,  0)
                          + COALESCE(mm_exam.practical_max_marks, mm_cls.practical_max_marks, 0),
                        0
                    ) AS subject_max_marks
                 FROM ssms_marks m
                 JOIN ssms_student_enrollment e
                      ON  e.enrollment_id    = m.enrollment_id
                      AND e.ssms_client_code = m.ssms_client_code
                 JOIN ssms_student_registration r
                      ON  r.registration_id  = e.registration_id
                 JOIN ssms_subjects sub ON sub.subject_id = m.subject_id
                 LEFT JOIN ssms_sections sec
                      ON  sec.section_id     = m.section_id
                 LEFT JOIN ssms_class_subjects cs
                      ON  cs.subject_id      = m.subject_id
                      AND cs.class_id        = m.class_id
                      AND cs.ssms_client_code = m.ssms_client_code
                 LEFT JOIN ssms_max_marks mm_exam
                      ON  mm_exam.subject_id       = m.subject_id
                      AND mm_exam.class_id         = m.class_id
                      AND mm_exam.ssms_client_code = m.ssms_client_code
                      AND mm_exam.exam_id          = m.exam_id
                 LEFT JOIN ssms_max_marks mm_cls
                      ON  mm_cls.subject_id        = m.subject_id
                      AND mm_cls.class_id          = m.class_id
                      AND mm_cls.ssms_client_code  = m.ssms_client_code
                      AND (mm_cls.exam_id IS NULL OR mm_cls.exam_id = 0)
                 WHERE m.ssms_client_code = ? AND m.exam_id = ? AND m.class_id = ?";
        $bind = [$clientCode, (int)$examId, (int)$classId];

        if (!empty($sessionId)) { $sql .= " AND m.session_id = ?"; $bind[] = (int)$sessionId; }
        if (!empty($sectionId)) { $sql .= " AND m.section_id = ?"; $bind[] = (int)$sectionId; }
        if (!empty($branchId))  { $sql .= " AND m.branch_id  = ?"; $bind[] = (int)$branchId;  }

        $sql .= " ORDER BY CAST(e.roll_number AS UNSIGNED) ASC, r.student_first_name ASC, sub.subject_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');

        // Build pivot
        $subjectsMap   = [];
        $studentsMap   = [];
        $subjectMaxMap = [];   // subject_id => canonical max marks (same for all students)

        foreach ($rows as $row) {
            $sid = $row['subject_id'];
            $eid = $row['enrollment_id'];

            if (!isset($subjectsMap[$sid])) {
                $subjectsMap[$sid] = [
                    'subject_id'   => $sid,
                    'subject_name' => $row['subject_name'],
                    'subject_code' => $row['subject_code'],
                ];
            }
            // Record canonical subject max (first non-zero wins; same across all students)
            if (!isset($subjectMaxMap[$sid])) {
                $subjectMaxMap[$sid] = (float)$row['subject_max_marks'];
            }

            if (!isset($studentsMap[$eid])) {
                $studentsMap[$eid] = [
                    'enrollment_id' => $eid,
                    'roll_number'   => $row['roll_number'],
                    'student_name'  => $row['student_name'],
                    'section_id'    => $row['section_id'],
                    'section_name'  => $row['section_name'],
                    'marks'         => [],
                    'total_obtained'=> 0,
                    'total_max'     => 0,
                ];
            }

            $theory    = $row['theory_marks']    !== null ? (float)$row['theory_marks']    : null;
            $internal  = $row['internal_marks']  !== null ? (float)$row['internal_marks']  : null;
            $practical = $row['practical_marks'] !== null ? (float)$row['practical_marks'] : null;
            $total     = (float)$row['total_marks'];
            $max       = (float)$row['subject_max_marks'];

            $studentsMap[$eid]['marks'][$sid] = [
                'theory_absent'  => (int)($row['theory_absent']   ?? 0),
                'internal_absent'=> (int)($row['internal_absent'] ?? 0),
                'practical_absent'=> (int)($row['practical_absent'] ?? 0),
                'theory'        => $theory,
                'internal'      => $internal,
                'practical'     => $practical,
                'total'         => $total,
                'max'           => $max,
                'theory_max'    => $row['theory_max_marks']    !== null ? (float)$row['theory_max_marks']    : null,
                'internal_max'  => $row['internal_max_marks']  !== null ? (float)$row['internal_max_marks']  : null,
                'practical_max' => $row['practical_max_marks'] !== null ? (float)$row['practical_max_marks'] : null,
            ];
            // Strict absent policy is implicit: absent components → NULL marks → COALESCE'd to 0,
            // so total_marks already reflects 0 for absent parts. Max always counts.
            $studentsMap[$eid]['total_obtained'] += $total;
            $studentsMap[$eid]['total_max']      += $max;
        }

        // Uniform total_max: every student should be judged against the same denominator
        // (sum of max marks for ALL subjects that appear in this exam, regardless of
        // whether individual marks have been entered for that student yet).
        $globalMax = array_sum($subjectMaxMap);
        foreach ($studentsMap as &$stu) {
            $stu['total_max'] = $globalMax;
            // Recompute percentage with the corrected denominator
            $stu['percentage'] = $globalMax > 0
                ? round(($stu['total_obtained'] / $globalMax) * 100, 2)
                : 0;
        }
        unset($stu);

        // Sort subjects by name (already ordered by query but ensure consistency)
        $subjects = array_values($subjectsMap);
        $students = array_values($studentsMap);

        $this->jsonOk([
            'subjects' => $subjects,
            'students' => $students,
        ]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getExamRankings
    // Returns students ranked by total marks for a given exam+class
    // Params: examId*, classId*, sessionId, sectionId, branchId
    // =========================================================================
    public function getExamRankings(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $examId    = $this->request->getQuery('examId');
        $classId   = $this->request->getQuery('classId');
        $sessionId = $this->request->getQuery('sessionId');
        $sectionId = $this->request->getQuery('sectionId');
        $branchId  = $this->request->getQuery('branchId');

        if (!$examId)    { $this->jsonError(422, 'examId is required.');    return; }
        if (!$sessionId) { $this->jsonError(422, 'sessionId is required.'); return; }

        $db = $this->getTableLocator()->get('SsmsMarks')->getConnection();

        // obtained = COALESCE(total_marks, theory+internal+practical, 0)
        // max      = exam-specific row first, class-level fallback;
        //            then COALESCE(max_marks, theory_max+internal_max+practical_max, 0)
        $sql  = "SELECT
                    m.enrollment_id,
                    r.student_first_name,
                    r.student_last_name,
                    CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                    e.roll_number,
                    c.class_name,
                    sec.section_name,
                    SUM(
                      COALESCE(m.total_marks,
                        COALESCE(m.theory_marks,0) + COALESCE(m.internal_marks,0) + COALESCE(m.practical_marks,0),
                        0)
                    )                                     AS total_obtained,
                    SUM(
                      COALESCE(
                        mm_row.max_marks,
                        COALESCE(mm_row.theory_max_marks,0)
                          + COALESCE(mm_row.internal_max_marks,0)
                          + COALESCE(mm_row.practical_max_marks,0),
                        0)
                    )                                     AS total_max,
                    COUNT(DISTINCT m.subject_id)          AS subjects_count,
                    ROUND(
                      CASE WHEN SUM(
                        COALESCE(
                          mm_row.max_marks,
                          COALESCE(mm_row.theory_max_marks,0)
                            + COALESCE(mm_row.internal_max_marks,0)
                            + COALESCE(mm_row.practical_max_marks,0),
                          0)
                      ) > 0
                        THEN (
                          SUM(COALESCE(m.total_marks,
                            COALESCE(m.theory_marks,0)+COALESCE(m.internal_marks,0)+COALESCE(m.practical_marks,0),0))
                          /
                          SUM(COALESCE(mm_row.max_marks,
                            COALESCE(mm_row.theory_max_marks,0)+COALESCE(mm_row.internal_max_marks,0)+COALESCE(mm_row.practical_max_marks,0),0))
                        ) * 100
                        ELSE 0
                      END, 2
                    )                                     AS percentage
                 FROM   ssms_marks m
                 JOIN   ssms_student_enrollment e
                        ON  e.enrollment_id    = m.enrollment_id
                        AND e.ssms_client_code = m.ssms_client_code
                 JOIN   ssms_student_registration r
                        ON  r.registration_id  = e.registration_id
                 LEFT JOIN ssms_classes  c   ON c.class_id    = m.class_id
                 LEFT JOIN ssms_sections sec ON sec.section_id = m.section_id
                 LEFT JOIN ssms_max_marks mm_row
                        ON  mm_row.id = (
                            SELECT id FROM ssms_max_marks
                            WHERE  subject_id       = m.subject_id
                              AND  class_id         = m.class_id
                              AND  ssms_client_code = m.ssms_client_code
                              AND  (exam_id = m.exam_id OR exam_id IS NULL OR exam_id = 0)
                            ORDER BY (exam_id IS NULL OR exam_id = 0) ASC
                            LIMIT 1
                        )
                 WHERE  m.exam_id          = ?
                   AND  m.session_id       = ?
                   AND  m.ssms_client_code = ?";

        $bind = [(int)$examId, (int)$sessionId, $clientCode];

        if (!empty($classId))   { $sql .= " AND m.class_id   = ?"; $bind[] = (int)$classId;   }
        if (!empty($sectionId)) { $sql .= " AND m.section_id = ?"; $bind[] = (int)$sectionId; }
        if (!empty($branchId))  { $sql .= " AND m.branch_id  = ?"; $bind[] = (int)$branchId;  }

        $sql .= " GROUP BY m.enrollment_id, r.student_first_name, r.student_last_name,
                            e.roll_number, c.class_name, sec.section_name
                  ORDER BY total_obtained DESC, r.student_first_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');

        // ── Per-student: check if failed in ANY single subject (< 30%) ──────
        // Build a lookup: enrollment_id → true if any subject < 30%
        $subjectSql  = "SELECT m.enrollment_id,
                               COALESCE(m.total_marks,
                                 COALESCE(m.theory_marks,0)+COALESCE(m.internal_marks,0)+COALESCE(m.practical_marks,0),
                                 0) AS total_marks,
                               COALESCE(
                                 mm_row.max_marks,
                                 COALESCE(mm_row.theory_max_marks,0)
                                   + COALESCE(mm_row.internal_max_marks,0)
                                   + COALESCE(mm_row.practical_max_marks,0),
                                 0) AS subject_max
                        FROM   ssms_marks m
                        LEFT JOIN ssms_max_marks mm_row
                               ON  mm_row.id = (
                                   SELECT id FROM ssms_max_marks
                                   WHERE  subject_id       = m.subject_id
                                     AND  class_id         = m.class_id
                                     AND  ssms_client_code = m.ssms_client_code
                                     AND  (exam_id = m.exam_id OR exam_id IS NULL OR exam_id = 0)
                                   ORDER BY (exam_id IS NULL OR exam_id = 0) ASC
                                   LIMIT 1
                               )
                        WHERE  m.exam_id          = ?
                          AND  m.session_id       = ?
                          AND  m.ssms_client_code = ?";
        $subjectBind = [(int)$examId, (int)$sessionId, $clientCode];
        if (!empty($classId))   { $subjectSql .= " AND m.class_id   = ?"; $subjectBind[] = (int)$classId;   }
        if (!empty($sectionId)) { $subjectSql .= " AND m.section_id = ?"; $subjectBind[] = (int)$sectionId; }
        if (!empty($branchId))  { $subjectSql .= " AND m.branch_id  = ?"; $subjectBind[] = (int)$branchId;  }

        $subjectRows = $db->execute($subjectSql, $subjectBind)->fetchAll('assoc');

        // Build fail map — enrollment_id → true if any subject below 30%
        $failMap = [];
        foreach ($subjectRows as $sr) {
            $eid     = $sr['enrollment_id'];
            $subMax  = (float)$sr['subject_max'];
            $subPct  = $subMax > 0
                ? ((float)$sr['total_marks'] / $subMax) * 100
                : 0;
            if ($subPct < 30) {
                $failMap[$eid] = true;
            }
        }

        // Assign ranks (handle ties — same marks = same rank)
        $rank      = 0;
        $prevTotal = null;
        $skip      = 0;
        foreach ($rows as &$row) {
            $total = (float)$row['total_obtained'];
            if ($total !== $prevTotal) {
                $rank      += 1 + $skip;
                $skip      = 0;
                $prevTotal = $total;
            } else {
                $skip++;
            }
            $row['rank'] = $rank;

            $pct = (float)$row['percentage'];

            // Failed if overall < 40% OR failed in any single subject (< 30%)
            $failedSubject      = !empty($failMap[$row['enrollment_id']]);
            $row['failed_subject'] = $failedSubject;
            $row['is_passed']      = !$failedSubject && $pct >= 40;

            // Grade — forced F if failed in any subject
            $row['grade'] = (!$row['is_passed'])
                ? 'F'
                : ($pct >= 90 ? 'A+' : ($pct >= 80 ? 'A' : ($pct >= 70 ? 'B+'
                    : ($pct >= 60 ? 'B' : ($pct >= 50 ? 'C' : 'D')))));

            $row['total_obtained'] = (float)$row['total_obtained'];
            $row['total_max']      = (float)$row['total_max'];
            $row['percentage']     = $pct;
        }
        unset($row);

        // Exam info
        $exam = $db->execute(
            "SELECT exam_id, exam_name FROM ssms_exams WHERE exam_id = ? AND ssms_client_code = ?",
            [(int)$examId, $clientCode]
        )->fetchAssoc();

        $this->jsonOk([
            'data'  => $rows,
            'total' => count($rows),
            'exam'  => $exam,
        ]);
    }

    // =========================================================================
    // POST /ExamServiceApi/promoteStudents
    // Marks the current enrollment row as 'promoted', then inserts a new row
    // for the target class/section/session using the SAME enrollment_id
    // (enrollment_id is a permanent student identifier, not a per-row PK).
    // Roll number is a 3-digit zero-padded value scoped to target class/section/session.
    // Body: { enrollment_ids[], target_class_id, target_section_id?, target_session_id }
    // =========================================================================
    public function promoteStudents(): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $body             = $this->request->getData();
        $enrollmentIds    = $body['enrollment_ids']        ?? [];
        $targetBranchId   = (int)($body['target_branch_id']   ?? 0);
        $targetClassId    = (int)($body['target_class_id']    ?? 0);
        $targetSectionId  = (int)($body['target_section_id']  ?? 0);
        $targetSessionId  = (int)($body['target_session_id']  ?? 0);
        $sourceSessionId  = (int)($body['current_session_id'] ?? 0);
        $courseMedium     = trim($body['course_medium'] ?? '');

        if (empty($enrollmentIds) || !$targetClassId || !$targetSectionId || !$targetSessionId) {
            $this->jsonError(422, 'enrollment_ids, target_class_id, target_section_id and target_session_id are required.');
            return;
        }

        // Guard: cannot promote to the same session the students are currently in
        if ($sourceSessionId && $sourceSessionId === $targetSessionId) {
            $this->jsonError(422, 'Cannot promote students to the same session they are currently enrolled in.');
            return;
        }

        $db       = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
        $promoted = 0;
        $skipped  = 0;
        $errors   = [];

        foreach ($enrollmentIds as $enrollmentId) {
            $enrollmentId = trim((string)$enrollmentId);
            if (!$enrollmentId) continue;

            try {
                // 1. Fetch the enrollment row for the specific source session (if provided),
                //    otherwise fall back to the most recently created row.
                if ($sourceSessionId) {
                    $current = $db->execute(
                        "SELECT registration_id, branch_id, class_id, section_id, session_id, status, course_medium
                         FROM   ssms_student_enrollment
                         WHERE  enrollment_id = ? AND session_id = ? AND ssms_client_code = ?
                         ORDER  BY created DESC LIMIT 1",
                        [$enrollmentId, $sourceSessionId, $clientCode]
                    )->fetchAssoc();
                } else {
                    $current = $db->execute(
                        "SELECT registration_id, branch_id, class_id, section_id, session_id, status, course_medium
                         FROM   ssms_student_enrollment
                         WHERE  enrollment_id = ? AND ssms_client_code = ?
                         ORDER  BY created DESC LIMIT 1",
                        [$enrollmentId, $clientCode]
                    )->fetchAssoc();
                }

                if (!$current) { $skipped++; continue; }

                // 2. Skip inactive enrollments
                if (($current['status'] ?? '') === 'inactive') {
                    $skipped++; continue;
                }

                // 3. Skip if a row already exists for this enrollment_id in the target class + session
                $dup = $db->execute(
                    "SELECT 1 FROM ssms_student_enrollment
                     WHERE  enrollment_id = ? AND class_id = ? AND session_id = ?
                       AND  ssms_client_code = ? LIMIT 1",
                    [$enrollmentId, $targetClassId, $targetSessionId, $clientCode]
                )->fetchAssoc();

                if ($dup) { $skipped++; continue; }

                // 4. Next 3-digit roll number for target class + section + session
                //    (same logic as StudentApiController::getNextRollNumber)
                $maxRoll = $db->execute(
                    "SELECT COALESCE(MAX(CAST(roll_number AS UNSIGNED)), 0) AS max_roll
                     FROM   ssms_student_enrollment
                     WHERE  class_id = ? AND section_id = ? AND session_id = ?
                       AND  ssms_client_code = ? AND status = 'active'",
                    [$targetClassId, $targetSectionId, $targetSessionId, $clientCode]
                )->fetchAssoc();

                $nextRoll = str_pad(
                    (string)((int)($maxRoll['max_roll'] ?? 0) + 1),
                    3, '0', STR_PAD_LEFT
                );

                // 5. Mark current enrollment row as promoted
                $db->execute(
                    "UPDATE ssms_student_enrollment
                     SET    status = 'promoted', modified = NOW()
                     WHERE  enrollment_id = ? AND class_id = ? AND session_id = ?
                       AND  ssms_client_code = ?",
                    [$enrollmentId, $current['class_id'], $current['session_id'], $clientCode]
                );

                // 6. Insert new enrollment row with the SAME enrollment_id
                $db->execute(
                    "INSERT INTO ssms_student_enrollment
                        (enrollment_id, roll_number, course_medium, ssms_client_code,
                         session_id, class_id, section_id,
                         registration_id, branch_id, status, created, modified)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())",
                    [
                        $enrollmentId, $nextRoll,
                        $courseMedium ?: ($current['course_medium'] ?? ''),
                        $clientCode,
                        $targetSessionId, $targetClassId, $targetSectionId,
                        $current['registration_id'],
                        $targetBranchId ?: $current['branch_id'],
                    ]
                );

                $promoted++;

            } catch (\Exception $e) {
                Log::error("promoteStudents [{$enrollmentId}]: " . $e->getMessage());
                $errors[] = $enrollmentId;
            }
        }

        $msg = "{$promoted} student(s) promoted successfully";
        if ($skipped)        $msg .= ", {$skipped} skipped (already in target class/session or inactive)";
        if (count($errors))  $msg .= ", " . count($errors) . " failed";

        $this->jsonOk([
            'promoted' => $promoted,
            'skipped'  => $skipped,
            'errors'   => $errors,
            'message'  => $msg,
        ]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getMyMarksheets
    // Student / Parent portal — returns all exams the logged-in student has
    // marks for, together with subject-wise marks for each exam.
    // No params required; enrollment_id is read from the JWT.
    // =========================================================================
    public function getMyMarksheets(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode   = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        // Priority: (1) enrollment_id JWT claim, (2) ssmsEnrollmentId header,
        // (3) ssmsUserName header (for accounts where username = enrollment_id)
        $jwtEnrollId  = trim((string)($this->request->getAttribute('jwt_enrollment_id') ?? ''));
        $hdrEnrollId  = trim((string)($this->request->getHeaderLine('ssmsEnrollmentId') ?? ''));
        $hdrUserName  = trim((string)($this->request->getHeaderLine('ssmsUserName') ?? ''));
        $enrollmentId = $jwtEnrollId !== '' ? $jwtEnrollId
                      : ($hdrEnrollId !== '' ? $hdrEnrollId : $hdrUserName);

        if (!$enrollmentId) {
            $this->jsonError(422, 'Could not determine enrollment ID.');
            return;
        }

        $db = $this->getTableLocator()->get('SsmsMarks')->getConnection();

        // ── Student info ─────────────────────────────────────────────────────
        $student = $db->execute(
            "SELECT
                e.enrollment_id, e.roll_number, e.class_id, e.section_id,
                e.session_id, e.branch_id,
                CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                r.student_first_name, r.student_last_name,
                c.class_name,
                sec.section_name,
                ses.session_name,
                b.branch_name
             FROM   ssms_student_enrollment e
             JOIN   ssms_student_registration r ON r.registration_id = e.registration_id
             LEFT JOIN ssms_classes  c   ON c.class_id    = e.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
             LEFT JOIN ssms_sessions ses ON ses.session_id = e.session_id
             LEFT JOIN ssms_branch   b   ON b.branch_id   = e.branch_id
             WHERE  e.enrollment_id = ? AND e.ssms_client_code = ?
             LIMIT  1",
            [$enrollmentId, $clientCode]
        )->fetchAssoc();

        if (!$student) {
            $this->jsonError(404, 'Enrollment record not found.');
            return;
        }

        // ── Exams this student has marks in ──────────────────────────────────
        $exams = $db->execute(
            "SELECT DISTINCT ex.exam_id, ex.exam_name
             FROM   ssms_marks m
             JOIN   ssms_exams ex ON ex.exam_id = m.exam_id
             WHERE  m.enrollment_id    = ?
               AND  m.ssms_client_code = ?
               AND  ex.is_released     = 1
             ORDER  BY ex.exam_name ASC",
            [$enrollmentId, $clientCode]
        )->fetchAll('assoc');

        // ── Subject-wise marks for each exam ─────────────────────────────────
        $gradeFor = function(float $pct): string {
            return match(true) {
                $pct >= 90 => 'A+',
                $pct >= 80 => 'A',
                $pct >= 70 => 'B+',
                $pct >= 60 => 'B',
                $pct >= 50 => 'C',
                $pct >= 40 => 'D',
                default    => 'F',
            };
        };

        $result = [];
        foreach ($exams as $exam) {
            $classId = (int)$student['class_id'];
            $examId  = (int)$exam['exam_id'];

            $marks = $db->execute(
                "SELECT
                    m.subject_id,
                    sub.subject_name,
                    cs.subject_code,
                    m.theory_marks,
                    m.internal_marks,
                    m.practical_marks,
                    COALESCE(m.total_marks,
                        COALESCE(m.theory_marks,0)+COALESCE(m.internal_marks,0)+COALESCE(m.practical_marks,0)
                    ) AS total_marks,
                    COALESCE(mm_exam.theory_max_marks,    mm_cls.theory_max_marks)    AS theory_max_marks,
                    COALESCE(mm_exam.internal_max_marks,  mm_cls.internal_max_marks)  AS internal_max_marks,
                    COALESCE(mm_exam.practical_max_marks, mm_cls.practical_max_marks) AS practical_max_marks,
                    COALESCE(
                        mm_exam.max_marks,
                        mm_cls.max_marks,
                        COALESCE(mm_exam.theory_max_marks,    mm_cls.theory_max_marks,    0)
                          + COALESCE(mm_exam.internal_max_marks,  mm_cls.internal_max_marks,  0)
                          + COALESCE(mm_exam.practical_max_marks, mm_cls.practical_max_marks, 0),
                        0
                    ) AS subject_max_marks
                 FROM   ssms_marks m
                 JOIN   ssms_subjects sub ON sub.subject_id = m.subject_id
                 LEFT JOIN ssms_class_subjects cs
                        ON  cs.subject_id       = m.subject_id
                       AND  cs.class_id         = m.class_id
                       AND  cs.ssms_client_code = m.ssms_client_code
                 LEFT JOIN ssms_max_marks mm_exam
                        ON  mm_exam.subject_id       = m.subject_id
                       AND  mm_exam.class_id         = m.class_id
                       AND  mm_exam.ssms_client_code = m.ssms_client_code
                       AND  mm_exam.exam_id          = m.exam_id
                 LEFT JOIN ssms_max_marks mm_cls
                        ON  mm_cls.subject_id        = m.subject_id
                       AND  mm_cls.class_id          = m.class_id
                       AND  mm_cls.ssms_client_code  = m.ssms_client_code
                       AND  (mm_cls.exam_id IS NULL OR mm_cls.exam_id = 0)
                 WHERE  m.enrollment_id    = ?
                   AND  m.exam_id         = ?
                   AND  m.ssms_client_code = ?
                 ORDER  BY sub.subject_name ASC",
                [$enrollmentId, $examId, $clientCode]
            )->fetchAll('assoc');

            // Drop subjects where max marks are not configured — exam not taken for them
            $marks = array_values(array_filter($marks, fn($mk) => (float)$mk['subject_max_marks'] > 0));

            $totalObtained = 0;
            $totalMax      = 0;
            foreach ($marks as &$mk) {
                $mk['total_marks']        = (float)$mk['total_marks'];
                $mk['subject_max_marks']  = (float)$mk['subject_max_marks'];
                $mk['theory_marks']       = $mk['theory_marks']    !== null ? (float)$mk['theory_marks']    : null;
                $mk['internal_marks']     = $mk['internal_marks']  !== null ? (float)$mk['internal_marks']  : null;
                $mk['practical_marks']    = $mk['practical_marks'] !== null ? (float)$mk['practical_marks'] : null;
                $mk['theory_max_marks']   = $mk['theory_max_marks']   !== null ? (float)$mk['theory_max_marks']   : null;
                $mk['internal_max_marks'] = $mk['internal_max_marks'] !== null ? (float)$mk['internal_max_marks'] : null;
                $mk['practical_max_marks']= $mk['practical_max_marks'] !== null ? (float)$mk['practical_max_marks'] : null;

                $subPct = $mk['subject_max_marks'] > 0
                    ? round(($mk['total_marks'] / $mk['subject_max_marks']) * 100, 1)
                    : 0;
                $mk['percentage'] = $subPct;
                $mk['grade']      = $gradeFor($subPct);

                $totalObtained += $mk['total_marks'];
                $totalMax      += $mk['subject_max_marks'];
            }
            unset($mk);

            $pct = $totalMax > 0 ? round(($totalObtained / $totalMax) * 100, 2) : 0;

            // ── Rank this student among classmates for this exam ──────────────
            // Count peers whose percentage is strictly higher → rank = count + 1
            $rankRow = $db->execute(
                "SELECT
                     (SELECT COUNT(*) + 1
                      FROM (
                          SELECT m2.enrollment_id,
                                 ROUND(
                                     SUM(COALESCE(m2.total_marks,
                                         COALESCE(m2.theory_marks,0)
                                         +COALESCE(m2.internal_marks,0)
                                         +COALESCE(m2.practical_marks,0)
                                     )) / NULLIF(SUM(COALESCE(
                                         me.max_marks, mc.max_marks,
                                         COALESCE(me.theory_max_marks, mc.theory_max_marks, 0)
                                         +COALESCE(me.internal_max_marks, mc.internal_max_marks, 0)
                                         +COALESCE(me.practical_max_marks, mc.practical_max_marks, 0),
                                         0
                                     )), 0) * 100, 2
                                 ) AS peer_pct
                          FROM ssms_marks m2
                          LEFT JOIN ssms_max_marks me
                              ON  me.subject_id       = m2.subject_id
                             AND  me.class_id         = m2.class_id
                             AND  me.ssms_client_code = m2.ssms_client_code
                             AND  me.exam_id          = m2.exam_id
                          LEFT JOIN ssms_max_marks mc
                              ON  mc.subject_id       = m2.subject_id
                             AND  mc.class_id         = m2.class_id
                             AND  mc.ssms_client_code = m2.ssms_client_code
                             AND  (mc.exam_id IS NULL OR mc.exam_id = 0)
                          WHERE m2.exam_id = ? AND m2.class_id = ? AND m2.ssms_client_code = ?
                          GROUP BY m2.enrollment_id
                          HAVING peer_pct > ?
                      ) above
                     ) AS student_rank,
                     (SELECT COUNT(DISTINCT enrollment_id)
                      FROM ssms_marks
                      WHERE exam_id = ? AND class_id = ? AND ssms_client_code = ?
                     ) AS total_students",
                [$examId, $classId, $clientCode, $pct, $examId, $classId, $clientCode]
            )->fetchAssoc();

            $result[] = [
                'exam_id'        => (int)$exam['exam_id'],
                'exam_name'      => $exam['exam_name'],
                'marks'          => $marks,
                'total_obtained' => $totalObtained,
                'total_max'      => $totalMax,
                'percentage'     => $pct,
                'grade'          => $gradeFor($pct),
                'rank'           => $rankRow ? (int)$rankRow['student_rank']   : null,
                'total_students' => $rankRow ? (int)$rankRow['total_students'] : null,
            ];
        }

        $this->jsonOk([
            'student' => $student,
            'exams'   => $result,
        ]);
    }

    // =========================================================================
    // POST /ExamServiceApi/saveQuickTestMaxMarks
    // =========================================================================
    // GET /ExamServiceApi/getQuickTestMaxMarks?examId=X&classId=Y
    // Returns saved max marks rows for a specific exam + class combination.
    // =========================================================================
    public function getQuickTestMaxMarks(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $examId  = $this->request->getQuery('examId');
        $classId = $this->request->getQuery('classId');

        if (!$examId || !$classId) {
            $this->jsonError(422, 'examId and classId are required.');
            return;
        }

        $db   = $this->getTableLocator()->get('SsmsMaxMarks')->getConnection();
        $rows = $db->execute(
            "SELECT subject_id, theory_max_marks, internal_max_marks, practical_max_marks, max_marks
             FROM   ssms_max_marks
             WHERE  exam_id = ? AND class_id = ? AND ssms_client_code = ?",
            [(int)$examId, (int)$classId, $clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows]);
    }

    // =========================================================================
    // GET /ExamServiceApi/getSubjectMaxMarks?classId=X&subjectId=Y&examId=Z
    // Returns the correct max marks row for a subject in a class, preferring
    // exam-specific over class-level (same priority as saveMarks lookup).
    // =========================================================================
    public function getSubjectMaxMarks(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $classId   = $this->request->getQuery('classId');
        $subjectId = $this->request->getQuery('subjectId');
        $examId    = $this->request->getQuery('examId'); // optional

        if (!$classId || !$subjectId) {
            $this->jsonError(422, 'classId and subjectId are required.');
            return;
        }

        $db = $this->getTableLocator()->get('SsmsMaxMarks')->getConnection();

        if ($examId) {
            // Prefer exam-specific row; fall back to class-level (exam_id IS NULL)
            $row = $db->execute(
                "SELECT theory_max_marks, internal_max_marks, practical_max_marks, max_marks
                 FROM   ssms_max_marks
                 WHERE  class_id = ? AND subject_id = ? AND ssms_client_code = ?
                   AND  (exam_id = ? OR exam_id IS NULL OR exam_id = 0)
                 ORDER  BY (exam_id IS NULL OR exam_id = 0) ASC
                 LIMIT  1",
                [(int)$classId, (int)$subjectId, $clientCode, (int)$examId]
            )->fetchAssoc();
        } else {
            // No exam — class-level only
            $row = $db->execute(
                "SELECT theory_max_marks, internal_max_marks, practical_max_marks, max_marks
                 FROM   ssms_max_marks
                 WHERE  class_id = ? AND subject_id = ? AND ssms_client_code = ?
                   AND  (exam_id IS NULL OR exam_id = 0)
                 LIMIT  1",
                [(int)$classId, (int)$subjectId, $clientCode]
            )->fetchAssoc();
        }

        $this->jsonOk(['data' => $row ?: null]);
    }

    // Body: { exam_id, class_id, subjects: [{subject_id, max_marks}] }
    // Upserts rows into ssms_max_marks with exam_id set (exam-specific).
    // Existing class-level rows (exam_id IS NULL) are untouched.
    // =========================================================================
    public function saveQuickTestMaxMarks(): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $body = $this->request->getData();

        // CakePHP sometimes doesn't parse JSON bodies via getData() — fall back to raw input
        if (empty($body)) {
            $rawInput = file_get_contents('php://input');
            $body     = json_decode($rawInput, true) ?? [];
        }

        $examId   = !empty($body['exam_id'])  ? (int)$body['exam_id']  : null;
        $classId  = !empty($body['class_id']) ? (int)$body['class_id'] : null;
        $subjects = is_array($body['subjects'] ?? null) ? $body['subjects'] : [];


        if (!$examId)         { $this->jsonError(422, 'exam_id is required.');  return; }
        if (!$classId)        { $this->jsonError(422, 'class_id is required.'); return; }
        if (empty($subjects)) { $this->jsonError(422, 'At least one subject with max marks is required.'); return; }

        $db  = $this->getTableLocator()->get('SsmsExams')->getConnection();
        $now = date('Y-m-d H:i:s');

        foreach ($subjects as $sub) {
            $subjectId   = !empty($sub['subject_id'])          ? (int)$sub['subject_id']           : null;
            $maxMarks    = isset($sub['max_marks'])             ? (float)$sub['max_marks']            : null;
            $theoryMax   = isset($sub['theory_max_marks'])      ? (float)$sub['theory_max_marks']     : null;
            $internalMax = isset($sub['internal_max_marks'])    ? (float)$sub['internal_max_marks']   : null;
            $practicalMax= isset($sub['practical_max_marks'])   ? (float)$sub['practical_max_marks']  : null;

            // Skip if nothing is set
            if (!$subjectId) continue;
            if ($maxMarks === null && $theoryMax === null && $internalMax === null && $practicalMax === null) continue;

            // Check if an exam-specific row already exists
            $existing = $db->execute(
                "SELECT id FROM ssms_max_marks
                 WHERE exam_id = ? AND subject_id = ? AND class_id = ? AND ssms_client_code = ?
                 LIMIT 1",
                [$examId, $subjectId, $classId, $clientCode]
            )->fetchAssoc();

            if ($existing) {
                $db->execute(
                    "UPDATE ssms_max_marks
                     SET theory_max_marks = ?, internal_max_marks = ?, practical_max_marks = ?,
                         max_marks = ?
                     WHERE exam_id = ? AND subject_id = ? AND class_id = ? AND ssms_client_code = ?",
                    [$theoryMax, $internalMax, $practicalMax, $maxMarks,
                     $examId, $subjectId, $classId, $clientCode]
                );
            } else {
                $db->execute(
                    "INSERT INTO ssms_max_marks
                        (exam_id, subject_id, class_id, theory_max_marks, internal_max_marks,
                         practical_max_marks, max_marks, ssms_client_code)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [$examId, $subjectId, $classId, $theoryMax, $internalMax,
                     $practicalMax, $maxMarks, $clientCode]
                );
            }
        }

        $this->jsonOk(['message' => 'Max marks saved successfully.', 'exam_id' => $examId]);
    }
}