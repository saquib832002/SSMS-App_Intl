<?php
declare(strict_types=1);

namespace App\Service;

/**
 * SMS / WhatsApp rules per country, and phone numbers in international (E.164) form.
 *
 * The rules are a summary of current guidance (Oct 2026) to show the school what it needs
 * before sending; each provider confirms the details at sign-up.
 *   sender     null = nothing to register · 'required' · 'recommended'
 *   templates  every SMS text must be registered first (India DLT)
 *   quiet      [from, to] school time – non-urgent SMS / WhatsApp wait until the end
 *   optout     a "Reply STOP" line is required on SMS
 *   consent    parents' written opt-in is expected before texting (set as the default)
 */
final class MessagingCountries
{
    /** ISO code => calling code (from the app's country list, libphonenumber data) */
    public const DIAL = [
        'IN'=>'91', 'AF'=>'93', 'AX'=>'358', 'AL'=>'355', 'DZ'=>'213', 'AS'=>'1', 'AD'=>'376', 'AO'=>'244', 'AI'=>'1', 'AG'=>'1',
        'AR'=>'54', 'AM'=>'374', 'AW'=>'297', 'AC'=>'247', 'AU'=>'61', 'AT'=>'43', 'AZ'=>'994', 'BS'=>'1', 'BH'=>'973', 'BD'=>'880',
        'BB'=>'1', 'BY'=>'375', 'BE'=>'32', 'BZ'=>'501', 'BJ'=>'229', 'BM'=>'1', 'BT'=>'975', 'BO'=>'591', 'BA'=>'387', 'BW'=>'267',
        'BR'=>'55', 'IO'=>'246', 'VG'=>'1', 'BN'=>'673', 'BG'=>'359', 'BF'=>'226', 'BI'=>'257', 'KH'=>'855', 'CM'=>'237', 'CA'=>'1',
        'CV'=>'238', 'BQ'=>'599', 'KY'=>'1', 'CF'=>'236', 'TD'=>'235', 'CL'=>'56', 'CN'=>'86', 'CX'=>'61', 'CC'=>'61', 'CO'=>'57',
        'KM'=>'269', 'CD'=>'243', 'CG'=>'242', 'CK'=>'682', 'CR'=>'506', 'CI'=>'225', 'HR'=>'385', 'CU'=>'53', 'CW'=>'599', 'CY'=>'357',
        'CZ'=>'420', 'DK'=>'45', 'DJ'=>'253', 'DM'=>'1', 'DO'=>'1', 'EC'=>'593', 'EG'=>'20', 'SV'=>'503', 'GQ'=>'240', 'ER'=>'291',
        'EE'=>'372', 'SZ'=>'268', 'ET'=>'251', 'FK'=>'500', 'FO'=>'298', 'FJ'=>'679', 'FI'=>'358', 'FR'=>'33', 'GF'=>'594', 'PF'=>'689',
        'GA'=>'241', 'GM'=>'220', 'GE'=>'995', 'DE'=>'49', 'GH'=>'233', 'GI'=>'350', 'GR'=>'30', 'GL'=>'299', 'GD'=>'1', 'GP'=>'590',
        'GU'=>'1', 'GT'=>'502', 'GG'=>'44', 'GN'=>'224', 'GW'=>'245', 'GY'=>'592', 'HT'=>'509', 'HN'=>'504', 'HK'=>'852', 'HU'=>'36',
        'IS'=>'354', 'ID'=>'62', 'IR'=>'98', 'IQ'=>'964', 'IE'=>'353', 'IM'=>'44', 'IL'=>'972', 'IT'=>'39', 'JM'=>'1', 'JP'=>'81',
        'JE'=>'44', 'JO'=>'962', 'KZ'=>'7', 'KE'=>'254', 'KI'=>'686', 'XK'=>'383', 'KW'=>'965', 'KG'=>'996', 'LA'=>'856', 'LV'=>'371',
        'LB'=>'961', 'LS'=>'266', 'LR'=>'231', 'LY'=>'218', 'LI'=>'423', 'LT'=>'370', 'LU'=>'352', 'MO'=>'853', 'MG'=>'261', 'MW'=>'265',
        'MY'=>'60', 'MV'=>'960', 'ML'=>'223', 'MT'=>'356', 'MH'=>'692', 'MQ'=>'596', 'MR'=>'222', 'MU'=>'230', 'YT'=>'262', 'MX'=>'52',
        'FM'=>'691', 'MD'=>'373', 'MC'=>'377', 'MN'=>'976', 'ME'=>'382', 'MS'=>'1', 'MA'=>'212', 'MZ'=>'258', 'MM'=>'95', 'NA'=>'264',
        'NR'=>'674', 'NP'=>'977', 'NL'=>'31', 'NC'=>'687', 'NZ'=>'64', 'NI'=>'505', 'NE'=>'227', 'NG'=>'234', 'NU'=>'683', 'NF'=>'672',
        'KP'=>'850', 'MK'=>'389', 'MP'=>'1', 'NO'=>'47', 'OM'=>'968', 'PK'=>'92', 'PW'=>'680', 'PS'=>'970', 'PA'=>'507', 'PG'=>'675',
        'PY'=>'595', 'PE'=>'51', 'PH'=>'63', 'PL'=>'48', 'PT'=>'351', 'PR'=>'1', 'QA'=>'974', 'RE'=>'262', 'RO'=>'40', 'RU'=>'7',
        'RW'=>'250', 'BL'=>'590', 'SH'=>'290', 'KN'=>'1', 'LC'=>'1', 'MF'=>'590', 'PM'=>'508', 'VC'=>'1', 'WS'=>'685', 'SM'=>'378',
        'ST'=>'239', 'SA'=>'966', 'SN'=>'221', 'RS'=>'381', 'SC'=>'248', 'SL'=>'232', 'SG'=>'65', 'SX'=>'1', 'SK'=>'421', 'SI'=>'386',
        'SB'=>'677', 'SO'=>'252', 'ZA'=>'27', 'KR'=>'82', 'SS'=>'211', 'ES'=>'34', 'LK'=>'94', 'SD'=>'249', 'SR'=>'597', 'SJ'=>'47',
        'SE'=>'46', 'CH'=>'41', 'SY'=>'963', 'TW'=>'886', 'TJ'=>'992', 'TZ'=>'255', 'TH'=>'66', 'TL'=>'670', 'TG'=>'228', 'TK'=>'690',
        'TO'=>'676', 'TT'=>'1', 'TA'=>'290', 'TN'=>'216', 'TR'=>'90', 'TM'=>'993', 'TC'=>'1', 'TV'=>'688', 'VI'=>'1', 'UG'=>'256',
        'UA'=>'380', 'AE'=>'971', 'GB'=>'44', 'US'=>'1', 'UY'=>'598', 'UZ'=>'998', 'VU'=>'678', 'VA'=>'39', 'VE'=>'58', 'VN'=>'84',
        'WF'=>'681', 'EH'=>'212', 'YE'=>'967', 'ZM'=>'260', 'ZW'=>'263',
    ];
    /** The local number's leading 0 is part of the number. */
    public const KEEP_ZERO = ['IT', 'SM', 'VA'];

    private const RULES = [
        'IN' => ['sender' => 'required', 'sender_format' => '6 letters (DLT header)', 'templates' => true, 'quiet' => ['21:00', '08:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['msg91', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['gupshup', 'meta', 'infobip', 'twilio', 'whapi'],
                 'note' => 'Register the school on DLT as a Principal Entity, register a 6-letter header and every message text (the Texts tab shows the exact text with {#var#}). Messages that do not match a registered template are dropped by the operators.'],
        'AE' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['infobip', 'unifonic', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'],
                 'note' => 'Sender names must be registered with the operators through your provider first (about 2 weeks). School alerts are transactional messages.'],
        'SA' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['unifonic', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'],
                 'note' => 'The sender name must be registered with the regulator through your provider, with the school\'s documents.'],
        'QA' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['unifonic', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register the sender name through your provider first.'],
        'KW' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['unifonic', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register the sender name through your provider first.'],
        'OM' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['unifonic', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register the sender name through your provider first.'],
        'BH' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['unifonic', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register the sender name through your provider first.'],
        'PK' => ['sender' => 'required', 'sender_format' => 'masking name approved by each operator', 'templates' => false, 'quiet' => ['21:00', '09:00'], 'optout' => true, 'consent' => false,
                 'sms' => ['infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'],
                 'note' => 'The sender name (masking) is approved by each operator. SMS must offer STOP. Non-urgent messages only 9 am – 9 pm.'],
        'BD' => ['sender' => 'required', 'sender_format' => 'masking name', 'templates' => false, 'quiet' => ['21:00', '08:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register a masking (sender) name through your provider.'],
        'US' => ['sender' => 'required', 'sender_format' => 'registered 10DLC number, toll-free number or short code', 'templates' => false, 'quiet' => ['21:00', '08:00'], 'optout' => true, 'consent' => true,
                 'sms' => ['twilio', 'infobip', 'generic'], 'whatsapp' => ['meta', 'twilio', 'infobip', 'whapi'],
                 'note' => 'Texts from ordinary numbers need A2P 10DLC brand and campaign registration (or a verified toll-free number). Parents must opt in, and STOP / HELP must work.'],
        'CA' => ['sender' => 'required', 'sender_format' => 'registered long code, toll-free number or short code', 'templates' => false, 'quiet' => ['21:00', '08:00'], 'optout' => true, 'consent' => true,
                 'sms' => ['twilio', 'infobip', 'generic'], 'whatsapp' => ['meta', 'twilio', 'infobip', 'whapi'], 'note' => 'Parents must opt in (CASL) and STOP must work.'],
        'GB' => ['sender' => 'recommended', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '08:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['twilio', 'infobip', 'generic'], 'whatsapp' => ['meta', 'twilio', 'infobip', 'whapi'],
                 'note' => 'If the school name is protected in the MEF sender ID registry, register it with your provider (letter of authorisation). List the provider in your privacy notice.'],
        'NG' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['africastalking', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Sender IDs must be registered with the operators through your provider. Numbers on the Do-Not-Disturb list need a transactional route.'],
        'KE' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['africastalking', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Sender IDs are registered per operator through your provider.'],
        'GH' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['africastalking', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register the sender ID through your provider.'],
        'UG' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['africastalking', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register the sender ID through your provider.'],
        'TZ' => ['sender' => 'required', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['africastalking', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Register the sender ID through your provider.'],
        'ZA' => ['sender' => 'recommended', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['20:00', '08:00'], 'optout' => false, 'consent' => false,
                 'sms' => ['africastalking', 'infobip', 'twilio', 'generic'], 'whatsapp' => ['meta', 'infobip', 'twilio', 'whapi'], 'note' => 'Follow POPIA: school messages to parents are fine; marketing needs consent.'],
    ];
    private const DEFAULT_RULE = ['sender' => 'recommended', 'sender_format' => 'up to 11 letters or numbers', 'templates' => false, 'quiet' => ['21:00', '07:00'], 'optout' => false, 'consent' => false,
        'sms' => ['twilio', 'infobip', 'generic'], 'whatsapp' => ['meta', 'twilio', 'infobip', 'gupshup', 'whapi'],
        'note' => 'Check with your provider whether the sender name must be registered in your country.'];
    private const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'IS', 'CH'];

    public static function rules(string $country): array
    {
        $c = strtoupper($country);
        $r = self::RULES[$c] ?? self::DEFAULT_RULE;
        if (!isset(self::RULES[$c]) && in_array($c, self::EU, true)) {
            $r['quiet'] = ['21:00', '08:00'];
            $r['note'] = 'GDPR: messages about the child are part of running the school, but name your provider in the privacy notice. Some countries protect sender names (e.g. France needs an approved sender for alphanumeric IDs).';
        }

        return $r + ['country' => $c, 'dial' => self::DIAL[$c] ?? null];
    }

    /**
     * Phone number → E.164 ("+971501234567"), using the school's country for local numbers.
     * Returns null when it cannot be a valid number.
     */
    public static function e164(?string $raw, string $country): ?string
    {
        $raw = trim((string)$raw);
        if ($raw === '') {
            return null;
        }
        $raw = preg_replace('/^whatsapp:/i', '', $raw);
        $plus = str_starts_with($raw, '+');
        $d = preg_replace('/\D/', '', $raw);
        if ($d === '') {
            return null;
        }
        $c = strtoupper($country);
        $dial = self::DIAL[$c] ?? null;
        if ($plus) {
            $n = $d;
        } elseif (str_starts_with($d, '00')) {
            $n = substr($d, 2);
        } elseif ($dial !== null && str_starts_with($d, $dial) && (strlen($d) >= strlen($dial) + 9 || strlen($d) > 11) && !str_starts_with($d, '0')) {
            $n = $d;   // already has the country code ("919876543210")
        } elseif ($dial !== null) {
            $local = in_array($c, self::KEEP_ZERO, true) ? $d : ltrim($d, '0');
            $n = $dial . $local;
        } else {
            return null;
        }
        if (strlen($n) < 8 || strlen($n) > 15 || $n[0] === '0') {
            return null;
        }

        return '+' . $n;
    }

    /** "+97150…" shown as "+971 ••• ••4567" in logs and lists. */
    public static function mask(string $e164): string
    {
        $d = preg_replace('/\D/', '', $e164);

        return '+' . substr($d, 0, max(1, strlen($d) - 9)) . ' ••• ••' . substr($d, -4);
    }

    /** SMS parts: 160 / 153 characters in the basic alphabet, 70 / 67 otherwise (Arabic, Hindi, Urdu, emoji …). */
    public static function segments(string $text): int
    {
        $gsm = '@£$¥èéùìòÇ' . "\n" . 'Øø' . "\r" . 'ÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
        $ext = '^{}\\[~]|€';
        $len = 0;
        $basic = true;
        foreach (preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
            if (mb_strpos($gsm, $ch) !== false) {
                $len++;
            } elseif (mb_strpos($ext, $ch) !== false) {
                $len += 2;
            } else {
                $basic = false;
                break;
            }
        }
        if (!$basic) {
            $len = mb_strlen($text);

            return $len <= 70 ? 1 : (int)ceil($len / 67);
        }

        return $len <= 160 ? 1 : (int)ceil($len / 153);
    }
}
