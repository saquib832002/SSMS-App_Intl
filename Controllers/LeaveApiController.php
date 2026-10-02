<?php
/**
 * LeaveApiController.php
 *
 * Staff Leave Management — CakePHP 4.x Controller
 * Each tenant (school) is isolated by ssmsClientCode header.
 *
 * Routes to add in config/routes.php:
 *   $routes->get('/LeaveApi/getLeaveTypes',     ['controller'=>'LeaveApi','action'=>'getLeaveTypes']);
 *   $routes->post('/LeaveApi/saveLeaveType',    ['controller'=>'LeaveApi','action'=>'saveLeaveType']);
 *   $routes->post('/LeaveApi/applyLeave',       ['controller'=>'LeaveApi','action'=>'applyLeave']);
 *   $routes->get('/LeaveApi/getMyLeaves',       ['controller'=>'LeaveApi','action'=>'getMyLeaves']);
 *   $routes->get('/LeaveApi/getPendingLeaves',  ['controller'=>'LeaveApi','action'=>'getPendingLeaves']);
 *   $routes->get('/LeaveApi/getAllLeaves',       ['controller'=>'LeaveApi','action'=>'getAllLeaves']);
 *   $routes->post('/LeaveApi/approveLeave',     ['controller'=>'LeaveApi','action'=>'approveLeave']);
 *   $routes->post('/LeaveApi/cancelLeave',      ['controller'=>'LeaveApi','action'=>'cancelLeave']);
 *   $routes->get('/LeaveApi/getLeaveBalance',   ['controller'=>'LeaveApi','action'=>'getLeaveBalance']);
 */

declare(strict_types=1);

namespace App\Controller;

use Cake\Http\Response;

class LeaveApiController extends AppController
{
    // ── Helpers ──────────────────────────────────────────────────────────────

    private function json(array $payload, int $code = 200): Response
    {
        return $this->response
            ->withType('application/json')
            ->withStatus($code)
            ->withStringBody(json_encode($payload, JSON_UNESCAPED_UNICODE));
    }

    private function db(): \Cake\Database\Connection
    {
        return \Cake\Datasource\ConnectionManager::get('default');
    }

    /** Tenant identifier — every school has a unique client code */
    private function clientCode(): string
    {
        return $this->request->getHeaderLine('ssmsClientCode') ?: '';
    }

    /** Return branch_id from request header */
    private function branchId(): int
    {
        return (int)($this->request->getHeaderLine('ssmsBranchId') ?: 0);
    }

    /**
     * Return the staff_id for the logged-in user.
     *
     * Fast path: the React Native app sends ssmsStaffId directly from the
     * login response, so we use that when available.
     *
     * Fallback: join sawera_ssms_users → ssms_staff via name pattern.
     * Owner / admin accounts may have no staff row → returns null (fine,
     * approved_by is nullable and admins cannot apply leave for themselves).
     */
    private function currentStaffId(): ?int
    {
        $clientCode = $this->clientCode();
        if (!$clientCode) return null;

        // Fast path — frontend sends staffId from login payload
        $headerId = (int)$this->request->getHeaderLine('ssmsStaffId');
        if ($headerId > 0) {
            // Verify the staff belongs to this tenant to prevent spoofing
            $row = $this->db()->execute(
                "SELECT staff_id FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ? LIMIT 1",
                [$headerId, $clientCode]
            )->fetch('assoc');
            if ($row) return (int)$row['staff_id'];
        }

        // Fallback: derive from login username via name join
        $uname = $this->request->getHeaderLine('ssmsUserName');
        if (!$uname) return null;

        $row = $this->db()->execute(
            "SELECT s.staff_id
               FROM sawera_ssms_users u
               JOIN ssms_staff s
                 ON s.ssms_client_code = u.ssms_client_code
                AND LOWER(TRIM(u.ssms_user_name)) = LOWER(CONCAT(TRIM(s.first_name), '.', TRIM(s.last_name)))
              WHERE LOWER(TRIM(u.ssms_user_name)) = LOWER(TRIM(?))
                AND u.ssms_client_code = ?
              LIMIT 1",
            [$uname, $clientCode]
        )->fetch('assoc');

        return $row ? (int)$row['staff_id'] : null;
    }

    private function role(): string
    {
        return strtolower($this->request->getHeaderLine('ssmsUserRole') ?: '');
    }

    private function isAdmin(): bool
    {
        return in_array($this->role(), ['owner', 'admin', 'principal'], true);
    }

    /**
     * Calculate working days between two dates using the school's configured
     * working_days (stored as comma-separated ISO day numbers: 1=Mon … 7=Sun).
     * Falls back to Mon–Sat if the school has no settings row.
     */
    private function workingDays(string $from, string $to): float
    {
        $row = $this->db()->execute(
            "SELECT working_days FROM ssms_school_settings WHERE client_code = ? LIMIT 1",
            [$this->clientCode()]
        )->fetch('assoc');

        $workNums = $row && !empty($row['working_days'])
            ? array_map('intval', array_filter(explode(',', $row['working_days'])))
            : [1, 2, 3, 4, 5, 6]; // default Mon–Sat

        $start = new \DateTime($from);
        $end   = new \DateTime($to);
        $days  = 0;
        while ($start <= $end) {
            if (in_array((int)$start->format('N'), $workNums)) {
                $days++;
            }
            $start->modify('+1 day');
        }
        return (float)$days;
    }

    // ── Leave Types ──────────────────────────────────────────────────────────

    /**
     * GET /LeaveApi/getLeaveTypes
     * Returns only this school's leave types.
     */
    public function getLeaveTypes(): Response
    {
        $rows = $this->db()->execute(
            'SELECT * FROM ssms_leave_types
              WHERE status = 1 AND client_code = ?
              ORDER BY name',
            [$this->clientCode()]
        )->fetchAll('assoc');

        return $this->json(['status' => true, 'data' => $rows]);
    }

    /**
     * POST /LeaveApi/saveLeaveType
     * Body: { id?, name, abbreviation, max_days_per_year, carry_forward, status }
     */
    public function saveLeaveType(): Response
    {
        if (!$this->isAdmin()) {
            return $this->json(['status' => false, 'message' => 'Unauthorized'], 403);
        }

        $body     = (array)$this->request->getData();
        $id       = (int)($body['id'] ?? 0);
        $name     = trim($body['name'] ?? '');
        $abbr     = trim($body['abbreviation'] ?? '');
        $maxDays  = (float)($body['max_days_per_year'] ?? 12);
        $carry    = (int)(bool)($body['carry_forward'] ?? 0);
        $status   = (int)(bool)($body['status'] ?? 1);
        $branchId = $this->branchId();

        if (!$name) {
            return $this->json(['status' => false, 'message' => 'Leave type name is required']);
        }

        $db = $this->db();
        if ($id > 0) {
            // Scope UPDATE to this school's records only
            $db->execute(
                'UPDATE ssms_leave_types
                    SET name=?, abbreviation=?, max_days_per_year=?, carry_forward=?, status=?
                  WHERE id=? AND client_code=?',
                [$name, $abbr, $maxDays, $carry, $status, $id, $this->clientCode()]
            );
        } else {
            $db->execute(
                'INSERT INTO ssms_leave_types
                   (client_code, branch_id, name, abbreviation, max_days_per_year, carry_forward, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$this->clientCode(), $branchId, $name, $abbr, $maxDays, $carry, $status]
            );
            $id = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetch('assoc')['id'];
        }

        return $this->json(['status' => true, 'message' => 'Saved successfully', 'id' => $id]);
    }

    // ── Apply for Leave ──────────────────────────────────────────────────────

    /**
     * POST /LeaveApi/applyLeave
     * Body: { leave_type_id, from_date, to_date, reason, is_half_day?, half_day_slot? }
     */
    public function applyLeave(): Response
    {
        $staffId = $this->currentStaffId();
        if (!$staffId) {
            return $this->json(['status' => false, 'message' => 'Staff not found'], 403);
        }

        $body     = (array)$this->request->getData();
        $typeId   = (int)($body['leave_type_id'] ?? 0);
        $fromDate = trim($body['from_date'] ?? '');
        $toDate   = trim($body['to_date']   ?? '');
        $reason   = trim($body['reason']    ?? '');
        $isHalf   = (int)(bool)($body['is_half_day']  ?? 0);
        $halfSlot = in_array($body['half_day_slot'] ?? '', ['morning', 'afternoon'])
                      ? $body['half_day_slot'] : null;
        $branchId = $this->branchId();

        if (!$typeId || !$fromDate || !$toDate || !$reason) {
            return $this->json(['status' => false, 'message' => 'All fields are required']);
        }
        if ($fromDate > $toDate) {
            return $this->json(['status' => false, 'message' => 'From date cannot be after To date']);
        }

        // Verify the leave type belongs to this school
        $typeExists = $this->db()->execute(
            'SELECT id FROM ssms_leave_types WHERE id=? AND client_code=? AND status=1',
            [$typeId, $this->clientCode()]
        )->fetch('assoc');
        if (!$typeExists) {
            return $this->json(['status' => false, 'message' => 'Invalid leave type']);
        }

        $days = $isHalf ? 0.5 : $this->workingDays($fromDate, $toDate);

        // Check for overlapping pending/approved applications
        $overlap = $this->db()->execute(
            "SELECT id FROM ssms_leave_applications
              WHERE staff_id = ?
                AND status IN ('pending','approved')
                AND from_date <= ? AND to_date >= ?",
            [$staffId, $toDate, $fromDate]
        )->fetch('assoc');

        if ($overlap) {
            return $this->json(['status' => false, 'message' => 'You already have a leave application overlapping these dates']);
        }

        // Check balance
        $year    = (int)date('Y');
        $balance = $this->getOrCreateBalance($staffId, $branchId, $this->clientCode(), $typeId, $year);
        $remaining = $balance['total_days'] + $balance['carried_days'] - $balance['used_days'];

        if ($days > $remaining) {
            return $this->json([
                'status'  => false,
                'message' => "Insufficient leave balance. Remaining: {$remaining} day(s).",
            ]);
        }

        $db = $this->db();
        $db->execute(
            'INSERT INTO ssms_leave_applications
               (staff_id, branch_id, leave_type_id, from_date, to_date, days, reason, is_half_day, half_day_slot, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "pending")',
            [$staffId, $branchId, $typeId, $fromDate, $toDate, $days, $reason, $isHalf, $halfSlot]
        );
        $newId = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetch('assoc')['id'];

        return $this->json(['status' => true, 'message' => 'Leave application submitted successfully', 'id' => $newId]);
    }

    // ── My Applications ──────────────────────────────────────────────────────

    /**
     * GET /LeaveApi/getMyLeaves?year=2025
     */
    public function getMyLeaves(): Response
    {
        $staffId = $this->currentStaffId();
        if (!$staffId) {
            return $this->json(['status' => false, 'message' => 'Staff not found'], 403);
        }

        $year = (int)($this->request->getQuery('year') ?: date('Y'));

        $rows = $this->db()->execute(
            "SELECT la.*,
                    lt.name          AS leave_type_name,
                    lt.abbreviation  AS leave_type_abbr,
                    CONCAT(s.first_name,' ',s.last_name) AS approved_by_name
               FROM ssms_leave_applications la
               JOIN ssms_leave_types lt ON lt.id = la.leave_type_id AND lt.client_code = ?
          LEFT JOIN ssms_staff s        ON s.staff_id = la.approved_by
              WHERE la.staff_id = ?
                AND YEAR(la.from_date) = ?
           ORDER BY la.created_at DESC",
            [$this->clientCode(), $staffId, $year]
        )->fetchAll('assoc');

        return $this->json(['status' => true, 'data' => $rows]);
    }

    // ── Admin: Pending / All Leaves ──────────────────────────────────────────

    /**
     * GET /LeaveApi/getPendingLeaves
     */
    public function getPendingLeaves(): Response
    {
        if (!$this->isAdmin()) {
            return $this->json(['status' => false, 'message' => 'Unauthorized'], 403);
        }

        $branchId = $this->branchId();
        $rows = $this->db()->execute(
            "SELECT la.*,
                    lt.name          AS leave_type_name,
                    lt.abbreviation  AS leave_type_abbr,
                    CONCAT(s.first_name,' ',s.last_name) AS staff_name,
                    s.specialty      AS designation
               FROM ssms_leave_applications la
               JOIN ssms_leave_types lt ON lt.id = la.leave_type_id AND lt.client_code = ?
               JOIN ssms_staff s        ON s.staff_id = la.staff_id
              WHERE la.status = 'pending'
                AND (? = 0 OR la.branch_id = ?)
           ORDER BY la.created_at ASC",
            [$this->clientCode(), $branchId, $branchId]
        )->fetchAll('assoc');

        return $this->json(['status' => true, 'data' => $rows]);
    }

    /**
     * GET /LeaveApi/getAllLeaves?year=2025&staff_id=&status=
     */
    public function getAllLeaves(): Response
    {
        if (!$this->isAdmin()) {
            return $this->json(['status' => false, 'message' => 'Unauthorized'], 403);
        }

        $branchId = $this->branchId();
        $year     = (int)($this->request->getQuery('year')     ?: date('Y'));
        $staffId  = (int)($this->request->getQuery('staff_id') ?: 0);
        $status   = $this->request->getQuery('status') ?: '';

        $params = [$this->clientCode(), $year, $branchId, $branchId];
        $extra  = '';
        if ($staffId > 0) { $extra .= ' AND la.staff_id = ?'; $params[] = $staffId; }
        if ($status)       { $extra .= ' AND la.status = ?';   $params[] = $status; }

        $rows = $this->db()->execute(
            "SELECT la.*,
                    lt.name          AS leave_type_name,
                    lt.abbreviation  AS leave_type_abbr,
                    CONCAT(s.first_name,' ',s.last_name)   AS staff_name,
                    s.specialty                             AS designation,
                    CONCAT(ab.first_name,' ',ab.last_name) AS approved_by_name
               FROM ssms_leave_applications la
               JOIN ssms_leave_types lt ON lt.id = la.leave_type_id AND lt.client_code = ?
               JOIN ssms_staff s        ON s.staff_id = la.staff_id
          LEFT JOIN ssms_staff ab       ON ab.staff_id = la.approved_by
              WHERE YEAR(la.from_date) = ?
                AND (? = 0 OR la.branch_id = ?)
                {$extra}
           ORDER BY la.created_at DESC",
            $params
        )->fetchAll('assoc');

        return $this->json(['status' => true, 'data' => $rows]);
    }

    // ── Approve / Reject ─────────────────────────────────────────────────────

    /**
     * POST /LeaveApi/approveLeave
     * Body: { id, action: 'approved'|'rejected', remarks? }
     */
    public function approveLeave(): Response
    {
        if (!$this->isAdmin()) {
            return $this->json(['status' => false, 'message' => 'Unauthorized'], 403);
        }

        $body    = (array)$this->request->getData();
        $id      = (int)($body['id']     ?? 0);
        $action  = $body['action']  ?? '';
        $remarks = trim($body['remarks'] ?? '');

        if (!$id || !in_array($action, ['approved', 'rejected'], true)) {
            return $this->json(['status' => false, 'message' => 'Invalid request']);
        }

        $db  = $this->db();
        $app = $db->execute(
            'SELECT * FROM ssms_leave_applications WHERE id = ? AND status = "pending"',
            [$id]
        )->fetch('assoc');

        if (!$app) {
            return $this->json(['status' => false, 'message' => 'Application not found or already processed']);
        }

        $approverStaffId = $this->currentStaffId();

        $db->execute(
            'UPDATE ssms_leave_applications
                SET status=?, approved_by=?, approved_at=NOW(), remarks=?
              WHERE id=?',
            [$action, $approverStaffId, $remarks ?: null, $id]
        );

        // If approved, deduct from this school's balance
        if ($action === 'approved') {
            $year = (int)(new \DateTime($app['from_date']))->format('Y');
            $this->getOrCreateBalance(
                (int)$app['staff_id'],
                (int)$app['branch_id'],
                $this->clientCode(),
                (int)$app['leave_type_id'],
                $year
            );
            $db->execute(
                'UPDATE ssms_leave_balances
                    SET used_days = used_days + ?
                  WHERE staff_id = ? AND leave_type_id = ? AND year = ? AND client_code = ?',
                [(float)$app['days'], (int)$app['staff_id'], (int)$app['leave_type_id'], $year, $this->clientCode()]
            );
        }

        $msg = $action === 'approved' ? 'Leave approved' : 'Leave rejected';
        return $this->json(['status' => true, 'message' => $msg]);
    }

    // ── Cancel (by staff) ────────────────────────────────────────────────────

    /**
     * POST /LeaveApi/cancelLeave
     * Body: { id }
     */
    public function cancelLeave(): Response
    {
        $staffId = $this->currentStaffId();
        if (!$staffId) {
            return $this->json(['status' => false, 'message' => 'Staff not found'], 403);
        }

        $id = (int)($this->request->getData('id') ?? 0);
        if (!$id) {
            return $this->json(['status' => false, 'message' => 'Invalid request']);
        }

        $db  = $this->db();
        $app = $db->execute(
            'SELECT * FROM ssms_leave_applications WHERE id = ? AND staff_id = ?',
            [$id, $staffId]
        )->fetch('assoc');

        if (!$app) {
            return $this->json(['status' => false, 'message' => 'Application not found']);
        }
        if (!in_array($app['status'], ['pending', 'approved'], true)) {
            return $this->json(['status' => false, 'message' => 'Cannot cancel a ' . $app['status'] . ' application']);
        }

        $db->execute(
            'UPDATE ssms_leave_applications SET status="cancelled" WHERE id=?',
            [$id]
        );

        // Restore balance if the leave was already approved
        if ($app['status'] === 'approved') {
            $year = (int)(new \DateTime($app['from_date']))->format('Y');
            $db->execute(
                'UPDATE ssms_leave_balances
                    SET used_days = GREATEST(0, used_days - ?)
                  WHERE staff_id = ? AND leave_type_id = ? AND year = ? AND client_code = ?',
                [(float)$app['days'], $staffId, (int)$app['leave_type_id'], $year, $this->clientCode()]
            );
        }

        return $this->json(['status' => true, 'message' => 'Leave application cancelled']);
    }

    // ── Balance ──────────────────────────────────────────────────────────────

    /**
     * GET /LeaveApi/getLeaveBalance?staff_id=&year=2025
     * staff_id is optional — defaults to logged-in staff
     */
    public function getLeaveBalance(): Response
    {
        $requestedStaffId = (int)($this->request->getQuery('staff_id') ?: 0);
        $staffId = $requestedStaffId > 0 ? $requestedStaffId : $this->currentStaffId();

        if (!$staffId) {
            return $this->json(['status' => false, 'message' => 'Staff not found'], 403);
        }

        // Non-admins can only see their own balance
        if ($requestedStaffId > 0 && $requestedStaffId !== $this->currentStaffId() && !$this->isAdmin()) {
            return $this->json(['status' => false, 'message' => 'Unauthorized'], 403);
        }

        $branchId = $this->branchId();
        $year     = (int)($this->request->getQuery('year') ?: date('Y'));

        // Get all active leave types belonging to this school
        $types = $this->db()->execute(
            'SELECT * FROM ssms_leave_types
              WHERE status = 1 AND client_code = ?
              ORDER BY name',
            [$this->clientCode()]
        )->fetchAll('assoc');

        $balances = [];
        foreach ($types as $type) {
            $b = $this->getOrCreateBalance($staffId, $branchId, $this->clientCode(), (int)$type['id'], $year);

            // Count days in pending applications so they are shown as "reserved"
            $pendingRow = $this->db()->execute(
                "SELECT COALESCE(SUM(days), 0) AS pending_days
                   FROM ssms_leave_applications
                  WHERE staff_id = ? AND leave_type_id = ? AND status = 'pending'
                    AND YEAR(from_date) = ?",
                [$staffId, (int)$type['id'], $year]
            )->fetch('assoc');
            $pendingDays = (float)($pendingRow['pending_days'] ?? 0);

            $approved  = (float)$b['used_days'];
            $total     = (float)$b['total_days'] + (float)$b['carried_days'];
            $remaining = max(0, $total - $approved - $pendingDays);

            $balances[] = [
                'leave_type_id'   => $type['id'],
                'leave_type_name' => $type['name'],
                'abbreviation'    => $type['abbreviation'],
                'total_days'      => (float)$b['total_days'],
                'used_days'       => $approved,
                'pending_days'    => $pendingDays,
                'carried_days'    => (float)$b['carried_days'],
                'remaining_days'  => $remaining,
            ];
        }

        return $this->json(['status' => true, 'data' => $balances, 'year' => $year]);
    }

    // ── Private: ensure balance row exists ───────────────────────────────────

    private function getOrCreateBalance(
        int    $staffId,
        int    $branchId,
        string $clientCode,
        int    $typeId,
        int    $year
    ): array {
        $db  = $this->db();
        $row = $db->execute(
            'SELECT * FROM ssms_leave_balances
              WHERE staff_id=? AND leave_type_id=? AND year=? AND client_code=?',
            [$staffId, $typeId, $year, $clientCode]
        )->fetch('assoc');

        if ($row) return $row;

        $lt = $db->execute(
            'SELECT max_days_per_year, carry_forward FROM ssms_leave_types WHERE id=?',
            [$typeId]
        )->fetch('assoc');

        $totalDays   = $lt ? (float)$lt['max_days_per_year'] : 12;
        $carriedDays = 0.0;

        if ($lt && (int)$lt['carry_forward'] === 1) {
            $prev = $db->execute(
                'SELECT total_days, used_days, carried_days FROM ssms_leave_balances
                  WHERE staff_id=? AND leave_type_id=? AND year=? AND client_code=?',
                [$staffId, $typeId, $year - 1, $clientCode]
            )->fetch('assoc');
            if ($prev) {
                $carriedDays = max(0, (float)$prev['total_days'] + (float)$prev['carried_days'] - (float)$prev['used_days']);
            }
        }

        $db->execute(
            'INSERT IGNORE INTO ssms_leave_balances
               (staff_id, branch_id, client_code, leave_type_id, year, total_days, used_days, carried_days)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
            [$staffId, $branchId, $clientCode, $typeId, $year, $totalDays, $carriedDays]
        );

        return [
            'total_days'   => $totalDays,
            'used_days'    => 0.0,
            'carried_days' => $carriedDays,
        ];
    }
}
