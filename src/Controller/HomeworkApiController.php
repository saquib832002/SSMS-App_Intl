<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * HomeworkApiController
 *
 * Daily homework / task management with per-student completion tracking.
 * Teachers assign tasks to a class (optionally a section and/or subject).
 * Students and parents can view tasks and their individual status/remarks.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SQL — run once in MySQL:
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * CREATE TABLE IF NOT EXISTS ssms_homework (
 *   id               INT AUTO_INCREMENT PRIMARY KEY,
 *   ssms_client_code VARCHAR(50)  NOT NULL,
 *   session_id       INT          NOT NULL,
 *   branch_id        INT          NULL,
 *   class_id         INT          NOT NULL,
 *   section_id       INT          NULL,            -- NULL = all sections
 *   subject_id       INT          NULL,            -- NULL = not subject-specific
 *   subject_name     VARCHAR(100) NULL,
 *   teacher_id       INT          NOT NULL,
 *   title            VARCHAR(255) NOT NULL,
 *   description      TEXT         NULL,
 *   assigned_date    DATE         NOT NULL,
 *   due_date         DATE         NOT NULL,
 *   status           ENUM('active','closed') NOT NULL DEFAULT 'active',
 *   created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *   updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   INDEX idx_client_session_class_date (ssms_client_code, session_id, class_id, assigned_date),
 *   INDEX idx_teacher (teacher_id),
 *   INDEX idx_branch (branch_id)
 * );
 *
 * CREATE TABLE IF NOT EXISTS ssms_homework_students (
 *   id                    INT AUTO_INCREMENT PRIMARY KEY,
 *   homework_id           INT          NOT NULL,
 *   enrollment_id         VARCHAR(50)  NOT NULL,   -- VARCHAR to match ssms_student_enrollment.enrollment_id
 *   ssms_client_code      VARCHAR(50)  NOT NULL,
 *   completion_status     ENUM('pending','submitted','completed','incomplete') NOT NULL DEFAULT 'pending',
 *   completion_percentage TINYINT UNSIGNED NULL,   -- 0–100
 *   teacher_remarks       TEXT         NULL,
 *   marked_by             INT          NULL,       -- teacher's user ID
 *   marked_at             DATETIME     NULL,
 *   created_at            DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *   updated_at            DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   UNIQUE KEY uq_hw_student (homework_id, enrollment_id),
 *   INDEX idx_enrollment (enrollment_id, ssms_client_code)
 * );
 *
 * ── If the table already exists with enrollment_id INT, run this migration: ──
 *   ALTER TABLE ssms_homework_students MODIFY enrollment_id VARCHAR(50) NOT NULL;
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Routes — add to config/routes.php inside the JWT-authenticated scope:
 * ───────────────────────────────────────────────────────────────────────────────
 *   $builder->post('/HomeworkApi/create',        ['controller'=>'HomeworkApi','action'=>'create']);
 *   $builder->get('/HomeworkApi/list',            ['controller'=>'HomeworkApi','action'=>'listHomework']);
 *   $builder->get('/HomeworkApi/detail/:id',      ['controller'=>'HomeworkApi','action'=>'detail'])->setPass(['id']);
 *   $builder->post('/HomeworkApi/markStudent',    ['controller'=>'HomeworkApi','action'=>'markStudent']);
 *   $builder->post('/HomeworkApi/markStudents',   ['controller'=>'HomeworkApi','action'=>'markStudents']);
 *   $builder->get('/HomeworkApi/studentView',     ['controller'=>'HomeworkApi','action'=>'studentView']);
 *   $builder->put('/HomeworkApi/update/:id',      ['controller'=>'HomeworkApi','action'=>'update'])->setPass(['id']);
 *   $builder->post('/HomeworkApi/update/:id',     ['controller'=>'HomeworkApi','action'=>'update'])->setPass(['id']);
 *   $builder->delete('/HomeworkApi/delete/:id',   ['controller'=>'HomeworkApi','action'=>'delete'])->setPass(['id']);
 *   $builder->post('/HomeworkApi/delete/:id',     ['controller'=>'HomeworkApi','action'=>'delete'])->setPass(['id']);
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Endpoint summary:
 * ───────────────────────────────────────────────────────────────────────────────
 *   POST   /HomeworkApi/create          — teacher creates homework
 *   GET    /HomeworkApi/list            — list homework (filters: classId, sectionId, teacherId, date / fromDate+toDate)
 *   GET    /HomeworkApi/detail/:id      — homework + all enrolled students + their submission status (query: sessionId)
 *   POST   /HomeworkApi/markStudent     — mark/update one student's status
 *   POST   /HomeworkApi/markStudents    — bulk mark multiple students at once
 *   GET    /HomeworkApi/studentView     — student/parent: homework for a given date (query: enrollmentId, date)
 *   PUT    /HomeworkApi/update/:id      — update homework title / description / dueDate / status
 *   DELETE /HomeworkApi/delete/:id      — delete homework and all its student records
 */
class HomeworkApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->autoRender = false;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

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
        $this->response = $this->response
            ->withType('application/json')
            ->withStatus($status)
            ->withStringBody(json_encode($payload));
    }

    // ─── 1. Create homework ───────────────────────────────────────────────────
    /**
     * POST /HomeworkApi/create
     *
     * Body (JSON or form-data):
     *   sessionId     int      required
     *   classId       int      required
     *   teacherId     int      required
     *   title         string   required
     *   branchId      int      optional
     *   sectionId     int      optional — omit for all sections
     *   subjectId     int      optional
     *   subjectName   string   optional
     *   description   string   optional
     *   assignedDate  date     optional — defaults to today (YYYY-MM-DD)
     *   dueDate       date     optional — defaults to assignedDate
     */
    public function create(): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->clientCode();
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];

        $sessionId   = (int)($d['sessionId'] ?? 0);
        $classId     = (int)($d['classId']   ?? 0);
        // Fall back to the JWT-authenticated user ID if client didn't send teacherId
        $jwtUser     = (int)($this->request->getAttribute('jwt_user') ?? 0);
        $teacherId   = (int)($d['teacherId'] ?? 0) ?: $jwtUser;
        $title       = trim((string)($d['title'] ?? ''));
        $branchId    = !empty($d['branchId'])    ? (int)$d['branchId']    : null;
        $sectionId   = !empty($d['sectionId'])   ? (int)$d['sectionId']   : null;
        $subjectId   = !empty($d['subjectId'])   ? (int)$d['subjectId']   : null;
        $subjectName = trim((string)($d['subjectName']  ?? '')) ?: null;
        $description = trim((string)($d['description']  ?? '')) ?: null;
        $assignedDate = trim((string)($d['assignedDate'] ?? date('Y-m-d')));
        $dueDate      = trim((string)($d['dueDate'] ?? $assignedDate));

        if (!$sessionId || !$classId || $title === '') {
            $this->json(['status' => false, 'message' => 'sessionId, classId, and title are required'], 400);
            return;
        }

        try {
            $db = $this->db();
            $db->execute(
                "INSERT INTO ssms_homework
                   (ssms_client_code, session_id, branch_id, class_id, section_id,
                    subject_id, subject_name, teacher_id, title, description,
                    assigned_date, due_date, status)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active')",
                [$clientCode, $sessionId, $branchId, $classId, $sectionId,
                 $subjectId, $subjectName, $teacherId, $title, $description,
                 $assignedDate, $dueDate]
            );
            $newId = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetchAssoc()['id'];

            $this->json([
                'status'     => true,
                'message'    => 'Homework created successfully',
                'homeworkId' => $newId,
            ]);
        } catch (\Exception $e) {
            Log::error('HomeworkApi::create — ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to create homework'], 500);
        }
    }

    // ─── 2. List homework ─────────────────────────────────────────────────────
    /**
     * GET /HomeworkApi/list
     *
     * Query params:
     *   sessionId  int     optional
     *   branchId   int     optional
     *   classId    int     optional
     *   sectionId  int     optional
     *   teacherId  int     optional
     *   date       date    optional — single day shortcut (overrides fromDate/toDate)
     *   fromDate   date    optional — defaults to today
     *   toDate     date    optional — defaults to today
     *
     * Returns homework records with aggregated student completion stats.
     */
    public function listHomework(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->clientCode();

        $sessionId = $this->request->getQuery('sessionId');
        $branchId  = $this->request->getQuery('branchId');
        $classId   = $this->request->getQuery('classId');
        $sectionId = $this->request->getQuery('sectionId');
        $teacherId = $this->request->getQuery('teacherId');
        $date      = $this->request->getQuery('date');
        $fromDate  = $this->request->getQuery('fromDate') ?? date('Y-m-d');
        $toDate    = $this->request->getQuery('toDate')   ?? date('Y-m-d');
        if ($date) { $fromDate = $toDate = $date; }

        try {
            $where  = 'WHERE h.ssms_client_code = ?';
            $params = [$clientCode];

            if ($sessionId) {
                $where   .= ' AND h.session_id = ?';
                $params[] = (int)$sessionId;
            }
            if ($branchId) {
                $where   .= ' AND h.branch_id = ?';
                $params[] = (int)$branchId;
            }
            if ($classId) {
                $where   .= ' AND h.class_id = ?';
                $params[] = (int)$classId;
            }
            if ($sectionId) {
                $where   .= ' AND (h.section_id = ? OR h.section_id IS NULL)';
                $params[] = (int)$sectionId;
            }
            if ($teacherId) {
                $where   .= ' AND h.teacher_id = ?';
                $params[] = (int)$teacherId;
            }
            $where   .= ' AND h.assigned_date BETWEEN ? AND ?';
            $params[] = $fromDate;
            $params[] = $toDate;

            $sql = "
                SELECT
                    h.id,
                    h.session_id      AS sessionId,
                    h.branch_id       AS branchId,
                    h.class_id        AS classId,
                    h.section_id      AS sectionId,
                    h.subject_id      AS subjectId,
                    h.subject_name    AS subjectName,
                    h.teacher_id      AS teacherId,
                    h.title,
                    h.description,
                    h.assigned_date   AS assignedDate,
                    h.due_date        AS dueDate,
                    h.status,
                    c.class_name      AS className,
                    sec.section_name  AS sectionName,
                    COUNT(hs.id)                                      AS totalMarked,
                    SUM(hs.completion_status = 'completed')           AS totalCompleted,
                    SUM(hs.completion_status = 'submitted')           AS totalSubmitted,
                    SUM(hs.completion_status = 'pending')             AS totalPending,
                    SUM(hs.completion_status = 'incomplete')          AS totalIncomplete,
                    ROUND(AVG(hs.completion_percentage), 1)           AS avgCompletionPct
                FROM ssms_homework h
                LEFT JOIN ssms_classes  c   ON c.class_id    = h.class_id
                LEFT JOIN ssms_sections sec ON sec.section_id = h.section_id
                LEFT JOIN ssms_homework_students hs ON hs.homework_id = h.id
                $where
                GROUP BY h.id
                ORDER BY h.assigned_date DESC, h.id DESC";

            $rows = $this->db()->execute($sql, $params)->fetchAll('assoc');
            $this->json(['status' => true, 'data' => $rows ?: []]);
        } catch (\Exception $e) {
            Log::error('HomeworkApi::listHomework — ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch homework list'], 500);
        }
    }

    // ─── 3. Detail + per-student status ──────────────────────────────────────
    /**
     * GET /HomeworkApi/detail/:id
     *
     * Returns the homework record plus every enrolled student in the relevant
     * class/section/session/branch, each with their current submission status and teacher remarks.
     */
    public function detail(string $id): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->clientCode();

        try {
            $db = $this->db();

            // Fetch homework header
            $hw = $db->execute(
                "SELECT h.*, c.class_name, sec.section_name
                 FROM ssms_homework h
                 LEFT JOIN ssms_classes  c   ON c.class_id    = h.class_id
                 LEFT JOIN ssms_sections sec ON sec.section_id = h.section_id
                 WHERE h.id = ? AND h.ssms_client_code = ?
                 LIMIT 1",
                [(int)$id, $clientCode]
            )->fetchAssoc();

            if (!$hw) {
                $this->json(['status' => false, 'message' => 'Homework not found'], 404);
                return;
            }

            // Build enrollment filter — always filter by session_id and branch_id from the homework record
            $secCond  = 'AND e.session_id = ?';
            $eParams  = [(int)$id, $clientCode, (int)$hw['class_id'], (int)$hw['session_id']];
            if ($hw['section_id']) { $secCond .= ' AND e.section_id = ?'; $eParams[] = (int)$hw['section_id']; }
            if ($hw['branch_id'])  { $secCond .= ' AND e.branch_id = ?';  $eParams[] = (int)$hw['branch_id']; }

            $students = $db->execute(
                "SELECT
                    e.enrollment_id       AS enrollmentId,
                    e.registration_id     AS registrationId,
                    e.roll_number         AS rollNumber,
                    e.section_id          AS sectionId,
                    sec.section_name      AS sectionName,
                    r.student_first_name  AS firstName,
                    r.student_middle_name AS middleName,
                    r.student_last_name   AS lastName,
                    r.student_photo       AS photo,
                    COALESCE(hs.completion_status, 'pending') AS completionStatus,
                    hs.completion_percentage                   AS completionPercentage,
                    hs.teacher_remarks                         AS teacherRemarks,
                    hs.marked_at                               AS markedAt
                 FROM ssms_student_enrollment e
                 JOIN ssms_student_registration r  ON r.registration_id = e.registration_id
                 LEFT JOIN ssms_sections sec        ON sec.section_id   = e.section_id
                 LEFT JOIN ssms_homework_students hs
                        ON hs.homework_id = ? AND hs.enrollment_id = e.enrollment_id
                 WHERE e.ssms_client_code = ?
                   AND e.class_id = ?
                   AND e.status = 'active'
                   $secCond
                 ORDER BY e.roll_number, r.student_first_name",
                $eParams
            )->fetchAll('assoc');

            // Summary counts
            $statuses = array_column($students, 'completionStatus');
            $summary  = [
                'total'      => count($students),
                'completed'  => count(array_filter($statuses, fn($s) => $s === 'completed')),
                'submitted'  => count(array_filter($statuses, fn($s) => $s === 'submitted')),
                'incomplete' => count(array_filter($statuses, fn($s) => $s === 'incomplete')),
                'pending'    => count(array_filter($statuses, fn($s) => $s === 'pending')),
                'avgPct'     => count($students) > 0
                    ? round(array_sum(array_filter(array_column($students, 'completionPercentage'), fn($v) => $v !== null))
                            / max(1, count(array_filter(array_column($students, 'completionPercentage'), fn($v) => $v !== null))), 1)
                    : null,
            ];

            $this->json([
                'status'   => true,
                'homework' => $hw,
                'summary'  => $summary,
                'students' => $students ?: [],
            ]);
        } catch (\Exception $e) {
            Log::error('HomeworkApi::detail — ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch homework detail'], 500);
        }
    }

    // ─── 4. Mark single student ───────────────────────────────────────────────
    /**
     * POST /HomeworkApi/markStudent
     *
     * Body:
     *   homeworkId           int     required
     *   enrollmentId         int     required
     *   completionStatus     string  required  — pending | submitted | completed | incomplete
     *   completionPercentage int     optional  — 0–100
     *   teacherRemarks       string  optional
     *   markedBy             int     optional  — teacher's user ID
     *
     * Uses INSERT … ON DUPLICATE KEY UPDATE so calling again updates the record.
     */
    public function markStudent(): void
    {
        $this->request->allowMethod(['post']);
        $d          = $this->request->getData();
        $clientCode = $this->clientCode();

        $homeworkId   = (int)($d['homeworkId'] ?? 0);
        $enrollmentId = trim((string)($d['enrollmentId'] ?? ''));
        $status       = trim((string)($d['completionStatus'] ?? 'pending'));
        $pct          = isset($d['completionPercentage']) && $d['completionPercentage'] !== ''
                        ? max(0, min(100, (int)$d['completionPercentage'])) : null;
        $remarks      = trim((string)($d['teacherRemarks'] ?? '')) ?: null;
        $markedBy     = !empty($d['markedBy']) ? (int)$d['markedBy'] : null;

        if (!$homeworkId || empty($enrollmentId)) {
            $this->json(['status' => false, 'message' => 'homeworkId and enrollmentId are required'], 400);
            return;
        }

        $allowed = ['pending', 'submitted', 'completed', 'incomplete'];
        if (!in_array($status, $allowed, true)) {
            $this->json(['status' => false, 'message' => "completionStatus must be one of: " . implode(', ', $allowed)], 400);
            return;
        }

        try {
            $this->db()->execute(
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
                [$homeworkId, $enrollmentId, $clientCode, $status, $pct, $remarks, $markedBy]
            );
            $this->json(['status' => true, 'message' => 'Student marked successfully']);
        } catch (\Exception $e) {
            Log::error('HomeworkApi::markStudent — ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to mark student'], 500);
        }
    }

    // ─── 5. Bulk mark students ────────────────────────────────────────────────
    /**
     * POST /HomeworkApi/markStudents
     *
     * Body:
     *   homeworkId  int     required
     *   markedBy    int     optional — teacher's user ID (applied to all)
     *   students    array   required — each item:
     *     { enrollmentId, completionStatus, completionPercentage?, teacherRemarks? }
     *
     * Returns counts of how many succeeded / failed.
     */
    public function markStudents(): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->clientCode();

        // Decode JSON body directly — more reliable than getData() for nested arrays
        $raw = (string)$this->request->getBody();
        $d   = json_decode($raw, true) ?: $this->request->getData() ?: [];

        $homeworkId = (int)($d['homeworkId'] ?? 0);
        $students   = $d['students'] ?? [];
        $markedBy   = !empty($d['markedBy']) ? (int)$d['markedBy'] : null;

        Log::error("markStudents CALLED: homeworkId={$homeworkId} studentCount=" . count($students) . " raw=" . substr($raw, 0, 300));

        if (!$homeworkId || !is_array($students) || empty($students)) {
            Log::error("markStudents VALIDATION FAIL: homeworkId={$homeworkId} isArray=" . (is_array($students)?'yes':'no') . " count=" . count($students));
            $this->json(['status' => false, 'message' => "Validation failed: homeworkId={$homeworkId} students=" . count($students)], 400);
            return;
        }

        $allowed = ['pending', 'submitted', 'completed', 'incomplete'];
        $success = 0;
        $failed  = 0;
        $db      = $this->db();

        foreach ($students as $s) {
            $enrollId = trim((string)($s['enrollmentId'] ?? ''));
            $status   = trim((string)($s['completionStatus'] ?? 'pending'));
            $pct      = isset($s['completionPercentage']) && $s['completionPercentage'] !== '' && $s['completionPercentage'] !== null
                        ? max(0, min(100, (int)$s['completionPercentage'])) : null;
            $remarks  = trim((string)($s['teacherRemarks'] ?? '')) ?: null;

            if (empty($enrollId) || !in_array($status, $allowed, true)) {
                Log::error("markStudents SKIP: enrollId={$enrollId} status={$status}");
                $failed++;
                continue;
            }

            try {
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
                    [$homeworkId, $enrollId, $clientCode, $status, $pct, $remarks, $markedBy]
                );
                $success++;
            } catch (\Exception $e) {
                Log::error("markStudents INSERT FAILED enrollId={$enrollId} status={$status} — " . $e->getMessage());
                $failed++;
            }
        }

        $this->json([
            'status'  => $success > 0 || $failed === 0,
            'message' => "Marked {$success} student(s)" . ($failed ? ", {$failed} skipped/failed" : ''),
            'marked'  => $success,
            'failed'  => $failed,
        ]);
    }

    // ─── 6. Student / parent view ─────────────────────────────────────────────
    /**
     * GET /HomeworkApi/studentView
     *
     * Query params:
     *   enrollmentId  int   required — student's enrollment ID
     *   date          date  optional — filter to a specific assigned_date (YYYY-MM-DD).
     *                                  When omitted, returns all active homework for the
     *                                  class (assigned in the last 60 days and still active).
     *
     * Returns homework for the student's class/section along with individual
     * completion status and teacher remarks from ssms_homework_students.
     */
    public function studentView(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->clientCode();

        // ── Resolve enrollment ID (string, not int — schema uses VARCHAR) ──────
        // Priority: query param → ssmsEnrollmentId header → ssmsUserName header
        // (ssmsUserName == enrollment_id for student/parent accounts in this system)
        $enrollmentId = trim((string)($this->request->getQuery('enrollmentId') ?? ''));
        if ($enrollmentId === '' || $enrollmentId === 'null' || $enrollmentId === 'undefined') {
            $enrollmentId = trim((string)($this->request->getHeaderLine('ssmsEnrollmentId') ?? ''));
        }
        if ($enrollmentId === '') {
            $enrollmentId = trim((string)($this->request->getHeaderLine('ssmsUserName') ?? ''));
        }

        // ── Date filter ────────────────────────────────────────────────────────
        $date = trim((string)($this->request->getQuery('date') ?? ''));
        if ($date === 'null' || $date === 'undefined' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = '';
        }

        if ($enrollmentId === '') {
            $this->json(['status' => false, 'message' => 'enrollmentId is required'], 400);
            return;
        }

        try {
            $db = $this->db();

            // Look up the enrollment to get session_id, branch_id, class_id, section_id
            $enrol = $db->execute(
                "SELECT e.session_id, e.branch_id, e.class_id, e.section_id
                 FROM ssms_student_enrollment e
                 WHERE e.enrollment_id = ? AND e.ssms_client_code = ? AND e.status = 'active'
                 LIMIT 1",
                [$enrollmentId, $clientCode]
            )->fetch('assoc');

            if (!$enrol) {
                $this->json(['status' => false, 'message' => 'No active enrollment found'], 404);
                return;
            }

            $sessionId = (int)$enrol['session_id'];
            $branchId  = $enrol['branch_id']  ? (int)$enrol['branch_id']  : null;
            $classId   = (int)$enrol['class_id'];
            $sectionId = $enrol['section_id'] ? (int)$enrol['section_id'] : null;

            // Match homework for this session/class; section matches either exact or class-wide (NULL)
            $secCond    = $sectionId ? "AND (h.section_id = {$sectionId} OR h.section_id IS NULL)" : '';
            $branchCond = $branchId  ? "AND (h.branch_id = {$branchId}   OR h.branch_id IS NULL)"  : '';

            // Date filter: exact day when provided; otherwise last 60 days of active homework
            if ($date !== '') {
                $dateCond   = 'AND h.assigned_date = ?';
                $dateParams = [$date];
            } else {
                $dateCond   = 'AND h.assigned_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)';
                $dateParams = [];
            }

            $homework = $db->execute(
                "SELECT
                    h.id,
                    h.title,
                    h.description,
                    h.subject_id    AS subjectId,
                    h.subject_name  AS subjectName,
                    h.assigned_date AS assignedDate,
                    h.due_date      AS dueDate,
                    h.status        AS homeworkStatus,
                    COALESCE(hs.completion_status, 'pending') AS completionStatus,
                    hs.completion_percentage                   AS completionPercentage,
                    hs.teacher_remarks                         AS teacherRemarks,
                    hs.marked_at                               AS markedAt
                 FROM ssms_homework h
                 LEFT JOIN ssms_homework_students hs
                        ON hs.homework_id = h.id AND hs.enrollment_id = ?
                 WHERE h.ssms_client_code = ?
                   AND h.session_id = ?
                   AND h.class_id = ?
                   AND h.status = 'active'
                   $dateCond
                   $secCond
                   $branchCond
                 ORDER BY h.due_date ASC, h.id ASC",
                array_merge([$enrollmentId, $clientCode, $sessionId, $classId], $dateParams)
            )->fetchAll('assoc');

            $this->json([
                'status' => true,
                'date'   => $date,
                'data'   => $homework ?: [],
            ]);
        } catch (\Exception $e) {
            Log::error('HomeworkApi::studentView — ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to fetch student homework'], 500);
        }
    }

    // ─── 7. Update homework ───────────────────────────────────────────────────
    /**
     * PUT /HomeworkApi/update/:id   (also accepts POST for mobile clients)
     *
     * Body (any subset):
     *   title        string
     *   description  string
     *   dueDate      date
     *   status       string  — active | closed
     */
    public function update(string $id): void
    {
        $this->request->allowMethod(['put', 'post']);
        $d          = $this->request->getData();
        $clientCode = $this->clientCode();

        $sets   = [];
        $params = [];

        if (array_key_exists('title', $d)) {
            $sets[]   = 'title = ?';
            $params[] = trim((string)$d['title']);
        }
        if (array_key_exists('description', $d)) {
            $sets[]   = 'description = ?';
            $params[] = trim((string)$d['description']) ?: null;
        }
        if (array_key_exists('dueDate', $d)) {
            $sets[]   = 'due_date = ?';
            $params[] = $d['dueDate'];
        }
        if (array_key_exists('status', $d) && in_array($d['status'], ['active', 'closed'], true)) {
            $sets[]   = 'status = ?';
            $params[] = $d['status'];
        }

        if (empty($sets)) {
            $this->json(['status' => false, 'message' => 'Nothing to update — provide title, description, dueDate, or status'], 400);
            return;
        }

        $params[] = (int)$id;
        $params[] = $clientCode;

        try {
            $this->db()->execute(
                'UPDATE ssms_homework SET ' . implode(', ', $sets) . ' WHERE id = ? AND ssms_client_code = ?',
                $params
            );
            $this->json(['status' => true, 'message' => 'Homework updated successfully']);
        } catch (\Exception $e) {
            Log::error('HomeworkApi::update — ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to update homework'], 500);
        }
    }

    // ─── 8. Delete homework ───────────────────────────────────────────────────
    /**
     * DELETE /HomeworkApi/delete/:id   (also accepts POST for mobile clients)
     *
     * Deletes the homework record and all associated student submission records.
     */
    public function delete(string $id): void
    {
        $this->request->allowMethod(['delete', 'post']);
        $clientCode = $this->clientCode();

        try {
            $db = $this->db();
            // Verify ownership before deleting
            $hw = $db->execute(
                'SELECT id FROM ssms_homework WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                [(int)$id, $clientCode]
            )->fetchAssoc();

            if (!$hw) {
                $this->json(['status' => false, 'message' => 'Homework not found'], 404);
                return;
            }

            $db->execute('DELETE FROM ssms_homework_students WHERE homework_id = ?', [(int)$id]);
            $db->execute('DELETE FROM ssms_homework WHERE id = ?', [(int)$id]);

            $this->json(['status' => true, 'message' => 'Homework deleted successfully']);
        } catch (\Exception $e) {
            Log::error('HomeworkApi::delete — ' . $e->getMessage());
            $this->json(['status' => false, 'message' => 'Failed to delete homework'], 500);
        }
    }
}
