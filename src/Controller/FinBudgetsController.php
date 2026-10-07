<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinBudgetsController extends AppController
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

    private function expenseAccounts(): array
    {
        return $this->db()->execute(
            "SELECT account_id, account_code, account_name FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_type='expense' AND is_active=1
             ORDER BY account_code",
            [$this->code()]
        )->fetchAll('assoc');
    }

    public static function departments(): array
    {
        return [
            'Administration', 'Science & Lab', 'Arts & Culture', 'Sports & Activities',
            'Library', 'IT & Technology', 'Hostel', 'Transport', 'Accounts',
            'Maintenance', 'Student Welfare', 'General',
        ];
    }

    public function index()
    {
        $fy = $this->currentFy();
        $budgets = $this->db()->execute(
            "SELECT b.*, f.fy_name,
                    COUNT(bl.line_id) AS line_count,
                    COALESCE(SUM(bl.budgeted_amount),0) AS total_budgeted
             FROM fin_budgets b
             JOIN fin_fiscal_years f ON f.fy_id = b.fy_id
             LEFT JOIN fin_budget_lines bl ON bl.budget_id = b.budget_id
             WHERE b.ssms_client_code=?
             GROUP BY b.budget_id
             ORDER BY b.created DESC",
            [$this->code()]
        )->fetchAll('assoc');
        $this->set(compact('budgets','fy'));
    }

    public function add()
    {
        $fy = $this->currentFy();
        if (!$fy) {
            $this->Flash->error('No active fiscal year. Please create one first.');
            return $this->redirect(['action'=>'index']);
        }
        $expAccounts = $this->expenseAccounts();
        $departments = self::departments();

        if ($this->request->is('post')) {
            $d     = $this->request->getData();
            $lines = $d['lines'] ?? [];

            // Filter out empty lines
            $lines = array_filter($lines, fn($l) => !empty($l['account_id']) && (float)($l['budgeted_amount'] ?? 0) > 0);

            if (empty($lines)) {
                $this->Flash->error('Please add at least one budget line with an account and amount.');
            } else {
                $db = $this->db();
                $db->execute(
                    "INSERT INTO fin_budgets (ssms_client_code, fy_id, budget_name, notes, created_by)
                     VALUES (?,?,?,?,?)",
                    [$this->code(), $fy['fy_id'], $d['budget_name'], $d['notes']??null, $this->user()]
                );
                $budgetId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

                foreach ($lines as $line) {
                    $db->execute(
                        "INSERT INTO fin_budget_lines (budget_id, account_id, department, budgeted_amount, notes)
                         VALUES (?,?,?,?,?)",
                        [$budgetId, $line['account_id'], $line['department']??null,
                         (float)$line['budgeted_amount'], $line['notes']??null]
                    );
                }
                $this->Flash->success('Budget created successfully.');
                return $this->redirect(['action'=>'view',$budgetId]);
            }
        }
        $this->set(compact('fy','expAccounts','departments'));
    }

    public function view(int $id)
    {
        $budget = $this->db()->execute(
            "SELECT b.*, f.fy_name, f.start_date, f.end_date
             FROM fin_budgets b JOIN fin_fiscal_years f ON f.fy_id=b.fy_id
             WHERE b.budget_id=? AND b.ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$budget) { $this->Flash->error('Budget not found.'); return $this->redirect(['action'=>'index']); }

        // Budget lines with actual spend from approved journal entries
        $lines = $this->db()->execute(
            "SELECT bl.*, a.account_code, a.account_name,
                    COALESCE(SUM(jl.debit_amount),0) AS actual_spend
             FROM fin_budget_lines bl
             JOIN fin_chart_of_accounts a ON a.account_id = bl.account_id
             LEFT JOIN fin_journal_lines jl ON jl.account_id = bl.account_id
             LEFT JOIN fin_journal_entries je ON je.journal_id = jl.journal_id
                   AND je.ssms_client_code=?
                   AND je.fy_id=?
                   AND je.source_type='expense'
             WHERE bl.budget_id=?
             GROUP BY bl.line_id
             ORDER BY bl.department, a.account_code",
            [$this->code(), $budget['fy_id'], $id]
        )->fetchAll('assoc');

        $totalBudgeted = array_sum(array_column($lines,'budgeted_amount'));
        $totalActual   = array_sum(array_column($lines,'actual_spend'));
        $this->set(compact('budget','lines','totalBudgeted','totalActual'));
    }

    public function edit(int $id)
    {
        $budget = $this->db()->execute(
            "SELECT b.*, f.fy_name FROM fin_budgets b JOIN fin_fiscal_years f ON f.fy_id=b.fy_id
             WHERE b.budget_id=? AND b.ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$budget) { $this->Flash->error('Budget not found.'); return $this->redirect(['action'=>'index']); }

        $expAccounts  = $this->expenseAccounts();
        $departments  = self::departments();
        $existingLines = $this->db()->execute(
            "SELECT * FROM fin_budget_lines WHERE budget_id=? ORDER BY department, line_id",
            [$id]
        )->fetchAll('assoc');

        if ($this->request->is(['post','put'])) {
            $d     = $this->request->getData();
            $lines = array_filter($d['lines'] ?? [], fn($l) => !empty($l['account_id']) && (float)($l['budgeted_amount'] ?? 0) > 0);

            if (empty($lines)) {
                $this->Flash->error('Please add at least one budget line.');
            } else {
                $db = $this->db();
                $db->execute(
                    "UPDATE fin_budgets SET budget_name=?, notes=? WHERE budget_id=? AND ssms_client_code=?",
                    [$d['budget_name'], $d['notes']??null, $id, $this->code()]
                );
                // Replace all lines
                $db->execute("DELETE FROM fin_budget_lines WHERE budget_id=?", [$id]);
                foreach ($lines as $line) {
                    $db->execute(
                        "INSERT INTO fin_budget_lines (budget_id, account_id, department, budgeted_amount, notes)
                         VALUES (?,?,?,?,?)",
                        [$id, $line['account_id'], $line['department']??null,
                         (float)$line['budgeted_amount'], $line['notes']??null]
                    );
                }
                $this->Flash->success('Budget updated.');
                return $this->redirect(['action'=>'view',$id]);
            }
        }
        $this->set(compact('budget','expAccounts','departments','existingLines'));
    }

    /**
     * Budget vs Actual dashboard — visual overview across all departments
     */
    public function dashboard()
    {
        $fy = $this->currentFy();
        if (!$fy) {
            $this->Flash->error('No active fiscal year.');
            return $this->redirect(['action'=>'index']);
        }

        // Pick the active budget for current FY (first active one)
        $budget = $this->db()->execute(
            "SELECT * FROM fin_budgets WHERE ssms_client_code=? AND fy_id=? AND is_active=1 ORDER BY created DESC LIMIT 1",
            [$this->code(), $fy['fy_id']]
        )->fetch('assoc');

        $lines = [];
        $deptSummary = [];

        if ($budget) {
            $lines = $this->db()->execute(
                "SELECT bl.*, a.account_code, a.account_name,
                        COALESCE(SUM(jl.debit_amount),0) AS actual_spend
                 FROM fin_budget_lines bl
                 JOIN fin_chart_of_accounts a ON a.account_id = bl.account_id
                 LEFT JOIN fin_journal_lines jl ON jl.account_id = bl.account_id
                 LEFT JOIN fin_journal_entries je ON je.journal_id = jl.journal_id
                       AND je.ssms_client_code=?
                       AND je.fy_id=?
                       AND je.source_type='expense'
                 WHERE bl.budget_id=?
                 GROUP BY bl.line_id
                 ORDER BY bl.department, a.account_code",
                [$this->code(), $fy['fy_id'], $budget['budget_id']]
            )->fetchAll('assoc');

            // Aggregate by department
            foreach ($lines as $l) {
                $dept = $l['department'] ?: 'Unassigned';
                if (!isset($deptSummary[$dept])) {
                    $deptSummary[$dept] = ['budgeted'=>0,'actual'=>0];
                }
                $deptSummary[$dept]['budgeted'] += (float)$l['budgeted_amount'];
                $deptSummary[$dept]['actual']   += (float)$l['actual_spend'];
            }
        }

        $totalBudgeted = array_sum(array_column($lines,'budgeted_amount'));
        $totalActual   = array_sum(array_column($lines,'actual_spend'));
        $this->set(compact('fy','budget','lines','deptSummary','totalBudgeted','totalActual'));
    }

    /**
     * API: check budget remaining for an account (used by expense add form)
     */
    public function checkBudget()
    {
        $this->autoRender = false;
        $accountId = (int)$this->request->getQuery('account_id');
        $fy = $this->currentFy();
        if (!$fy || !$accountId) {
            echo json_encode(['status'=>'no_budget','remaining'=>null]);
            return;
        }

        $budgeted = (float)($this->db()->execute(
            "SELECT COALESCE(SUM(bl.budgeted_amount),0) AS t
             FROM fin_budget_lines bl
             JOIN fin_budgets b ON b.budget_id=bl.budget_id
             WHERE b.ssms_client_code=? AND b.fy_id=? AND bl.account_id=? AND b.is_active=1",
            [$this->code(), $fy['fy_id'], $accountId]
        )->fetch('assoc')['t'] ?? 0);

        if ($budgeted <= 0) {
            echo json_encode(['status'=>'no_budget','remaining'=>null]);
            return;
        }

        $actual = (float)($this->db()->execute(
            "SELECT COALESCE(SUM(jl.debit_amount),0) AS t
             FROM fin_journal_lines jl
             JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
             WHERE jl.account_id=? AND je.ssms_client_code=? AND je.fy_id=? AND je.source_type='expense'",
            [$accountId, $this->code(), $fy['fy_id']]
        )->fetch('assoc')['t'] ?? 0);

        $remaining = $budgeted - $actual;
        echo json_encode([
            'status'    => $remaining > 0 ? 'ok' : 'exceeded',
            'budgeted'  => $budgeted,
            'actual'    => $actual,
            'remaining' => $remaining,
        ]);
    }
}
