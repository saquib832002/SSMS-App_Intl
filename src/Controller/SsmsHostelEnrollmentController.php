<?php
declare(strict_types=1);
namespace App\Controller;
use Cake\Datasource\ConnectionManager;

class SsmsHostelEnrollmentController extends AppController
{
    private function _cc(): string { return (string)$this->request->getSession()->read('ssms_client_code'); }

    /** Enrolled students (active hostel enrollments) */
    public function hostelEnrolledStudents()
    {
        $cc = $this->_cc();
        $db = ConnectionManager::get('default');
        $search = trim((string)($this->request->getQuery('search') ?? ''));

        $sql = "SELECT he.enrollment_id, he.current_status, he.de_enroll_date,
                       he.building_id, he.room_id, he.seat_id,
                       TRIM(CONCAT_WS(' ', r.student_first_name, r.student_last_name)) AS student_name,
                       r.mobile_number, r.email_address,
                       COALESCE(sc.class_name,'')    AS class_name,
                       COALESCE(ss.session_name,'')  AS session_name,
                       COALESCE(b.building_name,'')  AS building_name,
                       COALESCE(rm.room_name,'')     AS room_name,
                       COALESCE(st.seat_number,'')   AS seat_number
                FROM   ssms_hostel_enrollment he
                JOIN   ssms_student_enrollment   se ON se.enrollment_id   = he.enrollment_id
                JOIN   ssms_student_registration r  ON r.registration_id  = se.registration_id
                LEFT JOIN ssms_classes    sc ON sc.class_id    = he.class_id
                LEFT JOIN ssms_sessions   ss ON ss.session_id  = he.session_id
                LEFT JOIN ssms_building   b  ON b.building_id  = he.building_id
                LEFT JOIN ssms_rooms      rm ON rm.room_id     = he.room_id
                LEFT JOIN ssms_room_seats st ON st.seat_id     = he.seat_id
                WHERE  he.ssms_client_code = ? AND he.current_status = 'active'";
        $params = [$cc];
        if ($search) {
            $sql .= " AND (r.student_first_name LIKE ? OR r.student_last_name LIKE ? OR r.mobile_number LIKE ?)";
            $like = "%{$search}%";
            $params = array_merge($params, [$like, $like, $like]);
        }
        $sql .= " ORDER BY student_name ASC";
        $students = $db->execute($sql, $params)->fetchAll('assoc');

        $this->set(compact('students', 'search'));
    }

    /** Students NOT currently enrolled in hostel — enrolment form */
    public function hostelNotEnrolled()
    {
        $cc = $this->_cc();
        $db = ConnectionManager::get('default');

        // Handle enrolment POST
        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $enrollmentId = trim((string)($d['enrollment_id'] ?? ''));
            $buildingId   = (int)($d['building_id']   ?? 0);
            $roomId       = (int)($d['room_id']        ?? 0);
            $seatId       = (int)($d['seat_id']        ?? 0);
            $sessionId    = (int)($d['session_id']     ?? 0);
            $classId      = (int)($d['class_id']       ?? 0);

            if ($enrollmentId && $buildingId && $roomId && $seatId) {
                $regRow = $db->execute(
                    "SELECT registration_id, branch_id, section_id FROM ssms_student_enrollment WHERE enrollment_id=? AND ssms_client_code=? LIMIT 1",
                    [$enrollmentId, $cc]
                )->fetchAssoc();
                if ($regRow) {
                    $sectionId = (int)($regRow['section_id'] ?? 0);
                    $branchId  = (int)($regRow['branch_id']  ?? 0);

                    $seatRow = $db->execute(
                        "SELECT status FROM ssms_room_seats WHERE seat_id=? AND ssms_client_code=? LIMIT 1",
                        [$seatId, $cc]
                    )->fetchAssoc();

                    if ($seatRow && $seatRow['status'] === 'available') {
                        // Check if an inactive record already exists for this composite key
                        // (student was previously de-enrolled in the same session)
                        $existing = $db->execute(
                            "SELECT enrollment_id FROM ssms_hostel_enrollment
                             WHERE enrollment_id=? AND session_id=? AND class_id=? AND section_id=? AND ssms_client_code=? LIMIT 1",
                            [$enrollmentId, $sessionId, $classId, $sectionId, $cc]
                        )->fetchAssoc();

                        if ($existing) {
                            // Re-enroll: update existing (inactive) row
                            $db->execute(
                                "UPDATE ssms_hostel_enrollment
                                 SET building_id=?, room_id=?, seat_id=?, registration_id=?, branch_id=?,
                                     current_status='active', de_enroll_date=NULL, modified=NOW()
                                 WHERE enrollment_id=? AND session_id=? AND class_id=? AND section_id=? AND ssms_client_code=?",
                                [$buildingId, $roomId, $seatId, $regRow['registration_id'], $branchId,
                                 $enrollmentId, $sessionId, $classId, $sectionId, $cc]
                            );
                        } else {
                            // First-time enroll: insert new row
                            $db->execute(
                                "INSERT INTO ssms_hostel_enrollment
                                    (enrollment_id, registration_id, session_id, class_id, section_id, branch_id,
                                     building_id, room_id, seat_id, ssms_client_code, current_status, created, modified)
                                 VALUES (?,?,?,?,?,?,?,?,?,?,'active',NOW(),NOW())",
                                [$enrollmentId, $regRow['registration_id'], $sessionId, $classId,
                                 $sectionId, $branchId, $buildingId, $roomId, $seatId, $cc]
                            );
                        }

                        $db->execute("UPDATE ssms_room_seats SET status='occupied' WHERE seat_id=?", [$seatId]);
                        $this->Flash->success('Student enrolled in hostel successfully.');
                        return $this->redirect(['action' => 'hostelEnrolledStudents']);
                    } else {
                        $this->Flash->error('Selected seat is no longer available.');
                    }
                } else {
                    $this->Flash->error('Student enrollment not found.');
                }
            } else {
                $this->Flash->error('Please fill all required fields.');
            }
        }

        // Students not enrolled in hostel
        $students = $db->execute(
            "SELECT DISTINCT se.enrollment_id, se.class_id, se.session_id,
                    TRIM(CONCAT_WS(' ', r.student_first_name, r.student_last_name)) AS student_name,
                    COALESCE(sc.class_name,'') AS class_name,
                    COALESCE(ss.session_name,'') AS session_name
             FROM  ssms_student_enrollment se
             JOIN  ssms_student_registration r ON r.registration_id = se.registration_id
             LEFT JOIN ssms_classes  sc ON sc.class_id   = se.class_id
             LEFT JOIN ssms_sessions ss ON ss.session_id = se.session_id
             WHERE se.ssms_client_code = ?
               AND NOT EXISTS (
                   SELECT 1 FROM ssms_hostel_enrollment he
                   WHERE he.enrollment_id = se.enrollment_id AND he.current_status = 'active' AND he.ssms_client_code = ?
               )
             ORDER BY student_name ASC",
            [$cc, $cc]
        )->fetchAll('assoc');

        $buildings = $db->execute(
            "SELECT building_id, building_name, building_type FROM ssms_building WHERE ssms_client_code=? ORDER BY building_name",
            [$cc]
        )->fetchAll('assoc');
        $rooms = $db->execute(
            "SELECT r.room_id, r.room_name, r.building_id FROM ssms_rooms r
             JOIN ssms_building b ON b.building_id=r.building_id WHERE b.ssms_client_code=? ORDER BY r.room_name",
            [$cc]
        )->fetchAll('assoc');
        $seats = $db->execute(
            "SELECT seat_id, seat_number, room_id, building_id FROM ssms_room_seats WHERE ssms_client_code=? AND status='available' ORDER BY seat_number",
            [$cc]
        )->fetchAll('assoc');

        $this->set(compact('students', 'buildings', 'rooms', 'seats'));
    }

    /** De-enrol view — same as enrolled students but with de-enrol button */
    public function index()
    {
        $cc = $this->_cc();
        $db = ConnectionManager::get('default');

        // Handle de-enrol POST
        if ($this->request->is('post') && $this->request->getData('action') === 'deenroll') {
            $enrollmentId = trim((string)$this->request->getData('enrollment_id'));
            $deEnrolDate  = $this->request->getData('de_enroll_date') ?: date('Y-m-d');
            if ($enrollmentId) {
                $row = $db->execute(
                    "SELECT he.seat_id, he.room_id, he.building_id
                     FROM ssms_hostel_enrollment he
                     WHERE he.enrollment_id=? AND he.ssms_client_code=? AND he.current_status='active' LIMIT 1",
                    [$enrollmentId, $cc]
                )->fetchAssoc();
                if ($row) {
                    $db->execute(
                        "UPDATE ssms_hostel_enrollment SET current_status='inactive', de_enroll_date=?, modified=NOW() WHERE enrollment_id=? AND ssms_client_code=?",
                        [$deEnrolDate, $enrollmentId, $cc]
                    );
                    $seatId = (int)($row['seat_id'] ?? 0);
                    if ($seatId > 0) {
                        // Free the specific seat
                        $db->execute(
                            "UPDATE ssms_room_seats SET status='available' WHERE seat_id=? AND ssms_client_code=?",
                            [$seatId, $cc]
                        );
                    } elseif (!empty($row['room_id'])) {
                        // Fallback: free any occupied seat in the same room with no active enrollment
                        $db->execute(
                            "UPDATE ssms_room_seats SET status='available'
                             WHERE room_id=? AND ssms_client_code=? AND status='occupied'
                               AND seat_id NOT IN (
                                   SELECT seat_id FROM ssms_hostel_enrollment
                                   WHERE room_id=? AND ssms_client_code=? AND current_status='active' AND seat_id IS NOT NULL
                               )",
                            [(int)$row['room_id'], $cc, (int)$row['room_id'], $cc]
                        );
                    }
                    $this->Flash->success('Student de-enrolled from hostel.');
                }
            }
            return $this->redirect(['action' => 'index']);
        }

        $students = $db->execute(
            "SELECT he.enrollment_id, he.current_status,
                    TRIM(CONCAT_WS(' ', r.student_first_name, r.student_last_name)) AS student_name,
                    r.mobile_number,
                    COALESCE(sc.class_name,'')   AS class_name,
                    COALESCE(ss.session_name,'') AS session_name,
                    COALESCE(b.building_name,'') AS building_name,
                    COALESCE(rm.room_name,'')    AS room_name,
                    COALESCE(st.seat_number,'')  AS seat_number
             FROM   ssms_hostel_enrollment he
             JOIN   ssms_student_enrollment   se ON se.enrollment_id  = he.enrollment_id
             JOIN   ssms_student_registration r  ON r.registration_id = se.registration_id
             LEFT JOIN ssms_classes    sc ON sc.class_id   = he.class_id
             LEFT JOIN ssms_sessions   ss ON ss.session_id = he.session_id
             LEFT JOIN ssms_building   b  ON b.building_id = he.building_id
             LEFT JOIN ssms_rooms      rm ON rm.room_id    = he.room_id
             LEFT JOIN ssms_room_seats st ON st.seat_id    = he.seat_id
             WHERE  he.ssms_client_code = ? AND he.current_status = 'active'
             ORDER  BY student_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $this->set(compact('students'));
    }

    public function edit($id = null) { return $this->redirect(['action' => 'index']); }
    public function view($id = null) { return $this->redirect(['action' => 'index']); }
    public function add()            { return $this->redirect(['action' => 'hostelNotEnrolled']); }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $e = $this->SsmsHostelEnrollment->get($id);
        $this->SsmsHostelEnrollment->delete($e);
        return $this->redirect(['action' => 'index']);
    }
}
