<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;
use Cake\Log\Log;

/**
 * LibraryFacilityApiController
 * File: src/Controller/LibraryFacilityApiController.php
 *
 * Owns: lib_computers, lib_computer_bookings
 *
 * Computers and study desks are booked the same way, which is why the schema
 * treats a desk as a computer_type. The one rule that matters throughout is that
 * a machine cannot be double-booked: overlap is checked inside a transaction
 * against a locked set of that machine's bookings for the day.
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibraryFacilityApi' to $apiControllers in AppController.php
 *   3. Paste the facility block from api/routes.snippet.php into config/routes.php
 */
class LibraryFacilityApiController extends AppController
{
    use LibraryApiTrait;

    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->response = $this->response->withType('application/json');
    }

    private function insertId(): int
    {
        return (int)$this->db()->getDriver()->lastInsertId();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // COMPUTERS / DESKS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryFacilityApi/computers?zone=&type=&status=&date=
     *
     * Zone-grouped list with each machine's live state for the given date
     * (default today): who is on it now, and what is booked next. That is the
     * whole floor-plan screen in one call.
     */
    public function computers(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $date = date('Y-m-d', strtotime($this->q('date') ?? 'today') ?: time());

        $where       = ['c.ssms_client_code = ?'];
        $whereParams = [];

        if (($v = $this->q('zone')) !== null) {
            $where[] = 'c.zone = ?';
            $whereParams[] = $v;
        }
        if (($v = $this->q('type')) !== null) {
            $where[] = 'c.computer_type = ?';
            $whereParams[] = $v;
        }
        if (($v = $this->q('status')) !== null) {
            $where[] = 'c.status = ?';
            $whereParams[] = $v;
        }

        $whereSql = implode(' AND ', $where);

        // Positional parameters bind in the order the placeholders appear in the
        // SQL *text*, and the two correlated subqueries sit in the SELECT list —
        // so their dates come before anything in the WHERE clause.
        //
        // The previous version passed [clientCode, date, date, ...filters], which
        // fed the client code into the first subquery's booking_date and a date
        // into ssms_client_code. That matched no rows, so every device vanished
        // and free / in use / total all read zero.
        //
        // Keeping the WHERE parameters in their own list removes the index
        // arithmetic that made the order easy to get wrong.
        $ordered = array_merge([$date, $date, $clientCode], $whereParams);

        $rows = $this->db()->execute(
            "SELECT c.id, c.asset_tag, c.label, c.computer_type, c.zone, c.row_no,
                    c.seat_no, c.specs, c.status,
                    (SELECT CONCAT(m.full_name, '|', bk.end_time)
                       FROM lib_computer_bookings bk
                       JOIN lib_members m ON m.id = bk.member_id
                      WHERE bk.computer_id = c.id AND bk.booking_date = ?
                        AND bk.status = 'Active'
                      ORDER BY bk.start_time ASC LIMIT 1) AS in_use_by,
                    (SELECT COUNT(*) FROM lib_computer_bookings bk2
                      WHERE bk2.computer_id = c.id AND bk2.booking_date = ?
                        AND bk2.status IN ('Booked','Active')) AS bookings_today
             FROM   lib_computers c
             WHERE  {$whereSql}
             ORDER  BY c.zone ASC, c.label ASC",
            $ordered
        )->fetchAll('assoc');

        foreach ($rows as &$r) {
            $r = $this->castRow($r, ['id', 'bookings_today']);
            // Flattened in SQL to keep this a single query; split for the client.
            if (!empty($r['in_use_by'])) {
                [$name, $until] = array_pad(explode('|', (string)$r['in_use_by'], 2), 2, null);
                $r['current'] = ['member_name' => $name, 'until' => $until];
            } else {
                $r['current'] = null;
            }
            unset($r['in_use_by']);
        }
        unset($r);

        $zones = $this->db()->execute(
            "SELECT DISTINCT zone FROM lib_computers
             WHERE ssms_client_code = ? AND zone IS NOT NULL AND zone <> '' ORDER BY zone",
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok([
            'date'      => $date,
            'computers' => $rows,
            'zones'     => array_column($zones, 'zone'),
            'types'     => ['Desktop', 'Laptop', 'iMac', 'Tablet', 'Study Desk'],
            'statuses'  => ['Available', 'InUse', 'Maintenance', 'Retired'],
        ]);
    }

    /** POST|PUT /libraryFacilityApi/saveComputer */
    public function saveComputer(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body  = (array)$this->request->getData();
        $id    = $this->intOrNull($body, 'id');
        $label = $this->str($body, 'label');

        if ($label === '') {
            $this->invalid('A label is required (e.g. PC-01).', ['label' => 'Required']);

            return;
        }

        $type = $this->str($body, 'computer_type') ?: 'Desktop';
        if (!in_array($type, ['Desktop', 'Laptop', 'iMac', 'Tablet', 'Study Desk'], true)) {
            $this->invalid('Invalid device type.', ['computer_type' => 'Invalid']);

            return;
        }

        $status = $this->str($body, 'status') ?: 'Available';
        if (!in_array($status, ['Available', 'InUse', 'Maintenance', 'Retired'], true)) {
            $this->invalid('Invalid status.', ['status' => 'Invalid']);

            return;
        }

        $db = $this->db();

        $dupe = $db->execute(
            'SELECT id FROM lib_computers
             WHERE ssms_client_code = ? AND LOWER(label) = LOWER(?) AND (? IS NULL OR id <> ?) LIMIT 1',
            [$clientCode, $label, $id, $id]
        )->fetch('assoc');

        if ($dupe) {
            $this->conflict('A device labelled "' . $label . '" already exists.');

            return;
        }

        $fields = [
            'asset_tag'     => $this->str($body, 'asset_tag') ?: null,
            'label'         => $label,
            'computer_type' => $type,
            'zone'          => $this->str($body, 'zone') ?: null,
            'row_no'        => $this->str($body, 'row_no') ?: null,
            'seat_no'       => $this->str($body, 'seat_no') ?: null,
            'specs'         => $this->str($body, 'specs') ?: null,
            'status'        => $status,
        ];

        if ($id) {
            $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
            $db->execute(
                "UPDATE lib_computers SET {$set} WHERE id = ? AND ssms_client_code = ?",
                array_merge(array_values($fields), [$id, $clientCode])
            );
        } else {
            $cols = array_merge(['ssms_client_code'], array_keys($fields));
            $ph   = implode(', ', array_fill(0, count($cols), '?'));
            $db->execute(
                'INSERT INTO lib_computers (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                array_merge([$clientCode], array_values($fields))
            );
            $id = $this->insertId();
        }

        $this->audit('computer', $id, 'save', null, $fields);
        $this->ok(['id' => $id], null, 'Device saved.');
    }

    /**
     * DELETE /libraryFacilityApi/deleteComputer/{id}
     * Blocked once it has booking history — retire it instead, which keeps the
     * history readable.
     */
    public function deleteComputer(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $computerId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT * FROM lib_computers WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$computerId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Device');

            return;
        }

        $used = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_computer_bookings WHERE computer_id = ?',
            [$computerId]
        )->fetch('assoc')['c'] ?? 0);

        if ($used > 0) {
            $this->conflict(
                'This device has ' . $used . ' booking(s) on record. Set it to Retired instead.',
                'IN_USE'
            );

            return;
        }

        $db->execute('DELETE FROM lib_computers WHERE id = ? AND ssms_client_code = ?', [$computerId, $clientCode]);

        $this->audit('computer', $computerId, 'delete', $row, null);
        $this->ok(['id' => $computerId], null, 'Device deleted.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AVAILABILITY
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryFacilityApi/availability?date=&zone=&type=
     *
     * The day grid: every machine crossed with every slot between opening and
     * closing, each marked free or taken. Computed here rather than in the app
     * so opening hours and slot length live in one place.
     */
    public function availability(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $date     = date('Y-m-d', strtotime($this->q('date') ?? 'today') ?: time());
        $settings = $this->settings($clientCode);

        $opens  = (string)($settings['library_opens'] ?? '08:00:00');
        $closes = (string)($settings['library_closes'] ?? '17:00:00');
        $slotH  = max(1, (int)($settings['computer_slot_hours'] ?? 2));

        $where  = ["c.ssms_client_code = ?", "c.status IN ('Available','InUse')"];
        $params = [$clientCode];

        if (($v = $this->q('zone')) !== null) {
            $where[] = 'c.zone = ?';
            $params[] = $v;
        }
        if (($v = $this->q('type')) !== null) {
            $where[] = 'c.computer_type = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $computers = $db->execute(
            "SELECT id, label, computer_type, zone, seat_no, status
             FROM   lib_computers c WHERE {$whereSql} ORDER BY c.zone, c.label",
            $params
        )->fetchAll('assoc');

        $bookings = $db->execute(
            "SELECT computer_id, id, start_time, end_time, status, member_id,
                    (SELECT full_name FROM lib_members m WHERE m.id = member_id) AS member_name
             FROM   lib_computer_bookings
             WHERE  ssms_client_code = ? AND booking_date = ?
               AND  status IN ('Booked','Active')",
            [$clientCode, $date]
        )->fetchAll('assoc');

        $byComputer = [];
        foreach ($bookings as $bk) {
            $byComputer[(int)$bk['computer_id']][] = $bk;
        }

        // Build the slot ladder once; every machine shares it.
        $slots = [];
        for ($t = strtotime($date . ' ' . $opens); $t < strtotime($date . ' ' . $closes); $t += $slotH * 3600) {
            $end = min($t + $slotH * 3600, strtotime($date . ' ' . $closes));
            $slots[] = ['start' => date('H:i:s', $t), 'end' => date('H:i:s', $end)];
        }

        $grid = [];
        foreach ($computers as $c) {
            $cid  = (int)$c['id'];
            $mine = $byComputer[$cid] ?? [];
            $row  = [];

            foreach ($slots as $slot) {
                $taken = null;
                foreach ($mine as $bk) {
                    // Overlap, not equality — a booking need not align to the grid.
                    if ($bk['start_time'] < $slot['end'] && $bk['end_time'] > $slot['start']) {
                        $taken = [
                            'booking_id'  => (int)$bk['id'],
                            'member_id'   => (int)$bk['member_id'],
                            'member_name' => $bk['member_name'],
                            'status'      => $bk['status'],
                        ];
                        break;
                    }
                }
                $row[] = ['start' => $slot['start'], 'end' => $slot['end'],
                          'free' => $taken === null, 'booking' => $taken];
            }

            $grid[] = [
                'computer' => $this->castRow($c, ['id']),
                'slots'    => $row,
            ];
        }

        $this->ok([
            'date'      => $date,
            'opens'     => $opens,
            'closes'    => $closes,
            'slotHours' => $slotH,
            'grid'      => $grid,
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BOOKINGS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryFacilityApi/bookings?date=&computerId=&memberId=&status=&page= */
    public function bookings(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['bk.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('date')) !== null) {
            $where[] = 'bk.booking_date = ?';
            $params[] = date('Y-m-d', strtotime($v) ?: time());
        }
        if (($v = $this->qInt('computerId')) !== null) {
            $where[] = 'bk.computer_id = ?';
            $params[] = $v;
        }
        if (($v = $this->qInt('memberId')) !== null) {
            $where[] = 'bk.member_id = ?';
            $params[] = $v;
        }
        if (($v = $this->q('status')) !== null) {
            $where[] = 'bk.status = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_computer_bookings bk WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT bk.*, c.label, c.computer_type, c.zone, c.seat_no,
                    m.membership_no, m.full_name AS member_name, m.class_section
             FROM   lib_computer_bookings bk
             JOIN   lib_computers c ON c.id = bk.computer_id
             JOIN   lib_members m   ON m.id = bk.member_id
             WHERE  {$whereSql}
             ORDER  BY bk.booking_date DESC, bk.start_time ASC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['id', 'computer_id', 'member_id']),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /**
     * POST|PUT /libraryFacilityApi/saveBooking
     * Body: { id?, computer_id*, member_id | member_code, booking_date*,
     *         start_time*, end_time*, purpose }
     *
     * Enforces, inside one transaction:
     *   - the machine is usable (not Maintenance/Retired)
     *   - the slot does not overlap an existing booking on that machine
     *   - the member is not already booked elsewhere at the same time
     *   - the slot is no longer than computer_slot_hours
     *   - the member is under computer_daily_limit for that date
     */
    public function saveBooking(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body       = (array)$this->request->getData();
        $bookingId  = $this->intOrNull($body, 'id');
        $computerId = $this->intOrNull($body, 'computer_id');
        $date       = $this->dateOrNull($body, 'booking_date');
        $start      = $this->timeOrNull($this->str($body, 'start_time'));
        $end        = $this->timeOrNull($this->str($body, 'end_time'));

        if (!$computerId) {
            $this->invalid('A device must be selected.', ['computer_id' => 'Required']);

            return;
        }
        if ($date === null) {
            $this->invalid('A date is required.', ['booking_date' => 'Required']);

            return;
        }
        if ($start === null || $end === null) {
            $this->invalid('Start and end times are required (HH:MM).', ['start_time' => 'Required']);

            return;
        }
        if ($end <= $start) {
            $this->invalid('End time must be after start time.', ['end_time' => 'Invalid']);

            return;
        }

        $member = $this->resolveMember($clientCode, $body);
        if (!$member) {
            $this->fail(404, 'Member not found.', 'NOT_FOUND');

            return;
        }

        $memberId = (int)$member['id'];
        $settings = $this->settings($clientCode);
        $maxHours = max(1, (int)($settings['computer_slot_hours'] ?? 2));
        $dailyCap = max(1, (int)($settings['computer_daily_limit'] ?? 1));

        $hours = (strtotime($date . ' ' . $end) - strtotime($date . ' ' . $start)) / 3600;
        if ($hours > $maxHours) {
            $this->conflict(
                'Bookings are limited to ' . $maxHours . ' hour' . ($maxHours === 1 ? '' : 's') . '.',
                'LIMIT_REACHED'
            );

            return;
        }

        if (strtolower((string)$member['status']) !== 'active') {
            $this->conflict('Membership is ' . strtolower((string)$member['status']) . '.', 'MEMBER_BLOCKED');

            return;
        }

        try {
            $result = $this->transact(function () use (
                $clientCode, $bookingId, $computerId, $memberId, $date, $start, $end, $body, $dailyCap
            ) {
                $db = $this->db();

                $computer = $db->execute(
                    'SELECT * FROM lib_computers WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                    [$computerId, $clientCode]
                )->fetch('assoc');

                if (!$computer) {
                    return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Device not found.']];
                }
                if (in_array($computer['status'], ['Maintenance', 'Retired'], true)) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'NOT_AVAILABLE',
                        'message' => $computer['label'] . ' is ' . strtolower((string)$computer['status']) . '.',
                    ]];
                }

                // Lock the day's bookings for this machine, then test overlap.
                // Reading without the lock lets two people book the same slot in
                // the same instant, which is exactly what a booking grid must not do.
                $clash = $db->execute(
                    "SELECT bk.id, m.full_name, bk.start_time, bk.end_time
                     FROM   lib_computer_bookings bk
                     JOIN   lib_members m ON m.id = bk.member_id
                     WHERE  bk.computer_id = ? AND bk.booking_date = ?
                       AND  bk.status IN ('Booked','Active')
                       AND  (? IS NULL OR bk.id <> ?)
                       AND  bk.start_time < ? AND bk.end_time > ?
                     LIMIT  1
                     FOR UPDATE",
                    [$computerId, $date, $bookingId, $bookingId, $end, $start]
                )->fetch('assoc');

                if ($clash) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'SLOT_TAKEN',
                        'message' => 'Already booked ' . substr((string)$clash['start_time'], 0, 5)
                                     . '–' . substr((string)$clash['end_time'], 0, 5)
                                     . ' by ' . $clash['full_name'] . '.',
                    ]];
                }

                // The same member cannot sit at two machines at once.
                $double = $db->execute(
                    "SELECT bk.id, c.label
                     FROM   lib_computer_bookings bk
                     JOIN   lib_computers c ON c.id = bk.computer_id
                     WHERE  bk.member_id = ? AND bk.booking_date = ?
                       AND  bk.status IN ('Booked','Active')
                       AND  (? IS NULL OR bk.id <> ?)
                       AND  bk.start_time < ? AND bk.end_time > ?
                     LIMIT  1",
                    [$memberId, $date, $bookingId, $bookingId, $end, $start]
                )->fetch('assoc');

                if ($double) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'DUPLICATE',
                        'message' => 'This member is already booked on ' . $double['label'] . ' at that time.',
                    ]];
                }

                $usedToday = (int)($db->execute(
                    "SELECT COUNT(*) AS c FROM lib_computer_bookings
                     WHERE member_id = ? AND booking_date = ?
                       AND status IN ('Booked','Active','Completed')
                       AND (? IS NULL OR id <> ?)",
                    [$memberId, $date, $bookingId, $bookingId]
                )->fetch('assoc')['c'] ?? 0);

                if ($usedToday >= $dailyCap) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'LIMIT_REACHED',
                        'message' => 'Members may book ' . $dailyCap . ' session'
                                     . ($dailyCap === 1 ? '' : 's') . ' per day.',
                    ]];
                }

                $fields = [
                    'computer_id'  => $computerId,
                    'member_id'    => $memberId,
                    'booking_date' => $date,
                    'start_time'   => $start,
                    'end_time'     => $end,
                    'purpose'      => $this->str($body, 'purpose') ?: null,
                    'booked_by'    => $this->actor(),
                    'notes'        => $this->str($body, 'notes') ?: null,
                ];

                if ($bookingId) {
                    $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
                    $db->execute(
                        "UPDATE lib_computer_bookings SET {$set} WHERE id = ? AND ssms_client_code = ?",
                        array_merge(array_values($fields), [$bookingId, $clientCode])
                    );
                    $id = $bookingId;
                } else {
                    $cols = array_merge(['ssms_client_code'], array_keys($fields), ['status']);
                    $vals = array_merge([$clientCode], array_values($fields), ['Booked']);
                    $ph   = implode(', ', array_fill(0, count($cols), '?'));
                    $db->execute(
                        'INSERT INTO lib_computer_bookings (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                        $vals
                    );
                    $id = $this->insertId();
                }

                return ['ok' => true, 'data' => [
                    'id'          => $id,
                    'computer_id' => $computerId,
                    'label'       => $computer['label'],
                    'member_id'   => $memberId,
                    'date'        => $date,
                    'start_time'  => $start,
                    'end_time'    => $end,
                ]];
            });
        } catch (\Throwable $e) {
            Log::error('saveBooking failed: ' . $e->getMessage());
            $this->fail(500, 'The booking was not saved.', 'SERVER_ERROR');

            return;
        }

        if (($result['ok'] ?? false) !== true) {
            $err = $result['error'];
            $this->fail($err['code'] === 'NOT_FOUND' ? 404 : 409, $err['message'], $err['code']);

            return;
        }

        $this->audit('booking', (int)$result['data']['id'], $bookingId ? 'update' : 'create', null, $result['data']);
        $this->ok($result['data'], null, $bookingId ? 'Booking updated.' : 'Booked.');
    }

    /**
     * POST /libraryFacilityApi/checkIn
     * Body: { booking_id* }  — or { computer_id, member_id } for a walk-up.
     */
    public function checkIn(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body      = (array)$this->request->getData();
        $bookingId = $this->intOrNull($body, 'booking_id');

        if (!$bookingId) {
            $this->invalid('A booking must be selected.', ['booking_id' => 'Required']);

            return;
        }

        $db = $this->db();

        $bk = $db->execute(
            'SELECT bk.*, c.label FROM lib_computer_bookings bk
             JOIN   lib_computers c ON c.id = bk.computer_id
             WHERE  bk.id = ? AND bk.ssms_client_code = ? LIMIT 1',
            [$bookingId, $clientCode]
        )->fetch('assoc');

        if (!$bk) {
            $this->notFound('Booking');

            return;
        }
        if ($bk['status'] !== 'Booked') {
            $this->conflict('This booking is already ' . strtolower((string)$bk['status']) . '.');

            return;
        }

        $this->transact(function () use ($db, $bookingId, $bk, $clientCode) {
            $db->execute(
                "UPDATE lib_computer_bookings
                 SET status = 'Active', actual_start = NOW(), checked_in_by = ?
                 WHERE id = ? AND ssms_client_code = ?",
                [$this->actor(), $bookingId, $clientCode]
            );
            $db->execute(
                "UPDATE lib_computers SET status = 'InUse' WHERE id = ? AND status = 'Available'",
                [(int)$bk['computer_id']]
            );
        });

        $this->ok(['id' => $bookingId, 'label' => $bk['label']], null, 'Checked in to ' . $bk['label'] . '.');
    }

    /**
     * POST /libraryFacilityApi/checkOut
     * Body: { booking_id* }
     *
     * Frees the machine only if no other session is live on it, so a back-to-back
     * handover does not accidentally mark an occupied machine as free.
     */
    public function checkOut(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body      = (array)$this->request->getData();
        $bookingId = $this->intOrNull($body, 'booking_id');

        if (!$bookingId) {
            $this->invalid('A booking must be selected.', ['booking_id' => 'Required']);

            return;
        }

        $db = $this->db();

        $bk = $db->execute(
            'SELECT * FROM lib_computer_bookings WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$bookingId, $clientCode]
        )->fetch('assoc');

        if (!$bk) {
            $this->notFound('Booking');

            return;
        }
        if ($bk['status'] !== 'Active') {
            $this->conflict('This session is not active.');

            return;
        }

        $this->transact(function () use ($db, $bookingId, $bk, $clientCode) {
            $db->execute(
                "UPDATE lib_computer_bookings
                 SET status = 'Completed', actual_end = NOW()
                 WHERE id = ? AND ssms_client_code = ?",
                [$bookingId, $clientCode]
            );

            $stillBusy = $db->execute(
                "SELECT COUNT(*) AS c FROM lib_computer_bookings
                 WHERE computer_id = ? AND status = 'Active'",
                [(int)$bk['computer_id']]
            )->fetch('assoc');

            if ((int)($stillBusy['c'] ?? 0) === 0) {
                $db->execute(
                    "UPDATE lib_computers SET status = 'Available' WHERE id = ? AND status = 'InUse'",
                    [(int)$bk['computer_id']]
                );
            }
        });

        $this->ok(['id' => $bookingId], null, 'Session ended.');
    }

    /**
     * POST /libraryFacilityApi/cancelBooking
     * Body: { booking_id*, reason }
     */
    public function cancelBooking(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body      = (array)$this->request->getData();
        $bookingId = $this->intOrNull($body, 'booking_id');
        $reason    = $this->str($body, 'reason');

        if (!$bookingId) {
            $this->invalid('A booking must be selected.', ['booking_id' => 'Required']);

            return;
        }

        $db = $this->db();

        $bk = $db->execute(
            'SELECT * FROM lib_computer_bookings WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$bookingId, $clientCode]
        )->fetch('assoc');

        if (!$bk) {
            $this->notFound('Booking');

            return;
        }
        if (!in_array($bk['status'], ['Booked', 'Active'], true)) {
            $this->conflict('This booking is already ' . strtolower((string)$bk['status']) . '.');

            return;
        }

        $this->transact(function () use ($db, $bookingId, $bk, $clientCode, $reason) {
            $db->execute(
                "UPDATE lib_computer_bookings
                 SET status = 'Cancelled', notes = CONCAT(COALESCE(notes, ''), ?)
                 WHERE id = ? AND ssms_client_code = ?",
                ["\n" . date('Y-m-d') . ' — cancelled' . ($reason ? ': ' . $reason : ''), $bookingId, $clientCode]
            );

            if ($bk['status'] === 'Active') {
                $stillBusy = $db->execute(
                    "SELECT COUNT(*) AS c FROM lib_computer_bookings
                     WHERE computer_id = ? AND status = 'Active'",
                    [(int)$bk['computer_id']]
                )->fetch('assoc');

                if ((int)($stillBusy['c'] ?? 0) === 0) {
                    $db->execute(
                        "UPDATE lib_computers SET status = 'Available' WHERE id = ? AND status = 'InUse'",
                        [(int)$bk['computer_id']]
                    );
                }
            }
        });

        $this->audit('booking', $bookingId, 'cancel', $bk, ['reason' => $reason]);
        $this->ok(['id' => $bookingId], null, 'Booking cancelled.');
    }

    /**
     * POST /libraryFacilityApi/sweepNoShows
     *
     * Maintenance sweep — run from cron every few minutes during opening hours.
     * A booking nobody turned up for holds a machine hostage for its whole slot;
     * after computer_noshowgrace minutes it is released for someone else.
     */
    public function sweepNoShows(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $settings = $this->settings($clientCode);
        $grace    = max(1, (int)($settings['computer_noshowgrace'] ?? 15));

        $db = $this->db();

        $stale = $db->execute(
            "SELECT id, computer_id FROM lib_computer_bookings
             WHERE  ssms_client_code = ? AND status = 'Booked'
               AND  booking_date = CURDATE()
               AND  TIMESTAMPDIFF(MINUTE, CONCAT(booking_date, ' ', start_time), NOW()) > ?",
            [$clientCode, $grace]
        )->fetchAll('assoc');

        foreach ($stale as $bk) {
            $db->execute(
                "UPDATE lib_computer_bookings SET status = 'NoShow' WHERE id = ?",
                [(int)$bk['id']]
            );
        }

        // Yesterday's leftovers: anything still Booked or Active on a past date
        // is stale by definition.
        $db->execute(
            "UPDATE lib_computer_bookings
             SET    status = CASE WHEN status = 'Active' THEN 'Completed' ELSE 'NoShow' END
             WHERE  ssms_client_code = ? AND booking_date < CURDATE()
               AND  status IN ('Booked','Active')",
            [$clientCode]
        );

        // Any machine with no live session should not be showing as InUse.
        $db->execute(
            "UPDATE lib_computers c
             SET    c.status = 'Available'
             WHERE  c.ssms_client_code = ? AND c.status = 'InUse'
               AND  NOT EXISTS (SELECT 1 FROM lib_computer_bookings bk
                                WHERE bk.computer_id = c.id AND bk.status = 'Active')",
            [$clientCode]
        );

        $this->ok(
            ['noShows' => count($stale), 'graceMinutes' => $grace],
            null,
            count($stale) . ' no-show' . (count($stale) === 1 ? '' : 's') . ' released.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SHARED
    // ══════════════════════════════════════════════════════════════════════════

    /** Accept HH:MM or HH:MM:SS, return HH:MM:SS, or null when unusable. */
    private function timeOrNull(string $v): ?string
    {
        $v = trim($v);
        if ($v === '' || !preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', $v, $m)) {
            return null;
        }
        if ((int)$m[1] > 23 || (int)$m[2] > 59) {
            return null;
        }

        return sprintf('%02d:%02d:%02d', (int)$m[1], (int)$m[2], (int)($m[3] ?? 0));
    }
}
