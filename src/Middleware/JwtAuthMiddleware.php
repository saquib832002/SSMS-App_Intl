<?php
declare(strict_types=1);

namespace App\Middleware;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\SignatureInvalidException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use App\Service\Entitlements;

/**
 * JwtAuthMiddleware
 *
 * Place at: src/Middleware/JwtAuthMiddleware.php
 *
 * Register in src/Application.php middlewareQueue:
 *   ->add(new \App\Middleware\JwtAuthMiddleware())
 *
 * config/.env:
 *   JWT_SECRET=your-32-char-secret
 *   JWT_EXPIRY_HOURS=8
 *
 * IMPORTANT: Only intercepts API routes (/studentApi/, /feeApi/, etc.)
 * All other routes (web pages, CakePHP sessions) pass through untouched.
 */
class JwtAuthMiddleware implements MiddlewareInterface
{
    // ── API route prefixes — ONLY these paths go through JWT check ────────────
    // Web routes (/SaweraSsmsUsers/login, /dashboard, etc.) are NOT in this
    // list and will pass through without any JWT check.
    private const API_PREFIXES = [
        '/FeeApi/',
        '/UserServiceApi/',
        '/StudentApi/',
        '/SetupServiceApi/',
        '/HostelServiceApi/',
        '/StaffServiceApi/',
        '/DashboardServiceApi/',
        '/SubjectServiceApi/',
        '/ExamServiceApi/',
        '/TransportServiceApi/',
        '/TimeTableServiceApi/',
        '/SchoolEventsApi/',
        '/HomeworkApi/',
        '/LibraryCatalogApi', 
        '/LibraryMemberApi', 
        '/LibraryCirculationApi',
        '/LibraryFineApi', 
        '/LibraryAdminApi', 
        '/LibraryFacilityApi',
        '/LibrarySerialApi', 
        '/LibraryAcquisitionApi', 
        '/LibraryProgramApi',
        '/LibraryUserApi',
        '/NoticeApi',
        '/SchoolGalleryApi',
        '/SchoolSettingsServiceApi',
        '/DatesheetApi',
        '/QuestionBankApi',
        '/QuestionPaperApi',
        '/TestSeriesApi',
        '/ChatApi',
        '/CertificateApi',
        '/LeaveApi',
        '/SubscriptionApi/',
    ];

    // ── Public API routes — no token required ─────────────────────────────────
    private const PUBLIC_ROUTES = [
        'UserServiceApi/login',
        'UserServiceApi/registerTrialUser',
        'UserServiceApi/verifyEmail',
        'UserServiceApi/resendVerificationCode',
        'UserServiceApi/sendForgotPassword',
        'UserServiceApi/verifyForgotPassword',
        'UserServiceApi/resetPassword',
        'FeeApi/getFeeItems',
        'FeeApi/getClassFeeStructure',
        'UserServiceApi/registerStudentParent',
        'UserServiceApi/submitTicket',
        'SubscriptionApi/stripeWebhook',   // verified by Stripe-Signature instead
    ];

    public function process(
        ServerRequestInterface $request,
        RequestHandlerInterface $handler
    ): ResponseInterface {

        $path = $request->getUri()->getPath();

        // ── Step 1: Is this an API route at all? ──────────────────────────────
        $isApiRoute = false;
        foreach (self::API_PREFIXES as $prefix) {
            if (strpos($path, $prefix) !== false) {
                $isApiRoute = true;
                break;
            }
        }

        if (!$isApiRoute) {
            return $handler->handle($request);
        }

        // ── Step 2: Is this a public API route? ───────────────────────────────
        $isPublic = false;
        foreach (self::PUBLIC_ROUTES as $publicRoute) {
            if (strpos($path, $publicRoute) !== false) {
                $isPublic = true;
                break;
            }
        }

        if ($isPublic) {
            return $handler->handle($request);
        }

        // ── Step 3: Protected API route — check for web session first ───────────
        // Web-page AJAX calls use CakePHP sessions (not JWT). If a valid PHP
        // session with ssms_client_code exists we let the request through,
        // injecting the session value as a request attribute so controllers
        // work identically whether called via mobile JWT or web session.
        $sessionClientCode = '';
        if (\PHP_SESSION_ACTIVE === session_status()) {
            // Session already open — just read
            $sessionClientCode = (string)($_SESSION['ssms_client_code'] ?? '');
        } elseif (\PHP_SESSION_NONE === session_status() && !headers_sent()) {
            // Open read-only (read_and_close releases the lock immediately so
            // CakePHP's own session handling later in the stack is not blocked)
            session_start(['read_and_close' => true]);
            $sessionClientCode = (string)($_SESSION['ssms_client_code'] ?? '');
        }

        if ($sessionClientCode !== '') {
            $request = $request
                ->withAttribute('jwt_client_code', $sessionClientCode)
                ->withAttribute('jwt_user',        '')
                ->withAttribute('jwt_role',        '')
                ->withAttribute('jwt_branch_id',   null);
            return $this->guardModules($request, $handler, $sessionClientCode, $path);
        }

        // ── Step 4: No session — fall back to Bearer token validation ─────────
        $authHeader = $request->getHeaderLine('Authorization');

        if (empty($authHeader) || strpos($authHeader, 'Bearer ') !== 0) {
            return $this->jsonError(
                401,
                'Authorization token is missing. Please log in.'
            );
        }

        $token  = trim(substr($authHeader, 7));

        // Try env() first, then Configure (set in config/app_local.php)
        $secret = env('JWT_SECRET', '') ?: \Cake\Core\Configure::read('Jwt.secret', '') ?: '';

        if (empty($secret)) {
            \Cake\Log\Log::error('JWT_SECRET missing. Set in .env or config/app_local.php');
            return $this->jsonError(500, 'Server configuration error. Contact administrator.');
        }

        // ── Step 5: Decode and verify ─────────────────────────────────────────
        try {
            $decoded = JWT::decode($token, new Key($secret, 'HS256'));

        } catch (ExpiredException $e) {
            return $this->jsonError(
                401,
                'Your session has expired. Please log in again.'
            );
        } catch (SignatureInvalidException $e) {
            return $this->jsonError(
                401,
                'Invalid token signature. Please log in again.'
            );
        } catch (\Exception $e) {
            return $this->jsonError(
                401,
                'Invalid token. Please log in again.'
            );
        }

        // ── Step 6: Attach verified claims as request attributes ──────────────
        // Controllers read these via $this->request->getAttribute('jwt_role') etc.
        // Login (UserServiceApiController::login) writes the username as
        // `user`; `sub` is kept as a fallback for any older tokens.
        $clientCode = (string)($decoded->client_code ?? '');
        $request = $request
            ->withAttribute('jwt_user',          (string)($decoded->user ?? $decoded->sub ?? ''))
            ->withAttribute('jwt_role',          $decoded->role          ?? '')
            ->withAttribute('jwt_client_code',   $clientCode)
            ->withAttribute('jwt_branch_id',     $decoded->branch_id     ?? null)
            ->withAttribute('jwt_enrollment_id', $decoded->enrollment_id ?? null);

        return $this->guardModules($request, $handler, $clientCode, $path);
    }

    /**
     * Subscription paywall.
     *
     * Looks up the school's CURRENT entitlements (cached 60 s – not the copy
     * inside the 30-day token) and, for subscription schools only, refuses
     * API calls to modules they have not paid for with HTTP 402.
     * Legacy (Indian) schools always pass straight through.
     */
    private function guardModules(
        ServerRequestInterface $request,
        RequestHandlerInterface $handler,
        string $clientCode,
        string $path
    ): ResponseInterface {
        try {
            $ent = Entitlements::forClient($clientCode);
        } catch (\Throwable $e) {
            // Never lock anyone out because of a lookup failure; behave as before.
            \Cake\Log\Log::error('Entitlements lookup failed for ' . $clientCode . ': ' . $e->getMessage());
            return $handler->handle($request);
        }

        $request = $request
            ->withAttribute('jwt_active_modules', $ent['modules'])
            ->withAttribute('jwt_billing_model',  $ent['billing_model']);

        if (Entitlements::isSubscription($ent)) {
            [$controller, $action] = $this->routeOf($request, $path);
            $module = Entitlements::moduleFor($controller, $action);

            if (!Entitlements::allows($ent, $module)) {
                if ($module === null) {
                    \Cake\Log\Log::warning("Paywall: unmapped API {$controller}/{$action} denied for {$clientCode}");
                }
                return $this->jsonError(
                    402,
                    Entitlements::label($module) . " is not included in your school's plan. "
                    . 'Please ask your school administrator to upgrade the subscription.',
                    ['code' => 'MODULE_LOCKED', 'module' => $module ?? 'unknown']
                );
            }
        }

        return $handler->handle($request);
    }

    /** Controller + action for this request (RoutingMiddleware runs first). */
    private function routeOf(ServerRequestInterface $request, string $path): array
    {
        $params     = $request->getAttribute('params');
        $controller = is_array($params) ? (string)($params['controller'] ?? '') : '';
        $action     = is_array($params) ? (string)($params['action'] ?? '') : '';

        if ($controller === '' && preg_match('#/([A-Za-z]+Api)/([A-Za-z0-9_]+)#', $path, $m)) {
            $controller = $m[1];
            $action     = $m[2];
        }

        return [$controller, $action];
    }

    private function jsonError(int $status, string $message, array $extra = []): ResponseInterface
    {
        $response = new \Laminas\Diactoros\Response();
        $response->getBody()->write(json_encode([
            'status'  => false,
            'message' => $message,
        ] + $extra));
        return $response
            ->withStatus($status)
            ->withHeader('Content-Type', 'application/json');
    }
}