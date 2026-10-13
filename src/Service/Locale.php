<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * School locale – currency, number / date / time formats, time zone and local labels (tax, postal code).
 *
 * Stored per school in ssms_locale_settings; anything not set comes from the country's preset
 * (ssms_clients.country_code). The currency symbol and time zone are also kept in ssms_clients
 * (currency, timezone) because older screens and Meetings::tz() read them there.
 *
 * "Today" for a school is always the school's local date (Locale::today), never the server's UTC date.
 */
class Locale
{
    public const NUMBER_FORMATS = [
        'intl'   => ['label' => '1,234,567.89', 'group' => ',', 'decimal' => '.'],
        'indian' => ['label' => '12,34,567.89 (lakh / crore)', 'group' => ',', 'decimal' => '.'],
        'eu'     => ['label' => '1.234.567,89', 'group' => '.', 'decimal' => ','],
        'space'  => ['label' => '1 234 567,89', 'group' => ' ', 'decimal' => ','],
        'swiss'  => ['label' => "1'234'567.89", 'group' => "'", 'decimal' => '.'],
    ];
    public const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD.MM.YYYY'];
    public const TIME_FORMATS = ['12h', '24h'];
    public const CURRENCY_POSITIONS = ['before' => '₹100', 'before_space' => '₹ 100', 'after_space' => '100 ₹'];
    /** App and message languages (translations in resources/i18n/<code>.json, keyed by the English text). */
    public const LANGUAGES = ['en' => 'English', 'ar' => 'العربية (Arabic)', 'hi' => 'हिन्दी (Hindi)', 'ur' => 'اردو (Urdu)', 'fr' => 'Français (French)', 'es' => 'Español (Spanish)'];
    public const RTL_LANGUAGES = ['ar', 'ur'];

    /** country => [name, currency code, symbol, position, number, date, time, tax, postal, timezone, week start (1 = Monday)] */
    public const PRESETS = [
        'IN' => ['India', 'INR', '₹', 'before_space', 'indian', 'DD/MM/YYYY', '12h', 'GST', 'PIN code', 'Asia/Kolkata', 1],
        'PK' => ['Pakistan', 'PKR', 'Rs', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'GST', 'Postal code', 'Asia/Karachi', 1],
        'BD' => ['Bangladesh', 'BDT', '৳', 'before_space', 'indian', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Asia/Dhaka', 6],
        'LK' => ['Sri Lanka', 'LKR', 'Rs', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Asia/Colombo', 1],
        'NP' => ['Nepal', 'NPR', 'Rs', 'before_space', 'indian', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Asia/Kathmandu', 7],
        'AE' => ['United Arab Emirates', 'AED', 'AED', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'P.O. Box', 'Asia/Dubai', 1],
        'SA' => ['Saudi Arabia', 'SAR', 'SAR', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Asia/Riyadh', 7],
        'QA' => ['Qatar', 'QAR', 'QAR', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'Tax', 'P.O. Box', 'Asia/Qatar', 7],
        'KW' => ['Kuwait', 'KWD', 'KWD', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'Tax', 'Postal code', 'Asia/Kuwait', 7],
        'OM' => ['Oman', 'OMR', 'OMR', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'P.O. Box', 'Asia/Muscat', 7],
        'BH' => ['Bahrain', 'BHD', 'BHD', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'P.O. Box', 'Asia/Bahrain', 7],
        'GB' => ['United Kingdom', 'GBP', '£', 'before', 'intl', 'DD/MM/YYYY', '24h', 'VAT', 'Postcode', 'Europe/London', 1],
        'IE' => ['Ireland', 'EUR', '€', 'before', 'intl', 'DD/MM/YYYY', '24h', 'VAT', 'Eircode', 'Europe/Dublin', 1],
        'US' => ['United States', 'USD', '$', 'before', 'intl', 'MM/DD/YYYY', '12h', 'Sales tax', 'ZIP code', 'America/New_York', 7],
        'CA' => ['Canada', 'CAD', '$', 'before', 'intl', 'YYYY-MM-DD', '12h', 'GST/HST', 'Postal code', 'America/Toronto', 7],
        'AU' => ['Australia', 'AUD', '$', 'before', 'intl', 'DD/MM/YYYY', '12h', 'GST', 'Postcode', 'Australia/Sydney', 1],
        'NZ' => ['New Zealand', 'NZD', '$', 'before', 'intl', 'DD/MM/YYYY', '12h', 'GST', 'Postcode', 'Pacific/Auckland', 1],
        'SG' => ['Singapore', 'SGD', 'S$', 'before', 'intl', 'DD/MM/YYYY', '12h', 'GST', 'Postal code', 'Asia/Singapore', 1],
        'MY' => ['Malaysia', 'MYR', 'RM', 'before', 'intl', 'DD/MM/YYYY', '12h', 'SST', 'Postcode', 'Asia/Kuala_Lumpur', 1],
        'ID' => ['Indonesia', 'IDR', 'Rp', 'before_space', 'eu', 'DD/MM/YYYY', '24h', 'PPN', 'Postal code', 'Asia/Jakarta', 1],
        'PH' => ['Philippines', 'PHP', '₱', 'before', 'intl', 'MM/DD/YYYY', '12h', 'VAT', 'ZIP code', 'Asia/Manila', 7],
        'ZA' => ['South Africa', 'ZAR', 'R', 'before_space', 'space', 'YYYY-MM-DD', '24h', 'VAT', 'Postal code', 'Africa/Johannesburg', 7],
        'NG' => ['Nigeria', 'NGN', '₦', 'before', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Africa/Lagos', 1],
        'KE' => ['Kenya', 'KES', 'KSh', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Africa/Nairobi', 1],
        'GH' => ['Ghana', 'GHS', 'GH₵', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Africa/Accra', 1],
        'EG' => ['Egypt', 'EGP', 'E£', 'before_space', 'intl', 'DD/MM/YYYY', '12h', 'VAT', 'Postal code', 'Africa/Cairo', 7],
        'DE' => ['Germany', 'EUR', '€', 'after_space', 'eu', 'DD.MM.YYYY', '24h', 'MwSt', 'Postleitzahl', 'Europe/Berlin', 1],
        'FR' => ['France', 'EUR', '€', 'after_space', 'space', 'DD/MM/YYYY', '24h', 'TVA', 'Code postal', 'Europe/Paris', 1],
        'ES' => ['Spain', 'EUR', '€', 'after_space', 'eu', 'DD/MM/YYYY', '24h', 'IVA', 'Código postal', 'Europe/Madrid', 1],
        'IT' => ['Italy', 'EUR', '€', 'after_space', 'eu', 'DD/MM/YYYY', '24h', 'IVA', 'CAP', 'Europe/Rome', 1],
        'NL' => ['Netherlands', 'EUR', '€', 'before_space', 'eu', 'DD-MM-YYYY', '24h', 'BTW', 'Postcode', 'Europe/Amsterdam', 1],
        'CH' => ['Switzerland', 'CHF', 'CHF', 'before_space', 'swiss', 'DD.MM.YYYY', '24h', 'MWST', 'Postal code', 'Europe/Zurich', 1],
        'TR' => ['Turkey', 'TRY', '₺', 'before', 'eu', 'DD.MM.YYYY', '24h', 'KDV', 'Postal code', 'Europe/Istanbul', 1],
        'JP' => ['Japan', 'JPY', '¥', 'before', 'intl', 'YYYY-MM-DD', '24h', 'Consumption tax', 'Postal code', 'Asia/Tokyo', 7],
        'CN' => ['China', 'CNY', '¥', 'before', 'intl', 'YYYY-MM-DD', '24h', 'VAT', 'Postal code', 'Asia/Shanghai', 1],
        'HK' => ['Hong Kong', 'HKD', 'HK$', 'before', 'intl', 'DD/MM/YYYY', '12h', 'Tax', 'Postal code', 'Asia/Hong_Kong', 7],
    ];
    /** Currencies whose amounts have no minor unit (no decimals). */
    public const ZERO_DECIMAL = ['JPY', 'KRW', 'IDR', 'VND', 'CLP', 'UGX'];
    /** Currencies with three decimals. */
    public const THREE_DECIMAL = ['KWD', 'BHD', 'OMR', 'JOD', 'TND'];

    private static $cache = [];

    // ── Settings ────────────────────────────────────────────────────────────

    public static function preset(?string $country): array
    {
        $cc = strtoupper(trim((string)$country));
        $p = self::PRESETS[$cc] ?? self::PRESETS['IN'];
        $cc = isset(self::PRESETS[$cc]) ? $cc : 'IN';

        return ['country' => $cc, 'country_name' => $p[0], 'currency_code' => $p[1], 'currency_symbol' => $p[2], 'currency_position' => $p[3],
                'number_format' => $p[4], 'date_format' => $p[5], 'time_format' => $p[6], 'tax_label' => $p[7], 'postal_label' => $p[8],
                'timezone' => $p[9], 'week_start' => $p[10], 'language' => 'en'];
    }

    /** The school's effective locale: saved choices over the country preset. */
    public static function get(string $client): array
    {
        if (isset(self::$cache[$client])) {
            return self::$cache[$client];
        }
        $c = [];
        try {
            $c = self::db()->execute('SELECT * FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc') ?: [];
        } catch (\Throwable $e) {
        }
        $out = self::preset($c['country_code'] ?? 'IN');
        // older columns win over the preset (they were set by the school / billing)
        $sym = trim((string)($c['currency'] ?? ''));
        if ($sym !== '') {
            if (preg_match('/^[A-Za-z]{3}$/', $sym)) {
                $out['currency_code'] = strtoupper($sym);   // some schools typed a code ("INR") rather than a symbol
            } else {
                $out['currency_symbol'] = $sym;
            }
        }
        $tz = trim((string)($c['timezone'] ?? ''));
        if ($tz !== '' && in_array($tz, \DateTimeZone::listIdentifiers(), true)) {
            $out['timezone'] = $tz;
        }
        try {
            $r = self::db()->execute('SELECT * FROM ssms_locale_settings WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc');
            if ($r) {
                foreach (['currency_code', 'currency_symbol', 'currency_position', 'number_format', 'date_format', 'time_format', 'tax_label', 'postal_label', 'language'] as $k) {
                    if (isset($r[$k]) && $r[$k] !== '') {
                        $out[$k] = (string)$r[$k];
                    }
                }
                if (isset($r['week_start']) && $r['week_start'] !== null) {
                    $out['week_start'] = (int)$r['week_start'];
                }
            }
        } catch (\Throwable $e) {
            // table not created yet – preset + ssms_clients
        }
        $out['decimals'] = in_array($out['currency_code'], self::ZERO_DECIMAL, true) ? 0 : (in_array($out['currency_code'], self::THREE_DECIMAL, true) ? 3 : 2);
        $out['group_separator'] = self::NUMBER_FORMATS[$out['number_format']]['group'] ?? ',';
        $out['decimal_separator'] = self::NUMBER_FORMATS[$out['number_format']]['decimal'] ?? '.';

        return self::$cache[$client] = $out;
    }

    public static function resetCache(): void
    {
        self::$cache = [];
        self::$userLangs = [];
        self::$tokenUsers = [];
    }

    /** Lists for the settings screen. */
    public static function options(): array
    {
        $countries = [];
        foreach (self::PRESETS as $cc => $p) {
            $countries[] = ['code' => $cc, 'name' => $p[0], 'preset' => self::preset($cc)];
        }
        usort($countries, fn($a, $b) => strcmp($a['name'], $b['name']));
        $currencies = [];
        foreach (self::PRESETS as $p) {
            $currencies[$p[1]] = ['code' => $p[1], 'symbol' => $p[2]];
        }
        ksort($currencies);

        return ['countries' => $countries, 'currencies' => array_values($currencies), 'number_formats' => array_map(fn($k, $v) => ['value' => $k, 'label' => $v['label']], array_keys(self::NUMBER_FORMATS), self::NUMBER_FORMATS),
                'date_formats' => self::DATE_FORMATS, 'time_formats' => self::TIME_FORMATS, 'currency_positions' => self::CURRENCY_POSITIONS,
                'timezones' => \DateTimeZone::listIdentifiers(), 'languages' => self::LANGUAGES];
    }

    /** Save the school's choices (office: Settings · edit). Also keeps ssms_clients.currency / timezone in step. */
    public static function save(string $client, array $d, string $by): array
    {
        $cur = self::get($client);
        $v = [];
        $code = strtoupper(trim((string)($d['currency_code'] ?? $cur['currency_code'])));
        if (!preg_match('/^[A-Z]{3}$/', $code)) {
            throw new \InvalidArgumentException('The currency code must be 3 letters, e.g. INR, GBP, AED.');
        }
        $v['currency_code'] = $code;
        $sym = trim((string)($d['currency_symbol'] ?? $cur['currency_symbol']));
        if ($sym === '' || mb_strlen($sym) > 6) {
            throw new \InvalidArgumentException('The currency symbol must be 1–6 characters, e.g. ₹, £, AED.');
        }
        $v['currency_symbol'] = $sym;
        $pick = function (string $k, array $allowed, string $label) use ($d, $cur) {
            $x = (string)($d[$k] ?? $cur[$k]);
            if (!in_array($x, $allowed, true)) {
                throw new \InvalidArgumentException("Choose a valid $label.");
            }

            return $x;
        };
        $v['currency_position'] = $pick('currency_position', array_keys(self::CURRENCY_POSITIONS), 'currency position');
        $v['number_format'] = $pick('number_format', array_keys(self::NUMBER_FORMATS), 'number format');
        $v['date_format'] = $pick('date_format', self::DATE_FORMATS, 'date format');
        $v['time_format'] = $pick('time_format', self::TIME_FORMATS, 'time format');
        $v['language'] = $pick('language', array_keys(self::LANGUAGES), 'language');
        foreach (['tax_label' => 'tax name', 'postal_label' => 'postal code name'] as $k => $label) {
            $x = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($d[$k] ?? $cur[$k])) ?? '');
            if ($x === '' || mb_strlen($x) > 30) {
                throw new \InvalidArgumentException("The $label must be 1–30 characters.");
            }
            $v[$k] = $x;
        }
        $ws = (int)($d['week_start'] ?? $cur['week_start']);
        if (!in_array($ws, [1, 6, 7], true)) {
            throw new \InvalidArgumentException('The week starts on Monday, Saturday or Sunday.');
        }
        $v['week_start'] = $ws;
        $tz = trim((string)($d['timezone'] ?? $cur['timezone']));
        if (!in_array($tz, \DateTimeZone::listIdentifiers(), true)) {
            throw new \InvalidArgumentException('Choose a valid time zone, e.g. Asia/Kolkata or Europe/London.');
        }
        $country = strtoupper(trim((string)($d['country'] ?? $cur['country'])));
        if (!isset(self::PRESETS[$country])) {
            throw new \InvalidArgumentException('Choose a country from the list.');
        }
        $now = AccountSecurity::now();
        $cols = array_keys($v);
        self::db()->execute('INSERT INTO ssms_locale_settings (ssms_client_code, ' . implode(', ', $cols) . ', updated_by, modified) VALUES (?' . str_repeat(', ?', count($cols)) . ', ?, ?)
             ON DUPLICATE KEY UPDATE ' . implode(', ', array_map(fn($c) => "$c = VALUES($c)", $cols)) . ', updated_by = VALUES(updated_by), modified = VALUES(modified)',
            array_merge([$client], array_values($v), [mb_substr($by, 0, 100), $now]));
        // older screens read these two from ssms_clients
        self::db()->execute('UPDATE ssms_clients SET currency = ?, timezone = ?, country_code = ? WHERE ssms_client_code = ?', [$sym, $tz, $country, $client]);
        self::resetCache();
        $changed = [];
        $after = self::get($client);
        foreach ($after as $k => $x) {
            if (($cur[$k] ?? null) !== $x) {
                $changed[$k] = ['from' => $cur[$k] ?? null, 'to' => $x];
            }
        }

        return ['locale' => $after, 'changed' => $changed];
    }

    // ── Clock ───────────────────────────────────────────────────────────────

    public static function tz(string $client): \DateTimeZone
    {
        try {
            return new \DateTimeZone(self::get($client)['timezone']);
        } catch (\Throwable $e) {
            return new \DateTimeZone('UTC');
        }
    }

    /** The school's local date (Y-m-d). Use this instead of date('Y-m-d'), which is the server's (UTC) date. */
    public static function today(string $client): string
    {
        return self::now($client, 'Y-m-d');
    }

    /** The school's local date-time. */
    public static function now(string $client, string $format = 'Y-m-d H:i:s'): string
    {
        return (new \DateTimeImmutable('@' . AccountSecurity::time()))->setTimezone(self::tz($client))->format($format);
    }

    // ── Formatting (for e-mails, PDFs and messages made on the server) ─────

    public static function number(string $client, $value, ?int $decimals = null): string
    {
        $l = self::get($client);
        $decimals = $decimals ?? $l['decimals'];
        $n = round((float)$value, $decimals);
        $neg = $n < 0;
        $s = number_format(abs($n), $decimals, '.', '');
        [$int, $frac] = array_pad(explode('.', $s, 2), 2, '');
        if ($l['number_format'] === 'indian' && strlen($int) > 3) {
            $last = substr($int, -3);
            $rest = substr($int, 0, -3);
            $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', $l['group_separator'], $rest);
            $int = $rest . $l['group_separator'] . $last;
        } else {
            $int = preg_replace('/\B(?=(\d{3})+(?!\d))/', $l['group_separator'], $int);
        }

        return ($neg ? '-' : '') . $int . ($decimals > 0 ? $l['decimal_separator'] . $frac : '');
    }

    /** "₹ 1,23,456.00", "£1,234.50", "1.234,50 €" */
    public static function money(string $client, $value, ?int $decimals = null): string
    {
        $l = self::get($client);
        $num = self::number($client, $value, $decimals);
        $neg = str_starts_with($num, '-');
        $num = ltrim($num, '-');
        $s = $l['currency_symbol'];
        $out = match ($l['currency_position']) {
            'before' => $s . $num,
            'after_space' => $num . ' ' . $s,
            default => $s . ' ' . $num,
        };

        return ($neg ? '-' : '') . $out;
    }

    /** Date in the school's format; $style "short" = numeric, "medium" = 22 Oct 2026 / Oct 22, 2026, "long" adds the weekday. */
    public static function date(string $client, $date, string $style = 'short'): string
    {
        $t = is_numeric($date) ? (int)$date : strtotime((string)$date);
        if (!$t) {
            return '';
        }
        $f = self::get($client)['date_format'];
        if ($style === 'short') {
            return strtr($f, ['DD' => date('d', $t), 'MM' => date('m', $t), 'YYYY' => date('Y', $t)]);
        }
        $mon = self::t($client, date('M', $t));
        $j = date('j', $t);
        $y = date('Y', $t);
        $md = str_starts_with($f, 'MM') ? "$mon $j, $y" : (str_starts_with($f, 'YYYY') ? "$y $mon $j" : "$j $mon $y");

        return $style === 'long' ? self::t($client, date('D', $t)) . ' ' . $md : $md;
    }

    public static function time(string $client, $time): string
    {
        $t = strtotime('2000-01-01 ' . substr((string)$time, 0, 8));
        if (!$t) {
            return '';
        }

        return self::get($client)['time_format'] === '24h' ? date('H:i', $t) : date('g:i', $t) . ' ' . self::t($client, date('A', $t));
    }

    // ── language ────────────────────────────────────────────────────────────

    private static array $dicts = [];

    /** The school's language code (en when not set or unknown). */
    public static function lang(string $client): string
    {
        if (self::$override !== null) {
            return self::$override;   // texts being written for one person (their own language)
        }
        try {
            $l = (string)(self::get($client)['language'] ?? 'en');
        } catch (\Throwable $e) {
            $l = 'en';
        }

        return isset(self::LANGUAGES[$l]) ? $l : 'en';
    }

    public static function isRtl(string $client): bool
    {
        return in_array(self::lang($client), self::RTL_LANGUAGES, true);
    }

    /**
     * English text in the school's language; {name} placeholders are filled from $vars.
     * Falls back to English when there is no translation.
     */
    public static function t(string $client, string $en, array $vars = []): string
    {
        $s = $en;
        $l = self::lang($client);
        if ($l !== 'en') {
            $d = self::dict($l);
            if (isset($d[$en]) && is_string($d[$en]) && $d[$en] !== '') {
                $s = $d[$en];
            }
        }
        if (!$vars) {
            return $s;
        }

        return (string)preg_replace_callback('/\{(\w+)\}/', function ($m) use ($vars) {
            return array_key_exists($m[1], $vars) ? (string)$vars[$m[1]] : $m[0];
        }, $s);
    }

    /** HTML (emails): translate the plain text between tags; right-to-left for Arabic and Urdu. */
    public static function th(string $client, string $html): string
    {
        $l = self::lang($client);
        if ($l === 'en') {
            return $html;
        }
        $d = self::dict($l);
        $loose = [];
        foreach ($d as $k => $v) {
            if (is_string($v) && $v !== '') {
                $loose[trim((string)preg_replace('/\s+/u', ' ', (string)$k))] = $v;
            }
        }
        $out = (string)preg_replace_callback('/>([^<>]*[A-Za-z][^<>]*)</u', function ($m) use ($loose) {
            $key = trim((string)preg_replace('/\s+/u', ' ', $m[1]));
            $plain = html_entity_decode($key, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $tr = $loose[$key] ?? ($loose[$plain] ?? null);
            if ($tr === null) {
                return $m[0];
            }
            preg_match('/^\s*/u', $m[1], $lead);
            preg_match('/\s*$/u', $m[1], $trail);

            return '>' . $lead[0] . htmlspecialchars($tr, ENT_QUOTES, 'UTF-8') . $trail[0] . '<';
        }, $html);
        if (self::isRtl($client)) {
            if (preg_match('/<html[^>]*>/i', $out)) {
                if (!preg_match('/<html[^>]*\bdir=/i', $out)) {
                    $out = (string)preg_replace('/<html/i', '<html dir="rtl"', $out, 1);
                }
            } else {
                $out = '<div dir="rtl">' . $out . '</div>';
            }
        }

        return $out;
    }

    // ── each person's own language (phase 4) ───────────────────────────────

    private static ?string $override = null;
    private static array $userLangs = [];
    private static array $tokenUsers = [];

    /** The language a person chose for themselves ('' = follow the school). */
    public static function userLang(string $client, string $user): string
    {
        $user = trim($user);
        if ($client === '' || $user === '') {
            return '';
        }
        $k = strtoupper($client) . '|' . strtolower($user);
        if (!array_key_exists($k, self::$userLangs)) {
            $l = '';
            try {
                $r = self::db()->execute('SELECT language FROM ssms_user_language WHERE ssms_client_code = ? AND username = ? LIMIT 1', [$client, $user])->fetch('assoc');
                $l = (string)($r['language'] ?? '');
            } catch (\Throwable $e) {
                // table not created yet: everyone follows the school
            }
            self::$userLangs[$k] = isset(self::LANGUAGES[$l]) ? $l : '';
        }

        return self::$userLangs[$k];
    }

    /** The language to use for this person: their own choice, else the school's. */
    public static function langFor(string $client, ?string $user): string
    {
        $own = $user !== null ? self::userLang($client, $user) : '';
        if ($own !== '') {
            return $own;
        }
        $saved = self::$override;
        self::$override = null;
        try {
            return self::lang($client);
        } finally {
            self::$override = $saved;
        }
    }

    /** Language for the phone with this push token (the person signed in on it). */
    public static function langForToken(string $client, string $token): string
    {
        $k = strtoupper($client) . '|' . $token;
        if (!array_key_exists($k, self::$tokenUsers)) {
            $u = null;
            try {
                $r = self::db()->execute('SELECT username FROM ssms_user_presence WHERE client_code = ? AND push_token = ? LIMIT 1', [$client, $token])->fetch('assoc');
                $u = isset($r['username']) ? (string)$r['username'] : null;
            } catch (\Throwable $e) {
            }
            self::$tokenUsers[$k] = $u;
        }

        return self::langFor($client, self::$tokenUsers[$k]);
    }

    /**
     * Language for an e-mail to a family: the account with this e-mail address, else the student's own account
     * (user name = enrollment ID), else the school's.
     */
    public static function langForEmail(string $client, string $email, $enrollmentId = null): string
    {
        $email = trim($email);
        try {
            if ($email !== '') {
                $rows = self::db()->execute('SELECT ssms_user_name FROM sawera_ssms_users WHERE ssms_client_code = ? AND LOWER(ssms_user_email) = LOWER(?) LIMIT 5', [$client, $email])->fetchAll('assoc');
                foreach ($rows as $r) {
                    $l = self::userLang($client, (string)$r['ssms_user_name']);
                    if ($l !== '') {
                        return $l;
                    }
                }
            }
        } catch (\Throwable $e) {
        }
        if ($enrollmentId !== null && (string)$enrollmentId !== '' && (string)$enrollmentId !== '0') {
            $l = self::userLang($client, (string)$enrollmentId);
            if ($l !== '') {
                return $l;
            }
        }

        return self::langFor($client, null);
    }

    /** Run $fn with texts, dates and e-mails in this language (null = the school's). */
    public static function withLang(?string $lang, callable $fn)
    {
        $saved = self::$override;
        self::$override = ($lang !== null && isset(self::LANGUAGES[$lang])) ? $lang : null;
        try {
            return $fn();
        } finally {
            self::$override = $saved;
        }
    }

    /** Start / end a stretch in one language (when a closure is awkward). useLang returns what to give back to endLang. */
    public static function useLang(?string $lang): ?string
    {
        $saved = self::$override;
        self::$override = ($lang !== null && isset(self::LANGUAGES[$lang])) ? $lang : null;

        return $saved;
    }

    public static function endLang(?string $saved): void
    {
        self::$override = $saved;
    }

    /** Save a person's own language ('' = follow the school). */
    public static function saveUserLang(string $client, string $user, string $lang): string
    {
        $lang = strtolower(trim($lang));
        if ($lang !== '' && !isset(self::LANGUAGES[$lang])) {
            throw new \DomainException('Please choose a language from the list.');
        }
        if ($client === '' || trim($user) === '') {
            throw new \DomainException('Please sign in again.');
        }
        if ($lang === '') {
            self::db()->execute('DELETE FROM ssms_user_language WHERE ssms_client_code = ? AND username = ?', [$client, $user]);
        } else {
            self::db()->execute('INSERT INTO ssms_user_language (ssms_client_code, username, language, modified) VALUES (?,?,?,?)
                ON DUPLICATE KEY UPDATE language = VALUES(language), modified = VALUES(modified)', [$client, $user, $lang, AccountSecurity::now()]);
        }
        unset(self::$userLangs[strtoupper($client) . '|' . strtolower(trim($user))]);

        return $lang;
    }

    /** Test hook: use these translations instead of the files. */
    public static function setDictionary(string $lang, ?array $dict): void
    {
        if ($dict === null) {
            unset(self::$dicts[$lang]);
        } else {
            self::$dicts[$lang] = $dict;
        }
    }

    private static function dict(string $lang): array
    {
        if (!isset(self::$dicts[$lang])) {
            $root = defined('ROOT') ? ROOT : dirname(__DIR__, 2);
            $f = $root . DIRECTORY_SEPARATOR . 'resources' . DIRECTORY_SEPARATOR . 'i18n' . DIRECTORY_SEPARATOR . $lang . '.json';
            $j = is_file($f) ? json_decode((string)file_get_contents($f), true) : null;
            self::$dicts[$lang] = is_array($j) ? $j : [];
        }

        return self::$dicts[$lang];
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
