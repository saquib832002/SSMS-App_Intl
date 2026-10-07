<?php
/**
 * Controllers/SchoolEventsApiController.php
 * CRUD for ssms_school_events — upcoming events & holidays.
 *
 * ── Routes to add in config/routes.php ───────────────────────────────────────
 *   $builder->get('/SchoolEventsApi/getUpcomingEvents', ['controller'=>'SchoolEventsApi','action'=>'getUpcomingEvents']);
 *   $builder->post('/SchoolEventsApi/createEvent',      ['controller'=>'SchoolEventsApi','action'=>'createEvent']);
 *   $builder->post('/SchoolEventsApi/updateEvent/:id',  ['controller'=>'SchoolEventsApi','action'=>'updateEvent'])->setPass(['id']);
 *   $builder->delete('/SchoolEventsApi/deleteEvent/:id',['controller'=>'SchoolEventsApi','action'=>'deleteEvent'])->setPass(['id']);
 *   $builder->post('/SchoolEventsApi/deleteEvent/:id',  ['controller'=>'SchoolEventsApi','action'=>'deleteEvent'])->setPass(['id']);
 *
 * ── Table (run once) ─────────────────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS ssms_school_events (
 *     event_id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *     ssms_client_code  VARCHAR(50)  NOT NULL,
 *     event_title       VARCHAR(255) NOT NULL,
 *     event_type        ENUM('event','holiday') NOT NULL DEFAULT 'event',
 *     event_category    VARCHAR(100) DEFAULT NULL,
 *     event_date        DATE         NOT NULL,
 *     event_end_date    DATE         DEFAULT NULL,
 *     event_description TEXT         DEFAULT NULL,
 *     event_color       VARCHAR(10)  DEFAULT '#2f7ef5',
 *     is_public         TINYINT(1)   NOT NULL DEFAULT 1,
 *     created_by        VARCHAR(100) DEFAULT NULL,
 *     created_at        DATETIME     DEFAULT NULL,
 *     updated_at        DATETIME     DEFAULT NULL,
 *     INDEX idx_client_date (ssms_client_code, event_date)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 * ─────────────────────────────────────────────────────────────────────────────
 */
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

class SchoolEventsApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->autoRender = false;
        $this->response   = $this->response->withType('application/json');
    }

    private function getClientCode(): string
    {
        return $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? '';
    }

    private function db(): \Cake\Database\Connection
    {
        return \Cake\Datasource\ConnectionManager::get('default');
    }

    private function isAdminOrOwner(): bool
    {
        $role = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));
        return in_array($role, ['admin', 'owner'], true);
    }

    private function jsonOk(array $data = []): void
    {
        $this->response = $this->response
            ->withStringBody(json_encode(array_merge(['status' => true], $data)));
    }

    private function jsonError(int $code, string $msg): void
    {
        $this->response = $this->response
            ->withStatus($code)
            ->withStringBody(json_encode(['status' => false, 'message' => $msg]));
    }

    // =========================================================================
    // GET /SchoolEventsApi/getUpcomingEvents
    // Returns events from today onwards (or ongoing multi-day events).
    // =========================================================================
    public function getUpcomingEvents(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $limit = max(1, min(50, (int)($this->request->getQuery('limit') ?? 20)));

        $rows = $this->db()->execute(
            "SELECT event_id, event_title, event_type, event_category,
                    event_date, event_end_date, event_description,
                    event_color, is_public, created_by, created_at
             FROM   ssms_school_events
             WHERE  ssms_client_code = ?
             AND    (
                       event_date >= CURDATE()
                    OR (event_end_date IS NOT NULL AND event_end_date >= CURDATE())
                    )
             ORDER  BY event_date ASC
             LIMIT  {$limit}",
            [$clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows]);
    }

    // =========================================================================
    // POST /SchoolEventsApi/createEvent
    // =========================================================================
    public function createEvent(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        $body       = $this->request->getData();

        $title       = trim((string)($body['event_title']       ?? ''));
        $type        = trim((string)($body['event_type']        ?? 'event'));
        $category    = trim((string)($body['event_category']    ?? ''));
        $eventDate   = trim((string)($body['event_date']        ?? ''));
        $endDate     = trim((string)($body['event_end_date']    ?? '')) ?: null;
        $description = trim((string)($body['event_description'] ?? ''));
        $color       = trim((string)($body['event_color']       ?? '#2f7ef5'));
        $isPublic    = isset($body['is_public']) ? (int)(bool)$body['is_public'] : 1;
        $createdBy   = trim((string)($body['created_by']        ?? ''));

        if (empty($title))     { $this->jsonError(422, 'event_title is required.'); return; }
        if (empty($eventDate)) { $this->jsonError(422, 'event_date is required.');  return; }

        $this->db()->execute(
            "INSERT INTO ssms_school_events
                (ssms_client_code, event_title, event_type, event_category,
                 event_date, event_end_date, event_description,
                 event_color, is_public, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [$clientCode, $title, $type, $category, $eventDate, $endDate,
             $description, $color, $isPublic, $createdBy]
        );
        $newId = $this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createEvent [{$clientCode}] id={$newId} title={$title}");
        $this->jsonOk(['message' => 'Event created.', 'event_id' => $newId]);
    }

    // =========================================================================
    // POST /SchoolEventsApi/updateEvent/:id
    // =========================================================================
    public function updateEvent(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $existing = $this->db()->execute(
            "SELECT event_id FROM ssms_school_events WHERE event_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Event not found.'); return; }

        $body        = $this->request->getData();
        $title       = trim((string)($body['event_title']       ?? ''));
        $type        = trim((string)($body['event_type']        ?? 'event'));
        $category    = trim((string)($body['event_category']    ?? ''));
        $eventDate   = trim((string)($body['event_date']        ?? ''));
        $endDate     = trim((string)($body['event_end_date']    ?? '')) ?: null;
        $description = trim((string)($body['event_description'] ?? ''));
        $color       = trim((string)($body['event_color']       ?? '#2f7ef5'));
        $isPublic    = isset($body['is_public']) ? (int)(bool)$body['is_public'] : 1;

        if (empty($title))     { $this->jsonError(422, 'event_title is required.'); return; }
        if (empty($eventDate)) { $this->jsonError(422, 'event_date is required.');  return; }

        $this->db()->execute(
            "UPDATE ssms_school_events
             SET    event_title = ?, event_type = ?, event_category = ?,
                    event_date  = ?, event_end_date = ?, event_description = ?,
                    event_color = ?, is_public = ?, updated_at = NOW()
             WHERE  event_id = ? AND ssms_client_code = ?",
            [$title, $type, $category, $eventDate, $endDate, $description,
             $color, $isPublic, $id, $clientCode]
        );

        Log::info("updateEvent [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Event updated.', 'event_id' => $id]);
    }

    // =========================================================================
    // DELETE /SchoolEventsApi/deleteEvent/:id
    // =========================================================================
    public function deleteEvent(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $existing = $this->db()->execute(
            "SELECT event_id FROM ssms_school_events WHERE event_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Event not found.'); return; }

        $this->db()->execute(
            "DELETE FROM ssms_school_events WHERE event_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteEvent [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Event deleted.']);
    }
}
