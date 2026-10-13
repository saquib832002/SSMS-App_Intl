<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * Automatic notifications to parents (phase 1): in-app inbox, push and e-mail.
 *
 * Every message is one "event" (a child absent on a day, a new notice, a fee reminder …). The worker
 * (`run()`) looks for new events in the school's data, works out who gets them, writes them in each
 * person's own language, puts them in the in-app inbox and queues the push / e-mail in the outbox,
 * then sends what is due.
 *
 * It runs from `bin/cake notify` (every few minutes – cron or Windows Task Scheduler) and also,
 * at most once a minute per school, whenever someone opens the app (NotifyApi::summary → tick()).
 * Nothing in the existing screens has to call it: it reads attendance, late/early records, notices,
 * homework, fees and report cards as they are saved.
 */
class Notify
{
    /**
     * event => [label, push, email, essential, options] – the defaults when the school changed nothing.
     * SMS and WhatsApp (phase 2) are off until the school connects them and switches them on per event.
     * paid_when: 'unread' = SMS / WhatsApp only when the family has not read it in the app within unread_minutes
     * (or has no app), 'always' = at once.
     */
    public const EVENTS = [
        'absence'  => ['Absent today', 1, 0, 1, ['delay_minutes' => 20, 'correction' => 1, 'paid_when' => 'unread', 'unread_minutes' => 15]],
        'arrival'  => ['Late arrival / early pick-up', 1, 0, 0, ['paid_when' => 'unread', 'unread_minutes' => 15]],
        'homework' => ['New homework', 1, 0, 0, ['mode' => 'digest', 'digest_time' => '17:00', 'paid_when' => 'unread', 'unread_minutes' => 60]],
        'notice'   => ['New notice', 1, 1, 0, ['paid_when' => 'unread', 'unread_minutes' => 60]],
        'fee_due'  => ['Fee due / overdue', 1, 1, 1, ['days_before' => 3, 'on_due_day' => 1, 'overdue_every' => 7, 'overdue_for_days' => 60, 'paid_when' => 'unread', 'unread_minutes' => 60]],
        'results'  => ['Report card published', 1, 1, 0, ['paid_when' => 'unread', 'unread_minutes' => 60]],
    ];
    public const CHANNELS = ['push', 'email', 'sms', 'whatsapp'];
    public const PAID = ['sms', 'whatsapp'];
    /** Events about a student – parents and the student's own account get them. */
    public const FAMILY_EVENTS = ['absence', 'arrival', 'homework', 'fee_due', 'results'];
    private const STAFF_ROLES = ['owner', 'admin', 'principal', 'user', 'teacher', 'staff', 'accountant'];

    /** Test hooks: fn(array $expoMessages): array $tickets   ·   fn(string $to, string $subject, string $html): void */
    public static $push = null;
    public static $mail = null;

    // ── Settings (Setup › Notifications) ───────────────────────────────────

    public static function settings(string $client): array
    {
        $rows = [];
        try {
            foreach (self::q('SELECT * FROM ssms_notify_settings WHERE ssms_client_code = ?', [$client]) as $r) {
                $rows[$r['event']] = $r;
            }
        } catch (\Throwable $e) {
            // not migrated yet: defaults
        }
        $out = [];
        foreach (self::EVENTS as $ev => [$label, $push, $email, $essential, $opts]) {
            $r = $rows[$ev] ?? null;
            $saved = $r && $r['options'] ? (json_decode((string)$r['options'], true) ?: []) : [];
            $out[$ev] = [
                'event' => $ev, 'label' => $label,
                'enabled' => $r ? (bool)$r['enabled'] : true,
                'push' => $r ? (bool)$r['push'] : (bool)$push,
                'email' => $r ? (bool)$r['email'] : (bool)$email,
                'sms' => $r ? (bool)($r['sms'] ?? 0) : false,
                'whatsapp' => $r ? (bool)($r['whatsapp'] ?? 0) : false,
                'essential' => $r ? (bool)$r['essential'] : (bool)$essential,
                'options' => array_merge($opts, array_intersect_key($saved, $opts)),
            ];
        }

        return $out;
    }

    public static function saveSettings(string $client, array $data, string $by): array
    {
        $cur = self::settings($client);
        $changed = [];
        foreach ((array)($data['events'] ?? $data) as $ev => $d) {
            if (!isset(self::EVENTS[$ev]) || !is_array($d)) {
                continue;
            }
            $s = $cur[$ev];
            foreach (['enabled', 'push', 'email', 'sms', 'whatsapp', 'essential'] as $k) {
                if (array_key_exists($k, $d)) {
                    $s[$k] = filter_var($d[$k], FILTER_VALIDATE_BOOLEAN);
                }
            }
            $o = $s['options'];
            foreach ((array)($d['options'] ?? []) as $k => $v) {
                if (!array_key_exists($k, self::EVENTS[$ev][4])) {
                    continue;
                }
                $o[$k] = self::option($ev, $k, $v);
            }
            $s['options'] = $o;
            if ($s != $cur[$ev]) {
                $changed[$ev] = ['from' => self::brief($cur[$ev]), 'to' => self::brief($s)];
            }
            try {
                self::db()->execute('INSERT INTO ssms_notify_settings (ssms_client_code, event, enabled, push, email, sms, whatsapp, essential, options, updated_by, modified)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), push = VALUES(push), email = VALUES(email), sms = VALUES(sms),
                    whatsapp = VALUES(whatsapp), essential = VALUES(essential), options = VALUES(options), updated_by = VALUES(updated_by), modified = VALUES(modified)',
                    [$client, $ev, (int)$s['enabled'], (int)$s['push'], (int)$s['email'], (int)$s['sms'], (int)$s['whatsapp'], (int)$s['essential'], json_encode($s['options']), $by, self::now()]);
            } catch (\Throwable $e) {
                // SMS / WhatsApp columns not created yet (phase-2 migration): save the rest
                if ($s['sms'] || $s['whatsapp']) {
                    throw new \DomainException('Run the SMS / WhatsApp database update (2026_10_messaging.sql) first.');
                }
                self::db()->execute('INSERT INTO ssms_notify_settings (ssms_client_code, event, enabled, push, email, essential, options, updated_by, modified)
                    VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), push = VALUES(push), email = VALUES(email),
                    essential = VALUES(essential), options = VALUES(options), updated_by = VALUES(updated_by), modified = VALUES(modified)',
                    [$client, $ev, (int)$s['enabled'], (int)$s['push'], (int)$s['email'], (int)$s['essential'], json_encode($s['options']), $by, self::now()]);
            }
        }

        return ['settings' => self::settings($client), 'changed' => $changed];
    }

    private static function option(string $ev, string $k, $v)
    {
        switch ($k) {
            case 'mode':
                if (!in_array($v, ['digest', 'instant'], true)) {
                    throw new \DomainException('Homework: choose "one message a day" or "straight away".');
                }

                return $v;
            case 'paid_when':
                if (!in_array($v, ['unread', 'always'], true)) {
                    throw new \DomainException('SMS / WhatsApp: choose "only if not read in the app" or "always".');
                }

                return $v;
            case 'unread_minutes':
                $n = (int)$v;
                if ($n < 0 || $n > 1440) {
                    throw new \DomainException('Wait 0 to 1440 minutes for the app before SMS / WhatsApp.');
                }

                return $n;
            case 'digest_time':
                if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) {
                    throw new \DomainException('Please give the time as HH:MM, e.g. 17:00.');
                }

                return $v;
            case 'delay_minutes':
                $n = (int)$v;
                if ($n < 0 || $n > 240) {
                    throw new \DomainException('The absence delay must be 0 to 240 minutes.');
                }

                return $n;
            case 'days_before':
                $n = (int)$v;
                if ($n < 0 || $n > 30) {
                    throw new \DomainException('Remind 0 to 30 days before the due date.');
                }

                return $n;
            case 'overdue_every':
                $n = (int)$v;
                if ($n < 0 || $n > 60) {
                    throw new \DomainException('Overdue reminders: every 0 to 60 days (0 = never).');
                }

                return $n;
            case 'overdue_for_days':
                $n = (int)$v;
                if ($n < 0 || $n > 365) {
                    throw new \DomainException('Overdue reminders: stop after 0 to 365 days.');
                }

                return $n;
            default:   // on/off options
                return filter_var($v, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
        }
    }

    private static function brief(array $s): string
    {
        return ($s['enabled'] ? 'on' : 'off') . ($s['push'] ? '+push' : '') . ($s['email'] ? '+email' : '') . (!empty($s['sms']) ? '+sms' : '')
            . (!empty($s['whatsapp']) ? '+whatsapp' : '') . ($s['essential'] ? ' essential' : '');
    }

    // ── Each person's choices (menu › Notifications) ───────────────────────

    public static function prefs(string $client, string $user, string $role): array
    {
        $off = [];
        try {
            foreach (self::q('SELECT event, channel FROM ssms_notify_prefs WHERE ssms_client_code = ? AND username = ?', [$client, $user]) as $r) {
                $off[$r['event'] . '|' . $r['channel']] = true;
            }
        } catch (\Throwable $e) {
        }
        $staff = !in_array(strtolower($role), ['parent', 'student'], true);
        $out = [];
        foreach (self::settings($client) as $ev => $s) {
            if (!$s['enabled'] || ($staff && $ev !== 'notice')) {
                continue;
            }
            $ch = [];
            foreach (self::CHANNELS as $c) {
                if ($s[$c] && (!in_array($c, self::PAID, true) || Messaging::active($client, $c))) {
                    $ch[$c] = ['on' => $s['essential'] || !isset($off[$ev . '|' . $c]), 'locked' => $s['essential']];
                }
            }
            $out[] = ['event' => $ev, 'label' => $s['label'], 'essential' => $s['essential'], 'channels' => $ch];
        }

        return $out;
    }

    public static function savePref(string $client, string $user, string $event, string $channel, bool $on): array
    {
        $s = self::settings($client)[$event] ?? null;
        if (!$s || !in_array($channel, self::CHANNELS, true)) {
            throw new \DomainException('Unknown notification.');
        }
        if ($s['essential'] && !$on) {
            throw new \DomainException('The school sends this notification to every family. It cannot be turned off.');
        }
        if ($on) {
            self::db()->execute('DELETE FROM ssms_notify_prefs WHERE ssms_client_code = ? AND username = ? AND event = ? AND channel = ?', [$client, $user, $event, $channel]);
        } else {
            self::db()->execute('INSERT IGNORE INTO ssms_notify_prefs (ssms_client_code, username, event, channel, modified) VALUES (?,?,?,?,?)',
                [$client, $user, $event, $channel, self::now()]);
        }

        return ['event' => $event, 'channel' => $channel, 'on' => $on];
    }

    private static function wants(string $client, array $setting, string $user, string $channel): bool
    {
        return self::wantsChannel($client, $setting, $user, $channel);
    }

    /** The school sends this event on the channel and the person did not switch it off (essential events: always). */
    public static function wantsChannel(string $client, array $setting, string $user, string $channel): bool
    {
        if (empty($setting[$channel])) {
            return false;
        }
        if ($setting['essential'] || $user === '') {
            return true;
        }
        try {
            return !self::db()->execute('SELECT 1 FROM ssms_notify_prefs WHERE ssms_client_code = ? AND username = ? AND event = ? AND channel = ? LIMIT 1',
                [$client, $user, $setting['event'], $channel])->fetch('assoc');
        } catch (\Throwable $e) {
            return true;
        }
    }

    // ── Phones ─────────────────────────────────────────────────────────────

    public static function registerDevice(string $client, string $user, string $token, string $platform = ''): void
    {
        $token = trim($token);
        if (!preg_match('/^(ExponentPushToken|ExpoPushToken)\[[^\]]{8,190}\]$/', $token)) {
            throw new \DomainException('This phone could not be registered for notifications.');
        }
        // a phone belongs to whoever signed in on it last
        self::db()->execute('INSERT INTO ssms_push_tokens (token, ssms_client_code, username, platform, modified) VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE ssms_client_code = VALUES(ssms_client_code), username = VALUES(username), platform = VALUES(platform), modified = VALUES(modified)',
            [$token, $client, $user, mb_substr($platform, 0, 10), self::now()]);
        // the chat heartbeat also keeps the phone on the account's presence row: take it off anyone else's
        try {
            self::db()->execute('UPDATE ssms_user_presence SET push_token = NULL WHERE push_token = ? AND NOT (client_code = ? AND username = ?)', [$token, $client, $user]);
        } catch (\Throwable $e) {
        }
    }

    public static function forgetDevice(string $token): void
    {
        try {
            self::db()->execute('DELETE FROM ssms_push_tokens WHERE token = ?', [$token]);
            self::db()->execute('UPDATE ssms_user_presence SET push_token = NULL WHERE push_token = ?', [$token]);
        } catch (\Throwable $e) {
        }
    }

    /** Signing out on a phone: only the person's own phone. */
    public static function forgetDeviceOf(string $client, string $user, string $token): void
    {
        try {
            self::db()->execute('DELETE FROM ssms_push_tokens WHERE token = ? AND ssms_client_code = ? AND username = ?', [trim($token), $client, $user]);
            self::db()->execute('UPDATE ssms_user_presence SET push_token = NULL WHERE push_token = ? AND client_code = ? AND username = ?', [trim($token), $client, $user]);
        } catch (\Throwable $e) {
        }
    }

    // ── Inbox ──────────────────────────────────────────────────────────────

    public static function inbox(string $client, string $user, int $beforeId = 0, int $limit = 30): array
    {
        $limit = max(1, min(100, $limit));
        $p = [$client, $user];
        $w = '';
        if ($beforeId > 0) {
            $w = ' AND id < ?';
            $p[] = $beforeId;
        }
        $rows = self::q("SELECT id, event, ref, enrollment_id, title, body, data, created, read_at FROM ssms_notify_inbox
            WHERE ssms_client_code = ? AND username = ?$w ORDER BY id DESC LIMIT $limit", $p);

        return array_map(fn($r) => ['id' => (int)$r['id'], 'event' => $r['event'], 'ref' => $r['ref'], 'enrollment_id' => $r['enrollment_id'],
            'title' => $r['title'], 'body' => (string)$r['body'], 'data' => json_decode((string)$r['data'], true) ?: (object)[],
            'created' => self::local($client, $r['created']), 'read' => $r['read_at'] !== null], $rows);
    }

    public static function unread(string $client, string $user): int
    {
        try {
            return (int)(self::db()->execute('SELECT COUNT(*) n FROM ssms_notify_inbox WHERE ssms_client_code = ? AND username = ? AND read_at IS NULL',
                [$client, $user])->fetch('assoc')['n'] ?? 0);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /** $ids: list of inbox ids, or null = everything. */
    public static function markRead(string $client, string $user, ?array $ids): int
    {
        $p = [self::now(), $client, $user];
        $w = '';
        if ($ids !== null) {
            $ids = array_values(array_filter(array_map('intval', $ids)));
            if (!$ids) {
                return 0;
            }
            $w = ' AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
            $p = array_merge($p, $ids);
        }
        $n = self::db()->execute("UPDATE ssms_notify_inbox SET read_at = ? WHERE ssms_client_code = ? AND username = ? AND read_at IS NULL$w", $p)->rowCount();
        // opening a notice from the inbox counts as reading the notice
        foreach (self::q("SELECT ref FROM ssms_notify_inbox WHERE ssms_client_code = ? AND username = ? AND ref LIKE 'notice:%'" . ($ids !== null ? $w : ' AND read_at >= ?'),
            $ids !== null ? array_merge([$client, $user], $ids) : [$client, $user, $p[0]]) as $r) {
            self::noticeRead($client, $user, (int)substr((string)$r['ref'], 7), false);
        }

        return $n;
    }

    // ── Notice read receipts ───────────────────────────────────────────────

    /** From the app: record reads only for notices meant for this person (role in the notice's audience). */
    public static function noticesSeen(string $client, string $user, string $role, array $noticeIds): int
    {
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', $noticeIds)))), 0, 100);
        if (!$ids || $user === '') {
            return 0;
        }
        $role = strtolower($role);
        $n = 0;
        foreach (self::q('SELECT notice_id, target_audience FROM ssms_notices WHERE ssms_client_code = ? AND notice_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')',
            array_merge([$client], $ids)) as $row) {
            if (in_array($role, self::audienceRoles((string)$row['target_audience']), true)) {
                self::noticeRead($client, $user, (int)$row['notice_id']);
                $n++;
            }
        }

        return $n;
    }

    public static function noticeRead(string $client, string $user, int $noticeId, bool $alsoInbox = true): void
    {
        if ($noticeId <= 0 || $user === '') {
            return;
        }
        self::db()->execute('INSERT IGNORE INTO ssms_notice_reads (ssms_client_code, notice_id, username, read_at) VALUES (?,?,?,?)',
            [$client, $noticeId, $user, self::now()]);
        if ($alsoInbox) {
            self::db()->execute('UPDATE ssms_notify_inbox SET read_at = ? WHERE ssms_client_code = ? AND username = ? AND ref = ? AND read_at IS NULL',
                [self::now(), $client, $user, 'notice:' . $noticeId]);
        }
    }

    /** notice_id => [read, audience] for the notices given. */
    public static function noticeStats(string $client, array $noticeIds): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $noticeIds))));
        if (!$ids) {
            return [];
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $readers = [];
        foreach (self::q("SELECT notice_id, username FROM ssms_notice_reads WHERE ssms_client_code = ? AND notice_id IN ($in)", array_merge([$client], $ids)) as $r) {
            $readers[(int)$r['notice_id']][] = strtolower((string)$r['username']);
        }
        $out = [];
        $aud = [];
        foreach (self::q("SELECT notice_id, target_audience FROM ssms_notices WHERE ssms_client_code = ? AND notice_id IN ($in)", array_merge([$client], $ids)) as $n) {
            $a = strtolower((string)$n['target_audience']);
            $aud[$a] ??= array_flip(array_map(fn($u) => strtolower($u['username']), self::audienceUsers($client, $a)));
            // only people the notice is for count (staff opening the board don't)
            $read = count(array_filter($readers[(int)$n['notice_id']] ?? [], fn($u) => isset($aud[$a][$u])));
            $out[(int)$n['notice_id']] = ['read' => $read, 'audience' => count($aud[$a])];
        }

        return $out;
    }

    /** Who has / hasn't read a notice (names), for the school. */
    public static function noticeReaders(string $client, int $noticeId): array
    {
        $n = self::db()->execute('SELECT notice_id, title, target_audience FROM ssms_notices WHERE ssms_client_code = ? AND notice_id = ?', [$client, $noticeId])->fetch('assoc');
        if (!$n) {
            throw new \DomainException('Notice not found.');
        }
        $read = [];
        foreach (self::q('SELECT username, read_at FROM ssms_notice_reads WHERE ssms_client_code = ? AND notice_id = ?', [$client, $noticeId]) as $r) {
            $read[strtolower((string)$r['username'])] = $r['read_at'];
        }
        $who = ['read' => [], 'unread' => []];
        foreach (self::audienceUsers($client, (string)$n['target_audience']) as $u) {
            $row = ['username' => $u['username'], 'name' => $u['name'], 'role' => $u['role']];
            if (isset($read[strtolower($u['username'])])) {
                $who['read'][] = $row + ['read_at' => self::local($client, $read[strtolower($u['username'])])];
            } else {
                $who['unread'][] = $row;
            }
        }

        return ['notice_id' => $noticeId, 'title' => $n['title'], 'read' => $who['read'], 'unread' => $who['unread']];
    }

    /** "Remind the rest": a push (and the inbox entry again) to everyone who hasn't read the notice. Once a day. */
    public static function noticeRemind(string $client, int $noticeId, string $by): int
    {
        $s = self::settings($client)['notice'];
        if (!$s['enabled']) {
            throw new \DomainException('Notifications for notices are switched off in Setup › Notifications.');
        }
        $r = self::noticeReaders($client, $noticeId);
        if (!$r['unread']) {
            return 0;
        }
        $ref = 'notice_remind:' . $noticeId . ':' . Locale::today($client);
        if (!self::logOnce($client, $ref, 'notice', count($r['unread']))) {
            throw new \DomainException('A reminder for this notice was already sent today.');
        }
        $title = (string)$r['title'];
        $n = 0;
        $data = ['screen' => 'NoticeBoard', 'notice_id' => $noticeId, 'event' => 'notice'];
        foreach ($r['unread'] as $u) {
            $lang = Locale::langFor($client, $u['username']);
            $msg = Locale::withLang($lang, fn() => ['title' => Locale::t($client, 'Reminder: please read this notice'), 'body' => $title]);
            self::inboxAdd($client, $u['username'], 'notice', $ref, null, $msg['title'], $msg['body'], $data);
            $n++;
            if (self::wants($client, $s, $u['username'], 'push')) {
                self::queue($client, 'notice', $ref, 'push', $u['username'], $u['username'], null, $msg['title'], $msg['body'], $data, $lang);
            }
        }
        // SMS / WhatsApp to the same people when the school sends notices that way
        $users = array_column($r['unread'], 'username');
        if ((!empty($s['sms']) && Messaging::active($client, 'sms')) || (!empty($s['whatsapp']) && Messaging::active($client, 'whatsapp'))) {
            Messaging::queue($client, $s, $ref, $data, null, Messaging::userPhones($client, $users),
                fn() => ['title' => Locale::t($client, 'Reminder: please read this notice'), 'kind' => 'notice_remind', 'vars' => ['title' => mb_substr($title, 0, 120)]],
                array_values(array_filter($users, fn($u) => Meetings::tokensOfUser($client, (string)$u) !== [])));
        }
        self::deliver($client);
        Audit::log($client, 'notice.remind_unread', ['category' => 'records', 'actor' => $by, 'entity_type' => 'notice', 'entity_id' => (string)$noticeId,
            'summary' => "Reminder sent to {$n} people who had not read the notice"]);

        return $n;
    }

    // ── Who gets it ────────────────────────────────────────────────────────

    /** Parents' accounts and the student's own account for one child. */
    public static function familyUsers(string $client, string $eid): array
    {
        $users = Meetings::parentUsers($client, $eid);
        try {
            $st = self::db()->execute("SELECT ssms_user_name FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name = ? AND LOWER(ssms_user_role) = 'student' LIMIT 1",
                [$client, $eid])->fetch('assoc');
            if ($st) {
                $users[] = (string)$st['ssms_user_name'];
            }
        } catch (\Throwable $e) {
        }

        return array_values(array_unique($users));
    }

    /** E-mail addresses for a child's family: the parents' accounts and the admission form. */
    private static function familyEmails(string $client, string $eid, array $users): array
    {
        $out = [];
        if ($users) {
            $in = implode(',', array_fill(0, count($users), '?'));
            foreach (self::q("SELECT ssms_user_email FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name IN ($in)", array_merge([$client], $users)) as $r) {
                $out[] = (string)$r['ssms_user_email'];
            }
        }
        try {
            $r = self::db()->execute('SELECT r.email_address FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1', [$eid, $client])->fetch('assoc');
            $out[] = (string)($r['email_address'] ?? '');
        } catch (\Throwable $e) {
        }

        return self::cleanEmails($out);
    }

    private static function cleanEmails(array $list): array
    {
        $out = [];
        foreach ($list as $e) {
            $e = strtolower(trim((string)$e));
            if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) {
                $out[$e] = $e;
            }
        }

        return array_values($out);
    }

    /** Accounts a notice is for: all / parents / students / teachers / staff. */
    public static function audienceRoles(string $audience): array
    {
        return match (strtolower($audience)) {
            'parents' => ['parent'],
            'students' => ['student'],
            'teachers', 'staff' => self::STAFF_ROLES,
            default => array_merge(['parent', 'student'], self::STAFF_ROLES),
        };
    }

    public static function audienceUsers(string $client, string $audience): array
    {
        $roles = self::audienceRoles($audience);
        $in = implode(',', array_fill(0, count($roles), '?'));
        $rows = self::q("SELECT ssms_user_name, ssms_user_role, ssms_user_email, TRIM(CONCAT(COALESCE(ssms_user_firstname,''),' ',COALESCE(ssms_user_lastname,''))) name
            FROM sawera_ssms_users WHERE ssms_client_code = ? AND LOWER(ssms_user_role) IN ($in) AND COALESCE(ssms_user_status, 'active') = 'active'", array_merge([$client], $roles));
        $out = [];
        foreach ($rows as $r) {
            $u = (string)$r['ssms_user_name'];
            if ($u === '' || isset($out[strtolower($u)])) {
                continue;
            }
            $out[strtolower($u)] = ['username' => $u, 'role' => strtolower((string)$r['ssms_user_role']), 'email' => (string)$r['ssms_user_email'],
                'name' => trim((string)$r['name']) ?: $u];
        }

        return array_values($out);
    }

    /** Active enrollments of the current school year (optionally one class / section). */
    private static function enrollments(string $client, ?int $sessionId, ?int $classId = null, ?int $sectionId = null): array
    {
        $w = "e.ssms_client_code = ? AND COALESCE(e.status, 'active') = 'active'";
        $p = [$client];
        if ($sessionId) {
            $w .= ' AND e.session_id = ?';
            $p[] = $sessionId;
        }
        if ($classId) {
            $w .= ' AND e.class_id = ?';
            $p[] = $classId;
        }
        if ($sectionId) {
            $w .= ' AND e.section_id = ?';
            $p[] = $sectionId;
        }

        return array_map(fn($r) => (string)$r['enrollment_id'], self::q("SELECT e.enrollment_id FROM ssms_student_enrollment e WHERE $w", $p));
    }

    private static function currentSession(string $client): ?int
    {
        try {
            $r = self::db()->execute("SELECT session_id FROM ssms_sessions WHERE ssms_client_code = ? ORDER BY (UPPER(COALESCE(is_current,'')) = 'Y') DESC, session_id DESC LIMIT 1",
                [$client])->fetch('assoc');

            return $r ? (int)$r['session_id'] : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    // ── Sending one event ──────────────────────────────────────────────────

    /**
     * Send one event about a child to the family. $render is called in each person's language and returns
     * ['title' => …, 'body' => …]; $data goes with the push (screen to open …). Returns false if already sent.
     */
    public static function family(string $client, string $event, string $ref, string $eid, callable $render, array $data = []): bool
    {
        $s = self::settings($client)[$event];
        if (!$s['enabled']) {
            return false;
        }
        $users = self::familyUsers($client, $eid);
        $emails = $s['email'] ? self::familyEmails($client, $eid, $users) : [];
        if (!self::logOnce($client, $ref, $event, count($users) + count($emails))) {
            return false;
        }
        $data += ['event' => $event, 'enrollment_id' => $eid];
        try {
            self::fanOut($client, $s, $ref, $users, $emails, $render, $data, $eid);
        } catch (\Throwable $e) {
            self::unlog($client, $ref);   // next run finishes it (inbox / outbox rows are unique, nothing is doubled)
            throw $e;
        }

        return true;
    }

    /** Send one event to a list of accounts (+ extra e-mail addresses and phones [[phone, user, lang]]), e.g. a notice. */
    public static function people(string $client, string $event, string $ref, array $users, array $emails, callable $render, array $data = [], array $phones = []): bool
    {
        $s = self::settings($client)[$event];
        if (!$s['enabled']) {
            return false;
        }
        if (!self::logOnce($client, $ref, $event, count($users) + count($emails))) {
            return false;
        }
        try {
            self::fanOut($client, $s, $ref, $users, $s['email'] ? self::cleanEmails($emails) : [], $render, $data + ['event' => $event], null, $phones);
        } catch (\Throwable $e) {
            self::unlog($client, $ref);
            throw $e;
        }

        return true;
    }

    private static function fanOut(string $client, array $s, string $ref, array $users, array $emails, callable $render, array $data, ?string $eid, array $phones = []): void
    {
        $event = $s['event'];
        $emailOfUser = [];
        if ($users && $s['email']) {
            $in = implode(',', array_fill(0, count($users), '?'));
            foreach (self::q("SELECT ssms_user_name, ssms_user_email FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name IN ($in)", array_merge([$client], $users)) as $r) {
                $emailOfUser[strtolower((string)$r['ssms_user_name'])] = strtolower(trim((string)$r['ssms_user_email']));
            }
        }
        $skipEmails = [];
        foreach ($users as $u) {
            $lang = Locale::langFor($client, $u);
            $msg = Locale::withLang($lang, $render);
            $inboxId = self::inboxAdd($client, $u, $event, $ref, $eid, $msg['title'], $msg['body'], $data);
            if (self::wants($client, $s, $u, 'push')) {
                self::queue($client, $event, $ref, 'push', $u, $u, $eid, $msg['title'], $msg['body'], $data + ['inbox_id' => $inboxId], $lang);
            }
            $em = $emailOfUser[strtolower($u)] ?? '';
            if ($em !== '' && !self::wants($client, $s, $u, 'email')) {
                $skipEmails[$em] = true;   // this person turned e-mail off
            }
        }
        foreach ($emails as $em) {
            if (isset($skipEmails[$em])) {
                continue;
            }
            $lang = Locale::langForEmail($client, $em, $eid);
            $msg = Locale::withLang($lang, $render);
            self::queue($client, $event, $ref, 'email', null, $em, $eid, $msg['title'], (string)($msg['email_body'] ?? $msg['body']), $data, $lang);
        }
        // SMS / WhatsApp (phase 2): one per phone number of the family / person
        if ((!empty($s['sms']) && Messaging::active($client, 'sms')) || (!empty($s['whatsapp']) && Messaging::active($client, 'whatsapp'))) {
            $list = $eid !== null ? Messaging::familyPhones($client, $eid) : [];
            foreach (array_merge(Messaging::userPhones($client, $eid !== null ? [] : $users), $phones) as $p) {
                $list[] = $p;
            }
            $seen = [];
            $list = array_values(array_filter($list, function ($p) use (&$seen) {
                if (isset($seen[$p['phone']])) {
                    return false;
                }

                return $seen[$p['phone']] = true;
            }));
            // who could read it in the app first (has a phone with the app)
            $appUsers = array_values(array_filter($users, fn($u) => Meetings::tokensOfUser($client, (string)$u) !== []));
            Messaging::queue($client, $s, $ref, $data, $eid, $list, $render, $appUsers);
        }
    }

    /**
     * Bell + push to some accounts (each in their own language), e.g. a teacher given a cover period.
     * $ref makes it once only per person. Returns how many new inbox entries were made.
     */
    public static function toUsers(string $client, string $ref, array $users, callable $render, array $data = []): int
    {
        $n = 0;
        $data += ['event' => 'school'];
        foreach (array_values(array_unique(array_filter(array_map('strval', $users)))) as $u) {
            try {
                $lang = Locale::langFor($client, $u);
                $msg = Locale::withLang($lang, $render);
                $id = self::inboxAdd($client, $u, (string)$data['event'], $ref, null, (string)$msg['title'], (string)$msg['body'], $data);
                if ($id !== null) {
                    self::queue($client, (string)$data['event'], $ref, 'push', $u, $u, null, (string)$msg['title'], (string)$msg['body'], $data + ['inbox_id' => $id], $lang);
                    $n++;
                }
            } catch (\Throwable $e) {
                Log::warning('Notify toUsers: ' . $e->getMessage());
            }
        }

        return $n;
    }

    /** A message to the school office (owner / admin): bell + push. */
    public static function alertStaff(string $client, string $ref, callable $render): void
    {
        try {
            foreach (self::q("SELECT ssms_user_name FROM sawera_ssms_users WHERE ssms_client_code = ? AND LOWER(ssms_user_role) IN ('owner','admin') AND COALESCE(ssms_user_status,'active') = 'active'",
                [$client]) as $r) {
                $u = (string)$r['ssms_user_name'];
                $lang = Locale::langFor($client, $u);
                $msg = Locale::withLang($lang, $render);
                $data = ['event' => 'school', 'screen' => 'NotificationSettings'];
                if (self::inboxAdd($client, $u, 'school', $ref, null, $msg['title'], $msg['body'], $data) !== null) {
                    self::queue($client, 'school', $ref, 'push', $u, $u, null, $msg['title'], $msg['body'], $data, $lang);
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Notify alertStaff: ' . $e->getMessage());
        }
    }

    private static function inboxAdd(string $client, string $user, string $event, string $ref, ?string $eid, string $title, string $body, array $data): ?int
    {
        $db = self::db();
        $n = $db->execute('INSERT IGNORE INTO ssms_notify_inbox (ssms_client_code, username, event, ref, enrollment_id, title, body, data, created) VALUES (?,?,?,?,?,?,?,?,?)',
            [$client, $user, $event, $ref, $eid, mb_substr($title, 0, 250), $body, json_encode($data), self::now()])->rowCount();
        if ($n < 1) {
            return null;
        }

        return (int)$db->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'];
    }

    private static function queue(string $client, string $event, string $ref, string $channel, ?string $user, string $address, ?string $eid,
                                  string $title, string $body, array $data, string $lang, ?string $sendAfter = null): int
    {
        return self::db()->execute('INSERT IGNORE INTO ssms_notify_outbox (ssms_client_code, event, ref, channel, username, address, enrollment_id, lang, title, body, data, status, send_after, created)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$client, $event, $ref, $channel, $user, mb_substr($address, 0, 190), $eid, $lang, mb_substr($title, 0, 250), $body, json_encode($data), 'queued',
             $sendAfter ?? self::now(), self::now()])->rowCount();
    }

    /** true the first time a ref is seen (the event is then sent), false after. */
    private static function logOnce(string $client, string $ref, string $event, int $recipients): bool
    {
        return self::db()->execute('INSERT IGNORE INTO ssms_notify_log (ssms_client_code, ref, event, recipients, created) VALUES (?,?,?,?,?)',
            [$client, $ref, $event, $recipients, self::now()])->rowCount() > 0;
    }

    private static function unlog(string $client, string $ref): void
    {
        try {
            self::db()->execute('DELETE FROM ssms_notify_log WHERE ssms_client_code = ? AND ref = ?', [$client, $ref]);
        } catch (\Throwable $e) {
        }
    }

    private static function logged(string $client, string $ref): bool
    {
        return (bool)self::db()->execute('SELECT 1 FROM ssms_notify_log WHERE ssms_client_code = ? AND ref = ?', [$client, $ref])->fetch('assoc');
    }

    // ── Pushes from the older features (meetings, exams, leave, check-in) also go to the inbox ──

    /** $messages: Expo messages already written for one phone each. */
    public static function mirror(array $messages): void
    {
        try {
            foreach ($messages as $m) {
                $to = (string)($m['to'] ?? '');
                if ($to === '' || (($m['data']['type'] ?? '') === 'notify')) {
                    continue;
                }
                $who = self::db()->execute('SELECT ssms_client_code c, username u FROM ssms_push_tokens WHERE token = ? LIMIT 1', [$to])->fetch('assoc')
                    ?: self::db()->execute('SELECT client_code c, username u FROM ssms_user_presence WHERE push_token = ? LIMIT 1', [$to])->fetch('assoc');
                if (!$who || !$who['u']) {
                    continue;
                }
                $data = (array)($m['data'] ?? []);
                $event = mb_substr((string)($data['type'] ?? 'school'), 0, 30);
                // same message to two phones of one person → one inbox entry
                $ref = 'push:' . substr(sha1((string)($m['title'] ?? '') . '|' . (string)($m['body'] ?? '') . '|' . date('Y-m-d H', strtotime(self::now()))), 0, 24);
                self::inboxAdd((string)$who['c'], (string)$who['u'], $event, $ref, isset($data['enrollment_id']) ? (string)$data['enrollment_id'] : null,
                    (string)($m['title'] ?? ''), (string)($m['body'] ?? ''), $data);
            }
        } catch (\Throwable $e) {
            // the inbox must never stop the push itself
        }
    }

    // ── The worker ─────────────────────────────────────────────────────────

    /** Called when someone opens the app: runs the school's worker at most once a minute. */
    public static function tick(string $client): void
    {
        try {
            $now = self::now();
            $cut = date('Y-m-d H:i:s', strtotime($now) - 60);
            $db = self::db();
            $db->execute('INSERT IGNORE INTO ssms_notify_state (ssms_client_code, k, v) VALUES (?,?,?)', [$client, 'tick_at', '2000-01-01 00:00:00']);
            if ($db->execute('UPDATE ssms_notify_state SET v = ? WHERE ssms_client_code = ? AND k = ? AND v < ?', [$now, $client, 'tick_at', $cut])->rowCount() < 1) {
                return;
            }
            // runs inside an app request: let it finish even if the phone stops waiting
            @ignore_user_abort(true);
            @set_time_limit(120);
            self::run($client, 40);
        } catch (\Throwable $e) {
            Log::warning('Notify tick ' . $client . ': ' . $e->getMessage());
        }
    }

    /** Look for new events and send what is due. $client null = every school (cron). Returns messages sent. */
    public static function run(?string $client = null, int $emailLimit = 200): int
    {
        $clients = $client !== null ? [$client] : array_column(self::q('SELECT DISTINCT ssms_client_code c FROM ssms_clients WHERE ssms_client_code IS NOT NULL', []), 'c');
        $sent = 0;
        foreach ($clients as $c) {
            $c = (string)$c;
            try {
                self::scan($c);
            } catch (\Throwable $e) {
                Log::warning("Notify scan {$c}: " . $e->getMessage());
            }
            $sent += self::deliver($c, $emailLimit);
        }

        return $sent;
    }

    /** Find new events in the school's data. */
    public static function scan(string $client): void
    {
        if (self::state($client, 'started_at') === null) {
            self::start($client);

            return;
        }
        $s = self::settings($client);
        if ($s['absence']['enabled']) {
            self::scanAbsences($client, $s['absence']);
        }
        if ($s['fee_due']['enabled']) {
            self::scanFees($client, $s['fee_due']);
        }
        // switched off: move past what is there now, so it is not sent when switched on again
        $s['arrival']['enabled'] ? self::scanArrivals($client) : self::skipTo($client, ['arrival']);
        $s['notice']['enabled'] ? self::scanNotices($client) : self::skipTo($client, ['notice']);
        $s['homework']['enabled'] ? self::scanHomework($client, $s['homework']) : self::skipTo($client, ['homework']);
        $s['results']['enabled'] ? self::scanResults($client) : self::skipTo($client, ['results']);
        Cover::morningAlert($client);   // teacher cover: periods still without a cover teacher this morning
        Safety::daily($client);         // visitors: close yesterday's, remove old details; old one-off pick-up persons
        BusTracking::tick($client);     // buses: end trips with no position for a long time; old positions removed
    }

    /** First run for a school: nothing from before today is sent (no flood of old notices). */
    private static function start(string $client): void
    {
        self::skipTo($client, ['notice', 'homework', 'arrival', 'results']);
        self::setState($client, 'started_at', self::now());
    }

    private static function skipTo(string $client, array $what): void
    {
        $max = function (string $sql) use ($client) {
            try {
                return (string)(int)(self::db()->execute($sql, [$client])->fetch('assoc')['m'] ?? 0);
            } catch (\Throwable $e) {
                return '0';
            }
        };
        $sql = ['notice' => ['notice_id', 'SELECT MAX(notice_id) m FROM ssms_notices WHERE ssms_client_code = ?'],
                'homework' => ['homework_id', 'SELECT MAX(id) m FROM ssms_homework WHERE ssms_client_code = ?'],
                'arrival' => ['arrival_id', 'SELECT MAX(id) m FROM ssms_student_arrivals WHERE ssms_client_code = ?']];
        foreach ($what as $w) {
            if (isset($sql[$w])) {
                self::setState($client, $sql[$w][0], $max($sql[$w][1]));
            }
        }
        if (in_array('notice', $what, true)) {
            self::setState($client, 'notice_waiting', '');
        }
        if (in_array('homework', $what, true)) {
            self::setState($client, 'homework_digest_id', (string)self::state($client, 'homework_id'));
        }
        if (in_array('results', $what, true)) {
            try {
                foreach (self::q('SELECT id FROM ssms_report_card_plans WHERE ssms_client_code = ? AND is_published = 1', [$client]) as $p) {
                    self::logOnce($client, 'results:' . $p['id'], 'results', 0);
                }
            } catch (\Throwable $e) {
            }
        }
    }

    private static function scanAbsences(string $client, array $s): void
    {
        $today = Locale::today($client);
        $since = (string)self::state($client, 'started_at');
        $ready = date('Y-m-d H:i:s', strtotime(self::now()) - 60 * (int)$s['options']['delay_minutes']);
        $rows = self::q("SELECT enrollment_id, attendance, modified FROM student_attendance WHERE ssms_client_code = ? AND attendance_date = ? AND modified >= ?",
            [$client, $today, $since]);
        foreach ($rows as $r) {
            $eid = (string)$r['enrollment_id'];
            $ref = 'absence:' . $eid . ':' . $today;
            $absent = strtoupper((string)$r['attendance']) === 'A';
            if ($absent && (string)$r['modified'] <= $ready) {
                self::family($client, 'absence', $ref, $eid, function () use ($client, $eid, $today) {
                    $stu = StudentLeave::enrollment($client, $eid);

                    $v = ['student' => $stu['student_name'] ?? $eid, 'date' => Locale::date($client, $today, 'medium')];

                    return ['title' => Locale::t($client, 'Absent today'), 'body' => Locale::t($client, '{student} was marked absent today ({date}).', $v), 'kind' => 'absence', 'vars' => $v];
                }, ['screen' => 'MyAttendance']);
            } elseif (!$absent && (int)$s['options']['correction'] === 1 && self::logged($client, $ref)) {
                self::family($client, 'absence', $ref . ':fix', $eid, function () use ($client, $eid, $today) {
                    $stu = StudentLeave::enrollment($client, $eid);

                    $v = ['student' => $stu['student_name'] ?? $eid, 'date' => Locale::date($client, $today, 'medium')];

                    return ['title' => Locale::t($client, 'Attendance corrected'), 'body' => Locale::t($client, '{student} is not absent today ({date}). Please ignore the earlier message.', $v),
                            'kind' => 'absence_fix', 'vars' => $v];
                }, ['screen' => 'MyAttendance']);
            }
        }
    }

    private static function scanArrivals(string $client): void
    {
        $last = (int)self::state($client, 'arrival_id');
        $today = Locale::today($client);
        try {
            $rows = self::q('SELECT id, enrollment_id, kind, event_date, event_time, picked_up_by FROM ssms_student_arrivals WHERE ssms_client_code = ? AND id > ? ORDER BY id LIMIT 500', [$client, $last]);
        } catch (\Throwable $e) {
            return;
        }
        foreach ($rows as $r) {
            $last = max($last, (int)$r['id']);
            if (substr((string)$r['event_date'], 0, 10) !== $today) {
                continue;   // recorded for another day: not news
            }
            $eid = (string)$r['enrollment_id'];
            $kind = strtolower((string)$r['kind']);
            $early = str_contains($kind, 'early');
            $pickup = $kind === 'pickup';   // collected at the gate after school (Safety)
            if (!$early && !$pickup && !str_contains($kind, 'late')) {
                continue;
            }
            $time = substr((string)$r['event_time'], 0, 5);
            $person = trim((string)($r['picked_up_by'] ?? ''));
            self::family($client, 'arrival', 'arrival:' . $r['id'], $eid, function () use ($client, $eid, $early, $pickup, $time, $person) {
                $stu = StudentLeave::enrollment($client, $eid);
                $v = ['student' => $stu['student_name'] ?? $eid, 'time' => Locale::time($client, $time)];
                if ($pickup) {
                    $v['person'] = $person !== '' ? $person : Locale::t($client, 'an authorised person');

                    return ['title' => Locale::t($client, 'Collected from school'), 'body' => Locale::t($client, '{student} was collected at {time} by {person}.', $v), 'kind' => 'pickup', 'vars' => $v];
                }
                if ($early) {
                    $body = $person !== '' ? Locale::t($client, '{student} was picked up early today at {time} by {person}.', $v + ['person' => $person])
                        : Locale::t($client, '{student} was picked up early today at {time}.', $v);

                    return ['title' => Locale::t($client, 'Early pick-up'), 'body' => $body, 'kind' => 'early', 'vars' => $v];
                }

                return ['title' => Locale::t($client, 'Late arrival'), 'body' => Locale::t($client, '{student} arrived late today at {time}.', $v), 'kind' => 'late', 'vars' => $v];
            }, $pickup ? ['screen' => 'MyPickup', 'enrollment_id' => $eid] : ['screen' => 'MyAbsences']);
        }
        self::setState($client, 'arrival_id', (string)$last);
    }

    private static function scanNotices(string $client): void
    {
        $last = (int)self::state($client, 'notice_id');
        // notices saved as drafts (inactive) wait on a short list and are sent when switched on
        $waiting = array_values(array_filter(array_map('intval', explode(',', (string)self::state($client, 'notice_waiting')))));
        $cols = 'notice_id, title, body, target_audience, is_active, expires_at';
        try {
            $rows = self::q("SELECT $cols FROM ssms_notices WHERE ssms_client_code = ? AND notice_id > ? ORDER BY notice_id LIMIT 50", [$client, $last]);
            if ($waiting) {
                $rows = array_merge(self::q("SELECT $cols FROM ssms_notices WHERE ssms_client_code = ? AND notice_id IN (" . implode(',', array_fill(0, count($waiting), '?')) . ')',
                    array_merge([$client], $waiting)), $rows);
            }
        } catch (\Throwable $e) {
            return;
        }
        $still = [];
        $today = Locale::today($client);
        foreach ($rows as $n) {
            $id = (int)$n['notice_id'];
            $last = max($last, $id);
            if ($n['expires_at'] && substr((string)$n['expires_at'], 0, 10) < $today) {
                continue;
            }
            if (!(int)$n['is_active']) {
                $still[$id] = $id;
                continue;
            }
            self::sendNotice($client, $n);
        }
        self::setState($client, 'notice_id', (string)$last);
        self::setState($client, 'notice_waiting', implode(',', array_slice(array_values($still), -50)));
    }

    private static function sendNotice(string $client, array $n): void
    {
        $aud = strtolower((string)$n['target_audience']);
        $people = self::audienceUsers($client, $aud);
        $emails = array_column($people, 'email');
        if (in_array($aud, ['all', 'parents', ''], true)) {
            // families without an app account still get the e-mail from the admission form
            try {
                $sid = self::currentSession($client);
                foreach (self::q("SELECT DISTINCT r.email_address FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                    WHERE e.ssms_client_code = ? AND COALESCE(e.status,'active') = 'active'" . ($sid ? ' AND e.session_id = ?' : ''), $sid ? [$client, $sid] : [$client]) as $r) {
                    $emails[] = $r['email_address'];
                }
            } catch (\Throwable $e) {
            }
        }
        $title = (string)$n['title'];
        $snippet = mb_substr(trim(preg_replace('/\s+/u', ' ', strip_tags((string)$n['body']))), 0, 180);
        $full = (string)$n['body'];
        $id = (int)$n['notice_id'];
        self::people($client, 'notice', 'notice:' . $id, array_column($people, 'username'), $emails, fn() => [
            'title' => Locale::t($client, 'New notice: {title}', ['title' => $title]),
            'body' => $snippet,
            'email_body' => $full,
            'kind' => 'notice', 'vars' => ['title' => mb_substr($title, 0, 120)],
        ], ['screen' => 'NoticeBoard', 'notice_id' => $id], in_array($aud, ['all', 'parents', ''], true) ? Messaging::schoolFamilyPhones($client, self::currentSession($client)) : []);
    }

    private static function scanHomework(string $client, array $s): void
    {
        $last = (int)self::state($client, 'homework_id');
        $today = Locale::today($client);
        if ($s['options']['mode'] === 'instant') {
            try {
                $rows = self::q("SELECT id, class_id, section_id, session_id, subject_name, title, due_date FROM ssms_homework
                    WHERE ssms_client_code = ? AND id > ? AND COALESCE(status,'active') = 'active' ORDER BY id LIMIT 300", [$client, $last]);
            } catch (\Throwable $e) {
                return;
            }
            foreach ($rows as $h) {
                foreach (self::classEnrollments($client, $h) as $eid) {
                    self::family($client, 'homework', 'homework:' . $h['id'] . ':' . $eid, $eid, fn() => [
                        'title' => Locale::t($client, 'New homework – {subject}', ['subject' => $h['subject_name'] ?: Locale::t($client, 'Homework')]),
                        'body' => $h['title'] . ($h['due_date'] ? ' · ' . Locale::t($client, 'Due {date}', ['date' => Locale::date($client, (string)$h['due_date'], 'medium')]) : ''),
                        'kind' => 'homework', 'vars' => ['student' => StudentLeave::enrollment($client, $eid)['student_name'] ?? $eid,
                            'subject' => $h['subject_name'] ?: Locale::t($client, 'Homework'), 'title' => mb_substr((string)$h['title'], 0, 120)],
                    ], ['screen' => 'MyHomework']);
                }
                $last = max($last, (int)$h['id']);
                self::setState($client, 'homework_id', (string)$last);
            }
            self::setState($client, 'homework_digest_id', (string)$last);   // switching to "one a day" later does not repeat these

            return;
        }
        // one message a day, at the school's time, listing the homework set since the last one
        try {
            $max = (int)(self::db()->execute('SELECT MAX(id) m FROM ssms_homework WHERE ssms_client_code = ?', [$client])->fetch('assoc')['m'] ?? 0);
        } catch (\Throwable $e) {
            return;
        }
        self::setState($client, 'homework_id', (string)max($last, $max));   // switching to "straight away" later does not repeat these
        if (Locale::now($client, 'H:i') < (string)$s['options']['digest_time'] || self::state($client, 'homework_digest') === $today) {
            return;
        }
        $from = (int)self::state($client, 'homework_digest_id');
        $list = self::q("SELECT id, class_id, section_id, session_id, subject_name, title, due_date FROM ssms_homework
            WHERE ssms_client_code = ? AND id > ? AND id <= ? AND COALESCE(status,'active') = 'active' ORDER BY subject_name, id LIMIT 1000", [$client, $from, $max]);
        $byStudent = [];
        foreach ($list as $h) {
            foreach (self::classEnrollments($client, $h) as $eid) {
                $byStudent[$eid][] = $h;
            }
        }
        foreach ($byStudent as $eid => $items) {
            self::family($client, 'homework', 'homework_day:' . $eid . ':' . $today, (string)$eid, function () use ($client, $items, $eid) {
                $lines = [];
                foreach ($items as $h) {
                    $lines[] = '• ' . ($h['subject_name'] ? $h['subject_name'] . ': ' : '') . $h['title']
                        . ($h['due_date'] ? ' (' . Locale::t($client, 'due {date}', ['date' => Locale::date($client, (string)$h['due_date'], 'medium')]) . ')' : '');
                }
                $stu = StudentLeave::enrollment($client, (string)$eid);

                $subjects = implode(', ', array_unique(array_filter(array_map(fn($h) => (string)$h['subject_name'], $items)))) ?: (string)count($items);

                return ['title' => Locale::t($client, "Today's homework – {student}", ['student' => $stu['student_name'] ?? $eid]), 'body' => implode("\n", $lines),
                        'kind' => 'homework_day', 'vars' => ['student' => $stu['student_name'] ?? $eid, 'subjects' => mb_substr($subjects, 0, 160)]];
            }, ['screen' => 'MyHomework']);
        }
        // only once every family has it (a run stopped half-way carries on next time without repeats)
        self::setState($client, 'homework_digest_id', (string)$max);
        self::setState($client, 'homework_digest', $today);
    }

    /** The students a homework (or plan) row is for; no school year on the row = the current one. */
    private static function classEnrollments(string $client, array $h): array
    {
        return self::enrollments($client, (int)($h['session_id'] ?? 0) ?: self::currentSession($client), (int)($h['class_id'] ?? 0) ?: null,
            !empty($h['section_id']) ? (int)$h['section_id'] : null);
    }

    private static function scanResults(string $client): void
    {
        try {
            $plans = self::q('SELECT id, name, session_id, class_id FROM ssms_report_card_plans WHERE ssms_client_code = ? AND is_published = 1', [$client]);
        } catch (\Throwable $e) {
            return;
        }
        foreach ($plans as $p) {
            $ref = 'results:' . $p['id'];
            if (self::logged($client, $ref)) {
                continue;
            }
            $name = (string)$p['name'];
            foreach (self::classEnrollments($client, $p) as $eid) {
                self::family($client, 'results', $ref . ':' . $eid, $eid, function () use ($client, $eid, $name) {
                    $stu = StudentLeave::enrollment($client, $eid);

                    $v = ['name' => $name, 'student' => $stu['student_name'] ?? $eid];

                    return ['title' => Locale::t($client, 'Report card published'), 'body' => Locale::t($client, 'The {name} report card for {student} is ready in the app.', $v),
                            'kind' => 'results', 'vars' => $v];
                }, ['screen' => 'MyReportCards']);
            }
            self::logOnce($client, $ref, 'results', 0);   // once every family has it
        }
    }

    private static function scanFees(string $client, array $s): void
    {
        // once a day, from 8 am school time (not at night)
        $today = Locale::today($client);
        if (Locale::now($client, 'H:i') < '08:00' || self::state($client, 'fee_scan') === $today) {
            return;
        }
        $sid = self::currentSession($client);
        if (!$sid) {
            self::setState($client, 'fee_scan', $today);

            return;
        }
        $o = $s['options'];
        $soon = date('Y-m-d', strtotime($today . ' +' . (int)$o['days_before'] . ' days'));
        $from = date('Y-m-d', strtotime($today . ' -' . max(0, (int)$o['overdue_for_days']) . ' days'));
        try {
            $items = Analytics::owedItems($client, $sid, $from, $soon);
        } catch (\Throwable $e) {
            Log::warning("Notify fees {$client}: " . $e->getMessage());

            return;
        }
        $per = [];
        foreach ($items as $it) {
            $per[$it['enrollment_id']][] = $it;
        }
        foreach ($per as $eid => $list) {
            $eid = (string)$eid;
            $soonSum = $todaySum = $overSum = 0.0;
            $oldest = null;
            $cadence = false;
            foreach ($list as $it) {
                if ((int)$o['days_before'] > 0 && $it['due_date'] === $soon) {
                    $soonSum += $it['owed'];
                } elseif ($it['due_date'] === $today) {
                    $todaySum += $it['owed'];
                } elseif ($it['due_date'] < $today) {
                    $overSum += $it['owed'];
                    $oldest = $oldest === null ? $it['due_date'] : min($oldest, $it['due_date']);
                }
            }
            $name = fn() => StudentLeave::enrollment($client, $eid)['student_name'] ?? $eid;
            if ($todaySum > 0 && (int)$o['on_due_day'] === 1) {
                self::family($client, 'fee_due', "fee_today:$eid:$today", $eid, function () use ($client, $todaySum, $name) {
                    $v = ['amount' => Locale::money($client, $todaySum), 'student' => $name()];

                    return ['title' => Locale::t($client, 'Fee due today'), 'body' => Locale::t($client, '{amount} for {student} is due today.', $v), 'kind' => 'fee_today', 'vars' => $v];
                }, ['screen' => 'MyFee']);
            } elseif ($soonSum > 0) {
                self::family($client, 'fee_due', "fee_soon:$eid:$today", $eid, function () use ($client, $soonSum, $name, $soon) {
                    $v = ['amount' => Locale::money($client, $soonSum), 'student' => $name(), 'date' => Locale::date($client, $soon, 'medium')];

                    return ['title' => Locale::t($client, 'Fee due soon'), 'body' => Locale::t($client, '{amount} for {student} is due on {date}.', $v), 'kind' => 'fee_soon', 'vars' => $v];
                }, ['screen' => 'MyFee']);
            }
            // overdue: the first reminder the day after the due date, then every N days (also when a day was missed)
            if ($overSum > 0 && (int)$o['overdue_every'] > 0) {
                // the school's date is the last part of the ref (the log's own time is the server's)
                $prev = (string)(self::db()->execute("SELECT MAX(SUBSTRING_INDEX(ref, ':', -1)) d FROM ssms_notify_log WHERE ssms_client_code = ? AND ref LIKE ?",
                    [$client, 'fee_overdue:' . $eid . ':%'])->fetch('assoc')['d'] ?? '');
                $cadence = $prev === '' || (strtotime($today) - strtotime($prev)) / 86400 >= (int)$o['overdue_every'];
            }
            if ($overSum > 0 && $cadence) {
                self::family($client, 'fee_due', "fee_overdue:$eid:$today", $eid, function () use ($client, $overSum, $name, $oldest) {
                    $v = ['amount' => Locale::money($client, $overSum), 'student' => $name(), 'date' => Locale::date($client, (string)$oldest, 'medium')];

                    return ['title' => Locale::t($client, 'Fee overdue'), 'body' => Locale::t($client, '{amount} for {student} is overdue since {date}. Please pay in the app or at the school office.', $v),
                            'kind' => 'fee_overdue', 'vars' => $v];
                }, ['screen' => 'MyFee']);
            }
        }
        self::setState($client, 'fee_scan', $today);   // once every family has it
    }

    // ── Delivery ───────────────────────────────────────────────────────────

    /** Send what is due for one school. Returns how many went out. */
    /** Send the pushes that are due now (no e-mail / SMS), e.g. right after a teacher was given a cover period. */
    public static function pushNow(string $client): int
    {
        return self::deliver($client, 0, true);
    }

    public static function deliver(string $client, int $emailLimit = 200, bool $pushOnly = false): int
    {
        // one sender per school at a time (cron and an app request may overlap): no message goes out twice
        $lock = 'notify_send_' . md5($client);
        try {
            $got = (int)(self::db()->execute('SELECT GET_LOCK(?, 0) l', [$lock])->fetch('assoc')['l'] ?? 0);
        } catch (\Throwable $e) {
            $got = 1;
        }
        if ($got !== 1) {
            return 0;
        }
        try {
            return self::deliverLocked($client, $emailLimit, $pushOnly);
        } finally {
            try {
                self::db()->execute('SELECT RELEASE_LOCK(?)', [$lock]);
            } catch (\Throwable $e) {
            }
        }
    }

    private static function deliverLocked(string $client, int $emailLimit, bool $pushOnly = false): int
    {
        $now = self::now();
        $sent = 0;
        // pushes: all due, Expo takes 100 per call
        $rows = self::q("SELECT * FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel = 'push' AND status = 'queued' AND send_after <= ? ORDER BY id LIMIT 2000", [$client, $now]);
        $msgs = [];
        $rowOf = [];
        $attempts = [];
        foreach ($rows as $r) {
            $tokens = Meetings::tokensOfUser($client, (string)$r['username']);
            if (!$tokens) {
                self::mark((int)$r['id'], 'skipped', 'No phone with the app');
                continue;
            }
            $attempts[(int)$r['id']] = (int)$r['attempts'];
            $data = json_decode((string)$r['data'], true) ?: [];
            foreach ($tokens as $t) {
                // 'user' lets the phone ignore a tap meant for whoever was signed in before
                $msgs[] = ['to' => $t, 'sound' => 'default', 'title' => $r['title'], 'body' => mb_substr((string)$r['body'], 0, 900),
                    'data' => $data + ['type' => 'notify', 'ref' => $r['ref'], 'user' => (string)$r['username']], 'channelId' => 'chat'];
                $rowOf[] = (int)$r['id'];
            }
        }
        // per row: 'ok' when at least one of the person's phones accepted it; 'retry' when Expo could not be reached
        $result = array_fill_keys(array_unique($rowOf), 'refused');
        foreach (array_chunk(array_keys($msgs), 100) as $chunk) {
            $tickets = self::expo(array_map(fn($i) => $msgs[$i], $chunk));
            foreach ($chunk as $k => $i) {
                $id = $rowOf[$i];
                if ($tickets === null) {
                    if ($result[$id] !== 'ok') {
                        $result[$id] = 'retry';
                    }
                    continue;
                }
                $t = $tickets[$k] ?? ['status' => 'error'];
                if (($t['status'] ?? '') === 'ok') {
                    $result[$id] = 'ok';
                } elseif (($t['details']['error'] ?? '') === 'DeviceNotRegistered') {
                    self::forgetDevice((string)$msgs[$i]['to']);
                }
            }
        }
        foreach ($result as $id => $res) {
            if ($res === 'ok') {
                self::mark($id, 'sent', null);
                $sent++;
            } elseif ($res === 'retry' && $attempts[$id] + 1 < 3) {
                self::db()->execute('UPDATE ssms_notify_outbox SET attempts = attempts + 1, error = ?, send_after = ? WHERE id = ?',
                    ['The notification service could not be reached', date('Y-m-d H:i:s', strtotime($now) + 300 * ($attempts[$id] + 1)), $id]);
            } else {
                self::mark($id, 'failed', $res === 'retry' ? 'The notification service could not be reached' : 'The phone did not accept the notification');
            }
        }
        if ($pushOnly) {
            return $sent;
        }
        // e-mails: a few at a time (each one is a call to the mail server)
        $rows = self::q("SELECT * FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel = 'email' AND status = 'queued' AND send_after <= ? ORDER BY id LIMIT " . max(1, $emailLimit),
            [$client, $now]);
        foreach ($rows as $r) {
            try {
                self::email($client, $r);
                self::mark((int)$r['id'], 'sent', null);
                $sent++;
            } catch (\Throwable $e) {
                $tries = (int)$r['attempts'] + 1;
                self::db()->execute('UPDATE ssms_notify_outbox SET attempts = ?, error = ?, status = ?, send_after = ? WHERE id = ?',
                    [$tries, mb_substr($e->getMessage(), 0, 250), $tries >= 3 ? 'failed' : 'queued', date('Y-m-d H:i:s', strtotime($now) + 600 * $tries), (int)$r['id']]);
            }
        }

        // SMS / WhatsApp (phase 2)
        try {
            $sent += Messaging::deliver($client, 300);
        } catch (\Throwable $e) {
            Log::warning("Notify messaging {$client}: " . $e->getMessage());
        }

        return $sent;
    }

    private static function mark(int $id, string $status, ?string $error): void
    {
        self::db()->execute('UPDATE ssms_notify_outbox SET status = ?, error = ?, attempts = attempts + 1, sent_at = ? WHERE id = ?',
            [$status, $error, $status === 'sent' ? self::now() : null, $id]);
    }

    /** Expo push; one ticket per message (['status' => 'ok'|'error', …]), or null when Expo could not be reached (try again later). */
    private static function expo(array $messages): ?array
    {
        if (is_callable(self::$push)) {
            $r = (self::$push)($messages);

            return $r === null ? null : array_values((array)$r);
        }
        try {
            $ch = curl_init('https://exp.host/--/api/v2/push/send');
            curl_setopt_array($ch, [
                CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($messages), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
                CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
            ]);
            $res = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            $j = is_string($res) ? json_decode($res, true) : null;
            if ($res === false || $code >= 500 || $code === 429 || !is_array($j)) {
                Log::warning("Notify push: Expo not reachable (HTTP {$code})");

                return null;
            }
            if (!is_array($j['data'] ?? null)) {
                // the whole request was refused (e.g. bad message): every message failed
                Log::warning('Notify push: ' . mb_substr(json_encode($j['errors'] ?? $j), 0, 500));

                return array_fill(0, count($messages), ['status' => 'error']);
            }

            return array_values($j['data']);
        } catch (\Throwable $e) {
            Log::warning('Notify push: ' . $e->getMessage());

            return null;
        }
    }

    private static function email(string $client, array $r): void
    {
        $school = self::school($client);
        $data = json_decode((string)$r['data'], true) ?: [];
        $body = (string)($data['email_body'] ?? $r['body']);
        $prev = Locale::useLang($r['lang'] ?: null);
        try {
            $subject = $r['title'] . ' – ' . $school['name'];
            if (is_callable(self::$mail)) {
                (self::$mail)((string)$r['address'], $subject, $body, $school);

                return;
            }
            $mailer = new \Cake\Mailer\Mailer('default');
            $from = $school['email'] && filter_var($school['email'], FILTER_VALIDATE_EMAIL) ? $school['email'] : env('EMAIL_FROM_ADDRESS', 'admin@sawera.info');
            $mailer->setFrom([$from => $school['name']])
                ->setTo((string)$r['address'])
                ->setSubject($subject)
                ->setEmailFormat('html')
                ->viewBuilder()->setTemplate('notification')->setLayout('default')
                ->setVars(['title' => (string)$r['title'], 'body' => $body, 'schoolName' => $school['name'], 'schoolClientCode' => $client]);
            $mailer->send();
        } finally {
            Locale::endLang($prev);
        }
    }

    public static function school(string $client): array
    {
        try {
            $r = self::db()->execute('SELECT ssms_client_header_text, ssms_client_name, ssms_client_email FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1', [$client])->fetch('assoc');
        } catch (\Throwable $e) {
            $r = null;
        }

        return ['name' => trim((string)($r['ssms_client_header_text'] ?? '')) ?: (trim((string)($r['ssms_client_name'] ?? '')) ?: $client),
                'email' => trim((string)($r['ssms_client_email'] ?? ''))];
    }

    // ── Delivery log (Setup › Notifications) ───────────────────────────────

    public static function log(string $client, array $f = []): array
    {
        $w = 'ssms_client_code = ?';
        $p = [$client];
        if (!empty($f['event']) && (isset(self::EVENTS[$f['event']]) || $f['event'] === 'test')) {
            $w .= ' AND event = ?';
            $p[] = $f['event'];
        }
        if (!empty($f['channel']) && in_array($f['channel'], self::CHANNELS, true)) {
            $w .= ' AND channel = ?';
            $p[] = $f['channel'];
        }
        if (!empty($f['status']) && in_array($f['status'], ['queued', 'sent', 'failed', 'skipped'], true)) {
            $w .= ' AND status = ?';
            $p[] = $f['status'];
        }
        try {
            $rows = self::q("SELECT id, event, channel, username, address, title, status, error, created, sent_at, delivered_at, read_at, segments, cost FROM ssms_notify_outbox WHERE $w ORDER BY id DESC LIMIT 200", $p);
        } catch (\Throwable $e) {
            $rows = self::q("SELECT id, event, channel, username, address, title, status, error, created, sent_at FROM ssms_notify_outbox WHERE $w ORDER BY id DESC LIMIT 200", $p);
        }
        $totals = [];
        foreach (self::q("SELECT channel, status, COUNT(*) n FROM ssms_notify_outbox WHERE ssms_client_code = ? AND created >= ? GROUP BY channel, status",
            [$client, date('Y-m-d H:i:s', strtotime(self::now()) - 30 * 86400)]) as $t) {
            $totals[$t['channel']][$t['status']] = (int)$t['n'];
        }

        return ['rows' => array_map(fn($r) => ['id' => (int)$r['id'], 'event' => $r['event'], 'channel' => $r['channel'],
            'to' => $r['channel'] === 'email' ? self::maskEmail((string)$r['address']) : (in_array($r['channel'], self::PAID, true) ? MessagingCountries::mask((string)$r['address']) : (string)$r['username']),
            'title' => $r['title'], 'status' => $r['status'], 'error' => $r['error'], 'created' => self::local($client, $r['created']), 'sent_at' => self::local($client, $r['sent_at']),
            'delivered' => !empty($r['delivered_at']), 'read' => !empty($r['read_at']), 'segments' => isset($r['segments']) ? (int)$r['segments'] : null,
            'cost' => isset($r['cost']) ? (float)$r['cost'] : null], $rows), 'last30' => $totals];
    }

    private static function maskEmail(string $e): string
    {
        [$a, $d] = array_pad(explode('@', $e, 2), 2, '');

        return mb_substr($a, 0, 2) . '…@' . $d;
    }

    /** Send failed e-mails / SMS / WhatsApp of the last 7 days again (Setup › Notifications › Delivery). */
    public static function retryFailed(string $client): int
    {
        $since = date('Y-m-d H:i:s', strtotime(self::now()) - 7 * 86400);
        $n = self::db()->execute("UPDATE ssms_notify_outbox SET status = 'queued', attempts = 0, error = NULL, send_after = ? WHERE ssms_client_code = ? AND status = 'failed'
            AND channel = 'email' AND created >= ?", [self::now(), $client, $since])->rowCount();
        try {
            // SMS / WhatsApp: only what the provider never accepted (an accepted message is already paid for),
            // and not a WhatsApp message whose SMS went out instead
            $n += self::db()->execute("UPDATE ssms_notify_outbox o SET o.status = 'queued', o.attempts = 0, o.error = NULL, o.send_after = ?
                WHERE o.ssms_client_code = ? AND o.status = 'failed' AND o.channel IN ('sms','whatsapp') AND o.created >= ? AND o.sent_at IS NULL AND o.provider_id IS NULL
                AND NOT (o.channel = 'whatsapp' AND EXISTS (SELECT 1 FROM (SELECT ref, address FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel = 'sms' AND sent_at IS NOT NULL) x
                    WHERE x.ref = o.ref AND x.address = o.address))", [self::now(), $client, $since, $client])->rowCount();
        } catch (\Throwable $e) {
            // phase-2 columns not there yet
        }

        return $n;
    }

    // ── Privacy ────────────────────────────────────────────────────────────

    public static function eraseUsers(string $client, array $users): void
    {
        if (!$users) {
            return;
        }
        $in = implode(',', array_fill(0, count($users), '?'));
        // e-mails were queued by address (no account name): remove those to the people's own addresses too
        try {
            $emails = self::cleanEmails(array_column(self::q("SELECT ssms_user_email FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name IN ($in)",
                array_merge([$client], $users)), 'ssms_user_email'));
            self::eraseEmails($client, $emails);
        } catch (\Throwable $e) {
        }
        try {
            Messaging::erasePhones($client, array_column(Messaging::userPhones($client, $users), 'phone'));
        } catch (\Throwable $e) {
        }
        foreach (['ssms_notify_inbox', 'ssms_notify_prefs', 'ssms_push_tokens', 'ssms_notice_reads'] as $t) {
            try {
                self::db()->execute("DELETE FROM $t WHERE ssms_client_code = ? AND username IN ($in)", array_merge([$client], $users));
            } catch (\Throwable $e) {
            }
        }
        try {
            self::db()->execute("DELETE FROM ssms_notify_outbox WHERE ssms_client_code = ? AND username IN ($in)", array_merge([$client], $users));
        } catch (\Throwable $e) {
        }
    }

    /** Messages about these children (parents' inbox, outbox). Returns true when anything was removed. */
    public static function eraseEmails(string $client, array $emails): int
    {
        $emails = self::cleanEmails($emails);
        if (!$emails) {
            return 0;
        }
        try {
            return self::db()->execute("DELETE FROM ssms_notify_outbox WHERE ssms_client_code = ? AND channel = 'email' AND LOWER(address) IN ("
                . implode(',', array_fill(0, count($emails), '?')) . ')', array_merge([$client], $emails))->rowCount();
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /** $emails: the family's e-mail from the admission form (messages to it are removed too). */
    public static function eraseStudents(string $client, array $eids, array $emails = [], array $phones = []): bool
    {
        if (!$eids) {
            return false;
        }
        $country = Messaging::country($client);
        $gone = Messaging::erasePhones($client, array_filter(array_map(fn($p) => MessagingCountries::e164((string)$p, $country), $phones)));
        $in = implode(',', array_fill(0, count($eids), '?'));
        $n = self::eraseEmails($client, $emails) + $gone;
        foreach (['ssms_notify_inbox', 'ssms_notify_outbox'] as $t) {
            try {
                $n += self::db()->execute("DELETE FROM $t WHERE ssms_client_code = ? AND enrollment_id IN ($in)", array_merge([$client], $eids))->rowCount();
            } catch (\Throwable $e) {
            }
        }

        return $n > 0;
    }

    // ── small helpers ──────────────────────────────────────────────────────

    private static function state(string $client, string $k): ?string
    {
        try {
            $r = self::db()->execute('SELECT v FROM ssms_notify_state WHERE ssms_client_code = ? AND k = ?', [$client, $k])->fetch('assoc');

            return $r ? (string)$r['v'] : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private static function setState(string $client, string $k, string $v): void
    {
        self::db()->execute('INSERT INTO ssms_notify_state (ssms_client_code, k, v) VALUES (?,?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$client, $k, $v]);
    }

    /** A time stored by the server (its own time zone) → the school's local time, for showing. */
    private static function local(string $client, ?string $ts): ?string
    {
        if ($ts === null || $ts === '') {
            return $ts;
        }
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
