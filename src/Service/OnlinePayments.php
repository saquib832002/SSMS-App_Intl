<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Utility\Security;

/**
 * OnlinePayments – parents pay school fees online.
 *
 * Every school connects ITS OWN payment account, so the money goes straight
 * to the school (ManageMyAcademy takes no fee):
 *   • stripe   – Stripe Connect (Accounts v2: full Dashboard, school pays its own
 *                fees), direct charges on the school's account. One-click onboarding.
 *   • razorpay – the school's own Razorpay API keys (Indian schools), stored
 *                encrypted.
 *
 * Flow
 *   1. createPayment()  – app (parent, or admin "send link") picks due fee items;
 *                         a pay link /pay/{token} is stored with a snapshot of them.
 *   2. /pay/{token}     – web page: Stripe Checkout or Razorpay Checkout.
 *   3. confirm()        – on success (return page, Razorpay callback or webhook)
 *                         the payment is marked paid ONCE and written to
 *                         ssms_fee_paid_details like a counter payment
 *                         (admin_review = 'Pending' → owner approves as usual).
 *
 * Server config (config/.env):
 *   STRIPE_SECRET_KEY               platform key (Connect enabled)
 *   STRIPE_CONNECT_WEBHOOK_SECRET   whsec_… of the "Connected accounts" webhook
 */
final class OnlinePayments
{
    public const LINK_DAYS = 7;

    /** Currencies without minor units (Stripe list). */
    private const ZERO_DECIMAL = ['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF'];
    /** Three-decimal currencies (Stripe: last digit must be 0). */
    private const THREE_DECIMAL = ['BHD','JOD','KWD','OMR','TND'];

    /**
     * Countries where a school can open its own Stripe account (stripe.com/global,
     * self-serve, Oct 2026). India / Indonesia are invite-only → not offered.
     * Update this list when Stripe adds countries.
     */
    public const STRIPE_COUNTRIES = [
        'AE','AT','AU','BE','BG','BR','CA','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GI','GR','HK',
        'HR','HU','IE','IT','JP','LI','LT','LU','LV','MT','MX','MY','NL','NO','NZ','PL','PT','RO','SE','SG',
        'SI','SK','TH','US',
    ];
    /** Razorpay accounts are for Indian businesses. */
    public const RAZORPAY_COUNTRIES = ['IN'];

    /** Provider usable for the school's country ('' country = not known → allowed). */
    public static function providerAllowed(string $provider, string $country): bool
    {
        if ($country === '') {
            return true;
        }
        if ($provider === 'stripe') {
            return self::stripeSupported($country);
        }
        if ($provider === 'razorpay') {
            return in_array($country, self::RAZORPAY_COUNTRIES, true);
        }

        return false;
    }

    public static function stripeSupported(string $country): bool
    {
        return in_array(strtoupper($country), self::STRIPE_COUNTRIES, true);
    }

    /** Test hook: callable(method, path, params, idempotencyKey, account): array */
    public static $stripeHttp = null;
    /** Test hook: callable(method, path, params, keyId, keySecret): array */
    public static $razorpayHttp = null;

    // ── Settings ────────────────────────────────────────────────────────────

    public static function settings(string $clientCode): array
    {
        $row = self::db()->execute(
            'SELECT * FROM ssms_payment_settings WHERE ssms_client_code = ? LIMIT 1',
            [self::code($clientCode)]
        )->fetch('assoc');

        return $row ?: [
            'ssms_client_code' => self::code($clientCode), 'provider' => null, 'online_enabled' => 0,
            'stripe_account_id' => null, 'stripe_charges_enabled' => 0, 'stripe_details_submitted' => 0,
            'razorpay_key_id' => null, 'razorpay_key_secret' => null, 'razorpay_webhook_secret' => null,
        ];
    }

    /** Safe view for the app (no secrets). */
    public static function publicSettings(string $clientCode): array
    {
        $s       = self::settings($clientCode);
        $country = self::schoolCountry($clientCode);       // '' = not set yet

        return [
            'provider'               => $s['provider'],
            'enabled'                => (bool)$s['online_enabled'],
            'available'              => self::isAvailable($s) && self::providerAllowed((string)$s['provider'], $country),
            'stripeConnected'        => !empty($s['stripe_account_id']),
            'stripeChargesEnabled'   => (bool)$s['stripe_charges_enabled'],
            'stripeDetailsSubmitted' => (bool)$s['stripe_details_submitted'],
            'razorpayKeyId'          => $s['razorpay_key_id'],
            'razorpayConfigured'     => !empty($s['razorpay_key_id']) && !empty($s['razorpay_key_secret']),
            'razorpayWebhookSet'     => !empty($s['razorpay_webhook_secret']),
            'currency'               => self::schoolCurrency($clientCode),
            'country'                => $country,
            // null = country not known yet (owner picks it when connecting Stripe)
            'stripeSupported'        => $country === '' ? null : self::stripeSupported($country),
            'razorpaySupported'      => $country === '' ? null : in_array($country, self::RAZORPAY_COUNTRIES, true),
            'stripeCountries'        => self::STRIPE_COUNTRIES,
        ];
    }

    public static function isAvailable(array $s): bool
    {
        if (empty($s['online_enabled'])) {
            return false;
        }
        if ($s['provider'] === 'stripe') {
            return !empty($s['stripe_account_id']) && !empty($s['stripe_charges_enabled']);
        }
        if ($s['provider'] === 'razorpay') {
            return !empty($s['razorpay_key_id']) && !empty($s['razorpay_key_secret']);
        }

        return false;
    }

    /** Start / continue Stripe onboarding. Returns the Stripe-hosted onboarding URL. */
    /** Exception code: the school's country is needed before a Stripe account can be created. */
    public const ERR_COUNTRY_REQUIRED = 1001;

    public static function stripeOnboardingUrl(string $clientCode, string $by, string $returnUrl, string $refreshUrl, ?string $country = null): string
    {
        $code = self::code($clientCode);
        $s    = self::settings($code);
        $acct = (string)($s['stripe_account_id'] ?? '');
        if ($acct === '') {
            // Stripe needs the country of the school's business / bank account.
            $school  = self::school($code);
            $saved   = strtoupper(trim((string)($school['country_code'] ?? '')));
            $country = strtoupper(trim((string)$country));
            if (!preg_match('/^[A-Z]{2}$/', $country) || $country === 'ZZ') {
                $country = $saved;
            }
            if (!preg_match('/^[A-Z]{2}$/', $country) || $country === 'ZZ') {
                throw new \DomainException("Please choose the country of your school's bank account.", self::ERR_COUNTRY_REQUIRED);
            }
            if ($country === 'IN') {
                throw new \DomainException('Stripe is not available for schools in India here – please use Razorpay instead.');
            }
            if (!self::stripeSupported($country)) {
                throw new \DomainException('Stripe does not support schools in this country yet, so online payments are not available.');
            }
            if ($saved === '' || $saved === 'ZZ') {
                self::db()->execute('UPDATE ssms_clients SET country_code = ? WHERE ssms_client_code = ?', [$country, $code]);
            }
            // Accounts v2: the school gets the FULL Stripe Dashboard, pays its own
            // Stripe fees and is responsible for its own refunds/disputes
            // (same as the old "Standard" account). Payments are direct charges.
            $body = [
                'display_name'  => mb_substr((string)($school['ssms_client_header_text'] ?? $code), 0, 100) ?: $code,
                'dashboard'     => 'full',
                'defaults'      => ['responsibilities' => ['fees_collector' => 'stripe', 'losses_collector' => 'stripe']],
                'configuration' => ['merchant' => ['capabilities' => ['card_payments' => ['requested' => true]]]],
                'metadata'      => ['ssms_client_code' => $code],
                'include'       => ['configuration.merchant'],
            ];
            if (!empty($school['ssms_client_email']) && filter_var($school['ssms_client_email'], FILTER_VALIDATE_EMAIL)) {
                $body['contact_email'] = $school['ssms_client_email'];
            }
            $body['identity'] = ['country' => strtolower($country)];
            $acc  = self::stripe2('POST', 'core/accounts', $body, [], 'acct-create-' . $code . '-' . strtolower($country));
            $acct = (string)$acc['id'];
            self::saveSettings($code, ['provider' => 'stripe', 'stripe_account_id' => $acct], $by);
        } elseif ($s['provider'] !== 'stripe') {
            self::saveSettings($code, ['provider' => 'stripe'], $by);
        }
        // Newer Stripe API versions take the configurations from the account itself
        // ("configurations: Unknown field"); older ones require ['merchant'].
        // Try without it first, and retry with it if Stripe asks for it.
        $onboarding = ['refresh_url' => $refreshUrl, 'return_url' => $returnUrl];
        $linkBody   = fn(array $o) => ['account' => $acct, 'use_case' => ['type' => 'account_onboarding', 'account_onboarding' => $o]];
        try {
            $link = self::stripe2('POST', 'core/account_links', $linkBody($onboarding));
        } catch (\RuntimeException $e) {
            if (stripos($e->getMessage(), 'configurations') === false) {
                throw $e;
            }
            $link = self::stripe2('POST', 'core/account_links', $linkBody(['configurations' => ['merchant']] + $onboarding));
        }

        return (string)$link['url'];
    }

    /** Re-read the school's Stripe account (charges enabled?). */
    public static function refreshStripe(string $clientCode, string $by = 'system'): array
    {
        $code = self::code($clientCode);
        $s    = self::settings($code);
        if (empty($s['stripe_account_id'])) {
            throw new \DomainException('Stripe is not connected yet.');
        }
        $acc = self::stripe2('GET', 'core/accounts/' . rawurlencode((string)$s['stripe_account_id']), null, [
            'include' => ['configuration.merchant'],
        ]);
        // card_payments: active | pending | restricted | unsupported
        $cardStatus = (string)($acc['configuration']['merchant']['capabilities']['card_payments']['status'] ?? '');
        $charges    = $cardStatus === 'active';
        $firstReady = $charges && $s['provider'] === 'stripe' && empty($s['stripe_charges_enabled']);
        self::saveSettings($code, [
            'stripe_charges_enabled'   => $charges ? 1 : 0,
            'stripe_details_submitted' => in_array($cardStatus, ['active', 'pending'], true) ? 1 : 0,
            // first time Stripe becomes ready → switch online payments on
            'online_enabled'           => $firstReady ? 1 : (int)$s['online_enabled'],
        ], $by);

        return self::publicSettings($code);
    }

    /** Save (and test) the school's own Razorpay keys. */
    public static function saveRazorpay(string $clientCode, string $keyId, string $keySecret, string $webhookSecret, string $by): array
    {
        $code   = self::code($clientCode);
        $keyId  = trim($keyId);
        $secret = trim($keySecret);
        $country = self::schoolCountry($code);
        if ($country !== '' && !in_array($country, self::RAZORPAY_COUNTRIES, true)) {
            throw new \DomainException('Razorpay is only available for schools in India.');
        }
        if (!preg_match('/^rzp_(live|test)_[A-Za-z0-9]{6,40}$/', $keyId)) {
            throw new \InvalidArgumentException('Key ID should look like rzp_live_… or rzp_test_….');
        }
        $old = self::settings($code);
        if ($secret === '' && !empty($old['razorpay_key_secret']) && $old['razorpay_key_id'] === $keyId) {
            $secret = self::decrypt((string)$old['razorpay_key_secret']);   // keep the saved secret
        }
        if (strlen($secret) < 10) {
            throw new \InvalidArgumentException('Please enter the Key Secret.');
        }
        try {
            self::razorpay('GET', 'orders', ['count' => 1], $keyId, $secret);   // harmless test call
        } catch (\Throwable $e) {
            throw new \InvalidArgumentException('Razorpay rejected these keys: ' . $e->getMessage());
        }
        $fields = [
            'provider'            => 'razorpay',
            'razorpay_key_id'     => $keyId,
            'razorpay_key_secret' => self::encrypt($secret),
            'online_enabled'      => 1,
        ];
        $webhookSecret = trim($webhookSecret);
        if ($webhookSecret !== '') {
            $fields['razorpay_webhook_secret'] = self::encrypt($webhookSecret);
        }
        self::saveSettings($code, $fields, $by);

        return self::publicSettings($code);
    }

    /** Switch online payments on/off, optionally choosing the active provider. */
    public static function setEnabled(string $clientCode, bool $enabled, string $by, ?string $provider = null): array
    {
        $code = self::code($clientCode);
        $s    = self::settings($code);
        if ($provider !== null) {
            if (!in_array($provider, ['stripe', 'razorpay'], true)) {
                throw new \InvalidArgumentException('Unknown provider.');
            }
            $s['provider'] = $provider;
        }
        $s['online_enabled'] = $enabled ? 1 : 0;
        if ($enabled && !self::isAvailable($s)) {
            throw new \DomainException($s['provider'] === 'stripe'
                ? 'Finish connecting Stripe first.'
                : 'Save your Razorpay keys first.');
        }
        self::saveSettings($code, ['online_enabled' => $enabled ? 1 : 0, 'provider' => $s['provider']], $by);

        return self::publicSettings($code);
    }

    // ── Payments ────────────────────────────────────────────────────────────

    /**
     * Create a pay link for the given (server-computed) due items.
     *
     * @param array $items due rows from FeeApi::fetchStudentFeeDue (fee_id, fee_item_id, balance_due, …)
     * @return array{token:string, amount:float, currency:string, id:int}
     */
    public static function createPayment(string $clientCode, string $enrollmentId, array $items, array $student, string $payer, string $payerRole): array
    {
        $code = self::code($clientCode);
        $s    = self::settings($code);
        if (!self::isAvailable($s) || !self::providerAllowed((string)$s['provider'], self::schoolCountry($code))) {
            throw new \DomainException('Online payment is not available for this school.');
        }
        $clean = [];
        $total = 0.0;
        foreach ($items as $it) {
            $bal = round((float)($it['balance_due'] ?? 0), 2);
            if ($bal <= 0) {
                continue;
            }
            $clean[] = [
                'fee_id'           => (int)($it['fee_id'] ?? 0),
                'fee_item_id'      => (int)($it['fee_item_id'] ?? 0),
                'fee_item_name'    => (string)($it['fee_item_name'] ?? ''),
                'month_no'         => $it['month_no'] ?? null,
                'due_date'         => $it['due_date'] ?? null,
                'session_id'       => isset($it['session_id']) ? (int)$it['session_id'] : null,
                'class_id'         => isset($it['class_id']) ? (int)$it['class_id'] : null,
                'branch_id'        => isset($it['branch_id']) ? (int)$it['branch_id'] : null,
                'fee_amount'       => round((float)($it['fee_amount'] ?? 0), 2),
                'discount_percent' => round((float)($it['discount_percent'] ?? 0), 2),
                'discount_amount'  => round((float)($it['discount_amount'] ?? 0), 2),
                'discount_reason'  => (string)($it['discount_reason'] ?? ''),
                'tax_percent'      => round((float)($it['tax_percent'] ?? 0), 2),
                'tax_amount'       => round((float)($it['tax_amount'] ?? 0), 2),
                'net_fee_amount'   => round((float)($it['net_fee_amount'] ?? 0), 2),
                'balance_due'      => $bal,
            ];
            $total += $bal;
        }
        $total = round($total, 2);
        if ($clean === [] || $total <= 0) {
            throw new \DomainException('There is nothing due to pay.');
        }
        $currency = self::schoolCurrency($code);
        $token    = bin2hex(random_bytes(20));
        $conn     = self::db();
        $conn->execute(
            "INSERT INTO ssms_online_payments
                (pay_token, ssms_client_code, enrollment_id, registration_id, student_name,
                 provider, amount, currency, status, items_json, payer_user, payer_role, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, DATE_ADD(NOW(), INTERVAL " . self::LINK_DAYS . " DAY))",
            [
                $token, $code, $enrollmentId,
                isset($student['registration_id']) ? (string)$student['registration_id'] : null,
                mb_substr((string)($student['student_name'] ?? ''), 0, 150),
                $s['provider'], $total, $currency,
                json_encode($clean), mb_substr($payer, 0, 100), mb_substr($payerRole, 0, 30),
            ]
        );
        $id = (int)$conn->execute('SELECT id FROM ssms_online_payments WHERE pay_token = ?', [$token])->fetch('assoc')['id'];

        return ['token' => $token, 'amount' => $total, 'currency' => $currency, 'id' => $id];
    }

    public static function byToken(string $token): ?array
    {
        if (!preg_match('/^[a-f0-9]{40}$/', $token)) {
            return null;
        }
        $row = self::db()->execute(
            'SELECT p.*, (p.expires_at IS NOT NULL AND p.expires_at < NOW()) AS is_expired
               FROM ssms_online_payments p WHERE p.pay_token = ? LIMIT 1',
            [$token]
        )->fetch('assoc');

        return $row ?: null;
    }

    /** Stripe: create (or reuse) a Checkout Session on the school's account; returns its URL. */
    public static function stripeCheckoutUrl(string $token, string $successUrl, string $cancelUrl): string
    {
        $p = self::requirePending($token);
        $s = self::settings($p['ssms_client_code']);
        if ($p['provider'] !== 'stripe' || empty($s['stripe_account_id'])) {
            throw new \DomainException('This payment link is not a Stripe payment.');
        }
        $acct = (string)$s['stripe_account_id'];
        if (!empty($p['provider_ref'])) {
            $old = self::stripe('GET', 'checkout/sessions/' . rawurlencode((string)$p['provider_ref']), [], null, $acct);
            if (($old['payment_status'] ?? '') === 'paid') {
                self::confirmStripeSession($old, $acct);
                throw new \DomainException('This payment is already completed.');
            }
            if (($old['status'] ?? '') === 'open' && !empty($old['url'])) {
                return (string)$old['url'];
            }
        }
        $school = self::school($p['ssms_client_code']);
        $name   = 'School fees' . ($p['student_name'] ? ' – ' . $p['student_name'] : '');
        $sess   = self::stripe('POST', 'checkout/sessions', [
            'mode'                => 'payment',
            'success_url'         => $successUrl,
            'cancel_url'          => $cancelUrl,
            'client_reference_id' => $p['pay_token'],
            'metadata'            => ['pay_token' => $p['pay_token'], 'ssms_client_code' => $p['ssms_client_code'], 'enrollment_id' => (string)$p['enrollment_id']],
            'payment_intent_data' => [
                'description' => mb_substr($name . ' (' . ($school['ssms_client_header_text'] ?? $p['ssms_client_code']) . ')', 0, 250),
                'metadata'    => ['pay_token' => $p['pay_token'], 'enrollment_id' => (string)$p['enrollment_id']],
            ],
            'line_items' => [[
                'quantity'   => 1,
                'price_data' => [
                    'currency'     => strtolower((string)$p['currency']),
                    'unit_amount'  => self::toMinor((float)$p['amount'], (string)$p['currency']),
                    'product_data' => array_filter([
                        'name'        => mb_substr($name, 0, 120),
                        'description' => mb_substr(self::itemsSummary($p), 0, 300) ?: null,
                    ]),
                ],
            ]],
        ], 'checkout-' . $p['pay_token'] . '-' . time(), $acct);

        self::db()->execute('UPDATE ssms_online_payments SET provider_ref = ? WHERE id = ?', [(string)$sess['id'], (int)$p['id']]);

        return (string)$sess['url'];
    }

    /** Stripe: called on the return page – confirms if Stripe says paid. */
    public static function checkStripe(string $token): array
    {
        $p = self::byToken($token);
        if (!$p || $p['status'] !== 'pending' || $p['provider'] !== 'stripe' || empty($p['provider_ref'])) {
            return $p ?? [];
        }
        $s    = self::settings($p['ssms_client_code']);
        $sess = self::stripe('GET', 'checkout/sessions/' . rawurlencode((string)$p['provider_ref']), [], null, (string)$s['stripe_account_id']);
        if (($sess['payment_status'] ?? '') === 'paid') {
            self::confirmStripeSession($sess, (string)$s['stripe_account_id']);
        }

        return self::byToken($token) ?? [];
    }

    /** Stripe Connect webhook ("Events on connected accounts"). */
    public static function handleStripeWebhook(string $payload, string $sigHeader, ?string $secret = null): string
    {
        $secret = $secret ?? (string)(env('STRIPE_CONNECT_WEBHOOK_SECRET', '') ?: '');
        if ($secret === '') {
            throw new \RuntimeException('STRIPE_CONNECT_WEBHOOK_SECRET is not configured.');
        }
        $event = StripeClient::verifyWebhook($payload, $sigHeader, $secret);
        $type  = (string)($event['type'] ?? '');
        if (!in_array($type, ['checkout.session.completed', 'checkout.session.async_payment_succeeded'], true)) {
            return 'ignored:' . $type;
        }
        $sess = $event['data']['object'] ?? [];
        if (($sess['payment_status'] ?? '') !== 'paid') {
            return 'not_paid';
        }

        return self::confirmStripeSession($sess, (string)($event['account'] ?? '')) ? 'confirmed' : 'noop';
    }

    /** Razorpay: create (or reuse) the order; returns what checkout.js needs. */
    public static function razorpayOrder(string $token): array
    {
        $p = self::requirePending($token);
        $s = self::settings($p['ssms_client_code']);
        if ($p['provider'] !== 'razorpay' || empty($s['razorpay_key_id'])) {
            throw new \DomainException('This payment link is not a Razorpay payment.');
        }
        $minor = self::toMinor((float)$p['amount'], (string)$p['currency']);
        if (empty($p['provider_ref'])) {
            $order = self::razorpay('POST', 'orders', [
                'amount'   => $minor,
                'currency' => strtoupper((string)$p['currency']),
                'receipt'  => 'ONL' . $p['id'],
                'notes'    => ['pay_token' => $p['pay_token'], 'enrollment_id' => (string)$p['enrollment_id']],
            ], (string)$s['razorpay_key_id'], self::decrypt((string)$s['razorpay_key_secret']));
            self::db()->execute('UPDATE ssms_online_payments SET provider_ref = ? WHERE id = ?', [(string)$order['id'], (int)$p['id']]);
            $p['provider_ref'] = (string)$order['id'];
        }

        return [
            'keyId'    => (string)$s['razorpay_key_id'],
            'orderId'  => (string)$p['provider_ref'],
            'amount'   => $minor,
            'currency' => strtoupper((string)$p['currency']),
        ];
    }

    /** Razorpay checkout success callback: verify the signature, then confirm. */
    public static function verifyRazorpay(string $token, string $orderId, string $paymentId, string $signature): bool
    {
        $p = self::byToken($token);
        if (!$p || $p['provider'] !== 'razorpay' || $orderId === '' || $orderId !== (string)$p['provider_ref']) {
            throw new \DomainException('Payment details do not match this link.');
        }
        if ($p['status'] === 'paid') {
            return true;
        }
        $s      = self::settings($p['ssms_client_code']);
        $secret = self::decrypt((string)$s['razorpay_key_secret']);
        $expect = hash_hmac('sha256', $orderId . '|' . $paymentId, $secret);
        if (!hash_equals($expect, $signature)) {
            throw new \DomainException('Payment signature is not valid.');
        }
        $pay = self::razorpay('GET', 'payments/' . rawurlencode($paymentId), [], (string)$s['razorpay_key_id'], $secret);
        if (($pay['status'] ?? '') === 'authorized') {
            $pay = self::razorpay('POST', 'payments/' . rawurlencode($paymentId) . '/capture', [
                'amount' => (int)$pay['amount'], 'currency' => (string)$pay['currency'],
            ], (string)$s['razorpay_key_id'], $secret);
        }
        if (($pay['status'] ?? '') !== 'captured' || ($pay['order_id'] ?? '') !== $orderId) {
            throw new \DomainException('Razorpay has not confirmed this payment yet.');
        }
        self::confirm($p, $paymentId, (int)$pay['amount'], (string)$pay['currency']);

        return (self::byToken($token)['status'] ?? '') === 'paid';
    }

    /** Razorpay webhook (optional, per school): /pay/razorpay-webhook/{CODE} */
    public static function handleRazorpayWebhook(string $clientCode, string $payload, string $signature): string
    {
        $s = self::settings($clientCode);
        if (empty($s['razorpay_webhook_secret'])) {
            throw new \RuntimeException('Webhook secret not set for this school.');
        }
        $expect = hash_hmac('sha256', $payload, self::decrypt((string)$s['razorpay_webhook_secret']));
        if (!hash_equals($expect, $signature)) {
            throw new \DomainException('Bad webhook signature.');
        }
        $body  = json_decode($payload, true) ?: [];
        $event = (string)($body['event'] ?? '');
        if (!in_array($event, ['payment.captured', 'order.paid'], true)) {
            return 'ignored:' . $event;
        }
        $pay = $body['payload']['payment']['entity'] ?? [];
        if (($pay['status'] ?? '') !== 'captured' || empty($pay['order_id'])) {
            return 'not_captured';
        }
        $p = self::db()->execute(
            "SELECT * FROM ssms_online_payments WHERE provider = 'razorpay' AND provider_ref = ? AND ssms_client_code = ? LIMIT 1",
            [(string)$pay['order_id'], self::code($clientCode)]
        )->fetch('assoc');
        if (!$p) {
            return 'unknown_order';
        }

        return self::confirm($p, (string)$pay['id'], (int)$pay['amount'], (string)$pay['currency']) ? 'confirmed' : 'noop';
    }

    /** Payments of one school (for the admin screen). */
    public static function recent(string $clientCode, int $limit = 50): array
    {
        $limit = max(1, min(200, $limit));

        return self::db()->execute(
            "SELECT id, enrollment_id, student_name, provider, amount, currency, status, receipt_number,
                    payer_user, payer_role, created_at, paid_at, error
               FROM ssms_online_payments WHERE ssms_client_code = ?
              ORDER BY id DESC LIMIT {$limit}",
            [self::code($clientCode)]
        )->fetchAll('assoc');
    }

    // ── Confirmation + fee ledger ───────────────────────────────────────────

    private static function confirmStripeSession(array $sess, string $account): bool
    {
        $token = (string)($sess['metadata']['pay_token'] ?? $sess['client_reference_id'] ?? '');
        $p     = self::byToken($token);
        if (!$p || $p['provider'] !== 'stripe') {
            return false;
        }
        $s = self::settings($p['ssms_client_code']);
        if ($account !== '' && $account !== (string)$s['stripe_account_id']) {
            Log::warning("OnlinePayments: Stripe account mismatch for payment {$p['id']}");
            return false;
        }
        $paymentId = (string)($sess['payment_intent'] ?? $sess['id'] ?? '');

        return self::confirm($p, $paymentId, (int)($sess['amount_total'] ?? 0), (string)($sess['currency'] ?? ''));
    }

    /**
     * Mark paid exactly once and write the fee rows.
     * Returns true when THIS call recorded the payment (false = already done / mismatch).
     */
    public static function confirm(array $p, string $providerPaymentId, int $paidMinor, string $currency): bool
    {
        $expected = self::toMinor((float)$p['amount'], (string)$p['currency']);
        if ($paidMinor !== $expected || strtoupper($currency) !== strtoupper((string)$p['currency'])) {
            $msg = "Amount mismatch: paid {$paidMinor} {$currency}, expected {$expected} {$p['currency']}";
            Log::error("OnlinePayments #{$p['id']}: {$msg}");
            self::db()->execute(
                "UPDATE ssms_online_payments SET error = ? WHERE id = ? AND status = 'pending'",
                [$msg, (int)$p['id']]
            );
            return false;
        }

        $conn = self::db();
        $conn->begin();
        try {
            $receipt = 'ONL' . str_pad((string)$p['id'], 6, '0', STR_PAD_LEFT);
            $stmt = $conn->execute(
                "UPDATE ssms_online_payments
                    SET status = 'paid', provider_payment_id = ?, receipt_number = ?, paid_at = NOW(), error = NULL
                  WHERE id = ? AND status = 'pending'",
                [$providerPaymentId, $receipt, (int)$p['id']]
            );
            if ($stmt->rowCount() !== 1) {
                $conn->rollback();
                return false;                              // already confirmed by another path
            }
            self::writeLedger($p, $receipt);
            $conn->commit();
        } catch (\Throwable $e) {
            $conn->rollback();
            Log::error("OnlinePayments #{$p['id']}: could not record payment – " . $e->getMessage());
            throw $e;
        }

        return true;
    }

    /** Same rows as FeeApi::payStudentFees (full payment per item, no late fee). */
    private static function writeLedger(array $p, string $receipt): void
    {
        $items  = json_decode((string)$p['items_json'], true) ?: [];
        $method = $p['provider'] === 'stripe' ? 'Online - Stripe' : 'Online - Razorpay';
        $today  = Locale::today((string)$p['ssms_client_code']);   // the school's date, not the server's (UTC)
        $now    = date('Y-m-d H:i:s');
        foreach ($items as $it) {
            $allocate = round((float)$it['balance_due'], 2);
            if ($allocate <= 0) {
                continue;
            }
            $net = round((float)$it['fee_amount'] - (float)$it['discount_amount'], 2);
            $tax = round((float)$it['tax_amount'], 2);
            $proratedTax = ($net + $tax) > 0 && $tax > 0 ? round($tax * ($allocate / ($net + $tax)), 2) : 0.0;
            self::db()->execute(
                'INSERT INTO ssms_fee_paid_details
                    (enrollment_id, registration_id, fee_id, fee_item_id,
                     session_id, class_id, branch_id, ssms_client_code,
                     receipt_number, paid_amount, fee_paid_amount, late_fee,
                     discount_percent, discount_amount, discount_reason,
                     tax_percent, tax_amount,
                     payment_date, payment_method, admin_review, admin_user,
                     ssms_user_name, enrolled, created, modified)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [
                    (string)$p['enrollment_id'], $p['registration_id'] !== null ? (string)$p['registration_id'] : null,
                    (int)$it['fee_id'], (int)$it['fee_item_id'],
                    $it['session_id'], $it['class_id'], $it['branch_id'], (string)$p['ssms_client_code'],
                    $receipt, $allocate, round($allocate - $proratedTax, 2), 0,
                    (float)$it['discount_percent'], (float)$it['discount_amount'], (string)$it['discount_reason'],
                    (float)$it['tax_percent'], $proratedTax,
                    $today, $method, 'Pending', 'online',
                    (string)($p['payer_user'] ?? ''), 1, $now, $now,
                ]
            );
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    public static function toMinor(float $amount, string $currency): int
    {
        $cur = strtoupper($currency);
        if (in_array($cur, self::ZERO_DECIMAL, true)) {
            return (int)round($amount);
        }
        if (in_array($cur, self::THREE_DECIMAL, true)) {
            return (int)round($amount * 100) * 10;
        }

        return (int)round($amount * 100);
    }

    public static function itemsSummary(array $p): string
    {
        $names = array_map(fn($i) => (string)($i['fee_item_name'] ?? ''), json_decode((string)$p['items_json'], true) ?: []);

        return implode(', ', array_filter($names));
    }

    public static function school(string $clientCode): array
    {
        $row = self::db()->execute(
            'SELECT * FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1',
            [self::code($clientCode)]
        )->fetch('assoc');

        return $row ?: [];
    }

    /** School country (ISO-2, upper case) or '' when unknown / "Other". */
    public static function schoolCountry(string $clientCode): string
    {
        $c = strtoupper(trim((string)(self::school($clientCode)['country_code'] ?? '')));

        return preg_match('/^[A-Z]{2}$/', $c) && $c !== 'ZZ' ? $c : '';
    }

    public static function schoolCurrency(string $clientCode): string
    {
        $c = strtoupper(trim((string)(self::school($clientCode)['currency'] ?? '')));

        return preg_match('/^[A-Z]{3}$/', $c) ? $c : 'USD';
    }

    /** HMAC so public URLs (Stripe return/refresh) can't be forged for another school. */
    public static function sign(string $value): string
    {
        return substr(hash_hmac('sha256', $value, Security::getSalt() . '|pay'), 0, 32);
    }

    private static function requirePending(string $token): array
    {
        $p = self::byToken($token);
        if (!$p) {
            throw new \DomainException('Payment link not found.');
        }
        if ($p['status'] === 'paid') {
            throw new \DomainException('This payment is already completed.');
        }
        if ($p['status'] !== 'pending' || (int)$p['is_expired'] === 1) {
            throw new \DomainException('This payment link has expired. Please create a new one from the app.');
        }

        return $p;
    }

    private static function saveSettings(string $code, array $fields, string $by): void
    {
        $cols  = array_keys($fields);
        $place = implode(', ', array_fill(0, count($cols) + 2, '?'));
        $upd   = implode(', ', array_map(fn($c) => "{$c} = VALUES({$c})", array_merge($cols, ['updated_by'])));
        self::db()->execute(
            'INSERT INTO ssms_payment_settings (ssms_client_code, ' . implode(', ', $cols) . ', updated_by)
             VALUES (' . $place . ')
             ON DUPLICATE KEY UPDATE ' . $upd,
            array_merge([$code], array_values($fields), [mb_substr($by, 0, 100)])
        );
    }

    private static function encrypt(string $plain): string
    {
        return base64_encode(Security::encrypt($plain, self::encKey()));
    }

    private static function decrypt(string $stored): string
    {
        $raw = base64_decode($stored, true);
        $out = $raw !== false ? Security::decrypt($raw, self::encKey()) : null;
        if ($out === null || $out === false) {
            throw new \RuntimeException('Could not read the saved payment keys (security salt changed?). Please save them again.');
        }

        return (string)$out;
    }

    private static function encKey(): string
    {
        return hash('sha256', Security::getSalt() . '|online-payments');
    }

    private static function stripe(string $method, string $path, array $params = [], ?string $idem = null, ?string $account = null): array
    {
        if (is_callable(self::$stripeHttp)) {
            return (self::$stripeHttp)($method, $path, $params, $idem, $account);
        }

        return StripeClient::request($method, $path, $params, $idem, $account);
    }

    /** Stripe v2 API (accounts / account links). Test hook gets path 'v2/…'. */
    private static function stripe2(string $method, string $path, ?array $body = null, array $query = [], ?string $idem = null): array
    {
        if (is_callable(self::$stripeHttp)) {
            return (self::$stripeHttp)($method, 'v2/' . ltrim($path, '/'), $body ?? $query, $idem, null);
        }

        return StripeClient::requestV2($method, $path, $body, $query, $idem);
    }

    private static function razorpay(string $method, string $path, array $params, string $keyId, string $secret): array
    {
        if (is_callable(self::$razorpayHttp)) {
            return (self::$razorpayHttp)($method, $path, $params, $keyId, $secret);
        }
        $url     = 'https://api.razorpay.com/v1/' . ltrim($path, '/');
        $ch      = curl_init();
        $headers = ['Accept: application/json'];
        if ($method === 'GET') {
            curl_setopt($ch, CURLOPT_URL, $params ? $url . '?' . http_build_query($params) : $url);
        } else {
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($params ?: new \stdClass()));
            $headers[] = 'Content-Type: application/json';
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => $keyId . ':' . $secret,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 30,
        ]);
        $raw    = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err    = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new \RuntimeException('Razorpay request failed: ' . $err);
        }
        $data = json_decode((string)$raw, true);
        if (!is_array($data)) {
            throw new \RuntimeException("Razorpay returned an invalid response (HTTP {$status}).");
        }
        if ($status >= 400) {
            throw new \RuntimeException((string)($data['error']['description'] ?? "HTTP {$status}"));
        }

        return $data;
    }

    private static function code(string $c): string
    {
        return strtoupper(trim($c));
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
