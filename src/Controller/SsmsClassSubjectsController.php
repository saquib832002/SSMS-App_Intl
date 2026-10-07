<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsClassSubjects Controller
 *
 * Manages which subjects are assigned to each class, with class-specific
 * subject codes and display ordering.
 */
class SsmsClassSubjectsController extends AppController
{
    private function _clientCode(): string
    {
        return (string)$this->request->getSession()->read('ssms_client_code');
    }

    private function _requireAdminOrOwner(): bool
    {
        $role = strtolower(trim((string)$this->request->getSession()->read('ssms_user_role')));
        return in_array($role, ['admin', 'owner', 'superuser'], true);
    }

    // ── index ─────────────────────────────────────────────────────────────────
    // Show all subjects assigned to a selected class.

    public function index()
    {
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission.');
            return $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
        }

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        // All classes for the picker
        $classes = $conn->execute(
            "SELECT class_id, class_name FROM ssms_classes
             WHERE ssms_client_code = ? ORDER BY class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $classId = (int)($this->request->getQuery('class_id') ?? ($classes[0]['class_id'] ?? 0));

        // Assigned subjects for chosen class
        $assigned = [];
        if ($classId) {
            $assigned = $conn->execute(
                "SELECT cs.id, cs.subject_code, cs.display_order,
                        s.subject_id, s.subject_name
                 FROM ssms_class_subjects cs
                 JOIN ssms_subjects s ON s.subject_id = cs.subject_id
                                     AND s.ssms_client_code = cs.ssms_client_code
                 WHERE cs.ssms_client_code = ? AND cs.class_id = ?
                 ORDER BY cs.display_order, s.subject_name",
                [$clientCode, $classId]
            )->fetchAll('assoc');
        }

        // All master subjects not yet assigned to this class (for the assign dropdown)
        $assignedIds = array_column($assigned, 'subject_id');
        $available   = $conn->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects
             WHERE ssms_client_code = ? ORDER BY subject_name",
            [$clientCode]
        )->fetchAll('assoc');

        $available = array_filter($available, fn($s) => !in_array($s['subject_id'], $assignedIds));

        $this->set(compact('classes', 'classId', 'assigned', 'available'));
    }

    // ── assign ────────────────────────────────────────────────────────────────
    // AJAX-friendly POST: assign a subject to a class with optional code + order.

    public function assign()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission.');
            return $this->redirect(['action' => 'index']);
        }

        $clientCode  = $this->_clientCode();
        $conn        = ConnectionManager::get('default');
        $d           = $this->request->getData();

        $classId     = (int)($d['class_id']   ?? 0);
        $subjectId   = (int)($d['subject_id']  ?? 0);
        $subjectCode = trim((string)($d['subject_code']   ?? ''));
        $order       = (int)($d['display_order'] ?? 0);

        if (!$classId || !$subjectId) {
            $this->Flash->error('Class and subject are required.');
            return $this->redirect(['action' => 'index', '?' => ['class_id' => $classId]]);
        }

        // Guard: already assigned?
        $exists = $conn->execute(
            "SELECT id FROM ssms_class_subjects
             WHERE ssms_client_code = ? AND class_id = ? AND subject_id = ?",
            [$clientCode, $classId, $subjectId]
        )->fetchAssoc();

        if ($exists) {
            $this->Flash->error('This subject is already assigned to this class.');
        } else {
            $conn->execute(
                "INSERT INTO ssms_class_subjects
                    (ssms_client_code, class_id, subject_id, subject_code, display_order)
                 VALUES (?, ?, ?, ?, ?)",
                [$clientCode, $classId, $subjectId, $subjectCode ?: null, $order]
            );
            $this->Flash->success('Subject assigned successfully.');
        }

        return $this->redirect(['action' => 'index', '?' => ['class_id' => $classId]]);
    }

    // ── edit ──────────────────────────────────────────────────────────────────
    // Edit subject_code and display_order for an existing class-subject row.

    public function edit($id = null)
    {
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission.');
            return $this->redirect(['action' => 'index']);
        }

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $row = $conn->execute(
            "SELECT cs.*, s.subject_name
             FROM ssms_class_subjects cs
             JOIN ssms_subjects s ON s.subject_id = cs.subject_id
             WHERE cs.id = ? AND cs.ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$row) {
            $this->Flash->error('Record not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is(['post', 'put', 'patch'])) {
            $d = $this->request->getData();
            $conn->execute(
                "UPDATE ssms_class_subjects
                 SET subject_code = ?, display_order = ?
                 WHERE id = ? AND ssms_client_code = ?",
                [
                    trim($d['subject_code'] ?? '') ?: null,
                    (int)($d['display_order'] ?? 0),
                    $id,
                    $clientCode,
                ]
            );
            $this->Flash->success('Updated.');
            return $this->redirect(['action' => 'index', '?' => ['class_id' => $row['class_id']]]);
        }

        $this->set(compact('row'));
    }

    // ── remove ────────────────────────────────────────────────────────────────

    public function remove($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission.');
            return $this->redirect(['action' => 'index']);
        }

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $row = $conn->execute(
            "SELECT class_id FROM ssms_class_subjects WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();

        // Guard: check if this class_subject_id is in use by timetable
        $inUse = $conn->execute(
            "SELECT timetable_id FROM ssms_timetable WHERE class_subject_id = ? LIMIT 1",
            [$id]
        )->fetchAssoc();

        if ($inUse) {
            $this->Flash->error('Cannot remove — this subject is used in the timetable. Clear timetable slots first.');
            return $this->redirect(['action' => 'index', '?' => ['class_id' => $row['class_id'] ?? 0]]);
        }

        $conn->execute(
            "DELETE FROM ssms_class_subjects WHERE id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );
        $this->Flash->success('Subject removed from class.');
        return $this->redirect(['action' => 'index', '?' => ['class_id' => $row['class_id'] ?? 0]]);
    }
}
