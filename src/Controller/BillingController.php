<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Billing;
use App\Service\Entitlements;
use Cake\Log\Log;

/**
 * Web billing page for school admins (uses the normal web-panel login).
 *
 *   GET  /billing           plans, trial / subscription status
 *   POST /billing/checkout  plan_code → redirect to Stripe Checkout
 *   POST /billing/portal    → redirect to Stripe customer portal
 *
 * Template: templates/Billing/index.php (standalone page, no layout).
 */
class BillingController extends AppController
{
    public function index()
    {
        $this->request->allowMethod(['get']);
        $client = $this->_clientCode();
        if ($client === '') {
            return $this->redirect('/login');
        }

        $status = Billing::status($client);
        $plans  = Entitlements::isSubscription(['billing_model' => $status['billingModel']]) ? Billing::plans() : [];

        $checkout = (string)$this->request->getQuery('checkout');
        $notice   = null;
        $error    = (string)$this->request->getQuery('error');
        if ($checkout === 'success') {
            $notice = 'Thank you! Your payment was received. Your modules will unlock within a minute.';
        } elseif ($checkout === 'cancel') {
            $notice = 'Checkout was cancelled. No payment was taken.';
        }

        $this->viewBuilder()->disableAutoLayout();
        $this->set([
            'status'     => $status,
            'plans'      => $plans,
            'isAdmin'    => Billing::isAdminRole((string)$this->request->getSession()->read('ssms_user_role')),
            'schoolName' => (string)$this->request->getSession()->read('ssms_client_header_text'),
            'notice'     => $notice,
            'error'      => $error !== '' ? $error : null,
            'csrfToken'  => (string)$this->request->getAttribute('csrfToken'),
        ]);
    }

    public function checkout()
    {
        $this->request->allowMethod(['post']);
        $client = $this->_clientCode();
        if ($client === '') {
            return $this->redirect('/login');
        }
        if (!Billing::isAdminRole((string)$this->request->getSession()->read('ssms_user_role'))) {
            return $this->_back('Only the school owner or admin can manage the subscription.');
        }

        $planCode = strtoupper(trim((string)$this->request->getData('plan_code')));
        try {
            $url = Billing::createCheckout(
                $client,
                $planCode,
                (string)$this->request->getSession()->read('ssms_user_email')
            );
            return $this->redirect($url);
        } catch (\DomainException $e) {
            return $this->_back($e->getMessage());
        } catch (\Throwable $e) {
            Log::error('Billing checkout: ' . $e->getMessage());
            return $this->_back('Could not start checkout. Please try again.');
        }
    }

    public function portal()
    {
        $this->request->allowMethod(['post']);
        $client = $this->_clientCode();
        if ($client === '') {
            return $this->redirect('/login');
        }
        if (!Billing::isAdminRole((string)$this->request->getSession()->read('ssms_user_role'))) {
            return $this->_back('Only the school owner or admin can manage the subscription.');
        }

        try {
            return $this->redirect(Billing::createPortal($client));
        } catch (\DomainException $e) {
            return $this->_back($e->getMessage());
        } catch (\Throwable $e) {
            Log::error('Billing portal: ' . $e->getMessage());
            return $this->_back('Could not open billing. Please try again.');
        }
    }

    private function _clientCode(): string
    {
        return trim((string)$this->request->getSession()->read('ssms_client_code'));
    }

    private function _back(string $error)
    {
        return $this->redirect('/billing?error=' . rawurlencode($error));
    }
}
