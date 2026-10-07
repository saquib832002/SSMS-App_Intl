<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * FinanceApiController — JSON API for the School Finance module.
 * All endpoints require an active session (ssms_client_code in session).
 */
class FinanceApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->loadComponent('Flash');
        $this->RequestHandler->renderAs($this, 'json');
        $this->response = $this->response->withType('application/json');
    }

    // ─── helpers ────────────────────────────────────────────────────────────

    private function db()  { return ConnectionManager::get('default'); }
    private function code(): string { return $this->request->getSession()->read('ssms_client_code') ?? ''; }
    private function user(): string { return $this->request->getSession()->read('ssms_user_name') ?? 'system'; }

    private function json(array $data, int $status = 200): \Psr\Http\Message\ResponseInterface
    {
        return $this->response
            ->withStatus($status)
            ->withStringBody(json_encode($data, JSON_UNESCAPED_UNICODE));
    }

    /** Generate sequential reference numbers: REC-2025-0001 etc. */
    private function nextRef(string $prefix, string $table, string $col): string
    {
        $year = date('Y');
        $row  = $this->db()->execute(
            "SELECT MAX(CAST(SUBSTRING_INDEX($col,'-',-1) AS UNSIGNED)) AS n
             FROM $table WHERE ssms_client_code = ? AND $col LIKE ?",
            [$this->code(), "$prefix-$year-%"]
        )->fetch('assoc');
        $n = (int)($row['n'] ?? 0) + 1;
        return sprintf('%s-%s-%04d', $prefix, $year, $n);
    }

    /** Get or create current fiscal year for client. */
    private function currentFy(): ?array
    {
        return $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code = ? AND is_current = 1 LIMIT 1",
            [$this->code()]
        )->fetch('assoc') ?: null;
    }

    /** Post a double-entry journal and return journal_id. */
    private function postJournal(array $header, array $lines): int
    {
        $db = $this->db();
        $db->execute(
            "INSERT INTO fin_journal_entries
             (ssms_client_code,fy_id,journal_date,reference_no,description,source_type,source_id,status,created_by)
             VALUES (?,?,?,?,?,?,?,'posted',?)",
            [
                $this->code(), $header['fy_id'], $header['date'],
                $header['ref'], $header['description'],
                $header['source_type'], $header['source_id'] ?? null,
                $this->user()
            ]
        );
        $jid = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
        foreach ($lines as $line) {
            $db->execute(
                "INSERT INTO fin_journal_lines (journal_id,account_id,debit_amount,credit_amount,narration)
                 VALUES (?,?,?,?,?)",
                [$jid, $line['account_id'], $line['debit'] ?? 0, $line['credit'] ?? 0, $line['narration'] ?? null]
            );
        }
        return $jid;
    }

    // ─── Fiscal Years ────────────────────────────────────────────────────────

    public function getFiscalYears(): \Psr\Http\Message\ResponseInterface
    {
        $rows = $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code = ? ORDER BY start_date DESC",
            [$this->code()]
        )->fetchAll('assoc');
        return $this->json(['success' => true, 'data' => $rows]);
    }

    public function createFiscalYear(): \Psr\Http\Message\ResponseInterface
    {
        $d = $this->request->getData();
        if (empty($d['fy_name']) || empty($d['start_date']) || empty($d['end_date'])) {
            return $this->json(['success' => false, 'message' => 'fy_name, start_date, end_date are required.'], 422);
        }
        $db = $this->db();
        if (!empty($d['is_current'])) {
            $db->execute("UPDATE fin_fiscal_years SET is_current=0 WHERE ssms_client_code=?", [$this->code()]);
        }
        $db->execute(
            "INSERT INTO fin_fiscal_years (ssms_client_code,fy_name,start_date,end_date,is_current)
             VALUES (?,?,?,?,?)",
            [$this->code(), $d['fy_name'], $d['start_date'], $d['end_date'], empty($d['is_current']) ? 0 : 1]
        );
        return $this->json(['success' => true, 'message' => 'Fiscal year created.']);
    }

    // ─── Chart of Accounts ───────────────────────────────────────────────────

    public function getChartOfAccounts(): \Psr\Http\Message\ResponseInterface
    {
        $type = $this->request->getQuery('type');
        $sql  = "SELECT * FROM fin_chart_of_accounts WHERE ssms_client_code = ? AND is_active = 1";
        $params = [$this->code()];
        if ($type) { $sql .= " AND account_type = ?"; $params[] = $type; }
        $sql .= " ORDER BY account_code";
        $rows = $this->db()->execute($sql, $params)->fetchAll('assoc');
        return $this->json(['success' => true, 'data' => $rows]);
    }

    public function createAccount(): \Psr\Http\Message\ResponseInterface
    {
        $d = $this->request->getData();
        if (empty($d['account_code']) || empty($d['account_name']) || empty($d['account_type'])) {
            return $this->json(['success' => false, 'message' => 'account_code, account_name, account_type required.'], 422);
        }
        $nb = in_array($d['account_type'], ['asset','expense']) ? 'debit' : 'credit';
        try {
            $this->db()->execute(
                "INSERT INTO fin_chart_of_accounts
                 (ssms_client_code,parent_id,account_code,account_name,account_type,account_subtype,normal_balance)
                 VALUES (?,?,?,?,?,?,?)",
                [$this->code(), $d['parent_id'] ?? null, $d['account_code'], $d['account_name'],
                 $d['account_type'], $d['account_subtype'] ?? null, $nb]
            );
            return $this->json(['success' => true, 'message' => 'Account created.']);
        } catch (\Exception $e) {
            return $this->json(['success' => false, 'message' => 'Account code already exists.'], 409);
        }
    }

    public function updateAccount(int $id): \Psr\Http\Message\ResponseInterface
    {
        $d = $this->request->getData();
        $this->db()->execute(
            "UPDATE fin_chart_of_accounts SET account_name=?, account_subtype=?, is_active=?
             WHERE account_id=? AND ssms_client_code=? AND is_system=0",
            [$d['account_name'], $d['account_subtype'] ?? null, $d['is_active'] ?? 1, $id, $this->code()]
        );
        return $this->json(['success' => true, 'message' => 'Account updated.']);
    }

    // ─── Bank Accounts ───────────────────────────────────────────────────────

    public function getBankAccounts(): \Psr\Http\Message\ResponseInterface
    {
        $rows = $this->db()->execute(
            "SELECT b.*, a.account_name, a.account_code
             FROM fin_bank_accounts b
             JOIN fin_chart_of_accounts a ON a.account_id = b.account_id
             WHERE b.ssms_client_code = ? AND b.is_active = 1
             ORDER BY b.is_default DESC, b.account_label",
            [$this->code()]
        )->fetchAll('assoc');
        return $this->json(['success' => true, 'data' => $rows]);
    }

    public function createBankAccount(): \Psr\Http\Message\ResponseInterface
    {
        $d = $this->request->getData();
        if (empty($d['account_id']) || empty($d['account_label'])) {
            return $this->json(['success' => false, 'message' => 'account_id and account_label required.'], 422);
        }
        $db = $this->db();
        if (!empty($d['is_default'])) {
            $db->execute("UPDATE fin_bank_accounts SET is_default=0 WHERE ssms_client_code=?", [$this->code()]);
        }
        $db->execute(
            "INSERT INTO fin_bank_accounts
             (ssms_client_code,account_id,account_label,bank_name,account_number,account_type,opening_balance,is_default)
             VALUES (?,?,?,?,?,?,?,?)",
            [$this->code(), $d['account_id'], $d['account_label'], $d['bank_name'] ?? null,
             $d['account_number'] ?? null, $d['account_type'] ?? 'current',
             $d['opening_balance'] ?? 0, empty($d['is_default']) ? 0 : 1]
        );
        return $this->json(['success' => true, 'message' => 'Bank account created.']);
    }

    // ─── Income ──────────────────────────────────────────────────────────────

    public function getIncome(): \Psr\Http\Message\ResponseInterface
    {
        $from = $this->request->getQuery('from');
        $to   = $this->request->getQuery('to');
        $type = $this->request->getQuery('type');
        $fyId = $this->request->getQuery('fy_id');

        $sql  = "SELECT i.*, a.account_name, b.account_label AS bank_label
                 FROM fin_income i
                 JOIN fin_chart_of_accounts a ON a.account_id = i.account_id
                 JOIN fin_bank_accounts b ON b.bank_account_id = i.bank_account_id
                 WHERE i.ssms_client_code = ?";
        $p = [$this->code()];
        if ($from)  { $sql .= " AND i.income_date >= ?"; $p[] = $from; }
        if ($to)    { $sql .= " AND i.income_date <= ?"; $p[] = $to; }
        if ($type)  { $sql .= " AND i.income_type = ?";  $p[] = $type; }
        if ($fyId)  { $sql .= " AND i.fy_id = ?";        $p[] = $fyId; }
        $sql .= " ORDER BY i.income_date DESC, i.income_id DESC LIMIT 200";

        $rows = $this->db()->execute($sql, $p)->fetchAll('assoc');
        return $this->json(['success' => true, 'data' => $rows]);
    }

    public function recordIncome(): \Psr\Http\Message\ResponseInterface
    {
        $d = $this->request->getData();
        $required = ['income_date','income_type','account_id','bank_account_id','amount'];
        foreach ($required as $f) {
            if (empty($d[$f])) return $this->json(['success'=>false,'message'=>"$f is required."], 422);
        }

        $fy = $this->currentFy();
        if (!$fy) return $this->json(['success'=>false,'message'=>'No active fiscal year. Please create one first.'], 400);

        $db      = $this->db();
        $receiptNo = $this->nextRef('REC', 'fin_income', 'receipt_no');
        $amount    = (float)$d['amount'];

        // Get cash/bank ledger account_id from bank account
        $ba = $db->execute(
            "SELECT account_id FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$d['bank_account_id'], $this->code()]
        )->fetch('assoc');
        if (!$ba) return $this->json(['success'=>false,'message'=>'Bank account not found.'], 404);

        // Post journal: DR cash/bank, CR income account
        $jid = $this->postJournal(
            ['fy_id'=>$fy['fy_id'],'date'=>$d['income_date'],'ref'=>$receiptNo,
             'description'=>$d['description'] ?? 'Income recorded',
             'source_type'=>'income','source_id'=>null],
            [
                ['account_id'=>$ba['account_id'],  'debit'=>$amount,  'credit'=>0,      'narration'=>$d['payer_name'] ?? null],
                ['account_id'=>$d['account_id'],    'debit'=>0,        'credit'=>$amount,'narration'=>$d['description'] ?? null],
            ]
        );

        // Insert income record
        $db->execute(
            "INSERT INTO fin_income
             (ssms_client_code,fy_id,income_date,income_type,account_id,bank_account_id,
              amount,payer_name,payer_contact,description,payment_mode,reference_no,receipt_no,journal_id,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [$this->code(), $fy['fy_id'], $d['income_date'], $d['income_type'],
             $d['account_id'], $d['bank_account_id'], $amount,
             $d['payer_name'] ?? null, $d['payer_contact'] ?? null,
             $d['description'] ?? null, $d['payment_mode'] ?? 'cash',
             $d['reference_no'] ?? null, $receiptNo, $jid, $this->user()]
        );

        // Update journal source_id
        $incId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
        $db->execute("UPDATE fin_journal_entries SET source_id=? WHERE journal_id=?", [$incId, $jid]);

        return $this->json(['success'=>true,'message'=>'Income recorded.','receipt_no'=>$receiptNo,'income_id'=>$incId]);
    }

    public function updateIncome(int $id): \Psr\Http\Message\ResponseInterface
    {
        $d = $this->request->getData();
        // Only allow editing description, payer details — amount changes require reversal
        $this->db()->execute(
            "UPDATE fin_income SET payer_name=?,payer_contact=?,description=?,payment_mode=?,reference_no=?
             WHERE income_id=? AND ssms_client_code=?",
            [$d['payer_name'] ?? null, $d['payer_contact'] ?? null, $d['description'] ?? null,
             $d['payment_mode'] ?? 'cash', $d['reference_no'] ?? null, $id, $this->code()]
        );
        return $this->json(['success'=>true,'message'=>'Income updated.']);
    }

    // ─── Expenses ────────────────────────────────────────────────────────────

    public function getExpenses(): \Psr\Http\Message\ResponseInterface
    {
        $from   = $this->request->getQuery('from');
        $to     = $this->request->getQuery('to');
        $status = $this->request->getQuery('status');
        $fyId   = $this->request->getQuery('fy_id');

        $sql = "SELECT e.*, a.account_name, b.account_label AS bank_label
                FROM fin_expenses e
                JOIN fin_chart_of_accounts a ON a.account_id = e.account_id
                JOIN fin_bank_accounts b ON b.bank_account_id = e.bank_account_id
                WHERE e.ssms_client_code = ?";
        $p = [$this->code()];
        if ($from)   { $sql .= " AND e.expense_date >= ?"; $p[] = $from; }
        if ($to)     { $sql .= " AND e.expense_date <= ?"; $p[] = $to; }
        if ($status) { $sql .= " AND e.status = ?";        $p[] = $status; }
        if ($fyId)   { $sql .= " AND e.fy_id = ?";         $p[] = $fyId; }
        $sql .= " ORDER BY e.expense_date DESC, e.expense_id DESC LIMIT 200";

        $rows = $this->db()->execute($sql, $p)->fetchAll('assoc');
        return $this->json(['success'=>true,'data'=>$rows]);
    }

    public function createExpense(): \Psr\Http\Message\ResponseInterface
    {
        $d = $this->request->getData();
        $required = ['expense_date','expense_category','account_id','bank_account_id','amount'];
        foreach ($required as $f) {
            if (empty($d[$f])) return $this->json(['success'=>false,'message'=>"$f is required."], 422);
        }

        $fy = $this->currentFy();
        if (!$fy) return $this->json(['success'=>false,'message'=>'No active fiscal year.'], 400);

        $amount    = (float)$d['amount'];
        $taxAmount = (float)($d['tax_amount'] ?? 0);
        $total     = $amount + $taxAmount;
        $voucherNo = $this->nextRef('EXP', 'fin_expenses', 'voucher_no');

        $this->db()->execute(
            "INSERT INTO fin_expenses
             (ssms_client_code,fy_id,expense_date,expense_category,account_id,bank_account_id,
              amount,tax_amount,total_amount,payee_name,description,payment_mode,
              reference_no,voucher_no,status,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)",
            [$this->code(), $fy['fy_id'], $d['expense_date'], $d['expense_category'],
             $d['account_id'], $d['bank_account_id'], $amount, $taxAmount, $total,
             $d['payee_name'] ?? null, $d['description'] ?? null,
             $d['payment_mode'] ?? 'cash', $d['reference_no'] ?? null,
             $voucherNo, $this->user()]
        );
        $expId = (int)$this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

        return $this->json(['success'=>true,'message'=>'Expense submitted for approval.','voucher_no'=>$voucherNo,'expense_id'=>$expId]);
    }

    public function approveExpense(int $id): \Psr\Http\Message\ResponseInterface
    {
        $action = $this->request->getData('action'); // 'approve' or 'reject'
        $db     = $this->db();

        $exp = $db->execute(
            "SELECT * FROM fin_expenses WHERE expense_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$exp) return $this->json(['success'=>false,'message'=>'Expense not found.'], 404);
        if ($exp['status'] !== 'pending') return $this->json(['success'=>false,'message'=>'Only pending expenses can be actioned.'], 409);

        if ($action === 'reject') {
            $db->execute(
                "UPDATE fin_expenses SET status='rejected',approved_by=?,approved_at=NOW(),rejection_reason=? WHERE expense_id=?",
                [$this->user(), $this->request->getData('rejection_reason') ?? '', $id]
            );
            return $this->json(['success'=>true,'message'=>'Expense rejected.']);
        }

        // Get cash/bank ledger account_id
        $ba = $db->execute(
            "SELECT account_id FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$exp['bank_account_id'], $this->code()]
        )->fetch('assoc');
        if (!$ba) return $this->json(['success'=>false,'message'=>'Bank account not found.'], 404);

        // Post journal: DR expense account, CR cash/bank
        $jid = $this->postJournal(
            ['fy_id'=>$exp['fy_id'],'date'=>$exp['expense_date'],'ref'=>$exp['voucher_no'],
             'description'=>$exp['description'] ?? 'Expense approved',
             'source_type'=>'expense','source_id'=>$id],
            [
                ['account_id'=>$exp['account_id'], 'debit'=>$exp['total_amount'], 'credit'=>0,                    'narration'=>$exp['payee_name'] ?? null],
                ['account_id'=>$ba['account_id'],  'debit'=>0,                    'credit'=>$exp['total_amount'], 'narration'=>$exp['expense_category']],
            ]
        );

        $db->execute(
            "UPDATE fin_expenses SET status='approved',approved_by=?,approved_at=NOW(),journal_id=? WHERE expense_id=?",
            [$this->user(), $jid, $id]
        );
        return $this->json(['success'=>true,'message'=>'Expense approved and journal posted.']);
    }

    // ─── Reports ─────────────────────────────────────────────────────────────

    public function getProfitLoss(): \Psr\Http\Message\ResponseInterface
    {
        $from = $this->request->getQuery('from', date('Y-m-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));
        $db   = $this->db();

        $income = $db->execute(
            "SELECT a.account_name, SUM(i.amount) AS total
             FROM fin_income i
             JOIN fin_chart_of_accounts a ON a.account_id = i.account_id
             WHERE i.ssms_client_code=? AND i.income_date BETWEEN ? AND ?
             GROUP BY a.account_id, a.account_name ORDER BY a.account_code",
            [$this->code(), $from, $to]
        )->fetchAll('assoc');

        $expenses = $db->execute(
            "SELECT a.account_name, SUM(e.total_amount) AS total
             FROM fin_expenses e
             JOIN fin_chart_of_accounts a ON a.account_id = e.account_id
             WHERE e.ssms_client_code=? AND e.expense_date BETWEEN ? AND ? AND e.status='approved'
             GROUP BY a.account_id, a.account_name ORDER BY a.account_code",
            [$this->code(), $from, $to]
        )->fetchAll('assoc');

        $totalIncome  = array_sum(array_column($income,   'total'));
        $totalExpense = array_sum(array_column($expenses, 'total'));

        return $this->json([
            'success'       => true,
            'from'          => $from,
            'to'            => $to,
            'income'        => $income,
            'expenses'      => $expenses,
            'total_income'  => $totalIncome,
            'total_expense' => $totalExpense,
            'net_surplus'   => $totalIncome - $totalExpense,
        ]);
    }

    public function getDashboardKpis(): \Psr\Http\Message\ResponseInterface
    {
        $db   = $this->db();
        $code = $this->code();
        $fy   = $this->currentFy();
        $fyId = $fy['fy_id'] ?? 0;

        $inc = $db->execute(
            "SELECT COALESCE(SUM(amount),0) AS total FROM fin_income WHERE ssms_client_code=? AND fy_id=?",
            [$code, $fyId]
        )->fetch('assoc');

        $exp = $db->execute(
            "SELECT COALESCE(SUM(total_amount),0) AS total FROM fin_expenses WHERE ssms_client_code=? AND fy_id=? AND status='approved'",
            [$code, $fyId]
        )->fetch('assoc');

        $pending = $db->execute(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total FROM fin_expenses WHERE ssms_client_code=? AND status='pending'",
            [$code]
        )->fetch('assoc');

        $monthly = $db->execute(
            "SELECT DATE_FORMAT(income_date,'%b %Y') AS month_label,
                    DATE_FORMAT(income_date,'%Y-%m') AS month_key,
                    COALESCE(SUM(amount),0) AS income
             FROM fin_income WHERE ssms_client_code=? AND fy_id=?
             GROUP BY month_key,month_label ORDER BY month_key",
            [$code, $fyId]
        )->fetchAll('assoc');

        $monthlyExp = $db->execute(
            "SELECT DATE_FORMAT(expense_date,'%b %Y') AS month_label,
                    DATE_FORMAT(expense_date,'%Y-%m') AS month_key,
                    COALESCE(SUM(total_amount),0) AS expense
             FROM fin_expenses WHERE ssms_client_code=? AND fy_id=? AND status='approved'
             GROUP BY month_key,month_label ORDER BY month_key",
            [$code, $fyId]
        )->fetchAll('assoc');

        // Merge monthly data
        $months = [];
        foreach ($monthly    as $r) $months[$r['month_key']] = ['label'=>$r['month_label'],'income'=>$r['income'],'expense'=>0];
        foreach ($monthlyExp as $r) {
            if (!isset($months[$r['month_key']])) $months[$r['month_key']] = ['label'=>$r['month_label'],'income'=>0,'expense'=>0];
            $months[$r['month_key']]['expense'] = $r['expense'];
        }
        ksort($months);

        $recent = $db->execute(
            "(SELECT 'income' AS txn_type, income_date AS txn_date, receipt_no AS ref_no, amount, income_type AS category, payer_name AS party FROM fin_income WHERE ssms_client_code=? ORDER BY income_id DESC LIMIT 5)
             UNION ALL
             (SELECT 'expense', expense_date, voucher_no, total_amount, expense_category, payee_name FROM fin_expenses WHERE ssms_client_code=? AND status='approved' ORDER BY expense_id DESC LIMIT 5)
             ORDER BY txn_date DESC LIMIT 8",
            [$code, $code]
        )->fetchAll('assoc');

        return $this->json([
            'success'         => true,
            'fiscal_year'     => $fy,
            'total_income'    => (float)$inc['total'],
            'total_expense'   => (float)$exp['total'],
            'net_surplus'     => (float)$inc['total'] - (float)$exp['total'],
            'pending_count'   => (int)$pending['cnt'],
            'pending_amount'  => (float)$pending['total'],
            'monthly'         => array_values($months),
            'recent'          => $recent,
        ]);
    }

    public function getLedger(int $accountId): \Psr\Http\Message\ResponseInterface
    {
        $from = $this->request->getQuery('from', date('Y-m-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));

        $account = $this->db()->execute(
            "SELECT * FROM fin_chart_of_accounts WHERE account_id=? AND ssms_client_code=?",
            [$accountId, $this->code()]
        )->fetch('assoc');
        if (!$account) return $this->json(['success'=>false,'message'=>'Account not found.'], 404);

        $lines = $this->db()->execute(
            "SELECT jl.*, je.journal_date, je.reference_no, je.description, je.source_type
             FROM fin_journal_lines jl
             JOIN fin_journal_entries je ON je.journal_id = jl.journal_id
             WHERE jl.account_id=? AND je.ssms_client_code=?
               AND je.journal_date BETWEEN ? AND ? AND je.status='posted'
             ORDER BY je.journal_date, je.journal_id",
            [$accountId, $this->code(), $from, $to]
        )->fetchAll('assoc');

        $balance = 0;
        $nb      = $account['normal_balance'];
        foreach ($lines as &$l) {
            $balance += ($nb === 'debit') ? ($l['debit_amount'] - $l['credit_amount']) : ($l['credit_amount'] - $l['debit_amount']);
            $l['running_balance'] = $balance;
        }

        return $this->json(['success'=>true,'account'=>$account,'lines'=>$lines,'closing_balance'=>$balance]);
    }
}
