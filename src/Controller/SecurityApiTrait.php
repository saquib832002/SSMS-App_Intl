<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\AccountSecurity;
use App\Service\Audit;
use App\Service\Permissions;
use App\Service\TwoFactor;
use Cake\Log\Log;

/**
 * Shared helpers for SecurityApi, AuditApi, RolesApi and PrivacyApi.
 * Identity always comes from the verified token (JwtAuthMiddleware), never from headers.
 */
trait SecurityApiTrait
{
    protected function _client(): string
    {
        return strtoupper(trim((string)$this->request->getAttribute('jwt_client_code')));
    }

    protected function _role(): string
    {
        $r = strtolower(trim((string)$this->request->getAttribute('jwt_role')));

        return $r === 'teacher' ? 'user' : $r;
    }

    protected function _user(): string
    {
        return (string)$this->request->getAttribute('jwt_user');
    }

    protected function _sid(): ?string
    {
        $s = (string)$this->request->getAttribute('jwt_sid');

        return $s !== '' ? $s : null;
    }

    protected function _ip(): string
    {
        return AccountSecurity::clientIp($this->request);
    }

    protected function _isOwner(): bool
    {
        return $this->_role() === 'owner';
    }

    /** Owner always; others per Roles & permissions. */
    protected function _can(string $module, string $kind): bool
    {
        if ($this->_isOwner()) {
            return true;
        }
        $grid = Permissions::forUser($this->_client(), $this->_role(), $this->request->getAttribute('jwt_custom_role'));

        return !empty($grid[$module][$kind]);
    }

    protected function _audit(string $event, array $o): void
    {
        Audit::fromRequest($this->request, $event, $o);
    }

    /** Sensitive changes: ask for the two-step code again (if the person has two-step login on). */
    protected function _stepUp(?string $code): void
    {
        TwoFactor::stepUp($this->_user(), $code, $this->_ip());
    }

    protected function _forbidden(string $msg = 'You don\'t have permission to do this.')
    {
        return $this->_out(['status' => false, 'message' => $msg], 403);
    }

    protected function _try(callable $fn)
    {
        try {
            return $this->_out(['status' => true, 'data' => $fn()]);
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error(static::class . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());

            return $this->_out(['status' => false, 'message' => 'Something went wrong. Please try again.'], 500);
        }
    }

    protected function _out(array $data, int $status = 200)
    {
        $this->autoRender = false;

        return $this->response->withStatus($status)->withType('application/json')
            ->withStringBody((string)json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR));
    }
}
