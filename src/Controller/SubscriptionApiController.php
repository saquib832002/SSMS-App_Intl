<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Billing;
use App\Service\StripeClient;
use Cake\Log\Log;

/**
 * SubscriptionApi – billing for subscription (international) schools.
 *
 *   GET  /SubscriptionApi/getPlans               plans + modules (any logged-in user)
 *   GET  /SubscriptionApi/getSubscription        status, plan, trial end, modules
 *   POST /SubscriptionApi/createCheckoutSession  { planCode }  → { url }   (owner/admin)
 *   POST /SubscriptionApi/createPortalSession                 → { url }   (owner/admin)
 *   POST /SubscriptionApi/stripeWebhook          Stripe only (signature-verified, no JWT)
 *
 * Auth: JwtAuthMiddleware (app token or web session). All actions are in the
 * free 'core' module so a locked school can always reach billing.
 */
class SubscriptionApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    public function getPlans()
    {
        $this->request->allowMethod(['get']);
        try {
            return $this->_json(['status' => true, 'data' => Billing::plans()]);
        } catch (\Throwable $e) {
            Log::error('getPlans: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Could not load plans.'], 500);
        }
    }

    public function getSubscription()
    {
        $this->request->allowMethod(['get']);
        $client = $this->_clientCode();
        if ($client === '') {
            return $this->_json(['status' => false, 'message' => 'Unauthorized'], 401);
        }
        try {
            return $this->_json(['status' => true, 'data' => Billing::status($client)]);
        } catch (\Throwable $e) {
            Log::error('getSubscription: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Could not load subscription.'], 500);
        }
    }

    public function createCheckoutSession()
    {
        $this->request->allowMethod(['post']);
        $client = $this->_clientCode();
        if ($client === '' || !Billing::isAdminRole($this->_role())) {
            return $this->_json(['status' => false, 'message' => 'Only the school owner or admin can manage the subscription.'], 403);
        }

        $body     = $this->_body();
        $planCode = strtoupper(trim((string)($body['planCode'] ?? $body['plan_code'] ?? '')));
        if ($planCode === '') {
            return $this->_json(['status' => false, 'message' => 'planCode is required.'], 400);
        }

        try {
            $url = Billing::createCheckout($client, $planCode, $this->_userEmail());
            return $this->_json(['status' => true, 'data' => ['url' => $url]]);
        } catch (\DomainException $e) {
            return $this->_json(['status' => false, 'message' => $e->getMessage()], 400);
        } catch (\Throwable $e) {
            Log::error('createCheckoutSession: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Could not start checkout. Please try again.'], 500);
        }
    }

    public function createPortalSession()
    {
        $this->request->allowMethod(['post']);
        $client = $this->_clientCode();
        if ($client === '' || !Billing::isAdminRole($this->_role())) {
            return $this->_json(['status' => false, 'message' => 'Only the school owner or admin can manage the subscription.'], 403);
        }

        try {
            return $this->_json(['status' => true, 'data' => ['url' => Billing::createPortal($client)]]);
        } catch (\DomainException $e) {
            return $this->_json(['status' => false, 'message' => $e->getMessage()], 400);
        } catch (\Throwable $e) {
            Log::error('createPortalSession: ' . $e->getMessage());
            return $this->_json(['status' => false, 'message' => 'Could not open billing. Please try again.'], 500);
        }
    }

    /**
     * Stripe webhook. Public route (see JwtAuthMiddleware::PUBLIC_ROUTES);
     * trust comes only from the Stripe-Signature check.
     * 2xx = done; 4xx = bad request (Stripe stops); 5xx = Stripe retries.
     */
    public function stripeWebhook()
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $payload = (string)file_get_contents('php://input');
        if ($payload === '') {
            $stream = $this->request->getBody();
            if ($stream->isSeekable()) {
                $stream->rewind();
            }
            $payload = $stream->getContents();
        }

        try {
            $event = StripeClient::verifyWebhook($payload, $this->request->getHeaderLine('Stripe-Signature'));
        } catch (\Throwable $e) {
            Log::warning('stripeWebhook rejected: ' . $e->getMessage());
            return $this->_json(['received' => false, 'error' => 'invalid signature'], 400);
        }

        try {
            $result = Billing::handleWebhook($event, $payload);
            return $this->_json(['received' => true, 'result' => $result]);
        } catch (\Throwable $e) {
            Log::error("stripeWebhook {$event['type']} {$event['id']} failed: " . $e->getMessage());
            return $this->_json(['received' => false], 500);
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function _clientCode(): string
    {
        return trim((string)$this->request->getAttribute('jwt_client_code'));
    }

    /** Role from the app token, or from the web session (web calls have no JWT role). */
    private function _role(): string
    {
        $role = (string)$this->request->getAttribute('jwt_role');
        if ($role === '') {
            $role = (string)$this->request->getSession()->read('ssms_user_role');
        }

        return $role;
    }

    private function _userEmail(): ?string
    {
        $email = (string)$this->request->getSession()->read('ssms_user_email');
        if ($email !== '') {
            return $email;
        }
        $user = (string)$this->request->getAttribute('jwt_user');
        if ($user === '') {
            return null;
        }
        $row = \Cake\Datasource\ConnectionManager::get('default')->execute(
            'SELECT ssms_user_email FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$user, $this->_clientCode()]
        )->fetch('assoc');

        return $row['ssms_user_email'] ?? null;
    }

    private function _body(): array
    {
        $data = $this->request->getData();
        if (is_array($data) && $data !== []) {
            return $data;
        }
        $json = json_decode((string)file_get_contents('php://input'), true);

        return is_array($json) ? $json : [];
    }

    private function _json(array $data, int $status = 200)
    {
        $this->response = $this->response
            ->withStatus($status)
            ->withType('application/json')
            ->withStringBody(json_encode($data));

        return $this->response;
    }
}
