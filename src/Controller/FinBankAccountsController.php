<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinBankAccountsController extends AppController
{
    private function db() { return ConnectionManager::get('default'); }
    private function code(): string { return (string)$this->request->getSession()->read('ssms_client_code'); }
    private function user(): string { return (string)$this->request->getSession()->read('ssms_sawera_id'); }
    private function isOwner(): bool { return in_array(strtolower((string)$this->request->getSession()->read('ssms_user_role')), ['owner','admin'], true); }

    private function nextTxnRef(): string
    {
        $last = $this->db()->execute(
            "SELECT reference_no FROM fin_bank_transactions WHERE ssms_client_code=? ORDER BY txn_id DESC LIMIT 1",
            [$this->code()]
        )->fetch('assoc');
        if ($last && preg_match('/BT-(\d+)/', $last['reference_no'], $m)) {
            return 'BT-' . str_pad((string)((int)$m[1] + 1), 5, '0', STR_PAD_LEFT);
        }
        return 'BT-00001';
    }

    public function index()
    {
        $accounts = $this->db()->execute(
            "SELECT b.*, c.account_name
             FROM fin_bank_accounts b
             LEFT JOIN fin_chart_of_accounts c ON c.account_id=b.account_id
             WHERE b.ssms_client_code=?
             ORDER BY b.is_default DESC, b.bank_name ASC",
            [$this->code()]
        )->fetchAll('assoc');
        $totalBalance = array_sum(array_map(fn($a) => (float)($a['current_balance'] ?? 0), $accounts));
        $this->set(compact('accounts', 'totalBalance'));
    }

    public function add()
    {
        $coaAccounts = $this->db()->execute(
            "SELECT account_id, account_name FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_type='asset' AND is_active=1 ORDER BY account_name",
            [$this->code()]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $opening = (float)($d['opening_balance'] ?? 0);
            $this->db()->execute(
                "INSERT INTO fin_bank_accounts
                 (ssms_client_code,bank_name,branch_name,account_number,ifsc_code,
                  account_type,opening_balance,current_balance,account_id,is_default,notes,created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    $this->code(), $d['bank_name'], $d['branch_name'] ?? null,
                    $d['account_number'], $d['ifsc_code'] ?? null,
                    $d['account_type'] ?? 'current', $opening, $opening,
                    !empty($d['account_id']) ? (int)$d['account_id'] : null,
                    !empty($d['is_default']) ? 1 : 0,
                    $d['notes'] ?? null, $this->user()
                ]
            );
            if (!empty($d['is_default'])) {
                $newId = $this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
                $this->db()->execute(
                    "UPDATE fin_bank_accounts SET is_default=0 WHERE ssms_client_code=? AND bank_account_id!=?",
                    [$this->code(), $newId]
                );
            }
            $this->Flash->success('Bank account added.');
            return $this->redirect(['action' => 'index']);
        }
        $this->set(compact('coaAccounts'));
    }

    public function edit(int $id)
    {
        $account = $this->db()->execute(
            "SELECT * FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$account) { $this->Flash->error('Account not found.'); return $this->redirect(['action' => 'index']); }

        $coaAccounts = $this->db()->execute(
            "SELECT account_id, account_name FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_type='asset' AND is_active=1 ORDER BY account_name",
            [$this->code()]
        )->fetchAll('assoc');

        if ($this->request->is(['post', 'put'])) {
            $d = $this->request->getData();
            $this->db()->execute(
                "UPDATE fin_bank_accounts SET bank_name=?,branch_name=?,ifsc_code=?,account_type=?,
                 account_id=?,is_default=?,is_active=?,notes=?,modified=NOW()
                 WHERE bank_account_id=? AND ssms_client_code=?",
                [
                    $d['bank_name'], $d['branch_name'] ?? null, $d['ifsc_code'] ?? null,
                    $d['account_type'] ?? 'current',
                    !empty($d['account_id']) ? (int)$d['account_id'] : null,
                    !empty($d['is_default']) ? 1 : 0,
                    !empty($d['is_active']) ? 1 : 0,
                    $d['notes'] ?? null, $id, $this->code()
                ]
            );
            if (!empty($d['is_default'])) {
                $this->db()->execute(
                    "UPDATE fin_bank_accounts SET is_default=0 WHERE ssms_client_code=? AND bank_account_id!=?",
                    [$this->code(), $id]
                );
            }
            $this->Flash->success('Bank account updated.');
            return $this->redirect(['action' => 'index']);
        }
        $this->set(compact('account', 'coaAccounts'));
    }

    public function cashBook(int $id)
    {
        $account = $this->db()->execute(
            "SELECT * FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$account) { $this->Flash->error('Account not found.'); return $this->redirect(['action' => 'index']); }

        $fromDate = $this->request->getQuery('from') ?? date('Y-m-01');
        $toDate   = $this->request->getQuery('to')   ?? date('Y-m-d');

        $transactions = $this->db()->execute(
            "SELECT * FROM fin_bank_transactions
             WHERE ssms_client_code=? AND bank_account_id=? AND txn_date BETWEEN ? AND ?
             ORDER BY txn_date ASC, txn_id ASC",
            [$this->code(), $id, $fromDate, $toDate]
        )->fetchAll('assoc');

        $postNet = (float)($this->db()->execute(
            "SELECT COALESCE(SUM(IF(txn_type='credit',amount,-amount)),0) AS net
             FROM fin_bank_transactions
             WHERE ssms_client_code=? AND bank_account_id=? AND txn_date >= ?",
            [$this->code(), $id, $fromDate]
        )->fetch('assoc')['net'] ?? 0);
        $openingBalance = (float)$account['current_balance'] - $postNet;

        if ($this->request->is('post')) {
            $d   = $this->request->getData();
            $amt = (float)($d['amount'] ?? 0);
            if ($amt > 0) {
                $this->db()->execute(
                    "INSERT INTO fin_bank_transactions
                     (ssms_client_code,bank_account_id,txn_date,txn_type,amount,
                      description,reference_no,cheque_no,cheque_date,party_name,category,source_type,created_by)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual',?)",
                    [
                        $this->code(), $id, $d['txn_date'], $d['txn_type'],
                        $amt, $d['description'], $this->nextTxnRef(),
                        $d['cheque_no'] ?? null,
                        !empty($d['cheque_date']) ? $d['cheque_date'] : null,
                        $d['party_name'] ?? null,
                        $d['category'] ?? null,
                        $this->user()
                    ]
                );
                $delta = $d['txn_type'] === 'credit' ? $amt : -$amt;
                $this->db()->execute(
                    "UPDATE fin_bank_accounts SET current_balance=current_balance+? WHERE bank_account_id=?",
                    [$delta, $id]
                );
                $this->Flash->success('Transaction recorded.');
                return $this->redirect(['action' => 'cashBook', $id, '?' => ['from' => $fromDate, 'to' => $toDate]]);
            }
        }
        $this->set(compact('account', 'transactions', 'openingBalance', 'fromDate', 'toDate'));
    }

    public function reconcile(int $id)
    {
        $account = $this->db()->execute(
            "SELECT * FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$account) { $this->Flash->error('Account not found.'); return $this->redirect(['action' => 'index']); }

        $month      = $this->request->getQuery('month') ?? date('Y-m');
        $monthStart = $month . '-01';
        $monthEnd   = date('Y-m-t', strtotime($monthStart));

        $recon = $this->db()->execute(
            "SELECT * FROM fin_bank_reconciliation
             WHERE ssms_client_code=? AND bank_account_id=? AND recon_month=?",
            [$this->code(), $id, $monthStart]
        )->fetch('assoc');

        $transactions = $this->db()->execute(
            "SELECT * FROM fin_bank_transactions
             WHERE ssms_client_code=? AND bank_account_id=? AND txn_date BETWEEN ? AND ?
             ORDER BY txn_date ASC",
            [$this->code(), $id, $monthStart, $monthEnd]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d       = $this->request->getData();
            $stmtBal = (float)($d['statement_balance'] ?? 0);

            foreach ((array)($d['reconcile_ids'] ?? []) as $tid) {
                $this->db()->execute(
                    "UPDATE fin_bank_transactions SET is_reconciled=1, reconciled_on=? WHERE txn_id=? AND ssms_client_code=?",
                    [date('Y-m-d'), (int)$tid, $this->code()]
                );
            }

            $bookBal = (float)($this->db()->execute(
                "SELECT COALESCE(SUM(IF(txn_type='credit',amount,-amount)),0) AS bal
                 FROM fin_bank_transactions
                 WHERE ssms_client_code=? AND bank_account_id=? AND txn_date<=? AND is_reconciled=1",
                [$this->code(), $id, $monthEnd]
            )->fetch('assoc')['bal'] ?? 0);

            $diff   = $stmtBal - $bookBal;
            $status = abs($diff) < 0.01 ? 'balanced' : 'open';

            if ($recon) {
                $this->db()->execute(
                    "UPDATE fin_bank_reconciliation SET statement_balance=?,book_balance=?,difference=?,
                     status=?,notes=?,reconciled_by=?,reconciled_at=NOW() WHERE recon_id=?",
                    [$stmtBal, $bookBal, $diff, $status, $d['notes'] ?? null, $this->user(), $recon['recon_id']]
                );
            } else {
                $this->db()->execute(
                    "INSERT INTO fin_bank_reconciliation
                     (ssms_client_code,bank_account_id,recon_month,statement_balance,book_balance,difference,status,notes,reconciled_by,reconciled_at)
                     VALUES (?,?,?,?,?,?,?,?,?,NOW())",
                    [$this->code(), $id, $monthStart, $stmtBal, $bookBal, $diff, $status, $d['notes'] ?? null, $this->user()]
                );
            }
            $this->Flash->success($status === 'balanced' ? '✅ Reconciliation balanced!' : '⚠ Saved. Difference: ₹' . number_format(abs($diff), 2));
            return $this->redirect(['action' => 'reconcile', $id, '?' => ['month' => $month]]);
        }
        $this->set(compact('account', 'transactions', 'recon', 'month', 'monthStart', 'monthEnd'));
    }

    public function transfer()
    {
        $accounts = $this->db()->execute(
            "SELECT * FROM fin_bank_accounts WHERE ssms_client_code=? AND is_active=1 ORDER BY bank_name",
            [$this->code()]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d      = $this->request->getData();
            $amt    = (float)($d['amount'] ?? 0);
            $fromId = (int)($d['from_account_id'] ?? 0);
            $toId   = (int)($d['to_account_id'] ?? 0);

            if ($amt <= 0 || $fromId === $toId || !$fromId || !$toId) {
                $this->Flash->error('Invalid transfer details.');
            } else {
                $ref  = $this->nextTxnRef();
                $date = $d['transfer_date'] ?? date('Y-m-d');
                $desc = $d['description'] ?? 'Inter-account transfer';
                $this->db()->execute(
                    "INSERT INTO fin_bank_transactions
                     (ssms_client_code,bank_account_id,txn_date,txn_type,amount,description,reference_no,party_name,category,source_type,created_by)
                     VALUES (?,?,?,'debit',?,?,?,'Transfer Out','transfer','transfer',?)",
                    [$this->code(), $fromId, $date, $amt, $desc, $ref, $this->user()]
                );
                $this->db()->execute(
                    "INSERT INTO fin_bank_transactions
                     (ssms_client_code,bank_account_id,txn_date,txn_type,amount,description,reference_no,party_name,category,source_type,created_by)
                     VALUES (?,?,?,'credit',?,?,?,'Transfer In','transfer','transfer',?)",
                    [$this->code(), $toId, $date, $amt, $desc, $ref, $this->user()]
                );
                $this->db()->execute("UPDATE fin_bank_accounts SET current_balance=current_balance-? WHERE bank_account_id=?", [$amt, $fromId]);
                $this->db()->execute("UPDATE fin_bank_accounts SET current_balance=current_balance+? WHERE bank_account_id=?", [$amt, $toId]);
                $this->Flash->success("Transfer of ₹" . number_format($amt, 2) . " completed. Ref: $ref");
                return $this->redirect(['action' => 'index']);
            }
        }
        $this->set(compact('accounts'));
    }

    /**
     * Bank Statement CSV Import
     *
     * Expected CSV columns (order flexible — detected by header row):
     *   date, description/narration, debit, credit, balance
     *
     * The import:
     *  1. Parses and previews rows (GET or first POST)
     *  2. On confirmation (POST confirm=1) inserts into fin_bank_transactions
     *     and updates account current_balance
     */
    public function importCsv(int $accountId)
    {
        if (!$this->isOwner()) {
            $this->Flash->error('Only Owner/Admin can import bank statements.');
            return $this->redirect(['action' => 'index']);
        }

        $account = $this->db()->execute(
            "SELECT * FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$accountId, $this->code()]
        )->fetch('assoc');

        if (!$account) {
            $this->Flash->error('Bank account not found.');
            return $this->redirect(['action' => 'index']);
        }

        $rows    = [];
        $errors  = [];
        $preview = false;
        $summary = null;

        if ($this->request->is('post')) {
            $confirm = (bool)$this->request->getData('confirm');

            if ($confirm) {
                // ── Confirmed import ──────────────────────────────────────────
                $rowsJson = $this->request->getData('rows_json', '[]');
                $imported = json_decode($rowsJson, true) ?: [];
                $inserted = 0;
                $balance  = (float)$account['current_balance'];

                foreach ($imported as $r) {
                    $debit  = (float)($r['debit']  ?? 0);
                    $credit = (float)($r['credit'] ?? 0);
                    $type   = $credit > 0 ? 'credit' : 'debit';
                    $amount = $credit > 0 ? $credit : $debit;
                    if ($amount <= 0) continue;

                    $ref = $this->nextTxnRef();
                    $this->db()->execute(
                        "INSERT INTO fin_bank_transactions
                             (ssms_client_code, bank_account_id, txn_date, txn_type, amount,
                              description, reference_no, source_type, reconcile_status, created_by)
                         VALUES (?,?,?,?,?,?,?,'import','unreconciled',?)",
                        [$this->code(), $accountId, $r['date'], $type, $amount,
                         $r['description'], $ref, $this->user()]
                    );
                    $balance += ($type === 'credit' ? $amount : -$amount);
                    $inserted++;
                }

                // Update closing balance
                $this->db()->execute(
                    "UPDATE fin_bank_accounts SET current_balance=? WHERE bank_account_id=?",
                    [$balance, $accountId]
                );

                $this->Flash->success("$inserted transaction(s) imported successfully.");
                return $this->redirect(['action' => 'cashBook', $accountId]);
            }

            // ── Parse uploaded CSV ────────────────────────────────────────────
            $file = $this->request->getUploadedFiles()['csv_file'] ?? null;
            if (!$file || $file->getError() !== UPLOAD_ERR_OK) {
                $this->Flash->error('Please upload a valid CSV file.');
            } else {
                $stream  = $file->getStream()->detach();
                $headers = null;
                $map     = [];   // column name → index

                while (($line = fgetcsv($stream)) !== false) {
                    if ($headers === null) {
                        // Detect header row
                        $headers = array_map('strtolower', array_map('trim', $line));
                        foreach ($headers as $i => $h) {
                            if (str_contains($h, 'date'))                   $map['date']        = $i;
                            if (str_contains($h, 'desc') || str_contains($h, 'narr') || str_contains($h, 'particular')) $map['description'] = $i;
                            if (str_contains($h, 'debit') || str_contains($h, 'withdrawal')) $map['debit']  = $i;
                            if (str_contains($h, 'credit') || str_contains($h, 'deposit'))   $map['credit'] = $i;
                            if (str_contains($h, 'balance'))                $map['balance']     = $i;
                        }
                        if (!isset($map['date'])) {
                            $errors[] = 'CSV must have a column containing "date" in the header.';
                            break;
                        }
                        continue;
                    }

                    $raw = fn(int $idx) => trim($line[$idx] ?? '');
                    $num = fn(int $idx) => (float)preg_replace('/[^0-9.\-]/', '', $line[$idx] ?? '0');

                    $dateRaw = $raw($map['date'] ?? 0);
                    // Try common date formats
                    $date = null;
                    foreach (['d/m/Y','d-m-Y','Y-m-d','m/d/Y','d.m.Y'] as $fmt) {
                        $dt = \DateTime::createFromFormat($fmt, $dateRaw);
                        if ($dt) { $date = $dt->format('Y-m-d'); break; }
                    }
                    if (!$date) {
                        $errors[] = "Row skipped — unrecognised date: $dateRaw";
                        continue;
                    }

                    $debit  = isset($map['debit'])  ? $num($map['debit'])  : 0;
                    $credit = isset($map['credit']) ? $num($map['credit']) : 0;
                    if ($debit == 0 && $credit == 0) continue;  // skip zero rows

                    $rows[] = [
                        'date'        => $date,
                        'description' => isset($map['description']) ? $raw($map['description']) : '',
                        'debit'       => $debit,
                        'credit'      => $credit,
                        'balance'     => isset($map['balance']) ? $num($map['balance']) : null,
                    ];
                }
                fclose($stream);
                $preview = true;
                $summary = [
                    'count'       => count($rows),
                    'total_debit' => array_sum(array_column($rows, 'debit')),
                    'total_credit'=> array_sum(array_column($rows, 'credit')),
                ];
            }
        }

        $this->set(compact('account', 'rows', 'errors', 'preview', 'summary'));
    }
}
