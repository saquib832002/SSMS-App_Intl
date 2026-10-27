<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Service\Audit;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Records every successful change (POST / PUT / PATCH / DELETE) in the audit log:
 *   - API calls (app): when the JSON reply is not {status:false};
 *   - web pages: when the page redirects afterwards (CakePHP's "saved" pattern).
 * Values of secret fields are masked; files are not stored. Sign-ins, two-step login,
 * roles and privacy actions are logged in more detail by their own code, so they are skipped here.
 *
 * Add after JwtAuthMiddleware in Application::middleware().
 */
class AuditMiddleware implements MiddlewareInterface
{
    /** Not worth logging (noise) or logged in detail elsewhere. */
    private const SKIP_CONTROLLERS = ['ChatApi', 'AuditApi', 'SecurityApi', 'RolesApi', 'PrivacyApi', 'StudentRecordApi', 'MeetingApi', 'AnalyticsApi', 'ExamLogisticsApi', 'CoverApi', 'CalendarApi', 'CalendarFeed', 'SafetyApi', 'BusTrackingApi', 'BusDevice', 'LocaleApi', 'NotifyApi', 'NotifyHook', 'DebugKit'];
    private const SKIP_ACTIONS = [
        'UserServiceApi' => ['login', 'loginVerify', 'loginEmailCode', 'mfaSetupStart', 'mfaSetupConfirm', 'changePassword',
                             'resetPassword', 'sendForgotPasswordCode', 'verifyForgotPasswordCode', 'resendVerificationCode',
                             'registerTrialUser', 'registerStudentParent', 'savePushToken', 'updatePushToken', 'checkSchoolEmail', 'checkUserEmail'],
        'SaweraSsmsUsers' => ['login', 'logout', 'loginVerify'],
        'StaffAttendanceApi' => ['checkIn', 'checkOut'],
        'SubscriptionApi' => ['stripeWebhook', 'revenuecatWebhook'],
    ];

    private const CATEGORY = [
        'FeeApi' => 'money', 'OnlinePayApi' => 'money', 'SubscriptionApi' => 'money',
        'UserServiceApi' => 'access', 'SaweraSsmsUsers' => 'access',
        'SetupServiceApi' => 'settings', 'SchoolSettingsServiceApi' => 'settings',
    ];

    /** Request fields used as "which record" (first one present). */
    private const ID_KEYS = ['id', 'enrollment_id', 'enrollmentId', 'registration_id', 'staff_id', 'staffId', 'student_id', 'exam_id',
                             'receipt_number', 'receipt_no', 'username', 'ssms_user_name', 'fee_item_id', 'class_id', 'run_id'];

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $response = $handler->handle($request);
        $method   = strtoupper($request->getMethod());
        if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            return $response;
        }
        try {
            $params     = $request->getAttribute('params') ?: [];
            $controller = (string)($params['controller'] ?? '');
            $action     = (string)($params['action'] ?? '');
            if ($controller === '' || in_array($controller, self::SKIP_CONTROLLERS, true)
                || in_array($action, self::SKIP_ACTIONS[$controller] ?? [], true) || ($params['plugin'] ?? null)) {
                return $response;
            }
            $status = $response->getStatusCode();
            $isApi  = str_ends_with($controller, 'Api');
            if ($isApi) {
                if ($status >= 400) {
                    return $response;
                }
                $type = $response->getHeaderLine('Content-Type');
                if ($type !== '' && !str_contains($type, 'json')) {
                    return $response;   // file downloads etc.
                }
                $stream = $response->getBody();
                if (!$stream->isSeekable()) {
                    return $response;   // streamed reply – don't consume it
                }
                $body = (string)$stream;
                $stream->rewind();
                $json = json_decode($body, true);
                if (is_array($json) && array_key_exists('status', $json) && ($json['status'] === false || $json['status'] === 'error')) {
                    return $response;   // the action said no
                }
            } elseif ($status < 300 || $status >= 400) {
                return $response;       // web form re-shown (validation error) – nothing saved
            }
            $data = (array)$request->getParsedBody();
            $pass = (array)($params['pass'] ?? []);
            $entityId = '';
            foreach (self::ID_KEYS as $k) {
                if (isset($data[$k]) && is_scalar($data[$k]) && (string)$data[$k] !== '') {
                    $entityId = (string)$data[$k];
                    break;
                }
            }
            if ($entityId === '' && $pass) {
                $entityId = (string)$pass[0];
            }
            Audit::fromRequest($request, $controller . '.' . $action, [
                'category'    => self::category($controller, $action),
                'entity_type' => preg_replace('/(ServiceApi|Api)$/', '', $controller),
                'entity_id'   => $entityId,
                'summary'     => self::label($controller, $action) . ($entityId !== '' ? ' · ' . $entityId : ''),
                'changes'     => $data ?: null,
            ]);
        } catch (\Throwable $e) {
            \Cake\Log\Log::warning('AuditMiddleware: ' . $e->getMessage());
        }

        return $response;
    }

    private static function category(string $controller, string $action): string
    {
        if (isset(self::CATEGORY[$controller])) {
            return self::CATEGORY[$controller];
        }
        if (str_starts_with($controller, 'Fin') || str_contains($controller, 'Fee') || preg_match('/fee|pay|refund|discount|salary/i', $action)) {
            return 'money';
        }
        if (preg_match('/user|role|password/i', $action)) {
            return 'access';
        }
        if (preg_match('/setting|config/i', $controller . $action)) {
            return 'settings';
        }

        return 'records';
    }

    /** "StudentApi.markAttendance" → "Student: mark attendance" */
    private static function label(string $controller, string $action): string
    {
        $c = trim(preg_replace('/(?<!^)([A-Z])/', ' $1', preg_replace('/(ServiceApi|Api)$/', '', $controller)));
        $a = strtolower(trim(preg_replace('/(?<!^)([A-Z])/', ' $1', $action)));

        return $c . ': ' . $a;
    }
}
