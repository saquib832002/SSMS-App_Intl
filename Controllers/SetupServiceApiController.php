<?php
declare(strict_types=1);

namespace App\Controller;
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


/**
 * SaweraSsmsUsers Controller
 *
 * @property \App\Model\Table\SaweraSsmsUsersTable $SaweraSsmsUsers
 */
class SetupServiceApiController extends AppController
{
	 public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
		  // Allow login without authentication
    	//$this->Authentication->allowUnauthenticated(['getBranches','createBranch','updateBranch','deleteBranch', 'getClasses','createClass','updateClass','deleteClass',
         //                                           'getSections','createSection','updateSection','deleteSection']);
     }

     public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->response = $this->response->withType('application/json');
    }
 
    // ── Helpers ───────────────────────────────────────────────────────────────
 
    private function getClientCode(): string
    {
        return $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? '';
    }
 
    private function isAdminOrOwner(): bool
    {
        $role = strtolower(trim((string)(
            $this->request->getAttribute('jwt_role')
            ?? $this->request->getHeaderLine('ssmsUserRole')
            ?? ''
        )));
        return in_array($role, ['admin', 'owner'], true);
    }
 
    private function jsonError(int $status, string $message): void
    {
        $this->response = $this->response->withStatus($status);
        $this->set(['status' => false, 'message' => $message]);
        $this->viewBuilder()->setOption('serialize', ['status', 'message']);
    }
 
    private function jsonOk(array $data): void
    {
        $this->set(array_merge(['status' => true], $data));
        $this->viewBuilder()->setOption('serialize', array_keys(
            array_merge(['status' => true], $data)
        ));
    }
/**
 * GET /api/branches
 */
public function getBranches()
{
    $this->request->allowMethod(['get']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');

    $BranchTable = $this->fetchTable('SsmsBranch');
   // Log::error('$clientCode in getBranch: '. $clientCode );

    $branches = $BranchTable->find()
        ->select([
            'branch_id',
            'branch_name',
            'branch_address',
        ])
        ->where([
            'ssms_client_code' => $clientCode,
        ])
        ->orderBy([
            'branch_name' => 'ASC',
        ])
        ->enableHydration(false)
        ->toArray();
    return $this->response
        ->withType('application/json')
        ->withStringBody(json_encode([
            'status' => true,
            'data' => $branches,
        ]));
}

/**
 * POST /api/branches
 */
public function createBranch()
{
    $this->request->allowMethod(['post']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $data = $this->request->getData();

    $branchName = trim((string)($data['branch_name'] ?? ''));
    $branchAddress = trim((string)($data['branch_address'] ?? ''));

    if (empty($branchName)) {
        return $this->response
            ->withType('application/json')
            ->withStatus(422)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Branch name is required',
            ]));
    }

    $BranchTable = $this->fetchTable('SsmsBranch');

    $existing = $BranchTable->find()
        ->where([
            'ssms_client_code' => $clientCode,
            'branch_name' => $branchName,
        ])
        ->first();

    if ($existing) {
        return $this->response
            ->withType('application/json')
            ->withStatus(409)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Branch already exists',
            ]));
    }

    $entity = $BranchTable->newEntity([
        'branch_name' => $branchName,
        'branch_address' => $branchAddress,
        'ssms_client_code' => $clientCode,
    ]);

    try {
        $BranchTable->saveOrFail($entity);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Branch created successfully',
                'data' => [
                    'branch_id' => $entity->branch_id,
                    'branch_name' => $entity->branch_name,
                    'branch_address' => $entity->branch_address,
                ],
            ]));
    } catch (\Throwable $e) {
        Log::error('createBranch failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to create branch',
            ]));
    }
}

/**
 * PUT /api/branches/:branchId
 */
public function updateBranch($branchId = null)
{
    $this->request->allowMethod(['put', 'patch']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $data = $this->request->getData();

    if (empty($branchId)) {
        throw new NotFoundException('Branch ID is required');
    }

    $BranchTable = $this->fetchTable('SsmsBranch');

    $branch = $BranchTable->find()
        ->where([
            'branch_id' => $branchId,
            'ssms_client_code' => $clientCode,
        ])
        ->first();

    if (!$branch) {
        return $this->response
            ->withType('application/json')
            ->withStatus(404)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Branch not found',
            ]));
    }

    $duplicate = $BranchTable->find()
        ->where([
            'branch_name' => trim((string)($data['branch_name'] ?? '')),
            'ssms_client_code' => $clientCode,
            'branch_id !=' => $branchId,
        ])
        ->first();

    if ($duplicate) {
        return $this->response
            ->withType('application/json')
            ->withStatus(409)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Another branch with same name already exists',
            ]));
    }

    $branch = $BranchTable->patchEntity($branch, [
        'branch_name' => trim((string)($data['branch_name'] ?? $branch->branch_name)),
        'branch_address' => trim((string)($data['branch_address'] ?? $branch->branch_address)),
    ]);

    try {
        $BranchTable->saveOrFail($branch);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Branch updated successfully',
            ]));
    } catch (\Throwable $e) {
        Log::error('updateBranch failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to update branch',
            ]));
    }
}

/**
 * DELETE /api/branches/:branchId
 */
public function deleteBranch($branchId = null)
{
    $this->request->allowMethod(['delete']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');

    if (empty($branchId)) {
        throw new NotFoundException('Branch ID is required');
    }

    $BranchTable = $this->fetchTable('SsmsBranch');

    $branch = $BranchTable->find()
        ->where([
            'branch_id' => $branchId,
            'ssms_client_code' => $clientCode,
        ])
        ->first();

    if (!$branch) {
        return $this->response
            ->withType('application/json')
            ->withStatus(404)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Branch not found',
            ]));
    }

    try {
        $BranchTable->deleteOrFail($branch);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Branch deleted successfully',
            ]));
    } catch (\Throwable $e) {
        Log::error('deleteBranch failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to delete branch',
            ]));
    }
}
    
    //Class setup functions

public function getClasses()
{
    $this->request->allowMethod(['get']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');

    $ClassTable = $this->fetchTable('SsmsClasses');
    Log::error('$clientCode in getClasses: '. $clientCode );

    $classes = $ClassTable->find()
        ->select([
            'class_id',
            'class_name',
            'class_description',
        ])
        ->where([
            'ssms_client_code' => $clientCode,
        ])
        ->orderBy([
            'class_name' => 'ASC',
        ])
        ->enableHydration(false)
        ->toArray();

    return $this->response
        ->withType('application/json')
        ->withStringBody(json_encode([
            'status' => true,
            'data' => $classes,
        ]));
}

/**
 * POST /api/branches
 */
public function createClass()
{
    $this->request->allowMethod(['post']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $data = $this->request->getData();

    $className = trim((string)($data['class_name'] ?? ''));
    $classDesc = trim((string)($data['class_description'] ?? ''));

    if (empty($className)) {
        return $this->response
            ->withType('application/json')
            ->withStatus(422)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Class name is required',
            ]));
    }

    $classTable = $this->fetchTable('SsmsClasses');

    $existing = $classTable->find()
        ->where([
            'ssms_client_code' => $clientCode,
            'class_name' => $className,
        ])
        ->first();

    if ($existing) {
        return $this->response
            ->withType('application/json')
            ->withStatus(409)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Class already exists',
            ]));
    }

    $entity = $classTable->newEntity([
        'class_name' => $className,
        'class_description' => $classDesc,
        'ssms_client_code' => $clientCode,
    ]);

    try {
        $classTable->saveOrFail($entity);

        // Auto-create default section "A" for the new class
        $sectionTable  = $this->fetchTable('SsmsSections');
        $sectionEntity = $sectionTable->newEntity([
            'section_name'     => 'A',
            'class_id'         => $entity->class_id,
            'capacity'         => 50,
            'ssms_client_code' => $clientCode,
        ]);
        $sectionTable->save($sectionEntity); // soft-fail: class is still saved even if this fails

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Class created successfully',
                'data' => [
                    'class_id'          => $entity->class_id,
                    'class_name'        => $entity->class_name,
                    'class_description' => $entity->class_description,
                ],
            ]));
    } catch (\Throwable $e) {
        Log::error('create class failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to create class',
            ]));
    }
}

/**
 * PUT /api/branches/:classId
 */
public function updateClass($classId = null)
{
    $this->request->allowMethod(['put', 'patch']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $data = $this->request->getData();

    if (empty($classId)) {
        throw new NotFoundException('Class ID is required');
    }

    $classTable = $this->fetchTable('SsmsClasses');

    $class = $classTable->find()
        ->where([
            'class_id' => $classId,
            'ssms_client_code' => $clientCode,
        ])
        ->first();

    if (!$class) {
        return $this->response
            ->withType('application/json')
            ->withStatus(404)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Class not found',
            ]));
    }

    $duplicate = $classTable->find()
        ->where([
            'class_name' => trim((string)($data['class_name'] ?? '')),
            'ssms_client_code' => $clientCode,
            'class_id !=' => $classId,
        ])
        ->first();

    if ($duplicate) {
        return $this->response
            ->withType('application/json')
            ->withStatus(409)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Another class with same name already exists',
            ]));
    }

    $class = $classTable->patchEntity($class, [
        'class_name' => trim((string)($data['class_name'] ?? $branch->class_name)),
        'class_description' => trim((string)($data['class_description'] ?? $branch->class_description)),
    ]);

    try {
        $classTable->saveOrFail($class);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Class updated successfully',
            ]));
    } catch (\Throwable $e) {
        Log::error('updateClass failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to update class',
            ]));
    }
}

/**
 * DELETE /api/branches/:classId
 */
public function deleteClass($classId = null)
{
    $this->request->allowMethod(['delete']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');

    if (empty($classId)) {
        throw new NotFoundException('Branch ID is required');
    }
     $enrollmentTable = $this->fetchTable('SsmsStudentEnrollment');

     $classInenrollmentTable = $enrollmentTable->find()
        ->where([
            'ssms_client_code' => $clientCode,
            'class_id' => $classId,
        ])
        ->count();

     if ($classInenrollmentTable > 0) {

        return $this->response
            ->withType('application/json')
            ->withStatus(402)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Class is in use, can not be deleted.',
            ]));
          Log::error('Class is use: ' .  ($classInenrollmentTable));

    }
    
    
    $classTable = $this->fetchTable('SsmsClasses');

    $class = $classTable->find()
        ->where([
            'class_id' => $classId,
            'ssms_client_code' => $clientCode,
        ])
        ->first();

    if (!$class) {
        return $this->response
            ->withType('application/json')
            ->withStatus(404)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Class not found',
            ]));
    }

    try {
        $classTable->deleteOrFail($class);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Class deleted successfully',
            ]));
    } catch (\Throwable $e) {
        Log::error('Delete Class failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to delete Class',
            ]));
    }
}
    
    
public function getSections()
{
    $this->request->allowMethod(['get']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $classId    = $this->request->getQuery('class_id');

    $SectionsTable = $this->fetchTable('SsmsSections');

    $conditions = ['SsmsSections.ssms_client_code' => $clientCode];
    if (!empty($classId)) {
        $conditions['SsmsSections.class_id'] = (int)$classId;
    }

    $sections = $SectionsTable->find()
        ->select([
            'section_id' => 'SsmsSections.section_id',
            'section_name' => 'SsmsSections.section_name',
            'capacity' => 'SsmsSections.capacity',
            'class_id' => 'SsmsSections.class_id',
            'staff_id' => 'SsmsSections.staff_id',
            'first_name'=> 'SsmsStaff.first_name',
            'last_name'=> 'SsmsStaff.last_name',
            'class_name' => 'SsmsClasses.class_name',
        ])
        ->leftJoin(
            ['SsmsClasses' => 'ssms_classes'],
            ['SsmsClasses.class_id = SsmsSections.class_id']
        )
        ->leftJoin(
            ['SsmsStaff' => 'ssms_staff'],
            ['SsmsStaff.staff_id = SsmsSections.staff_id']
        )
        ->where($conditions)
        ->orderBy([
            'SsmsClasses.class_name' => 'ASC',
            'SsmsSections.section_name' => 'ASC',
        ])
        ->enableHydration(false)
        ->toArray();

    return $this->response
        ->withType('application/json')
        ->withStringBody(json_encode([
            'status' => true,
            'data' => $sections,
        ]));
}

/**
 * POST /api/branches
 */
public function createSection()
{
    $this->request->allowMethod(['post']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $data = $this->request->getData();

    $SectionName = trim((string)($data['section_name'] ?? ''));
    $classId = trim((string)($data['class_id'] ?? ''));
    $capacity = trim((string)($data['capacity'] ?? ''));

    if (empty($SectionName)) {
        return $this->response
            ->withType('application/json')
            ->withStatus(422)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Section name is required',
            ]));
    }

    $SectionTable = $this->fetchTable('SsmsSections');

    $existing = $SectionTable->find()
        ->where([
            'ssms_client_code' => $clientCode,
            'section_name' => $SectionName,
            'class_id' => $classId,
        ])
        ->first();

    if ($existing) {
        return $this->response
            ->withType('application/json')
            ->withStatus(409)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Section already exists for the selected class',
            ]));
    }

    $entity = $SectionTable->newEntity([
        'section_name' => $SectionName,
        'class_id' => $classId,
        'capacity' => $capacity,
        'ssms_client_code' => $clientCode,
    ]);
    Log::error('form $entity: ' . json_encode($entity));

    try {
        $SectionTable->saveOrFail($entity);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Section created successfully',
                'data' => [
                    'section_id' => $entity->section_id,
                    'section_name' => $entity->section_name,
                    'capacity' => $entity->Section_description,
                ],
            ]));
    } catch (\Throwable $e) {
        Log::error('create Section failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to create Section',
            ]));
    }
}

/**
 * PUT /api/branches/:SectionId
 */
public function updateSection($SectionId = null)
{
    $this->request->allowMethod(['put', 'patch']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $data = $this->request->getData();

    if (empty($SectionId)) {
        throw new NotFoundException('Section ID is required');
    }

    $SectionTable = $this->fetchTable('SsmsSections');

    $Section = $SectionTable->find()
        ->where([
            'section_id' => $SectionId,
            'ssms_client_code' => $clientCode,
        ])
        ->first();

    if (!$Section) {
        return $this->response
            ->withType('application/json')
            ->withStatus(404)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Section not found',
            ]));
    }

    $duplicate = $SectionTable->find()
        ->where([
            'section_name' => trim((string)($data['section_name'] ?? '')),
            'ssms_client_code' => $clientCode,
            'section_id !=' => $SectionId,
        ])
        ->first();

    if ($duplicate) {
        return $this->response
            ->withType('application/json')
            ->withStatus(409)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Another Section with same name already exists',
            ]));
    }

    $Section = $SectionTable->patchEntity($Section, [
        'section_name' => trim((string)($data['section_name'] ?? $Section->section_name)),
        'capacity' => trim((string)($data['capacity'] ?? $Section->capacity)),
        'staff_id' => trim((string)($data['staff_id'] ?? $Section->staff_id)),

    ]);

    try {
        $SectionTable->saveOrFail($Section);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Section updated successfully',
            ]));
    } catch (\Throwable $e) {
        Log::error('updateSection failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to update Section',
            ]));
    }
}

/**
 * DELETE /api/branches/:SectionId
 */
public function deleteSection($SectionId = null)
{
    $this->request->allowMethod(['delete']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');

    if (empty($SectionId)) {
        throw new NotFoundException('Section ID is required');
    }
     $enrollmentTable = $this->fetchTable('SsmsStudentEnrollment');

     $SectionInenrollmentTable = $enrollmentTable->find()
        ->where([
            'ssms_client_code' => $clientCode,
            'section_id' => $SectionId,
        ])
        ->first();

     if ($SectionInenrollmentTable) {

        return $this->response
            ->withType('application/json')
            ->withStatus(402)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Section is in use, can not be deleted.',
            ]));
          Log::error('Section is use: ' .  ($SectionInenrollmentTable));

    }
    
    
    $SectionTable = $this->fetchTable('SsmsSections');

    $Section = $SectionTable->find()
        ->where([
            'section_id' => $SectionId,
            'ssms_client_code' => $clientCode,
        ])
        ->first();

    if (!$Section) {
        return $this->response
            ->withType('application/json')
            ->withStatus(404)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Section not found',
            ]));
    }

    try {
        $SectionTable->deleteOrFail($Section);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'Section deleted successfully',
            ]));
    } catch (\Throwable $e) {
        Log::error('Delete Section failed: ' . $e->getMessage());

        return $this->response
            ->withType('application/json')
            ->withStatus(500)
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'Failed to delete Section',
            ]));
    }
}
    // ══════════════════════════════════════════════════════════════════════════
    // SESSIONS
    // ══════════════════════════════════════════════════════════════════════════
 
    /**
     * GET /SetupServiceApi/getSessions
     * Returns all sessions for the current client.
     */
    public function getSessions(): void
    {
        $this->request->allowMethod(['get']);
 
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }
 
        $db = $this->getTableLocator()->get('SsmsSessions')->getConnection();
 
        $sessions = $db->execute(
            "SELECT session_id, session_name, is_current, active, ssms_client_code
             FROM   ssms_sessions
             WHERE  ssms_client_code = ?
             ORDER  BY session_id DESC",
            [$clientCode]
        )->fetchAll('assoc');
 
        $this->jsonOk(['data' => $sessions]);
    }
 
    /**
     * POST /SetupServiceApi/createSession
     * Create a new session. Admin / owner only.
     */
    public function createSession(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }
 
        $clientCode  = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }
 
        $body        = $this->request->getData();
        $sessionName = trim((string)($body['session_name'] ?? ''));
        $isCurrent   = trim((string)($body['is_current']   ?? 'N'));
        $active      = trim((string)($body['active']       ?? 'Yes'));
 
        if (empty($sessionName)) {
            $this->jsonError(422, 'session_name is required.');
            return;
        }
 
        // Validate values
        if (!in_array($isCurrent, ['Y', 'N'], true)) $isCurrent = 'N';
        if (!in_array($active, ['Yes', 'No'], true))  $active    = 'Yes';
 
        $db = $this->getTableLocator()->get('SsmsSessions')->getConnection();
 
        // Check duplicate name
        $dup = $db->execute(
            "SELECT session_id FROM ssms_sessions WHERE session_name = ? AND ssms_client_code = ?",
            [$sessionName, $clientCode]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, "A session named \"{$sessionName}\" already exists."); return; }
 
        // If marking as current, unset other current sessions first
        if ($isCurrent === 'Y') {
            $db->execute(
                "UPDATE ssms_sessions SET is_current = 'N' WHERE ssms_client_code = ?",
                [$clientCode]
            );
        }
 
        $db->execute(
            "INSERT INTO ssms_sessions (session_name, is_current, active, ssms_client_code)
             VALUES (?, ?, ?, ?)",
            [$sessionName, $isCurrent, $active, $clientCode]
        );
 
        $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;
 
        Log::info("createSession: [{$clientCode}] id={$newId} name={$sessionName}");
        $this->jsonOk(['message' => 'Session created successfully.', 'session_id' => $newId]);
    }
 
    /**
     * PUT /SetupServiceApi/updateSession/:id
     * Update an existing session. Admin / owner only.
     */
    public function updateSession(?int $id = null): void
    {
        $this->request->allowMethod(['put', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }
 
        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }
 
        $body        = $this->request->getData();
        $sessionName = trim((string)($body['session_name'] ?? ''));
        $isCurrent   = trim((string)($body['is_current']   ?? 'N'));
        $active      = trim((string)($body['active']       ?? 'Yes'));
 
        if (empty($sessionName)) { $this->jsonError(422, 'session_name is required.'); return; }
        if (!in_array($isCurrent, ['Y', 'N'], true)) $isCurrent = 'N';
        if (!in_array($active, ['Yes', 'No'], true))  $active    = 'Yes';
 
        $db = $this->getTableLocator()->get('SsmsSessions')->getConnection();
 
        // Verify ownership
        $existing = $db->execute(
            "SELECT session_id FROM ssms_sessions WHERE session_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Session not found.'); return; }
 
        // Check duplicate name (excluding self)
        $dup = $db->execute(
            "SELECT session_id FROM ssms_sessions WHERE session_name = ? AND ssms_client_code = ? AND session_id != ?",
            [$sessionName, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, "A session named \"{$sessionName}\" already exists."); return; }
 
        // If marking as current, unset others
        if ($isCurrent === 'Y') {
            $db->execute(
                "UPDATE ssms_sessions SET is_current = 'N' WHERE ssms_client_code = ? AND session_id != ?",
                [$clientCode, $id]
            );
        }
 
        $db->execute(
            "UPDATE ssms_sessions
             SET    session_name = ?, is_current = ?, active = ?
             WHERE  session_id = ? AND ssms_client_code = ?",
            [$sessionName, $isCurrent, $active, $id, $clientCode]
        );
 
        Log::info("updateSession: [{$clientCode}] id={$id} name={$sessionName}");
        $this->jsonOk(['message' => 'Session updated successfully.', 'session_id' => $id]);
    }
 
    /**
     * DELETE /SetupServiceApi/deleteSession/:id
     * Delete a session — blocked if referenced by enrollments or fee records.
     * Admin / owner only.
     */
    public function deleteSession(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner access required.'); return; }
 
        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }
 
        $db = $this->getTableLocator()->get('SsmsSessions')->getConnection();
 
        // Verify ownership
        $existing = $db->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE session_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Session not found.'); return; }
 
        // Block if used in student enrollments
        $enrollCount = (int)$db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_student_enrollment WHERE session_id = ?",
            [$id]
        )->fetchAssoc()['cnt'];
        if ($enrollCount > 0) {
            $this->jsonError(409,
                "Cannot delete: {$enrollCount} student enrollment(s) use this session."
            );
            return;
        }
 
        // Block if used in fee structure
        $feeCount = (int)$db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_fee_structure WHERE session_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc()['cnt'];
        if ($feeCount > 0) {
            $this->jsonError(409,
                "Cannot delete: {$feeCount} fee structure record(s) use this session."
            );
            return;
        }
 
        $db->execute(
            "DELETE FROM ssms_sessions WHERE session_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );
 
        Log::info("deleteSession: [{$clientCode}] id={$id} name={$existing['session_name']}");
        $this->jsonOk(['message' => 'Session deleted successfully.']);
    }
    
}
