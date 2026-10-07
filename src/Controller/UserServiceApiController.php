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
use Cake\Mailer\Mailer;
use Firebase\JWT\JWT;

/**
 * SaweraSsmsUsers Controller
 *
 * @property \App\Model\Table\SaweraSsmsUsersTable $SaweraSsmsUsers
 */
class UserServiceApiController extends AppController
{
	 public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
		  // Allow login without authentication
         //  $this->Authentication->allowUnauthenticated(['login','createTrialUser','getTrialBranchId','registerTrialUser','getUsers','updateUser','deleteUser', 'sendForgotPasswordCode','verifyForgotPasswordCode','resetPassword']);
    }
    private function _encryptPassword(string $password): string
    {
        return crypt($password, '$2y$10$iusesomecrazystrings22');
    }
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
                        ssms_user_role, ssms_client_code,
                        ssms_user_firstname, ssms_user_lastname,
                        ssms_user_status, staff_id
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

            if (!$verified) {
                return $this->_json(['status' => false, 'message' => 'Invalid username or password']);
            }

            // ── 2a. Check individual user account status ───────────────────────
            $userStatus = strtolower(trim((string)($userRow['ssms_user_status'] ?? '')));
            if ($userStatus !== 'active') {
                return $this->_json([
                    'status'  => false,
                    'message' => 'Your account is inactive. Please contact your school administration to activate your account.',
                ]);
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

            // ── 3a. Billing model ─────────────────────────────────────────────
            // 'legacy' (Indian schools) → unchanged rules below.
            // 'subscription' (international) → never blocked at login; when a
            // subscription lapses the school simply drops back to free modules.
            \App\Service\Entitlements::clear($ssmsClientCode);
            $entitlements   = \App\Service\Entitlements::forClient($ssmsClientCode);
            $isSubscription = \App\Service\Entitlements::isSubscription($entitlements);

            $expiryRaw = $clientRow['ssms_client_expiry_date'] ?? null;
            if ($expiryRaw && !$isSubscription) {
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

            // Product modules (school / finance / library …) – unchanged for every school.
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

            // ── 5a. For student accounts, resolve enrollment_id from username ──
            $enrollmentId = null;
            $userRole     = strtolower(trim((string)($userRow['ssms_user_role'] ?? '')));
            if ($userRole === 'student') {
                $enrollRow = $conn->execute(
                    "SELECT enrollment_id FROM ssms_student_enrollment
                     WHERE  enrollment_id    = ?
                       AND  ssms_client_code = ?
                       AND  status           = 'active'
                     LIMIT 1",
                    [$userRow['ssms_user_name'], $ssmsClientCode]
                )->fetchAssoc();
                $enrollmentId = $enrollRow['enrollment_id'] ?? null;

                // Fallback: username might not equal enrollment_id — try matching
                // registration_id or a student_user link if your schema has one
                if (!$enrollmentId) {
                    $regRow = $conn->execute(
                        "SELECT e.enrollment_id
                         FROM   ssms_student_enrollment e
                         JOIN   ssms_student_registration r ON r.registration_id = e.registration_id
                         WHERE  r.ssms_client_code  = ?
                           AND  e.ssms_client_code  = ?
                           AND  e.status            = 'active'
                           AND  (r.mobile_number = ? OR r.student_first_name = ?)
                         ORDER  BY e.enrollment_id ASC
                         LIMIT  1",
                        [$ssmsClientCode, $ssmsClientCode,
                         $userRow['ssms_user_name'], $userRow['ssms_user_name']]
                    )->fetchAssoc();
                    $enrollmentId = $regRow['enrollment_id'] ?? null;
                }
            }

            $now        = time();
            $expSeconds = 30 * 24 * 60 * 60; // 30 days
            $payload    = [
                'iss'            => 'ssms',
                'iat'            => $now,
                'exp'            => $now + $expSeconds,
                'user'           => $userRow['ssms_user_name'],
                'client_code'    => $ssmsClientCode,
                'role'           => $userRow['ssms_user_role'] ?? '',
                'enrollment_id'  => $enrollmentId,
                'active_modules' => $activeModules,
                'billing_model'  => $entitlements['billing_model'],
            ];

            $token = $this->_createJwt($payload, $secret);

            // ── 6. Update last_login_date ──────────────────────────────────────
            $conn->execute(
                "UPDATE sawera_ssms_users
                 SET    last_login_date = NOW()
                 WHERE  ssms_user_name = :uname",
                ['uname' => $username]
            );

            return $this->_json([
                'status'  => true,
                'message' => 'Login successful',
                'data'    => [
                    'ssmsUserName'   => $userRow['ssms_user_name'],
                    'firstName'      => $userRow['ssms_user_firstname'] ?? '',
                    'lastName'       => $userRow['ssms_user_lastname']  ?? '',
                    'userEmail'      => $userRow['ssms_user_email']  ?? '',
                    'ssmsUserRole'   => $userRow['ssms_user_role']   ?? '',
                    'ssmsClientCode' => $ssmsClientCode,
                    'token'          => $token,
                    'expiresAt'      => ($now + $expSeconds) * 1000, // ms for JS Date.now()
                    'branchId'       => null, // set per-user if branch_id column exists
                    'enrollmentId'   => $enrollmentId,   // non-null only for student accounts
                    'staffId'        => $userRow['staff_id'] ?? null,
                    'activeModules'  => $activeModules,
                    'billingModel'   => $entitlements['billing_model'],
                    // Plan features for subscription schools ([] for Indian/legacy schools)
                    'activeFeatures' => $entitlements['features'],
                ],
            ]);

        } catch (\Exception $e) {
            Log::error('login error: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Server error: ' . $e->getMessage()]);
        }
    }

 /**
     * GET /UserServiceApi/getEntitlements
     * Current billing model + active modules for the caller's school.
     * The app calls this when it returns to the foreground so upgrades and
     * expiries apply without logging out.
     */
    public function getEntitlements()
    {
        $this->request->allowMethod(['get']);

        $clientCode = (string)$this->request->getAttribute('jwt_client_code');
        if ($clientCode === '') {
            return $this->_json(['status' => false, 'message' => 'Unauthorized']);
        }

        $ent = \App\Service\Entitlements::forClient($clientCode);

        return $this->_json([
            'status' => true,
            'data'   => [
                'billingModel'    => $ent['billing_model'],
                'activeModules'   => $ent['modules'],
                'activeFeatures'  => $ent['features'],
                'featureExpiries' => (object)$ent['expiries'],
            ],
        ]);
    }

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
    
 public function updateUserPhoto()
    {
        $this->request->allowMethod(['post']);

        $ssmsClientCode = $this->request->getAttribute('jwt_client_code')
                       ?: $this->request->getHeaderLine('ssmsClientCode');
        $ssmsUserName   = $this->request->getAttribute('jwt_user')
                       ?: $this->request->getHeaderLine('ssmsUserName');

        if (!$ssmsClientCode || !$ssmsUserName) {
            return $this->_json(['status' => false, 'message' => 'Unauthorized']);
        }

        $photoFile = $this->request->getUploadedFile('user_photo');
        if (!$photoFile || $photoFile->getError() !== UPLOAD_ERR_OK) {
            return $this->_json(['status' => false, 'message' => 'No photo provided']);
        }

        $uploadResult = $this->savePhoto($photoFile, $ssmsClientCode, 'userPhoto', $ssmsUserName);
        if (!$uploadResult['success']) {
            return $this->_json(['status' => false, 'message' => $uploadResult['message']]);
        }

        $filename = $uploadResult['filename'];

        try {
            $conn = ConnectionManager::get('default');
            $conn->execute(
                "UPDATE sawera_ssms_users
                 SET    ssms_user_image  = :img
                 WHERE  ssms_user_name   = :uname
                   AND  ssms_client_code = :code",
                ['img' => $filename, 'uname' => $ssmsUserName, 'code' => $ssmsClientCode]
            );
            return $this->_json([
                'status'   => true,
                'message'  => 'Photo updated successfully',
                'filename' => $filename,
            ]);
        } catch (\Exception $e) {
            Log::error('updateUserPhoto error: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Failed to save photo: ' . $e->getMessage()]);
        }
    }

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
            log::error("new passwrd to update". $newHash);
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
    
 // =========================================================================
    // POST /userServiceApi/registerTrial
    // =========================================================================
    /**
     * Creates a complete trial school setup in one transaction:
     *   1. Insert row in ssms_clients
     *   2. Insert default branch in ssms_branch
     *   3. Insert owner user in sawera_ssms_users
     *
     * Accepts multipart/form-data so logo and user photo can be uploaded.
     *
     * Required fields:
     *   ssms_client_code, ssms_client_name, ssms_client_email, ssms_client_phone,
     *   ssms_client_header_text, branch_name,
     *   ssms_user_name, ssms_user_password, ssms_user_firstname, ssms_user_lastname,
     *   ssms_user_email, mobile_number
     *
     * Optional fields:
     *   ssms_client_address, ssms_client_city, ssms_client_state, ssms_client_zip,
     *   currency, enroll_prefix, registration_prefix, ssms_client_expiry_date,
     *   branch_address, user_dob
     *
     * Optional file uploads:
     *   logo       — school logo image
     *   user_photo — admin user profile photo
     */
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

        // ── Country decides billing (one common app for all countries) ─────────
        //   IN, or no country sent (older app versions) → 'legacy' (Indian flow)
        //   any other country                          → 'subscription'
        //                                                (14-day trial, then paid modules)
        $countryCode = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($data['country_code'] ?? '')), 0, 2));
        $countryCode = $countryCode !== '' ? $countryCode : null;
        $isIntl      = $sourceApp === 'school' && $countryCode !== null && $countryCode !== 'IN';
        $timezone    = substr(preg_replace('#[^A-Za-z0-9_/+\-]#', '', (string)($data['timezone'] ?? '')), 0, 64);
        $timezone    = $timezone !== '' ? $timezone : null;

        // Currency: use what the app sent, but never default a non-Indian school to INR
        $currency = strtoupper(trim((string)($data['currency'] ?? '')));
        if ($isIntl && ($currency === '' || $currency === 'INR')) {
            $currencyByCountry = [
                'US' => 'USD', 'GB' => 'GBP', 'CA' => 'CAD', 'AU' => 'AUD', 'NZ' => 'NZD',
                'IE' => 'EUR', 'DE' => 'EUR', 'FR' => 'EUR', 'NL' => 'EUR', 'ES' => 'EUR', 'IT' => 'EUR',
                'AE' => 'AED', 'SA' => 'SAR', 'QA' => 'QAR', 'KW' => 'KWD', 'OM' => 'OMR', 'BH' => 'BHD',
                'SG' => 'SGD', 'MY' => 'MYR', 'ID' => 'IDR', 'PH' => 'PHP', 'TH' => 'THB', 'VN' => 'VND',
                'BD' => 'BDT', 'NP' => 'NPR', 'LK' => 'LKR', 'PK' => 'PKR', 'AF' => 'AFN', 'MV' => 'MVR',
                'NG' => 'NGN', 'KE' => 'KES', 'GH' => 'GHS', 'ZA' => 'ZAR', 'UG' => 'UGX', 'TZ' => 'TZS',
                'EG' => 'EGP', 'TR' => 'TRY', 'JP' => 'JPY',
            ];
            $currency = $currencyByCountry[$countryCode] ?? 'USD';
        }
        if ($currency === '') {
            $currency = 'INR';
        }

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
        // Expiry date stored on ssms_clients:
        //   • International (subscription) schools → end of the free trial
        //     (registration + TRIAL_DAYS). Shown as the trial end; module access
        //     to trial features in ssms_client_features follows this date.
        //   • Indian (legacy) schools → 1 year, as before.
        $exp = new \DateTime();
        if ($isIntl) {
            $exp->modify('+' . (int)\App\Service\Entitlements::TRIAL_DAYS . ' days');
        } else {
            $exp->modify('+1 year');
        }
        $expiryDate = $exp->format('Y-m-d');
        //$expiryDate   = trim((string)($data['ssms_client_expiry_date'] ?? ''));
        //if (empty($expiryDate)) {
        //    $exp = new \DateTime();
        //    $exp->modify('+1 year');
        //    $expiryDate = $exp->format('Y-m-d');
        //}
        $userPassword = $data['ssms_user_password'];
        $encryptedPassword = $this->_encryptPassword(trim((string)($userPassword ?? '')));
 
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
                    $currency,
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

            // 4a. Indian school from the new app: just record country / time zone.
            //     Wrapped so a missing migration can never block Indian sign-ups.
            if (!$isIntl && $countryCode !== null) {
                try {
                    $db->execute(
                        "UPDATE ssms_clients SET country_code = ?, timezone = ? WHERE ssms_client_code = ?",
                        [$countryCode, $timezone, $clientCode]
                    );
                } catch (\Throwable $e) {
                    log::error('registerTrial: could not save country/timezone (run the phase-1 migration): ' . $e->getMessage());
                }
            }

            // 4b. International school → subscription billing:
            //     free 'core' features always + every paid feature during the trial.
            //     Plan features go to ssms_client_features, NOT ssms_client_modules
            //     (that table stays for product modules used by the web panel).
            if ($isIntl) {
                $db->execute(
                    "UPDATE ssms_clients
                        SET billing_model = 'subscription', country_code = ?, timezone = ?
                      WHERE ssms_client_code = ?",
                    [$countryCode, $timezone, $clientCode]
                );
                // Trial features end on ssms_client_expiry_date (registration + TRIAL_DAYS);
                // expires_at is stored too as a fallback if that date is ever cleared.
                $trialDays = (int)\App\Service\Entitlements::TRIAL_DAYS;
                foreach (\App\Service\Entitlements::PAID_MODULES as $paidFeature) {
                    $db->execute(
                        "INSERT INTO ssms_client_features
                            (ssms_client_code, feature_key, source, expires_at)
                         VALUES (?, ?, 'trial', DATE_ADD(NOW(), INTERVAL {$trialDays} DAY))
                         ON DUPLICATE KEY UPDATE
                            source     = VALUES(source),
                            expires_at = VALUES(expires_at)",
                        [$clientCode, $paidFeature]
                    );
                }
            }

            // 5. Seed default classes (LKG → Class 10) + Section A for each.
            //    Gives every new school a ready-to-use class/section structure
            //    so they can enrol students immediately without manual setup.
            $defaultClasses = [
                'LKG', 'UKG',
                'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5',
                'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
            ];
            foreach ($defaultClasses as $className) {
                $db->execute(
                    "INSERT INTO ssms_classes (class_name, ssms_client_code) VALUES (?, ?)",
                    [$className, $clientCode]
                );
                $newClassId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'];
                $db->execute(
                    "INSERT INTO ssms_sections (section_name, class_id, ssms_client_code) VALUES (?, ?, ?)",
                    ['Section A', $newClassId, $clientCode]
                );
            }

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
                . "Billing       : " . ($isIntl ? 'subscription (' . $countryCode . ', ' . \App\Service\Entitlements::TRIAL_DAYS . '-day trial)' : 'legacy') . "\n"
                . "Country       : " . ($countryCode ?? 'not sent') . "\n"
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
    
    private function _saveUpload(string $fieldName, string $clientCode, string $folder): string
    {
        $file = $this->request->getUploadedFile($fieldName);
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return '';
 
        $dir  = WWW_ROOT . 'clients' . DS . $clientCode . DS . $folder . DS;
        if (!is_dir($dir)) mkdir($dir, 0755, true);
 
        $ext      = pathinfo((string)$file->getClientFilename(), PATHINFO_EXTENSION) ?: 'jpg';
        $filename = $fieldName . '_' . time() . '.' . $ext;
 
        try {
            $file->moveTo($dir . $filename);
            return $filename;
        } catch (\Exception $e) {
            log::warning("_saveUpload failed for {$fieldName}: " . $e->getMessage());
            return '';
        }
    }
    
	
	function getTrialBranchId()
	{ 
		
		$branchTable = $this->fetchTable('SsmsBranch');
		$branches = $branchTable->find()
		->select(['branch_id', 'branch_name'])
        ->where(['ssms_client_code' => 'TRL'])
        ->first()
        ?->get('branch_id');
		
        //return $this->response
        //    ->withType('application/json')
        //    ->withStringBody(json_encode([
        //        'branchId' => $branches,
        //    ]));
        return $branches;
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
	public function getUsers()
        {
            $this->request->allowMethod(['get']);

            $clientCode = $this->request->getHeaderLine('ssmsClientCode');

            $conn = ConnectionManager::get('default');

            $users = $conn->execute(
                "SELECT u.ssms_user_name, u.ssms_user_firstname, u.ssms_user_lastname,
                        u.ssms_user_email, u.ssms_user_role, u.ssms_user_image,
                        u.staff_id, u.branch_id, u.ssms_user_status,
                        u.mobile_number, u.created, u.last_login_date,
                        b.branch_name,
                        TRIM(CONCAT(COALESCE(s.first_name,''), ' ', COALESCE(s.last_name,''))) AS staff_name
                 FROM   sawera_ssms_users u
                 LEFT JOIN ssms_branch b ON u.branch_id IS NOT NULL AND b.branch_id = u.branch_id
                 LEFT JOIN ssms_staff    s ON u.staff_id  IS NOT NULL AND s.staff_id  = u.staff_id AND s.ssms_client_code = :code2
                 WHERE  u.ssms_client_code = :code
                 ORDER BY u.ssms_user_firstname",
                ['code' => $clientCode, 'code2' => $clientCode]
            )->fetchAll('assoc');

            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status' => true,
                    'data' => $users,
                ]));
        }

// ── routes.php entries needed ─────────────────────────────────────────────────
// $builder->get('/UserServiceApi/getStudentUsers',       ['controller'=>'UserServiceApi','action'=>'getStudentUsers']);
// $builder->post('/UserServiceApi/toggleStudentUserStatus', ['controller'=>'UserServiceApi','action'=>'toggleStudentUserStatus']);
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /UserServiceApi/getStudentUsers ──────────────────────────────────────
// Admin/Owner only. Returns all Student + Parent accounts for this client.
// Optional query param: ?status=active|Inactive  (omit for all)
public function getStudentUsers()
{
    $this->request->allowMethod(['get']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $statusFilter = $this->request->getQuery('status'); // optional

    $conn = ConnectionManager::get('default');

    $sql = "SELECT u.ssms_user_name, u.ssms_user_firstname, u.ssms_user_lastname,
                   u.ssms_user_email, u.ssms_user_role, u.ssms_user_status,
                   u.branch_id, u.mobile_number, u.last_login_date, u.created,
                   b.branch_name
            FROM   sawera_ssms_users u
            LEFT JOIN ssms_branch b ON b.branch_id = u.branch_id
            WHERE  u.ssms_client_code = :code
              AND  u.ssms_user_role   IN ('Student','Parent')";

    $params = ['code' => $clientCode];

    if ($statusFilter !== null && $statusFilter !== '') {
        $sql .= " AND LOWER(u.ssms_user_status) = :status";
        $params['status'] = strtolower($statusFilter);
    }

    $sql .= " ORDER BY u.ssms_user_role ASC, u.ssms_user_firstname ASC";

    $users = $conn->execute($sql, $params)->fetchAll('assoc');

    return $this->response->withType('application/json')
        ->withStringBody(json_encode(['status' => true, 'data' => $users]));
}

// ── POST /UserServiceApi/toggleStudentUserStatus ─────────────────────────────
// Admin/Owner only. Activates or deactivates a Student/Parent account.
// Body: { userName, status }  where status = 'active' | 'Inactive'
public function toggleStudentUserStatus()
{
    $this->request->allowMethod(['post']);

    $clientCode = $this->request->getHeaderLine('ssmsClientCode');
    $callerRole = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));

    if (!in_array($callerRole, ['admin', 'owner'], true)) {
        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'  => false,
                'message' => 'Only admin or owner can change user status.',
            ]));
    }

    $data     = $this->request->getData();
    $userName = trim((string)($data['userName'] ?? ''));
    $newStatus = trim((string)($data['status']   ?? ''));

    if (!$userName || !in_array($newStatus, ['active', 'Inactive'], true)) {
        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'  => false,
                'message' => 'Invalid request. Provide userName and status (active or Inactive).',
            ]));
    }

    $conn = ConnectionManager::get('default');

    // Verify the target user belongs to this client and is Student/Parent
    $target = $conn->execute(
        "SELECT ssms_user_name, ssms_user_role FROM sawera_ssms_users
         WHERE  ssms_user_name   = :uname
           AND  ssms_client_code = :code
           AND  ssms_user_role   IN ('Student','Parent')
         LIMIT  1",
        ['uname' => $userName, 'code' => $clientCode]
    )->fetch('assoc');

    if (!$target) {
        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'  => false,
                'message' => 'User not found or not a student/parent account.',
            ]));
    }

    $conn->execute(
        "UPDATE sawera_ssms_users
         SET    ssms_user_status = :status, modified = NOW()
         WHERE  ssms_user_name   = :uname
           AND  ssms_client_code = :code",
        ['status' => $newStatus, 'uname' => $userName, 'code' => $clientCode]
    );

    $label = $newStatus === 'active' ? 'activated' : 'deactivated';
    return $this->response->withType('application/json')
        ->withStringBody(json_encode([
            'status'  => true,
            'message' => "Account {$label} successfully.",
        ]));
}

public function createUser()
        {
            $this->request->allowMethod(['post']);

            $data = $this->request->getData();
            $clientCode = $this->request->getHeaderLine('ssmsClientCode');

            \Cake\Log\Log::debug('createUser: START clientCode=' . $clientCode
                . ' keys=' . implode(',', array_keys($data))
                . ' mobile_number=' . json_encode($data['mobile_number'] ?? 'NOT_SET')
                . ' role=' . ($data['ssms_user_role'] ?? 'NOT_SET')
            );

            $UsersTable = $this->fetchTable('SaweraSsmsUsers');

            // ── Duplicate check: username must be unique per client ───────────
            $newUserName = trim((string)($data['ssms_user_name'] ?? ''));
            $newEmail    = strtolower(trim((string)($data['ssms_user_email'] ?? '')));
            $newRole     = trim((string)($data['ssms_user_role'] ?? ''));

            $dupUsername = $UsersTable->find()
                ->where(['ssms_user_name' => $newUserName, 'ssms_client_code' => $clientCode])
                ->count();
            if ($dupUsername > 0) {
                \Cake\Log\Log::debug('createUser: DUPLICATE username ' . $newUserName);
                return $this->response->withType('application/json')->withStringBody(json_encode([
                    'status'  => false,
                    'message' => "Username '{$newUserName}' is already taken. Please choose a different username.",
                ]));
            }

            // ── Duplicate check: email + role combination must be unique per client ──
            $dupEmailRole = $UsersTable->find()
                ->where([
                    'ssms_user_email' => $newEmail,
                    'ssms_user_role'  => $newRole,
                    'ssms_client_code' => $clientCode,
                ])
                ->count();
            if ($dupEmailRole > 0) {
                \Cake\Log\Log::debug('createUser: DUPLICATE email+role ' . $newEmail . '+' . $newRole);
                return $this->response->withType('application/json')->withStringBody(json_encode([
                    'status'  => false,
                    'message' => "A user with email '{$newEmail}' and role '{$newRole}' already exists.",
                ]));
            }

            \Cake\Log\Log::debug('createUser: duplicate checks passed, building entity');

            $password = $this->_encryptPassword($data['ssms_user_password']);
            $entity = $UsersTable->newEntity([
                'ssms_user_name' => $data['ssms_user_name'] ?? '',
                'ssms_user_firstname' => $data['ssms_user_firstname'] ?? '',
                'ssms_user_lastname' => $data['ssms_user_lastname'] ?? '',
                'ssms_user_password' => $password,
                'ssms_user_email' => $data['ssms_user_email'] ?? '',
                'ssms_user_role' => $data['ssms_user_role'] ?? 'Teacher',
                'staff_id' => $data['staff_id'] ?? null,
                'branch_id' => $data['branch_id'] ?? null,
                'ssms_user_status' => $data['ssms_user_status'] ?? 'active',
                'validationStatus' => 'Pending',
                'ssms_client_code' => $clientCode,
            ]);

            \Cake\Log\Log::debug('createUser: entity errors after newEntity=' . json_encode($entity->getErrors()));

            if ($UsersTable->save($entity)) {
                \Cake\Log\Log::debug('createUser: entity save SUCCESS');
                // Set mobile_number via raw SQL to bypass Entity accessibility guards
                $mobileNumber = !empty($data['mobile_number']) ? trim($data['mobile_number']) : null;
                \Cake\Log\Log::debug('createUser: mobileNumber to save=' . json_encode($mobileNumber));
                if ($mobileNumber !== null) {
                    try {
                        $conn = \Cake\Datasource\ConnectionManager::get('default');
                        $affected = $conn->execute(
                            "UPDATE sawera_ssms_users SET mobile_number = ? WHERE ssms_user_name = ? AND ssms_client_code = ?",
                            [$mobileNumber, trim((string)($data['ssms_user_name'] ?? '')), $clientCode]
                        )->rowCount();
                        \Cake\Log\Log::debug('createUser: mobile UPDATE rows affected=' . $affected);
                    } catch (\Exception $e) {
                        \Cake\Log\Log::error('createUser mobile_number update failed: ' . $e->getMessage());
                    }
                }
                return $this->response->withType('application/json')->withStringBody(json_encode([
                    'status' => true,
                    'message' => 'User created successfully',
                ]));
            }

            $errors = $entity->getErrors();
            \Cake\Log\Log::error('createUser: entity save FAILED errors=' . json_encode($errors));

            return $this->response->withType('application/json')->withStringBody(json_encode([
                'status' => false,
                'message' => 'Unable to create user: ' . json_encode($errors),
                'errors' => $errors,
            ]));
        }
    
    public function updateUser($userName = null)
{
    $this->request->allowMethod(['put', 'post']);

    $data = $this->request->getData();
    $clientCode = $this->request->getHeaderLine('ssmsClientCode');

    $UsersTable = $this->fetchTable('SaweraSsmsUsers');

    $entity = $UsersTable->find()
        ->where([
            'ssms_user_name' => $userName,
            'ssms_client_code' => $clientCode,
        ])
        ->first();

    if (!$entity) {
        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => false,
                'message' => 'User not found',
            ]));
    }

    // ── Duplicate check: email + role combo must not exist for another user ──
    $updEmail = strtolower(trim((string)($data['ssms_user_email'] ?? $entity->ssms_user_email)));
    $updRole  = trim((string)($data['ssms_user_role']  ?? $entity->ssms_user_role));

    $dupEmailRole = $UsersTable->find()
        ->where([
            'ssms_user_email'  => $updEmail,
            'ssms_user_role'   => $updRole,
            'ssms_client_code' => $clientCode,
        ])
        ->andWhere(['ssms_user_name !=' => $userName])
        ->count();
    if ($dupEmailRole > 0) {
        return $this->response->withType('application/json')->withStringBody(json_encode([
            'status'  => false,
            'message' => "Another user already has email '{$updEmail}' with role '{$updRole}'. Please use a different email or role.",
        ]));
    }

    $updateData = [
        'ssms_user_firstname' => $data['ssms_user_firstname'] ?? $entity->ssms_user_firstname,
        'ssms_user_lastname' => $data['ssms_user_lastname'] ?? $entity->ssms_user_lastname,
        'ssms_user_email' => $data['ssms_user_email'] ?? $entity->ssms_user_email,
        'ssms_user_role' => $data['ssms_user_role'] ?? $entity->ssms_user_role,
        'staff_id' => $data['staff_id'] ?? $entity->staff_id,
        'branch_id' => $data['branch_id'] ?? $entity->branch_id,
        'ssms_user_status' => $data['ssms_user_status'] ?? $entity->ssms_user_status,
    ];

    if (!empty($data['ssms_user_password'])) {
		$passwordText = $data['ssms_user_password'];
        $password = $this->_encryptPassword($passwordText);

        //Log::write('error', 'Password from input is :'. $data['ssms_user_password']);

        $updateData['ssms_user_password'] = $password;
        // ── 6. Send welcome email with temporary password ───────────────────────
        $emailSent = $this->sendWelcomeEmail(
            fullName:     trim("{$data['ssms_user_firstname']} " . ($data['ssms_user_lastname'] ?? '')),
            username:     trim($data['ssms_user_name']),
            email:        strtolower(trim($data['ssms_user_email'])),
            tempPassword: $passwordText,
            templateName: 'welcome_user'
        );

        if (!$emailSent) {
            // User was created — log the failure but do not roll back.
            // The admin can trigger a password reset separately.
            Log::warning("Welcome email failed for user: {$data['ssms_user_name']}");
        }

    }

    $entity = $UsersTable->patchEntity($entity, $updateData);

    if ($UsersTable->save($entity)) {
        // Update mobile_number via raw SQL to bypass Entity accessibility guards
        if (array_key_exists('mobile_number', $data)) {
            $mobileNumber = !empty($data['mobile_number']) ? trim($data['mobile_number']) : null;
            try {
                $conn = \Cake\Datasource\ConnectionManager::get('default');
                $conn->execute(
                    "UPDATE sawera_ssms_users SET mobile_number = ? WHERE ssms_user_name = ? AND ssms_client_code = ?",
                    [$mobileNumber, $userName, $clientCode]
                );
            } catch (\Exception $e) {
                \Cake\Log\Log::error('updateUser mobile_number update failed: ' . $e->getMessage());
            }
        }
        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'message' => 'User updated successfully',
            ]));
    }

    return $this->response
        ->withType('application/json')
        ->withStringBody(json_encode([
            'status' => false,
            'message' => 'Unable to update user',
            'errors' => $entity->getErrors(),
        ]));
        
    }
    // =========================================================================
    // GET /UserServiceApi/getInstituteDetails
    // =========================================================================
    public function getInstituteDetails()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');

        \Cake\Log\Log::debug("getInstituteDetails: clientCode=[{$clientCode}]");

        if (!$clientCode) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Unauthorized — no client code.']));
        }

        $db  = $this->getTableLocator()->get('SsmsClients')->getConnection();
        $row = $db->execute(
            "SELECT ssms_client_code, ssms_client_name, ssms_client_address,
                    ssms_client_city, ssms_client_state, ssms_client_zip,
                    ssms_client_email, ssms_client_phone, ssms_client_header_text,
                    logo_name, currency, ssms_client_expiry_date,
                    enroll_prefix, registration_prefix,
                    upi_id, pay_account_name,
                    whatsapp_community_link, whatsapp_channel_link,
                    created, modified
             FROM   ssms_clients
             WHERE  ssms_client_code = ?
             LIMIT  1",
            [$clientCode]
        )->fetchAssoc();

        \Cake\Log\Log::debug("getInstituteDetails: found=" . ($row ? 'yes' : 'no') . " code=[{$clientCode}]");

        return $this->response->withType('application/json')
            ->withStringBody(json_encode($row
                ? ['status' => true,  'data' => $row]
                : ['status' => false, 'message' => "Institute not found for code: {$clientCode}"]
            ));
    }

    // =========================================================================
    // POST /UserServiceApi/updateInstituteDetails
    // =========================================================================
    public function updateInstituteDetails()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $role       = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));

        if (!$clientCode) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Unauthorized.']));
        }
        if (!in_array($role, ['admin', 'owner'])) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Admin or owner access required.']));
        }

        $db   = $this->fetchTable('SsmsClients')->getConnection();
        $body = $this->request->getData();

        // Handle logo upload (multipart)
        $uploadedFiles = $this->request->getUploadedFiles();
        $logoName      = null;

        if (!empty($uploadedFiles['logo'])) {
            $file     = $uploadedFiles['logo'];
            $origName = $file->getClientFilename();
            $ext      = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
            if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => 'Invalid logo file type.']));
            }

            // Fixed filename — overwrites the old logo automatically
            $logoName = 'logo_' . $clientCode . '.' . $ext;
            $logoDir  = "../../clients/" . $clientCode . '/';

            // Delete any previously uploaded logo for this client
            foreach (['jpg','jpeg','png','gif','webp'] as $oldExt) {
                $oldFile = $logoDir . $oldExt;
                if (file_exists($oldFile)) {
                    unlink($oldFile);
                }
            }

            if (!is_dir($logoDir)) {
                mkdir($logoDir, 0755, true);
            }
            $file->moveTo($logoDir . DS . $logoName);
        }

        $allowed = [
            'ssms_client_name', 'ssms_client_address', 'ssms_client_city',
            'ssms_client_state', 'ssms_client_zip', 'ssms_client_email',
            'ssms_client_phone', 'ssms_client_header_text',
            'currency', 'enroll_prefix', 'registration_prefix',
            'upi_id', 'pay_account_name',
            'whatsapp_community_link', 'whatsapp_channel_link',
        ];

        $sets  = [];
        $binds = [];
        foreach ($allowed as $field) {
            if (array_key_exists($field, $body)) {
                $sets[]  = "{$field} = ?";
                $binds[] = trim((string)($body[$field] ?? ''));
            }
        }
        if ($logoName) {
            $sets[]  = "logo_name = ?";
            $binds[] = $logoName;
        }
        if (empty($sets)) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'No fields to update.']));
        }

        $sets[]  = "modified = ?";
        $binds[] = date('Y-m-d H:i:s');
        $binds[] = $clientCode;

        $db->execute(
            "UPDATE ssms_clients SET " . implode(', ', $sets) . " WHERE ssms_client_code = ?",
            $binds
        );

        // Return updated record
        $updated = $db->execute(
            "SELECT ssms_client_code, ssms_client_name, ssms_client_address,
                    ssms_client_city, ssms_client_state, ssms_client_zip,
                    ssms_client_email, ssms_client_phone, ssms_client_header_text,
                    logo_name, currency, ssms_client_expiry_date,
                    enroll_prefix, registration_prefix,
                    upi_id, pay_account_name, created, modified
             FROM   ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();

        return $this->response->withType('application/json')
            ->withStringBody(json_encode(['status' => true, 'message' => 'Institute details updated.', 'data' => $updated]));
    }

    
    public function deleteUser($userName = null)
        {
            $this->request->allowMethod(['delete', 'post']);

            $clientCode = $this->request->getHeaderLine('ssmsClientCode');
            $ssmsUserRole = $this->request->getHeaderLine('ssmsUserRole');
            if($ssmsUserRole == 'admin' || $ssmsUserRole == 'owner')
                {  $UsersTable = $this->fetchTable('SaweraSsmsUsers');

                    $entity = $UsersTable->find()
                        ->where([
                            'ssms_user_name' => $userName,
                            'ssms_client_code' => $clientCode,
                        ])
                        ->first();

                    if (!$entity) {
                        return $this->response
                            ->withType('application/json')
                            ->withStringBody(json_encode([
                                'status' => false,
                                'message' => 'User not found',
                            ]));
                    }

                    // Soft delete
                    $entity = $UsersTable->patchEntity($entity, [
                        'ssms_user_status' => 'Inactive',
                    ]);

                    if ($UsersTable->save($entity)) {
                        return $this->response
                            ->withType('application/json')
                            ->withStringBody(json_encode([
                                'status' => true,
                                'message' => 'User deactivated successfully',
                            ]));
                    }
                }
        else
        {
           return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status' => false,
                    'message' => 'You are not allowed to delete user',
                ])); 
        }
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status' => false,
                    'message' => 'Unable to delete user',
                ]));
        }
    
    // =========================================================================
    // POST /UserServiceApi/checkSchoolEmail
    // Public — no auth required.
    // Checks whether a school email already exists in ssms_clients.
    // Body (JSON): { email }
    // Response: { status: true, exists: bool, message: "..." }
    // =========================================================================
    public function checkSchoolEmail(): void
    {
        $this->request->allowMethod(['post', 'options']);

        $data  = $this->request->getData();
        $email = strtolower(trim((string)($data['email'] ?? '')));

        if (!$email) {
            $this->response = $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'exists'  => false,
                    'message' => 'Email is required.',
                ]));
            return;
        }

        $db  = $this->getTableLocator()->get('SsmsClients')->getConnection();
        $row = $db->execute(
            "SELECT ssms_client_code FROM ssms_clients WHERE LOWER(ssms_client_email) = ? LIMIT 1",
            [$email]
        )->fetchAssoc();

        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($row
                ? ['status' => true, 'exists' => true,  'message' => 'This school email is already registered. Please use a different email address.']
                : ['status' => true, 'exists' => false, 'message' => 'Email is available.']
            ));
    }

    // =========================================================================
    // POST /UserServiceApi/checkUserEmail
    // Public — no auth required.
    // Checks whether a user email already exists in sawera_ssms_users.
    // Body (JSON): { email }
    // Response: { status: true, exists: bool, message: "..." }
    // =========================================================================
    public function checkUserEmail(): void
    {
        $this->request->allowMethod(['post', 'options']);

        $data  = $this->request->getData();
        $email = strtolower(trim((string)($data['email'] ?? '')));

        if (!$email) {
            $this->response = $this->response
                ->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'exists'  => false,
                    'message' => 'Email is required.',
                ]));
            return;
        }

        $db  = $this->getTableLocator()->get('SaweraSsmsUsers')->getConnection();
        $row = $db->execute(
            "SELECT ssms_user_name FROM sawera_ssms_users WHERE LOWER(ssms_user_email) = ? LIMIT 1",
            [$email]
        )->fetchAssoc();

        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($row
                ? ['status' => true, 'exists' => true,  'message' => 'This email address is already in use. Please use a different email.']
                : ['status' => true, 'exists' => false, 'message' => 'Email is available.']
            ));
    }

    // =========================================================================
    // Sends a plain-text admin alert to saquib832002@gmail.com + admin@managemyacademy.com
    // Matches the _notifyAdmins() pattern used in SsmsClientsController (web).
    // =========================================================================
    private function _notifyAdmins(string $subject, string $body): void
    {
        $recipients = [
            'saquib832002@gmail.com'    => 'Saquib',
            'admin@managemyacademy.com' => 'MMA Admin',
        ];
        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('text')
                ->setFrom(
                    env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                    env('MAIL_FROM_NAME',    'ManageMyAcademy')
                )
                ->setSubject($subject);

            foreach ($recipients as $address => $name) {
                $mailer->setTo($address, $name);
                $mailer->deliver($body);
            }
        } catch (\Exception $e) {
            Log::error('_notifyAdmins failed: ' . $e->getMessage());
        }
    }

      private function sendWelcomeEmail( string $fullName,  string $username, string $email, string $tempPassword, string $templateName ): bool 
      {
          log::error("Template error name received as :". $templateName );
                $emailName = ($templateName === 'welcome_client') ? 'welcome_client' : 'welcome_user';

                try {
                    $mailer = new Mailer('default');
                    $mailer
                        ->setEmailFormat('both')
                        ->setTo($email, $fullName)
                        ->setFrom(
                            env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                            env('MAIL_FROM_NAME',    'ManageMyAcademy')  
                           )
                        ->setSubject('Welcome to the School Management System — Your Account Details')
                        ->setViewVars([
                            'fullName'     => $fullName,
                            'username'     => $username,
                            'tempPassword' => $tempPassword,
                            'loginUrl'     => env('APP_URL', 'https://managemyacademy.com/'),
                        ]);

                    // viewBuilder() is separate — not chained on $mailer after setViewVars
                    $mailer->viewBuilder()
                        ->setTemplate($emailName)   // templates/email/html/welcome_client.php OR welcome_user.php
                        ->setLayout('default');     // templates/layout/email/html/default.php

                    $mailer->send();
                    return true;

                } catch (\Exception $e) {
                    Log::error('sendWelcomeEmail failed for ' . $email . ': ' . $e->getMessage());
                    return false;
                }
            }
    
    public function sendForgotPasswordCode()
    {
        $this->request->allowMethod(['post']);

        $data     = $this->request->getData();
        $username = trim((string)($data['username'] ?? ''));
        $email    = trim((string)($data['email']    ?? ''));
        $mobile   = preg_replace('/\D/', '', trim((string)($data['mobile']  ?? '')));
        $method   = (!empty($mobile) && empty($email)) ? 'whatsapp' : 'email';

        if (empty($username)) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Username is required.']));
        }
        if ($method === 'email' && empty($email)) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Email address is required.']));
        }
        if ($method === 'whatsapp' && empty($mobile)) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Mobile number is required.']));
        }

        $UsersTable = $this->fetchTable('SaweraSsmsUsers');

        if ($method === 'whatsapp') {
            // Normalise the submitted mobile to digits only (strips +, spaces, dashes, etc.)
            $mobileDigits = preg_replace('/\D/', '', $mobile);

            $user = $UsersTable->find()
                ->where([
                    'LOWER(ssms_user_name) ='  => strtolower($username),
                    'LOWER(ssms_user_status) =' => 'active',
                ])
                ->first();

            if (!$user) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => 'User not found or account is inactive.']));
            }

            // Compare full digits — user must supply the number exactly as stored
            // (with country code). Both sides are stripped to digits-only before comparison.
            $storedDigits = preg_replace('/\D/', '', (string)($user['mobile_number'] ?? ''));
            if (empty($storedDigits) || $storedDigits !== $mobileDigits) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => 'Mobile number does not match our records. Please include the country code (e.g., 919876543210 for India).',
                    ]));
            }

            $code = (string)random_int(100000, 999999);
            $user = $UsersTable->patchEntity($user, ['validationCode' => $code, 'validationStatus' => 'Pending']);
            $UsersTable->save($user);

            // Fetch school name for the personalised WhatsApp message
            $clientCode = (string)($user['ssms_client_code'] ?? '');
            $schoolName = 'SSMS'; // default fallback
            if (!empty($clientCode)) {
                try {
                    $db        = $this->fetchTable('SsmsClients')->getConnection();
                    $clientRow = $db->execute(
                        "SELECT ssms_client_name FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                        [$clientCode]
                    )->fetchAssoc();
                    if (!empty($clientRow['ssms_client_name'])) {
                        $schoolName = $clientRow['ssms_client_name'];
                    }
                } catch (\Exception $e) {
                    Log::error("sendForgotPasswordCode: failed to fetch school name — " . $e->getMessage());
                }
            }

            $fullName = trim("{$user['ssms_user_firstname']} " . ($user['ssms_user_lastname'] ?? ''));
            $waPhone  = $storedDigits; // already digits-only with country code
            $waText   = urlencode(
                "🔐 *{$schoolName} — Password Reset*\n\n" .
                "Hello {$fullName},\n\n" .
                "Your verification code is: *{$code}*\n\n" .
                "Enter this code in the {$schoolName} app to reset your password.\n" .
                "This code is for one-time use only."
            );
            $waUrl = "https://wa.me/{$waPhone}?text={$waText}";

            Log::debug("sendForgotPasswordCode (whatsapp): user={$username} school={$schoolName} phone={$waPhone}");

            return $this->response->withType('application/json')->withStringBody(json_encode([
                'status'       => true,
                'method'       => 'whatsapp',
                'whatsapp_url' => $waUrl,
                'message'      => 'Verification code generated. Open WhatsApp to receive it.',
            ]));

        } else {
            // ── Email path (original) ────────────────────────────────────────────
            $user = $UsersTable->find()
                ->where([
                    'LOWER(ssms_user_name) ='  => strtolower($username),
                    'LOWER(ssms_user_email) =' => strtolower($email),
                    'LOWER(ssms_user_status) =' => 'active',
                ])
                ->first();

            if (!$user) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => 'User not found or account is inactive.']));
            }

            $code = (string)random_int(100000, 999999);
            $user = $UsersTable->patchEntity($user, ['validationCode' => $code, 'validationStatus' => 'Pending']);
            $UsersTable->save($user);

            $emailSent = $this->senPinViaEmail(
                fullName:     trim("{$user['ssms_user_firstname']} " . ($user['ssms_user_lastname'] ?? '')),
                username:     trim($user['ssms_user_name']),
                email:        strtolower(trim($user['ssms_user_email'])),
                tempPassword: $code
            );

            if (!$emailSent) {
                Log::error("Forgot-password email failed for user: {$username}");
            }

            Log::debug("sendForgotPasswordCode (email): user={$username} email={$email}");

            return $this->response->withType('application/json')->withStringBody(json_encode([
                'status'  => true,
                'method'  => 'email',
                'message' => 'Verification code sent to your email.',
            ]));
        }
    }
private function senPinViaEmail(string $fullName, string $username, string $email, string $tempPassword ): bool 
      {
        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('both')                        // send HTML + plain text
                ->setTo($email, $fullName)
                ->setFrom(
                    env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                    env('MAIL_FROM_NAME', 'Manage My Academy')
                )
                ->setSubject('Welcome to the School Management System — Your Account Details')
                ->setViewVars([
                    'fullName'     => $fullName,
                    'username'     => $username,
                    'tempPassword' => $tempPassword,
                    'loginUrl'     => env('APP_URL', 'https://managemyacademy.com/'),
                ])
                ->viewBuilder()
                ->setTemplate('validation_code')          // templates/email/html/welcome_user.php
                ->setLayout('default');                // templates/layout/email/html/default.php

            $mailer->send();
            log::error('PIN email sent');

            return true;
        } catch (\Exception $e) {
            log::error('PIN email exception: ' . $e->getMessage());
            return false;
        }
    }
public function verifyForgotPasswordCode()
    {
        $this->request->allowMethod(['post']);

        $data     = $this->request->getData();
        $username = trim((string)($data['username'] ?? ''));
        $email    = trim((string)($data['email']    ?? ''));
        $mobile   = preg_replace('/\D/', '', trim((string)($data['mobile']  ?? '')));
        $code     = (string)($data['code'] ?? '');

        $UsersTable = $this->fetchTable('SaweraSsmsUsers');

        // Look up by username + code (same for both paths)
        $user = $UsersTable->find()
            ->where([
                'LOWER(ssms_user_name) =' => strtolower($username),
                'validationCode'           => $code,
            ])
            ->first();

        if (!$user) {
            return $this->response->withType('application/json')->withStringBody(json_encode([
                'status'  => false,
                'message' => 'Invalid verification code.',
            ]));
        }

        // Additional identity check: verify email OR mobile (full digits) matches
        if (!empty($email)) {
            if (strtolower(trim((string)($user['ssms_user_email'] ?? ''))) !== strtolower($email)) {
                return $this->response->withType('application/json')->withStringBody(json_encode([
                    'status' => false, 'message' => 'Invalid verification code.',
                ]));
            }
        } elseif (!empty($mobile)) {
            $mobileDigits = preg_replace('/\D/', '', $mobile);
            $storedDigits = preg_replace('/\D/', '', (string)($user['mobile_number'] ?? ''));
            if (empty($storedDigits) || $storedDigits !== $mobileDigits) {
                return $this->response->withType('application/json')->withStringBody(json_encode([
                    'status' => false, 'message' => 'Invalid verification code.',
                ]));
            }
        }

        $user = $UsersTable->patchEntity($user, [
            'validationStatus' => 'Verified',
            'ssms_user_status' => 'active',
        ]);
        $UsersTable->save($user);

        return $this->response->withType('application/json')->withStringBody(json_encode([
            'status'  => true,
            'message' => 'Code verified successfully.',
        ]));
    }

public function resetPassword()
{
    $this->request->allowMethod(['post']);
    $data = $this->request->getData();

    $username            = trim((string)($data['username']    ?? ''));
    $email               = trim((string)($data['email']       ?? ''));
    $mobile              = preg_replace('/\D/', '', trim((string)($data['mobile'] ?? '')));
    $code                = (string)($data['code']             ?? '');
    $newPasswordFromUser = $data['newPassword']               ?? '';
    $newPassword         = $this->_encryptPassword($newPasswordFromUser);

    $UsersTable = $this->fetchTable('SaweraSsmsUsers');

    // Look up by username + code + Verified status
    $user = $UsersTable->find()
        ->where([
            'LOWER(ssms_user_name) =' => strtolower($username),
            'validationCode'          => $code,
            'validationStatus'        => 'Verified',
        ])
        ->first();

    // Additional identity check: verify email OR mobile (full digits) matches
    if ($user && !empty($email)) {
        if (strtolower(trim((string)($user['ssms_user_email'] ?? ''))) !== strtolower($email)) {
            $user = null;
        }
    } elseif ($user && !empty($mobile)) {
        $mobileDigits = preg_replace('/\D/', '', $mobile);
        $storedDigits = preg_replace('/\D/', '', (string)($user['mobile_number'] ?? ''));
        if (empty($storedDigits) || $storedDigits !== $mobileDigits) {
            $user = null;
        }
    }

    if (!$user) {
        return $this->response->withType('application/json')->withStringBody(json_encode([
            'status'  => false,
            'message' => 'User validation failed',
        ]));
    }

    // ── Direct property assignment instead of patchEntity ─────────────────
    // patchEntity respects $_accessible mass-assignment protection and will
    // silently skip fields not listed there — including ssms_user_password.
    // Setting properties directly and marking them dirty bypasses this.
    $user->ssms_user_password = $newPassword;
    $user->validationCode     = null;
    $user->validationStatus   = null;
    $user->setDirty('ssms_user_password', true);
    $user->setDirty('validationCode',     true);
    $user->setDirty('validationStatus',   true);

    if (!$UsersTable->save($user)) {
        Log::error('resetPassword save failed: ' . json_encode($user->getErrors()));
        return $this->response->withType('application/json')->withStringBody(json_encode([
            'status'  => false,
            'message' => 'Failed to save new password. Please try again.',
        ]));
    }

    return $this->response->withType('application/json')->withStringBody(json_encode([
        'status'  => true,
        'message' => 'Password reset successfully',
    ]));
}

    // =========================================================================
    // POST /UserServiceApi/registerStudentParent
    //
    // Public endpoint — no token required.
    // Verifies the student by: enrollmentId + dateOfBirth + (email OR mobile).
    // At least one of email / mobileNumber must be supplied.
    // On success, creates a login account and:
    //   • sends credentials via email  (if email provided)
    //   • returns whatsappText + whatsappPhone for frontend to open wa.me
    //     (if mobileNumber provided)
    //
    // Body (JSON): { enrollmentId, email, mobileNumber, dateOfBirth (DD/MM/YYYY), role }
    // =========================================================================
    public function registerStudentParent()
    {
        $this->request->allowMethod(['post']);

        $data      = $this->request->getData();
        $role      = trim((string)($data['role'] ?? 'Student'));
        $role      = in_array($role, ['Student', 'Parent'], true) ? $role : 'Student';
        $email     = strtolower(trim((string)($data['email']        ?? '')));
        $mobileRaw = preg_replace('/\D/', '', trim((string)($data['mobileNumber'] ?? '')));

        $db         = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
        $UsersTable = $this->fetchTable('SaweraSsmsUsers');

        // ══════════════════════════════════════════════════════════════════════
        // PARENT PATH — verified by enrollment ID + mobile cross-check
        // Username = last 10 digits of their mobile, role = parent
        // ══════════════════════════════════════════════════════════════════════
        if ($role === 'Parent') {
            $firstName    = trim((string)($data['firstName']    ?? ''));
            $lastName     = trim((string)($data['lastName']     ?? ''));
            $enrollmentId = strtoupper(trim((string)($data['enrollmentId'] ?? '')));

            if (!$firstName) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => 'Please enter your name.',
                    ]));
            }
            if (!$enrollmentId) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => "Please enter your child's enrollment ID.",
                    ]));
            }
            if (!$mobileRaw) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => 'Mobile number is required for parent registration.',
                    ]));
            }

            $last10 = substr($mobileRaw, -10);

            // Look up the enrollment and verify that the mobile matches school records
            $studentRow = $db->execute("
                SELECT r.ssms_client_code, e.branch_id, r.mobile_number
                FROM   ssms_student_enrollment   e
                JOIN   ssms_student_registration r
                       ON r.registration_id = e.registration_id
                WHERE  e.enrollment_id = ?
                  AND  e.status = 'active'
                LIMIT 1
            ", [$enrollmentId])->fetch('assoc');

            if (!$studentRow) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => 'Enrollment ID not found or the student is not active. Please check and try again.',
                    ]));
            }

            // Verify mobile matches (compare last 10 digits)
            $dbMobileLast10 = substr(preg_replace('/\D/', '', (string)($studentRow['mobile_number'] ?? '')), -10);
            if (!$dbMobileLast10 || $dbMobileLast10 !== $last10) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => 'Mobile number does not match the records for this enrollment ID. Please use the number registered with the school.',
                    ]));
            }

            $clientCode     = $studentRow['ssms_client_code'];
            $branchId       = $studentRow['branch_id'] ?? null;
            $fullName       = trim("{$firstName} {$lastName}");
            $parentUserName = $last10; // parent's login username = 10-digit mobile

            // Check if account already exists
            $existing = $UsersTable->find()
                ->where(['LOWER(ssms_user_name) =' => strtolower($parentUserName),
                         'ssms_client_code'        => $clientCode])
                ->first();

            if ($existing) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => 'An account with this mobile number already exists. Please use Forgot Password to reset your credentials.',
                    ]));
            }

            $plainPassword     = substr(str_shuffle('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'), 0, 8);
            $encryptedPassword = $this->_encryptPassword($plainPassword);
            $now               = date('Y-m-d H:i:s');

            $entity = $UsersTable->newEntity([
                'ssms_user_name'      => $parentUserName,
                'ssms_user_firstname' => $firstName,
                'ssms_user_lastname'  => $lastName ?: $firstName,
                'ssms_user_password'  => $encryptedPassword,
                'ssms_user_role'      => 'parent',
                'ssms_user_status'    => 'Inactive',
                'ssms_client_code'    => $clientCode,
                'branch_id'           => $branchId,
                'validationStatus'    => 'Verified',
                'created'             => $now,
                'modified'            => $now,
            ]);
            // Bypass accessor restrictions to ensure mobile_number and optional
            // email are persisted correctly (fields not in entity's _accessible
            // are silently dropped by newEntity — use set() to bypass the guard).
            $entity->set('mobile_number', $mobileRaw, ['guard' => false]);
            if ($email) {
                $entity->set('ssms_user_email', $email, ['guard' => false]);
            }

            if (!$UsersTable->save($entity)) {
                Log::error('registerStudentParent (parent) save failed: ' . json_encode($entity->getErrors()));
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode([
                        'status'  => false,
                        'message' => 'Failed to create account. Please try again.',
                    ]));
            }

            // Send email if provided
            $emailSent = false;
            if ($email) {
                $emailSent = $this->sendWelcomeEmail(
                    fullName:     $fullName,
                    username:     $parentUserName,
                    email:        $email,
                    tempPassword: $plainPassword,
                    templateName: 'welcome_user'
                );
            }

            $whatsappText = "Hello {$fullName},\n\n"
                . "Your Parent Portal login credentials:\n\n"
                . "User ID: {$parentUserName}\n"
                . "Password: {$plainPassword}\n\n"
                . "Login at the school app to view your child's progress.\n\n"
                . "Thank you";

            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'        => true,
                    'message'       => 'Parent account created successfully.',
                    'fullName'      => $fullName,
                    'sentEmail'     => $emailSent,
                    'sentEmailTo'   => $emailSent ? $email : null,
                    'whatsappPhone' => $mobileRaw,
                    'whatsappText'  => $whatsappText,
                ]));
        }

        // ══════════════════════════════════════════════════════════════════════
        // STUDENT PATH — identified by enrollment ID + date of birth
        // Username = enrollment ID, role = student
        // ══════════════════════════════════════════════════════════════════════
        $enrollmentId = trim((string)($data['enrollmentId'] ?? ''));
        $dobRaw       = trim((string)($data['dateOfBirth']  ?? ''));

        // ── 1. Basic validation ───────────────────────────────────────────────
        if (!$enrollmentId) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Enrollment ID is required.',
                ]));
        }
        if (!$dobRaw) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Date of birth is required.',
                ]));
        }
        if (!$email && !$mobileRaw) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Please provide at least an email address or mobile number for verification.',
                ]));
        }

        // ── 2. Convert DD/MM/YYYY → YYYY-MM-DD for DB comparison ─────────────
        if (!preg_match('/^(\d{2})\/(\d{2})\/(\d{4})$/', $dobRaw, $m)) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Date of birth must be in DD/MM/YYYY format.',
                ]));
        }
        $dobDb = "{$m[3]}-{$m[2]}-{$m[1]}";

        $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();

        // ── 3. Look up the enrolled student ──────────────────────────────────
        // Match on enrollment_id + DOB + (email OR last-10-digits of mobile).
        // Using OR conditions built dynamically.
        $contactConditions = [];
        $contactParams     = [];

        if ($email) {
            $contactConditions[] = "LOWER(r.email_address) = ?";
            $contactParams[]     = $email;
        }
        if ($mobileRaw) {
            // Match last 10 digits — use LIKE for MySQL 5.7 compatibility (no REGEXP_REPLACE)
            $last10              = substr($mobileRaw, -10);
            $contactConditions[] = "r.mobile_number LIKE ?";
            $contactParams[]     = '%' . $last10;
        }

        $contactClause = '(' . implode(' OR ', $contactConditions) . ')';

        $student = $db->execute(
            "SELECT
                 e.enrollment_id,
                 e.registration_id,
                 e.ssms_client_code,
                 e.branch_id,
                 r.student_first_name,
                 r.student_last_name,
                 r.email_address,
                 r.mobile_number
             FROM  ssms_student_enrollment  e
             JOIN  ssms_student_registration r
                   ON r.registration_id = e.registration_id
                  AND r.ssms_client_code = e.ssms_client_code
             WHERE e.enrollment_id     = ?
               AND DATE(r.student_dob) = ?
               AND {$contactClause}
             LIMIT 1",
            array_merge([$enrollmentId, $dobDb], $contactParams)
        )->fetchAssoc();

        if (!$student) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'No enrolled student found matching the provided details. Please verify your enrollment ID, date of birth, and contact information.',
                ]));
        }

        $clientCode   = $student['ssms_client_code'];
        $branchId     = $student['branch_id']          ?? null;
        $firstName    = trim($student['student_first_name'] ?? '');
        $lastName     = trim($student['student_last_name']  ?? '');
        // Some students have no last name — fall back to first name to satisfy NOT NULL constraint
        if ($lastName === '') $lastName = $firstName;
        $fullName     = trim("{$firstName} {$lastName}");
        $storedEmail  = $student['email_address']      ?? '';
        $storedMobile = preg_replace('/\D/', '', (string)($student['mobile_number'] ?? ''));

        // Resolve the email to use: provided by user, or fall back to stored
        $useEmail  = $email  ?: $storedEmail;
        $useMobile = $mobileRaw ?: $storedMobile;

        // ── 4. Check if a user account already exists for this enrollment ID ─
        $UsersTable   = $this->fetchTable('SaweraSsmsUsers');
        $existingUser = $UsersTable->find()
            ->where(['LOWER(ssms_user_name) =' => strtolower($enrollmentId)])
            ->first();

        if ($existingUser) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'An account for this enrollment ID already exists. Please use Forgot Password if you need to reset your credentials.',
                ]));
        }

        // ── 5. Generate a random plain-text password and encrypt it ──────────
        $plainPassword     = substr(str_shuffle('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'), 0, 8);
        $encryptedPassword = $this->_encryptPassword($plainPassword);

        // ── 6. Create the user ────────────────────────────────────────────────
        $now    = date('Y-m-d H:i:s');
        $entity = $UsersTable->newEntity([
            'ssms_user_name'      => $enrollmentId,
            'ssms_user_firstname' => $firstName,
            'ssms_user_lastname'  => $lastName,
            'ssms_user_password'  => $encryptedPassword,
            'ssms_user_email'     => $useEmail,
            'ssms_user_role'      => $role,
            'ssms_user_status'    => 'Inactive', // admin must activate before first login
            'ssms_client_code'    => $clientCode,
            'branch_id'           => $branchId,
            'validationStatus'    => 'Verified',
            'created'             => $now,
            'modified'            => $now,
        ]);

        if (!$UsersTable->save($entity)) {
            Log::error('registerStudentParent save failed: ' . json_encode($entity->getErrors()));
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Failed to create user account. Please try again.',
                ]));
        }

        // ── 7. Send credentials via email (ONLY if user explicitly provided one) ─
        // Do NOT fall back to the stored email — user chose mobile-only verification.
        $emailSent = false;
        if ($email) {
            $emailSent = $this->sendWelcomeEmail(
                fullName:     $fullName,
                username:     $enrollmentId,
                email:        $email,
                tempPassword: $plainPassword,
                templateName: 'welcome_user'
            );
            if (!$emailSent) {
                Log::error("registerStudentParent: welcome email failed for enrollment [{$enrollmentId}]");
            }
        }

        // ── 8. Build WhatsApp message text (if mobile available) ─────────────
        $whatsappText  = null;
        $whatsappPhone = null;
        if ($useMobile) {
            $whatsappPhone = $useMobile;
            $whatsappText  = "Hello {$fullName},\n\n"
                . "Your School Portal login credentials:\n\n"
                . "User ID: {$enrollmentId}\n"
                . "Password: {$plainPassword}\n\n"
                . "Please login and change your password after first login.\n\n"
                . "Thank you";
        }

        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'        => true,
                'message'       => 'Account created successfully.',
                'fullName'      => $fullName,
                'sentEmail'     => $emailSent,
                'sentEmailTo'   => $emailSent ? $email : null,
                'whatsappPhone' => $whatsappPhone,
                'whatsappText'  => $whatsappText,
            ]));
    }

    // =========================================================================
    // POST /UserServiceApi/resendVerificationCode
    // Re-generates and re-sends the 6-digit verification code to the user.
    // Accepts users whose account is Active OR whose validation is still Pending
    // (covers newly registered trial users who haven't verified yet).
    // Body: { username, email }
    // =========================================================================
    
    public function resendVerificationCode()
    {
        $this->request->allowMethod(['post']);

        $data     = $this->request->getData();
        $username = strtolower(trim((string)($data['username'] ?? '')));
        $email    = strtolower(trim((string)($data['email']    ?? '')));

        if (!$username || !$email) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'username and email are required.',
                ]));
        }

        $UsersTable = $this->fetchTable('SaweraSsmsUsers');

        // Accept active users OR users with a pending verification
        $user = $UsersTable->find()
            ->where([
                'LOWER(ssms_user_name) ='  => $username,
                'LOWER(ssms_user_email) =' => $email,
            ])
            ->first();

        if (!$user) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'No account found with that username and email.',
                ]));
        }

        // Generate a fresh 6-digit code
        $code = (string)random_int(100000, 999999);

        $user = $UsersTable->patchEntity($user, [
            'validationCode'   => $code,
            'validationStatus' => 'Pending',
        ]);
        $UsersTable->save($user);

        // Send PIN email
        $emailSent = $this->senPinViaEmail(
            fullName:     trim("{$user['ssms_user_firstname']} " . ($user['ssms_user_lastname'] ?? '')),
            username:     trim($user['ssms_user_name']),
            email:        strtolower(trim($user['ssms_user_email'])),
            tempPassword: $code
        );

        if (!$emailSent) {
            Log::warning("resendVerificationCode: email failed for {$user['ssms_user_name']}");
        }

        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'  => true,
                'message' => 'A new verification code has been sent to your email.',
            ]));
    }

    // =========================================================================
    // POST /UserServiceApi/submitTicket
    // Public — no auth required.
    // Creates a support ticket and emails the admin team (CC: creator).
    // Body (JSON): { name, email_address, mobile_number, problem_description, ssms_client_code }
    // =========================================================================
    public function submitTicket(): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $data = $this->request->getData();

        $name        = trim((string)($data['name']                ?? ''));
        $email       = strtolower(trim((string)($data['email_address']    ?? '')));
        $mobile      = trim((string)($data['mobile_number']       ?? ''));
        $description = trim((string)($data['problem_description'] ?? ''));
        $clientCode  = strtoupper(trim((string)($data['ssms_client_code'] ?? '')));

        // ── Validation ────────────────────────────────────────────────────────
        if (!$name || !$email || !$description) {
            $this->response = $this->response
                ->withStatus(422)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Name, email address and problem description are required.']));
            return;
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->response = $this->response
                ->withStatus(422)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Please provide a valid email address.']));
            return;
        }

        // ── Generate ticket number: TKT-YYYYMMDD-XXXX ────────────────────────
        $db          = $this->getTableLocator()->get('SsmsClients')->getConnection();
        $datePrefix  = 'TKT-' . date('Ymd') . '-';
        $lastRow     = $db->execute(
            "SELECT ticket_number FROM support_tickets WHERE ticket_number LIKE ? ORDER BY ticket_id DESC LIMIT 1",
            [$datePrefix . '%']
        )->fetchAssoc();

        $seq = 1;
        if ($lastRow) {
            $parts = explode('-', $lastRow['ticket_number']);
            $seq   = (int)end($parts) + 1;
        }
        $ticketNumber = $datePrefix . str_pad((string)$seq, 4, '0', STR_PAD_LEFT);

        // ── Insert ────────────────────────────────────────────────────────────
        $now = date('Y-m-d H:i:s');
        try {
            $db->execute(
                "INSERT INTO support_tickets
                    (ticket_number, name, email_address, mobile_number,
                     problem_description, ssms_client_code, status, created, modified)
                 VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?)",
                [
                    $ticketNumber,
                    $name,
                    $email,
                    $mobile ?: null,
                    $description,
                    $clientCode ?: null,
                    $now,
                    $now,
                ]
            );
        } catch (\Exception $e) {
            Log::error('submitTicket DB error: ' . $e->getMessage());
            $this->response = $this->response
                ->withStatus(500)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Failed to save ticket. Please try again.']));
            return;
        }

        // ── Email: To admin, CC creator ───────────────────────────────────────
        $adminEmails = [
            'saquib832002@gmail.com'    => 'Saquib',
            'admin@managemyacademy.com' => 'MMA Admin',
        ];
        $subject = "[Support] New Ticket {$ticketNumber} — {$name}";
        $body    = "A new support request has been submitted.\n\n"
                 . "Ticket #  : {$ticketNumber}\n"
                 . "Name      : {$name}\n"
                 . "Email     : {$email}\n"
                 . "Mobile    : " . ($mobile ?: 'N/A') . "\n"
                 . "School    : " . ($clientCode ?: 'N/A') . "\n\n"
                 . "Problem Description:\n{$description}\n\n"
                 . "Please log in to the admin panel to respond.\n";
        try {
            $mailer = new Mailer('default');
            $mailer->setEmailFormat('text')
                   ->setFrom(env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'), env('MAIL_FROM_NAME', 'ManageMyAcademy'))
                   ->setSubject($subject)
                   ->setCc([$email => $name]);
            foreach ($adminEmails as $addr => $adminName) {
                $mailer->setTo($addr, $adminName);
                $mailer->deliver($body);
            }
        } catch (\Exception $e) {
            Log::error('submitTicket email error: ' . $e->getMessage());
        }

        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status'        => true,
                'ticket_number' => $ticketNumber,
                'message'       => "Your ticket {$ticketNumber} has been submitted. We will respond to {$email} shortly.",
            ]));
    }

    // =========================================================================
    // GET /UserServiceApi/getTickets
    // Requires auth (admin / owner role via header).
    // Returns all tickets. If ssmsClientCode header is provided, scopes to that school.
    // =========================================================================
    public function getTickets(): void
    {
        $this->request->allowMethod(['get']);
        $this->autoRender = false;

        $role       = strtolower(trim($this->request->getHeaderLine('ssmsUserRole')   ?? ''));
        $clientCode = strtoupper(trim($this->request->getHeaderLine('ssmsClientCode') ?? ''));

        if (!in_array($role, ['admin', 'owner'])) {
            $this->response = $this->response
                ->withStatus(403)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Access denied. Admin or owner role required.']));
            return;
        }

        $db     = $this->getTableLocator()->get('SsmsClients')->getConnection();
        $where  = $clientCode ? "WHERE ssms_client_code = ?" : "WHERE 1=1";
        $params = $clientCode ? [$clientCode] : [];

        $status = $this->request->getQuery('status');
        if ($status) {
            $where  .= " AND status = ?";
            $params[] = $status;
        }

        $tickets = $db->execute(
            "SELECT ticket_id, ticket_number, name, email_address, mobile_number,
                    problem_description, ssms_client_code, status, response, created, modified
             FROM   support_tickets
             {$where}
             ORDER  BY ticket_id DESC",
            $params
        )->fetchAll('assoc');

        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode(['status' => true, 'data' => $tickets]));
    }

    // =========================================================================
    // POST /UserServiceApi/updateTicket/{ticketId}
    // Requires auth (admin / owner role).
    // Updates status and/or response. Emails creator (CC admin).
    // Body (JSON): { status, response }
    // =========================================================================
    public function updateTicket(int $ticketId = 0): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $role = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));
        if (!in_array($role, ['admin', 'owner'])) {
            $this->response = $this->response
                ->withStatus(403)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Access denied.']));
            return;
        }

        $db     = $this->getTableLocator()->get('SsmsClients')->getConnection();
        $ticket = $db->execute(
            "SELECT * FROM support_tickets WHERE ticket_id = ? LIMIT 1",
            [$ticketId]
        )->fetchAssoc();

        if (!$ticket) {
            $this->response = $this->response
                ->withStatus(404)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Ticket not found.']));
            return;
        }

        $data      = $this->request->getData();
        $newStatus = trim((string)($data['status'] ?? $ticket['status']));
        $newReply  = trim((string)($data['reply']  ?? ''));

        $validStatuses = ['Open', 'In Progress', 'Resolved', 'Closed'];
        if (!in_array($newStatus, $validStatuses, true)) {
            $this->response = $this->response
                ->withStatus(422)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Invalid status value.']));
            return;
        }

        // ── Append new reply to existing conversation thread ──────────────────
        $existingResponse = (string)($ticket['response'] ?? '');
        $updatedResponse  = $existingResponse;
        if ($newReply !== '') {
            $responderName = trim($this->request->getHeaderLine('ssmsUserName') ?? '');
            if ($responderName === '') $responderName = 'Admin';
            $timestamp     = date('d M Y, h:i A');
            $entry         = "[{$timestamp}][{$responderName}]\n{$newReply}";
            $updatedResponse = $existingResponse !== ''
                ? $existingResponse . "\n\n" . $entry
                : $entry;
        }

        $now = date('Y-m-d H:i:s');
        $db->execute(
            "UPDATE support_tickets SET status = ?, response = ?, modified = ? WHERE ticket_id = ?",
            [$newStatus, $updatedResponse ?: null, $now, $ticketId]
        );

        // ── Email creator, CC admin ───────────────────────────────────────────
        $adminEmails = ['saquib832002@gmail.com', 'admin@managemyacademy.com'];
        $subject = "[Support] Ticket {$ticket['ticket_number']} Updated — Status: {$newStatus}";
        $body    = "Your support ticket has been updated.\n\n"
                 . "Ticket #  : {$ticket['ticket_number']}\n"
                 . "Status    : {$newStatus}\n\n"
                 . ($newReply ? "Latest Reply:\n{$newReply}\n\n" : '')
                 . "Original Issue:\n{$ticket['problem_description']}\n\n"
                 . "If you have further questions, please submit a new ticket or reply to this email.\n";
        try {
            $mailer = new Mailer('default');
            $mailer->setEmailFormat('text')
                   ->setFrom(env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'), env('MAIL_FROM_NAME', 'ManageMyAcademy'))
                   ->setSubject($subject)
                   ->setTo($ticket['email_address'], $ticket['name'])
                   ->setCc($adminEmails)
                   ->deliver($body);
        } catch (\Exception $e) {
            Log::error('updateTicket email error: ' . $e->getMessage());
        }

        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status'           => true,
                'message'          => "Ticket {$ticket['ticket_number']} updated to '{$newStatus}'.",
                'updated_response' => $updatedResponse,
                'updated_status'   => $newStatus,
            ]));
    }
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
 private function _json(array $data)
    {
        $this->response = $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($data));
        return $this->response;
    }
}