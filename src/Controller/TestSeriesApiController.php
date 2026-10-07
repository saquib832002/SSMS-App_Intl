<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * TestSeriesApiController
 * File: src/Controller/TestSeriesApiController.php  (or place in Controllers/ per project layout)
 *
 * Manages the full Test Series / Online Exam lifecycle for SSMS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SQL MIGRATION — run once in MySQL
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * CREATE TABLE IF NOT EXISTS ssms_test_series (
 *   id           INT AUTO_INCREMENT PRIMARY KEY,
 *   client_code  VARCHAR(50)  NOT NULL,
 *   title        VARCHAR(200) NOT NULL,
 *   description  TEXT         NULL,
 *   exam_type    VARCHAR(100) NULL,
 *   branch_id    INT          NOT NULL DEFAULT 0,
 *   session_id   INT          NOT NULL DEFAULT 0,
 *   class_id     INT          NOT NULL DEFAULT 0,
 *   status       ENUM('active','inactive') NOT NULL DEFAULT 'active',
 *   created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *   updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   INDEX idx_ts_client (client_code)
 * );
 *
 * CREATE TABLE IF NOT EXISTS ssms_tests (
 *   id                      INT AUTO_INCREMENT PRIMARY KEY,
 *   client_code             VARCHAR(50)    NOT NULL,
 *   series_id               INT            NOT NULL,
 *   title                   VARCHAR(200)   NOT NULL,
 *   instructions            TEXT           NULL,
 *   duration_minutes        INT            NOT NULL DEFAULT 60,
 *   total_marks             DECIMAL(8,2)   NOT NULL DEFAULT 100,
 *   passing_marks           DECIMAL(8,2)   NOT NULL DEFAULT 35,
 *   negative_marking_ratio  DECIMAL(4,2)   NOT NULL DEFAULT 0.25,
 *   question_randomize      TINYINT(1)     NOT NULL DEFAULT 0,
 *   answer_randomize        TINYINT(1)     NOT NULL DEFAULT 0,
 *   show_result_immediately TINYINT(1)     NOT NULL DEFAULT 1,
 *   scheduled_start         DATETIME       NULL,
 *   scheduled_end           DATETIME       NULL,
 *   branch_id               INT            NOT NULL DEFAULT 0,
 *   session_id              INT            NOT NULL DEFAULT 0,
 *   class_id                INT            NOT NULL DEFAULT 0,
 *   status                  ENUM('draft','published','closed') NOT NULL DEFAULT 'draft',
 *   created_at              DATETIME       DEFAULT CURRENT_TIMESTAMP,
 *   updated_at              DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   INDEX idx_t_client (client_code),
 *   INDEX idx_t_series (series_id)
 * );
 *
 * CREATE TABLE IF NOT EXISTS ssms_test_sections (
 *   id                 INT AUTO_INCREMENT PRIMARY KEY,
 *   client_code        VARCHAR(50)  NOT NULL,
 *   test_id            INT          NOT NULL,
 *   title              VARCHAR(200) NOT NULL,
 *   description        TEXT         NULL,
 *   marks_per_question DECIMAL(6,2) NOT NULL DEFAULT 1,
 *   negative_marks     DECIMAL(6,2) NOT NULL DEFAULT 0,
 *   created_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *   INDEX idx_sec_test (test_id)
 * );
 *
 * CREATE TABLE IF NOT EXISTS ssms_test_questions (
 *   id             INT AUTO_INCREMENT PRIMARY KEY,
 *   client_code    VARCHAR(50)  NOT NULL,
 *   test_id        INT          NOT NULL,
 *   section_id     INT          NULL,
 *   question_id    INT          NOT NULL,
 *   marks          DECIMAL(6,2) NOT NULL DEFAULT 1,
 *   negative_marks DECIMAL(6,2) NOT NULL DEFAULT 0,
 *   question_order INT          NOT NULL DEFAULT 0,
 *   INDEX idx_tq_test     (test_id),
 *   INDEX idx_tq_question (question_id),
 *   UNIQUE KEY uq_tq (test_id, question_id)
 * );
 *
 * CREATE TABLE IF NOT EXISTS ssms_test_attempts (
 *   id                INT AUTO_INCREMENT PRIMARY KEY,
 *   client_code       VARCHAR(50)  NOT NULL,
 *   test_id           INT          NOT NULL,
 *   student_id        INT          NOT NULL,
 *   enrollment_id     INT          NOT NULL,
 *   status            ENUM('in_progress','submitted') NOT NULL DEFAULT 'in_progress',
 *   score             DECIMAL(8,2) NOT NULL DEFAULT 0,
 *   correct_count     INT          NOT NULL DEFAULT 0,
 *   wrong_count       INT          NOT NULL DEFAULT 0,
 *   unattempted_count INT          NOT NULL DEFAULT 0,
 *   rank              INT          NOT NULL DEFAULT 0,
 *   percentile        DECIMAL(5,2) NOT NULL DEFAULT 0,
 *   started_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *   submitted_at      DATETIME     NULL,
 *   INDEX idx_ta_test    (test_id),
 *   INDEX idx_ta_student (student_id),
 *   UNIQUE KEY uq_attempt (test_id, enrollment_id)
 * );
 *
 * CREATE TABLE IF NOT EXISTS ssms_test_responses (
 *   id                   INT AUTO_INCREMENT PRIMARY KEY,
 *   client_code          VARCHAR(50)    NOT NULL,
 *   attempt_id           INT            NOT NULL,
 *   test_question_id     INT            NOT NULL,
 *   question_id          INT            NOT NULL,
 *   selected_option      VARCHAR(500)   NULL,
 *   numerical_answer     DECIMAL(12,4)  NULL,
 *   is_marked_for_review TINYINT(1)     NOT NULL DEFAULT 0,
 *   is_attempted         TINYINT(1)     NOT NULL DEFAULT 0,
 *   time_spent_seconds   INT            NOT NULL DEFAULT 0,
 *   marks_awarded        DECIMAL(6,2)   NOT NULL DEFAULT 0,
 *   is_correct           TINYINT(1)     NOT NULL DEFAULT 0,
 *   INDEX idx_tr_attempt (attempt_id),
 *   UNIQUE KEY uq_response (attempt_id, test_question_id)
 * );
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * AppController — add 'TestSeriesApi' to $apiControllers array
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Routes — add inside the JWT-authenticated scope in config/routes.php:
 * ───────────────────────────────────────────────────────────────────────────────
 *   // Admin / Teacher
 *   $builder->post('/TestSeriesApi/createSeries',      ['controller'=>'TestSeriesApi','action'=>'createSeries']);
 *   $builder->get('/TestSeriesApi/getSeriesList',      ['controller'=>'TestSeriesApi','action'=>'getSeriesList']);
 *   $builder->post('/TestSeriesApi/updateSeries',      ['controller'=>'TestSeriesApi','action'=>'updateSeries']);
 *   $builder->post('/TestSeriesApi/deleteSeries',      ['controller'=>'TestSeriesApi','action'=>'deleteSeries']);
 *   $builder->post('/TestSeriesApi/createTest',        ['controller'=>'TestSeriesApi','action'=>'createTest']);
 *   $builder->get('/TestSeriesApi/getTestsBySeriesId', ['controller'=>'TestSeriesApi','action'=>'getTestsBySeriesId']);
 *   $builder->post('/TestSeriesApi/updateTest',        ['controller'=>'TestSeriesApi','action'=>'updateTest']);
 *   $builder->post('/TestSeriesApi/deleteTest',        ['controller'=>'TestSeriesApi','action'=>'deleteTest']);
 *   $builder->post('/TestSeriesApi/addSection',        ['controller'=>'TestSeriesApi','action'=>'addSection']);
 *   $builder->get('/TestSeriesApi/getSections',        ['controller'=>'TestSeriesApi','action'=>'getSections']);
 *   $builder->post('/TestSeriesApi/deleteSection',     ['controller'=>'TestSeriesApi','action'=>'deleteSection']);
 *   $builder->post('/TestSeriesApi/addQuestions',      ['controller'=>'TestSeriesApi','action'=>'addQuestions']);
 *   $builder->post('/TestSeriesApi/removeQuestion',    ['controller'=>'TestSeriesApi','action'=>'removeQuestion']);
 *   $builder->get('/TestSeriesApi/getTestQuestions',   ['controller'=>'TestSeriesApi','action'=>'getTestQuestions']);
 *   $builder->post('/TestSeriesApi/publishTest',       ['controller'=>'TestSeriesApi','action'=>'publishTest']);
 *   $builder->get('/TestSeriesApi/getTestAttempts',    ['controller'=>'TestSeriesApi','action'=>'getTestAttempts']);
 *   $builder->get('/TestSeriesApi/getBatchAnalysis',   ['controller'=>'TestSeriesApi','action'=>'getBatchAnalysis']);
 *   // Student
 *   $builder->get('/TestSeriesApi/getMySeriesList',    ['controller'=>'TestSeriesApi','action'=>'getMySeriesList']);
 *   $builder->get('/TestSeriesApi/getMyTests',         ['controller'=>'TestSeriesApi','action'=>'getMyTests']);
 *   $builder->post('/TestSeriesApi/startAttempt',      ['controller'=>'TestSeriesApi','action'=>'startAttempt']);
 *   $builder->post('/TestSeriesApi/saveResponses',     ['controller'=>'TestSeriesApi','action'=>'saveResponses']);
 *   $builder->post('/TestSeriesApi/submitAttempt',     ['controller'=>'TestSeriesApi','action'=>'submitAttempt']);
 *   $builder->get('/TestSeriesApi/getResult',          ['controller'=>'TestSeriesApi','action'=>'getResult']);
 *   $builder->get('/TestSeriesApi/getAnalysis',        ['controller'=>'TestSeriesApi','action'=>'getAnalysis']);
 *   $builder->get('/TestSeriesApi/getLeaderboard',     ['controller'=>'TestSeriesApi','action'=>'getLeaderboard']);
 *
 * NOTE on correct_option / scoring:
 *   ssms_question_bank.answer (TEXT) must hold the correct option identifier that
 *   the frontend will also send as selected_option.  For MCQ this is typically "A",
 *   "B", "C", "D" or the verbatim option text.  If answer is empty the controller
 *   falls back to the first options JSON entry where isCorrect === true.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
class TestSeriesApiController extends AppController
{
    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    private function clientCode(): string
    {
        return (string)(
            $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
        );
    }

    /**
     * Resolve the student's enrollment ID from the request.
     *
     * Enrollment IDs in this system are VARCHAR strings (e.g. "ETWF-2026-0001"),
     * NOT integers. Never cast to int.
     *
     * Priority:
     *   1. ssmsEnrollmentId header  (set when user.enrollmentId is populated after login)
     *   2. ssmsUserName header      (in this system, the student's username IS their enrollment_id)
     *
     * Returns '' if neither source yields a usable value.
     */
    private function resolveEnrollmentId(): string
    {
        $fromHeader = trim((string)$this->request->getHeaderLine('ssmsEnrollmentId'));
        if ($fromHeader !== '' && $fromHeader !== '0' && $fromHeader !== 'null' && $fromHeader !== 'undefined') {
            return $fromHeader;
        }
        // Fallback: ssmsUserName equals enrollment_id for student/parent accounts
        $fromUser = trim((string)$this->request->getHeaderLine('ssmsUserName'));
        return $fromUser;
    }

    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    /** Emit a JSON response and disable CakePHP auto-render. */
    private function json(array $payload, int $status = 200): void
    {
        $this->autoRender = false;
        $this->response   = $this->response
            ->withType('application/json')
            ->withStatus($status)
            ->withStringBody(json_encode($payload));
    }

    /** Decode JSON request body, falling back to form data. */
    private function body(): array
    {
        $raw = (string)$this->request->getBody();
        return json_decode($raw, true) ?: $this->request->getData() ?: [];
    }

    /**
     * Determine the correct answer string for a question_bank row.
     *
     * Return value conventions:
     *   - single-correct MCQ / true_false:
     *       returns the text of the one correct option, e.g. "Paris"
     *   - multi_correct:
     *       reads the `answer` TEXT column (e.g. "A,C"), converts each letter
     *       to a 0-based index, looks up the option text at that index, sorts
     *       them and returns a comma-joined string, e.g. "Mitosis,Photosynthesis"
     *       The student's selected_option must follow the same format.
     *   - fill_blank: returns the answer TEXT column (non-empty).
     *   - short / long / match / passage / figure / null answer: returns null
     *       → scoring is skipped (marks_awarded stays 0, is_correct stays 0).
     */
    private function deriveCorrectAnswer(array $qbRow): ?string
    {
        $type = strtolower(trim((string)($qbRow['type'] ?? '')));

        // ── multi_correct — correct letters stored in `answer` as "A,C" ────────
        if ($type === 'multi_correct') {
            $answer = trim((string)($qbRow['answer'] ?? ''));
            if ($answer === '') {
                return null;
            }

            $opts = $qbRow['options'] ?? null;
            if (is_string($opts)) {
                $opts = json_decode($opts, true) ?? [];
            }
            if (!is_array($opts)) {
                return null;
            }

            $letters  = array_map('trim', explode(',', strtoupper($answer)));
            $letters  = array_filter($letters, fn($l) => $l !== '');
            $correctTexts = [];
            foreach ($letters as $letter) {
                $idx = ord($letter) - ord('A');   // A→0, B→1, C→2, D→3 …
                $t   = trim((string)($opts[$idx]['text'] ?? ''));
                if ($t !== '') {
                    $correctTexts[] = $t;
                }
            }

            if (empty($correctTexts)) {
                return null;
            }
            sort($correctTexts);
            return implode(',', $correctTexts);
        }

        // ── Single-correct MCQ / true_false — use isCorrect flags ─────────────
        if (in_array($type, ['mcq', 'true_false'], true)) {
            $opts = $qbRow['options'] ?? null;
            if (is_string($opts)) {
                $opts = json_decode($opts, true) ?? [];
            }
            if (!is_array($opts)) {
                return null;
            }

            foreach ($opts as $opt) {
                if (!empty($opt['isCorrect'])) {
                    $t = trim((string)($opt['text'] ?? ''));
                    if ($t !== '') {
                        return $t;
                    }
                }
            }
            return null;
        }

        // ── Text-answer types (fill_blank) ─────────────────────────────────────
        if ($type === 'fill_blank') {
            $answer = trim((string)($qbRow['answer'] ?? ''));
            return $answer !== '' ? $answer : null;
        }

        // short / long / match / passage / figure — not auto-scored
        return null;
    }

    /**
     * Normalise a student's selected_option so it can be compared with
     * deriveCorrectAnswer():
     *   - Splits on comma, trims each part, sorts, re-joins.
     * This handles multi-correct regardless of the order the student tapped.
     */
    private function normaliseSelection(string $raw): string
    {
        $parts = array_map('trim', explode(',', $raw));
        $parts = array_filter($parts, fn($p) => $p !== '');
        sort($parts);
        return implode(',', $parts);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN / TEACHER — SERIES
    // ══════════════════════════════════════════════════════════════════════════

    // ── POST /TestSeriesApi/createSeries ─────────────────────────────────────

    public function createSeries(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d = $this->body();

        $title = trim((string)($d['title'] ?? ''));
        if (!$title) {
            $this->json(['status' => false, 'message' => 'title is required'], 400);
            return;
        }

        try {
            $this->db()->execute(
                "INSERT INTO ssms_test_series
                    (client_code, title, description, exam_type, branch_id, session_id, class_id, series_scope)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $clientCode,
                    $title,
                    trim((string)($d['description']  ?? '')),
                    trim((string)($d['exam_type']    ?? '')),
                    (int)($d['branch_id']  ?? 0),
                    (int)($d['session_id'] ?? 0),
                    (int)($d['class_id']   ?? 0),
                    in_array($d['series_scope'] ?? '', ['full_syllabus', 'chapter_wise'])
                        ? $d['series_scope']
                        : 'full_syllabus',
                ]
            );
            $newId = (int)$this->db()->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];
            $this->json(['status' => true, 'message' => 'Series created', 'data' => ['id' => $newId]]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::createSeries ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to create series'], 500);
        }
    }

    // ── GET /TestSeriesApi/getSeriesList ──────────────────────────────────────

    public function getSeriesList(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $branchId  = $this->request->getQuery('branch_id');
        $sessionId = $this->request->getQuery('session_id');
        $classId   = $this->request->getQuery('class_id');

        $where  = 'WHERE ts.client_code = ? AND ts.status = ?';
        $params = [$clientCode, 'active'];

        if ($branchId)  { $where .= ' AND ts.branch_id  = ?'; $params[] = (int)$branchId;  }
        if ($sessionId) { $where .= ' AND ts.session_id = ?'; $params[] = (int)$sessionId; }
        if ($classId)   { $where .= ' AND ts.class_id   = ?'; $params[] = (int)$classId;   }

        try {
            $rows = $this->db()->execute("
                SELECT ts.*,
                       COUNT(t.id)             AS test_count,
                       MIN(t.scheduled_start)  AS series_start,
                       MAX(t.scheduled_end)    AS series_end
                FROM   ssms_test_series ts
                LEFT JOIN ssms_tests t
                       ON t.series_id   = ts.id
                      AND t.client_code = ts.client_code
                {$where}
                GROUP BY ts.id
                ORDER BY ts.id DESC
            ", $params)->fetchAll('assoc');

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getSeriesList ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch series list'], 500);
        }
    }

    // ── POST /TestSeriesApi/updateSeries ──────────────────────────────────────

    public function updateSeries(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d  = $this->body();
        $id = (int)($d['id'] ?? 0);
        if (!$id) {
            $this->json(['status' => false, 'message' => 'id is required'], 400);
            return;
        }

        $allowed = ['title', 'description', 'exam_type', 'branch_id', 'session_id', 'class_id', 'series_scope', 'status'];
        $set     = [];
        $params  = [];

        foreach ($allowed as $col) {
            if (!array_key_exists($col, $d)) continue;
            $set[]    = "{$col} = ?";
            if (in_array($col, ['branch_id', 'session_id', 'class_id'])) {
                $params[] = (int)$d[$col];
            } elseif ($col === 'series_scope') {
                $params[] = in_array($d[$col], ['full_syllabus', 'chapter_wise'])
                    ? $d[$col] : 'full_syllabus';
            } else {
                $params[] = trim((string)$d[$col]);
            }
        }

        if (empty($set)) {
            $this->json(['status' => false, 'message' => 'Nothing to update'], 400);
            return;
        }

        $params[] = $id;
        $params[] = $clientCode;

        try {
            $this->db()->execute(
                'UPDATE ssms_test_series SET ' . implode(', ', $set) . ' WHERE id = ? AND client_code = ?',
                $params
            );
            $this->json(['status' => true, 'message' => 'Series updated']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::updateSeries ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to update series'], 500);
        }
    }

    // ── POST /TestSeriesApi/deleteSeries ──────────────────────────────────────

    public function deleteSeries(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d  = $this->body();
        $id = (int)($d['id'] ?? $this->request->getQuery('id') ?? 0);
        if (!$id) {
            $this->json(['status' => false, 'message' => 'id is required'], 400);
            return;
        }

        try {
            $affected = $this->db()->execute(
                "UPDATE ssms_test_series SET status = 'inactive' WHERE id = ? AND client_code = ?",
                [$id, $clientCode]
            )->rowCount();

            if ($affected === 0) {
                $this->json(['status' => false, 'message' => 'Series not found'], 404);
                return;
            }
            $this->json(['status' => true, 'message' => 'Series deleted']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::deleteSeries ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to delete series'], 500);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN / TEACHER — TESTS
    // ══════════════════════════════════════════════════════════════════════════

    // ── POST /TestSeriesApi/createTest ────────────────────────────────────────

    public function createTest(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d = $this->body();

        $seriesId = (int)($d['series_id'] ?? 0);
        $title    = trim((string)($d['title'] ?? ''));

        if (!$seriesId || !$title) {
            $this->json(['status' => false, 'message' => 'series_id and title are required'], 400);
            return;
        }

        // Verify series belongs to this client
        $series = $this->db()->execute(
            "SELECT id FROM ssms_test_series WHERE id = ? AND client_code = ? AND status = 'active'",
            [$seriesId, $clientCode]
        )->fetchAssoc();

        if (!$series) {
            $this->json(['status' => false, 'message' => 'Series not found'], 404);
            return;
        }

        try {
            $this->db()->execute(
                "INSERT INTO ssms_tests
                    (client_code, series_id, title, instructions, duration_minutes,
                     total_marks, passing_marks, negative_marking_ratio,
                     question_randomize, answer_randomize, show_result_immediately,
                     scheduled_start, scheduled_end, branch_id, session_id, class_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $clientCode,
                    $seriesId,
                    $title,
                    trim((string)($d['instructions']             ?? '')),
                    (int)($d['duration_minutes']                 ?? 60),
                    (float)($d['total_marks']                    ?? 100),
                    (float)($d['passing_marks']                  ?? 35),
                    (float)($d['negative_marking_ratio']         ?? 0.25),
                    (int)($d['question_randomize']               ?? 0),
                    (int)($d['answer_randomize']                 ?? 0),
                    (int)($d['show_result_immediately']          ?? 1),
                    ($d['scheduled_start'] ?? null) ?: null,
                    ($d['scheduled_end']   ?? null) ?: null,
                    (int)($d['branch_id']                        ?? 0),
                    (int)($d['session_id']                       ?? 0),
                    (int)($d['class_id']                         ?? 0),
                ]
            );

            $newId = (int)$this->db()->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];
            $this->json(['status' => true, 'message' => 'Test created', 'data' => ['id' => $newId]]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::createTest ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to create test'], 500);
        }
    }

    // ── GET /TestSeriesApi/getTestsBySeriesId?series_id=X ────────────────────

    public function getTestsBySeriesId(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $seriesId = (int)($this->request->getQuery('series_id') ?? 0);
        if (!$seriesId) {
            $this->json(['status' => false, 'message' => 'series_id is required'], 400);
            return;
        }

        try {
            $rows = $this->db()->execute(
                "SELECT t.*,
                        COALESCE(q.question_count, 0) AS question_count
                 FROM   ssms_tests t
                 LEFT JOIN (
                     SELECT test_id, client_code, COUNT(*) AS question_count
                     FROM   ssms_test_questions
                     GROUP BY test_id, client_code
                 ) q ON q.test_id = t.id AND q.client_code = t.client_code
                 WHERE  t.series_id   = ?
                   AND  t.client_code = ?
                 ORDER BY t.id ASC",
                [$seriesId, $clientCode]
            )->fetchAll('assoc');

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getTestsBySeriesId ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch tests'], 500);
        }
    }

    // ── POST /TestSeriesApi/updateTest ────────────────────────────────────────

    public function updateTest(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d  = $this->body();
        $id = (int)($d['id'] ?? 0);
        if (!$id) {
            $this->json(['status' => false, 'message' => 'id is required'], 400);
            return;
        }

        $allowedStr = ['title', 'instructions', 'scheduled_start', 'scheduled_end', 'status'];
        $allowedNum = ['series_id', 'duration_minutes', 'branch_id', 'session_id', 'class_id',
                       'question_randomize', 'answer_randomize', 'show_result_immediately'];
        $allowedFloat = ['total_marks', 'passing_marks', 'negative_marking_ratio'];

        $set    = [];
        $params = [];

        foreach ($allowedStr as $col) {
            if (!array_key_exists($col, $d)) continue;
            $set[]    = "{$col} = ?";
            $params[] = $d[$col] === '' || $d[$col] === null ? null : trim((string)$d[$col]);
        }
        foreach ($allowedNum as $col) {
            if (!array_key_exists($col, $d)) continue;
            $set[]    = "{$col} = ?";
            $params[] = (int)$d[$col];
        }
        foreach ($allowedFloat as $col) {
            if (!array_key_exists($col, $d)) continue;
            $set[]    = "{$col} = ?";
            $params[] = (float)$d[$col];
        }

        if (empty($set)) {
            $this->json(['status' => false, 'message' => 'Nothing to update'], 400);
            return;
        }

        $params[] = $id;
        $params[] = $clientCode;

        try {
            $this->db()->execute(
                'UPDATE ssms_tests SET ' . implode(', ', $set) . ' WHERE id = ? AND client_code = ?',
                $params
            );
            $this->json(['status' => true, 'message' => 'Test updated']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::updateTest ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to update test'], 500);
        }
    }

    // ── POST /TestSeriesApi/deleteTest ────────────────────────────────────────

    public function deleteTest(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d  = $this->body();
        $id = (int)($d['id'] ?? $this->request->getQuery('id') ?? 0);
        if (!$id) {
            $this->json(['status' => false, 'message' => 'id is required'], 400);
            return;
        }

        try {
            $affected = $this->db()->execute(
                'DELETE FROM ssms_tests WHERE id = ? AND client_code = ?',
                [$id, $clientCode]
            )->rowCount();

            if ($affected === 0) {
                $this->json(['status' => false, 'message' => 'Test not found'], 404);
                return;
            }
            $this->json(['status' => true, 'message' => 'Test deleted']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::deleteTest ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to delete test'], 500);
        }
    }

    // ── POST /TestSeriesApi/publishTest ───────────────────────────────────────

    public function publishTest(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d  = $this->body();
        $id = (int)($d['id'] ?? 0);
        if (!$id) {
            $this->json(['status' => false, 'message' => 'id is required'], 400);
            return;
        }

        try {
            $affected = $this->db()->execute(
                "UPDATE ssms_tests SET status = 'published' WHERE id = ? AND client_code = ?",
                [$id, $clientCode]
            )->rowCount();

            if ($affected === 0) {
                $this->json(['status' => false, 'message' => 'Test not found'], 404);
                return;
            }
            $this->json(['status' => true, 'message' => 'Test published']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::publishTest ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to publish test'], 500);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN / TEACHER — SECTIONS
    // ══════════════════════════════════════════════════════════════════════════

    // ── POST /TestSeriesApi/addSection ────────────────────────────────────────

    public function addSection(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d      = $this->body();
        $testId = (int)($d['test_id'] ?? 0);
        $title  = trim((string)($d['name'] ?? $d['title'] ?? $d['section_name'] ?? ''));

        if (!$testId || !$title) {
            $this->json(['status' => false, 'message' => 'test_id and name are required'], 400);
            return;
        }

        // Verify test ownership
        $test = $this->db()->execute(
            'SELECT id FROM ssms_tests WHERE id = ? AND client_code = ?',
            [$testId, $clientCode]
        )->fetchAssoc();

        if (!$test) {
            $this->json(['status' => false, 'message' => 'Test not found'], 404);
            return;
        }

        try {
            // Auto-assign section_order as next in sequence for this test
            $maxOrder = (int)($this->db()->execute(
                'SELECT COALESCE(MAX(section_order), 0) AS mo FROM ssms_test_sections WHERE test_id = ? AND client_code = ?',
                [$testId, $clientCode]
            )->fetchAssoc()['mo'] ?? 0);

            $this->db()->execute(
                "INSERT INTO ssms_test_sections
                    (client_code, test_id, section_name, marks_per_question, negative_per_question, num_questions, section_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    $clientCode,
                    $testId,
                    $title,
                    (float)($d['marks_per_question']                              ?? 1),
                    (float)($d['negative_per_question'] ?? $d['negative_marks'] ?? 0),
                    (int)($d['num_questions'] ?? 0),
                    $maxOrder + 1,
                ]
            );
            $newId = (int)$this->db()->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];
            $this->json(['status' => true, 'message' => 'Section added', 'data' => ['id' => $newId]]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::addSection ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to add section'], 500);
        }
    }

    // ── GET /TestSeriesApi/getSections?test_id=X ─────────────────────────────

    public function getSections(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $testId = (int)($this->request->getQuery('test_id') ?? 0);
        if (!$testId) {
            $this->json(['status' => false, 'message' => 'test_id is required'], 400);
            return;
        }

        try {
            $rows = $this->db()->execute(
                "SELECT sec.*, COUNT(tq.id) AS question_count
                 FROM ssms_test_sections sec
                 LEFT JOIN ssms_test_questions tq
                        ON tq.section_id  = sec.id
                       AND tq.client_code = sec.client_code
                 WHERE sec.test_id = ? AND sec.client_code = ?
                 GROUP BY sec.id
                 ORDER BY sec.section_order ASC, sec.id ASC",
                [$testId, $clientCode]
            )->fetchAll('assoc');

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getSections ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch sections'], 500);
        }
    }

    // ── POST /TestSeriesApi/deleteSection ─────────────────────────────────────

    public function deleteSection(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d  = $this->body();
        $id = (int)($d['id'] ?? $this->request->getQuery('id') ?? 0);
        if (!$id) {
            $this->json(['status' => false, 'message' => 'id is required'], 400);
            return;
        }

        try {
            $affected = $this->db()->execute(
                'DELETE FROM ssms_test_sections WHERE id = ? AND client_code = ?',
                [$id, $clientCode]
            )->rowCount();

            if ($affected === 0) {
                $this->json(['status' => false, 'message' => 'Section not found'], 404);
                return;
            }
            $this->json(['status' => true, 'message' => 'Section deleted']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::deleteSection ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to delete section'], 500);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN / TEACHER — QUESTIONS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /TestSeriesApi/addQuestions
     *
     * Body: {
     *   test_id: int,
     *   questions: [
     *     { question_id, section_id, marks, negative_marks, question_order }
     *   ]
     * }
     *
     * Uses INSERT … ON DUPLICATE KEY UPDATE so re-sending the same question_id
     * for the same test just updates its configuration instead of duplicating it.
     * (Requires a UNIQUE KEY on (test_id, question_id) — add if missing.)
     */
    public function addQuestions(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d         = $this->body();
        $testId    = (int)($d['test_id'] ?? 0);
        $questions = $d['questions'] ?? [];

        if (!$testId) {
            $this->json(['status' => false, 'message' => 'test_id is required'], 400);
            return;
        }
        if (empty($questions) || !is_array($questions)) {
            $this->json(['status' => false, 'message' => 'questions array is required'], 400);
            return;
        }

        // Verify test ownership
        $test = $this->db()->execute(
            'SELECT id FROM ssms_tests WHERE id = ? AND client_code = ?',
            [$testId, $clientCode]
        )->fetchAssoc();

        if (!$test) {
            $this->json(['status' => false, 'message' => 'Test not found'], 404);
            return;
        }

        $db = $this->db();
        $inserted = 0;

        try {
            foreach ($questions as $q) {
                $questionId    = (int)($q['question_id']    ?? 0);
                $sectionId     = ($q['section_id'] ?? null) ? (int)$q['section_id'] : null;
                $marks         = (float)($q['marks']         ?? 1);
                $negativeMarks = (float)($q['negative_marks'] ?? 0);
                $order         = (int)($q['question_order']  ?? 0);

                if (!$questionId) continue;

                $db->execute(
                    "INSERT INTO ssms_test_questions
                         (client_code, test_id, section_id, question_id, marks, negative_marks, question_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                         section_id     = VALUES(section_id),
                         marks          = VALUES(marks),
                         negative_marks = VALUES(negative_marks),
                         question_order = VALUES(question_order)",
                    [$clientCode, $testId, $sectionId, $questionId, $marks, $negativeMarks, $order]
                );
                $inserted++;
            }

            $this->json(['status' => true, 'message' => "{$inserted} question(s) added/updated"]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::addQuestions ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to add questions'], 500);
        }
    }

    // ── POST /TestSeriesApi/removeQuestion ────────────────────────────────────

    public function removeQuestion(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d  = $this->body();
        $id = (int)($d['id'] ?? $this->request->getQuery('id') ?? 0);
        if (!$id) {
            $this->json(['status' => false, 'message' => 'id (ssms_test_questions.id) is required'], 400);
            return;
        }

        try {
            $affected = $this->db()->execute(
                'DELETE FROM ssms_test_questions WHERE id = ? AND client_code = ?',
                [$id, $clientCode]
            )->rowCount();

            if ($affected === 0) {
                $this->json(['status' => false, 'message' => 'Question not found in test'], 404);
                return;
            }
            $this->json(['status' => true, 'message' => 'Question removed from test']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::removeQuestion ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to remove question'], 500);
        }
    }

    // ── GET /TestSeriesApi/getTestQuestions?test_id=X ────────────────────────

    public function getTestQuestions(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $testId = (int)($this->request->getQuery('test_id') ?? 0);
        if (!$testId) {
            $this->json(['status' => false, 'message' => 'test_id is required'], 400);
            return;
        }

        try {
            $rows = $this->db()->execute(
                "SELECT tq.id            AS test_question_id,
                        tq.test_id,
                        tq.section_id,
                        tq.question_id,
                        tq.marks,
                        tq.negative_marks,
                        tq.question_order,
                        qb.type,
                        qb.question_text,
                        qb.options,
                        qb.match_pairs,
                        qb.answer,
                        qb.image_path,
                        qb.difficulty,
                        qb.chapter,
                        qb.explanation,
                        sec.section_name AS section_title
                 FROM   ssms_test_questions tq
                 JOIN   ssms_question_bank  qb  ON qb.id  = tq.question_id
                 LEFT JOIN ssms_test_sections sec ON sec.id = tq.section_id
                 WHERE  tq.test_id    = ?
                   AND  tq.client_code = ?
                 ORDER BY tq.question_order ASC, tq.id ASC",
                [$testId, $clientCode]
            )->fetchAll('assoc');

            foreach ($rows as &$row) {
                $row['options']     = $row['options']     ? json_decode($row['options'],     true) : null;
                $row['match_pairs'] = $row['match_pairs'] ? json_decode($row['match_pairs'], true) : null;
            }
            unset($row);

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getTestQuestions ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch test questions'], 500);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN / TEACHER — REPORTS
    // ══════════════════════════════════════════════════════════════════════════

    // ── GET /TestSeriesApi/getTestAttempts?test_id=X ──────────────────────────

    public function getTestAttempts(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $testId = (int)($this->request->getQuery('test_id') ?? 0);
        if (!$testId) {
            $this->json(['status' => false, 'message' => 'test_id is required'], 400);
            return;
        }

        try {
            $rows = $this->db()->execute(
                "SELECT ta.*,
                        CONCAT(sr.first_name, ' ', COALESCE(sr.middle_name,''), ' ', sr.last_name) AS student_name,
                        sr.roll_number
                 FROM   ssms_test_attempts ta
                 LEFT JOIN ssms_student_registration sr ON sr.student_id = ta.student_id
                 WHERE  ta.test_id     = ?
                   AND  ta.client_code = ?
                 ORDER BY ta.score DESC, ta.submitted_at ASC",
                [$testId, $clientCode]
            )->fetchAll('assoc');

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getTestAttempts ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch attempts'], 500);
        }
    }

    /**
     * GET /TestSeriesApi/getBatchAnalysis?test_id=X
     *
     * Returns per-question stats: total attempts, correct count, wrong count,
     * unattempted count, and percentage correct — across all submitted attempts.
     */
    public function getBatchAnalysis(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $testId = (int)($this->request->getQuery('test_id') ?? 0);
        if (!$testId) {
            $this->json(['status' => false, 'message' => 'test_id is required'], 400);
            return;
        }

        try {
            // Total submitted attempts for this test
            $totalRow = $this->db()->execute(
                "SELECT COUNT(*) AS cnt FROM ssms_test_attempts
                 WHERE test_id = ? AND client_code = ? AND status = 'submitted'",
                [$testId, $clientCode]
            )->fetchAssoc();
            $totalAttempts = (int)($totalRow['cnt'] ?? 0);

            // Per-question stats (only from submitted attempts)
            $rows = $this->db()->execute(
                "SELECT tr.test_question_id,
                        tr.question_id,
                        qb.question_text,
                        qb.type,
                        COUNT(tr.id)                                       AS total_responses,
                        SUM(tr.is_correct)                                 AS correct_count,
                        SUM(tr.is_attempted = 1 AND tr.is_correct = 0)     AS wrong_count,
                        SUM(tr.is_attempted = 0)                           AS unattempted_count,
                        ROUND(SUM(tr.is_correct) / COUNT(tr.id) * 100, 1) AS pct_correct
                 FROM   ssms_test_responses tr
                 JOIN   ssms_test_attempts  ta  ON ta.id = tr.attempt_id
                 JOIN   ssms_question_bank  qb  ON qb.id = tr.question_id
                 WHERE  ta.test_id     = ?
                   AND  ta.client_code = ?
                   AND  ta.status      = 'submitted'
                 GROUP BY tr.test_question_id, tr.question_id
                 ORDER BY tr.test_question_id ASC",
                [$testId, $clientCode]
            )->fetchAll('assoc');

            $this->json([
                'status'         => true,
                'total_attempts' => $totalAttempts,
                'data'           => $rows ?: [],
            ]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getBatchAnalysis ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch batch analysis'], 500);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STUDENT ACTIONS
    // ══════════════════════════════════════════════════════════════════════════

    // ── GET /TestSeriesApi/getMySeriesList ────────────────────────────────────
    // Headers: ssmsEnrollmentId — used to look up branch/session/class

    public function getMySeriesList(): void
    {
        $clientCode   = $this->clientCode();
        $enrollmentId = $this->resolveEnrollmentId();

        if (!$clientCode || !$enrollmentId) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        try {
            // Fetch enrollment details to scope the series
            $enroll = $this->db()->execute(
                "SELECT branch_id, session_id, class_id
                 FROM   ssms_student_enrollment
                 WHERE  enrollment_id = ? AND ssms_client_code = ?",
                [$enrollmentId, $clientCode]
            )->fetchAssoc();

            if (!$enroll) {
                $this->json(['status' => false, 'message' => 'Enrollment not found'], 404);
                return;
            }

            $rows = $this->db()->execute(
                "SELECT ts.*, COUNT(t.id) AS test_count
                 FROM   ssms_test_series ts
                 LEFT JOIN ssms_tests t ON t.series_id = ts.id AND t.client_code = ts.client_code
                 WHERE  ts.client_code = ?
                   AND  ts.status      = 'active'
                   AND  ts.branch_id   = ?
                   AND  ts.session_id  = ?
                   AND  ts.class_id    = ?
                 GROUP BY ts.id
                 ORDER BY ts.id DESC",
                [$clientCode, (int)$enroll['branch_id'], (int)$enroll['session_id'], (int)$enroll['class_id']]
            )->fetchAll('assoc');

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getMySeriesList ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch series'], 500);
        }
    }

    // ── GET /TestSeriesApi/getMyTests?series_id=X ────────────────────────────

    public function getMyTests(): void
    {
        $clientCode   = $this->clientCode();
        $enrollmentId = $this->resolveEnrollmentId();
        $seriesId     = (int)($this->request->getQuery('series_id') ?? 0);

        if (!$clientCode || !$enrollmentId) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }
        if (!$seriesId) {
            $this->json(['status' => false, 'message' => 'series_id is required'], 400);
            return;
        }

        try {
            $now = date('Y-m-d H:i:s');

            $rows = $this->db()->execute(
                "SELECT t.*,
                        COALESCE(q.question_count, 0) AS question_count,
                        ta.id        AS attempt_id,
                        ta.status    AS attempt_status,
                        ta.score     AS my_score
                 FROM   ssms_tests t
                 LEFT JOIN (
                     SELECT test_id, client_code, COUNT(*) AS question_count
                     FROM   ssms_test_questions
                     GROUP BY test_id, client_code
                 ) q ON q.test_id = t.id AND q.client_code = t.client_code
                 LEFT JOIN ssms_test_attempts ta ON ta.test_id      = t.id
                                                AND ta.enrollment_id = ?
                                                AND ta.client_code   = t.client_code
                 WHERE  t.series_id   = ?
                   AND  t.client_code = ?
                   AND  t.status      = 'published'
                   AND  (t.scheduled_start IS NULL OR t.scheduled_start <= ?)
                   AND  (t.scheduled_end   IS NULL OR t.scheduled_end   >= ?)
                 ORDER BY t.id ASC",
                [$enrollmentId, $seriesId, $clientCode, $now, $now]
            )->fetchAll('assoc');

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getMyTests ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch tests'], 500);
        }
    }

    /**
     * POST /TestSeriesApi/startAttempt
     *
     * Body: { test_id: int, student_id: int }
     * Also reads ssmsEnrollmentId from headers.
     *
     * - If an in_progress attempt already exists → return it with saved responses.
     * - Otherwise → create new attempt row, return questions (shuffled if randomize=1).
     */
    public function startAttempt(): void
    {
        $clientCode   = $this->clientCode();
        $enrollmentId = $this->resolveEnrollmentId();

        if (!$clientCode || !$enrollmentId) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d      = $this->body();
        $testId = (int)($d['test_id'] ?? 0);

        if (!$testId) {
            $this->json(['status' => false, 'message' => 'test_id is required'], 400);
            return;
        }

        $db = $this->db();

        try {
            // Resolve student_id (registration_id) from the enrollment table
            $enroll = $db->execute(
                "SELECT registration_id
                 FROM   ssms_student_enrollment
                 WHERE  enrollment_id = ? AND ssms_client_code = ?",
                [$enrollmentId, $clientCode]
            )->fetchAssoc();

            if (!$enroll) {
                $this->json(['status' => false, 'message' => 'Student enrollment not found'], 404);
                return;
            }
            $studentId = (int)$enroll['registration_id'];

            // Fetch the test and verify it is accessible
            $now  = date('Y-m-d H:i:s');
            $test = $db->execute(
                "SELECT * FROM ssms_tests
                 WHERE id = ? AND client_code = ? AND status = 'published'
                   AND (scheduled_start IS NULL OR scheduled_start <= ?)
                   AND (scheduled_end   IS NULL OR scheduled_end   >= ?)",
                [$testId, $clientCode, $now, $now]
            )->fetchAssoc();

            if (!$test) {
                $this->json(['status' => false, 'message' => 'Test not available'], 403);
                return;
            }

            // Check for an existing attempt
            $existing = $db->execute(
                "SELECT * FROM ssms_test_attempts
                 WHERE test_id = ? AND enrollment_id = ? AND client_code = ?",
                [$testId, $enrollmentId, $clientCode]
            )->fetchAssoc();

            if ($existing && $existing['status'] === 'submitted') {
                $this->json(['status' => false, 'message' => 'Test already submitted', 'data' => $existing], 409);
                return;
            }

            $attemptId  = null;
            $startedAt  = null;
            $savedResponses = [];

            if ($existing && $existing['status'] === 'in_progress') {
                // Resume existing attempt — preserve original started_at.
                // Fall back to created_at for records inserted before started_at was added.
                $attemptId = (int)$existing['id'];
                $startedAt = $existing['started_at'] ?? $existing['created_at'];
                $savedResponses = $db->execute(
                    'SELECT * FROM ssms_test_responses WHERE attempt_id = ? AND client_code = ?',
                    [$attemptId, $clientCode]
                )->fetchAll('assoc');
            } else {
                // Create a new attempt, record start time
                $db->execute(
                    "INSERT INTO ssms_test_attempts
                         (client_code, test_id, student_id, enrollment_id, started_at, status)
                     VALUES (?, ?, ?, ?, NOW(), 'in_progress')",
                    [$clientCode, $testId, $studentId, $enrollmentId]
                );
                $attemptId = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];
                $startedAt = $now; // $now was set above as date('Y-m-d H:i:s')
            }

            // Compute remaining seconds server-side so the client never has to do
            // timezone-sensitive date arithmetic. strtotime() uses the same server TZ
            // for both values, so the difference is always correct.
            $totalSeconds        = (int)$test['duration_minutes'] * 60;
            $elapsedSeconds      = $startedAt ? max(0, strtotime($now) - strtotime($startedAt)) : 0;
            $timeRemainingSeconds = max(0, $totalSeconds - $elapsedSeconds);

            // Fetch questions for the test
            $questions = $db->execute(
                "SELECT tq.id AS test_question_id,
                        tq.section_id,
                        tq.question_id,
                        tq.marks,
                        tq.negative_marks,
                        tq.question_order,
                        qb.type,
                        qb.question_text,
                        qb.options,
                        qb.match_pairs,
                        qb.image_path,
                        qb.difficulty,
                        sec.section_name AS section_title
                 FROM   ssms_test_questions tq
                 JOIN   ssms_question_bank  qb  ON qb.id  = tq.question_id
                 LEFT JOIN ssms_test_sections sec ON sec.id = tq.section_id
                 WHERE  tq.test_id     = ?
                   AND  tq.client_code = ?
                 ORDER BY tq.question_order ASC, tq.id ASC",
                [$testId, $clientCode]
            )->fetchAll('assoc');

            foreach ($questions as &$q) {
                $q['options']     = $q['options']     ? json_decode($q['options'],     true) : null;
                $q['match_pairs'] = $q['match_pairs'] ? json_decode($q['match_pairs'], true) : null;

                // Tag each option with its original letter BEFORE any shuffle, then strip isCorrect.
                // _origLetter survives the shuffle so the client can store selected_option
                // using the original letter (matching qb.answer) instead of the displayed position.
                if (is_array($q['options'])) {
                    $q['options'] = array_values(array_map(function ($opt, $i) {
                        unset($opt['isCorrect']);
                        $opt['_origLetter'] = chr(ord('A') + $i);
                        return $opt;
                    }, $q['options'], array_keys($q['options'])));
                }
            }
            unset($q);

            // Shuffle questions / answers if test settings require it
            if ((int)$test['question_randomize'] === 1) {
                shuffle($questions);
            }

            if ((int)$test['answer_randomize'] === 1) {
                foreach ($questions as &$q) {
                    if (is_array($q['options']) && count($q['options']) > 1) {
                        shuffle($q['options']);
                    }
                }
                unset($q);
            }

            $this->json([
                'status'  => true,
                'message' => 'Attempt started',
                'data'    => [
                    'attempt_id'             => $attemptId,
                    'started_at'             => $startedAt,
                    'server_time'            => $now,
                    'time_remaining_seconds' => $timeRemainingSeconds, // server-calculated; use this directly
                    'test'                   => $test,
                    'questions'              => $questions,
                    'saved_responses'        => $savedResponses,
                ],
            ]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::startAttempt ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to start attempt'], 500);
        }
    }

    /**
     * POST /TestSeriesApi/saveResponses
     *
     * Body: {
     *   attempt_id: int,
     *   responses: [
     *     { test_question_id, question_id, selected_option, numerical_answer,
     *       is_marked_for_review, is_attempted, time_spent_seconds }
     *   ]
     * }
     *
     * Upserts each response row without scoring (scoring happens at submitAttempt).
     */
    public function saveResponses(): void
    {
        $clientCode   = $this->clientCode();
        $enrollmentId = $this->resolveEnrollmentId();

        if (!$clientCode || !$enrollmentId) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d         = $this->body();
        $attemptId = (int)($d['attempt_id'] ?? 0);
        $responses = $d['responses'] ?? [];

        if (!$attemptId) {
            $this->json(['status' => false, 'message' => 'attempt_id is required'], 400);
            return;
        }
        if (empty($responses) || !is_array($responses)) {
            $this->json(['status' => false, 'message' => 'responses array is required'], 400);
            return;
        }

        $db = $this->db();

        // Verify the attempt belongs to this enrollmentId / client
        $attempt = $db->execute(
            "SELECT id FROM ssms_test_attempts
             WHERE id = ? AND enrollment_id = ? AND client_code = ? AND status = 'in_progress'",
            [$attemptId, $enrollmentId, $clientCode]
        )->fetchAssoc();

        if (!$attempt) {
            $this->json(['status' => false, 'message' => 'Active attempt not found'], 404);
            return;
        }

        try {
            $saved = 0;
            foreach ($responses as $r) {
                $testQuestionId = (int)($r['test_question_id'] ?? 0);
                $questionId     = (int)($r['question_id']      ?? 0);
                if (!$testQuestionId || !$questionId) continue;

                $selectedOption    = isset($r['selected_option'])    ? (string)$r['selected_option'] : null;
                $numericalAnswer   = isset($r['numerical_answer'])   && $r['numerical_answer'] !== '' ? (float)$r['numerical_answer'] : null;
                $markedForReview   = (int)($r['is_marked_for_review'] ?? 0);
                $isAttempted       = (int)($r['is_attempted']         ?? 0);
                $timeSpent         = (int)($r['time_spent_seconds']   ?? 0);

                $db->execute(
                    "INSERT INTO ssms_test_responses
                         (client_code, attempt_id, test_question_id, question_id,
                          selected_option, numerical_answer, is_marked_for_review,
                          is_attempted, time_spent_seconds)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                         selected_option      = VALUES(selected_option),
                         numerical_answer     = VALUES(numerical_answer),
                         is_marked_for_review = VALUES(is_marked_for_review),
                         is_attempted         = VALUES(is_attempted),
                         time_spent_seconds   = VALUES(time_spent_seconds)",
                    [
                        $clientCode, $attemptId, $testQuestionId, $questionId,
                        $selectedOption, $numericalAnswer, $markedForReview,
                        $isAttempted, $timeSpent,
                    ]
                );
                $saved++;
            }

            $this->json(['status' => true, 'message' => "{$saved} response(s) saved"]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::saveResponses ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to save responses'], 500);
        }
    }

    /**
     * POST /TestSeriesApi/submitAttempt
     *
     * Body: { attempt_id: int }
     *
     * Scoring logic:
     *   - For each response, join ssms_question_bank to derive correct answer.
     *   - selected_option matches correct answer → +marks
     *   - selected_option set but wrong → −negative_marks
     *   - not attempted → 0
     *   - Updates marks_awarded + is_correct on each response row.
     *   - Aggregates score/counts on ssms_test_attempts.
     *   - Recomputes rank and percentile for all submitted attempts for the same test.
     */
    public function submitAttempt(): void
    {
        $clientCode   = $this->clientCode();
        $enrollmentId = $this->resolveEnrollmentId();

        if (!$clientCode || !$enrollmentId) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $d         = $this->body();
        $attemptId = (int)($d['attempt_id'] ?? 0);
        if (!$attemptId) {
            $this->json(['status' => false, 'message' => 'attempt_id is required'], 400);
            return;
        }

        $d         = $this->body();
        $inlineResponses = $d['responses'] ?? null; // optional: responses bundled with submit

        $db = $this->db();

        // Fetch and lock the attempt
        $attempt = $db->execute(
            "SELECT * FROM ssms_test_attempts
             WHERE id = ? AND enrollment_id = ? AND client_code = ?",
            [$attemptId, $enrollmentId, $clientCode]
        )->fetchAssoc();

        if (!$attempt) {
            $this->json(['status' => false, 'message' => 'Attempt not found'], 404);
            return;
        }
        if ($attempt['status'] === 'submitted') {
            $this->json(['status' => false, 'message' => 'Attempt already submitted', 'data' => $attempt], 409);
            return;
        }

        $testId = (int)$attempt['test_id'];

        try {
            // ── If responses were bundled with the submit, upsert them now ────────
            // This makes submit atomic: no separate saveResponses call needed.
            if (is_array($inlineResponses) && count($inlineResponses) > 0) {
                foreach ($inlineResponses as $r) {
                    $tqId       = (int)($r['test_question_id'] ?? 0);
                    $qId        = (int)($r['question_id']      ?? 0);
                    if (!$tqId || !$qId) continue;
                    $selOpt     = isset($r['selected_option'])  ? (string)$r['selected_option'] : null;
                    $numAns     = isset($r['numerical_answer']) && $r['numerical_answer'] !== '' ? (float)$r['numerical_answer'] : null;
                    $marked     = (int)($r['is_marked_for_review'] ?? 0);
                    $attempted  = (int)($r['is_attempted']         ?? 0);
                    $timeSpent  = (int)($r['time_spent_seconds']   ?? 0);
                    $db->execute(
                        "INSERT INTO ssms_test_responses
                             (client_code, attempt_id, test_question_id, question_id,
                              selected_option, numerical_answer, is_marked_for_review,
                              is_attempted, time_spent_seconds)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                             selected_option      = VALUES(selected_option),
                             numerical_answer     = VALUES(numerical_answer),
                             is_marked_for_review = VALUES(is_marked_for_review),
                             is_attempted         = VALUES(is_attempted),
                             time_spent_seconds   = VALUES(time_spent_seconds)",
                        [$clientCode, $attemptId, $tqId, $qId, $selOpt, $numAns, $marked, $attempted, $timeSpent]
                    );
                }
            }

            // Fetch all responses for this attempt, joined with question_bank, sections,
            // and the test itself.  Neg-marks fallback chain:
            //   1. question-level tq.negative_marks  (if non-zero)
            //   2. section-level  sec.negative_per_question (if question has a section)
            //   3. test-level     t.negative_marking_ratio  (covers questions with no section)
            //   4. 0
            $responses = $db->execute(
                "SELECT tr.*,
                        tq.marks AS question_marks,
                        COALESCE(
                            NULLIF(tq.negative_marks,        0),
                            NULLIF(sec.negative_per_question, 0),
                            NULLIF(t.negative_marking_ratio,  0),
                            0
                        ) AS question_neg_marks,
                        qb.type    AS q_type,
                        qb.options AS q_options,
                        qb.answer  AS q_answer
                 FROM   ssms_test_responses tr
                 JOIN   ssms_test_questions  tq  ON tq.id  = tr.test_question_id
                 JOIN   ssms_question_bank   qb  ON qb.id  = tr.question_id
                 LEFT JOIN ssms_test_sections sec ON sec.id = tq.section_id
                                                 AND sec.client_code = tr.client_code
                 LEFT JOIN ssms_tests         t   ON t.id   = tq.test_id
                                                 AND t.client_code  = tq.client_code
                 WHERE  tr.attempt_id  = ?
                   AND  tr.client_code = ?",
                [$attemptId, $clientCode]
            )->fetchAll('assoc');

            $totalScore      = 0.0;
            $correctCount    = 0;
            $wrongCount      = 0;
            $unattemptedCount = 0;

            foreach ($responses as $r) {
                $isAttempted   = (int)$r['is_attempted'];
                $selectedOpt   = strtoupper(trim((string)($r['selected_option'] ?? '')));
                $qType         = strtolower(trim((string)($r['q_type'] ?? '')));
                // qb.answer column is the authoritative correct answer set by the admin.
                $rawAnswer = strtoupper(trim((string)($r['q_answer'] ?? '')));

                // Auto-scorable types: answer is letter-based (MCQ, multi_correct, true_false)
                // or text-based (fill_blank).  Everything else is subjective → skip.
                $autoScoreTypes = ['mcq', 'true_false', 'multi_correct', 'fill_blank'];
                $isAutoScored   = in_array($qType, $autoScoreTypes, true);

                // Safety fallback: if admin left marks = 0, treat each question as 1 mark
                $qMarks    = (float)$r['question_marks'];
                $qNegMarks = (float)$r['question_neg_marks'];
                if ($qMarks <= 0) {
                    $qMarks = 1.0;
                }

                $marksAwarded = 0.0;
                $isCorrect    = 0;

                if (!$isAttempted || $selectedOpt === '') {
                    // Skipped / unattempted → 0 marks, no penalty
                    $unattemptedCount++;
                } elseif (!$isAutoScored || $rawAnswer === '') {
                    // Subjective / un-scorable type, or no answer set → skip, treat as unattempted
                    $unattemptedCount++;
                } elseif ($this->normaliseSelection($selectedOpt) === $this->normaliseSelection($rawAnswer)) {
                    // Correct — letter comparison works for both single and multi-correct
                    $marksAwarded = $qMarks;
                    $isCorrect    = 1;
                    $correctCount++;
                } else {
                    // Attempted but wrong → negative marking
                    $marksAwarded = -1 * $qNegMarks;
                    $wrongCount++;
                }

                $totalScore += $marksAwarded;

                // Update the response row with scoring
                $db->execute(
                    'UPDATE ssms_test_responses SET marks_awarded = ?, is_correct = ? WHERE id = ?',
                    [$marksAwarded, $isCorrect, (int)$r['id']]
                );
            }

            // Mark attempt as submitted
            $submittedAt = date('Y-m-d H:i:s');
            $db->execute(
                "UPDATE ssms_test_attempts
                 SET status = 'submitted', score = ?, correct_count = ?,
                     wrong_count = ?, unattempted_count = ?, submitted_at = ?
                 WHERE id = ?",
                [$totalScore, $correctCount, $wrongCount, $unattemptedCount, $submittedAt, $attemptId]
            );

            // ── Recompute rank & percentile for all submitted attempts ──────────
            // Wrapped in its own try-catch: if rank/percentile columns don't exist yet
            // (pending migration), the submission still completes successfully.
            try {
                $allAttempts = $db->execute(
                    "SELECT id, score FROM ssms_test_attempts
                     WHERE test_id = ? AND client_code = ? AND status = 'submitted'
                     ORDER BY score DESC, submitted_at ASC",
                    [$testId, $clientCode]
                )->fetchAll('assoc');

                $totalSubmitted = count($allAttempts);
                $rank           = 1;

                foreach ($allAttempts as $idx => $a) {
                    if ($idx > 0 && (float)$a['score'] < (float)$allAttempts[$idx - 1]['score']) {
                        $rank = $idx + 1;
                    }
                    $belowCount = 0;
                    foreach ($allAttempts as $other) {
                        if ((float)$other['score'] < (float)$a['score']) {
                            $belowCount++;
                        }
                    }
                    $percentile = $totalSubmitted > 0
                        ? round($belowCount / $totalSubmitted * 100, 2)
                        : 0.0;

                    $db->execute(
                        'UPDATE ssms_test_attempts SET rank_in_batch = ?, percentile = ? WHERE id = ?',
                        [$rank, $percentile, (int)$a['id']]
                    );
                }
            } catch (\Exception $rankEx) {
                // rank/percentile columns not yet added — run the migration SQL
                Log::warning('rank/percentile update skipped: ' . $rankEx->getMessage());
            }

            // Return summary for this attempt
            $summary = $db->execute(
                'SELECT * FROM ssms_test_attempts WHERE id = ?',
                [$attemptId]
            )->fetchAssoc();

            $this->json([
                'status'  => true,
                'message' => 'Attempt submitted successfully',
                'data'    => $summary,
            ]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::submitAttempt ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to submit attempt'], 500);
        }
    }

    // ── GET /TestSeriesApi/getResult?attempt_id=X ─────────────────────────────

    public function getResult(): void
    {
        $clientCode   = $this->clientCode();
        $enrollmentId = $this->resolveEnrollmentId();

        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $attemptId = (int)($this->request->getQuery('attempt_id') ?? 0);
        if (!$attemptId) {
            $this->json(['status' => false, 'message' => 'attempt_id is required'], 400);
            return;
        }

        $db = $this->db();

        try {
            $where  = 'WHERE ta.id = ? AND ta.client_code = ?';
            $params = [$attemptId, $clientCode];
            $role   = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (in_array($role, ['student', 'parent'], true) && $enrollmentId) {
                $where  .= ' AND ta.enrollment_id = ?';
                $params[] = $enrollmentId;
            }

            // Compute obtained_marks dynamically so old attempts (submitted before the
            // neg-marks fix) also show the correct score.  Fallback chain:
            //   question-level → section-level → test-level → 0
            $attempt = $db->execute(
                "SELECT ta.*,
                        (
                            SELECT COALESCE(SUM(
                                CASE
                                    WHEN tr2.is_attempted = 0 THEN 0
                                    WHEN tr2.is_correct = 1   THEN tq2.marks
                                    ELSE -1.0 * COALESCE(
                                        NULLIF(tq2.negative_marks,         0),
                                        NULLIF(sec2.negative_per_question, 0),
                                        NULLIF(t2.negative_marking_ratio,  0),
                                        0
                                    )
                                END
                            ), 0)
                            FROM   ssms_test_responses  tr2
                            JOIN   ssms_test_questions  tq2  ON tq2.id  = tr2.test_question_id
                            LEFT JOIN ssms_test_sections sec2 ON sec2.id = tq2.section_id
                                                             AND sec2.client_code = tr2.client_code
                            LEFT JOIN ssms_tests         t2   ON t2.id  = tq2.test_id
                                                             AND t2.client_code = tq2.client_code
                            WHERE  tr2.attempt_id  = ta.id
                              AND  tr2.client_code = ta.client_code
                        )                     AS obtained_marks,
                        t.title               AS test_title,
                        t.total_marks,
                        t.passing_marks,
                        t.show_result_immediately,
                        t.duration_minutes
                 FROM   ssms_test_attempts ta
                 JOIN   ssms_tests         t ON t.id = ta.test_id
                 {$where}",
                $params
            )->fetchAssoc();

            if (!$attempt) {
                $this->json(['status' => false, 'message' => 'Result not found'], 404);
                return;
            }

            // Self-heal: if the stored score differs from the dynamically computed one,
            // write the correct value back so ta.score stays accurate going forward.
            $computedScore = round((float)($attempt['obtained_marks'] ?? 0), 3);
            $storedScore   = round((float)($attempt['score']          ?? 0), 3);
            if ($computedScore !== $storedScore) {
                $db->execute(
                    'UPDATE ssms_test_attempts SET score = ? WHERE id = ?',
                    [$computedScore, $attemptId]
                );
                $attempt['score'] = $computedScore;
            }

            // Section breakdown also uses dynamic score calculation for the same reason.
            $sections = $db->execute(
                "SELECT sec.id                                          AS section_id,
                        sec.section_name,
                        COUNT(tq.id)                                    AS total_questions,
                        SUM(tq.marks)                                   AS total_marks,
                        SUM(tr.is_correct)                              AS correct_count,
                        SUM(tr.is_attempted = 1 AND tr.is_correct = 0) AS wrong_count,
                        SUM(tr.is_attempted = 0)                        AS unattempted_count,
                        SUM(
                            CASE
                                WHEN tr.is_attempted = 0 THEN 0
                                WHEN tr.is_correct = 1   THEN tq.marks
                                ELSE -1.0 * COALESCE(
                                    NULLIF(tq.negative_marks,        0),
                                    NULLIF(sec.negative_per_question, 0),
                                    NULLIF(t.negative_marking_ratio,  0),
                                    0
                                )
                            END
                        )                                               AS obtained_marks
                 FROM   ssms_test_responses tr
                 JOIN   ssms_test_questions  tq  ON tq.id  = tr.test_question_id
                 JOIN   ssms_test_sections   sec ON sec.id = tq.section_id
                 LEFT JOIN ssms_tests         t   ON t.id  = tq.test_id
                                                 AND t.client_code = tq.client_code
                 WHERE  tr.attempt_id  = ?
                   AND  tr.client_code = ?
                 GROUP BY sec.id, sec.section_name
                 ORDER BY sec.section_order ASC, sec.id ASC",
                [$attemptId, $clientCode]
            )->fetchAll('assoc');

            $this->json([
                'status' => true,
                'data'   => [
                    'attempt'  => $attempt,
                    'sections' => $sections ?: [],
                ],
            ]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getResult ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch result'], 500);
        }
    }

    /**
     * GET /TestSeriesApi/getAnalysis?attempt_id=X
     *
     * Full Q-by-Q analysis: question text, correct answer, student's answer,
     * is_correct, marks_awarded, time_spent.
     */
    public function getAnalysis(): void
    {
        $clientCode   = $this->clientCode();
        $enrollmentId = $this->resolveEnrollmentId();

        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $attemptId = (int)($this->request->getQuery('attempt_id') ?? 0);
        if (!$attemptId) {
            $this->json(['status' => false, 'message' => 'attempt_id is required'], 400);
            return;
        }

        $db = $this->db();

        try {
            $role = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (in_array($role, ['student', 'parent'], true) && $enrollmentId) {
                $ok = $db->execute(
                    "SELECT id FROM ssms_test_attempts WHERE id = ? AND enrollment_id = ? AND client_code = ?",
                    [$attemptId, $enrollmentId, $clientCode]
                )->fetchAssoc();
                if (!$ok) {
                    $this->json(['status' => false, 'message' => 'Not found'], 404);
                    return;
                }
            }

            $rows = $db->execute(
                "SELECT tr.id                   AS response_id,
                        tr.test_question_id,
                        tr.question_id,
                        tr.selected_option,
                        tr.numerical_answer,
                        tr.is_attempted,
                        tr.is_correct,
                        -- Recompute marks_awarded dynamically (question → section → test → 0)
                        CASE
                            WHEN tr.is_attempted = 0 THEN 0
                            WHEN tr.is_correct   = 1 THEN tq.marks
                            ELSE -1.0 * COALESCE(
                                NULLIF(tq.negative_marks,        0),
                                NULLIF(sec.negative_per_question, 0),
                                NULLIF(t.negative_marking_ratio,  0),
                                0
                            )
                        END                     AS marks_awarded,
                        tr.time_spent_seconds,
                        tr.is_marked_for_review,
                        tq.marks               AS max_marks,
                        tq.negative_marks,
                        tq.section_id,
                        tq.question_order,
                        qb.type                AS q_type,
                        qb.question_text,
                        qb.options,
                        qb.match_pairs,
                        qb.answer              AS correct_answer,
                        qb.explanation,
                        qb.image_path,
                        qb.difficulty,
                        sec.section_name       AS section_title
                 FROM   ssms_test_responses tr
                 JOIN   ssms_test_questions  tq  ON tq.id  = tr.test_question_id
                 JOIN   ssms_question_bank   qb  ON qb.id  = tr.question_id
                 LEFT JOIN ssms_test_sections sec ON sec.id = tq.section_id
                 LEFT JOIN ssms_tests         t   ON t.id  = tq.test_id
                                                 AND t.client_code = tq.client_code
                 WHERE  tr.attempt_id  = ?
                   AND  tr.client_code = ?
                 ORDER BY tq.question_order ASC, tr.test_question_id ASC",
                [$attemptId, $clientCode]
            )->fetchAll('assoc');

            foreach ($rows as &$row) {
                $row['options']     = $row['options']     ? json_decode($row['options'],     true) : null;
                $row['match_pairs'] = $row['match_pairs'] ? json_decode($row['match_pairs'], true) : null;

                $row['selected_option'] = strtoupper(trim((string)($row['selected_option'] ?? '')));
                // correct_answer = qb.answer column — the letter the admin typed.
                $row['correct_answer']  = strtoupper(trim((string)($row['correct_answer'] ?? '')));
            }
            unset($row);

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getAnalysis ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch analysis'], 500);
        }
    }

    // ── GET /TestSeriesApi/getLeaderboard?test_id=X ───────────────────────────

    public function getLeaderboard(): void
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            $this->json(['status' => false, 'message' => 'Unauthorized'], 401);
            return;
        }

        $testId = (int)($this->request->getQuery('test_id') ?? 0);
        if (!$testId) {
            $this->json(['status' => false, 'message' => 'test_id is required'], 400);
            return;
        }

        $limit = min((int)($this->request->getQuery('limit') ?? 50), 200);

        // Detect whether the column has been renamed yet (rank → rank_in_batch).
        $rankCol = 'rank_in_batch';
        try {
            $cols = $this->db()->execute(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME   = 'ssms_test_attempts'
                    AND COLUMN_NAME  = 'rank_in_batch'"
            )->fetchAll('assoc');
            if (empty($cols)) {
                $rankCol = '`rank`';   // old column name, backtick-escaped (reserved word)
            }
        } catch (\Exception $ignored) {}

        try {
            $rows = $this->db()->execute(
                "SELECT ta.{$rankCol}                                                 AS rank,
                        ta.score                                                      AS obtained_marks,
                        ta.correct_count,
                        ta.wrong_count,
                        ta.unattempted_count,
                        ta.percentile,
                        ta.submitted_at,
                        ta.enrollment_id,
                        TIMESTAMPDIFF(SECOND, ta.started_at, ta.submitted_at)        AS time_spent_seconds,
                        t.total_marks,
                        COALESCE(qc.question_count, 0)                               AS question_count,
                        CONCAT(sr.student_first_name, ' ', sr.student_last_name)     AS student_name,
                        se.roll_number
                 FROM   ssms_test_attempts ta
                 JOIN   ssms_tests                  t  ON t.id             = ta.test_id
                                                      AND t.client_code    = ta.client_code
                 LEFT JOIN (
                     SELECT test_id, client_code, COUNT(*) AS question_count
                     FROM   ssms_test_questions
                     GROUP BY test_id, client_code
                 ) qc ON qc.test_id    = ta.test_id
                      AND qc.client_code = ta.client_code
                 LEFT JOIN ssms_student_enrollment  se ON se.enrollment_id  = ta.enrollment_id
                                                      AND se.ssms_client_code = ta.client_code
                 LEFT JOIN ssms_student_registration sr ON sr.registration_id = se.registration_id
                 WHERE  ta.test_id     = ?
                   AND  ta.client_code = ?
                   AND  ta.status      = 'submitted'
                 ORDER BY ta.{$rankCol} ASC, ta.submitted_at ASC
                 LIMIT {$limit}",
                [$testId, $clientCode]
            )->fetchAll('assoc');

            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getLeaderboard ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch leaderboard'], 500);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CHAPTERS  (chapter-wise test series feature)
    // Routes to add in config/routes.php:
    //   $routes->get('/TestSeriesApi/getChapters',         ['controller'=>'TestSeriesApi','action'=>'getChapters']);
    //   $routes->post('/TestSeriesApi/createChapter',       ['controller'=>'TestSeriesApi','action'=>'createChapter']);
    //   $routes->post('/TestSeriesApi/updateChapter/:id',   ['controller'=>'TestSeriesApi','action'=>'updateChapter']);
    //   $routes->delete('/TestSeriesApi/deleteChapter/:id', ['controller'=>'TestSeriesApi','action'=>'deleteChapter']);
    // ═══════════════════════════════════════════════════════════════════════════

    /** GET /TestSeriesApi/getChapters?class_id=&subject_id= */
    public function getChapters(): void
    {
        $clientCode  = $this->request->getHeaderLine('ssmsClientCode');
        $classId     = $this->request->getQuery('class_id');
        $subjectId   = $this->request->getQuery('subject_id');
        $subjectName = trim((string)($this->request->getQuery('subject_name') ?? ''));

        // If no subject_id provided but subject_name is, look up the subject id
        if (!$subjectId && $subjectName) {
            $sRow = $this->db()->execute(
                "SELECT subject_id FROM ssms_subjects WHERE ssms_client_code = ? AND subject_name = ? LIMIT 1",
                [$clientCode, $subjectName]
            )->fetchAssoc();
            if ($sRow) { $subjectId = $sRow['subject_id']; }
        }

        $where  = 'client_code = ?';
        $params = [$clientCode];

        if ($classId)   { $where .= ' AND class_id = ?';   $params[] = (int)$classId; }
        if ($subjectId) { $where .= ' AND subject_id = ?'; $params[] = (int)$subjectId; }

        try {
            $rows = $this->db()->execute(
                "SELECT * FROM ssms_chapters WHERE {$where} ORDER BY chapter_no ASC, chapter_name ASC",
                $params
            )->fetchAll('assoc');
            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::getChapters ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch chapters'], 500);
        }
    }

    /** POST /TestSeriesApi/createChapter */
    public function createChapter(): void
    {
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $data       = (array)($this->request->getParsedBody() ?? []);

        if (empty($data['class_id']) || empty($data['subject_id']) || empty($data['chapter_name'])) {
            $this->json(['status' => false, 'message' => 'class_id, subject_id and chapter_name are required.'], 400);
            return;
        }

        $row = [
            'client_code'  => $clientCode,
            'class_id'     => (int)$data['class_id'],
            'subject_id'   => (int)$data['subject_id'],
            'chapter_no'   => isset($data['chapter_no'])   ? (int)$data['chapter_no']       : 0,
            'chapter_name' => trim($data['chapter_name']),
            'unit_name'    => isset($data['unit_name'])    ? trim($data['unit_name']) : null,
        ];

        try {
            $this->db()->insert('ssms_chapters', $row);
            $newId = $this->db()->getDriver()->lastInsertId();
            $this->json(['status' => true, 'message' => 'Chapter created.', 'id' => $newId]);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::createChapter ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to create chapter'], 500);
        }
    }

    /** POST /TestSeriesApi/updateChapter/:id */
    public function updateChapter(int $id): void
    {
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $data       = (array)($this->request->getParsedBody() ?? []);

        $allowed = ['chapter_no', 'chapter_name', 'unit_name'];
        $set = []; $params = [];
        foreach ($allowed as $k) {
            if (array_key_exists($k, $data)) {
                $set[]    = "{$k} = ?";
                $params[] = $data[$k];
            }
        }

        if (empty($set)) {
            $this->json(['status' => false, 'message' => 'Nothing to update.'], 400);
            return;
        }

        $params[] = $id;
        $params[] = $clientCode;

        try {
            $this->db()->execute(
                'UPDATE ssms_chapters SET ' . implode(', ', $set) . ' WHERE id = ? AND client_code = ?',
                $params
            );
            $this->json(['status' => true, 'message' => 'Chapter updated.']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::updateChapter ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to update chapter'], 500);
        }
    }

    /** DELETE /TestSeriesApi/deleteChapter/:id */
    public function deleteChapter(int $id): void
    {
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        try {
            $this->db()->execute(
                'DELETE FROM ssms_chapters WHERE id = ? AND client_code = ?',
                [$id, $clientCode]
            );
            $this->json(['status' => true, 'message' => 'Chapter deleted.']);
        } catch (\Exception $e) {
            Log::error('TestSeriesApi::deleteChapter ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to delete chapter'], 500);
        }
    }
}
