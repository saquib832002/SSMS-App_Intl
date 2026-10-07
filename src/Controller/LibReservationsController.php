<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class LibReservationsController extends AppController
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

    // ── GET /library/reservations ─────────────────────────────────────────────
    public function index(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $reservations = $db->execute(
            "SELECT r.*, b.title AS book_title, b.available_copies,
                    m.full_name AS member_name, m.membership_no, m.email
             FROM lib_reservations r
             JOIN lib_books b ON b.id = r.book_id
             JOIN lib_members m ON m.id = r.member_id
             WHERE r.ssms_client_code=? AND r.status IN ('Waiting','Notified')
             ORDER BY b.title, r.queue_position",
            [$client]
        )->fetchAll('assoc');

        $this->set(compact('reservations'));
    }

    // ── GET/POST /library/reservations/place ──────────────────────────────────
    public function place(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $errors  = [];
        $success = false;

        if ($this->request->is('post')) {
            $memberNo = strtoupper(trim((string)$this->request->getData('membership_no')));
            $bookId   = (int)$this->request->getData('book_id');

            $member = $db->execute(
                "SELECT * FROM lib_members WHERE membership_no=? AND ssms_client_code=?",
                [$memberNo, $client]
            )->fetch('assoc');

            if (!$member) {
                $errors[] = "Member '{$memberNo}' not found.";
            } elseif ($member['status'] !== 'Active') {
                $errors[] = "Member is {$member['status']} and cannot place holds.";
            }

            $book = $db->execute(
                "SELECT * FROM lib_books WHERE id=? AND ssms_client_code=?",
                [$bookId, $client]
            )->fetch('assoc');

            if (!$book) {
                $errors[] = "Book not found.";
            } elseif ($book['is_reference']) {
                $errors[] = "Reference books cannot be reserved.";
            } elseif ($book['available_copies'] > 0) {
                $errors[] = "This book is currently available. Please check it out directly.";
            }

            if (empty($errors) && $member && $book) {
                // Check duplicate reservation
                $existing = $db->execute(
                    "SELECT id FROM lib_reservations
                     WHERE member_id=? AND book_id=? AND ssms_client_code=? AND status IN ('Waiting','Notified')",
                    [$member['id'], $bookId, $client]
                )->fetch('assoc');

                if ($existing) {
                    $errors[] = "Member already has an active hold for this book.";
                }
            }

            if (empty($errors) && $member && $book) {
                // Get next queue position
                $queuePos = $db->execute(
                    "SELECT COALESCE(MAX(queue_position), 0) + 1 AS next
                     FROM lib_reservations
                     WHERE book_id=? AND ssms_client_code=? AND status IN ('Waiting','Notified')",
                    [$bookId, $client]
                )->fetch('assoc')['next'];

                $db->execute(
                    "INSERT INTO lib_reservations
                     (ssms_client_code, member_id, book_id, queue_position, status)
                     VALUES (?,?,?,?,'Waiting')",
                    [$client, $member['id'], $bookId, $queuePos]
                );

                $success = true;
            }
        }

        // Load books with all copies issued for the form
        $booksFullyOut = $db->execute(
            "SELECT id, title, isbn FROM lib_books
             WHERE ssms_client_code=? AND available_copies=0 AND is_reference=0
             ORDER BY title",
            [$client]
        )->fetchAll('assoc');

        $this->set(compact('errors', 'success', 'booksFullyOut'));
    }

    // ── POST /library/reservations/cancel/{id} ────────────────────────────────
    public function cancel(int $reservationId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $reason = trim((string)$this->request->getData('reason', 'Cancelled by librarian'));

        $db->execute(
            "UPDATE lib_reservations SET status='Cancelled', cancelled_reason=?
             WHERE id=? AND ssms_client_code=? AND status IN ('Waiting','Notified')",
            [$reason, $reservationId, $client]
        );

        // If there's a copy assigned, release it
        $reservation = $db->execute(
            "SELECT copy_id, book_id FROM lib_reservations WHERE id=?",
            [$reservationId]
        )->fetch('assoc');

        if ($reservation && $reservation['copy_id']) {
            $db->execute(
                "UPDATE lib_book_copies SET status='Available' WHERE id=?",
                [$reservation['copy_id']]
            );
            $db->execute(
                "UPDATE lib_books SET available_copies=available_copies+1 WHERE id=?",
                [$reservation['book_id']]
            );
        }

        // Re-number queue positions
        if ($reservation) {
            $db->execute(
                "SET @pos := 0;
                 UPDATE lib_reservations
                 SET queue_position = (@pos := @pos + 1)
                 WHERE book_id=? AND ssms_client_code=? AND status IN ('Waiting','Notified')
                 ORDER BY queue_position",
                [$reservation['book_id'], $client]
            );
        }

        $this->Flash->success('Reservation cancelled.');
        $this->redirect(['action' => 'index']);
    }
}
