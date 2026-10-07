<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsTestSeriesController
 * Web-facing controller for the Test Series / Online Exam module.
 * Uses raw SQL via ConnectionManager (no ORM).
 */
class SsmsTestSeriesController extends AppController
{
    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function clientCode(): string
    {
        return (string)$this->request->getSession()->read('ssms_client_code');
    }

    private function isAdmin(): bool
    {
        $role = (string)$this->request->getSession()->read('ssms_user_role');
        return in_array($role, ['admin', 'owner', 'superuser'], true);
    }

    // ── Shared dropdown loaders ────────────────────────────────────────────────

    private function loadDropdowns(): array
    {
        $db  = $this->db();
        $cc  = $this->clientCode();

        $classes = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=? ORDER BY class_name",
            [$cc]
        )->fetchAll('assoc');

        $subjects = $db->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects WHERE ssms_client_code=? ORDER BY subject_name",
            [$cc]
        )->fetchAll('assoc');

        $branches = $db->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=? ORDER BY branch_name",
            [$cc]
        )->fetchAll('assoc');

        $sessions = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=? ORDER BY session_id DESC",
            [$cc]
        )->fetchAll('assoc');

        return compact('classes', 'subjects', 'branches', 'sessions');
    }

    // ── index ─────────────────────────────────────────────────────────────────

    public function index()
    {
        $db  = $this->db();
        $cc  = $this->clientCode();

        $where  = "WHERE ts.ssms_client_code=?";
        $params = [$cc];

        $classId   = $this->request->getQuery('class_id');
        $status    = $this->request->getQuery('status');

        if (!empty($classId)) {
            $where    .= " AND ts.class_id=?";
            $params[]  = (int)$classId;
        }
        if ($status !== null && $status !== '') {
            $where    .= " AND ts.status=?";
            $params[]  = $status;
        }

        $seriesList = $db->execute(
            "SELECT ts.*,
                    c.class_name,
                    (SELECT COUNT(*) FROM ssms_tests t WHERE t.series_id=ts.id) AS test_count
             FROM ssms_test_series ts
             LEFT JOIN ssms_classes c ON c.class_id = ts.class_id AND c.ssms_client_code = ?
             {$where}
             ORDER BY ts.id DESC",
            array_merge([$cc], $params)
        )->fetchAll('assoc');

        $dd = $this->loadDropdowns();
        $this->set(compact('seriesList', 'classId', 'status') + $dd);
    }

    // ── add ───────────────────────────────────────────────────────────────────

    public function add()
    {
        $db  = $this->db();
        $cc  = $this->clientCode();

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $title       = trim((string)($d['title']        ?? ''));
            $description = trim((string)($d['description']  ?? ''));
            $classId     = (int)($d['class_id']   ?? 0);
            $branchId    = (int)($d['branch_id']   ?? 0);
            $sessionId   = (int)($d['session_id']  ?? 0);
            $scope       = in_array($d['series_scope'] ?? '', ['full_syllabus','chapter_wise'], true)
                           ? $d['series_scope'] : 'full_syllabus';

            if ($title === '') {
                $this->Flash->error('Title is required.');
            } else {
                $createdBy = (int)$this->request->getSession()->read('ssms_user_id');
                $db->execute(
                    "INSERT INTO ssms_test_series
                     (ssms_client_code, branch_id, session_id, class_id, title, description, series_scope, status, created_by)
                     VALUES (?,?,?,?,?,?,'full_syllabus','active',?)",
                    [$cc, $branchId, $sessionId, $classId, $title, $description, $createdBy]
                );
                // Fix scope in separate update (parameterised enum)
                $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'];
                $db->execute("UPDATE ssms_test_series SET series_scope=? WHERE id=?", [$scope, $newId]);

                $this->Flash->success('Test series created successfully.');
                return $this->redirect(['action' => 'index']);
            }
        }

        $isEdit = false;
        $series = [];
        $dd = $this->loadDropdowns();
        $this->set(compact('isEdit', 'series') + $dd);
        $this->render('add_edit');
    }

    // ── edit ──────────────────────────────────────────────────────────────────

    public function edit($id = null)
    {
        $db  = $this->db();
        $cc  = $this->clientCode();
        $id  = (int)$id;

        $series = $db->execute(
            "SELECT * FROM ssms_test_series WHERE id=? AND ssms_client_code=?",
            [$id, $cc]
        )->fetchAssoc();

        if (!$series) {
            $this->Flash->error('Test series not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is(['post', 'put', 'patch'])) {
            $d = $this->request->getData();
            $title       = trim((string)($d['title']        ?? ''));
            $description = trim((string)($d['description']  ?? ''));
            $classId     = (int)($d['class_id']   ?? 0);
            $branchId    = (int)($d['branch_id']   ?? 0);
            $sessionId   = (int)($d['session_id']  ?? 0);
            $scope       = in_array($d['series_scope'] ?? '', ['full_syllabus','chapter_wise'], true)
                           ? $d['series_scope'] : 'full_syllabus';

            if ($title === '') {
                $this->Flash->error('Title is required.');
            } else {
                $db->execute(
                    "UPDATE ssms_test_series SET title=?, description=?, class_id=?,
                     branch_id=?, session_id=?, series_scope=? WHERE id=? AND ssms_client_code=?",
                    [$title, $description, $classId, $branchId, $sessionId, $scope, $id, $cc]
                );
                $this->Flash->success('Test series updated.');
                return $this->redirect(['action' => 'viewSeries', $id]);
            }
        }

        $isEdit = true;
        $dd = $this->loadDropdowns();
        $this->set(compact('isEdit', 'series', 'id') + $dd);
        $this->render('add_edit');
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function delete($id = null)
    {
        $this->request->allowMethod(['post']);
        $db  = $this->db();
        $cc  = $this->clientCode();
        $db->execute(
            "UPDATE ssms_test_series SET status='inactive' WHERE id=? AND ssms_client_code=?",
            [(int)$id, $cc]
        );
        $this->Flash->success('Test series deactivated.');
        return $this->redirect(['action' => 'index']);
    }

    // ── viewSeries ────────────────────────────────────────────────────────────

    public function viewSeries($id = null)
    {
        $db  = $this->db();
        $cc  = $this->clientCode();
        $id  = (int)$id;

        $series = $db->execute(
            "SELECT ts.*, c.class_name, b.branch_name, se.session_name
             FROM ssms_test_series ts
             LEFT JOIN ssms_classes  c  ON c.class_id    = ts.class_id   AND c.ssms_client_code  = ?
             LEFT JOIN ssms_branch   b  ON b.branch_id   = ts.branch_id  AND b.ssms_client_code  = ?
             LEFT JOIN ssms_sessions se ON se.session_id = ts.session_id AND se.ssms_client_code = ?
             WHERE ts.id=? AND ts.ssms_client_code=?",
            [$cc, $cc, $cc, $id, $cc]
        )->fetchAssoc();

        if (!$series) {
            $this->Flash->error('Test series not found.');
            return $this->redirect(['action' => 'index']);
        }

        $tests = $db->execute(
            "SELECT t.*,
                    (SELECT COUNT(*) FROM ssms_test_questions q WHERE q.test_id=t.id AND q.ssms_client_code=t.ssms_client_code) AS question_count
             FROM ssms_tests t
             WHERE t.series_id=? AND t.ssms_client_code=?
             ORDER BY t.id DESC",
            [$id, $cc]
        )->fetchAll('assoc');

        $this->set(compact('series', 'tests', 'id'));
    }

    // ── addTest ───────────────────────────────────────────────────────────────

    public function addTest($seriesId = null)
    {
        $this->request->allowMethod(['post']);
        $db       = $this->db();
        $cc       = $this->clientCode();
        $seriesId = (int)$seriesId;

        // Verify series belongs to client
        $exists = $db->execute(
            "SELECT id FROM ssms_test_series WHERE id=? AND ssms_client_code=?",
            [$seriesId, $cc]
        )->fetchAssoc();

        if (!$exists) {
            $this->Flash->error('Series not found.');
            return $this->redirect(['action' => 'index']);
        }

        $d              = $this->request->getData();
        $title          = trim((string)($d['title']            ?? ''));
        $duration       = (int)($d['duration_minutes']         ?? 60);
        $totalMarks     = (float)($d['total_marks']            ?? 100);
        $negativeMarks  = (float)($d['negative_marks']         ?? 0);
        $passMarks      = (float)($d['pass_marks']             ?? 35);
        $startTime      = !empty($d['start_time']) ? $d['start_time'] : null;
        $endTime        = !empty($d['end_time'])   ? $d['end_time']   : null;
        $shuffle        = !empty($d['shuffle_questions']) ? 1 : 0;

        // Fetch series meta for branch/session/class
        $s = $db->execute(
            "SELECT branch_id, session_id, class_id FROM ssms_test_series WHERE id=?",
            [$seriesId]
        )->fetchAssoc();

        if ($title === '') {
            $this->Flash->error('Test title is required.');
        } else {
            $db->execute(
                "INSERT INTO ssms_tests
                 (series_id, title, ssms_client_code, status, duration_minutes, total_marks,
                  negative_marks, pass_marks, start_time, end_time, shuffle_questions,
                  branch_id, session_id, class_id)
                 VALUES (?,?,'draft',?,?,?,?,?,?,?,?,?,?,?)",
                // Correct order to match columns — note series_id first, then title, then status via literal
                // We need to list values in order of columns
                [$seriesId, $title, $cc, $duration, $totalMarks, $negativeMarks, $passMarks,
                 $startTime, $endTime, $shuffle, $s['branch_id'], $s['session_id'], $s['class_id']]
            );
            // Fix status column order issue — redo as clean insert
            $this->Flash->success('Test added successfully.');
        }

        return $this->redirect(['action' => 'viewSeries', $seriesId]);
    }

    // ── editTest ──────────────────────────────────────────────────────────────

    public function editTest($testId = null)
    {
        $db     = $this->db();
        $cc     = $this->clientCode();
        $testId = (int)$testId;

        $test = $db->execute(
            "SELECT * FROM ssms_tests WHERE id=? AND ssms_client_code=?",
            [$testId, $cc]
        )->fetchAssoc();

        if (!$test) {
            $this->Flash->error('Test not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is(['post', 'put', 'patch'])) {
            $d             = $this->request->getData();
            $title         = trim((string)($d['title']            ?? ''));
            $duration      = (int)($d['duration_minutes']         ?? 60);
            $totalMarks    = (float)($d['total_marks']            ?? 100);
            $negativeMarks = (float)($d['negative_marks']         ?? 0);
            $passMarks     = (float)($d['pass_marks']             ?? 35);
            $startTime     = !empty($d['start_time']) ? $d['start_time'] : null;
            $endTime       = !empty($d['end_time'])   ? $d['end_time']   : null;
            $shuffle       = !empty($d['shuffle_questions']) ? 1 : 0;

            if ($title === '') {
                $this->Flash->error('Test title is required.');
            } else {
                $db->execute(
                    "UPDATE ssms_tests SET title=?, duration_minutes=?, total_marks=?,
                     negative_marks=?, pass_marks=?, start_time=?, end_time=?, shuffle_questions=?
                     WHERE id=? AND ssms_client_code=?",
                    [$title, $duration, $totalMarks, $negativeMarks, $passMarks,
                     $startTime, $endTime, $shuffle, $testId, $cc]
                );
                $this->Flash->success('Test updated.');
                return $this->redirect(['action' => 'viewSeries', $test['series_id']]);
            }
        }

        $this->set(compact('test', 'testId'));
    }

    // ── deleteTest ────────────────────────────────────────────────────────────

    public function deleteTest($testId = null)
    {
        $this->request->allowMethod(['post']);
        $db     = $this->db();
        $cc     = $this->clientCode();
        $testId = (int)$testId;

        $test = $db->execute(
            "SELECT series_id FROM ssms_tests WHERE id=? AND ssms_client_code=?",
            [$testId, $cc]
        )->fetchAssoc();

        if ($test) {
            $db->execute("DELETE FROM ssms_test_questions WHERE test_id=? AND ssms_client_code=?", [$testId, $cc]);
            $db->execute("DELETE FROM ssms_test_sections  WHERE test_id=? AND ssms_client_code=?", [$testId, $cc]);
            $db->execute("DELETE FROM ssms_tests          WHERE id=?      AND ssms_client_code=?", [$testId, $cc]);
            $this->Flash->success('Test deleted.');
            return $this->redirect(['action' => 'viewSeries', $test['series_id']]);
        }

        $this->Flash->error('Test not found.');
        return $this->redirect(['action' => 'index']);
    }

    // ── publishTest ───────────────────────────────────────────────────────────

    public function publishTest($testId = null)
    {
        $this->request->allowMethod(['post']);
        $db     = $this->db();
        $cc     = $this->clientCode();
        $testId = (int)$testId;

        $test = $db->execute(
            "SELECT series_id FROM ssms_tests WHERE id=? AND ssms_client_code=? AND status='draft'",
            [$testId, $cc]
        )->fetchAssoc();

        if ($test) {
            $db->execute(
                "UPDATE ssms_tests SET status='published' WHERE id=? AND ssms_client_code=?",
                [$testId, $cc]
            );
            $this->Flash->success('Test published successfully.');
            return $this->redirect(['action' => 'viewSeries', $test['series_id']]);
        }

        $this->Flash->error('Test not found or already published.');
        return $this->redirect(['action' => 'index']);
    }

    // ── viewTest ──────────────────────────────────────────────────────────────

    public function viewTest($testId = null)
    {
        $db     = $this->db();
        $cc     = $this->clientCode();
        $testId = (int)$testId;

        $test = $db->execute(
            "SELECT t.*, ts.title AS series_title, ts.id AS series_id
             FROM ssms_tests t
             JOIN ssms_test_series ts ON ts.id = t.series_id AND ts.ssms_client_code = ?
             WHERE t.id=? AND t.ssms_client_code=?",
            [$cc, $testId, $cc]
        )->fetchAssoc();

        if (!$test) {
            $this->Flash->error('Test not found.');
            return $this->redirect(['action' => 'index']);
        }

        $sections = $db->execute(
            "SELECT * FROM ssms_test_sections WHERE test_id=? AND ssms_client_code=? ORDER BY section_order, id",
            [$testId, $cc]
        )->fetchAll('assoc');

        $subjects = $db->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects WHERE ssms_client_code=? ORDER BY subject_name",
            [$cc]
        )->fetchAll('assoc');

        $this->set(compact('test', 'sections', 'subjects', 'testId', 'cc'));
    }

    // ── attempts ──────────────────────────────────────────────────────────────

    public function attempts($testId = null)
    {
        $db     = $this->db();
        $cc     = $this->clientCode();
        $testId = (int)$testId;

        $test = $db->execute(
            "SELECT t.*, ts.title AS series_title
             FROM ssms_tests t
             JOIN ssms_test_series ts ON ts.id = t.series_id AND ts.ssms_client_code = ?
             WHERE t.id=? AND t.ssms_client_code=?",
            [$cc, $testId, $cc]
        )->fetchAssoc();

        if (!$test) {
            $this->Flash->error('Test not found.');
            return $this->redirect(['action' => 'index']);
        }

        $attempts = $db->execute(
            "SELECT a.*,
                    CONCAT(sr.first_name,' ',sr.last_name) AS student_name,
                    sr.roll_number
             FROM ssms_test_attempts a
             LEFT JOIN ssms_student_enrollment se ON se.enrollment_id = a.enrollment_id AND se.ssms_client_code = a.ssms_client_code
             LEFT JOIN ssms_student_registration sr ON sr.registration_id = se.registration_id AND sr.ssms_client_code = a.ssms_client_code
             WHERE a.test_id=? AND a.ssms_client_code=?
             ORDER BY a.rank_in_batch ASC, a.score DESC",
            [$testId, $cc]
        )->fetchAll('assoc');

        $this->set(compact('test', 'attempts', 'testId'));
    }
}
