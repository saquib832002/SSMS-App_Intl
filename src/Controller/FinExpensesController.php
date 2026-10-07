<?php
declare(strict_types=1);
namespace App\Controller;

use App\Mailer\ExpenseMailer;
use Cake\Datasource\ConnectionManager;

class FinExpensesController extends AppController
{
    public function initialize(): void { parent::initialize(); $this->loadComponent('Flash'); }

    private function db()   { return ConnectionManager::get('default'); }
    private function code() { return $this->request->getSession()->read('ssms_client_code'); }
    private function user() { return $this->request->getSession()->read('ssms_user_name') ?? 'system'; }

    private function currentFy(): ?array
    {
        return $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code=? AND is_current=1 LIMIT 1",
            [$this->code()]
        )->fetch('assoc') ?: null;
    }

    private function nextRef(string $prefix, string $table, string $col): string
    {
        $year = date('Y');
        $row  = $this->db()->execute(
            "SELECT MAX(CAST(SUBSTRING_INDEX($col,'-',-1) AS UNSIGNED)) AS n
             FROM $table WHERE ssms_client_code=? AND $col LIKE ?",
            [$this->code(), "$prefix-$year-%"]
        )->fetch('assoc');
        return sprintf('%s-%s-%04d', $prefix, $year, (int)($row['n'] ?? 0) + 1);
    }

    private function postJournal(array $h, array $lines): int
    {
        $db = $this->db();
        $db->execute(
            "INSERT INTO fin_journal_entries (ssms_client_code,fy_id,journal_date,reference_no,description,source_type,source_id,status,created_by)
             VALUES (?,?,?,?,?,?,?,'posted',?)",
            [$this->code(),$h['fy_id'],$h['date'],$h['ref'],$h['description'],$h['source_type'],$h['source_id']??null,$this->user()]
        );
        $jid = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
        foreach ($lines as $l) {
            $db->execute(
                "INSERT INTO fin_journal_lines (journal_id,account_id,debit_amount,credit_amount,narration) VALUES (?,?,?,?,?)",
                [$jid,$l['account_id'],$l['debit']??0,$l['credit']??0,$l['narration']??null]
            );
        }
        return $jid;
    }

    private function budgetCheck(int $accountId, float $amount, int $fyId): array
    {
        $budgeted = (float)($this->db()->execute(
            "SELECT COALESCE(SUM(bl.budgeted_amount),0) AS t
             FROM fin_budget_lines bl
             JOIN fin_budgets b ON b.budget_id=bl.budget_id
             WHERE b.ssms_client_code=? AND b.fy_id=? AND bl.account_id=? AND b.is_active=1",
            [$this->code(), $fyId, $accountId]
        )->fetch('assoc')['t'] ?? 0);

        if ($budgeted <= 0) return ['has_budget'=>false];

        $actual = (float)($this->db()->execute(
            "SELECT COALESCE(SUM(jl.debit_amount),0) AS t
             FROM fin_journal_lines jl
             JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
             WHERE jl.account_id=? AND je.ssms_client_code=? AND je.fy_id=? AND je.source_type='expense'",
            [$accountId, $this->code(), $fyId]
        )->fetch('assoc')['t'] ?? 0);

        $remaining = $budgeted - $actual;
        return [
            'has_budget' => true,
            'budgeted'   => $budgeted,
            'actual'     => $actual,
            'remaining'  => $remaining,
            'will_exceed'=> $amount > $remaining,
        ];
    }

    private function saveAttachment(): ?string
    {
        $file = $this->request->getUploadedFiles()['attachment'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return null;
        $ext  = strtolower(pathinfo($file->getClientFilename(), PATHINFO_EXTENSION));
        if (!in_array($ext, ['pdf','jpg','jpeg','png','webp'])) return null;
        $name = 'EXP-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
        $file->moveTo(WWW_ROOT . 'uploads' . DS . 'finance' . DS . $name);
        return $name;
    }

    private function loadDropdowns(): array
    {
        $db   = $this->db();
        $code = $this->code();
        $expAccounts = $db->execute(
            "SELECT account_id, account_code, account_name FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_type='expense' AND parent_id IS NOT NULL AND is_active=1 ORDER BY account_code",
            [$code]
        )->fetchAll('assoc');
        $bankAccounts = $db->execute(
            "SELECT bank_account_id, CONCAT(bank_name,' (',account_type,')') AS account_label, account_type FROM fin_bank_accounts
             WHERE ssms_client_code=? AND is_active=1 ORDER BY is_default DESC, account_label",
            [$code]
        )->fetchAll('assoc');
        return compact('expAccounts','bankAccounts');
    }

    public function index()
    {
        $from   = $this->request->getQuery('from', date('Y-m-01'));
        $to     = $this->request->getQuery('to',   date('Y-m-d'));
        $status = $this->request->getQuery('status', '');
        $type   = $this->request->getQuery('type',   '');

        $sql = "SELECT e.*, a.account_name, CONCAT(b.bank_name,' (',b.account_type,')') AS bank_label
                FROM fin_expenses e
                JOIN fin_chart_of_accounts a ON a.account_id = e.account_id
                LEFT JOIN fin_bank_accounts b ON b.bank_account_id = e.bank_account_id
                WHERE e.ssms_client_code=? AND e.expense_date BETWEEN ? AND ?";
        $p = [$this->code(), $from, $to];
        if ($status) { $sql .= " AND e.status=?";       $p[] = $status; }
        if ($type)   { $sql .= " AND e.expense_type=?"; $p[] = $type;   }
        $sql .= " ORDER BY e.expense_date DESC, e.expense_id DESC";

        $expenses = $this->db()->execute($sql, $p)->fetchAll('assoc');
        $total    = array_sum(array_column($expenses, 'amount'));
        $pending  = count(array_filter($expenses, fn($e) => $e['status'] === 'pending'));
        $fy       = $this->currentFy();
        $this->set(compact('expenses','total','pending','from','to','status','type','fy'));
    }

    public function add()
    {
        $fy = $this->currentFy();
        if (!$fy) {
            $this->Flash->error('No active fiscal year. Please create one first.');
            return $this->redirect(['action'=>'index']);
        }
        ['expAccounts'=>$expAccounts,'bankAccounts'=>$bankAccounts] = $this->loadDropdowns();

        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $amount    = (float)($d['amount'] ?? 0);
            $voucherNo = $this->nextRef('EXP','fin_expenses','voucher_no');

            if ($amount <= 0) {
                $this->Flash->error('Amount must be greater than zero.');
            } else {
                // Budget check — warn but do not block
                $bChk = $this->budgetCheck((int)$d['account_id'], $amount, $fy['fy_id']);
                if ($bChk['has_budget'] && $bChk['will_exceed']) {
                    $over = number_format($amount - $bChk['remaining'], 2);
                    $this->Flash->error(
                        "⚠ Budget Warning: This expense exceeds the allocated budget for this account by <strong>₹$over</strong>. "
                        . "Remaining budget was <strong>₹" . number_format($bChk['remaining'], 2) . "</strong>. "
                        . "The expense has been submitted and will require owner approval.",
                        ['escape' => false]
                    );
                }
                $attachment = $this->saveAttachment();
                // Expenses start as 'pending' — journal posted on approval
                $this->db()->execute(
                    "INSERT INTO fin_expenses
                     (ssms_client_code,fy_id,expense_date,expense_type,account_id,bank_account_id,
                      amount,payee_name,payee_contact,description,payment_mode,reference_no,voucher_no,
                      attachment,status,created_by)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)",
                    [$this->code(),$fy['fy_id'],$d['expense_date'],$d['expense_type'],
                     $d['account_id'],$d['bank_account_id']??null,$amount,
                     $d['payee_name']??null,$d['payee_contact']??null,$d['description']??null,
                     $d['payment_mode']??'cash',$d['reference_no']??null,$voucherNo,
                     $attachment,$this->user()]
                );
                $expId = (int)$this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

                $this->Flash->success("Expense submitted. Voucher No: <strong>$voucherNo</strong> — Awaiting approval.", ['escape'=>false]);
                return $this->redirect(['action'=>'view',$expId]);
            }
        }
        $this->set(compact('fy','expAccounts','bankAccounts'));
    }

    public function view(int $id)
    {
        $expense = $this->db()->execute(
            "SELECT e.*, a.account_name, CONCAT(b.bank_name,' (',b.account_type,')') AS bank_label
             FROM fin_expenses e
             JOIN fin_chart_of_accounts a ON a.account_id = e.account_id
             LEFT JOIN fin_bank_accounts b ON b.bank_account_id = e.bank_account_id
             WHERE e.expense_id=? AND e.ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$expense) { $this->Flash->error('Record not found.'); return $this->redirect(['action'=>'index']); }

        $journal = $expense['journal_id'] ? $this->db()->execute(
            "SELECT jl.*, a.account_code, a.account_name
             FROM fin_journal_lines jl JOIN fin_chart_of_accounts a ON a.account_id=jl.account_id
             WHERE jl.journal_id=?", [$expense['journal_id']]
        )->fetchAll('assoc') : [];

        $school = $this->db()->execute(
            "SELECT ssms_client_header_text, ssms_client_address FROM ssms_clients WHERE ssms_client_code=? LIMIT 1",
            [$this->code()]
        )->fetch('assoc');

        $isOwner = $this->isOwner();
        $this->set(compact('expense','journal','school','isOwner'));
    }

    public function edit(int $id)
    {
        $expense = $this->db()->execute(
            "SELECT * FROM fin_expenses WHERE expense_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$expense) { $this->Flash->error('Record not found.'); return $this->redirect(['action'=>'index']); }

        if ($expense['status'] !== 'pending') {
            $this->Flash->error('Only pending expenses can be edited.');
            return $this->redirect(['action'=>'view',$id]);
        }

        if ($this->request->is(['post','put'])) {
            $d = $this->request->getData();
            $this->db()->execute(
                "UPDATE fin_expenses SET payee_name=?,payee_contact=?,description=?,payment_mode=?,reference_no=?
                 WHERE expense_id=? AND ssms_client_code=?",
                [$d['payee_name']??null,$d['payee_contact']??null,$d['description']??null,
                 $d['payment_mode']??'cash',$d['reference_no']??null,$id,$this->code()]
            );
            $this->Flash->success('Expense updated.');
            return $this->redirect(['action'=>'view',$id]);
        }
        ['expAccounts'=>$expAccounts,'bankAccounts'=>$bankAccounts] = $this->loadDropdowns();
        $this->set(compact('expense','expAccounts','bankAccounts'));
    }

    private function isOwner(): bool
    {
        return $this->request->getSession()->read('ssms_user_role') === 'owner';
    }

    public function approve(int $id)
    {
        if (!$this->isOwner()) {
            $this->Flash->error('Only the Owner can approve expenses.');
            return $this->redirect(['action'=>'view',$id]);
        }
        $this->request->allowMethod(['post']);
        $expense = $this->db()->execute(
            "SELECT * FROM fin_expenses WHERE expense_id=? AND ssms_client_code=? AND status='pending'",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$expense) { $this->Flash->error('Expense not found or not in pending state.'); return $this->redirect(['action'=>'index']); }

        $fy = $this->currentFy();
        if (!$fy) { $this->Flash->error('No active fiscal year.'); return $this->redirect(['action'=>'view',$id]); }
        if ($fy['is_locked']) { $this->Flash->error('This fiscal year is locked. Cannot post journal.'); return $this->redirect(['action'=>'view',$id]); }

        // Get cash/bank COA account_id
        $ba = $expense['bank_account_id'] ? $this->db()->execute(
            "SELECT account_id FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$expense['bank_account_id'], $this->code()]
        )->fetch('assoc') : null;

        if (!$ba) {
            $this->Flash->error('No bank/cash account linked to this expense. Cannot post journal.');
            return $this->redirect(['action'=>'view',$id]);
        }

        $jid = $this->postJournal(
            ['fy_id'=>$fy['fy_id'],'date'=>$expense['expense_date'],'ref'=>$expense['voucher_no'],
             'description'=>$expense['description'] ?: 'Expense - '.$expense['expense_type'],
             'source_type'=>'expense','source_id'=>$id],
            [
                ['account_id'=>$expense['account_id'], 'debit'=>(float)$expense['amount'], 'credit'=>0,                         'narration'=>$expense['payee_name']??null],
                ['account_id'=>$ba['account_id'],      'debit'=>0,                         'credit'=>(float)$expense['amount'], 'narration'=>$expense['description']??null],
            ]
        );

        $this->db()->execute(
            "UPDATE fin_expenses SET status='approved', journal_id=?, approved_by=?, approved_at=NOW()
             WHERE expense_id=? AND ssms_client_code=?",
            [$jid, $this->user(), $id, $this->code()]
        );
        $this->Flash->success("Expense <strong>{$expense['voucher_no']}</strong> approved and journal posted.", ['escape'=>false]);

        // Email notification — fire-and-forget; errors are swallowed
        try {
            $expense['approved_by'] = $this->user();
            $expense['approved_at'] = date('Y-m-d H:i:s');
            $school = $this->db()->execute(
                "SELECT ssms_client_header_text, ssms_client_address FROM ssms_clients WHERE ssms_client_code=? LIMIT 1",
                [$this->code()]
            )->fetch('assoc') ?: [];
            (new ExpenseMailer())->send('approved', [$expense, $school]);
        } catch (\Throwable $e) { /* silent */ }

        return $this->redirect(['action'=>'view',$id]);
    }

    public function reject(int $id)
    {
        if (!$this->isOwner()) {
            $this->Flash->error('Only the Owner can reject expenses.');
            return $this->redirect(['action'=>'view',$id]);
        }
        $this->request->allowMethod(['post']);
        $expense = $this->db()->execute(
            "SELECT * FROM fin_expenses WHERE expense_id=? AND ssms_client_code=? AND status='pending'",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$expense) { $this->Flash->error('Expense not found or already processed.'); return $this->redirect(['action'=>'index']); }

        $remarks = $this->request->getData('reject_remarks') ?? '';
        $this->db()->execute(
            "UPDATE fin_expenses SET status='rejected', reject_remarks=?, approved_by=?, approved_at=NOW()
             WHERE expense_id=? AND ssms_client_code=?",
            [$remarks, $this->user(), $id, $this->code()]
        );
        $this->Flash->warning("Expense <strong>{$expense['voucher_no']}</strong> rejected.", ['escape'=>false]);

        // Email notification — fire-and-forget; errors are swallowed
        try {
            $expense['approved_by'] = $this->user();
            $expense['approved_at'] = date('Y-m-d H:i:s');
            $school = $this->db()->execute(
                "SELECT ssms_client_header_text, ssms_client_address FROM ssms_clients WHERE ssms_client_code=? LIMIT 1",
                [$this->code()]
            )->fetch('assoc') ?: [];
            (new ExpenseMailer())->send('rejected', [$expense, $school, $remarks]);
        } catch (\Throwable $e) { /* silent */ }

        return $this->redirect(['action'=>'view',$id]);
    }
}
