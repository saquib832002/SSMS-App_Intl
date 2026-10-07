<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\AppController;

/**
 * DatesheetApiController
 *
 * Endpoints:
 *   GET  /DatesheetApi/getDatesheet?examId=X&classId=Y&branchId=B&sessionId=S  → admin
 *   POST /DatesheetApi/saveDatesheet                                             → admin upsert
 *   POST /DatesheetApi/togglePublish                                             → admin publish
 *   GET  /DatesheetApi/getMyDatesheet                                            → student/parent
 */
class DatesheetApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function clientCode(): string
    {
        return $this->request->getHeaderLine('ssmsClientCode') ?? '';
    }

    private function ok($data = null): \Psr\Http\Message\ResponseInterface
    {
        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode(['success' => true, 'data' => $data]));
    }

    private function fail(string $msg, int $code = 400): \Psr\Http\Message\ResponseInterface
    {
        return $this->response
            ->withStatus($code)
            ->withType('application/json')
            ->withStringBody(json_encode(['success' => false, 'message' => $msg]));
    }

    // ── GET /DatesheetApi/getDatesheet?examId=X&classId=Y&branchId=B&sessionId=S ─
    // Returns all subjects for the class with their scheduled date/time (if set).
    public function getDatesheet()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->clientCode();
        $examId     = (int)($this->request->getQuery('examId')    ?? 0);
        $classId    = (int)($this->request->getQuery('classId')   ?? 0);
        $branchId   = (int)($this->request->getQuery('branchId')  ?? 0);
        $sessionId  = (int)($this->request->getQuery('sessionId') ?? 0);

        if (!$examId || !$classId) {
            return $this->fail('examId and classId are required.');
        }

        $db = \Cake\Datasource\ConnectionManager::get('default');

        // Get all subjects assigned to this class
        $subjects = $db->execute(
            "SELECT cs.subject_id, s.subject_name, cs.display_order
             FROM ssms_class_subjects cs
             JOIN ssms_subjects s ON s.subject_id = cs.subject_id
             WHERE cs.class_id = ? AND cs.ssms_client_code = ?
             ORDER BY cs.display_order ASC, s.subject_name ASC",
            [$classId, $clientCode]
        )->fetchAll('assoc');

        if (empty($subjects)) {
            return $this->ok([
                'entries'      => [],
                'is_published' => false,
                'exam_id'      => $examId,
                'class_id'     => $classId,
                'branch_id'    => $branchId,
                'session_id'   => $sessionId,
            ]);
        }

        $subjectIds   = array_column($subjects, 'subject_id');
        $placeholders = implode(',', array_fill(0, count($subjectIds), '?'));

        // Fetch existing datesheet rows for this exam + class + branch + session
        $rows = $db->execute(
            "SELECT subject_id, exam_date, start_time, end_time, venue, notes, is_published
             FROM ssms_exam_datesheet
             WHERE ssms_client_code = ? AND exam_id = ? AND class_id = ?
               AND branch_id = ? AND session_id = ?
               AND subject_id IN ($placeholders)",
            array_merge([$clientCode, $examId, $classId, $branchId, $sessionId], $subjectIds)
        )->fetchAll('assoc');

        $rowMap      = [];
        $isPublished = false;
        foreach ($rows as $r) {
            $rowMap[(int)$r['subject_id']] = $r;
            if ((int)$r['is_published'] === 1) $isPublished = true;
        }

        $entries = [];
        foreach ($subjects as $sub) {
            $sid  = (int)$sub['subject_id'];
            $slot = $rowMap[$sid] ?? null;
            $entries[] = [
                'subject_id'   => $sid,
                'subject_name' => $sub['subject_name'],
                'exam_date'    => $slot['exam_date']  ?? null,
                'start_time'   => $slot['start_time'] ?? null,
                'end_time'     => $slot['end_time']   ?? null,
                'venue'        => $slot['venue']      ?? null,
                'notes'        => $slot['notes']      ?? null,
            ];
        }

        return $this->ok([
            'entries'      => $entries,
            'is_published' => $isPublished,
            'exam_id'      => $examId,
            'class_id'     => $classId,
            'branch_id'    => $branchId,
            'session_id'   => $sessionId,
        ]);
    }

    // ── POST /DatesheetApi/saveDatesheet ─────────────────────────────────────
    // Body: { exam_id, class_id, branch_id, session_id,
    //         entries: [{subject_id, exam_date, start_time, end_time, venue, notes}] }
    public function saveDatesheet()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->clientCode();
        $body       = $this->request->getData();

        $examId    = (int)($body['exam_id']    ?? 0);
        $classId   = (int)($body['class_id']   ?? 0);
        $branchId  = (int)($body['branch_id']  ?? 0);
        $sessionId = (int)($body['session_id'] ?? 0);
        $entries   = $body['entries'] ?? [];

        if (!$examId || !$classId || empty($entries)) {
            return $this->fail('exam_id, class_id and entries are required.');
        }

        $db  = \Cake\Datasource\ConnectionManager::get('default');
        $now = date('Y-m-d H:i:s');

        foreach ($entries as $entry) {
            $subjectId = (int)($entry['subject_id'] ?? 0);
            $examDate  = $entry['exam_date']  ?? null;
            if (!$subjectId || !$examDate) continue;

            $startTime = $entry['start_time'] ?? null;
            $endTime   = $entry['end_time']   ?? null;
            $venue     = $entry['venue']      ?? null;
            $notes     = $entry['notes']      ?? null;

            $db->execute(
                "INSERT INTO ssms_exam_datesheet
                    (ssms_client_code, branch_id, session_id, exam_id, class_id, subject_id,
                     exam_date, start_time, end_time, venue, notes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    exam_date  = VALUES(exam_date),
                    start_time = VALUES(start_time),
                    end_time   = VALUES(end_time),
                    venue      = VALUES(venue),
                    notes      = VALUES(notes),
                    updated_at = VALUES(updated_at)",
                [$clientCode, $branchId, $sessionId, $examId, $classId, $subjectId,
                 $examDate, $startTime, $endTime, $venue, $notes, $now, $now]
            );
        }

        return $this->ok('Date sheet saved successfully.');
    }

    // ── POST /DatesheetApi/togglePublish ─────────────────────────────────────
    // Body: { exam_id, class_id, branch_id, session_id }
    public function togglePublish()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->clientCode();
        $body       = $this->request->getData();

        $examId    = (int)($body['exam_id']    ?? 0);
        $classId   = (int)($body['class_id']   ?? 0);
        $branchId  = (int)($body['branch_id']  ?? 0);
        $sessionId = (int)($body['session_id'] ?? 0);

        if (!$examId || !$classId) {
            return $this->fail('exam_id and class_id are required.');
        }

        $db = \Cake\Datasource\ConnectionManager::get('default');

        $current = $db->execute(
            "SELECT MAX(is_published) AS cur
             FROM ssms_exam_datesheet
             WHERE ssms_client_code = ? AND exam_id = ? AND class_id = ?
               AND branch_id = ? AND session_id = ?",
            [$clientCode, $examId, $classId, $branchId, $sessionId]
        )->fetchAssoc();

        $newState = ((int)($current['cur'] ?? 0) === 1) ? 0 : 1;

        $db->execute(
            "UPDATE ssms_exam_datesheet
             SET is_published = ?, updated_at = NOW()
             WHERE ssms_client_code = ? AND exam_id = ? AND class_id = ?
               AND branch_id = ? AND session_id = ?",
            [$newState, $clientCode, $examId, $classId, $branchId, $sessionId]
        );

        return $this->ok([
            'is_published' => (bool)$newState,
            'message'      => $newState ? 'Date sheet published.' : 'Date sheet unpublished.',
        ]);
    }

    // ── GET /DatesheetApi/getAllDatesheets?examId=X&branchId=B&sessionId=S ───
    // Admin: all published datesheets for every class in one exam, grouped by class.
    public function getAllDatesheets()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->clientCode();
        $examId    = (int)($this->request->getQuery('examId')    ?? 0);
        $branchId  = (int)($this->request->getQuery('branchId')  ?? 0);
        $sessionId = (int)($this->request->getQuery('sessionId') ?? 0);

        if (!$examId) {
            return $this->fail('examId is required.');
        }

        $db = \Cake\Datasource\ConnectionManager::get('default');

        $exam = $db->execute(
            "SELECT exam_name FROM ssms_exams WHERE exam_id = ? LIMIT 1",
            [$examId]
        )->fetchAssoc();

        $rows = $db->execute(
            "SELECT
                d.class_id,
                c.class_name,
                s.subject_name,
                d.exam_date,
                d.start_time,
                d.end_time,
                d.venue
             FROM ssms_exam_datesheet d
             JOIN ssms_classes  c ON c.class_id  = d.class_id
             JOIN ssms_subjects s ON s.subject_id = d.subject_id
             WHERE d.ssms_client_code = ?
               AND d.exam_id        = ?
               AND d.is_published   = 1
               AND (d.branch_id  = 0 OR d.branch_id  = ?)
               AND (d.session_id = 0 OR d.session_id = ?)
             ORDER BY c.class_name ASC, d.exam_date ASC, s.subject_name ASC",
            [$clientCode, $examId, $branchId, $sessionId]
        )->fetchAll('assoc');

        $classes = [];
        foreach ($rows as $r) {
            $cid = (int)$r['class_id'];
            if (!isset($classes[$cid])) {
                $classes[$cid] = [
                    'class_id'   => $cid,
                    'class_name' => $r['class_name'],
                    'entries'    => [],
                ];
            }
            $classes[$cid]['entries'][] = [
                'subject_name' => $r['subject_name'],
                'exam_date'    => $r['exam_date'],
                'start_time'   => $r['start_time'],
                'end_time'     => $r['end_time'],
                'venue'        => $r['venue'] ?? '',
            ];
        }

        return $this->ok([
            'exam_name' => $exam['exam_name'] ?? '',
            'classes'   => array_values($classes),
        ]);
    }

    // ── GET /DatesheetApi/getMyDatesheet ─────────────────────────────────────
    // Student / parent — returns all published datesheets for their class,
    // filtered by their enrolled branch + session, grouped by exam.
    // branch_id=0 or session_id=0 in the datesheet means "all" (acts as wildcard).
    public function getMyDatesheet()
    {
        $this->request->allowMethod(['get']);
        $clientCode  = $this->clientCode();

        // Same 3-way fallback as getMyMarksheets:
        // (1) JWT claim, (2) ssmsEnrollmentId header, (3) ssmsUserName header
        $jwtEnrollId  = trim((string)($this->request->getAttribute('jwt_enrollment_id') ?? ''));
        $hdrEnrollId  = trim((string)($this->request->getHeaderLine('ssmsEnrollmentId') ?? ''));
        $hdrUserName  = trim((string)($this->request->getHeaderLine('ssmsUserName') ?? ''));
        $enrollmentId = $jwtEnrollId !== '' ? $jwtEnrollId
                      : ($hdrEnrollId !== '' ? $hdrEnrollId : $hdrUserName);

        if (!$enrollmentId) {
            return $this->fail('Enrollment ID is required.', 401);
        }

        $db = \Cake\Datasource\ConnectionManager::get('default');

        // Resolve class_id, branch_id, session_id from enrollment
        $enrolRow = $db->execute(
            "SELECT class_id,
                    COALESCE(branch_id, 0)  AS branch_id,
                    COALESCE(session_id, 0) AS session_id
             FROM ssms_student_enrollment
             WHERE ssms_client_code = ? AND enrollment_id = ? LIMIT 1",
            [$clientCode, $enrollmentId]
        )->fetchAssoc();

        if (!$enrolRow) {
            return $this->fail('Enrollment not found.', 404);
        }

        $classId   = (int)$enrolRow['class_id'];
        $branchId  = (int)$enrolRow['branch_id'];
        $sessionId = (int)$enrolRow['session_id'];

        // branch_id=0 / session_id=0 in the datesheet means "all branches/sessions"
        $rows = $db->execute(
            "SELECT
                d.exam_id,
                e.exam_name,
                e.exam_category,
                d.subject_id,
                s.subject_name,
                d.exam_date,
                d.start_time,
                d.end_time,
                d.venue,
                d.notes
             FROM ssms_exam_datesheet d
             JOIN ssms_exams    e ON e.exam_id    = d.exam_id
             JOIN ssms_subjects s ON s.subject_id = d.subject_id
             WHERE d.ssms_client_code = ?
               AND d.class_id        = ?
               AND d.is_published    = 1
               AND (d.branch_id  = 0 OR d.branch_id  = ?)
               AND (d.session_id = 0 OR d.session_id = ?)
             ORDER BY d.exam_id ASC, d.exam_date ASC, s.subject_name ASC",
            [$clientCode, $classId, $branchId, $sessionId]
        )->fetchAll('assoc');

        // Group by exam
        $exams = [];
        foreach ($rows as $r) {
            $eid = (int)$r['exam_id'];
            if (!isset($exams[$eid])) {
                $exams[$eid] = [
                    'exam_id'       => $eid,
                    'exam_name'     => $r['exam_name'],
                    'exam_category' => $r['exam_category'],
                    'class_id'      => $classId,
                    'entries'       => [],
                ];
            }
            $exams[$eid]['entries'][] = [
                'subject_id'   => (int)$r['subject_id'],
                'subject_name' => $r['subject_name'],
                'exam_date'    => $r['exam_date'],
                'start_time'   => $r['start_time'],
                'end_time'     => $r['end_time'],
                'venue'        => $r['venue'],
                'notes'        => $r['notes'],
            ];
        }

        return $this->ok(array_values($exams));
    }
}
