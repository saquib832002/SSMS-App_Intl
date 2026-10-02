<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

/**
 * HostelServiceApiController
 * File: src/Controller/HostelServiceApiController.php
 *
 * Add to config/routes.php:
 *   // Buildings
 *   $builder->get('/hostelServiceApi/getBuildings',            ['controller'=>'HostelServiceApi','action'=>'getBuildings']);
 *   $builder->post('/hostelServiceApi/saveBuilding',           ['controller'=>'HostelServiceApi','action'=>'saveBuilding']);
 *   $builder->put('/hostelServiceApi/saveBuilding',            ['controller'=>'HostelServiceApi','action'=>'saveBuilding']);
 *   $builder->delete('/hostelServiceApi/deleteBuilding/{id}',  ['controller'=>'HostelServiceApi','action'=>'deleteBuilding']);
 *   // Rooms
 *   $builder->get('/hostelServiceApi/getRooms',                ['controller'=>'HostelServiceApi','action'=>'getRooms']);
 *   $builder->post('/hostelServiceApi/saveRoom',               ['controller'=>'HostelServiceApi','action'=>'saveRoom']);
 *   $builder->put('/hostelServiceApi/saveRoom',                ['controller'=>'HostelServiceApi','action'=>'saveRoom']);
 *   $builder->delete('/hostelServiceApi/deleteRoom/{id}',      ['controller'=>'HostelServiceApi','action'=>'deleteRoom']);
 *   // Seats
 *   $builder->get('/hostelServiceApi/getSeats',                ['controller'=>'HostelServiceApi','action'=>'getSeats']);
 *   $builder->post('/hostelServiceApi/saveSeat',               ['controller'=>'HostelServiceApi','action'=>'saveSeat']);
 *   $builder->put('/hostelServiceApi/saveSeat',                ['controller'=>'HostelServiceApi','action'=>'saveSeat']);
 *   $builder->delete('/hostelServiceApi/deleteSeat/{id}',      ['controller'=>'HostelServiceApi','action'=>'deleteSeat']);
 *
 * Add 'HostelServiceApi' to $apiControllers list in AppController.php
 */
class HostelServiceApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        // CakePHP 5: use Json view class — no template files needed
        $this->viewBuilder()->setClassName('Json');
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->response = $this->response->withType('application/json');
    }

    // ── Helper: read clientCode from JWT or header ────────────────────────────
    private function getClientCode(): string
    {
        return $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? '';
    }

    // ── Helper: check if caller is admin or owner ─────────────────────────────
    private function isAdminOrOwner(): bool
    {
        $role = strtolower(trim((string)(
            $this->request->getAttribute('jwt_role')
            ?? $this->request->getHeaderLine('ssmsUserRole')
            ?? ''
        )));
        return in_array($role, ['admin', 'owner'], true);
    }

    // ── Helper: JSON error ────────────────────────────────────────────────────
    private function jsonError(int $status, string $message): void
    {
        $this->response = $this->response->withStatus($status);
        $this->set(['status' => false, 'message' => $message]);
        $this->viewBuilder()->setOption('serialize', ['status', 'message']);
    }

    // ── Helper: JSON success ──────────────────────────────────────────────────
    private function jsonOk(array $data): void
    {
        $this->set(array_merge(['status' => true], $data));
        $this->viewBuilder()->setOption('serialize', array_keys(
            array_merge(['status' => true], $data)
        ));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BUILDINGS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /hostelServiceApi/getBuildings
     * Returns all buildings for the current client.
     */
    public function getBuildings(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized'); return; }

        $db = $this->getTableLocator()->get('SsmsBuilding')->getConnection();
        $buildings = $db->execute(
            "SELECT building_id, building_number, building_name, building_type, ssms_client_code
             FROM   ssms_building
             WHERE  ssms_client_code = ?
             ORDER  BY building_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['buildings' => $buildings]);
    }

    /**
     * POST/PUT /hostelServiceApi/saveBuilding
     * Insert (POST) or update (PUT) a building.
     * Admin / owner only.
     */
    public function saveBuilding(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized'); return; }

        $body = $this->request->getData();
        $buildingId     = !empty($body['building_id'])     ? (int)$body['building_id']            : null;
        $buildingName   = trim((string)($body['building_name']   ?? ''));
        $buildingNumber = trim((string)($body['building_number'] ?? ''));
        $buildingType   = trim((string)($body['building_type']   ?? ''));

        if (!$buildingName)   { $this->jsonError(422, 'building_name is required.');   return; }
        if (!$buildingNumber) { $this->jsonError(422, 'building_number is required.'); return; }
        if (!$buildingType)   { $this->jsonError(422, 'building_type is required.');   return; }

        $db    = $this->getTableLocator()->get('SsmsBuilding')->getConnection();
        $table = $this->getTableLocator()->get('SsmsBuilding');

        if ($buildingId) {
            // ── UPDATE ────────────────────────────────────────────────────────
            $existing = $table->find()->where(['building_id' => $buildingId, 'ssms_client_code' => $clientCode])->first();
            if (!$existing) { $this->jsonError(404, 'Building not found.'); return; }

            // Check duplicate name (excluding self)
            $duplicate = $db->execute(
                "SELECT building_id FROM ssms_building
                 WHERE building_name = ? AND ssms_client_code = ? AND building_id != ?",
                [$buildingName, $clientCode, $buildingId]
            )->fetchAssoc();
            if ($duplicate) {
                $this->jsonError(409, "A building named \"{$buildingName}\" already exists. Please use a different name.");
                return;
            }

            $db->execute(
                "UPDATE ssms_building
                 SET    building_name = ?, building_number = ?, building_type = ?
                 WHERE  building_id = ? AND ssms_client_code = ?",
                [$buildingName, $buildingNumber, $buildingType, $buildingId, $clientCode]
            );
            Log::info("saveBuilding: updated {$buildingId} by {$clientCode}");
            $this->jsonOk(['message' => 'Building updated successfully.', 'building_id' => $buildingId]);
        } else {
            // ── INSERT ────────────────────────────────────────────────────────
            // Check duplicate name
            $duplicate = $db->execute(
                "SELECT building_id FROM ssms_building
                 WHERE building_name = ? AND ssms_client_code = ?",
                [$buildingName, $clientCode]
            )->fetchAssoc();
            if ($duplicate) {
                $this->jsonError(409, "A building named \"{$buildingName}\" already exists. Please use a different name.");
                return;
            }

            // Check duplicate number
            $dupNumber = $db->execute(
                "SELECT building_id FROM ssms_building
                 WHERE building_number = ? AND ssms_client_code = ?",
                [$buildingNumber, $clientCode]
            )->fetchAssoc();
            if ($dupNumber) {
                $this->jsonError(409, "Building number \"{$buildingNumber}\" is already in use. Please use a different number.");
                return;
            }

            $db->execute(
                "INSERT INTO ssms_building (building_name, building_number, building_type, ssms_client_code)
                 VALUES (?, ?, ?, ?)",
                [$buildingName, $buildingNumber, $buildingType, $clientCode]
            );
            $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;
            Log::info("saveBuilding: created {$newId} by {$clientCode}");
            $this->jsonOk(['message' => 'Building added successfully.', 'building_id' => $newId]);
        }
    }

    /**
     * DELETE /hostelServiceApi/deleteBuilding/{id}
     * Delete a building — blocked if rooms exist for it.
     * Admin / owner only.
     */
    public function deleteBuilding(?int $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db = $this->getTableLocator()->get('SsmsBuilding')->getConnection();

        // Check if rooms exist for this building
        $roomCount = (int)$db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_rooms WHERE building_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc()['cnt'];

        if ($roomCount > 0) {
            $this->jsonError(409,
                "Cannot delete: {$roomCount} room(s) are assigned to this building. " .
                "Delete all rooms first."
            );
            return;
        }

        // Verify ownership
        $building = $db->execute(
            "SELECT building_id FROM ssms_building WHERE building_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$building) { $this->jsonError(404, 'Building not found.'); return; }

        $db->execute("DELETE FROM ssms_building WHERE building_id = ? AND ssms_client_code = ?", [$id, $clientCode]);
        Log::info("deleteBuilding: deleted {$id} by {$clientCode}");
        $this->jsonOk(['message' => 'Building deleted successfully.']);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ROOMS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /hostelServiceApi/getRooms?buildingId=X
     */
    public function getRooms(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode  = $this->getClientCode();
        $buildingId  = (int)($this->request->getQuery('buildingId') ?? 0);
        if (!$clientCode || !$buildingId) { $this->jsonError(422, 'buildingId is required.'); return; }

        $db = $this->getTableLocator()->get('SsmsRooms')->getConnection();
        $rooms = $db->execute(
            "SELECT r.room_id, r.room_name, r.building_id,
                    COUNT(s.seat_id) AS seat_count
             FROM   ssms_rooms r
             LEFT   JOIN ssms_room_seats s ON s.room_id = r.room_id
             WHERE  r.building_id = ? AND r.ssms_client_code = ?
             GROUP  BY r.room_id
             ORDER  BY r.room_name ASC",
            [$buildingId, $clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['rooms' => $rooms]);
    }

    /**
     * POST/PUT /hostelServiceApi/saveRoom
     */
    public function saveRoom(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }

        $clientCode = $this->getClientCode();
        $body       = $this->request->getData();
        $roomId     = !empty($body['room_id'])     ? (int)$body['room_id']     : null;
        $roomName   = trim((string)($body['room_name']   ?? ''));
        $buildingId = !empty($body['building_id']) ? (int)$body['building_id'] : null;

        if (!$roomName)   { $this->jsonError(422, 'room_name is required.');   return; }
        if (!$buildingId) { $this->jsonError(422, 'building_id is required.'); return; }
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $db = $this->getTableLocator()->get('SsmsRooms')->getConnection();

        if ($roomId) {
            // Check duplicate room name in same building (excluding self)
            $dup = $db->execute(
                "SELECT room_id FROM ssms_rooms WHERE room_name = ? AND building_id = ? AND ssms_client_code = ? AND room_id != ?",
                [$roomName, $buildingId, $clientCode, $roomId]
            )->fetchAssoc();
            if ($dup) { $this->jsonError(409, "A room named \"{$roomName}\" already exists in this building."); return; }

            $db->execute(
                "UPDATE ssms_rooms SET room_name = ? WHERE room_id = ? AND ssms_client_code = ?",
                [$roomName, $roomId, $clientCode]
            );
            $this->jsonOk(['message' => 'Room updated.', 'room_id' => $roomId]);
        } else {
            // Check duplicate room name in same building
            $dup = $db->execute(
                "SELECT room_id FROM ssms_rooms WHERE room_name = ? AND building_id = ? AND ssms_client_code = ?",
                [$roomName, $buildingId, $clientCode]
            )->fetchAssoc();
            if ($dup) { $this->jsonError(409, "A room named \"{$roomName}\" already exists in this building."); return; }

            $db->execute(
                "INSERT INTO ssms_rooms (room_name, building_id, ssms_client_code) VALUES (?, ?, ?)",
                [$roomName, $buildingId, $clientCode]
            );
            $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;
            $this->jsonOk(['message' => 'Room added.', 'room_id' => $newId]);
        }
    }

    /**
     * DELETE /hostelServiceApi/deleteRoom/{id}
     * Blocked if seats exist for this room.
     */
    public function deleteRoom(?int $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db = $this->getTableLocator()->get('SsmsRooms')->getConnection();

        $seatCount = (int)$db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_room_seats WHERE room_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc()['cnt'];

        if ($seatCount > 0) {
            $this->jsonError(409,
                "Cannot delete: {$seatCount} seat(s) are in this room. Delete all seats first."
            );
            return;
        }

        $room = $db->execute(
            "SELECT room_id FROM ssms_rooms WHERE room_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$room) { $this->jsonError(404, 'Room not found.'); return; }

        $db->execute("DELETE FROM ssms_rooms WHERE room_id = ? AND ssms_client_code = ?", [$id, $clientCode]);
        $this->jsonOk(['message' => 'Room deleted.']);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SEATS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /hostelServiceApi/getSeats?roomId=X
     */
    public function getSeats(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        $roomId     = (int)($this->request->getQuery('roomId') ?? 0);
        if (!$clientCode || !$roomId) { $this->jsonError(422, 'roomId is required.'); return; }

        $db = $this->getTableLocator()->get('SsmsRoomSeats')->getConnection();
        $seats = $db->execute(
            "SELECT s.seat_id, s.seat_number, s.status, s.room_id, s.building_id
             FROM   ssms_room_seats s
             WHERE  s.room_id = ? AND s.ssms_client_code = ?
             ORDER  BY s.seat_number ASC",
            [$roomId, $clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['seats' => $seats]);
    }

    /**
     * POST/PUT /hostelServiceApi/saveSeat
     */
    public function saveSeat(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }

        $clientCode = $this->getClientCode();
        $body       = $this->request->getData();
        $seatId     = !empty($body['seat_id'])     ? (int)$body['seat_id']     : null;
        $seatNumber = trim((string)($body['seat_number'] ?? ''));
        $status     = trim((string)($body['status']      ?? 'available'));
        $roomId     = !empty($body['room_id'])     ? (int)$body['room_id']     : null;
        $buildingId = !empty($body['building_id']) ? (int)$body['building_id'] : null;

        $allowedStatuses = ['available', 'occupied', 'reserved', 'maintenance'];
        if (!$seatNumber)                          { $this->jsonError(422, 'seat_number is required.');  return; }
        if (!$roomId)                              { $this->jsonError(422, 'room_id is required.');      return; }
        if (!$buildingId)                          { $this->jsonError(422, 'building_id is required.');  return; }
        if (!in_array($status, $allowedStatuses))  { $this->jsonError(422, 'Invalid status value.');     return; }
        if (!$clientCode)                          { $this->jsonError(401, 'Unauthorized.');              return; }

        $db = $this->getTableLocator()->get('SsmsRoomSeats')->getConnection();

        if ($seatId) {
            // Check occupied status conflict
            if ($status !== 'occupied') {
                $active = $db->execute(
                    "SELECT COUNT(*) AS cnt FROM ssms_room_seats WHERE seat_id = ? AND status = 'active'",
                    [$seatId]
                )->fetchAssoc()['cnt'] ?? 0;
                if ((int)$active > 0) {
                    $this->jsonError(409, "Cannot change status: a student is currently assigned to this seat.");
                    return;
                }
            }
            // Check duplicate seat number in same room (excluding self)
            $dup = $db->execute(
                "SELECT seat_id FROM ssms_room_seats WHERE seat_number = ? AND room_id = ? AND ssms_client_code = ? AND seat_id != ?",
                [$seatNumber, $roomId, $clientCode, $seatId]
            )->fetchAssoc();
            if ($dup) { $this->jsonError(409, "Seat number \"{$seatNumber}\" already exists in this room."); return; }

            $db->execute(
                "UPDATE ssms_room_seats SET seat_number = ?, status = ?
                 WHERE  seat_id = ? AND ssms_client_code = ?",
                [$seatNumber, $status, $seatId, $clientCode]
            );
            $this->jsonOk(['message' => 'Seat updated.', 'seat_id' => $seatId]);
        } else {
            // Check duplicate seat number in same room
            $dup = $db->execute(
                "SELECT seat_id FROM ssms_room_seats WHERE seat_number = ? AND room_id = ? AND ssms_client_code = ?",
                [$seatNumber, $roomId, $clientCode]
            )->fetchAssoc();
            if ($dup) { $this->jsonError(409, "Seat number \"{$seatNumber}\" already exists in this room."); return; }

            $db->execute(
                "INSERT INTO ssms_room_seats (seat_number, status, room_id, building_id, ssms_client_code)
                 VALUES (?, ?, ?, ?, ?)",
                [$seatNumber, $status, $roomId, $buildingId, $clientCode]
            );
            $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;
            $this->jsonOk(['message' => 'Seat added.', 'seat_id' => $newId]);
        }
    }

    /**
     * DELETE /hostelServiceApi/deleteSeat/{id}
     * Blocked if a student is currently assigned (active hostel enrollment).
     */
    public function deleteSeat(?int $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db = $this->getTableLocator()->get('SsmsRoomSeats')->getConnection();

        // Block delete if a student is assigned
        $active = (int)$db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_room_seats WHERE seat_id = ? AND status = 'occupied'",
            [$id]
        )->fetchAssoc()['cnt'];

        if ($active > 0) {
            $this->jsonError(409,
                "Cannot delete: a student is currently assigned to this seat."
            );
            return;
        }

        $seat = $db->execute(
            "SELECT seat_id FROM ssms_room_seats WHERE seat_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$seat) { $this->jsonError(404, 'Seat not found.'); return; }

        $db->execute("DELETE FROM ssms_room_seats WHERE seat_id = ? AND ssms_client_code = ?", [$id, $clientCode]);
        $this->jsonOk(['message' => 'Seat deleted.']);
    }
    
    // ══════════════════════════════════════════════════════════════════════════
    // GET /hostelServiceApi/getHostelEnrollment?enrollmentId=ENR-001
    // Returns existing hostel enrollment for a student enrollment ID (if any)
    // ══════════════════════════════════════════════════════════════════════════
    public function getHostelEnrollment(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode  = $this->getClientCode();
        $enrollmentId = trim((string)($this->request->getQuery('enrollmentId') ?? ''));
 
        if (!$clientCode || !$enrollmentId) {
            $this->jsonError(422, 'enrollmentId is required.');
            return;
        }
 
        $db = $this->getTableLocator()->get('SsmsHostelEnrollment')->getConnection();
 
        $row = $db->execute(
            "SELECT
                he.enrollment_id   AS enrollmentId,
                he.session_id      AS sessionId,
                he.class_id        AS classId,
                he.section_id      AS sectionId,
                he.branch_id       AS branchId,
                he.building_id     AS buildingId,
                he.room_id         AS roomId,
                he.seat_id         AS seatId,
                he.current_status  AS currentStatus,
                he.de_enroll_date  AS deEnrollDate,
                he.ssms_client_code,
                b.building_name    AS buildingName,
                r.room_name        AS roomName,
                rs.seat_number     AS seatNumber
             FROM  ssms_hostel_enrollment he
             LEFT  JOIN ssms_building    b  ON b.building_id  = he.building_id
             LEFT  JOIN ssms_rooms       r  ON r.room_id      = he.room_id
             LEFT  JOIN ssms_room_seats  rs ON rs.seat_id     = he.seat_id
             WHERE he.enrollment_id   = ?
               AND he.ssms_client_code = ?
             ORDER BY he.enrollment_id DESC
             LIMIT 1",
            [$enrollmentId, $clientCode]
        )->fetchAssoc();
 
        $this->jsonOk(['enrollment' => $row ?: null]);
    }
    
    // ══════════════════════════════════════════════════════════════════════════
    // POST /hostelServiceApi/saveHostelEnrollment
    // Insert or update a hostel enrollment.
    // Admin / owner only.
    // ══════════════════════════════════════════════════════════════════════════
    public function saveHostelEnrollment(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) {
            $this->jsonError(403, 'Admin or owner access required.');
            return;
        }
 
        $clientCode = $this->getClientCode();
        $body       = $this->request->getData();
 
        $hostelEnrollmentId = !empty($body['hostelEnrollmentId']) ? (int)$body['hostelEnrollmentId'] : null;
        $enrollmentId       = trim((string)($body['enrollmentId'] ?? ''));
        $registrationId       = trim((string)($body['registrationId'] ?? ''));
        $sessionId          = !empty($body['sessionId'])  ? (int)$body['sessionId']  : null;
        $classId            = !empty($body['classId'])    ? (int)$body['classId']    : null;
        $sectionId          = !empty($body['sectionId'])  ? (int)$body['sectionId']  : null;
        $branchId           = !empty($body['branchId'])   ? (int)$body['branchId']   : null;
        $buildingId         = !empty($body['buildingId']) ? (int)$body['buildingId'] : null;
        $roomId             = !empty($body['roomId'])     ? (int)$body['roomId']     : null;
        $seatId             = !empty($body['seatId'])     ? (int)$body['seatId']     : null;
 
        // Validation
        $errors = [];
        if (!$enrollmentId) $errors[] = 'enrollmentId is required.';
        if (!$sessionId)    $errors[] = 'sessionId is required.';
        if (!$classId)      $errors[] = 'classId is required.';
        if (!$buildingId)   $errors[] = 'buildingId is required.';
        if (!$roomId)       $errors[] = 'roomId is required.';
        if (!$seatId)       $errors[] = 'seatId is required.';
        if (!empty($errors)) { $this->jsonError(422, implode(' ', $errors)); return; }
 
        $db = $this->getTableLocator()->get('SsmsHostelEnrollment')->getConnection();
 
        try {
            if ($hostelEnrollmentId) {
                // ── UPDATE ────────────────────────────────────────────────────
                // Free the previously occupied seat
                $existing = $db->execute(
                    "SELECT seat_id FROM ssms_hostel_enrollment WHERE id = ? AND ssms_client_code = ?",
                    [$hostelEnrollmentId, $clientCode]
                )->fetchAssoc();
 
                if (!$existing) { $this->jsonError(404, 'Hostel enrolment not found.'); return; }
 
                // Release old seat if seat changed
                if ((int)$existing['seat_id'] !== $seatId) {
                    $db->execute(
                        "UPDATE ssms_room_seats SET status = 'available' WHERE seat_id = ?",
                        [(int)$existing['seat_id']]
                    );
                }
 
                $db->execute(
                    "UPDATE ssms_hostel_enrollment
                     SET session_id = ?, class_id = ?, section_id = ?,
                         branch_id = ?, building_id = ?, room_id = ?, seat_id = ?,
                         current_status = 'active', de_enroll_date = NULL,
                         modified = NOW()
                     WHERE id = ? AND ssms_client_code = ?",
                    [$sessionId, $classId, $sectionId, $branchId,
                     $buildingId, $roomId, $seatId,
                     $hostelEnrollmentId, $clientCode]
                );
            } else {
                // ── INSERT ────────────────────────────────────────────────────
                // Check student not already enrolled
                $alreadyEnrolled = $db->execute(
                    "SELECT enrollment_id FROM ssms_hostel_enrollment
                     WHERE enrollment_id = ? AND ssms_client_code = ? AND current_status = 'active' AND session_id = ? 
                     AND class_id = ? AND section_id = ? AND branch_id = ? 
                     LIMIT 1",
                    [$enrollmentId, $clientCode, $sessionId, $classId, $sectionId, $branchId]
                )->fetchAssoc();
 
                if ($alreadyEnrolled) {
                    $this->jsonError(409, 'This student is already enrolled in a hostel seat.');
                    return;
                }
 
                // Check seat is still available
                $seat = $db->execute(
                    "SELECT status FROM ssms_room_seats WHERE seat_id = ? AND ssms_client_code = ?",
                    [$seatId, $clientCode]
                )->fetchAssoc();
 
                if (!$seat || $seat['status'] !== 'available') {
                    $this->jsonError(409, 'This seat is no longer available. Please select another seat.');
                    return;
                }
 
                $db->execute(
                    "INSERT INTO ssms_hostel_enrollment
                        (enrollment_id, session_id, class_id, section_id,
                         branch_id, building_id, room_id, seat_id,
                         ssms_client_code, current_status, created, modified, registration_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW(), ?)",
                    [$enrollmentId, $sessionId, $classId, $sectionId,
                     $branchId, $buildingId, $roomId, $seatId, $clientCode, $registrationId]
                );
            }
 
            // Mark seat as occupied
            $db->execute(
                "UPDATE ssms_room_seats SET status = 'occupied' WHERE seat_id = ?",
                [$seatId]
            );
 
            Log::info("saveHostelEnrollment: [{$clientCode}] enrollment={$enrollmentId} seat={$seatId}");
            $this->jsonOk(['message' => 'Hostel enrolment saved successfully.']);
 
        } catch (\Exception $e) {
            Log::error('saveHostelEnrollment: ' . $e->getMessage());
            $this->jsonError(500, 'Server error: ' . $e->getMessage());
        }
    }
 
    // ══════════════════════════════════════════════════════════════════════════
    // POST /hostelServiceApi/deEnrollHostel
    // Mark enrollment as inactive, free the seat, set de_enroll_date.
    // Admin / owner only.
    // ══════════════════════════════════════════════════════════════════════════
    public function deEnrollHostel(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) {
            $this->jsonError(403, 'Admin or owner access required.');
            return;
        }
 
        $clientCode         = $this->getClientCode();
        $body               = $this->request->getData();
        $hostelEnrollmentId = !empty($body['hostelEnrollmentId']) ? (int)$body['hostelEnrollmentId'] : null;
        $deEnrollDate       = trim((string)($body['deEnrollDate'] ?? ''));
 
        if (!$hostelEnrollmentId) { $this->jsonError(422, 'hostelEnrollmentId is required.'); return; }
        if (!$deEnrollDate)       { $this->jsonError(422, 'deEnrollDate is required.');       return; }
 
        // Validate date format
        if (!\DateTime::createFromFormat('Y-m-d', $deEnrollDate)) {
            $this->jsonError(422, 'deEnrollDate must be in YYYY-MM-DD format.');
            return;
        }
 
        $db = $this->getTableLocator()->get('SsmsHostelEnrollment')->getConnection();
 
        $enrollment = $db->execute(
            "SELECT id, seat_id FROM ssms_hostel_enrollment
             WHERE id = ? AND ssms_client_code = ? AND current_status = 'active'",
            [$hostelEnrollmentId, $clientCode]
        )->fetchAssoc();
 
        if (!$enrollment) {
            $this->jsonError(404, 'Active hostel enrolment not found.');
            return;
        }
 
        try {
            // Mark enrollment inactive
            $db->execute(
                "UPDATE ssms_hostel_enrollment
                 SET current_status = 'inactive', de_enroll_date = ?, modified = NOW()
                 WHERE id = ? AND ssms_client_code = ?",
                [$deEnrollDate, $hostelEnrollmentId, $clientCode]
            );
 
            // Free the seat
            $db->execute(
                "UPDATE ssms_room_seats SET status = 'available' WHERE seat_id = ?",
                [(int)$enrollment['seat_id']]
            );
 
            Log::info("deEnrollHostel: [{$clientCode}] id={$hostelEnrollmentId} date={$deEnrollDate}");
            $this->jsonOk(['message' => 'Student de-enrolled from hostel successfully.']);
 
        } catch (\Exception $e) {
            Log::error('deEnrollHostel: ' . $e->getMessage());
            $this->jsonError(500, 'Server error: ' . $e->getMessage());
        }
    }
 
    // ══════════════════════════════════════════════════════════════════════════
    // GET /hostelServiceApi/getAvailableSeats?roomId=X
    // Returns only seats with status = 'available' for a room.
    // If editing existing enrolment, the currently assigned seat is also included.
    // ══════════════════════════════════════════════════════════════════════════
    public function getAvailableSeats(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        $roomId     = (int)($this->request->getQuery('roomId') ?? 0);
        // Optional: include currently assigned seat (for edit mode)
        $currentSeatId = (int)($this->request->getQuery('currentSeatId') ?? 0);
 
        if (!$clientCode || !$roomId) {
            $this->jsonError(422, 'roomId is required.');
            return;
        }
 
        $db = $this->getTableLocator()->get('SsmsRoomSeats')->getConnection();
 
        $seats = $db->execute(
            "SELECT seat_id, seat_number, status
             FROM   ssms_room_seats
             WHERE  room_id = ? AND ssms_client_code = ?
               AND  (status = 'available' OR seat_id = ?)
             ORDER  BY seat_number ASC",
            [$roomId, $clientCode, $currentSeatId ?: 0]
        )->fetchAll('assoc');
 
        $this->jsonOk(['seats' => $seats]);
    }
    
    public function getHostelEnrolledStudents()
        {
            $this->request->allowMethod(['get']);

            $ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');

            $studentEnrollmentTable = $this->fetchTable('SsmsHostelEnrollment');

            $enrolledStudents = $studentEnrollmentTable->find()
                ->select([
                    'registrationNo' => 'SsmsStudentRegistration.registration_id',
                    'firstName' => 'SsmsStudentRegistration.student_first_name',
                    'middleName' => 'SsmsStudentRegistration.student_middle_name',
                    'lastName' => 'SsmsStudentRegistration.student_last_name',
                    'emailAddress' => 'SsmsStudentRegistration.email_address',
                    'gender' => 'SsmsStudentRegistration.student_gender',
                    'dob' => 'SsmsStudentRegistration.student_dob',
                    'classId' => 'SsmsHostelEnrollment.class_id',
                    'branchId' => 'SsmsHostelEnrollment.branch_id',
                    'sessionId' => 'SsmsHostelEnrollment.session_id',
                    'mobileNumber' => 'SsmsStudentRegistration.mobile_number',
                    'photo' => 'SsmsStudentRegistration.student_photo',
                    'className' => 'SsmsClasses.class_name',

                    'placeOfBirth' => 'SsmsStudentRegistration.student_birth_place',
                    'nationality' => 'SsmsStudentRegistration.student_nationality',
                    'courseMedium' => 'SsmsStudentRegistration.course_medium',
                    'isPhysicallyChallenged' => 'SsmsStudentRegistration.student_physically_challenged',
                    'admissionType' => 'SsmsStudentRegistration.student_admission_type',

                    'cAddressLine1' => 'SsmsStudentRegistration.student_c_address_line_1',
                    'cAddressLine2' => 'SsmsStudentRegistration.student_c_address_line_2',
                    'cAddressCity' => 'SsmsStudentRegistration.student_c_address_city',
                    'cAddressState' => 'SsmsStudentRegistration.student_c_address_state',
                    'cAddressZipCode' => 'SsmsStudentRegistration.student_c_address_zip',

                    'pAddressLine1' => 'SsmsStudentRegistration.student_p_address_line_1',
                    'pAddressLine2' => 'SsmsStudentRegistration.student_p_address_line_2',
                    'pAddressCity' => 'SsmsStudentRegistration.student_p_address_city',
                    'pAddressState' => 'SsmsStudentRegistration.student_p_address_state',
                    'pAddressZipCode' => 'SsmsStudentRegistration.student_p_address_zip',

                    'fatherName' => 'SsmsStudentRegistration.student_father_name',
                    'fatherQualification' => 'SsmsStudentRegistration.father_qualification',
                    'fatherAge' => 'SsmsStudentRegistration.father_age',
                    'fatherOccupation' => 'SsmsStudentRegistration.father_occupation',

                    'motherName' => 'SsmsStudentRegistration.student_mother_name',
                    'motherQualification' => 'SsmsStudentRegistration.mother_qualification',
                    'motherAge' => 'SsmsStudentRegistration.mother_age',
                    'motherOccupation' => 'SsmsStudentRegistration.mother_occupation',

                    'enrollmentId' => 'SsmsHostelEnrollment.enrollment_id',
                    'enrollmentStatus' => 'SsmsHostelEnrollment.current_status',
                ])
                ->innerJoin(
                    ['SsmsStudentRegistration' => 'ssms_student_registration'],
                    ['SsmsStudentRegistration.registration_id = SsmsHostelEnrollment.registration_id']
                )
                ->leftJoin(
                    ['SsmsClasses' => 'ssms_classes'],
                    ['SsmsClasses.class_id = SsmsHostelEnrollment.class_id']
                )
                ->where([
                    'SsmsHostelEnrollment.ssms_client_code' => $ssmsClientCode,
                    'SsmsStudentRegistration.ssms_client_code' => $ssmsClientCode,
                    'SsmsHostelEnrollment.current_status' => 'active',
                ])
                ->enableHydration(false)
                ->toArray();
          //  Log::error('$enrolledStudents — ' . json_encode($enrolledStudents));
            $response = !empty($enrolledStudents)
                ? ['status' => true, 'data' => $enrolledStudents]
                : ['status' => false, 'message' => 'No enrolled students found', 'data' => []];
            log::error("Hostel students: ". json_encode($enrolledStudents));
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode($response));
        }
    
    // src/Controller/HostelServiceApiController.php — add temporarily
public function debugJwt(): void
{
    $secret  = env('JWT_SECRET', 'NOT_SET_IN_ENV');
    $secret2 = \Cake\Core\Configure::read('Jwt.secret', 'NOT_SET_IN_CONFIGURE');
    $appLocal = file_exists(CONFIG . 'app_local.php') ? 'EXISTS' : 'MISSING';

    $this->set([
        'env_secret'       => empty($secret)  ? 'EMPTY' : 'SET (len=' . strlen($secret) . ')',
        'configure_secret' => empty($secret2) ? 'EMPTY' : 'SET (len=' . strlen($secret2) . ')',
        'app_local_file'   => $appLocal,
        'config_path'      => CONFIG,
    ]);
    $this->viewBuilder()->setOption('serialize', [
        'env_secret', 'configure_secret', 'app_local_file', 'config_path'
    ]);
}
}