<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsQuestionPaperController
 *
 * Web-facing Paper Builder for assembling question papers from the question bank.
 * Relies on QuestionPaperApiController (AJAX) for add/remove/reorder/publish actions.
 *
 * Routes to add in config/routes.php:
 *   $builder->connect('/papers',                ['controller'=>'SsmsQuestionPaper','action'=>'index']);
 *   $builder->connect('/papers/add',            ['controller'=>'SsmsQuestionPaper','action'=>'add']);
 *   $builder->connect('/papers/edit/{id}',      ['controller'=>'SsmsQuestionPaper','action'=>'edit'])->setPass(['id']);
 *   $builder->connect('/papers/view/{id}',      ['controller'=>'SsmsQuestionPaper','action'=>'view'])->setPass(['id']);
 *   $builder->connect('/papers/delete/{id}',    ['controller'=>'SsmsQuestionPaper','action'=>'delete'])->setPass(['id']);
 *   $builder->connect('/papers/publish/{id}',   ['controller'=>'SsmsQuestionPaper','action'=>'publish'])->setPass(['id']);
 */
class SsmsQuestionPaperController extends AppController
{
    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function requireRole(): bool
    {
        $role = $this->request->getSession()->read('ssms_user_role');
        if (!in_array($role, ['admin', 'owner', 'superuser'], true)) {
            $this->Flash->error('You do not have permission to access this page.');
            $this->redirect(['controller' => 'Dashboards', 'action' => 'index']);
            return false;
        }
        return true;
    }

    private function loadDropdowns(string $clientCode): array
    {
        $db = $this->db();
        $classes = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code = ? ORDER BY class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $subjects = $db->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects WHERE ssms_client_code = ? ORDER BY subject_name",
            [$clientCode]
        )->fetchAll('assoc');

        $branches = $db->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_name",
            [$clientCode]
        )->fetchAll('assoc');

        $sessions = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code = ? ORDER BY session_id DESC",
            [$clientCode]
        )->fetchAll('assoc');

        return compact('classes', 'subjects', 'branches', 'sessions');
    }

    // ── GET /papers ───────────────────────────────────────────────────────────
    public function index()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');

        $filterClass   = $this->request->getQuery('class_id', '');
        $filterSubject = $this->request->getQuery('subject_id', '');
        $filterStatus  = $this->request->getQuery('status', '');
        $filterSession = $this->request->getQuery('session_id', '');
        $filterKeyword = trim((string)$this->request->getQuery('keyword', ''));

        $where  = 'WHERE p.ssms_client_code = ?';
        $params = [$clientCode];

        if ($filterClass)   { $where .= ' AND p.class_id = ?';    $params[] = (int)$filterClass;   }
        if ($filterSubject) { $where .= ' AND p.subject_id = ?';  $params[] = (int)$filterSubject; }
        if ($filterStatus)  { $where .= ' AND p.status = ?';      $params[] = $filterStatus;       }
        if ($filterSession) { $where .= ' AND p.session_id = ?';  $params[] = (int)$filterSession; }
        if ($filterKeyword) { $where .= ' AND p.title LIKE ?';    $params[] = '%' . $filterKeyword . '%'; }

        $db = $this->db();

        try {
            $papers = $db->execute("
                SELECT p.id, p.title, p.exam_type, p.session, p.total_marks, p.duration_minutes,
                       p.status, p.created_at,
                       c.class_name, s.subject_name,
                       b.branch_name,
                       ss.session_name,
                       (SELECT COUNT(*) FROM ssms_paper_questions pq WHERE pq.paper_id = p.id) AS question_count
                FROM   ssms_question_papers p
                LEFT JOIN ssms_classes  c  ON c.class_id   = p.class_id
                LEFT JOIN ssms_subjects s  ON s.subject_id = p.subject_id
                LEFT JOIN ssms_branch   b  ON b.branch_id  = p.branch_id
                LEFT JOIN ssms_sessions ss ON ss.session_id = p.session_id
                {$where}
                ORDER BY p.id DESC
                LIMIT 300
            ", $params)->fetchAll('assoc');
        } catch (\Exception $e) {
            Log::error('SsmsQuestionPaper::index ' . $e->getMessage());
            $papers = [];
            $this->Flash->error('Could not load papers.');
        }

        $dropdowns = $this->loadDropdowns($clientCode);
        $filters = [
            'class_id'   => $filterClass,
            'subject_id' => $filterSubject,
            'status'     => $filterStatus,
            'session_id' => $filterSession,
            'keyword'    => $filterKeyword,
        ];

        $this->set(compact('papers', 'filters'));
        $this->set($dropdowns);
    }

    // ── GET|POST /papers/add ─────────────────────────────────────────────────
    public function add()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $userId     = (int)$session->read('ssms_user_id');
        $dropdowns  = $this->loadDropdowns($clientCode);

        if ($this->request->is('post')) {
            $d = $this->request->getData();

            $title       = trim((string)($d['title'] ?? ''));
            $classId     = !empty($d['class_id'])          ? (int)$d['class_id']          : null;
            $subjectId   = !empty($d['subject_id'])        ? (int)$d['subject_id']        : null;
            $examType    = trim((string)($d['exam_type']   ?? 'Unit Test'));
            $examSession = trim((string)($d['session']     ?? ''));
            $duration    = !empty($d['duration_minutes'])  ? (int)$d['duration_minutes']  : null;
            $branchId    = !empty($d['branch_id'])         ? (int)$d['branch_id']         : null;
            $sessionId   = !empty($d['session_id'])        ? (int)$d['session_id']        : null;

            if ($title === '') {
                $this->Flash->error('Paper title is required.');
            } else {
                try {
                    $this->db()->execute("
                        INSERT INTO ssms_question_papers
                            (ssms_client_code, branch_id, session_id, title, class_id, subject_id,
                             session, exam_type, duration_minutes, created_by)
                        VALUES (?,?,?,?,?,?,?,?,?,?)
                    ", [$clientCode, $branchId, $sessionId, $title, $classId, $subjectId,
                        $examSession, $examType, $duration, $userId ?: null]);

                    $newId = (int)$this->db()->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];
                    $this->Flash->success('Paper created! Now add questions to build it.');
                    return $this->redirect(['action' => 'view', $newId]);
                } catch (\Exception $e) {
                    Log::error('SsmsQuestionPaper::add ' . $e->getMessage());
                    $this->Flash->error('Failed to create paper. Please try again.');
                }
            }
        }

        $this->set($dropdowns);
        $this->set('isEdit', false);
        $this->set('paper', null);
        $this->render('add_edit');
    }

    // ── GET|POST /papers/edit/:id ────────────────────────────────────────────
    public function edit($id = null)
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $paperId    = (int)$id;
        $db         = $this->db();

        $paper = $db->execute(
            "SELECT * FROM ssms_question_papers WHERE id = ? AND ssms_client_code = ?",
            [$paperId, $clientCode]
        )->fetchAssoc();

        if (!$paper) {
            $this->Flash->error('Paper not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($paper['status'] !== 'draft') {
            $this->Flash->error('Only draft papers can be edited. This paper is ' . $paper['status'] . '.');
            return $this->redirect(['action' => 'view', $paperId]);
        }

        $dropdowns = $this->loadDropdowns($clientCode);

        if ($this->request->is('post')) {
            $d = $this->request->getData();

            $title       = trim((string)($d['title'] ?? ''));
            $classId     = !empty($d['class_id'])          ? (int)$d['class_id']          : null;
            $subjectId   = !empty($d['subject_id'])        ? (int)$d['subject_id']        : null;
            $examType    = trim((string)($d['exam_type']   ?? 'Unit Test'));
            $examSession = trim((string)($d['session']     ?? ''));
            $duration    = !empty($d['duration_minutes'])  ? (int)$d['duration_minutes']  : null;
            $branchId    = !empty($d['branch_id'])         ? (int)$d['branch_id']         : null;
            $sessionId   = !empty($d['session_id'])        ? (int)$d['session_id']        : null;

            if ($title === '') {
                $this->Flash->error('Paper title is required.');
            } else {
                try {
                    $db->execute("
                        UPDATE ssms_question_papers
                        SET title = ?, class_id = ?, subject_id = ?, exam_type = ?, session = ?,
                            duration_minutes = ?, branch_id = ?, session_id = ?
                        WHERE id = ? AND ssms_client_code = ?
                    ", [$title, $classId, $subjectId, $examType, $examSession,
                        $duration, $branchId, $sessionId, $paperId, $clientCode]);

                    $this->Flash->success('Paper updated successfully.');
                    return $this->redirect(['action' => 'view', $paperId]);
                } catch (\Exception $e) {
                    Log::error('SsmsQuestionPaper::edit ' . $e->getMessage());
                    $this->Flash->error('Failed to update paper. Please try again.');
                }
            }
        }

        $this->set($dropdowns);
        $this->set('isEdit', true);
        $this->set('paper', $paper);
        $this->render('add_edit');
    }

    // ── GET /papers/preview/:id ──────────────────────────────────────────────
    public function preview($id = null)
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $paperId    = (int)$id;
        $db         = $this->db();

        $paper = $db->execute("
            SELECT p.*, c.class_name, s.subject_name, b.branch_name, ss.session_name
            FROM   ssms_question_papers p
            LEFT JOIN ssms_classes  c  ON c.class_id   = p.class_id
            LEFT JOIN ssms_subjects s  ON s.subject_id = p.subject_id
            LEFT JOIN ssms_branch   b  ON b.branch_id  = p.branch_id
            LEFT JOIN ssms_sessions ss ON ss.session_id = p.session_id
            WHERE  p.id = ? AND p.ssms_client_code = ?
        ", [$paperId, $clientCode])->fetchAssoc();

        if (!$paper) {
            $this->Flash->error('Paper not found.');
            return $this->redirect(['action' => 'index']);
        }

        $questions = $db->execute("
            SELECT pq.id AS pq_id, pq.question_id, pq.section_label, pq.order_index, pq.marks,
                   q.type, q.question_text, q.options, q.match_pairs, q.answer,
                   q.image_path, q.answer_lines, q.chapter,
                   s.subject_name, c.class_name
            FROM   ssms_paper_questions pq
            JOIN   ssms_question_bank q ON q.id = pq.question_id
            LEFT JOIN ssms_subjects   s ON s.subject_id = q.subject_id
            LEFT JOIN ssms_classes    c ON c.class_id   = q.class_id
            WHERE  pq.paper_id = ?
            ORDER  BY pq.order_index ASC, pq.id ASC
        ", [$paperId])->fetchAll('assoc');

        foreach ($questions as &$q) {
            $q['options']     = $q['options']     ? json_decode($q['options'],     true) : null;
            $q['match_pairs'] = $q['match_pairs'] ? json_decode($q['match_pairs'], true) : null;
        }
        unset($q);

        // School identity from session (set at login from ssms_clients table)
        $schoolName = $session->read('ssms_client_header_text') ?: 'School Name';
        $logoName   = $session->read('logo_name') ?: '';

        // header_config overrides if present
        $cfg = $paper['header_config'] ? json_decode($paper['header_config'], true) : [];
        if (!empty($cfg['schoolName'])) $schoolName = $cfg['schoolName'];
        $schoolAddress = $cfg['address'] ?? '';

        $this->set(compact(
            'paper', 'questions', 'clientCode',
            'schoolName', 'logoName', 'schoolAddress'
        ));

        // Use a bare layout (no sidebar/nav) for clean print
        $this->viewBuilder()->setLayout('print');
    }

    // ── GET /papers/view/:id ─────────────────────────────────────────────────
    public function view($id = null)
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $paperId    = (int)$id;
        $db         = $this->db();

        $paper = $db->execute("
            SELECT p.*, c.class_name, s.subject_name, b.branch_name, ss.session_name
            FROM   ssms_question_papers p
            LEFT JOIN ssms_classes  c  ON c.class_id   = p.class_id
            LEFT JOIN ssms_subjects s  ON s.subject_id = p.subject_id
            LEFT JOIN ssms_branch   b  ON b.branch_id  = p.branch_id
            LEFT JOIN ssms_sessions ss ON ss.session_id = p.session_id
            WHERE  p.id = ? AND p.ssms_client_code = ?
        ", [$paperId, $clientCode])->fetchAssoc();

        if (!$paper) {
            $this->Flash->error('Paper not found.');
            return $this->redirect(['action' => 'index']);
        }

        // Load subjects list for the question picker filter
        $subjects = $db->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects WHERE ssms_client_code = ? ORDER BY subject_name",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact('paper', 'subjects', 'clientCode'));
    }

    // ── POST /papers/delete/:id ───────────────────────────────────────────────
    public function delete($id = null)
    {
        $this->request->allowMethod(['post']);
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $paperId    = (int)$id;
        $db         = $this->db();

        $paper = $db->execute(
            "SELECT id, status FROM ssms_question_papers WHERE id = ? AND ssms_client_code = ?",
            [$paperId, $clientCode]
        )->fetchAssoc();

        if (!$paper) {
            $this->Flash->error('Paper not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($paper['status'] !== 'draft') {
            $this->Flash->error('Only draft papers can be deleted.');
            return $this->redirect(['action' => 'index']);
        }

        try {
            $db->execute('DELETE FROM ssms_paper_questions WHERE paper_id = ?', [$paperId]);
            $db->execute('DELETE FROM ssms_question_papers  WHERE id = ? AND ssms_client_code = ?', [$paperId, $clientCode]);
            $this->Flash->success('Paper deleted successfully.');
        } catch (\Exception $e) {
            Log::error('SsmsQuestionPaper::delete ' . $e->getMessage());
            $this->Flash->error('Failed to delete paper.');
        }

        return $this->redirect(['action' => 'index']);
    }

    // ── POST /papers/publish/:id ──────────────────────────────────────────────
    public function publish($id = null)
    {
        $this->request->allowMethod(['post']);
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $paperId    = (int)$id;

        try {
            $affected = $this->db()->execute(
                "UPDATE ssms_question_papers SET status = 'published'
                 WHERE id = ? AND ssms_client_code = ? AND status = 'draft'",
                [$paperId, $clientCode]
            )->rowCount();

            if ($affected > 0) {
                $this->Flash->success('Paper published successfully.');
            } else {
                $this->Flash->error('Paper could not be published (already published or not found).');
            }
        } catch (\Exception $e) {
            Log::error('SsmsQuestionPaper::publish ' . $e->getMessage());
            $this->Flash->error('Failed to publish paper.');
        }

        return $this->redirect(['action' => 'view', $paperId]);
    }
}
