<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Core\Configure;
use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * PlayBilling – Google Play in-app subscriptions through RevenueCat.
 *
 * The app buys a Play subscription with the RevenueCat SDK, using the app user
 * id  "school_<CLIENTCODE>"  so the subscription belongs to the SCHOOL, not to
 * one phone. This class asks RevenueCat for that school's current state and
 * writes it to:
 *   • ssms_client_features  (source = 'play', expires_at = paid-until + grace)
 *   • ssms_subscriptions    (provider = 'google_play')
 * The paywall (Entitlements) then follows automatically.
 *
 * Called from:
 *   • SubscriptionApi/syncPlayPurchase   – the app, right after a purchase/restore
 *   • SubscriptionApi/revenuecatWebhook  – RevenueCat, on renewals, cancels, expiry …
 *
 * Config (config/.env):
 *   REVENUECAT_SECRET_KEY     sk_…   (RevenueCat → Project settings → API keys, secret)
 *   REVENUECAT_WEBHOOK_AUTH   any long random string, also set as the webhook's
 *                             "Authorization header value" in RevenueCat
 */
final class PlayBilling
{
    private const API_BASE = 'https://api.revenuecat.com/v1/';

    /** Extra access after the paid-until date (Play's own grace period comes on top). */
    public const GRACE_HOURS = 24;

    public static function appUserId(string $clientCode): string
    {
        return 'school_' . strtoupper(trim($clientCode));
    }

    public static function clientFromAppUserId(?string $appUserId): ?string
    {
        if ($appUserId !== null && preg_match('/^school_([A-Za-z0-9]{1,20})$/', trim($appUserId), $m)) {
            return strtoupper($m[1]);
        }

        return null;
    }

    public static function secretKey(): string
    {
        return (string)(env('REVENUECAT_SECRET_KEY', '') ?: Configure::read('RevenueCat.secretKey', ''));
    }

    public static function webhookAuth(): string
    {
        return (string)(env('REVENUECAT_WEBHOOK_AUTH', '') ?: Configure::read('RevenueCat.webhookAuth', ''));
    }

    /** GET a RevenueCat REST resource. */
    public static function request(string $path): array
    {
        $key = self::secretKey();
        if ($key === '') {
            throw new \RuntimeException('RevenueCat is not configured (REVENUECAT_SECRET_KEY missing).');
        }

        $ch = curl_init(self::API_BASE . ltrim($path, '/'));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $key, 'Accept: application/json'],
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 30,
        ]);
        $raw    = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err    = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            throw new \RuntimeException('RevenueCat request failed: ' . $err);
        }
        $data = json_decode((string)$raw, true);
        if (!is_array($data) || $status >= 400) {
            $msg = is_array($data) ? ($data['message'] ?? "HTTP {$status}") : "HTTP {$status}";
            throw new \RuntimeException('RevenueCat error: ' . $msg);
        }

        return $data;
    }

    /**
     * Re-read the school's Play subscription from RevenueCat and update the
     * database. Returns the new Billing::status().
     *
     * @param array|null $subscriber Pre-fetched "subscriber" object (tests); null = fetch.
     */
    public static function sync(string $clientCode, ?array $subscriber = null): array
    {
        $clientCode = strtoupper(trim($clientCode));
        $ent = Entitlements::forClient($clientCode);
        if (!Entitlements::isSubscription($ent)) {
            throw new \DomainException('In-app subscriptions are only available for schools on a subscription plan.');
        }

        if ($subscriber === null) {
            $data       = self::request('subscribers/' . rawurlencode(self::appUserId($clientCode)));
            $subscriber = $data['subscriber'] ?? [];
        }

        $conn  = ConnectionManager::get('default');
        $plans = $conn->execute(
            'SELECT plan_code, play_product_id FROM ssms_plans WHERE play_product_id IS NOT NULL'
        )->fetchAll('assoc');

        // Pick the best ACTIVE plan (most features); otherwise remember the latest expired one.
        $now    = time();
        $best   = null;
        $latest = null;
        foreach ((array)($subscriber['subscriptions'] ?? []) as $productId => $s) {
            $planCode = self::planForProduct((string)$productId, $plans);
            if ($planCode === null) {
                continue;
            }
            $expires = !empty($s['expires_date']) ? strtotime((string)$s['expires_date']) : null;
            // Monthly and yearly are two BASE PLANS of the same Play subscription
            // (ssms_basic:monthly / ssms_basic:yearly) – same plan, same features.
            $product = (string)$productId;
            if (strpos($product, ':') === false && !empty($s['product_plan_identifier'])) {
                $product .= ':' . $s['product_plan_identifier'];
            }
            $row = [
                'plan'       => $planCode,
                'product'    => $product,
                'expires'    => $expires,
                'active'     => $expires === null || $expires > $now,
                'cancelled'  => !empty($s['unsubscribe_detected_at']),
                'billingErr' => !empty($s['billing_issues_detected_at']),
                'trial'      => ($s['period_type'] ?? '') === 'trial',
                'modules'    => count(Billing::planModules($planCode)),
            ];
            // Most features wins; same plan (e.g. monthly → yearly switch) → later paid-until wins
            if ($row['active'] && (
                $best === null
                || $row['modules'] > $best['modules']
                || ($row['modules'] === $best['modules'] && (int)$row['expires'] > (int)$best['expires'])
            )) {
                $best = $row;
            }
            if ($latest === null || (int)$row['expires'] > (int)$latest['expires']) {
                $latest = $row;
            }
        }

        $state = $best ?? $latest; // what to record in ssms_subscriptions
        $conn->begin();
        try {
            if ($best !== null) {
                $modules   = Billing::planModules($best['plan']);
                $expiresAt = $best['expires'] !== null ? $best['expires'] + self::GRACE_HOURS * 3600 : null;
                foreach ($modules as $feature) {
                    // expires_at is assigned BEFORE source so the IF() still sees the old source.
                    $conn->execute(
                        "INSERT INTO ssms_client_features (ssms_client_code, feature_key, source, expires_at)
                         VALUES (?, ?, 'play', FROM_UNIXTIME(?))
                         ON DUPLICATE KEY UPDATE
                            expires_at = IF(source = 'manual' AND expires_at IS NULL, NULL, VALUES(expires_at)),
                            source     = IF(source = 'manual' AND expires_at IS NULL, source, 'play')",
                        [$clientCode, $feature, $expiresAt]
                    );
                }
                // Downgrade → features not in the plan end now.
                $in = implode(',', array_fill(0, count($modules), '?'));
                $conn->execute(
                    "UPDATE ssms_client_features SET expires_at = NOW()
                      WHERE ssms_client_code = ? AND source = 'play'
                        AND feature_key NOT IN ({$in})
                        AND (expires_at IS NULL OR expires_at > NOW())",
                    array_merge([$clientCode], $modules)
                );
            } else {
                // No active Play subscription → Play-granted features end now.
                $conn->execute(
                    "UPDATE ssms_client_features SET expires_at = NOW()
                      WHERE ssms_client_code = ? AND source = 'play'
                        AND (expires_at IS NULL OR expires_at > NOW())",
                    [$clientCode]
                );
            }

            if ($state !== null) {
                $status = !$state['active'] ? 'expired'
                    : ($state['billingErr'] ? 'past_due' : ($state['trial'] ? 'trialing' : 'active'));
                $conn->execute(
                    "INSERT INTO ssms_subscriptions
                        (ssms_client_code, plan_code, status, provider, store_product_id,
                         current_period_end, cancel_at_period_end)
                     VALUES (?, ?, ?, 'google_play', ?, FROM_UNIXTIME(?), ?)
                     ON DUPLICATE KEY UPDATE
                        plan_code            = VALUES(plan_code),
                        status               = VALUES(status),
                        provider             = 'google_play',
                        store_product_id     = VALUES(store_product_id),
                        current_period_end   = VALUES(current_period_end),
                        cancel_at_period_end = VALUES(cancel_at_period_end)",
                    [$clientCode, $state['plan'], $status, $state['product'], $state['expires'], $state['cancelled'] ? 1 : 0]
                );
            }

            $conn->commit();
        } catch (\Throwable $e) {
            $conn->rollback();
            throw $e;
        }

        Entitlements::clear($clientCode);

        return Billing::status($clientCode);
    }

    /**
     * Process a RevenueCat webhook body exactly once.
     * @return string result for logging
     */
    public static function handleWebhook(array $body, string $payload): string
    {
        $event = $body['event'] ?? [];
        $type  = (string)($event['type'] ?? '');
        $id    = (string)($event['id'] ?? '');
        if ($type === 'TEST') {
            return 'test';
        }

        // Find the school among all ids RevenueCat sends for this customer.
        $ids = array_merge(
            [$event['app_user_id'] ?? null, $event['original_app_user_id'] ?? null],
            (array)($event['aliases'] ?? []),
            (array)($event['transferred_to'] ?? [])
        );
        $client = null;
        foreach ($ids as $candidate) {
            $client = self::clientFromAppUserId(is_string($candidate) ? $candidate : null);
            if ($client !== null) {
                break;
            }
        }
        if ($client === null) {
            Log::warning("RevenueCat webhook {$type} {$id}: no school_<code> app user id – ignored");
            return 'ignored';
        }

        $conn    = ConnectionManager::get('default');
        $eventId = 'rc_' . ($id !== '' ? $id : sha1($payload));
        $seen    = $conn->execute(
            'SELECT processed_at FROM ssms_billing_events WHERE stripe_event_id = ? LIMIT 1',
            [$eventId]
        )->fetch('assoc');
        if ($seen && !empty($seen['processed_at'])) {
            return 'duplicate';
        }
        if (!$seen) {
            $conn->execute(
                'INSERT IGNORE INTO ssms_billing_events (stripe_event_id, event_type, ssms_client_code, payload) VALUES (?, ?, ?, ?)',
                [$eventId, 'revenuecat.' . $type, $client, $payload]
            );
        }

        try {
            self::sync($client);
            $conn->execute(
                'UPDATE ssms_billing_events SET processed_at = NOW(), error = NULL WHERE stripe_event_id = ?',
                [$eventId]
            );

            return 'processed:' . $client;
        } catch (\DomainException $e) {
            // e.g. a legacy (Indian) school – nothing to do, don't make RevenueCat retry
            $conn->execute(
                'UPDATE ssms_billing_events SET processed_at = NOW(), error = ? WHERE stripe_event_id = ?',
                [$e->getMessage(), $eventId]
            );

            return 'skipped:' . $client;
        } catch (\Throwable $e) {
            $conn->execute(
                'UPDATE ssms_billing_events SET error = ? WHERE stripe_event_id = ?',
                [mb_substr($e->getMessage(), 0, 2000), $eventId]
            );
            throw $e;
        }
    }

    /** "ssms_basic:monthly" or "ssms_basic" → BASIC */
    private static function planForProduct(string $productId, array $plans): ?string
    {
        $base = explode(':', $productId)[0];
        foreach ($plans as $p) {
            if ($p['play_product_id'] === $productId || $p['play_product_id'] === $base) {
                return $p['plan_code'];
            }
        }

        return null;
    }
}
