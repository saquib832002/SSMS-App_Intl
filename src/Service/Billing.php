<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Routing\Router;

/**
 * Billing – Stripe subscriptions for 'subscription' (international) schools.
 *
 * Flow:
 *   1. School admin opens /billing (web) and picks a plan
 *      → createCheckout() → Stripe Checkout page.
 *   2. Stripe calls /SubscriptionApi/stripeWebhook
 *      → handleWebhook() → syncSubscription():
 *         • saves the subscription in ssms_subscriptions
 *         • grants the plan's features in ssms_client_features
 *           with expires_at = end of the paid period + GRACE_DAYS
 *         • expires them when the subscription ends / is unpaid
 *   3. Entitlements cache is cleared → the paywall (phase 1) follows at once.
 *
 * Legacy (Indian) schools are never touched.
 */
final class Billing
{
    /** Extra days of access after the paid period while Stripe retries a payment. */
    public const GRACE_DAYS = 3;

    /** Subscription states that keep modules unlocked. */
    private const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'];

    public const ADMIN_ROLES = ['owner', 'admin', 'super', 'superuser'];

    public static function isAdminRole(?string $role): bool
    {
        return in_array(strtolower(trim((string)$role)), self::ADMIN_ROLES, true);
    }

    // ── Read ────────────────────────────────────────────────────────────────

    /** Active plans with their modules. */
    public static function plans(): array
    {
        $conn = ConnectionManager::get('default');
        $rows = $conn->execute(
            'SELECT * FROM ssms_plans WHERE is_active = 1 ORDER BY sort_order, plan_code'
        )->fetchAll('assoc');
        $mods = $conn->execute('SELECT plan_code, module_key FROM ssms_plan_modules')->fetchAll('assoc');

        $byPlan = [];
        foreach ($mods as $m) {
            $byPlan[$m['plan_code']][] = $m['module_key'];
        }

        $plans = [];
        foreach ($rows as $r) {
            $plans[] = [
                'planCode'    => $r['plan_code'],
                'name'        => $r['name'],
                'description' => $r['description'],
                'priceMinor'  => $r['price_minor'] !== null ? (int)$r['price_minor'] : null,
                'currency'    => $r['currency'],
                'interval'    => $r['billing_interval'],
                'available'   => !empty($r['stripe_price_id']),
                'playProductId' => $r['play_product_id'] ?? null,   // Google Play subscription id (phase 4)
                'modules'     => $byPlan[$r['plan_code']] ?? [],
            ];
        }

        return $plans;
    }

    public static function planModules(string $planCode): array
    {
        $rows = ConnectionManager::get('default')->execute(
            'SELECT module_key FROM ssms_plan_modules WHERE plan_code = ?',
            [$planCode]
        )->fetchAll('assoc');

        return array_column($rows, 'module_key');
    }

    public static function subscription(string $clientCode): ?array
    {
        $row = ConnectionManager::get('default')->execute(
            'SELECT s.*, p.name AS plan_name
               FROM ssms_subscriptions s
               LEFT JOIN ssms_plans p ON p.plan_code = s.plan_code
              WHERE s.ssms_client_code = ? LIMIT 1',
            [$clientCode]
        )->fetch('assoc');

        return $row ?: null;
    }

    /** Everything the app / billing page needs to show the school's status. */
    public static function status(string $clientCode): array
    {
        $ent = Entitlements::forClient($clientCode);
        $sub = Entitlements::isSubscription($ent) ? self::subscription($clientCode) : null;

        $trialEndsAt = null;
        if (Entitlements::isSubscription($ent)) {
            // Trial end = the school's expiry date (while any trial module is still unpaid)
            $row = ConnectionManager::get('default')->execute(
                "SELECT c.ssms_client_expiry_date AS trial_end
                   FROM ssms_clients c
                  WHERE c.ssms_client_code = ?
                    AND c.ssms_client_expiry_date >= CURDATE()
                    AND EXISTS (SELECT 1 FROM ssms_client_features f
                                 WHERE f.ssms_client_code = c.ssms_client_code
                                   AND f.source = 'trial')",
                [$clientCode]
            )->fetch('assoc');
            $trialEndsAt = $row['trial_end'] ?? null;
        }

        return [
            'billingModel'     => $ent['billing_model'],
            'activeModules'    => $ent['modules'],
            'activeFeatures'   => $ent['features'],
            'featureExpiries'  => (object)$ent['expiries'],
            'trialEndsAt'      => $trialEndsAt,
            'subscription'     => $sub ? [
                'planCode'          => $sub['plan_code'],
                'planName'          => $sub['plan_name'] ?? $sub['plan_code'],
                'provider'          => $sub['provider'] ?? 'stripe',
                'storeProductId'    => $sub['store_product_id'] ?? null,
                'status'            => $sub['status'],
                'currentPeriodEnd'  => $sub['current_period_end'],
                'cancelAtPeriodEnd' => (bool)$sub['cancel_at_period_end'],
            ] : null,
            'hasActiveSubscription' => $sub !== null && in_array($sub['status'], self::ENTITLED_STATUSES, true),
            'canManageBilling'      => $sub !== null && !empty($sub['stripe_customer_id']),
            'billingConfigured'     => StripeClient::isConfigured(),
        ];
    }

    // ── Checkout / portal ───────────────────────────────────────────────────

    /** @return string Stripe Checkout URL */
    public static function createCheckout(string $clientCode, string $planCode, ?string $email = null): string
    {
        $ent = Entitlements::forClient($clientCode);
        if (!Entitlements::isSubscription($ent)) {
            throw new \DomainException('Online billing is only available for schools on a subscription plan.');
        }

        $plan = ConnectionManager::get('default')->execute(
            'SELECT plan_code, stripe_price_id FROM ssms_plans WHERE plan_code = ? AND is_active = 1 LIMIT 1',
            [$planCode]
        )->fetch('assoc');
        if (!$plan || empty($plan['stripe_price_id'])) {
            throw new \DomainException('This plan is not available yet.');
        }

        $sub = self::subscription($clientCode);
        if ($sub && in_array($sub['status'], self::ENTITLED_STATUSES, true)) {
            throw new \DomainException(
                'Your school already has a subscription. Use "Manage billing" to change the plan or payment method.'
            );
        }

        $params = [
            'mode'                => 'subscription',
            'line_items'          => [['price' => $plan['stripe_price_id'], 'quantity' => 1]],
            'client_reference_id' => $clientCode,
            'metadata'            => ['client_code' => $clientCode, 'plan_code' => $planCode],
            'subscription_data'   => ['metadata' => ['client_code' => $clientCode, 'plan_code' => $planCode]],
            'success_url'         => self::url('billing?checkout=success'),
            'cancel_url'          => self::url('billing?checkout=cancel'),
            'allow_promotion_codes' => 'true',
        ];

        if ($sub && !empty($sub['stripe_customer_id'])) {
            $params['customer'] = $sub['stripe_customer_id'];
        } elseif ($email && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $params['customer_email'] = $email;
        }

        if (self::automaticTax()) {
            $params['automatic_tax']              = ['enabled' => 'true'];
            $params['billing_address_collection'] = 'required';
            if (isset($params['customer'])) {
                $params['customer_update'] = ['address' => 'auto', 'name' => 'auto'];
            }
        }

        $session = StripeClient::request('POST', 'checkout/sessions', $params);
        if (empty($session['url'])) {
            throw new \RuntimeException('Stripe did not return a checkout URL.');
        }

        return (string)$session['url'];
    }

    /** @return string Stripe customer portal URL (change plan, card, cancel, invoices) */
    public static function createPortal(string $clientCode): string
    {
        $sub = self::subscription($clientCode);
        if (!$sub || empty($sub['stripe_customer_id'])) {
            throw new \DomainException('There is no billing account yet. Please choose a plan first.');
        }

        $session = StripeClient::request('POST', 'billing_portal/sessions', [
            'customer'   => $sub['stripe_customer_id'],
            'return_url' => self::url('billing'),
        ]);

        return (string)$session['url'];
    }

    // ── Webhook ─────────────────────────────────────────────────────────────

    /**
     * Process a verified Stripe event exactly once.
     * Throws on failure so the controller returns 500 and Stripe retries.
     */
    public static function handleWebhook(array $event, string $payload): string
    {
        $conn = ConnectionManager::get('default');
        $id   = (string)$event['id'];
        $type = (string)$event['type'];

        $seen = $conn->execute(
            'SELECT processed_at FROM ssms_billing_events WHERE stripe_event_id = ? LIMIT 1',
            [$id]
        )->fetch('assoc');
        if ($seen && !empty($seen['processed_at'])) {
            return 'duplicate';
        }
        if (!$seen) {
            $conn->execute(
                'INSERT IGNORE INTO ssms_billing_events (stripe_event_id, event_type, payload) VALUES (?, ?, ?)',
                [$id, $type, $payload]
            );
        }

        try {
            $client = self::dispatch($type, $event['data']['object'] ?? []);
            $conn->execute(
                'UPDATE ssms_billing_events SET processed_at = NOW(), ssms_client_code = ?, error = NULL
                  WHERE stripe_event_id = ?',
                [$client, $id]
            );

            return $client !== null ? 'processed:' . $client : 'ignored';
        } catch (\Throwable $e) {
            $conn->execute(
                'UPDATE ssms_billing_events SET error = ? WHERE stripe_event_id = ?',
                [mb_substr($e->getMessage(), 0, 2000), $id]
            );
            throw $e;
        }
    }

    private static function dispatch(string $type, array $obj): ?string
    {
        switch ($type) {
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded':
                if (($obj['mode'] ?? '') !== 'subscription') {
                    return null;
                }
                $subId  = self::idOf($obj['subscription'] ?? null);
                $client = $obj['client_reference_id'] ?? ($obj['metadata']['client_code'] ?? null);
                return $subId ? self::syncById($subId, $client) : null;

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
            case 'customer.subscription.paused':
            case 'customer.subscription.resumed':
                // Re-read from Stripe: events can arrive out of order.
                $subId = self::idOf($obj['id'] ?? null);
                return $subId ? self::syncById($subId, $obj['metadata']['client_code'] ?? null) : null;

            case 'invoice.paid':
            case 'invoice.payment_succeeded':
            case 'invoice.payment_failed':
                // 'subscription' moved under parent.subscription_details in newer API versions
                $subId = self::idOf($obj['subscription'] ?? ($obj['parent']['subscription_details']['subscription'] ?? null));
                return $subId ? self::syncById($subId, null) : null;
        }

        return null; // other events are logged but not needed
    }

    private static function syncById(string $subscriptionId, ?string $clientHint): ?string
    {
        $sub = StripeClient::request('GET', 'subscriptions/' . rawurlencode($subscriptionId));

        return self::syncSubscription($sub, $clientHint);
    }

    /**
     * Save a Stripe subscription object and update the school's modules.
     * Public so it can be unit-tested and reused (e.g. a manual resync script).
     */
    public static function syncSubscription(array $sub, ?string $clientHint = null): ?string
    {
        $conn     = ConnectionManager::get('default');
        $subId    = (string)($sub['id'] ?? '');
        $customer = self::idOf($sub['customer'] ?? null);
        $client   = $sub['metadata']['client_code'] ?? $clientHint;

        if (!$client) {
            $row = $conn->execute(
                'SELECT ssms_client_code FROM ssms_subscriptions
                  WHERE stripe_subscription_id = ? OR (stripe_customer_id IS NOT NULL AND stripe_customer_id = ?)
                  LIMIT 1',
                [$subId, $customer]
            )->fetch('assoc');
            $client = $row['ssms_client_code'] ?? null;
        }
        if (!$client) {
            Log::warning("Billing: subscription {$subId} has no school (client_code) – ignored");
            return null;
        }

        $item     = $sub['items']['data'][0] ?? [];
        $priceId  = $item['price']['id'] ?? null;
        $planCode = null;
        if ($priceId) {
            $p = $conn->execute('SELECT plan_code FROM ssms_plans WHERE stripe_price_id = ? LIMIT 1', [$priceId])
                ->fetch('assoc');
            $planCode = $p['plan_code'] ?? null;
        }
        $planCode   = $planCode ?? ($sub['metadata']['plan_code'] ?? null);
        // current_period_end moved from the subscription to its items in Stripe API 2025-03-31
        $periodEnd  = $item['current_period_end'] ?? ($sub['current_period_end'] ?? null);
        $status     = (string)($sub['status'] ?? 'incomplete');
        $entitled   = in_array($status, self::ENTITLED_STATUSES, true);

        // An old, ended subscription must not cancel the school's newer active one.
        $existing = self::subscription($client);
        if ($existing && !empty($existing['stripe_subscription_id'])
            && $existing['stripe_subscription_id'] !== $subId
            && in_array($existing['status'], self::ENTITLED_STATUSES, true)
            && !$entitled) {
            Log::info("Billing: ignored update for old subscription {$subId} of {$client}");
            return $client;
        }

        $conn->begin();
        try {
            $conn->execute(
                'INSERT INTO ssms_subscriptions
                    (ssms_client_code, plan_code, status, stripe_customer_id, stripe_subscription_id,
                     current_period_end, trial_end, cancel_at_period_end, canceled_at)
                 VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, FROM_UNIXTIME(?))
                 ON DUPLICATE KEY UPDATE
                    plan_code              = VALUES(plan_code),
                    status                 = VALUES(status),
                    stripe_customer_id     = VALUES(stripe_customer_id),
                    stripe_subscription_id = VALUES(stripe_subscription_id),
                    current_period_end     = VALUES(current_period_end),
                    trial_end              = VALUES(trial_end),
                    cancel_at_period_end   = VALUES(cancel_at_period_end),
                    canceled_at            = VALUES(canceled_at)',
                [
                    $client, $planCode, $status, $customer, $subId,
                    $periodEnd, $sub['trial_end'] ?? null,
                    !empty($sub['cancel_at_period_end']) ? 1 : 0,
                    $sub['canceled_at'] ?? null,
                ]
            );

            $modules = $planCode ? self::planModules($planCode) : [];

            if ($entitled && $periodEnd && $modules) {
                $expires = (int)$periodEnd + self::GRACE_DAYS * 86400;
                foreach ($modules as $module) {
                    // Paid period replaces a trial row; a permanent manual grant (NULL) is kept.
                    $conn->execute(
                        "INSERT INTO ssms_client_features (ssms_client_code, feature_key, source, expires_at)
                         VALUES (?, ?, 'subscription', FROM_UNIXTIME(?))
                         ON DUPLICATE KEY UPDATE
                            source     = IF(source = 'manual' AND expires_at IS NULL, source, 'subscription'),
                            expires_at = IF(source = 'manual' AND expires_at IS NULL, NULL, VALUES(expires_at))",
                        [$client, $module, $expires]
                    );
                }
                // Plan downgraded → features no longer in the plan end now.
                $in = implode(',', array_fill(0, count($modules), '?'));
                $conn->execute(
                    "UPDATE ssms_client_features SET expires_at = NOW()
                      WHERE ssms_client_code = ? AND source = 'subscription'
                        AND feature_key NOT IN ({$in})
                        AND (expires_at IS NULL OR expires_at > NOW())",
                    array_merge([$client], $modules)
                );
            } else {
                // Cancelled / unpaid / incomplete → paid features end now (trial / manual rows untouched).
                $conn->execute(
                    "UPDATE ssms_client_features SET expires_at = NOW()
                      WHERE ssms_client_code = ? AND source = 'subscription'
                        AND (expires_at IS NULL OR expires_at > NOW())",
                    [$client]
                );
            }

            $conn->commit();
        } catch (\Throwable $e) {
            $conn->rollback();
            throw $e;
        }

        Entitlements::clear($client);

        return $client;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** Absolute URL on this site (BILLING_BASE_URL overrides, e.g. https://managemyacademy.com/). */
    public static function url(string $path): string
    {
        $base = (string)env('BILLING_BASE_URL', '');
        if ($base === '') {
            $base = Router::url('/', true);
        }

        return rtrim($base, '/') . '/' . ltrim($path, '/');
    }

    private static function automaticTax(): bool
    {
        return in_array(strtolower((string)env('STRIPE_AUTOMATIC_TAX', '0')), ['1', 'true', 'yes'], true);
    }

    private static function idOf($value): ?string
    {
        if (is_array($value)) {
            $value = $value['id'] ?? null;
        }
        $value = $value !== null ? (string)$value : '';

        return $value !== '' ? $value : null;
    }
}
