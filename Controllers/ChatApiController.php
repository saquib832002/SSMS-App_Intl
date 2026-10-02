<?php
/**
 * Controllers/ChatApiController.php
 * In-app staff chat — per-client, polling-based, stored in MySQL.
 *
 * ── SQL (run once on your DB) ─────────────────────────────────────────────────
 *
 *   -- 1. Conversations (one row per unique user pair per client)
 *   CREATE TABLE IF NOT EXISTS ssms_chat_conversations (
 *     id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *     client_code   VARCHAR(50)  NOT NULL,
 *     user_a        VARCHAR(100) NOT NULL,   -- lexically smaller username
 *     user_b        VARCHAR(100) NOT NULL,   -- lexically larger username
 *     last_message  TEXT         DEFAULT NULL,
 *     last_msg_at   DATETIME     DEFAULT NULL,
 *     created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *     UNIQUE KEY uq_conv (client_code, user_a, user_b),
 *     INDEX idx_user_a (client_code, user_a),
 *     INDEX idx_user_b (client_code, user_b)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 *   -- 2. Messages
 *   CREATE TABLE IF NOT EXISTS ssms_chat_messages (
 *     id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *     conversation_id INT UNSIGNED NOT NULL,
 *     sender          VARCHAR(100) NOT NULL,
 *     body            TEXT         NOT NULL,
 *     is_read         TINYINT(1)   NOT NULL DEFAULT 0,
 *     created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *     INDEX idx_conv_time (conversation_id, created_at),
 *     INDEX idx_unread    (conversation_id, sender, is_read)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 *   -- 3. Presence (heartbeat upsert every ~30 s while app is open)
 *   CREATE TABLE IF NOT EXISTS ssms_user_presence (
 *     username      VARCHAR(100) NOT NULL,
 *     client_code   VARCHAR(50)  NOT NULL,
 *     display_name  VARCHAR(255) DEFAULT NULL,
 *     role          VARCHAR(50)  DEFAULT NULL,
 *     last_seen_at  DATETIME     NOT NULL,
 *     push_token    VARCHAR(200) DEFAULT NULL,
 *     PRIMARY KEY (username, client_code)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 *   -- Migration for existing installations:
 *   ALTER TABLE ssms_user_presence
 *     ADD COLUMN IF NOT EXISTS push_token VARCHAR(200) DEFAULT NULL;
 *
 * ── Routes (add inside your JWT-protected scope in routes.php) ────────────────
 *   $builder->get('/ChatApi/getUsers',         ['controller'=>'ChatApi','action'=>'getUsers']);
 *   $builder->post('/ChatApi/heartbeat',        ['controller'=>'ChatApi','action'=>'heartbeat']);
 *   $builder->get('/ChatApi/getConversations',  ['controller'=>'ChatApi','action'=>'getConversations']);
 *   $builder->get('/ChatApi/getMessages',       ['controller'=>'ChatApi','action'=>'getMessages']);
 *   $builder->post('/ChatApi/sendMessage',      ['controller'=>'ChatApi','action'=>'sendMessage']);
 * ─────────────────────────────────────────────────────────────────────────────
 */
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

class ChatApiController extends AppController
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
        // Use ?: so we fall through on empty-string too (not just null)
        return trim(
            ($this->request->getAttribute('jwt_client_code') ?: null)
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? ''
        );
    }

    private function getUsername(): string
    {
        return trim(
            ($this->request->getAttribute('jwt_user') ?: null)
            ?? $this->request->getHeaderLine('ssmsUserName')
            ?? ''
        );
    }

    private function getRole(): string
    {
        return strtolower(trim(
            ($this->request->getAttribute('jwt_role') ?: null)
            ?? $this->request->getHeaderLine('ssmsUserRole')
            ?? ''
        ));
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

    /**
     * Normalise a pair of usernames into (user_a, user_b) so that user_a is
     * always the lexically smaller one — this keeps the UNIQUE KEY working
     * regardless of who initiates the conversation.
     */
    private function convPair(string $me, string $other): array
    {
        return strcmp($me, $other) < 0
            ? [$me, $other]
            : [$other, $me];
    }

    /**
     * Find an existing conversation or create one, returning its id.
     */
    private function ensureConversation(string $clientCode, string $me, string $other): int
    {
        $db = $this->db();
        [$ua, $ub] = $this->convPair($me, $other);

        $row = $db->execute(
            "SELECT id FROM ssms_chat_conversations
             WHERE client_code = ? AND user_a = ? AND user_b = ?",
            [$clientCode, $ua, $ub]
        )->fetch('assoc');

        if ($row) {
            return (int)$row['id'];
        }

        $db->execute(
            "INSERT INTO ssms_chat_conversations
               (client_code, user_a, user_b, created_at)
             VALUES (?, ?, ?, NOW())",
            [$clientCode, $ua, $ub]
        );
        return (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
    }

    // =========================================================================
    // GET /ChatApi/getUsers
    // Returns all active users for this client (excluding the caller) with
    // online status and unread message count.
    // =========================================================================
    public function getUsers(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        $me         = $this->getUsername();
        if (!$clientCode || !$me) { $this->jsonError(422, 'Auth missing.'); return; }

        $db = $this->db();

        // All active users for this client except me
        $users = $db->execute(
            "SELECT
               u.ssms_user_name      AS username,
               u.ssms_user_firstname AS first_name,
               u.ssms_user_lastname  AS last_name,
               u.ssms_user_role      AS role,
               p.last_seen_at,
               CASE
                 WHEN p.last_seen_at >= NOW() - INTERVAL 2 MINUTE THEN 1
                 ELSE 0
               END AS is_online
             FROM sawera_ssms_users u
             LEFT JOIN ssms_user_presence p
               ON p.username = u.ssms_user_name AND p.client_code = u.ssms_client_code
             WHERE u.ssms_client_code = ?
               AND u.ssms_user_name  != ?
               AND u.ssms_user_status = 'active'
             ORDER BY is_online DESC, u.ssms_user_firstname ASC",
            [$clientCode, $me]
        )->fetchAll('assoc');

        // Attach unread count per user
        foreach ($users as &$u) {
            [$ua, $ub] = $this->convPair($me, $u['username']);
            $unread = $db->execute(
                "SELECT COUNT(*) AS cnt
                 FROM ssms_chat_messages m
                 JOIN ssms_chat_conversations c ON c.id = m.conversation_id
                 WHERE c.client_code = ? AND c.user_a = ? AND c.user_b = ?
                   AND m.sender = ? AND m.is_read = 0",
                [$clientCode, $ua, $ub, $u['username']]
            )->fetch('assoc');
            $u['unread_count'] = (int)($unread['cnt'] ?? 0);
            $u['display_name'] = trim($u['first_name'] . ' ' . $u['last_name'])
                               ?: $u['username'];
        }
        unset($u);

        $this->jsonOk(['users' => array_values($users)]);
    }

    // =========================================================================
    // POST /ChatApi/heartbeat
    // Upserts presence record for the caller. Also returns total unread count.
    // Call every 30 s while app is in foreground.
    // =========================================================================
    public function heartbeat(): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->getClientCode();
        $me         = $this->getUsername();
        $role       = $this->getRole();
        if (!$clientCode || !$me) { $this->jsonError(422, 'Auth missing.'); return; }

        $db = $this->db();

        // Pull display name from users table
        $userRow = $db->execute(
            "SELECT ssms_user_firstname, ssms_user_lastname
             FROM sawera_ssms_users
             WHERE ssms_user_name = ? AND ssms_client_code = ?
             LIMIT 1",
            [$me, $clientCode]
        )->fetch('assoc');
        $displayName = $userRow
            ? trim(($userRow['ssms_user_firstname'] ?? '') . ' ' . ($userRow['ssms_user_lastname'] ?? ''))
            : $me;

        $body      = (array)($this->request->getParsedBody() ?? []);
        $pushToken = isset($body['push_token']) && is_string($body['push_token'])
            ? substr($body['push_token'], 0, 200)
            : null;

        // Try with push_token first; fall back silently if the column doesn't exist yet
        // (run: ALTER TABLE ssms_user_presence ADD COLUMN push_token VARCHAR(200) DEFAULT NULL)
        $upserted = false;
        if ($pushToken !== null) {
            try {
                $db->execute(
                    "INSERT INTO ssms_user_presence (username, client_code, display_name, role, last_seen_at, push_token)
                     VALUES (?, ?, ?, ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE
                       display_name = VALUES(display_name),
                       role         = VALUES(role),
                       last_seen_at = NOW(),
                       push_token   = VALUES(push_token)",
                    [$me, $clientCode, $displayName, $role, $pushToken]
                );
                $upserted = true;
            } catch (\Exception $e) {
                // Column probably missing — fall through to the base upsert
            }
        }
        if (!$upserted) {
            $db->execute(
                "INSERT INTO ssms_user_presence (username, client_code, display_name, role, last_seen_at)
                 VALUES (?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                   display_name = VALUES(display_name),
                   role         = VALUES(role),
                   last_seen_at = NOW()",
                [$me, $clientCode, $displayName, $role]
            );
        }

        // Total unread messages across all conversations
        $unreadRow = $db->execute(
            "SELECT COUNT(*) AS cnt
             FROM ssms_chat_messages m
             JOIN ssms_chat_conversations c ON c.id = m.conversation_id
             WHERE c.client_code = ?
               AND (c.user_a = ? OR c.user_b = ?)
               AND m.sender != ?
               AND m.is_read = 0",
            [$clientCode, $me, $me, $me]
        )->fetch('assoc');

        $this->jsonOk(['total_unread' => (int)($unreadRow['cnt'] ?? 0)]);
    }

    // =========================================================================
    // GET /ChatApi/getConversations
    // Returns all conversations the caller is part of, newest first.
    // =========================================================================
    public function getConversations(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        $me         = $this->getUsername();
        if (!$clientCode || !$me) { $this->jsonError(422, 'Auth missing.'); return; }

        $db = $this->db();

        $convs = $db->execute(
            "SELECT
               c.id,
               c.user_a,
               c.user_b,
               c.last_message,
               c.last_msg_at,
               -- other user's info
               CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END AS other_username,
               u.ssms_user_firstname AS other_first,
               u.ssms_user_lastname  AS other_last,
               u.ssms_user_role      AS other_role,
               CASE
                 WHEN p.last_seen_at >= NOW() - INTERVAL 2 MINUTE THEN 1
                 ELSE 0
               END AS other_online,
               -- unread count (messages FROM the other person that I haven't read)
               (SELECT COUNT(*) FROM ssms_chat_messages m2
                WHERE m2.conversation_id = c.id
                  AND m2.sender != ?
                  AND m2.is_read = 0) AS unread_count
             FROM ssms_chat_conversations c
             JOIN sawera_ssms_users u
               ON u.ssms_user_name = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
              AND u.ssms_client_code = c.client_code
             LEFT JOIN ssms_user_presence p
               ON p.username = u.ssms_user_name AND p.client_code = c.client_code
             WHERE c.client_code = ?
               AND (c.user_a = ? OR c.user_b = ?)
             ORDER BY c.last_msg_at DESC",
            [$me, $me, $me, $clientCode, $me, $me]
        )->fetchAll('assoc');

        foreach ($convs as &$c) {
            $c['other_display_name'] = trim($c['other_first'] . ' ' . $c['other_last'])
                                     ?: $c['other_username'];
            $c['unread_count']       = (int)$c['unread_count'];
            $c['other_online']       = (bool)$c['other_online'];
        }
        unset($c);

        $this->jsonOk(['conversations' => array_values($convs)]);
    }

    // =========================================================================
    // GET /ChatApi/getMessages?with=USERNAME&since=2024-01-01T00:00:00&limit=50
    // Returns messages for the conversation between caller and ?with=.
    // Also marks messages FROM the other user as read.
    // =========================================================================
    public function getMessages(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        $me         = $this->getUsername();
        $other      = trim((string)($this->request->getQuery('with') ?? ''));
        $since      = trim((string)($this->request->getQuery('since') ?? ''));
        $limit      = max(1, min(200, (int)($this->request->getQuery('limit') ?? 50)));

        if (!$clientCode || !$me) { $this->jsonError(422, 'Auth missing.'); return; }
        if (!$other)              { $this->jsonError(422, '?with= required.'); return; }
        if ($other === $me)       { $this->jsonError(422, 'Cannot chat with yourself.'); return; }

        $db    = $this->db();
        $convId = $this->ensureConversation($clientCode, $me, $other);

        // Mark messages from the other user as read
        $db->execute(
            "UPDATE ssms_chat_messages
             SET is_read = 1
             WHERE conversation_id = ? AND sender = ? AND is_read = 0",
            [$convId, $other]
        );

        // Fetch messages (optionally incremental via since=)
        // LIMIT must be inlined as an integer — PDO binds it as a quoted string
        // which MySQL rejects in LIMIT clauses.
        $limitInt    = (int)$limit;
        $params      = [$convId];
        $sinceClause = '';
        if ($since) {
            $sinceClause = "AND m.created_at > ?";
            $params[]    = $since;
        }

        $rows = $db->execute(
            "SELECT m.id, m.sender, m.body, m.is_read, m.created_at
             FROM ssms_chat_messages m
             WHERE m.conversation_id = ?
               $sinceClause
             ORDER BY m.created_at ASC
             LIMIT $limitInt",
            $params
        )->fetchAll('assoc');

        $this->jsonOk([
            'conversation_id' => $convId,
            'messages'        => array_values($rows),
        ]);
    }

    // =========================================================================
    // POST /ChatApi/sendMessage
    // Body: { "to": "username", "body": "message text" }
    // =========================================================================
    public function sendMessage(): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->getClientCode();
        $me         = $this->getUsername();
        if (!$clientCode || !$me) { $this->jsonError(422, 'Auth missing.'); return; }

        // Support both raw JSON body and form-parsed body
        $d    = $this->bodyJson();
        $to   = trim((string)($d['to']   ?? ''));
        $body = trim((string)($d['body'] ?? ''));

        if (!$to)       { $this->jsonError(422, '"to" is required.');   return; }
        if (!$body)     { $this->jsonError(422, '"body" is required.');  return; }
        if ($to === $me){ $this->jsonError(422, 'Cannot chat with yourself.'); return; }

        try {
        // Verify the recipient exists in this client
        $db = $this->db();
        $recip = $db->execute(
            "SELECT ssms_user_name FROM sawera_ssms_users
             WHERE ssms_user_name = ? AND ssms_client_code = ? AND ssms_user_status = 'active'
             LIMIT 1",
            [$to, $clientCode]
        )->fetch('assoc');
        if (!$recip) { $this->jsonError(404, 'Recipient not found.'); return; }

        $convId = $this->ensureConversation($clientCode, $me, $to);

        // Insert message
        $db->execute(
            "INSERT INTO ssms_chat_messages (conversation_id, sender, body, created_at)
             VALUES (?, ?, ?, NOW())",
            [$convId, $me, $body]
        );
        $msgId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

        // Update conversation summary
        $db->execute(
            "UPDATE ssms_chat_conversations
             SET last_message = ?, last_msg_at = NOW()
             WHERE id = ?",
            [mb_substr($body, 0, 255), $convId]
        );

        // ── Push notification to recipient if offline ──────────────────────────
        $presenceRow = $db->execute(
            "SELECT last_seen_at, push_token FROM ssms_user_presence
             WHERE username = ? AND client_code = ?
             LIMIT 1",
            [$to, $clientCode]
        )->fetch('assoc');

        $isOffline  = !$presenceRow
            || strtotime($presenceRow['last_seen_at']) < (time() - 120);
        $pushToken  = $presenceRow['push_token'] ?? null;

        if ($isOffline && $pushToken) {
            $senderDisplayRow = $db->execute(
                "SELECT ssms_user_firstname, ssms_user_lastname
                 FROM sawera_ssms_users
                 WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1",
                [$me, $clientCode]
            )->fetch('assoc');
            $senderName = $senderDisplayRow
                ? trim(($senderDisplayRow['ssms_user_firstname'] ?? '') . ' ' . ($senderDisplayRow['ssms_user_lastname'] ?? ''))
                : $me;

            $payload = json_encode([
                'to'    => $pushToken,
                'sound' => 'default',
                'title' => $senderName,
                'body'  => mb_substr($body, 0, 200),
                'data'  => [
                    'screen'        => 'Chat',
                    'otherUsername' => $me,
                    'otherName'     => $senderName,
                ],
                'channelId' => 'chat',
            ]);

            $ch = curl_init('https://exp.host/--/api/v2/push/send');
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $payload,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 5,
                CURLOPT_HTTPHEADER     => [
                    'Accept: application/json',
                    'Accept-Encoding: gzip, deflate',
                    'Content-Type: application/json',
                ],
            ]);
            curl_exec($ch);
            curl_close($ch);
        }

        $this->jsonOk([
            'message_id'      => $msgId,
            'conversation_id' => $convId,
        ]);
        } catch (\Exception $e) {
            $this->jsonError(500, 'DB error: ' . $e->getMessage());
        }
    }
}
