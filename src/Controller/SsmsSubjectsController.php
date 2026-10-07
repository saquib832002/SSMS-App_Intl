<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsSubjects Controller — Subject Master
 *
 * Manages the school-wide subject catalogue (name only, no class dependency).
 * Class-specific assignments live in SsmsClassSubjectsController.
 */
class SsmsSubjectsController extends AppController
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

    public function index()
    {
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission to view this page.');
            return $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
        }

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $subjects = $conn->execute(
            "SELECT s.subject_id, s.subject_name,
                    COUNT(DISTINCT cs.id) AS class_count
             FROM ssms_subjects s
             LEFT JOIN ssms_class_subjects cs
                    ON cs.subject_id = s.subject_id AND cs.ssms_client_code = s.ssms_client_code
             WHERE s.ssms_client_code = ?
             GROUP BY s.subject_id, s.subject_name
             ORDER BY s.subject_name",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact('subjects'));
    }

    // ── add ───────────────────────────────────────────────────────────────────

    public function add()
    {
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission.');
            return $this->redirect(['action' => 'index']);
        }

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        if ($this->request->is('post')) {
            $name = trim((string)($this->request->getData('subject_name') ?? ''));
            if ($name === '') {
                $this->Flash->error('Subject name is required.');
            } else {
                $exists = $conn->execute(
                    "SELECT subject_id FROM ssms_subjects WHERE ssms_client_code = ? AND subject_name = ?",
                    [$clientCode, $name]
                )->fetchAssoc();

                if ($exists) {
                    $this->Flash->error("Subject \"{$name}\" already exists.");
                } else {
                    $conn->execute(
                        "INSERT INTO ssms_subjects (subject_name, ssms_client_code) VALUES (?, ?)",
                        [$name, $clientCode]
                    );
                    $this->Flash->success("Subject \"{$name}\" added.");
                    return $this->redirect(['action' => 'index']);
                }
            }
        }
    }

    // ── edit ──────────────────────────────────────────────────────────────────

    public function edit($id = null)
    {
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission.');
            return $this->redirect(['action' => 'index']);
        }

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $subject = $conn->execute(
            "SELECT * FROM ssms_subjects WHERE subject_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$subject) {
            $this->Flash->error('Subject not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is(['post', 'put', 'patch'])) {
            $name = trim((string)($this->request->getData('subject_name') ?? ''));
            if ($name === '') {
                $this->Flash->error('Subject name is required.');
            } else {
                $conn->execute(
                    "UPDATE ssms_subjects SET subject_name = ? WHERE subject_id = ? AND ssms_client_code = ?",
                    [$name, $id, $clientCode]
                );
                $this->Flash->success('Subject updated.');
                return $this->redirect(['action' => 'index']);
            }
        }

        $this->set(compact('subject'));
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        if (!$this->_requireAdminOrOwner()) {
            $this->Flash->error('You do not have permission.');
            return $this->redirect(['action' => 'index']);
        }

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $used = $conn->execute(
            "SELECT id FROM ssms_class_subjects WHERE subject_id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();

        if ($used) {
            $this->Flash->error('Cannot delete — subject is assigned to one or more classes. Remove class assignments first.');
            return $this->redirect(['action' => 'index']);
        }

        $conn->execute(
            "DELETE FROM ssms_subjects WHERE subject_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );
        $this->Flash->success('Subject deleted.');
        return $this->redirect(['action' => 'index']);
    }
}
