<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Utility\Security;

/**
 * Automatic notifications – phase 2: SMS and WhatsApp.
 *
 * - Paid add-on: the school needs the 'messaging' feature (Entitlements).
 * - Each school connects SMS and/or WhatsApp with its OWN provider account (keys entered in
 *   Setup › Notifications, stored encrypted, never sent back to the app), or uses ManageMyAcademy's
 *   account (set up by the platform with `bin/cake notify_platform`, with a monthly allowance per school).
 * - Notify queues one SMS / WhatsApp per family phone next to the push / e-mail; deliver() sends them:
 *     · "only if not read in the app" (default): waits N minutes and is skipped when the family read it;
 *     · SMS waits for WhatsApp and is skipped when WhatsApp reached the number;
 *     · quiet hours (country default, school can change) for non-urgent messages;
 *     · STOP replies, parents' own choices, optional written consent;
 *     · monthly limit / allowance with a warning to the office at 80 % and a stop at 100 %.
 * - Texts: a standard text per message kind in each language (the school may use its own wording);
 *   India DLT template IDs and WhatsApp template names / IDs per kind and language.
 * - Delivery reports and replies arrive at /hooks/notify/{provider}/{school}/{key}.
 *
 * Tables: ssms_notify_channels, ssms_notify_templates, ssms_notify_optouts, ssms_notify_platform (+ outbox columns)
 */
final class Messaging
{
    public const CHANNELS = ['sms', 'whatsapp'];
    public const MODES = ['off', 'own', 'managed'];

    /** kind => [event, title (as in the app), standard text, urgent] */
    public const KINDS = [
        'absence'       => ['absence', 'Absent today', 'From {school}: {student} was marked absent today ({date}).', true],
        'absence_fix'   => ['absence', 'Attendance corrected', 'From {school}: correction - {student} is not absent today ({date}). Please ignore the earlier message.', true],
        'late'          => ['arrival', 'Late arrival', 'From {school}: {student} arrived late today ({time}).', true],
        'early'         => ['arrival', 'Early pick-up', 'From {school}: {student} was picked up early today ({time}).', true],
        'pickup'        => ['arrival', 'Collected from school', 'From {school}: {student} was collected at {time} by {person}.', true],
        'homework'      => ['homework', 'New homework', 'From {school}: new homework for {student} in {subject}: "{title}".', false],
        'homework_day'  => ['homework', "Today's homework", "From {school}: today's homework for {student}: {subjects}. Details in the app.", false],
        'notice'        => ['notice', 'New notice', 'New notice from {school}: "{title}". Please read it in the app.', false],
        'notice_remind' => ['notice', 'Reminder: please read this notice', 'Reminder from {school}: please read the notice "{title}" in the app.', false],
        'fee_soon'      => ['fee_due', 'Fee due soon', 'From {school}: the fee of {amount} for {student} is due on {date}. Please pay on time.', false],
        'fee_today'     => ['fee_due', 'Fee due today', 'From {school}: the fee of {amount} for {student} is due today.', false],
        'fee_overdue'   => ['fee_due', 'Fee overdue', 'From {school}: the fee of {amount} for {student} is overdue since {date}. Please pay in the app or at the school office.', false],
        'results'       => ['results', 'Report card published', 'From {school}: the {name} report card for {student} is ready in the app.', false],
    ];

    private const OPTOUT_LINE = 'Reply STOP to opt out.';
    private const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'arret', 'arrêt', 'baja', 'parar', 'توقف', 'إيقاف', 'بند', 'روکیں', 'रोकें', 'बंद'];
    private const START_WORDS = ['start', 'unstop', 'subscribe'];

    private static array $cache = [];

    // ── Paid add-on ────────────────────────────────────────────────────────

    /** The school has the "SMS & WhatsApp messages" add-on (subscription feature, or product module for legacy schools). */
    public static function allowed(string $client): bool
    {
        $k = 'allowed|' . $client;
        if (array_key_exists($k, self::$cache)) {
            return self::$cache[$k];
        }
        try {
            $ent = Entitlements::forClient($client);
            $ok = Entitlements::isSubscription($ent) ? in_array('messaging', $ent['features'] ?? [], true) : in_array('messaging', $ent['modules'] ?? [], true);
        } catch (\Throwable $e) {
            $ok = false;
        }

        return self::$cache[$k] = $ok;
    }

    public static function resetCache(): void
    {
        self::$cache = [];
    }

    // ── Connection (per school and channel) ────────────────────────────────

    private static function row(string $client, string $channel): ?array
    {
        try {
            $r = self::db()->execute('SELECT * FROM ssms_notify_channels WHERE ssms_client_code = ? AND channel = ?', [$client, $channel])->fetch('assoc');

            return $r ?: null;
        } catch (\Throwable $e) {
            return null;   // phase-2 migration not run yet
        }
    }

    public static function platform(string $channel): ?array
    {
        try {
            $r = self::db()->execute('SELECT * FROM ssms_notify_platform WHERE channel = ?', [$channel])->fetch('assoc');
            if (!$r || !MessagingProviders::supports((string)$r['provider'], $channel)) {
                return null;
            }
            $r['cfg'] = self::decryptCfg((string)$r['config']);

            return $r;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * What sending on this channel uses right now, or null when it cannot send:
     * provider, cfg, sender, via (own|managed), limit (null = none), cost, currency, quiet, consent, sms_after_whatsapp, rules
     */
    public static function conn(string $client, string $channel): ?array
    {
        $k = 'conn|' . $client . '|' . $channel;
        if (array_key_exists($k, self::$cache)) {
            return self::$cache[$k];
        }
        $out = null;
        $r = self::row($client, $channel);
        if ($r && self::allowed($client) && in_array($r['mode'], ['own', 'managed'], true)) {
            $rules = MessagingCountries::rules(self::country($client));
            $base = ['quiet' => [$r['quiet_start'] ?: $rules['quiet'][0], $r['quiet_end'] ?: $rules['quiet'][1]],
                     'consent' => $r['consent_required'] === null ? (bool)$rules['consent'] : (bool)$r['consent_required'],
                     'sms_after_whatsapp' => (bool)$r['sms_after_whatsapp'], 'rules' => $rules, 'row' => $r];
            if ($r['mode'] === 'own' && $r['provider'] && MessagingProviders::supports((string)$r['provider'], $channel) && $r['status'] !== 'error') {
                $cfg = self::decryptCfg((string)$r['config']);
                if (self::complete((string)$r['provider'], $cfg)) {
                    $out = $base + ['provider' => (string)$r['provider'], 'cfg' => $cfg, 'sender' => (string)$r['sender'], 'via' => 'own',
                        'limit' => $r['monthly_limit'] !== null ? (int)$r['monthly_limit'] : null,
                        'cost' => $r['cost_per_message'] !== null ? (float)$r['cost_per_message'] : null, 'currency' => (string)$r['currency']];
                }
            } elseif ($r['mode'] === 'managed' && ($p = self::platform($channel))) {
                $out = $base + ['provider' => (string)$p['provider'], 'cfg' => $p['cfg'], 'sender' => (string)$p['sender'], 'via' => 'managed',
                    'limit' => $r['managed_allowance'] !== null ? (int)$r['managed_allowance'] : (int)$p['default_allowance'],
                    'cost' => $p['cost_per_message'] !== null ? (float)$p['cost_per_message'] : null, 'currency' => (string)$p['currency']];
            }
        }

        return self::$cache[$k] = $out;
    }

    public static function active(string $client, string $channel): bool
    {
        return self::conn($client, $channel) !== null;
    }

    private static function complete(string $provider, array $cfg): bool
    {
        foreach (MessagingProviders::LIST[$provider]['fields'] as [$key, , , $required]) {
            if ($required && trim((string)($cfg[$key] ?? '')) === '') {
                return false;
            }
        }

        return true;
    }

    /** Both channels for Setup › Notifications › Messaging (no secrets). */
    public static function channels(string $client): array
    {
        $rules = MessagingCountries::rules(self::country($client));
        $out = ['allowed' => self::allowed($client), 'country' => $rules['country'], 'rules' => $rules, 'channels' => [], 'providers' => []];
        foreach (MessagingProviders::LIST as $key => $p) {
            $out['providers'][] = ['key' => $key, 'name' => $p['name'], 'channels' => $p['channels'], 'template' => $p['template'],
                'fields' => array_map(fn($f) => ['key' => $f[0], 'label' => $f[1], 'secret' => $f[2], 'required' => $f[3], 'help' => $f[4]], $p['fields'])];
        }
        foreach (self::CHANNELS as $ch) {
            $out['channels'][$ch] = self::channelView($client, $ch, $rules);
        }

        return $out;
    }

    private static function channelView(string $client, string $ch, array $rules): array
    {
        $r = self::row($client, $ch) ?? [];
        $provider = (string)($r['provider'] ?? '');
        $cfg = $provider !== '' ? self::decryptCfg((string)($r['config'] ?? '')) : [];
        $fields = [];
        foreach (MessagingProviders::LIST[$provider]['fields'] ?? [] as [$key, , $secret]) {
            $fields[$key] = $secret ? '' : (string)($cfg[$key] ?? '');
            if ($secret) {
                $fields[$key . '__saved'] = trim((string)($cfg[$key] ?? '')) !== '';
            }
        }
        $p = self::platform($ch);
        $conn = self::conn($client, $ch);
        $via = $conn['via'] ?? ((string)($r['mode'] ?? 'off'));

        return [
            'channel' => $ch, 'mode' => (string)($r['mode'] ?? 'off'), 'provider' => $provider, 'fields' => (object)$fields,
            'sender' => (string)($r['sender'] ?? ''), 'status' => (string)($r['status'] ?? 'new'), 'last_error' => $r['last_error'] ?? null,
            'tested_at' => isset($r['tested_at']) ? self::local($client, $r['tested_at']) : null, 'active' => $conn !== null,
            'monthly_limit' => isset($r['monthly_limit']) ? (int)$r['monthly_limit'] : null,
            'cost_per_message' => isset($r['cost_per_message']) ? (float)$r['cost_per_message'] : null, 'currency' => (string)($r['currency'] ?? ''),
            'quiet_start' => $r['quiet_start'] ?? null, 'quiet_end' => $r['quiet_end'] ?? null, 'quiet_default' => $rules['quiet'],
            'consent_required' => isset($r['consent_required']) && $r['consent_required'] !== null ? (bool)$r['consent_required'] : null, 'consent_default' => (bool)$rules['consent'],
            'sms_after_whatsapp' => isset($r['sms_after_whatsapp']) ? (bool)$r['sms_after_whatsapp'] : true,
            'managed_available' => $p !== null, 'managed_provider' => $p ? MessagingProviders::LIST[$p['provider']]['name'] : null,
            'allowance' => $p ? (isset($r['managed_allowance']) ? (int)$r['managed_allowance'] : (int)$p['default_allowance']) : null,
            'used' => self::used($client, $ch, $via === 'managed' ? 'managed' : 'own'),
            'hook_url' => $provider !== '' && ($r['mode'] ?? '') === 'own' ? self::hookUrl($client, $provider) : null,
            'verify_token' => self::hookKey($client),
            'recommended' => $rules[$ch] ?? [],
        ];
    }

    public static function saveChannel(string $client, string $channel, array $d, string $by): array
    {
        if (!in_array($channel, self::CHANNELS, true)) {
            throw new \DomainException('Unknown channel.');
        }
        if (!self::allowed($client)) {
            throw new \DomainException('SMS and WhatsApp messages are a paid add-on. Ask ManageMyAcademy to switch them on for your school.');
        }
        $old = self::row($client, $channel) ?? [];
        $mode = (string)($d['mode'] ?? $old['mode'] ?? 'off');
        if (!in_array($mode, self::MODES, true)) {
            throw new \DomainException('Choose how to send: off, your own account or ManageMyAcademy.');
        }
        $provider = (string)($d['provider'] ?? $old['provider'] ?? '');
        $cfg = $provider !== '' && $provider === ($old['provider'] ?? '') ? self::decryptCfg((string)($old['config'] ?? '')) : [];
        if ($mode === 'own') {
            if (!isset(MessagingProviders::LIST[$provider]) || !MessagingProviders::supports($provider, $channel)) {
                throw new \DomainException('Choose a provider for this channel.');
            }
            foreach (MessagingProviders::LIST[$provider]['fields'] as [$key, $label, $secret, $required]) {
                $v = isset($d['fields'][$key]) ? trim((string)$d['fields'][$key]) : null;
                if ($v !== null && !($secret && $v === '')) {
                    $cfg[$key] = mb_substr($v, 0, 2000);   // a secret left empty keeps the saved one
                }
                if ($required && trim((string)($cfg[$key] ?? '')) === '') {
                    throw new \DomainException(Locale::t($client, 'Please fill in "{field}".', ['field' => Locale::t($client, $label)]));
                }
            }
        } elseif ($mode === 'managed' && !self::platform($channel)) {
            throw new \DomainException("ManageMyAcademy's account is not available for this channel yet. Please use your own provider account.");
        }
        $sender = $mode === 'own' ? mb_substr(trim((string)($d['sender'] ?? $old['sender'] ?? '')), 0, 40) : '';   // ManageMyAcademy's account: its own sender
        if ($mode === 'own' && $sender === '' && !($provider === 'twilio' && $channel === 'sms' && trim((string)($cfg['messaging_service_sid'] ?? '')) !== '')
            && !in_array($provider, ['msg91', 'whapi', 'africastalking', 'meta', 'generic'], true)) {
            throw new \DomainException($channel === 'whatsapp' ? 'Enter the WhatsApp number messages are sent from.' : 'Enter the sender ID or number.');
        }
        $num = function ($v, int $min, int $max, string $msg) {
            if ($v === null || $v === '') {
                return null;
            }
            if (!is_numeric($v) || $v < $min || $v > $max) {
                throw new \DomainException($msg);
            }

            return $v;
        };
        $limit = $num($d['monthly_limit'] ?? $old['monthly_limit'] ?? null, 0, 10000000, 'The monthly limit must be a number of messages.');
        $cost = $num($d['cost_per_message'] ?? $old['cost_per_message'] ?? null, 0, 1000, 'The cost per message must be a number.');
        $time = function ($v) {
            if ($v === null || $v === '') {
                return null;
            }
            if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) {
                throw new \DomainException('Please give the time as HH:MM, e.g. 17:00.');
            }

            return $v;
        };
        $qs = $time(array_key_exists('quiet_start', $d) ? $d['quiet_start'] : ($old['quiet_start'] ?? null));
        $qe = $time(array_key_exists('quiet_end', $d) ? $d['quiet_end'] : ($old['quiet_end'] ?? null));
        $consent = array_key_exists('consent_required', $d) ? ($d['consent_required'] === null || $d['consent_required'] === '' ? null : (int)filter_var($d['consent_required'], FILTER_VALIDATE_BOOLEAN))
            : ($old['consent_required'] ?? null);
        $after = array_key_exists('sms_after_whatsapp', $d) ? (int)filter_var($d['sms_after_whatsapp'], FILTER_VALIDATE_BOOLEAN) : (int)($old['sms_after_whatsapp'] ?? 1);
        $changedKeys = $mode !== ($old['mode'] ?? 'off') || $provider !== (string)($old['provider'] ?? '') || self::decryptCfg((string)($old['config'] ?? '')) != $cfg
            || $sender !== (string)($old['sender'] ?? '');
        self::db()->execute('INSERT INTO ssms_notify_channels (ssms_client_code, channel, mode, provider, config, sender, status, last_error, monthly_limit, cost_per_message, currency,
                quiet_start, quiet_end, consent_required, sms_after_whatsapp, updated_by, modified)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE mode = VALUES(mode), provider = VALUES(provider), config = VALUES(config), sender = VALUES(sender),
                status = IF(?, VALUES(status), status), last_error = IF(?, NULL, last_error), monthly_limit = VALUES(monthly_limit), cost_per_message = VALUES(cost_per_message),
                currency = VALUES(currency), quiet_start = VALUES(quiet_start), quiet_end = VALUES(quiet_end), consent_required = VALUES(consent_required),
                sms_after_whatsapp = VALUES(sms_after_whatsapp), updated_by = VALUES(updated_by), modified = VALUES(modified)',
            [$client, $channel, $mode, $provider ?: null, $mode === 'own' ? self::encryptCfg($cfg) : ($old['config'] ?? null), $sender ?: null,
             $mode === 'off' ? 'new' : ($mode === 'managed' ? 'connected' : 'new'), null,
             $limit !== null ? (int)$limit : null, $cost !== null ? (float)$cost : null, mb_substr(strtoupper(trim((string)($d['currency'] ?? $old['currency'] ?? ''))), 0, 5) ?: null,
             $qs, $qe, $consent, $after, $by, self::now(), (int)$changedKeys, (int)$changedKeys]);
        self::resetCache();
        if ($consent ?? MessagingCountries::rules(self::country($client))['consent']) {
            self::ensureConsentType($client);   // also when the country's default asks for consent
        }
        $res = ['channel' => self::channelView($client, $channel, MessagingCountries::rules(self::country($client))), 'changed' => $changedKeys];
        if ($mode === 'own' && $changedKeys) {
            $res['test'] = self::testChannel($client, $channel);
            $res['channel'] = self::channelView($client, $channel, MessagingCountries::rules(self::country($client)));
        }

        return $res;
    }

    /** Check the keys with the provider (no message is sent). */
    public static function testChannel(string $client, string $channel): array
    {
        $r = self::row($client, $channel);
        if (!$r || $r['mode'] === 'off') {
            throw new \DomainException('This channel is switched off.');
        }
        if ($r['mode'] === 'managed') {
            return ['ok' => self::platform($channel) !== null, 'error' => null, 'info' => 'ManageMyAcademy'];
        }
        $t = MessagingProviders::test((string)$r['provider'], $channel, self::decryptCfg((string)$r['config']));
        self::db()->execute('UPDATE ssms_notify_channels SET status = ?, last_error = ?, tested_at = ? WHERE ssms_client_code = ? AND channel = ?',
            [$t['ok'] ? 'connected' : 'error', $t['ok'] ? null : mb_substr((string)$t['error'], 0, 250), self::now(), $client, $channel]);
        self::resetCache();

        return $t;
    }

    /** Send a real sample message (absence, school language) to a number – counts towards the limit. Five an hour. */
    public static function testSend(string $client, string $channel, string $to, string $by): array
    {
        $conn = self::conn($client, $channel);
        if (!$conn) {
            throw new \DomainException('Connect this channel first.');
        }
        $phone = MessagingCountries::e164($to, self::country($client));
        if (!$phone) {
            throw new \DomainException('Please enter a valid mobile number, with the country code.');
        }
        $hour = substr(self::now(), 0, 13);
        $n = (int)(self::db()->execute("SELECT COUNT(*) n FROM ssms_notify_outbox WHERE ssms_client_code = ? AND event = 'test' AND created >= ?", [$client, $hour . ':00:00'])->fetch('assoc')['n'] ?? 0);
        if ($n >= 5) {
            throw new \DomainException('Five test messages an hour at most. Please try again later.');
        }
        $lang = Locale::langFor($client, null);
        $vars = Locale::withLang($lang, fn() => ['student' => Locale::t($client, 'Test Student'), 'date' => Locale::date($client, Locale::today($client), 'medium')]);
        $data = ['kind' => 'absence', 'vars' => $vars, 'test' => 1];
        $ref = 'test:' . $channel . ':' . $phone . ':' . str_replace([' ', ':', '-'], '', self::now()) . ':' . bin2hex(random_bytes(3));
        $c = self::compose($client, $channel, 'absence', $vars, $lang, $conn);
        if ($c['error']) {
            throw new \DomainException($c['error']);
        }
        self::db()->execute('INSERT INTO ssms_notify_outbox (ssms_client_code, event, ref, channel, username, address, enrollment_id, lang, title, body, data, status, send_after, created)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$client, 'test', $ref, $channel, $by, $phone, null, $lang, 'Test', $c['text'], json_encode($data), 'sending', self::now(), self::now()]);
        $id = (int)self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'];
        self::deliverRows($client, self::q('SELECT * FROM ssms_notify_outbox WHERE id = ?', [$id]));
        $row = self::db()->execute('SELECT status, error, provider_id FROM ssms_notify_outbox WHERE id = ?', [$id])->fetch('assoc');

        return ['ok' => $row['status'] === 'sent', 'status' => $row['status'], 'error' => $row['error'], 'text' => $c['text'], 'to' => MessagingCountries::mask($phone)];
    }

    // ── ManageMyAcademy's account (platform) ───────────────────────────────

    public static function setPlatform(string $channel, string $provider, array $cfg, string $sender, ?int $defaultAllowance, ?float $cost, string $currency): void
    {
        if (!MessagingProviders::supports($provider, $channel)) {
            throw new \DomainException("$provider does not send $channel.");
        }
        if (!self::complete($provider, $cfg)) {
            throw new \DomainException('Some required fields are missing.');
        }
        self::db()->execute('INSERT INTO ssms_notify_platform (channel, provider, config, sender, default_allowance, cost_per_message, currency, modified) VALUES (?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE provider = VALUES(provider), config = VALUES(config), sender = VALUES(sender), default_allowance = VALUES(default_allowance),
            cost_per_message = VALUES(cost_per_message), currency = VALUES(currency), modified = VALUES(modified)',
            [$channel, $provider, self::encryptCfg($cfg), $sender ?: null, (int)($defaultAllowance ?? 0), $cost, $currency ?: null, self::now()]);
        self::resetCache();
    }

    public static function setAllowance(string $client, string $channel, ?int $allowance): void
    {
        self::db()->execute("INSERT INTO ssms_notify_channels (ssms_client_code, channel, mode, managed_allowance, modified) VALUES (?,?,'off',?,?)
            ON DUPLICATE KEY UPDATE managed_allowance = VALUES(managed_allowance), stopped_month = NULL, warned_month = NULL", [$client, $channel, $allowance, self::now()]);
        self::resetCache();
    }

    // ── Platform owner (superuser web page /admin/messaging) ───────────────

    /** ManageMyAcademy's accounts for the web page: no secrets, only "saved". */
    public static function platformView(): array
    {
        $out = [];
        foreach (self::CHANNELS as $ch) {
            $p = null;
            try {
                $p = self::db()->execute('SELECT * FROM ssms_notify_platform WHERE channel = ?', [$ch])->fetch('assoc') ?: null;
            } catch (\Throwable $e) {
            }
            $provider = (string)($p['provider'] ?? '');
            $cfg = $p ? self::decryptCfg((string)$p['config']) : [];
            $fields = [];
            foreach (MessagingProviders::LIST[$provider]['fields'] ?? [] as [$key, , $secret]) {
                $fields[$key] = $secret ? '' : (string)($cfg[$key] ?? '');
                $fields[$key . '__saved'] = trim((string)($cfg[$key] ?? '')) !== '';
            }
            $out[$ch] = ['channel' => $ch, 'set' => $p !== null, 'provider' => $provider, 'fields' => $fields, 'sender' => (string)($p['sender'] ?? ''),
                'default_allowance' => (int)($p['default_allowance'] ?? 0), 'cost_per_message' => $p['cost_per_message'] ?? null, 'currency' => (string)($p['currency'] ?? ''),
                'modified' => $p['modified'] ?? null, 'hook_url' => $provider !== '' ? self::hookUrl('platform', $provider) : null, 'verify_token' => self::hookKey('platform')];
        }

        return $out;
    }

    /** Save ManageMyAcademy's account for a channel; secret fields left empty keep the saved value. */
    public static function savePlatform(string $channel, array $d): void
    {
        if (!in_array($channel, self::CHANNELS, true)) {
            throw new \DomainException('Unknown channel.');
        }
        $provider = (string)($d['provider'] ?? '');
        if (!isset(MessagingProviders::LIST[$provider]) || !MessagingProviders::supports($provider, $channel)) {
            throw new \DomainException('Choose a provider that sends ' . ($channel === 'sms' ? 'SMS' : 'WhatsApp') . '.');
        }
        $old = self::platform($channel);
        $cfg = $old && $old['provider'] === $provider ? (array)$old['cfg'] : [];
        foreach (MessagingProviders::LIST[$provider]['fields'] as [$key, $label, $secret, $required]) {
            $v = isset($d['fields'][$key]) ? trim((string)$d['fields'][$key]) : null;
            if ($v !== null && !($secret && $v === '')) {
                $cfg[$key] = mb_substr($v, 0, 2000);
            }
            if ($required && trim((string)($cfg[$key] ?? '')) === '') {
                throw new \DomainException('Please fill in "' . $label . '".');
            }
        }
        $allow = trim((string)($d['default_allowance'] ?? '0'));
        if (!ctype_digit($allow)) {
            throw new \DomainException('The default allowance must be a whole number of messages.');
        }
        $cost = trim((string)($d['cost_per_message'] ?? ''));
        if ($cost !== '' && (!is_numeric($cost) || $cost < 0)) {
            throw new \DomainException('The price per message must be a number.');
        }
        self::setPlatform($channel, $provider, $cfg, mb_substr(trim((string)($d['sender'] ?? '')), 0, 40), (int)$allow, $cost === '' ? null : (float)$cost,
            mb_substr(strtoupper(trim((string)($d['currency'] ?? ''))), 0, 5));
    }

    public static function testPlatform(string $channel): array
    {
        $p = self::platform($channel);
        if (!$p) {
            throw new \DomainException('Set up this channel first.');
        }

        return MessagingProviders::test((string)$p['provider'], $channel, (array)$p['cfg']);
    }

    public static function removePlatform(string $channel): void
    {
        self::db()->execute('DELETE FROM ssms_notify_platform WHERE channel = ?', [$channel]);
        self::resetCache();
    }

    /** Switch the paid add-on on / off: subscription schools a plan feature, Indian (legacy) schools a product module. */
    public static function setAddon(string $client, bool $on, string $by): void
    {
        $r = self::db()->execute('SELECT billing_model FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc');
        if (!$r) {
            throw new \DomainException('School not found.');
        }
        $sub = strtolower(trim((string)$r['billing_model'])) === 'subscription';
        if ($sub) {
            $on ? self::db()->execute("INSERT INTO ssms_client_features (ssms_client_code, feature_key, source, expires_at) VALUES (?, 'messaging', 'manual', NULL)
                    ON DUPLICATE KEY UPDATE source = 'manual', expires_at = NULL", [$client])
                : self::db()->execute("DELETE FROM ssms_client_features WHERE ssms_client_code = ? AND feature_key = 'messaging'", [$client]);
        } else {
            $on ? self::db()->execute("INSERT INTO ssms_client_modules (ssms_client_code, module_key, granted_at, granted_by)
                    SELECT ?, 'messaging', NOW(), ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ssms_client_modules WHERE ssms_client_code = ? AND module_key = 'messaging')", [$client, $by, $client])
                : self::db()->execute("DELETE FROM ssms_client_modules WHERE ssms_client_code = ? AND module_key = 'messaging'", [$client]);
        }
        Entitlements::clear($client);
        self::resetCache();
    }

    /**
     * Let a school send through ManageMyAcademy's account (the school does not enter any keys), or stop it.
     * $allowance: messages per month, null = the platform default. Switching off returns the channel to "off"
     * (a school's own account is left alone).
     */
    public static function setSchoolManaged(string $client, string $channel, bool $on, ?int $allowance, string $by): void
    {
        if (!in_array($channel, self::CHANNELS, true)) {
            throw new \DomainException('Unknown channel.');
        }
        if ($on && !self::platform($channel)) {
            throw new \DomainException("Set up ManageMyAcademy's " . ($channel === 'sms' ? 'SMS' : 'WhatsApp') . ' account first.');
        }
        $old = self::row($client, $channel);
        if ($on) {
            self::db()->execute("INSERT INTO ssms_notify_channels (ssms_client_code, channel, mode, status, managed_allowance, updated_by, modified) VALUES (?,?,'managed','connected',?,?,?)
                ON DUPLICATE KEY UPDATE mode = 'managed', status = 'connected', last_error = NULL, managed_allowance = VALUES(managed_allowance),
                stopped_month = NULL, warned_month = NULL, updated_by = VALUES(updated_by), modified = VALUES(modified)", [$client, $channel, $allowance, $by, self::now()]);
        } else {
            if ($old && $old['mode'] === 'managed') {
                self::db()->execute("UPDATE ssms_notify_channels SET mode = 'off', updated_by = ?, modified = ? WHERE ssms_client_code = ? AND channel = ?", [$by, self::now(), $client, $channel]);
            }
            self::setAllowance($client, $channel, $allowance);
        }
        self::resetCache();
    }

    /** Every school for the platform page: add-on, how each channel sends, allowance, use and cost this month. */
    public static function schoolsOverview(string $search = ''): array
    {
        $w = '';
        $p = [];
        if ($search !== '') {
            $w = 'WHERE c.ssms_client_code LIKE ? OR c.ssms_client_header_text LIKE ? OR c.ssms_client_name LIKE ?';
            $p = ['%' . $search . '%', '%' . $search . '%', '%' . $search . '%'];
        }
        $schools = self::q("SELECT c.ssms_client_code code, COALESCE(NULLIF(c.ssms_client_header_text,''), c.ssms_client_name, c.ssms_client_code) name, c.billing_model,
                c.country_code FROM ssms_clients c $w ORDER BY c.ssms_client_code LIMIT 500", $p);
        $chan = [];
        try {
            foreach (self::q('SELECT ssms_client_code, channel, mode, provider, managed_allowance FROM ssms_notify_channels', []) as $r) {
                $chan[$r['ssms_client_code']][$r['channel']] = $r;
            }
        } catch (\Throwable $e) {
        }
        $use = [];
        try {
            foreach (self::q("SELECT ssms_client_code, channel, via, COALESCE(SUM(COALESCE(segments,1)),0) n, COALESCE(SUM(cost),0) cost FROM ssms_notify_outbox
                    WHERE channel IN ('sms','whatsapp') AND sent_at >= ? GROUP BY ssms_client_code, channel, via", [substr(self::now(), 0, 7) . '-01 00:00:00']) as $r) {
                $use[$r['ssms_client_code']][$r['channel']][$r['via']] = ['n' => (int)$r['n'], 'cost' => (float)$r['cost']];
            }
        } catch (\Throwable $e) {
        }
        $plat = [];
        foreach (self::CHANNELS as $ch) {
            $plat[$ch] = self::platform($ch);
        }
        $out = [];
        foreach ($schools as $s) {
            $code = (string)$s['code'];
            $row = ['code' => $code, 'name' => (string)$s['name'], 'billing' => strtolower((string)$s['billing_model']) === 'subscription' ? 'subscription' : 'legacy',
                'country' => (string)$s['country_code'], 'addon' => self::allowed($code), 'channels' => []];
            foreach (self::CHANNELS as $ch) {
                $c = $chan[$code][$ch] ?? null;
                $row['channels'][$ch] = ['mode' => (string)($c['mode'] ?? 'off'), 'provider' => (string)($c['provider'] ?? ''),
                    'allowance' => $c && $c['managed_allowance'] !== null ? (int)$c['managed_allowance'] : null,
                    'effective_allowance' => $c && $c['managed_allowance'] !== null ? (int)$c['managed_allowance'] : (int)($plat[$ch]['default_allowance'] ?? 0),
                    'used_managed' => $use[$code][$ch]['managed']['n'] ?? 0, 'cost_managed' => round($use[$code][$ch]['managed']['cost'] ?? 0, 2),
                    'used_own' => $use[$code][$ch]['own']['n'] ?? 0];
            }
            $out[] = $row;
        }

        return $out;
    }

    /** One school: this and the last 5 months on ManageMyAcademy's account. */
    public static function schoolHistory(string $client): array
    {
        $out = [];
        try {
            foreach (self::q("SELECT DATE_FORMAT(sent_at, '%Y-%m') m, channel, via, COALESCE(SUM(COALESCE(segments,1)),0) n, COALESCE(SUM(cost),0) cost
                    FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel IN ('sms','whatsapp') AND sent_at >= ?
                    GROUP BY DATE_FORMAT(sent_at, '%Y-%m'), channel, via ORDER BY m DESC", [$client, date('Y-m-01 00:00:00', strtotime(substr(self::now(), 0, 7) . '-01 -5 months'))]) as $r) {
                $out[$r['m']][$r['channel']][$r['via']] = ['n' => (int)$r['n'], 'cost' => round((float)$r['cost'], 2)];
            }
        } catch (\Throwable $e) {
        }

        return $out;
    }

    // ── Texts ──────────────────────────────────────────────────────────────

    /** Placeholders of a text in order: "{student} … {date}" → ['student', 'date'] (each use, also repeated ones, when $all) */
    public static function placeholders(string $text, bool $all = false): array
    {
        preg_match_all('/\{(\w+)\}/', $text, $m);

        return $all ? $m[1] : array_values(array_unique($m[1]));
    }

    private static function tplRows(string $client): array
    {
        $k = 'tpl|' . $client;
        if (!array_key_exists($k, self::$cache)) {
            $rows = [];
            try {
                foreach (self::q('SELECT * FROM ssms_notify_templates WHERE ssms_client_code = ?', [$client]) as $r) {
                    $rows[$r['kind'] . '|' . $r['channel'] . '|' . $r['lang']] = $r;
                }
            } catch (\Throwable $e) {
            }
            self::$cache[$k] = $rows;
        }

        return self::$cache[$k];
    }

    /** The text for a kind, channel and language (the school's own wording, else the standard text translated). */
    private static function baseText(string $client, string $kind, string $channel, string $lang): string
    {
        $own = trim((string)(self::tplRows($client)[$kind . '|' . $channel . '|' . $lang]['text'] ?? ''));

        return $own !== '' ? $own : Locale::withLang($lang, fn() => Locale::t($client, self::KINDS[$kind][2]));
    }

    /**
     * The message to send: text, template (provider ID / name) and the values in the order the text uses them.
     * When the provider needs a registered template, the person's language is used if it has one, else the
     * school's, else English. → ['text', 'template', 'vars', 'lang', 'error']
     */
    public static function compose(string $client, string $channel, string $kind, array $vars, string $lang, ?array $conn): array
    {
        if (!isset(self::KINDS[$kind])) {
            return ['text' => '', 'template' => null, 'vars' => [], 'lang' => $lang, 'error' => 'Unknown message.'];
        }
        $vars += ['school' => self::schoolName($client)];
        $needs = $conn ? MessagingProviders::needsTemplate($conn['provider'], $channel, $conn['cfg']) : false;
        $tpl = null;
        $use = $lang;
        if ($needs) {
            foreach (array_unique([$lang, Locale::langFor($client, null), 'en']) as $l) {
                $r = self::tplRows($client)[$kind . '|' . $channel . '|' . $l] ?? null;
                if ($r && trim((string)$r['provider_ref']) !== '' && $r['status'] !== 'rejected') {
                    $tpl = trim((string)$r['provider_ref']);
                    $use = $l;
                    break;
                }
            }
            if ($tpl === null) {
                return ['text' => '', 'template' => null, 'vars' => [], 'lang' => $lang,
                    'error' => Locale::t($client, 'Add the registered template for "{name}" in Setup › Notifications › Texts first.', ['name' => Locale::t($client, self::KINDS[$kind][1])])];
            }
        }
        $base = self::baseText($client, $kind, $channel, $use);
        $ordered = [];
        foreach (self::placeholders($base, true) as $p) {
            $v = (string)($vars[$p] ?? '');
            // WhatsApp template values: one line, no tabs, not too long
            $ordered[] = $channel === 'whatsapp' ? mb_substr(trim(preg_replace('/\s*\n\s*|\t|\s{4,}/u', ' · ', $v)), 0, 300) : $v;
        }
        $text = (string)preg_replace_callback('/\{(\w+)\}/', fn($m) => (string)($vars[$m[1]] ?? ''), $base);
        if ($channel === 'sms' && $conn && !empty($conn['rules']['optout']) && !$needs) {
            $text .= ' ' . Locale::withLang($use, fn() => Locale::t($client, self::OPTOUT_LINE));
        }

        return ['text' => $text, 'template' => $tpl, 'vars' => $ordered, 'lang' => $use, 'error' => null];
    }

    /** Setup › Notifications › Templates: every kind × channel × language with the exact text to register. */
    public static function templates(string $client): array
    {
        $schoolLang = Locale::langFor($client, null);
        $used = [$schoolLang => true];
        try {
            foreach (self::q('SELECT DISTINCT language FROM ssms_user_language WHERE ssms_client_code = ?', [$client]) as $r) {
                $used[(string)$r['language']] = true;
            }
        } catch (\Throwable $e) {
        }
        $out = [];
        foreach (self::CHANNELS as $ch) {
            $conn = self::conn($client, $ch);
            foreach (self::KINDS as $kind => [$event, $title, $std]) {
                foreach (array_keys(Locale::LANGUAGES) as $l) {
                    $r = self::tplRows($client)[$kind . '|' . $ch . '|' . $l] ?? null;
                    $base = self::baseText($client, $kind, $ch, $l);
                    $i = 0;
                    $out[] = [
                        'kind' => $kind, 'event' => $event, 'title' => $title, 'channel' => $ch, 'lang' => $l, 'used' => isset($used[$l]),
                        'standard' => Locale::withLang($l, fn() => Locale::t($client, $std)), 'text' => $r['text'] ?? null, 'vars' => self::placeholders($std),
                        // the text to register: India DLT {#var#}, WhatsApp {{1}} {{2}} …
                        'register_text' => $ch === 'whatsapp' ? (string)preg_replace_callback('/\{\w+\}/', function () use (&$i) { return '{{' . (++$i) . '}}'; }, $base)
                                                              : (string)preg_replace('/\{\w+\}/', '{#var#}', $base),
                        'provider_ref' => $r['provider_ref'] ?? null, 'status' => $r['status'] ?? 'none',
                        'needs_template' => $conn ? MessagingProviders::needsTemplate($conn['provider'], $ch, $conn['cfg']) : false,
                        'segments' => $ch === 'sms' ? MessagingCountries::segments(self::sample($client, $base)) : null,
                    ];
                }
            }
        }

        return ['templates' => $out, 'school_language' => $schoolLang, 'languages' => Locale::LANGUAGES];
    }

    /** A typical filled-in text, to count SMS parts. */
    private static function sample(string $client, string $text): string
    {
        $s = ['student' => 'Aisha Rahman', 'date' => '12 Nov 2026', 'time' => '09:20', 'school' => self::schoolName($client), 'subject' => 'Mathematics',
              'title' => 'Exercise 4.2', 'subjects' => 'Maths, English, Science', 'amount' => '2,500.00', 'name' => 'Term 1'];

        return (string)preg_replace_callback('/\{(\w+)\}/', fn($m) => $s[$m[1]] ?? 'xxxx', $text);
    }

    public static function saveTemplate(string $client, string $kind, string $channel, string $lang, array $d, string $by): array
    {
        if (!isset(self::KINDS[$kind]) || !in_array($channel, self::CHANNELS, true) || !isset(Locale::LANGUAGES[$lang])) {
            throw new \DomainException('Unknown message.');
        }
        $text = isset($d['text']) ? trim((string)$d['text']) : null;
        if ($text !== null && $text !== '') {
            $allowed = self::placeholders(self::KINDS[$kind][2]);
            $bad = array_diff(self::placeholders($text), $allowed);
            if ($bad) {
                throw new \DomainException(Locale::t($client, 'Only these placeholders can be used: {list}.', ['list' => '{' . implode('}, {', $allowed) . '}']));
            }
            if (mb_strlen($text) > 640) {
                throw new \DomainException('The text is too long (640 characters at most).');
            }
        }
        $status = (string)($d['status'] ?? 'none');
        if (!in_array($status, ['none', 'submitted', 'approved', 'rejected'], true)) {
            $status = 'none';
        }
        $ref = isset($d['provider_ref']) ? mb_substr(trim((string)$d['provider_ref']), 0, 190) : null;
        self::db()->execute('INSERT INTO ssms_notify_templates (ssms_client_code, kind, channel, lang, provider_ref, status, text, updated_by, modified) VALUES (?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE provider_ref = VALUES(provider_ref), status = VALUES(status), text = VALUES(text), updated_by = VALUES(updated_by), modified = VALUES(modified)',
            [$client, $kind, $channel, $lang, $ref ?: null, $ref ? $status : 'none', $text ?: null, $by, self::now()]);
        self::resetCache();

        return ['kind' => $kind, 'channel' => $channel, 'lang' => $lang, 'provider_ref' => $ref ?: null, 'status' => $ref ? $status : 'none', 'text' => $text ?: null];
    }

    // ── Who gets it: family phones ─────────────────────────────────────────

    /** A child's family phones (admission form mobile, guardians who get notices) → [[phone, user, lang]] */
    public static function familyPhones(string $client, string $eid): array
    {
        $country = self::country($client);
        $raw = [];
        try {
            $r = self::db()->execute('SELECT r.mobile_number FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1', [$eid, $client])->fetch('assoc');
            $raw[] = (string)($r['mobile_number'] ?? '');
        } catch (\Throwable $e) {
        }
        try {
            foreach (self::q("SELECT g.phone FROM ssms_student_guardians g JOIN ssms_student_enrollment e ON e.registration_id = g.registration_id AND e.ssms_client_code = g.ssms_client_code
                    WHERE e.enrollment_id = ? AND g.ssms_client_code = ? AND g.gets_notices = 1 AND COALESCE(g.restriction_note, '') = ''", [$eid, $client]) as $g) {
                $raw[] = (string)$g['phone'];
            }
        } catch (\Throwable $e) {
        }
        // the parents' app accounts: their own number, and their language
        $accounts = [];
        foreach (Meetings::parentUsers($client, $eid) as $u) {
            $m = self::db()->execute('SELECT mobile_number FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name = ? LIMIT 1', [$client, $u])->fetch('assoc');
            $ph = MessagingCountries::e164((string)($m['mobile_number'] ?? '') ?: $u, $country);
            if ($ph) {
                $accounts[$ph] ??= $u;
                $raw[] = $ph;
            }
        }
        $out = [];
        foreach ($raw as $x) {
            $ph = MessagingCountries::e164($x, $country);
            if ($ph && !isset($out[$ph])) {
                $u = $accounts[$ph] ?? null;
                $out[$ph] = ['phone' => $ph, 'user' => $u, 'lang' => Locale::langFor($client, $u)];
            }
        }

        return array_values($out);
    }

    /** App accounts' own numbers (notices to staff, parents, students) → [[phone, user, lang]] */
    public static function userPhones(string $client, array $users): array
    {
        if (!$users) {
            return [];
        }
        $country = self::country($client);
        $out = [];
        foreach (array_chunk($users, 500) as $chunk) {
            foreach (self::q('SELECT ssms_user_name, mobile_number FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')',
                array_merge([$client], $chunk)) as $r) {
                $ph = MessagingCountries::e164((string)$r['mobile_number'] ?: (string)$r['ssms_user_name'], $country);
                if ($ph && !isset($out[$ph])) {
                    $out[$ph] = ['phone' => $ph, 'user' => (string)$r['ssms_user_name'], 'lang' => Locale::langFor($client, (string)$r['ssms_user_name'])];
                }
            }
        }

        return array_values($out);
    }

    /** Families' admission-form numbers for the whole school (notices to all / parents). */
    public static function schoolFamilyPhones(string $client, ?int $sessionId): array
    {
        $country = self::country($client);
        $acc = [];
        try {
            foreach (self::q("SELECT ssms_user_name, mobile_number FROM sawera_ssms_users WHERE ssms_client_code = ? AND LOWER(ssms_user_role) = 'parent' AND COALESCE(ssms_user_status,'active') = 'active'",
                [$client]) as $u) {
                $ph = MessagingCountries::e164((string)$u['mobile_number'] ?: (string)$u['ssms_user_name'], $country);
                if ($ph) {
                    $acc[$ph] ??= (string)$u['ssms_user_name'];
                }
            }
        } catch (\Throwable $e) {
        }
        $out = [];
        try {
            foreach (self::q("SELECT DISTINCT r.mobile_number FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                    WHERE e.ssms_client_code = ? AND COALESCE(e.status,'active') = 'active'" . ($sessionId ? ' AND e.session_id = ?' : ''), $sessionId ? [$client, $sessionId] : [$client]) as $r) {
                $ph = MessagingCountries::e164((string)$r['mobile_number'], $country);
                if ($ph) {
                    $u = $acc[$ph] ?? null;
                    $out[$ph] = ['phone' => $ph, 'user' => $u, 'lang' => Locale::langFor($client, $u)];
                }
            }
        } catch (\Throwable $e) {
        }

        return array_values($out);
    }

    // ── Consent (optional, per school / country) ───────────────────────────

    private static function ensureConsentType(string $client): void
    {
        if (isset(self::$cache['consent_type|' . $client])) {
            return;
        }
        self::$cache['consent_type|' . $client] = true;
        try {
            Consents::types($client);   // seeds the standard types for a new school
            $has = self::db()->execute("SELECT id FROM ssms_consent_types WHERE ssms_client_code = ? AND type_key = 'messages'", [$client])->fetch('assoc');
            if (!$has) {
                self::db()->execute("INSERT INTO ssms_consent_types (ssms_client_code, type_key, title, body, audience, required, version, active, modified) VALUES (?,?,?,?,?,?,1,1,?)",
                    [$client, 'messages', 'Messages by SMS / WhatsApp', 'The school may send you messages about your child (absence, fees, notices, results) by SMS or WhatsApp. Reply STOP at any time to stop them.', 'parent', 0, self::now()]);
            }
        } catch (\Throwable $e) {
            Log::warning('Messaging consent type: ' . $e->getMessage());
        }
    }

    private static function consented(string $client, string $eid): bool
    {
        try {
            $r = self::db()->execute("SELECT c.granted FROM ssms_consents c JOIN ssms_consent_types t ON t.id = c.type_id AND t.ssms_client_code = c.ssms_client_code
                WHERE c.ssms_client_code = ? AND c.subject_id = ? AND t.type_key = 'messages' ORDER BY c.id DESC LIMIT 1", [$client, $eid])->fetch('assoc');

            return $r && (int)$r['granted'] === 1;
        } catch (\Throwable $e) {
            return false;
        }
    }

    // ── Queuing (called by Notify for each event) ──────────────────────────

    /**
     * $s: the event's settings · $phones: [[phone, user, lang]] · $render: called in each person's language,
     * returns kind + vars (+ title) · $appUsers: the family's / person's accounts with the app (for "only if not read").
     * Returns how many messages were queued.
     */
    public static function queue(string $client, array $s, string $ref, array $data, ?string $eid, array $phones, callable $render, array $appUsers): int
    {
        $n = 0;
        $wa = !empty($s['whatsapp']) && self::active($client, 'whatsapp');
        $fixOf = str_ends_with($ref, ':fix') ? substr($ref, 0, -4) : null;
        if ($fixOf !== null) {
            self::db()->execute("UPDATE ssms_notify_outbox SET status = 'skipped', error = 'Corrected before it was sent' WHERE ssms_client_code = ? AND ref = ?
                AND channel IN ('sms','whatsapp') AND status = 'queued'", [$client, $fixOf]);
        }
        foreach (['whatsapp', 'sms'] as $ch) {
            if (empty($s[$ch]) || !($conn = self::conn($client, $ch))) {
                continue;
            }
            if ($conn['consent']) {
                self::ensureConsentType($client);
            }
            if ($conn['consent'] && $eid !== null && !self::consented($client, $eid)) {
                continue;   // the school asks for written consent and this family has not given it
            }
            if ($conn['consent'] && $eid === null) {
                $phones = array_values(array_filter($phones, fn($p) => $p['user'] !== null));   // no consent record for unknown numbers
            }
            foreach ($phones as $p) {
                if ($p['user'] && !Notify::wantsChannel($client, $s, (string)$p['user'], $ch)) {
                    continue;
                }
                if (self::optedOut($client, $ch, $p['phone'])) {
                    continue;
                }
                if ($fixOf !== null && !self::db()->execute("SELECT 1 FROM ssms_notify_outbox WHERE ssms_client_code = ? AND ref = ? AND channel = ? AND address = ? AND sent_at IS NOT NULL LIMIT 1",
                        [$client, $fixOf, $ch, $p['phone']])->fetch('assoc')) {
                    continue;   // the absence message never reached this number: nothing to correct
                }
                $msg = Locale::withLang($p['lang'], $render);
                $kind = (string)($msg['kind'] ?? '');
                if (!isset(self::KINDS[$kind])) {
                    continue;
                }
                $vars = (array)($msg['vars'] ?? []);
                $c = self::compose($client, $ch, $kind, $vars, $p['lang'], $conn);
                $after = strtotime(self::now());
                $cond = [];
                $readers = $eid !== null ? $appUsers : ($p['user'] && in_array($p['user'], $appUsers, true) ? [$p['user']] : []);
                if (($s['options']['paid_when'] ?? 'unread') === 'unread' && $readers) {
                    $after += 60 * max(0, (int)($s['options']['unread_minutes'] ?? 15));
                    $cond['unread'] = array_values($readers);
                }
                if ($ch === 'sms' && $wa && $conn['sms_after_whatsapp']) {
                    $cond['after_whatsapp'] = 1;
                    $after = max($after, strtotime(self::now()) + 600);
                }
                if (!self::KINDS[$kind][3]) {
                    $after = self::afterQuiet($client, $conn, $after);
                }
                $n += self::db()->execute('INSERT IGNORE INTO ssms_notify_outbox (ssms_client_code, event, ref, channel, username, address, enrollment_id, lang, title, body, data, status, send_after, created)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    [$client, $s['event'], $ref, $ch, $p['user'], $p['phone'], $eid, $p['lang'], mb_substr((string)($msg['title'] ?? ''), 0, 250), $c['text'] ?: Locale::withLang($p['lang'], fn() => Locale::t($client, self::KINDS[$kind][2], $vars)),
                     json_encode($data + ['kind' => $kind, 'vars' => $vars, 'cond' => (object)$cond], JSON_UNESCAPED_UNICODE), 'queued', date('Y-m-d H:i:s', $after), self::now()])->rowCount();
            }
        }

        return $n;
    }

    /** Non-urgent messages wait for the end of the quiet hours (school time). */
    private static function afterQuiet(string $client, array $conn, int $ts): int
    {
        [$from, $to] = $conn['quiet'];
        if (!$from || !$to || $from === $to) {
            return $ts;
        }
        $tz = Locale::tz($client);
        $local = (new \DateTimeImmutable('@' . $ts))->setTimezone($tz);
        $hm = $local->format('H:i');
        $quiet = $from < $to ? ($hm >= $from && $hm < $to) : ($hm >= $from || $hm < $to);
        if (!$quiet) {
            return $ts;
        }
        [$h, $m] = array_map('intval', explode(':', $to));
        $end = $local->setTime($h, $m);
        if ($end <= $local) {
            $end = $end->modify('+1 day');
        }

        return $end->getTimestamp();
    }

    public static function optedOut(string $client, string $channel, string $phone): bool
    {
        try {
            return (bool)self::db()->execute('SELECT 1 FROM ssms_notify_optouts WHERE ssms_client_code = ? AND channel = ? AND phone = ?', [$client, $channel, $phone])->fetch('assoc');
        } catch (\Throwable $e) {
            return false;
        }
    }

    public static function optOut(string $client, string $channel, string $phone, string $source): void
    {
        self::db()->execute('INSERT IGNORE INTO ssms_notify_optouts (ssms_client_code, channel, phone, source, created) VALUES (?,?,?,?,?)', [$client, $channel, $phone, $source, self::now()]);
    }

    public static function optIn(string $client, string $channel, string $phone): void
    {
        self::db()->execute('DELETE FROM ssms_notify_optouts WHERE ssms_client_code = ? AND channel = ? AND phone = ?', [$client, $channel, $phone]);
    }

    // ── Sending (inside Notify::deliver's per-school lock) ─────────────────

    public static function deliver(string $client, int $limit = 300): int
    {
        try {
            $rows = self::q("SELECT * FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel IN ('sms','whatsapp') AND status = 'queued' AND send_after <= ? ORDER BY id LIMIT " . max(1, $limit),
                [$client, self::now()]);
        } catch (\Throwable $e) {
            return 0;
        }

        return $rows ? self::deliverRows($client, $rows) : 0;
    }

    private static function deliverRows(string $client, array $rows): int
    {
        $sent = 0;
        $used = [];
        foreach ($rows as $r) {
            $id = (int)$r['id'];
            $ch = (string)$r['channel'];
            $data = json_decode((string)$r['data'], true) ?: [];
            $cond = (array)($data['cond'] ?? []);
            if (!empty($cond['unread']) && self::readInApp($client, (string)$r['ref'], (array)$cond['unread'], (int)($data['notice_id'] ?? 0))) {
                self::mark($id, 'skipped', 'Read in the app');
                continue;
            }
            if (!empty($cond['after_whatsapp'])) {
                $w = self::db()->execute("SELECT status FROM ssms_notify_outbox WHERE ssms_client_code = ? AND ref = ? AND channel = 'whatsapp' AND address = ? LIMIT 1",
                    [$client, $r['ref'], $r['address']])->fetch('assoc');
                if ($w && $w['status'] === 'queued') {
                    self::db()->execute('UPDATE ssms_notify_outbox SET send_after = ? WHERE id = ?', [date('Y-m-d H:i:s', strtotime(self::now()) + 300), $id]);
                    continue;
                }
                if ($w && $w['status'] === 'sent') {
                    self::mark($id, 'skipped', 'Sent by WhatsApp');
                    continue;
                }
            }
            $conn = self::conn($client, $ch);
            if (!$conn) {
                self::mark($id, 'skipped', $ch === 'sms' ? 'SMS is not set up' : 'WhatsApp is not set up');
                continue;
            }
            if (self::optedOut($client, $ch, (string)$r['address'])) {
                self::mark($id, 'skipped', 'This number asked not to get messages');
                continue;
            }
            $kind = (string)($data['kind'] ?? '');
            if (empty($data['test']) && isset(self::KINDS[$kind]) && !self::KINDS[$kind][3]) {
                $later = self::afterQuiet($client, $conn, strtotime(self::now()));
                if ($later > strtotime(self::now())) {   // a retry / a held-back SMS: still not at night
                    self::db()->execute('UPDATE ssms_notify_outbox SET send_after = ? WHERE id = ?', [date('Y-m-d H:i:s', $later), $id]);
                    continue;
                }
            }
            $c = ($data['test'] ?? null) ? self::compose($client, $ch, 'absence', (array)$data['vars'], (string)$r['lang'], $conn)
                                        : self::compose($client, $ch, (string)($data['kind'] ?? ''), (array)($data['vars'] ?? []), (string)$r['lang'] ?: 'en', $conn);
            if ($c['error']) {
                self::mark($id, 'failed', $c['error']);
                continue;
            }
            $segs = $ch === 'sms' ? MessagingCountries::segments($c['text']) : 1;
            $uk = $ch . '|' . $conn['via'];
            $used[$uk] ??= self::used($client, $ch, $conn['via']);
            if ($conn['limit'] !== null && $used[$uk] + $segs > $conn['limit']) {
                self::mark($id, 'skipped', 'Monthly limit reached');
                self::alertLimit($client, $ch, $conn, 'stopped');
                continue;
            }
            $res = MessagingProviders::send($conn['provider'], $ch, $conn['cfg'], ['to' => (string)$r['address'], 'text' => $c['text'], 'template' => $c['template'],
                'vars' => $c['vars'], 'lang' => $c['lang'], 'sender' => $conn['sender'],
                'callback' => self::hookUrl($conn['via'] === 'managed' ? 'platform' : $client, $conn['provider'])]);
            if ($res['ok']) {
                $cost = $res['cost'] ?? ($conn['cost'] !== null ? round($conn['cost'] * $segs, 4) : null);
                self::db()->execute("UPDATE ssms_notify_outbox SET status = 'sent', error = NULL, attempts = attempts + 1, sent_at = ?, provider = ?, provider_id = ?, via = ?, segments = ?, cost = ?, body = ?
                    WHERE id = ?", [self::now(), $conn['provider'], mb_substr((string)$res['id'], 0, 120), $conn['via'], $segs, $cost, $c['text'], $id]);
                $used[$uk] += $segs;
                $sent++;
                if ($conn['limit'] && $used[$uk] >= 0.8 * $conn['limit']) {
                    self::alertLimit($client, $ch, $conn, 'warned');
                }
            } elseif ($res['retry'] && (int)$r['attempts'] + 1 < 3) {
                self::db()->execute('UPDATE ssms_notify_outbox SET attempts = attempts + 1, error = ?, send_after = ? WHERE id = ?',
                    [mb_substr((string)$res['error'], 0, 250), date('Y-m-d H:i:s', strtotime(self::now()) + 300 * ((int)$r['attempts'] + 1)), $id]);
            } else {
                self::mark($id, 'failed', (string)$res['error']);
                if ($ch === 'whatsapp') {
                    self::smsAgain($client, (string)$r['ref'], (string)$r['address']);
                }
            }
        }

        return $sent;
    }

    private static function readInApp(string $client, string $ref, array $users, int $noticeId = 0): bool
    {
        if (!$users) {
            return false;
        }
        $in = implode(',', array_fill(0, count($users), '?'));
        if ($noticeId > 0 && self::db()->execute("SELECT 1 FROM ssms_notice_reads WHERE ssms_client_code = ? AND notice_id = ? AND username IN ($in) LIMIT 1",
                array_merge([$client, $noticeId], array_values($users)))->fetch('assoc')) {
            return true;   // opened on the notice board
        }

        return (bool)self::db()->execute("SELECT 1 FROM ssms_notify_inbox WHERE ssms_client_code = ? AND ref = ? AND read_at IS NOT NULL AND username IN ($in) LIMIT 1",
            array_merge([$client, $ref], array_values($users)))->fetch('assoc');
    }

    /** WhatsApp did not reach the number: the SMS that was held back goes after all. */
    private static function smsAgain(string $client, string $ref, string $phone): void
    {
        self::db()->execute("UPDATE ssms_notify_outbox SET status = 'queued', error = NULL, send_after = ? WHERE ssms_client_code = ? AND ref = ? AND channel = 'sms' AND address = ?
            AND status = 'skipped' AND error = 'Sent by WhatsApp'", [self::now(), $client, $ref, $phone]);
    }

    private static function mark(int $id, string $status, ?string $error): void
    {
        self::db()->execute('UPDATE ssms_notify_outbox SET status = ?, error = ?, attempts = attempts + 1 WHERE id = ?', [$status, $error ? mb_substr($error, 0, 250) : null, $id]);
    }

    /** SMS parts / WhatsApp messages sent this month on this channel (own account or ManageMyAcademy's). */
    public static function used(string $client, string $channel, string $via): int
    {
        try {
            return (int)(self::db()->execute("SELECT COALESCE(SUM(COALESCE(segments, 1)), 0) n FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel = ? AND via = ?
                AND sent_at >= ?", [$client, $channel, $via, substr(self::now(), 0, 7) . '-01 00:00:00'])->fetch('assoc')['n'] ?? 0);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /** Tell the office once a month: 80 % used ('warned') or the limit reached ('stopped'). */
    private static function alertLimit(string $client, string $ch, array $conn, string $what): void
    {
        $month = substr(self::now(), 0, 7);
        $col = $what === 'stopped' ? 'stopped_month' : 'warned_month';
        if (($conn['row'][$col] ?? null) === $month) {
            return;
        }
        $n = self::db()->execute("UPDATE ssms_notify_channels SET $col = ? WHERE ssms_client_code = ? AND channel = ? AND ($col IS NULL OR $col <> ?)", [$month, $client, $ch, $month])->rowCount();
        self::resetCache();
        if ($n < 1) {
            return;
        }
        $name = $ch === 'sms' ? 'SMS' : 'WhatsApp';
        Notify::alertStaff($client, "msg_limit:$ch:$what:$month", fn() => $what === 'stopped'
            ? ['title' => Locale::t($client, '{channel} messages stopped', ['channel' => $name]),
               'body' => Locale::t($client, 'The monthly limit of {limit} {channel} messages is reached. Families still get the app notification and e-mail. Change the limit in Setup › Notifications.', ['limit' => $conn['limit'], 'channel' => $name])]
            : ['title' => Locale::t($client, '{channel}: 80% of this month\'s messages used', ['channel' => $name]),
               'body' => Locale::t($client, '{used} of {limit} {channel} messages are used this month.', ['used' => self::used($client, $ch, $conn['via']), 'limit' => $conn['limit'], 'channel' => $name])]);
    }

    // ── Webhooks ───────────────────────────────────────────────────────────

    /** The key in a school's webhook URL ('platform' = ManageMyAcademy's own account). */
    public static function hookKey(string $client): string
    {
        return substr(hash_hmac('sha256', 'notify-hook|' . strtoupper($client), Security::getSalt()), 0, 24);
    }

    public static function hookUrl(string $client, string $provider): string
    {
        return rtrim((string)env('APP_URL', 'https://managemyacademy.com/'), '/') . '/hooks/notify/' . rawurlencode($provider) . '/' . rawurlencode($client) . '/' . self::hookKey($client);
    }

    /** → [http status, body, content type]. $client 'platform' = reports and replies for ManageMyAcademy's account (any school). */
    public static function hook(string $provider, string $client, string $key, array $req): array
    {
        if (!isset(MessagingProviders::LIST[$provider]) || $client === '' || !hash_equals(self::hookKey($client), $key)) {
            return [404, 'not found', 'text/plain'];
        }
        $platform = strtolower($client) === 'platform';
        // every account this URL can belong to (a school may use Twilio for SMS on ManageMyAcademy's account and for WhatsApp on its own)
        $cfgs = [];
        foreach (self::CHANNELS as $ch) {
            if ($platform) {
                $p = self::platform($ch);
                if ($p && $p['provider'] === $provider) {
                    $cfgs[] = $p['cfg'];
                }
            } else {
                $r = self::row($client, $ch);
                if ($r && $r['provider'] === $provider && $r['mode'] === 'own') {
                    $cfgs[] = self::decryptCfg((string)$r['config']);
                }
            }
        }
        $cfgs = array_values(array_filter($cfgs));
        if (!$cfgs) {
            return [404, 'not found', 'text/plain'];
        }
        $p = MessagingProviders::parseHook($provider, $req);
        if ($p['reply'] !== null) {   // Meta's subscription check
            return hash_equals(self::hookKey($client), (string)$p['reply']['token']) ? [200, (string)$p['reply']['challenge'], 'text/plain'] : [403, 'forbidden', 'text/plain'];
        }
        $ok = false;
        foreach ($cfgs as $cfg) {
            if (MessagingProviders::verifyHook($provider, $cfg, $req)) {
                $ok = true;
                break;
            }
        }
        if (!$ok) {
            Log::warning("Messaging hook $provider/$client: signature check failed");

            return [403, 'forbidden', 'text/plain'];
        }
        foreach ($p['statuses'] as [$pid, $state, $err]) {
            if ($platform) {
                $sc = self::db()->execute("SELECT ssms_client_code c FROM ssms_notify_outbox WHERE provider = ? AND provider_id = ? AND via = 'managed' LIMIT 1", [$provider, (string)$pid])->fetch('assoc');
                if ($sc) {
                    self::applyStatus((string)$sc['c'], $provider, (string)$pid, (string)$state, $err);
                }
            } else {
                self::applyStatus($client, $provider, (string)$pid, (string)$state, $err);
            }
        }
        foreach ($p['inbound'] as [$from, $text, $ch]) {
            if ($platform) {
                // a reply to the shared number: every school that sent to this number through ManageMyAcademy's account
                $num = '+' . ltrim(preg_replace('/\D/', '', (string)$from), '+');
                foreach (self::q("SELECT DISTINCT ssms_client_code c FROM ssms_notify_outbox WHERE via = 'managed' AND provider = ? AND address = ?", [$provider, $num]) as $sc) {
                    self::inbound((string)$sc['c'], (string)$ch, (string)$from, (string)$text);
                }
            } else {
                self::inbound($client, (string)$ch, (string)$from, (string)$text);
            }
        }

        return [200, 'ok', 'text/plain'];
    }

    private static function applyStatus(string $client, string $provider, string $pid, string $state, ?string $err): void
    {
        $row = self::db()->execute('SELECT id, ref, channel, address, username, data, status FROM ssms_notify_outbox WHERE ssms_client_code = ? AND provider = ? AND provider_id = ? LIMIT 1',
            [$client, $provider, $pid])->fetch('assoc');
        if (!$row) {
            return;
        }
        $now = self::now();
        if ($state === 'delivered') {
            self::db()->execute('UPDATE ssms_notify_outbox SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ?', [$now, $row['id']]);
        } elseif ($state === 'read') {
            self::db()->execute('UPDATE ssms_notify_outbox SET delivered_at = COALESCE(delivered_at, ?), read_at = COALESCE(read_at, ?) WHERE id = ?', [$now, $now, $row['id']]);
            // a notice read on WhatsApp counts as read
            $data = json_decode((string)$row['data'], true) ?: [];
            if (!empty($data['notice_id']) && $row['username']) {
                Notify::noticeRead($client, (string)$row['username'], (int)$data['notice_id']);
            }
        } elseif ($state === 'failed' && $row['status'] !== 'failed') {
            self::db()->execute("UPDATE ssms_notify_outbox SET status = 'failed', error = ? WHERE id = ?", [mb_substr($err ?: 'Not delivered', 0, 250), $row['id']]);
            if ($row['channel'] === 'whatsapp') {
                self::smsAgain($client, (string)$row['ref'], (string)$row['address']);
            }
        }
    }

    private static function inbound(string $client, string $channel, string $from, string $text): void
    {
        $phone = MessagingCountries::e164(str_starts_with($from, '+') ? $from : '+' . preg_replace('/\D/', '', $from), self::country($client));
        if (!$phone) {
            return;
        }
        $w = mb_strtolower(trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', $text)));
        if (in_array($w, self::STOP_WORDS, true) || in_array(str_replace(' ', '', $w), self::STOP_WORDS, true)) {
            self::optOut($client, $channel, $phone, 'reply');
        } elseif (in_array($w, self::START_WORDS, true)) {
            self::db()->execute("DELETE FROM ssms_notify_optouts WHERE ssms_client_code = ? AND channel = ? AND phone = ? AND source = 'reply'", [$client, $channel, $phone]);
        }
    }

    // ── Usage (Setup › Notifications › Delivery) ───────────────────────────

    public static function usage(string $client): array
    {
        $out = [];
        $month = substr(self::now(), 0, 7) . '-01 00:00:00';
        foreach (self::CHANNELS as $ch) {
            $conn = self::conn($client, $ch);
            $via = $conn['via'] ?? 'own';
            $rows = [];
            try {
                $rows = self::q("SELECT event, status, COUNT(*) n, COALESCE(SUM(COALESCE(segments,1)),0) parts, COALESCE(SUM(cost),0) cost,
                        SUM(delivered_at IS NOT NULL) delivered, SUM(read_at IS NOT NULL) seen
                    FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel = ? AND created >= ? GROUP BY event, status", [$client, $ch, $month]);
            } catch (\Throwable $e) {
            }
            $by = [];
            $tot = ['sent' => 0, 'failed' => 0, 'skipped' => 0, 'queued' => 0, 'parts' => 0, 'cost' => 0.0, 'delivered' => 0, 'read' => 0];
            foreach ($rows as $r) {
                $st = (string)$r['status'];
                $by[$r['event']][$st] = (int)$r['n'];
                $tot[$st] = ($tot[$st] ?? 0) + (int)$r['n'];
                if ($st === 'sent') {
                    $tot['parts'] += (int)$r['parts'];
                    $tot['cost'] += (float)$r['cost'];
                    $tot['delivered'] += (int)$r['delivered'];
                    $tot['read'] += (int)$r['seen'];
                }
            }
            $out[$ch] = ['active' => $conn !== null, 'via' => $conn['via'] ?? null, 'limit' => $conn['limit'] ?? null, 'used' => self::used($client, $ch, $via),
                'currency' => $conn['currency'] ?? '', 'totals' => $tot, 'by_event' => (object)$by, 'cost' => round($tot['cost'], 2)];
        }

        return $out;
    }

    // ── Privacy ────────────────────────────────────────────────────────────

    public static function erasePhones(string $client, array $phones): int
    {
        $phones = array_values(array_unique(array_filter($phones)));
        if (!$phones) {
            return 0;
        }
        try {
            // rows the provider accepted stay (without the number or text) so this month's use stays right
            $in = implode(',', array_fill(0, count($phones), '?'));
            $n = self::db()->execute("UPDATE ssms_notify_outbox SET address = CONCAT('erased-', id), username = NULL, enrollment_id = NULL, title = '', body = NULL, data = NULL
                WHERE ssms_client_code = ? AND channel IN ('sms','whatsapp') AND sent_at IS NOT NULL AND address IN ($in)", array_merge([$client], $phones))->rowCount();

            return $n + self::db()->execute("DELETE FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel IN ('sms','whatsapp') AND address IN ($in)",
                array_merge([$client], $phones))->rowCount();
        } catch (\Throwable $e) {
            return 0;
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /** The school's country (ssms_clients.country_code – also countries without a Region & Formats preset). */
    public static function country(string $client): string
    {
        $k = 'country|' . $client;
        if (!array_key_exists($k, self::$cache)) {
            $c = '';
            try {
                $c = strtoupper(trim((string)(self::db()->execute('SELECT country_code FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc')['country_code'] ?? '')));
            } catch (\Throwable $e) {
            }
            self::$cache[$k] = preg_match('/^[A-Z]{2}$/', $c) ? $c : strtoupper((string)(Locale::get($client)['country'] ?? 'IN'));
        }

        return self::$cache[$k];
    }

    private static function schoolName(string $client): string
    {
        return Notify::school($client)['name'];
    }

    private static function encKey(): string
    {
        return hash('sha256', Security::getSalt() . '|messaging');
    }

    private static function encryptCfg(array $cfg): string
    {
        return $cfg ? base64_encode(Security::encrypt((string)json_encode($cfg), self::encKey())) : '';
    }

    private static function decryptCfg(string $stored): array
    {
        if ($stored === '') {
            return [];
        }
        $raw = base64_decode($stored, true);
        $plain = $raw !== false ? Security::decrypt($raw, self::encKey()) : null;

        return $plain ? (json_decode($plain, true) ?: []) : [];
    }

    private static function local(string $client, string $ts): string
    {
        try {
            return (new \DateTimeImmutable($ts, new \DateTimeZone(date_default_timezone_get())))->setTimezone(Locale::tz($client))->format('Y-m-d H:i:s');
        } catch (\Throwable $e) {
            return $ts;
        }
    }

    private static function now(): string
    {
        return AccountSecurity::now();
    }

    private static function q(string $sql, array $p): array
    {
        return self::db()->execute($sql, $p)->fetchAll('assoc');
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
