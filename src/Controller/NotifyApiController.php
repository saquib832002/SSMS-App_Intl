<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Messaging;
use App\Service\MessagingCountries;
use App\Service\Notify;
use App\Service\Permissions;

/**
 * NotifyApi – automatic notifications (JWT, app only).
 *
 * Everyone signed in:
 *   GET  /NotifyApi/summary          unread count for the bell (also runs the school's worker, at most once a minute)
 *   GET  /NotifyApi/inbox            ?before=<id>&limit=30
 *   POST /NotifyApi/markRead         {ids: [..]} or {all: true}
 *   GET  /NotifyApi/prefs            what this person can switch off
 *   POST /NotifyApi/savePref         {event, channel, on}
 *   POST /NotifyApi/registerDevice   {token, platform}
 *   POST /NotifyApi/unregisterDevice {token}
 *   POST /NotifyApi/noticeRead       {notice_id} or {notice_ids: [..]} (seen on the notice board)
 * School (staff):
 *   GET  /NotifyApi/settings         what the school sends (Setup › Notifications); can_edit = School settings · edit
 *   POST /NotifyApi/saveSettings     {events: {absence: {enabled, push, email, essential, options: {..}}, ..}}
 *   GET  /NotifyApi/log              delivery log ?event=&status=  (action deliveryLog)
 *   POST /NotifyApi/retryFailed      send failed e-mails again
 *   GET  /NotifyApi/noticeStats      ?ids=1,2,3   → read X of Y   (Notices · view)
 *   GET  /NotifyApi/noticeReaders    ?notice_id=  → who has / hasn't read it   (Notices · view)
 *   POST /NotifyApi/noticeRemind     {notice_id} → "Remind the rest"   (Notices · edit)
 * SMS / WhatsApp (phase 2, paid add-on; changes need School settings · edit):
 *   GET  /NotifyApi/messaging        both channels: mode, provider, fields (no secrets), country rules, usage this month
 *   POST /NotifyApi/saveChannel      {channel, mode, provider, fields: {..}, sender, monthly_limit, cost_per_message, currency, quiet_start, quiet_end, consent_required, sms_after_whatsapp}
 *   POST /NotifyApi/testChannel      {channel}  check the keys (no message)
 *   POST /NotifyApi/testSend         {channel, to}  a real sample message
 *   GET  /NotifyApi/templates        texts per message, channel and language; DLT / WhatsApp template IDs
 *   POST /NotifyApi/saveTemplate     {kind, channel, lang, provider_ref, status, text}
 *   POST /NotifyApi/optOut           {channel, phone, on}  stop / allow messages to a number
 */
class NotifyApiController extends AppController
{
    use SecurityApiTrait {
        _out as private _traitOut;
    }

    private ?int $bufLevel = null;

    public function initialize(): void
    {
        parent::initialize();
        if (ob_start()) {
            $this->bufLevel = ob_get_level();
        }
    }

    protected function _out(array $data, int $status = 200)
    {
        if ($this->bufLevel !== null && ob_get_level() >= $this->bufLevel) {
            while (ob_get_level() > $this->bufLevel) {
                ob_end_flush();
            }
            $stray = (string)ob_get_clean();
            $this->bufLevel = null;
            if (trim($stray) !== '') {
                \Cake\Log\Log::warning('NotifyApi: unexpected output removed from reply: ' . mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($stray))), 0, 1000));
            }
        }

        return $this->_traitOut($data, $status);
    }

    private function bearer(): void
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization')) || $this->_client() === '' || $this->_user() === '') {
            throw new \DomainException('Please sign in again.');
        }
    }

    private function portal(): bool
    {
        return in_array($this->_role(), Permissions::PORTAL_ROLES, true);
    }

    private function staffOnly(): void
    {
        if ($this->portal()) {
            throw new \DomainException('Not allowed.');
        }
    }

    private function canEdit(): bool
    {
        $role = $this->_role();
        if ($role === 'owner') {
            return true;
        }
        if (!in_array($role, Permissions::BASE_ROLES, true)) {
            return false;
        }
        $grid = Permissions::forUser($this->_client(), $role, $this->request->getAttribute('jwt_custom_role'));

        return !empty($grid['settings']['edit']);
    }

    // ── everyone ───────────────────────────────────────────────────────────

    public function summary()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            Notify::tick($this->_client());

            return ['unread' => Notify::unread($this->_client(), $this->_user())];
        });
    }

    public function inbox()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            $items = Notify::inbox($this->_client(), $this->_user(), (int)$this->request->getQuery('before', 0), (int)$this->request->getQuery('limit', 30));

            return ['items' => $items, 'unread' => Notify::unread($this->_client(), $this->_user())];
        });
    }

    public function markRead()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            $all = filter_var($this->request->getData('all'), FILTER_VALIDATE_BOOLEAN);
            $ids = $all ? null : (array)($this->request->getData('ids') ?? []);
            $n = Notify::markRead($this->_client(), $this->_user(), $ids);

            return ['marked' => $n, 'unread' => Notify::unread($this->_client(), $this->_user())];
        });
    }

    public function prefs()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();

            return ['prefs' => Notify::prefs($this->_client(), $this->_user(), $this->_role())];
        });
    }

    public function savePref()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            $ev = (string)$this->request->getData('event');
            if ($ev !== 'notice' && !$this->portal()) {
                throw new \DomainException('Unknown notification.');
            }
            Notify::savePref($this->_client(), $this->_user(), $ev, (string)$this->request->getData('channel'),
                filter_var($this->request->getData('on'), FILTER_VALIDATE_BOOLEAN));

            return ['prefs' => Notify::prefs($this->_client(), $this->_user(), $this->_role())];
        });
    }

    public function registerDevice()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            Notify::registerDevice($this->_client(), $this->_user(), (string)$this->request->getData('token'), (string)($this->request->getData('platform') ?? ''));

            return ['ok' => true];
        });
    }

    public function unregisterDevice()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            Notify::forgetDeviceOf($this->_client(), $this->_user(), (string)$this->request->getData('token'));

            return ['ok' => true];
        });
    }

    public function noticeRead()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            $ids = (array)($this->request->getData('notice_ids') ?? []);
            $ids[] = $this->request->getData('notice_id');
            Notify::noticesSeen($this->_client(), $this->_user(), $this->_role(), $ids);

            return ['ok' => true, 'unread' => Notify::unread($this->_client(), $this->_user())];
        });
    }

    // ── the school ─────────────────────────────────────────────────────────

    public function settings()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            $this->staffOnly();

            return ['settings' => array_values(Notify::settings($this->_client())), 'can_edit' => $this->canEdit(), 'channels' => Notify::CHANNELS,
                    'paid' => ['allowed' => Messaging::allowed($this->_client()), 'sms' => Messaging::active($this->_client(), 'sms'), 'whatsapp' => Messaging::active($this->_client(), 'whatsapp')]];
        });
    }

    public function saveSettings()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            if (!$this->canEdit()) {
                throw new \DomainException("You don't have permission to change school settings.");
            }
            $r = Notify::saveSettings($this->_client(), (array)$this->request->getData(), $this->_user());
            if ($r['changed']) {
                $this->_audit('settings.notifications_changed', ['category' => 'settings', 'entity_type' => 'notifications', 'entity_id' => $this->_client(),
                    'summary' => 'Automatic notifications changed: ' . implode(', ', array_keys($r['changed'])), 'changes' => $r['changed']]);
            }

            return ['settings' => array_values($r['settings']), 'changed' => array_keys($r['changed']), 'can_edit' => true,
                    'paid' => ['allowed' => Messaging::allowed($this->_client()), 'sms' => Messaging::active($this->_client(), 'sms'), 'whatsapp' => Messaging::active($this->_client(), 'whatsapp')]];
        });
    }

    /** GET /NotifyApi/log (named deliveryLog: Controller::log() is Cake's own logger) */
    public function deliveryLog()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            $this->staffOnly();
            if (!$this->canEdit()) {
                throw new \DomainException("You don't have permission to see the delivery log.");
            }

            return Notify::log($this->_client(), ['event' => (string)$this->request->getQuery('event', ''), 'status' => (string)$this->request->getQuery('status', ''),
                    'channel' => (string)$this->request->getQuery('channel', '')]) + ['usage' => Messaging::usage($this->_client())];
        });
    }

    public function retryFailed()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            if (!$this->canEdit()) {
                throw new \DomainException("You don't have permission to change school settings.");
            }

            return ['queued' => Notify::retryFailed($this->_client()), 'sent' => Notify::deliver($this->_client(), 50)];
        });
    }

    public function noticeStats()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            $this->staffOnly();
            $ids = array_slice(array_filter(array_map('intval', explode(',', (string)$this->request->getQuery('ids', '')))), 0, 100);

            return ['stats' => (object)Notify::noticeStats($this->_client(), $ids)];
        });
    }

    public function noticeReaders()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            $this->staffOnly();

            return Notify::noticeReaders($this->_client(), (int)$this->request->getQuery('notice_id', 0));
        });
    }

    public function noticeRemind()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            $this->staffOnly();
            $n = Notify::noticeRemind($this->_client(), (int)$this->request->getData('notice_id'), $this->_user());

            return ['reminded' => $n];
        });
    }

    // ── SMS / WhatsApp (phase 2) ───────────────────────────────────────────

    private function editor(): void
    {
        $this->bearer();
        if (!$this->canEdit()) {
            throw new \DomainException("You don't have permission to change school settings.");
        }
    }

    public function messaging()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            $this->staffOnly();

            $m = Messaging::channels($this->_client());
            $edit = $this->canEdit();
            if (!$edit) {
                // the webhook key and provider settings are for people who may change them
                foreach ($m['channels'] as $ch => $v) {
                    $m['channels'][$ch]['hook_url'] = null;
                    $m['channels'][$ch]['verify_token'] = null;
                    $m['channels'][$ch]['fields'] = (object)[];
                }
            }

            return $m + ['usage' => Messaging::usage($this->_client()), 'can_edit' => $edit];
        });
    }

    public function saveChannel()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->editor();
            $ch = (string)$this->request->getData('channel');
            $d = (array)$this->request->getData();
            $r = Messaging::saveChannel($this->_client(), $ch, $d, $this->_user());
            // keys are never written to the audit log – only what changed
            $this->_audit('settings.messaging_changed', ['category' => 'settings', 'entity_type' => 'messaging', 'entity_id' => $ch,
                'summary' => strtoupper($ch) . ' messaging: ' . $r['channel']['mode'] . ($r['channel']['provider'] ? ' (' . $r['channel']['provider'] . ')' : '')
                    . (!empty($r['changed']) ? ', provider details changed' : '')]);

            return $r;
        });
    }

    public function testChannel()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->editor();
            $ch = (string)$this->request->getData('channel');
            $t = Messaging::testChannel($this->_client(), $ch);

            return ['test' => $t, 'channel' => Messaging::channels($this->_client())['channels'][$ch] ?? null];
        });
    }

    public function testSend()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->editor();
            $ch = (string)$this->request->getData('channel');
            $r = Messaging::testSend($this->_client(), $ch, (string)$this->request->getData('to'), $this->_user());
            $this->_audit('settings.messaging_test', ['category' => 'settings', 'entity_type' => 'messaging', 'entity_id' => $ch,
                'summary' => 'Test ' . strtoupper($ch) . ' to ' . $r['to'] . ': ' . $r['status']]);

            return $r;
        });
    }

    public function templates()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            $this->staffOnly();

            return Messaging::templates($this->_client()) + ['can_edit' => $this->canEdit()];
        });
    }

    public function saveTemplate()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->editor();
            $d = (array)$this->request->getData();
            $r = Messaging::saveTemplate($this->_client(), (string)($d['kind'] ?? ''), (string)($d['channel'] ?? ''), (string)($d['lang'] ?? ''), $d, $this->_user());
            $this->_audit('settings.messaging_template', ['category' => 'settings', 'entity_type' => 'messaging_template', 'entity_id' => $r['kind'] . '/' . $r['channel'] . '/' . $r['lang'],
                'summary' => 'Message text / template changed: ' . $r['kind'] . ' (' . $r['channel'] . ', ' . $r['lang'] . ')']);

            return $r;
        });
    }

    public function optOut()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->editor();
            $ch = (string)$this->request->getData('channel');
            if (!in_array($ch, Messaging::CHANNELS, true)) {
                throw new \DomainException('Unknown channel.');
            }
            $phone = MessagingCountries::e164((string)$this->request->getData('phone'), Messaging::country($this->_client()));
            if (!$phone) {
                throw new \DomainException('Please enter a valid mobile number, with the country code.');
            }
            $on = filter_var($this->request->getData('on'), FILTER_VALIDATE_BOOLEAN);
            $on ? Messaging::optIn($this->_client(), $ch, $phone) : Messaging::optOut($this->_client(), $ch, $phone, 'office');
            $this->_audit('settings.messaging_optout', ['category' => 'privacy', 'entity_type' => 'phone', 'entity_id' => MessagingCountries::mask($phone),
                'summary' => ($on ? 'Messages allowed again to ' : 'Messages stopped to ') . MessagingCountries::mask($phone) . ' (' . $ch . ')']);

            return ['phone' => MessagingCountries::mask($phone), 'channel' => $ch, 'on' => $on];
        });
    }
}
