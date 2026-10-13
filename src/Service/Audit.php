<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Audit log – who did what, when. Insert-only (the API has no edit/delete),
 * and each school's entries form a hash chain: every row stores a fingerprint
 * of the previous one, so a change made directly in the database shows up as
 * "chain broken" in verify(). The network address is NOT part of the
 * fingerprint, so it can be shortened after 90 days without breaking the chain.
 *
 * Table: ssms_audit_log
 */
class Audit
{
    public const CATEGORIES = ['security', 'access', 'records', 'money', 'privacy', 'settings'];

    /** Clock for tests */
    public static $now = null;

    /** Field names whose values are never stored. */
    private const SECRET_KEYS = [
        'password', 'newpassword', 'currentpassword', 'ssms_user_password', 'new_password', 'confirm_password',
        'otp', 'code', 'mfa_code', 'backup_code', 'secret', 'token', 'device_token', 'challenge', 'pin',
        'validationcode', 'cvv', 'card_number', 'cardnumber', 'razorpay_key_secret', 'razorpay_webhook_secret',
        'stripe_secret_key', 'api_key', 'authorization',
    ];

    /**
     * $o: category, actor, role, entity_type, entity_id, summary, changes (array), ip, app_version
     * Never throws – auditing must not break the action being audited.
     */
    public static function log(string $client, string $event, array $o = []): void
    {
        if ($client === '') {
            return;
        }
        $db   = self::db();
        $lock = 'audit_' . md5($client);
        try {
            $db->execute('SELECT GET_LOCK(?, 3)', [$lock]);
            $prev = $db->execute(
                'SELECT hash FROM ssms_audit_log WHERE ssms_client_code = ? ORDER BY id DESC LIMIT 1', [$client]
            )->fetch('assoc')['hash'] ?? str_repeat('0', 64);
            $row = [
                'ssms_client_code' => $client,
                'created'          => date('Y-m-d H:i:s', self::time()),
                'category'         => in_array($o['category'] ?? '', self::CATEGORIES, true) ? $o['category'] : 'records',
                'event'            => mb_substr($event, 0, 80),
                'actor'            => mb_substr((string)($o['actor'] ?? ''), 0, 100),
                'actor_role'       => mb_substr((string)($o['role'] ?? ''), 0, 30),
                'entity_type'      => mb_substr((string)($o['entity_type'] ?? ''), 0, 40),
                'entity_id'        => mb_substr((string)($o['entity_id'] ?? ''), 0, 64),
                'summary'          => mb_substr((string)($o['summary'] ?? ''), 0, 255),
                'changes'          => isset($o['changes']) ? json_encode(self::mask($o['changes']), JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR) : null,
                'ip'               => mb_substr((string)($o['ip'] ?? ''), 0, 45),
                'app_version'      => mb_substr((string)($o['app_version'] ?? ''), 0, 30),
                'prev_hash'        => $prev,
            ];
            $row['hash'] = self::fingerprint($row);
            $db->execute(
                'INSERT INTO ssms_audit_log (ssms_client_code, created, category, event, actor, actor_role, entity_type, entity_id,
                        summary, changes, ip, app_version, prev_hash, hash)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                array_values($row)
            );
        } catch (\Throwable $e) {
            Log::warning("Audit {$event}: " . $e->getMessage());
        } finally {
            try {
                $db->execute('SELECT RELEASE_LOCK(?)', [$lock]);
            } catch (\Throwable $e) {
            }
        }
    }

    /** Log from a controller/middleware request (actor, role, ip, app version taken from it). */
    public static function fromRequest($request, string $event, array $o = []): void
    {
        $client = (string)($o['client'] ?? $request->getAttribute('jwt_client_code') ?? '');
        if ($client === '' && isset($_SESSION) && is_array($_SESSION)) {
            $client = (string)($_SESSION['ssms_client_code'] ?? '');   // web pages (session sign-in)
        }
        $o += [
            'actor'       => (string)($request->getAttribute('jwt_user') ?: ($_SESSION['ssms_user_name'] ?? '')),
            'role'        => (string)($request->getAttribute('jwt_role') ?: ($_SESSION['ssms_user_role'] ?? '')),
            'ip'          => AccountSecurity::clientIp($request),
            'app_version' => (string)$request->getHeaderLine('X-App-Version') ?: 'web',
        ];
        unset($o['client']);
        self::log($client, $event, $o);
    }

    public static function fingerprint(array $r): string
    {
        return hash('sha256', implode('|', [
            $r['prev_hash'], $r['ssms_client_code'], $r['created'], $r['category'], $r['event'], $r['actor'],
            $r['actor_role'], $r['entity_type'], $r['entity_id'], $r['summary'], (string)$r['changes'],
        ]));
    }

    /** Replace secret values with •••• and keep big payloads small. */
    public static function mask($v, int $depth = 0)
    {
        if (is_array($v)) {
            if ($depth > 4) {
                return '[…]';
            }
            $out = [];
            $i   = 0;
            foreach ($v as $k => $x) {
                if (++$i > 60) {
                    $out['…'] = (count($v) - 60) . ' more';
                    break;
                }
                $key = strtolower((string)$k);
                if (in_array($key, self::SECRET_KEYS, true) || str_contains($key, 'password') || str_contains($key, 'secret')
                    || str_ends_with($key, 'token')) {
                    $out[$k] = '••••';
                    continue;
                }
                $out[$k] = self::mask($x, $depth + 1);
            }

            return $out;
        }
        if (is_object($v)) {
            return '[file]';
        }
        if (is_string($v) && mb_strlen($v) > 300) {
            return mb_substr($v, 0, 300) . '…';
        }

        return $v;
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /** filters: from, to (Y-m-d), actor, category, q, page (1-based) */
    public static function list(string $client, array $f = []): array
    {
        $w = ['ssms_client_code = ?'];
        $p = [$client];
        if (!empty($f['from'])) {
            $w[] = 'created >= ?';
            $p[] = substr((string)$f['from'], 0, 10) . ' 00:00:00';
        }
        if (!empty($f['to'])) {
            $w[] = 'created <= ?';
            $p[] = substr((string)$f['to'], 0, 10) . ' 23:59:59';
        }
        if (!empty($f['actor'])) {
            $w[] = 'actor = ?';
            $p[] = (string)$f['actor'];
        }
        if (!empty($f['category']) && in_array($f['category'], self::CATEGORIES, true)) {
            $w[] = 'category = ?';
            $p[] = $f['category'];
        }
        if (!empty($f['q'])) {
            $w[] = '(summary LIKE ? OR event LIKE ? OR entity_id LIKE ? OR actor LIKE ?)';
            $q   = '%' . str_replace(['%', '_'], ['\%', '\_'], (string)$f['q']) . '%';
            array_push($p, $q, $q, $q, $q);
        }
        $page = max(1, (int)($f['page'] ?? 1));
        $per  = min(200, max(10, (int)($f['per_page'] ?? 50)));
        $rows = self::db()->execute(
            'SELECT id, created, category, event, actor, actor_role, entity_type, entity_id, summary, ip, app_version
               FROM ssms_audit_log WHERE ' . implode(' AND ', $w) . ' ORDER BY id DESC LIMIT ' . ($per + 1) . ' OFFSET ' . (($page - 1) * $per),
            $p
        )->fetchAll('assoc');
        $more = count($rows) > $per;

        return ['entries' => array_map([self::class, 'cast'], array_slice($rows, 0, $per)), 'page' => $page, 'more' => $more];
    }

    public static function get(string $client, int $id): ?array
    {
        $r = self::db()->execute('SELECT * FROM ssms_audit_log WHERE ssms_client_code = ? AND id = ?', [$client, $id])->fetch('assoc');
        if (!$r) {
            return null;
        }
        $intact       = hash_equals((string)$r['hash'], self::fingerprint($r));
        $r            = self::cast($r);
        $r['changes'] = $r['changes'] !== null ? json_decode((string)$r['changes'], true) : null;
        $r['intact']  = $intact;
        unset($r['prev_hash']);

        return $r;
    }

    /** Re-check the chain. → { ok, checked, broken_at } */
    public static function verify(string $client, int $limit = 20000): array
    {
        $rows = self::db()->execute(
            'SELECT * FROM ssms_audit_log WHERE ssms_client_code = ? ORDER BY id ASC LIMIT ' . (int)$limit, [$client]
        )->fetchAll('assoc');
        $prev = null;
        foreach ($rows as $r) {
            if ($prev !== null && !hash_equals($prev, (string)$r['prev_hash'])) {
                return ['ok' => false, 'checked' => count($rows), 'broken_at' => (int)$r['id']];
            }
            if (!hash_equals((string)$r['hash'], self::fingerprint($r))) {
                return ['ok' => false, 'checked' => count($rows), 'broken_at' => (int)$r['id']];
            }
            $prev = (string)$r['hash'];
        }

        return ['ok' => true, 'checked' => count($rows), 'broken_at' => null];
    }

    public static function csv(string $client, array $f = []): string
    {
        $f['per_page'] = 200;
        $out = fopen('php://temp', 'r+');
        fputcsv($out, ['id', 'when', 'category', 'event', 'who', 'role', 'record type', 'record', 'summary', 'ip', 'app']);
        for ($page = 1; $page <= 250; $page++) {
            $f['page'] = $page;
            $chunk = self::list($client, $f);
            foreach ($chunk['entries'] as $e) {
                fputcsv($out, [$e['id'], $e['created'], $e['category'], $e['event'], $e['actor'], $e['actor_role'],
                    $e['entity_type'], $e['entity_id'], $e['summary'], $e['ip'], $e['app_version']]);
            }
            if (!$chunk['more']) {
                break;
            }
        }
        rewind($out);

        return (string)stream_get_contents($out);
    }

    /** Remove entries older than the school's retention; shorten IPs older than 90 days. */
    public static function maintain(string $client, int $years): array
    {
        $cut  = date('Y-m-d H:i:s', self::time() - $years * 365 * 86400);
        $del  = self::db()->execute('DELETE FROM ssms_audit_log WHERE ssms_client_code = ? AND created < ?', [$client, $cut])->rowCount();
        $ipc  = date('Y-m-d H:i:s', self::time() - 90 * 86400);
        $rows = self::db()->execute(
            "SELECT id, ip FROM ssms_audit_log WHERE ssms_client_code = ? AND created < ? AND ip <> '' AND ip NOT LIKE '%x%' LIMIT 5000",
            [$client, $ipc]
        )->fetchAll('assoc');
        foreach ($rows as $r) {
            self::db()->execute('UPDATE ssms_audit_log SET ip = ? WHERE id = ?', [self::shortIp((string)$r['ip']), $r['id']]);
        }

        return ['deleted' => (int)$del, 'ips_shortened' => count($rows)];
    }

    public static function shortIp(string $ip): string
    {
        if (str_contains($ip, '.')) {
            $p = explode('.', $ip);

            return ($p[0] ?? 'x') . '.' . ($p[1] ?? 'x') . '.x.x';
        }
        if (str_contains($ip, ':')) {
            $p = explode(':', $ip);

            return implode(':', array_slice($p, 0, 3)) . ':x';
        }

        return 'x';
    }

    private static function cast(array $r): array
    {
        $r['id'] = (int)$r['id'];

        return $r;
    }

    private static function time(): int
    {
        return is_callable(self::$now) ? (int)(self::$now)() : AccountSecurity::time();
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
