<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

/**
 * Two-step login.
 *  - Authenticator app: standard 6-digit codes, 30 s steps (RFC 6238, SHA-1), ±1 step for clock drift,
 *    a code can't be used twice (last_step).
 *  - E-mail code (6 digits, 10 minutes, one per minute) as the fallback.
 *  - 10 one-time backup codes (stored hashed).
 *  - "Trust this device for 30 days" tokens (stored hashed).
 *  - Secret stored encrypted (AES-256, key derived from the app salt).
 *
 * Login flow: password OK → gate() → either sign in, or a 5-minute "challenge" token
 * (purpose verify | setup) that the app exchanges for a real sign-in with a code.
 *
 * Tables: ssms_user_mfa, ssms_trusted_devices
 */
class TwoFactor
{
    public const ISSUER     = 'ManageMyAcademy';
    public const STEP       = 30;
    public const TRUST_DAYS = 30;
    public const CHALLENGE_TTL = 300;

    // ── Status / policy ───────────────────────────────────────────────────

    public static function row(string $user): ?array
    {
        try {
            return self::db()->execute('SELECT * FROM ssms_user_mfa WHERE username = ? LIMIT 1', [$user])->fetch('assoc') ?: null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    public static function isEnabled(string $user): bool
    {
        $r = self::row($user);

        return $r !== null && (int)$r['enabled'] === 1;
    }

    /** → { required, deadline (Y-m-d|null), overdue } for this person's role */
    public static function requirement(string $client, string $role): array
    {
        $s = AccountSecurity::settings($client);
        if (!in_array(strtolower($role), $s['mfa_roles'], true)) {
            return ['required' => false, 'deadline' => null, 'overdue' => false];
        }
        $since    = $s['mfa_required_since'] ?: AccountSecurity::startMfaClock($client);
        $deadline = date('Y-m-d', strtotime($since) + $s['mfa_grace_days'] * 86400);

        return ['required' => true, 'deadline' => $deadline, 'overdue' => date('Y-m-d', AccountSecurity::time()) > $deadline];
    }

    public static function status(string $client, string $user, string $role): array
    {
        $r = self::row($user);

        return [
            'enabled'          => $r !== null && (int)$r['enabled'] === 1,
            'enabled_at'       => $r['enabled_at'] ?? null,
            'backup_remaining' => $r ? count(json_decode((string)$r['backup_codes'], true) ?: []) : 0,
            'email'            => AccountSecurity::maskEmail(self::email($user)),
            'trusted_devices'  => self::trustedDevices($user),
        ] + self::requirement($client, $role);
    }

    /**
     * After the password is right. Returns null to sign in now, or an array:
     *   ['mfa_required' => true, 'purpose' => 'verify'|'setup', 'challenge' => …, …]
     *   ['blocked' => message] when the app is too old for two-step login.
     */
    public static function gate(array $userRow, ?string $deviceToken, bool $appSupportsMfa): ?array
    {
        $user   = (string)$userRow['ssms_user_name'];
        $client = (string)$userRow['ssms_client_code'];
        $role   = strtolower((string)$userRow['ssms_user_role']);
        $enabled = self::isEnabled($user);
        $req     = self::requirement($client, $role);
        if (!$enabled && !$req['required']) {
            return null;
        }
        if ($enabled) {
            if ($deviceToken && self::deviceTrusted($user, $deviceToken)) {
                return null;
            }
            $purpose = 'verify';
        } else {
            if (!$req['overdue']) {
                return null;   // still in the grace period – the app shows a reminder
            }
            $purpose = 'setup';
        }
        if (!$appSupportsMfa) {
            return ['blocked' => 'Your school now requires two-step login. Please update the app from the Play Store to sign in.'];
        }

        return [
            'mfa_required' => true,
            'purpose'      => $purpose,
            'challenge'    => self::challenge($user, $client, $purpose),
            'methods'      => $purpose === 'verify' ? ['totp', 'email', 'backup'] : [],
            'email'        => AccountSecurity::maskEmail(self::email($user)),
            'username'     => $user,
        ];
    }

    // ── Challenge token (between password and code) ───────────────────────

    public static function challenge(string $user, string $client, string $purpose): string
    {
        return JWT::encode([
            'typ' => 'mfa', 'purpose' => $purpose, 'user' => $user, 'client_code' => $client,
            'iat' => AccountSecurity::time(), 'exp' => AccountSecurity::time() + self::CHALLENGE_TTL,
            'jti' => bin2hex(random_bytes(8)),
        ], self::secret(), 'HS256');
    }

    /** → [user, client, purpose] or throws */
    public static function readChallenge(string $token, ?string $purpose = null): array
    {
        try {
            JWT::$timestamp = AccountSecurity::time();
            $d = JWT::decode($token, new Key(self::secret(), 'HS256'));
        } catch (\Throwable $e) {
            throw new \DomainException('This sign-in has timed out. Please enter your password again.');
        } finally {
            JWT::$timestamp = null;
        }
        if (($d->typ ?? '') !== 'mfa' || ($purpose !== null && ($d->purpose ?? '') !== $purpose)) {
            throw new \DomainException('This sign-in has timed out. Please enter your password again.');
        }

        return [(string)$d->user, (string)$d->client_code, (string)$d->purpose];
    }

    // ── Verify a code ─────────────────────────────────────────────────────

    /**
     * $method: totp | email | backup. Returns the method used. Throws with a friendly message.
     * Wrong codes count toward the same lock as wrong passwords ("mfa:user").
     */
    public static function verify(string $user, string $method, string $code, string $ip = ''): string
    {
        $key  = 'mfa:' . $user;
        $mins = AccountSecurity::lockedFor($key, '');
        if ($mins > 0) {
            throw new \DomainException(AccountSecurity::lockMessage($mins));
        }
        $r  = self::row($user);
        $ok = false;
        if ($r && (int)$r['enabled'] === 1) {
            if ($method === 'totp') {
                $ok = self::checkTotp($user, $r, $code);
            } elseif ($method === 'email') {
                $ok = self::checkEmailCode($user, $r, $code);
            } elseif ($method === 'backup') {
                $ok = self::useBackupCode($user, $r, $code);
            }
        }
        if (!$ok) {
            $locked = AccountSecurity::recordFailure($key, $ip);
            throw new \InvalidArgumentException($locked
                ? AccountSecurity::lockMessage(AccountSecurity::LOCK_MINUTES)
                : ($method === 'backup' ? 'That backup code is not right or was already used.' : 'That code is not right or has expired. Try again.'));
        }
        AccountSecurity::recordSuccess($key, $ip);

        return $method;
    }

    /** For confirming sensitive changes. Accepts an authenticator or backup code. Users without two-step pass. */
    public static function stepUp(string $user, ?string $code, string $ip = ''): bool
    {
        if (!self::isEnabled($user)) {
            return false;   // nothing to check
        }
        $code = trim((string)$code);
        if ($code === '') {
            throw new \InvalidArgumentException('Enter the 6-digit code from your authenticator app to confirm.');
        }
        self::verify($user, preg_match('/[A-Za-z]/', $code) ? 'backup' : 'totp', $code, $ip);

        return true;
    }

    private static function checkTotp(string $user, array $r, string $code): bool
    {
        $secret = AccountSecurity::decrypt((string)$r['secret_enc'], 'mfa');
        $code   = preg_replace('/\D/', '', $code);
        if (!$secret || strlen($code) !== 6) {
            return false;
        }
        $step = self::matchStep($secret, $code);
        if ($step === null || $step <= (int)$r['last_step']) {
            return false;   // wrong, or already used
        }
        self::db()->execute('UPDATE ssms_user_mfa SET last_step = ? WHERE username = ?', [$step, $user]);

        return true;
    }

    /** Which 30-second step (now ±1) this code belongs to, or null. */
    public static function matchStep(string $base32, string $code, ?int $t = null): ?int
    {
        $t   = $t ?? AccountSecurity::time();
        $now = intdiv($t, self::STEP);
        $key = self::base32Decode($base32);
        foreach ([$now, $now - 1, $now + 1] as $s) {
            if (hash_equals(self::totp($key, $s), $code)) {
                return $s;
            }
        }

        return null;
    }

    public static function totp(string $rawKey, int $step): string
    {
        $h = hash_hmac('sha1', pack('N2', 0, $step), $rawKey, true);
        $o = ord($h[19]) & 0x0f;
        $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);

        return str_pad((string)($n % 1000000), 6, '0', STR_PAD_LEFT);
    }

    // ── Setup / disable ───────────────────────────────────────────────────

    /** → { secret, uri } (secret shown once; stored encrypted, not yet enabled) */
    public static function setupStart(string $client, string $user): array
    {
        if (self::isEnabled($user)) {
            throw new \DomainException('Two-step login is already on.');
        }
        $secret = self::base32Encode(random_bytes(20));
        self::db()->execute(
            'INSERT INTO ssms_user_mfa (username, ssms_client_code, method, secret_enc, enabled, last_step, backup_codes, updated)
             VALUES (?,?,?,?,0,0,?,?)
             ON DUPLICATE KEY UPDATE secret_enc = VALUES(secret_enc), enabled = 0, last_step = 0, backup_codes = VALUES(backup_codes),
                                     ssms_client_code = VALUES(ssms_client_code), updated = VALUES(updated)',
            [$user, $client, 'totp', AccountSecurity::encrypt($secret, 'mfa'), '[]', AccountSecurity::now()]
        );
        $label = rawurlencode(self::ISSUER . ':' . $user);

        return [
            'secret' => trim(chunk_split($secret, 4, ' ')),
            'uri'    => "otpauth://totp/{$label}?secret={$secret}&issuer=" . rawurlencode(self::ISSUER) . '&digits=6&period=30',
        ];
    }

    /** Confirm with the first code → backup codes (shown once). */
    public static function setupConfirm(string $user, string $code): array
    {
        $r = self::row($user);
        if (!$r || (int)$r['enabled'] === 1) {
            throw new \DomainException('Start the setup again.');
        }
        $secret = AccountSecurity::decrypt((string)$r['secret_enc'], 'mfa');
        $step   = $secret ? self::matchStep($secret, preg_replace('/\D/', '', $code)) : null;
        if ($step === null) {
            throw new \InvalidArgumentException('That code is not right. Check the time on your phone is set automatically, then try the newest code.');
        }
        $codes = self::newBackupCodes();
        self::db()->execute(
            'UPDATE ssms_user_mfa SET enabled = 1, enabled_at = ?, last_step = ?, backup_codes = ?, updated = ? WHERE username = ?',
            [AccountSecurity::now(), $step, json_encode(array_map([self::class, 'hashCode'], $codes)), AccountSecurity::now(), $user]
        );

        return $codes;
    }

    public static function regenerateBackupCodes(string $user): array
    {
        if (!self::isEnabled($user)) {
            throw new \DomainException('Turn on two-step login first.');
        }
        $codes = self::newBackupCodes();
        self::db()->execute('UPDATE ssms_user_mfa SET backup_codes = ?, updated = ? WHERE username = ?',
            [json_encode(array_map([self::class, 'hashCode'], $codes)), AccountSecurity::now(), $user]);

        return $codes;
    }

    /** User turns it off (code required). Not allowed when the school requires it for their role. */
    public static function disable(string $client, string $user, string $role, string $code, string $ip = ''): void
    {
        if (self::requirement($client, $role)['required']) {
            throw new \DomainException('Your school requires two-step login for your role, so it can\'t be turned off.');
        }
        self::stepUp($user, $code, $ip);
        self::wipe($user);
    }

    /** Owner resets someone's two-step login (lost phone). They set it up again at next sign-in. */
    public static function wipe(string $user): void
    {
        self::db()->execute('DELETE FROM ssms_user_mfa WHERE username = ?', [$user]);
        self::db()->execute('DELETE FROM ssms_trusted_devices WHERE username = ?', [$user]);
    }

    // ── E-mail code ───────────────────────────────────────────────────────

    public static function sendEmailCode(string $user): string
    {
        $r = self::row($user);
        if (!$r || (int)$r['enabled'] !== 1) {
            throw new \DomainException('Two-step login is not on for this account.');
        }
        if (!empty($r['email_sent_at']) && strtotime((string)$r['email_sent_at']) > AccountSecurity::time() - 60) {
            throw new \DomainException('A code was just sent. Wait a minute before asking for another.');
        }
        $to = self::email($user);
        if ($to === '') {
            throw new \DomainException('There is no e-mail address on your account. Use your authenticator app or a backup code.');
        }
        $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        self::db()->execute(
            'UPDATE ssms_user_mfa SET email_code_hash = ?, email_code_expires = ?, email_sent_at = ? WHERE username = ?',
            [self::hashCode($code), date('Y-m-d H:i:s', AccountSecurity::time() + 600), AccountSecurity::now(), $user]
        );
        AccountSecurity::mail($to, $user, 'Your sign-in code: ' . $code,
            "Your ManageMyAcademy sign-in code is {$code}\n\nIt works for 10 minutes. If you didn't try to sign in, change your password now and tell your school.\n");

        return AccountSecurity::maskEmail($to);
    }

    private static function checkEmailCode(string $user, array $r, string $code): bool
    {
        $code = preg_replace('/\D/', '', $code);
        if (empty($r['email_code_hash']) || empty($r['email_code_expires'])
            || strtotime((string)$r['email_code_expires']) < AccountSecurity::time()
            || !hash_equals((string)$r['email_code_hash'], self::hashCode($code))) {
            return false;
        }
        self::db()->execute('UPDATE ssms_user_mfa SET email_code_hash = NULL, email_code_expires = NULL WHERE username = ?', [$user]);

        return true;
    }

    // ── Backup codes ──────────────────────────────────────────────────────

    private static function newBackupCodes(): array
    {
        $out = [];
        for ($i = 0; $i < 10; $i++) {
            $c     = Passwords::random(8);
            $out[] = substr($c, 0, 4) . '-' . substr($c, 4);
        }

        return $out;
    }

    private static function useBackupCode(string $user, array $r, string $code): bool
    {
        $norm = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code));
        if (strlen($norm) !== 8) {
            return false;
        }
        $h    = self::hashCode(substr($norm, 0, 4) . '-' . substr($norm, 4));
        $list = json_decode((string)$r['backup_codes'], true) ?: [];
        foreach ($list as $i => $x) {
            if (hash_equals((string)$x, $h)) {
                unset($list[$i]);
                self::db()->execute('UPDATE ssms_user_mfa SET backup_codes = ? WHERE username = ?', [json_encode(array_values($list)), $user]);

                return true;
            }
        }

        return false;
    }

    public static function hashCode(string $code): string
    {
        // keyed with the app salt (not the JWT secret, so rotating JWT_SECRET keeps backup codes working)
        return hash_hmac('sha256', strtoupper($code), hash('sha256', \Cake\Utility\Security::getSalt() . '|mfa-codes'));
    }

    // ── Trusted devices ───────────────────────────────────────────────────

    public static function trustDevice(string $client, string $user, string $label): string
    {
        $tok = bin2hex(random_bytes(24));
        self::db()->execute(
            'INSERT INTO ssms_trusted_devices (ssms_client_code, username, token_hash, label, expires, created) VALUES (?,?,?,?,?,?)',
            [$client, $user, hash('sha256', $tok), mb_substr($label, 0, 120),
             date('Y-m-d H:i:s', AccountSecurity::time() + self::TRUST_DAYS * 86400), AccountSecurity::now()]
        );

        return $tok;
    }

    public static function deviceTrusted(string $user, string $tok): bool
    {
        if (!preg_match('/^[a-f0-9]{48}$/', $tok)) {
            return false;
        }
        try {
            return (bool)self::db()->execute(
                'SELECT 1 FROM ssms_trusted_devices WHERE username = ? AND token_hash = ? AND expires > ? LIMIT 1',
                [$user, hash('sha256', $tok), AccountSecurity::now()]
            )->fetch('assoc');
        } catch (\Throwable $e) {
            return false;
        }
    }

    public static function trustedDevices(string $user): array
    {
        try {
            return self::db()->execute(
                'SELECT id, label, expires, created FROM ssms_trusted_devices WHERE username = ? AND expires > ? ORDER BY created DESC',
                [$user, AccountSecurity::now()]
            )->fetchAll('assoc');
        } catch (\Throwable $e) {
            return [];
        }
    }

    public static function forgetDevices(string $user, ?int $id = null): void
    {
        self::db()->execute('DELETE FROM ssms_trusted_devices WHERE username = ?' . ($id ? ' AND id = ?' : ''), $id ? [$user, $id] : [$user]);
    }

    // ── base32 ──────────────────────────────────────────────────────────────

    public static function base32Encode(string $bin): string
    {
        $abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split($bin) as $c) {
            $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= $abc[bindec(str_pad($chunk, 5, '0'))];
        }

        return $out;
    }

    public static function base32Decode(string $s): string
    {
        $abc  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $s    = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s));
        $bits = '';
        foreach (str_split($s) as $c) {
            $bits .= str_pad(decbin((int)strpos($abc, $c)), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr(bindec($byte));
            }
        }

        return $out;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static function email(string $user): string
    {
        try {
            return trim((string)(self::db()->execute('SELECT ssms_user_email FROM sawera_ssms_users WHERE ssms_user_name = ? LIMIT 1', [$user])
                ->fetch('assoc')['ssms_user_email'] ?? ''));
        } catch (\Throwable $e) {
            return '';
        }
    }

    public static function secret(): string
    {
        $s = env('JWT_SECRET', '') ?: \Cake\Core\Configure::read('Jwt.secret', '');

        return hash('sha256', (string)$s . '|mfa-challenge');
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
