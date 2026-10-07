<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinFiscalYearsController extends AppController
{
    public function initialize(): void { parent::initialize(); $this->loadComponent('Flash'); }
    private function db()   { return ConnectionManager::get('default'); }
    private function code() { return $this->request->getSession()->read('ssms_client_code'); }

    public function index()
    {
        $fiscalYears = $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code=? ORDER BY start_date DESC",
            [$this->code()]
        )->fetchAll('assoc');
        $this->set(compact('fiscalYears'));
    }

    public function add()
    {
        if (!$this->request->is('post')) {
            return $this->redirect(['action' => 'index']);
        }
        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $isCurrent = (int)($d['is_current'] ?? 0);
            if ($isCurrent) {
                $this->db()->execute(
                    "UPDATE fin_fiscal_years SET is_current=0 WHERE ssms_client_code=?",
                    [$this->code()]
                );
            }
            $this->db()->execute(
                "INSERT INTO fin_fiscal_years (ssms_client_code, fy_name, start_date, end_date, is_current)
                 VALUES (?,?,?,?,?)",
                [$this->code(), $d['fy_name'], $d['start_date'], $d['end_date'], $isCurrent]
            );
            $hasCoa = $this->db()->execute(
                "SELECT COUNT(*) AS n FROM fin_chart_of_accounts WHERE ssms_client_code=?",
                [$this->code()]
            )->fetch('assoc')['n'];
            if (!$hasCoa) {
                $this->db()->execute("CALL fin_seed_coa(?)", [$this->code()]);
            }
            $this->Flash->success('Fiscal year created' . ($hasCoa ? '' : ' and Chart of Accounts seeded') . '.');
            return $this->redirect(['action'=>'index']);
        }
    }

    public function edit(int $id)
    {
        $fy = $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE fy_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$fy) { $this->Flash->error('Fiscal year not found.'); return $this->redirect(['action'=>'index']); }

        // Check if any journal entries exist for this fiscal year
        $hasTransactions = (int)$this->db()->execute(
            "SELECT COUNT(*) AS n FROM fin_journal_entries WHERE fy_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc')['n'] > 0;

        if ($this->request->is(['post','put'])) {
            $d = $this->request->getData();
            if ($hasTransactions) {
                // Only name is editable when transactions exist
                $this->db()->execute(
                    "UPDATE fin_fiscal_years SET fy_name=? WHERE fy_id=? AND ssms_client_code=?",
                    [$d['fy_name'], $id, $this->code()]
                );
            } else {
                $this->db()->execute(
                    "UPDATE fin_fiscal_years SET fy_name=?, start_date=?, end_date=? WHERE fy_id=? AND ssms_client_code=?",
                    [$d['fy_name'], $d['start_date'], $d['end_date'], $id, $this->code()]
                );
            }
            $this->Flash->success('Fiscal year updated.');
            return $this->redirect(['action'=>'index']);
        }

        $this->set(compact('fy','hasTransactions'));
    }

    public function toggleLock(int $id)
    {
        $this->request->allowMethod(['post']);
        $fy = $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE fy_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$fy) { $this->Flash->error('Fiscal year not found.'); return $this->redirect(['action'=>'index']); }

        $newLock = $fy['is_locked'] ? 0 : 1;
        $this->db()->execute(
            "UPDATE fin_fiscal_years SET is_locked=? WHERE fy_id=? AND ssms_client_code=?",
            [$newLock, $id, $this->code()]
        );
        $this->Flash->success('Fiscal year ' . ($newLock ? 'locked — no new entries can be posted.' : 'unlocked.'));
        return $this->redirect(['action'=>'index']);
    }

    public function setCurrent(int $id)
    {
        $this->request->allowMethod(['post']);
        $this->db()->execute(
            "UPDATE fin_fiscal_years SET is_current=0 WHERE ssms_client_code=?",
            [$this->code()]
        );
        $this->db()->execute(
            "UPDATE fin_fiscal_years SET is_current=1 WHERE fy_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        );
        $this->Flash->success('Active fiscal year updated.');
        return $this->redirect(['action'=>'index']);
    }
}
