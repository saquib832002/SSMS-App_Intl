<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\OnlinePayments;
use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Mailer\Mailer;
use Cake\Routing\Router;

/**
 * OnlinePayApi – online fee payments (JSON API for the app, JWT protected).
 *
 * School owner / admin (settings):
 *   GET  /OnlinePayApi/getSettings       status + recent online payments
 *   POST /OnlinePayApi/connectStripe     → { url } Stripe onboarding (owner)
 *   POST /OnlinePayApi/refreshStripe     re-read Stripe account status
 *   POST /OnlinePayApi/saveRazorpay      { key_id, key_secret, webhook_secret? } (owner)
 *   POST /OnlinePayApi/setEnabled        { enabled, provider? } (owner)
 * Parents / students / staff:
 *   GET  /OnlinePayApi/availability      { available, provider, currency }
 *   POST /OnlinePayApi/createFeePayment  { enrollment_id, items?: [{fee_id, fee_item_id}] } → { payUrl }
 *   POST /OnlinePayApi/emailPayLink      { enrollment_id } staff: email the link to the parent
 *
 * Extends FeeApiController only to reuse fetchStudentFeeDue(), so the amount
 * to pay is always calculated on the server (never trusted from the app).
 */
class OnlinePayApiController extends FeeApiController
{
    private const STAFF = ['owner', 'admin', 'accountant'];

    // ── Settings (school) ──────────────────────────────────────────────────

    public function getSettings()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $code = $this->_client();

        return $this->_out(['status' => true, 'data' => [
            'settings' => OnlinePayments::publicSettings($code),
            'payments' => OnlinePayments::recent($code, 50),
            'razorpayWebhookUrl' => Router::url('/pay/razorpay-webhook/' . $code, true),
        ]]);
    }

    public function connectStripe()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(['owner'])) {
            return $this->_out(['status' => false, 'message' => 'Only the school owner can connect a payment account.'], 403);
        }
        $code = $this->_client();
        $sig  = OnlinePayments::sign($code);
        try {
            $url = OnlinePayments::stripeOnboardingUrl(
                $code,
                $this->_user(),
                Router::url('/pay/stripe-return?c=' . rawurlencode($code) . '&s=' . $sig, true),
                Router::url('/pay/stripe-return?c=' . rawurlencode($code) . '&s=' . $sig . '&again=1', true),
                (string)($this->request->getData('country') ?? '')
            );
        } catch (\DomainException $e) {
            if ($e->getCode() === OnlinePayments::ERR_COUNTRY_REQUIRED) {
                return $this->_out(['status' => false, 'code' => 'COUNTRY_REQUIRED', 'message' => $e->getMessage()], 422);
            }
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error('connectStripe ' . $code . ': ' . $e->getMessage());
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }

        return $this->_out(['status' => true, 'data' => ['url' => $url]]);
    }

    public function refreshStripe()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        try {
            return $this->_out(['status' => true, 'data' => OnlinePayments::refreshStripe($this->_client(), $this->_user())]);
        } catch (\Throwable $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }
    }

    public function saveRazorpay()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(['owner'])) {
            return $this->_out(['status' => false, 'message' => 'Only the school owner can change payment keys.'], 403);
        }
        $d = (array)$this->request->getData();
        try {
            $s = OnlinePayments::saveRazorpay(
                $this->_client(),
                (string)($d['key_id'] ?? ''),
                (string)($d['key_secret'] ?? ''),
                (string)($d['webhook_secret'] ?? ''),
                $this->_user()
            );
        } catch (\Throwable $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }

        return $this->_out(['status' => true, 'data' => $s, 'message' => 'Razorpay keys saved. Online payments are on.']);
    }

    public function setEnabled()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(['owner'])) {
            return $this->_out(['status' => false, 'message' => 'Only the school owner can change this.'], 403);
        }
        $d = (array)$this->request->getData();
        try {
            $s = OnlinePayments::setEnabled(
                $this->_client(),
                filter_var($d['enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                $this->_user(),
                isset($d['provider']) && $d['provider'] !== '' ? (string)$d['provider'] : null
            );
        } catch (\Throwable $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }

        return $this->_out(['status' => true, 'data' => $s]);
    }

    // ── Paying ─────────────────────────────────────────────────────────────

    public function availability()
    {
        $this->request->allowMethod(['get']);
        $s = OnlinePayments::publicSettings($this->_client());

        return $this->_out(['status' => true, 'data' => [
            'available' => $s['available'],
            'provider'  => $s['available'] ? $s['provider'] : null,
            'currency'  => $s['currency'],
        ]]);
    }

    public function createFeePayment()
    {
        $this->request->allowMethod(['post']);
        $d   = (array)$this->request->getData();
        $eid = trim((string)($d['enrollment_id'] ?? ''));
        try {
            $res = $this->_createLink($eid, (array)($d['items'] ?? []));
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error('createFeePayment: ' . $e->getMessage());
            return $this->_out(['status' => false, 'message' => 'Could not start the online payment. Please try again.'], 500);
        }

        return $this->_out(['status' => true, 'data' => $res]);
    }

    public function emailPayLink()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isRole(self::STAFF)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $d   = (array)$this->request->getData();
        $eid = trim((string)($d['enrollment_id'] ?? ''));
        try {
            $res = $this->_createLink($eid, (array)($d['items'] ?? []));
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }
        $student = $this->_student($eid);
        $email   = trim((string)($d['email'] ?? '') ?: (string)($student['email_address'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->_out(['status' => true, 'emailed' => false, 'data' => $res,
                'message' => 'No valid email on the student record – share the link another way.']);
        }
        $school   = OnlinePayments::school($this->_client());
        $schoolNm = (string)($school['ssms_client_header_text'] ?? 'School');
        $from     = !empty($school['ssms_client_email']) ? (string)$school['ssms_client_email'] : (string)env('EMAIL_FROM_ADDRESS', 'admin@sawera.info');
        $amount   = number_format((float)$res['amount'], 2) . ' ' . $res['currency'];
        $h        = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
        $html     = '<p>Dear Parent,</p>'
            . '<p>School fees of <strong>' . $h($amount) . '</strong> are due for <strong>' . $h($student['student_name'] ?? '') . '</strong>.</p>'
            . '<p><a href="' . $h($res['payUrl']) . '" style="display:inline-block;background:#1e40af;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Pay online</a></p>'
            . '<p style="color:#64748b;font-size:13px">Or open this link: ' . $h($res['payUrl']) . '<br>The link is valid for ' . OnlinePayments::LINK_DAYS . ' days.</p>'
            . '<p>Thank you,<br>' . $h($schoolNm) . '</p>';
        try {
            (new Mailer('default'))
                ->setFrom([$from => $schoolNm])
                ->setTo($email)
                ->setSubject("Fee payment link – {$schoolNm}")
                ->setEmailFormat('html')
                ->deliver($html);
        } catch (\Throwable $e) {
            Log::error('emailPayLink: ' . $e->getMessage());
            return $this->_out(['status' => true, 'emailed' => false, 'data' => $res,
                'message' => 'The link was created but the email could not be sent. Share the link another way.']);
        }

        return $this->_out(['status' => true, 'emailed' => true, 'data' => $res, 'message' => "Payment link emailed to {$email}."]);
    }

    /**
     * GET /OnlinePayApi/paymentStatus?id=123
     * Status of an online payment started from the app (staff collecting by
     * card, or a parent). Asks Stripe directly while still pending, so the
     * screen updates even before the webhook arrives.
     * → { status: pending|paid|failed|expired, receipt, amount, currency }
     */
    public function paymentStatus()
    {
        $this->request->allowMethod(['get']);
        $id  = (int)$this->request->getQuery('id');
        $row = ConnectionManager::get('default')->execute(
            'SELECT pay_token, enrollment_id FROM ssms_online_payments WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$id, $this->_client()]
        )->fetch('assoc');
        if (!$row) {
            return $this->_out(['status' => false, 'message' => 'Payment not found.'], 404);
        }
        $student = $this->_student((string)$row['enrollment_id']);
        if (!$student || !$this->_mayPayFor($student)) {
            return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
        }
        $p = OnlinePayments::byToken((string)$row['pay_token']) ?? [];
        if (($p['status'] ?? '') === 'pending' && ($p['provider'] ?? '') === 'stripe') {
            try {
                $p = OnlinePayments::checkStripe((string)$row['pay_token']) ?: $p;
            } catch (\Throwable $e) {
                Log::warning('paymentStatus checkStripe: ' . $e->getMessage());
            }
        }
        $state = (string)($p['status'] ?? 'pending');
        if ($state === 'pending' && (int)($p['is_expired'] ?? 0) === 1) {
            $state = 'expired';
        }

        return $this->_out(['status' => true, 'data' => [
            'status'   => $state,
            'receipt'  => $p['receipt_number'] ?? null,
            'amount'   => isset($p['amount']) ? (float)$p['amount'] : null,
            'currency' => $p['currency'] ?? null,
        ]]);
    }

    // ── internals ──────────────────────────────────────────────────────────

    private function _createLink(string $eid, array $wanted): array
    {
        if ($eid === '') {
            throw new \InvalidArgumentException('enrollment_id is required.');
        }
        $code    = $this->_client();
        $student = $this->_student($eid);
        if (!$student) {
            throw new \DomainException('Student not found.');
        }
        if (!$this->_mayPayFor($student)) {
            throw new \DomainException('You can only pay fees for your own children.');
        }
        $due = $this->_dueItems($code, $eid);
        if ($wanted !== []) {
            $keys = [];
            foreach ($wanted as $w) {
                $keys[(int)($w['fee_id'] ?? 0) . ':' . (int)($w['fee_item_id'] ?? 0)] = true;
            }
            $due = array_values(array_filter($due, fn($i) => isset($keys[(int)$i['fee_id'] . ':' . (int)$i['fee_item_id']])));
        }
        $r = OnlinePayments::createPayment($code, $eid, $due, $student, $this->_user(), $this->_role());
        $r['payUrl'] = Router::url('/pay/' . $r['token'], true);
        unset($r['token']);

        return $r;
    }

    /** Due items calculated by the existing fee screen logic (single source of truth). */
    private function _dueItems(string $clientCode, string $enrollmentId): array
    {
        $orig = $this->request;
        $this->request = $orig->withMethod('GET')
            ->withHeader('ssmsUserRole', 'owner')
            ->withHeader('ssmsUserName', 'online-pay')
            ->withHeader('ssmsClientCode', $clientCode)
            ->withQueryParams([]);
        try {
            $this->fetchStudentFeeDue((string)$enrollmentId);
            $vars = $this->viewBuilder()->getVars();
        } finally {
            $this->request = $orig;
        }

        return is_array($vars['due'] ?? null) ? $vars['due'] : [];
    }

    private function _student(string $eid): array
    {
        $row = ConnectionManager::get('default')->execute(
            "SELECT e.enrollment_id, e.registration_id, r.mobile_number, r.email_address,
                    TRIM(CONCAT(COALESCE(r.student_first_name,''), ' ', COALESCE(r.student_last_name,''))) AS student_name
               FROM ssms_student_enrollment e
               JOIN ssms_student_registration r ON r.registration_id = e.registration_id
              WHERE e.enrollment_id = ? AND e.ssms_client_code = ?
              LIMIT 1",
            [$eid, $this->_client()]
        )->fetch('assoc');

        return $row ?: [];
    }

    /** Staff: any student of the school. Student: own enrollment. Parent: children (same mobile). */
    private function _mayPayFor(array $student): bool
    {
        $role = $this->_role();
        if (in_array($role, self::STAFF, true)) {
            return true;
        }
        if ($role === 'student') {
            $own = (string)($this->request->getAttribute('jwt_enrollment_id') ?? '');
            $usr = $this->_user();
            return $own === (string)$student['enrollment_id'] || $usr === (string)$student['enrollment_id'];
        }
        if ($role === 'parent') {
            $user = $this->_user();
            $row  = ConnectionManager::get('default')->execute(
                'SELECT mobile_number FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
                [$user, $this->_client()]
            )->fetch('assoc');
            $parentMobile = (string)($row['mobile_number'] ?? '') ?: $user;
            $a = substr(preg_replace('/\D/', '', $parentMobile), -10);
            $b = substr(preg_replace('/\D/', '', (string)$student['mobile_number']), -10);
            if (strlen($a) >= 6 && $a === $b) {
                return true;
            }
            // guardians the school gave app sign-in (Student record › Guardians)
            return strlen($a) >= 6 && in_array((string)$student['enrollment_id'],
                \App\Service\StudentRecord::guardianEnrollments($this->_client(), $a), true);
        }

        return false;
    }

    private function _client(): string
    {
        return strtoupper(trim((string)$this->request->getAttribute('jwt_client_code')));
    }

    private function _role(): string
    {
        return strtolower(trim((string)$this->request->getAttribute('jwt_role')));
    }

    private function _user(): string
    {
        return (string)($this->request->getAttribute('jwt_user') ?: $this->request->getHeaderLine('ssmsUserName'));
    }

    private function _isRole(array $roles): bool
    {
        return in_array($this->_role(), $roles, true);
    }

    private function _out(array $data, int $status = 200)
    {
        $this->autoRender = false;

        return $this->response
            ->withStatus($status)
            ->withType('application/json')
            ->withStringBody((string)json_encode($data));
    }
}
