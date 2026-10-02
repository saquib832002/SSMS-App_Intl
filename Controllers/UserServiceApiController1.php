<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

class UserServiceApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
		  // Allow login without authentication
         //  $this->Authentication->allowUnauthenticated(['login','createTrialUser','getTrialBranchId','registerTrialUser','getUsers','updateUser','deleteUser', 'sendForgotPasswordCode','verifyForgotPasswordCode','resetPassword']);
    }

    // ── POST /UserServiceApi/login ────────────────────────────────────────────
    // Body: { username, password }
    // Returns: { status, data: { ssmsUserName, userEmail, ssmsUserRole,
    //             ssmsClientCode, token, expiresAt, branchId, activeModules } }
    public function login()
    {
        $this->request->allowMethod(['post']);

        $username = trim($this->request->getData('username') ?? '');
        $password = $this->request->getData('password') ?? '';

        if (!$username || $password === '') {
            return $this->_json(['status' => false, 'message' => 'Username and password are required']);
        }

        try {
            $conn = ConnectionManager::get('default');

            // ── 1. Fetch user row ─────────────────────────────────────────────
            $userRow = $conn->execute(
                "SELECT ssms_user_name, ssms_user_password, ssms_user_email,
                        ssms_user_role, ssms_client_code
                 FROM   sawera_ssms_users
                 WHERE  ssms_user_name = :uname
                 LIMIT  1",
                ['uname' => $username]
            )->fetch('assoc');

            if (!$userRow) {
                return $this->_json(['status' => false, 'message' => 'Invalid username or password']);
            }

            // ── 2. Verify password using shared _encryptPassword helper ───────
            $stored   = $userRow['ssms_user_password'];
            $verified = ($stored === $this->_encryptPassword($password));
            log:error("passwrd in DB". $newHash);

            if (!$verified) {
                return $this->_json(['status' => false, 'message' => 'Invalid username or password']);
            }

            $ssmsClientCode = $userRow['ssms_client_code'];

            // ── 3. Check client status / expiry ───────────────────────────────
            $clientRow = $conn->execute(
                "SELECT ssms_client_status, ssms_client_expiry_date
                 FROM   ssms_clients
                 WHERE  ssms_client_code = :code
                 LIMIT  1",
                ['code' => $ssmsClientCode]
            )->fetch('assoc');

            if (!$clientRow) {
                return $this->_json(['status' => false, 'message' => 'Account not found. Contact support.']);
            }

            if (strtolower(trim($clientRow['ssms_client_status'] ?? '')) === 'inactive') {
                return $this->_json(['status' => false, 'message' => 'Your account is inactive. Please contact support.']);
            }

            $expiryRaw = $clientRow['ssms_client_expiry_date'] ?? null;
            if ($expiryRaw) {
                $expiryStr = is_object($expiryRaw) && method_exists($expiryRaw, 'format')
                    ? $expiryRaw->format('Y-m-d')
                    : substr((string)$expiryRaw, 0, 10);
                if ($expiryStr && new \DateTime($expiryStr) < new \DateTime('today')) {
                    return $this->_json(['status' => false, 'message' => 'Your membership has expired. Please renew to continue.']);
                }
            }

            // ── 4. Active modules ──────────────────────────────────────────────
            $modRows = $conn->execute(
                "SELECT module_key FROM ssms_client_modules
                 WHERE  ssms_client_code = :code",
                ['code' => $ssmsClientCode]
            )->fetchAll('assoc');

            $activeModules = !empty($modRows) ? array_column($modRows, 'module_key') : ['school'];

            // ── 5. Generate JWT ────────────────────────────────────────────────
            $secret = env('JWT_SECRET', '');
            if (empty($secret)) {
                $secret = \Cake\Core\Configure::read('Jwt.secret', '');
            }
            if (empty($secret)) {
                Log::error('login: JWT_SECRET is not configured');
                return $this->_json(['status' => false, 'message' => 'Server configuration error']);
            }

            $now        = time();
            $expSeconds = 30 * 24 * 60 * 60; // 30 days
            $payload    = [
                'iss'            => 'ssms',
                'iat'            => $now,
                'exp'            => $now + $expSeconds,
                'user'           => $userRow['ssms_user_name'],
                'client_code'    => $ssmsClientCode,
                'active_modules' => $activeModules,
            ];

            $token = $this->_createJwt($payload, $secret);

            return $this->_json([
                'status'  => true,
                'message' => 'Login successful',
                'data'    => [
                    'ssmsUserName'   => $userRow['ssms_user_name'],
                    'userEmail'      => $userRow['ssms_user_email']  ?? '',
                    'ssmsUserRole'   => $userRow['ssms_user_role']   ?? '',
                    'ssmsClientCode' => $ssmsClientCode,
                    'token'          => $token,
                    'expiresAt'      => ($now + $expSeconds) * 1000, // ms for JS Date.now()
                    'branchId'       => null, // set per-user if branch_id column exists
                    'activeModules'  => $activeModules,
                ],
            ]);

        } catch (\Exception $e) {
            Log::error('login error: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Server error: ' . $e->getMessage()]);
        }
    }

    public function registerTrialUser(): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $data       = $this->request->getData();
        log::error('Data received : ' . json_encode($data));

        $clientCode = strtoupper(trim((string)($data['ssms_client_code'] ?? '')));

        // ── Which app is this signup coming from? ─────────────────────────────
        // The client app states where it is; the server decides what that
        // entitles the account to. Absent or unrecognised means school, so the
        // existing NewSMS flow is completely unchanged.
        //
        // Deliberately NOT a module list from the client — that would let any
        // caller with a proxy grant itself whatever modules it liked.
        $sourceApp = strtolower(trim((string)($data['source_app'] ?? 'school')));

        $moduleForApp = [
            'school'  => 'school',
            'library' => 'library',
            'finance' => 'finance',
            'safeer'  => 'donation',   // TODO: confirm Safeer's real module key
        ];

        $moduleKey = $moduleForApp[$sourceApp] ?? 'school';
        $appLabel  = ucfirst($sourceApp);

        // ── Basic required field validation ───────────────────────────────────
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
            'ssms_user_email'         => 'User email',
            'mobile_number'           => 'Mobile number',
        ];
 
        foreach ($required as $field => $label) {
            if (empty(trim((string)($data[$field] ?? '')))) {
                $this->response = $this->response
                    ->withStatus(422)
                    ->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => "{$label} is required."]));
                return;
            }
        }

        if (strlen($clientCode) < 3 || strlen($clientCode) > 5) {
            $this->response = $this->response
                ->withStatus(422)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'School code must be 3–5 characters.']));
            return;
        }
 
        $db = $this->getTableLocator()->get('SsmsClients')->getConnection();
 
        // ── Check school code is not already taken ────────────────────────────
        $existing = $db->execute(
            "SELECT ssms_client_code FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
 
        if ($existing) {
            // An existing client is not "pick a different code" — it means this
            // institution already has an account with us, on one app or another.
            // They need the new module added, not a second account. The `code`
            // field is what the apps branch on; the message can be reworded
            // freely without breaking them.
            $this->response = $this->response
                ->withStatus(409)
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'     => false,
                    'code'       => 'ALREADY_REGISTERED',
                    'clientCode' => $clientCode,
                    'message'    => "You are already registered for one of our apps — School, "
                        . "Library, Finance or Safeer. Sign in with your existing username and "
                        . "password, then raise a ticket with the admin team to have the "
                        . "{$appLabel} module enabled for your account.",
                ]));
            return;
        }
 
        // ── Check school email is not already registered ──────────────────────
        $schoolEmail = strtolower(trim((string)($data['ssms_client_email'] ?? '')));
        $existingSchoolEmail = $db->execute(
            "SELECT ssms_client_code FROM ssms_clients WHERE LOWER(ssms_client_email) = ? LIMIT 1",
            [$schoolEmail]
        )->fetchAssoc();

        if ($existingSchoolEmail) {
            // Same situation as above, found by email instead of by code.
            // Return the code we found so the app can put it in the support
            // ticket — the admin team then knows exactly which account to enable.
            $this->response = $this->response
                ->withStatus(409)
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'     => false,
                    'code'       => 'ALREADY_REGISTERED',
                    'clientCode' => $existingSchoolEmail['ssms_client_code'] ?? $clientCode,
                    'message'    => "You are already registered for one of our apps — School, "
                        . "Library, Finance or Safeer. Sign in with your existing username and "
                        . "password, then raise a ticket with the admin team to have the "
                        . "{$appLabel} module enabled for your account.",
                ]));
            return;
        }

        // ── Check username is not already taken ───────────────────────────────
        $userName = trim((string)($data['ssms_user_name'] ?? ''));
        $existingUser = $db->execute(
            "SELECT ssms_user_name FROM sawera_ssms_users WHERE LOWER(ssms_user_name) = ? LIMIT 1",
            [strtolower($userName)]
        )->fetchAssoc();

        if ($existingUser) {
            $this->response = $this->response
                ->withStatus(409)
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => "Username '{$userName}' is already taken. Please choose a different username.",
                ]));
            return;
        }

        // ── Check user email is not already registered ────────────────────────
        $userEmail = strtolower(trim((string)($data['ssms_user_email'] ?? '')));
        $existingUserEmail = $db->execute(
            "SELECT ssms_user_name FROM sawera_ssms_users WHERE LOWER(ssms_user_email) = ? LIMIT 1",
            [$userEmail]
        )->fetchAssoc();

        if ($existingUserEmail) {
            // A person, not an institution — but the outcome is the same: they
            // already have credentials that work, and need module access rather
            // than a new account.
            //
            // Note the username check above deliberately keeps its original
            // "choose a different username" message. A taken username may well
            // belong to somebody else entirely, so telling this person they are
            // already registered would be wrong.
            $existingClientForUser = $db->execute(
                "SELECT ssms_client_code FROM sawera_ssms_users WHERE LOWER(ssms_user_email) = ? LIMIT 1",
                [$userEmail]
            )->fetchAssoc();

            $this->response = $this->response
                ->withStatus(409)
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'     => false,
                    'code'       => 'ALREADY_REGISTERED',
                    'clientCode' => $existingClientForUser['ssms_client_code'] ?? '',
                    'message'    => "You are already registered for one of our apps — School, "
                        . "Library, Finance or Safeer. Sign in with your existing username and "
                        . "password, then raise a ticket with the admin team to have the "
                        . "{$appLabel} module enabled for your account.",
                ]));
            return;
        }
 
        // ── Handle file uploads ───────────────────────────────────────────────
        $logoFile = $this->request->getUploadedFile('logo');
        $userPhotoFile= $this->request->getUploadedFile('user_photo');
        if ($logoFile !== null && $logoFile->getError() === UPLOAD_ERR_OK) {
            $uploadResult = $this->savePhoto($logoFile, $clientCode,'logo', $userName);
 
            if (!$uploadResult['success']) {
                $this->response = $this->response
                    ->withStatus(422)
                    ->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => $uploadResult['message']]));
                return;
            }
 
            $logoFileName = $uploadResult['filename'];
        }
        else
            $logoFileName = '';
        if ($userPhotoFile !== null && $userPhotoFile->getError() === UPLOAD_ERR_OK) {
            $uploadResult1 = $this->savePhoto($userPhotoFile, $clientCode,'userPhoto', $userName);
 
            if (!$uploadResult1['success']) {
                $this->response = $this->response
                    ->withStatus(422)
                    ->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => $uploadResult1['message']]));
                return;
            }
 
            $userPhotoFilename = $uploadResult1['filename'];
        }
        else
            $userPhotoFilename = '';
        //$logoName     = $this->_saveUpload('logo',       $clientCode, 'logos');
       // $userPhotoName= $this->_saveUpload('user_photo', $clientCode, 'users');
 
        // ── Defaults ─────────────────────────────────────────────────────────
        $now          = date('Y-m-d H:i:s');
        $today        = date('Y-m-d');
        //$expiryDate   = $today;
        $exp = new \DateTime();
            $exp->modify('+1 year');
            $expiryDate = $exp->format('Y-m-d');
        //$expiryDate   = trim((string)($data['ssms_client_expiry_date'] ?? ''));
        //if (empty($expiryDate)) {
        //    $exp = new \DateTime();
        //    $exp->modify('+1 year');
        //    $expiryDate = $exp->format('Y-m-d');
        //}
        $userPassword = $data['ssms_user_password'];
        $encryptedPassword = $this->encryptPassword(trim((string)($userPassword ?? '')));
 
        // ── Database transaction ──────────────────────────────────────────────
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
                    strtoupper(trim((string)($data['enroll_prefix']           ?? 'E'))),
                    strtoupper(trim((string)($data['registration_prefix']     ?? 'R'))),
                    $now,
                    $now,
                ]
            );
 
            // 2. ssms_branch (default branch)
            $db->execute(
                "INSERT INTO ssms_branch (
                    branch_name, branch_address, ssms_client_code
                ) VALUES (?, ?, ?)",
                [
                    trim((string)($data['branch_name']    ?? 'Main Campus')),
                    trim((string)($data['branch_address'] ?? '')),
                    $clientCode,
                ]
            );
 
            // Get the new branch_id
            $branchRow = $db->execute(
                "SELECT branch_id FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_id DESC LIMIT 1",
                [$clientCode]
            )->fetchAssoc();
            $branchId = (int)($branchRow['branch_id'] ?? 0);
            $now          = date('Y-m-d H:i:s');
            // 3. sawera_ssms_users (owner account)
            $code = (string)random_int(100000, 999999);
            $db->execute(
                "INSERT INTO sawera_ssms_users (
                    ssms_user_name, ssms_user_firstname, ssms_user_lastname,
                    ssms_user_password, ssms_user_image, ssms_user_role,
                    ssms_user_email, mobile_number, user_dob,
                    branch_id, ssms_user_status, ssms_client_code,validationCode,validationStatus,
                    created, modified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?)",
                [
                    $userName,
                    trim((string)($data['ssms_user_firstname'] ?? '')),
                    trim((string)($data['ssms_user_lastname']  ?? '')),
                    $encryptedPassword,
                    $userPhotoFilename ?? '',
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
 
            // 4. Grant the module this signup is entitled to.
            //    Inside the transaction on purpose: a client that exists with no
            //    module grant can sign in and then fail on every screen, which
            //    is harder to diagnose than a signup that cleanly rolled back.
            $db->execute(
                "INSERT IGNORE INTO ssms_client_modules
                    (ssms_client_code, module_key, granted_by)
                 VALUES (?, ?, ?)",
                [$clientCode, $moduleKey, 'trial_signup:' . $sourceApp]
            );

            $db->commit();

            log::info("Trial registration successful: {$clientCode} / {$userName} "
                . "(source={$sourceApp}, module={$moduleKey})");

            // ── Welcome email to the new client ──────────────────────────────
            $emailSent = $this->sendWelcomeEmail(
                fullName:     trim("{$data['ssms_user_firstname']} " . ($data['ssms_user_lastname'] ?? '')),
                username:     trim($data['ssms_user_name']),
                email:        strtolower(trim($data['ssms_user_email'])),
                tempPassword: $code,
                templateName: "welcome_client"
            );

            if (!$emailSent) {
                log::error("Welcome email failed for user: {$data['ssms_user_name']}");
            }

            // ── Admin notification — new registration ─────────────────────────
            $this->_notifyAdmins(
                '[Manage My Academy] New Client Registered via App',
                "A new institution has registered successfully.\n\n"
                . "School Code   : {$clientCode}\n"
                . "Display Name  : " . trim((string)($data['ssms_client_header_text'] ?? '')) . "\n"
                . "Owner Name    : " . trim("{$data['ssms_user_firstname']} " . ($data['ssms_user_lastname'] ?? '')) . "\n"
                . "Username      : {$userName}\n"
                . "Admin Email   : " . trim((string)($data['ssms_user_email'] ?? '')) . "\n"
                . "School Email  : " . trim((string)($data['ssms_client_email'] ?? '')) . "\n"
                . "Phone         : " . trim((string)($data['ssms_client_phone'] ?? '')) . "\n"
                . "Branch        : " . trim((string)($data['branch_name'] ?? '')) . "\n"
                . "City          : " . trim((string)($data['ssms_client_city'] ?? '')) . "\n"
                . "Trial Expiry  : {$expiryDate}\n"
                . "Registered At : " . date('d M Y, h:i A') . "\n"
            );

            $this->response = $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'      => true,
                    'message'     => 'Trial account created successfully! You can now log in with your credentials.',
                    'client_code' => $clientCode,
                ]));

        } catch (\Exception $e) {
            $db->rollback();
            log::error('registerTrial error: ' . $e->getMessage());

            // ── Admin alert — registration failure ────────────────────────────
            $this->_notifyAdmins(
                '[Manage My Academy] ⚠️ Client Registration FAILED via App',
                "A registration attempt has failed.\n\n"
                . "School Code   : " . ($clientCode ?: 'N/A') . "\n"
                . "Display Name  : " . trim((string)($data['ssms_client_header_text'] ?? 'N/A')) . "\n"
                . "Username      : " . ($userName ?: 'N/A') . "\n"
                . "Admin Email   : " . trim((string)($data['ssms_user_email'] ?? 'N/A')) . "\n"
                . "Error         : " . $e->getMessage() . "\n"
                . "Failed At     : " . date('d M Y, h:i A') . "\n"
            );

            $this->response = $this->response
                ->withStatus(500)
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Registration failed: ' . $e->getMessage(),
                ]));
        }
    }
    
 private function savePhoto($file, $clientCode, $fileFor, $userName): array
    {
        // ── Validate MIME type ────────────────────────────────────────────────
        $allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        $mime         = $file->getClientMediaType();
 
        if (!in_array($mime, $allowedMimes, true)) {
            return ['success' => false, 'filename' => null, 'message' => "Invalid file type '{$mime}'. Only JPEG, PNG and WebP are allowed."];
        }
 
        // ── Validate file size (max 5 MB) ────────────────────────────────────
        $maxBytes = 5 * 1024 * 1024;
        if ($file->getSize() > $maxBytes) {
            $mb = round($file->getSize() / 1024 / 1024, 1);
            return ['success' => false, 'filename' => null, 'message' => "Photo is too large ({$mb} MB). Maximum allowed size is 5 MB."];
        }
 
        // ── Build filename from student's name ────────────────────────────────
       
        $extension = in_array($mime, ['image/png'], true) ? 'png' : 'jpg';
        
        if($fileFor == 'logo')
            $filename  = "{$clientCode}.{$extension}";
        if($fileFor == 'userPhoto')
            $filename  = "{$userName}.{$extension}";
        // ── Ensure upload directory exists ────────────────────────────────────
       // $uploadDir = WWW_ROOT . str_replace('/', DS, self::PHOTO_DIR);
        if($fileFor == 'logo') {
          //$uploadDir = "../../clients/" .$clientCode. "/";
        $baseDir   = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') . '/';
        $uploadDir = $baseDir . 'clients/' . $clientCode . '/';
        }
        if($fileFor == 'userPhoto') { 
          //$uploadDir = "../../clients/" .$clientCode. "/user/" ;
            $baseDir   = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') . '/';
            $uploadDir = $baseDir . 'clients/' . $clientCode . "/user/" ;
        }

        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }
 
        // ── Move file to its permanent location ───────────────────────────────
        $destination = $uploadDir . DS . $filename;
 
        try {
            $file->moveTo($destination);
        } catch (\Exception $e) {
            log::error('StudentsController::saveStudentPhoto() moveTo failed: ' . $e->getMessage());
            return ['success' => false, 'filename' => null, 'message' => 'Could not save photo file: ' . $e->getMessage()];
        }
 
        log::info("Student photo saved: {$filename}");
 
        return ['success' => true, 'filename' => $filename, 'message' => ''];
    }    
    private function saveStudentPhoto($uploadedFile, string $clientCode, $regId): string
    {
        $originalName = $uploadedFile->getClientFilename() ?: 'student.jpg';
        $uploadPath = "../../clients/" . $clientCode ."/" . $regId ."/";

        // Extension (basic allowlist)
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $allowed = ['jpg', 'jpeg', 'png', 'webp', 'heic'];

        if (!in_array($ext, $allowed, true)) {
            throw new BadRequestException('Invalid image type. Allowed: jpg, jpeg, png, webp, heic');
        }

        // Create upload folder
        $clientFolder = $clientCode ? preg_replace('/[^a-zA-Z0-9_-]/', '', $clientCode) : 'default';
        $relativeDir = "/uploads/students/{$clientFolder}";
        $absoluteDir = WWW_ROOT . "uploads" . DS . "students" . DS . $clientFolder . DS;

        if (!is_dir($absoluteDir)) {
            mkdir($absoluteDir, 0775, true);
        }

        // Unique filename
        $fileName = Text::uuid() . "." . $ext;
        $absolutePath = $absoluteDir . $fileName;

        // Move file
        $uploadedFile->moveTo($absolutePath);

        return $relativeDir . "/" . $originalName;
    }
    // ── GET /UserServiceApi/getUserProfile ────────────────────────────────────
    // Returns the logged-in user's personal details (from sawera_ssms_users)
    // and the client's membership/expiry info (from ssms_clients).
    public function getUserProfile()
    {
        $this->request->allowMethod(['get']);

        $ssmsClientCode = $this->request->getAttribute('jwt_client_code')
                       ?: $this->request->getHeaderLine('ssmsClientCode');
        $ssmsUserName   = $this->request->getAttribute('jwt_user')
                       ?: $this->request->getHeaderLine('ssmsUserName');

        if (!$ssmsClientCode || !$ssmsUserName) {
            $this->response = $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Unauthorized: missing identity',
                ]));
            return $this->response;
        }

        try {
            $conn = ConnectionManager::get('default');

            // ── User row ──────────────────────────────────────────────────────
            $userRow = $conn->execute(
                "SELECT ssms_user_name , ssms_user_firstname, ssms_user_lastname, ssms_user_email,
                        mobile_number, ssms_user_image, ssms_user_role
                 FROM   sawera_ssms_users
                 WHERE  ssms_user_name = :uname
                   AND  ssms_client_code = :code
                 LIMIT 1",
                ['uname' => $ssmsUserName, 'code' => $ssmsClientCode]
            )->fetch('assoc');

            // ── Client row ────────────────────────────────────────────────────
            $clientRow = $conn->execute(
                "SELECT ssms_client_name, ssms_client_expiry_date,
                        ssms_client_status, ssms_client_code
                 FROM   ssms_clients
                 WHERE  ssms_client_code = :code
                 LIMIT 1",
                ['code' => $ssmsClientCode]
            )->fetch('assoc');

            // Normalise expiry date — could be a string or Date object
            $expiryRaw = $clientRow['ssms_client_expiry_date'] ?? null;
            if (is_object($expiryRaw) && method_exists($expiryRaw, 'format')) {
                $expiryDate = $expiryRaw->format('Y-m-d');
            } else {
                $expiryDate = $expiryRaw ? substr((string)$expiryRaw, 0, 10) : '';
            }

            $response = [
                'status' => true,
                'data'   => [
                    // User fields
                    'userName'     => $userRow['ssms_user_name']      ?? $ssmsUserName,
                    'firstName'    => $userRow['ssms_user_firstname']  ?? '',
                    'lastName'     => $userRow['ssms_user_lastname']   ?? '',
                    'emailAddress' => $userRow['ssms_user_email']      ?? '',
                    'mobileNumber' => $userRow['mobile_number']        ?? '',
                    'userPhoto'    => $userRow['ssms_user_image']      ?? '',
                    'userRole'     => $userRow['ssms_user_role']       ?? '',
                    // Client / membership fields
                    'clientName'   => $clientRow['ssms_client_name']   ?? '',
                    'clientCode'   => $ssmsClientCode,
                    'expiryDate'   => $expiryDate,
                    'clientStatus' => $clientRow['ssms_client_status'] ?? '',
                ],
            ];
        } catch (\Exception $e) {
            Log::error('getUserProfile error: ' . $e->getMessage());
            $response = [
                'status'  => false,
                'message' => 'Failed to load profile: ' . $e->getMessage(),
            ];
        }

        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($response));
        return $this->response;
    }

    // ── POST /UserServiceApi/changePassword ───────────────────────────────────
    // Body: { currentPassword, newPassword }
    public function changePassword()
    {
        $this->request->allowMethod(['post']);

        $ssmsClientCode  = $this->request->getAttribute('jwt_client_code')
                        ?: $this->request->getHeaderLine('ssmsClientCode');
        $ssmsUserName    = $this->request->getAttribute('jwt_user')
                        ?: $this->request->getHeaderLine('ssmsUserName');
        $currentPassword = trim($this->request->getData('currentPassword') ?? '');
        $newPassword     = trim($this->request->getData('newPassword')     ?? '');

        if (!$ssmsClientCode || !$ssmsUserName) {
            return $this->_json(['status' => false, 'message' => 'Unauthorized']);
        }
        if (!$currentPassword) {
            return $this->_json(['status' => false, 'message' => 'Current password is required']);
        }
        if (!$newPassword || strlen($newPassword) < 8) {
            return $this->_json(['status' => false, 'message' => 'New password must be at least 8 characters']);
        }

        try {
            $conn = ConnectionManager::get('default');

            $row = $conn->execute(
                "SELECT ssms_user_password FROM sawera_ssms_users
                 WHERE  ssms_user_name = :uname AND ssms_client_code = :code LIMIT 1",
                ['uname' => $ssmsUserName, 'code' => $ssmsClientCode]
            )->fetch('assoc');

            if (!$row) {
                return $this->_json(['status' => false, 'message' => 'User not found']);
            }

            // Verify current password using the shared _encryptPassword helper
            $stored   = $row['ssms_user_password'];
            $verified = ($stored === $this->_encryptPassword($currentPassword));

            if (!$verified) {
                return $this->_json(['status' => false, 'message' => 'Current password is incorrect']);
            }

            if ($currentPassword === $newPassword) {
                return $this->_json(['status' => false, 'message' => 'New password must be different from current password']);
            }

            $newHash = $this->_encryptPassword($newPassword);
            log:error("new passwrd to update". $newHash);
            $conn->execute(
                "UPDATE sawera_ssms_users
                 SET    ssms_user_password = :hash
                 WHERE  ssms_user_name = :uname AND ssms_client_code = :code",
                ['hash' => $newHash, 'uname' => $ssmsUserName, 'code' => $ssmsClientCode]
            );

            return $this->_json(['status' => true, 'message' => 'Password changed successfully']);

        } catch (\Exception $e) {
            Log::error('changePassword error: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Server error: ' . $e->getMessage()]);
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Build a standard HS256 JWT without requiring firebase/php-jwt.
     * Compatible with any RFC-7519 middleware that uses the same secret.
     */
    private function _createJwt(array $payload, string $secret): string
    {
        $b64 = function (string $data): string {
            return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
        };

        $header    = $b64(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
        $body      = $b64(json_encode($payload));
        $signature = $b64(hash_hmac('sha256', "$header.$body", $secret, true));

        return "$header.$body.$signature";
    }

    private function _encryptPassword(string $password): string
    {
        return crypt($password, '$2y$10$iusesomecrazystrings22');
    }

    private function _json(array $data)
    {
        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($data));
        return $this->response;
    }
}
