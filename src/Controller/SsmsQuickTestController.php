<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsQuickTestController
 * Mirrors QuickTestSetupScreen — pick exam + class + section,
 * set per-subject max marks (theory / internal / practical / total),
 * then jump to marks entry.
 *
 * Uses: ssms_max_marks  (same table as SsmsMaxMarksController)
 */
class SsmsQuickTestController extends AppController
{
    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    // ── index — the combined setup page ──────────────────────────────────────
    public function index()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $db         = $this->db();

        // ── Dropdowns ─────────────────────────────────────────────────────
        $ssmsSessions = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=? ORDER BY session_id DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsClasses = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=? ORDER BY class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsBranchList = $db->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=? ORDER BY branch_name",
            [$clientCode]
        )->fetchAll('assoc');

        $ssmsExams = $db->execute(
            "SELECT exam_id, exam_name, exam_category FROM ssms_exams WHERE ssms_client_code=? AND status='Active' ORDER BY exam_name",
            [$clientCode]
        )->fetchAll('assoc');

        // State defaults
        $examId    = null;
        $classId   = null;
        $sectionId = null;
        $sessionId = null;
        $branchId  = null;
        $sections  = [];
        $subjects  = [];
        $maxMarks  = [];
        $loaded    = false;

        // ── POST: load subjects or save max marks ──────────────────────────
        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $examId    = !empty($d['exam_id'])    ? (int)$d['exam_id']    : null;
            $classId   = !empty($d['class_id'])   ? (int)$d['class_id']   : null;
            $sectionId = !empty($d['section_id']) ? (int)$d['section_id'] : null;
            $sessionId = !empty($d['session_id']) ? (int)$d['session_id'] : null;
            $branchId  = !empty($d['branch_id'])  ? (int)$d['branch_id']  : null;

            // ─ Save max marks ─────────────────────────────────────────────
            if (!empty($d['save_marks']) && $examId && $classId) {
                $this->_saveMaxMarks($db, $d['subjects'] ?? [], $examId, $classId, $clientCode);
                // Redirect to marks entry
                return $this->redirect([
                    'controller' => 'SsmsMarks',
                    'action'     => 'add',
                    '?'          => [
                        'exam_id'    => $examId,
                        'class_id'   => $classId,
                        'section_id' => $sectionId,
                        'session_id' => $sessionId,
                        'branch_id'  => $branchId,
                    ],
                ]);
            }

            // ─ Load subjects + saved max marks ────────────────────────────
            if ($classId) {
                $sections = $db->execute(
                    "SELECT section_id, section_name FROM ssms_sections WHERE class_id=? AND ssms_client_code=? ORDER BY section_name",
                    [$classId, $clientCode]
                )->fetchAll('assoc');

                $subjects = $db->execute(
                    "SELECT cs.class_subject_id, s.subject_id, s.subject_name, cs.subject_code
                     FROM ssms_class_subjects cs
                     JOIN ssms_subjects s ON s.subject_id = cs.subject_id AND s.ssms_client_code = cs.ssms_client_code
                     WHERE cs.class_id=? AND cs.ssms_client_code=?
                     ORDER BY cs.display_order, s.subject_name",
                    [$classId, $clientCode]
                )->fetchAll('assoc');

                // Load saved max marks for this exam + class
                if ($examId) {
                    $savedRows = $db->execute(
                        "SELECT subject_id, theory_max_marks, internal_max_marks, practical_max_marks, max_marks
                         FROM ssms_max_marks
                         WHERE exam_id=? AND class_id=? AND ssms_client_code=?",
                        [$examId, $classId, $clientCode]
                    )->fetchAll('assoc');
                    foreach ($savedRows as $r) {
                        $maxMarks[$r['subject_id']] = $r;
                    }
                }
                $loaded = true;
            }

        // ── GET: restore state from query params ───────────────────────────
        } else {
            $q         = $this->request->getQueryParams();
            $examId    = !empty($q['exam_id'])    ? (int)$q['exam_id']    : null;
            $classId   = !empty($q['class_id'])   ? (int)$q['class_id']   : null;
            $sectionId = !empty($q['section_id']) ? (int)$q['section_id'] : null;
            $sessionId = !empty($q['session_id']) ? (int)$q['session_id'] : null;
            $branchId  = !empty($q['branch_id'])  ? (int)$q['branch_id']  : null;

            if ($classId) {
                $sections = $db->execute(
                    "SELECT section_id, section_name FROM ssms_sections WHERE class_id=? AND ssms_client_code=? ORDER BY section_name",
                    [$classId, $clientCode]
                )->fetchAll('assoc');

                $subjects = $db->execute(
                    "SELECT cs.class_subject_id, s.subject_id, s.subject_name, cs.subject_code
                     FROM ssms_class_subjects cs
                     JOIN ssms_subjects s ON s.subject_id = cs.subject_id AND s.ssms_client_code = cs.ssms_client_code
                     WHERE cs.class_id=? AND cs.ssms_client_code=?
                     ORDER BY cs.display_order, s.subject_name",
                    [$classId, $clientCode]
                )->fetchAll('assoc');

                if ($examId) {
                    $savedRows = $db->execute(
                        "SELECT subject_id, theory_max_marks, internal_max_marks, practical_max_marks, max_marks
                         FROM ssms_max_marks
                         WHERE exam_id=? AND class_id=? AND ssms_client_code=?",
                        [$examId, $classId, $clientCode]
                    )->fetchAll('assoc');
                    foreach ($savedRows as $r) {
                        $maxMarks[$r['subject_id']] = $r;
                    }
                }
                $loaded = true;
            }
        }

        $this->set(compact(
            'ssmsSessions', 'ssmsClasses', 'ssmsBranchList', 'ssmsExams',
            'sections', 'subjects', 'maxMarks',
            'examId', 'classId', 'sectionId', 'sessionId', 'branchId',
            'loaded'
        ));
    }

    // ── AJAX: sections for a class ────────────────────────────────────────────
    public function getSections()
    {
        $this->request->allowMethod(['get']);
        $this->viewBuilder()->setClassName('Json');
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $classId    = $this->request->getQuery('class_id');

        $sections = $this->db()->execute(
            "SELECT section_id, section_name FROM ssms_sections WHERE class_id=? AND ssms_client_code=? ORDER BY section_name",
            [(int)$classId, $clientCode]
        )->fetchAll('assoc');

        $this->set(compact('sections'));
        $this->viewBuilder()->setOption('serialize', ['sections']);
    }

    // ── Private: upsert max marks ─────────────────────────────────────────────
    private function _saveMaxMarks($db, array $subjectsPost, int $examId, int $classId, string $clientCode): void
    {
        $db->begin();
        try {
            foreach ($subjectsPost as $subjectId => $m) {
                $subjectId   = (int)$subjectId;
                $theory      = isset($m['theory'])    && $m['theory']    !== '' ? (float)$m['theory']    : null;
                $internal    = isset($m['internal'])  && $m['internal']  !== '' ? (float)$m['internal']  : null;
                $practical   = isset($m['practical']) && $m['practical'] !== '' ? (float)$m['practical'] : null;
                $total       = ($theory ?? 0) + ($internal ?? 0) + ($practical ?? 0);
                $maxMarks    = $total > 0 ? $total : null;

                if ($maxMarks === null && $theory === null && $internal === null && $practical === null) {
                    continue; // blank row — skip
                }

                $existing = $db->execute(
                    "SELECT id FROM ssms_max_marks WHERE exam_id=? AND subject_id=? AND class_id=? AND ssms_client_code=? LIMIT 1",
                    [$examId, $subjectId, $classId, $clientCode]
                )->fetchAssoc();

                if ($existing) {
                    $db->execute(
                        "UPDATE ssms_max_marks SET theory_max_marks=?, internal_max_marks=?, practical_max_marks=?, max_marks=? WHERE id=?",
                        [$theory, $internal, $practical, $maxMarks, $existing['id']]
                    );
                } else {
                    $db->execute(
                        "INSERT INTO ssms_max_marks (exam_id, subject_id, class_id, theory_max_marks, internal_max_marks, practical_max_marks, max_marks, ssms_client_code) VALUES (?,?,?,?,?,?,?,?)",
                        [$examId, $subjectId, $classId, $theory, $internal, $practical, $maxMarks, $clientCode]
                    );
                }
            }
            $db->commit();
            $this->Flash->success('Max marks saved. Now entering student marks.');
        } catch (\Exception $e) {
            $db->rollback();
            Log::error('QuickTest saveMaxMarks: ' . $e->getMessage());
            $this->Flash->error('Save failed: ' . $e->getMessage());
        }
    }
}
