<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsTimetable Controller
 *
 * manage()      – Admin/Owner: grid editor (session+class+section filter)
 * saveSlot()    – AJAX POST: save one cell; returns JSON
 * view()        – All roles: read-only class timetable grid
 * teacherView() – All roles: read-only teacher weekly timetable
 */
class SsmsTimetableController extends AppController
{
    private function _clientCode(): string
    {
        return (string) $this->request->getSession()->read('ssms_client_code');
    }

    private function _isAdminOrOwner(): bool
    {
        return in_array(
            $this->request->getSession()->read('ssms_user_role'),
            ['admin', 'owner'], true
        );
    }

    private function _requireAdminOrOwner(): ?object
    {
        if (!$this->_isAdminOrOwner()) {
            $this->Flash->error('You do not have permission to perform this action.');
            return $this->redirect(['action' => 'manage']);
        }
        return null;
    }

    /** Shared helper: load dropdown data needed by multiple actions */
    private function _loadDropdowns(string $clientCode): array
    {
        $conn = ConnectionManager::get('default');

        $sessions = $conn->execute(
            "SELECT session_id, session_name FROM ssms_sessions
             WHERE ssms_client_code = ? ORDER BY session_id DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $classes = $conn->execute(
            "SELECT class_id, class_name FROM ssms_classes
             WHERE ssms_client_code = ? ORDER BY class_name",
            [$clientCode]
        )->fetchAll('assoc');

        $staff = $conn->execute(
            "SELECT staff_id, CONCAT(first_name,' ',last_name) AS staff_name
             FROM ssms_staff WHERE ssms_client_code = ?
             ORDER BY first_name, last_name",
            [$clientCode]
        )->fetchAll('assoc');

        $periods = $conn->execute(
            "SELECT * FROM ssms_periods
             WHERE ssms_client_code = ? ORDER BY period_number",
            [$clientCode]
        )->fetchAll('assoc');

        return compact('sessions', 'classes', 'staff', 'periods');
    }

    /** Load subjects for a specific class from ssms_class_subjects */
    private function _loadClassSubjects(string $clientCode, int $classId): array
    {
        if (!$classId) return [];
        $conn = ConnectionManager::get('default');
        return $conn->execute(
            "SELECT cs.id AS class_subject_id, cs.subject_code,
                    s.subject_id, s.subject_name
             FROM ssms_class_subjects cs
             JOIN ssms_subjects s ON s.subject_id = cs.subject_id
                                  AND s.ssms_client_code = cs.ssms_client_code
             WHERE cs.ssms_client_code = ? AND cs.class_id = ?
             ORDER BY cs.display_order, s.subject_name",
            [$clientCode, $classId]
        )->fetchAll('assoc');
    }

    // ── manage ────────────────────────────────────────────────────────────────
    // Grid editor: one column per day, one row per period, each cell = subject+teacher

    public function manage()
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');
        $drops      = $this->_loadDropdowns($clientCode);

        $sessionId  = (int)($this->request->getQuery('session_id')  ?? ($drops['sessions'][0]['session_id']  ?? 0));
        $classId    = (int)($this->request->getQuery('class_id')    ?? ($drops['classes'][0]['class_id']     ?? 0));
        $sectionId  = (int)($this->request->getQuery('section_id')  ?? 0);

        // Sections for the chosen class
        $sections = [];
        if ($classId) {
            $sections = $conn->execute(
                "SELECT section_id, section_name FROM ssms_sections
                 WHERE ssms_client_code = ? AND class_id = ? ORDER BY section_name",
                [$clientCode, $classId]
            )->fetchAll('assoc');
            if (!$sectionId && $sections) {
                $sectionId = (int)$sections[0]['section_id'];
            }
        }

        // Subjects for the chosen class (from ssms_class_subjects)
        $subjects = $this->_loadClassSubjects($clientCode, $classId);

        // Existing timetable entries for this class-section-session → indexed [day][period]
        $grid = [];
        if ($classId && $sectionId && $sessionId) {
            $rows = $conn->execute(
                "SELECT t.*, CONCAT(st.first_name,' ',st.last_name) AS staff_name,
                        sub.subject_name, cs.subject_code
                 FROM ssms_timetable t
                 LEFT JOIN ssms_staff          st  ON st.staff_id          = t.staff_id          AND st.ssms_client_code  = t.ssms_client_code
                 LEFT JOIN ssms_class_subjects cs  ON cs.id                = t.class_subject_id
                 LEFT JOIN ssms_subjects       sub ON sub.subject_id       = cs.subject_id
                 WHERE t.ssms_client_code = ? AND t.session_id = ?
                   AND t.class_id = ? AND t.section_id = ?",
                [$clientCode, $sessionId, $classId, $sectionId]
            )->fetchAll('assoc');

            foreach ($rows as $r) {
                $grid[(int)$r['day_of_week']][(int)$r['period_id']] = $r;
            }
        }

        $days = [1=>'Monday',2=>'Tuesday',3=>'Wednesday',4=>'Thursday',5=>'Friday',6=>'Saturday'];

        // Build teacher busy map for the whole session:
        // busyMap[staff_id][day_of_week][period_id] = "Class – Section"
        // Excludes the current class-section so we don't flag its own assignments.
        $busyMap = [];
        if ($sessionId) {
            $busyRows = $conn->execute(
                "SELECT t.staff_id, t.day_of_week, t.period_id,
                        c.class_name, sec.section_name
                 FROM ssms_timetable t
                 LEFT JOIN ssms_classes  c   ON c.class_id    = t.class_id   AND c.ssms_client_code   = t.ssms_client_code
                 LEFT JOIN ssms_sections sec ON sec.section_id = t.section_id AND sec.ssms_client_code = t.ssms_client_code
                 WHERE t.ssms_client_code = ? AND t.session_id = ?
                   AND t.staff_id IS NOT NULL
                   AND NOT (t.class_id = ? AND t.section_id = ?)",
                [$clientCode, $sessionId, $classId ?: 0, $sectionId ?: 0]
            )->fetchAll('assoc');

            foreach ($busyRows as $br) {
                $sid = (int)$br['staff_id'];
                $d   = (int)$br['day_of_week'];
                $p   = (int)$br['period_id'];
                $busyMap[$sid][$d][$p] = ($br['class_name'] ?? '?') . ' – ' . ($br['section_name'] ?? '?');
            }
        }

        $this->set(compact('sessionId','classId','sectionId','sections','subjects','grid','days','busyMap'));
        $this->set($drops);
        $this->set('isAdminOrOwner', true);
    }

    // ── saveSlot (AJAX) ───────────────────────────────────────────────────────

    public function saveSlot()
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->disableAutoLayout();

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');
        $d          = $this->request->getData();

        $sessionId = (int)($d['session_id'] ?? 0);
        $classId   = (int)($d['class_id']   ?? 0);
        $sectionId = (int)($d['section_id'] ?? 0);
        $day       = (int)($d['day_of_week'] ?? 0);
        $periodId  = (int)($d['period_id']   ?? 0);
        $classSubjectId = !empty($d['class_subject_id']) ? (int)$d['class_subject_id'] : null;
        $staffId        = !empty($d['staff_id'])         ? (int)$d['staff_id']         : null;
        $room           = !empty($d['room'])             ? $d['room']                  : null;

        if (!$sessionId || !$classId || !$sectionId || !$day || !$periodId) {
            echo json_encode(['ok' => false, 'msg' => 'Missing required fields.']);
            return $this->response->withType('application/json');
        }

        // ── Conflict check: same teacher same day+period in a different class ──
        if ($staffId) {
            $conflict = $conn->execute(
                "SELECT t.timetable_id, c.class_name, sec.section_name
                 FROM ssms_timetable t
                 LEFT JOIN ssms_classes   c   ON c.class_id   = t.class_id
                 LEFT JOIN ssms_sections  sec ON sec.section_id = t.section_id
                 WHERE t.ssms_client_code = ? AND t.session_id = ?
                   AND t.staff_id = ? AND t.day_of_week = ? AND t.period_id = ?
                   AND NOT (t.class_id = ? AND t.section_id = ?)",
                [$clientCode, $sessionId, $staffId, $day, $periodId, $classId, $sectionId]
            )->fetchAll('assoc');

            if ($conflict) {
                $c = $conflict[0];
                echo json_encode([
                    'ok'  => false,
                    'msg' => 'Teacher conflict! This teacher is already assigned to ' .
                             h($c['class_name']) . ' – ' . h($c['section_name']) .
                             ' at this period.',
                ]);
                return $this->response->withType('application/json');
            }
        }

        try {
            // UPSERT: insert or update on duplicate slot key
            $conn->execute(
                "INSERT INTO ssms_timetable
                    (ssms_client_code, session_id, class_id, section_id,
                     day_of_week, period_id, class_subject_id, staff_id, room)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    class_subject_id = VALUES(class_subject_id),
                    staff_id         = VALUES(staff_id),
                    room             = VALUES(room)",
                [$clientCode, $sessionId, $classId, $sectionId, $day, $periodId,
                 $classSubjectId, $staffId, $room]
            );

            // Return updated label for the cell
            $label = '';
            if ($classSubjectId) {
                $sub = $conn->execute(
                    "SELECT s.subject_name FROM ssms_class_subjects cs
                     JOIN ssms_subjects s ON s.subject_id = cs.subject_id
                     WHERE cs.id = ?",
                    [$classSubjectId]
                )->fetchAll('assoc')[0] ?? null;
                $label = $sub['subject_name'] ?? '';
            }
            $teacher = '';
            if ($staffId) {
                $s = $conn->execute(
                    "SELECT CONCAT(first_name,' ',last_name) AS n FROM ssms_staff
                     WHERE staff_id = ? AND ssms_client_code = ?",
                    [$staffId, $clientCode]
                )->fetchAll('assoc')[0] ?? null;
                $teacher = $s['n'] ?? '';
            }

            echo json_encode(['ok'=>true, 'subject'=>$label, 'teacher'=>$teacher, 'room'=>$room]);
        } catch (\Exception $e) {
            echo json_encode(['ok'=>false, 'msg'=>$e->getMessage()]);
        }

        return $this->response->withType('application/json');
    }

    // ── clearSlot (AJAX) ──────────────────────────────────────────────────────

    public function clearSlot()
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->disableAutoLayout();

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');
        $d          = $this->request->getData();

        $conn->execute(
            "DELETE FROM ssms_timetable
             WHERE ssms_client_code = ? AND session_id = ?
               AND class_id = ? AND section_id = ?
               AND day_of_week = ? AND period_id = ?",
            [
                $clientCode, (int)$d['session_id'],
                (int)$d['class_id'], (int)$d['section_id'],
                (int)$d['day_of_week'], (int)$d['period_id'],
            ]
        );

        echo json_encode(['ok' => true]);
        return $this->response->withType('application/json');
    }

    // ── copyDay (AJAX) ───────────────────────────────────────────────────────
    // Copies all slots from one source day to one or more target days.
    // Existing slots on target days are cleared first (full replace).

    public function copyDay()
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->disableAutoLayout();

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');
        $d          = $this->request->getData();

        $sessionId  = (int)($d['session_id']  ?? 0);
        $classId    = (int)($d['class_id']    ?? 0);
        $sectionId  = (int)($d['section_id']  ?? 0);
        $sourceDay  = (int)($d['source_day']  ?? 0);
        $mode       = $d['mode'] ?? 'all'; // 'all' | 'weekdays'

        if (!$sessionId || !$classId || !$sectionId || !$sourceDay) {
            echo json_encode(['ok' => false, 'msg' => 'Missing required fields.']);
            return $this->response->withType('application/json');
        }

        // Fetch source day slots
        $sourceSlots = $conn->execute(
            "SELECT period_id, class_subject_id, staff_id, room
             FROM ssms_timetable
             WHERE ssms_client_code = ? AND session_id = ?
               AND class_id = ? AND section_id = ? AND day_of_week = ?",
            [$clientCode, $sessionId, $classId, $sectionId, $sourceDay]
        )->fetchAll('assoc');

        if (empty($sourceSlots)) {
            echo json_encode(['ok' => false, 'msg' => 'Source day has no slots to copy.']);
            return $this->response->withType('application/json');
        }

        // Target days
        $allDays      = [1, 2, 3, 4, 5, 6]; // Mon–Sat
        $weekdaysOnly = [1, 2, 3, 4, 5];     // Mon–Fri
        $targetDays   = array_filter(
            $mode === 'weekdays' ? $weekdaysOnly : $allDays,
            fn($d) => $d !== $sourceDay
        );

        try {
            foreach ($targetDays as $targetDay) {
                // Clear target day first
                $conn->execute(
                    "DELETE FROM ssms_timetable
                     WHERE ssms_client_code = ? AND session_id = ?
                       AND class_id = ? AND section_id = ? AND day_of_week = ?",
                    [$clientCode, $sessionId, $classId, $sectionId, $targetDay]
                );

                // Copy each slot
                foreach ($sourceSlots as $slot) {
                    $conn->execute(
                        "INSERT INTO ssms_timetable
                            (ssms_client_code, session_id, class_id, section_id,
                             day_of_week, period_id, class_subject_id, staff_id, room)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [
                            $clientCode, $sessionId, $classId, $sectionId,
                            $targetDay,
                            $slot['period_id'],
                            $slot['class_subject_id'] ?: null,
                            $slot['staff_id']         ?: null,
                            $slot['room']             ?: null,
                        ]
                    );
                }
            }

            $copied = count($sourceSlots);
            $days   = count($targetDays);
            echo json_encode([
                'ok'  => true,
                'msg' => "Copied {$copied} slots to {$days} day(s). Reload to see the updated grid.",
            ]);
        } catch (\Exception $e) {
            echo json_encode(['ok' => false, 'msg' => $e->getMessage()]);
        }

        return $this->response->withType('application/json');
    }

    // ── view ──────────────────────────────────────────────────────────────────
    // Read-only class timetable grid

    public function view()
    {
        $clientCode = $this->_clientCode();
        if (!$clientCode) {
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $conn      = ConnectionManager::get('default');
        $drops     = $this->_loadDropdowns($clientCode);

        $sessionId = (int)($this->request->getQuery('session_id') ?? ($drops['sessions'][0]['session_id'] ?? 0));
        $classId   = (int)($this->request->getQuery('class_id')   ?? ($drops['classes'][0]['class_id']   ?? 0));
        $sectionId = (int)($this->request->getQuery('section_id') ?? 0);

        $sections = [];
        if ($classId) {
            $sections = $conn->execute(
                "SELECT section_id, section_name FROM ssms_sections
                 WHERE ssms_client_code = ? AND class_id = ? ORDER BY section_name",
                [$clientCode, $classId]
            )->fetchAll('assoc');
            if (!$sectionId && $sections) $sectionId = (int)$sections[0]['section_id'];
        }

        $grid = [];
        if ($classId && $sectionId && $sessionId) {
            $rows = $conn->execute(
                "SELECT t.*, CONCAT(st.first_name,' ',st.last_name) AS staff_name,
                        sub.subject_name, cs.subject_code
                 FROM ssms_timetable t
                 LEFT JOIN ssms_staff          st  ON st.staff_id    = t.staff_id    AND st.ssms_client_code  = t.ssms_client_code
                 LEFT JOIN ssms_class_subjects cs  ON cs.id          = t.class_subject_id
                 LEFT JOIN ssms_subjects       sub ON sub.subject_id = cs.subject_id
                 WHERE t.ssms_client_code = ? AND t.session_id = ?
                   AND t.class_id = ? AND t.section_id = ?",
                [$clientCode, $sessionId, $classId, $sectionId]
            )->fetchAll('assoc');

            foreach ($rows as $r) {
                $grid[(int)$r['day_of_week']][(int)$r['period_id']] = $r;
            }
        }

        // Class + section labels for heading
        $classLabel = ''; $sectionLabel = '';
        foreach ($drops['classes']  as $c) { if ((int)$c['class_id']   === $classId)   $classLabel   = $c['class_name'];   }
        foreach ($sections          as $s) { if ((int)$s['section_id'] === $sectionId) $sectionLabel = $s['section_name']; }

        $days = [1=>'Monday',2=>'Tuesday',3=>'Wednesday',4=>'Thursday',5=>'Friday',6=>'Saturday'];

        $this->set(compact('sessionId','classId','sectionId','sections','grid','days','classLabel','sectionLabel'));
        $this->set($drops);
        $this->set('isAdminOrOwner', $this->_isAdminOrOwner());
    }

    // ── teacherView ───────────────────────────────────────────────────────────
    // All slots a teacher is assigned across all classes for a session

    public function teacherView()
    {
        $clientCode = $this->_clientCode();
        if (!$clientCode) {
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $conn    = ConnectionManager::get('default');
        $drops   = $this->_loadDropdowns($clientCode);

        $sessionId = (int)($this->request->getQuery('session_id') ?? ($drops['sessions'][0]['session_id'] ?? 0));
        $staffId   = (int)($this->request->getQuery('staff_id')   ?? ($drops['staff'][0]['staff_id']      ?? 0));

        $grid = [];
        $teacherName = '';
        if ($staffId && $sessionId) {
            foreach ($drops['staff'] as $s) {
                if ((int)$s['staff_id'] === $staffId) { $teacherName = $s['staff_name']; break; }
            }
            $rows = $conn->execute(
                "SELECT t.*, c.class_name, sec.section_name, sub.subject_name, cs.subject_code
                 FROM ssms_timetable t
                 LEFT JOIN ssms_classes        c   ON c.class_id    = t.class_id    AND c.ssms_client_code   = t.ssms_client_code
                 LEFT JOIN ssms_sections       sec ON sec.section_id = t.section_id AND sec.ssms_client_code = t.ssms_client_code
                 LEFT JOIN ssms_class_subjects cs  ON cs.id          = t.class_subject_id
                 LEFT JOIN ssms_subjects       sub ON sub.subject_id = cs.subject_id
                 WHERE t.ssms_client_code = ? AND t.session_id = ? AND t.staff_id = ?",
                [$clientCode, $sessionId, $staffId]
            )->fetchAll('assoc');

            foreach ($rows as $r) {
                $grid[(int)$r['day_of_week']][(int)$r['period_id']] = $r;
            }
        }

        $days = [1=>'Monday',2=>'Tuesday',3=>'Wednesday',4=>'Thursday',5=>'Friday',6=>'Saturday'];

        $this->set(compact('sessionId','staffId','teacherName','grid','days'));
        $this->set($drops);
        $this->set('isAdminOrOwner', $this->_isAdminOrOwner());
    }

    // ── masterView ────────────────────────────────────────────────────────────
    // All periods (rows) × all class-sections (columns) for a given day.
    // Since schools typically run the same schedule every day, day defaults to Monday.

    public function masterView()
    {
        $clientCode = $this->_clientCode();
        if (!$clientCode) {
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $conn  = ConnectionManager::get('default');
        $drops = $this->_loadDropdowns($clientCode);

        $sessionId = (int)($this->request->getQuery('session_id') ?? ($drops['sessions'][0]['session_id'] ?? 0));
        $branchId  = (int)($this->request->getQuery('branch_id') ?? 0);

        // Load branches for filter dropdown
        $branches = $conn->execute(
            "SELECT branch_id, branch_name FROM ssms_branch
             WHERE ssms_client_code = ? ORDER BY branch_name",
            [$clientCode]
        )->fetchAll('assoc');

        // Since the school uses the same schedule every day, we always read from Monday (day 1).
        $fixedDay = 1;

        // All class-section combinations that have timetable entries for this session,
        // optionally filtered by branch via student enrollment.
        $columns = [];
        if ($sessionId) {
            if ($branchId) {
                $colRows = $conn->execute(
                    "SELECT DISTINCT t.class_id, t.section_id,
                            c.class_name, sec.section_name
                     FROM ssms_timetable t
                     LEFT JOIN ssms_classes  c   ON c.class_id    = t.class_id    AND c.ssms_client_code   = t.ssms_client_code
                     LEFT JOIN ssms_sections sec ON sec.section_id = t.section_id AND sec.ssms_client_code = t.ssms_client_code
                     INNER JOIN ssms_student_enrollment se
                            ON se.class_id          = t.class_id
                           AND se.section_id        = t.section_id
                           AND se.session_id        = t.session_id
                           AND se.branch_id         = ?
                           AND se.ssms_client_code  = t.ssms_client_code
                     WHERE t.ssms_client_code = ? AND t.session_id = ?
                     ORDER BY c.class_name, sec.section_name",
                    [$branchId, $clientCode, $sessionId]
                )->fetchAll('assoc');
            } else {
                $colRows = $conn->execute(
                    "SELECT DISTINCT t.class_id, t.section_id,
                            c.class_name, sec.section_name
                     FROM ssms_timetable t
                     LEFT JOIN ssms_classes  c   ON c.class_id    = t.class_id    AND c.ssms_client_code   = t.ssms_client_code
                     LEFT JOIN ssms_sections sec ON sec.section_id = t.section_id AND sec.ssms_client_code = t.ssms_client_code
                     WHERE t.ssms_client_code = ? AND t.session_id = ?
                     ORDER BY c.class_name, sec.section_name",
                    [$clientCode, $sessionId]
                )->fetchAll('assoc');
            }

            foreach ($colRows as $r) {
                $key = $r['class_id'] . '_' . $r['section_id'];
                $columns[$key] = [
                    'class_id'     => $r['class_id'],
                    'section_id'   => $r['section_id'],
                    'class_name'   => $r['class_name'],
                    'section_name' => $r['section_name'],
                    'label'        => $r['class_name'] . ($r['section_name'] ? ' · ' . $r['section_name'] : ''),
                ];
            }
        }

        // Grid: grid[period_id][class_section_key] = {subject_name, staff_name, room}
        $grid = [];
        if ($sessionId && $columns) {
            $rows = $conn->execute(
                "SELECT t.period_id, t.class_id, t.section_id,
                        sub.subject_name, cs.subject_code,
                        CONCAT(s.first_name,' ',s.last_name) AS staff_name,
                        t.room
                 FROM ssms_timetable t
                 LEFT JOIN ssms_class_subjects cs  ON cs.id          = t.class_subject_id
                 LEFT JOIN ssms_subjects       sub ON sub.subject_id = cs.subject_id
                 LEFT JOIN ssms_staff          s   ON s.staff_id     = t.staff_id AND s.ssms_client_code = t.ssms_client_code
                 WHERE t.ssms_client_code = ? AND t.session_id = ? AND t.day_of_week = ?",
                [$clientCode, $sessionId, $fixedDay]
            )->fetchAll('assoc');

            foreach ($rows as $r) {
                $key = $r['class_id'] . '_' . $r['section_id'];
                $grid[(int)$r['period_id']][$key] = $r;
            }
        }

        // School info for PDF header
        $school = $conn->execute(
            "SELECT ssms_client_header_text, ssms_client_address
             FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetch('assoc');

        // Current session name for PDF header
        $sessionName = '';
        foreach ($drops['sessions'] as $s) {
            if ((int)$s['session_id'] === $sessionId) {
                $sessionName = $s['session_name'];
                break;
            }
        }

        $this->set(compact('sessionId','branchId','branches','columns','grid','school','sessionName'));
        $this->set($drops);
        $this->set('isAdminOrOwner', $this->_isAdminOrOwner());
    }
}
