<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\AccountSecurity;
use App\Service\Audit;
use App\Service\TwoFactor;
use Cake\Datasource\ConnectionManager;

/**
 * SecurityApi – my account security + school security settings (JWT protected).
 *
 * Everyone signed in:
 *   GET  /SecurityApi/status                      two-step status, trusted devices, sign-ins
 *   POST /SecurityApi/mfaStart                    → { secret, uri }
 *   POST /SecurityApi/mfaConfirm   { code }       → { backup_codes }
 *   POST /SecurityApi/mfaDisable   { code }
 *   POST /SecurityApi/backupCodes  { code }       → new backup codes
 *   POST /SecurityApi/forgetDevices { id? }
 *   POST /SecurityApi/revokeSession { ref }
 *   POST /SecurityApi/signOutEverywhere { keep_current }
 *   POST /SecurityApi/logout
 * Owner (settings) / owner & admin (people):
 *   GET  /SecurityApi/settings      POST /SecurityApi/saveSettings { …, code }
 *   GET  /SecurityApi/people        POST /SecurityApi/resetMfa { username, code }
 *   POST /SecurityApi/sendSetPasswordLink { username }
 * Public:
 *   POST /SecurityApi/setPassword { token, password }
 */
class SecurityApiController extends AppController
{
    use SecurityApiTrait;

    public function status()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(fn() => TwoFactor::status($this->_client(), $this->_user(), $this->_role()) + [
            'sessions' => AccountSecurity::sessions($this->_client(), $this->_user(), $this->_sid()),
        ]);
    }

    public function mfaStart()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(fn() => TwoFactor::setupStart($this->_client(), $this->_user()));
    }

    public function mfaConfirm()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $codes = TwoFactor::setupConfirm($this->_user(), (string)$this->request->getData('code'));
            $this->_audit('mfa.enabled', ['category' => 'security', 'summary' => 'Two-step login turned on']);

            return ['backup_codes' => $codes];
        });
    }

    public function mfaDisable()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            TwoFactor::disable($this->_client(), $this->_user(), $this->_role(), (string)$this->request->getData('code'), $this->_ip());
            $this->_audit('mfa.disabled', ['category' => 'security', 'summary' => 'Two-step login turned off']);

            return ['enabled' => false];
        });
    }

    public function backupCodes()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->_stepUp((string)$this->request->getData('code'));
            $codes = TwoFactor::regenerateBackupCodes($this->_user());
            $this->_audit('mfa.backup_regenerated', ['category' => 'security', 'summary' => 'New backup codes made (old ones stop working)']);

            return ['backup_codes' => $codes];
        });
    }

    public function forgetDevices()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $id = (int)$this->request->getData('id') ?: null;
            TwoFactor::forgetDevices($this->_user(), $id);
            $this->_audit('mfa.devices_forgotten', ['category' => 'security', 'summary' => $id ? 'Stopped trusting a device' : 'Stopped trusting all devices']);

            return ['trusted_devices' => TwoFactor::trustedDevices($this->_user())];
        });
    }

    public function revokeSession()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            if (!AccountSecurity::revokeSession($this->_client(), $this->_user(), (string)$this->request->getData('ref'), 'signed out by user')) {
                throw new \InvalidArgumentException('That sign-in was not found.');
            }
            $this->_audit('session.revoked', ['category' => 'security', 'summary' => 'Signed out one device']);

            return ['sessions' => AccountSecurity::sessions($this->_client(), $this->_user(), $this->_sid())];
        });
    }

    public function signOutEverywhere()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $keep = (bool)$this->request->getData('keep_current') && $this->_sid();
            $n = AccountSecurity::revokeAll($this->_client(), $this->_user(), $keep ? $this->_sid() : null, 'sign out everywhere');
            TwoFactor::forgetDevices($this->_user());
            $this->_audit('session.revoked_all', ['category' => 'security',
                'summary' => 'Signed out everywhere' . ($keep ? ' (except this device)' : '') . " · {$n} sign-ins ended"]);

            return ['ended' => $n, 'signed_out' => !$keep];
        });
    }

    public function logout()
    {
        $this->request->allowMethod(['post']);
        if ($this->_sid()) {
            AccountSecurity::revokeSid((string)$this->_sid(), 'signed out');
        }
        $this->_audit('logout', ['category' => 'security', 'summary' => 'Signed out']);

        return $this->_out(['status' => true]);
    }

    // ── School settings (owner) ─────────────────────────────────────────────

    public function settings()
    {
        $this->request->allowMethod(['get']);
        if (!in_array($this->_role(), ['owner', 'admin'], true)) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => AccountSecurity::settings($this->_client()) + ['can_edit' => $this->_isOwner()]);
    }

    public function saveSettings()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isOwner()) {
            return $this->_forbidden('Only the school owner can change security settings.');
        }

        return $this->_try(function () {
            $d = (array)$this->request->getData();
            $this->_stepUp($d['code'] ?? null);
            $before = AccountSecurity::settings($this->_client());
            $after  = AccountSecurity::saveSettings($this->_client(), $d, $this->_user());
            $diff = [];
            foreach ($after as $k => $v) {
                if ($v !== ($before[$k] ?? null)) {
                    $diff[$k] = ['from' => $before[$k] ?? null, 'to' => $v];
                }
            }
            $this->_audit('security.settings', ['category' => 'settings', 'summary' => 'Security settings changed', 'changes' => $diff]);

            return $after + ['can_edit' => true];
        });
    }

    /** Staff accounts with their two-step status (owner/admin – for resets and reminders). */
    public function people()
    {
        $this->request->allowMethod(['get']);
        if (!in_array($this->_role(), ['owner', 'admin'], true)) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $rows = ConnectionManager::get('default')->execute(
                "SELECT u.ssms_user_name, u.ssms_user_firstname, u.ssms_user_lastname, u.ssms_user_role, u.last_login_date,
                        m.enabled AS mfa_enabled
                   FROM sawera_ssms_users u LEFT JOIN ssms_user_mfa m ON m.username = u.ssms_user_name
                  WHERE u.ssms_client_code = ? AND LOWER(u.ssms_user_role) NOT IN ('parent','student')
                  ORDER BY u.ssms_user_firstname", [$this->_client()]
            )->fetchAll('assoc');
            $out = [];
            foreach ($rows as $r) {
                $req = TwoFactor::requirement($this->_client(), (string)$r['ssms_user_role']);
                $out[] = [
                    'username' => $r['ssms_user_name'], 'name' => trim($r['ssms_user_firstname'] . ' ' . $r['ssms_user_lastname']) ?: $r['ssms_user_name'],
                    'role' => $r['ssms_user_role'], 'last_login' => $r['last_login_date'], 'mfa_enabled' => (int)$r['mfa_enabled'] === 1,
                    'mfa_required' => $req['required'], 'deadline' => $req['deadline'],
                ];
            }

            return $out;
        });
    }

    /** Owner resets someone's two-step login (lost phone). They set it up again at next sign-in. */
    public function resetMfa()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isOwner()) {
            return $this->_forbidden('Only the school owner can reset two-step login.');
        }

        return $this->_try(function () {
            $target = trim((string)$this->request->getData('username'));
            $this->_stepUp($this->request->getData('code'));
            $u = ConnectionManager::get('default')->execute(
                'SELECT ssms_user_name, ssms_user_email, ssms_user_role FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
                [$target, $this->_client()])->fetch('assoc');
            if (!$u) {
                throw new \InvalidArgumentException('User not found.');
            }
            if ($target === $this->_user()) {
                throw new \DomainException('You can\'t reset your own two-step login here. Use a backup code, or contact platform support.');
            }
            TwoFactor::wipe($target);
            AccountSecurity::revokeAll($this->_client(), $target, null, 'two-step login reset');
            $this->_audit('mfa.reset', ['category' => 'security', 'entity_type' => 'user', 'entity_id' => $target,
                'summary' => "Two-step login reset for {$target} · signed out everywhere"]);
            AccountSecurity::mail((string)$u['ssms_user_email'], $target, 'Your two-step login was reset',
                "The school owner reset two-step login for your account ({$target}). You'll be asked to set it up again the next time you sign in.\n\nIf you didn't ask for this, tell your school straight away.\n");

            return ['reset' => $target];
        });
    }

    /** E-mail someone a one-time link to choose a new password (admins). */
    public function sendSetPasswordLink()
    {
        $this->request->allowMethod(['post']);
        if (!in_array($this->_role(), ['owner', 'admin'], true)) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $target = trim((string)$this->request->getData('username'));
            $u = ConnectionManager::get('default')->execute(
                'SELECT ssms_user_name, ssms_user_email, ssms_user_firstname FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
                [$target, $this->_client()])->fetch('assoc');
            if (!$u) {
                throw new \InvalidArgumentException('User not found.');
            }
            $url = AccountSecurity::setPasswordUrl(AccountSecurity::passwordToken($this->_client(), $target));
            $sent = AccountSecurity::mail((string)$u['ssms_user_email'], (string)$u['ssms_user_firstname'], 'Set your ManageMyAcademy password',
                "Hello {$u['ssms_user_firstname']},\n\nUse this link to choose a password for your account ({$target}). It works once, for 48 hours:\n{$url}\n");
            $this->_audit('password.link_sent', ['category' => 'access', 'entity_type' => 'user', 'entity_id' => $target,
                'summary' => "Set-password link created for {$target}"]);

            return ['emailed' => $sent, 'email' => AccountSecurity::maskEmail((string)$u['ssms_user_email']), 'link' => $url];
        });
    }

    /** Public: choose a password from a set-password link (app or web). */
    public function setPassword()
    {
        $this->request->allowMethod(['post']);
        try {
            [$client, $user] = AccountSecurity::usePasswordToken((string)$this->request->getData('token'), (string)$this->request->getData('password'));
            Audit::log($client, 'password.set', ['category' => 'security', 'actor' => $user, 'ip' => $this->_ip(), 'summary' => 'Password set from a link']);

            return $this->_out(['status' => true, 'message' => 'Password saved. You can sign in now.']);
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }
    }
}
