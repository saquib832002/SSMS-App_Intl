<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class LibComputersController extends AppController
{
    private function _db() { return ConnectionManager::get('default'); }
    private function _client(): string
    {
        return (string)$this->request->getSession()->read('ssms_client_code');
    }
    private function _user(): string
    {
        return (string)$this->request->getSession()->read('ssms_user_name');
    }
    private function _checkAccess(): bool
    {
        if (!$this->request->getSession()->read('ssms_user_role')) {
            $this->Flash->error('Please log in.');
            $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
            return false;
        }
        return true;
    }

    // ── GET /library/computers ────────────────────────────────────────────────
    public function index(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $computers = $db->execute(
            "SELECT c.*,
                    (SELECT COUNT(*) FROM lib_computer_bookings b
                     WHERE b.computer_id=c.id AND b.booking_date=CURDATE()
                     AND b.status IN ('Booked','Active')) AS bookings_today
             FROM lib_computers c
             WHERE c.ssms_client_code = ?
             ORDER BY c.zone, c.label",
            [$client]
        )->fetchAll('assoc');

        // Stats
        $stats = $db->execute(
            "SELECT
               COUNT(*) AS total,
               SUM(IF(status='Available',1,0)) AS available,
               SUM(IF(status='InUse',1,0)) AS in_use,
               SUM(IF(status='Maintenance',1,0)) AS maintenance
             FROM lib_computers WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');

        $this->set(compact('computers', 'stats'));
    }

    // ── GET/POST /library/computers/add ──────────────────────────────────────
    public function add(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();
        $errors = [];

        if ($this->request->is('post')) {
            $label = trim((string)$this->request->getData('label'));
            if ($label === '') $errors[] = 'Label / name is required.';

            if (empty($errors)) {
                $db->execute(
                    "INSERT INTO lib_computers
                     (ssms_client_code, asset_tag, label, computer_type, zone, row_no, seat_no, specs)
                     VALUES (?,?,?,?,?,?,?,?)",
                    [
                        $client,
                        strtoupper(trim((string)$this->request->getData('asset_tag'))),
                        $label,
                        $this->request->getData('computer_type', 'Desktop'),
                        trim((string)$this->request->getData('zone')),
                        trim((string)$this->request->getData('row_no')),
                        trim((string)$this->request->getData('seat_no')),
                        trim((string)$this->request->getData('specs')),
                    ]
                );
                $this->Flash->success("'{$label}' added to library computers.");
                $this->redirect(['action' => 'index']);
                return;
            }
        }

        $this->set(compact('errors'));
    }

    // ── GET/POST /library/computers/edit/{id} ────────────────────────────────
    public function edit(int $computerId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $computer = $db->execute(
            "SELECT * FROM lib_computers WHERE id=? AND ssms_client_code=?",
            [$computerId, $client]
        )->fetch('assoc');

        if (!$computer) {
            $this->Flash->error('Computer not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        $errors = [];

        if ($this->request->is('post')) {
            $label = trim((string)$this->request->getData('label'));
            if ($label === '') $errors[] = 'Label is required.';

            if (empty($errors)) {
                $db->execute(
                    "UPDATE lib_computers SET asset_tag=?, label=?, computer_type=?, zone=?,
                      row_no=?, seat_no=?, specs=?, status=?
                     WHERE id=? AND ssms_client_code=?",
                    [
                        strtoupper(trim((string)$this->request->getData('asset_tag'))),
                        $label,
                        $this->request->getData('computer_type', 'Desktop'),
                        trim((string)$this->request->getData('zone')),
                        trim((string)$this->request->getData('row_no')),
                        trim((string)$this->request->getData('seat_no')),
                        trim((string)$this->request->getData('specs')),
                        $this->request->getData('status', 'Available'),
                        $computerId, $client
                    ]
                );
                $this->Flash->success('Computer updated.');
                $this->redirect(['action' => 'index']);
                return;
            }

            $computer = array_merge($computer, $this->request->getData());
        }

        $this->set(compact('computer', 'errors'));
    }

    // ── GET /library/computers/availability ──────────────────────────────────
    // Live seat map for a given date
    public function availability(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $date = $this->request->getQuery('date', date('Y-m-d'));
        // Validate date
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $settings = $db->execute(
            "SELECT library_opens, library_closes, computer_slot_hours FROM lib_settings WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');

        $opens  = $settings['library_opens']  ?? '08:00:00';
        $closes = $settings['library_closes'] ?? '17:00:00';
        $slotH  = (int)($settings['computer_slot_hours'] ?? 2);

        // Generate time slots
        $slots = [];
        $cur   = strtotime($date . ' ' . $opens);
        $end   = strtotime($date . ' ' . $closes);
        while ($cur + ($slotH * 3600) <= $end) {
            $slots[] = [
                'start' => date('H:i', $cur),
                'end'   => date('H:i', $cur + ($slotH * 3600)),
            ];
            $cur += ($slotH * 3600);
        }

        $computers = $db->execute(
            "SELECT * FROM lib_computers WHERE ssms_client_code=? AND status != 'Retired' ORDER BY zone, label",
            [$client]
        )->fetchAll('assoc');

        // All bookings for that date
        $bookings = $db->execute(
            "SELECT cb.*, m.full_name AS member_name
             FROM lib_computer_bookings cb
             JOIN lib_members m ON m.id = cb.member_id
             WHERE cb.ssms_client_code=? AND cb.booking_date=? AND cb.status IN ('Booked','Active','Completed')
             ORDER BY cb.start_time",
            [$client, $date]
        )->fetchAll('assoc');

        // Index bookings by computer_id + start_time for quick lookup
        $bookingMap = [];
        foreach ($bookings as $b) {
            $bookingMap[$b['computer_id']][$b['start_time']] = $b;
        }

        $this->set(compact('computers', 'slots', 'bookings', 'bookingMap', 'date', 'settings'));
    }

    // ── GET/POST /library/computers/book ─────────────────────────────────────
    public function book(): void
    {
        if (!$this->_checkAccess()) return;

        $db        = $this->_db();
        $client    = $this->_client();
        $librarian = $this->_user();

        $errors  = [];
        $success = false;
        $booking = null;

        $settings = $db->execute(
            "SELECT * FROM lib_settings WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');

        $dailyLimit  = (int)($settings['computer_daily_limit'] ?? 1);

        if ($this->request->is('post')) {
            $memberNo   = strtoupper(trim((string)$this->request->getData('membership_no')));
            $computerId = (int)$this->request->getData('computer_id');
            $bookDate   = $this->request->getData('booking_date', date('Y-m-d'));
            $startTime  = $this->request->getData('start_time');
            $endTime    = $this->request->getData('end_time');
            $purpose    = trim((string)$this->request->getData('purpose', 'Study'));

            // Validate member
            $member = $db->execute(
                "SELECT * FROM lib_members WHERE membership_no=? AND ssms_client_code=?",
                [$memberNo, $client]
            )->fetch('assoc');

            if (!$member) {
                $errors[] = "Member '{$memberNo}' not found.";
            } elseif ($member['status'] !== 'Active') {
                $errors[] = "Member is {$member['status']} and cannot book computers.";
            }

            if (empty($errors)) {
                // Check daily booking limit
                $todayCount = $db->execute(
                    "SELECT COUNT(*) AS cnt FROM lib_computer_bookings
                     WHERE member_id=? AND ssms_client_code=? AND booking_date=? AND status NOT IN ('Cancelled','NoShow')",
                    [$member['id'], $client, $bookDate]
                )->fetch('assoc');

                if ((int)$todayCount['cnt'] >= $dailyLimit) {
                    $errors[] = "Member has already reached the daily booking limit ({$dailyLimit}) for {$bookDate}.";
                }
            }

            // Validate computer availability for this slot
            if (empty($errors)) {
                $overlap = $db->execute(
                    "SELECT id FROM lib_computer_bookings
                     WHERE computer_id=? AND booking_date=? AND status IN ('Booked','Active')
                     AND NOT (end_time <= ? OR start_time >= ?)",
                    [$computerId, $bookDate, $startTime, $endTime]
                )->fetch('assoc');

                if ($overlap) {
                    $errors[] = "This computer/desk is already booked for the selected time slot.";
                }
            }

            if (empty($errors) && $member) {
                $computer = $db->execute(
                    "SELECT * FROM lib_computers WHERE id=? AND ssms_client_code=?",
                    [$computerId, $client]
                )->fetch('assoc');

                $db->execute(
                    "INSERT INTO lib_computer_bookings
                     (ssms_client_code, computer_id, member_id, booking_date, start_time, end_time, purpose, booked_by, status)
                     VALUES (?,?,?,?,?,?,?,?,'Booked')",
                    [$client, $computerId, $member['id'], $bookDate, $startTime, $endTime, $purpose, $librarian]
                );

                $success = true;
                $booking = [
                    'member'   => $member,
                    'computer' => $computer,
                    'date'     => $bookDate,
                    'start'    => $startTime,
                    'end'      => $endTime,
                    'purpose'  => $purpose,
                ];
            }
        }

        // Fetch computers and settings for the form
        $computers = $db->execute(
            "SELECT * FROM lib_computers WHERE ssms_client_code=? AND status='Available' ORDER BY zone, label",
            [$client]
        )->fetchAll('assoc');

        $this->set(compact('errors', 'success', 'booking', 'computers', 'settings'));
    }

    // ── POST /library/computers/checkin/{bookingId} ───────────────────────────
    public function checkin(int $bookingId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db        = $this->_db();
        $client    = $this->_client();
        $librarian = $this->_user();

        $booking = $db->execute(
            "SELECT * FROM lib_computer_bookings WHERE id=? AND ssms_client_code=?",
            [$bookingId, $client]
        )->fetch('assoc');

        if ($booking && $booking['status'] === 'Booked') {
            $db->execute(
                "UPDATE lib_computer_bookings SET status='Active', actual_start=NOW(), checked_in_by=? WHERE id=?",
                [$librarian, $bookingId]
            );
            $db->execute(
                "UPDATE lib_computers SET status='InUse' WHERE id=?",
                [$booking['computer_id']]
            );
            $this->Flash->success('Member checked in. Session started.');
        } else {
            $this->Flash->error('Booking not found or already active.');
        }

        $this->redirect(['action' => 'bookings']);
    }

    // ── POST /library/computers/checkout/{bookingId} ──────────────────────────
    public function checkout(int $bookingId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db        = $this->_db();
        $client    = $this->_client();

        $booking = $db->execute(
            "SELECT * FROM lib_computer_bookings WHERE id=? AND ssms_client_code=?",
            [$bookingId, $client]
        )->fetch('assoc');

        if ($booking && $booking['status'] === 'Active') {
            $db->execute(
                "UPDATE lib_computer_bookings SET status='Completed', actual_end=NOW() WHERE id=?",
                [$bookingId]
            );
            $db->execute(
                "UPDATE lib_computers SET status='Available' WHERE id=?",
                [$booking['computer_id']]
            );
            $this->Flash->success('Session ended. Computer released.');
        } else {
            $this->Flash->error('Booking not found or not active.');
        }

        $this->redirect(['action' => 'bookings']);
    }

    // ── GET /library/computers/bookings ──────────────────────────────────────
    public function bookings(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $date = $this->request->getQuery('date', date('Y-m-d'));

        $bookings = $db->execute(
            "SELECT cb.*, c.label AS computer_label, c.zone,
                    m.full_name AS member_name, m.membership_no
             FROM lib_computer_bookings cb
             JOIN lib_computers c ON c.id = cb.computer_id
             JOIN lib_members m ON m.id = cb.member_id
             WHERE cb.ssms_client_code=? AND cb.booking_date=?
             ORDER BY cb.start_time, c.label",
            [$client, $date]
        )->fetchAll('assoc');

        $this->set(compact('bookings', 'date'));
    }
}
