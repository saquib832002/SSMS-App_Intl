<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\BusTracking;

/**
 * BusTrackingApi – live bus tracking (JWT, app only).
 *
 * Driver (the login linked to the route's driver, or Roles › Transport edit):
 *   GET  driverHome            POST startTrip {route_id, direction}     GET driverTrip?id
 *   POST ping {trip_id, points:[{lat,lng,speed,heading,accuracy,t}]}    POST markStudent {trip_id, enrollment_id, status}
 *   POST endTrip {trip_id, force}
 * Office (Roles › Transport):
 *   GET  live                  GET  trip?id                             GET settings   POST saveSettings {...}
 *   GET  drivers               POST linkDriver {driver_id, username}
 *   GET  vehicles              POST setVehicleMode {vehicle_id, mode, tracker_id}   POST pairCode {vehicle_id}   POST unpair {vehicle_id}
 *   POST newGpsKey
 * Bus phones and GPS trackers (no login) use /hooks/bus/… (BusDeviceController).
 * Parents / students:
 *   GET  myBus?enrollment_id   POST setMyAlert {key, on}
 */
class BusTrackingApiController extends AppController
{
    use SecurityApiTrait;

    private function bearer(): void
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app for live bus tracking.');
        }
    }

    private function acc(): array
    {
        $this->bearer();
        if (in_array(strtolower($this->_role()), ['parent', 'student'], true)) {
            throw new \DomainException('Not allowed.');
        }

        return BusTracking::access($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(), 'custom_role' => $this->request->getAttribute('jwt_custom_role')]);
    }

    private function fam(): array
    {
        $this->bearer();

        return BusTracking::familyAccess($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(),
            'enrollment_id' => $this->request->getAttribute('jwt_enrollment_id')]);
    }

    private function q(string $k): string
    {
        return trim((string)$this->request->getQuery($k, ''));
    }

    private function d(string $k): string
    {
        $v = $this->request->getData($k, '');

        return is_scalar($v) ? trim((string)$v) : '';
    }

    private function audit(string $event, string $summary, $id): void
    {
        $this->_audit($event, ['category' => 'records', 'entity_type' => 'bus_trip', 'entity_id' => (string)$id, 'summary' => $summary]);
    }

    private function reading(callable $fn)
    {
        $this->request->allowMethod(['get']);

        return $this->_try($fn);
    }

    private function writing(callable $fn)
    {
        $this->request->allowMethod(['post']);

        return $this->_try($fn);
    }

    // ── Driver ──────────────────────────────────────────────────────────────

    public function driverHome()
    {
        return $this->reading(fn() => BusTracking::driverHome($this->acc()));
    }

    public function startTrip()
    {
        return $this->writing(function () {
            $r = BusTracking::startTrip($this->acc(), (int)$this->d('route_id'), $this->d('direction'));
            if (!$r['resumed']) {
                $this->audit('transport.trip_started', 'Bus trip started: ' . $r['trip']['route_name'] . ' (' . $r['trip']['direction'] . ')', $r['trip']['trip_id']);
            }

            return $r;
        });
    }

    public function driverTrip()
    {
        return $this->reading(fn() => BusTracking::driverTrip($this->acc(), (int)$this->q('id')));
    }

    public function ping()
    {
        return $this->writing(function () {
            $pts = $this->request->getData('points');

            $now = $this->request->getData('now');

            return BusTracking::ping($this->acc(), (int)$this->d('trip_id'), is_array($pts) ? $pts : [], is_numeric($now) ? (float)$now : null);
        });
    }

    public function markStudent()
    {
        return $this->writing(fn() => BusTracking::markStudent($this->acc(), (int)$this->d('trip_id'), $this->d('enrollment_id'), $this->d('status')));
    }

    public function endTrip()
    {
        return $this->writing(function () {
            $f = $this->d('force');
            $r = BusTracking::endTrip($this->acc(), (int)$this->d('trip_id'), in_array(strtolower($f), ['1', 'true', 'yes'], true));
            if ($r['ended']) {
                $this->audit('transport.trip_ended', 'Bus trip ended', (int)$this->d('trip_id'));
            }

            return $r;
        });
    }

    // ── Office ──────────────────────────────────────────────────────────────

    public function live()
    {
        return $this->reading(fn() => BusTracking::live($this->acc()));
    }

    public function trip()
    {
        return $this->reading(fn() => BusTracking::trip($this->acc(), (int)$this->q('id')));
    }

    public function settings()
    {
        return $this->reading(function () {
            $a = $this->acc();
            if (!$a['view']) {
                throw new \DomainException("You don't have permission to see the buses. Ask the school owner if you need it (Roles › Transport).");
            }

            return ['settings' => BusTracking::settings($a['client']), 'can' => ['edit' => (bool)$a['edit']]];
        });
    }

    public function saveSettings()
    {
        return $this->writing(function () {
            $s = BusTracking::saveSettings($this->acc(), (array)$this->request->getData());
            $this->audit('transport.tracking_settings', 'Live bus tracking rules changed', $this->_client());

            return ['settings' => $s];
        });
    }

    public function drivers()
    {
        return $this->reading(fn() => BusTracking::drivers($this->acc()));
    }

    public function linkDriver()
    {
        return $this->writing(function () {
            $r = BusTracking::linkDriver($this->acc(), (int)$this->d('driver_id'), $this->d('username'));
            $this->audit('transport.driver_login', 'Driver app login set: driver ' . $this->d('driver_id') . ' → ' . ($this->d('username') ?: '(none)'), (int)$this->d('driver_id'));

            return $r;
        });
    }

    // ── Buses: driver's phone / bus phone / GPS tracker ────────────────────

    public function vehicles()
    {
        return $this->reading(fn() => BusTracking::vehicles($this->acc()));
    }

    public function setVehicleMode()
    {
        return $this->writing(function () {
            $r = BusTracking::setVehicleMode($this->acc(), (int)$this->d('vehicle_id'), $this->d('mode'), $this->d('tracker_id'));
            $this->audit('transport.tracking_mode', 'Bus ' . $r['vehicle']['number'] . ' tracked by: ' . $r['vehicle']['mode'], (int)$this->d('vehicle_id'));

            return $r;
        });
    }

    public function pairCode()
    {
        return $this->writing(function () {
            $r = BusTracking::pairCode($this->acc(), (int)$this->d('vehicle_id'));
            $this->audit('transport.pair_code', 'Pairing code made for bus ' . $r['vehicle']['number'], (int)$this->d('vehicle_id'));

            return $r;
        });
    }

    public function unpair()
    {
        return $this->writing(function () {
            $r = BusTracking::unpair($this->acc(), (int)$this->d('vehicle_id'));
            $this->audit('transport.unpair', 'Bus phone unpaired from bus ' . $r['vehicle']['number'], (int)$this->d('vehicle_id'));

            return $r;
        });
    }

    public function newGpsKey()
    {
        return $this->writing(function () {
            $r = BusTracking::newGpsKey($this->acc());
            $this->audit('transport.gps_key', 'New GPS forwarding address', $this->_client());

            return $r;
        });
    }

    // ── Parents / students ──────────────────────────────────────────────────

    public function myBus()
    {
        return $this->reading(fn() => BusTracking::myBus($this->fam(), $this->q('enrollment_id')));
    }

    public function setMyAlert()
    {
        return $this->writing(fn() => BusTracking::setMyAlert($this->fam(), $this->d('key'), in_array(strtolower($this->d('on')), ['1', 'true', 'yes'], true)));
    }
}
