<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsNoticesController
 * Web UI for Notice Board / Circulars.
 * Mirrors the mobile app NoticeBoardScreen.
 *
 * DB table: ssms_notices
 * Run this SQL once if table doesn't exist:
 *
 * CREATE TABLE IF NOT EXISTS ssms_notices (
 *   notice_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *   ssms_client_code VARCHAR(50)  NOT NULL,
 *   title            VARCHAR(255) NOT NULL,
 *   body             TEXT         NOT NULL,
 *   category         ENUM('General','Academic','Exam','Fee','Event','Administrative') NOT NULL DEFAULT 'General',
 *   priority         ENUM('normal','important','urgent') NOT NULL DEFAULT 'normal',
 *   target_audience  ENUM('all','students','parents','teachers','staff') NOT NULL DEFAULT 'all',
 *   branch_id        INT          DEFAULT NULL,
 *   is_pinned        TINYINT(1)   NOT NULL DEFAULT 0,
 *   is_active        TINYINT(1)   NOT NULL DEFAULT 1,
 *   expires_at       DATE         DEFAULT NULL,
 *   created_by       VARCHAR(100) DEFAULT NULL,
 *   created_at       DATETIME     DEFAULT NULL,
 *   updated_at       DATETIME     DEFAULT NULL,
 *   INDEX idx_client_active (ssms_client_code, is_active, created_at)
 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 */
class SsmsNoticesController extends AppController
{
    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function session(): \Cake\Http\Session
    {
        return $this->request->getSession();
    }

    private function isAdmin(): bool
    {
        $role = strtolower((string)$this->session()->read('ssms_user_role'));
        return in_array($role, ['admin', 'owner', 'teacher'], true);
    }

    // ── index ─────────────────────────────────────────────────────────────────
    public function index()
    {
        $session    = $this->session();
        $clientCode = $session->read('ssms_client_code');
        $role       = strtolower((string)$session->read('ssms_user_role'));
        $isAdmin    = $this->isAdmin();

        $filterCat      = $this->request->getQuery('category') ?? '';
        $filterPriority = $this->request->getQuery('priority') ?? '';
        $filterAudience = $this->request->getQuery('audience') ?? '';

        $db     = $this->db();
        $where  = 'WHERE ssms_client_code = ?';
        $params = [$clientCode];

        // Non-admins/teachers only see active, non-expired notices for their audience
        if (!$isAdmin) {
            $where .= " AND is_active = 1 AND (expires_at IS NULL OR expires_at >= CURDATE())";
            if ($role === 'student') {
                $where .= " AND target_audience IN ('all','students')";
            } elseif ($role === 'parent') {
                $where .= " AND target_audience IN ('all','parents')";
            } else {
                $where .= " AND target_audience IN ('all','staff')";
            }
        }

        if ($filterCat)      { $where .= ' AND category = ?';        $params[] = $filterCat; }
        if ($filterPriority) { $where .= ' AND priority = ?';        $params[] = $filterPriority; }
        if ($filterAudience) { $where .= ' AND target_audience = ?'; $params[] = $filterAudience; }

        $notices = $db->execute(
            "SELECT * FROM ssms_notices $where ORDER BY is_pinned DESC, created_at DESC",
            $params
        )->fetchAll('assoc');

        $this->set(compact('notices', 'isAdmin', 'role', 'filterCat', 'filterPriority', 'filterAudience'));
    }

    // ── add ───────────────────────────────────────────────────────────────────
    public function add()
    {
        $session    = $this->session();
        $clientCode = $session->read('ssms_client_code');
        $userName   = $session->read('ssms_user_name');

        if ($this->request->is('post')) {
            $d = $this->request->getData();

            $title     = trim((string)($d['title'] ?? ''));
            $body      = trim((string)($d['body']  ?? ''));
            $category  = $d['category']  ?? 'General';
            $priority  = $d['priority']  ?? 'normal';
            $audience  = $d['target_audience'] ?? 'all';
            $isPinned  = !empty($d['is_pinned']) ? 1 : 0;
            $expiresAt = !empty($d['expires_at']) ? $d['expires_at'] : null;

            if ($title === '' || $body === '') {
                $this->Flash->error('Title and body are required.');
            } else {
                $this->db()->execute(
                    "INSERT INTO ssms_notices
                       (ssms_client_code, title, body, category, priority, target_audience,
                        is_pinned, is_active, expires_at, created_by, created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?,1,?,?,NOW(),NOW())",
                    [$clientCode, $title, $body, $category, $priority, $audience,
                     $isPinned, $expiresAt, $userName]
                );
                $this->Flash->success('Notice posted successfully.');
                return $this->redirect(['action' => 'index']);
            }
        }

        $this->set('notice', null);
    }

    // ── edit ──────────────────────────────────────────────────────────────────
    public function edit(int $id)
    {
        $clientCode = $this->session()->read('ssms_client_code');
        $db         = $this->db();

        $notice = $db->execute(
            "SELECT * FROM ssms_notices WHERE notice_id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$notice) {
            $this->Flash->error('Notice not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $db->execute(
                "UPDATE ssms_notices SET
                   title = ?, body = ?, category = ?, priority = ?, target_audience = ?,
                   is_pinned = ?, expires_at = ?, updated_at = NOW()
                 WHERE notice_id = ? AND ssms_client_code = ?",
                [
                    trim((string)($d['title'] ?? '')),
                    trim((string)($d['body']  ?? '')),
                    $d['category']  ?? 'General',
                    $d['priority']  ?? 'normal',
                    $d['target_audience'] ?? 'all',
                    !empty($d['is_pinned']) ? 1 : 0,
                    !empty($d['expires_at']) ? $d['expires_at'] : null,
                    $id, $clientCode,
                ]
            );
            $this->Flash->success('Notice updated.');
            return $this->redirect(['action' => 'index']);
        }

        $this->set(compact('notice'));
    }

    // ── delete ────────────────────────────────────────────────────────────────
    public function delete(int $id)
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->session()->read('ssms_client_code');
        $this->db()->execute(
            "DELETE FROM ssms_notices WHERE notice_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );
        $this->Flash->success('Notice deleted.');
        return $this->redirect(['action' => 'index']);
    }

    // ── pin (toggle) ──────────────────────────────────────────────────────────
    public function pin(int $id)
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->session()->read('ssms_client_code');
        $db         = $this->db();

        $n = $db->execute(
            "SELECT notice_id, is_pinned FROM ssms_notices WHERE notice_id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();

        if ($n) {
            $db->execute(
                "UPDATE ssms_notices SET is_pinned = ? WHERE notice_id = ?",
                [$n['is_pinned'] ? 0 : 1, $id]
            );
        }

        return $this->redirect(['action' => 'index']);
    }
}
