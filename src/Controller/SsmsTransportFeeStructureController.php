<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsTransportFeeStructureController
 * Mirrors TransportFeeStructureScreen — same data model as SsmsFeeStructureController
 * but scoped to fee items with category = 'Transport'.
 */
class SsmsTransportFeeStructureController extends AppController
{
    private const CATEGORY   = 'Transport';
    private const MONTHS     = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
    private const MONTH_NUM  = [
        'Apr'=>'04','May'=>'05','Jun'=>'06','Jul'=>'07','Aug'=>'08','Sep'=>'09',
        'Oct'=>'10','Nov'=>'11','Dec'=>'12','Jan'=>'01','Feb'=>'02','Mar'=>'03',
    ];

    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    public function index()
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $db         = $this->db();

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

        // Only Transport fee items
        $feeItemsRaw    = $db->execute(
            "SELECT fee_item_id, fee_item_name, fee_type, is_mandatory, category
             FROM   ssms_fee_items
             WHERE  ssms_client_code=:cc AND status='Active' AND category=:cat
             ORDER BY is_mandatory DESC, fee_item_name",
            ['cc' => $clientCode, 'cat' => self::CATEGORY]
        )->fetchAll('assoc');

        $classId = $sessionId = $branchId = null;
        $structure       = $this->_emptyStructure($feeItemsRaw);
        $structureLoaded = false;

        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $classId   = !empty($d['class_id'])   ? (int)$d['class_id']   : null;
            $sessionId = !empty($d['session_id'])  ? (int)$d['session_id'] : null;
            $branchId  = !empty($d['branch_id'])   ? (int)$d['branch_id']  : null;

            if (!empty($d['save_structure']) && $classId && $sessionId && $branchId) {
                $this->_saveFeeStructure($db, $d['amounts'] ?? [], $feeItemsRaw, $classId, $sessionId, $branchId, $clientCode);
                return $this->redirect(['action' => 'index', '?' => ['class_id' => $classId, 'session_id' => $sessionId, 'branch_id' => $branchId]]);
            }

            if ($classId && $sessionId && $branchId) {
                $structure       = $this->_loadStructure($db, $feeItemsRaw, $classId, $sessionId, $branchId, $clientCode);
                $structureLoaded = true;
            }
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

    private function _emptyStructure(array $feeItemsRaw): array
    {
        $s = ['oneTimeMandatory' => [], 'oneTimeOptional' => [], 'monthlyMandatory' => [], 'monthlyOptional' => []];
        foreach ($feeItemsRaw as $fi) {
            $isMonthly   = ($fi['fee_type'] === 'Monthly');
            $isMandatory = (strtolower((string)($fi['is_mandatory'] ?? 'yes')) === 'yes');
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

    private function _loadStructure($db, array $feeItemsRaw, int $classId, int $sessionId, int $branchId, string $clientCode): array
    {
        $rows = $db->execute(
            "SELECT fs.fee_id, fs.fee_item_id, fs.fee_amount, fs.month_no
             FROM   ssms_fee_structure fs
             INNER JOIN ssms_fee_items fi ON fi.fee_item_id = fs.fee_item_id AND fi.category = ?
             INNER JOIN (
                 SELECT MIN(fs2.fee_id) AS min_id
                 FROM   ssms_fee_structure fs2
                 INNER JOIN ssms_fee_items fi2 ON fi2.fee_item_id = fs2.fee_item_id AND fi2.category = ?
                 WHERE  fs2.class_id=? AND fs2.session_id=? AND fs2.branch_id=? AND fs2.ssms_client_code=?
                 GROUP  BY fs2.fee_item_id, fs2.month_no
             ) canon ON canon.min_id = fs.fee_id
             ORDER  BY fs.fee_item_id, fs.month_no",
            [self::CATEGORY, self::CATEGORY, $classId, $sessionId, $branchId, $clientCode]
        )->fetchAll('assoc');

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
                    'id'      => $fid,
                    'feeName' => $fi['fee_item_name'],
                    'amount'  => $found ? (string)$found['fee_amount'] : '',
                    'fee_id'  => $found ? $found['fee_id'] : null,
                ];
                $isMandatory ? $s['oneTimeMandatory'][] = $obj : $s['oneTimeOptional'][] = $obj;
            }
        }
        return $s;
    }

    private function _saveFeeStructure($db, array $amounts, array $feeItemsRaw, int $classId, int $sessionId, int $branchId, string $clientCode): void
    {
        $year = (int)date('Y');

        $existing = [];
        $rows = $db->execute(
            "SELECT MIN(fs.fee_id) AS fee_id, fs.fee_item_id, fs.month_no
             FROM ssms_fee_structure fs
             INNER JOIN ssms_fee_items fi ON fi.fee_item_id = fs.fee_item_id AND fi.category = ?
             WHERE fs.class_id=? AND fs.session_id=? AND fs.branch_id=? AND fs.ssms_client_code=?
             GROUP BY fs.fee_item_id, fs.month_no",
            [self::CATEGORY, $classId, $sessionId, $branchId, $clientCode]
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
                            $db->execute("UPDATE ssms_fee_structure SET fee_amount=? WHERE fee_id=?", [$amount, $existing[$fid][$m]]);
                        } else {
                            $mo      = self::MONTH_NUM[$m];
                            $y       = in_array($m, ['Jan','Feb','Mar']) ? $year + 1 : $year;
                            $dueDate = sprintf('%04d-%s-01', $y, $mo);
                            $db->execute(
                                "INSERT INTO ssms_fee_structure (fee_item_id, fee_amount, due_date, class_id, session_id, branch_id, month_no, ssms_client_code) VALUES (?,?,?,?,?,?,?,?)",
                                [$fid, $amount, $dueDate, $classId, $sessionId, $branchId, $m, $clientCode]
                            );
                        }
                    }
                } else {
                    $bucket = $isMandatory ? 'oneTimeMandatory' : 'oneTimeOptional';
                    $amount = (float)($amounts[$bucket][$fid] ?? 0);
                    if ($amount <= 0) continue;
                    if (isset($existing[$fid]['Apr'])) {
                        $db->execute("UPDATE ssms_fee_structure SET fee_amount=? WHERE fee_id=?", [$amount, $existing[$fid]['Apr']]);
                    } else {
                        $db->execute(
                            "INSERT INTO ssms_fee_structure (fee_item_id, fee_amount, due_date, class_id, session_id, branch_id, month_no, ssms_client_code) VALUES (?,?,CURDATE(),?,?,?,'Apr',?)",
                            [$fid, $amount, $classId, $sessionId, $branchId, $clientCode]
                        );
                    }
                }
            }
            $db->commit();
            $this->Flash->success('Transport fee structure saved successfully.');
        } catch (\Exception $e) {
            $db->rollback();
            Log::error('TransportFeeStructure save error: ' . $e->getMessage());
            $this->Flash->error('Save failed: ' . $e->getMessage());
        }
    }
}
