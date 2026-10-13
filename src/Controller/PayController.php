<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\OnlinePayments;
use Cake\Event\EventInterface;
use Cake\Log\Log;
use Cake\Routing\Router;

/**
 * Public payment pages + webhooks (no login – the 40-char token is the secret).
 *
 *   GET  /pay/{token}                   payment page (summary + Pay button / result)
 *   GET  /pay/{token}/go                Stripe: create Checkout Session → redirect
 *   POST /pay/{token}/razorpay          Razorpay Checkout success callback
 *   GET  /pay/stripe-return?c=&s=       school finished / refreshes Stripe onboarding
 *   POST /pay/stripe-webhook            Stripe Connect webhook (connected accounts)
 *   POST /pay/razorpay-webhook/{CODE}   Razorpay webhook (optional, per school)
 */
class PayController extends AppController
{
    public function beforeFilter(EventInterface $event): void
    {
        // Public pages: no login, no module checks (parent.beforeFilter is skipped on purpose).
        $this->Authentication->allowUnauthenticated([
            'show', 'go', 'razorpay', 'stripeReturn', 'stripeWebhook', 'razorpayWebhook',
        ]);
        $this->viewBuilder()->disableAutoLayout();
    }

    public function show(string $token = '')
    {
        $p = OnlinePayments::byToken($token);
        if (!$p) {
            return $this->_message('Payment link not found', 'Please check the link or create a new one from the app.', 404);
        }
        $error = null;
        if ($p['status'] === 'pending' && $p['provider'] === 'stripe' && $this->request->getQuery('return')) {
            try {
                $p = OnlinePayments::checkStripe($token) ?: $p;
            } catch (\Throwable $e) {
                Log::error('pay/show checkStripe: ' . $e->getMessage());
            }
        }
        $rzp = null;
        if ($p['status'] === 'pending' && (int)$p['is_expired'] !== 1 && $p['provider'] === 'razorpay') {
            try {
                $rzp = OnlinePayments::razorpayOrder($token);
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }
        $this->set([
            'p'         => $p,
            'school'    => OnlinePayments::school((string)$p['ssms_client_code']),
            'items'     => json_decode((string)$p['items_json'], true) ?: [],
            'rzp'       => $rzp,
            'error'     => $error ?? ($this->request->getQuery('cancelled') ? 'Payment was cancelled. You can try again.' : null),
            'goUrl'     => Router::url('/pay/' . $token . '/go', true),
            'rzpPost'   => Router::url('/pay/' . $token . '/razorpay', true),
            'selfUrl'   => Router::url('/pay/' . $token, true),
        ]);

        return $this->render('show');
    }

    public function go(string $token = '')
    {
        try {
            $url = OnlinePayments::stripeCheckoutUrl(
                $token,
                Router::url('/pay/' . $token . '?return=1', true),
                Router::url('/pay/' . $token . '?cancelled=1', true)
            );
        } catch (\Throwable $e) {
            return $this->_message('Payment could not start', $e->getMessage(), 422);
        }

        return $this->redirect($url);
    }

    public function razorpay(string $token = '')
    {
        $this->request->allowMethod(['post']);
        $d = (array)$this->request->getData();
        try {
            OnlinePayments::verifyRazorpay(
                $token,
                (string)($d['razorpay_order_id'] ?? ''),
                (string)($d['razorpay_payment_id'] ?? ''),
                (string)($d['razorpay_signature'] ?? '')
            );
        } catch (\Throwable $e) {
            Log::error('pay/razorpay verify: ' . $e->getMessage());
            return $this->_message('Payment not confirmed', $e->getMessage() . ' If money was taken, it will be confirmed automatically or refunded by Razorpay.', 422);
        }

        return $this->redirect('/pay/' . $token);
    }

    public function stripeReturn()
    {
        $code  = strtoupper((string)$this->request->getQuery('c'));
        $sig   = (string)$this->request->getQuery('s');
        if ($code === '' || !hash_equals(OnlinePayments::sign($code), $sig)) {
            return $this->_message('Invalid link', 'Please start again from the app.', 403);
        }
        try {
            if ($this->request->getQuery('again')) {
                // Onboarding link expired → make a fresh one and continue.
                $url = OnlinePayments::stripeOnboardingUrl(
                    $code, 'stripe-refresh',
                    Router::url('/pay/stripe-return?c=' . rawurlencode($code) . '&s=' . $sig, true),
                    Router::url('/pay/stripe-return?c=' . rawurlencode($code) . '&s=' . $sig . '&again=1', true)
                );
                return $this->redirect($url);
            }
            $s = OnlinePayments::refreshStripe($code, 'stripe-return');
        } catch (\Throwable $e) {
            return $this->_message('Could not check Stripe', $e->getMessage(), 500);
        }
        if ($s['stripeChargesEnabled']) {
            return $this->_message('Stripe connected ✓', 'Online fee payments are now on for your school. You can close this page and return to the app.');
        }

        return $this->_message('Almost there', 'Stripe still needs some details or is reviewing your account. Return to the app and tap "Continue Stripe setup" or "Refresh status" later.');
    }

    public function stripeWebhook()
    {
        $this->request->allowMethod(['post']);
        $payload = (string)file_get_contents('php://input');
        if ($payload === '') {
            $payload = (string)$this->request->getBody();
        }
        try {
            $res = OnlinePayments::handleStripeWebhook($payload, $this->request->getHeaderLine('Stripe-Signature'));
        } catch (\RuntimeException $e) {
            Log::warning('pay/stripe-webhook rejected: ' . $e->getMessage());
            return $this->_json(['received' => false], 400);
        } catch (\Throwable $e) {
            Log::error('pay/stripe-webhook failed: ' . $e->getMessage());
            return $this->_json(['received' => false], 500);
        }

        return $this->_json(['received' => true, 'result' => $res]);
    }

    public function razorpayWebhook(string $code = '')
    {
        $this->request->allowMethod(['post']);
        $payload = (string)file_get_contents('php://input');
        if ($payload === '') {
            $payload = (string)$this->request->getBody();
        }
        try {
            $res = OnlinePayments::handleRazorpayWebhook($code, $payload, $this->request->getHeaderLine('X-Razorpay-Signature'));
        } catch (\DomainException | \RuntimeException $e) {
            Log::warning('pay/razorpay-webhook rejected: ' . $e->getMessage());
            return $this->_json(['received' => false], 400);
        } catch (\Throwable $e) {
            Log::error('pay/razorpay-webhook failed: ' . $e->getMessage());
            return $this->_json(['received' => false], 500);
        }

        return $this->_json(['received' => true, 'result' => $res]);
    }

    private function _message(string $title, string $text, int $status = 200)
    {
        $this->response = $this->response->withStatus($status);
        $this->set(['title' => $title, 'text' => $text]);

        return $this->render('message');
    }

    private function _json(array $data, int $status = 200)
    {
        $this->autoRender = false;

        return $this->response->withStatus($status)->withType('application/json')->withStringBody((string)json_encode($data));
    }
}
