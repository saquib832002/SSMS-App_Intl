<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Controller\Controller;
use Cake\Datasource\ConnectionManager;
use Cake\Event\EventInterface;
use Cake\Log\Log;
use Cake\Mailer\Mailer;
use App\Service\Trials;

/**
 * SsmsClients Controller
 *
 * @property \App\Model\Table\SsmsClientsTable $SsmsClients
 */
class SsmsClientsController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
    }

    public function landing(): void
    {
        $this->viewBuilder()->disableAutoLayout();
    }

    public function privacyPolicy(): void
    {
        $this->viewBuilder()->disableAutoLayout();
    }

    public function beforeFilter(EventInterface $event): void
    {
        parent::beforeFilter($event); // sets ['login','logout'] — we extend it below
        $this->Authentication->allowUnauthenticated([
            'login', 'logout',
            'landing',
            'privacyPolicy',
            'clientRegistration',
            'verifyRegistrationCode',
            'sendRegistrationCode',
        ]);
    }

    // =========================================================================
    // Existing CRUD actions
    // =========================================================================

    public function index()
    {
        $session  = $this->request->getSession();
        $userRole = strtolower(trim((string)$session->read('ssms_user_role')));

        if (!in_array($userRole, ['admin', 'owner'])) {
            $this->Flash->error(__('You are not authorized to view this page.'));
            return $this->redirect(['controller' => 'Dashboards', 'action' => 'index']);
        }

        $clientCode  = $session->read('ssms_client_code');
        $query       = $this->SsmsClients->find()->where(['ssms_client_code' => $clientCode]);
        $ssmsClients = $this->paginate($query);
        $this->set(compact('ssmsClients'));
    }

    public function view($id = null)
    {
        $ssmsClient = $this->SsmsClients->get($id, contain: []);
        $connection = ConnectionManager::get('default');

        // Classes with per-section student counts for this client
        $classSectionStats = $connection->execute(
            "SELECT
                cl.class_id, cl.class_name,
                sec.section_id, sec.section_name,
                COUNT(DISTINCT se.registration_id) AS student_count
             FROM ssms_classes cl
             LEFT JOIN ssms_sections sec
                    ON sec.class_id = cl.class_id
                   AND sec.ssms_client_code = cl.ssms_client_code
             LEFT JOIN ssms_student_enrollment se
                    ON se.class_id = cl.class_id
                   AND se.section_id = sec.section_id
                   AND se.ssms_client_code = cl.ssms_client_code
                   AND (se.status = 'active' OR se.status IS NULL)
             WHERE cl.ssms_client_code = ?
             GROUP BY cl.class_id, cl.class_name, sec.section_id, sec.section_name
             ORDER BY cl.class_name ASC, sec.section_name ASC",
            [$id]
        )->fetchAll('assoc');

        // Group by class for easier rendering
        $classSections = [];
        foreach ($classSectionStats as $row) {
            $cid = $row['class_id'];
            if (!isset($classSections[$cid])) {
                $classSections[$cid] = ['class_name' => $row['class_name'], 'sections' => [], 'total' => 0];
            }
            if ($row['section_id']) {
                $classSections[$cid]['sections'][] = [
                    'section_name'  => $row['section_name'],
                    'student_count' => (int)$row['student_count'],
                ];
            }
            $classSections[$cid]['total'] += (int)$row['student_count'];
        }

        $this->set(compact('ssmsClient', 'classSections'));
    }

    public function add()
    {
        $session = $this->request->getSession();
        if ($session->read('ssms_user_role') == 'superuser') {
            $ssmsClient = $this->SsmsClients->newEmptyEntity();
            if ($this->request->is('post')) {
                $ssmsClient->ssms_client_code    = $this->request->getData('ssms_client_code');
                $ssmsClient->ssms_client_address = $this->request->getData('ssms_client_address');
                $ssmsClient->branch_name         = $this->request->getData('ssms_client_address');
                $ssmsClient->ssms_client_city    = $this->request->getData('ssms_client_city');
                $BranchState   = $this->request->getData('ssms_client_state');
                $BranchAddress = $ssmsClient->ssms_client_city . ' ' . $BranchState;
                $uploadedFile  = $this->request->getData('logo_name');
                $originalName  = $uploadedFile->getClientFilename();
                $safeName      = substr(time() . '_' . preg_replace('/[^a-zA-Z0-9.\-_]/', '_', $originalName), 0, 50);
                $ssmsClient->logo_name = $originalName;
                $data = $this->request->getData();
                unset($data['logo_name']);
                $ssmsClient = $this->SsmsClients->patchEntity($ssmsClient, $data);
                if ($this->SsmsClients->save($ssmsClient)) {
                    $connection = ConnectionManager::get('default');
                    $connection->execute(
                        "INSERT INTO ssms_branch (branch_name, branch_address, ssms_client_code) VALUES(?, ?, ?)",
                        [$ssmsClient->branch_name, $ssmsClient->ssms_client_address, $ssmsClient->ssms_client_code]
                    );
                    $path = $_SERVER['DOCUMENT_ROOT'] . "/" . "../clients/" . $ssmsClient->ssms_client_code;
                    mkdir($path, 0777, true);
                    $uploadPath = $_SERVER['DOCUMENT_ROOT'] . "/" . "../clients/" . $ssmsClient->ssms_client_code . "/" . $originalName;
                    $uploadedFile->moveTo($uploadPath);
                    $this->Flash->success(__('The client has been saved.'));
                    return $this->redirect(['action' => 'index']);
                }
                $this->Flash->error(__('The client could not be saved. Please, try again.'));
            }
            $this->set(compact('ssmsClient'));
        } else {
            $this->Flash->error(__('You are not authorized to add user.'));
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }
    }

    public function edit($id = null)
    {
        $ssmsClient = $this->SsmsClients->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsClient = $this->SsmsClients->patchEntity($ssmsClient, $this->request->getData());
            if ($this->SsmsClients->save($ssmsClient)) {
                $this->Flash->success(__('The ssms client has been saved.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms client could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsClient'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsClient = $this->SsmsClients->get($id);
        if ($this->SsmsClients->delete($ssmsClient)) {
            $this->Flash->success(__('The ssms client has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms client could not be deleted. Please, try again.'));
        }
        return $this->redirect(['action' => 'index']);
    }

    // =========================================================================
    // Module Access Manager — superuser grants/revokes modules per client
    // GET  /admin/clients/modules/:code  — show toggle UI
    // POST /admin/clients/modules/:code  — save changes
    // =========================================================================

    public function manageModules(string $clientCode = ''): void
    {
        $session = $this->request->getSession();
        if ($session->read('ssms_user_role') !== 'superuser') {
            $this->Flash->error('You are not authorized to manage module access.');
            $this->redirect(['controller' => 'Dashboards', 'action' => 'superuserDashboard']);
            return;
        }

        $db = ConnectionManager::get('default');

        // Verify client exists
        $client = $db->execute(
            "SELECT ssms_client_code, ssms_client_header_text FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetch('assoc');

        if (!$client) {
            $this->Flash->error('Client not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        // All available modules (extend this array as new modules are built)
        $allModules = [
            'school'   => [
                'label'    => 'School Management',
                'icon'     => 'bi-mortarboard-fill',
                'color'    => '#16a34a',
                'bg'       => '#f0fdf4',
                'border'   => '#86efac',
                'desc'     => 'Students, attendance, exams, timetable, staff, events, hostel, transport.',
                'lockable' => false, // can never be revoked
            ],
            'finance'  => [
                'label'    => 'Finance Management',
                'icon'     => 'bi-graph-up-arrow',
                'color'    => '#2563eb',
                'bg'       => '#eff6ff',
                'border'   => '#93c5fd',
                'desc'     => 'Fee management, income/expenses, payroll, budgets, banking, procurement, reports.',
                'lockable' => true,
            ],
            'library'  => [
                'label'    => 'Library Management',
                'icon'     => 'bi-book-fill',
                'color'    => '#d97706',
                'bg'       => '#fffbeb',
                'border'   => '#fde68a',
                'desc'     => 'Books catalogue, issue/return, members, fine management.',
                'lockable' => true,
            ],
            'donation' => [
                'label'    => 'Donation Management',
                'icon'     => 'bi-heart-fill',
                'color'    => '#db2777',
                'bg'       => '#fdf2f8',
                'border'   => '#f9a8d4',
                'desc'     => 'Donor registry, campaigns, receipts and donation reports.',
                'lockable' => true,
            ],
        ];

        if ($this->request->is('post')) {
            $submittedModules = (array)($this->request->getData('modules') ?? []);
            // Always keep 'school'
            $submittedModules[] = 'school';
            $submittedModules   = array_unique(array_intersect($submittedModules, array_keys($allModules)));

            // Fetch currently granted modules
            $currentRows    = $db->execute(
                "SELECT module_key FROM ssms_client_modules WHERE ssms_client_code = ?",
                [$clientCode]
            )->fetchAll('assoc');
            $currentModules = array_column($currentRows, 'module_key');

            $toGrant  = array_diff($submittedModules, $currentModules);
            $toRevoke = array_diff($currentModules, $submittedModules);
            $byUser   = $session->read('ssms_user_name');

            foreach ($toGrant as $mk) {
                $db->execute(
                    "INSERT IGNORE INTO ssms_client_modules (ssms_client_code, module_key, granted_at, granted_by) VALUES (?, ?, NOW(), ?)",
                    [$clientCode, $mk, $byUser]
                );
            }
            foreach ($toRevoke as $mk) {
                if ($mk === 'school') continue; // never revoke school
                $db->execute(
                    "DELETE FROM ssms_client_modules WHERE ssms_client_code = ? AND module_key = ?",
                    [$clientCode, $mk]
                );
            }

            Log::info("Module access updated for {$clientCode} by {$byUser}: granted=[" . implode(',', $toGrant) . "] revoked=[" . implode(',', $toRevoke) . "]");
            $this->Flash->success("Module access for {$client['ssms_client_header_text']} updated successfully.");
            $this->redirect(['action' => 'manageModules', $clientCode]);
            return;
        }

        // Fetch currently active modules for this client
        $activeRows    = $db->execute(
            "SELECT module_key, granted_at, granted_by FROM ssms_client_modules WHERE ssms_client_code = ?",
            [$clientCode]
        )->fetchAll('assoc');
        $activeModules = [];
        foreach ($activeRows as $row) {
            $activeModules[$row['module_key']] = $row;
        }

        $this->set(compact('client', 'allModules', 'activeModules', 'clientCode'));
    }

    // =========================================================================
    // Institute Details — view & edit for the logged-in school's own record
    // =========================================================================

    public function instituteDetails()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $userRole   = strtolower(trim((string)$session->read('ssms_user_role')));
        $isAdmin    = in_array($userRole, ['admin', 'owner']);

        $db = ConnectionManager::get('default');

        // ── POST: save ────────────────────────────────────────────────────────
        if ($this->request->is(['post', 'put'])) {
            if (!$isAdmin) {
                $this->Flash->error(__('You are not authorized to edit institute details.'));
                return $this->redirect(['action' => 'instituteDetails']);
            }

            $data = $this->request->getData();

            // Logo upload
            $logoName     = null;
            $uploadedFile = $this->request->getUploadedFile('logo_name');
            if ($uploadedFile && $uploadedFile->getError() === UPLOAD_ERR_OK) {
                $mime         = $uploadedFile->getClientMediaType();
                $allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                if (in_array($mime, $allowedMimes, true)) {
                    $ext       = ($mime === 'image/png') ? 'png' : 'jpg';
                    $logoName  = $clientCode . '_logo.' . $ext;
                    $uploadDir = $_SERVER['DOCUMENT_ROOT'] . '/../clients/' . $clientCode . '/';
                    if (!is_dir($uploadDir)) {
                        mkdir($uploadDir, 0755, true);
                    }
                    try {
                        $uploadedFile->moveTo($uploadDir . $logoName);
                    } catch (\Exception $e) {
                        Log::error('instituteDetails logo upload failed: ' . $e->getMessage());
                        $logoName = null;
                        $this->Flash->error(__('Logo could not be saved: ' . $e->getMessage()));
                    }
                } else {
                    $this->Flash->error(__('Invalid file type. Only JPEG, PNG or WebP are allowed.'));
                }
            }

            $logoSql = $logoName ? ', logo_name = ?' : '';
            $sql     = "UPDATE ssms_clients SET
                ssms_client_name        = ?,
                ssms_client_header_text = ?,
                ssms_client_email       = ?,
                ssms_client_phone       = ?,
                ssms_client_address     = ?,
                ssms_client_city        = ?,
                ssms_client_state       = ?,
                ssms_client_zip         = ?,
                enroll_prefix           = ?,
                registration_prefix     = ?,
                currency                = ?,
                upi_id                  = ?,
                pay_account_name        = ?,
                razorpay_key_id         = ?,
                razorpay_key_secret     = ?,
                razorpay_env            = ?,
                modified                = NOW()
                {$logoSql}
                WHERE ssms_client_code  = ?";

            $params = [
                trim((string)($data['ssms_client_name']        ?? '')),
                trim((string)($data['ssms_client_header_text'] ?? '')),
                trim((string)($data['ssms_client_email']       ?? '')),
                trim((string)($data['ssms_client_phone']       ?? '')),
                trim((string)($data['ssms_client_address']     ?? '')),
                trim((string)($data['ssms_client_city']        ?? '')),
                trim((string)($data['ssms_client_state']       ?? '')),
                trim((string)($data['ssms_client_zip']         ?? '')),
                strtoupper(trim((string)($data['enroll_prefix']           ?? ''))),
                strtoupper(trim((string)($data['registration_prefix']     ?? ''))),
                trim((string)($data['currency']         ?? '')),
                trim((string)($data['upi_id']           ?? '')),
                trim((string)($data['pay_account_name'] ?? '')),
                trim((string)($data['razorpay_key_id']     ?? '')),
                trim((string)($data['razorpay_key_secret'] ?? '')),
                trim((string)($data['razorpay_env']        ?? 'test')),
            ];
            if ($logoName) {
                $params[] = $logoName;
            }
            $params[] = $clientCode;

            $db->execute($sql, $params);

            // Keep session header text in sync
            $session->write('ssms_client_header_text', trim((string)($data['ssms_client_header_text'] ?? '')));

            $this->Flash->success(__('Institute details updated successfully.'));
            return $this->redirect(['action' => 'instituteDetails']);
        }

        // ── GET: load ─────────────────────────────────────────────────────────
        $row = $db->execute(
            "SELECT * FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();

        if (!$row) {
            $this->Flash->error(__('Institute record not found.'));
            return $this->redirect(['controller' => 'Dashboards', 'action' => 'index']);
        }

        $logoUrl = ($row['logo_name'] ?? '')
            ? '/clients/' . $clientCode . '/' . $row['logo_name']
            : null;

        $this->set([
            'client'  => $row,
            'isAdmin' => $isAdmin,
            'logoUrl' => $logoUrl,
        ]);
    }

    // =========================================================================
    // PUBLIC: Trial Registration (no auth required)
    // =========================================================================

    /**
     * GET  /ssms-clients/client-registration  — render wizard
     * POST /ssms-clients/client-registration  — submit registration (multipart/form-data)
     *                                           returns JSON
     */
    public function clientRegistration(): void
    {
        $this->viewBuilder()->disableAutoLayout();

        if (!$this->request->is('post')) {
            // GET — just render the page, no variables needed
            return;
        }

        // ── POST: process registration ────────────────────────────────────────
        $this->autoRender = false;

        $data       = $this->request->getData();
        $clientCode = strtoupper(trim((string)($data['ssms_client_code'] ?? '')));

        // Required field validation
        $required = [
            'ssms_client_code'        => 'School code',
            'ssms_client_name'        => 'Owner/principal name',
            'ssms_client_email'       => 'School email',
            'ssms_client_phone'       => 'School phone',
            'ssms_client_header_text' => 'School display name',
            'branch_name'             => 'Branch name',
            'ssms_user_name'          => 'Username',
            'ssms_user_password'      => 'Password',
            'ssms_user_firstname'     => 'First name',
            'ssms_user_lastname'      => 'Last name',
            'ssms_user_email'         => 'Admin email',
            'mobile_number'           => 'Mobile number',
        ];

        foreach ($required as $field => $label) {
            if (empty(trim((string)($data[$field] ?? '')))) {
                $this->_jsonResponse(['status' => false, 'message' => "{$label} is required."]);
                return;
            }
        }

        if (strlen($clientCode) < 2 || strlen($clientCode) > 5) {
            $this->_jsonResponse(['status' => false, 'message' => 'School code must be 2–5 characters (letters/numbers).']);
            return;
        }

        $db = $this->getTableLocator()->get('SsmsClients')->getConnection();

        // Uniqueness: school code
        $existing = $db->execute(
            "SELECT ssms_client_code FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
        if ($existing) {
            $this->_jsonResponse(['status' => false, 'message' => "School code '{$clientCode}' is already registered. Please choose a different code."]);
            return;
        }

        // Uniqueness: school email
        $clientEmail        = trim((string)($data['ssms_client_email'] ?? ''));
        $existingClientEmail = $db->execute(
            "SELECT ssms_client_code FROM ssms_clients WHERE LOWER(ssms_client_email) = ? LIMIT 1",
            [strtolower($clientEmail)]
        )->fetchAssoc();
        if ($existingClientEmail) {
            $this->_jsonResponse(['status' => false, 'message' => "School email '{$clientEmail}' is already registered. Please use a different school email address."]);
            return;
        }

        // Username format: 2–20 chars, letters/numbers/underscore only
        $userName = trim((string)($data['ssms_user_name'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_.@\-]{2,50}$/', $userName)) {
            $this->_jsonResponse(['status' => false, 'message' => 'Username must be 2–50 characters and may only contain letters, numbers, @, ., _ or -.']);
            return;
        }

        // Uniqueness: username
        $existingUser = $db->execute(
            "SELECT ssms_user_name FROM sawera_ssms_users WHERE LOWER(ssms_user_name) = ? LIMIT 1",
            [strtolower($userName)]
        )->fetchAssoc();
        if ($existingUser) {
            $this->_jsonResponse(['status' => false, 'message' => "Username '{$userName}' is already taken. Please choose a different username."]);
            return;
        }

        // Uniqueness: admin user email
        $userEmail        = trim((string)($data['ssms_user_email'] ?? ''));
        $existingUserEmail = $db->execute(
            "SELECT ssms_user_name FROM sawera_ssms_users WHERE LOWER(ssms_user_email) = ? LIMIT 1",
            [strtolower($userEmail)]
        )->fetchAssoc();
        if ($existingUserEmail) {
            $this->_jsonResponse(['status' => false, 'message' => "Admin email '{$userEmail}' is already in use. Please use a different email address for the admin account."]);
            return;
        }

        // File uploads
        $logoFileName      = '';
        $userPhotoFilename = '';

        $logoFile = $this->request->getUploadedFile('logo');
        if ($logoFile !== null && $logoFile->getError() === UPLOAD_ERR_OK) {
            $result = $this->_saveClientFile($logoFile, $clientCode, 'logo', $userName);
            if (!$result['success']) {
                $this->_jsonResponse(['status' => false, 'message' => $result['message']]);
                return;
            }
            $logoFileName = $result['filename'];
        }

        $userPhotoFile = $this->request->getUploadedFile('user_photo');
        if ($userPhotoFile !== null && $userPhotoFile->getError() === UPLOAD_ERR_OK) {
            $result = $this->_saveClientFile($userPhotoFile, $clientCode, 'userPhoto', $userName);
            if (!$result['success']) {
                $this->_jsonResponse(['status' => false, 'message' => $result['message']]);
                return;
            }
            $userPhotoFilename = $result['filename'];
        }

        $now              = date('Y-m-d H:i:s');
        $exp              = new \DateTime();
        $exp->modify('+1 year');
        $expiryDate       = $exp->format('Y-m-d');
        $encryptedPassword = $this->_encryptPassword(trim((string)($data['ssms_user_password'] ?? '')));

        $db->begin();
        try {
            // 1. ssms_clients
            $db->execute(
                "INSERT INTO ssms_clients (
                    ssms_client_code, ssms_client_name, ssms_client_address,
                    ssms_client_city, ssms_client_state, ssms_client_zip,
                    ssms_client_email, ssms_client_phone, ssms_client_header_text,
                    logo_name, currency, ssms_client_status, ssms_client_expiry_date,
                    enroll_prefix, registration_prefix, created, modified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $clientCode,
                    trim((string)($data['ssms_client_name']        ?? '')),
                    trim((string)($data['ssms_client_address']      ?? '')),
                    trim((string)($data['ssms_client_city']         ?? '')),
                    trim((string)($data['ssms_client_state']        ?? '')),
                    trim((string)($data['ssms_client_zip']          ?? '')),
                    trim((string)($data['ssms_client_email']        ?? '')),
                    trim((string)($data['ssms_client_phone']        ?? '')),
                    trim((string)($data['ssms_client_header_text']  ?? '')),
                    $logoFileName,
                    trim((string)($data['currency']                 ?? 'INR')),
                    'active',
                    $expiryDate,
                    strtoupper(trim((string)($data['enroll_prefix']       ?? 'E'))),
                    strtoupper(trim((string)($data['registration_prefix'] ?? 'R'))),
                    $now,
                    $now,
                ]
            );

            // 2. ssms_branch
            $db->execute(
                "INSERT INTO ssms_branch (branch_name, branch_address, ssms_client_code) VALUES (?, ?, ?)",
                [
                    trim((string)($data['branch_name']    ?? 'Main Campus')),
                    trim((string)($data['branch_address'] ?? '')),
                    $clientCode,
                ]
            );

            $branchRow = $db->execute(
                "SELECT branch_id FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_id DESC LIMIT 1",
                [$clientCode]
            )->fetchAssoc();
            $branchId = (int)($branchRow['branch_id'] ?? 0);

            // 3. sawera_ssms_users (owner, Inactive until email verified)
            $code = (string)random_int(100000, 999999);
            $db->execute(
                "INSERT INTO sawera_ssms_users (
                    ssms_user_name, ssms_user_firstname, ssms_user_lastname,
                    ssms_user_password, ssms_user_image, ssms_user_role,
                    ssms_user_email, mobile_number, user_dob,
                    branch_id, ssms_user_status, ssms_client_code,
                    validationCode, validationStatus, created, modified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $userName,
                    trim((string)($data['ssms_user_firstname'] ?? '')),
                    trim((string)($data['ssms_user_lastname']  ?? '')),
                    $encryptedPassword,
                    $userPhotoFilename,
                    'owner',
                    trim((string)($data['ssms_user_email']  ?? '')),
                    trim((string)($data['mobile_number']    ?? '')),
                    trim((string)($data['user_dob']         ?? '')) ?: null,
                    $branchId,
                    'Inactive',
                    $clientCode,
                    $code,
                    'Pending',
                    $now,
                    $now,
                ]
            );

            $db->commit();

            // Send welcome/verification email to the registrant
            $adminEmail    = strtolower(trim((string)($data['ssms_user_email'] ?? '')));
            $adminFullName = trim(($data['ssms_user_firstname'] ?? '') . ' ' . ($data['ssms_user_lastname'] ?? ''));
            $this->_sendWelcomeEmail($adminFullName, $userName, $adminEmail, $code);

            Log::info("Trial registration: {$clientCode} / {$userName}");

            // Notify platform admins of successful registration
            $this->_notifyAdmins(
                '[Manage My Academy] New Client Registered via Website',
                "A new institution has registered successfully.\n\n"
                . "School Code   : {$clientCode}\n"
                . "Display Name  : " . trim((string)($data['ssms_client_header_text'] ?? '')) . "\n"
                . "Owner Name    : {$adminFullName}\n"
                . "Username      : {$userName}\n"
                . "Email         : {$adminEmail}\n"
                . "Phone         : " . trim((string)($data['ssms_client_phone'] ?? '')) . "\n"
                . "Branch        : " . trim((string)($data['branch_name'] ?? '')) . "\n"
                . "Registered At : " . date('d M Y, h:i A') . "\n"
            );

            $this->_jsonResponse([
                'status'   => true,
                'message'  => 'Registration successful! Please check your email for the verification code.',
                'email'    => $adminEmail,
                'username' => $userName,
            ]);

        } catch (\Exception $e) {
            $db->rollback();
            Log::error('clientRegistration error: ' . $e->getMessage());

            // Alert platform admins of registration failure
            $this->_notifyAdmins(
                '[Manage My Academy] ⚠️ Client Registration FAILED via Website',
                "A registration attempt has failed.\n\n"
                . "School Code   : " . ($clientCode ?: 'N/A') . "\n"
                . "Username      : " . ($userName   ?: 'N/A') . "\n"
                . "Error         : " . $e->getMessage() . "\n"
                . "Failed At     : " . date('d M Y, h:i A') . "\n"
            );

            $this->_jsonResponse(['status' => false, 'message' => 'Registration failed: ' . $e->getMessage()]);
        }
    }

    /**
     * POST /ssms-clients/verify-registration-code
     * Body JSON: { username, email, code }
     */
    public function verifyRegistrationCode(): void
    {
        $this->autoRender = false;
        $this->request->allowMethod(['post']);

        $body     = json_decode((string)$this->request->getBody(), true) ?? [];
        $username = strtolower(trim((string)($body['username'] ?? '')));
        $email    = strtolower(trim((string)($body['email']    ?? '')));
        $code     = trim((string)($body['code'] ?? ''));

        if (!$username || !$email || !$code) {
            $this->_jsonResponse(['status' => false, 'message' => 'Username, email and code are required.']);
            return;
        }

        $UsersTable = $this->fetchTable('SaweraSsmsUsers');
        $user = $UsersTable->find()
            ->where([
                'LOWER(ssms_user_name) ='  => $username,
                'LOWER(ssms_user_email) =' => $email,
                'validationCode'           => $code,
            ])
            ->first();

        if (!$user) {
            $this->_jsonResponse(['status' => false, 'message' => 'Invalid or expired verification code. Please try again or request a new code.']);
            return;
        }

        $user->validationStatus = 'Verified';
        $user->ssms_user_status = 'active';
        $user->setDirty('validationStatus', true);
        $user->setDirty('ssms_user_status', true);
        $UsersTable->save($user);

        $this->_jsonResponse(['status' => true, 'message' => 'Email verified! Your account is now active. You can now log in.']);
    }

    /**
     * POST /ssms-clients/send-registration-code
     * Body JSON: { username, email }
     */
    public function sendRegistrationCode(): void
    {
        $this->autoRender = false;
        $this->request->allowMethod(['post']);

        $body     = json_decode((string)$this->request->getBody(), true) ?? [];
        $username = strtolower(trim((string)($body['username'] ?? '')));
        $email    = strtolower(trim((string)($body['email']    ?? '')));

        if (!$username || !$email) {
            $this->_jsonResponse(['status' => false, 'message' => 'Username and email are required.']);
            return;
        }

        $UsersTable = $this->fetchTable('SaweraSsmsUsers');
        $user = $UsersTable->find()
            ->where([
                'LOWER(ssms_user_name) ='  => $username,
                'LOWER(ssms_user_email) =' => $email,
            ])
            ->first();

        if (!$user) {
            $this->_jsonResponse(['status' => false, 'message' => 'No account found with that username and email.']);
            return;
        }

        $code = (string)random_int(100000, 999999);
        $user = $UsersTable->patchEntity($user, [
            'validationCode'   => $code,
            'validationStatus' => 'Pending',
        ]);
        $UsersTable->save($user);

        $fullName = trim(($user['ssms_user_firstname'] ?? '') . ' ' . ($user['ssms_user_lastname'] ?? ''));
        $sent = $this->_sendPinEmail($fullName, trim($user['ssms_user_name']), strtolower(trim($user['ssms_user_email'])), $code);

        if (!$sent) {
            $this->_jsonResponse(['status' => false, 'message' => 'Account found but we could not send the email. Please contact support at admin@managemyacademy.com and quote your username.']);
            return;
        }

        $this->_jsonResponse(['status' => true, 'message' => "A new verification code has been sent to {$email}. Check your inbox or spam folder."]);
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private function _jsonResponse(array $data): void
    {
        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($data));
    }

    private function _encryptPassword(string $password): string
    {
        return crypt($password, '$2y$10$iusesomecrazystrings22');
    }

   private function _saveClientFile($file, string $clientCode, string $fileFor, string $userName): array
{
    $allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    $mime         = $file->getClientMediaType();
    if (!in_array($mime, $allowedMimes, true)) {
        return ['success' => false, 'filename' => '', 'message' => "Invalid file type. Only JPEG, PNG and WebP are allowed."];
    }
    if ($file->getSize() > 5 * 1024 * 1024) {
        return ['success' => false, 'filename' => '', 'message' => "File is too large. Maximum 5 MB allowed."];
    }
    $ext      = ($mime === 'image/png') ? 'png' : 'jpg';
    $filename = ($fileFor === 'logo') ? "{$clientCode}.{$ext}" : "{$userName}.{$ext}";
    $baseDir   = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') . '/';
    $uploadDir = $baseDir . 'clients/' . $clientCode . '/'
               . ($fileFor === 'logo' ? '' : 'user/');
    \Cake\Log\Log::debug("Upload Directory is: " . $uploadDir);
    if (!is_dir($uploadDir)) {
        if (!mkdir($uploadDir, 0755, true)) {
            \Cake\Log\Log::error('_saveClientFile mkdir failed for: ' . $uploadDir);
            return ['success' => false, 'filename' => '', 'message' => 'Could not create upload directory.'];
        }
    }
    if (!is_writable($uploadDir)) {
        \Cake\Log\Log::error('_saveClientFile directory not writable: ' . $uploadDir);
        return ['success' => false, 'filename' => '', 'message' => 'Upload directory is not writable.'];
    }
    try {
        $file->moveTo($uploadDir . $filename);
    } catch (\Exception $e) {
        \Cake\Log\Log::error('_saveClientFile moveTo failed: ' . $e->getMessage());
        return ['success' => false, 'filename' => '', 'message' => 'Could not save file: ' . $e->getMessage()];
    }
    return ['success' => true, 'filename' => $filename, 'message' => ''];
}

    private function _notifyAdmins(string $subject, string $body): void
    {
        $recipients = [
            'saquib832002@gmail.com'      => 'Saquib',
            'admin@managemyacademy.com'   => 'MMA Admin',
        ];
        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('text')
                ->setFrom(env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'), env('MAIL_FROM_NAME', 'ManageMyAcademy'))
                ->setSubject($subject);

            foreach ($recipients as $address => $name) {
                $mailer->setTo($address, $name);
                $mailer->deliver($body);
            }
        } catch (\Exception $e) {
            \Cake\Log\Log::error('_notifyAdmins failed: ' . $e->getMessage());
        }
    }

    private function _sendWelcomeEmail(string $fullName, string $username, string $email, string $code): bool
    {
        $fromAddr = env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com');
        $fromName = env('MAIL_FROM_NAME', 'Manage My Academy');
        Log::info("_sendWelcomeEmail: to={$email} | from={$fromAddr} | username={$username}");
        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('both')
                ->setTo($email, $fullName)
                ->setFrom($fromAddr, $fromName)
                ->setSubject('Welcome to Manage My Academy — Verify Your Email')
                ->setViewVars([
                    'fullName'     => $fullName,
                    'username'     => $username,
                    'tempPassword' => $code,
                    'loginUrl'     => env('APP_URL', 'https://managemyacademy.com/'),
                ]);
            $mailer->viewBuilder()->setTemplate('welcome_client')->setLayout('default');
            $mailer->send();
            Log::info("_sendWelcomeEmail: SUCCESS → {$email}");
            return true;
        } catch (\Exception $e) {
            Log::error('_sendWelcomeEmail FAILED: ' . $e->getMessage() . ' | to=' . $email);
            return false;
        }
    }

    private function _sendPinEmail(string $fullName, string $username, string $email, string $code): bool
    {
        $fromAddr = env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com');
        $fromName = env('MAIL_FROM_NAME', 'Manage My Academy');
        Log::info("_sendPinEmail: to={$email} | from={$fromAddr} | username={$username}");
        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('both')
                ->setTo($email, $fullName)
                ->setFrom($fromAddr, $fromName)
                ->setSubject('Manage My Academy — Your Verification Code')
                ->setViewVars([
                    'fullName'     => $fullName,
                    'username'     => $username,
                    'tempPassword' => $code,
                    'loginUrl'     => env('APP_URL', 'https://managemyacademy.com/'),
                ]);
            $mailer->viewBuilder()->setTemplate('validation_code')->setLayout('default');
            $mailer->send();
            Log::info("_sendPinEmail: SUCCESS → {$email}");
            return true;
        } catch (\Exception $e) {
            Log::error('_sendPinEmail FAILED: ' . $e->getMessage() . ' | to=' . $email);
            return false;
        }
    }

    // =========================================================================
    // Free-trial management (platform owner / superuser only)
    //   GET/POST /admin/clients/trials             default trial length + all schools
    //   GET/POST /admin/clients/manageTrial/{CODE} one school: extend / set / end / restart
    // =========================================================================

    private function _isSuperuser(): bool
    {
        return $this->request->getSession()->read('ssms_user_role') === 'superuser';
    }

    private function _changedBy(): string
    {
        $s = $this->request->getSession();
        $name = (string)($s->read('ssms_user_name') ?? '');
        if ($name === '') {
            $identity = $this->request->getAttribute('identity');
            if ($identity !== null && method_exists($identity, 'get')) {
                $name = (string)($identity->get('ssms_user_name') ?? '');
            }
        }

        return $name !== '' ? $name : 'superuser';
    }

    public function trials()
    {
        if (!$this->_isSuperuser()) {
            $this->Flash->error('You are not authorized to manage free trials.');
            return $this->redirect(['controller' => 'Dashboards', 'action' => 'superuserDashboard']);
        }
        $this->viewBuilder()->disableAutoLayout();

        $notice = null;
        $error  = null;
        if ($this->request->is('post')) {
            try {
                $days  = (int)$this->request->getData('trial_days');
                $apply = (string)$this->request->getData('apply_current') === '1';
                $note  = trim((string)$this->request->getData('note'));
                $res   = Trials::setDefaultDays($days, $this->_changedBy(), $apply, $note);
                $notice = "Default free trial changed from {$res['old']} to {$res['new']} days."
                    . ($apply ? " {$res['updatedSchools']} school(s) currently in trial were updated." : '');
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }

        $filter  = (string)$this->request->getQuery('state', '');
        $search  = trim((string)$this->request->getQuery('q', ''));
        $schools = Trials::listSchools(null, false, $search);
        $counts  = ['trial' => 0, 'trial_ended' => 0, 'paid' => 0];
        foreach ($schools as $sc) {
            if (isset($counts[$sc['state']])) {
                $counts[$sc['state']]++;
            }
        }
        if ($filter !== '') {
            $schools = array_values(array_filter($schools, fn($sc) => $sc['state'] === $filter));
        }

        $this->set([
            'defaultDays' => Trials::defaultDays(),
            'schools'     => $schools,
            'counts'      => $counts,
            'filter'      => $filter,
            'search'      => $search,
            'history'     => Trials::history(null, 20),
            'notice'      => $notice,
            'error'       => $error,
            'csrfToken'   => (string)$this->request->getAttribute('csrfToken'),
        ]);
        $this->render('trials');
    }

    public function manageTrial(string $clientCode = '')
    {
        if (!$this->_isSuperuser()) {
            $this->Flash->error('You are not authorized to manage free trials.');
            return $this->redirect(['controller' => 'Dashboards', 'action' => 'superuserDashboard']);
        }
        $this->viewBuilder()->disableAutoLayout();
        $clientCode = strtoupper(trim($clientCode));

        $notice = null;
        $error  = null;
        if ($this->request->is('post')) {
            $by   = $this->_changedBy();
            $note = trim((string)$this->request->getData('note'));
            try {
                switch ((string)$this->request->getData('op')) {
                    case 'extend':
                        $from   = (string)$this->request->getData('from') === 'today' ? 'today' : 'end';
                        $date   = Trials::extend($clientCode, (int)$this->request->getData('days'), $by, $note, $from);
                        $notice = 'Trial extended. New end date: ' . date('j M Y', strtotime($date)) . '.';
                        break;
                    case 'set_date':
                        $date   = Trials::setEndDate($clientCode, trim((string)$this->request->getData('end_date')), $by, $note);
                        $notice = 'Trial end date set to ' . date('j M Y', strtotime($date)) . '.';
                        break;
                    case 'end_now':
                        Trials::endNow($clientCode, $by, $note);
                        $notice = 'Trial ended. Paid and manually granted features are not affected.';
                        break;
                    case 'restart':
                        $d      = (int)$this->request->getData('days');
                        $date   = Trials::restart($clientCode, $d > 0 ? $d : null, $by, $note);
                        $notice = 'New trial started. It ends on ' . date('j M Y', strtotime($date)) . '.';
                        break;
                    default:
                        $error = 'Unknown action.';
                }
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }

        try {
            $school = Trials::status($clientCode);
        } catch (\Throwable $e) {
            $this->Flash->error('School not found.');
            return $this->redirect(['action' => 'trials']);
        }

        $this->set([
            'school'      => $school,
            'defaultDays' => Trials::defaultDays(),
            'history'     => Trials::history($clientCode, 50),
            'notice'      => $notice,
            'error'       => $error,
            'csrfToken'   => (string)$this->request->getAttribute('csrfToken'),
        ]);
        $this->render('manage_trial');
    }
}
