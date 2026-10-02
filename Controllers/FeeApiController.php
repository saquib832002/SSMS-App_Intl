<?php
declare(strict_types=1);

namespace App\Controller;
use App\Controller\Traits\FinAutoPostTrait;
use Cake\Datasource\ConnectionManager;
use Cake\I18n\Date;

use Cake\Routing\Router;
use Cake\Filesystem\Folder;
use Psr\Http\Message\UploadedFileInterface;
use Authentication\Middleware\AuthenticationMiddleware;
use Cake\Http\Exception\BadRequestException;
use Cake\Utility\Text;
use Cake\Database\Expression\QueryExpression;
use Cake\Log\Log;
use Cake\Mailer\Mailer;
use Cake\I18n\DateTime;

/**
 * SaweraSsmsUsers Controller
 *
 * @property \App\Model\Table\SaweraSsmsUsersTable $SaweraSsmsUsers
 */
class FeeApiController extends AppController
{
    use FinAutoPostTrait;
	 public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
		  // Allow login without authentication
    	//$this->Authentication->allowUnauthenticated(['getFeeItems','createFeeItem','updateFeeItem','deactivateFeeItem','deleteFeeItem',
         //    'getClassFeeStructure','saveClassFeeStructure','getDueFees','collecFee','fetchStudentFeeDue','payStudentFees','sendReceiptEmail','getDemandSlip','getPendingCollections','approveCollections']);
    }
    public function createFeeItem()
        {
            $this->request->allowMethod(['post']);
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $data = $this->request->getData();

            $FeeItemsTable = $this->fetchTable('SsmsFeeItems');

            $mapped = [
                'fee_item_name' => $data['feeName'] ?? null,
                'fee_code' => $data['feeCode'] ?? null,
                'fee_type' => $data['feeType'] ?? null,
                'category' => $data['category'] ?? null,
                'is_mandatory' => $data['isMandatory'] ?? 'Yes',
                'status' => $data['status'] ?? 'Active',
                'tax_percent'   => isset($data['tax_percent'])   ? (float)$data['tax_percent']  : 0.00,
                'tax_inclusive' => isset($data['tax_inclusive']) ? (int)$data['tax_inclusive']  : 0,
                'ssms_client_code' => $clientCode,
            ];

            $entity = $FeeItemsTable->newEntity($mapped);

            if ($entity->hasErrors()) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(422)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Validation failed',
                        'errors' => $entity->getErrors(),
                    ]));
            }

            if ($FeeItemsTable->save($entity)) {
                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode([
                        'status' => true,
                        'message' => 'Fee item created successfully',
                        'data' => $entity,
                    ]));
            }

            return $this->response
                ->withType('application/json')
                ->withStatus(500)
                ->withStringBody(json_encode([
                    'status' => false,
                    'message' => 'Failed to create fee item',
                ]));
        }
    
   
    public function saveClassFeeStructure()
        {
            $this->request->allowMethod(['post']);
            
            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $data = $this->request->getData();
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            $filters = $data['filters'] ?? [];
            $sessionId = $filters['sessionId'] ?? null;
            $branchId = $filters['branchId'] ?? null;
            $classId = $filters['classId'] ?? null;

            if (empty($sessionId) || empty($branchId) || empty($classId)) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(422)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Session, branch and class are required',
                    ]));
            }

            $FeeStructureTable = $this->fetchTable('SsmsFeeStructure');
            $connection = $FeeStructureTable->getConnection();

            $oneTimeMandatoryFees = $data['oneTimeMandatoryFees'] ?? [];
            $oneTimeOptionalFees = $data['oneTimeOptionalFees'] ?? [];
            $monthlyMandatoryFees = $data['monthlyMandatoryFees'] ?? [];
            $monthlyOptionalFees = $data['monthlyOptionalFees'] ?? [];

            try {
                $connection->begin();

                foreach ($oneTimeMandatoryFees as $fee) {
                    $this->upsertFeeStructureRow($FeeStructureTable, [
                        'feeId' => $fee['feeId'] ?? null,
                        'fee_item_id' => $fee['feeItemId'] ?? null,
                        'fee_amount' => $fee['amount'] ?? '',
                        'due_date' => date('Y-m-d'),
                        'class_id' => $classId,
                        'session_id' => $sessionId,
                        'branch_id' => $branchId,
                        'month_no' => 'Apr',
                        'ssms_client_code' => $clientCode,
                        'status' => 'Active',
                    ]);
                }

                foreach ($oneTimeOptionalFees as $fee) {
                    $this->upsertFeeStructureRow($FeeStructureTable, [
                        'feeId' => $fee['feeId'] ?? null,
                        'fee_item_id' => $fee['feeItemId'] ?? null,
                        'fee_amount' => $fee['amount'] ?? '',
                        'due_date' => date('Y-m-d'),
                        'class_id' => $classId,
                        'session_id' => $sessionId,
                        'branch_id' => $branchId,
                        'month_no' => 'Apr',
                        'ssms_client_code' => $clientCode,
                        'status' => 'Active',
                    ]);
                }

                foreach ($monthlyMandatoryFees as $fee) {
                    foreach (($fee['months'] ?? []) as $monthName => $details) {
                        $this->upsertFeeStructureRow($FeeStructureTable, [
                            'feeId' => $details['feeId'] ?? null,
                            'fee_item_id' => $fee['feeItemId'] ?? $fee['id'] ?? null,
                            'fee_amount' => $details['amount'] ?? '',
                            'due_date' => $this->getDueDateFromMonth($monthName),
                            'class_id' => $classId,
                            'session_id' => $sessionId,
                            'branch_id' => $branchId,
                            'month_no' => $monthName,
                            'ssms_client_code' => $clientCode,
                            'status' => 'Active',
                        ]);
                    }
                }

                foreach ($monthlyOptionalFees as $fee) {
                    foreach (($fee['months'] ?? []) as $monthName => $details) {
                        $this->upsertFeeStructureRow($FeeStructureTable, [
                            'feeId' => $details['feeId'] ?? null,
                            'fee_item_id' => $fee['feeItemId'] ?? $fee['id'] ?? null,
                            'fee_amount' => $details['amount'] ?? '',
                            'due_date' => $this->getDueDateFromMonth($monthName),
                            'class_id' => $classId,
                            'session_id' => $sessionId,
                            'branch_id' => $branchId,
                            'month_no' => $monthName,
                            'ssms_client_code' => $clientCode,
                            'status' => 'Active',
                        ]);
                    }
                }

                $connection->commit();

                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode([
                        'status' => true,
                        'message' => 'Fee structure saved successfully',
                    ]));
            } catch (\Throwable $e) {
                $connection->rollback();

                return $this->response
                    ->withType('application/json')
                    ->withStatus(500)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => $e->getMessage(),
                    ]));
            }
        }
    public function getClassFeeStructure()
        {
            $this->request->allowMethod(['get']);
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $sessionId = $this->request->getQuery('sessionId');
            $branchId = $this->request->getQuery('branchId');
            $classId = $this->request->getQuery('classId');

            $FeeStructureTable = $this->fetchTable('SsmsFeeStructure');

            $conditions = [
                'SsmsFeeStructure.ssms_client_code' => $clientCode,
            ];

            if (!empty($sessionId)) {
                $conditions['SsmsFeeStructure.session_id'] = $sessionId;
            }
            if (!empty($branchId)) {
                $conditions['SsmsFeeStructure.branch_id'] = $branchId;
            }
            if (!empty($classId)) {
                $conditions['SsmsFeeStructure.class_id'] = $classId;
            }

            $rows = $FeeStructureTable->find()
                ->select([
                    'fee_id' => 'SsmsFeeStructure.fee_id',
                    'fee_item_id' => 'SsmsFeeStructure.fee_item_id',
                    'fee_amount' => 'SsmsFeeStructure.fee_amount',
                    'due_date' => 'SsmsFeeStructure.due_date',
                    'class_id' => 'SsmsFeeStructure.class_id',
                    'session_id' => 'SsmsFeeStructure.session_id',
                    'branch_id' => 'SsmsFeeStructure.branch_id',
                    'month_no' => 'SsmsFeeStructure.month_no',
                    'ssms_client_code' => 'SsmsFeeStructure.ssms_client_code',
                    'fee_item_name' => 'SsmsFeeItems.fee_item_name',
                    'fee_type' => 'SsmsFeeItems.fee_type',
                    'is_mandatory' => 'SsmsFeeItems.is_mandatory',
                ])
                ->leftJoin(
                    ['SsmsFeeItems' => 'ssms_fee_items'],
                    ['SsmsFeeItems.fee_item_id = SsmsFeeStructure.fee_item_id']
                )
                ->where($conditions)
                ->orderBy([
                    'SsmsFeeItems.fee_type' => 'ASC',
                    'SsmsFeeItems.fee_item_name' => 'ASC',
                    'SsmsFeeStructure.month_no' => 'ASC',
                ])
                ->enableHydration(false)
                ->toArray();

            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status' => true,
                    'data' => $rows,
                ]));
        }
   private function upsertFeeStructureRow($FeeStructureTable, array $row): void
        {
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            $feeId = $row['feeId'] ?? null;
            $amount = $row['fee_amount'] ?? '';

            unset($row['feeId']);

            if (!empty($feeId)) {
                $existing = $FeeStructureTable->find()
                    ->where(['fee_id' => $feeId])
                    ->first();

                if ($existing) {
                    if ($amount === '' || $amount === null) {
                        $existing->status = 'Inactive';
                        $FeeStructureTable->saveOrFail($existing);
                        return;
                    }

                    $existing = $FeeStructureTable->patchEntity($existing, $row);
                    $FeeStructureTable->saveOrFail($existing);
                    return;
                }
            }

            if ($amount === '' || $amount === null) {
                return;
            }

            $duplicate = $FeeStructureTable->find()
                ->where([
                    'fee_item_id' => $row['fee_item_id'],
                    'class_id' => $row['class_id'],
                    'session_id' => $row['session_id'],
                    'branch_id' => $row['branch_id'],
                    'month_no IS' => $row['month_no'],
                    'ssms_client_code' => $row['ssms_client_code'],
                ])
                ->first();

            if ($duplicate) {
                $duplicate = $FeeStructureTable->patchEntity($duplicate, $row);
                $FeeStructureTable->saveOrFail($duplicate);
                return;
            }

            $entity = $FeeStructureTable->newEntity($row);
            $FeeStructureTable->saveOrFail($entity);
        }

    
    private function getDueDateFromMonth(string $monthName): string
        {
            $currentYear = (int)date('Y');

            $monthMap = [
                'Apr' => '04',
                'May' => '05',
                'Jun' => '06',
                'Jul' => '07',
                'Aug' => '08',
                'Sep' => '09',
                'Oct' => '10',
                'Nov' => '11',
                'Dec' => '12',
                'Jan' => '01',
                'Feb' => '02',
                'Mar' => '03',
            ];

            $monthNumber = $monthMap[$monthName] ?? '04';

            $year = in_array($monthName, ['Jan', 'Feb', 'Mar'], true)
                ? $currentYear + 1
                : $currentYear;

            return sprintf('%04d-%s-01', $year, $monthNumber);
        }
    public function updateFeeItem($id)
        {
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to do this operation.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $data = $this->request->getData();

            $FeeItemsTable = $this->fetchTable('SsmsFeeItems');

            $entity = $FeeItemsTable->find()
                ->where([
                    'fee_item_id' => $id,
                    'ssms_client_code' => $clientCode,
                ])
                ->first();

            if (!$entity) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(404)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Fee item not found',
                    ]));
            }

            $mapped = [
                'fee_item_name' => $data['feeName'] ?? $entity->fee_item_name,
                'fee_code' => $data['feeCode'] ?? $entity->fee_code,
                'fee_type' => $data['feeType'] ?? $entity->fee_type,
                'category' => $data['category'] ?? $entity->category,
                'is_mandatory' => $data['isMandatory'] ?? $entity->is_mandatory,
                'status' => $data['status'] ?? $entity->status,
                'tax_percent'   => isset($data['tax_percent'])   ? (float)$data['tax_percent']  : (float)($entity->tax_percent ?? 0),
                'tax_inclusive' => isset($data['tax_inclusive']) ? (int)$data['tax_inclusive']  : (int)($entity->tax_inclusive ?? 0),
            ];

            $entity = $FeeItemsTable->patchEntity($entity, $mapped);

            if ($entity->hasErrors()) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(422)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Validation failed',
                        'errors' => $entity->getErrors(),
                    ]));
            }

            if ($FeeItemsTable->save($entity)) {
                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode([
                        'status' => true,
                        'message' => 'Fee item updated successfully',
                        'data' => $entity,
                    ]));
            }

            return $this->response
                ->withType('application/json')
                ->withStatus(500)
                ->withStringBody(json_encode([
                    'status' => false,
                    'message' => 'Failed to update fee item',
                ]));
        }
    
    public function deactivateFeeItem($id)
        {
            $this->request->allowMethod(['patch']);
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to do this operation.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $userRole = $this->request->getHeaderLine('ssmsUserRole');

            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(403)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Only admin, owner or accountant can deactivate fee items',
                    ]));
            }

            $FeeItemsTable = $this->fetchTable('SsmsFeeItems');

            $entity = $FeeItemsTable->find()
                ->where([
                    'fee_item_id' => $id,
                    'ssms_client_code' => $clientCode,
                ])
                ->first();

            if (!$entity) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(404)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Fee item not found',
                    ]));
            }

            $entity = $FeeItemsTable->patchEntity($entity, [
                'status' => 'Inactive',
            ]);

            if ($FeeItemsTable->save($entity)) {
                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode([
                        'status' => true,
                        'message' => 'Fee item deactivated successfully',
                    ]));
            }

            return $this->response
                ->withType('application/json')
                ->withStatus(500)
                ->withStringBody(json_encode([
                    'status' => false,
                    'message' => 'Failed to deactivate fee item',
                ]));
        }
    
    public function deleteFeeItem($id)
        {
            $this->request->allowMethod(['delete']);
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to do this operation.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $userRole = $this->request->getHeaderLine('ssmsUserRole');

            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(403)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Only admin, owner or accountant can delete fee items',
                    ]));
            }

            $FeeItemsTable = $this->fetchTable('SsmsFeeItems');
            $FeeItemsInFeeStructureTable = $this->fetchTable('SsmsFeeStructure');


            $entity = $FeeItemsTable->find()
                ->where([
                    'fee_item_id' => $id,
                    'ssms_client_code' => $clientCode,
                ])
                ->first();
        $feeStructureEntity = $FeeItemsInFeeStructureTable->find()
                ->where([
                    'fee_item_id' => $id,
                    'ssms_client_code' => $clientCode,
                ])
                ->first();

            if (!$entity) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(404)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Fee item not found',
                    ]));
            }
        
         if ($feeStructureEntity) {
                return $this->response
                    ->withType('application/json')
                    ->withStatus(403)
                    ->withStringBody(json_encode([
                        'status' => false,
                        'message' => 'Fee iten can not be deleted as its its being used.',
                    ]));
            }

            if ($FeeItemsTable->delete($entity)) {
                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode([
                        'status' => true,
                        'message' => 'Fee item deleted successfully',
                    ]));
            }

            return $this->response
                ->withType('application/json')
                ->withStatus(500)
                ->withStringBody(json_encode([
                    'status' => false,
                    'message' => 'Failed to delete fee item',
                ]));
        }
    
    public function getFeeItems()
        {
            $this->request->allowMethod(['get']);

            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to do this operation.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
            // Optional category filter — e.g. "Academic" or "Hostel"
            $category = trim((string)($this->request->getQuery('category') ?? ''));
            //Log::error("category: ". $category);
            $FeeItemsTable = $this->fetchTable('SsmsFeeItems');

            $conditions = ['ssms_client_code' => $clientCode];
            if ($category !== '') {
                $conditions['category'] = $category;
            }

            $items = $FeeItemsTable->find()
                ->select([
                    'fee_item_id',
                    'fee_item_name',
                    'fee_code',
                    'fee_type',
                    'category',
                    'is_mandatory',
                    'status',
                    'tax_percent',
                    'tax_inclusive',
                ])
                ->where($conditions)
                ->orderBy([
                    'fee_item_name' => 'ASC'
                ])
                ->enableHydration(false)
                ->toArray();

            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status' => true,
                    'data'   => $items,
                ]));
        }
    

 // ── GET /api/fee-records(?enrollment_id=X) ────────────────────────────────
    public function index(): void
    {
        $this->request->allowMethod(['get']);
        $table = $this->getTableLocator()->get('SsmsFeePaidDetails');
        $query = $table->find();
 
        // Student-scoped filter (primary use-case for this screen)
        if ($enrollmentId = $this->request->getQuery('enrollment_id')) {
            $query->where(['enrollment_id' => (int)$enrollmentId]);
        }
 
        // Additional optional filters
        foreach (['branch_id','class_id','session_id','fee_id','admin_review','ssms_user_name'] as $f) {
            if ($v = $this->request->getQuery($f)) {
                $query->where(["SsmsFeePaidDetails.{$f}" => $v]);
            }
        }
 
        // Date range
        if ($from = $this->request->getQuery('from')) $query->where(['fee_paid_date >=' => $from]);
        if ($to   = $this->request->getQuery('to'))   $query->where(['fee_paid_date <=' => $to]);
 
        $records = $query->orderDesc('trxn_id')->toArray();
 
        // Split paid / unpaid so the app can also use the raw list
        $unpaid  = array_values(array_filter($records, fn($r) => (float)$r->balance_amount > 0));
        $paid    = array_values(array_filter($records, fn($r) => (float)$r->balance_amount <= 0));
 
        $this->set([
            'success' => true,
            'data'    => $records,
            'unpaid'  => $unpaid,
            'paid'    => $paid,
            'summary' => [
                'total_billed'   => array_sum(array_column($records, 'fee_amount')),
                'total_paid'     => array_sum(array_column($records, 'paid_amount')),
                'total_balance'  => array_sum(array_column($records, 'balance_amount')),
                'total_late_fee' => array_sum(array_column($records, 'late_fee')),
                'count'          => count($records),
            ],
        ]);
        $this->viewBuilder()->setOption('serialize', ['success', 'data', 'unpaid', 'paid', 'summary']);
    }
 
    // ── GET /api/fee-records/:id ──────────────────────────────────────────────
    public function view(int $id): void
    {
        $this->request->allowMethod(['get']);
        $rec = $this->getTableLocator()->get('SsmsFeePaidDetails')
            ->find()->where(['trxn_id' => $id])->first();
 
        if (!$rec) { $this->notFound(); return; }
 
        $this->set(['success' => true, 'data' => $rec]);
        $this->viewBuilder()->setOption('serialize', ['success', 'data']);
    }
 
    // ── POST /api/fee-records ─────────────────────────────────────────────────
    public function add(): void
    {
        $this->request->allowMethod(['post']);
        $data = $this->request->getData();
 
        if ($errs = $this->validateFeeData($data, true)) {
            $this->unprocessable($errs); return;
        }
 
        $table  = $this->getTableLocator()->get('SsmsFeePaidDetails');
        $entity = $table->newEntity($this->sanitize($data));
        $entity->balance_amount = $this->calcBalance($entity->fee_amount, $entity->paid_amount, $entity->late_fee ?? 0);
 
        if (!$table->save($entity)) {
            $this->serverError($entity->getErrors()); return;
        }
 
        $this->response = $this->response->withStatus(201);
        $this->set(['success' => true, 'message' => 'Fee record created.', 'data' => $entity]);
        $this->viewBuilder()->setOption('serialize', ['success', 'message', 'data']);
    }
 
    // ── PUT /api/fee-records/:id ──────────────────────────────────────────────
    public function edit(int $id): void
    {
        $this->request->allowMethod(['put', 'patch']);
        $table  = $this->getTableLocator()->get('SsmsFeePaidDetails');
        $entity = $table->find()->where(['trxn_id' => $id])->first();
 
        if (!$entity) { $this->notFound(); return; }
 
        $data = $this->request->getData();
        if ($errs = $this->validateFeeData($data, false)) {
            $this->unprocessable($errs); return;
        }
 
        $table->patchEntity($entity, $this->sanitize($data));
        $entity->balance_amount = $this->calcBalance($entity->fee_amount, $entity->paid_amount, $entity->late_fee ?? 0);
 
        if (!$table->save($entity)) {
            $this->serverError($entity->getErrors()); return;
        }
 
        $this->set(['success' => true, 'message' => 'Record updated.', 'data' => $entity]);
        $this->viewBuilder()->setOption('serialize', ['success', 'message', 'data']);
    }
 
    // ── PATCH /api/fee-records/:id/collect ───────────────────────────────────
    /**
     * Dedicated "collect payment" action.
     *
     * Body params:
     *   paid_amount    float  — amount being collected NOW (added to existing paid_amount)
     *   payment_date   string — date of this payment
     *   fee_paid_date  string — date fee was received
     *   receipt_number string — receipt for this payment (updates the record)
     *   admin_review   string — new review status
     *   admin_user     string — admin collecting
     *
     * Server enforces:
     *   - paid_amount > 0
     *   - new total paid ≤ fee_amount + late_fee
     *   - balance auto-recalculated
     *   - admin_review_date stamped automatically
     */
    //public function collect(int $id): void
    //{
    //    $this->request->allowMethod(['patch']);
    //    $table  = $this->getTableLocator()->get('SsmsFeePaidDetails');
    //    $entity = $table->find()->where(['trxn_id' => $id])->first();
 //
    //    if (!$entity) { $this->notFound(); return; }
 //
    //    $data       = $this->request->getData();
    //    $newPayment = (float)($data['paid_amount'] ?? 0);
 //
    //    if ($newPayment <= 0) {
    //        $this->unprocessable(['paid_amount' => 'Payment amount must be greater than zero.']); return;
    //    }
 //
    //    $maxAllowed = (float)$entity->fee_amount + (float)($entity->late_fee ?? 0);
    //    $newTotal   = (float)$entity->paid_amount + $newPayment;
 //
    //    if ($newTotal > $maxAllowed) {
    //        $this->unprocessable(['paid_amount' => sprintf(
    //            'Total paid (₹%.2f) would exceed total billed (₹%.2f).',
    //            $newTotal, $maxAllowed
    //        )]); return;
    //    }
 //
    //    $today = FrozenTime::now()->toDateString();
 //
    //    $entity->paid_amount      = round($newTotal, 2);
    //    $entity->balance_amount   = $this->calcBalance((float)$entity->fee_amount, $newTotal, (float)($entity->late_fee ?? 0));
    //    $entity->payment_date     = $data['payment_date']    ?? $today;
    //    $entity->fee_paid_date    = $data['fee_paid_date']   ?? $today;
    //    $entity->admin_review     = $data['admin_review']    ?? 'Approved';
    //    $entity->admin_user       = $data['admin_user']      ?? '';
    //    $entity->admin_review_date = $today;
 //
    //    // Update receipt number if provided
    //    if (!empty($data['receipt_number'])) {
    //        $entity->receipt_number = $data['receipt_number'];
    //    }
 //
    //    if (!$table->save($entity)) {
    //        $this->serverError($entity->getErrors()); return;
    //    }
 //
    //    $this->set([
    //        'success'      => true,
    //        'message'      => sprintf('Payment of ₹%.2f collected. New balance: ₹%.2f', $newPayment, $entity->balance_amount),
    //        'data'         => $entity,
    //        'payment_collected' => $newPayment,
    //        'new_balance'  => $entity->balance_amount,
    //        'fully_paid'   => $entity->balance_amount <= 0,
    //    ]);
    //    $this->viewBuilder()->setOption('serialize', ['success', 'message', 'data', 'payment_collected', 'new_balance', 'fully_paid']);
    //}
 
    // ── DELETE /api/fee-records/:id ───────────────────────────────────────────
    public function delete(int $id): void
    {
        $this->request->allowMethod(['delete']);
        $table  = $this->getTableLocator()->get('SsmsFeePaidDetails');
        $entity = $table->find()->where(['trxn_id' => $id])->first();
 
        if (!$entity) { $this->notFound(); return; }
 
        if (!$table->delete($entity)) {
            $this->serverError([]); return;
        }
 
        $this->set(['success' => true, 'message' => 'Record deleted.']);
        $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    }
 
    // ── Private helpers ───────────────────────────────────────────────────────
 
    private function calcBalance(float $fee, float $paid, float $late = 0): float
    {
        return max(0.0, round($fee + $late - $paid, 2));
    }
 
    private function validateFeeData(array $data, bool $isNew): array
    {
        $errs = [];
        if ($isNew && empty(trim((string)($data['receipt_number'] ?? '')))) {
            $errs['receipt_number'] = 'Receipt number is required.';
        }
        if (!is_numeric($data['fee_amount'] ?? '')) {
            $errs['fee_amount'] = 'A valid fee amount is required.';
        }
        if (!isset($data['paid_amount']) || !is_numeric($data['paid_amount'])) {
            $errs['paid_amount'] = 'A valid paid amount is required.';
        }
        return $errs;
    }
 
    private function sanitize(array $d): array
    {
        $today = DateTime::now()->toDateString();
        return [
            'receipt_number'    => trim((string)($d['receipt_number']    ?? '')),
            'fee_amount'        => (float)($d['fee_amount']              ?? 0),
            'late_fee'          => (float)($d['late_fee']                ?? 0),
            'paid_amount'       => (float)($d['paid_amount']             ?? 0),
            'fee_paid_date'     => $d['fee_paid_date']   ?? $today,
            'payment_date'      => $d['payment_date']    ?? $today,
            'admin_review'      => in_array($d['admin_review'] ?? '', ['Pending','Approved','Rejected','Under Review'])
                                    ? $d['admin_review'] : 'Pending',
            'admin_user'        => trim((string)($d['admin_user']        ?? '')),
            'admin_review_date' => !empty($d['admin_review_date']) ? $d['admin_review_date'] : null,
            'ssms_client_code'  => trim((string)($d['ssms_client_code']  ?? '')),
            'session_id'        => !empty($d['session_id'])      ? (int)$d['session_id']      : null,
            'class_id'          => !empty($d['class_id'])        ? (int)$d['class_id']        : null,
            'branch_id'         => !empty($d['branch_id'])       ? (int)$d['branch_id']       : null,
            'enrollment_id'     => !empty($d['enrollment_id'])   ? (int)$d['enrollment_id']   : null,
            'registration_id'   => !empty($d['registration_id']) ? (int)$d['registration_id'] : null,
            'fee_item_id'       => !empty($d['fee_item_id'])     ? (int)$d['fee_item_id']     : null,
            'fee_id'            => !empty($d['fee_id'])          ? (int)$d['fee_id']          : null,
            'enrolled'          => isset($d['enrolled'])         ? (int)$d['enrolled']        : 1,
            'ssms_user_name'    => trim((string)($d['ssms_user_name']    ?? '')),
        ];
    }
 
    // ── Generic response helpers ──────────────────────────────────────────────
 
    private function notFound(): void
    {
        $this->response = $this->response->withStatus(404);
        $this->set(['success' => false, 'message' => 'Record not found.']);
        $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    }
 
    private function unprocessable(array $errors): void
    {
        $this->response = $this->response->withStatus(422);
        $this->set(['success' => false, 'message' => 'Validation failed.', 'errors' => $errors]);
        $this->viewBuilder()->setOption('serialize', ['success', 'message', 'errors']);
    }
 
    private function serverError(array $errors): void
    {
        $this->response = $this->response->withStatus(500);
        $this->set(['success' => false, 'message' => 'Database operation failed.', 'errors' => $errors]);
        $this->viewBuilder()->setOption('serialize', ['success', 'message', 'errors']);
    }
    
    public function getDueFees($enrollmentId = null)
{
    $this->request->allowMethod(['get']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');

    $FeePaidTable = $this->fetchTable('SsmsFeePaidDetails');

    $today = date('Y-m-d');

    $fees = $FeePaidTable->find()
        ->select([
            'trxn_id',
            'fee_id',
            'fee_item_id',
            'fee_amount',
            'balance_amount',
            'SsmsFeeStructure.due_date',
            'SsmsFeeStructure.month_no',
            'fee_item_name' => 'SsmsFeeItems.fee_item_name',
        ])
        ->leftJoin(
            ['SsmsFeeStructure' => 'ssms_fee_structure'],
            ['SsmsFeeStructure.fee_id = SsmsFeePaidDetails.fee_id']
        )
        ->leftJoin(
            ['SsmsFeeItems' => 'ssms_fee_items'],
            ['SsmsFeeItems.fee_item_id = SsmsFeePaidDetails.fee_item_id']
        )
        ->where([
            'SsmsFeePaidDetails.enrollment_id' => $enrollmentId,
            'SsmsFeePaidDetails.ssms_client_code' => $clientCode,
            'SsmsFeePaidDetails.balance_amount >' => 0,
            'SsmsFeeStructure.due_date <=' => $today,
        ])
        ->order([
            'SsmsFeeStructure.due_date' => 'ASC',
        ])
        ->enableHydration(false)
        ->toArray();

    return $this->response
        ->withType('application/json')
        ->withStringBody(json_encode([
            'status' => true,
            'data' => $fees,
        ]));
}

    
//public function collectFee()
//        {
//            $this->request->allowMethod(['post']);
//            $data = $this->request->getData();
//            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
//            $feeIds = $data['feeIds'] ?? [];
//            $lateFee = (float)($data['lateFee'] ?? 0);
//            $discount = (float)($data['discount'] ?? 0);
//            $FeePaidTable = $this->fetchTable('SsmsFeePaidDetails');
//
//            foreach ($feeIds as $feePaidId) {
//                $entity = $FeePaidTable->find()
//                    ->where([
//                        'trxn_id' => $feePaidId,
//                        'ssms_client_code' => $clientCode,
//                    ])
//                    ->first();
//
//                if ($entity) {
//                    $entity = $FeePaidTable->patchEntity($entity, [
//                        'paid_amount' => $entity->balance_amount,
//                        'balance_amount' => 0,
//                        'late_fee' => $lateFee,
//                        'discount_amount' => $discount,
//                        'receipt_number' => 'RCPT' . time(),
//                        'fee_paid_date' => date('Y-m-d'),
//                        'payment_status' => 'Paid',
//                    ]);
//
//                    $FeePaidTable->save($entity);
//                }
//            }
//
//            return $this->response
//                ->withType('application/json')
//                ->withStringBody(json_encode([
//                    'status' => true,
//                    'message' => 'Fee collected successfully',
//                ]));
//        }
    
    
     public function fetchStudentFeeDue($enrollmentId): void
    {
        $this->request->allowMethod(['get']);
        $userRole   = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
        $userName   = $this->request->getHeaderLine('ssmsUserName');

        $isAdmin    = in_array($userRole, ['admin', 'owner', 'accountant']);
        $isStudent  = in_array($userRole, ['student', 'parent']);

        // Students and parents may only fetch their own enrollment data.
        if (!$isAdmin && !$isStudent) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to do this operation.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        // Students are restricted to their own enrollment ID (= their username).
        // Parents are exempt from this check — their username is their mobile/login,
        // not an enrollment ID. They are authenticated via JWT and may view their children's data.
        if ($isStudent && $userRole !== 'parent' && strtolower(trim($enrollmentId)) !== strtolower(trim($userName))) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You can only view your own fee details.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
        $db         = $this->getTableLocator()->get('SsmsFeePaidDetails')->getConnection();
        $classId    = $this->request->getQuery('class_id');
        $sessionId  = $this->request->getQuery('session_id');
        $branchId   = $this->request->getQuery('branch_id');
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $category = $this->request->getQuery('category');
       //  Log::error("category received in fetchStudentHostelFeeDue :". $category);
        //          Log::error("category received in $classId :". $classId);

        // ── 1. DUE FEES ──────────────────────────────────────────────────────
        //
        // Drive from ssms_fee_structure — the master list of all fee items.
        // LEFT JOIN an aggregate of actual payments made so balance is always live:
        //
        //   balance_due = fs.fee_amount − SUM(paid_amount for this enrollment)
        //
        // If NO payment rows exist at all for the enrollment, COALESCE returns 0
        // so balance_due = full fee_amount — the student owes everything.
        // ─────────────────────────────────────────────────────────────────────
        $today = date('Y-m-d');
        $dueQuery = "
            SELECT
                fs.fee_id,
                fs.fee_item_id,
                fs.month_no,
                fs.due_date,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fs.fee_item_id))
                    AS fee_item_name,
                fs.fee_amount,
                sc.class_id,
                sc.class_name,
                fs.session_id,
                COALESCE(ss.session_name, CONCAT('Session ', fs.session_id)) AS session_name,
                fs.branch_id,
                COALESCE(sb.branch_name,  CONCAT('Branch ',  fs.branch_id))  AS branch_name,
                fs.ssms_client_code,

                -- Total already paid by this enrollment for this fee item
                COALESCE(paid_agg.total_fee_paid, 0)            AS total_fee_paid,

                -- Discount for this student on this fee item in this session
                COALESCE(sd.discount_percent, 0)            AS discount_percent,
                (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END) AS discount_amount,
                COALESCE(sd.reason,          '')            AS discount_reason,

                -- Tax: rate from fee_items, computed on discounted amount
                COALESCE(fi.tax_percent, 0)                 AS tax_percent,
                COALESCE(fi.tax_inclusive, 0)               AS tax_inclusive,
                -- Full tax on discounted base
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    * COALESCE(fi.tax_percent, 0) / 100,
                2)                                          AS full_tax_amount,
                -- Prorated remaining tax = full_tax * (balance_due / net_fee)
                -- When no partial payment, this equals full_tax_amount
                CASE
                  WHEN COALESCE(paid_agg.total_fee_paid, 0) = 0
                    THEN ROUND(
                           (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                           * COALESCE(fi.tax_percent, 0) / 100, 2)
                  ELSE ROUND(
                         ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                               * COALESCE(fi.tax_percent, 0) / 100, 2)
                         * GREATEST(0,
                             (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                             + ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                                     * COALESCE(fi.tax_percent, 0) / 100, 2)
                             - COALESCE(paid_agg.total_fee_paid, 0))
                         / NULLIF(
                             (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                             + ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                                     * COALESCE(fi.tax_percent, 0) / 100, 2), 0)
                       , 2)
                END                                         AS tax_amount,

                -- Net fee = (base - discount) + tax_on_discounted
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    + ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        * COALESCE(fi.tax_percent, 0) / 100, 2),
                2)                                          AS net_fee_amount,

                -- Balance = net_fee - cash_paid
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    + ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        * COALESCE(fi.tax_percent, 0) / 100, 2)
                    - COALESCE(paid_agg.total_fee_paid, 0),
                2)                                          AS balance_due,

                -- Latest trxn / receipt for UI reference (NULL if no payments yet)
                paid_agg.latest_trxn_id                     AS trxn_id,
                paid_agg.latest_receipt                     AS receipt_number

            FROM ssms_fee_structure fs

            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fs.fee_item_id
                AND fi.category = 'Academic'
                AND fs.due_date < :dueDate

            LEFT JOIN ssms_classes sc
                ON  sc.class_id = fs.class_id

            LEFT JOIN ssms_sessions ss
                ON  ss.session_id = fs.session_id

            LEFT JOIN ssms_branch sb
                ON  sb.branch_id = fs.branch_id

            -- Aggregate all payments this enrollment has made per fee item.
            -- This is a LEFT JOIN so rows with zero payments still appear.
            -- Use paid_amount - late_fee = actual fee cash paid (works for old+new rows)
            LEFT JOIN (
                SELECT
                    fp.fee_id,
                    fp.fee_item_id,
                    SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) AS total_fee_paid,
                    SUM(fp.late_fee)                               AS late_fee_paid,
                    MAX(fp.trxn_id)                                AS latest_trxn_id,
                    MAX(fp.receipt_number)                         AS latest_receipt
                FROM ssms_fee_paid_details fp
                WHERE fp.enrollment_id = :enrollment_id_agg
                  AND fp.receipt_number != ''
                  AND fp.paid_amount > 0
                GROUP BY fp.fee_id, fp.fee_item_id
            ) paid_agg
                ON  paid_agg.fee_id      = fs.fee_id
                AND paid_agg.fee_item_id = fs.fee_item_id

            -- Discount: one row per student+fee_item+session
            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :enrollment_id_disc
                AND sd.fee_item_id      = fs.fee_item_id
                AND sd.session_id       = fs.session_id
                AND sd.ssms_client_code = fs.ssms_client_code

            INNER JOIN ssms_student_enrollment enr
                ON  enr.class_id      = fs.class_id
                AND enr.session_id    = fs.session_id
                AND fi.category       = 'Academic'
                AND enr.enrollment_id = :enrollment_id_enr

            WHERE 1=1
        ";

        $dueParams = [
            'enrollment_id_agg'  => $enrollmentId,
            'enrollment_id_enr'  => $enrollmentId,
            'enrollment_id_disc' => $enrollmentId,
            'dueDate'            => $today,
        ];

        if (!empty($classId)) {
            $dueQuery .= " AND fs.class_id = :class_id";
            $dueParams['class_id'] = (int)$classId;
        }
        if (!empty($sessionId)) {
            $dueQuery .= " AND fs.session_id = :session_id";
            $dueParams['session_id'] = (int)$sessionId;
        }
        if (!empty($branchId)) {
            $dueQuery .= " AND fs.branch_id = :branch_id";
            $dueParams['branch_id'] = (int)$branchId;
        }
        if (!empty($clientCode)) {
            $dueQuery .= " AND fs.ssms_client_code = :ssms_client_code";
            $dueParams['ssms_client_code'] = $clientCode;
        }

        // Only return items where balance is still outstanding
        $dueQuery .= "
            HAVING balance_due > 0
            ORDER BY fs.due_date ASC, fs.fee_item_id ASC
        ";

        $dueItems = $db->execute($dueQuery, $dueParams)->fetchAll('assoc');
        foreach ($dueItems as $di) {
            \Cake\Log\Log::debug("DUE: " . ($di['fee_item_name'] ?? '') .
                " disc=" . ($di['discount_amount'] ?? 'MISSING') .
                " net=" . ($di['net_fee_amount'] ?? 'MISSING') .
                " paid=" . ($di['total_fee_paid'] ?? 0) .
                " bal=" . ($di['balance_due'] ?? 0));
        }

        // ── 2. PAYMENT HISTORY — grouped by receipt_number ───────────────────
        //
        // KEY FIX: balance_amount in ssms_fee_paid_details is a stored snapshot
        // (the remaining balance at the moment that row was written). For partial
        // payments this is wrong — the last payment row shows balance=0 even when
        // the full fee was not paid across all receipts.
        //
        // Solution: JOIN a live aggregate subquery that sums ALL paid_amount rows
        // for this enrollment per fee_item, then computes:
        //   true_balance = fs.fee_amount − total_ever_paid_for_this_item
        //
        // This way each item in history correctly shows how much of that fee item
        // is still outstanding at the current point in time.
        // ─────────────────────────────────────────────────────────────────────
        $paidQuery = "
            SELECT
                fp.trxn_id,
                fp.receipt_number,
                fp.paid_amount,
                fp.fee_paid_amount,
                fp.late_fee,
                fp.payment_date,
                fp.fee_paid_date,
                fp.payment_method,
                fp.admin_review,
                fp.admin_user,
                fp.admin_review_date,
                fp.enrollment_id,
                fp.registration_id,
                fp.class_id,
                fp.branch_id,
                fp.session_id,
                fp.ssms_client_code,
                fp.ssms_user_name,
                fp.fee_item_id,
                fp.fee_id,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                fs.month_no,
                fs.due_date                                  AS fee_due_date,
                fs.fee_amount                                AS structure_fee_amount,

                COALESCE(sd.discount_percent, 0)             AS discount_percent,
                (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END) AS discount_amount,
                COALESCE(fi.tax_percent, 0)                  AS tax_percent,
                fp.tax_amount,
                ROUND(fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END), 2)
                                                             AS net_fee_amount,
                COALESCE(paid_total.sum_paid, 0)             AS total_ever_paid,
                GREATEST(
                    0,
                    ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        + ROUND(
                            (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                            * COALESCE(fi.tax_percent, 0) / 100, 2)
                        - COALESCE(paid_total.sum_fee_paid, 0),
                    2)
                )                                            AS true_balance

            FROM ssms_fee_paid_details fp

            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fp.fee_item_id

            LEFT JOIN ssms_fee_structure fs
                ON  fs.fee_id      = fp.fee_id
                AND fs.fee_item_id = fp.fee_item_id

            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :enrollment_id_disc
                AND sd.fee_item_id      = fp.fee_item_id
                AND sd.session_id       = fp.session_id
                AND sd.ssms_client_code = fp.ssms_client_code

            LEFT JOIN (
                SELECT
                    fee_id,
                    fee_item_id,
                    SUM(paid_amount)                        AS sum_paid,
                    SUM(paid_amount - COALESCE(late_fee, 0)) AS sum_fee_paid,
                    SUM(late_fee)                           AS sum_late_fee
                FROM ssms_fee_paid_details
                WHERE enrollment_id = :enrollment_id_agg
                  AND receipt_number != ''
                  AND paid_amount > 0
                GROUP BY fee_id, fee_item_id
            ) paid_total
                ON  paid_total.fee_id      = fp.fee_id
                AND paid_total.fee_item_id = fp.fee_item_id

            WHERE fp.enrollment_id  = :enrollment_id
              AND (fp.paid_amount > 0 OR fp.late_fee > 0)
              AND COALESCE(fp.receipt_number, '') != ''

            ORDER BY fp.payment_date DESC, fp.receipt_number ASC, fp.trxn_id ASC
        ";

        $rawRows = $db->execute($paidQuery, [
            'enrollment_id'      => $enrollmentId,
            'enrollment_id_agg'  => $enrollmentId,
            'enrollment_id_disc' => $enrollmentId,
        ])->fetchAll('assoc');
        // Group rows by receipt_number into receipt objects.
        $receiptMap = [];
        foreach ($rawRows as $row) {
            $rNo = trim((string)($row['receipt_number'] ?? ''));
            if ($rNo === '') continue;

            if (!isset($receiptMap[$rNo])) {
                $receiptMap[$rNo] = [
                    'receipt_number'    => $rNo,
                    'payment_date'      => $row['payment_date'],
                    'fee_paid_date'     => $row['fee_paid_date'],
                    'payment_method'    => $row['payment_method']    ?? 'Cash',
                    'admin_review'      => $row['admin_review']      ?? 'Pending',
                    'admin_user'        => $row['admin_user']        ?? '',
                    'admin_review_date' => $row['admin_review_date'] ?? null,
                    'enrollment_id'     => $row['enrollment_id'],
                    'registration_id'   => $row['registration_id']   ?? null,
                    'class_id'          => $row['class_id'],
                    'branch_id'         => $row['branch_id'],
                    'session_id'        => $row['session_id'],
                    'ssms_client_code'  => $row['ssms_client_code']  ?? '',
                    'ssms_user_name'    => $row['ssms_user_name']    ?? '',
                    'total_paid'        => 0.0,
                    'total_fee'         => 0.0,
                    'total_discount'    => 0.0,
                    'total_tax'         => 0.0,
                    'total_balance'     => 0.0,
                    'total_late_fee'    => 0.0,
                    'total_collected'   => 0.0,
                    'items'             => [],
                    '_seen_fee_items'   => [],
                ];
            }

            $feeAmt      = (float)($row['fee_paid_amount']        ?? 0);
            $paidAmt     = (float)($row['paid_amount']            ?? 0);
            $late        = (float)($row['late_fee']               ?? 0);
            $trueBalance = (float)($row['true_balance']           ?? 0);
            $structFee   = (float)($row['structure_fee_amount']   ?? $feeAmt);
            $totalEver   = (float)($row['total_ever_paid']        ?? 0);
            $feeItemId   = $row['fee_item_id'];
            $discAmt     = (float)($row['discount_amount']        ?? 0);
            $discPct     = (float)($row['discount_percent']       ?? 0);
            $taxPct      = (float)($row['tax_percent']            ?? 0);
            $taxAmt      = (float)($row['tax_amount']             ?? 0);
            $netFee      = round($structFee + $taxAmt - $discAmt, 2);

            $receiptMap[$rNo]['total_paid']      += $paidAmt;
            $receiptMap[$rNo]['total_fee']       += $feeAmt;
            $receiptMap[$rNo]['total_late_fee']  += $late;
            $receiptMap[$rNo]['total_collected'] += $paidAmt;

            if (!in_array($feeItemId, $receiptMap[$rNo]['_seen_fee_items'])) {
                $receiptMap[$rNo]['total_balance']    += $trueBalance;
                $receiptMap[$rNo]['total_discount']   += $discAmt;
                $receiptMap[$rNo]['total_tax']        += $taxAmt;
                $receiptMap[$rNo]['_seen_fee_items'][] = $feeItemId;
            }

            $receiptMap[$rNo]['items'][] = [
                'trxn_id'          => $row['trxn_id'],
                'fee_id'           => $row['fee_id'],
                'fee_item_id'      => $feeItemId,
                'fee_item_name'    => $row['fee_item_name'],
                'month_no'         => $row['month_no']    ?? null,
                'fee_due_date'     => $row['fee_due_date'] ?? null,
                'fee_amount'       => round($structFee,   2),
                'discount_percent' => round($discPct,     2),
                'discount_amount'  => round($discAmt,     2),
                'tax_percent'      => round($taxPct,      2),
                'tax_amount'       => round($taxAmt,      2),
                'net_fee_amount'   => $netFee,
                'paid_amount'      => round($paidAmt,     2),
                'total_paid'       => round($totalEver,   2),
                'late_fee'         => round($late,        2),
                'balance_amount'   => round($trueBalance, 2),
            ];
        }

        // Round totals and strip the internal tracking key
        $paidRecords = [];
        foreach ($receiptMap as &$receipt) {
            $receipt['total_paid']      = round($receipt['total_paid'],      2);
            $receipt['total_fee']       = round($receipt['total_fee'],       2);
            $receipt['total_discount']  = round($receipt['total_discount'],  2);
            $receipt['total_tax']       = round($receipt['total_tax'],       2);
            $receipt['total_balance']   = round($receipt['total_balance'],   2);
            $receipt['total_late_fee']  = round($receipt['total_late_fee'],  2);
            $receipt['total_collected'] = round($receipt['total_collected'],  2);
            unset($receipt['_seen_fee_items']);
            $paidRecords[] = $receipt;
        }
        // ── 3. Summary ────────────────────────────────────────────────────────
        $totalDue  = array_sum(array_column($dueItems,    'balance_due'));
        $totalPaid = array_sum(array_column($paidRecords, 'total_paid'))
                   + array_sum(array_column($paidRecords, 'total_late_fee'));

        try {
                $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
                $schoolDetails = $db->execute("
                    SELECT ssms_client_header_text, ssms_client_address, ssms_client_city, ssms_client_state, ssms_client_zip, ssms_client_email, ssms_client_phone, logo_name, currency, upi_id, pay_account_name
                    FROM ssms_clients
                    WHERE  ssms_client_code = :clientCode
                    LIMIT  1
                ", ['clientCode' => $clientCode ])->fetch('assoc');
            } catch (\Exception $e) {
                Log::warning('fetchStudentFeeDue: could not fetch school details — ' . $e->getMessage());
            }

        // ── 4. Parent/Guardian mobile number + course medium ─────────────────
        $mobileNumber = '';
        $courseMedium = '';
        try {
            $mobileRow = $db->execute("
                SELECT r.mobile_number, e.course_medium
                FROM   ssms_student_enrollment e
                INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                WHERE  e.enrollment_id = :eid
                LIMIT  1
            ", ['eid' => $enrollmentId])->fetch('assoc');
            if (is_array($mobileRow)) {
                $mobileNumber = trim((string)($mobileRow['mobile_number'] ?? ''));
                $courseMedium = trim((string)($mobileRow['course_medium'] ?? ''));
            }
        } catch (\Throwable $e) {
            Log::warning('fetchStudentFeeDue: could not fetch mobile_number — ' . $e->getMessage());
        }

        // ── 5. Enrollment details (class, session, branch, section) ───────────
        $enrollmentInfo = [];
        try {
            $enrollRow = $db->execute("
                SELECT
                    e.class_id,
                    e.session_id,
                    e.branch_id,
                    COALESCE(c.class_name,  CONCAT('Class ',   e.class_id))   AS class_name,
                    COALESCE(sec.section_name, '')                             AS section_name,
                    COALESCE(ss.session_name, CONCAT('Session ', e.session_id)) AS session_name,
                    COALESCE(b.branch_name,  '')                               AS branch_name,
                    TRIM(CONCAT(COALESCE(r.student_first_name, ''), ' ', COALESCE(r.student_last_name, ''))) AS student_name
                FROM ssms_student_enrollment e
                LEFT JOIN ssms_classes   c   ON c.class_id    = e.class_id
                LEFT JOIN ssms_sessions  ss  ON ss.session_id = e.session_id
                LEFT JOIN ssms_branch    b   ON b.branch_id   = e.branch_id
                LEFT JOIN ssms_sections  sec ON sec.section_id = e.section_id
                LEFT JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                WHERE e.enrollment_id = :eid
                LIMIT 1
            ", ['eid' => $enrollmentId])->fetch('assoc');
            if ($enrollRow) {
                $enrollmentInfo = [
                    'class_name'   => $enrollRow['class_name']   ?? '',
                    'section_name' => $enrollRow['section_name'] ?? '',
                    'session_name' => $enrollRow['session_name'] ?? '',
                    'branch_name'  => $enrollRow['branch_name']  ?? '',
                    'student_name' => $enrollRow['student_name'] ?? '',
                ];
            }
        } catch (\Exception $e) {
            Log::warning('fetchStudentFeeDue: could not fetch enrollment details — ' . $e->getMessage());
        }

        $this->set([
            'success' => true,
            'due'     => $dueItems,
            'paid'    => $paidRecords,
            'schoolDetails'   => $schoolDetails ?? [],
            'mobile_number'   => $mobileNumber,
            'course_medium'   => $courseMedium ?? '',
            'enrollment_info' => $enrollmentInfo,
            'summary' => [
                'total_due'  => round((float)$totalDue,  2),
                'total_paid' => round((float)$totalPaid, 2),
                'due_count'  => count($dueItems),
                'paid_count' => count($paidRecords),
            ],
        ]);
        $this->viewBuilder()->setOption('serialize', ['success', 'due', 'paid', 'summary', 'schoolDetails', 'mobile_number', 'course_medium', 'enrollment_info']);
    }



     public function fetchStudentHostelFeeDue($enrollmentId): void
    {
        $this->request->allowMethod(['get']);
        $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to do this operation.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
        $db         = $this->getTableLocator()->get('SsmsFeePaidDetails')->getConnection();
        $classId    = $this->request->getQuery('class_id');
        $sessionId  = $this->request->getQuery('session_id');
        $branchId   = $this->request->getQuery('branch_id');
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $category = $this->request->getQuery('category');
         Log::error("Category received as : ". $category);
         ///Log::error("category received in fetchStudentHostelFeeDue :". $category);
         //         Log::error("category received in $classId :". $classId);

        // ── 1. DUE FEES ──────────────────────────────────────────────────────
        //
        // Drive from ssms_fee_structure — the master list of all fee items.
        // LEFT JOIN an aggregate of actual payments made so balance is always live:
        //
        //   balance_due = fs.fee_amount − SUM(paid_amount for this enrollment)
        //
        // If NO payment rows exist at all for the enrollment, COALESCE returns 0
        // so balance_due = full fee_amount — the student owes everything.
        // ─────────────────────────────────────────────────────────────────────
        $today = date('Y-m-d');
        $dueQuery = "
            SELECT
                fs.fee_id,
                fs.fee_item_id,
                fs.month_no,
                fs.due_date,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fs.fee_item_id))
                    AS fee_item_name,
                fs.fee_amount,
                sc.class_id,
                sc.class_name,
                fs.session_id,
                COALESCE(ss.session_name, CONCAT('Session ', fs.session_id)) AS session_name,
                fs.branch_id,
                COALESCE(sb.branch_name,  CONCAT('Branch ',  fs.branch_id))  AS branch_name,
                fs.ssms_client_code,

                -- Total already paid by this enrollment for this fee item
                COALESCE(paid_agg.total_fee_paid, 0)            AS total_fee_paid,

                -- Discount for this student on this fee item in this session
                COALESCE(sd.discount_percent, 0)            AS discount_percent,
                (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END) AS discount_amount,
                COALESCE(sd.reason,          '')            AS discount_reason,

                -- Tax: rate from fee_items, computed on discounted amount
                COALESCE(fi.tax_percent, 0)                 AS tax_percent,
                COALESCE(fi.tax_inclusive, 0)               AS tax_inclusive,
                -- Full tax on discounted base
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    * COALESCE(fi.tax_percent, 0) / 100,
                2)                                          AS full_tax_amount,
                -- Prorated remaining tax = full_tax * (balance_due / net_fee)
                -- When no partial payment, this equals full_tax_amount
                CASE
                  WHEN COALESCE(paid_agg.total_fee_paid, 0) = 0
                    THEN ROUND(
                           (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                           * COALESCE(fi.tax_percent, 0) / 100, 2)
                  ELSE ROUND(
                         ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                               * COALESCE(fi.tax_percent, 0) / 100, 2)
                         * GREATEST(0,
                             (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                             + ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                                     * COALESCE(fi.tax_percent, 0) / 100, 2)
                             - COALESCE(paid_agg.total_fee_paid, 0))
                         / NULLIF(
                             (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                             + ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                                     * COALESCE(fi.tax_percent, 0) / 100, 2), 0)
                       , 2)
                END                                         AS tax_amount,

                -- Net fee = (base - discount) + tax_on_discounted
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    + ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        * COALESCE(fi.tax_percent, 0) / 100, 2),
                2)                                          AS net_fee_amount,

                -- Balance = net_fee - cash_paid
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    + ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        * COALESCE(fi.tax_percent, 0) / 100, 2)
                    - COALESCE(paid_agg.total_fee_paid, 0),
                2)                                          AS balance_due,

                -- Latest trxn / receipt for UI reference (NULL if no payments yet)
                paid_agg.latest_trxn_id                     AS trxn_id,
                paid_agg.latest_receipt                     AS receipt_number

            FROM ssms_fee_structure fs

            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fs.fee_item_id
                AND fi.category = 'Hostel'
                AND fs.due_date < :dueDate

            LEFT JOIN ssms_classes sc
                ON  sc.class_id = fs.class_id

            LEFT JOIN ssms_sessions ss
                ON  ss.session_id = fs.session_id

            LEFT JOIN ssms_branch sb
                ON  sb.branch_id = fs.branch_id

            -- Aggregate actual cash paid per fee item
            LEFT JOIN (
                SELECT
                    fp.fee_id,
                    fp.fee_item_id,
                    SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) AS total_fee_paid,
                    SUM(fp.late_fee)                               AS late_fee_paid,
                    MAX(fp.trxn_id)                                AS latest_trxn_id,
                    MAX(fp.receipt_number)                         AS latest_receipt
                FROM ssms_fee_paid_details fp
                WHERE fp.enrollment_id = :enrollment_id_agg
                  AND fp.receipt_number != ''
                  AND fp.paid_amount > 0
                GROUP BY fp.fee_id, fp.fee_item_id
            ) paid_agg
                ON  paid_agg.fee_id      = fs.fee_id
                AND paid_agg.fee_item_id = fs.fee_item_id
             -- Discount: one row per student+fee_item+session
            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :enrollment_id_enr
                AND sd.fee_item_id      = fs.fee_item_id
                AND sd.session_id       = fs.session_id
                AND sd.ssms_client_code = fs.ssms_client_code
            -- CRITICAL: scope fee_structure to this student's class/session.
            -- We JOIN ssms_student_enrollment so even students with zero payment rows
            -- are correctly scoped — no need for WHERE EXISTS.
            INNER JOIN ssms_hostel_enrollment enr
                ON  enr.class_id   = fs.class_id
                AND enr.session_id = fs.session_id
                AND fi.category = 'Hostel'
                AND enr.enrollment_id = :enrollment_id_enr

            WHERE 1=1
        ";

        $dueParams = [
            'enrollment_id_agg'  => $enrollmentId,
            'enrollment_id_enr'  => $enrollmentId,
            'enrollment_id_disc' => $enrollmentId,
            'dueDate'            => $today,
        ];

        if (!empty($classId)) {
            $dueQuery .= " AND fs.class_id = :class_id";
            $dueParams['class_id'] = (int)$classId;
        }
        if (!empty($sessionId)) {
            $dueQuery .= " AND fs.session_id = :session_id";
            $dueParams['session_id'] = (int)$sessionId;
        }
        if (!empty($branchId)) {
            $dueQuery .= " AND fs.branch_id = :branch_id";
            $dueParams['branch_id'] = (int)$branchId;
        }
        if (!empty($clientCode)) {
            $dueQuery .= " AND fs.ssms_client_code = :ssms_client_code";
            $dueParams['ssms_client_code'] = $clientCode;
        }

        // Only return items where balance is still outstanding
        $dueQuery .= "
            HAVING balance_due > 0
            ORDER BY fs.due_date ASC, fs.fee_item_id ASC
        ";

        $dueItems = $db->execute($dueQuery, $dueParams)->fetchAll('assoc');
       //  Log::error("due items : ". json_encode($dueItems));
        // ── 2. PAYMENT HISTORY — grouped by receipt_number ───────────────────
        //
        // KEY FIX: balance_amount in ssms_fee_paid_details is a stored snapshot
        // (the remaining balance at the moment that row was written). For partial
        // payments this is wrong — the last payment row shows balance=0 even when
        // the full fee was not paid across all receipts.
        //
        // Solution: JOIN a live aggregate subquery that sums ALL paid_amount rows
        // for this enrollment per fee_item, then computes:
        //   true_balance = fs.fee_amount − total_ever_paid_for_this_item
        //
        // This way each item in history correctly shows how much of that fee item
        // is still outstanding at the current point in time.
        // ─────────────────────────────────────────────────────────────────────
        $paidQuery = "
            SELECT
                fp.trxn_id,
                fp.receipt_number,
                fp.paid_amount,
                fp.fee_paid_amount,
                fp.late_fee,
                fp.payment_date,
                fp.fee_paid_date,
                fp.payment_method,
                fp.admin_review,
                fp.admin_user,
                fp.admin_review_date,
                fp.enrollment_id,
                fp.registration_id,
                fp.class_id,
                fp.branch_id,
                fp.session_id,
                fp.ssms_client_code,
                fp.ssms_user_name,
                fp.fee_item_id,
                fp.fee_id,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                fs.month_no,
                fs.due_date                                  AS fee_due_date,
                fs.fee_amount                                AS structure_fee_amount,
                COALESCE(fi.tax_percent, 0)                  AS tax_percent,
                fp.tax_amount,
                COALESCE(paid_total.sum_paid, 0)             AS total_ever_paid,
                GREATEST(
                    0,
                    ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        + ROUND(
                            (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                            * COALESCE(fi.tax_percent, 0) / 100, 2)
                        - COALESCE(paid_total.sum_fee_paid, 0),
                    2)
                )                                            AS true_balance

            FROM ssms_fee_paid_details fp

            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fp.fee_item_id
                AND fi.category = 'Hostel'

            LEFT JOIN ssms_fee_structure fs
                ON  fs.fee_id      = fp.fee_id
                AND fs.fee_item_id = fp.fee_item_id

            -- Discount: one row per student+fee_item+session
            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :enrollment_id
                AND sd.fee_item_id      = fs.fee_item_id
                AND sd.session_id       = fs.session_id
                AND sd.ssms_client_code = fs.ssms_client_code
                
            -- Aggregate: sum of ALL paid amounts for this enrollment+fee_item
            LEFT JOIN (
                SELECT
                    fee_id,
                    fee_item_id,
                    SUM(paid_amount)                         AS sum_paid,
                    SUM(paid_amount - COALESCE(late_fee, 0)) AS sum_fee_paid,
                    SUM(late_fee)                            AS sum_late_fee
                FROM ssms_fee_paid_details
                WHERE enrollment_id = :enrollment_id_agg
                GROUP BY fee_id, fee_item_id
            ) paid_total
                ON  paid_total.fee_id      = fp.fee_id
                AND paid_total.fee_item_id = fp.fee_item_id

            WHERE fp.enrollment_id  = :enrollment_id
              AND (fp.paid_amount > 0 OR fp.late_fee > 0)
              AND fp.receipt_number != ''
                AND fi.category = 'Hostel'

            ORDER BY fp.payment_date DESC, fp.receipt_number ASC, fp.trxn_id ASC
        ";

        $rawRows = $db->execute($paidQuery, [
            'enrollment_id'     => $enrollmentId,
            'enrollment_id_agg' => $enrollmentId,
        ])->fetchAll('assoc');
        // Group rows by receipt_number into receipt objects.
        $receiptMap = [];
        foreach ($rawRows as $row) {
            $rNo = trim((string)($row['receipt_number'] ?? ''));
            if ($rNo === '') continue;

            if (!isset($receiptMap[$rNo])) {
                $receiptMap[$rNo] = [
                    'receipt_number'    => $rNo,
                    'payment_date'      => $row['payment_date'],
                    'fee_paid_date'     => $row['fee_paid_date'],
                    'payment_method'    => $row['payment_method']    ?? 'Cash',
                    'admin_review'      => $row['admin_review']      ?? 'Pending',
                    'admin_user'        => $row['admin_user']        ?? '',
                    'admin_review_date' => $row['admin_review_date'] ?? null,
                    'enrollment_id'     => $row['enrollment_id'],
                    'registration_id'   => $row['registration_id']   ?? null,
                    'class_id'          => $row['class_id'],
                    'branch_id'         => $row['branch_id'],
                    'session_id'        => $row['session_id'],
                    'ssms_client_code'  => $row['ssms_client_code']  ?? '',
                    'ssms_user_name'    => $row['ssms_user_name']    ?? '',
                    'total_paid'        => 0.0,
                    'total_fee'         => 0.0,
                    'total_discount'    => 0.0,
                    'total_tax'         => 0.0,
                    'total_balance'     => 0.0,
                    'total_late_fee'    => 0.0,
                    'total_collected'   => 0.0,
                    'items'             => [],
                    '_seen_fee_items'   => [],
                ];
            }

            $feeAmt      = (float)($row['fee_paid_amount']        ?? 0);
            $paidAmt     = (float)($row['paid_amount']            ?? 0);
            $late        = (float)($row['late_fee']               ?? 0);
            $trueBalance = (float)($row['true_balance']           ?? 0);
            $structFee   = (float)($row['structure_fee_amount']   ?? $feeAmt);
            $totalEver   = (float)($row['total_ever_paid']        ?? 0);
            $feeItemId   = $row['fee_item_id'];
            $discAmt     = (float)($row['discount_amount']        ?? 0);
            $discPct     = (float)($row['discount_percent']       ?? 0);
            $taxPct      = (float)($row['tax_percent']            ?? 0);
            $taxAmt      = (float)($row['tax_amount']             ?? 0);
            $netFee      = round($structFee + $taxAmt - $discAmt, 2);

            $receiptMap[$rNo]['total_paid']      += $paidAmt;
            $receiptMap[$rNo]['total_fee']       += $feeAmt;
            $receiptMap[$rNo]['total_late_fee']  += $late;
            $receiptMap[$rNo]['total_collected'] += $paidAmt;

            if (!in_array($feeItemId, $receiptMap[$rNo]['_seen_fee_items'])) {
                $receiptMap[$rNo]['total_balance']    += $trueBalance;
                $receiptMap[$rNo]['total_discount']   += $discAmt;
                $receiptMap[$rNo]['total_tax']        += $taxAmt;
                $receiptMap[$rNo]['_seen_fee_items'][] = $feeItemId;
            }

            $receiptMap[$rNo]['items'][] = [
                'trxn_id'          => $row['trxn_id'],
                'fee_id'           => $row['fee_id'],
                'fee_item_id'      => $feeItemId,
                'fee_item_name'    => $row['fee_item_name'],
                'month_no'         => $row['month_no']    ?? null,
                'fee_due_date'     => $row['fee_due_date'] ?? null,
                'fee_amount'       => round($structFee,   2),
                'discount_percent' => round($discPct,     2),
                'discount_amount'  => round($discAmt,     2),
                'tax_percent'      => round($taxPct,      2),
                'tax_amount'       => round($taxAmt,      2),
                'net_fee_amount'   => $netFee,
                'paid_amount'      => round($paidAmt,     2),
                'total_paid'       => round($totalEver,   2),
                'late_fee'         => round($late,        2),
                'balance_amount'   => round($trueBalance, 2),
            ];
        }

        $paidRecords = [];
        foreach ($receiptMap as &$receipt) {
            $receipt['total_paid']      = round($receipt['total_paid'],      2);
            $receipt['total_fee']       = round($receipt['total_fee'],       2);
            $receipt['total_discount']  = round($receipt['total_discount'],  2);
            $receipt['total_tax']       = round($receipt['total_tax'],       2);
            $receipt['total_balance']   = round($receipt['total_balance'],   2);
            $receipt['total_late_fee']  = round($receipt['total_late_fee'],  2);
            $receipt['total_collected'] = round($receipt['total_collected'],  2);
            unset($receipt['_seen_fee_items']);
            $paidRecords[] = $receipt;
        }

        $totalDue  = array_sum(array_column($dueItems,    'balance_due'));
        $totalPaid = array_sum(array_column($paidRecords, 'total_paid'))
                   + array_sum(array_column($paidRecords, 'total_late_fee'));

        try {
            $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
            $schoolDetails = $db->execute("
                SELECT ssms_client_header_text, ssms_client_address, ssms_client_city, ssms_client_state, ssms_client_zip, ssms_client_email, currency,upi_id, pay_account_name
                FROM ssms_clients
                WHERE  ssms_client_code = :clientCode
                LIMIT  1
            ", ['clientCode' => $clientCode])->fetchAssoc();
        } catch (\Exception $e) {
            Log::warning('fetchStudentHostelFeeDue: could not fetch school details — ' . $e->getMessage());
        }
        $this->set([
            'success' => true,
            'due'     => $dueItems,
            'paid'    => $paidRecords,
            'schoolDetails' => $schoolDetails ?? [],
            'summary' => [
                'total_due'  => round((float)$totalDue,  2),
                'total_paid' => round((float)$totalPaid, 2),
                'due_count'  => count($dueItems),
                'paid_count' => count($paidRecords),
            ],
        ]);
        $this->viewBuilder()->setOption('serialize', ['success', 'due', 'paid', 'summary','schoolDetails']);
    }

    public function fetchStudentTransportFeeDue($enrollmentId): void
    {
        $this->request->allowMethod(['get']);
        $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
            if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to do this operation.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
            }
        $db         = $this->getTableLocator()->get('SsmsFeePaidDetails')->getConnection();
        $classId    = $this->request->getQuery('class_id');
        $sessionId  = $this->request->getQuery('session_id');
        $branchId   = $this->request->getQuery('branch_id');
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $category = $this->request->getQuery('category');
         Log::error("category received in fetchStudentHostelFeeDue :". $category);
         Log::error("ClassID received :". $classId);
         Log::error("Branch received  :". $branchId);
         Log::error("SessionId received :". $sessionId);

        // ── 1. DUE FEES ──────────────────────────────────────────────────────
        //
        // Drive from ssms_fee_structure — the master list of all fee items.
        // LEFT JOIN an aggregate of actual payments made so balance is always live:
        //
        //   balance_due = fs.fee_amount − SUM(paid_amount for this enrollment)
        //
        // If NO payment rows exist at all for the enrollment, COALESCE returns 0
        // so balance_due = full fee_amount — the student owes everything.
        // ─────────────────────────────────────────────────────────────────────
        $today = date('Y-m-d');
        $dueQuery = "
            SELECT
                fs.fee_id,
                fs.fee_item_id,
                fs.month_no,
                fs.due_date,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fs.fee_item_id))
                    AS fee_item_name,
                fs.fee_amount,
                sc.class_id,
                sc.class_name,
                fs.session_id,
                COALESCE(ss.session_name, CONCAT('Session ', fs.session_id)) AS session_name,
                fs.branch_id,
                COALESCE(sb.branch_name,  CONCAT('Branch ',  fs.branch_id))  AS branch_name,
                fs.ssms_client_code,

                -- Total already paid by this enrollment for this fee item
                COALESCE(paid_agg.total_fee_paid, 0)            AS total_fee_paid,

                -- Discount for this student on this fee item in this session
                COALESCE(sd.discount_percent, 0)            AS discount_percent,
                (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END) AS discount_amount,
                COALESCE(sd.reason,          '')            AS discount_reason,

                -- Tax: rate from fee_items, computed on discounted amount
                COALESCE(fi.tax_percent, 0)                 AS tax_percent,
                COALESCE(fi.tax_inclusive, 0)               AS tax_inclusive,
                -- Full tax on discounted base
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    * COALESCE(fi.tax_percent, 0) / 100,
                2)                                          AS full_tax_amount,
                -- Prorated remaining tax = full_tax * (balance_due / net_fee)
                -- When no partial payment, this equals full_tax_amount
                CASE
                  WHEN COALESCE(paid_agg.total_fee_paid, 0) = 0
                    THEN ROUND(
                           (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                           * COALESCE(fi.tax_percent, 0) / 100, 2)
                  ELSE ROUND(
                         ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                               * COALESCE(fi.tax_percent, 0) / 100, 2)
                         * GREATEST(0,
                             (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                             + ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                                     * COALESCE(fi.tax_percent, 0) / 100, 2)
                             - COALESCE(paid_agg.total_fee_paid, 0))
                         / NULLIF(
                             (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                             + ROUND((fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                                     * COALESCE(fi.tax_percent, 0) / 100, 2), 0)
                       , 2)
                END                                         AS tax_amount,

                -- Net fee = (base - discount) + tax_on_discounted
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    + ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        * COALESCE(fi.tax_percent, 0) / 100, 2),
                2)                                          AS net_fee_amount,

                -- Balance = net_fee - cash_paid
                ROUND(
                    (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                    + ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        * COALESCE(fi.tax_percent, 0) / 100, 2)
                    - COALESCE(paid_agg.total_fee_paid, 0),
                2)                                          AS balance_due,

                -- Latest trxn / receipt for UI reference (NULL if no payments yet)
                paid_agg.latest_trxn_id                     AS trxn_id,
                paid_agg.latest_receipt                     AS receipt_number

            FROM ssms_fee_structure fs

            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fs.fee_item_id
                AND fi.category = :categoryParams
                AND fs.due_date < :dueDate

            LEFT JOIN ssms_classes sc
                ON  sc.class_id = fs.class_id

            LEFT JOIN ssms_sessions ss
                ON  ss.session_id = fs.session_id

            LEFT JOIN ssms_branch sb
                ON  sb.branch_id = fs.branch_id

            -- Aggregate all payments this enrollment has made per fee item.
            -- This is a LEFT JOIN so rows with zero payments still appear.
            -- Use paid_amount - late_fee = actual fee cash paid (works for old+new rows)
            LEFT JOIN (
                SELECT
                    fp.fee_id,
                    fp.fee_item_id,
                    SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) AS total_fee_paid,
                    SUM(fp.late_fee)                               AS late_fee_paid,
                    MAX(fp.trxn_id)                                AS latest_trxn_id,
                    MAX(fp.receipt_number)                         AS latest_receipt
                FROM ssms_fee_paid_details fp
                WHERE fp.enrollment_id = :enrollment_id_agg
                  AND fp.receipt_number != ''
                  AND fp.paid_amount > 0
                GROUP BY fp.fee_id, fp.fee_item_id
            ) paid_agg
                ON  paid_agg.fee_id      = fs.fee_id
                AND paid_agg.fee_item_id = fs.fee_item_id

            -- Discount: one row per student+fee_item+session
            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :enrollment_id_disc
                AND sd.fee_item_id      = fs.fee_item_id
                AND sd.session_id       = fs.session_id
                AND sd.ssms_client_code = fs.ssms_client_code

            INNER JOIN ssms_transport_enrollments enr
                ON  enr.class_id      = fs.class_id
                AND enr.session_id    = fs.session_id
                AND fi.category       = :categoryParams
                AND enr.enrollment_id = :enrollment_id_enr

            WHERE 1=1
        ";

        $dueParams = [
            'enrollment_id_agg'  => $enrollmentId,
            'enrollment_id_enr'  => $enrollmentId,
            'enrollment_id_disc' => $enrollmentId,
            'dueDate'            => $today,
            'categoryParams' => $category,
        ];

        if (!empty($classId)) {
            $dueQuery .= " AND fs.class_id = :class_id";
            $dueParams['class_id'] = (int)$classId;
        }
        if (!empty($sessionId)) {
            $dueQuery .= " AND fs.session_id = :session_id";
            $dueParams['session_id'] = (int)$sessionId;
        }
        if (!empty($branchId)) {
            $dueQuery .= " AND fs.branch_id = :branch_id";
            $dueParams['branch_id'] = (int)$branchId;
        }
        if (!empty($clientCode)) {
            $dueQuery .= " AND fs.ssms_client_code = :ssms_client_code";
            $dueParams['ssms_client_code'] = $clientCode;
        }

        // Only return items where balance is still outstanding
        $dueQuery .= "
            HAVING balance_due > 0
            ORDER BY fs.due_date ASC, fs.fee_item_id ASC
        ";
        Log::error("Query received in fetchStudentTransportFeeDue :". $dueQuery);
        $dueItems = $db->execute($dueQuery, $dueParams)->fetchAll('assoc');
        foreach ($dueItems as $di) {
            \Cake\Log\Log::debug("DUE: " . ($di['fee_item_name'] ?? '') .
                " disc=" . ($di['discount_amount'] ?? 'MISSING') .
                " net=" . ($di['net_fee_amount'] ?? 'MISSING') .
                " paid=" . ($di['total_fee_paid'] ?? 0) .
                " bal=" . ($di['balance_due'] ?? 0));
        }

        // ── 2. PAYMENT HISTORY — grouped by receipt_number ───────────────────
        //
        // KEY FIX: balance_amount in ssms_fee_paid_details is a stored snapshot
        // (the remaining balance at the moment that row was written). For partial
        // payments this is wrong — the last payment row shows balance=0 even when
        // the full fee was not paid across all receipts.
        //
        // Solution: JOIN a live aggregate subquery that sums ALL paid_amount rows
        // for this enrollment per fee_item, then computes:
        //   true_balance = fs.fee_amount − total_ever_paid_for_this_item
        //
        // This way each item in history correctly shows how much of that fee item
        // is still outstanding at the current point in time.
        // ─────────────────────────────────────────────────────────────────────
        $paidQuery = "
            SELECT
                fp.trxn_id,
                fp.receipt_number,
                fp.paid_amount,
                fp.fee_paid_amount,
                fp.late_fee,
                fp.payment_date,
                fp.fee_paid_date,
                fp.payment_method,
                fp.admin_review,
                fp.admin_user,
                fp.admin_review_date,
                fp.enrollment_id,
                fp.registration_id,
                fp.class_id,
                fp.branch_id,
                fp.session_id,
                fp.ssms_client_code,
                fp.ssms_user_name,
                fp.fee_item_id,
                fp.fee_id,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                fs.month_no,
                fs.due_date                                  AS fee_due_date,
                fs.fee_amount                                AS structure_fee_amount,

                COALESCE(sd.discount_percent, 0)             AS discount_percent,
                (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END) AS discount_amount,
                COALESCE(fi.tax_percent, 0)                  AS tax_percent,
                fp.tax_amount,
                ROUND(fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END), 2)
                                                             AS net_fee_amount,
                COALESCE(paid_total.sum_paid, 0)             AS total_ever_paid,
                GREATEST(
                    0,
                    ROUND(
                        (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                        + ROUND(
                            (fs.fee_amount - (CASE WHEN sd.discount_amount > 0 THEN sd.discount_amount ELSE ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2) END))
                            * COALESCE(fi.tax_percent, 0) / 100, 2)
                        - COALESCE(paid_total.sum_fee_paid, 0),
                    2)
                )                                            AS true_balance

            FROM ssms_fee_paid_details fp

            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fp.fee_item_id
                AND fi.category = :categoryParams

            LEFT JOIN ssms_fee_structure fs
                ON  fs.fee_id      = fp.fee_id
                AND fs.fee_item_id = fp.fee_item_id

            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :enrollment_id_disc
                AND sd.fee_item_id      = fp.fee_item_id
                AND sd.session_id       = fp.session_id
                AND sd.ssms_client_code = fp.ssms_client_code

            LEFT JOIN (
                SELECT
                    fee_id,
                    fee_item_id,
                    SUM(paid_amount)                        AS sum_paid,
                    SUM(paid_amount - COALESCE(late_fee, 0)) AS sum_fee_paid,
                    SUM(late_fee)                           AS sum_late_fee
                FROM ssms_fee_paid_details
                WHERE enrollment_id = :enrollment_id_agg
                  AND receipt_number != ''
                  AND paid_amount > 0
                GROUP BY fee_id, fee_item_id
            ) paid_total
                ON  paid_total.fee_id      = fp.fee_id
                AND paid_total.fee_item_id = fp.fee_item_id

            WHERE fp.enrollment_id  = :enrollment_id
              AND (fp.paid_amount > 0 OR fp.late_fee > 0)
              AND fp.receipt_number != ''
                AND fi.category = :categoryParams

            ORDER BY fp.payment_date DESC, fp.receipt_number ASC, fp.trxn_id ASC
        ";

        $rawRows = $db->execute($paidQuery, [
            'enrollment_id'      => $enrollmentId,
            'enrollment_id_agg'  => $enrollmentId,
            'enrollment_id_disc' => $enrollmentId,
            'categoryParams' => $category,
        ])->fetchAll('assoc');
       //  Log::error("Paid query : ". json_encode($paidQuery));

        // Group rows by receipt_number into receipt objects.
        // total_balance on the receipt = sum of true_balance across its items,
        // which correctly reflects the current outstanding per fee_item.
        $receiptMap = [];
        foreach ($rawRows as $row) {
            $rNo = trim((string)($row['receipt_number'] ?? ''));
            if ($rNo === '') continue;

            if (!isset($receiptMap[$rNo])) {
                $receiptMap[$rNo] = [
                    'receipt_number'    => $rNo,
                    'payment_date'      => $row['payment_date'],
                    'fee_paid_date'     => $row['fee_paid_date'],
                    'payment_method'    => $row['payment_method']    ?? 'Cash',
                    'admin_review'      => $row['admin_review']      ?? 'Pending',
                    'admin_user'        => $row['admin_user']        ?? '',
                    'admin_review_date' => $row['admin_review_date'] ?? null,
                    'enrollment_id'     => $row['enrollment_id'],
                    'registration_id'   => $row['registration_id']   ?? null,
                    'class_id'          => $row['class_id'],
                    'branch_id'         => $row['branch_id'],
                    'session_id'        => $row['session_id'],
                    'ssms_client_code'  => $row['ssms_client_code']  ?? '',
                    'ssms_user_name'    => $row['ssms_user_name']    ?? '',
                    'total_paid'        => 0.0,
                    'total_fee'         => 0.0,
                    'total_discount'    => 0.0,
                    'total_tax'         => 0.0,
                    'total_balance'     => 0.0,
                    'total_late_fee'    => 0.0,
                    'total_collected'   => 0.0,
                    'items'             => [],
                    '_seen_fee_items'   => [],
                ];
            }

            $feeAmt      = (float)($row['fee_paid_amount']        ?? 0);
            $paidAmt     = (float)($row['paid_amount']            ?? 0);
            $late        = (float)($row['late_fee']               ?? 0);
            $trueBalance = (float)($row['true_balance']           ?? 0);
            $structFee   = (float)($row['structure_fee_amount']   ?? $feeAmt);
            $totalEver   = (float)($row['total_ever_paid']        ?? 0);
            $feeItemId   = $row['fee_item_id'];
            $discAmt     = (float)($row['discount_amount']        ?? 0);
            $discPct     = (float)($row['discount_percent']       ?? 0);
            $taxPct      = (float)($row['tax_percent']            ?? 0);
            $taxAmt      = (float)($row['tax_amount']             ?? 0);
            $netFee      = round($structFee + $taxAmt - $discAmt, 2);

            $receiptMap[$rNo]['total_paid']      += $paidAmt;
            $receiptMap[$rNo]['total_fee']       += $feeAmt;
            $receiptMap[$rNo]['total_late_fee']  += $late;
            $receiptMap[$rNo]['total_collected'] += $paidAmt;

            if (!in_array($feeItemId, $receiptMap[$rNo]['_seen_fee_items'])) {
                $receiptMap[$rNo]['total_balance']    += $trueBalance;
                $receiptMap[$rNo]['total_discount']   += $discAmt;
                $receiptMap[$rNo]['total_tax']        += $taxAmt;
                $receiptMap[$rNo]['_seen_fee_items'][] = $feeItemId;
            }

            $receiptMap[$rNo]['items'][] = [
                'trxn_id'          => $row['trxn_id'],
                'fee_id'           => $row['fee_id'],
                'fee_item_id'      => $feeItemId,
                'fee_item_name'    => $row['fee_item_name'],
                'month_no'         => $row['month_no']    ?? null,
                'fee_due_date'     => $row['fee_due_date'] ?? null,
                'fee_amount'       => round($structFee,   2),
                'discount_percent' => round($discPct,     2),
                'discount_amount'  => round($discAmt,     2),
                'tax_percent'      => round($taxPct,      2),
                'tax_amount'       => round($taxAmt,      2),
                'net_fee_amount'   => $netFee,
                'paid_amount'      => round($paidAmt,     2),
                'total_paid'       => round($totalEver,   2),
                'late_fee'         => round($late,        2),
                'balance_amount'   => round($trueBalance, 2),
            ];
        }

        $paidRecords = [];
        foreach ($receiptMap as &$receipt) {
            $receipt['total_paid']      = round($receipt['total_paid'],      2);
            $receipt['total_fee']       = round($receipt['total_fee'],       2);
            $receipt['total_discount']  = round($receipt['total_discount'],  2);
            $receipt['total_tax']       = round($receipt['total_tax'],       2);
            $receipt['total_balance']   = round($receipt['total_balance'],   2);
            $receipt['total_late_fee']  = round($receipt['total_late_fee'],  2);
            $receipt['total_collected'] = round($receipt['total_collected'],  2);
            unset($receipt['_seen_fee_items']);
            $paidRecords[] = $receipt;
        }

        $totalDue  = array_sum(array_column($dueItems,    'balance_due'));
        $totalPaid = array_sum(array_column($paidRecords, 'total_paid'))
                   + array_sum(array_column($paidRecords, 'total_late_fee'));

        try {
            $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
            $schoolDetails = $db->execute("
                SELECT ssms_client_header_text, ssms_client_address, ssms_client_city, ssms_client_state, ssms_client_zip, ssms_client_email, currency,upi_id, pay_account_name
                FROM ssms_clients
                WHERE  ssms_client_code = :clientCode
                LIMIT  1
            ", ['clientCode' => $clientCode])->fetchAssoc();
        } catch (\Exception $e) {
            Log::warning('fetchStudentTransportFeeDue: could not fetch school details — ' . $e->getMessage());
        }
        $this->set([
            'success' => true,
            'due'     => $dueItems,
            'paid'    => $paidRecords,
            'schoolDetails' => $schoolDetails ?? [],
            'summary' => [
                'total_due'  => round((float)$totalDue,  2),
                'total_paid' => round((float)$totalPaid, 2),
                'due_count'  => count($dueItems),
                'paid_count' => count($paidRecords),
            ],
        ]);
        $this->viewBuilder()->setOption('serialize', ['success', 'due', 'paid', 'summary','schoolDetails']);
    }

    public function payStudentFees(): void
    {
       $this->request->allowMethod(['post']);
        $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
        $ssmsUserName = strtolower(trim($this->request->getHeaderLine('ssmsUserName')));
        $ssmsClientCode = strtolower(trim($this->request->getHeaderLine('ssmsClientCode')));

        if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
        $data = $this->request->getData();
        //Log::error("Payment data received : ". json_encode($data));
       // $receiptNumber1 = date('Ymd') . mt_rand(100, 999);
        // ── Extract every key safely BEFORE validation ────────────────────────
        $enrollmentId   = $data['enrollment_id']     ?? null;
        $receiptNumber  = trim((string)($data['receipt_number']  ?? ''));
        $paidAmountRaw  = $data['fee_paid_amount']        ?? null;
        $feeItems       = $data['selected_fee_items'] ?? null;
        $paymentDate    = $data['payment_date']       ?? null;
        $feePaidDate    = $data['fee_paid_date']      ?? null;
        $paymentMethod = $data['payment_method'] ?? null;
        $adminUser      = trim((string)($data['admin_user']       ?? ''));
 
        // ── Validate ──────────────────────────────────────────────────────────
        $errs = [];
        if (empty($enrollmentId))                        $errs[] = 'enrollment_id is required.';
        if ($receiptNumber === '')                        $errs[] = 'receipt_number is required.';
        if (!is_numeric($paidAmountRaw))                 $errs[] = 'paid_amount must be numeric.';
        if (empty($feeItems) || !is_array($feeItems))    $errs[] = 'No fee items selected.';
 
        if (!empty($errs)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => implode(' ', $errs)]);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
 
        $table        = $this->getTableLocator()->get('SsmsFeePaidDetails');
        $paidTotal    = (float)$paidAmountRaw;
        $items        = (array)$feeItems;
        $today        = DateTime::now()->toDateString();
        $paymentDate  = $paymentDate ?? $today;
        $feePaidDate  = $feePaidDate ?? $today;
        $createdTrxns = [];
        $remaining    = $paidTotal;
        $totalLateFee = 0; //this will be used in email receipt
        foreach ($items as $item) {
            if ($remaining <= 0) break;
            $clientCode     = trim((string)($item['ssms_client_code'] ?? ''));
            $sessionId      = !empty($item['session_id'])      ? (int)$item['session_id']      : null;
            $classId        = !empty($item['class_id'])        ? (int)$item['class_id']        : null;
            $branchId       = !empty($item['branch_id'])       ? (int)$item['branch_id']       : null;
            $registrationId = !empty($item['registration_id']) ? (int)$item['registration_id'] : null;
            $userName       = trim((string)($item['ssms_user_name']   ?? ''));
            $lateFee         = !empty($item['late_fee']) ? (float)$item['late_fee'] : 0;
            $totalLateFee    = $totalLateFee + $lateFee;
            $discountPercent = round((float)($item['discount_percent'] ?? 0), 2);
            $discountAmount  = round((float)($item['discount_amount']  ?? 0), 2);
            $discountReason  = trim((string)($item['discount_reason']  ?? ''));
            $taxPercent      = round((float)($item['tax_percent']      ?? 0), 2);
            $taxAmount       = round((float)($item['tax_amount']       ?? 0), 2);
            $originalFeeAmt  = round((float)($item['fee_amount'] ?? 0), 2);
            $netFeeAmt       = round($originalFeeAmt - $discountAmount, 2);   // base after discount, before tax
            $itemBalanceDue  = round((float)(($item['balance_due'] ?? null) ?? ($netFeeAmt + $taxAmount)), 2);
 
            // How much of the remaining cash goes to this item
            $allocate  = round(min($remaining, $itemBalanceDue + $lateFee), 2);
            $remaining = round($remaining - $allocate, 2);
 
            // Balance still owed after this payment
            $newBalance = round(max(0, $itemBalanceDue - $allocate), 2);
 
            // Prorate tax to only what is covered by this payment.
            // Cash toward fee (excluding late fee) as a proportion of total net+tax
            // gives us the share of tax applicable to this transaction.
            $cashTowardFee   = round($allocate - $lateFee, 2);
            $totalNetWithTax = round($netFeeAmt + $taxAmount, 2);
            if ($totalNetWithTax > 0 && $taxAmount > 0) {
                $proratedTax = round($taxAmount * ($cashTowardFee / $totalNetWithTax), 2);
            } else {
                $proratedTax = 0.0;
            }
 
            // Shared fields inherited by every row written for this item
            $sharedFields = [
                'fee_paid_amount'        => $originalFeeAmt,
                'ssms_client_code'  => $clientCode,
                'session_id'        => $sessionId,
                'class_id'          => $classId,
                'branch_id'         => $branchId,
                'enrollment_id'     => $enrollmentId,
                'registration_id'   => $registrationId,
                'fee_item_id'       => (int)(($item['fee_item_id'] ?? null) ?? 0),
                'fee_id'            => (int)(($item['fee_id']      ?? null) ?? 0),
                'enrolled'          => 1,
                'ssms_user_name'    => $userName,
            ];
 
            // ── STEP 1 ────────────────────────────────────────────────────────
            // If a previous row exists for this item (with or without a receipt),
            // zero out its balance_amount so the ledger stays clean.
            // We NEVER change its paid_amount, receipt_number, or other history.
            
            
            //$existingTrxnId = !empty($item['existing_trxn']) ? (int)$item['existing_trxn'] : null;
 //
            //if ($existingTrxnId) {
            //    $existingEntity = $table->find()
            //        ->where(['trxn_id' => $existingTrxnId])
            //        ->first();
 //
            //    if ($existingEntity) {
            //        //$existingEntity->balance_amount = 0;
            //        $existingEntity->admin_review   = 'Pending';
            //        $existingEntity->paid_amount   = $allocate;
            //        $existingEntity->receipt_number   = $receiptNumber;
            //        $existingEntity->payment_date   = $paymentDate;
            //        $existingEntity->payment_method   = $paymentMethod;
            //         Log::error('$existingEntity for same: ' . $existingEntity);
            //        $table->save($existingEntity);
            //        $createdTrxns[] = [
            //            'trxn_id' => $existingEntity->trxn_id,
            //            'action'  => 'zeroed_existing',
            //        ];
            //    }
            //}
 
            // ── STEP 2 NOT NEEDED for now. will clean later─ ────────────────────────────────────────────────────────
            // Always INSERT a new payment row with the new receipt number,
            // the amount being paid now, and the resulting balance.
            // Raw SQL INSERT — bypasses Entity $_accessible so discount fields are saved
            // NOTE: fee_amount column does NOT exist in ssms_fee_paid_details — excluded
            $db2 = $table->getConnection();
            $now = date('Y-m-d H:i:s');
            $db2->execute(
                'INSERT INTO ssms_fee_paid_details
                    (enrollment_id, registration_id, fee_id, fee_item_id,
                     session_id, class_id, branch_id, ssms_client_code,
                     receipt_number, paid_amount, fee_paid_amount, late_fee,
                     discount_percent, discount_amount, discount_reason,
                     tax_percent, tax_amount,
                     payment_date, payment_method, admin_review, admin_user,
                     ssms_user_name, enrolled, created, modified)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [
                    $enrollmentId,
                    $sharedFields['registration_id'],
                    $sharedFields['fee_id'],
                    $sharedFields['fee_item_id'],
                    $sharedFields['session_id'],
                    $sharedFields['class_id'],
                    $sharedFields['branch_id'],
                    $sharedFields['ssms_client_code'],
                    $receiptNumber,
                    $allocate,                                         // paid_amount  = total cash collected for this item
                    round($allocate - $lateFee - $proratedTax, 2),     // fee_paid_amount = base fee only (no tax, no late)
                    $lateFee,
                    $discountPercent,
                    $discountAmount,
                    $discountReason,
                    $taxPercent,                           // tax_percent ← rate (same on every partial row)
                    $proratedTax,                          // tax_amount  ← prorated share for this payment only
                    $paymentDate,
                    $paymentMethod,
                    'Pending',
                    $adminUser,
                    $sharedFields['ssms_user_name'],
                    1,
                    $now,
                    $now,
                ]
            );
            $newTrxnId = $db2->getDriver()->lastInsertId();
            $createdTrxns[] = ['trxn_id' => $newTrxnId, 'action' => 'payment_row'];
 
            // ── STEP 3 ───────────────────────────────────────────────────────
            // If this is a partial payment, INSERT a balance-placeholder row
            // so the remaining amount appears in the student's Due list.
            // receipt_number = '' so the next payment correctly triggers Step 1.
            
            
            //if ($newBalance > 0) {
            //    $placeholder = $table->newEntity([ 
            //        'receipt_number'    => '',
            //        'ssms_client_code'  => $clientCode,
            //        'session_id'        => $sessionId,
            //        'class_id'          => $classId,
            //        'branch_id'         => $branchId,
            //        'enrollment_id'     => $enrollmentId,
            //        'registration_id'   => $registrationId,
            //        'fee_item_id'       => (int)(($item['fee_item_id'] ?? null) ?? 0),
            //        'fee_id'            => (int)(($item['fee_id']      ?? null) ?? 0),
            //        'enrolled'          => 1,
            //        'ssms_user_name'    => $userName,
            //        'fee_amount'        => $this->d($newBalance),
            //        'paid_amount'       => $this->d(0),
            //        'balance_amount'    => $this->d($newBalance),
            //        'payment_date'      => null,
            //        'fee_paid_date'     => null,
            //        'admin_review'      => 'Pending',
            //        'admin_user'        => '',
            //        'admin_review_date' => null,
            //    ]);
            //   Log::error('Insert a new row: ' . $placeholder);
//
            //    if (!$table->save($placeholder)) {
            //        Log::error(
            //            'FeeRecords::pay() Step 3 placeholder save failed: '
            //            . json_encode($placeholder->getErrors(), JSON_PRETTY_PRINT)
            //        );                } 
            //   else {
            //        $createdTrxns[] = [
            //            'trxn_id' => $placeholder->trxn_id,
            //            'action'  => 'balance_placeholder',
            //        ];
            //    }
            //}
        }
 
        // ── Auto-post to finance ledger (finance module clients only) ────────
        $jwtModules = $this->request->getAttribute('jwt_active_modules');
        if (is_array($jwtModules)) {
            $hasFinance = in_array('finance', $jwtModules, true);
        } else {
            // Fallback for older tokens that predate active_modules in JWT
            $hasFinance = (bool)$this->getTableLocator()
                ->get('SsmsClients')
                ->getConnection()
                ->execute(
                    "SELECT 1 FROM ssms_client_modules
                     WHERE ssms_client_code = ? AND module_key = 'finance' LIMIT 1",
                    [$ssmsClientCode]
                )->fetchAssoc();
        }

        if ($hasFinance) {
            try {
                $this->_autoPostFeeIncome(
                    $ssmsClientCode,
                    $paidTotal,
                    $receiptNumber,
                    $paymentDate,
                    (string)($paymentMethod ?? 'bank'),
                    trim((string)($data['student_name'] ?? $data['ssms_user_name'] ?? '')),
                    $ssmsUserName
                );
            } catch (\Throwable $e) {
                \Cake\Log\Log::error('FinAutoPost payStudentFees failed: ' . $e->getMessage() . ' | ' . $e->getFile() . ':' . $e->getLine());
            }
        }

        $this->set([
            'success'      => true,
            'message'      => sprintf(
                'Payment of %.2f recorded against %d fee item(s).',
                $paidTotal,
                count($items)
            ),
            'transactions' => $createdTrxns,
            'amount_paid'  => $paidTotal,
            'unallocated'  => max(0, $remaining),
        ]);
        $this->viewBuilder()->setOption('serialize', [
            'success', 'message', 'transactions', 'amount_paid', 'unallocated',
        ]);
        
        // ── Auto-send receipt email after payment is saved ────────────────────
        // We attempt this AFTER setting the response so a mail failure never
        // blocks or rolls back the payment that was already committed to DB.
        // email_address can come directly from the request, or we fall back to
        // fetching it from the students table using enrollment_id.
        $emailAddress = trim((string)($data['email_address'] ?? ''));
 
        if (empty($emailAddress) && !empty($enrollmentId)) {
            // Look up student email from enrollment → students join
            try {
                $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
                $row = $db->execute("
                    SELECT s.email_address, ssms_client_header_text, ssms_client_address, ssms_client_city, ssms_client_state, ssms_client_zip, ssms_client_email, currency
                    FROM   ssms_student_enrollment e
                    INNER JOIN ssms_student_registration s ON s.registration_id = e.registration_id
                    INNER JOIN ssms_clients c ON c.ssms_client_code = e.ssms_client_code
                    WHERE  e.enrollment_id = :eid
                    AND c.ssms_client_code = :clientCode
                    LIMIT  1
                ", ['eid' => (int)$enrollmentId, 'clientCode' => $ssmsClientCode ])->fetchAssoc();
                if (!empty($row['email_address'])) {
                    $emailAddress = trim($row['email_address']);
                    $schoolName = trim($row['ssms_client_header_text']);
                    $schoolAddress = trim($row['ssms_client_address']);
                    $schoolCity = trim($row['ssms_client_city']);
                    $schoolState = trim($row['ssms_client_state']);
                    $schoolZip = trim($row['ssms_client_zip']);
                    $schoolEmailAddress = trim($row['ssms_client_email']);
                    $schoolCurrency= trim($row['currency']);
                }
                
            } catch (\Exception $e) {
                Log::warning('payStudentFees: could not fetch student email — ' . $e->getMessage());
            }
        }
 
        if (!empty($emailAddress) && filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
            // Build the fee_items array for the receipt from what was just paid
            $receiptFeeItems = [];
            $runningRemaining = $paidTotal;
            foreach ((array)$feeItems as $item) {
                if ($runningRemaining <= 0) break;
                $itemBal  = round((float)(($item['balance_due'] ?? null) ?? ($item['fee_amount'] ?? 0)), 2);
                $alloc    = round(min($runningRemaining, $itemBal), 2);
                $runningRemaining = round($runningRemaining - $alloc, 2);
                $newBal   = round(max(0, $itemBal - $alloc), 2);
 
                $receiptFeeItems[] = [
                    'fee_item_name'  => $item['fee_item_name'] ?? ('Fee #' . ($item['fee_item_id'] ?? '?')),
                    'fee_amount'     => (float)($item['fee_amount']  ?? 0),
                    'paid_amount'    => $alloc,
                    'balance_amount' => $newBal,
                    'late_fee'       => 0,
                    'month_no'       => $item['month_no'] ?? '',
                ];
            }
 
            $this->_dispatchReceiptEmail([
                'email'          => $emailAddress,
                'receipt_number' => $receiptNumber,
                'student_name'   => trim((string)($data['student_name'] ?? $data['ssms_user_name'] ?? '')),
                'enrollment_id'  => $enrollmentId,
                'paid_amount'    => $paidTotal,
                'balance_amount' => max(0, $remaining),   // any unallocated remainder
                'fee_amount'     => array_sum(array_column((array)$feeItems, 'fee_amount')),
                'payment_date'   => $paymentDate,
                'payment_method' => $data['payment_method'] ?? 'Cash',
                'admin_user'     => $ssmsUserName,
                'fee_items'      => $receiptFeeItems,
                'totalLateFee'   => $totalLateFee,
                'schoolName'     => $schoolName,
                'schoolAddress'      => $schoolAddress,
                'schoolCity'         => $schoolCity,
                'schoolState'        => $schoolState,
                'schoolZip'          => $schoolZip,
                'schoolEmailAddress' => $schoolEmailAddress,
                'schoolCurrency'   => $schoolCurrency,
                
            ]);
        } else {
            Log::info("payStudentFees: no valid email for enrollment #{$enrollmentId} — receipt email skipped.");
        }
    }
 
 private function d(mixed $val): string
    {
        return number_format((float)$val, 2, '.', '');
    }

    
    // =========================================================================
    // GET /feeApi/getPendingCollections
    // =========================================================================
    /**
     * Returns all receipts where admin_review = 'Pending' or 'Under Review',
     * grouped by receipt_number with student info and fee item breakdown.
     *
     * Query params:
     *   branch_id, session_id, class_id, collected_by — all optional filters
     *   date_from, date_to — payment_date range filter (YYYY-MM-DD)
     */
    public function getPendingCollections(): void
    {
        //Log::error(" I am in collection");
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
        if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
        $db = $this->getTableLocator()->get('SsmsFeePaidDetails')->getConnection();
 
        $filters    = [];
        $params     = [];
 
        $filters[] = "fp.admin_review IN ('Pending','Under Review')";
        $filters[] = "fp.paid_amount > 0";
        $filters[] = "fp.receipt_number != ''";
 
        if (!empty($clientCode)) {
            $filters[] = "fp.ssms_client_code = :ssms_client_code";
            $params['ssms_client_code'] = $clientCode;
        }
        if ($v = $this->request->getQuery('branch_id'))   { $filters[] = "fp.branch_id  = :branch_id";  $params['branch_id']  = (int)$v; }
        if ($v = $this->request->getQuery('session_id'))  { $filters[] = "fp.session_id = :session_id"; $params['session_id'] = (int)$v; }
        if ($v = $this->request->getQuery('class_id'))    { $filters[] = "fp.class_id   = :class_id";   $params['class_id']   = (int)$v; }
        if ($v = $this->request->getQuery('collected_by')){ $filters[] = "fp.ssms_user_name = :collected_by"; $params['collected_by'] = $v; }
        if ($v = $this->request->getQuery('date_from'))   { $filters[] = "fp.payment_date >= :date_from"; $params['date_from'] = $v; }
        if ($v = $this->request->getQuery('date_to'))     { $filters[] = "fp.payment_date <= :date_to";   $params['date_to']   = $v; }
 
        $where = implode(' AND ', $filters);
 
        $sql = "
            SELECT
                fp.trxn_id,
                fp.receipt_number,
                fp.paid_amount,
                fp.fee_paid_amount,
                fp.late_fee,
                fp.balance_amount,
                fp.payment_date,
                fp.payment_method,
                fp.admin_review,
                fp.enrollment_id,
                fp.class_id,
                fp.branch_id,
                fp.session_id,
                fp.ssms_client_code,
                fp.ssms_user_name                               AS collected_by,
                fp.fee_item_id,
                fp.fee_id,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                fs.month_no,
                fs.due_date,
                sc.class_name,
                COALESCE(ss.session_name, CONCAT('Session ', fp.session_id)) AS session_name,
                COALESCE(sb.branch_name,  CONCAT('Branch ',  fp.branch_id))  AS branch_name,
                TRIM(CONCAT_WS(' ',
                    NULLIF(sr.student_title,''),
                    sr.student_first_name,
                    NULLIF(sr.student_middle_name,''),
                    sr.student_last_name
                ))                                              AS student_name
            FROM ssms_fee_paid_details fp
            LEFT JOIN ssms_fee_items fi     ON fi.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_fee_structure fs ON fs.fee_id = fp.fee_id AND fs.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_classes sc       ON sc.class_id = fp.class_id
            LEFT JOIN ssms_sessions ss      ON ss.session_id = fp.session_id
            LEFT JOIN ssms_branch sb      ON sb.branch_id  = fp.branch_id
            LEFT JOIN ssms_student_enrollment enr ON enr.enrollment_id = fp.enrollment_id
            LEFT JOIN ssms_student_registration sr ON sr.registration_id = enr.registration_id
            WHERE {$where}
            ORDER BY fp.payment_date DESC, fp.receipt_number ASC, fp.trxn_id ASC
        ";
 
        $rows = $db->execute($sql, $params)->fetchAll('assoc');
 
        // Group by receipt_number — same pattern as fetchStudentFeeDue
        $receiptMap = [];
        foreach ($rows as $row) {
            $rNo = trim((string)($row['receipt_number'] ?? ''));
            if ($rNo === '') continue;
 
            if (!isset($receiptMap[$rNo])) {
                $receiptMap[$rNo] = [
                    'receipt_number'  => $rNo,
                    'payment_date'    => $row['payment_date'],
                    'payment_method'  => $row['payment_method'] ?? 'Cash',
                    'admin_review'    => $row['admin_review']   ?? 'Pending',
                    'enrollment_id'   => $row['enrollment_id'],
                    'class_id'        => $row['class_id'],
                    'branch_id'       => $row['branch_id'],
                    'session_id'      => $row['session_id'],
                    'ssms_client_code'=> $row['ssms_client_code'] ?? '',
                    'collected_by'    => $row['collected_by']    ?? '',
                    'student_name'    => trim($row['student_name'] ?? ''),
                    'class_name'      => $row['class_name']      ?? '',
                    'session_name'    => $row['session_name']    ?? '',
                    'branch_name'     => $row['branch_name']     ?? '',
                    'total_paid'      => 0.0,
                    'total_late_fee'  => 0.0,
                    'total_collected' => 0.0,
                    'total_balance'   => 0.0,
                    'total_fee'       => 0.0,
                    'items'           => [],
                    '_seen_items'     => [],
                ];
            }
 
            $paidAmt = (float)($row['paid_amount']    ?? 0);
            $late    = (float)($row['late_fee']       ?? 0);
            $feeAmt  = (float)($row['fee_amount']     ?? 0);
            $bal     = (float)($row['balance_amount'] ?? 0);
            $feeItemId = $row['fee_item_id'];
 
            $receiptMap[$rNo]['total_paid']      += $paidAmt;
            $receiptMap[$rNo]['total_late_fee']  += $late;
            $receiptMap[$rNo]['total_collected'] += $paidAmt + $late;   // late fee shown separately
            $receiptMap[$rNo]['total_fee']       += $feeAmt;
 
            // Count balance once per fee_item (avoid duplicates for multi-row items)
            if (!in_array($feeItemId, $receiptMap[$rNo]['_seen_items'])) {
                $receiptMap[$rNo]['total_balance']  += $bal;
                $receiptMap[$rNo]['_seen_items'][]   = $feeItemId;
            }
 
            $receiptMap[$rNo]['items'][] = [
                'trxn_id'        => $row['trxn_id'],
                'fee_id'         => $row['fee_id'],
                'fee_item_id'    => $feeItemId,
                'fee_item_name'  => $row['fee_item_name'],
                'month_no'       => $row['month_no']  ?? null,
                'due_date'       => $row['due_date']  ?? null,
                'fee_amount'     => round($feeAmt,  2),
                'paid_amount'    => round($paidAmt, 2),
                'late_fee'       => round($late,    2),
                'balance_amount' => round($bal,     2),
            ];
        }
 
        // Build final list and compute summary
        $receipts = [];
        $totalPendingAmt = 0.0;
        foreach ($receiptMap as &$rec) {
            $rec['total_paid']      = round($rec['total_paid'],      2);
            $rec['total_late_fee']  = round($rec['total_late_fee'],  2);
            $rec['total_collected'] = round($rec['total_collected'],  2);
            $rec['total_balance']   = round($rec['total_balance'],   2);
            $rec['total_fee']       = round($rec['total_fee'],       2);
            unset($rec['_seen_items']);
            $totalPendingAmt += $rec['total_collected'];
            $receipts[] = $rec;
        }
 
        // Today's approved count/amount (for the summary banner)
        $todaySql = "
            SELECT COUNT(DISTINCT receipt_number) AS cnt, SUM(paid_amount) AS amt
            FROM ssms_fee_paid_details
            WHERE admin_review = 'Complete'
              AND DATE(admin_review_date) = CURDATE()
            " . (!empty($clientCode) ? " AND ssms_client_code = :cc" : "") . "
        ";
        $todayParams = !empty($clientCode) ? ['cc' => $clientCode] : [];
        $todayRow    = $db->execute($todaySql, $todayParams)->fetchAssoc();

        $currencyRow = $db->execute(
            "SELECT currency FROM ssms_clients WHERE ssms_client_code = :cc LIMIT 1",
            ['cc' => $clientCode]
        )->fetchAssoc();
        $currency = trim((string)($currencyRow['currency'] ?? ''));

        $this->set([
            'status'   => true,
            'receipts' => $receipts,
            'currency' => $currency,
            'summary'  => [
                'pending_count'           => count($receipts),
                'total_pending_amount'    => round($totalPendingAmt, 2),
                'approved_today'          => (int)($todayRow['cnt'] ?? 0),
                'approved_amount_today'   => round((float)($todayRow['amt'] ?? 0), 2),
            ],
        ]);
        $this->viewBuilder()->setOption('serialize', ['status', 'receipts', 'currency', 'summary']);
    }
 
    // =========================================================================
    // POST /feeApi/approveCollections
    // =========================================================================
    /**
     * Approves a list of receipt numbers:
     *   1. Updates ssms_fee_paid_details: admin_review='Complete', admin_user, admin_review_date
     *   2. Inserts one income entry per receipt into ssms_balancesheet
     *
     * POST body (JSON):
     *   receipt_numbers  array  *required — e.g. ["CASH-20250101-1234", "CASH-20250101-5678"]
     */
   public function approveCollections(): void
    {
        $this->request->allowMethod(['post']);
 
        $userRole = $this->request->getHeaderLine('ssmsUserRole');
 
        if (strtolower(trim($userRole)) !== 'owner') {
            $this->response = $this->response->withStatus(403);
            $this->set(['status' => false, 'message' => 'Access denied. You are not allowed to approve fee collections.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }
 
        $data           = $this->request->getData();
        $receiptNumbers = (array)($data['receipt_numbers'] ?? []);
        $adminUser      = $this->request->getHeaderLine('ssmsUserName');
        $clientCode     = $this->request->getHeaderLine('ssmsClientCode');
        $today          = date('Y-m-d H:i:s');
        $todayDate      = date('Y-m-d');
 
        if (empty($receiptNumbers)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => 'receipt_numbers array is required.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }
 
        $db = $this->getTableLocator()->get('SsmsFeePaidDetails')->getConnection();
 
        // Fetch the receipts we're about to approve (need amounts for balance sheet).
        // We use SUM(paid_amount) ONLY — this is the actual cash received.
        // late_fee is metadata stored on each fee_item row showing what was charged,
        // but it is NOT additional money on top of paid_amount. The student pays
        // one total amount (paid_amount already includes any late fee component).
        // Summing late_fee separately would double-count it across multiple rows.
        $placeholders = implode(',', array_fill(0, count($receiptNumbers), '?'));
        $receiptRows  = $db->execute(
            "SELECT receipt_number,
                    SUM(paid_amount) + SUM(late_fee)     AS total_amount,
                    MAX(ssms_client_code) AS ssms_client_code
             FROM ssms_fee_paid_details
             WHERE receipt_number IN ({$placeholders})
               AND admin_review IN ('Pending','Under Review')
             GROUP BY receipt_number",
            array_values($receiptNumbers)
        )->fetchAll('assoc');
 
        if (empty($receiptRows)) {
            $this->set(['status' => false, 'message' => 'No matching pending receipts found.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }
 
        // Fetch current balance from balance sheet for running total
        $balRow = $db->execute(
            "SELECT COALESCE(balance, 0) AS balance
             FROM ssms_balancesheet
             WHERE ssms_client_code = ?
             ORDER BY id DESC LIMIT 1",
            [$clientCode ?: ($receiptRows[0]['ssms_client_code'] ?? '')]
        )->fetchAssoc();
 
        $runningBalance = (float)($balRow['balance'] ?? 0);
 
        $db->begin();
        try {
            $approved = 0;
            foreach ($receiptRows as $receipt) {
                $rNo         = $receipt['receipt_number'];
                $totalAmount = (float)($receipt['total_amount'] ?? 0);
                $cc          = $clientCode ?: ($receipt['ssms_client_code'] ?? '');
 
                // 1. Mark all rows for this receipt as Complete
                $db->execute(
                    "UPDATE ssms_fee_paid_details
                     SET admin_review      = 'Complete',
                         admin_user        = ?,
                         admin_review_date = ?
                     WHERE receipt_number  = ?
                       AND admin_review IN ('Pending','Under Review')",
                    [$adminUser, $today, $rNo]
                );
 
                // 2. Post single income entry — total collected (paid_amount + late_fee)
                $runningBalance += $totalAmount;
                $db->execute(
                    "INSERT INTO ssms_balancesheet
                        (trxn_date, trxn_desc, amount, trxn_type, balance, created, modified, ssms_client_code)
                     VALUES (?, ?, ?, 'income', ?, ?, ?, ?)",
                    [
                        $todayDate,
                        "From fee receipt #{$rNo}",
                        round($totalAmount, 2),
                        round($runningBalance, 2),
                        $today,
                        $today,
                        $cc,
                    ]
                );
 
                $approved++;
            }
 
            $db->commit();
 
            $this->set([
                'status'   => true,
                'message'  => "{$approved} receipt(s) approved and posted to balance sheet.",
                'approved' => $approved,
            ]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message', 'approved']);
 
        } catch (\Exception $e) {
            $db->rollback();
            Log::error('approveCollections error: ' . $e->getMessage());
            $this->response = $this->response->withStatus(500);
            $this->set(['status' => false, 'message' => 'Approval failed: ' . $e->getMessage()]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
        }
    }
    
    private function _fetchClientInfo($db, ?string $clientCode): array
    {
        $empty = [
            'header_text' => env('SCHOOL_NAME', 'School Management System'),
            'address'     => '',
            'city'        => '',
            'state'        => '',
            'zip'         => '',
            'email'       => env('EMAIL_FROM_ADDRESS', ''),
            'phone'       => '',
            'logo_name'   => '',
        ];

        if (empty($clientCode)) return $empty;

        try {
            $row = $db->execute("
                SELECT
                    ssms_client_header_text,
                    logo_name,
                    ssms_client_address,
                    ssms_client_city,
                    ssms_client_state,
                    ssms_client_zip,
                    ssms_client_email,
                    ssms_client_phone,
                    currency
                FROM ssms_clients
                WHERE ssms_client_code = :code
                LIMIT 1
            ", ['code' => $clientCode])->fetchAssoc();
            if (empty($row)) 
                return $empty;

            return [
                'header_text' => trim((string)($row['ssms_client_header_text'] ?? '')) ?: $empty['header_text'],
                'address'     => trim((string)($row['ssms_client_address']     ?? '')),
                'city'        => trim((string)($row['ssms_client_city']        ?? '')),
                'state'       => trim((string)($row['ssms_client_state']       ?? '')),
                'zip'         => trim((string)($row['ssms_client_zip']         ?? '')),
                'email'       => trim((string)($row['ssms_client_email']       ?? '')),
                'phone'       => trim((string)($row['ssms_client_phone']       ?? '')),
                'logo_name'   => trim((string)($row['logo_name']               ?? '')),
                'currency'    => trim((string)($row['currency']                ?? '')),
            ];
        } catch (\Exception $e) {
            Log::warning('_fetchClientInfo failed: ' . $e->getMessage());
            return $empty;
        }
    }
    // =========================================================================
    // Standard CRUD
    // =========================================================================
 
    //public function index(): void
    //{
    //    $this->request->allowMethod(['get']);
    //    $table = $this->getTableLocator()->get('SsmsFeePaidDetails');
    //    $query = $table->find();
    //    foreach (['enrollment_id','branch_id','class_id','session_id','admin_review'] as $f) {
    //        if ($v = $this->request->getQuery($f)) $query->where(["$f" => $v]);
    //    }
    //    $records = $query->orderDesc('trxn_id')->limit(200)->toArray();
    //    $this->set(['success' => true, 'data' => $records]);
    //    $this->viewBuilder()->setOption('serialize', ['success', 'data']);
    //}
 
    //public function view(int $id): void
    //{
    //    $this->request->allowMethod(['get']);
    //    $rec = $this->getTableLocator()->get('SsmsFeePaidDetails')->find()->where(['trxn_id' => $id])->first();
    //    if (!$rec) { $this->_notFound(); return; }
    //    $this->set(['success' => true, 'data' => $rec]);
    //    $this->viewBuilder()->setOption('serialize', ['success', 'data']);
    //}
 
    //public function add(): void
    //{
    //    $this->request->allowMethod(['post']);
    //    $data   = $this->request->getData();
    //    $table  = $this->getTableLocator()->get('SsmsFeePaidDetails');
    //    $entity = $table->newEntity($this->_sanitize($data));
    //    $entity->balance_amount = max(0, (float)$entity->fee_amount + (float)($entity->late_fee??0) - (float)$entity->paid_amount);
    //    if (!$table->save($entity)) { $this->_serverError($entity->getErrors()); return; }
    //    $this->response = $this->response->withStatus(201);
    //    $this->set(['success' => true, 'data' => $entity]);
    //    $this->viewBuilder()->setOption('serialize', ['success', 'data']);
    //}
 
    //public function edit(int $id): void
    //{
    //    $this->request->allowMethod(['put', 'patch']);
    //    $table  = $this->getTableLocator()->get('SsmsFeePaidDetails');
    //    $entity = $table->find()->where(['trxn_id' => $id])->first();
    //    if (!$entity) { $this->_notFound(); return; }
    //    $table->patchEntity($entity, $this->_sanitize($this->request->getData()));
    //    $entity->balance_amount = max(0, (float)$entity->fee_amount + (float)($entity->late_fee??0) - (float)$entity->paid_amount);
    //    if (!$table->save($entity)) { $this->_serverError($entity->getErrors()); return; }
    //    $this->set(['success' => true, 'data' => $entity]);
    //    $this->viewBuilder()->setOption('serialize', ['success', 'data']);
    //}
 //
    //public function delete(int $id): void
    //{
    //    $this->request->allowMethod(['delete']);
    //    $table  = $this->getTableLocator()->get('SsmsFeePaidDetails');
    //    $entity = $table->find()->where(['trxn_id' => $id])->first();
    //    if (!$entity) { $this->_notFound(); return; }
    //    $table->delete($entity);
    //    $this->set(['success' => true, 'message' => 'Deleted.']);
    //    $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    //}
 
    // ── Private helpers ───────────────────────────────────────────────────────
 
    private function _sanitize(array $d): array
    {
        $t = DateTime::now()->toDateString();
        return [
            'receipt_number'    => trim((string)($d['receipt_number']    ?? '')),
            'fee_amount'        => (float)($d['fee_amount']              ?? 0),
            'late_fee'          => (float)($d['late_fee']                ?? 0),
            'paid_amount'       => (float)($d['paid_amount']             ?? 0),
            'fee_paid_date'     => $d['fee_paid_date']    ?? $t,
            'payment_date'      => $d['payment_date']     ?? $t,
            'admin_review'      => in_array($d['admin_review']??'', ['Pending','Approved','Rejected','Under Review']) ? $d['admin_review'] : 'Pending',
            'admin_user'        => trim((string)($d['admin_user']        ?? '')),
            'admin_review_date' => !empty($d['admin_review_date']) ? $d['admin_review_date'] : null,
            'ssms_client_code'  => trim((string)($d['ssms_client_code']  ?? '')),
            'session_id'        => !empty($d['session_id'])     ? (int)$d['session_id']     : null,
            'class_id'          => !empty($d['class_id'])       ? (int)$d['class_id']       : null,
            'branch_id'         => !empty($d['branch_id'])      ? (int)$d['branch_id']      : null,
            'enrollment_id'     => !empty($d['enrollment_id'])  ? (int)$d['enrollment_id']  : null,
            'registration_id'   => !empty($d['registration_id'])? (int)$d['registration_id']: null,
            'fee_item_id'       => !empty($d['fee_item_id'])    ? (int)$d['fee_item_id']    : null,
            'fee_id'            => !empty($d['fee_id'])         ? (int)$d['fee_id']         : null,
            'enrolled'          => isset($d['enrolled'])        ? (int)$d['enrolled']       : 1,
            'ssms_user_name'    => trim((string)($d['ssms_user_name']    ?? '')),
        ];
    }
 
    private function _notFound(): void
    {
        $this->response = $this->response->withStatus(404);
        $this->set(['success' => false, 'message' => 'Record not found.']);
        $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    }
 
    private function _serverError(array $errors): void
    {
        $this->response = $this->response->withStatus(500);
        $this->set(['success' => false, 'message' => 'Database error.', 'errors' => $errors]);
        $this->viewBuilder()->setOption('serialize', ['success', 'message', 'errors']);
    }
    
    
    private function _dispatchReceiptEmail(array $params): bool
    {
        $email       = trim((string)($params['email']        ?? ''));
        $receiptNo   = $params['receipt_number'] ?? '—';
        $studentName = trim((string)($params['student_name'] ?? 'Student'));
 
        //$schoolName  = env('SCHOOL_NAME',       'School Management System');
        //$fromAddress = env('EMAIL_FROM_ADDRESS', 'fees@school.com');
        //$fromName    = env('EMAIL_FROM_NAME',    'School Office');
        $schoolName  = $params['schoolName']      ?? env('SCHOOL_NAME', 'School');
        $fromAddress = !empty($params['schoolEmailAddress'])
                        ? $params['schoolEmailAddress']
                        : env('EMAIL_FROM_ADDRESS', 'admin@sawera.info');
        $fromName    = $schoolName;
        try {
            $mailer = new \Cake\Mailer\Mailer('default');
            $mailer
                ->setFrom([$fromAddress => $fromName])
                ->setTo([$email => $studentName])
                ->setSubject("Fee Receipt #{$receiptNo} — {$schoolName}")
                ->setEmailFormat('html')
                ->viewBuilder()
                    ->setTemplate('fee_receipt')
                    ->setLayout('default')
                    ->setVars([
                        // Identity
                        'schoolName'    => $schoolName,
                        'fromAddress'   => $fromAddress,
                        'fromName'      => $fromName,
                        'schoolAddress'  => $params['schoolAddress']      ?? '',
                        'schoolCity'     => $params['schoolCity']         ?? '',
                        'schoolState'    => $params['schoolState']        ?? '',
                        'schoolZip'      => $params['schoolZip']          ?? '',

                        // Receipt header
                        'receiptNo'     => $receiptNo,
                        'studentName'   => $studentName,
                        'enrollmentId'  => ($params['enrollment_id']  ?? 0),
 
                        // Financial totals
                        'paidAmount'    => (float)($params['paid_amount']    ?? 0),
                        'balanceAmount' => (float)($params['balance_amount'] ?? 0),
                        'feeAmount'     => (float)($params['fee_amount']     ?? 0),
                        'totalLateFee'  => (float)($params['totalLateFee']     ?? 0),
                        // Payment metadata
                        'paymentDate'   => !empty($params['payment_date'])
                                            ? $params['payment_date'] : date('Y-m-d'),
                        'paymentMethod' => $params['payment_method'] ?? 'Cash',
                        'adminUser'     => $params['admin_user']     ?? '',
 
                        // Line items for the breakdown table
                        'feeItems'      => (array)($params['fee_items'] ?? []),
 
                        // Timestamp
                        'generatedOn'   => date('d M Y \at h:i A'),
                    ]);
 
            $mailer->send();
 
            Log::error("Receipt email dispatched to {$email} for receipt #{$receiptNo}");
            return true;
 
        } catch (\Exception $e) {
            Log::error("_dispatchReceiptEmail failed [{$email} / #{$receiptNo}]: " . $e->getMessage());
            return false;
        }
    }
    
     // =========================================================================
    // POST /feeApi/sendReceiptEmail
    // =========================================================================
    public function sendReceiptEmail(): void
    {
        $this->request->allowMethod(['post']);
        $userRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')));
        $ssmsUserName = strtolower(trim($this->request->getHeaderLine('ssmsUserName')));
        $ssmsClientCode = strtolower(trim($this->request->getHeaderLine('ssmsClientCode')));
                Log::error("ssmsClientCode received is :". json_encode($ssmsClientCode));

        if (!in_array($userRole, ['admin', 'owner', 'accountant'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'You are not allowed to collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
        $data  = $this->request->getData();
        $email = trim((string)($data['email'] ?? ''));
        Log::error("data received is :". json_encode($data));
        Log::error("Email received is :". json_encode($email));

 
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'A valid email address is required.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
 
        $enrollmentId = $data['enrollment_id'] ?? null;
        $receiptNo    = $data['receipt_number'] ?? '—';
        $studentName  = trim((string)($data['student_name'] ?? 'Student'));

        // Initialise school vars — overwritten from DB below
        $schoolName         = env('SCHOOL_NAME', 'School Management System');
        $schoolAddress      = '';
        $schoolCity         = '';
        $schoolState        = '';
        $schoolZip          = '';
        $schoolEmailAddress = env('EMAIL_FROM_ADDRESS', 'admin@sawera.info');
        $schoolCurrency     = '₹';
        $fromAddress        = env('EMAIL_FROM_ADDRESS', 'admin@sawera.info');//$schoolEmailAddress; // defined here, updated from DB below

        if (!empty($enrollmentId)) {
            try {
                $db  = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
                $row = $db->execute("
                    SELECT s.email_address,
                           c.ssms_client_header_text, c.ssms_client_address,
                           c.ssms_client_city, c.ssms_client_state,
                           c.ssms_client_zip, c.ssms_client_email, c.currency
                    FROM   ssms_student_enrollment e
                    INNER JOIN ssms_student_registration s
                           ON s.registration_id = e.registration_id
                    INNER JOIN ssms_clients c
                           ON c.ssms_client_code = e.ssms_client_code
                    WHERE  e.enrollment_id   = :eid
                      AND  c.ssms_client_code = :clientCode
                    LIMIT  1
                ", ['eid' => $enrollmentId, 'clientCode' => $ssmsClientCode])->fetchAssoc();

                if (!empty($row)) {
                    $schoolName         = trim($row['ssms_client_header_text'] ?? $schoolName);
                    $schoolAddress      = trim($row['ssms_client_address']     ?? '');
                    $schoolCity         = trim($row['ssms_client_city']        ?? '');
                    $schoolState        = trim($row['ssms_client_state']       ?? '');
                    $schoolZip          = trim($row['ssms_client_zip']         ?? '');
                    $schoolEmailAddress = trim($row['ssms_client_email']       ?? $schoolEmailAddress);
                    $schoolCurrency     = trim($row['currency']                ?? '₹');
                    //$fromAddress        = !empty($schoolEmailAddress)
                    //                      ? $schoolEmailAddress
                    //                      : env('EMAIL_FROM_ADDRESS', 'admin@sawera.info');
                }
            } catch (\Exception $e) {
                Log::warning('sendReceiptEmail: could not fetch school details — ' . $e->getMessage());
            }
        }

        try {
            $mailer = new \Cake\Mailer\Mailer('default');
            $mailer
                ->setFrom([$fromAddress => $schoolName])
                ->setTo([$email => $studentName])
                ->setSubject("Fee Receipt #{$receiptNo} — {$schoolName}")
                ->setEmailFormat('html')
                ->viewBuilder()
                    ->setTemplate('fee_receipt')
                    ->setLayout('default')
                    ->setVars([
                        // Identity
                        'schoolName'    => $schoolName,
                        'fromAddress'   => $schoolEmailAddress,
                        'fromName'      => $schoolName,
                        'schoolAddress'      => $schoolAddress,
                        'schoolCity'         => $schoolCity,
                        'schoolState'        => $schoolState,
                        'schoolZip'          => $schoolZip,
                        'schoolEmailAddress' => $schoolEmailAddress,
                        'schoolCurrency'     => $schoolCurrency,
                        // Receipt header
                        'receiptNo'     => $receiptNo,
                        'studentName'   => $studentName,
                        'enrollmentId'  => ($data['enrollment_id']  ?? ''),
 
                        // Financial totals
                        'paidAmount'    => (float)($data['paid_amount']    ?? 0),
                        'balanceAmount' => (float)($data['balance_amount'] ?? 0),
                        'feeAmount'     => (float)($data['fee_amount']     ?? 0),
 
                        // Payment metadata
                        'paymentDate'   => !empty($data['payment_date'])
                                            ? $data['payment_date'] : date('Y-m-d'),
                        'paymentMethod' => $data['payment_method'] ?? 'Cash',
                        'adminUser'     => $data['admin_user']     ?? '',
 
                        // Line items (the breakdown table)
                        'feeItems'      => (array)($data['fee_items'] ?? []),
 
                        // Generated timestamp
                        'generatedOn'   => date('d M Y \\a\\t h:i A'),
                    ]);
 
            $mailer->send();
 
            Log::error("Receipt email sent to {$email} for receipt #{$receiptNo}");
            $this->set(['success' => true, 'message' => "Receipt emailed to {$email}."]);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
 
        } catch (\Exception $e) {
            Log::error('sendReceiptEmail error: ' . $e->getMessage());
            $this->response = $this->response->withStatus(502);
            $this->set(['success' => false, 'message' => 'Email send failed: ' . $e->getMessage()]);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
        }
    }
    
    public function getDemandSlip(): void
    {
        $this->request->allowMethod(['get']);

        $classId    = $this->request->getQuery('class_id');
        $sessionId  = $this->request->getQuery('session_id');
        $branchId   = $this->request->getQuery('branch_id');
        $category   = trim((string)($this->request->getQuery('category') ?? ''));
        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode');

        if (empty($classId) || empty($sessionId)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => 'class_id and session_id are required.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        $db    = $this->getTableLocator()->get('SsmsFeePaidDetails')->getConnection();
        $today = date('Y-m-d');

        // Map category param to category label and value
        $categoryMap = [
            'Academic'  => 'Academic',
            'Hostel'    => 'Hostel',
            'Transport' => 'Transport',
        ];

        // Which categories to run — if none specified, run all three
        $runCategories = !empty($category) && isset($categoryMap[$category])
            ? [$category]
            : ['Academic', 'Hostel', 'Transport'];

        // ── 1. Enrolled students — per category uses different table ──────────
        // Mirrors web version enrollSqlMap exactly
        $enrollSqlMap = [
            'Academic'  => [
                'from'   => 'ssms_student_enrollment e',
                'join'   => 'INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id',
                'select' => 'e.enrollment_id, e.registration_id, e.course_medium',
                'where'  => 'e.class_id = :cls AND e.session_id = :sid AND e.ssms_client_code = :cc',
                'branch' => 'e.branch_id = :bid',
            ],
            'Hostel'    => [
                'from'   => 'ssms_hostel_enrollment e',
                'join'   => 'INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id',
                'select' => "e.enrollment_id, e.registration_id, '' AS course_medium",
                'where'  => "e.class_id = :cls AND e.session_id = :sid AND e.ssms_client_code = :cc AND e.current_status = 'active'",
                'branch' => 'e.branch_id = :bid',
            ],
            'Transport' => [
                'from'   => 'ssms_transport_enrollments te',
                'join'   => 'INNER JOIN ssms_student_enrollment e ON e.enrollment_id = te.enrollment_id
                             INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id',
                'select' => 'te.enrollment_id, e.registration_id, e.course_medium',
                'where'  => 'te.class_id = :cls AND te.session_id = :sid AND te.ssms_client_code = :cc',
                'branch' => 'te.branch_id = :bid',
            ],
        ];

        $grandFee  = $grandTax  = $grandPaid  = $grandDue  = 0.0;
        $allStudents = [];   // accumulate across categories, then merge

        foreach ($runCategories as $cat) {
            $esm = $enrollSqlMap[$cat];
            $enrollSql = "SELECT {$esm['select']},
                           TRIM(CONCAT_WS(' ', r.student_first_name, r.student_last_name)) AS student_name,
                           r.email_address, r.mobile_number
                    FROM   {$esm['from']}
                    {$esm['join']}
                    WHERE  {$esm['where']}";
            $enrollParams = ['cls' => (int)$classId, 'sid' => (int)$sessionId, 'cc' => $clientCode];
            if (!empty($branchId)) { $enrollSql .= " AND {$esm['branch']}"; $enrollParams['bid'] = (int)$branchId; }
            $enrollSql .= " ORDER BY r.student_first_name";
            $rawStudents = $db->execute($enrollSql, $enrollParams)->fetchAll('assoc');

            if (empty($rawStudents)) continue;

            // ── 2. Fee structure — deduplicated using MIN(fee_id) per month ───
            // Mirrors web version exactly — avoids GROUP BY issues with non-aggregated cols
            $feeStructSql = "
                SELECT fs.fee_id, fs.fee_item_id,
                       COALESCE(fi.fee_item_name,'') AS fee_item_name,
                       fs.fee_amount, fs.due_date, fs.month_no,
                       COALESCE(fi.tax_percent, 0)   AS tax_percent
                FROM   ssms_fee_structure fs
                INNER JOIN ssms_fee_items fi
                    ON  fi.fee_item_id = fs.fee_item_id
                    AND fi.category    = :cat
                WHERE  fs.class_id=:cls AND fs.session_id=:sid
                  AND  fs.due_date < :td AND fs.ssms_client_code=:cc
                  AND  fs.fee_id = (
                      SELECT MIN(fs2.fee_id)
                      FROM   ssms_fee_structure fs2
                      WHERE  fs2.fee_item_id      = fs.fee_item_id
                        AND  fs2.month_no         = fs.month_no
                        AND  fs2.class_id         = fs.class_id
                        AND  fs2.session_id       = fs.session_id
                        AND  fs2.ssms_client_code = fs.ssms_client_code
                  )
            ";
            $feeStructParams = [
                'cat' => $cat, 'cls' => (int)$classId,
                'sid' => (int)$sessionId, 'td' => $today, 'cc' => $clientCode,
            ];
            if (!empty($branchId)) { $feeStructSql .= " AND fs.branch_id=:bid"; $feeStructParams['bid'] = (int)$branchId; }
            $feeStructSql .= " ORDER BY fs.due_date, fs.fee_item_id";
            $feeStructure = $db->execute($feeStructSql, $feeStructParams)->fetchAll('assoc');

            if (empty($feeStructure)) continue;

            // ── 3. Payments and discounts ──────────────────────────────────────
            $enrollIds = array_map('strval', array_column($rawStudents, 'enrollment_id'));
            $ph        = implode(',', array_fill(0, count($enrollIds), '?'));

            // Use paid_amount - late_fee for base payment (mirrors web: total_paid_net)
            $payments = $db->execute(
                "SELECT enrollment_id, fee_id,
                        SUM(paid_amount - COALESCE(late_fee, 0)) AS total_paid_net,
                        SUM(COALESCE(late_fee, 0))               AS total_late
                 FROM   ssms_fee_paid_details
                 WHERE  enrollment_id IN ({$ph}) AND session_id=? AND paid_amount>0
                 GROUP BY enrollment_id, fee_id",
                array_merge(array_values($enrollIds), [(int)$sessionId])
            )->fetchAll('assoc');

            $payIdx = [];
            foreach ($payments as $p) {
                $payIdx[(string)$p['enrollment_id']][(string)$p['fee_id']] = $p;
            }

            // Discounts — fetch all for these students, index by enrollment_id + fee_item_id
            $discounts = $db->execute(
                "SELECT enrollment_id, fee_item_id,
                        COALESCE(discount_percent, 0) AS discount_percent,
                        COALESCE(discount_amount,  0) AS discount_amount
                 FROM   ssms_student_discounts
                 WHERE  enrollment_id IN ({$ph}) AND session_id=?",
                array_merge(array_values($enrollIds), [(int)$sessionId])
            )->fetchAll('assoc');

            $discIdx = [];
            foreach ($discounts as $disc) {
                $discIdx[(string)$disc['enrollment_id']][(string)$disc['fee_item_id']] = $disc;
            }

            // ── 4. Build per-student fee items ────────────────────────────────
            foreach ($rawStudents as $stu) {
                $eid      = (string)$stu['enrollment_id'];
                $stuFee   = $stuTax = $stuPaid = $stuDue = 0.0;
                $feeItems = [];

                foreach ($feeStructure as $fs) {
                    $feeAmt  = (float)$fs['fee_amount'];
                    $taxPct  = (float)$fs['tax_percent'];
                    $paid    = (float)($payIdx[$eid][(string)$fs['fee_id']]['total_paid_net'] ?? 0);
                    $late    = (float)($payIdx[$eid][(string)$fs['fee_id']]['total_late']     ?? 0);

                    // Discount: always recalculate from percent (stored amount may be stale)
                    $discRow = $discIdx[$eid][(string)$fs['fee_item_id']] ?? null;
                    $discPct = (float)($discRow['discount_percent'] ?? 0);
                    $discAmt = $discPct > 0
                        ? round($feeAmt * $discPct / 100, 2)
                        : (float)($discRow['discount_amount'] ?? 0);

                    // Balance: compare paid (excl late) vs net payable (excl late)
                    $taxAmt        = round(($feeAmt - $discAmt) * $taxPct / 100, 2);
                    $netFee        = round($feeAmt - $discAmt, 2);
                    $netFeeWithTax = round($netFee + $taxAmt, 2);
                    $balance       = round(max(0, $netFeeWithTax - $paid), 2);

                    $stuFee  += $netFee;
                    $stuTax  += $taxAmt;
                    $stuPaid += $paid;
                    $stuDue  += $balance;

                    $feeItems[] = [
                        'fee_id'           => $fs['fee_id'],
                        'fee_item_id'      => $fs['fee_item_id'],
                        'fee_item_name'    => $fs['fee_item_name'],
                        'category'         => $cat,
                        'month_no'         => $fs['month_no'],
                        'due_date'         => $fs['due_date'],
                        'fee_amount'       => round($feeAmt,   2),
                        'discount_percent' => round($discPct,  2),
                        'discount_amount'  => round($discAmt,  2),
                        'tax_percent'      => round($taxPct,   2),
                        'tax_amount'       => $taxAmt,
                        'net_fee_amount'   => $netFee,
                        'net_payable'      => $netFeeWithTax,
                        'previously_paid'  => round($paid,     2),
                        'late_fee'         => round($late,     2),
                        'balance_due'      => $balance,
                        'is_paid'          => $balance <= 0,
                    ];
                }

                $grandFee  += $stuFee;
                $grandTax  += $stuTax;
                $grandPaid += $stuPaid;
                $grandDue  += $stuDue;

                $allStudents[] = [
                    'enrollment_id'   => $stu['enrollment_id'],
                    'registration_id' => $stu['registration_id'],
                    'student_name'    => $stu['student_name'],
                    'email_address'   => $stu['email_address'],
                    'mobile_number'   => $stu['mobile_number'],
                    'course_medium'   => trim((string)($stu['course_medium'] ?? '')),
                    'category'        => $cat,
                    'fee_items'       => $feeItems,
                    'total_fee'       => round($stuFee,  2),
                    'total_tax'       => round($stuTax,  2),
                    'total_paid'      => round($stuPaid, 2),
                    'total_due'       => round($stuDue,  2),
                    'fully_paid'      => $stuDue <= 0,
                ];
            }
        }

        // ── 5. Merge multi-category entries per student ───────────────────────
        // When ALL categories run, a student may appear in SCH + HTL + TRP.
        // Collapse into one entry per enrollment_id (mirrors web version).
        $merged = [];
        foreach ($allStudents as $s) {
            $key = (string)$s['enrollment_id'];
            if (!isset($merged[$key])) {
                $merged[$key] = $s;
            } else {
                $merged[$key]['fee_items']   = array_merge($merged[$key]['fee_items'], $s['fee_items']);
                $merged[$key]['total_fee']  += $s['total_fee'];
                $merged[$key]['total_tax']  += $s['total_tax'];
                $merged[$key]['total_paid'] += $s['total_paid'];
                $merged[$key]['total_due']  += $s['total_due'];
                $merged[$key]['fully_paid']  = $merged[$key]['total_due'] <= 0;
                if (strpos($merged[$key]['category'], $s['category']) === false) {
                    $merged[$key]['category'] .= ' / ' . $s['category'];
                }
                // Keep first non-empty course_medium across categories
                if (empty($merged[$key]['course_medium']) && !empty($s['course_medium'])) {
                    $merged[$key]['course_medium'] = $s['course_medium'];
                }
            }
        }

        // Round merged totals and build final result
        $result = [];
        foreach (array_values($merged) as $s) {
            $s['total_fee']  = round($s['total_fee'],  2);
            $s['total_tax']  = round($s['total_tax'],  2);
            $s['total_paid'] = round($s['total_paid'], 2);
            $s['total_due']  = round($s['total_due'],  2);
            // Only include students with outstanding dues
            if ($s['total_due'] > 0) {
                $result[] = $s;
            }
        }

        // Sort by student name
        usort($result, fn($a, $b) => strcmp($a['student_name'], $b['student_name']));

        $this->set([
            'status'     => true,
            'students'   => $result,
            'clientInfo' => $this->_fetchClientInfo($db, $clientCode),
            'summary'    => [
                'student_count' => count($result),
                'total_fee'     => round($grandFee,  2),
                'total_tax'     => round($grandTax,  2),
                'total_paid'    => round($grandPaid, 2),
                'total_due'     => round($grandDue,  2),
            ],
        ]);
        $this->viewBuilder()->setOption('serialize', ['status', 'students', 'clientInfo', 'summary']);
    }

        // =========================================================================
    // GET /FeeApi/getStudentDiscounts?enrollmentId=X&sessionId=Y
    // Returns all per-fee-item discounts saved for a student + session
    // =========================================================================
    public function getStudentDiscounts()
    {
        $this->request->allowMethod(['get']);
        $clientCode  = $this->request->getHeaderLine('ssmsClientCode');
        $enrollId    = $this->request->getQuery('enrollmentId');
        $sessionId   = $this->request->getQuery('sessionId');
 
        if (!$clientCode || !$enrollId) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'enrollmentId is required.']));
        }
 
        $db   = $this->getTableLocator()->get('SsmsStudentDiscounts')->getConnection();
        $sql  = "SELECT d.discount_id, d.enrollment_id, d.fee_item_id,
                        d.session_id, d.discount_percent, d.discount_amount,
                        d.reason, fi.fee_item_name, fs.fee_amount
                 FROM   ssms_student_discounts d
                 JOIN   ssms_fee_items     fi ON fi.fee_item_id = d.fee_item_id
                 LEFT JOIN ssms_fee_structure fs
                        ON  fs.fee_item_id = d.fee_item_id
                        AND fs.session_id  = d.session_id
                        AND fs.ssms_client_code = d.ssms_client_code
                 WHERE  d.enrollment_id    = ?
                   AND  d.ssms_client_code = ?";
        $bind = [$enrollId, $clientCode];
        if ($sessionId) { $sql .= " AND d.session_id = ?"; $bind[] = (int)$sessionId; }
 
        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
 
        return $this->response->withType('application/json')
            ->withStringBody(json_encode(['status' => true, 'data' => $rows]));
    }
 
    // =========================================================================
    // POST /FeeApi/saveStudentDiscounts
    // Body: { enrollment_id, session_id, items: [{fee_item_id, discount_percent, reason}] }
    // Upserts each item — same enrollment+fee_item+session = update
    // =========================================================================
    public function saveStudentDiscounts()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $userName   = $this->request->getHeaderLine('ssmsUserName');
        $role       = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));
 
        if (!$clientCode) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Unauthorized.']));
        }
        if (!in_array($role, ['admin', 'owner'])) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Admin or owner access required.']));
        }
 
        $body      = $this->request->getData();
        $enrollId  = trim((string)($body['enrollment_id'] ?? ''));
        $sessionId = (int)($body['session_id'] ?? 0);
        $branchId = (int)($body['branch_id'] ?? 0);
        $classId = (int)($body['class_id'] ?? 0);
        $items     = $body['items'] ?? [];
        Log::error("Discount items received as :". json_encode($items));
        if (!$enrollId || !$sessionId || empty($items)) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'enrollment_id, session_id and items are required.']));
        }
 
        $db  = $this->getTableLocator()->get('SsmsStudentDiscounts')->getConnection();
        $now = date('Y-m-d H:i:s');
 
        foreach ($items as $item) {
            $feeItemId  = (int)($item['fee_item_id']      ?? 0);
            $percent    = min(100, max(0, (float)($item['discount_percent'] ?? 0)));
            $reason     = trim((string)($item['reason'] ?? ''));
 
            if (!$feeItemId) continue;
 
            // Get base fee amount to compute discount_amount
            $feeRow = $db->execute(
                "SELECT fee_amount FROM ssms_fee_structure
                  WHERE fee_item_id = ? AND session_id = ? AND ssms_client_code = ? LIMIT 1",
                [$feeItemId, $sessionId, $clientCode]
            )->fetchAssoc();
            $feeAmount      = (float)($feeRow['fee_amount'] ?? 0);
            $discountAmount = round($feeAmount * $percent / 100, 2);
 
            // UPSERT
            $db->execute(
                "INSERT INTO ssms_student_discounts
                    (enrollment_id, fee_item_id, session_id, class_id, branch_id, discount_percent,
                     discount_amount, reason, ssms_client_code, created_by, created, modified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    discount_percent = VALUES(discount_percent),
                    discount_amount  = VALUES(discount_amount),
                    reason           = VALUES(reason),
                    modified         = VALUES(modified)",
                [$enrollId, $feeItemId, $sessionId, $classId, $branchId, $percent,
                 $discountAmount, $reason, $clientCode, $userName, $now, $now]
            );
        }
 
        // Return updated list
        $updated = $db->execute(
            "SELECT d.*, fi.fee_item_name
             FROM ssms_student_discounts d
             JOIN ssms_fee_items fi ON fi.fee_item_id = d.fee_item_id
             WHERE d.enrollment_id = ? AND d.session_id = ? AND d.ssms_client_code = ?",
            [$enrollId, $sessionId, $clientCode]
        )->fetchAll('assoc');
 
        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'  => true,
                'message' => 'Discounts saved successfully.',
                'data'    => $updated,
            ]));
    }

    // =========================================================================
    // GET /FeeApi/getEnrolledStudents
    // Returns enrolled students for a given class+session (for discount screen)
    // Params: classId*, sessionId*, sectionId, branchId
    // =========================================================================
    public function getEnrolledStudents()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $classId    = $this->request->getQuery('classId');
        $sessionId  = $this->request->getQuery('sessionId');
        $sectionId  = $this->request->getQuery('sectionId');
        $branchId   = $this->request->getQuery('branchId');

        if (!$clientCode || !$classId || !$sessionId) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'classId and sessionId are required.',
                ]));
        }

        $db  = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
        $sql = "SELECT e.enrollment_id, e.roll_number, e.class_id,
                       e.section_id, e.session_id, e.branch_id,
                       CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                       c.class_name, s.section_name
                FROM   ssms_student_enrollment e
                JOIN   ssms_student_registration r ON r.registration_id  = e.registration_id
                LEFT JOIN ssms_classes  c ON c.class_id   = e.class_id
                LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                WHERE  e.class_id         = ?
                  AND  e.session_id       = ?
                  AND  e.ssms_client_code = ?
                  AND  e.status           = 'active'";

        $bind = [(int)$classId, (int)$sessionId, $clientCode];
        if (!empty($sectionId)) { $sql .= " AND e.section_id = ?"; $bind[] = (int)$sectionId; }
        if (!empty($branchId))  { $sql .= " AND e.branch_id  = ?"; $bind[] = (int)$branchId;  }
        $sql .= " ORDER BY e.roll_number ASC, r.student_first_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');

        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'data'   => $rows,
                'total'  => count($rows),
            ]));
    }

}