<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsFeeStructure Controller
 * — index() is reimplemented as the ClassFeeStructureScreen (combined manage page)
 * — add() / edit() / view() / delete() kept for individual-row operations
 *
 * @property \App\Model\Table\SsmsFeeStructureTable $SsmsFeeStructure
 */
class SsmsFeeStructureController extends AppController
{
    private const MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
    private const MONTH_NUM = [
        'Apr'=>'04','May'=>'05','Jun'=>'06','Jul'=>'07','Aug'=>'08','Sep'=>'09',
        'Oct'=>'10','Nov'=>'11','Dec'=>'12','Jan'=>'01','Feb'=>'02','Mar'=>'03',
    ];

    // =========================================================================
    // INDEX — ClassFeeStructureScreen (combined filter + load + save)
    // =========================================================================

    public function index()
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $db         = ConnectionManager::get('default');

        // ── Dropdown data ─────────────────────────────────────────────────
        $ssmsSessions   = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=:cc ORDER BY session_id DESC",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        $ssmsClasses    = $db->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=:cc ORDER BY class_name",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        $ssmsBranchList = $db->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=:cc ORDER BY branch_name",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        $feeItemsRaw    = $db->execute(
            "SELECT fee_item_id, fee_item_name, fee_type, is_mandatory, category
             FROM   ssms_fee_items
             WHERE  ssms_client_code=:cc AND status='Active'
             ORDER BY is_mandatory DESC, fee_item_name",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        // ── State vars ────────────────────────────────────────────────────
        $classId  = $sessionId = $branchId = null;
        $structure       = $this->_emptyStructure($feeItemsRaw);
        $structureLoaded = false;

        // ── Handle POST ───────────────────────────────────────────────────
        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $classId   = !empty($d['class_id'])   ? (int)$d['class_id']   : null;
            $sessionId = !empty($d['session_id'])  ? (int)$d['session_id'] : null;
            $branchId  = !empty($d['branch_id'])   ? (int)$d['branch_id']  : null;

            // ─ SAVE ────────────────────────────────────────────────────────
            if (!empty($d['save_structure']) && $classId && $sessionId && $branchId) {
                $this->_saveFeeStructure($db, $d['amounts'] ?? [], $feeItemsRaw, $classId, $sessionId, $branchId, $clientCode);
                return $this->redirect(['action' => 'index', '?' => ['class_id' => $classId, 'session_id' => $sessionId, 'branch_id' => $branchId]]);
            }

            // ─ LOAD ────────────────────────────────────────────────────────
            if ($classId && $sessionId && $branchId) {
                $structure       = $this->_loadStructure($db, $feeItemsRaw, $classId, $sessionId, $branchId, $clientCode);
                $structureLoaded = true;
            }

        // ── Handle GET with ?class_id= (after redirect from save) ────────
        } else {
            $q         = $this->request->getQueryParams();
            $classId   = !empty($q['class_id'])   ? (int)$q['class_id']   : null;
            $sessionId = !empty($q['session_id'])  ? (int)$q['session_id'] : null;
            $branchId  = !empty($q['branch_id'])   ? (int)$q['branch_id']  : null;

            if ($classId && $sessionId && $branchId) {
                $structure       = $this->_loadStructure($db, $feeItemsRaw, $classId, $sessionId, $branchId, $clientCode);
                $structureLoaded = true;
            }
        }

        $months = self::MONTHS;
        $this->set(compact(
            'ssmsSessions', 'ssmsClasses', 'ssmsBranchList', 'feeItemsRaw',
            'structure', 'classId', 'sessionId', 'branchId',
            'structureLoaded', 'months'
        ));
    }

    // =========================================================================
    // VIEW — single fee structure row
    // =========================================================================

    public function view($id = null)
    {
        $ssmsFeeStructure = $this->SsmsFeeStructure->get($id, contain: ['FeeItems', 'Branches']);
        $this->set(compact('ssmsFeeStructure'));
    }

    // =========================================================================
    // ADD — single-row add (kept for manual entry / edge cases)
    // =========================================================================

    public function add()
    {
        $ssmsFeeStructure = $this->SsmsFeeStructure->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsFeeStructure = $this->SsmsFeeStructure->patchEntity($ssmsFeeStructure, $this->request->getData());
            if ($this->SsmsFeeStructure->save($ssmsFeeStructure)) {
                $this->Flash->success('Fee structure row saved.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save. Please try again.');
        }
        $feeItems = $this->SsmsFeeStructure->FeeItems->find('list', limit: 200)->all();
        $branches = $this->SsmsFeeStructure->Branches->find('list', limit: 200)->all();

        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $db = ConnectionManager::get('default');
        $ssmsSessions = $db->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=:cc ORDER BY session_id DESC", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsClasses  = $db->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=:cc ORDER BY class_name", ['cc' => $clientCode])->fetchAll('assoc');

        $this->set(compact('ssmsFeeStructure', 'feeItems', 'branches', 'ssmsSessions', 'ssmsClasses'));
    }

    // =========================================================================
    // EDIT — single-row edit
    // =========================================================================

    public function edit($id = null)
    {
        $ssmsFeeStructure = $this->SsmsFeeStructure->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsFeeStructure = $this->SsmsFeeStructure->patchEntity($ssmsFeeStructure, $this->request->getData());
            if ($this->SsmsFeeStructure->save($ssmsFeeStructure)) {
                $this->Flash->success('Fee structure row updated.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update. Please try again.');
        }
        $feeItems = $this->SsmsFeeStructure->FeeItems->find('list', limit: 200)->all();
        $branches = $this->SsmsFeeStructure->Branches->find('list', limit: 200)->all();

        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $db = ConnectionManager::get('default');
        $ssmsSessions = $db->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=:cc ORDER BY session_id DESC", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsClasses  = $db->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=:cc ORDER BY class_name", ['cc' => $clientCode])->fetchAll('assoc');

        $this->set(compact('ssmsFeeStructure', 'feeItems', 'branches', 'ssmsSessions', 'ssmsClasses'));
    }

    // =========================================================================
    // DELETE — single-row delete
    // =========================================================================

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsFeeStructure = $this->SsmsFeeStructure->get($id);
        if ($this->SsmsFeeStructure->delete($ssmsFeeStructure)) {
            $this->Flash->success('Fee structure row deleted.');
        } else {
            $this->Flash->error('Could not delete. Please try again.');
        }
        return $this->redirect(['action' => 'index']);
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /** Build empty 4-bucket structure from fee items list */
    private function _emptyStructure(array $feeItemsRaw): array
    {
        $s = ['oneTimeMandatory' => [], 'oneTimeOptional' => [], 'monthlyMandatory' => [], 'monthlyOptional' => []];
        foreach ($feeItemsRaw as $fi) {
            $isMonthly  = ($fi['fee_type'] === 'Monthly');
            $isMandatory= (strtolower((string)($fi['is_mandatory'] ?? 'yes')) === 'yes');
            if ($isMonthly) {
                $months = [];
                foreach (self::MONTHS as $m) { $months[$m] = ['amount' => '', 'fee_id' => null]; }
                $obj = ['id' => $fi['fee_item_id'], 'feeName' => $fi['fee_item_name'], 'months' => $months];
                $isMandatory ? $s['monthlyMandatory'][] = $obj : $s['monthlyOptional'][] = $obj;
            } else {
                $obj = ['id' => $fi['fee_item_id'], 'feeName' => $fi['fee_item_name'], 'amount' => '', 'fee_id' => null];
                $isMandatory ? $s['oneTimeMandatory'][] = $obj : $s['oneTimeOptional'][] = $obj;
            }
        }
        return $s;
    }

    /** Load existing fee structure from DB and merge into 4 buckets */
    private function _loadStructure($db, array $feeItemsRaw, int $classId, int $sessionId, int $branchId, string $clientCode): array
    {
        $rows = $db->execute(
            "SELECT fs.fee_id, fs.fee_item_id, fs.fee_amount, fs.month_no
             FROM   ssms_fee_structure fs
             INNER JOIN (
                 SELECT MIN(fee_id) AS min_id
                 FROM   ssms_fee_structure
                 WHERE  class_id=:cls AND session_id=:sid AND branch_id=:bid AND ssms_client_code=:cc
                 GROUP  BY fee_item_id, month_no
             ) canon ON canon.min_id = fs.fee_id
             ORDER  BY fs.fee_item_id, fs.month_no",
            ['cls' => $classId, 'sid' => $sessionId, 'bid' => $branchId, 'cc' => $clientCode]
        )->fetchAll('assoc');

        // Index: [fee_item_id][month_no] => row
        $idx = [];
        foreach ($rows as $r) {
            $idx[$r['fee_item_id']][$r['month_no']] = $r;
        }

        $s = ['oneTimeMandatory' => [], 'oneTimeOptional' => [], 'monthlyMandatory' => [], 'monthlyOptional' => []];
        foreach ($feeItemsRaw as $fi) {
            $fid         = $fi['fee_item_id'];
            $isMonthly   = ($fi['fee_type'] === 'Monthly');
            $isMandatory = (strtolower((string)($fi['is_mandatory'] ?? 'yes')) === 'yes');

            if ($isMonthly) {
                $monthData = [];
                foreach (self::MONTHS as $m) {
                    $found = $idx[$fid][$m] ?? null;
                    $monthData[$m] = [
                        'amount' => $found ? (string)$found['fee_amount'] : '',
                        'fee_id' => $found ? $found['fee_id'] : null,
                    ];
                }
                $obj = ['id' => $fid, 'feeName' => $fi['fee_item_name'], 'months' => $monthData];
                $isMandatory ? $s['monthlyMandatory'][] = $obj : $s['monthlyOptional'][] = $obj;
            } else {
                $allRows = $idx[$fid] ?? [];
                $found   = !empty($allRows) ? array_values($allRows)[0] : null;
                $obj = [
                    'id'     => $fid,
                    'feeName'=> $fi['fee_item_name'],
                    'amount' => $found ? (string)$found['fee_amount'] : '',
                    'fee_id' => $found ? $found['fee_id'] : null,
                ];
                $isMandatory ? $s['oneTimeMandatory'][] = $obj : $s['oneTimeOptional'][] = $obj;
            }
        }
        return $s;
    }

    /** Upsert fee structure amounts from POST data */
    private function _saveFeeStructure($db, array $amounts, array $feeItemsRaw, int $classId, int $sessionId, int $branchId, string $clientCode): void
    {
        $now  = date('Y-m-d H:i:s');
        $year = (int)date('Y');

        // Pre-load canonical fee_id per (fee_item_id, month_no) using MIN(fee_id)
        // so we always operate on the original row (which may have payment history).
        // Duplicate rows created by earlier buggy saves are cleaned up below.
        $existing = [];
        $rows = $db->execute(
            "SELECT MIN(fee_id) AS fee_id, fee_item_id, month_no
             FROM ssms_fee_structure
             WHERE class_id=? AND session_id=? AND branch_id=? AND ssms_client_code=?
             GROUP BY fee_item_id, month_no",
            [$classId, $sessionId, $branchId, $clientCode]
        )->fetchAll('assoc');
        foreach ($rows as $r) {
            $existing[$r['fee_item_id']][$r['month_no']] = (int)$r['fee_id'];
        }

        $db->begin();
        try {
            foreach ($feeItemsRaw as $fi) {
                $fid         = $fi['fee_item_id'];
                $isMonthly   = ($fi['fee_type'] === 'Monthly');
                $isMandatory = (strtolower((string)($fi['is_mandatory'] ?? 'yes')) === 'yes');

                if ($isMonthly) {
                    $bucket = $isMandatory ? 'monthlyMandatory' : 'monthlyOptional';
                    foreach (self::MONTHS as $m) {
                        $amount = (float)($amounts[$bucket][$fid][$m] ?? 0);
                        if ($amount <= 0) continue;

                        if (isset($existing[$fid][$m])) {
                            // UPDATE existing row — preserve original due_date
                            $db->execute(
                                "UPDATE ssms_fee_structure SET fee_amount=? WHERE fee_id=?",
                                [$amount, $existing[$fid][$m]]
                            );
                        } else {
                            // INSERT new row
                            $mo      = self::MONTH_NUM[$m];
                            $y       = in_array($m, ['Jan','Feb','Mar']) ? $year + 1 : $year;
                            $dueDate = sprintf('%04d-%s-01', $y, $mo);
                            $db->execute(
                                "INSERT INTO ssms_fee_structure
                                    (fee_item_id, fee_amount, due_date, class_id, session_id, branch_id,
                                     month_no, ssms_client_code)
                                 VALUES (?,?,?,?,?,?,?,?)",
                                [$fid, $amount, $dueDate, $classId, $sessionId, $branchId, $m, $clientCode]
                            );
                        }
                    }
                } else {
                    $bucket = $isMandatory ? 'oneTimeMandatory' : 'oneTimeOptional';
                    $amount = (float)($amounts[$bucket][$fid] ?? 0);
                    if ($amount <= 0) continue;

                    // One-time fees use 'Apr' as the month_no placeholder
                    if (isset($existing[$fid]['Apr'])) {
                        $db->execute(
                            "UPDATE ssms_fee_structure SET fee_amount=? WHERE fee_id=?",
                            [$amount, $existing[$fid]['Apr']]
                        );
                    } else {
                        $db->execute(
                            "INSERT INTO ssms_fee_structure
                                (fee_item_id, fee_amount, due_date, class_id, session_id, branch_id,
                                 month_no, ssms_client_code)
                             VALUES (?,?,CURDATE(),?,?,?,'Apr',?)",
                            [$fid, $amount, $classId, $sessionId, $branchId, $clientCode]
                        );
                    }
                }
            }

            // Remove duplicate rows created by earlier buggy saves.
            // Wrap the MIN subquery in another SELECT to avoid MySQL Error 1093
            // ("can't specify target table for update in FROM clause").
            $db->execute(
                "DELETE FROM ssms_fee_structure
                 WHERE class_id=? AND session_id=? AND branch_id=? AND ssms_client_code=?
                   AND fee_id NOT IN (
                       SELECT * FROM (
                           SELECT MIN(fee_id)
                           FROM ssms_fee_structure
                           WHERE class_id=? AND session_id=? AND branch_id=? AND ssms_client_code=?
                           GROUP BY fee_item_id, month_no
                       ) AS _keep
                   )",
                [$classId, $sessionId, $branchId, $clientCode,
                 $classId, $sessionId, $branchId, $clientCode]
            );

            $db->commit();
            $this->Flash->success('Fee structure saved successfully.');
        } catch (\Exception $e) {
            $db->rollback();
            Log::error('saveFeeStructure error: ' . $e->getMessage());
            $this->Flash->error('Save failed: ' . $e->getMessage());
        }
    }
}
