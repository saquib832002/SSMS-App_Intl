<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class LibMembersController extends AppController
{
    private function _db() { return ConnectionManager::get('default'); }
    private function _client(): string
    {
        return (string)$this->request->getSession()->read('ssms_client_code');
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

    // ── GET /library/members ──────────────────────────────────────────────────
    public function index(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $search = trim((string)$this->request->getQuery('q', ''));
        $type   = $this->request->getQuery('type', '');
        $status = $this->request->getQuery('status', '');

        $where  = ['m.ssms_client_code = ?'];
        $params = [$client];

        if ($search !== '') {
            $where[]  = '(m.full_name LIKE ? OR m.membership_no LIKE ? OR m.email LIKE ?)';
            $params[] = "%{$search}%";
            $params[] = "%{$search}%";
            $params[] = "%{$search}%";
        }
        if ($type !== '') {
            $where[]  = 'm.member_type = ?';
            $params[] = $type;
        }
        if ($status !== '') {
            $where[]  = 'm.status = ?';
            $params[] = $status;
        }

        $members = $db->execute(
            "SELECT m.*,
                    COUNT(co.id) AS books_out,
                    SUM(IF(f.status IN ('Pending','Partial'), f.amount - f.paid_amount - f.waived_amount, 0)) AS pending_fines
             FROM lib_members m
             LEFT JOIN lib_checkouts co ON co.member_id = m.id AND co.status IN ('Active','Overdue')
             LEFT JOIN lib_fines f ON f.member_id = m.id
             WHERE " . implode(' AND ', $where) . "
             GROUP BY m.id
             ORDER BY m.full_name",
            $params
        )->fetchAll('assoc');

        // Stats
        $stats = $db->execute(
            "SELECT
               COUNT(*) AS total,
               SUM(IF(member_type='student',1,0)) AS students,
               SUM(IF(member_type='staff',1,0)) AS staff,
               SUM(IF(status='Active',1,0)) AS active,
               SUM(IF(status='Suspended',1,0)) AS suspended
             FROM lib_members WHERE ssms_client_code = ?",
            [$client]
        )->fetch('assoc');

        $this->set(compact('members', 'stats', 'search', 'type', 'status'));
    }

    // ── GET/POST /library/members/add ─────────────────────────────────────────
    public function add(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $errors = [];
        $data   = [];

        // Load classes for student member type
        $classes = $db->execute(
            "SELECT DISTINCT class_name FROM ssms_classes WHERE ssms_client_code = ? ORDER BY class_name",
            [$client]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $memberType = $this->request->getData('member_type', 'student');
            $fullName   = trim((string)$this->request->getData('full_name'));
            $email      = strtolower(trim((string)$this->request->getData('email')));
            $phone      = trim((string)$this->request->getData('phone'));
            $classSection = trim((string)$this->request->getData('class_section'));
            $refId      = trim((string)$this->request->getData('ref_id'));
            $validFrom  = $this->request->getData('valid_from') ?: date('Y-m-d');
            $validTo    = $this->request->getData('valid_to');
            $maxBooks   = (int)$this->request->getData('max_books', 3);

            if ($fullName === '') $errors[] = 'Full name is required.';

            if (empty($errors)) {
                // Auto-generate membership number: LIB-{clientCode}-{YYYY}-{sequence}
                $seq = $db->execute(
                    "SELECT COUNT(*)+1 AS next FROM lib_members WHERE ssms_client_code = ?",
                    [$client]
                )->fetch('assoc')['next'];

                $membershipNo = 'LIB-' . $client . '-' . date('Y') . '-' . str_pad((string)$seq, 4, '0', STR_PAD_LEFT);

                $db->execute(
                    "INSERT INTO lib_members
                     (ssms_client_code, membership_no, member_type, ref_id, full_name, email, phone,
                      class_section, max_books, valid_from, valid_to, status)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,'Active')",
                    [$client, $membershipNo, $memberType, $refId, $fullName, $email, $phone,
                     $classSection, $maxBooks, $validFrom ?: null, $validTo ?: null]
                );

                $newId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
                $this->Flash->success("Member '{$fullName}' enrolled with card no. {$membershipNo}.");
                $this->redirect(['action' => 'profile', $newId]);
                return;
            }

            $data = $this->request->getData();
        }

        $this->set(compact('errors', 'data', 'classes'));
    }

    // ── GET/POST /library/members/edit/{id} ──────────────────────────────────
    public function edit(int $memberId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $member = $db->execute(
            "SELECT * FROM lib_members WHERE id=? AND ssms_client_code=?",
            [$memberId, $client]
        )->fetch('assoc');

        if (!$member) {
            $this->Flash->error('Member not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        $errors = [];

        if ($this->request->is('post')) {
            $action = $this->request->getData('_action', 'update');

            if ($action === 'suspend') {
                $db->execute(
                    "UPDATE lib_members SET status='Suspended' WHERE id=? AND ssms_client_code=?",
                    [$memberId, $client]
                );
                $this->Flash->success('Member suspended.');
                $this->redirect(['action' => 'profile', $memberId]);
                return;
            } elseif ($action === 'activate') {
                $db->execute(
                    "UPDATE lib_members SET status='Active' WHERE id=? AND ssms_client_code=?",
                    [$memberId, $client]
                );
                $this->Flash->success('Member activated.');
                $this->redirect(['action' => 'profile', $memberId]);
                return;
            }

            $fullName = trim((string)$this->request->getData('full_name'));
            if ($fullName === '') $errors[] = 'Full name is required.';

            if (empty($errors)) {
                $db->execute(
                    "UPDATE lib_members SET full_name=?, email=?, phone=?, class_section=?,
                      max_books=?, valid_from=?, valid_to=?
                     WHERE id=? AND ssms_client_code=?",
                    [
                        $fullName,
                        strtolower(trim((string)$this->request->getData('email'))),
                        trim((string)$this->request->getData('phone')),
                        trim((string)$this->request->getData('class_section')),
                        (int)$this->request->getData('max_books', 3),
                        $this->request->getData('valid_from') ?: null,
                        $this->request->getData('valid_to') ?: null,
                        $memberId, $client
                    ]
                );
                $this->Flash->success('Member updated.');
                $this->redirect(['action' => 'profile', $memberId]);
                return;
            }

            $member = array_merge($member, $this->request->getData());
        }

        $this->set(compact('member', 'errors'));
    }

    // ── GET /library/members/profile/{id} ────────────────────────────────────
    public function profile(int $memberId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $member = $db->execute(
            "SELECT * FROM lib_members WHERE id=? AND ssms_client_code=?",
            [$memberId, $client]
        )->fetch('assoc');

        if (!$member) {
            $this->Flash->error('Member not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        // Currently checked-out books
        $booksOut = $db->execute(
            "SELECT co.*, bc.accession_no, b.title, b.id AS book_id,
                    DATEDIFF(CURDATE(), co.due_date) AS days_overdue
             FROM lib_checkouts co
             JOIN lib_book_copies bc ON bc.id = co.copy_id
             JOIN lib_books b ON b.id = bc.book_id
             WHERE co.member_id=? AND co.ssms_client_code=? AND co.status IN ('Active','Overdue')
             ORDER BY co.due_date",
            [$memberId, $client]
        )->fetchAll('assoc');

        // Pending fines
        $pendingFines = $db->execute(
            "SELECT f.*, co.id AS checkout_id, b.title AS book_title
             FROM lib_fines f
             LEFT JOIN lib_checkouts co ON co.id = f.checkout_id
             LEFT JOIN lib_book_copies bc ON bc.id = co.copy_id
             LEFT JOIN lib_books b ON b.id = bc.book_id
             WHERE f.member_id=? AND f.ssms_client_code=? AND f.status IN ('Pending','Partial')
             ORDER BY f.created_at DESC",
            [$memberId, $client]
        )->fetchAll('assoc');

        // Borrowing history (last 20)
        $history = $db->execute(
            "SELECT co.*, bc.accession_no, b.title
             FROM lib_checkouts co
             JOIN lib_book_copies bc ON bc.id = co.copy_id
             JOIN lib_books b ON b.id = bc.book_id
             WHERE co.member_id=? AND co.ssms_client_code=?
             ORDER BY co.issue_date DESC LIMIT 20",
            [$memberId, $client]
        )->fetchAll('assoc');

        // Active reservations
        $reservations = $db->execute(
            "SELECT r.*, b.title
             FROM lib_reservations r
             JOIN lib_books b ON b.id = r.book_id
             WHERE r.member_id=? AND r.ssms_client_code=? AND r.status IN ('Waiting','Notified')
             ORDER BY r.reserved_on",
            [$memberId, $client]
        )->fetchAll('assoc');

        // Computer bookings (upcoming)
        $computerBookings = $db->execute(
            "SELECT cb.*, c.label AS computer_label, c.zone
             FROM lib_computer_bookings cb
             JOIN lib_computers c ON c.id = cb.computer_id
             WHERE cb.member_id=? AND cb.ssms_client_code=? AND cb.booking_date >= CURDATE()
             AND cb.status IN ('Booked','Active')
             ORDER BY cb.booking_date, cb.start_time",
            [$memberId, $client]
        )->fetchAll('assoc');

        $settings = $db->execute(
            "SELECT currency_symbol FROM lib_settings WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');
        $currency = $settings['currency_symbol'] ?? 'PKR';

        $this->set(compact('member', 'booksOut', 'pendingFines', 'history', 'reservations', 'computerBookings', 'currency'));
    }

    // ── POST /library/members/bulkEnroll ─────────────────────────────────────
    // Enroll all students of a class who are not yet library members
    public function bulkEnroll(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        if ($this->request->is('post')) {
            $className  = trim((string)$this->request->getData('class_name'));
            $validFrom  = $this->request->getData('valid_from') ?: date('Y-m-d');
            $validTo    = $this->request->getData('valid_to') ?: date('Y-m-d', strtotime('+1 year'));

            if ($className === '') {
                $this->Flash->error('Please select a class.');
                $this->redirect(['action' => 'bulkEnroll']);
                return;
            }

            // Fetch all enrolled students in that class
            $students = $db->execute(
                "SELECT sr.ssms_reg_id, sr.ssms_firstname, sr.ssms_lastname, sr.ssms_email,
                        cl.class_name, sec.section_name
                 FROM ssms_student_registration sr
                 JOIN ssms_student_enrollment se ON se.ssms_reg_id = sr.ssms_reg_id
                 JOIN ssms_classes cl ON cl.class_id = se.class_id
                 LEFT JOIN ssms_sections sec ON sec.section_id = se.section_id
                 WHERE sr.ssms_client_code = ? AND cl.class_name = ?
                 AND sr.ssms_reg_id NOT IN (
                     SELECT ref_id FROM lib_members WHERE ssms_client_code = ? AND member_type = 'student'
                 )",
                [$client, $className, $client]
            )->fetchAll('assoc');

            $enrolled = 0;
            foreach ($students as $s) {
                $seq = $db->execute(
                    "SELECT COUNT(*)+1 AS next FROM lib_members WHERE ssms_client_code = ?",
                    [$client]
                )->fetch('assoc')['next'];

                $memberNo = 'LIB-' . $client . '-' . date('Y') . '-' . str_pad((string)$seq, 4, '0', STR_PAD_LEFT);
                $fullName = trim($s['ssms_firstname'] . ' ' . $s['ssms_lastname']);
                $section  = $s['class_name'] . ($s['section_name'] ? ' - ' . $s['section_name'] : '');

                $db->execute(
                    "INSERT INTO lib_members
                     (ssms_client_code, membership_no, member_type, ref_id, full_name, email,
                      class_section, max_books, valid_from, valid_to, status)
                     VALUES (?,?,'student',?,?,?,?,3,?,?,'Active')",
                    [$client, $memberNo, $s['ssms_reg_id'], $fullName, $s['ssms_email'] ?? '', $section, $validFrom, $validTo]
                );
                $enrolled++;
            }

            $this->Flash->success("{$enrolled} student(s) enrolled as library members.");
            $this->redirect(['action' => 'index']);
            return;
        }

        $classes = $db->execute(
            "SELECT DISTINCT class_name FROM ssms_classes WHERE ssms_client_code = ? ORDER BY class_name",
            [$client]
        )->fetchAll('assoc');

        $this->set(compact('classes'));
    }
}
