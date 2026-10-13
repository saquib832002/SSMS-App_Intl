<?php
declare(strict_types=1);

namespace App\Service;

/**
 * Password hashing in one place.
 *
 * Old accounts were hashed with crypt() and ONE fixed bcrypt salt for everyone
 * ($2y$10$iusesomecrazystrings22…). Those strings are still valid bcrypt, so
 * password_verify() accepts them; after a successful sign-in the password is
 * re-hashed with a unique salt (needsRehash → hash). Nobody has to reset.
 */
class Passwords
{
    public const LEGACY_SALT = '$2y$10$iusesomecrazystrings22';

    /** bcrypt with a per-password random salt (always 60 chars, fits the existing column). */
    public static function hash(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT, ['cost' => 11]);
    }

    public static function verify(string $plain, ?string $stored): bool
    {
        $stored = (string)$stored;
        if ($plain === '' || $stored === '') {
            return false;
        }
        if (password_verify($plain, $stored)) {
            return true;
        }
        // very old rows that are not bcrypt at all – compare the legacy way, timing-safe
        if (!str_starts_with($stored, '$2')) {
            return hash_equals($stored, crypt($plain, self::LEGACY_SALT));
        }

        return false;
    }

    public static function needsRehash(?string $stored): bool
    {
        $stored = (string)$stored;

        return $stored === '' || str_starts_with($stored, self::LEGACY_SALT)
            || password_needs_rehash($stored, PASSWORD_BCRYPT, ['cost' => 11]);
    }

    /** Readable random password / code (no 0/O/1/I/L). */
    public static function random(int $len = 10): string
    {
        $abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        $out = '';
        for ($i = 0; $i < $len; $i++) {
            $out .= $abc[random_int(0, strlen($abc) - 1)];
        }

        return $out;
    }
}
