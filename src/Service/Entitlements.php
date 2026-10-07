<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Cache\Cache;
use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Entitlements – which modules a school may use.
 *
 * One shared backend serves two kinds of school, decided by
 * ssms_clients.billing_model (set once at sign-up, editable by superadmin):
 *
 *   'legacy'       Indian schools (default for every existing row).
 *                  No module paywall – behaviour is unchanged.
 *   'subscription' International schools. 'core' is free; every other
 *                  school-app feature needs an active row in
 *                  ssms_client_features (trial / subscription / manual).
 *
 * Two separate things, two separate tables:
 *   ssms_client_modules   PRODUCT modules (school, finance, library, donation)
 *                         – unchanged, managed on the web "Manage Modules" page.
 *   ssms_client_features  PLAN features inside the school app
 *                         (attendance, fees, exams …) – subscription schools only.
 *
 * To change which screens are free/paid, edit CONTROLLER_MODULES and
 * ACTION_MODULES below. Nothing else needs to change.
 */
final class Entitlements
{
    public const LEGACY       = 'legacy';
    public const SUBSCRIPTION = 'subscription';

    /** Always available to subscription schools. */
    public const FREE_MODULES = ['core'];

    /** Paid modules for subscription schools (granted during the trial). */
    public const PAID_MODULES = [
        'attendance', 'notices', 'fees', 'exams', 'academics',
        'assessments', 'hostel', 'transport', 'communication',
    ];

    public const TRIAL_DAYS = 14;

    /** Product-level modules: checked against ssms_client_modules (as the web panel does). */
    public const PRODUCT_MODULES = ['school', 'finance', 'library', 'donation'];

    /** Default module for every action of an API controller. */
    private const CONTROLLER_MODULES = [
        // ── Free (core) ──────────────────────────────────────────────────────
        'UserServiceApi'           => 'core',
        'SetupServiceApi'          => 'core',
        'DashboardServiceApi'      => 'core',
        'SchoolSettingsServiceApi' => 'core',
        'SubjectServiceApi'        => 'core',
        'StaffServiceApi'          => 'core',
        'StudentApi'               => 'core',
        'SubscriptionApi'          => 'core',   // phase 2 – billing screens

        // ── Paid ─────────────────────────────────────────────────────────────
        'FeeApi'                   => 'fees',
        'HostelServiceApi'         => 'hostel',
        'TransportServiceApi'      => 'transport',
        'ExamServiceApi'           => 'exams',
        'DatesheetApi'             => 'exams',
        'TimeTableServiceApi'      => 'academics',
        'HomeworkApi'              => 'academics',
        'LeaveApi'                 => 'academics',
        'QuestionBankApi'          => 'assessments',
        'QuestionPaperApi'         => 'assessments',
        'TestSeriesApi'            => 'assessments',
        'ChapterApi'               => 'assessments',
        'NoticeApi'                => 'notices',
        'SchoolEventsApi'          => 'notices',
        'SchoolGalleryApi'         => 'communication',
        'ChatApi'                  => 'communication',
        'CertificateApi'           => 'communication',

        // ── Other product lines (unchanged keys) ─────────────────────────────
        'FinanceApi'               => 'finance',
        'LibraryCatalogApi'        => 'library',
        'LibraryMemberApi'         => 'library',
        'LibraryCirculationApi'    => 'library',
        'LibraryFineApi'           => 'library',
        'LibraryAdminApi'          => 'library',
        'LibraryFacilityApi'       => 'library',
        'LibrarySerialApi'         => 'library',
        'LibraryAcquisitionApi'    => 'library',
        'LibraryProgramApi'        => 'library',
        'LibraryUserApi'           => 'library',
    ];

    /** Per-action overrides for controllers that serve several modules. */
    private const ACTION_MODULES = [
        'StudentApi' => [
            'getStudentsAttendance' => 'attendance',
            'saveAttendance'        => 'attendance',
            'getRecentAttendance'   => 'attendance',
            'getMonthlyAttendance'  => 'attendance',
            'getMyAttendance'       => 'attendance',
            'getIdCardData'         => 'communication',
            'insertAllFees'         => 'fees',
        ],
        'SubjectServiceApi' => [
            'getMaxMarks'    => 'exams',
            'createMaxMarks' => 'exams',
            'updateMaxMarks' => 'exams',
            'deleteMaxMarks' => 'exams',
        ],
        'SchoolSettingsServiceApi' => [
            'getIdCardConfig'  => 'communication',
            'saveIdCardConfig' => 'communication',
        ],
        'ChatApi' => [
            // Background presence ping from MainTabs every 30 s – keep it free
            // so locked schools don't get errors on every screen.
            'heartbeat' => 'core',
        ],
    ];

    private const CACHE_CONFIG = 'entitlements';

    /**
     * Module key needed for a controller/action, or null when the
     * controller is not mapped (subscription schools are denied).
     */
    public static function moduleFor(string $controller, string $action): ?string
    {
        foreach (self::ACTION_MODULES as $ctrl => $actions) {
            if (strcasecmp($ctrl, $controller) !== 0) {
                continue;
            }
            foreach ($actions as $act => $module) {
                if (strcasecmp($act, $action) === 0) {
                    return $module;
                }
            }
        }
        foreach (self::CONTROLLER_MODULES as $ctrl => $module) {
            if (strcasecmp($ctrl, $controller) === 0) {
                return $module;
            }
        }

        return null;
    }

    /**
     * Entitlements for a school (cached for 60 s).
     *
     * @return array{billing_model:string, modules:string[], features:string[], expiries:array<string,string>}
     */
    public static function forClient(string $clientCode): array
    {
        $clientCode = trim($clientCode);
        if ($clientCode === '') {
            return ['billing_model' => self::LEGACY, 'modules' => [], 'features' => [], 'expiries' => []];
        }

        $key = self::cacheKey($clientCode);
        if (self::ensureCache()) {
            try {
                $cached = Cache::read($key, self::CACHE_CONFIG);
                if (is_array($cached)) {
                    return $cached;
                }
            } catch (\Throwable $e) {
                // cache problems must never block a request
            }
        }

        $ent = self::load($clientCode);

        if (self::ensureCache()) {
            try {
                Cache::write($key, $ent, self::CACHE_CONFIG);
            } catch (\Throwable $e) {
            }
        }

        return $ent;
    }

    /** Forget the cached value (call after changing a school's modules). */
    public static function clear(string $clientCode): void
    {
        if (self::ensureCache()) {
            try {
                Cache::delete(self::cacheKey($clientCode), self::CACHE_CONFIG);
            } catch (\Throwable $e) {
            }
        }
    }

    public static function isSubscription(array $ent): bool
    {
        return ($ent['billing_model'] ?? self::LEGACY) === self::SUBSCRIPTION;
    }

    /** Can this school use the given module? Legacy schools: always yes. */
    public static function allows(array $ent, ?string $module): bool
    {
        if (!self::isSubscription($ent)) {
            return true;
        }
        if ($module === null) {
            return false;
        }
        if (in_array($module, self::FREE_MODULES, true) || $module === 'school') {
            return true;
        }
        if (in_array($module, self::PRODUCT_MODULES, true)) {
            // finance / library / donation: same product grant the web panel uses
            return in_array($module, $ent['modules'] ?? [], true);
        }

        return in_array($module, $ent['features'] ?? [], true);
    }

    /** Human label used in the 402 message. */
    public static function label(?string $module): string
    {
        $labels = [
            'attendance'    => 'Attendance',
            'notices'       => 'Notice Board & Events',
            'fees'          => 'Fees',
            'exams'         => 'Exams & Results',
            'academics'     => 'Timetable, Homework & Leave',
            'assessments'   => 'Question Bank & Test Series',
            'hostel'        => 'Hostel',
            'transport'     => 'Transport',
            'communication' => 'Chat, Gallery, Certificates & ID Cards',
            'finance'       => 'Finance',
            'library'       => 'Library',
        ];

        return $labels[$module ?? ''] ?? 'This feature';
    }

    // ── internals ────────────────────────────────────────────────────────────

    private static function load(string $clientCode): array
    {
        $conn    = ConnectionManager::get('default');
        $billing = self::LEGACY;

        try {
            $row = $conn->execute(
                'SELECT billing_model FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1',
                [$clientCode]
            )->fetch('assoc');
            if (strtolower(trim((string)($row['billing_model'] ?? ''))) === self::SUBSCRIPTION) {
                $billing = self::SUBSCRIPTION;
            }
        } catch (\Throwable $e) {
            // Migration not run yet → every school stays legacy (today's behaviour).
            Log::warning('Entitlements: billing_model unavailable – ' . $e->getMessage());
        }

        // ── Product modules: exactly what the web panel reads (no expiry logic) ──
        $rows    = $conn->execute(
            'SELECT module_key FROM ssms_client_modules WHERE ssms_client_code = ?',
            [$clientCode]
        )->fetchAll('assoc');
        $modules = array_values(array_unique(array_column($rows, 'module_key')));
        if ($modules === []) {
            $modules = ['school']; // same default as login always used
        }

        // ── Plan features: subscription schools only ─────────────────────────
        $features = [];
        $expiries = [];
        if ($billing === self::SUBSCRIPTION) {
            try {
                // Trial rows follow the school's ssms_client_expiry_date (one date
                // to extend a trial); paid / manual rows follow their expires_at.
                $frows = $conn->execute(
                    "SELECT f.feature_key,
                            CASE WHEN f.source = 'trial' AND c.ssms_client_expiry_date IS NOT NULL
                                 THEN CONCAT(c.ssms_client_expiry_date, ' 23:59:59')
                                 ELSE f.expires_at END AS expires_at
                       FROM ssms_client_features f
                       JOIN ssms_clients c ON c.ssms_client_code = f.ssms_client_code
                      WHERE f.ssms_client_code = ?
                        AND (
                              (f.source = 'trial'
                                 AND c.ssms_client_expiry_date IS NOT NULL
                                 AND c.ssms_client_expiry_date >= CURDATE())
                           OR ((f.source <> 'trial' OR c.ssms_client_expiry_date IS NULL)
                                 AND (f.expires_at IS NULL OR f.expires_at > NOW()))
                        )",
                    [$clientCode]
                )->fetchAll('assoc');
                foreach ($frows as $r) {
                    $key        = (string)$r['feature_key'];
                    $features[] = $key;
                    if (!empty($r['expires_at'])) {
                        $expiries[$key] = (string)$r['expires_at'];
                    }
                }
            } catch (\Throwable $e) {
                // Phase-3 migration not run yet → only free features (fail closed).
                Log::error('Entitlements: ssms_client_features unavailable – ' . $e->getMessage());
            }
            $features = array_values(array_unique(array_merge(self::FREE_MODULES, $features)));
        }

        return [
            'billing_model' => $billing,
            'modules'       => $modules,
            'features'      => $features,
            'expiries'      => $expiries,
        ];
    }

    private static function cacheKey(string $clientCode): string
    {
        return 'ent_' . preg_replace('/[^A-Za-z0-9_]/', '_', $clientCode);
    }

    private static function ensureCache(): bool
    {
        try {
            if (!in_array(self::CACHE_CONFIG, Cache::configured(), true)) {
                Cache::setConfig(self::CACHE_CONFIG, [
                    'className' => 'File',
                    'prefix'    => 'ent_',
                    'path'      => CACHE . 'entitlements' . DS,
                    'duration'  => '+60 seconds',
                ]);
            }

            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }
}
