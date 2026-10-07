<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Core\Configure;

/**
 * Minimal Stripe REST client (no Composer package needed – uses cURL).
 *
 * Config (config/.env or config/app_local.php → 'Stripe' => [...]):
 *   STRIPE_SECRET_KEY      sk_test_... / sk_live_...
 *   STRIPE_WEBHOOK_SECRET  whsec_...   (from the webhook endpoint in Stripe)
 */
final class StripeClient
{
    private const API_BASE = 'https://api.stripe.com/v1/';

    /** Signed webhooks older than this are rejected (replay protection). */
    public const WEBHOOK_TOLERANCE = 300;

    public static function secretKey(): string
    {
        return (string)(env('STRIPE_SECRET_KEY', '') ?: Configure::read('Stripe.secretKey', ''));
    }

    public static function webhookSecret(): string
    {
        return (string)(env('STRIPE_WEBHOOK_SECRET', '') ?: Configure::read('Stripe.webhookSecret', ''));
    }

    public static function isConfigured(): bool
    {
        return self::secretKey() !== '';
    }

    /**
     * Call the Stripe API.
     *
     * @param string $method GET | POST | DELETE
     * @param string $path   e.g. 'checkout/sessions' or 'subscriptions/sub_123'
     * @param array  $params form parameters (nested arrays allowed)
     * @return array decoded JSON
     * @throws \RuntimeException on network or Stripe errors
     */
    public static function request(string $method, string $path, array $params = [], ?string $idempotencyKey = null): array
    {
        $key = self::secretKey();
        if ($key === '') {
            throw new \RuntimeException('Stripe is not configured (STRIPE_SECRET_KEY missing).');
        }

        $method = strtoupper($method);
        $url    = self::API_BASE . ltrim($path, '/');
        $query  = http_build_query($params, '', '&', PHP_QUERY_RFC1738);

        $headers = ['Authorization: Bearer ' . $key];
        if ($idempotencyKey !== null) {
            $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
        }

        $ch = curl_init();
        if ($method === 'GET') {
            curl_setopt($ch, CURLOPT_URL, $query !== '' ? $url . '?' . $query : $url);
        } else {
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $query);
            $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 30,
        ]);

        $raw    = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err    = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            throw new \RuntimeException('Stripe request failed: ' . $err);
        }
        $data = json_decode((string)$raw, true);
        if (!is_array($data)) {
            throw new \RuntimeException("Stripe returned an invalid response (HTTP {$status}).");
        }
        if ($status >= 400) {
            $msg = $data['error']['message'] ?? "HTTP {$status}";
            throw new \RuntimeException('Stripe error: ' . $msg);
        }

        return $data;
    }

    /**
     * Verify the Stripe-Signature header and return the decoded event.
     * Signed payload = "{timestamp}.{raw body}", HMAC-SHA256 with the
     * endpoint secret, compared against every v1 signature in the header.
     *
     * @throws \RuntimeException when the signature is missing/invalid/too old
     */
    public static function verifyWebhook(string $payload, string $sigHeader, ?string $secret = null, ?int $now = null): array
    {
        $secret = $secret ?? self::webhookSecret();
        if ($secret === '') {
            throw new \RuntimeException('STRIPE_WEBHOOK_SECRET is not configured.');
        }

        $timestamp  = null;
        $signatures = [];
        foreach (explode(',', $sigHeader) as $part) {
            $kv = explode('=', trim($part), 2);
            if (count($kv) !== 2) {
                continue;
            }
            if ($kv[0] === 't') {
                $timestamp = (int)$kv[1];
            } elseif ($kv[0] === 'v1') {
                $signatures[] = $kv[1];
            }
        }
        if ($timestamp === null || $signatures === []) {
            throw new \RuntimeException('Missing or malformed Stripe-Signature header.');
        }

        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
        $valid    = false;
        foreach ($signatures as $sig) {
            if (hash_equals($expected, $sig)) {
                $valid = true;
                break;
            }
        }
        if (!$valid) {
            throw new \RuntimeException('Invalid Stripe webhook signature.');
        }
        if (abs(($now ?? time()) - $timestamp) > self::WEBHOOK_TOLERANCE) {
            throw new \RuntimeException('Stripe webhook timestamp outside tolerance.');
        }

        $event = json_decode($payload, true);
        if (!is_array($event) || empty($event['id']) || empty($event['type'])) {
            throw new \RuntimeException('Invalid Stripe event payload.');
        }

        return $event;
    }
}
