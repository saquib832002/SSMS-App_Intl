<?php
declare(strict_types=1);
namespace App\Controller;
use Cake\Log\Log;

use Cake\Datasource\ConnectionManager;

class FinIncomeController extends AppController
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

    private function saveAttachment(): ?string
    {
        $file = $this->request->getUploadedFiles()['attachment'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return null;
        $ext  = strtolower(pathinfo($file->getClientFilename(), PATHINFO_EXTENSION));
        $allowed = ['pdf','jpg','jpeg','png','webp'];
        if (!in_array($ext, $allowed)) return null;
        $name = 'INC-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
        $dest = WWW_ROOT . 'uploads' . DS . 'finance' . DS . $name;
        $file->moveTo($dest);
        return $name;
    }

    private function loadDropdowns(): array
    {
        $db   = $this->db();
        $code = $this->code();
        $incAccounts = $db->execute(
            "SELECT account_id, account_code, account_name FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_type='income' AND parent_id IS NOT NULL AND is_active=1 ORDER BY account_code",
            [$code]
        )->fetchAll('assoc');
        $bankAccounts = $db->execute(
            "SELECT bank_account_id, CONCAT(bank_name,' (',account_type,')') AS account_label, account_type FROM fin_bank_accounts
             WHERE ssms_client_code=? AND is_active=1 ORDER BY is_default DESC, bank_name",
            [$code]
        )->fetchAll('assoc');
        return compact('incAccounts','bankAccounts');
    }

    private function canVoid(): bool
    {
        return in_array($this->request->getSession()->read('ssms_user_role'), ['admin','owner']);
    }

    public function index()
    {
        $from = $this->request->getQuery('from', date('Y-m-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));
        $type = $this->request->getQuery('type', '');

        $sql  = "SELECT i.*, a.account_name, CONCAT(b.bank_name,' (',b.account_type,')') AS bank_label
                 FROM fin_income i
                 JOIN fin_chart_of_accounts a ON a.account_id = i.account_id
                 JOIN fin_bank_accounts b ON b.bank_account_id = i.bank_account_id
                 WHERE i.ssms_client_code=? AND i.income_date BETWEEN ? AND ?";
        $p = [$this->code(), $from, $to];
        if ($type) { $sql .= " AND i.income_type=?"; $p[] = $type; }
        $sql .= " ORDER BY i.income_date DESC, i.income_id DESC";

        $income = $this->db()->execute($sql, $p)->fetchAll('assoc');
        // Total excludes voided entries
        $total  = array_sum(array_column(
            array_filter($income, fn($i) => ($i['status'] ?? 'active') !== 'voided'),
            'amount'
        ));
        $fy       = $this->currentFy();
        $canVoid  = $this->canVoid();
        $this->set(compact('income','total','from','to','type','fy','canVoid'));
    }

    public function add()
    {
        $fy = $this->currentFy();
        if (!$fy) {
            $this->Flash->error('No active fiscal year found. Please create a fiscal year first.');
            return $this->redirect(['action'=>'index']);
        }
        ['incAccounts'=>$incAccounts,'bankAccounts'=>$bankAccounts] = $this->loadDropdowns();

        if (empty($bankAccounts)) {
            $this->Flash->error('No bank/cash accounts configured. Please add a bank account in Finance Setup first.');
            return $this->redirect(['action'=>'index']);
        }

        if ($fy['is_locked']) {
            $this->Flash->error('This fiscal year is locked. No new entries can be posted.');
            return $this->redirect(['action'=>'index']);
        }

        if ($this->request->is('post')) {
                        log::error("received data is :". json_encode($this->request->getData()));

            $d         = $this->request->getData();
            $amount    = (float)($d['amount'] ?? 0);
            $receiptNo = $this->nextRef('REC','fin_income','receipt_no');

            // Get ledger account_id from bank account
            $ba = $this->db()->execute(
                "SELECT account_id FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
                [$d['bank_account_id'], $this->code()]
            )->fetch('assoc');
            log::error("query is :". json_encode($ba));
            if (!$ba || $amount <= 0) {
                $this->Flash->error('Invalid amount or bank account.');
            } else {
                $jid = $this->postJournal(
                    ['fy_id'=>$fy['fy_id'],'date'=>$d['income_date'],'ref'=>$receiptNo,
                     'description'=>$d['description'] ?: 'Income - '.$d['income_type'],
                     'source_type'=>'income','source_id'=>null],
                    [
                        ['account_id'=>$ba['account_id'], 'debit'=>$amount, 'credit'=>0,      'narration'=>$d['payer_name']??null],
                        ['account_id'=>$d['account_id'],  'debit'=>0,       'credit'=>$amount,'narration'=>$d['description']??null],
                    ]
                );
                $attachment = $this->saveAttachment();
                $this->db()->execute(
                    "INSERT INTO fin_income
                     (ssms_client_code,fy_id,income_date,income_type,account_id,bank_account_id,
                      amount,payer_name,payer_contact,description,payment_mode,reference_no,receipt_no,journal_id,attachment,created_by)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [$this->code(),$fy['fy_id'],$d['income_date'],$d['income_type'],$d['account_id'],
                     $d['bank_account_id'],$amount,$d['payer_name']??null,$d['payer_contact']??null,
                     $d['description']??null,$d['payment_mode']??'cash',$d['reference_no']??null,
                     $receiptNo,$jid,$attachment,$this->user()]
                );
                $incId = (int)$this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
                $this->db()->execute("UPDATE fin_journal_entries SET source_id=? WHERE journal_id=?",[$incId,$jid]);

                $this->Flash->success("Income recorded. Receipt No: <strong>$receiptNo</strong>", ['escape'=>false]);
                return $this->redirect(['action'=>'view',$incId]);
            }
        }
        $this->set(compact('fy','incAccounts','bankAccounts'));
    }

    public function view(int $id)
    {
        $income = $this->db()->execute(
            "SELECT i.*, a.account_name, CONCAT(b.bank_name,' (',b.account_type,')') AS bank_label, b.bank_name
             FROM fin_income i
             JOIN fin_chart_of_accounts a ON a.account_id = i.account_id
             JOIN fin_bank_accounts b ON b.bank_account_id = i.bank_account_id
             WHERE i.income_id=? AND i.ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$income) { $this->Flash->error('Record not found.'); return $this->redirect(['action'=>'index']); }

        $journal = $income['journal_id'] ? $this->db()->execute(
            "SELECT jl.*, a.account_code, a.account_name, a.account_type
             FROM fin_journal_lines jl JOIN fin_chart_of_accounts a ON a.account_id=jl.account_id
             WHERE jl.journal_id=?", [$income['journal_id']]
        )->fetchAll('assoc') : [];

        // School info for receipt header
        $school = $this->db()->execute(
            "SELECT ssms_client_header_text, ssms_client_address FROM ssms_clients WHERE ssms_client_code=? LIMIT 1",
            [$this->code()]
        )->fetch('assoc');

        // Reversal journal lines (if voided)
        $reversalJournal = [];
        if (!empty($income['reversal_journal_id'])) {
            $reversalJournal = $this->db()->execute(
                "SELECT jl.*, a.account_code, a.account_name
                 FROM fin_journal_lines jl JOIN fin_chart_of_accounts a ON a.account_id=jl.account_id
                 WHERE jl.journal_id=?", [$income['reversal_journal_id']]
            )->fetchAll('assoc');
        }

        $canVoid = $this->canVoid();
        $this->set(compact('income','journal','school','canVoid','reversalJournal'));
    }

    public function edit(int $id)
    {
        $income = $this->db()->execute(
            "SELECT * FROM fin_income WHERE income_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$income) { $this->Flash->error('Record not found.'); return $this->redirect(['action'=>'index']); }

        if ($this->request->is(['post','put'])) {
            $d = $this->request->getData();
            $this->db()->execute(
                "UPDATE fin_income SET payer_name=?,payer_contact=?,description=?,payment_mode=?,reference_no=?
                 WHERE income_id=? AND ssms_client_code=?",
                [$d['payer_name']??null,$d['payer_contact']??null,$d['description']??null,
                 $d['payment_mode']??'cash',$d['reference_no']??null,$id,$this->code()]
            );
            $this->Flash->success('Income record updated.');
            return $this->redirect(['action'=>'view',$id]);
        }
        ['incAccounts'=>$incAccounts,'bankAccounts'=>$bankAccounts] = $this->loadDropdowns();
        $this->set(compact('income','incAccounts','bankAccounts'));
    }

    public function void(int $id)
    {
        if (!$this->canVoid()) {
            $this->Flash->error('Only Admin or Owner can void income entries.');
            return $this->redirect(['action'=>'view',$id]);
        }
        if (!$this->request->is('post')) {
            return $this->redirect(['action'=>'view',$id]);
        }

        $income = $this->db()->execute(
            "SELECT * FROM fin_income WHERE income_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$income) { $this->Flash->error('Record not found.'); return $this->redirect(['action'=>'index']); }
        if (($income['status'] ?? 'active') === 'voided') {
            $this->Flash->error('This entry is already voided.');
            return $this->redirect(['action'=>'view',$id]);
        }

        $reason = trim($this->request->getData('void_reason') ?? '');
        if (empty($reason)) {
            $this->Flash->error('A reason is required to void an entry.');
            return $this->redirect(['action'=>'view',$id]);
        }

        // Fetch original journal lines and reverse DR/CR
        $origLines = $this->db()->execute(
            "SELECT * FROM fin_journal_lines WHERE journal_id=?",
            [$income['journal_id']]
        )->fetchAll('assoc');

        $reversalLines = [];
        foreach ($origLines as $l) {
            $reversalLines[] = [
                'account_id' => $l['account_id'],
                'debit'      => (float)$l['credit_amount'],
                'credit'     => (float)$l['debit_amount'],
                'narration'  => 'VOID: ' . ($l['narration'] ?? ''),
            ];
        }

        $revJid = $this->postJournal(
            ['fy_id'       => $income['fy_id'],
             'date'        => date('Y-m-d'),
             'ref'         => 'VOID-' . $income['receipt_no'],
             'description' => 'Reversal of ' . $income['receipt_no'] . ' — ' . $reason,
             'source_type' => 'income_void',
             'source_id'   => $id],
            $reversalLines
        );

        $this->db()->execute(
            "UPDATE fin_income SET status='voided', void_reason=?, voided_by=?, voided_at=NOW(), reversal_journal_id=?
             WHERE income_id=? AND ssms_client_code=?",
            [$reason, $this->user(), $revJid, $id, $this->code()]
        );

        $this->Flash->success('Income entry voided and reversal journal posted.');
        return $this->redirect(['action'=>'view',$id]);
    }
}
