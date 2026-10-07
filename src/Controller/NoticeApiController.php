<?php
/**
 * Controllers/NoticeApiController.php
 * CRUD for school notices / circular board.
 *
 * ── SQL (run once) ────────────────────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS ssms_notices (
 *     notice_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *     ssms_client_code VARCHAR(50)  NOT NULL,
 *     title            VARCHAR(255) NOT NULL,
 *     body             TEXT         NOT NULL,
 *     category         ENUM('General','Academic','Exam','Fee','Event','Administrative')
 *                      NOT NULL DEFAULT 'General',
 *     priority         ENUM('normal','important','urgent') NOT NULL DEFAULT 'normal',
 *     target_audience  ENUM('all','students','parents','teachers','staff')
 *                      NOT NULL DEFAULT 'all',
 *     branch_id        INT          DEFAULT NULL,
 *     is_pinned        TINYINT(1)   NOT NULL DEFAULT 0,
 *     is_active        TINYINT(1)   NOT NULL DEFAULT 1,
 *     expires_at       DATE         DEFAULT NULL,
 *     created_by       VARCHAR(100) DEFAULT NULL,
 *     created_at       DATETIME     DEFAULT NULL,
 *     updated_at       DATETIME     DEFAULT NULL,
 *     INDEX idx_client_active (ssms_client_code, is_active, created_at)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 * ── Routes (add to config/routes.php inside the JWT-protected scope) ─────────
 *   $builder->get('/NoticeApi/list',        ['controller'=>'NoticeApi','action'=>'list']);
 *   $builder->post('/NoticeApi/create',     ['controller'=>'NoticeApi','action'=>'create']);
 *   $builder->post('/NoticeApi/update/:id', ['controller'=>'NoticeApi','action'=>'update'])->setPass(['id']);
 *   $builder->post('/NoticeApi/delete/:id', ['controller'=>'NoticeApi','action'=>'delete'])->setPass(['id']);
 * ─────────────────────────────────────────────────────────────────────────────
 */
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

class NoticeApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->autoRender = false;
        $this->response   = $this->response->withType('application/json');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function db(): \Cake\Database\Connection
    {
        return \Cake\Datasource\ConnectionManager::get('default');
    }

    private function getClientCode(): string
    {
        return $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? '';
    }

    private function getRole(): string
    {
        return strtolower(trim(
            $this->request->getAttribute('jwt_role')
            ?? $this->request->getHeaderLine('ssmsUserRole')
            ?? ''
        ));
    }

    private function getUsername(): string
    {
        return $this->request->getAttribute('jwt_user')
            ?? $this->request->getHeaderLine('ssmsUserName')
            ?? '';
    }

    private function isAdminOrOwner(): bool
    {
        return in_array($this->getRole(), ['admin', 'owner'], true);
    }

    private function canWrite(): bool
    {
        return in_array($this->getRole(), ['admin', 'owner', 'teacher'], true);
    }

    private function jsonOk(array $extra = []): void
    {
        $this->response = $this->response
            ->withStringBody(json_encode(array_merge(['status' => true], $extra)));
    }

    private function jsonError(int $code, string $msg): void
    {
        $this->response = $this->response
            ->withStatus($code)
            ->withStringBody(json_encode(['status' => false, 'message' => $msg]));
    }

    private function bodyJson(): array
    {
        $raw = (string)$this->request->getBody();
        return json_decode($raw, true) ?? $this->request->getData() ?? [];
    }

    // =========================================================================
    // GET /NoticeApi/list?limit=50&category=Exam&priority=urgent
    // Role-aware: students see all+students, parents see all+parents,
    //             teachers see all+teachers+staff, admin/owner/user see everything.
    // Non-admins never see expired notices.
    // =========================================================================
    public function list(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $role     = $this->getRole();
        $limit    = max(1, min(100, (int)($this->request->getQuery('limit') ?? 50)));
        $category = trim((string)($this->request->getQuery('category') ?? ''));
        $priority = trim((string)($this->request->getQuery('priority') ?? ''));

        // Audience clause
        $audienceClause = '';
        if ($role === 'student') {
            $audienceClause = "AND (n.target_audience IN ('all','students'))";
        } elseif ($role === 'parent') {
            $audienceClause = "AND (n.target_audience IN ('all','parents'))";
        } elseif ($role === 'teacher') {
            $audienceClause = "AND (n.target_audience IN ('all','teachers','staff'))";
        }
        // admin/owner/user — no audience restriction

        // Expiry clause for non-admins
        $expiryClause = !$this->isAdminOrOwner()
            ? "AND (n.expires_at IS NULL OR n.expires_at >= CURDATE())"
            : '';

        // Optional filters
        $catClause = '';
        $priClause = '';
        $params    = [$clientCode];
        if ($category !== '') { $catClause = 'AND n.category = ?';  $params[] = $category; }
        if ($priority !== '') { $priClause = 'AND n.priority = ?';  $params[] = $priority; }

        $rows = $this->db()->execute(
            "SELECT n.notice_id, n.title, n.body, n.category, n.priority,
                    n.target_audience, n.is_pinned, n.is_active,
                    n.expires_at, n.created_by, n.created_at, n.updated_at
             FROM   ssms_notices n
             WHERE  n.ssms_client_code = ?
               AND  n.is_active = 1
               {$audienceClause}
               {$expiryClause}
               {$catClause}
               {$priClause}
             ORDER BY n.is_pinned DESC, n.priority = 'urgent' DESC,
                      n.priority = 'important' DESC, n.created_at DESC
             LIMIT  {$limit}",
            $params
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows, 'count' => count($rows)]);
    }

    // =========================================================================
    // POST /NoticeApi/create
    // =========================================================================
    public function create(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->canWrite()) { $this->jsonError(403, 'Permission denied.'); return; }

        $clientCode = $this->getClientCode();
        $body       = $this->bodyJson();

        $title     = trim((string)($body['title']           ?? ''));
        $bodyText  = trim((string)($body['body']            ?? ''));
        $category  = trim((string)($body['category']        ?? 'General'));
        $priority  = trim((string)($body['priority']        ?? 'normal'));
        $audience  = trim((string)($body['target_audience'] ?? 'all'));
        $isPinned  = $this->isAdminOrOwner() ? (int)(bool)($body['is_pinned'] ?? false) : 0;
        $expiresAt = trim((string)($body['expires_at'] ?? '')) ?: null;
        $createdBy = $this->getUsername();

        if (empty($title))    { $this->jsonError(422, 'Title is required.');        return; }
        if (empty($bodyText)) { $this->jsonError(422, 'Notice body is required.');  return; }

        $this->db()->execute(
            "INSERT INTO ssms_notices
               (ssms_client_code, title, body, category, priority, target_audience,
                is_pinned, is_active, expires_at, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())",
            [$clientCode, $title, $bodyText, $category, $priority, $audience,
             $isPinned, $expiresAt, $createdBy]
        );
        $newId = $this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createNotice [{$clientCode}] id={$newId} by={$createdBy}");
        $this->jsonOk(['message' => 'Notice created.', 'notice_id' => $newId]);
    }

    // =========================================================================
    // POST /NoticeApi/update/:id
    // =========================================================================
    public function update(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->canWrite()) { $this->jsonError(403, 'Permission denied.'); return; }

        $clientCode = $this->getClientCode();
        if (!$id) { $this->jsonError(422, 'Invalid ID.'); return; }

        $existing = $this->db()->execute(
            "SELECT notice_id, created_by, is_pinned FROM ssms_notices
             WHERE notice_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Notice not found.'); return; }

        // Teachers may only edit their own notices
        if ($this->getRole() === 'teacher'
            && $existing['created_by'] !== $this->getUsername()) {
            $this->jsonError(403, 'You can only edit your own notices.'); return;
        }

        $body      = $this->bodyJson();
        $title     = trim((string)($body['title']           ?? ''));
        $bodyText  = trim((string)($body['body']            ?? ''));
        $category  = trim((string)($body['category']        ?? 'General'));
        $priority  = trim((string)($body['priority']        ?? 'normal'));
        $audience  = trim((string)($body['target_audience'] ?? 'all'));
        $isPinned  = $this->isAdminOrOwner()
            ? (int)(bool)($body['is_pinned'] ?? false)
            : (int)$existing['is_pinned'];
        $expiresAt = trim((string)($body['expires_at'] ?? '')) ?: null;

        if (empty($title))    { $this->jsonError(422, 'Title is required.');       return; }
        if (empty($bodyText)) { $this->jsonError(422, 'Notice body is required.'); return; }

        $this->db()->execute(
            "UPDATE ssms_notices
             SET title = ?, body = ?, category = ?, priority = ?,
                 target_audience = ?, is_pinned = ?, expires_at = ?, updated_at = NOW()
             WHERE notice_id = ? AND ssms_client_code = ?",
            [$title, $bodyText, $category, $priority, $audience,
             $isPinned, $expiresAt, $id, $clientCode]
        );

        Log::info("updateNotice [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Notice updated.']);
    }

    // =========================================================================
    // POST /NoticeApi/delete/:id
    // =========================================================================
    public function delete(?int $id = null): void
    {
        $this->request->allowMethod(['post', 'delete']);
        if (!$this->canWrite()) { $this->jsonError(403, 'Permission denied.'); return; }

        $clientCode = $this->getClientCode();
        if (!$id) { $this->jsonError(422, 'Invalid ID.'); return; }

        $existing = $this->db()->execute(
            "SELECT notice_id, created_by FROM ssms_notices
             WHERE notice_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Notice not found.'); return; }

        if ($this->getRole() === 'teacher'
            && $existing['created_by'] !== $this->getUsername()) {
            $this->jsonError(403, 'You can only delete your own notices.'); return;
        }

        $this->db()->execute(
            "DELETE FROM ssms_notices WHERE notice_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteNotice [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Notice deleted.']);
    }
}
