<?php
declare(strict_types=1);
namespace App\Controller;
use Cake\Log\Log;

/**
 * SubjectServiceApiController
 *
 * TABLE STRUCTURE (run once):
 * ─────────────────────────────────────────────────────────────────────────────
 * -- 1. Drop class_id / subject_code from ssms_subjects (migrate first!)
 * ALTER TABLE ssms_subjects DROP COLUMN IF EXISTS class_id;
 * ALTER TABLE ssms_subjects DROP COLUMN IF EXISTS subject_code;
 *
 * -- 2. Create ssms_class_subjects
 * CREATE TABLE IF NOT EXISTS ssms_class_subjects (
 *   id               INT AUTO_INCREMENT PRIMARY KEY,
 *   subject_id       INT          NOT NULL,
 *   class_id         INT          NOT NULL,
 *   subject_code     VARCHAR(30)  DEFAULT '',
 *   display_order    INT          DEFAULT 0,
 *   ssms_client_code VARCHAR(50)  NOT NULL,
 *   created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *   updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   UNIQUE KEY uq_class_subject (subject_id, class_id, ssms_client_code)
 * );
 *
 * -- 3. Optional: migrate existing class_id data
 * INSERT IGNORE INTO ssms_class_subjects (subject_id, class_id, subject_code, ssms_client_code)
 * SELECT subject_id, class_id, subject_code, ssms_client_code
 * FROM ssms_subjects WHERE class_id IS NOT NULL;
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Routes to add in config/routes.php:
 *   $builder->get('/SubjectServiceApi/getSubjects',           ['controller'=>'SubjectServiceApi','action'=>'getSubjects']);
 *   $builder->post('/SubjectServiceApi/createSubject',        ['controller'=>'SubjectServiceApi','action'=>'createSubject']);
 *   $builder->post('/SubjectServiceApi/updateSubject/:id',    ['controller'=>'SubjectServiceApi','action'=>'updateSubject'])->setPass(['id']);
 *   $builder->delete('/SubjectServiceApi/deleteSubject/:id',  ['controller'=>'SubjectServiceApi','action'=>'deleteSubject'])->setPass(['id']);
 *
 *   $builder->get('/SubjectServiceApi/getClassSubjects',          ['controller'=>'SubjectServiceApi','action'=>'getClassSubjects']);
 *   $builder->post('/SubjectServiceApi/createClassSubject',       ['controller'=>'SubjectServiceApi','action'=>'createClassSubject']);
 *   $builder->post('/SubjectServiceApi/updateClassSubject/:id',   ['controller'=>'SubjectServiceApi','action'=>'updateClassSubject'])->setPass(['id']);
 *   $builder->delete('/SubjectServiceApi/deleteClassSubject/:id', ['controller'=>'SubjectServiceApi','action'=>'deleteClassSubject'])->setPass(['id']);
 */
class SubjectServiceApiController extends AppController
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

    private function db(): \Cake\Database\Connection
    {
        return $this->getTableLocator()->get('SsmsSubjects')->getConnection();
    }

    // =========================================================================
    // SUBJECTS  (school-wide catalogue — no class_id here)
    // =========================================================================

    // GET /SubjectServiceApi/getSubjects
    // Returns all subjects with how many classes each is assigned to.
    public function getSubjects(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $rows = $this->db()->execute(
            "SELECT s.subject_id, s.subject_name, s.ssms_client_code,
                    COUNT(cs.id) AS class_count
             FROM   ssms_subjects s
             LEFT JOIN ssms_class_subjects cs
                    ON cs.subject_id = s.subject_id
                   AND cs.ssms_client_code = s.ssms_client_code
             WHERE  s.ssms_client_code = ?
             GROUP  BY s.subject_id, s.subject_name, s.ssms_client_code
             ORDER  BY s.subject_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    // POST /SubjectServiceApi/createSubject
    public function createSubject(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode  = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $body        = $this->request->getData();
        $subjectName = trim((string)($body['subject_name'] ?? ''));

        if (!$subjectName) { $this->jsonError(422, 'subject_name is required.'); return; }

        $db = $this->db();

        $dup = $db->execute(
            "SELECT subject_id FROM ssms_subjects
             WHERE LOWER(subject_name) = LOWER(?) AND ssms_client_code = ?",
            [$subjectName, $clientCode]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, "Subject \"{$subjectName}\" already exists.");
            return;
        }

        $db->execute(
            "INSERT INTO ssms_subjects (subject_name, ssms_client_code) VALUES (?, ?)",
            [$subjectName, $clientCode]
        );
        $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createSubject [{$clientCode}] id={$newId} name={$subjectName}");
        $this->jsonOk(['message' => 'Subject created successfully.', 'subject_id' => $newId]);
    }

    // POST /SubjectServiceApi/updateSubject/:id
    public function updateSubject(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $body        = $this->request->getData();
        $subjectName = trim((string)($body['subject_name'] ?? ''));

        if (!$subjectName) { $this->jsonError(422, 'subject_name is required.'); return; }

        $db = $this->db();

        $existing = $db->execute(
            "SELECT subject_id FROM ssms_subjects WHERE subject_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Subject not found.'); return; }

        $dup = $db->execute(
            "SELECT subject_id FROM ssms_subjects
             WHERE LOWER(subject_name) = LOWER(?) AND ssms_client_code = ? AND subject_id != ?",
            [$subjectName, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, "Subject \"{$subjectName}\" already exists.");
            return;
        }

        $db->execute(
            "UPDATE ssms_subjects SET subject_name = ?
             WHERE  subject_id = ? AND ssms_client_code = ?",
            [$subjectName, $id, $clientCode]
        );

        Log::info("updateSubject [{$clientCode}] id={$id} name={$subjectName}");
        $this->jsonOk(['message' => 'Subject updated successfully.', 'subject_id' => $id]);
    }

    // DELETE /SubjectServiceApi/deleteSubject/:id
    public function deleteSubject(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db = $this->db();

        $existing = $db->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects
             WHERE subject_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Subject not found.'); return; }

        // Block deletion if assigned to any class
        $assigned = $db->execute(
            "SELECT id FROM ssms_class_subjects
             WHERE subject_id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();
        if ($assigned) {
            $this->jsonError(409,
                "Cannot delete \"{$existing['subject_name']}\" — it is assigned to one or more classes. " .
                "Remove the class assignments first."
            );
            return;
        }

        $db->execute(
            "DELETE FROM ssms_subjects WHERE subject_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteSubject [{$clientCode}] id={$id} name={$existing['subject_name']}");
        $this->jsonOk(['message' => 'Subject deleted successfully.']);
    }

    // =========================================================================
    // CLASS SUBJECTS  (subject ↔ class assignments)
    // =========================================================================

    // GET /SubjectServiceApi/getClassSubjects?classId=X
    public function getClassSubjects(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $classId = $this->request->getQuery('classId');
        $db      = $this->db();

        $sql  = "SELECT cs.id, cs.subject_id, cs.class_id,
                        cs.subject_code, cs.display_order, cs.ssms_client_code,
                        s.subject_name,
                        c.class_name
                 FROM   ssms_class_subjects cs
                 LEFT JOIN ssms_subjects s ON s.subject_id = cs.subject_id
                 LEFT JOIN ssms_classes  c ON c.class_id   = cs.class_id
                 WHERE  cs.ssms_client_code = ?";
        $bind = [$clientCode];

        if (!empty($classId)) {
            $sql  .= " AND cs.class_id = ?";
            $bind[] = (int)$classId;
        }
        $sql .= " ORDER BY c.class_name ASC, cs.display_order ASC, s.subject_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    // POST /SubjectServiceApi/createClassSubject
    public function createClassSubject(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $body         = $this->request->getData();
        $subjectId    = !empty($body['subject_id'])    ? (int)$body['subject_id']    : null;
        $classId      = !empty($body['class_id'])      ? (int)$body['class_id']      : null;
        $subjectCode  = trim((string)($body['subject_code']  ?? ''));
        $displayOrder = isset($body['display_order'])  ? (int)$body['display_order'] : 0;

        if (!$subjectId) { $this->jsonError(422, 'subject_id is required.'); return; }
        if (!$classId)   { $this->jsonError(422, 'class_id is required.');   return; }

        $db = $this->db();

        $dup = $db->execute(
            "SELECT id FROM ssms_class_subjects
             WHERE subject_id = ? AND class_id = ? AND ssms_client_code = ?",
            [$subjectId, $classId, $clientCode]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, 'This subject is already assigned to the selected class.');
            return;
        }

        $db->execute(
            "INSERT INTO ssms_class_subjects
                (subject_id, class_id, subject_code, display_order, ssms_client_code, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
            [$subjectId, $classId, $subjectCode, $displayOrder, $clientCode]
        );
        $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createClassSubject [{$clientCode}] id={$newId} subjectId={$subjectId} classId={$classId}");
        $this->jsonOk(['message' => 'Class subject assigned successfully.', 'id' => $newId]);
    }

    // POST /SubjectServiceApi/updateClassSubject/:id
    public function updateClassSubject(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $body         = $this->request->getData();
        $subjectId    = !empty($body['subject_id'])    ? (int)$body['subject_id']    : null;
        $classId      = !empty($body['class_id'])      ? (int)$body['class_id']      : null;
        $subjectCode  = trim((string)($body['subject_code']  ?? ''));
        $displayOrder = isset($body['display_order'])  ? (int)$body['display_order'] : 0;

        if (!$subjectId) { $this->jsonError(422, 'subject_id is required.'); return; }
        if (!$classId)   { $this->jsonError(422, 'class_id is required.');   return; }

        $db = $this->db();

        $existing = $db->execute(
            "SELECT id FROM ssms_class_subjects WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Assignment not found.'); return; }

        // Duplicate check excluding self
        $dup = $db->execute(
            "SELECT id FROM ssms_class_subjects
             WHERE subject_id = ? AND class_id = ? AND ssms_client_code = ? AND id != ?",
            [$subjectId, $classId, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, 'This subject is already assigned to the selected class.');
            return;
        }

        $db->execute(
            "UPDATE ssms_class_subjects
             SET subject_id = ?, class_id = ?, subject_code = ?,
                 display_order = ?, updated_at = NOW()
             WHERE id = ? AND ssms_client_code = ?",
            [$subjectId, $classId, $subjectCode, $displayOrder, $id, $clientCode]
        );

        Log::info("updateClassSubject [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Class subject updated successfully.', 'id' => $id]);
    }

    // DELETE /SubjectServiceApi/deleteClassSubject/:id
    public function deleteClassSubject(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db = $this->db();

        $existing = $db->execute(
            "SELECT id FROM ssms_class_subjects WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Assignment not found.'); return; }

        $db->execute(
            "DELETE FROM ssms_class_subjects WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteClassSubject [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Class subject removed successfully.']);
    }

    // =========================================================================
    // SUBJECT TEACHERS
    // =========================================================================

    public function getSubjectTeachers(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $staffId = $this->request->getQuery('staffId');

        $db     = $this->db();
        $where  = 'WHERE st.ssms_client_code = ?';
        $params = [$clientCode];
        if ($staffId) {
            $where   .= ' AND st.staff_id = ?';
            $params[] = (int)$staffId;
        }

        $rows = $db->execute(
            "SELECT st.id, st.branch_id, st.class_id, st.section_id,
                    st.subject_id, st.staff_id, st.ssms_client_code,
                    b.branch_name,
                    c.class_name,
                    sec.section_name,
                    sub.subject_name,
                    cs.subject_code,
                    CONCAT(COALESCE(stf.first_name,''), ' ', COALESCE(stf.last_name,'')) AS staff_name
             FROM   ssms_subject_teacher st
             LEFT JOIN ssms_branch   b   ON b.branch_id    = st.branch_id
             LEFT JOIN ssms_classes  c   ON c.class_id     = st.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = st.section_id
             LEFT JOIN ssms_subjects sub ON sub.subject_id = st.subject_id
             LEFT JOIN ssms_class_subjects cs
                    ON cs.subject_id = st.subject_id AND cs.class_id = st.class_id
                   AND cs.ssms_client_code = st.ssms_client_code
             LEFT JOIN ssms_staff    stf ON stf.staff_id   = st.staff_id
             $where
             ORDER  BY c.class_name ASC, sec.section_name ASC, sub.subject_name ASC",
            $params
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    public function createSubjectTeacher(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $body      = $this->request->getData();
        $branchId  = !empty($body['branch_id'])  ? (int)$body['branch_id']  : null;
        $classId   = !empty($body['class_id'])   ? (int)$body['class_id']   : null;
        $sectionId = !empty($body['section_id']) ? (int)$body['section_id'] : null;
        $subjectId = !empty($body['subject_id']) ? (int)$body['subject_id'] : null;
        $staffId   = !empty($body['staff_id'])   ? (int)$body['staff_id']   : null;

        if (!$classId)   { $this->jsonError(422, 'class_id is required.');   return; }
        if (!$subjectId) { $this->jsonError(422, 'subject_id is required.'); return; }
        if (!$staffId)   { $this->jsonError(422, 'staff_id is required.');   return; }

        $db  = $this->db();
        $dup = $db->execute(
            "SELECT id FROM ssms_subject_teacher
             WHERE subject_id = ? AND section_id <=> ? AND ssms_client_code = ?",
            [$subjectId, $sectionId, $clientCode]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, 'Subject already assigned for this section.'); return; }

        $db->execute(
            "INSERT INTO ssms_subject_teacher
                (branch_id, class_id, section_id, subject_id, staff_id, ssms_client_code)
             VALUES (?, ?, ?, ?, ?, ?)",
            [$branchId, $classId, $sectionId, $subjectId, $staffId, $clientCode]
        );
        $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;
        Log::info("createSubjectTeacher [{$clientCode}] id={$newId}");
        $this->jsonOk(['message' => 'Assignment created successfully.', 'id' => $newId]);
    }

    public function updateSubjectTeacher(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $body      = $this->request->getData();
        $branchId  = !empty($body['branch_id'])  ? (int)$body['branch_id']  : null;
        $classId   = !empty($body['class_id'])   ? (int)$body['class_id']   : null;
        $sectionId = !empty($body['section_id']) ? (int)$body['section_id'] : null;
        $subjectId = !empty($body['subject_id']) ? (int)$body['subject_id'] : null;
        $staffId   = !empty($body['staff_id'])   ? (int)$body['staff_id']   : null;

        if (!$classId)   { $this->jsonError(422, 'class_id is required.');   return; }
        if (!$subjectId) { $this->jsonError(422, 'subject_id is required.'); return; }
        if (!$staffId)   { $this->jsonError(422, 'staff_id is required.');   return; }

        $db       = $this->db();
        $existing = $db->execute(
            "SELECT id FROM ssms_subject_teacher WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Assignment not found.'); return; }

        $dup = $db->execute(
            "SELECT id FROM ssms_subject_teacher
             WHERE subject_id = ? AND section_id <=> ? AND ssms_client_code = ? AND id != ?",
            [$subjectId, $sectionId, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, 'Subject already assigned for this section.'); return; }

        $db->execute(
            "UPDATE ssms_subject_teacher
             SET branch_id=?, class_id=?, section_id=?, subject_id=?, staff_id=?
             WHERE id=? AND ssms_client_code=?",
            [$branchId, $classId, $sectionId, $subjectId, $staffId, $id, $clientCode]
        );
        Log::info("updateSubjectTeacher [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Assignment updated successfully.', 'id' => $id]);
    }

    public function deleteSubjectTeacher(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db       = $this->db();
        $existing = $db->execute(
            "SELECT id FROM ssms_subject_teacher WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Assignment not found.'); return; }

        $db->execute(
            "DELETE FROM ssms_subject_teacher WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );
        Log::info("deleteSubjectTeacher [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Assignment deleted successfully.']);
    }

    // =========================================================================
    // MAX MARKS
    // =========================================================================

    public function getMaxMarks(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $classId = $this->request->getQuery('classId');
        $db      = $this->db();

        $sql  = "SELECT m.id, m.class_id, m.subject_id,
                        m.theory_max_marks, m.internal_max_marks, m.practical_max_marks,
                        m.max_marks, m.ssms_client_code,
                        c.class_name,
                        s.subject_name,
                        cs.subject_code
                 FROM   ssms_max_marks m
                 LEFT JOIN ssms_classes  c  ON c.class_id   = m.class_id
                 LEFT JOIN ssms_subjects s  ON s.subject_id = m.subject_id
                 LEFT JOIN ssms_class_subjects cs
                        ON cs.subject_id = m.subject_id AND cs.class_id = m.class_id
                       AND cs.ssms_client_code = m.ssms_client_code
                 WHERE  m.ssms_client_code = ?";
        $bind = [$clientCode];

        if (!empty($classId)) { $sql .= " AND m.class_id = ?"; $bind[] = (int)$classId; }
        $sql .= " ORDER BY c.class_name ASC, s.subject_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    public function createMaxMarks(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $body      = $this->request->getData();
        $classId   = !empty($body['class_id'])   ? (int)$body['class_id']   : null;
        $subjectId = !empty($body['subject_id']) ? (int)$body['subject_id'] : null;
        $theory    = isset($body['theory_max_marks'])    ? (float)$body['theory_max_marks']    : 0;
        $internal  = isset($body['internal_max_marks'])  ? (float)$body['internal_max_marks']  : 0;
        $practical = isset($body['practical_max_marks']) ? (float)$body['practical_max_marks'] : 0;
        $maxMarks  = $theory + $internal + $practical;

        if (!$classId)   { $this->jsonError(422, 'class_id is required.');   return; }
        if (!$subjectId) { $this->jsonError(422, 'subject_id is required.'); return; }

        $db  = $this->db();
        $dup = $db->execute(
            "SELECT id FROM ssms_max_marks WHERE class_id = ? AND subject_id = ? AND ssms_client_code = ?",
            [$classId, $subjectId, $clientCode]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, 'Max marks already defined for this class and subject.');
            return;
        }

        $db->execute(
            "INSERT INTO ssms_max_marks
                (class_id, subject_id, theory_max_marks, internal_max_marks,
                 practical_max_marks, max_marks, ssms_client_code)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$classId, $subjectId, $theory, $internal, $practical, $maxMarks, $clientCode]
        );
        $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createMaxMarks [{$clientCode}] id={$newId} class={$classId} subject={$subjectId}");
        $this->jsonOk(['message' => 'Max marks created successfully.', 'id' => $newId]);
    }

    public function updateMaxMarks(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $body      = $this->request->getData();
        $classId   = !empty($body['class_id'])   ? (int)$body['class_id']   : null;
        $subjectId = !empty($body['subject_id']) ? (int)$body['subject_id'] : null;
        $theory    = isset($body['theory_max_marks'])    ? (float)$body['theory_max_marks']    : 0;
        $internal  = isset($body['internal_max_marks'])  ? (float)$body['internal_max_marks']  : 0;
        $practical = isset($body['practical_max_marks']) ? (float)$body['practical_max_marks'] : 0;
        $maxMarks  = $theory + $internal + $practical;

        if (!$classId)   { $this->jsonError(422, 'class_id is required.');   return; }
        if (!$subjectId) { $this->jsonError(422, 'subject_id is required.'); return; }

        $db       = $this->db();
        $existing = $db->execute(
            "SELECT id FROM ssms_max_marks WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Record not found.'); return; }

        $dup = $db->execute(
            "SELECT id FROM ssms_max_marks
             WHERE class_id = ? AND subject_id = ? AND ssms_client_code = ? AND id != ?",
            [$classId, $subjectId, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) {
            $this->jsonError(409, 'Max marks already defined for this class and subject.');
            return;
        }

        $db->execute(
            "UPDATE ssms_max_marks
             SET class_id=?, subject_id=?, theory_max_marks=?,
                 internal_max_marks=?, practical_max_marks=?, max_marks=?
             WHERE id=? AND ssms_client_code=?",
            [$classId, $subjectId, $theory, $internal, $practical, $maxMarks, $id, $clientCode]
        );

        Log::info("updateMaxMarks [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Max marks updated successfully.', 'id' => $id]);
    }

    public function deleteMaxMarks(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db       = $this->db();
        $existing = $db->execute(
            "SELECT id FROM ssms_max_marks WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Record not found.'); return; }

        $db->execute(
            "DELETE FROM ssms_max_marks WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );
        Log::info("deleteMaxMarks [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Max marks deleted successfully.']);
    }
}
