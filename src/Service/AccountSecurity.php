<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Mailer\Mailer;
use Cake\Utility\Security;

/**
 * Account security: school security settings, sign-in sessions (revocable),
 * login throttling, set-password links, small crypto + mail helpers.
 *
 * Tables (Database/migrations/2026_10_privacy_security.sql):
 *   ssms_security_settings, ssms_user_sessions, ssms_user_security,
 *   ssms_login_attempts, ssms_password_tokens
 */
class AccountSecurity
{
    public const MAX_USER_FAILS = 5;     // per account from one network address, in LOCK_MINUTES
    public const MAX_ACCOUNT_FAILS = 20; // per account from anywhere (slows guessing spread over many addresses)
    public const MAX_IP_FAILS   = 100;   // per network address (a whole school can share one address)
    public const LOCK_MINUTES   = 15;
    public const SESSION_DAYS   = 30;

    public const DEFAULT_MFA_ROLES = ['owner', 'admin', 'principal', 'accountant'];

    /** Clock for tests */
    public static $now = null;

    public static function time(): int
    {
        return is_callable(self::$now) ? (int)(self::$now)() : time();
    }

    public static function now(): string
    {
        return date('Y-m-d H:i:s', self::time());
    }

    // ── School security settings ──────────────────────────────────────────

    public static function settings(string $client): array
    {
        $r = null;
        try {
            $r = self::db()->execute('SELECT * FROM ssms_security_settings WHERE ssms_client_code = ? LIMIT 1', [$client])
                ->fetch('assoc') ?: null;
        } catch (\Throwable $e) {
        }
        $roles = $r && $r['mfa_roles'] !== null ? array_values(array_filter(array_map('trim', explode(',', (string)$r['mfa_roles'])))) : self::DEFAULT_MFA_ROLES;
        if (!in_array('owner', $roles, true)) {
            $roles[] = 'owner';   // owner always
        }

        return [
            'mfa_roles'             => $roles,
            'mfa_grace_days'        => (int)($r['mfa_grace_days'] ?? 7),
            'mfa_required_since'    => $r['mfa_required_since'] ?? null,
            'audit_retention_years' => (int)($r['audit_retention_years'] ?? 2),
            'coppa_mode'            => (string)($r['coppa_mode'] ?? 'parent'),   // parent | school
            'consent_enabled'       => (int)($r['consent_enabled'] ?? 1) === 1,
            // safety switch: turn off role-permission checks if something breaks (role screens still work)
            'permissions_enforced'  => (int)($r['permissions_enforced'] ?? 1) === 1,
            'retention'             => json_decode((string)($r['retention_json'] ?? ''), true) ?: self::defaultRetention($client),
        ];
    }

    public static function saveSettings(string $client, array $d, string $by): array
    {
        $cur   = self::settings($client);
        $roles = isset($d['mfa_roles']) ? (array)$d['mfa_roles'] : $cur['mfa_roles'];
        $roles = array_values(array_unique(array_intersect(
            array_map('strtolower', array_map('strval', $roles)),
            ['owner', 'admin', 'principal', 'accountant', 'user', 'teacher', 'staff', 'parent', 'student']
        )));
        if (!in_array('owner', $roles, true)) {
            $roles[] = 'owner';
        }
        $grace = (int)($d['mfa_grace_days'] ?? $cur['mfa_grace_days']);
        if ($grace < 0 || $grace > 60) {
            throw new \InvalidArgumentException('Grace period must be 0–60 days.');
        }
        $years = (int)($d['audit_retention_years'] ?? $cur['audit_retention_years']);
        if ($years < 1 || $years > 7) {
            throw new \InvalidArgumentException('Keep the audit log for 1–7 years.');
        }
        $coppa = (string)($d['coppa_mode'] ?? $cur['coppa_mode']);
        if (!in_array($coppa, ['parent', 'school'], true)) {
            $coppa = 'parent';
        }
        $ret = $cur['retention'];
        if (isset($d['retention']) && is_array($d['retention'])) {
            foreach ($ret as $k => $v) {
                if (isset($d['retention'][$k])) {
                    $ret[$k] = max(0, min(50, (int)$d['retention'][$k]));
                }
            }
        }
        $since = $cur['mfa_required_since'] ?: date('Y-m-d', self::time());
        // adding a role to the required list restarts the grace period for that role's people
        if (array_diff($roles, $cur['mfa_roles'])) {
            $since = date('Y-m-d', self::time());
        }
        self::db()->execute(
            'INSERT INTO ssms_security_settings (ssms_client_code, mfa_roles, mfa_grace_days, mfa_required_since,
                    audit_retention_years, coppa_mode, consent_enabled, retention_json, updated_by, modified, permissions_enforced)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE mfa_roles = VALUES(mfa_roles), mfa_grace_days = VALUES(mfa_grace_days),
                    mfa_required_since = VALUES(mfa_required_since), audit_retention_years = VALUES(audit_retention_years),
                    coppa_mode = VALUES(coppa_mode), consent_enabled = VALUES(consent_enabled), retention_json = VALUES(retention_json),
                    updated_by = VALUES(updated_by), modified = VALUES(modified), permissions_enforced = VALUES(permissions_enforced)',
            [$client, implode(',', $roles), $grace, $since, $years, $coppa,
             array_key_exists('consent_enabled', $d) ? (!empty($d['consent_enabled']) ? 1 : 0) : (int)$cur['consent_enabled'],
             json_encode($ret), mb_substr($by, 0, 100), self::now(),
             array_key_exists('permissions_enforced', $d) ? (!empty($d['permissions_enforced']) ? 1 : 0) : (int)$cur['permissions_enforced']]
        );

        return self::settings($client);
    }

    /** First time two-step login is checked for a school: the grace period starts today (stored, so it ends). */
    public static function startMfaClock(string $client): string
    {
        $today = date('Y-m-d', self::time());
        try {
            self::db()->execute(
                'INSERT INTO ssms_security_settings (ssms_client_code, mfa_required_since, modified) VALUES (?,?,?)
                 ON DUPLICATE KEY UPDATE mfa_required_since = COALESCE(mfa_required_since, VALUES(mfa_required_since))',
                [$client, $today, self::now()]
            );
            $r = self::db()->execute('SELECT mfa_required_since FROM ssms_security_settings WHERE ssms_client_code = ?', [$client])->fetch('assoc');

            return (string)($r['mfa_required_since'] ?? $today) ?: $today;
        } catch (\Throwable $e) {
            return $today;   // tables not installed yet – nobody is blocked
        }
    }

    /** Years each kind of record is kept after a student / staff member leaves (deletion requests). */
    public static function defaultRetention(string $client): array
    {
        $country = '';
        try {
            $r = self::db()->execute('SELECT * FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc');
            $country = strtoupper((string)($r['country_code'] ?? $r['ssms_client_country'] ?? $r['country'] ?? ''));
        } catch (\Throwable $e) {
        }
        $fees = ['IN' => 8, 'US' => 7, 'GB' => 6, 'AE' => 5, 'SA' => 10][$country] ?? 7;

        return ['fees' => $fees, 'academic' => 50, 'attendance' => 3, 'payroll' => $fees];
    }

    // ── Sessions ──────────────────────────────────────────────────────────

    /** New sign-in session → its id (goes into the token as "sid"), or null if sessions aren't installed yet. */
    public static function createSession(string $client, string $user, array $meta = [], bool $mfa = false): ?string
    {
        $sid = bin2hex(random_bytes(16));
        try {
            self::db()->execute(
                'INSERT INTO ssms_user_sessions (id, ssms_client_code, username, device, platform, app_version, ip, mfa,
                        created, last_seen, expires)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [$sid, $client, $user, mb_substr((string)($meta['device'] ?? ''), 0, 120),
                 mb_substr((string)($meta['platform'] ?? ''), 0, 20), mb_substr((string)($meta['app_version'] ?? ''), 0, 30),
                 mb_substr((string)($meta['ip'] ?? ''), 0, 45), $mfa ? 1 : 0, self::now(), self::now(),
                 date('Y-m-d H:i:s', self::time() + self::SESSION_DAYS * 86400)]
            );
        } catch (\Throwable $e) {
            Log::warning('createSession: ' . $e->getMessage());   // table not there yet – sign-in still works
            return null;   // no sid in the token, so it isn't refused once the table exists
        }

        return $sid;
    }

    /**
     * Is this token still good? Called by the middleware on every API request.
     * Returns null when OK, otherwise a message. $row = the user + session lookup.
     */
    public static function tokenProblem(?array $row, int $iat, ?string $sid): ?string
    {
        if (!$row) {
            return 'Your account no longer exists. Please contact the school.';
        }
        if (strtolower(trim((string)$row['ssms_user_status'])) !== 'active') {
            return 'Your account is inactive. Please contact your school administration.';
        }
        if (!empty($row['tokens_valid_after']) && $iat < strtotime((string)$row['tokens_valid_after'])) {
            return 'You were signed out. Please sign in again.';
        }
        if (!$sid && !empty($row['sidless_invalid_after']) && $iat < strtotime((string)$row['sidless_invalid_after'])) {
            return 'You were signed out. Please sign in again.';
        }
        if ($sid && array_key_exists('s_revoked', $row)) {
            if ($row['s_id'] === null) {
                return 'You were signed out. Please sign in again.';
            }
            if ($row['s_revoked'] !== null || ($row['s_expires'] && strtotime((string)$row['s_expires']) < self::time())) {
                return 'You were signed out. Please sign in again.';
            }
        }

        return null;
    }

    /**
     * One query: user status/role + security + this session.
     * Falls back to the users table alone if the security tables are not there yet.
     */
    public static function lookup(string $user, ?string $sid): ?array
    {
        try {
            $sql = 'SELECT u.ssms_user_name, u.ssms_user_status, u.ssms_user_role, u.ssms_client_code, u.staff_id, u.custom_role_id,
                           sec.tokens_valid_after, sec.sidless_invalid_after'
                 . ($sid ? ', s.id AS s_id, s.revoked_at AS s_revoked, s.expires AS s_expires, s.last_seen AS s_seen' : '') . '
                      FROM sawera_ssms_users u
                 LEFT JOIN ssms_user_security sec ON sec.username = u.ssms_user_name'
                 . ($sid ? ' LEFT JOIN ssms_user_sessions s ON s.id = ? AND s.username = u.ssms_user_name' : '') . '
                     WHERE u.ssms_user_name = ? LIMIT 1';
            $row = self::db()->execute($sql, $sid ? [$sid, $user] : [$user])->fetch('assoc');
        } catch (\Throwable $e) {
            try {
                // security tables there, custom_role_id column missing
                $sql = 'SELECT u.ssms_user_name, u.ssms_user_status, u.ssms_user_role, u.ssms_client_code, u.staff_id,
                               sec.tokens_valid_after, sec.sidless_invalid_after'
                     . ($sid ? ', s.id AS s_id, s.revoked_at AS s_revoked, s.expires AS s_expires, s.last_seen AS s_seen' : '') . '
                          FROM sawera_ssms_users u
                     LEFT JOIN ssms_user_security sec ON sec.username = u.ssms_user_name'
                     . ($sid ? ' LEFT JOIN ssms_user_sessions s ON s.id = ? AND s.username = u.ssms_user_name' : '') . '
                         WHERE u.ssms_user_name = ? LIMIT 1';
                $row = self::db()->execute($sql, $sid ? [$sid, $user] : [$user])->fetch('assoc');
            } catch (\Throwable $e2) {
                $row = self::db()->execute(
                    'SELECT ssms_user_name, ssms_user_status, ssms_user_role, ssms_client_code, staff_id
                       FROM sawera_ssms_users WHERE ssms_user_name = ? LIMIT 1', [$user]
                )->fetch('assoc');
            }
        }

        return $row ?: null;
    }

    public static function touch(string $sid, ?string $lastSeen): void
    {
        if ($lastSeen && strtotime($lastSeen) > self::time() - 300) {
            return;
        }
        try {
            self::db()->execute('UPDATE ssms_user_sessions SET last_seen = ? WHERE id = ?', [self::now(), $sid]);
        } catch (\Throwable $e) {
        }
    }

    public static function sessions(string $client, string $user, ?string $currentSid = null): array
    {
        $rows = self::db()->execute(
            'SELECT id, device, platform, app_version, ip, mfa, created, last_seen, expires
               FROM ssms_user_sessions
              WHERE ssms_client_code = ? AND username = ? AND revoked_at IS NULL AND expires > ?
              ORDER BY last_seen DESC LIMIT 50',
            [$client, $user, self::now()]
        )->fetchAll('assoc');
        foreach ($rows as &$r) {
            $r['current'] = $currentSid !== null && hash_equals($r['id'], $currentSid);
            $r['mfa']     = (int)$r['mfa'] === 1;
            $r['ref']     = substr(hash('sha256', $r['id']), 0, 12);   // never send the real id
            unset($r['id']);
        }

        return $rows;
    }

    public static function revokeSession(string $client, string $user, string $ref, string $reason = 'signed out'): bool
    {
        foreach (self::db()->execute(
            'SELECT id FROM ssms_user_sessions WHERE ssms_client_code = ? AND username = ? AND revoked_at IS NULL',
            [$client, $user]
        )->fetchAll('assoc') as $r) {
            if (hash_equals(substr(hash('sha256', $r['id']), 0, 12), $ref)) {
                self::db()->execute('UPDATE ssms_user_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ?',
                    [self::now(), mb_substr($reason, 0, 60), $r['id']]);

                return true;
            }
        }

        return false;
    }

    public static function revokeSid(string $sid, string $reason = 'signed out'): void
    {
        try {
            self::db()->execute('UPDATE ssms_user_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
                [self::now(), mb_substr($reason, 0, 60), $sid]);
        } catch (\Throwable $e) {
        }
    }

    /**
     * Sign out everywhere (optionally keeping one session). Also invalidates tokens
     * issued before now that have no session id (older app versions).
     */
    public static function revokeAll(string $client, string $user, ?string $exceptSid = null, string $reason = 'sign out everywhere'): int
    {
        try {
            $n = self::db()->execute(
                'UPDATE ssms_user_sessions SET revoked_at = ?, revoked_reason = ?
                  WHERE username = ? AND revoked_at IS NULL' . ($exceptSid ? ' AND id <> ?' : ''),
                $exceptSid ? [self::now(), mb_substr($reason, 0, 60), $user, $exceptSid] : [self::now(), mb_substr($reason, 0, 60), $user]
            )->rowCount();
            if (!$exceptSid) {
                self::db()->execute(
                    'INSERT INTO ssms_user_security (username, ssms_client_code, tokens_valid_after) VALUES (?,?,?)
                     ON DUPLICATE KEY UPDATE tokens_valid_after = VALUES(tokens_valid_after)',
                    [$user, $client, self::now()]
                );
            } else {
                // old tokens without a session id: cut them off too, but the current token (has sid) survives
                self::db()->execute(
                    'INSERT INTO ssms_user_security (username, ssms_client_code, sidless_invalid_after) VALUES (?,?,?)
                     ON DUPLICATE KEY UPDATE sidless_invalid_after = VALUES(sidless_invalid_after)',
                    [$user, $client, self::now()]
                );
            }

            return (int)$n;
        } catch (\Throwable $e) {
            Log::warning('revokeAll: ' . $e->getMessage());

            return 0;
        }
    }

    // ── Login throttling ──────────────────────────────────────────────────

    /**
     * Minutes until the account / address may try again (0 = fine). $key can be "mfa:user".
     * Locks: 5 failures for this account from this address · 20 for this account from anywhere ·
     * 100 from this address for any account. (So a stranger elsewhere can't lock the owner out with 5 tries.)
     */
    public static function lockedFor(string $key, string $ip): int
    {
        try {
            $since = date('Y-m-d H:i:s', self::time() - self::LOCK_MINUTES * 60);
            $key   = mb_strtolower($key);
            $checks = [
                ['username = ? AND ip = ?', [$key, $ip], self::MAX_USER_FAILS],
                ['username = ?', [$key], self::MAX_ACCOUNT_FAILS],
            ];
            if ($ip !== '') {
                $checks[] = ['ip = ?', [$ip], self::MAX_IP_FAILS];
            }
            foreach ($checks as [$w, $p, $max]) {
                $r = self::db()->execute(
                    "SELECT COUNT(*) n, MAX(attempted_at) last FROM ssms_login_attempts WHERE $w AND success = 0 AND attempted_at > ?",
                    array_merge($p, [$since])
                )->fetch('assoc');
                if ((int)$r['n'] >= $max) {
                    return max(1, (int)ceil((strtotime((string)$r['last']) + self::LOCK_MINUTES * 60 - self::time()) / 60));
                }
            }
        } catch (\Throwable $e) {
        }

        return 0;
    }

    /** Record a failed try. Returns true when this failure just locked the account (for this address). */
    public static function recordFailure(string $key, string $ip): bool
    {
        try {
            self::db()->execute('INSERT INTO ssms_login_attempts (username, ip, success, attempted_at) VALUES (?,?,0,?)',
                [mb_strtolower(mb_substr($key, 0, 120)), mb_substr($ip, 0, 45), self::now()]);
            $since = date('Y-m-d H:i:s', self::time() - self::LOCK_MINUTES * 60);
            $n = (int)self::db()->execute(
                'SELECT COUNT(*) n FROM ssms_login_attempts WHERE username = ? AND ip = ? AND success = 0 AND attempted_at > ?',
                [mb_strtolower($key), mb_substr($ip, 0, 45), $since]
            )->fetch('assoc')['n'];

            return $n === self::MAX_USER_FAILS;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /** Successful sign-in clears that account's failures. */
    public static function recordSuccess(string $key, string $ip): void
    {
        try {
            self::db()->execute('DELETE FROM ssms_login_attempts WHERE username = ? AND success = 0', [mb_strtolower($key)]);
        } catch (\Throwable $e) {
        }
    }

    public static function lockMessage(int $minutes): string
    {
        return "Too many wrong attempts. For your security, sign-in is paused – try again in {$minutes} minute"
            . ($minutes === 1 ? '' : 's') . '.';
    }

    // ── Set-password links (instead of e-mailing passwords) ───────────────

    public static function passwordToken(string $client, string $user, int $hours = 48): string
    {
        $tok = bin2hex(random_bytes(24));
        self::db()->execute(
            'INSERT INTO ssms_password_tokens (token_hash, ssms_client_code, username, expires, created) VALUES (?,?,?,?,?)',
            [hash('sha256', $tok), $client, $user, date('Y-m-d H:i:s', self::time() + $hours * 3600), self::now()]
        );

        return $tok;
    }

    /** → [client, username] for a valid unused token, or null */
    public static function checkPasswordToken(string $tok): ?array
    {
        if (!preg_match('/^[a-f0-9]{48}$/', $tok)) {
            return null;
        }
        $r = self::db()->execute(
            'SELECT * FROM ssms_password_tokens WHERE token_hash = ? AND used_at IS NULL AND expires > ? LIMIT 1',
            [hash('sha256', $tok), self::now()]
        )->fetch('assoc');

        return $r ? [(string)$r['ssms_client_code'], (string)$r['username']] : null;
    }

    public static function usePasswordToken(string $tok, string $newPassword): array
    {
        $who = self::checkPasswordToken($tok);
        if (!$who) {
            throw new \DomainException('This link has expired or was already used. Ask the school to send a new one.');
        }
        self::checkStrength($newPassword);
        self::db()->execute('UPDATE sawera_ssms_users SET ssms_user_password = ? WHERE ssms_user_name = ? AND ssms_client_code = ?',
            [Passwords::hash($newPassword), $who[1], $who[0]]);
        self::db()->execute('UPDATE ssms_password_tokens SET used_at = ? WHERE token_hash = ?', [self::now(), hash('sha256', $tok)]);
        self::revokeAll($who[0], $who[1], null, 'password set');

        return $who;
    }

    public static function checkStrength(string $pw): void
    {
        if (strlen($pw) < 8) {
            throw new \InvalidArgumentException('Use at least 8 characters.');
        }
        if (!preg_match('/[A-Za-z]/', $pw) || !preg_match('/\d/', $pw)) {
            throw new \InvalidArgumentException('Use letters and at least one number.');
        }
    }

    public static function setPasswordUrl(string $tok): string
    {
        return rtrim((string)env('APP_URL', 'https://managemyacademy.com/'), '/') . '/set-password/' . $tok;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    public static function clientIp($request = null): string
    {
        $ip = '';
        if ($request && method_exists($request, 'clientIp')) {
            $ip = (string)$request->clientIp();
        }
        if ($ip === '') {
            $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
        }

        return mb_substr($ip, 0, 45);
    }

    /** AES-256 (CakePHP Security::encrypt) with a key derived from the app salt. */
    public static function encrypt(string $plain, string $purpose): string
    {
        return base64_encode(Security::encrypt($plain, hash('sha256', Security::getSalt() . '|' . $purpose)));
    }

    public static function decrypt(string $stored, string $purpose): ?string
    {
        $raw = base64_decode($stored, true);
        if ($raw === false) {
            return null;
        }
        $out = Security::decrypt($raw, hash('sha256', Security::getSalt() . '|' . $purpose));

        return $out === null || $out === false ? null : (string)$out;
    }

    /** Plain-text e-mail. Returns false when it could not be sent. */
    public static $mail = null;   // tests: fn(to, subject, body)

    public static function mail(string $to, string $name, string $subject, string $body): bool
    {
        if (trim($to) === '') {
            return false;
        }
        if (is_callable(self::$mail)) {
            (self::$mail)($to, $subject, $body);

            return true;
        }
        try {
            (new Mailer('default'))
                ->setEmailFormat('text')
                ->setTo($to, $name ?: $to)
                ->setFrom(env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'), env('MAIL_FROM_NAME', 'Manage My Academy'))
                ->setSubject($subject)
                ->deliver($body);

            return true;
        } catch (\Throwable $e) {
            Log::error('AccountSecurity mail: ' . $e->getMessage());

            return false;
        }
    }

    public static function maskEmail(?string $e): string
    {
        $e = (string)$e;
        if (!str_contains($e, '@')) {
            return '';
        }
        [$a, $d] = explode('@', $e, 2);

        return mb_substr($a, 0, 2) . str_repeat('•', max(1, mb_strlen($a) - 2)) . '@' . $d;
    }

    public static function db()
    {
        return ConnectionManager::get('default');
    }
}
