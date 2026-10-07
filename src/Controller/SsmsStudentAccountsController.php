<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsStudentAccountsController
 * Mirrors StudentUserAccountsScreen — manage Student & Parent login accounts.
 * Admin / Owner only.
 *
 * Actions:
 *   index()  — list + filter (GET) or toggle status (POST)
 */
class SsmsStudentAccountsController extends AppController
{
    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function isAdminOrOwner(): bool
    {
        $role = strtolower((string)$this->request->getSession()->read('ssms_user_role'));
        return in_array($role, ['admin', 'owner'], true);
    }

    // ── index ─────────────────────────────────────────────────────────────────
    public function index()
    {
        if (!$this->isAdminOrOwner()) {
            $this->Flash->error('Only admins and owners can manage student accounts.');
            return $this->redirect('/');
        }

        $clientCode   = $this->request->getSession()->read('ssms_client_code');
        $db           = $this->db();
        $statusFilter = $this->request->getQuery('status') ?? '';
        $search       = trim((string)($this->request->getQuery('q') ?? ''));

        // ── Handle POST: toggle status ─────────────────────────────────────
        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $userName  = trim((string)($d['user_name']  ?? ''));
            $newStatus = trim((string)($d['new_status'] ?? ''));

            if ($userName && in_array($newStatus, ['active', 'Inactive'], true)) {
                // Verify the account belongs to this client and is Student/Parent
                $target = $db->execute(
                    "SELECT ssms_user_name FROM sawera_ssms_users
                     WHERE ssms_user_name=? AND ssms_client_code=? AND ssms_user_role IN ('Student','Parent') LIMIT 1",
                    [$userName, $clientCode]
                )->fetchAssoc();

                if ($target) {
                    $db->execute(
                        "UPDATE sawera_ssms_users SET ssms_user_status=? WHERE ssms_user_name=? AND ssms_client_code=?",
                        [$newStatus, $userName, $clientCode]
                    );
                    $label = $newStatus === 'active' ? 'activated' : 'deactivated';
                    $this->Flash->success("Account '{$userName}' {$label}.");
                } else {
                    $this->Flash->error('Account not found or not a student/parent account.');
                }
            }

            // Redirect back preserving filters
            return $this->redirect(['action' => 'index', '?' => ['status' => $statusFilter, 'q' => $search]]);
        }

        // ── Fetch accounts ─────────────────────────────────────────────────
        $sql    = "SELECT u.ssms_user_name, u.ssms_user_firstname, u.ssms_user_lastname,
                          u.ssms_user_email, u.ssms_user_role, u.ssms_user_status,
                          u.branch_id, u.mobile_number, u.last_login_date, u.created,
                          b.branch_name
                   FROM   sawera_ssms_users u
                   LEFT JOIN ssms_branch b ON b.branch_id = u.branch_id
                   WHERE  u.ssms_client_code = ?
                     AND  u.ssms_user_role IN ('Student','Parent')";
        $params = [$clientCode];

        if ($statusFilter !== '') {
            $sql .= " AND LOWER(u.ssms_user_status) = ?";
            $params[] = strtolower($statusFilter);
        }
        if ($search !== '') {
            $like = '%' . $search . '%';
            $sql .= " AND (u.ssms_user_firstname LIKE ? OR u.ssms_user_lastname LIKE ?
                           OR u.ssms_user_name LIKE ? OR u.ssms_user_email LIKE ?
                           OR b.branch_name LIKE ?)";
            $params = array_merge($params, [$like, $like, $like, $like, $like]);
        }
        $sql .= " ORDER BY u.ssms_user_role ASC, u.ssms_user_firstname ASC";

        $accounts = $db->execute($sql, $params)->fetchAll('assoc');

        // Counts for filter chips (unfiltered)
        $allAccounts    = $db->execute(
            "SELECT ssms_user_status FROM sawera_ssms_users WHERE ssms_client_code=? AND ssms_user_role IN ('Student','Parent')",
            [$clientCode]
        )->fetchAll('assoc');
        $totalCount    = count($allAccounts);
        $activeCount   = count(array_filter($allAccounts, fn($a) => strtolower($a['ssms_user_status']) === 'active'));
        $inactiveCount = $totalCount - $activeCount;

        $this->set(compact('accounts', 'statusFilter', 'search', 'totalCount', 'activeCount', 'inactiveCount'));
    }
}
