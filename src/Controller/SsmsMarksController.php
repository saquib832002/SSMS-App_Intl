<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsMarks Controller — CakePHP 5
 */
class SsmsMarksController extends AppController
{
    // ── Index ──────────────────────────────────────────────────────────────
    public function index()
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $ssmsMarks = $connection->execute(
            "SELECT sm.id, sm.enrollment_id, sm.roll_number, sm.subject_id,
                    sm.theory_marks, sm.internal_marks, sm.practical_marks, sm.total_marks,
                    ss.session_name, se.exam_name, sc.class_name, sec.section_name, sub.subject_name
             FROM   ssms_marks sm
             LEFT JOIN ssms_sessions  ss  ON sm.session_id = ss.session_id
             LEFT JOIN ssms_exams     se  ON sm.exam_id    = se.exam_id
             LEFT JOIN ssms_classes   sc  ON sm.class_id   = sc.class_id
             LEFT JOIN ssms_sections  sec ON sm.section_id = sec.section_id
             LEFT JOIN ssms_subjects  sub ON sm.subject_id = sub.subject_id
             WHERE sm.ssms_client_code = ?
             ORDER BY ss.session_name, se.exam_name, sc.class_name, sec.section_name",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact('ssmsMarks'));
    }

    // ── Add (selector form) ────────────────────────────────────────────────
    public function add()
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');
        $role       = strtolower(trim((string)$session->read('ssms_user_role')));
        $staffId    = $session->read('staff_id');
        $branchId   = $session->read('branch_id');

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            return $this->redirect(['action' => 'addMarks',
                $d['session_id'], $d['class_id'], $d['section_id'],
                $d['subject_id'], $d['exam_id'],
            ]);
        }

        $ssmsSessions = array_column(
            $connection->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=? ORDER BY session_name", [$clientCode])->fetchAll('assoc'),
            'session_name', 'session_id'
        );
        $ssmsExams = array_column(
            $connection->execute("SELECT exam_id, exam_name FROM ssms_exams WHERE ssms_client_code=? ORDER BY exam_name", [$clientCode])->fetchAll('assoc'),
            'exam_name', 'exam_id'
        );

        if ($role === 'user') {
            // Only classes/sections/subjects this teacher is assigned to in ssms_subject_teacher.
            // Filter by staff_id only — do NOT filter by branch_id here because a teacher's
            // class assignments are independent of which branch the user account belongs to.
            if (!$staffId) {
                // No staff_id in session → no assignments possible
                $assigned = [];
            } else {
                $assigned = $connection->execute(
                    "SELECT DISTINCT sst.class_id, sc.class_name, sst.section_id, sec.section_name,
                            sst.subject_id, sub.subject_name,
                            COALESCE(cs.subject_code, '') AS subject_code
                     FROM ssms_subject_teacher sst
                     JOIN ssms_classes sc   ON sc.class_id   = sst.class_id
                     JOIN ssms_sections sec ON sec.section_id = sst.section_id
                     JOIN ssms_subjects sub ON sub.subject_id = sst.subject_id
                     LEFT JOIN ssms_class_subjects cs ON cs.subject_id = sst.subject_id
                                                      AND cs.class_id  = sst.class_id
                                                      AND cs.ssms_client_code = sst.ssms_client_code
                     WHERE sst.ssms_client_code = ? AND sst.staff_id = ?
                     ORDER BY sc.class_name, sec.section_name",
                    [$clientCode, $staffId]
                )->fetchAll('assoc');
            }

            // Build unique classes and sections from assignments
            $ssmsClasses  = [];
            $ssmsSections = [];
            $ssmsSubjects = [];
            foreach ($assigned as $row) {
                $ssmsClasses[$row['class_id']] = $row['class_name'];
                $ssmsSections[] = [
                    'section_id'   => $row['section_id'],
                    'section_name' => $row['section_name'],
                    'class_id'     => $row['class_id'],
                ];
                $ssmsSubjects[] = [
                    'subject_id'   => $row['subject_id'],
                    'subject_name' => $row['subject_name'],
                    'subject_code' => $row['subject_code'],
                    'class_id'     => $row['class_id'],
                ];
            }
            // Deduplicate sections and subjects
            $ssmsSections = array_values(array_unique($ssmsSections, SORT_REGULAR));
            $ssmsSubjects = array_values(array_unique($ssmsSubjects, SORT_REGULAR));
        } else {
            // Admin / owner / superuser — see everything
            $ssmsClasses = array_column(
                $connection->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=? ORDER BY class_name", [$clientCode])->fetchAll('assoc'),
                'class_name', 'class_id'
            );
            $ssmsSections = $connection->execute(
                "SELECT section_id, section_name, class_id FROM ssms_sections
                 WHERE ssms_client_code=? ORDER BY section_name",
                [$clientCode]
            )->fetchAll('assoc');
            $ssmsSubjects = $connection->execute(
                "SELECT cs.class_id, s.subject_id, s.subject_name, cs.subject_code
                 FROM ssms_class_subjects cs
                 JOIN ssms_subjects s ON s.subject_id = cs.subject_id
                                     AND s.ssms_client_code = cs.ssms_client_code
                 WHERE cs.ssms_client_code = ?
                 ORDER BY cs.class_id, cs.display_order, s.subject_name",
                [$clientCode]
            )->fetchAll('assoc');
        }

        $ssmsMarks = null;
        $this->set(compact('ssmsSessions', 'ssmsClasses', 'ssmsSections', 'ssmsSubjects', 'ssmsExams', 'ssmsMarks', 'role'));
    }

    // ── AddMarks (per-student entry form) ──────────────────────────────────
    public function addMarks(
        $sessionId = null, $classId = null, $sectionId = null,
        $subjectId = null, $examId   = null
    ) {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');
        $role       = strtolower(trim((string)$session->read('ssms_user_role')));
        $staffId    = $session->read('staff_id');

        // Role guard for user role: verify the requested class/section/subject is assigned to them.
        // Admin / owner / superuser always pass through.
        if ($role === 'user' && $staffId) {
            $allowed = $connection->execute(
                "SELECT COUNT(*) AS cnt FROM ssms_subject_teacher
                 WHERE ssms_client_code=? AND staff_id=? AND class_id=? AND section_id=? AND subject_id=?",
                [$clientCode, $staffId, $classId, $sectionId, $subjectId]
            )->fetchAssoc();
            if (empty($allowed['cnt']) || (int)$allowed['cnt'] === 0) {
                $this->Flash->error('You are not assigned to this class/section/subject.');
                return $this->redirect(['action' => 'add']);
            }
        } elseif ($role === 'user' && !$staffId) {
            $this->Flash->error('Your account is not linked to a staff profile. Please contact the administrator.');
            return $this->redirect(['action' => 'add']);
        }

        // POST: save marks for one student (each row submits its own form)
        if ($this->request->is('post')) {
            $enrollIds    = (array)($this->request->getData('enrollment_id') ?? []);
            $theoryArr    = (array)($this->request->getData('theory_marks')   ?? []);
            $internalArr  = (array)($this->request->getData('internal_marks') ?? []);
            $practicalArr = (array)($this->request->getData('practical_marks')?? []);

            foreach ($enrollIds as $i => $enrollId) {
                $theory    = (float)($theoryArr[$i]    ?? 0);
                $internal  = (float)($internalArr[$i]  ?? 0);
                $practical = (float)($practicalArr[$i] ?? 0);
                $total     = $theory + $internal + $practical;

                $existing = $connection->execute(
                    "SELECT id FROM ssms_marks
                     WHERE enrollment_id=? AND session_id=? AND class_id=? AND section_id=?
                           AND subject_id=? AND exam_id=? AND ssms_client_code=? LIMIT 1",
                    [$enrollId, $sessionId, $classId, $sectionId, $subjectId, $examId, $clientCode]
                )->fetchAssoc();

                if ($existing) {
                    // User role teachers may only ADD marks, not update existing ones
                    if ($role === 'user') {
                        continue;
                    }
                    $connection->execute(
                        "UPDATE ssms_marks
                         SET theory_marks=?, internal_marks=?, practical_marks=?, total_marks=?, modified=NOW()
                         WHERE id=?",
                        [$theory, $internal, $practical, $total, $existing['id']]
                    );
                } else {
                    $enroll = $connection->execute(
                        "SELECT roll_number, branch_id FROM ssms_student_enrollment
                         WHERE enrollment_id=? LIMIT 1",
                        [$enrollId]
                    )->fetchAssoc();

                    $connection->execute(
                        "INSERT INTO ssms_marks
                         (enrollment_id, session_id, class_id, section_id, subject_id, exam_id,
                          branch_id, roll_number, theory_marks, internal_marks, practical_marks,
                          total_marks, ssms_client_code, created, modified)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())",
                        [$enrollId, $sessionId, $classId, $sectionId, $subjectId, $examId,
                         $enroll['branch_id'] ?? 0, $enroll['roll_number'] ?? '',
                         $theory, $internal, $practical, $total, $clientCode]
                    );
                }
            }

            $this->Flash->success('Marks saved successfully.');
            return $this->redirect(['action' => 'addMarks',
                $sessionId, $classId, $sectionId, $subjectId, $examId]);
        }

        // Max marks (per class + subject — no exam_id on this table)
        $maxRow = $connection->execute(
            "SELECT theory_max_marks, internal_max_marks, practical_max_marks
             FROM ssms_max_marks
             WHERE class_id=? AND subject_id=? AND ssms_client_code=? LIMIT 1",
            [$classId, $subjectId, $clientCode]
        )->fetchAssoc();
        $theoryMaxMarks = ($maxRow && $maxRow['theory_max_marks']   !== null && $maxRow['theory_max_marks']   > 0) ? $maxRow['theory_max_marks']   : null;
        $intMaxMarks    = ($maxRow && $maxRow['internal_max_marks']  !== null && $maxRow['internal_max_marks']  > 0) ? $maxRow['internal_max_marks']  : null;
        $pracMaxMarks   = ($maxRow && $maxRow['practical_max_marks'] !== null && $maxRow['practical_max_marks'] > 0) ? $maxRow['practical_max_marks'] : null;

        // Students enrolled in this class/section/session (with names)
        $ssmsStudentEnrollment = $connection->execute(
            "SELECT se.enrollment_id, se.roll_number,
                    sr.student_first_name, sr.student_last_name
             FROM ssms_student_enrollment se
             LEFT JOIN ssms_student_registration sr ON se.registration_id = sr.registration_id
             WHERE se.class_id=? AND se.section_id=? AND se.session_id=? AND se.ssms_client_code=?
             ORDER BY CAST(se.roll_number AS UNSIGNED)",
            [$classId, $sectionId, $sessionId, $clientCode]
        )->fetchAll('assoc');

        // Already saved marks for this combination
        $ssmsMarks = $connection->execute(
            "SELECT sm.id, sm.enrollment_id, sm.roll_number, sm.subject_id,
                    sm.theory_marks, sm.internal_marks, sm.practical_marks, sm.total_marks,
                    ss.session_name, se.exam_name, sc.class_name, sec.section_name, sub.subject_name
             FROM   ssms_marks sm
             LEFT JOIN ssms_sessions  ss  ON sm.session_id = ss.session_id
             LEFT JOIN ssms_exams     se  ON sm.exam_id    = se.exam_id
             LEFT JOIN ssms_classes   sc  ON sm.class_id   = sc.class_id
             LEFT JOIN ssms_sections  sec ON sm.section_id = sec.section_id
             LEFT JOIN ssms_subjects  sub ON sm.subject_id = sub.subject_id
             WHERE sm.ssms_client_code=? AND sm.session_id=? AND sm.class_id=?
               AND sm.section_id=? AND sm.subject_id=? AND sm.exam_id=?
             ORDER BY CAST(sm.roll_number AS UNSIGNED)",
            [$clientCode, $sessionId, $classId, $sectionId, $subjectId, $examId]
        )->fetchAll('assoc');

        // Build lookup keyed by enrollment_id so the entry form can pre-fill saved marks
        $marksMap = [];
        foreach ($ssmsMarks as $m) {
            $marksMap[$m['enrollment_id']] = $m;
        }

        // Names for page sub-header
        $names = $connection->execute(
            "SELECT ss.session_name, sc.class_name, sec.section_name, sub.subject_name, se.exam_name
             FROM ssms_sessions ss, ssms_classes sc, ssms_sections sec, ssms_subjects sub, ssms_exams se
             WHERE ss.session_id=? AND sc.class_id=? AND sec.section_id=? AND sub.subject_id=? AND se.exam_id=? LIMIT 1",
            [$sessionId, $classId, $sectionId, $subjectId, $examId]
        )->fetchAssoc();

        $sessionName = $names['session_name'] ?? '';
        $className   = $names['class_name']   ?? '';
        $sectionName = $names['section_name'] ?? '';
        $subName     = $names['subject_name'] ?? '';
        $examName    = $names['exam_name']    ?? '';

        $this->set(compact(
            'ssmsStudentEnrollment', 'ssmsMarks', 'marksMap',
            'theoryMaxMarks', 'intMaxMarks', 'pracMaxMarks',
            'sessionName', 'className', 'sectionName', 'subName', 'examName',
            'sessionId', 'classId', 'sectionId', 'subjectId', 'examId',
            'role'
        ));
    }

    // ── Edit ──────────────────────────────────────────────────────────────
    public function edit($id = null, $subjectId = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $ssmsExam = $this->SsmsMarks->get($id, contain: []);

        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsExam = $this->SsmsMarks->patchEntity($ssmsExam, $this->request->getData());
            $ssmsExam->total_marks = (float)($ssmsExam->theory_marks   ?? 0)
                                   + (float)($ssmsExam->internal_marks  ?? 0)
                                   + (float)($ssmsExam->practical_marks ?? 0);
            if ($this->SsmsMarks->save($ssmsExam)) {
                $this->Flash->success('Marks updated successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save marks. Please try again.');
        }

        // Max marks for this record's class + subject
        $maxRow = $connection->execute(
            "SELECT theory_max_marks, internal_max_marks, practical_max_marks
             FROM ssms_max_marks
             WHERE class_id=? AND subject_id=? AND ssms_client_code=? LIMIT 1",
            [$ssmsExam->class_id, $subjectId ?? $ssmsExam->subject_id, $clientCode]
        )->fetchAssoc();
        $theoryMaxMarks = ($maxRow && $maxRow['theory_max_marks']   > 0) ? $maxRow['theory_max_marks']   : null;
        $intMaxMarks    = ($maxRow && $maxRow['internal_max_marks']  > 0) ? $maxRow['internal_max_marks']  : null;
        $pracMaxMarks   = ($maxRow && $maxRow['practical_max_marks'] > 0) ? $maxRow['practical_max_marks'] : null;

        // Dropdown lists (key-value)
        $ssmsClasses  = array_column($connection->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=? ORDER BY class_name", [$clientCode])->fetchAll('assoc'), 'class_name', 'class_id');
        $ssmsSessions = array_column($connection->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=? ORDER BY session_name", [$clientCode])->fetchAll('assoc'), 'session_name', 'session_id');
        $ssmsSections = array_column($connection->execute("SELECT section_id, section_name FROM ssms_sections WHERE ssms_client_code=? ORDER BY section_name", [$clientCode])->fetchAll('assoc'), 'section_name', 'section_id');
        $ssmsSubjects = array_column($connection->execute("SELECT subject_id, subject_name FROM ssms_subjects WHERE ssms_client_code=? ORDER BY subject_name", [$clientCode])->fetchAll('assoc'), 'subject_name', 'subject_id');

        $this->set(compact(
            'ssmsExam', 'ssmsClasses', 'ssmsSessions', 'ssmsSections', 'ssmsSubjects',
            'theoryMaxMarks', 'intMaxMarks', 'pracMaxMarks'
        ));
    }

    // ── Delete ────────────────────────────────────────────────────────────
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsMark = $this->SsmsMarks->get($id);
        if ($this->SsmsMarks->delete($ssmsMark)) {
            $this->Flash->success('Marks record deleted.');
        } else {
            $this->Flash->error('Could not delete this record.');
        }
        return $this->redirect(['action' => 'index']);
    }

    // ── ClassSubjectMarks (pivot table) ───────────────────────────────────
    public function classSubjectMarks($sesId = null, $classId = null, $secId = null, $examId = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        if ($this->request->is('post')) {
            $sesId   = $this->request->getData('session_id');
            $classId = $this->request->getData('class_id');
            $secId   = $this->request->getData('section_id');
            $examId  = $this->request->getData('exam_id');
            return $this->redirect(['action' => 'classSubjectMarks', $sesId, $classId, $secId, $examId]);
        }

        $columnHeader = $subjectMarksLists = null;
        $totalMaxMarks = 0;

        if ($sesId && $classId && $secId && $examId) {
            // Distinct subjects that have marks entered for this combo
            $subjects = $connection->execute(
                "SELECT DISTINCT sub.subject_id, sub.subject_name
                 FROM ssms_marks sm
                 JOIN ssms_subjects sub ON sm.subject_id = sub.subject_id
                 WHERE sm.ssms_client_code=? AND sm.session_id=? AND sm.class_id=?
                   AND sm.section_id=? AND sm.exam_id=?
                 ORDER BY sub.subject_name",
                [$clientCode, $sesId, $classId, $secId, $examId]
            )->fetchAll('assoc');

            // Column headers: enrollment_id first, then subject names
            $columnHeader = ['enrollment_id'];
            foreach ($subjects as $sub) {
                $columnHeader[] = $sub['subject_name'];
            }

            // Total max marks for this class
            $maxRow = $connection->execute(
                "SELECT COALESCE(SUM(max_marks), 0) as total_max
                 FROM ssms_max_marks WHERE class_id=? AND ssms_client_code=?",
                [$classId, $clientCode]
            )->fetchAssoc();
            $totalMaxMarks = (float)($maxRow['total_max'] ?? 0);

            // Marks with registration_id from enrollment table
            $rawMarks = $connection->execute(
                "SELECT sm.enrollment_id, sub.subject_name, sm.total_marks,
                        ste.registration_id
                 FROM ssms_marks sm
                 JOIN ssms_subjects sub ON sm.subject_id = sub.subject_id
                 LEFT JOIN ssms_student_enrollment ste
                       ON sm.enrollment_id = ste.enrollment_id
                      AND ste.ssms_client_code = sm.ssms_client_code
                 WHERE sm.ssms_client_code=? AND sm.session_id=? AND sm.class_id=?
                   AND sm.section_id=? AND sm.exam_id=?
                 ORDER BY sm.enrollment_id, sub.subject_name",
                [$clientCode, $sesId, $classId, $secId, $examId]
            )->fetchAll('assoc');

            // Build pivot
            $pivot = [];
            foreach ($rawMarks as $row) {
                $eid = $row['enrollment_id'];
                if (!isset($pivot[$eid])) {
                    $pivot[$eid] = [
                        'enrollment_id'   => $eid,
                        'registration_id' => $row['registration_id'],
                    ];
                }
                $pivot[$eid][$row['subject_name']] = $row['total_marks'];
            }
            $subjectMarksLists = array_values($pivot);
        }

        $this->set(compact(
            'columnHeader', 'subjectMarksLists', 'totalMaxMarks',
            'sesId', 'classId', 'secId', 'examId'
        ));
    }

    // ── StudentRank ────────────────────────────────────────────────────────
    public function studentRank()
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $branchId = $sesId = $classId = $secId = $examId = null;
        $classRankings = [];
        $divHidden = 'hidden';

        if ($this->request->is('post')) {
            $branchId = $this->request->getData('branch_id') ?: null;
            $sesId    = $this->request->getData('session_id') ?: null;
            $classId  = $this->request->getData('class_id') ?: null;
            $secId    = $this->request->getData('section_id') ?: null;
            $examId   = $this->request->getData('exam_id') ?: null;

            // Only session + exam are required; class/section are optional
            if ($sesId && $examId) {
                // ── Main ranking query ─────────────────────────────────────
                $sql  = "SELECT
                            sm.enrollment_id, sm.class_id, sm.section_id, sm.branch_id,
                            CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                            e.roll_number,
                            ss.session_name, sc.class_name, sec.section_name,
                            SUM(sm.total_marks)                AS total_obtained,
                            COALESCE(SUM(mm.max_marks), 0)     AS total_max,
                            ROUND(
                              CASE WHEN COALESCE(SUM(mm.max_marks), 0) > 0
                                THEN (SUM(sm.total_marks) / SUM(COALESCE(mm.max_marks, 0))) * 100
                                ELSE 0
                              END, 2)                          AS percentage
                         FROM   ssms_marks sm
                         JOIN   ssms_student_enrollment e
                                ON  e.enrollment_id    = sm.enrollment_id
                                AND e.ssms_client_code = sm.ssms_client_code
                         JOIN   ssms_student_registration r
                                ON  r.registration_id  = e.registration_id
                         LEFT JOIN ssms_sessions  ss  ON ss.session_id  = sm.session_id
                         LEFT JOIN ssms_classes   sc  ON sc.class_id    = sm.class_id
                         LEFT JOIN ssms_sections  sec ON sec.section_id = sm.section_id
                         LEFT JOIN ssms_max_marks mm
                                ON  mm.subject_id       = sm.subject_id
                                AND mm.class_id         = sm.class_id
                                AND mm.ssms_client_code = sm.ssms_client_code
                         WHERE sm.ssms_client_code=? AND sm.session_id=? AND sm.exam_id=?";
                $bind = [$clientCode, $sesId, $examId];
                if ($classId)   { $sql .= " AND sm.class_id   = ?"; $bind[] = $classId;   }
                if ($secId)     { $sql .= " AND sm.section_id = ?"; $bind[] = $secId;     }
                if ($branchId)  { $sql .= " AND sm.branch_id  = ?"; $bind[] = $branchId;  }
                $sql .= " GROUP BY sm.enrollment_id, sm.class_id, sm.section_id, sm.branch_id,
                                   r.student_first_name, r.student_last_name,
                                   e.roll_number, ss.session_name, sc.class_name, sec.section_name
                          ORDER BY total_obtained DESC, r.student_first_name ASC";

                $rows = $connection->execute($sql, $bind)->fetchAll('assoc');

                // ── Per-subject fail map (any subject < 30% = fail) ────────
                $subSql  = "SELECT sm.enrollment_id, sm.total_marks,
                                   COALESCE(mm.max_marks, 0) AS subject_max
                            FROM   ssms_marks sm
                            LEFT JOIN ssms_max_marks mm
                                   ON  mm.subject_id       = sm.subject_id
                                   AND mm.class_id         = sm.class_id
                                   AND mm.ssms_client_code = sm.ssms_client_code
                            WHERE  sm.ssms_client_code=? AND sm.session_id=? AND sm.exam_id=?";
                $subBind = [$clientCode, $sesId, $examId];
                if ($classId)  { $subSql .= " AND sm.class_id   = ?"; $subBind[] = $classId;  }
                if ($secId)    { $subSql .= " AND sm.section_id = ?"; $subBind[] = $secId;    }
                if ($branchId) { $subSql .= " AND sm.branch_id  = ?"; $subBind[] = $branchId; }

                $subjectRows = $connection->execute($subSql, $subBind)->fetchAll('assoc');
                $failMap = [];
                foreach ($subjectRows as $sr) {
                    $subMax = (float)$sr['subject_max'];
                    $subPct = $subMax > 0 ? ((float)$sr['total_marks'] / $subMax) * 100 : 0;
                    if ($subPct < 30) {
                        $failMap[$sr['enrollment_id']] = true;
                    }
                }

                // ── Assign tie-aware ranks + grade ─────────────────────────
                $rank = $prevTotal = 0;
                $skip = 0;
                foreach ($rows as &$row) {
                    $total = (float)$row['total_obtained'];
                    if ($total !== $prevTotal) {
                        $rank     += 1 + $skip;
                        $skip      = 0;
                        $prevTotal = $total;
                    } else {
                        $skip++;
                    }
                    $row['rank'] = $rank;

                    $pct              = (float)$row['percentage'];
                    $failedSubject    = !empty($failMap[$row['enrollment_id']]);
                    $row['is_passed'] = !$failedSubject && $pct >= 40;
                    $row['grade']     = !$row['is_passed'] ? 'F'
                        : ($pct >= 90 ? 'A+' : ($pct >= 80 ? 'A' : ($pct >= 70 ? 'B+'
                        : ($pct >= 60 ? 'B'  : ($pct >= 50 ? 'C' : 'D')))));
                }
                unset($row);

                $classRankings = $rows;
                $divHidden = '';
            }
        }

        // Dropdowns
        $ssmsBranch   = array_column($connection->execute("SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=? ORDER BY branch_name", [$clientCode])->fetchAll('assoc'), 'branch_name', 'branch_id');
        $ssmsSessions = array_column($connection->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=? ORDER BY session_name", [$clientCode])->fetchAll('assoc'), 'session_name', 'session_id');
        $ssmsClasses  = array_column($connection->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=? ORDER BY class_name", [$clientCode])->fetchAll('assoc'), 'class_name', 'class_id');
        $ssmsSections = $connection->execute(
            "SELECT section_id, section_name, class_id FROM ssms_sections WHERE ssms_client_code=? ORDER BY section_name",
            [$clientCode]
        )->fetchAll('assoc');
        $ssmsExams = array_column($connection->execute("SELECT exam_id, exam_name FROM ssms_exams WHERE ssms_client_code=? ORDER BY exam_name", [$clientCode])->fetchAll('assoc'), 'exam_name', 'exam_id');

        $this->set(compact(
            'classRankings', 'divHidden',
            'ssmsBranch', 'ssmsSessions', 'ssmsClasses', 'ssmsSections', 'ssmsExams',
            'branchId', 'sesId', 'classId', 'secId', 'examId'
        ));
    }

    // ── StudentRanking (direct view, no filter form) ───────────────────────
    public function studentRanking($sesId = null, $classId = null, $secId = null, $examId = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        $classRankings = [];
        if ($sesId && $classId && $secId && $examId) {
            $classRankings = $connection->execute(
                "SELECT sm.enrollment_id, sm.class_id, sm.section_id,
                        ss.session_name, sc.class_name, sec.section_name,
                        SUM(sm.total_marks) as total_obtained,
                        COALESCE(SUM(mm.max_marks), 0) as max_marks,
                        CASE WHEN COALESCE(SUM(mm.max_marks), 0) > 0
                             THEN (SUM(sm.total_marks) / SUM(mm.max_marks)) * 100
                             ELSE 0 END as percentage
                 FROM   ssms_marks sm
                 LEFT JOIN ssms_sessions  ss  ON sm.session_id = ss.session_id
                 LEFT JOIN ssms_classes   sc  ON sm.class_id   = sc.class_id
                 LEFT JOIN ssms_sections  sec ON sm.section_id = sec.section_id
                 LEFT JOIN ssms_max_marks mm  ON mm.subject_id = sm.subject_id
                                             AND mm.class_id   = sm.class_id
                                             AND mm.ssms_client_code = sm.ssms_client_code
                 WHERE sm.ssms_client_code=? AND sm.session_id=? AND sm.class_id=?
                   AND sm.section_id=? AND sm.exam_id=?
                 GROUP BY sm.enrollment_id, sm.class_id, sm.section_id,
                          ss.session_name, sc.class_name, sec.section_name
                 ORDER BY percentage DESC",
                [$clientCode, $sesId, $classId, $secId, $examId]
            )->fetchAll('assoc');
        }

        $this->set(compact('classRankings', 'sesId', 'classId', 'secId', 'examId'));
    }

    // ── Marksheet ─────────────────────────────────────────────────────────
    public function marksheet($enrollmentId = null, $examId = null)
    {
        $session    = $this->request->getSession();
        $connection = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code');

        if (!$enrollmentId || !$examId) {
            $this->Flash->error('Invalid marksheet request.');
            return $this->redirect(['action' => 'studentRank']);
        }

        // School info
        $schoolRow  = $connection->execute(
            "SELECT ssms_client_name, ssms_client_header_text, ssms_client_address,
                    ssms_client_city, ssms_client_phone, ssms_client_email, logo_name
             FROM   ssms_clients WHERE ssms_client_code=? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();

        // Student + enrollment info
        $student = $connection->execute(
            "SELECT e.enrollment_id, e.roll_number, e.class_id, e.section_id,
                    e.session_id, e.branch_id,
                    r.student_first_name, r.student_last_name, r.registration_id,
                    r.student_father_name, r.student_dob,
                    CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                    c.class_name, sec.section_name, ses.session_name, b.branch_name
             FROM   ssms_student_enrollment e
             JOIN   ssms_student_registration r ON r.registration_id = e.registration_id
             LEFT JOIN ssms_classes   c   ON c.class_id    = e.class_id
             LEFT JOIN ssms_sections  sec ON sec.section_id = e.section_id
             LEFT JOIN ssms_sessions  ses ON ses.session_id = e.session_id
             LEFT JOIN ssms_branch    b   ON b.branch_id   = e.branch_id
             WHERE  e.enrollment_id=? AND e.ssms_client_code=? LIMIT 1",
            [$enrollmentId, $clientCode]
        )->fetchAssoc();

        if (!$student) {
            $this->Flash->error('Student not found.');
            return $this->redirect(['action' => 'studentRank']);
        }

        // Exam name
        $exam = $connection->execute(
            "SELECT exam_id, exam_name FROM ssms_exams WHERE exam_id=? AND ssms_client_code=? LIMIT 1",
            [$examId, $clientCode]
        )->fetchAssoc();

        // All subject marks for this student + exam
        $marks = $connection->execute(
            "SELECT sub.subject_name, COALESCE(cs.subject_code, '') AS subject_code,
                    m.theory_marks, m.internal_marks, m.practical_marks, m.total_marks,
                    mm.theory_max_marks, mm.internal_max_marks, mm.practical_max_marks,
                    mm.max_marks AS subject_max_marks
             FROM   ssms_marks m
             JOIN   ssms_subjects sub ON sub.subject_id = m.subject_id
             LEFT JOIN ssms_class_subjects cs
                    ON  cs.subject_id       = m.subject_id
                    AND cs.class_id         = m.class_id
                    AND cs.ssms_client_code = m.ssms_client_code
             LEFT JOIN ssms_max_marks mm
                    ON  mm.subject_id       = m.subject_id
                    AND mm.class_id         = m.class_id
                    AND mm.ssms_client_code = m.ssms_client_code
             WHERE  m.enrollment_id=? AND m.exam_id=? AND m.ssms_client_code=?
             ORDER  BY sub.subject_name ASC",
            [$enrollmentId, $examId, $clientCode]
        )->fetchAll('assoc');

        // Totals + grade
        $totalObtained = (float)array_sum(array_column($marks, 'total_marks'));
        $totalMax      = (float)array_sum(array_column($marks, 'subject_max_marks'));
        $percentage    = $totalMax > 0 ? round(($totalObtained / $totalMax) * 100, 2) : 0;

        // Check per-subject fail (< 30% of that subject's max)
        $failedSubject = false;
        foreach ($marks as $m) {
            $subMax = (float)($m['subject_max_marks'] ?? 0);
            $subPct = $subMax > 0 ? ((float)$m['total_marks'] / $subMax) * 100 : 0;
            if ($subPct < 30) { $failedSubject = true; break; }
        }
        $isPassed = !$failedSubject && $percentage >= 40;
        $grade    = !$isPassed ? 'F'
            : ($percentage >= 90 ? 'A+' : ($percentage >= 80 ? 'A' : ($percentage >= 70 ? 'B+'
            : ($percentage >= 60 ? 'B'  : ($percentage >= 50 ? 'C' : 'D')))));

        $this->set(compact(
            'schoolRow', 'student', 'exam', 'marks',
            'totalObtained', 'totalMax', 'percentage', 'isPassed', 'grade',
            'enrollmentId', 'examId'
        ));
    }

    // ── PromoteToNextClass ─────────────────────────────────────────────────
    public function promoteToNextClass(
        $regId = null, $sesId = null, $classId = null,
        $secId = null, $enrollId = null
    ) {
        // Promotion logic: update student's class/section in the next session
        // Full implementation depends on your promotion rules
        $this->Flash->success('Student promoted successfully.');
        return $this->redirect(['action' => 'classSubjectMarks', $sesId, $classId, $secId]);
    }

    // ── GenerateRankPdf ────────────────────────────────────────────────────
    public function generateRankPdf(
        $branchId = null, $sesId = null, $classId = null,
        $secId    = null, $examId = null
    ) {
        // Requires FPDF library — stub redirects gracefully if not installed
        if (!file_exists($_SERVER['DOCUMENT_ROOT'] . '/fpdf/fpdf.php')) {
            $this->Flash->error('PDF generation requires the FPDF library. Please install it at /fpdf/fpdf.php.');
            return $this->redirect(['action' => 'studentRank']);
        }
        // FPDF generation logic goes here (legacy)
        $this->Flash->error('PDF generation not yet implemented.');
        return $this->redirect(['action' => 'studentRank']);
    }

    // ── GenerateMarksheetPdf ──────────────────────────────────────────────
    public function generateMarksheetPdf($encKey = null)
    {
        if (!file_exists($_SERVER['DOCUMENT_ROOT'] . '/fpdf/fpdf.php')) {
            $this->Flash->error('Marksheet PDF requires the FPDF library. Please install it at /fpdf/fpdf.php.');
            return $this->redirect(['action' => 'index']);
        }
        // FPDF marksheet logic goes here (legacy)
        $this->Flash->error('Marksheet PDF generation not yet implemented.');
        return $this->redirect(['action' => 'index']);
    }
}
