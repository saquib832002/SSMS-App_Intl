<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * QuestionBankApiController
 *
 * Manages the school's reusable question bank.
 * Questions are scoped to ssms_client_code so each school only sees its own.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SQL — run once in MySQL:
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * CREATE TABLE IF NOT EXISTS ssms_question_bank (
 *   id               INT AUTO_INCREMENT PRIMARY KEY,
 *   ssms_client_code VARCHAR(50)   NOT NULL,
 *   branch_id        INT           NOT NULL,
 *   session_id       INT           NOT NULL,
 *   subject_id       INT           NOT NULL,
 *   class_id         INT           NOT NULL,
 *   chapter          VARCHAR(150)  NULL,
 *   type             ENUM('fill_blank','mcq','true_false','match','short','long','passage','figure')
 *                    NOT NULL DEFAULT 'short',
 *   question_text    TEXT          NOT NULL,
 *   options          JSON          NULL,   -- [{text,isCorrect}] for MCQ/True-False
 *   match_pairs      JSON          NULL,   -- [{left,right}] for Match
 *   answer           TEXT          NULL,
 *   image_path       VARCHAR(255)  NULL,
 *   difficulty       ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
 *   marks            TINYINT UNSIGNED NOT NULL DEFAULT 2,
 *   answer_lines     TINYINT UNSIGNED NOT NULL DEFAULT 6,
 *   tags             JSON          NULL,
 *   created_by       INT           NULL,
 *   is_deleted       TINYINT(1)    NOT NULL DEFAULT 0,
 *   created_at       DATETIME      DEFAULT CURRENT_TIMESTAMP,
 *   updated_at       DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   INDEX idx_client (ssms_client_code),
 *   INDEX idx_client_branch  (ssms_client_code, branch_id),
 *   INDEX idx_client_session (ssms_client_code, session_id),
 *   INDEX idx_client_subject (ssms_client_code, subject_id),
 *   INDEX idx_client_class   (ssms_client_code, class_id),
 *   FULLTEXT INDEX ft_question (question_text)
 * );
 *
 * -- If the table already exists, run this migration instead:
 * ALTER TABLE ssms_question_bank
 *   ADD COLUMN branch_id  INT NOT NULL DEFAULT 0 AFTER ssms_client_code,
 *   ADD COLUMN session_id INT NOT NULL DEFAULT 0 AFTER branch_id,
 *   ADD INDEX idx_client_branch  (ssms_client_code, branch_id),
 *   ADD INDEX idx_client_session (ssms_client_code, session_id);
 * -- Tighten subject_id / class_id to NOT NULL (existing NULLs must be backfilled first):
 * UPDATE ssms_question_bank SET subject_id = 0 WHERE subject_id IS NULL;
 * UPDATE ssms_question_bank SET class_id   = 0 WHERE class_id   IS NULL;
 * ALTER TABLE ssms_question_bank
 *   MODIFY COLUMN branch_id  INT NOT NULL,
 *   MODIFY COLUMN session_id INT NOT NULL,
 *   MODIFY COLUMN subject_id INT NOT NULL,
 *   MODIFY COLUMN class_id   INT NOT NULL;
 *
 * -- Image upload directory (create on server):
 * --   webroot/clients/{client_code}/question_images/
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Routes — add inside the JWT-authenticated scope in config/routes.php:
 * ───────────────────────────────────────────────────────────────────────────────
 *   $builder->get('/QuestionBankApi/getQuestions',       ['controller'=>'QuestionBankApi','action'=>'getQuestions']);
 *   $builder->post('/QuestionBankApi/createQuestion',    ['controller'=>'QuestionBankApi','action'=>'createQuestion']);
 *   $builder->post('/QuestionBankApi/updateQuestion',     ['controller'=>'QuestionBankApi','action'=>'updateQuestion']);
 *   $builder->post('/QuestionBankApi/deleteQuestion',     ['controller'=>'QuestionBankApi','action'=>'deleteQuestion']);
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Endpoint summary:
 * ───────────────────────────────────────────────────────────────────────────────
 *   GET    /QuestionBankApi/getQuestions           — list questions (filters: subject_id, class_id, type, difficulty, keyword)
 *   POST   /QuestionBankApi/createQuestion         — create question; multipart if image attached
 *   POST   /QuestionBankApi/updateQuestion          — update question    (id in body)
 *   POST   /QuestionBankApi/deleteQuestion         — soft-delete question (id in body)
 */
class QuestionBankApiController extends AppController
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

    /**
     * Convert a value to a JSON string for storage, or null if empty/invalid.
     * Accepts: array, non-empty string (validated as JSON), or null/empty.
     */
    private function toJsonOrNull(mixed $v): ?string
    {
        if ($v === null || $v === '' || $v === []) return null;
        if (is_array($v)) return json_encode($v);
        if (is_string($v)) {
            // validate it's real JSON before storing
            json_decode($v);
            return (json_last_error() === JSON_ERROR_NONE) ? $v : null;
        }
        return null;
    }

    /** Upload a question image and return the relative web path, or null on failure. */
    private function uploadImage(string $clientCode): ?string
    {
        $file = $this->request->getUploadedFile('image');
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) {
            return null;
        }
        $allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!in_array($file->getClientMediaType(), $allowed, true)) {
            return null;
        }
        $ext = pathinfo($file->getClientFilename(), PATHINFO_EXTENSION) ?: 'jpg';

        // Use same convention as student/gallery uploads:
        // __DIR__ = htdocs/src/Controller/ → two levels up = htdocs root
        // This keeps question images alongside all other client files at
        // htdocs/clients/{clientCode}/question_images/ (NOT inside webroot/)
        $dir = dirname(dirname(__DIR__)) . DS . 'clients' . DS . $clientCode . DS . 'question_images';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $name = uniqid('qi_', true) . '.' . strtolower($ext);
        $file->moveTo($dir . DS . $name);
        return '/clients/' . $clientCode . '/question_images/' . $name;
    }

    /**
     * Sync the isCorrect flag in each option based on the answer column value.
     * e.g. answer "B" → options[1].isCorrect = true, all others false.
     *      answer "A,C" → options[0] and options[2] are true.
     * Returns the updated options JSON string, or the original if no change is needed.
     */
    private function syncIsCorrectFromAnswer(string $type, ?string $optionsJson, string $answer): ?string
    {
        if (!in_array($type, ['mcq', 'true_false', 'multi_correct'], true)) {
            return $optionsJson;
        }
        $opts = $optionsJson ? (json_decode($optionsJson, true) ?? []) : [];
        if (!is_array($opts) || empty($opts)) return $optionsJson;

        $answerUpper    = strtoupper(trim($answer));
        if ($answerUpper === '') return $optionsJson;   // nothing to sync

        $correctLetters = array_filter(
            array_map('trim', explode(',', $answerUpper)),
            fn($l) => $l !== ''
        );

        $synced = [];
        foreach ($opts as $i => $opt) {
            $letter           = chr(ord('A') + $i);
            $opt['isCorrect'] = in_array($letter, $correctLetters, true);
            $synced[]         = $opt;
        }
        return json_encode($synced);
    }

    // ── GET /QuestionBankApi/getQuestions ─────────────────────────────────────

    public function getQuestions(): void
    {
        $clientCode = $this->clientCode();
        $subjectId  = $this->request->getQuery('subject_id');
        $classId    = $this->request->getQuery('class_id');
        $branchId   = $this->request->getQuery('branch_id');
        $sessionId  = $this->request->getQuery('session_id');
        $type       = $this->request->getQuery('type');
        $difficulty = $this->request->getQuery('difficulty');
        $keyword    = trim((string)$this->request->getQuery('keyword'));
        $chapterId  = $this->request->getQuery('chapter_id');

        $where  = 'WHERE q.ssms_client_code = ? AND q.is_deleted = 0';
        $params = [$clientCode];

        if ($subjectId) { $where .= ' AND q.subject_id = ?';  $params[] = (int)$subjectId; }
        if ($classId)   { $where .= ' AND q.class_id = ?';    $params[] = (int)$classId;   }
        if ($branchId)  { $where .= ' AND q.branch_id = ?';   $params[] = (int)$branchId;  }
        if ($sessionId) { $where .= ' AND q.session_id = ?';  $params[] = (int)$sessionId; }
        if ($type)      { $where .= ' AND q.type = ?';        $params[] = $type;            }
        if ($difficulty){ $where .= ' AND q.difficulty = ?';  $params[] = $difficulty;      }
        if ($keyword)   { $where .= ' AND q.question_text LIKE ?'; $params[] = '%' . $keyword . '%'; }
        if ($chapterId) { $where .= ' AND q.chapter_id = ?';  $params[] = (int)$chapterId;  }

        try {
            $rows = $this->db()->execute("
                SELECT q.id, q.branch_id, q.session_id,
                       q.subject_id, q.class_id, q.chapter_id, q.chapter, q.type,
                       q.question_text, q.options, q.match_pairs, q.answer,
                       q.image_path, q.difficulty, q.marks, q.answer_lines,
                       q.tags, q.created_at,
                       s.subject_name, c.class_name,
                       ch.chapter_name, ch.chapter_no
                FROM   ssms_question_bank q
                LEFT JOIN ssms_subjects   s  ON s.subject_id  = q.subject_id
                LEFT JOIN ssms_classes    c  ON c.class_id    = q.class_id
                LEFT JOIN ssms_chapters   ch ON ch.id = q.chapter_id
                {$where}
                ORDER BY q.id DESC
                LIMIT 500
            ", $params)->fetchAll('assoc');

            // Decode JSON columns
            foreach ($rows as &$row) {
                $row['options']     = $row['options']     ? json_decode($row['options'],     true) : null;
                $row['match_pairs'] = $row['match_pairs'] ? json_decode($row['match_pairs'], true) : null;
                $row['tags']        = $row['tags']        ? json_decode($row['tags'],        true) : null;
                if ($row['image_path']) {
                    $row['image_url'] = $row['image_path'];
                }
            }
            unset($row);

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('QuestionBankApi::getQuestions ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch questions'], 500);
        }
    }

    // ── POST /QuestionBankApi/createQuestion ──────────────────────────────────

    public function createQuestion(): void
    {
        $clientCode = $this->clientCode();
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];

        // If id is present in body → treat as update.
        // This lets the frontend reuse the createQuestion route (which is already in routes.php)
        // without needing a separate updateQuestion route entry.
        if (!empty($d['id'])) {
            $this->doUpdateQuestion($clientCode, $d);
            return;
        }

        $type         = trim((string)($d['type']          ?? 'short'));
        $questionText = trim((string)($d['question_text'] ?? ''));
        if (!$questionText) {
            $this->json(['status' => false, 'message' => 'question_text is required'], 400);
            return;
        }

        $validTypes = ['fill_blank','mcq','multi_correct','true_false','match','short','long','passage','figure'];
        if (!in_array($type, $validTypes, true)) {
            $this->json(['status' => false, 'message' => 'Invalid question type'], 400);
            return;
        }

        $options    = $this->toJsonOrNull($d['options']     ?? null);
        $matchPairs = $this->toJsonOrNull($d['match_pairs'] ?? null);
        $tags       = $this->toJsonOrNull($d['tags']        ?? null);
        $imagePath  = $this->uploadImage($clientCode);

        $branchIdVal = ($d['branch_id']  ?? null) ? (int)$d['branch_id']  : 0;
        $sessionIdVal= ($d['session_id'] ?? null) ? (int)$d['session_id'] : 0;
        $subjectId   = ($d['subject_id'] ?? null) ? (int)$d['subject_id'] : 0;
        $classId     = ($d['class_id']   ?? null) ? (int)$d['class_id']   : 0;
        $createdBy   = ($d['created_by'] ?? null) ? (int)$d['created_by'] : null;
        $marks       = (int)($d['marks']        ?? 2);
        $answerLines = (int)($d['answer_lines'] ?? 6);
        $difficulty  = in_array($d['difficulty'] ?? '', ['easy','medium','hard']) ? $d['difficulty'] : 'medium';

        // qb.answer column is the authoritative value — use it directly.
        // Sync the isCorrect flags in the options JSON to match, so they stay consistent.
        $answerVal = trim((string)($d['answer'] ?? ''));
        if ($options !== null && $answerVal !== '') {
            $options = $this->syncIsCorrectFromAnswer($type, $options, $answerVal);
        }

        try {
            $chapterId = isset($d['chapter_id']) && $d['chapter_id'] !== '' && $d['chapter_id'] !== null
                ? (int)$d['chapter_id'] : null;

            $this->db()->execute("
                INSERT INTO ssms_question_bank
                    (ssms_client_code, branch_id, session_id, subject_id, class_id, chapter_id, chapter, type,
                     question_text, options, match_pairs, answer, explanation, image_path,
                     difficulty, marks, answer_lines, tags, created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ", [
                $clientCode, $branchIdVal, $sessionIdVal, $subjectId, $classId,
                $chapterId,
                trim((string)($d['chapter']      ?? '')),
                $type, $questionText, $options, $matchPairs,
                $answerVal,
                trim((string)($d['explanation']  ?? '')),
                $imagePath,
                $difficulty, $marks, $answerLines, $tags, $createdBy,
            ]);

            $newId = (int)$this->db()->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];
            $this->json(['status' => true, 'message' => 'Question created', 'data' => ['id' => $newId]]);
        } catch (\Exception $e) {
            Log::error('QuestionBankApi::createQuestion ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to create question'], 500);
        }
    }

    // ── POST /QuestionBankApi/updateQuestion (also called from createQuestion) ──

    public function updateQuestion(): void
    {
        $clientCode = $this->clientCode();
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];
        $this->doUpdateQuestion($clientCode, $d);
    }

    /** Shared update logic — called by both updateQuestion() and createQuestion() (when id present). */
    private function doUpdateQuestion(string $clientCode, array $d): void
    {
        $qId = (int)($d['id'] ?? 0);
        if (!$qId) {
            $this->json(['status' => false, 'message' => 'Question id is required'], 400);
            return;
        }

        // Verify ownership
        $existing = $this->db()->execute(
            'SELECT id, image_path FROM ssms_question_bank WHERE id = ? AND ssms_client_code = ? AND is_deleted = 0',
            [$qId, $clientCode]
        )->fetchAssoc();

        if (!$existing) {
            $this->json(['status' => false, 'message' => 'Question not found'], 404);
            return;
        }

        // Build SET clause dynamically
        $set    = [];
        $params = [];

        $fields = [
            'branch_id'     => fn($v) => (int)$v,
            'session_id'    => fn($v) => (int)$v,
            'subject_id'    => fn($v) => (int)$v,
            'class_id'      => fn($v) => (int)$v,
            'chapter_id'    => fn($v) => ($v !== '' && $v !== null) ? (int)$v : null,
            'chapter'       => fn($v) => trim((string)$v),
            'type'          => fn($v) => trim((string)$v),
            'question_text' => fn($v) => trim((string)$v),
            'answer'        => fn($v) => trim((string)$v),
            'explanation'   => fn($v) => trim((string)$v),
            'difficulty'    => fn($v) => in_array($v, ['easy','medium','hard']) ? $v : 'medium',
            'marks'         => fn($v) => (int)$v,
            'answer_lines'  => fn($v) => (int)$v,
        ];
        foreach ($fields as $col => $cast) {
            if (array_key_exists($col, $d)) {
                $set[]    = "{$col} = ?";
                $params[] = $cast($d[$col]);
            }
        }

        // JSON columns
        $updatedOptionsJson = null;
        foreach (['options', 'match_pairs', 'tags'] as $col) {
            if (array_key_exists($col, $d)) {
                $jsonVal  = $this->toJsonOrNull($d[$col]);
                $set[]    = "{$col} = ?";
                $params[] = $jsonVal;
                if ($col === 'options') $updatedOptionsJson = $jsonVal;
            }
        }

        // If options were updated, re-derive the answer letter from isCorrect flags
        // Sync isCorrect flags in options from the answer column (qb.answer is the authority).
        if ($updatedOptionsJson !== null) {
            $qType = trim((string)($d['type'] ?? ''));
            if ($qType === '') {
                $existingType = $this->db()->execute(
                    'SELECT type FROM ssms_question_bank WHERE id = ?', [$qId]
                )->fetchAssoc()['type'] ?? '';
                $qType = $existingType;
            }
            // Find the answer value being saved (from the payload's answer field, if present)
            $answerIdx = array_search('answer = ?', $set);
            $answerForSync = $answerIdx !== false
                ? $params[$answerIdx]
                : trim((string)($d['answer'] ?? ''));
            if ($answerForSync !== '') {
                $synced = $this->syncIsCorrectFromAnswer($qType, $updatedOptionsJson, $answerForSync);
                // Update the options param in the $set/$params arrays
                $optIdx = array_search('options = ?', $set);
                if ($optIdx !== false) {
                    $params[$optIdx] = $synced;
                }
            }
        }

        // Image upload (replaces old image)
        $newImage = $this->uploadImage($clientCode);
        if ($newImage) {
            $set[]    = 'image_path = ?';
            $params[] = $newImage;
        }

        if (empty($set)) {
            $this->json(['status' => false, 'message' => 'Nothing to update'], 400);
            return;
        }

        $params[] = $qId;
        $params[] = $clientCode;

        try {
            $this->db()->execute(
                'UPDATE ssms_question_bank SET ' . implode(', ', $set) . ' WHERE id = ? AND ssms_client_code = ?',
                $params
            );
            $this->json(['status' => true, 'message' => 'Question updated']);
        } catch (\Exception $e) {
            Log::error('QuestionBankApi::updateQuestion ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to update question'], 500);
        }
    }

    // ── POST /QuestionBankApi/deleteQuestion ──────────────────────────────────

    public function deleteQuestion(): void
    {
        $clientCode = $this->clientCode();
        $raw  = (string)$this->request->getBody();
        $d    = json_decode($raw, true) ?: $this->request->getData() ?: [];
        $qId  = (int)($d['id'] ?? $this->request->getQuery('id') ?? 0);
        if (!$qId) {
            $this->json(['status' => false, 'message' => 'Question id is required'], 400);
            return;
        }

        try {
            $affected = $this->db()->execute(
                'UPDATE ssms_question_bank SET is_deleted = 1 WHERE id = ? AND ssms_client_code = ?',
                [$qId, $clientCode]
            )->rowCount();

            if ($affected === 0) {
                $this->json(['status' => false, 'message' => 'Question not found'], 404);
                return;
            }
            $this->json(['status' => true, 'message' => 'Question deleted']);
        } catch (\Exception $e) {
            Log::error('QuestionBankApi::deleteQuestion ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to delete question'], 500);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BULK IMPORT
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /QuestionBankApi/getImportReference
     *
     * Returns all branches, sessions, classes, and subjects for this school
     * so the app can build the Excel template's Reference sheet and validate
     * name lookups before sending rows to importQuestions.
     */
    public function getImportReference(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }
        try {
            $db = $this->db();

            $branches = $db->execute(
                "SELECT branch_id AS id, branch_name AS name
                 FROM ssms_branch
                 WHERE ssms_client_code = ?
                 ORDER BY branch_name ASC",
                [$clientCode]
            )->fetchAll('assoc');

            $sessions = $db->execute(
                "SELECT session_id AS id, session_name AS name
                 FROM ssms_sessions
                 WHERE ssms_client_code = ?
                 ORDER BY session_id DESC",
                [$clientCode]
            )->fetchAll('assoc');

            $classes = $db->execute(
                "SELECT class_id AS id, class_name AS name
                 FROM ssms_classes
                 WHERE ssms_client_code = ?
                 ORDER BY class_name ASC",
                [$clientCode]
            )->fetchAll('assoc');

            $subjects = $db->execute(
                "SELECT subject_id AS id, subject_name AS name
                 FROM ssms_subjects
                 WHERE ssms_client_code = ?
                 ORDER BY subject_name ASC",
                [$clientCode]
            )->fetchAll('assoc');

            $this->json([
                'status' => true,
                'data'   => compact('branches', 'sessions', 'classes', 'subjects'),
            ]);
        } catch (\Exception $e) {
            Log::error('QuestionBankApi::getImportReference ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to load reference data'], 500);
        }
    }

    /**
     * POST /QuestionBankApi/importQuestions
     *
     * Body: { questions: [ {type, question_text, option_a, option_b, option_c,
     *                        option_d, answer, marks, negative_marks, difficulty,
     *                        chapter, explanation, subject_name, class_name,
     *                        branch_name, session_name} ] }
     *
     * Resolves names → IDs, validates each row, bulk-inserts valid questions.
     * Returns { imported, failed, errors: [{row, message}] }.
     */
    public function importQuestions(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $body = $this->request->getParsedBody();
        $rows = $body['questions'] ?? [];

        if (empty($rows) || !is_array($rows)) {
            $this->json(['status' => false, 'message' => 'No questions provided'], 400);
            return;
        }

        $db          = $this->db();
        $imported    = 0;
        $failed      = 0;
        $errors      = [];
        $validTypes  = ['mcq', 'multi_correct', 'true_false', 'short', 'long',
                        'fill_blank', 'passage', 'figure', 'match'];
        $validDiffs  = ['easy', 'medium', 'hard'];
        $optLetters  = ['A', 'B', 'C', 'D', 'E', 'F'];

        // ── Build lookup maps: name (lowercased) → id ─────────────────────────
        $buildMap = function (string $table, string $idCol, string $nameCol) use ($db, $clientCode): array {
            $rows = $db->execute(
                "SELECT {$idCol} AS id, {$nameCol} AS name
                 FROM   {$table}
                 WHERE  ssms_client_code = ?", [$clientCode]
            )->fetchAll('assoc');
            $map = [];
            foreach ($rows as $r) {
                $map[strtolower(trim((string)$r['name']))] = (int)$r['id'];
            }
            return $map;
        };

        $branchMap  = $buildMap('ssms_branch',   'branch_id',  'branch_name');
        $sessionMap = $buildMap('ssms_sessions', 'session_id', 'session_name');
        $classMap   = $buildMap('ssms_classes',  'class_id',   'class_name');
        $subjectMap = $buildMap('ssms_subjects', 'subject_id', 'subject_name');

        // Default branch: header or first branch in school
        $defaultBranchId = null;
        $headerBranch    = trim($this->request->getHeaderLine('ssmsBranchId'));
        if ($headerBranch && is_numeric($headerBranch)) {
            $defaultBranchId = (int)$headerBranch;
        } elseif (!empty($branchMap)) {
            $defaultBranchId = reset($branchMap);
        }

        // Default session: most recent
        $defaultSessionId = null;
        if (!empty($sessionMap)) {
            $defaultSessionId = reset($sessionMap);
        }

        // ── Process each row ───────────────────────────────────────────────────
        foreach ($rows as $idx => $row) {
            $rowNum = $idx + 2; // Excel row (1=header, so data starts at 2)
            $errs   = [];

            $type = strtolower(trim((string)($row['type'] ?? '')));
            if (!in_array($type, $validTypes, true)) {
                $errs[] = "Invalid type '{$type}'. Use: mcq, multi_correct, true_false, short, long.";
            }

            $questionText = trim((string)($row['question_text'] ?? ''));
            if ($questionText === '') {
                $errs[] = "Question text is required.";
            }

            // Subject (required)
            $subjectName = strtolower(trim((string)($row['subject_name'] ?? '')));
            $subjectId   = $subjectMap[$subjectName] ?? null;
            if (!$subjectId) {
                $errs[] = "Subject '{$row['subject_name']}' not found. Check the Reference sheet for valid names.";
            }

            // Class (required)
            $className = strtolower(trim((string)($row['class_name'] ?? '')));
            $classId   = $classMap[$className] ?? null;
            if (!$classId) {
                $errs[] = "Class '{$row['class_name']}' not found. Check the Reference sheet for valid names.";
            }

            // Branch (optional — default to user's branch)
            $branchId = $defaultBranchId;
            if (!empty($row['branch_name'])) {
                $branchKey = strtolower(trim((string)$row['branch_name']));
                $branchId  = $branchMap[$branchKey] ?? $defaultBranchId;
            }
            if (!$branchId) {
                $errs[] = "Branch not found. Provide a valid branch name or leave blank to use your default.";
            }

            // Session (optional — default to most recent)
            $sessionId = $defaultSessionId;
            if (!empty($row['session_name'])) {
                $sessionKey = strtolower(trim((string)$row['session_name']));
                $sessionId  = $sessionMap[$sessionKey] ?? $defaultSessionId;
            }
            if (!$sessionId) {
                $errs[] = "Session not found. Provide a valid session name or leave blank to use the latest.";
            }

            // Marks
            $marks = isset($row['marks']) && $row['marks'] !== '' ? (float)$row['marks'] : 1;
            if ($marks <= 0) $marks = 1;

            // Negative marks
            $negMarks = isset($row['negative_marks']) && $row['negative_marks'] !== ''
                ? (float)$row['negative_marks'] : 0;
            if ($negMarks < 0) $negMarks = 0;

            // Difficulty
            $diff = strtolower(trim((string)($row['difficulty'] ?? 'medium')));
            if (!in_array($diff, $validDiffs, true)) $diff = 'medium';

            // Chapter, explanation
            $chapter     = trim((string)($row['chapter']     ?? ''));
            $explanation = trim((string)($row['explanation'] ?? ''));

            // Answer
            $answer = strtoupper(trim((string)($row['answer'] ?? '')));

            // Build options JSON for MCQ / multi_correct / true_false
            $optionsJson = null;
            if (in_array($type, ['mcq', 'multi_correct', 'true_false'], true)) {
                $optArr = [];
                if ($type === 'true_false') {
                    $optArr = [
                        ['text' => 'True',  'isCorrect' => strtolower($answer) === 'true'],
                        ['text' => 'False', 'isCorrect' => strtolower($answer) === 'false'],
                    ];
                    // Normalise answer
                    $answer = in_array(strtolower($answer), ['true', 'a']) ? 'A' : 'B';
                } else {
                    $optKeys = ['option_a', 'option_b', 'option_c', 'option_d'];
                    $correctLetters = array_filter(
                        array_map('trim', explode(',', $answer)),
                        fn($l) => $l !== ''
                    );
                    foreach ($optKeys as $i => $key) {
                        $text = trim((string)($row[$key] ?? ''));
                        if ($text === '' && $i >= 2) continue; // C & D optional
                        if ($text === '' && $i < 2) {
                            $errs[] = "Option " . strtoupper(substr($key, -1)) . " is required for {$type}.";
                            continue;
                        }
                        $letter    = $optLetters[$i];
                        $isCorrect = in_array($letter, $correctLetters, true);
                        $optArr[]  = ['text' => $text, 'isCorrect' => $isCorrect];
                    }
                    if (!empty($optArr) && empty($correctLetters)) {
                        $errs[] = "Answer column is required for {$type}. Use A, B, C, or D (comma-separated for multi_correct).";
                    }
                }
                if (!empty($optArr)) {
                    $optionsJson = json_encode($optArr);
                }
            }

            if (!empty($errs)) {
                foreach ($errs as $msg) {
                    $errors[] = ['row' => $rowNum, 'message' => $msg];
                }
                $failed++;
                continue;
            }

            // ── Insert ─────────────────────────────────────────────────────────
            try {
                $db->execute(
                    "INSERT INTO ssms_question_bank
                         (ssms_client_code, branch_id, session_id, subject_id, class_id,
                          chapter, type, question_text, options, answer, explanation,
                          difficulty, marks)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [
                        $clientCode, $branchId, $sessionId, $subjectId, $classId,
                        $chapter ?: null, $type, $questionText, $optionsJson,
                        $answer ?: null, $explanation ?: null,
                        $diff, (int)$marks,
                    ]
                );
                $imported++;
            } catch (\Exception $e) {
                Log::error("QuestionBankApi::importQuestions row {$rowNum}: " . $e->getMessage());
                $errors[] = ['row' => $rowNum, 'message' => 'Database error: ' . $e->getMessage()];
                $failed++;
            }
        }

        $this->json([
            'status'   => true,
            'imported' => $imported,
            'failed'   => $failed,
            'errors'   => $errors,
        ]);
    }
}
