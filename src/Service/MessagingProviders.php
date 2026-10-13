<?php
declare(strict_types=1);

namespace App\Service;

/**
 * SMS / WhatsApp providers. Each one: send(), test(), and reading its delivery-report / reply webhooks.
 *
 *   send($provider, $channel, $cfg, $m)   $m = to (E.164), text, template (provider's template ID / name),
 *                                              vars (ordered values), lang, sender, callback (status URL)
 *        → ['ok' => bool, 'id' => provider message ID, 'cost' => float|null, 'error' => text, 'retry' => bool]
 *   test($provider, $channel, $cfg)       → ['ok' => bool, 'error' => text, 'info' => text]
 *   parseHook($provider, $req)            → ['statuses' => [[id, status (sent|delivered|read|failed), error]],
 *                                            'inbound' => [[from, text, channel]], 'reply' => GET verification answer]
 *   verifyHook($provider, $cfg, $req, $key)
 *
 * API details checked against the providers' docs (Oct 2026); the request formats are kept in one place
 * here so a change by a provider only touches this file.
 */
final class MessagingProviders
{
    /** Test hook: fn(string $method, string $url, array $headers, ?string $body): [int $httpCode, string $body] */
    public static $http = null;

    /**
     * provider => name, channels, template (channels that need a registered template), fields
     * field: [key, label, secret, required, help]
     */
    public const LIST = [
        'twilio' => ['name' => 'Twilio', 'channels' => ['sms', 'whatsapp'], 'template' => ['whatsapp'], 'fields' => [
            ['account_sid', 'Account SID', false, true, 'Starts with AC – Twilio Console › Account info'],
            ['auth_token', 'Auth token', true, true, 'Twilio Console › Account info'],
            ['messaging_service_sid', 'Messaging service SID (optional)', false, false, 'Starts with MG. Used instead of the sender number when set (SMS).'],
        ]],
        'infobip' => ['name' => 'Infobip', 'channels' => ['sms', 'whatsapp'], 'template' => ['whatsapp'], 'fields' => [
            ['base_url', 'API base URL', false, true, 'Your own URL from the Infobip portal, e.g. xxxxx.api.infobip.com'],
            ['api_key', 'API key', true, true, 'Infobip portal › Developers › API keys'],
            ['dlt_entity_id', 'DLT principal entity ID (India)', false, false, 'Only for India: your DLT entity ID'],
        ]],
        'meta' => ['name' => 'WhatsApp Cloud API (Meta)', 'channels' => ['whatsapp'], 'template' => ['whatsapp'], 'fields' => [
            ['phone_number_id', 'Phone number ID', false, true, 'Meta for Developers › WhatsApp › API setup'],
            ['access_token', 'Access token (permanent)', true, true, 'A system-user token with whatsapp_business_messaging'],
            ['app_secret', 'App secret', true, false, 'App settings › Basic – used to check that delivery reports really come from Meta'],
            ['graph_version', 'Graph API version', false, false, 'Default v24.0'],
        ]],
        'msg91' => ['name' => 'MSG91', 'channels' => ['sms'], 'template' => ['sms'], 'fields' => [
            ['auth_key', 'Auth key', true, true, 'MSG91 › API › Auth key'],
        ]],
        'gupshup' => ['name' => 'Gupshup', 'channels' => ['whatsapp'], 'template' => ['whatsapp'], 'fields' => [
            ['api_key', 'API key', true, true, 'Gupshup dashboard › your app'],
            ['app_name', 'App name', false, true, 'The Gupshup app name (src.name)'],
        ]],
        'unifonic' => ['name' => 'Unifonic', 'channels' => ['sms'], 'template' => [], 'fields' => [
            ['app_sid', 'App SID', true, true, 'Unifonic console › Applications'],
        ]],
        'africastalking' => ['name' => "Africa's Talking", 'channels' => ['sms'], 'template' => [], 'fields' => [
            ['username', 'Username', false, true, "Your app's username ('sandbox' for testing)"],
            ['api_key', 'API key', true, true, "Africa's Talking › Settings › API key"],
        ]],
        'whapi' => ['name' => 'Whapi.Cloud', 'channels' => ['whatsapp'], 'template' => [], 'fields' => [
            ['token', 'Channel token', true, true, 'Whapi dashboard › your channel'],
            ['base_url', 'API URL', false, false, 'Default https://gate.whapi.cloud'],
        ]],
        'generic' => ['name' => 'Other SMS gateway (HTTP)', 'channels' => ['sms'], 'template' => [], 'fields' => [
            ['url', 'URL', true, true, 'Placeholders: {to} (+E.164), {to_digits}, {text}, {sender}, {template}'],
            ['method', 'Method (GET or POST)', false, false, 'Default POST'],
            ['body', 'Body (POST)', true, false, 'Same placeholders; leave empty for none'],
            ['content_type', 'Body type (form or json)', false, false, 'Default form'],
            ['headers', 'Headers', true, false, 'One per line, e.g. Authorization: Bearer xxxx'],
            ['success_contains', 'Reply must contain (optional)', false, false, 'e.g. "success"'],
            ['id_field', 'Message ID field in the reply (optional)', false, false, 'e.g. data.id'],
        ]],
    ];

    /** Meta / Infobip language codes for the app languages (a template name can also say "name:en_US"). */
    private const WA_LANG = ['en' => 'en', 'ar' => 'ar', 'hi' => 'hi', 'ur' => 'ur', 'fr' => 'fr', 'es' => 'es'];

    public static function supports(string $provider, string $channel): bool
    {
        return in_array($channel, self::LIST[$provider]['channels'] ?? [], true);
    }

    public static function needsTemplate(string $provider, string $channel, array $cfg = []): bool
    {
        if ($provider === 'infobip' && $channel === 'sms') {
            return trim((string)($cfg['dlt_entity_id'] ?? '')) !== '';   // India DLT through Infobip
        }

        return in_array($channel, self::LIST[$provider]['template'] ?? [], true);
    }

    // ── Sending ────────────────────────────────────────────────────────────

    public static function send(string $provider, string $channel, array $cfg, array $m): array
    {
        if (!self::supports($provider, $channel)) {
            return self::fail('This provider does not send ' . $channel . '.');
        }
        try {
            return match ($provider) {
                'twilio' => self::twilio($channel, $cfg, $m),
                'infobip' => self::infobip($channel, $cfg, $m),
                'meta' => self::meta($cfg, $m),
                'msg91' => self::msg91($cfg, $m),
                'gupshup' => self::gupshup($cfg, $m),
                'unifonic' => self::unifonic($cfg, $m),
                'africastalking' => self::africastalking($cfg, $m),
                'whapi' => self::whapi($cfg, $m),
                'generic' => self::generic($cfg, $m),
            };
        } catch (\DomainException $e) {
            return self::fail($e->getMessage());
        } catch (\Throwable $e) {
            return self::fail($e->getMessage(), true);
        }
    }

    private static function digits(string $e164): string
    {
        return preg_replace('/\D/', '', $e164);
    }

    private static function twilio(string $channel, array $cfg, array $m): array
    {
        $sid = trim((string)$cfg['account_sid']);
        $f = ['To' => ($channel === 'whatsapp' ? 'whatsapp:' : '') . $m['to']];
        if ($channel === 'sms' && trim((string)($cfg['messaging_service_sid'] ?? '')) !== '') {
            $f['MessagingServiceSid'] = trim((string)$cfg['messaging_service_sid']);
        } else {
            $f['From'] = ($channel === 'whatsapp' ? 'whatsapp:' : '') . $m['sender'];
        }
        if ($channel === 'whatsapp') {
            if (empty($m['template'])) {
                return self::fail('No WhatsApp template (Content SID) for this message.');
            }
            $f['ContentSid'] = $m['template'];
            $vars = [];
            foreach (array_values($m['vars']) as $i => $v) {
                $vars[(string)($i + 1)] = (string)$v;
            }
            $f['ContentVariables'] = json_encode((object)$vars, JSON_UNESCAPED_UNICODE);
        } else {
            $f['Body'] = $m['text'];
        }
        if (!empty($m['callback'])) {
            $f['StatusCallback'] = $m['callback'];
        }
        [$code, $body] = self::http('POST', "https://api.twilio.com/2010-04-01/Accounts/" . rawurlencode($sid) . '/Messages.json',
            ['Authorization: Basic ' . base64_encode($sid . ':' . $cfg['auth_token']), 'Content-Type: application/x-www-form-urlencoded'], http_build_query($f));
        $j = json_decode($body, true) ?: [];
        if ($code >= 200 && $code < 300 && !empty($j['sid'])) {
            return self::ok((string)$j['sid'], isset($j['price']) && $j['price'] !== null ? abs((float)$j['price']) : null);
        }

        return self::fail((string)($j['message'] ?? "HTTP $code"), self::retryable($code));
    }

    private static function infobipBase(array $cfg): string
    {
        $b = rtrim(trim((string)$cfg['base_url']), '/');

        return preg_match('#^https?://#i', $b) ? $b : 'https://' . $b;
    }

    private static function infobip(string $channel, array $cfg, array $m): array
    {
        $h = ['Authorization: App ' . $cfg['api_key'], 'Content-Type: application/json', 'Accept: application/json'];
        if ($channel === 'sms') {
            $msg = ['from' => $m['sender'], 'destinations' => [['to' => self::digits($m['to'])]], 'text' => $m['text']];
            if (!empty($m['callback'])) {
                $msg['notifyUrl'] = $m['callback'];
                $msg['notifyContentType'] = 'application/json';
            }
            if (trim((string)($cfg['dlt_entity_id'] ?? '')) !== '') {
                if (empty($m['template'])) {
                    return self::fail('No DLT template ID for this message.');
                }
                $msg['regional'] = ['indiaDlt' => ['principalEntityId' => trim((string)$cfg['dlt_entity_id']), 'contentTemplateId' => $m['template']]];
            }
            [$code, $body] = self::http('POST', self::infobipBase($cfg) . '/sms/2/text/advanced', $h, json_encode(['messages' => [$msg]], JSON_UNESCAPED_UNICODE));
        } else {
            if (empty($m['template'])) {
                return self::fail('No WhatsApp template name for this message.');
            }
            [$name, $lang] = self::waName((string)$m['template'], (string)$m['lang']);
            $msg = ['from' => self::digits((string)$m['sender']), 'to' => self::digits($m['to']),
                'content' => ['templateName' => $name, 'templateData' => ['body' => ['placeholders' => array_map('strval', array_values($m['vars']))]], 'language' => $lang]];
            if (!empty($m['callback'])) {
                $msg['notifyUrl'] = $m['callback'];
            }
            [$code, $body] = self::http('POST', self::infobipBase($cfg) . '/whatsapp/1/message/template', $h, json_encode(['messages' => [$msg]], JSON_UNESCAPED_UNICODE));
        }
        $j = json_decode($body, true) ?: [];
        $first = $j['messages'][0] ?? $j;
        $group = strtoupper((string)($first['status']['groupName'] ?? ''));
        if ($code >= 200 && $code < 300 && !empty($first['messageId']) && !in_array($group, ['REJECTED', 'UNDELIVERABLE'], true)) {
            return self::ok((string)$first['messageId']);
        }
        $err = $j['requestError']['serviceException']['text'] ?? $j['description'] ?? $first['status']['description'] ?? "HTTP $code";

        return self::fail((string)$err, self::retryable($code));
    }

    /** "absent_today" or "absent_today:en_US" → [name, language code] */
    private static function waName(string $ref, string $lang): array
    {
        if (str_contains($ref, ':')) {
            [$n, $l] = explode(':', $ref, 2);

            return [trim($n), trim($l)];
        }

        return [trim($ref), self::WA_LANG[$lang] ?? 'en'];
    }

    private static function graph(array $cfg): string
    {
        $v = trim((string)($cfg['graph_version'] ?? '')) ?: 'v24.0';

        return 'https://graph.facebook.com/' . (str_starts_with($v, 'v') ? $v : 'v' . $v);
    }

    private static function meta(array $cfg, array $m): array
    {
        if (empty($m['template'])) {
            return self::fail('No WhatsApp template name for this message.');
        }
        [$name, $lang] = self::waName((string)$m['template'], (string)$m['lang']);
        $params = array_map(fn($v) => ['type' => 'text', 'text' => (string)$v], array_values($m['vars']));
        $tpl = ['name' => $name, 'language' => ['code' => $lang]];
        if ($params) {
            $tpl['components'] = [['type' => 'body', 'parameters' => $params]];
        }
        [$code, $body] = self::http('POST', self::graph($cfg) . '/' . rawurlencode(trim((string)$cfg['phone_number_id'])) . '/messages',
            ['Authorization: Bearer ' . $cfg['access_token'], 'Content-Type: application/json'],
            json_encode(['messaging_product' => 'whatsapp', 'to' => self::digits($m['to']), 'type' => 'template', 'template' => $tpl], JSON_UNESCAPED_UNICODE));
        $j = json_decode($body, true) ?: [];
        if ($code >= 200 && $code < 300 && !empty($j['messages'][0]['id'])) {
            return self::ok((string)$j['messages'][0]['id']);
        }
        $ec = (int)($j['error']['code'] ?? 0);

        return self::fail((string)($j['error']['error_data']['details'] ?? $j['error']['message'] ?? "HTTP $code"),
            self::retryable($code) || in_array($ec, [4, 80007, 130429, 131048, 131056], true));
    }

    private static function msg91(array $cfg, array $m): array
    {
        if (empty($m['template'])) {
            return self::fail('No DLT template (MSG91 template ID) for this message.');
        }
        $rcp = ['mobiles' => self::digits($m['to'])];
        foreach (array_values($m['vars']) as $i => $v) {
            $rcp['var' . ($i + 1)] = (string)$v;
        }
        [$code, $body] = self::http('POST', 'https://control.msg91.com/api/v5/flow/',
            ['authkey: ' . $cfg['auth_key'], 'Content-Type: application/json', 'Accept: application/json'],
            json_encode(['template_id' => $m['template'], 'short_url' => '0', 'recipients' => [$rcp]], JSON_UNESCAPED_UNICODE));
        $j = json_decode($body, true) ?: [];
        if ($code >= 200 && $code < 300 && ($j['type'] ?? '') === 'success') {
            return self::ok((string)($j['message'] ?? ''));
        }

        return self::fail((string)($j['message'] ?? "HTTP $code"), self::retryable($code));
    }

    private static function gupshup(array $cfg, array $m): array
    {
        if (empty($m['template'])) {
            return self::fail('No WhatsApp template ID for this message.');
        }
        $f = ['channel' => 'whatsapp', 'source' => self::digits((string)$m['sender']), 'destination' => self::digits($m['to']), 'src.name' => (string)$cfg['app_name'],
            'template' => json_encode(['id' => $m['template'], 'params' => array_map('strval', array_values($m['vars']))], JSON_UNESCAPED_UNICODE)];
        [$code, $body] = self::http('POST', 'https://api.gupshup.io/wa/api/v1/template/msg',
            ['apikey: ' . $cfg['api_key'], 'Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'], http_build_query($f));
        $j = json_decode($body, true) ?: [];
        if ($code >= 200 && $code < 300 && ($j['status'] ?? '') === 'submitted' && !empty($j['messageId'])) {
            return self::ok((string)$j['messageId']);
        }

        return self::fail((string)($j['message'] ?? "HTTP $code"), self::retryable($code));
    }

    private static function unifonic(array $cfg, array $m): array
    {
        [$code, $body] = self::http('POST', 'https://el.cloud.unifonic.com/rest/SMS/messages', ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
            http_build_query(['AppSid' => $cfg['app_sid'], 'SenderID' => $m['sender'], 'Recipient' => self::digits($m['to']), 'Body' => $m['text'], 'responseType' => 'JSON']));
        $j = json_decode($body, true) ?: [];
        if ($code >= 200 && $code < 300 && !empty($j['success']) && !empty($j['data']['MessageID'])) {
            return self::ok((string)$j['data']['MessageID'], isset($j['data']['Cost']) ? (float)$j['data']['Cost'] : null);
        }

        return self::fail((string)(($j['message'] ?? '') ?: ($j['errorCode'] ?? "HTTP $code")), self::retryable($code));
    }

    private static function atBase(array $cfg): string
    {
        return strtolower(trim((string)$cfg['username'])) === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    }

    private static function africastalking(array $cfg, array $m): array
    {
        $f = ['username' => trim((string)$cfg['username']), 'to' => $m['to'], 'message' => $m['text']];
        if (trim((string)$m['sender']) !== '') {
            $f['from'] = trim((string)$m['sender']);
        }
        [$code, $body] = self::http('POST', self::atBase($cfg) . '/version1/messaging',
            ['apiKey: ' . $cfg['api_key'], 'Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'], http_build_query($f));
        $j = json_decode($body, true) ?: [];
        $r = $j['SMSMessageData']['Recipients'][0] ?? null;
        if ($code >= 200 && $code < 300 && $r && in_array((int)($r['statusCode'] ?? 0), [100, 101, 102], true)) {
            $cost = preg_match('/([\d.]+)/', (string)($r['cost'] ?? ''), $c) ? (float)$c[1] : null;

            return self::ok((string)$r['messageId'], $cost);
        }

        return self::fail((string)($r['status'] ?? ($j['SMSMessageData']['Message'] ?? "HTTP $code")), self::retryable($code));
    }

    private static function whapiBase(array $cfg): string
    {
        return rtrim(trim((string)($cfg['base_url'] ?? '')) ?: 'https://gate.whapi.cloud', '/');
    }

    private static function whapi(array $cfg, array $m): array
    {
        [$code, $body] = self::http('POST', self::whapiBase($cfg) . '/messages/text',
            ['Authorization: Bearer ' . $cfg['token'], 'Content-Type: application/json', 'Accept: application/json'],
            json_encode(['to' => self::digits($m['to']), 'body' => $m['text']], JSON_UNESCAPED_UNICODE));
        $j = json_decode($body, true) ?: [];
        $id = $j['message']['id'] ?? $j['id'] ?? null;
        if ($code >= 200 && $code < 300 && ($j['sent'] ?? true) && $id) {
            return self::ok((string)$id);
        }

        return self::fail((string)($j['error']['message'] ?? $j['message'] ?? "HTTP $code"), self::retryable($code));
    }

    private static function generic(array $cfg, array $m): array
    {
        $vals = ['to' => $m['to'], 'to_digits' => self::digits($m['to']), 'text' => $m['text'], 'sender' => (string)$m['sender'], 'template' => (string)($m['template'] ?? '')];
        $fill = function (string $tpl, callable $enc) use ($vals) {
            return (string)preg_replace_callback('/\{(to|to_digits|text|sender|template)\}/', fn($x) => $enc($vals[$x[1]]), $tpl);
        };
        $url = $fill(trim((string)$cfg['url']), 'rawurlencode');
        if (!preg_match('#^https://#i', $url)) {
            return self::fail('The gateway URL must start with https://');
        }
        $method = strtoupper(trim((string)($cfg['method'] ?? ''))) === 'GET' ? 'GET' : 'POST';
        $json = strtolower(trim((string)($cfg['content_type'] ?? ''))) === 'json';
        $body = null;
        if ($method === 'POST' && trim((string)($cfg['body'] ?? '')) !== '') {
            $body = $fill((string)$cfg['body'], $json ? fn($v) => substr((string)json_encode((string)$v, JSON_UNESCAPED_UNICODE), 1, -1) : 'rawurlencode');
        }
        $h = [$json ? 'Content-Type: application/json' : 'Content-Type: application/x-www-form-urlencoded'];
        foreach (preg_split('/\r?\n/', (string)($cfg['headers'] ?? '')) as $line) {
            if (preg_match('/^\s*([A-Za-z0-9-]+)\s*:\s*(.+)$/', $line, $x)) {
                $h[] = $x[1] . ': ' . trim($x[2]);
            }
        }
        [$code, $resp] = self::http($method, $url, $h, $body);
        $need = trim((string)($cfg['success_contains'] ?? ''));
        if ($code >= 200 && $code < 300 && ($need === '' || stripos($resp, $need) !== false)) {
            $id = null;
            if (trim((string)($cfg['id_field'] ?? '')) !== '' && is_array($j = json_decode($resp, true))) {
                foreach (explode('.', trim((string)$cfg['id_field'])) as $k) {
                    $j = is_array($j) ? ($j[$k] ?? null) : null;
                }
                $id = is_scalar($j) ? (string)$j : null;
            }

            return self::ok($id ?? 'gw-' . substr(sha1($resp . microtime()), 0, 16));
        }

        // the reply itself is never shown (it could contain anything the gateway returns)
        return self::fail($code >= 200 && $code < 300 ? 'The gateway did not confirm the message.' : "The gateway refused the message (HTTP $code).", self::retryable($code));
    }

    // ── Checking the settings ──────────────────────────────────────────────

    public static function test(string $provider, string $channel, array $cfg): array
    {
        try {
            [$method, $url, $h] = match ($provider) {
                'twilio' => ['GET', 'https://api.twilio.com/2010-04-01/Accounts/' . rawurlencode(trim((string)$cfg['account_sid'])) . '.json',
                    ['Authorization: Basic ' . base64_encode(trim((string)$cfg['account_sid']) . ':' . $cfg['auth_token'])]],
                'infobip' => ['GET', self::infobipBase($cfg) . '/account/1/balance', ['Authorization: App ' . $cfg['api_key'], 'Accept: application/json']],
                'meta' => ['GET', self::graph($cfg) . '/' . rawurlencode(trim((string)$cfg['phone_number_id'])) . '?fields=display_phone_number,verified_name',
                    ['Authorization: Bearer ' . $cfg['access_token']]],
                'msg91' => ['GET', 'https://control.msg91.com/api/balance.php?type=4&authkey=' . rawurlencode((string)$cfg['auth_key']), []],
                'gupshup' => ['GET', 'https://api.gupshup.io/sm/api/v2/wallet/balance', ['apikey: ' . $cfg['api_key'], 'Accept: application/json']],
                'unifonic' => ['POST', 'https://el.cloud.unifonic.com/rest/Account/GetBalance', ['Content-Type: application/x-www-form-urlencoded']],
                'africastalking' => ['GET', self::atBase($cfg) . '/version1/user?username=' . rawurlencode(trim((string)$cfg['username'])),
                    ['apiKey: ' . $cfg['api_key'], 'Accept: application/json']],
                'whapi' => ['GET', self::whapiBase($cfg) . '/health', ['Authorization: Bearer ' . $cfg['token'], 'Accept: application/json']],
                'generic' => [null, null, []],
            };
            if ($method === null) {
                return ['ok' => true, 'error' => null, 'info' => 'Send a test message to check this gateway.'];
            }
            [$code, $body] = self::http($method, $url, $h, $provider === 'unifonic' ? http_build_query(['AppSid' => $cfg['app_sid'], 'responseType' => 'JSON']) : null);
            $j = json_decode($body, true);
            $good = $code >= 200 && $code < 300 && !($provider === 'unifonic' && is_array($j) && empty($j['success']))
                && !($provider === 'msg91' && !is_numeric(trim($body)) && !is_array($j));
            if ($good) {
                $info = match ($provider) {
                    'meta' => (string)($j['verified_name'] ?? '') . ' ' . (string)($j['display_phone_number'] ?? ''),
                    'twilio' => (string)($j['friendly_name'] ?? ''),
                    'infobip' => isset($j['balance']) ? $j['balance'] . ' ' . ($j['currency'] ?? '') : '',
                    'africastalking' => (string)($j['UserData']['balance'] ?? ''),
                    'msg91' => trim($body) . ' SMS',
                    default => '',
                };

                return ['ok' => true, 'error' => null, 'info' => trim($info)];
            }
            $err = is_array($j) ? ($j['message'] ?? $j['error']['message'] ?? $j['requestError']['serviceException']['text'] ?? null) : null;
            $err = is_string($err) ? mb_substr($err, 0, 160) : null;

            return ['ok' => false, 'error' => $code === 0 ? 'The provider could not be reached.' : (string)($err ?: ($code === 401 || $code === 403 ? 'The keys were not accepted.' : "HTTP $code")), 'info' => null];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => $e->getMessage(), 'info' => null];
        }
    }

    // ── Webhooks: delivery reports and replies ─────────────────────────────

    /** Map a provider's status to sent / delivered / read / failed. */
    private static function state(string $s): ?string
    {
        $s = strtolower(trim($s));

        return match (true) {
            in_array($s, ['delivered', 'success', 'delivered_to_handset', '1'], true) => 'delivered',
            in_array($s, ['read', 'played'], true) => 'read',
            in_array($s, ['failed', 'undelivered', 'undeliverable', 'rejected', 'expired', 'absentsubscriber', '2', '9', '16', '17', '20', '25'], true) => 'failed',
            in_array($s, ['sent', 'queued', 'sending', 'accepted', 'submitted', 'buffered', 'enqueued', 'pending', '0'], true) => 'sent',
            default => null,
        };
    }

    /** $req: method, query, form, json, raw, headers (lower-case keys), url */
    public static function parseHook(string $provider, array $req): array
    {
        $out = ['statuses' => [], 'inbound' => [], 'reply' => null];
        $form = (array)($req['form'] ?? []);
        $j = is_array($req['json'] ?? null) ? $req['json'] : [];
        switch ($provider) {
            case 'twilio':
                if (!empty($form['MessageSid']) && !empty($form['MessageStatus'])) {
                    $out['statuses'][] = [(string)$form['MessageSid'], self::state((string)$form['MessageStatus']), !empty($form['ErrorCode']) ? 'Error ' . $form['ErrorCode'] : null];
                } elseif (isset($form['Body'], $form['From'])) {
                    $wa = str_starts_with(strtolower((string)$form['From']), 'whatsapp:');
                    $out['inbound'][] = [preg_replace('/^whatsapp:/i', '', (string)$form['From']), (string)$form['Body'], $wa ? 'whatsapp' : 'sms'];
                }
                break;
            case 'infobip':
                foreach ((array)($j['results'] ?? []) as $r) {
                    if (isset($r['status'])) {
                        $g = (string)($r['status']['groupName'] ?? $r['status']['name'] ?? '');
                        $out['statuses'][] = [(string)($r['messageId'] ?? ''), self::state($g), isset($r['error']['name']) && ($r['error']['groupName'] ?? 'OK') !== 'OK' ? (string)$r['error']['name'] : null];
                    } elseif (isset($r['from'])) {
                        $text = $r['text'] ?? $r['cleanText'] ?? ($r['message']['text'] ?? '');
                        $out['inbound'][] = [(string)$r['from'], (string)$text, isset($r['message']) ? 'whatsapp' : 'sms'];
                    }
                }
                break;
            case 'meta':
                if (strtoupper((string)($req['method'] ?? '')) === 'GET') {
                    $q = (array)($req['query'] ?? []);
                    $out['reply'] = ['token' => (string)($q['hub_verify_token'] ?? $q['hub.verify_token'] ?? ''), 'challenge' => (string)($q['hub_challenge'] ?? $q['hub.challenge'] ?? '')];
                    break;
                }
                foreach ((array)($j['entry'] ?? []) as $e) {
                    foreach ((array)($e['changes'] ?? []) as $c) {
                        $v = (array)($c['value'] ?? []);
                        foreach ((array)($v['statuses'] ?? []) as $s) {
                            $out['statuses'][] = [(string)($s['id'] ?? ''), self::state((string)($s['status'] ?? '')), isset($s['errors'][0]) ? (string)($s['errors'][0]['title'] ?? $s['errors'][0]['message'] ?? 'Error') : null];
                        }
                        foreach ((array)($v['messages'] ?? []) as $msg) {
                            $out['inbound'][] = [(string)($msg['from'] ?? ''), (string)($msg['text']['body'] ?? $msg['button']['text'] ?? ''), 'whatsapp'];
                        }
                    }
                }
                break;
            case 'msg91':
                $list = isset($j['data']) && is_array($j['data']) ? $j['data'] : (array_is_list($j) ? $j : [$j]);
                foreach ($list as $r) {
                    if (is_array($r) && isset($r['requestId'])) {
                        $out['statuses'][] = [(string)$r['requestId'], self::state((string)($r['status'] ?? '')), !empty($r['failureReason']) ? (string)$r['failureReason'] : null];
                    }
                }
                break;
            case 'gupshup':
                $p = (array)($j['payload'] ?? []);
                if (($j['type'] ?? '') === 'message-event') {
                    $st = self::state((string)($p['type'] ?? ''));
                    $err = isset($p['payload']['reason']) ? (string)$p['payload']['reason'] : null;
                    foreach (array_unique(array_filter([(string)($p['gsId'] ?? ''), (string)($p['id'] ?? '')])) as $id) {
                        $out['statuses'][] = [$id, $st, $err];
                    }
                } elseif (($j['type'] ?? '') === 'message') {
                    $out['inbound'][] = [(string)($p['source'] ?? $p['sender']['phone'] ?? ''), (string)($p['payload']['text'] ?? ''), 'whatsapp'];
                }
                break;
            case 'africastalking':
                if (isset($form['id'], $form['status'])) {
                    $out['statuses'][] = [(string)$form['id'], self::state((string)$form['status']), !empty($form['failureReason']) ? (string)$form['failureReason'] : null];
                } elseif (isset($form['from'], $form['text'])) {
                    $out['inbound'][] = [(string)$form['from'], (string)$form['text'], 'sms'];
                }
                break;
            case 'whapi':
                foreach ((array)($j['statuses'] ?? []) as $s) {
                    $out['statuses'][] = [(string)($s['id'] ?? ''), self::state((string)($s['status'] ?? $s['code'] ?? '')), null];
                }
                foreach ((array)($j['messages'] ?? []) as $msg) {
                    if (empty($msg['from_me'])) {
                        $out['inbound'][] = [(string)($msg['from'] ?? ''), (string)($msg['text']['body'] ?? ''), 'whatsapp'];
                    }
                }
                break;
        }
        $out['statuses'] = array_values(array_filter($out['statuses'], fn($s) => $s[0] !== '' && $s[1] !== null));

        return $out;
    }

    /** The URL carries the school's secret key (checked by the caller); providers that sign their webhooks are checked too. */
    public static function verifyHook(string $provider, array $cfg, array $req): bool
    {
        $h = (array)($req['headers'] ?? []);
        if ($provider === 'meta' && trim((string)($cfg['app_secret'] ?? '')) !== '' && strtoupper((string)($req['method'] ?? '')) === 'POST') {
            $sig = (string)($h['x-hub-signature-256'] ?? '');

            return $sig !== '' && hash_equals('sha256=' . hash_hmac('sha256', (string)($req['raw'] ?? ''), (string)$cfg['app_secret']), $sig);
        }
        if ($provider === 'twilio' && trim((string)($cfg['auth_token'] ?? '')) !== '') {
            $sig = (string)($h['x-twilio-signature'] ?? '');
            if ($sig === '') {
                return false;
            }
            $form = (array)($req['form'] ?? []);
            ksort($form, SORT_STRING);
            $data = '';
            foreach ($form as $k => $v) {
                $data .= $k . (is_array($v) ? implode('', $v) : $v);
            }
            $url = (string)($req['url'] ?? '');
            // behind a proxy the scheme the app sees may differ from the public one
            foreach (array_unique([$url, preg_replace('#^http://#', 'https://', $url), preg_replace('#^https://#', 'http://', $url)]) as $u) {
                if (hash_equals(base64_encode(hash_hmac('sha1', $u . $data, (string)$cfg['auth_token'], true)), $sig)) {
                    return true;
                }
            }

            return false;
        }

        return true;
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /** https only, and never an address inside the server's own network (school-typed URLs: generic gateway, Infobip / Whapi base URL). */
    public static function publicUrl(string $url): bool
    {
        $p = parse_url($url);
        if (!$p || strtolower((string)($p['scheme'] ?? '')) !== 'https' || empty($p['host']) || isset($p['user']) || isset($p['pass'])) {
            return false;
        }
        $host = trim((string)$p['host'], '[]');
        if (strtolower($host) === 'localhost' || str_ends_with(strtolower($host), '.local') || str_ends_with(strtolower($host), '.internal')) {
            return false;
        }
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
        foreach ($ips as $ip) {
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return false;
            }
        }

        return true;
    }

    private static function ok(string $id, ?float $cost = null): array
    {
        return ['ok' => true, 'id' => $id, 'cost' => $cost, 'error' => null, 'retry' => false];
    }

    private static function fail(string $error, bool $retry = false): array
    {
        return ['ok' => false, 'id' => null, 'cost' => null, 'error' => mb_substr($error, 0, 240), 'retry' => $retry];
    }

    private static function retryable(int $code): bool
    {
        return $code === 0 || $code === 429 || $code >= 500;
    }

    /** → [http code (0 = not reached), body] */
    private static function http(string $method, string $url, array $headers, ?string $body): array
    {
        if (!self::publicUrl($url)) {
            throw new \DomainException('The provider address must be a public https:// address.');
        }
        if (is_callable(self::$http)) {
            return (self::$http)($method, $url, $headers, $body);
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_HTTPHEADER => $headers, CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $res = curl_exec($ch);
        $code = $res === false ? 0 : (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return [$code, $res === false ? '' : (string)$res];
    }
}
