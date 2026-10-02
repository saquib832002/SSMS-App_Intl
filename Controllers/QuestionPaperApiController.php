<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * QuestionPaperApiController
 *
 * Creates and manages question papers assembled from the question bank.
 * Each paper belongs to one school (ssms_client_code), one class, one subject.
 * Questions are linked via ssms_paper_questions (junction) with per-paper marks.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SQL — run once in MySQL:
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * CREATE TABLE IF NOT EXISTS ssms_question_papers (
 *   id               INT AUTO_INCREMENT PRIMARY KEY,
 *   ssms_client_code VARCHAR(50)   NOT NULL,
 *   branch_id        INT           NULL,
 *   session_id       INT           NULL,
 *   title            VARCHAR(255)  NOT NULL,
 *   class_id         INT           NULL,
 *   subject_id       INT           NULL,
 *   subject_ids      JSON          NULL,  -- for multi-subject papers (NEET/IIT JEE style)
 *   session          VARCHAR(20)   NULL,
 *   exam_type        VARCHAR(50)   NULL DEFAULT 'Unit Test',
 *   total_marks      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 *   duration_minutes SMALLINT UNSIGNED NULL,
 *   instructions     JSON          NULL,
 *   header_config    JSON          NULL,  -- {schoolName, address, logo, language, ...}
 *   status           ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
 *   created_by       INT           NULL,
 *   created_at       DATETIME      DEFAULT CURRENT_TIMESTAMP,
 *   updated_at       DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   INDEX idx_client (ssms_client_code),
 *   INDEX idx_client_status (ssms_client_code, status),
 *   INDEX idx_client_branch  (ssms_client_code, branch_id),
 *   INDEX idx_client_session (ssms_client_code, session_id)
 * );
 *
 * ─── MIGRATIONS (run each block once if the table already exists) ──────────────
 *
 * -- Migration 1: branch / session columns (run if missing)
 * ALTER TABLE ssms_question_papers
 *   ADD COLUMN branch_id  INT NULL AFTER ssms_client_code,
 *   ADD COLUMN session_id INT NULL AFTER branch_id,
 *   ADD INDEX idx_client_branch  (ssms_client_code, branch_id),
 *   ADD INDEX idx_client_session (ssms_client_code, session_id);
 *
 * -- Migration 2: multi-subject column  ← REQUIRED for NEET/IIT-JEE style papers
 * --              Run this if subject_ids column does not yet exist:
 * ALTER TABLE ssms_question_papers
 *   ADD COLUMN subject_ids JSON NULL AFTER subject_id;
 *
 * CREATE TABLE IF NOT EXISTS ssms_paper_questions (
 *   id            INT AUTO_INCREMENT PRIMARY KEY,
 *   paper_id      INT              NOT NULL,
 *   question_id   INT              NOT NULL,
 *   section_label VARCHAR(50)      NULL,
 *   order_index   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
 *   marks         TINYINT UNSIGNED  NOT NULL DEFAULT 2,
 *   sub_questions JSON             NULL,
 *   UNIQUE KEY uq_paper_question (paper_id, question_id),
 *   INDEX idx_paper (paper_id)
 * );
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Routes — add inside the JWT-authenticated scope in config/routes.php:
 * ───────────────────────────────────────────────────────────────────────────────
 *   $builder->get('/QuestionPaperApi/getPapers',              ['controller'=>'QuestionPaperApi','action'=>'getPapers']);
 *   $builder->post('/QuestionPaperApi/createPaper',           ['controller'=>'QuestionPaperApi','action'=>'createPaper']);
 *   $builder->post('/QuestionPaperApi/updatePaper/:id',       ['controller'=>'QuestionPaperApi','action'=>'updatePaper'])->setPass(['id']);
 *   $builder->delete('/QuestionPaperApi/deletePaper/:id',     ['controller'=>'QuestionPaperApi','action'=>'deletePaper'])->setPass(['id']);
 *   $builder->post('/QuestionPaperApi/deletePaper/:id',       ['controller'=>'QuestionPaperApi','action'=>'deletePaper'])->setPass(['id']);
 *   $builder->get('/QuestionPaperApi/getPaper/:id',           ['controller'=>'QuestionPaperApi','action'=>'getPaper'])->setPass(['id']);
 *   $builder->post('/QuestionPaperApi/addQuestion/:id',       ['controller'=>'QuestionPaperApi','action'=>'addQuestion'])->setPass(['id']);
 *   $builder->post('/QuestionPaperApi/updateQuestion/:id/:pqId',['controller'=>'QuestionPaperApi','action'=>'updatePaperQuestion'])->setPass(['id','pqId']);
 *   $builder->delete('/QuestionPaperApi/removeQuestion/:id/:pqId',['controller'=>'QuestionPaperApi','action'=>'removeQuestion'])->setPass(['id','pqId']);
 *   $builder->post('/QuestionPaperApi/removeQuestion/:id/:pqId',  ['controller'=>'QuestionPaperApi','action'=>'removeQuestion'])->setPass(['id','pqId']);
 *   $builder->post('/QuestionPaperApi/publishPaper/:id',      ['controller'=>'QuestionPaperApi','action'=>'publishPaper'])->setPass(['id']);
 *   $builder->get('/QuestionPaperApi/exportDocx/:id',         ['controller'=>'QuestionPaperApi','action'=>'exportDocx'])->setPass(['id']);
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Endpoint summary:
 * ───────────────────────────────────────────────────────────────────────────────
 *   GET    /QuestionPaperApi/getPapers              — list papers (filter: class_id, subject_id, session, status)
 *   POST   /QuestionPaperApi/createPaper            — create paper header; returns {id}
 *   POST   /QuestionPaperApi/updatePaper/:id        — update header/config
 *   DELETE /QuestionPaperApi/deletePaper/:id        — delete draft paper
 *   GET    /QuestionPaperApi/getPaper/:id           — full paper + all questions
 *   POST   /QuestionPaperApi/addQuestion/:id        — add question to paper
 *   POST   /QuestionPaperApi/updateQuestion/:id/:pqId — update order/marks
 *   DELETE /QuestionPaperApi/removeQuestion/:id/:pqId — remove question from paper
 *   POST   /QuestionPaperApi/publishPaper/:id       — set status = published
 *   GET    /QuestionPaperApi/exportDocx/:id         — download paper as .docx (PHPWord)
 */
class QuestionPaperApiController extends AppController
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    private function clientCode(): string
    {
        return (string)(
            $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
        );
    }

    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function json(array $payload, int $status = 200): void
    {
        $this->autoRender = false;
        $this->response = $this->response
            ->withType('application/json')
            ->withStatus($status)
            ->withStringBody(json_encode($payload));
    }

    /** Recalculate and persist total_marks for a paper from its questions. */
    private function syncTotalMarks(int $paperId): void
    {
        $this->db()->execute(
            'UPDATE ssms_question_papers p
             SET p.total_marks = (
                 SELECT COALESCE(SUM(pq.marks), 0)
                 FROM ssms_paper_questions pq
                 WHERE pq.paper_id = ?
             )
             WHERE p.id = ?',
            [$paperId, $paperId]
        );
    }

    // ── GET /QuestionPaperApi/getPapers ───────────────────────────────────────

    public function getPapers(): void
    {
        $clientCode = $this->clientCode();
        $classId    = $this->request->getQuery('class_id');
        $subjectId  = $this->request->getQuery('subject_id');
        $session    = $this->request->getQuery('session');
        $status     = $this->request->getQuery('status');
        $branchId   = $this->request->getQuery('branch_id');
        $sessionId  = $this->request->getQuery('session_id');

        $where  = 'WHERE p.ssms_client_code = ?';
        $params = [$clientCode];

        if ($classId)   { $where .= ' AND p.class_id = ?';   $params[] = (int)$classId;  }
        if ($subjectId) { $where .= ' AND p.subject_id = ?'; $params[] = (int)$subjectId; }
        if ($session)   { $where .= ' AND p.session = ?';    $params[] = $session;         }
        if ($status)    { $where .= ' AND p.status = ?';     $params[] = $status;          }
        if ($branchId)  { $where .= ' AND p.branch_id = ?';  $params[] = (int)$branchId;  }
        if ($sessionId) { $where .= ' AND p.session_id = ?'; $params[] = (int)$sessionId; }

        try {
            $rows = $this->db()->execute("
                SELECT p.id, p.title, p.branch_id, p.session_id,
                       p.class_id, p.subject_id, p.subject_ids, p.session,
                       p.exam_type, p.total_marks, p.duration_minutes,
                       p.instructions, p.header_config, p.status, p.created_by, p.created_at,
                       c.class_name, s.subject_name
                FROM   ssms_question_papers p
                LEFT JOIN ssms_classes  c ON c.class_id = p.class_id
                LEFT JOIN ssms_subjects s ON s.subject_id = p.subject_id
                {$where}
                ORDER BY p.id DESC
                LIMIT 200
            ", $params)->fetchAll('assoc');

            foreach ($rows as &$row) {
                $row['instructions']  = $row['instructions']  ? json_decode($row['instructions'],  true) : [];
                $row['header_config'] = $row['header_config'] ? json_decode($row['header_config'], true) : [];
                $row['subject_ids']   = $row['subject_ids']   ? json_decode($row['subject_ids'],   true) : null;
            }
            unset($row);

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::getPapers ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch papers'], 500);
        }
    }

    // ── POST /QuestionPaperApi/createPaper ────────────────────────────────────

    public function createPaper(): void
    {
        $clientCode = $this->clientCode();
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];

        $title = trim((string)($d['title'] ?? ''));
        if (!$title) {
            $this->json(['status' => false, 'message' => 'title is required'], 400);
            return;
        }

        $classId     = ($d['class_id']   ?? null) ? (int)$d['class_id']   : null;
        $branchIdVal = ($d['branch_id']  ?? null) ? (int)$d['branch_id']  : null;
        $sessionIdVal= ($d['session_id'] ?? null) ? (int)$d['session_id'] : null;
        $createdBy   = ($d['created_by'] ?? null) ? (int)$d['created_by'] : null;

        // Multi-subject: subject_ids is an array; single-subject: subject_id scalar
        $subjectIdsRaw = $d['subject_ids'] ?? null;
        $isMulti = is_array($subjectIdsRaw) && count($subjectIdsRaw) > 1;
        $subjectId  = $isMulti ? null : (($d['subject_id'] ?? null) ? (int)$d['subject_id'] : null);
        $subjectIds = $isMulti ? json_encode(array_values(array_map('intval', $subjectIdsRaw))) : null;

        $instructions = isset($d['instructions'])
            ? (is_string($d['instructions']) ? $d['instructions'] : json_encode($d['instructions']))
            : null;
        $headerConfig = isset($d['header_config'])
            ? (is_string($d['header_config']) ? $d['header_config'] : json_encode($d['header_config']))
            : null;

        try {
            $this->db()->execute("
                INSERT INTO ssms_question_papers
                    (ssms_client_code, branch_id, session_id, title, class_id, subject_id, subject_ids, session,
                     exam_type, duration_minutes, instructions, header_config, created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ", [
                $clientCode, $branchIdVal, $sessionIdVal, $title, $classId, $subjectId, $subjectIds,
                trim((string)($d['session']           ?? '')),
                trim((string)($d['exam_type']         ?? 'Unit Test')),
                ($d['duration_minutes'] ?? null) ? (int)$d['duration_minutes'] : null,
                $instructions,
                $headerConfig,
                $createdBy,
            ]);
            $newId = (int)$this->db()->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];
            $this->json(['status' => true, 'message' => 'Paper created', 'data' => ['id' => $newId]]);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::createPaper ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to create paper'], 500);
        }
    }

    // ── POST /QuestionPaperApi/updatePaper/:id ────────────────────────────────

    public function updatePaper(string $id): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];

        // Confirm paper belongs to this school
        $exists = $this->db()->execute(
            'SELECT id FROM ssms_question_papers WHERE id = ? AND ssms_client_code = ?',
            [$paperId, $clientCode]
        )->fetchAssoc();
        if (!$exists) {
            $this->json(['status' => false, 'message' => 'Paper not found'], 404);
            return;
        }

        $set = []; $params = [];
        $scalar = [
            'title'            => fn($v) => trim((string)$v),
            'branch_id'        => fn($v) => $v ? (int)$v : null,
            'session_id'       => fn($v) => $v ? (int)$v : null,
            'class_id'         => fn($v) => $v ? (int)$v : null,
            'subject_id'       => fn($v) => $v ? (int)$v : null,
            'subject_ids'      => fn($v) => is_array($v) ? json_encode(array_values(array_map('intval', $v))) : ($v ? $v : null),
            'session'          => fn($v) => trim((string)$v),
            'exam_type'        => fn($v) => trim((string)$v),
            'duration_minutes' => fn($v) => $v ? (int)$v : null,
            'total_marks'      => fn($v) => (int)$v,
        ];
        foreach ($scalar as $col => $cast) {
            if (array_key_exists($col, $d)) { $set[] = "{$col} = ?"; $params[] = $cast($d[$col]); }
        }
        foreach (['instructions' => 'instructions', 'header_config' => 'header_config'] as $k => $col) {
            if (array_key_exists($k, $d)) {
                $set[]    = "{$col} = ?";
                $params[] = is_string($d[$k]) ? $d[$k] : json_encode($d[$k]);
            }
        }

        if (empty($set)) { $this->json(['status' => false, 'message' => 'Nothing to update'], 400); return; }

        $params[] = $paperId; $params[] = $clientCode;
        try {
            $this->db()->execute(
                'UPDATE ssms_question_papers SET ' . implode(', ', $set) . ' WHERE id = ? AND ssms_client_code = ?',
                $params
            );
            $this->json(['status' => true, 'message' => 'Paper updated']);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::updatePaper ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to update paper'], 500);
        }
    }

    // ── DELETE /QuestionPaperApi/deletePaper/:id ──────────────────────────────

    public function deletePaper(string $id): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;

        try {
            // Only draft papers can be deleted
            $paper = $this->db()->execute(
                'SELECT status FROM ssms_question_papers WHERE id = ? AND ssms_client_code = ?',
                [$paperId, $clientCode]
            )->fetchAssoc();

            if (!$paper) { $this->json(['status' => false, 'message' => 'Paper not found'], 404); return; }
            if ($paper['status'] === 'published') {
                $this->json(['status' => false, 'message' => 'Published papers cannot be deleted. Archive first.'], 403);
                return;
            }

            $db = $this->db();
            $db->execute('DELETE FROM ssms_paper_questions WHERE paper_id = ?', [$paperId]);
            $db->execute('DELETE FROM ssms_question_papers  WHERE id = ? AND ssms_client_code = ?', [$paperId, $clientCode]);
            $this->json(['status' => true, 'message' => 'Paper deleted']);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::deletePaper ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to delete paper'], 500);
        }
    }

    // ── GET /QuestionPaperApi/getPaper/:id ────────────────────────────────────

    public function getPaper(string $id): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;

        try {
            $paper = $this->db()->execute("
                SELECT p.id, p.title, p.branch_id, p.session_id,
                       p.class_id, p.subject_id, p.subject_ids, p.session, p.exam_type,
                       p.total_marks, p.duration_minutes, p.instructions, p.header_config,
                       p.status, p.created_by, p.created_at,
                       c.class_name, s.subject_name
                FROM   ssms_question_papers p
                LEFT JOIN ssms_classes  c ON c.class_id = p.class_id
                LEFT JOIN ssms_subjects s ON s.subject_id = p.subject_id
                WHERE  p.id = ? AND p.ssms_client_code = ?
            ", [$paperId, $clientCode])->fetchAssoc();

            if (!$paper) { $this->json(['status' => false, 'message' => 'Paper not found'], 404); return; }

            $paper['instructions']  = $paper['instructions']  ? json_decode($paper['instructions'],  true) : [];
            $paper['header_config'] = $paper['header_config'] ? json_decode($paper['header_config'], true) : [];
            $paper['subject_ids']   = $paper['subject_ids']   ? json_decode($paper['subject_ids'],   true) : null;

            // Resolve subject names for multi-subject papers
            if (is_array($paper['subject_ids']) && count($paper['subject_ids']) > 0) {
                $placeholders = implode(',', array_fill(0, count($paper['subject_ids']), '?'));
                $subs = $this->db()->execute(
                    "SELECT subject_id, subject_name FROM ssms_subjects WHERE subject_id IN ({$placeholders})",
                    $paper['subject_ids']
                )->fetchAll('assoc');
                $paper['subjects'] = $subs; // [{subject_id, subject_name}, ...]
            } elseif ($paper['subject_id'] && $paper['subject_name']) {
                $paper['subjects'] = [['subject_id' => (int)$paper['subject_id'], 'subject_name' => $paper['subject_name']]];
            } else {
                $paper['subjects'] = [];
            }

            // Fetch questions
            $questions = $this->db()->execute("
                SELECT pq.id AS pq_id, pq.question_id, pq.section_label, pq.order_index, pq.marks,
                       q.type, q.question_text, q.options, q.match_pairs, q.answer,
                       q.image_path, q.answer_lines, q.chapter,
                       s.subject_name, c.class_name
                FROM   ssms_paper_questions pq
                JOIN   ssms_question_bank q ON q.id = pq.question_id
                LEFT JOIN ssms_subjects   s ON s.subject_id = q.subject_id
                LEFT JOIN ssms_classes    c ON c.class_id = q.class_id
                WHERE  pq.paper_id = ?
                ORDER  BY pq.order_index ASC, pq.id ASC
            ", [$paperId])->fetchAll('assoc');

            foreach ($questions as &$q) {
                $q['options']     = $q['options']     ? json_decode($q['options'],     true) : null;
                $q['match_pairs'] = $q['match_pairs'] ? json_decode($q['match_pairs'], true) : null;
                if ($q['image_path']) {
                    $q['image_url'] = $q['image_path'];
                }
            }
            unset($q);

            $paper['questions'] = $questions;
            $this->json(['status' => true, 'data' => $paper]);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::getPaper ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch paper'], 500);
        }
    }

    // ── POST /QuestionPaperApi/addQuestion/:id ────────────────────────────────

    public function addQuestion(string $id): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];

        $questionId = (int)($d['question_id'] ?? 0);
        if (!$questionId) {
            $this->json(['status' => false, 'message' => 'question_id is required'], 400);
            return;
        }

        // Confirm paper belongs to this school and is not published
        $paper = $this->db()->execute(
            'SELECT id, status FROM ssms_question_papers WHERE id = ? AND ssms_client_code = ?',
            [$paperId, $clientCode]
        )->fetchAssoc();
        if (!$paper) { $this->json(['status' => false, 'message' => 'Paper not found'], 404); return; }
        if ($paper['status'] === 'published') {
            $this->json(['status' => false, 'message' => 'Cannot modify a published paper'], 403);
            return;
        }

        $marks      = (int)($d['marks']       ?? 2);
        $orderIndex = (int)($d['order_index'] ?? 999);
        $section    = trim((string)($d['section_label'] ?? ''));

        try {
            $this->db()->execute("
                INSERT INTO ssms_paper_questions (paper_id, question_id, section_label, order_index, marks)
                VALUES (?,?,?,?,?)
                ON DUPLICATE KEY UPDATE marks = VALUES(marks), order_index = VALUES(order_index),
                                        section_label = VALUES(section_label)
            ", [$paperId, $questionId, $section ?: null, $orderIndex, $marks]);

            $this->syncTotalMarks($paperId);
            $this->json(['status' => true, 'message' => 'Question added to paper']);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::addQuestion ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to add question'], 500);
        }
    }

    // ── POST /QuestionPaperApi/updateQuestion/:id/:pqId ───────────────────────

    public function updatePaperQuestion(string $id, string $pqId): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;
        $pqIdInt    = (int)$pqId;
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];

        // Verify paper ownership
        $paper = $this->db()->execute(
            'SELECT id FROM ssms_question_papers WHERE id = ? AND ssms_client_code = ?',
            [$paperId, $clientCode]
        )->fetchAssoc();
        if (!$paper) { $this->json(['status' => false, 'message' => 'Paper not found'], 404); return; }

        $set = []; $params = [];
        if (array_key_exists('marks',       $d)) { $set[] = 'marks = ?';         $params[] = (int)$d['marks'];                  }
        if (array_key_exists('order_index', $d)) { $set[] = 'order_index = ?';   $params[] = (int)$d['order_index'];            }
        if (array_key_exists('section_label',$d)){ $set[] = 'section_label = ?'; $params[] = trim((string)$d['section_label']); }

        if (empty($set)) { $this->json(['status' => false, 'message' => 'Nothing to update'], 400); return; }

        $params[] = $pqIdInt; $params[] = $paperId;
        try {
            $this->db()->execute(
                'UPDATE ssms_paper_questions SET ' . implode(', ', $set) . ' WHERE id = ? AND paper_id = ?',
                $params
            );
            $this->syncTotalMarks($paperId);
            $this->json(['status' => true, 'message' => 'Updated']);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::updatePaperQuestion ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to update'], 500);
        }
    }

    // ── DELETE /QuestionPaperApi/removeQuestion/:id/:pqId ────────────────────

    public function removeQuestion(string $id, string $pqId): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;
        $pqIdInt    = (int)$pqId;

        $paper = $this->db()->execute(
            'SELECT id, status FROM ssms_question_papers WHERE id = ? AND ssms_client_code = ?',
            [$paperId, $clientCode]
        )->fetchAssoc();
        if (!$paper) { $this->json(['status' => false, 'message' => 'Paper not found'], 404); return; }
        if ($paper['status'] === 'published') {
            $this->json(['status' => false, 'message' => 'Cannot modify a published paper'], 403);
            return;
        }

        try {
            $this->db()->execute(
                'DELETE FROM ssms_paper_questions WHERE id = ? AND paper_id = ?',
                [$pqIdInt, $paperId]
            );
            $this->syncTotalMarks($paperId);
            $this->json(['status' => true, 'message' => 'Question removed']);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::removeQuestion ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to remove question'], 500);
        }
    }

    // ── POST /QuestionPaperApi/publishPaper/:id ───────────────────────────────

    public function publishPaper(string $id): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;

        try {
            $affected = $this->db()->execute(
                "UPDATE ssms_question_papers SET status = 'published' WHERE id = ? AND ssms_client_code = ? AND status = 'draft'",
                [$paperId, $clientCode]
            )->rowCount();

            if ($affected === 0) {
                $this->json(['status' => false, 'message' => 'Paper not found or already published'], 400);
                return;
            }
            $this->json(['status' => true, 'message' => 'Paper published']);
        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::publishPaper ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to publish paper'], 500);
        }
    }

    // ── GET /QuestionPaperApi/exportDocx/:id ─────────────────────────────────
    /**
     * Generates a .docx Word file of the question paper using PHPWord.
     *
     * Requires: composer require phpoffice/phpword
     * Then: vendor/autoload.php is included automatically by CakePHP.
     */
    public function exportDocx(string $id): void
    {
        $clientCode = $this->clientCode();
        $paperId    = (int)$id;

        try {
            // Load paper + questions (reuse getPaper logic)
            $paper = $this->db()->execute("
                SELECT p.*, c.class_name, s.subject_name
                FROM   ssms_question_papers p
                LEFT JOIN ssms_classes  c ON c.class_id = p.class_id
                LEFT JOIN ssms_subjects s ON s.subject_id = p.subject_id
                WHERE  p.id = ? AND p.ssms_client_code = ?
            ", [$paperId, $clientCode])->fetchAssoc();

            if (!$paper) {
                $this->response = $this->response->withStatus(404)->withStringBody('Paper not found');
                return;
            }

            $questions = $this->db()->execute("
                SELECT pq.marks, pq.order_index, pq.section_label,
                       q.type, q.question_text, q.options, q.match_pairs, q.answer_lines, q.image_path
                FROM   ssms_paper_questions pq
                JOIN   ssms_question_bank q ON q.id = pq.question_id
                WHERE  pq.paper_id = ?
                ORDER  BY pq.order_index ASC, pq.id ASC
            ", [$paperId])->fetchAll('assoc');

            $cfg         = $paper['header_config'] ? json_decode($paper['header_config'], true) : [];
            $instructions = $paper['instructions']  ? json_decode($paper['instructions'],  true) : [];
            $schoolName  = $cfg['schoolName'] ?? $paper['title'];
            $schoolAddr  = $cfg['address']    ?? '';
            $className   = $paper['class_name']   ?? '';
            $subjectName = $paper['subject_name'] ?? '';
            $totalMarks  = (int)$paper['total_marks'];
            $session     = $paper['session']   ?? '';
            $examType    = $paper['exam_type'] ?? '';
            $duration    = $paper['duration_minutes'] ? $paper['duration_minutes'] . ' min' : '';

            // ── PHPWord document ─────────────────────────────────────────────
            if (!class_exists('\PhpOffice\PhpWord\PhpWord')) {
                // PHPWord not installed — return JSON error
                $this->json(['status' => false, 'message' => 'PHPWord not installed. Run: composer require phpoffice/phpword'], 500);
                return;
            }

            $phpWord = new \PhpOffice\PhpWord\PhpWord();
            $phpWord->setDefaultFontName('Calibri');
            $phpWord->setDefaultFontSize(11);

            $section = $phpWord->addSection([
                'pageSizeW'    => \PhpOffice\PhpWord\Shared\Converter::cmToTwip(21.0),
                'pageSizeH'    => \PhpOffice\PhpWord\Shared\Converter::cmToTwip(29.7),
                'marginTop'    => \PhpOffice\PhpWord\Shared\Converter::cmToTwip(1.5),
                'marginBottom' => \PhpOffice\PhpWord\Shared\Converter::cmToTwip(1.5),
                'marginLeft'   => \PhpOffice\PhpWord\Shared\Converter::cmToTwip(2.0),
                'marginRight'  => \PhpOffice\PhpWord\Shared\Converter::cmToTwip(2.0),
            ]);

            // ── Header: school name ─────────────────────────────────────────
            $section->addText($schoolName, ['bold' => true, 'size' => 16, 'name' => 'Calibri'], ['alignment' => 'center', 'spaceAfter' => 0]);
            if ($schoolAddr) {
                $section->addText($schoolAddr, ['size' => 9, 'color' => '555555'], ['alignment' => 'center', 'spaceAfter' => 40]);
            }

            // ── Meta row: Class | Subject | Marks ──────────────────────────
            $metaTable = $section->addTable(['borderSize' => 6, 'borderColor' => '000000', 'cellMargin' => 60]);
            $metaTable->addRow();
            foreach ([
                "कक्षा : {$className}",
                "विषय : {$subjectName}",
                "पूर्णांक : {$totalMarks}",
            ] as $cell) {
                $metaTable->addCell(3200)->addText($cell, ['bold' => true, 'size' => 10], ['alignment' => 'center']);
            }

            if ($examType || $session || $duration) {
                $metaTable->addRow();
                foreach ([
                    $examType ?: '',
                    $session  ? "सत्र : {$session}" : '',
                    $duration ? "समय : {$duration}" : '',
                ] as $cell) {
                    $metaTable->addCell(3200)->addText($cell, ['size' => 9], ['alignment' => 'center']);
                }
            }

            $section->addTextBreak(1);

            // ── Instructions ────────────────────────────────────────────────
            if (!empty($instructions)) {
                $section->addText('सामान्य निर्देश :', ['bold' => true, 'size' => 9]);
                foreach ($instructions as $i => $inst) {
                    $section->addListItem($inst, 0, ['size' => 9], ['listType' => \PhpOffice\PhpWord\Style\ListItem::TYPE_NUMBER]);
                }
                $section->addTextBreak(1);
            }

            // ── Questions ───────────────────────────────────────────────────
            $currentSection = null;
            foreach ($questions as $idx => $q) {
                // Section divider
                if ($q['section_label'] && $q['section_label'] !== $currentSection) {
                    $currentSection = $q['section_label'];
                    $section->addText($currentSection, ['bold' => true, 'size' => 11], ['alignment' => 'center', 'spaceAfter' => 80, 'spaceBefore' => 80]);
                }

                $qNum   = 'प्रश्न ' . ($idx + 1) . '.';
                $qText  = $q['question_text'] ?? '';
                $marks  = '(' . ($q['marks'] ?? 1) . ' अंक)';

                // Question stem with right-aligned marks using a table
                $qTable = $section->addTable(['borderSize' => 0, 'cellMargin' => 0]);
                $qTable->addRow();
                $qTable->addCell(600)->addText($qNum, ['bold' => true, 'size' => 10]);
                $qTable->addCell(8200)->addText($qText, ['size' => 10]);
                $qTable->addCell(1500)->addText($marks, ['bold' => true, 'size' => 9], ['alignment' => 'right']);

                // Type-specific content
                $type = $q['type'];

                if ($type === 'mcq' || $type === 'true_false') {
                    $opts = [];
                    try { $opts = json_decode($q['options'], true) ?: []; } catch (\Exception $e) {}
                    $letters = ['A', 'B', 'C', 'D'];
                    $optTable = $section->addTable(['borderSize' => 0]);
                    for ($i = 0; $i < count($opts); $i += 2) {
                        $optTable->addRow();
                        $a = '(' . $letters[$i]   . ') ' . ($opts[$i]['text']   ?? '');
                        $b = isset($opts[$i + 1]) ? '(' . $letters[$i + 1] . ') ' . ($opts[$i + 1]['text'] ?? '') : '';
                        $optTable->addCell(4900)->addText($a, ['size' => 9], ['indentation' => ['left' => 400]]);
                        $optTable->addCell(4900)->addText($b, ['size' => 9]);
                    }
                } elseif ($type === 'match') {
                    $pairs = [];
                    try { $pairs = json_decode($q['match_pairs'], true) ?: []; } catch (\Exception $e) {}
                    $shuffled = $pairs;
                    shuffle($shuffled);
                    $matchTable = $section->addTable(['borderSize' => 4, 'borderColor' => 'cccccc']);
                    $matchTable->addRow();
                    $matchTable->addCell(4500)->addText('Column A', ['bold' => true, 'size' => 9]);
                    $matchTable->addCell(4500)->addText('Column B', ['bold' => true, 'size' => 9]);
                    foreach ($pairs as $pi => $pair) {
                        $matchTable->addRow();
                        $matchTable->addCell(4500)->addText(($pi + 1) . '. ' . ($pair['left'] ?? ''), ['size' => 9]);
                        $matchTable->addCell(4500)->addText(chr(97 + $pi) . '. ' . ($shuffled[$pi]['right'] ?? ''), ['size' => 9]);
                    }
                } elseif ($type === 'short' || $type === 'long' || $type === 'figure') {
                    $lines = (int)($q['answer_lines'] ?? ($type === 'short' ? 5 : 10));
                    for ($i = 0; $i < $lines; $i++) {
                        $section->addText('', ['size' => 10], ['borderBottom' => ['color' => 'cccccc', 'size' => 4], 'spaceBefore' => 0, 'spaceAfter' => 200]);
                    }
                }

                // Image (if attached)
                if (!empty($q['image_path'])) {
                    $imgPath = WWW_ROOT . ltrim($q['image_path'], '/');
                    if (file_exists($imgPath)) {
                        $section->addImage($imgPath, ['width' => 150, 'alignment' => 'right']);
                    }
                }

                $section->addTextBreak(1);
            }

            // ── Footer line ─────────────────────────────────────────────────
            $section->addText('----------- समाप्त -----------', ['size' => 9], ['alignment' => 'center', 'spaceBefore' => 300]);

            // ── Stream response ─────────────────────────────────────────────
            $filename = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $paper['title'] ?? 'paper') . '.docx';
            $tmpFile  = tempnam(sys_get_temp_dir(), 'qp_');

            $objWriter = \PhpOffice\PhpWord\IOFactory::createWriter($phpWord, 'Word2007');
            $objWriter->save($tmpFile);

            $this->response = $this->response
                ->withHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                ->withHeader('Content-Disposition', 'attachment; filename="' . $filename . '"')
                ->withHeader('Content-Length',      (string)filesize($tmpFile))
                ->withStringBody(file_get_contents($tmpFile));

            @unlink($tmpFile);

        } catch (\Exception $e) {
            Log::error('QuestionPaperApi::exportDocx ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Export failed: ' . $e->getMessage()], 500);
        }
    }
}
