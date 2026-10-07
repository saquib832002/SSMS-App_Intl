<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class LibFinesController extends AppController
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

    // ── GET /library/fines ────────────────────────────────────────────────────
    public function index(): void
    {
        if (!$this->_checkAccess()) return;

        $db     = $this->_db();
        $client = $this->_client();

        $status = $this->request->getQuery('status', 'Pending');
        $type   = $this->request->getQuery('type', '');

        $where  = ['f.ssms_client_code = ?'];
        $params = [$client];

        if ($status !== '') {
            $where[]  = 'f.status = ?';
            $params[] = $status;
        }
        if ($type !== '') {
            $where[]  = 'f.fine_type = ?';
            $params[] = $type;
        }

        $fines = $db->execute(
            "SELECT f.*, m.full_name AS member_name, m.membership_no,
                    b.title AS book_title, bc.accession_no,
                    (f.amount - f.paid_amount - f.waived_amount) AS balance
             FROM lib_fines f
             JOIN lib_members m ON m.id = f.member_id
             LEFT JOIN lib_checkouts co ON co.id = f.checkout_id
             LEFT JOIN lib_book_copies bc ON bc.id = co.copy_id
             LEFT JOIN lib_books b ON b.id = bc.book_id
             WHERE " . implode(' AND ', $where) . "
             ORDER BY f.created_at DESC",
            $params
        )->fetchAll('assoc');

        $summary = $db->execute(
            "SELECT
               SUM(IF(status='Pending', amount-paid_amount-waived_amount, 0)) AS pending_total,
               SUM(IF(status='Paid', paid_amount, 0)) AS collected_total,
               COUNT(IF(status='Pending',1,NULL)) AS pending_count,
               COUNT(IF(status='Waived',1,NULL)) AS waived_count
             FROM lib_fines WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');

        $clientRow = $db->execute(
            "SELECT currency FROM ssms_clients WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');
        $currency = ($clientRow["currency"] ?? "PKR");

        $this->set(compact('fines', 'summary', 'currency', 'status', 'type'));
    }

    // ── GET/POST /library/fines/collect/{fineId} ─────────────────────────────
    public function collect(int $fineId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db        = $this->_db();
        $client    = $this->_client();
        $librarian = $this->_user();

        $fine = $db->execute(
            "SELECT f.*, m.full_name AS member_name, m.membership_no,
                    b.title AS book_title,
                    (f.amount - f.paid_amount - f.waived_amount) AS balance
             FROM lib_fines f
             JOIN lib_members m ON m.id = f.member_id
             LEFT JOIN lib_checkouts co ON co.id = f.checkout_id
             LEFT JOIN lib_book_copies bc ON bc.id = co.copy_id
             LEFT JOIN lib_books b ON b.id = bc.book_id
             WHERE f.id=? AND f.ssms_client_code=?",
            [$fineId, $client]
        )->fetch('assoc');

        if (!$fine || $fine['status'] === 'Paid' || $fine['status'] === 'Waived') {
            $this->Flash->error('Fine not found or already resolved.');
            $this->redirect(['action' => 'index']);
            return;
        }

        $errors = [];

        if ($this->request->is('post')) {
            $amountPaid = (float)$this->request->getData('amount_paid');
            $method     = $this->request->getData('payment_method', 'Cash');
            $receipt    = trim((string)$this->request->getData('receipt_no'));

            $balance = (float)$fine['balance'];

            if ($amountPaid <= 0) {
                $errors[] = 'Payment amount must be greater than zero.';
            } elseif ($amountPaid > $balance) {
                $errors[] = "Payment ({$amountPaid}) exceeds outstanding balance ({$balance}).";
            }

            if (empty($errors)) {
                // Log payment
                $db->execute(
                    "INSERT INTO lib_fine_payments
                     (fine_id, amount_paid, payment_method, receipt_no, collected_by)
                     VALUES (?,?,?,?,?)",
                    [$fineId, $amountPaid, $method, $receipt, $librarian]
                );

                $newPaid = (float)$fine['paid_amount'] + $amountPaid;
                $remaining = $fine['amount'] - $newPaid - $fine['waived_amount'];
                $newStatus = $remaining <= 0.001 ? 'Paid' : 'Partial';

                $db->execute(
                    "UPDATE lib_fines SET paid_amount=?, status=? WHERE id=?",
                    [$newPaid, $newStatus, $fineId]
                );

                $this->Flash->success("Payment of {$amountPaid} recorded. Status: {$newStatus}.");
                $this->redirect(['action' => 'index']);
                return;
            }
        }

        $clientRow = $db->execute(
            "SELECT currency FROM ssms_clients WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');
        $currency = ($clientRow["currency"] ?? "PKR");

        $this->set(compact('fine', 'errors', 'currency'));
    }

    // ── POST /library/fines/waive/{fineId} ───────────────────────────────────
    public function waive(int $fineId = 0): void
    {
        if (!$this->_checkAccess()) return;

        $db        = $this->_db();
        $client    = $this->_client();
        $librarian = $this->_user();

        $fine = $db->execute(
            "SELECT * FROM lib_fines WHERE id=? AND ssms_client_code=?",
            [$fineId, $client]
        )->fetch('assoc');

        if (!$fine || in_array($fine['status'], ['Paid', 'Waived'])) {
            $this->Flash->error('Fine not found or already resolved.');
            $this->redirect(['action' => 'index']);
            return;
        }

        if ($this->request->is('post')) {
            $reason      = trim((string)$this->request->getData('waive_reason'));
            $waivedAmt   = (float)($fine['amount'] - $fine['paid_amount']);

            $db->execute(
                "UPDATE lib_fines SET status='Waived', waived_amount=?, waived_by=?, waive_reason=? WHERE id=?",
                [$waivedAmt, $librarian, $reason, $fineId]
            );

            $this->Flash->success('Fine waived successfully.');
            $this->redirect(['action' => 'index']);
            return;
        }

        $clientRow = $db->execute(
            "SELECT currency FROM ssms_clients WHERE ssms_client_code=?",
            [$client]
        )->fetch('assoc');
        $currency = ($clientRow["currency"] ?? "PKR");

        $this->set(compact('fine', 'currency'));
    }
}
