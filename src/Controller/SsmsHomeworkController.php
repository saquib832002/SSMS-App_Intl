<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsHomeworkController
 * Web UI for homework/task management.
 * Mirrors the mobile app HomeworkCreateScreen / HomeworkMarkScreen / HomeworkStudentScreen.
 */
class SsmsHomeworkController extends AppController
{
    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function session(): \Cake\Http\Session
    {
        return $this->request->getSession();
    }

    // ── index: list homework ──────────────────────────────────────────────────
    public function index()
    {
        $session    = $this->session();
        $clientCode = $session->read('ssms_client_code');
        $role       = strtolower((string)$session->read('ssms_user_role'));
        $staffId    = (int)$session->read('staff_id');
        $branchId   = $session->read('branch_id');

        // Filters from GET
        $filterClass   = $this->request->getQuery('class_id');
        $filterSection = $this->request->getQuery('section_id');
        $filterFrom    = $this->request->getQuery('from') ?? date('Y-m-01');
        $filterTo      = $this->request->getQuery('to')   ?? date('Y-m-d');

        $db     = $this->db();
        $where  = 'WHERE h.ssms_client_code = ?';
        $params = [$clientCode];

        // Teachers see only their own homework
        if ($role === 'teacher' && $staffId) {
            $where   .= ' AND h.teacher_id = ?';
            $params[] = $staffId;
        }

        if ($filterClass) {
            $where   .= ' AND h.class_id = ?';
            $params[] = (int)$filterClass;
        }
        if ($filterSection) {
            $where   .= ' AND (h.section_id = ? OR h.section_id IS NULL)';
            $params[] = (int)$filterSection;
        }
        $where   .= ' AND h.assigned_date BETWEEN ? AND ?';
        $params[] = $filterFrom;
        $params[] = $filterTo;

        $homeworkList = $db->execute(
            "SELECT h.*,
                    c.class_name,
                    sec.section_name,
                    COUNT(hs.id)                                 AS total_marked,
                    SUM(hs.completion_status = 'completed')      AS total_completed,
                    SUM(hs.completion_status = 'submitted')      AS total_submitted,
                    SUM(hs.completion_status = 'pending')        AS total_pending,
                    SUM(hs.completion_status = 'incomplete')     AS total_incomplete
             FROM ssms_homework h
             LEFT JOIN ssms_classes  c   ON c.class_id    = h.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = h.section_id
             LEFT JOIN ssms_homework_students hs ON hs.homework_id = h.id
             $where
             GROUP BY h.id
             ORDER BY h.assigned_date DESC, h.id DESC",
            $params
        )->fetchAll('assoc');

        // For filter dropdowns
        $classes = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code = ? ORDER BY class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $sections = $filterClass
            ? $db->execute(
                "SELECT section_id, section_name FROM ssms_sections WHERE class_id = ? AND ssms_client_code = ? ORDER BY section_name",
                [(int)$filterClass, $clientCode]
            )->fetchAll('assoc')
            : [];

        $this->set(compact('homeworkList', 'classes', 'sections', 'filterClass', 'filterSection', 'filterFrom', 'filterTo', 'role'));
    }

    // ── add: create new homework ──────────────────────────────────────────────
    public function add()
    {
        $session    = $this->session();
        $clientCode = $session->read('ssms_client_code');
        $staffId    = (int)$session->read('staff_id');
        $branchId   = $session->read('branch_id');
        $db         = $this->db();

        if ($this->request->is('post')) {
            $d = $this->request->getData();

            $sessionId   = (int)($d['session_id'] ?? 0);
            $classId     = (int)($d['class_id']   ?? 0);
            $sectionId   = !empty($d['section_id'])  ? (int)$d['section_id']  : null;
            $subjectId   = !empty($d['subject_id'])  ? (int)$d['subject_id']  : null;
            $subjectName = trim((string)($d['subject_name'] ?? '')) ?: null;
            $title       = trim((string)($d['title'] ?? ''));
            $description = trim((string)($d['description'] ?? '')) ?: null;
            $assignedDate = $d['assigned_date'] ?? date('Y-m-d');
            $dueDate      = $d['due_date'] ?? $assignedDate;
            $teacherId    = $staffId ?: (int)($d['teacher_id'] ?? 0);
            $branchIdVal  = $branchId ? (int)$branchId : null;

            if (!$sessionId || !$classId || $title === '') {
                $this->Flash->error('Session, Class, and Title are required.');
            } else {
                $db->execute(
                    "INSERT INTO ssms_homework
                       (ssms_client_code, session_id, branch_id, class_id, section_id,
                        subject_id, subject_name, teacher_id, title, description,
                        assigned_date, due_date, status)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active')",
                    [$clientCode, $sessionId, $branchIdVal, $classId, $sectionId,
                     $subjectId, $subjectName, $teacherId, $title, $description,
                     $assignedDate, $dueDate]
                );
                $this->Flash->success('Homework assigned successfully.');
                return $this->redirect(['action' => 'index']);
            }
        }

        // Dropdowns
        $sessions = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code = ? ORDER BY session_id DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $classes = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code = ? ORDER BY class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact('sessions', 'classes'));
    }

    // ── markStudents: view + update per-student completion ────────────────────
    public function markStudents(int $id): void
    {
        $session    = $this->session();
        $clientCode = $session->read('ssms_client_code');
        $staffId    = (int)$session->read('staff_id');
        $db         = $this->db();

        // Fetch homework header
        $hw = $db->execute(
            "SELECT h.*, c.class_name, sec.section_name
             FROM ssms_homework h
             LEFT JOIN ssms_classes  c   ON c.class_id    = h.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = h.section_id
             WHERE h.id = ? AND h.ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$hw) {
            $this->Flash->error('Homework not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is('post')) {
            $studentData = $this->request->getData('students') ?? [];
            $saved = 0;
            foreach ($studentData as $enrollId => $vals) {
                $status  = $vals['status'] ?? 'pending';
                $pct     = isset($vals['pct']) && $vals['pct'] !== '' ? max(0, min(100, (int)$vals['pct'])) : null;
                $remarks = trim((string)($vals['remarks'] ?? '')) ?: null;
                $db->execute(
                    "INSERT INTO ssms_homework_students
                       (homework_id, enrollment_id, ssms_client_code,
                        completion_status, completion_percentage, teacher_remarks, marked_by, marked_at)
                     VALUES (?,?,?,?,?,?,?,NOW())
                     ON DUPLICATE KEY UPDATE
                       completion_status     = VALUES(completion_status),
                       completion_percentage = VALUES(completion_percentage),
                       teacher_remarks       = VALUES(teacher_remarks),
                       marked_by             = VALUES(marked_by),
                       marked_at             = NOW()",
                    [$id, $enrollId, $clientCode, $status, $pct, $remarks, $staffId]
                );
                $saved++;
            }
            $this->Flash->success("Saved marks for {$saved} student(s).");
            return $this->redirect(['action' => 'markStudents', $id]);
        }

        // Build enrollment filter
        $secCond  = '';
        $eParams  = [$clientCode, (int)$hw['class_id'], (int)$hw['session_id']];
        if ($hw['section_id']) { $secCond .= ' AND e.section_id = ?'; $eParams[] = (int)$hw['section_id']; }
        if ($hw['branch_id'])  { $secCond .= ' AND e.branch_id = ?';  $eParams[] = (int)$hw['branch_id']; }

        $students = $db->execute(
            "SELECT
                e.enrollment_id,
                e.roll_number,
                sec.section_name,
                r.student_first_name,
                r.student_last_name,
                COALESCE(hs.completion_status, 'pending')   AS completion_status,
                hs.completion_percentage,
                hs.teacher_remarks
             FROM ssms_student_enrollment e
             JOIN ssms_student_registration r   ON r.registration_id = e.registration_id
             LEFT JOIN ssms_sections sec        ON sec.section_id    = e.section_id
             LEFT JOIN ssms_homework_students hs
                    ON hs.homework_id = ? AND hs.enrollment_id = e.enrollment_id
             WHERE e.ssms_client_code = ?
               AND e.class_id = ?
               AND e.session_id = ?
               AND e.status = 'active'
               $secCond
             ORDER BY e.roll_number, r.student_first_name",
            array_merge([$id], $eParams)
        )->fetchAll('assoc');

        $this->set(compact('hw', 'students'));
    }

    // ── close: toggle status ──────────────────────────────────────────────────
    public function close(int $id): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->session()->read('ssms_client_code');
        $db         = $this->db();

        $hw = $db->execute(
            "SELECT id, status FROM ssms_homework WHERE id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();

        if ($hw) {
            $newStatus = ($hw['status'] === 'active') ? 'closed' : 'active';
            $db->execute("UPDATE ssms_homework SET status = ? WHERE id = ?", [$newStatus, $id]);
            $this->Flash->success("Homework marked as {$newStatus}.");
        }

        return $this->redirect(['action' => 'index']);
    }

    // ── delete: remove homework and student records ───────────────────────────
    public function delete(int $id): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->session()->read('ssms_client_code');
        $db         = $this->db();

        $hw = $db->execute(
            "SELECT id FROM ssms_homework WHERE id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();

        if ($hw) {
            $db->execute("DELETE FROM ssms_homework_students WHERE homework_id = ?", [$id]);
            $db->execute("DELETE FROM ssms_homework WHERE id = ?", [$id]);
            $this->Flash->success('Homework deleted.');
        }

        return $this->redirect(['action' => 'index']);
    }
}
