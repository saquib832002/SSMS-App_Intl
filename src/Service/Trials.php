<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Cache\Cache;
use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Trials – free-trial length and per-school trial management
 * (international / 'subscription' schools only).
 *
 * How a trial works (unchanged):
 *   • A school's trial END DATE is ssms_clients.ssms_client_expiry_date.
 *   • During the trial every paid feature has a row in ssms_client_features
 *     with source = 'trial'; those rows are active while the end date is
 *     today or later (see Entitlements::load()).
 *
 * What this class adds:
 *   • Default trial length for NEW schools, stored in
 *     ssms_platform_settings ('trial_days'), editable by the platform owner
 *     (web superuser) – no code change / redeploy needed.
 *   • Per-school actions: extend, set end date, end now, restart.
 *   • "Apply new default to schools currently in trial".
 *   • Every change is written to ssms_trial_changes (history).
 *
 * Indian ('legacy') schools are never touched.
 * Run Database/migrations/2026_10_subscription_phase5_trial_settings.sql first;
 * until then the default falls back to env TRIAL_DAYS or 14.
 */
final class Trials
{
    public const FALLBACK_DAYS = 14;
    public const MIN_DAYS      = 1;
    public const MAX_DAYS      = 365;

    private const SETTING_KEY  = 'trial_days';
    private const CACHE_CONFIG = 'entitlements';      // same file cache as Entitlements
    private const CACHE_KEY    = 'platform_trial_days';

    private static ?int $memo = null;

    // ── Default trial length ────────────────────────────────────────────────

    /** Trial length (days) given to NEW international schools. */
    public static function defaultDays(): int
    {
        if (self::$memo !== null) {
            return self::$memo;
        }
        $days = null;
        if (self::ensureCache()) {
            try {
                $cached = Cache::read(self::CACHE_KEY, self::CACHE_CONFIG);
                if (is_int($cached)) {
                    $days = $cached;
                }
            } catch (\Throwable $e) {
            }
        }
        if ($days === null) {
            try {
                $row = ConnectionManager::get('default')->execute(
                    'SELECT setting_value FROM ssms_platform_settings WHERE setting_key = ? LIMIT 1',
                    [self::SETTING_KEY]
                )->fetch('assoc');
                if ($row && is_numeric($row['setting_value'])) {
                    $days = (int)$row['setting_value'];
                }
            } catch (\Throwable $e) {
                // migration not run yet
            }
            if ($days === null) {
                $env  = function_exists('env') ? env('TRIAL_DAYS', null) : null;
                $days = is_numeric($env) ? (int)$env : self::FALLBACK_DAYS;
            }
            $days = self::clamp($days);
            if (self::ensureCache()) {
                try {
                    Cache::write(self::CACHE_KEY, $days, self::CACHE_CONFIG);
                } catch (\Throwable $e) {
                }
            }
        }

        return self::$memo = self::clamp($days);
    }

    /**
     * Change the default trial length. Optionally re-calculate the end date of
     * every school that is CURRENTLY in its trial (registration date + $days).
     *
     * @return array{old:int,new:int,updatedSchools:int}
     */
    public static function setDefaultDays(int $days, string $by, bool $applyToCurrent = false, string $note = ''): array
    {
        self::assertDays($days);
        $old  = self::defaultDays();
        $conn = ConnectionManager::get('default');
        $conn->execute(
            'INSERT INTO ssms_platform_settings (setting_key, setting_value, updated_by)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
            [self::SETTING_KEY, (string)$days, $by]
        );
        self::log(null, 'default_days', (string)$old, (string)$days, $note, $by);
        self::forgetDefault();

        $updated = $applyToCurrent ? self::applyDefaultToCurrentTrials($days, $by) : 0;

        return ['old' => $old, 'new' => $days, 'updatedSchools' => $updated];
    }

    /**
     * Schools currently in trial (end date today or later, trial rows present,
     * nothing paid) get end date = registration date + $days (never before today).
     */
    public static function applyDefaultToCurrentTrials(int $days, string $by): int
    {
        self::assertDays($days);
        $count = 0;
        foreach (self::listSchools() as $s) {
            if ($s['state'] !== 'trial' || empty($s['registeredOn'])) {
                continue;
            }
            $new = (new \DateTimeImmutable($s['registeredOn']))->modify("+{$days} days");
            $today = self::dbToday();
            if ($new < $today) {
                $new = $today;
            }
            $newStr = $new->format('Y-m-d');
            if ($newStr === $s['trialEnd']) {
                continue;
            }
            self::writeEndDate($s['code'], $newStr, 'apply_default', "Default changed to {$days} days", $by);
            $count++;
        }

        return $count;
    }

    // ── Per-school actions ───────────────────────────────────────────────────

    /** Extend by N days, counted from the current end date (or today if already ended). */
    public static function extend(string $clientCode, int $days, string $by, string $note = '', string $from = 'end'): string
    {
        if ($days < 1 || $days > self::MAX_DAYS) {
            throw new \InvalidArgumentException('Days must be between 1 and ' . self::MAX_DAYS . '.');
        }
        $s     = self::status($clientCode);
        $today = self::dbToday();
        $base  = $today;
        if ($from === 'end' && !empty($s['trialEnd'])) {
            $end  = new \DateTimeImmutable($s['trialEnd']);
            $base = $end > $today ? $end : $today;
        }
        $new = $base->modify("+{$days} days")->format('Y-m-d');
        self::writeEndDate($s['code'], $new, 'extend', $note !== '' ? $note : "+{$days} days", $by);

        return $new;
    }

    /** Set an exact end date (Y-m-d). A date in the past ends the trial. */
    public static function setEndDate(string $clientCode, string $date, string $by, string $note = ''): string
    {
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($d === false || $d->format('Y-m-d') !== $date) {
            throw new \InvalidArgumentException('Please enter a valid date (YYYY-MM-DD).');
        }
        if ($d > (self::dbToday())->modify('+' . (self::MAX_DAYS * 3) . ' days')) {
            throw new \InvalidArgumentException('That date is too far in the future.');
        }
        $s = self::status($clientCode);
        self::writeEndDate($s['code'], $date, 'set_date', $note, $by);

        return $date;
    }

    /** End the trial now (paid / manual features are not affected). */
    public static function endNow(string $clientCode, string $by, string $note = ''): string
    {
        $s    = self::status($clientCode);
        $date = self::dbToday()->modify('-1 day')->format('Y-m-d');
        self::writeEndDate($s['code'], $date, 'end_now', $note, $by);

        return $date;
    }

    /** Give a fresh trial of $days (default trial length when null), starting today. */
    public static function restart(string $clientCode, ?int $days, string $by, string $note = ''): string
    {
        $days = $days ?? self::defaultDays();
        self::assertDays($days);
        $s    = self::status($clientCode);
        $date = (self::dbToday())->modify("+{$days} days")->format('Y-m-d');
        self::writeEndDate($s['code'], $date, 'restart', $note !== '' ? $note : "{$days}-day trial", $by);

        return $date;
    }

    // ── Read ────────────────────────────────────────────────────────────────

    /**
     * Trial status of one school.
     *
     * state: 'trial' | 'trial_ended' | 'paid' | 'legacy'
     */
    public static function status(string $clientCode): array
    {
        $clientCode = strtoupper(trim($clientCode));
        $rows = self::listSchools($clientCode, true);
        if ($rows === []) {
            throw new \DomainException('School not found.');
        }

        return $rows[0];
    }

    /**
     * All schools (international by default) with their trial status.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function listSchools(?string $onlyCode = null, bool $includeLegacy = false, string $search = ''): array
    {
        $conn   = ConnectionManager::get('default');
        $where  = [];
        $params = [];
        if (!$includeLegacy) {
            $where[] = "c.billing_model = 'subscription'";
        }
        if ($onlyCode !== null) {
            $where[]  = 'c.ssms_client_code = ?';
            $params[] = $onlyCode;
        }
        if ($search !== '') {
            $where[]  = '(c.ssms_client_code LIKE ? OR c.ssms_client_header_text LIKE ?)';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
        }
        $sql = "SELECT c.ssms_client_code, c.ssms_client_header_text, c.billing_model,
                       c.country_code, c.created, c.ssms_client_expiry_date,
                       (SELECT COUNT(*) FROM ssms_client_features f
                         WHERE f.ssms_client_code = c.ssms_client_code AND f.source = 'trial') AS trial_rows,
                       (SELECT COUNT(*) FROM ssms_client_features f
                         WHERE f.ssms_client_code = c.ssms_client_code
                           AND f.source IN ('play','subscription')
                           AND (f.expires_at IS NULL OR f.expires_at > NOW())) AS paid_rows,
                       (SELECT COUNT(*) FROM ssms_client_features f
                         WHERE f.ssms_client_code = c.ssms_client_code
                           AND f.source = 'manual'
                           AND (f.expires_at IS NULL OR f.expires_at > NOW())) AS manual_rows
                  FROM ssms_clients c"
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . ' ORDER BY c.created DESC, c.ssms_client_code';
        $rows = $conn->execute($sql, $params)->fetchAll('assoc');

        // Current plan (one row per school)
        $plans = [];
        try {
            foreach ($conn->execute(
                "SELECT s.ssms_client_code, s.plan_code, s.status, s.current_period_end
                   FROM ssms_subscriptions s"
            )->fetchAll('assoc') as $p) {
                $plans[$p['ssms_client_code']] = $p;
            }
        } catch (\Throwable $e) {
        }

        $today = self::dbToday();
        $out   = [];
        foreach ($rows as $r) {
            $code    = (string)$r['ssms_client_code'];
            $isSub   = strtolower((string)$r['billing_model']) === 'subscription';
            $end     = !empty($r['ssms_client_expiry_date']) ? substr((string)$r['ssms_client_expiry_date'], 0, 10) : null;
            $endDate = $end ? new \DateTimeImmutable($end) : null;
            $daysLeft = $endDate ? (int)$today->diff($endDate)->format('%r%a') : null;
            $paid    = (int)$r['paid_rows'] > 0;
            $inTrial = $isSub && (int)$r['trial_rows'] > 0 && $endDate !== null && $endDate >= $today;

            $state = !$isSub ? 'legacy' : ($paid ? 'paid' : ($inTrial ? 'trial' : 'trial_ended'));
            $plan  = $plans[$code] ?? null;
            $out[] = [
                'code'         => $code,
                'name'         => (string)($r['ssms_client_header_text'] ?? ''),
                'country'      => (string)($r['country_code'] ?? ''),
                'billingModel' => $isSub ? 'subscription' : 'legacy',
                'registeredOn' => !empty($r['created']) ? substr((string)$r['created'], 0, 10) : null,
                'trialEnd'     => $isSub ? $end : null,
                'daysLeft'     => $isSub && $inTrial ? max(0, $daysLeft) : null,
                'state'        => $state,
                'paidPlan'     => $paid && $plan ? $plan['plan_code'] : null,
                'paidUntil'    => $paid && $plan ? $plan['current_period_end'] : null,
                'manualGrants' => (int)$r['manual_rows'],
            ];
        }

        return $out;
    }

    /** Last N changes (all schools, or one school). */
    public static function history(?string $clientCode = null, int $limit = 50): array
    {
        try {
            $conn = ConnectionManager::get('default');
            $limit = max(1, min(500, $limit));
            if ($clientCode === null) {
                return $conn->execute(
                    "SELECT * FROM ssms_trial_changes ORDER BY id DESC LIMIT {$limit}"
                )->fetchAll('assoc');
            }

            return $conn->execute(
                "SELECT * FROM ssms_trial_changes WHERE ssms_client_code = ? ORDER BY id DESC LIMIT {$limit}",
                [strtoupper(trim($clientCode))]
            )->fetchAll('assoc');
        } catch (\Throwable $e) {
            return [];
        }
    }

    // ── internals ───────────────────────────────────────────────────────────

    /**
     * Save a new trial end date and make sure the trial rows exist so the
     * school really gets every paid feature until that date.
     * Active paid ('play' / 'subscription') and manual grants are left alone.
     */
    private static function writeEndDate(string $clientCode, string $date, string $action, string $note, string $by): void
    {
        $conn = ConnectionManager::get('default');
        $row  = $conn->execute(
            'SELECT billing_model, ssms_client_expiry_date FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1',
            [$clientCode]
        )->fetch('assoc');
        if (!$row) {
            throw new \DomainException('School not found.');
        }
        if (strtolower((string)$row['billing_model']) !== 'subscription') {
            throw new \DomainException('Trials only apply to international (subscription) schools.');
        }
        $old       = !empty($row['ssms_client_expiry_date']) ? substr((string)$row['ssms_client_expiry_date'], 0, 10) : '';
        $endOfDay  = $date . ' 23:59:59';
        $isFuture  = $date >= self::dbToday()->format('Y-m-d');

        $conn->begin();
        try {
            $conn->execute(
                'UPDATE ssms_clients SET ssms_client_expiry_date = ? WHERE ssms_client_code = ?',
                [$date, $clientCode]
            );

            $existing = [];
            foreach ($conn->execute(
                'SELECT feature_key, source, expires_at,
                        (expires_at IS NOT NULL AND expires_at <= NOW()) AS ended
                   FROM ssms_client_features WHERE ssms_client_code = ?',
                [$clientCode]
            )->fetchAll('assoc') as $f) {
                $existing[$f['feature_key']] = $f;
            }

            foreach (Entitlements::PAID_MODULES as $feature) {
                $f = $existing[$feature] ?? null;
                if ($f === null) {
                    if ($isFuture) {
                        $conn->execute(
                            "INSERT INTO ssms_client_features (ssms_client_code, feature_key, source, expires_at)
                             VALUES (?, ?, 'trial', ?)",
                            [$clientCode, $feature, $endOfDay]
                        );
                    }
                    continue;
                }
                if ($f['source'] === 'trial') {
                    // fallback date only (trial rows follow ssms_client_expiry_date)
                    $conn->execute(
                        "UPDATE ssms_client_features SET expires_at = ?
                          WHERE ssms_client_code = ? AND feature_key = ?",
                        [$endOfDay, $clientCode, $feature]
                    );
                    continue;
                }
                // Paid / manual row: only take it over when it has already ended.
                $ended = (int)$f['ended'] === 1;
                if ($ended && $isFuture) {
                    $conn->execute(
                        "UPDATE ssms_client_features SET source = 'trial', expires_at = ?
                          WHERE ssms_client_code = ? AND feature_key = ?",
                        [$endOfDay, $clientCode, $feature]
                    );
                }
            }

            self::log($clientCode, $action, $old, $date, $note, $by);
            $conn->commit();
        } catch (\Throwable $e) {
            $conn->rollback();
            throw $e;
        }

        Entitlements::clear($clientCode);
    }

    private static function log(?string $clientCode, string $action, string $old, string $new, string $note, string $by): void
    {
        try {
            ConnectionManager::get('default')->execute(
                'INSERT INTO ssms_trial_changes (ssms_client_code, action, old_value, new_value, note, changed_by)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$clientCode, $action, $old, $new, mb_substr($note, 0, 255), mb_substr($by, 0, 100)]
            );
        } catch (\Throwable $e) {
            Log::warning('Trials: history not saved (run the phase-5 migration) – ' . $e->getMessage());
        }
    }

    /**
     * "Today" as the DATABASE sees it. Trial checks use MySQL CURDATE(), and the
     * PHP and MySQL time zones can differ, so all trial dates are based on this.
     */
    private static function dbToday(): \DateTimeImmutable
    {
        try {
            $row = ConnectionManager::get('default')->execute('SELECT CURDATE() AS d')->fetch('assoc');
            if (!empty($row['d'])) {
                return new \DateTimeImmutable(substr((string)$row['d'], 0, 10));
            }
        } catch (\Throwable $e) {
        }

        return new \DateTimeImmutable('today');
    }

    private static function assertDays(int $days): void
    {
        if ($days < self::MIN_DAYS || $days > self::MAX_DAYS) {
            throw new \InvalidArgumentException('Trial length must be between ' . self::MIN_DAYS . ' and ' . self::MAX_DAYS . ' days.');
        }
    }

    private static function clamp(int $days): int
    {
        return max(self::MIN_DAYS, min(self::MAX_DAYS, $days));
    }

    private static function forgetDefault(): void
    {
        self::$memo = null;
        if (self::ensureCache()) {
            try {
                Cache::delete(self::CACHE_KEY, self::CACHE_CONFIG);
            } catch (\Throwable $e) {
            }
        }
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
