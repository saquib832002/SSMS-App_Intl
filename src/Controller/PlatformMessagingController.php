<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Audit;
use App\Service\Messaging;
use App\Service\MessagingProviders;
use Cake\Log\Log;

/**
 * SMS & WhatsApp – platform owner pages (superuser only, standalone like the free-trial pages).
 *
 *   GET/POST /admin/messaging               ManageMyAcademy's SMS and WhatsApp accounts (keys, sender, default allowance, price,
 *                                           webhook address) + every school: add-on, how it sends, allowance, use this month
 *   GET/POST /admin/messaging/school/{CODE} one school: add-on on/off, use ManageMyAcademy's account per channel, allowance, history
 *
 * Keys are stored encrypted and never shown again ("saved – leave empty to keep").
 */
class PlatformMessagingController extends AppController
{
    private function _isSuperuser(): bool
    {
        return $this->request->getSession()->read('ssms_user_role') === 'superuser';
    }

    private function _by(): string
    {
        return (string)($this->request->getSession()->read('ssms_user_name') ?: 'superuser');
    }

    public function index()
    {
        if (!$this->_isSuperuser()) {
            $this->Flash->error('You are not authorized to manage SMS and WhatsApp.');

            return $this->redirect(['controller' => 'Dashboards', 'action' => 'superuserDashboard']);
        }
        $this->viewBuilder()->disableAutoLayout();
        $notice = null;
        $error = null;
        if ($this->request->is('post')) {
            $op = (string)$this->request->getData('op');
            $ch = (string)$this->request->getData('channel');
            try {
                switch ($op) {
                    case 'save':
                        Messaging::savePlatform($ch, (array)$this->request->getData());
                        $t = Messaging::testPlatform($ch);
                        $notice = strtoupper($ch) . ' account saved. ' . ($t['ok'] ? 'The provider accepted the details' . ($t['info'] ? ' (' . $t['info'] . ')' : '') . '.'
                            : 'But the provider did not accept them: ' . $t['error']);
                        Log::info("Platform messaging: {$ch} account saved by " . $this->_by());
                        break;
                    case 'test':
                        $t = Messaging::testPlatform($ch);
                        $t['ok'] ? $notice = 'Connected' . ($t['info'] ? ': ' . $t['info'] : '.') : $error = 'Not working: ' . $t['error'];
                        break;
                    case 'remove':
                        Messaging::removePlatform($ch);
                        $notice = strtoupper($ch) . " account removed. Schools that used it stop sending {$ch} until they connect their own.";
                        Log::info("Platform messaging: {$ch} account removed by " . $this->_by());
                        break;
                    case 'addon':
                        $code = strtoupper(trim((string)$this->request->getData('code')));
                        $on = (string)$this->request->getData('on') === '1';
                        Messaging::setAddon($code, $on, $this->_by());
                        Audit::log($code, 'platform.messaging_addon', ['category' => 'settings', 'actor' => $this->_by(), 'role' => 'superuser',
                            'summary' => 'SMS & WhatsApp add-on ' . ($on ? 'switched on' : 'switched off') . ' by the platform']);
                        $notice = "SMS & WhatsApp add-on " . ($on ? 'switched on' : 'switched off') . " for {$code}.";
                        break;
                    default:
                        $error = 'Unknown action.';
                }
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }
        $search = trim((string)$this->request->getQuery('q', ''));
        $this->set([
            'platform' => Messaging::platformView(),
            'providers' => MessagingProviders::LIST,
            'schools' => Messaging::schoolsOverview($search),
            'search' => $search,
            'notice' => $notice,
            'error' => $error,
            'edit' => (string)$this->request->getQuery('edit', ''),
            'csrfToken' => (string)$this->request->getAttribute('csrfToken'),
        ]);
        $this->render('index');
    }

    public function school(string $code = '')
    {
        if (!$this->_isSuperuser()) {
            $this->Flash->error('You are not authorized to manage SMS and WhatsApp.');

            return $this->redirect(['controller' => 'Dashboards', 'action' => 'superuserDashboard']);
        }
        $this->viewBuilder()->disableAutoLayout();
        $code = strtoupper(trim($code));
        $notice = null;
        $error = null;
        if ($this->request->is('post')) {
            try {
                $op = (string)$this->request->getData('op');
                if ($op === 'addon') {
                    $on = (string)$this->request->getData('on') === '1';
                    Messaging::setAddon($code, $on, $this->_by());
                    Audit::log($code, 'platform.messaging_addon', ['category' => 'settings', 'actor' => $this->_by(), 'role' => 'superuser',
                        'summary' => 'SMS & WhatsApp add-on ' . ($on ? 'switched on' : 'switched off') . ' by the platform']);
                    $notice = 'Add-on ' . ($on ? 'switched on.' : 'switched off.');
                } elseif ($op === 'channel') {
                    $ch = (string)$this->request->getData('channel');
                    $on = (string)$this->request->getData('managed') === '1';
                    $a = trim((string)$this->request->getData('allowance'));
                    if ($a !== '' && !ctype_digit($a)) {
                        throw new \DomainException('The allowance must be a whole number of messages (or empty for the default).');
                    }
                    if ($on && !Messaging::allowed($code)) {
                        throw new \DomainException('Switch the SMS & WhatsApp add-on on first.');
                    }
                    Messaging::setSchoolManaged($code, $ch, $on, $a === '' ? null : (int)$a, $this->_by());
                    Audit::log($code, 'platform.messaging_managed', ['category' => 'settings', 'actor' => $this->_by(), 'role' => 'superuser', 'entity_type' => 'messaging', 'entity_id' => $ch,
                        'summary' => strtoupper($ch) . ': ' . ($on ? "uses ManageMyAcademy's account" : "ManageMyAcademy's account not used") . ', allowance ' . ($a === '' ? 'default' : $a) . ' a month']);
                    $notice = strtoupper($ch) . ' saved.';
                } else {
                    $error = 'Unknown action.';
                }
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }
        $all = Messaging::schoolsOverview($code);
        $school = null;
        foreach ($all as $s) {
            if ($s['code'] === $code) {
                $school = $s;
            }
        }
        if (!$school) {
            $this->Flash->error('School not found.');

            return $this->redirect(['action' => 'index']);
        }
        $this->set([
            'school' => $school,
            'platform' => Messaging::platformView(),
            'providers' => MessagingProviders::LIST,
            'history' => Messaging::schoolHistory($code),
            'notice' => $notice,
            'error' => $error,
            'csrfToken' => (string)$this->request->getAttribute('csrfToken'),
        ]);
        $this->render('school');
    }
}
