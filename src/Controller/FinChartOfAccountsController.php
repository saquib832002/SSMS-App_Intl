<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinChartOfAccountsController extends AppController
{
    public function initialize(): void { parent::initialize(); $this->loadComponent('Flash'); }

    private function db()   { return ConnectionManager::get('default'); }
    private function code() { return $this->request->getSession()->read('ssms_client_code'); }

    /** Ensure COA seed exists for this client, then return all accounts. */
    private function ensureSeed(): void
    {
        $cnt = (int)$this->db()->execute(
            "SELECT COUNT(*) AS n FROM fin_chart_of_accounts WHERE ssms_client_code=?", [$this->code()]
        )->fetch('assoc')['n'];
        if ($cnt === 0) {
            $this->db()->execute("CALL fin_seed_coa(?)", [$this->code()]);
        }
    }

    public function index()
    {
        $this->ensureSeed();
        $accounts = $this->db()->execute(
            "SELECT a.*, p.account_name AS parent_name
             FROM fin_chart_of_accounts a
             LEFT JOIN fin_chart_of_accounts p ON p.account_id = a.parent_id
             WHERE a.ssms_client_code=? ORDER BY a.account_code",
            [$this->code()]
        )->fetchAll('assoc');
        $this->set(compact('accounts'));
    }

    public function add()
    {
        $this->ensureSeed();
        $parents = $this->db()->execute(
            "SELECT account_id, account_code, account_name, account_type
             FROM fin_chart_of_accounts WHERE ssms_client_code=? AND is_active=1 ORDER BY account_code",
            [$this->code()]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d  = $this->request->getData();
            $nb = in_array($d['account_type'], ['asset','expense']) ? 'debit' : 'credit';
            try {
                $this->db()->execute(
                    "INSERT INTO fin_chart_of_accounts
                     (ssms_client_code,parent_id,account_code,account_name,account_type,account_subtype,normal_balance)
                     VALUES (?,?,?,?,?,?,?)",
                    [$this->code(), $d['parent_id'] ?: null, $d['account_code'], $d['account_name'],
                     $d['account_type'], $d['account_subtype'] ?? null, $nb]
                );
                $this->Flash->success('Account created successfully.');
                return $this->redirect(['action' => 'index']);
            } catch (\Exception $e) {
                $this->Flash->error('Account code already exists or invalid data.');
            }
        }
        $this->set(compact('parents'));
    }

    public function edit(int $id)
    {
        $account = $this->db()->execute(
            "SELECT * FROM fin_chart_of_accounts WHERE account_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$account) { $this->Flash->error('Account not found.'); return $this->redirect(['action'=>'index']); }

        $parents = $this->db()->execute(
            "SELECT account_id, account_code, account_name FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_id != ? AND is_active=1 ORDER BY account_code",
            [$this->code(), $id]
        )->fetchAll('assoc');

        if ($this->request->is(['post','put'])) {
            $d = $this->request->getData();
            $this->db()->execute(
                "UPDATE fin_chart_of_accounts SET account_name=?,parent_id=?,account_subtype=?,is_active=?
                 WHERE account_id=? AND ssms_client_code=?",
                [$d['account_name'], $d['parent_id'] ?: null, $d['account_subtype'] ?? null,
                 isset($d['is_active']) ? 1 : 0, $id, $this->code()]
            );
            $this->Flash->success('Account updated.');
            return $this->redirect(['action'=>'index']);
        }
        $this->set(compact('account','parents'));
    }
}
