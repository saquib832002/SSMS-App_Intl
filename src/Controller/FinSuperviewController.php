<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * FinSuperviewController
 *
 * Superuser-only: consolidated finance overview across ALL client schools.
 * Restricted to ssms_user_role = 'superuser'.
 */
class FinSuperviewController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->loadComponent('Flash');
    }

    private function db() { return ConnectionManager::get('default'); }

    private function isSuperuser(): bool
    {
        return strtolower((string)$this->request->getSession()->read('ssms_user_role')) === 'superuser';
    }

    public function index()
    {
        if (!$this->isSuperuser()) {
            $this->Flash->error('Access restricted to superusers only.');
            return $this->redirect('/');
        }

        // All clients
        $clients = $this->db()->execute(
            "SELECT ssms_client_code, ssms_client_header_text AS school_name, ssms_client_city AS city
             FROM ssms_clients ORDER BY ssms_client_header_text"
        )->fetchAll('assoc');

        $rows = [];
        foreach ($clients as $c) {
            $code = $c['ssms_client_code'];

            // Active FY for this school
            $fy = $this->db()->execute(
                "SELECT fy_id, fy_name, start_date, end_date
                 FROM fin_fiscal_years WHERE ssms_client_code=? AND is_current=1 LIMIT 1",
                [$code]
            )->fetch('assoc');

            if (!$fy) {
                $rows[] = array_merge($c, [
                    'fy_name'      => '—',
                    'income'       => 0,
                    'expenses'     => 0,
                    'net'          => 0,
                    'pending'      => 0,
                    'cash'         => 0,
                    'has_fy'       => false,
                ]);
                continue;
            }

            $fyId = $fy['fy_id'];

            $income = (float)($this->db()->execute(
                "SELECT COALESCE(SUM(amount),0) AS t FROM fin_income
                 WHERE ssms_client_code=? AND fy_id=?",
                [$code, $fyId]
            )->fetch('assoc')['t'] ?? 0);

            $expenses = (float)($this->db()->execute(
                "SELECT COALESCE(SUM(amount),0) AS t FROM fin_expenses
                 WHERE ssms_client_code=? AND fy_id=? AND status='approved'",
                [$code, $fyId]
            )->fetch('assoc')['t'] ?? 0);

            $pending = (int)($this->db()->execute(
                "SELECT COUNT(*) AS n FROM fin_expenses
                 WHERE ssms_client_code=? AND fy_id=? AND status='pending'",
                [$code, $fyId]
            )->fetch('assoc')['n'] ?? 0);

            $cash = (float)($this->db()->execute(
                "SELECT COALESCE(SUM(current_balance),0) AS t
                 FROM fin_bank_accounts WHERE ssms_client_code=? AND is_active=1",
                [$code]
            )->fetch('assoc')['t'] ?? 0);

            $rows[] = array_merge($c, [
                'fy_name'  => $fy['fy_name'],
                'income'   => $income,
                'expenses' => $expenses,
                'net'      => $income - $expenses,
                'pending'  => $pending,
                'cash'     => $cash,
                'has_fy'   => true,
            ]);
        }

        // Grand totals
        $totals = [
            'income'   => array_sum(array_column($rows, 'income')),
            'expenses' => array_sum(array_column($rows, 'expenses')),
            'net'      => array_sum(array_column($rows, 'net')),
            'cash'     => array_sum(array_column($rows, 'cash')),
            'pending'  => array_sum(array_column($rows, 'pending')),
        ];

        $this->set(compact('rows', 'totals'));
    }
}
