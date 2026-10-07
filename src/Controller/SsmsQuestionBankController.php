<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsQuestionBankController
 *
 * Web UI for the school question bank.
 * Actions: index, add, edit, delete, chapters
 */
class SsmsQuestionBankController extends AppController
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function clientCode(): string
    {
        return (string)$this->request->getSession()->read('ssms_client_code');
    }

    private function role(): string
    {
        return (string)$this->request->getSession()->read('ssms_user_role');
    }

    private function isAdmin(): bool
    {
        return in_array($this->role(), ['admin', 'owner', 'superuser'], true);
    }

    private function requireAdmin(): ?object
    {
        if (!$this->isAdmin()) {
            $this->Flash->error('You do not have permission to perform this action.');
            return $this->redirect(['action' => 'index']);
        }
        return null;
    }

    /** Load branch, session, class, subject dropdowns for forms/filters. */
    private function loadDropdowns(string $clientCode): array
    {
        $db = $this->db();

        $branches = $db->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $sessions = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code = ? ORDER BY session_id DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $classes = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code = ? ORDER BY class_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $subjects = $db->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects WHERE ssms_client_code = ? ORDER BY subject_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        return compact('branches', 'sessions', 'classes', 'subjects');
    }

    /** Load chapters for a given client, optionally filtered by class/subject. */
    private function loadChapters(string $clientCode, ?int $classId = null, ?int $subjectId = null): array
    {
        $db = $this->db();
        $where = 'WHERE client_code = ?';
        $params = [$clientCode];

        if ($classId) {
            $where .= ' AND class_id = ?';
            $params[] = $classId;
        }
        if ($subjectId) {
            $where .= ' AND subject_id = ?';
            $params[] = $subjectId;
        }

        try {
            return $db->execute(
                "SELECT id, chapter_name, class_id, subject_id FROM ssms_chapters $where ORDER BY chapter_name ASC",
                $params
            )->fetchAll('assoc');
        } catch (\Exception $e) {
            return [];
        }
    }

    /**
     * Handle question image upload (cropped base64 or raw file upload).
     * Returns the public URL path on success, null otherwise.
     * Matches the pattern from QuestionBankApiController::uploadImage().
     */
    private function uploadQuestionImage(string $clientCode): ?string
    {
        $dir = dirname(dirname(__DIR__)) . DS . 'clients' . DS . $clientCode . DS . 'question_images';

        // 1. Prefer the cropped base64 data from the Cropper.js modal
        $base64Data = trim((string)($this->request->getData('question_image_data') ?? ''));
        if ($base64Data && strpos($base64Data, 'data:image/') === 0) {
            if (preg_match('/^data:image\/(\w+);base64,(.+)$/s', $base64Data, $m)) {
                $ext  = strtolower($m[1] === 'jpeg' ? 'jpg' : $m[1]);
                $data = base64_decode($m[2]);
                if ($data) {
                    if (!is_dir($dir)) mkdir($dir, 0775, true);
                    $name = uniqid('qi_', true) . '.' . $ext;
                    file_put_contents($dir . DS . $name, $data);
                    return '/clients/' . $clientCode . '/question_images/' . $name;
                }
            }
        }

        // 2. Fall back to a direct file upload (no crop)
        $file = $this->request->getUploadedFile('question_image');
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) {
            return null;
        }
        $allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!in_array($file->getClientMediaType(), $allowed, true)) {
            return null;
        }
        $ext = strtolower(pathinfo($file->getClientFilename(), PATHINFO_EXTENSION) ?: 'jpg');
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $name = uniqid('qi_', true) . '.' . $ext;
        $file->moveTo($dir . DS . $name);
        return '/clients/' . $clientCode . '/question_images/' . $name;
    }

    /** Delete a question image file given its public URL path. */
    private function deleteQuestionImage(string $imagePath): void
    {
        if (!$imagePath) return;
        // Convert /clients/{code}/question_images/file.jpg → absolute FS path
        $absPath = dirname(dirname(__DIR__)) . DS . ltrim(str_replace('/', DS, $imagePath), DS);
        if (is_file($absPath)) {
            @unlink($absPath);
        }
    }

    /** Build options JSON from POST data. */
    private function buildOptionsJson(array $d, string $type): ?string
    {
        if (!in_array($type, ['mcq', 'multi_correct', 'true_false'], true)) {
            return null;
        }

        if ($type === 'true_false') {
            $ans = strtolower(trim((string)($d['tf_answer'] ?? 'true')));
            $opts = [
                ['text' => 'True',  'isCorrect' => ($ans === 'true' || $ans === 'a')],
                ['text' => 'False', 'isCorrect' => ($ans === 'false' || $ans === 'b')],
            ];
            return json_encode($opts);
        }

        // MCQ / multi_correct
        $optTexts = $d['opt_text'] ?? [];
        $correct  = $d['opt_correct'] ?? null;  // string for mcq, array for multi_correct
        $letters  = ['A', 'B', 'C', 'D', 'E'];
        $options  = [];

        foreach ($optTexts as $i => $text) {
            if (trim((string)$text) === '') continue;
            $letter    = $letters[$i] ?? chr(65 + $i);
            $isCorrect = is_array($correct)
                ? in_array($letter, $correct, true)
                : ($correct === $letter);
            $options[] = ['text' => trim((string)$text), 'isCorrect' => $isCorrect];
        }

        return empty($options) ? null : json_encode($options);
    }

    /** Derive the answer string from POST data based on type. */
    private function buildAnswer(array $d, string $type): string
    {
        switch ($type) {
            case 'true_false':
                $ans = strtolower(trim((string)($d['tf_answer'] ?? 'true')));
                return ($ans === 'true' || $ans === 'a') ? 'A' : 'B';

            case 'mcq':
                return strtoupper(trim((string)($d['opt_correct'] ?? '')));

            case 'multi_correct':
                $correct = $d['opt_correct'] ?? [];
                if (is_array($correct)) {
                    return implode(',', array_map('strtoupper', $correct));
                }
                return strtoupper(trim((string)$correct));

            default:
                return trim((string)($d['answer'] ?? ''));
        }
    }

    /** Build match_pairs JSON from POST data. */
    private function buildMatchPairsJson(array $d): ?string
    {
        $lefts  = $d['match_left']  ?? [];
        $rights = $d['match_right'] ?? [];
        $pairs  = [];

        foreach ($lefts as $i => $l) {
            $l = trim((string)$l);
            $r = trim((string)($rights[$i] ?? ''));
            if ($l !== '' || $r !== '') {
                $pairs[] = ['left' => $l, 'right' => $r];
            }
        }

        return empty($pairs) ? null : json_encode($pairs);
    }

    // ── index ─────────────────────────────────────────────────────────────────

    public function index()
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) {
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $db = $this->db();

        // Filters
        $filters = [
            'class_id'   => $this->request->getQuery('class_id', ''),
            'subject_id' => $this->request->getQuery('subject_id', ''),
            'chapter_id' => $this->request->getQuery('chapter_id', ''),
            'type'       => $this->request->getQuery('type', ''),
            'difficulty' => $this->request->getQuery('difficulty', ''),
            'keyword'    => trim((string)$this->request->getQuery('keyword', '')),
            'branch_id'  => $this->request->getQuery('branch_id', ''),
            'session_id' => $this->request->getQuery('session_id', ''),
        ];

        $where  = 'WHERE q.ssms_client_code = ? AND q.is_deleted = 0';
        $params = [$clientCode];

        if ($filters['class_id'])   { $where .= ' AND q.class_id = ?';   $params[] = (int)$filters['class_id']; }
        if ($filters['subject_id']) { $where .= ' AND q.subject_id = ?'; $params[] = (int)$filters['subject_id']; }
        if ($filters['chapter_id']) { $where .= ' AND q.chapter_id = ?'; $params[] = (int)$filters['chapter_id']; }
        if ($filters['type'])       { $where .= ' AND q.type = ?';       $params[] = $filters['type']; }
        if ($filters['difficulty']) { $where .= ' AND q.difficulty = ?'; $params[] = $filters['difficulty']; }
        if ($filters['branch_id'])  { $where .= ' AND q.branch_id = ?';  $params[] = (int)$filters['branch_id']; }
        if ($filters['session_id']) { $where .= ' AND q.session_id = ?'; $params[] = (int)$filters['session_id']; }
        if ($filters['keyword'])    { $where .= ' AND q.question_text LIKE ?'; $params[] = '%' . $filters['keyword'] . '%'; }

        $questions = $db->execute(
            "SELECT q.id, q.type, q.question_text, q.difficulty, q.marks, q.chapter,
                    q.chapter_id, q.class_id, q.subject_id, q.created_at,
                    s.subject_name, c.class_name,
                    ch.chapter_name
             FROM   ssms_question_bank q
             LEFT JOIN ssms_subjects  s  ON s.subject_id = q.subject_id
             LEFT JOIN ssms_classes   c  ON c.class_id   = q.class_id
             LEFT JOIN ssms_chapters  ch ON ch.id         = q.chapter_id
             $where
             ORDER BY q.id DESC
             LIMIT 500",
            $params
        )->fetchAll('assoc');

        $dropdowns = $this->loadDropdowns($clientCode);
        $chapters  = $this->loadChapters(
            $clientCode,
            $filters['class_id']   ? (int)$filters['class_id']   : null,
            $filters['subject_id'] ? (int)$filters['subject_id'] : null
        );

        $this->set(compact('questions', 'filters', 'chapters'));
        $this->set($dropdowns);
        $this->set('isAdmin', $this->isAdmin());
    }

    // ── add ───────────────────────────────────────────────────────────────────

    public function add()
    {
        if ($r = $this->requireAdmin()) return $r;

        $clientCode = $this->clientCode();
        $db = $this->db();
        $formData = [];

        if ($this->request->is(['post', 'put'])) {
            $d    = $this->request->getData();
            $type = trim((string)($d['type'] ?? 'short'));

            $validTypes = ['fill_blank','mcq','multi_correct','true_false','match','short','long','passage','figure'];
            if (!in_array($type, $validTypes, true)) {
                $this->Flash->error('Invalid question type selected.');
            } elseif (empty(trim((string)($d['question_text'] ?? '')))) {
                $this->Flash->error('Question text is required.');
            } else {
                $optionsJson    = $this->buildOptionsJson($d, $type);
                $matchPairsJson = ($type === 'match') ? $this->buildMatchPairsJson($d) : null;
                $answer         = $this->buildAnswer($d, $type);

                $chapterId = ($d['chapter_id'] ?? '') !== '' ? (int)$d['chapter_id'] : null;
                $chapterTxt = trim((string)($d['chapter'] ?? ''));
                // If chapter_id provided, resolve chapter name from DB
                if ($chapterId && !$chapterTxt) {
                    $chRow = $db->execute("SELECT chapter_name FROM ssms_chapters WHERE id = ?", [$chapterId])->fetch('assoc');
                    if ($chRow) $chapterTxt = $chRow['chapter_name'];
                }

                $imagePath = $this->uploadQuestionImage($clientCode);

                try {
                    $db->execute(
                        "INSERT INTO ssms_question_bank
                            (ssms_client_code, branch_id, session_id, subject_id, class_id,
                             chapter_id, chapter, type, question_text, options, match_pairs,
                             answer, explanation, difficulty, marks, answer_lines, image_path, created_by)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        [
                            $clientCode,
                            (int)($d['branch_id']  ?? 0),
                            (int)($d['session_id'] ?? 0),
                            (int)($d['subject_id'] ?? 0),
                            (int)($d['class_id']   ?? 0),
                            $chapterId,
                            $chapterTxt,
                            $type,
                            trim((string)$d['question_text']),
                            $optionsJson,
                            $matchPairsJson,
                            $answer,
                            trim((string)($d['explanation'] ?? '')),
                            in_array($d['difficulty'] ?? '', ['easy','medium','hard']) ? $d['difficulty'] : 'medium',
                            max(0.5, (float)($d['marks'] ?? 1)),
                            max(1, (int)($d['answer_lines'] ?? 6)),
                            $imagePath,
                            $this->request->getSession()->read('ssms_user_id'),
                        ]
                    );
                    $this->Flash->success('Question added successfully.');
                    // Redirect back to add with sticky classification values
                    return $this->redirect([
                        'action' => 'add',
                        '?' => [
                            'session_id' => $d['session_id'] ?? '',
                            'branch_id'  => $d['branch_id']  ?? '',
                            'class_id'   => $d['class_id']   ?? '',
                            'subject_id' => $d['subject_id'] ?? '',
                        ],
                    ]);
                } catch (\Exception $e) {
                    Log::error('SsmsQuestionBank::add ' . $e->getMessage());
                    $this->Flash->error('Could not save the question: ' . $e->getMessage());
                    $formData = $d;
                }
            }
            $formData = $d;
        } else {
            // Pre-fill from sticky query params
            $formData = [
                'session_id' => $this->request->getQuery('session_id', ''),
                'branch_id'  => $this->request->getQuery('branch_id',  ''),
                'class_id'   => $this->request->getQuery('class_id',   ''),
                'subject_id' => $this->request->getQuery('subject_id', ''),
            ];
        }

        $dropdowns = $this->loadDropdowns($clientCode);
        $stickyClassId   = (int)($formData['class_id']   ?? 0) ?: null;
        $stickySubjectId = (int)($formData['subject_id'] ?? 0) ?: null;
        $chapters  = $this->loadChapters($clientCode, $stickyClassId, $stickySubjectId);
        $this->set(compact('formData', 'chapters'));
        $this->set($dropdowns);
        $this->set('isEdit', false);
        $this->render('add_edit');
    }

    // ── ajaxChapters — JSON endpoint for dynamic chapter dropdown ─────────────

    public function ajaxChapters(): void
    {
        $this->autoRender = false;
        $clientCode = $this->clientCode();
        $classId    = (int)$this->request->getQuery('class_id',   0) ?: null;
        $subjectId  = (int)$this->request->getQuery('subject_id', 0) ?: null;
        $chapters   = $this->loadChapters($clientCode, $classId, $subjectId);
        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($chapters));
    }

    // ── edit ──────────────────────────────────────────────────────────────────

    public function edit($id = null)
    {
        if ($r = $this->requireAdmin()) return $r;

        $pass = $this->request->getParam('pass');
        $id   = (!empty($pass[0]) ? (int)$pass[0] : null) ?? (int)($id ?? 0);

        $clientCode = $this->clientCode();
        $db = $this->db();

        $question = $db->execute(
            "SELECT * FROM ssms_question_bank WHERE id = ? AND ssms_client_code = ? AND is_deleted = 0",
            [$id, $clientCode]
        )->fetch('assoc');

        if (!$question) {
            $this->Flash->error('Question not found.');
            return $this->redirect(['action' => 'index']);
        }

        $formData = $question;

        if ($this->request->is(['post', 'put'])) {
            $d    = $this->request->getData();
            $type = trim((string)($d['type'] ?? 'short'));

            $validTypes = ['fill_blank','mcq','multi_correct','true_false','match','short','long','passage','figure'];
            if (!in_array($type, $validTypes, true)) {
                $this->Flash->error('Invalid question type selected.');
            } elseif (empty(trim((string)($d['question_text'] ?? '')))) {
                $this->Flash->error('Question text is required.');
            } else {
                $optionsJson    = $this->buildOptionsJson($d, $type);
                $matchPairsJson = ($type === 'match') ? $this->buildMatchPairsJson($d) : null;
                $answer         = $this->buildAnswer($d, $type);

                $chapterId = ($d['chapter_id'] ?? '') !== '' ? (int)$d['chapter_id'] : null;
                $chapterTxt = trim((string)($d['chapter'] ?? ''));
                if ($chapterId && !$chapterTxt) {
                    $chRow = $db->execute("SELECT chapter_name FROM ssms_chapters WHERE id = ?", [$chapterId])->fetch('assoc');
                    if ($chRow) $chapterTxt = $chRow['chapter_name'];
                }

                // Handle image: new upload, removal, or keep existing
                $currentImagePath = $question['image_path'] ?? '';
                $removeImage = !empty($d['remove_image']);
                $newImagePath = $this->uploadQuestionImage($clientCode);

                if ($newImagePath) {
                    // New image uploaded — delete old if exists
                    if ($currentImagePath) $this->deleteQuestionImage($currentImagePath);
                    $finalImagePath = $newImagePath;
                } elseif ($removeImage) {
                    // Explicit removal requested
                    if ($currentImagePath) $this->deleteQuestionImage($currentImagePath);
                    $finalImagePath = null;
                } else {
                    // Keep existing
                    $finalImagePath = $currentImagePath ?: null;
                }

                try {
                    $db->execute(
                        "UPDATE ssms_question_bank SET
                            branch_id    = ?,
                            session_id   = ?,
                            subject_id   = ?,
                            class_id     = ?,
                            chapter_id   = ?,
                            chapter      = ?,
                            type         = ?,
                            question_text = ?,
                            options      = ?,
                            match_pairs  = ?,
                            answer       = ?,
                            explanation  = ?,
                            difficulty   = ?,
                            marks        = ?,
                            answer_lines = ?,
                            image_path   = ?
                         WHERE id = ? AND ssms_client_code = ?",
                        [
                            (int)($d['branch_id']  ?? 0),
                            (int)($d['session_id'] ?? 0),
                            (int)($d['subject_id'] ?? 0),
                            (int)($d['class_id']   ?? 0),
                            $chapterId,
                            $chapterTxt,
                            $type,
                            trim((string)$d['question_text']),
                            $optionsJson,
                            $matchPairsJson,
                            $answer,
                            trim((string)($d['explanation'] ?? '')),
                            in_array($d['difficulty'] ?? '', ['easy','medium','hard']) ? $d['difficulty'] : 'medium',
                            max(0.5, (float)($d['marks'] ?? 1)),
                            max(1, (int)($d['answer_lines'] ?? 6)),
                            $finalImagePath,
                            $id,
                            $clientCode,
                        ]
                    );
                    $this->Flash->success('Question updated successfully.');
                    return $this->redirect(['action' => 'index']);
                } catch (\Exception $e) {
                    Log::error('SsmsQuestionBank::edit ' . $e->getMessage());
                    $this->Flash->error('Could not update the question: ' . $e->getMessage());
                    $formData = $d;
                }
            }
            $formData = $d;
        }

        $dropdowns = $this->loadDropdowns($clientCode);
        $chapters  = $this->loadChapters(
            $clientCode,
            (int)($question['class_id'] ?? 0) ?: null,
            (int)($question['subject_id'] ?? 0) ?: null
        );
        $this->set(compact('formData', 'question', 'chapters', 'id'));
        $this->set($dropdowns);
        $this->set('isEdit', true);
        $this->render('add_edit');
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function delete($id = null)
    {
        if ($r = $this->requireAdmin()) return $r;
        $this->request->allowMethod(['post', 'delete']);

        $pass = $this->request->getParam('pass');
        $id   = (!empty($pass[0]) ? (int)$pass[0] : null) ?? (int)($id ?? 0);

        $clientCode = $this->clientCode();

        try {
            $this->db()->execute(
                "UPDATE ssms_question_bank SET is_deleted = 1 WHERE id = ? AND ssms_client_code = ?",
                [$id, $clientCode]
            );
            $this->Flash->success('Question deleted.');
        } catch (\Exception $e) {
            $this->Flash->error('Could not delete the question.');
        }

        return $this->redirect(['action' => 'index']);
    }

    // ── chapters ──────────────────────────────────────────────────────────────

    public function chapters()
    {
        if ($r = $this->requireAdmin()) return $r;

        $clientCode = $this->clientCode();
        $db = $this->db();

        // Handle POST: add chapter or delete chapter
        if ($this->request->is('post')) {
            $d      = $this->request->getData();
            $action = $d['chapter_action'] ?? 'add';

            if ($action === 'delete') {
                $chapId = (int)($d['chapter_id'] ?? 0);
                if ($chapId) {
                    try {
                        $db->execute(
                            "DELETE FROM ssms_chapters WHERE id = ? AND client_code = ?",
                            [$chapId, $clientCode]
                        );
                        $this->Flash->success('Chapter deleted.');
                    } catch (\Exception $e) {
                        $this->Flash->error('Could not delete chapter.');
                    }
                }
            } else {
                // Add chapter
                $chapterName = trim((string)($d['chapter_name'] ?? ''));
                $classId     = (int)($d['class_id']  ?? 0);
                $subjectId   = (int)($d['subject_id'] ?? 0);
                $branchId    = (int)($d['branch_id']  ?? 0);

                if (!$chapterName || !$classId || !$subjectId) {
                    $this->Flash->error('Chapter name, class and subject are required.');
                } else {
                    try {
                        $db->execute(
                            "INSERT INTO ssms_chapters (client_code, class_id, subject_id, chapter_name)
                             VALUES (?, ?, ?, ?)",
                            [$clientCode, $classId, $subjectId, $chapterName]
                        );
                        $this->Flash->success('Chapter added successfully.');
                    } catch (\Exception $e) {
                        Log::error('SsmsQuestionBank::chapters ' . $e->getMessage());
                        $this->Flash->error('Could not add chapter: ' . $e->getMessage());
                    }
                }
            }

            return $this->redirect(['action' => 'chapters']);
        }

        // GET: load chapter list + dropdowns
        $chapterList = $this->loadChapters($clientCode);

        // Enrich with class/subject names
        if (!empty($chapterList)) {
            $classMap = [];
            foreach ($db->execute(
                "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code = ?", [$clientCode]
            )->fetchAll('assoc') as $r) {
                $classMap[$r['class_id']] = $r['class_name'];
            }

            $subjectMap = [];
            foreach ($db->execute(
                "SELECT subject_id, subject_name FROM ssms_subjects WHERE ssms_client_code = ?", [$clientCode]
            )->fetchAll('assoc') as $r) {
                $subjectMap[$r['subject_id']] = $r['subject_name'];
            }

            foreach ($chapterList as &$ch) {
                $ch['class_name']   = $classMap[$ch['class_id']]   ?? '—';
                $ch['subject_name'] = $subjectMap[$ch['subject_id']] ?? '—';
            }
            unset($ch);
        }

        $dropdowns = $this->loadDropdowns($clientCode);
        $this->set(compact('chapterList'));
        $this->set($dropdowns);
    }
}
