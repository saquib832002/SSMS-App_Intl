<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Log\Log;
use Cake\I18n\DateTime;

class TransportServiceApiController extends AppController
{
    // ── Routes ────────────────────────────────────────────────────────────────
    public function getRoutes()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db   = $this->getTableLocator()->get('SsmsTransportRoutes')->getConnection();
        $rows = $db->execute(
            "SELECT * FROM ssms_transport_routes
              WHERE ssms_client_code = ? ORDER BY route_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        return $this->_json(['status' => true, 'data' => $rows]);
    }

    public function createRoute()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();
        $this->_requireRole(['admin','owner']);

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportRoutes')->getConnection();
        $now  = date('Y-m-d H:i:s');

        $db->execute(
            "INSERT INTO ssms_transport_routes
                (route_name, route_code, start_point, end_point,
                 distance_km, monthly_fare, status, ssms_client_code, created, modified)
             VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                trim((string)($data['route_name']   ?? '')),
                trim((string)($data['route_code']   ?? '')) ?: null,
                trim((string)($data['start_point']  ?? '')) ?: null,
                trim((string)($data['end_point']    ?? '')) ?: null,
                !empty($data['distance_km'])  ? (float)$data['distance_km']  : null,
                !empty($data['monthly_fare']) ? (float)$data['monthly_fare'] : 0,
                'active', $clientCode, $now, $now,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Route created.']);
    }

    public function updateRoute($id = null)
    {
        $this->request->allowMethod(['put']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();
        $this->_requireRole(['admin','owner']);

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportRoutes')->getConnection();
        $db->execute(
            "UPDATE ssms_transport_routes SET
                route_name = ?, route_code = ?, start_point = ?, end_point = ?,
                distance_km = ?, monthly_fare = ?, modified = NOW()
             WHERE route_id = ? AND ssms_client_code = ?",
            [
                trim((string)($data['route_name']   ?? '')),
                trim((string)($data['route_code']   ?? '')) ?: null,
                trim((string)($data['start_point']  ?? '')) ?: null,
                trim((string)($data['end_point']    ?? '')) ?: null,
                !empty($data['distance_km'])  ? (float)$data['distance_km']  : null,
                !empty($data['monthly_fare']) ? (float)$data['monthly_fare'] : 0,
                (int)$id, $clientCode,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Route updated.']);
    }

    public function deleteRoute($id = null)
    {
        $this->request->allowMethod(['delete']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();
        $this->_requireRole(['admin','owner']);

        $db = $this->getTableLocator()->get('SsmsTransportRoutes')->getConnection();
        $db->execute(
            "DELETE FROM ssms_transport_routes WHERE route_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );
        return $this->_json(['status' => true, 'message' => 'Route deleted.']);
    }

    // ── Stops ─────────────────────────────────────────────────────────────────
    public function getStops()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $routeId    = $this->request->getQuery('routeId');
        if (!$clientCode || !$routeId) return $this->_unauth();

        $db   = $this->getTableLocator()->get('SsmsTransportStops')->getConnection();
        $rows = $db->execute(
            "SELECT * FROM ssms_transport_stops
              WHERE route_id = ? AND ssms_client_code = ?
              ORDER BY stop_order ASC",
            [(int)$routeId, $clientCode]
        )->fetchAll('assoc');

        return $this->_json(['status' => true, 'data' => $rows]);
    }

    public function createStop()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportStops')->getConnection();
        $now  = date('Y-m-d H:i:s');

        $db->execute(
            "INSERT INTO ssms_transport_stops
                (route_id, stop_name, stop_order, latitude, longitude,
                 pickup_time, dropoff_time, ssms_client_code, created, modified)
             VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                (int)($data['route_id']    ?? 0),
                trim((string)($data['stop_name']   ?? '')),
                (int)($data['stop_order']  ?? 1),
                !empty($data['latitude'])   ? (float)$data['latitude']   : null,
                !empty($data['longitude'])  ? (float)$data['longitude']  : null,
                !empty($data['pickup_time'])  ? $data['pickup_time']  : null,
                !empty($data['dropoff_time']) ? $data['dropoff_time'] : null,
                $clientCode, $now, $now,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Stop created.']);
    }

    public function updateStop($id = null)
    {
        $this->request->allowMethod(['put']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportStops')->getConnection();
        $db->execute(
            "UPDATE ssms_transport_stops SET
                stop_name = ?, stop_order = ?, latitude = ?, longitude = ?,
                pickup_time = ?, dropoff_time = ?, modified = NOW()
             WHERE stop_id = ? AND ssms_client_code = ?",
            [
                trim((string)($data['stop_name'] ?? '')),
                (int)($data['stop_order'] ?? 1),
                !empty($data['latitude'])   ? (float)$data['latitude']   : null,
                !empty($data['longitude'])  ? (float)$data['longitude']  : null,
                !empty($data['pickup_time'])  ? $data['pickup_time']  : null,
                !empty($data['dropoff_time']) ? $data['dropoff_time'] : null,
                (int)$id, $clientCode,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Stop updated.']);
    }

    public function deleteStop($id = null)
    {
        $this->request->allowMethod(['delete']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db = $this->getTableLocator()->get('SsmsTransportStops')->getConnection();
        $db->execute(
            "DELETE FROM ssms_transport_stops WHERE stop_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );
        return $this->_json(['status' => true, 'message' => 'Stop deleted.']);
    }

    // ── Vehicles ──────────────────────────────────────────────────────────────
    public function getVehicles()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db   = $this->getTableLocator()->get('SsmsTransportVehicles')->getConnection();
        $rows = $db->execute(
            "SELECT * FROM ssms_transport_vehicles
              WHERE ssms_client_code = ? ORDER BY vehicle_number ASC",
            [$clientCode]
        )->fetchAll('assoc');

        return $this->_json(['status' => true, 'data' => $rows]);
    }

    public function createVehicle()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();
        $this->_requireRole(['admin','owner']);

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportVehicles')->getConnection();
        $now  = date('Y-m-d H:i:s');

        $db->execute(
            "INSERT INTO ssms_transport_vehicles
                (vehicle_number, vehicle_name, capacity, model,
                 status, ssms_client_code, created, modified)
             VALUES (?,?,?,?,?,?,?,?)",
            [
                strtoupper(trim((string)($data['vehicle_number'] ?? ''))),
                trim((string)($data['vehicle_name'] ?? '')) ?: null,
                !empty($data['capacity']) ? (int)$data['capacity'] : null,
                trim((string)($data['model'] ?? '')) ?: null,
                'active', $clientCode, $now, $now,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Vehicle created.']);
    }

    public function updateVehicle($id = null)
    {
        $this->request->allowMethod(['put']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportVehicles')->getConnection();
        $db->execute(
            "UPDATE ssms_transport_vehicles SET
                vehicle_number = ?, vehicle_name = ?, capacity = ?,
                model = ?, modified = NOW()
             WHERE vehicle_id = ? AND ssms_client_code = ?",
            [
                strtoupper(trim((string)($data['vehicle_number'] ?? ''))),
                trim((string)($data['vehicle_name'] ?? '')) ?: null,
                !empty($data['capacity']) ? (int)$data['capacity'] : null,
                trim((string)($data['model'] ?? '')) ?: null,
                (int)$id, $clientCode,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Vehicle updated.']);
    }

    public function deleteVehicle($id = null)
    {
        $this->request->allowMethod(['delete']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db = $this->getTableLocator()->get('SsmsTransportVehicles')->getConnection();
        $db->execute(
            "DELETE FROM ssms_transport_vehicles WHERE vehicle_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );
        return $this->_json(['status' => true, 'message' => 'Vehicle deleted.']);
    }

    // ── Drivers ───────────────────────────────────────────────────────────────
    public function getDrivers()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db   = $this->getTableLocator()->get('SsmsTransportDrivers')->getConnection();
        $rows = $db->execute(
            "SELECT * FROM ssms_transport_drivers
              WHERE ssms_client_code = ? ORDER BY driver_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        return $this->_json(['status' => true, 'data' => $rows]);
    }

    public function createDriver()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();
        $this->_requireRole(['admin','owner']);

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportDrivers')->getConnection();
        $now  = date('Y-m-d H:i:s');

        $db->execute(
            "INSERT INTO ssms_transport_drivers
                (driver_name, mobile_number, license_number, license_expiry,
                 status, ssms_client_code, created, modified)
             VALUES (?,?,?,?,?,?,?,?)",
            [
                trim((string)($data['driver_name']    ?? '')),
                trim((string)($data['mobile_number']  ?? '')) ?: null,
                trim((string)($data['license_number'] ?? '')) ?: null,
                !empty($data['license_expiry']) ? $data['license_expiry'] : null,
                'active', $clientCode, $now, $now,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Driver created.']);
    }

    public function updateDriver($id = null)
    {
        $this->request->allowMethod(['put']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportDrivers')->getConnection();
        $db->execute(
            "UPDATE ssms_transport_drivers SET
                driver_name = ?, mobile_number = ?, license_number = ?,
                license_expiry = ?, modified = NOW()
             WHERE driver_id = ? AND ssms_client_code = ?",
            [
                trim((string)($data['driver_name']    ?? '')),
                trim((string)($data['mobile_number']  ?? '')) ?: null,
                trim((string)($data['license_number'] ?? '')) ?: null,
                !empty($data['license_expiry']) ? $data['license_expiry'] : null,
                (int)$id, $clientCode,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Driver updated.']);
    }

    public function deleteDriver($id = null)
    {
        $this->request->allowMethod(['delete']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db = $this->getTableLocator()->get('SsmsTransportDrivers')->getConnection();
        $db->execute(
            "DELETE FROM ssms_transport_drivers WHERE driver_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );
        return $this->_json(['status' => true, 'message' => 'Driver deleted.']);
    }

    // ── Assignments ───────────────────────────────────────────────────────────
    public function getAssignments()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $sessionId  = $this->request->getQuery('sessionId');
        if (!$clientCode) return $this->_unauth();

        $db   = $this->getTableLocator()->get('SsmsTransportAssignments')->getConnection();
        $rows = $db->execute(
            "SELECT a.*,
                    r.route_name, r.start_point, r.end_point,
                    v.vehicle_number, v.vehicle_name,
                    d.driver_name, d.mobile_number
             FROM   ssms_transport_assignments a
             JOIN   ssms_transport_routes  r ON r.route_id   = a.route_id
             JOIN   ssms_transport_vehicles v ON v.vehicle_id = a.vehicle_id
             JOIN   ssms_transport_drivers  d ON d.driver_id  = a.driver_id
             WHERE  a.ssms_client_code = ?
               AND  a.session_id       = ?
             ORDER  BY r.route_name ASC",
            [$clientCode, (int)$sessionId]
        )->fetchAll('assoc');

        return $this->_json(['status' => true, 'data' => $rows]);
    }

    public function saveAssignment()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();
        $this->_requireRole(['admin','owner']);

        $data      = $this->request->getData();
        $db        = $this->getTableLocator()->get('SsmsTransportAssignments')->getConnection();
        $now       = date('Y-m-d H:i:s');

        $assignmentId = !empty($data['assignment_id']) ? (int)$data['assignment_id'] : 0;

        if ($assignmentId > 0) {
            // Update existing
            $db->execute(
                "UPDATE ssms_transport_assignments SET
                    route_id = ?, vehicle_id = ?, driver_id = ?, modified = ?
                 WHERE assignment_id = ? AND ssms_client_code = ?",
                [(int)$data['route_id'], (int)$data['vehicle_id'],
                 (int)$data['driver_id'], $now, $assignmentId, $clientCode]
            );
            return $this->_json(['status' => true, 'message' => 'Assignment updated.']);
        }

        // Insert new — upsert on route+session (one vehicle+driver per route per session)
        $db->execute(
            "INSERT INTO ssms_transport_assignments
                (route_id, vehicle_id, driver_id, session_id,
                 ssms_client_code, created, modified)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                vehicle_id = VALUES(vehicle_id),
                driver_id  = VALUES(driver_id),
                modified   = VALUES(modified)",
            [(int)$data['route_id'], (int)$data['vehicle_id'],
             (int)$data['driver_id'], (int)$data['session_id'],
             $clientCode, $now, $now]
        );
        return $this->_json(['status' => true, 'message' => 'Assignment saved.']);
    }

    public function deleteAssignment($id = null)
    {
        $this->request->allowMethod(['delete']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db = $this->getTableLocator()->get('SsmsTransportAssignments')->getConnection();
        $db->execute(
            "DELETE FROM ssms_transport_assignments WHERE assignment_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );
        return $this->_json(['status' => true, 'message' => 'Assignment removed.']);
    }

    // ── Student enrollments ───────────────────────────────────────────────────
    public function getTransportEnrollments()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $sessionId  = $this->request->getQuery('sessionId');
        if (!$clientCode) return $this->_unauth();

        $db  = $this->getTableLocator()->get('SsmsTransportEnrollments')->getConnection();
        $sql = "SELECT te.*,
                    COALESCE(
                        CONCAT(reg.student_first_name,' ',reg.student_last_name),
                        CONCAT('Student #', te.enrollment_id)
                    )                                   AS student_name,
                    COALESCE(rt.route_name, CONCAT('Route #',te.route_id)) AS route_name,
                    COALESCE(st.stop_name,  CONCAT('Stop #', te.stop_id))  AS stop_name,
                    COALESCE(te.class_id,  enr.class_id)  AS class_id,
                    COALESCE(te.branch_id, enr.branch_id) AS branch_id
                FROM ssms_transport_enrollments te
                LEFT JOIN ssms_student_enrollment   enr
                       ON CAST(enr.enrollment_id AS CHAR) = CAST(te.enrollment_id AS CHAR)
                LEFT JOIN ssms_student_registration reg ON reg.registration_id = enr.registration_id
                LEFT JOIN ssms_transport_routes     rt  ON rt.route_id  = te.route_id
                LEFT JOIN ssms_transport_stops      st  ON st.stop_id   = te.stop_id
                WHERE te.ssms_client_code = ?
                  AND te.status = 'active'";
        $bind = [$clientCode];
        if ($sessionId) { $sql .= " AND te.session_id = ?"; $bind[] = (int)$sessionId; }
        $sql .= " ORDER BY student_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
        Log::error("data for enrollment is :" . json_encode($rows));
        return $this->_json(['status' => true, 'data' => $rows, 'total' => count($rows)]);
    }

    public function enrollStudentTransport()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $data = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsTransportEnrollments')->getConnection();
        $now  = date('Y-m-d H:i:s');

        $db->execute(
            "INSERT INTO ssms_transport_enrollments
                (enrollment_id, route_id, stop_id, pickup_stop_id, dropoff_stop_id,
                 session_id, branch_id, class_id, transport_type, monthly_fare, status, ssms_client_code,
                 created, modified)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                stop_id        = VALUES(stop_id),
                pickup_stop_id = VALUES(pickup_stop_id),
                dropoff_stop_id= VALUES(dropoff_stop_id),
                transport_type = VALUES(transport_type),
                monthly_fare   = VALUES(monthly_fare),
                modified       = VALUES(modified)",
            [
                trim((string)($data['enrollment_id']   ?? '')),
                (int)($data['route_id']    ?? 0),
                (int)($data['stop_id']     ?? 0),
                !empty($data['pickup_stop_id'])  ? (int)$data['pickup_stop_id']  : null,
                !empty($data['dropoff_stop_id']) ? (int)$data['dropoff_stop_id'] : null,
                (int)($data['session_id']  ?? 0),
                (int)($data['branch_id']  ?? 0),
                (int)($data['class_id']  ?? 0),
                $data['transport_type'] ?? 'both',
                (float)($data['monthly_fare'] ?? 0),
                'active', $clientCode, $now, $now,
            ]
        );
        return $this->_json(['status' => true, 'message' => 'Student enrolled in transport.']);
    }

    public function removeTransportEnrollment($id = null)
    {
        $this->request->allowMethod(['delete']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        if (!$clientCode) return $this->_unauth();

        $db = $this->getTableLocator()->get('SsmsTransportEnrollments')->getConnection();
        $db->execute(
            "DELETE FROM ssms_transport_enrollments
              WHERE transport_enrollment_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );
        return $this->_json(['status' => true, 'message' => 'Enrollment removed.']);
    }


    // ── GET /TransportApi/getStudentTransportEnrollment?enrollmentId=X ─────────
    public function getStudentTransportEnrollment()
    {
        $this->request->allowMethod(['get']);
        $clientCode   = $this->request->getHeaderLine('ssmsClientCode');
        $enrollmentId = $this->request->getQuery('enrollmentId');

        if (!$clientCode || !$enrollmentId) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'enrollmentId and clientCode are required.',
                    'data'    => null,
                ]));
        }

        $db  = $this->getTableLocator()->get('SsmsTransportEnrollments')->getConnection();
        $row = $db->execute(
            "SELECT te.*,
                    rt.route_name,
                    st.stop_name,
                    pu.stop_name AS pickup_stop_name,
                    dr.stop_name AS dropoff_stop_name
             FROM   ssms_transport_enrollments te
             LEFT JOIN ssms_transport_routes rt ON rt.route_id = te.route_id
             LEFT JOIN ssms_transport_stops  st ON st.stop_id  = te.stop_id
             LEFT JOIN ssms_transport_stops  pu ON pu.stop_id  = te.pickup_stop_id
             LEFT JOIN ssms_transport_stops  dr ON dr.stop_id  = te.dropoff_stop_id
             WHERE  CAST(te.enrollment_id AS CHAR) = CAST(? AS CHAR)
               AND  te.ssms_client_code = ?
               AND  te.status = 'active'
             ORDER  BY te.created DESC
             LIMIT  1",
            [(string)$enrollmentId, $clientCode]
        )->fetchAssoc();

        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'data'   => $row ?: null,
            ]));
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    public function getTransportSummary()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $sessionId  = $this->request->getQuery('sessionId');
        if (!$clientCode) return $this->_unauth();

        $db = $this->getTableLocator()->get('SsmsTransportRoutes')->getConnection();

        $routes   = (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_routes   WHERE ssms_client_code=? AND status='active'", [$clientCode])->fetchColumn(0);
        $vehicles = (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_vehicles WHERE ssms_client_code=? AND status='active'", [$clientCode])->fetchColumn(0);
        $drivers  = (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_drivers  WHERE ssms_client_code=? AND status='active'", [$clientCode])->fetchColumn(0);
        $enrolled = $sessionId
            ? (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_enrollments WHERE ssms_client_code=? AND session_id=? AND status='active'", [$clientCode, (int)$sessionId])->fetchColumn(0)
            : 0;

        return $this->_json(['status' => true, 'data' => [
            'active_routes'   => $routes,
            'active_vehicles' => $vehicles,
            'active_drivers'  => $drivers,
            'total_enrolled'  => $enrolled,
        ]]);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private function _json(array $data)
    {
        return $this->response->withType('application/json')
            ->withStringBody(json_encode($data));
    }

    private function _unauth()
    {
        return $this->_json(['status' => false, 'message' => 'Unauthorized.']);
    }

    private function _requireRole(array $roles): void
    {
        $role = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));
        if (!in_array($role, $roles)) {
            throw new \Cake\Http\Exception\ForbiddenException('You are not authorized to do this task.');
        }
    }
}