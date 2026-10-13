<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\StaffAttendance;
use Cake\Log\Log;

/**
 * StaffAttendanceApi – staff check-in / out, daily marking, monthly report (JWT protected).
 *
 * Any staff member (login linked to a staff record):
 *   GET  /StaffAttendanceApi/myToday              today's record + settings
 *   POST /StaffAttendanceApi/checkIn              { code?, lat?, lng?, accuracy? }
 *                                                 code = typed office code or scanned QR text; lat/lng when the school requires location
 *   POST /StaffAttendanceApi/checkOut
 *   GET  /StaffAttendanceApi/myMonth?month=YYYY-MM
 * Owner / admin / principal:
 *   GET  /StaffAttendanceApi/officeCode           rotating 6-digit code for the office screen
 *   GET  /StaffAttendanceApi/settings / POST saveSettings
 *   POST /StaffAttendanceApi/setLocation          { lat, lng }   school location = where the admin is standing
 * Reminders ("you haven't checked in yet") go out when the office screen, the staff day list or a staff
 * member's check-in screen is open, and from the scheduled task:  bin/cake staff_checkin_reminders
 *   GET  /StaffAttendanceApi/day?date=YYYY-MM-DD
 *   POST /StaffAttendanceApi/mark                 { date, marks: [{ staff_id, status, check_in?, check_out?, note? }] }
 * Owner / admin / principal / accountant:
 *   GET  /StaffAttendanceApi/month?month=YYYY-MM  monthly report (payable days)
 *   GET  /StaffAttendanceApi/payrollDays?month=YYYY-MM
 */
class StaffAttendanceApiController extends AppController
{
    private const REPORT_ROLES = ['owner', 'admin', 'principal', 'accountant'];

    // ── Staff self ────────────────────────────────────────────────────────

    public function myToday()
    {
        $this->request->allowMethod(['get']);
        $code = $this->_client();
        $sid  = StaffAttendance::staffIdForUser($code, $this->_user());
        $set  = StaffAttendance::settings($code);
        StaffAttendance::remindNotCheckedIn($code);

        return $this->_out(['status' => true, 'data' => [
            'linked'   => $sid !== null,
            'is_admin' => $this->_admin(),
            'today'    => $this->schoolToday(),
            'record'   => $sid ? StaffAttendance::row($code, $sid, $this->schoolToday()) : null,
            'settings' => $set,
        ]]);
    }

    public function checkIn()
    {
        $this->request->allowMethod(['post']);
        $sid = $this->_staffId();
        if (!$sid) {
            return $this->_notLinked();
        }
        $d = (array)$this->request->getData();

        return $this->_try(fn() => ['record' => StaffAttendance::checkIn(
            $this->_client(), $sid, isset($d['code']) ? (string)$d['code'] : null,
            ['lat' => $d['lat'] ?? null, 'lng' => $d['lng'] ?? null, 'accuracy' => $d['accuracy'] ?? null]
        )]);
    }

    public function checkOut()
    {
        $this->request->allowMethod(['post']);
        $sid = $this->_staffId();
        if (!$sid) {
            return $this->_notLinked();
        }

        return $this->_try(fn() => ['record' => StaffAttendance::checkOut($this->_client(), $sid)]);
    }

    public function myMonth()
    {
        $this->request->allowMethod(['get']);
        $sid = $this->_staffId();
        if (!$sid) {
            return $this->_notLinked();
        }

        return $this->_try(fn() => StaffAttendance::myMonth($this->_client(), $sid, $this->_month()));
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    public function officeCode()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_admin()) {
            return $this->_forbidden();
        }

        StaffAttendance::remindNotCheckedIn($this->_client());   // the office screen polls every minute

        return $this->_try(fn() => StaffAttendance::officeCode($this->_client()));
    }

    public function settings()
    {
        $this->request->allowMethod(['get']);

        return $this->_out(['status' => true, 'data' => StaffAttendance::settings($this->_client()) + ['can_edit' => $this->_admin()]]);
    }

    public function saveSettings()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_admin()) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => StaffAttendance::saveSettings($this->_client(), (array)$this->request->getData(), $this->_user()));
    }

    public function setLocation()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_admin()) {
            return $this->_forbidden();
        }
        $d = (array)$this->request->getData();

        return $this->_try(fn() => StaffAttendance::setLocation($this->_client(), $d['lat'] ?? null, $d['lng'] ?? null, $this->_user()));
    }

    public function day()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_admin()) {
            return $this->_forbidden();
        }
        $date = (string)($this->request->getQuery('date') ?: $this->schoolToday());
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $this->_out(['status' => false, 'message' => 'Choose a date.'], 422);
        }

        StaffAttendance::remindNotCheckedIn($this->_client());

        return $this->_try(fn() => StaffAttendance::day($this->_client(), $date));
    }

    public function mark()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_admin()) {
            return $this->_forbidden();
        }
        $d = (array)$this->request->getData();

        return $this->_try(fn() => ['saved' => StaffAttendance::mark(
            $this->_client(), (string)($d['date'] ?? ''), (array)($d['marks'] ?? []), $this->_user()
        )]);
    }

    public function month()
    {
        $this->request->allowMethod(['get']);
        if (!in_array($this->_role(), self::REPORT_ROLES, true)) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => StaffAttendance::month($this->_client(), $this->_month()));
    }

    public function payrollDays()
    {
        $this->request->allowMethod(['get']);
        if (!in_array($this->_role(), self::REPORT_ROLES, true)) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => StaffAttendance::payrollDays($this->_client(), $this->_month()));
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function _month(): string
    {
        return (string)($this->request->getQuery('month') ?: $this->schoolToday('Y-m'));
    }

    private function _staffId(): ?int
    {
        return StaffAttendance::staffIdForUser($this->_client(), $this->_user());
    }

    private function _admin(): bool
    {
        return in_array($this->_role(), StaffAttendance::ADMINS, true);
    }

    private function _notLinked()
    {
        return $this->_out(['status' => false,
            'message' => 'Your login is not linked to a staff record. Ask the office to link it under Staff.'], 422);
    }

    private function _forbidden()
    {
        return $this->_out(['status' => false, 'message' => 'Not allowed.'], 403);
    }

    private function _try(callable $fn)
    {
        try {
            return $this->_out(['status' => true, 'data' => $fn()]);
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error('StaffAttendanceApi: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());

            return $this->_out(['status' => false, 'message' => 'Something went wrong. Please try again.'], 500);
        }
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

    private function _out(array $data, int $status = 200)
    {
        $this->autoRender = false;

        return $this->response->withStatus($status)->withType('application/json')->withStringBody((string)json_encode($data));
    }
}
