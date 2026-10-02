<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

/**
 * StaffServiceApiController
 * File: src/Controller/StaffServiceApiController.php
 *
 * Routes to add in config/routes.php:
 *   $builder->get('/StaffServiceApi/getStaff',                ['controller'=>'StaffServiceApi','action'=>'getStaff']);
 *   $builder->get('/StaffServiceApi/getStaffById/:id',         ['controller'=>'StaffServiceApi','action'=>'getStaffById'])->setPass(['id']);
 *   $builder->get('/StaffServiceApi/getStaffCategories',       ['controller'=>'StaffServiceApi','action'=>'getStaffCategories']);
 *   $builder->post('/StaffServiceApi/saveStaffRegistration',   ['controller'=>'StaffServiceApi','action'=>'saveStaffRegistration']);
 *   $builder->post('/StaffServiceApi/updateStaffStatus/:id',   ['controller'=>'StaffServiceApi','action'=>'updateStaffStatus'])->setPass(['id']);
 *   $builder->delete('/StaffServiceApi/deleteStaff/:id',       ['controller'=>'StaffServiceApi','action'=>'deleteStaff'])->setPass(['id']);
 */
class StaffServiceApiController extends AppController
{
    private const UPLOAD_BASE    = "";
    private const UPLOAD_URL     = '/uploads/staff/';
    private const MAX_FILE_SIZE  = 5 * 1024 * 1024;
    private const ALLOWED_IMG    = ['image/jpeg', 'image/png', 'image/webp'];
    private const ALLOWED_DOC    = ['image/jpeg', 'image/png', 'application/pdf'];

    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->response = $this->response->withType('application/json');
    }

    private function getClientCode(): string
    {
        return $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? '';
    }

    private function isAdminOrOwner(): bool
    {
        $jwtRole    = strtolower(trim((string)$this->request->getAttribute('jwt_role')));
        $headerRole = strtolower(trim((string)$this->request->getHeaderLine('ssmsUserRole')));
        $role       = $jwtRole !== '' ? $jwtRole : $headerRole;
        return in_array($role, ['admin', 'owner'], true);
    }

    private function jsonOk(array $data): void
    {
        $this->set(array_merge(['status' => true], $data));
        $this->viewBuilder()->setOption('serialize',
            array_keys(array_merge(['status' => true], $data))
        );
    }

    private function jsonError(int $status, string $message): void
    {
        $this->response = $this->response->withStatus($status);
        $this->set(['status' => false, 'message' => $message]);
        $this->viewBuilder()->setOption('serialize', ['status', 'message']);
    }

    // =========================================================================
    // GET /StaffServiceApi/getHiredStaff
    // Returns all hired (active) staff with full details
    // =========================================================================
    public function getHiredStaff(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $branchId = $this->request->getQuery('branchId');
        $db       = $this->getTableLocator()->get('SsmsStaff')->getConnection();

        $sql  = "SELECT
                        s.staff_id, s.staff_title, s.first_name, s.last_name,
                        s.email_address, s.mobile_number, s.gender,
                        s.date_of_birth, s.address, s.state,
                        s.father_name, s.mother_name,
                        s.specialty, s.expected_salary, s.salary,
                        s.date_of_hiring, s.years_of_experience,
                        s.hired, s.resigned, s.resignation_date,
                        s.staff_photo, s.id_proof, s.address_proof, s.experience_letter,
                        s.category_id, s.branch_id, s.ssms_client_code,
                        sc.category_name,
                        b.branch_name,
                        CONCAT(COALESCE(s.staff_title,''), ' ', s.first_name, ' ', s.last_name) AS full_name
                 FROM   ssms_staff s
                 LEFT JOIN staff_category sc ON sc.category_id = s.category_id
                 LEFT JOIN ssms_branch  b  ON b.branch_id    = s.branch_id
                 WHERE  s.ssms_client_code = ?
                   AND  s.hired IN ('Y', 'Yes', 'yes')
                   AND  (s.resigned IS NULL OR TRIM(s.resigned) = '' OR LOWER(TRIM(s.resigned)) IN ('n', 'no'))";
        $bind = [$clientCode];

        if (!empty($branchId)) { $sql .= " AND s.branch_id = ?"; $bind[] = $branchId; }
        $sql .= " ORDER BY s.first_name ASC, s.last_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');

        // DEBUG — log first row keys to verify mobile_number is returned
        if (!empty($rows)) {
            Log::debug('getHiredStaff first row keys: ' . implode(', ', array_keys($rows[0])));
            Log::debug('getHiredStaff mobile_number: ' . ($rows[0]['mobile_number'] ?? 'NOT FOUND'));
        }

        $this->jsonOk(['data' => $rows, 'total' => count($rows)]);
    }

    // =========================================================================
    // GET /StaffServiceApi/getStaff
    // =========================================================================
    public function getStaff(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $branchId = $this->request->getQuery('branchId');
        $db       = $this->getTableLocator()->get('SsmsStaff')->getConnection();

        $sql  = "SELECT s.staff_id, s.staff_title, s.first_name, s.last_name,
                        CONCAT(COALESCE(s.staff_title,''), ' ', s.first_name, ' ', s.last_name) AS full_name,
                        CONCAT(s.first_name, ' ', s.last_name, ' (', s.staff_id, ')') AS display_name,
                        s.email_address, s.mobile_number, s.gender, s.specialty,
                        s.hired, s.resigned, s.branch_id, s.staff_photo,
                        s.date_of_hiring, s.expected_salary,
                        sc.category_name
                 FROM   ssms_staff s
                 LEFT JOIN staff_category sc ON sc.category_id = s.category_id
                 WHERE  s.ssms_client_code = ?";
        $bind = [$clientCode];

        if (!empty($branchId)) { $sql .= " AND s.branch_id = ?"; $bind[] = $branchId; }
        $sql .= " ORDER BY s.first_name ASC, s.last_name ASC";

        $rows = $db->execute($sql, $bind)->fetchAll('assoc');
        $this->jsonOk(['data' => $rows]);
    }

    // =========================================================================
    // GET /StaffServiceApi/getStaffById/:id
    // =========================================================================
    public function getStaffById(?int $id = null): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db  = $this->getTableLocator()->get('SsmsStaff')->getConnection();
        $row = $db->execute(
            "SELECT s.*, sc.category_name
             FROM   ssms_staff s
             LEFT JOIN staff_category sc ON sc.category_id = s.category_id
             WHERE  s.staff_id = ? AND s.ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$row) { $this->jsonError(404, 'Staff member not found.'); return; }
        $this->jsonOk(['data' => $row]);
    }

    // =========================================================================
    // GET /StaffServiceApi/getStaffCategories
    // =========================================================================
    public function getStaffCategories(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $db   = $this->getTableLocator()->get('StaffCategory')->getConnection();
        $rows = $db->execute(
            "SELECT category_id, category_name
             FROM   staff_category
             WHERE  ssms_client_code = ? OR ssms_client_code IS NULL
             ORDER  BY category_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows]);
    }

    // =========================================================================
    // POST /StaffServiceApi/saveStaffRegistration
    // Multipart form — handles text + file uploads
    // Pass staff_id to update; omit to create
    // =========================================================================
    public function saveStaffRegistration(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) {
            $this->jsonError(403, 'Admin or owner access required.');
            return;
        }

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $data    = $this->request->getData();
        $files   = $this->request->getUploadedFiles();
        $staffId = !empty($data['staff_id']) ? (int)$data['staff_id'] : null;

        // Validation
        $firstName = trim((string)($data['first_name']     ?? ''));
        $lastName  = trim((string)($data['last_name']      ?? ''));
        $mobile    = trim((string)($data['mobile_number']  ?? ''));

        if (!$firstName) { $this->jsonError(422, 'first_name is required.');    return; }
        if (!$lastName)  { $this->jsonError(422, 'last_name is required.');     return; }
        if (!$mobile)    { $this->jsonError(422, 'mobile_number is required.'); return; }

        $db = $this->getTableLocator()->get('SsmsStaff')->getConnection();

        // File uploads
        $filePaths = [];
        $fileMap   = [
            'staff_photo'       => ['photos',            self::ALLOWED_IMG],
            'id_proof'          => ['id_proof',          self::ALLOWED_DOC],
            'address_proof'     => ['address_proof',     self::ALLOWED_DOC],
            'experience_letter' => ['experience_letter', self::ALLOWED_DOC],
        ];

        foreach ($fileMap as $field => [$subDir, $types]) {
            $file = $files[$field] ?? null;
            if (!$file || $file->getError() !== UPLOAD_ERR_OK) continue;

            if (!in_array($file->getClientMediaType(), $types, true)) {
                $this->jsonError(422, "Invalid file type for {$field}.");
                return;
            }
            if ($file->getSize() > self::MAX_FILE_SIZE) {
                $this->jsonError(422, "File too large for {$field}. Max 5MB.");
                return;
            }

            $ext  = strtolower(pathinfo($file->getClientFilename(), PATHINFO_EXTENSION));
            $name = uniqid('', true) . '.' . $ext;
            $dir  = "../../clients/". $clientCode . "/Staffs/";
            if (!is_dir($dir)) 
                mkdir($dir, 0755, true);
            $file->moveTo($dir . $name);
            $filePaths[$field] = $name;
        }

        // Build field set
        $fields = [
            'staff_title'         => trim((string)($data['staff_title']         ?? '')),
            'first_name'          => $firstName,
            'last_name'           => $lastName,
            'email_address'       => trim((string)($data['email_address']       ?? '')),
            'mobile_number'       => $mobile,
            'address'             => trim((string)($data['address']             ?? '')),
            'state'               => trim((string)($data['state']               ?? '')),
            'father_name'         => trim((string)($data['father_name']         ?? '')),
            'mother_name'         => trim((string)($data['mother_name']         ?? '')),
            'date_of_birth'       => !empty($data['date_of_birth'])       ? $data['date_of_birth']       : null,
            'gender'              => trim((string)($data['gender']              ?? '')),
            'date_of_hiring'      => !empty($data['date_of_hiring'])      ? $data['date_of_hiring']      : null,
            'years_of_experience' => isset($data['years_of_experience'])  ? (int)$data['years_of_experience'] : null,
            'specialty'           => trim((string)($data['specialty']           ?? '')),
            'expected_salary'     => !empty($data['expected_salary'])     ? (float)$data['expected_salary'] : null,
            'category_id'         => !empty($data['category_id'])        ? (int)$data['category_id']    : null,
            'hired'               => (($data['hired']    ?? 'Y') === 'Y') ? 'Y' : 'N',
            'resigned'            => (($data['resigned'] ?? 'N') === 'Y') ? 'Y' : 'N',
            'resignation_date'    => !empty($data['resignation_date'])    ? $data['resignation_date']    : null,
            'branch_id'           => !empty($data['branch_id'])          ? (int)$data['branch_id']      : null,
            'ssms_client_code'    => $clientCode,
        ];

        foreach ($filePaths as $field => $path) { $fields[$field] = $path; }

        if ($staffId) {
            // UPDATE
            $existing = $db->execute(
                "SELECT staff_id FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?",
                [$staffId, $clientCode]
            )->fetchAssoc();
            if (!$existing) { $this->jsonError(404, 'Staff member not found.'); return; }

            $fields['modified'] = date('Y-m-d H:i:s');
            unset($fields['ssms_client_code']);

            $setClauses = array_map(fn($k) => "{$k} = ?", array_keys($fields));
            $values     = [...array_values($fields), $staffId, $clientCode];

            $db->execute(
                "UPDATE ssms_staff SET " . implode(', ', $setClauses) .
                " WHERE staff_id = ? AND ssms_client_code = ?",
                $values
            );

            Log::info("updateStaff [{$clientCode}] id={$staffId}");
            $this->jsonOk(['message' => 'Staff updated successfully.', 'staff_id' => $staffId]);
        } else {
            // INSERT
            $fields['created']  = date('Y-m-d H:i:s');
            $fields['modified'] = date('Y-m-d H:i:s');

            $cols  = array_keys($fields);
            $vals  = array_values($fields);
            $phs   = array_fill(0, count($cols), '?');

            $db->execute(
                "INSERT INTO ssms_staff (" . implode(', ', $cols) . ")
                 VALUES (" . implode(', ', $phs) . ")",
                $vals
            );
            $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

            Log::info("createStaff [{$clientCode}] id={$newId} {$firstName} {$lastName}");
            $this->jsonOk(['message' => 'Staff registered successfully.', 'staff_id' => $newId]);
        }
    }

    // =========================================================================
    // POST /StaffServiceApi/updateStaffStatus/:id
    // =========================================================================
    public function updateStaffStatus(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $data   = $this->request->getData();
        $db     = $this->getTableLocator()->get('SsmsStaff')->getConnection();
        $fields = [];

        if (isset($data['hired']))            $fields['hired']            = $data['hired']           === 'Y' ? 'Y' : 'N';
        if (isset($data['resigned']))         $fields['resigned']         = $data['resigned']        === 'Y' ? 'Y' : 'N';
        if (array_key_exists('resignation_date', $data)) $fields['resignation_date'] = $data['resignation_date'] ?: null;
        $fields['modified'] = date('Y-m-d H:i:s');

        $setClauses = array_map(fn($k) => "{$k} = ?", array_keys($fields));
        $values     = [...array_values($fields), $id, $clientCode];

        $db->execute(
            "UPDATE ssms_staff SET " . implode(', ', $setClauses) .
            " WHERE staff_id = ? AND ssms_client_code = ?",
            $values
        );

        $this->jsonOk(['message' => 'Staff status updated.']);
    }

    // =========================================================================
    // GET /StaffServiceApi/getHiringList
    // Returns all registered staff with hiring status for admin review
    // =========================================================================
    public function getHiringList(): void
    {
        $this->request->allowMethod(['get']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $db   = $this->getTableLocator()->get('SsmsStaff')->getConnection();
        $rows = $db->execute(
            "SELECT s.staff_id, s.staff_title, s.first_name, s.last_name,
                    s.email_address, s.mobile_number, s.gender,
                    s.date_of_birth, s.address, s.state,
                    s.father_name, s.mother_name,
                    s.specialty, s.expected_salary, s.salary, s.date_of_hiring,
                    s.hired, s.resigned, s.resignation_date,
                    s.staff_photo, s.years_of_experience,
                    s.branch_id, s.category_id,
                    sc.category_name,
                    b.branch_name,
                    (SELECT COUNT(*) FROM sawera_ssms_users u
                     WHERE u.ssms_client_code = s.ssms_client_code
                       AND LOWER(u.ssms_user_name) = LOWER(CONCAT(s.first_name, '.', s.last_name))
                    ) AS has_account
             FROM   ssms_staff s
             LEFT JOIN staff_category sc ON sc.category_id = s.category_id
             LEFT JOIN ssms_branch  b  ON b.branch_id    = s.branch_id
             WHERE  s.ssms_client_code = ?
             ORDER  BY s.hired ASC, s.first_name ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows]);
    }

    // =========================================================================
    // POST /StaffServiceApi/updateHiringDetails/:id
    // Updates hiring details. If hired=Y and no account exists, creates one
    // and sends welcome email.
    // =========================================================================
    public function updateHiringDetails(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $body = $this->request->getData();
        $db   = $this->getTableLocator()->get('SsmsStaff')->getConnection();

        // Fetch existing staff record
        $staff = $db->execute(
            "SELECT s.*, b.branch_name
             FROM   ssms_staff s
             LEFT JOIN ssms_branch b ON b.branch_id = s.branch_id
             WHERE  s.staff_id = ? AND s.ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$staff) { $this->jsonError(404, 'Staff member not found.'); return; }

        // Build update fields
        $fields = ['modified' => date('Y-m-d H:i:s')];

        if (array_key_exists('date_of_hiring',  $body)) $fields['date_of_hiring']  = $body['date_of_hiring']  ?: null;
        if (array_key_exists('expected_salary', $body)) $fields['expected_salary'] = !empty($body['expected_salary']) ? (float)$body['expected_salary'] : null;
        if (array_key_exists('salary',          $body)) $fields['salary']          = !empty($body['salary'])          ? (float)$body['salary']          : null;
        if (array_key_exists('branch_id',       $body)) $fields['branch_id']       = !empty($body['branch_id'])       ? (int)$body['branch_id']         : null;
        if (array_key_exists('hired',           $body)) $fields['hired']           = $body['hired']           === 'Y' ? 'Y' : 'N';
        if (array_key_exists('resigned',        $body)) $fields['resigned']        = $body['resigned']        === 'Y' ? 'Y' : 'N';
        if (array_key_exists('resignation_date',$body)) $fields['resignation_date']= $body['resignation_date'] ?: null;

        // Persist update
        $setClauses = array_map(fn($k) => "{$k} = ?", array_keys($fields));
        $values     = [...array_values($fields), $id, $clientCode];
        $db->execute(
            "UPDATE ssms_staff SET " . implode(', ', $setClauses) .
            " WHERE staff_id = ? AND ssms_client_code = ?",
            $values
        );

        $accountCreated = false;
        $emailSent      = false;
        $tempPassword   = null;
        $username       = null;

        // ── Create user account when marked as hired ──────────────────────────
        if (($fields['hired'] ?? $staff['hired']) === 'Y') {

            // Check if account already exists
            $firstName = strtolower(trim($staff['first_name']));
            $lastName  = strtolower(trim($staff['last_name']));
            $username  = $firstName . '.' . $lastName;
            $email     = trim($staff['email_address'] ?? '');

            $existingUser = $db->execute(
                "SELECT ssms_user_name FROM sawera_ssms_users
                 WHERE (LOWER(ssms_user_name) = LOWER(?) OR LOWER(ssms_user_email) = LOWER(?))
                   AND ssms_client_code = ?",
                [$username, $email, $clientCode]
            )->fetchAssoc();

            if (!$existingUser && !empty($email)) {
                // Generate temp password
                $tempPassword = ucfirst($firstName) . '@' . rand(1000, 9999);
                $hashedPw     = password_hash($tempPassword, PASSWORD_DEFAULT);
                $now          = date('Y-m-d H:i:s');
                $fullName     = trim(($staff['staff_title'] ? $staff['staff_title'] . ' ' : '') .
                                $staff['first_name'] . ' ' . $staff['last_name']);

                $db->execute(
                    "INSERT INTO sawera_ssms_users
                        (ssms_user_name, ssms_user_firstname, ssms_user_lastname,
                         ssms_user_email, ssms_user_password, ssms_user_role,
                         ssms_user_status, ssms_client_code, branch_id, created, modified)
                     VALUES (?, ?, ?, ?, ?, 'Teacher', 'active', ?, ?, ?, ?)",
                    [
                        $username,
                        $staff['first_name'],
                        $staff['last_name'],
                        $email,
                        $hashedPw,
                        $clientCode,
                        $staff['branch_id'] ?? null,
                        $now,
                        $now,
                    ]
                );
                $accountCreated = true;

                // Send welcome email using existing sendWelcomeEmail helper
                // Delegate to UserServiceApiController via internal call
                try {
                    $mailer = new \Cake\Mailer\Mailer('default');
                    $mailer
                        ->setEmailFormat('both')
                        ->setTo($email, $fullName)
                        ->setFrom(
                            env('MAIL_FROM_ADDRESS', 'admin@sawera.info'),
                            env('MAIL_FROM_NAME',    'School Management System')
                        )
                        ->setSubject('Welcome — Your Staff Account Has Been Created')
                        ->setViewVars([
                            'fullName'     => $fullName,
                            'username'     => $username,
                            'tempPassword' => $tempPassword,
                            'loginUrl'     => env('APP_URL', 'https://sawera.info/ssms/'),
                        ]);
                    $mailer->viewBuilder()
                        ->setTemplate('welcome_user')
                        ->setLayout('default');
                    $mailer->send();
                    $emailSent = true;
                } catch (\Exception $e) {
                    Log::error("Staff welcome email failed for {$email}: " . $e->getMessage());
                }

                Log::info("Staff hired: [{$clientCode}] staff_id={$id} username={$username} email_sent=" . ($emailSent ? 'YES' : 'NO'));
            }
        }

        $message = 'Hiring details updated successfully.';
        if ($accountCreated) $message .= " User account created (username: {$username}).";
        if ($accountCreated && $emailSent)  $message .= ' Welcome email sent.';
        if ($accountCreated && !$emailSent) $message .= ' Note: welcome email could not be sent — please share credentials manually.';

        $this->jsonOk([
            'message'        => $message,
            'account_created'=> $accountCreated,
            'email_sent'     => $emailSent,
            'username'       => $username,
        ]);
    }

    // =========================================================================
    // POST /StaffServiceApi/createStaffCategory
    // =========================================================================
    public function createStaffCategory(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode    = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(401, 'Unauthorized.'); return; }

        $categoryName  = trim((string)($this->request->getData('category_name') ?? ''));
        if (!$categoryName) { $this->jsonError(422, 'category_name is required.'); return; }

        $db = $this->getTableLocator()->get('StaffCategory')->getConnection();

        // Duplicate check
        $dup = $db->execute(
            "SELECT category_id FROM staff_category
             WHERE LOWER(category_name) = LOWER(?) AND ssms_client_code = ?",
            [$categoryName, $clientCode]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, "Category \"{$categoryName}\" already exists."); return; }

        $db->execute(
            "INSERT INTO staff_category (category_name, ssms_client_code) VALUES (?, ?)",
            [$categoryName, $clientCode]
        );
        $newId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createStaffCategory [{$clientCode}] id={$newId} name={$categoryName}");
        $this->jsonOk(['message' => 'Category created successfully.', 'category_id' => $newId]);
    }

    // =========================================================================
    // POST /StaffServiceApi/updateStaffCategory/:id
    // =========================================================================
    public function updateStaffCategory(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode   = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $categoryName = trim((string)($this->request->getData('category_name') ?? ''));
        if (!$categoryName) { $this->jsonError(422, 'category_name is required.'); return; }

        $db = $this->getTableLocator()->get('StaffCategory')->getConnection();

        $existing = $db->execute(
            "SELECT category_id FROM staff_category WHERE category_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Category not found.'); return; }

        // Duplicate check excluding self
        $dup = $db->execute(
            "SELECT category_id FROM staff_category
             WHERE LOWER(category_name) = LOWER(?) AND ssms_client_code = ? AND category_id != ?",
            [$categoryName, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, "Category \"{$categoryName}\" already exists."); return; }

        $db->execute(
            "UPDATE staff_category SET category_name = ? WHERE category_id = ? AND ssms_client_code = ?",
            [$categoryName, $id, $clientCode]
        );

        Log::info("updateStaffCategory [{$clientCode}] id={$id} name={$categoryName}");
        $this->jsonOk(['message' => 'Category updated successfully.', 'category_id' => $id]);
    }

    // =========================================================================
    // DELETE /StaffServiceApi/deleteStaffCategory/:id
    // Blocked if any staff is assigned to this category
    // =========================================================================
    public function deleteStaffCategory(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db = $this->getTableLocator()->get('StaffCategory')->getConnection();

        $existing = $db->execute(
            "SELECT category_id, category_name FROM staff_category
             WHERE category_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Category not found.'); return; }

        // Block if staff assigned to this category
        $count = (int)$db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_staff WHERE category_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc()['cnt'];
        if ($count > 0) {
            $this->jsonError(409, "Cannot delete: {$count} staff member(s) use this category.");
            return;
        }

        $db->execute(
            "DELETE FROM staff_category WHERE category_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteStaffCategory [{$clientCode}] id={$id} name={$existing['category_name']}");
        $this->jsonOk(['message' => 'Category deleted successfully.']);
    }

    // =========================================================================
    // DELETE /StaffServiceApi/deleteStaff/:id
    // =========================================================================
    public function deleteStaff(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $db       = $this->getTableLocator()->get('SsmsStaff')->getConnection();
        $existing = $db->execute(
            "SELECT staff_id, first_name, last_name FROM ssms_staff
             WHERE staff_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();

        if (!$existing) { $this->jsonError(404, 'Staff member not found.'); return; }

        $count = (int)$db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_sections WHERE staff_id = ?", [$id]
        )->fetchAssoc()['cnt'];

        if ($count > 0) {
            $this->jsonError(409, "Cannot delete: staff assigned to {$count} section(s).");
            return;
        }

        $db->execute(
            "DELETE FROM ssms_staff WHERE staff_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteStaff [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Staff deleted successfully.']);
    }
}