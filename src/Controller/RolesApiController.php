<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\AccountSecurity;
use App\Service\Permissions;

/**
 * RolesApi – roles & permissions (JWT protected).
 * Viewing: owner, admin, principal. Changing: owner, or anyone given "Users & roles · approve".
 *
 *   GET  /RolesApi/list
 *   GET  /RolesApi/role?key=admin | custom:12
 *   POST /RolesApi/save   { key?|new, name?, base_role?, own_classes_only?, grid: {module: {kind: bool}}, code? }
 *   POST /RolesApi/remove { key, code? }      custom role: delete · built-in: back to defaults
 *   GET  /RolesApi/people
 *   POST /RolesApi/assign { username, key|null }
 *   GET  /RolesApi/mine                       my own permissions (for the app's menus)
 */
class RolesApiController extends AppController
{
    use SecurityApiTrait;

    private function canView(): bool
    {
        return in_array($this->_role(), ['owner', 'admin', 'principal'], true) || $this->_can('users', 'approve');
    }

    private function canManage(): bool
    {
        return $this->_isOwner() || $this->_can('users', 'approve');
    }

    public function list()
    {
        $this->request->allowMethod(['get']);
        if (!$this->canView()) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => ['roles' => Permissions::roles($this->_client()), 'can_manage' => $this->canManage(),
            'modules' => Permissions::MODULES, 'kinds' => Permissions::KINDS,
            'enforced' => AccountSecurity::settings($this->_client())['permissions_enforced']]);
    }

    public function role()
    {
        $this->request->allowMethod(['get']);
        if (!$this->canView()) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => Permissions::role($this->_client(), (string)$this->request->getQuery('key')) + ['can_manage' => $this->canManage()]);
    }

    public function save()
    {
        $this->request->allowMethod(['post']);
        if (!$this->canManage()) {
            return $this->_forbidden('Only the owner (or someone given "Users & roles · approve") can change roles.');
        }

        return $this->_try(function () {
            $d   = (array)$this->request->getData();
            $key = isset($d['key']) && $d['key'] !== 'new' ? (string)$d['key'] : null;
            // giving or removing access to money, users, settings or privacy needs the two-step code again
            $sensitive = false;
            foreach ((array)($d['grid'] ?? []) as $m => $_) {
                if (in_array($m, Permissions::CONFIRM_MODULES, true)) {
                    $sensitive = true;
                }
            }
            $before = $key ? Permissions::role($this->_client(), $key)['grid'] : null;
            if ($sensitive && $before !== null) {
                $sensitive = false;
                foreach ((array)$d['grid'] as $m => $kinds) {
                    if (!in_array($m, Permissions::CONFIRM_MODULES, true)) {
                        continue;
                    }
                    foreach ((array)$kinds as $k => $v) {
                        if (isset($before[$m][$k]) && (bool)$v !== $before[$m][$k]) {
                            $sensitive = true;
                        }
                    }
                }
            }
            if ($sensitive) {
                $this->_stepUp($d['code'] ?? null);
            }
            $mine = Permissions::forUser($this->_client(), $this->_role(), $this->request->getAttribute('jwt_custom_role'));
            [$role, $changes, $isNew] = Permissions::save($this->_client(), $key, $d, $this->_role(), $mine, $this->_user());
            $this->_audit($isNew ? 'role.created' : 'role.changed', ['category' => 'access', 'entity_type' => 'role', 'entity_id' => $role['key'],
                'summary' => ($isNew ? 'Role created: ' : 'Role changed: ') . $role['name'] . ($changes ? ' (' . count($changes) . ' changes)' : ''),
                'changes' => ['permissions' => $changes, 'own_classes_only' => $role['own_classes_only']]]);

            return ['role' => $role, 'changes' => $changes];
        });
    }

    public function remove()
    {
        $this->request->allowMethod(['post']);
        if (!$this->canManage()) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $key = (string)$this->request->getData('key');
            $this->_stepUp($this->request->getData('code'));
            $role = Permissions::role($this->_client(), $key);
            $affected = Permissions::remove($this->_client(), $key);
            foreach ($affected as $u) {
                AccountSecurity::revokeAll($this->_client(), (string)$u, null, 'role removed');
            }
            $this->_audit(str_starts_with($key, 'custom:') ? 'role.deleted' : 'role.reset', ['category' => 'access', 'entity_type' => 'role',
                'entity_id' => $key, 'summary' => (str_starts_with($key, 'custom:') ? 'Role deleted: ' : 'Role reset to defaults: ') . $role['name'],
                'changes' => $affected ? ['moved_back_to_built_in_role' => $affected] : null]);

            return ['roles' => Permissions::roles($this->_client())];
        });
    }

    public function people()
    {
        $this->request->allowMethod(['get']);
        if (!$this->canView()) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => Permissions::people($this->_client()));
    }

    public function assign()
    {
        $this->request->allowMethod(['post']);
        if (!$this->canManage()) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $d   = (array)$this->request->getData();
            $key = !empty($d['key']) ? (string)$d['key'] : null;
            $res = Permissions::assign($this->_client(), (string)($d['username'] ?? ''), $key);
            // new permissions apply on the next request; end their sign-ins so menus refresh too
            AccountSecurity::revokeAll($this->_client(), $res['username'], null, 'role changed');
            $this->_audit('role.assigned', ['category' => 'access', 'entity_type' => 'user', 'entity_id' => $res['username'],
                'summary' => $res['username'] . ($key ? ' moved to role ' . (Permissions::role($this->_client(), $key)['name']) : ' moved back to their built-in role')]);

            return $res;
        });
    }

    public function mine()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(fn() => ['permissions' => Permissions::forApp($this->_client(), $this->_role(), $this->request->getAttribute('jwt_custom_role'))]);
    }
}
