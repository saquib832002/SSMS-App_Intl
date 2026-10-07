<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsPeriods Controller
 * Manages the school's daily period/time-slot master.
 * Admin / Owner only for write operations.
 */
class SsmsPeriodsController extends AppController
{
    private function _clientCode(): string
    {
        return (string) $this->request->getSession()->read('ssms_client_code');
    }

    private function _isAdminOrOwner(): bool
    {
        return in_array(
            $this->request->getSession()->read('ssms_user_role'),
            ['admin', 'owner'], true
        );
    }

    private function _requireAdminOrOwner(): ?object
    {
        if (!$this->_isAdminOrOwner()) {
            $this->Flash->error('You do not have permission to perform this action.');
            return $this->redirect(['action' => 'index']);
        }
        return null;
    }

    // ── index ─────────────────────────────────────────────────────────────────

    public function index()
    {
        $clientCode = $this->_clientCode();
        if (!$clientCode) {
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $conn    = ConnectionManager::get('default');
        $periods = $conn->execute(
            "SELECT * FROM ssms_periods
             WHERE ssms_client_code = ?
             ORDER BY period_number ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact('periods'));
        $this->set('isAdminOrOwner', $this->_isAdminOrOwner());
    }

    // ── add ───────────────────────────────────────────────────────────────────

    public function add()
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        if ($this->request->is('post')) {
            $d = $this->request->getData();

            if (empty($d['period_name']) || empty($d['start_time']) || empty($d['end_time'])) {
                $this->Flash->error('Period name, start time and end time are required.');
            } elseif ($d['start_time'] >= $d['end_time']) {
                $this->Flash->error('End time must be after start time.');
            } else {
                // Auto-assign next period_number if not provided
                $number = !empty($d['period_number']) ? (int)$d['period_number'] : null;
                if (!$number) {
                    $row    = $conn->execute(
                        "SELECT COALESCE(MAX(period_number), 0) + 1 AS next_num
                         FROM ssms_periods WHERE ssms_client_code = ?",
                        [$clientCode]
                    )->fetchAll('assoc');
                    $number = (int)($row[0]['next_num'] ?? 1);
                }

                $isBreak = isset($d['is_break']) ? 1 : 0;

                try {
                    $conn->execute(
                        "INSERT INTO ssms_periods
                            (ssms_client_code, period_number, period_name, start_time, end_time, is_break)
                         VALUES (?, ?, ?, ?, ?, ?)",
                        [$clientCode, $number, $d['period_name'], $d['start_time'], $d['end_time'], $isBreak]
                    );
                    $this->Flash->success('Period saved successfully.');
                    return $this->redirect(['action' => 'index']);
                } catch (\Exception $e) {
                    $this->Flash->error('Could not save period. Period number may already exist. ' . $e->getMessage());
                }
            }
        }

        $this->set('formData', $this->request->getData());
    }

    // ── edit ──────────────────────────────────────────────────────────────────

    public function edit($id = null)
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $period = $conn->execute(
            "SELECT * FROM ssms_periods WHERE period_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        )->fetchAll('assoc')[0] ?? null;

        if (!$period) {
            $this->Flash->error('Period not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is(['post', 'put'])) {
            $d = $this->request->getData();

            if (empty($d['period_name']) || empty($d['start_time']) || empty($d['end_time'])) {
                $this->Flash->error('Period name, start time and end time are required.');
            } elseif ($d['start_time'] >= $d['end_time']) {
                $this->Flash->error('End time must be after start time.');
            } else {
                $isBreak = isset($d['is_break']) ? 1 : 0;
                try {
                    $conn->execute(
                        "UPDATE ssms_periods SET
                            period_number = ?,
                            period_name   = ?,
                            start_time    = ?,
                            end_time      = ?,
                            is_break      = ?
                         WHERE period_id = ? AND ssms_client_code = ?",
                        [
                            (int)$d['period_number'], $d['period_name'],
                            $d['start_time'], $d['end_time'], $isBreak,
                            (int)$id, $clientCode,
                        ]
                    );
                    $this->Flash->success('Period updated successfully.');
                    return $this->redirect(['action' => 'index']);
                } catch (\Exception $e) {
                    $this->Flash->error('Could not update period. ' . $e->getMessage());
                }
            }
        }

        $this->set(compact('period'));
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function delete($id = null)
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;
        $this->request->allowMethod(['post', 'delete']);

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        // Check if period is used in any timetable
        $inUse = $conn->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_timetable
             WHERE period_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        )->fetchAll('assoc')[0]['cnt'] ?? 0;

        if ($inUse > 0) {
            $this->Flash->error('Cannot delete — this period is used in the timetable. Remove timetable entries first.');
            return $this->redirect(['action' => 'index']);
        }

        $conn->execute(
            "DELETE FROM ssms_periods WHERE period_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );
        $this->Flash->success('Period deleted.');
        return $this->redirect(['action' => 'index']);
    }
}
