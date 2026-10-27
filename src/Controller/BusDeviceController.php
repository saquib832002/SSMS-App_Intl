<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\BusTracking;
use Cake\Event\EventInterface;
use Cake\Log\Log;

/**
 * Live bus tracking without a login.
 *
 * Bus phone (a phone kept in the bus, paired once with the office's QR code). Its key goes in the header
 * "X-Bus-Device"; only a hash of it is stored.
 *   POST /hooks/bus/pair      {school, code, device_name}  → {token, …}   (the key is shown once)
 *   GET  /hooks/bus/home                                    → the bus, its routes, the trip now, the trip windows
 *   POST /hooks/bus/ping      {points:[{lat,lng,speed,heading,accuracy,t}], now}
 *   POST /hooks/bus/trip      {action: start|end, direction, route_id}
 * GPS tracker platforms (Traccar position forwarding, or the OsmAnd-style query) – the school's secret is in the URL:
 *   GET|POST /hooks/bus/gps/{SCHOOL}/{key}
 * The URL to paste into the tracker platform is shown in Transport › Live buses › Buses.
 */
class BusDeviceController extends AppController
{
    public function beforeFilter(EventInterface $event): void
    {
        // Public: no login, no module checks (parent.beforeFilter is skipped on purpose, as for the other webhooks).
        $this->Authentication->allowUnauthenticated(['pair', 'home', 'ping', 'trip', 'gps']);
        $this->autoRender = false;
    }

    private function out(int $code, array $body)
    {
        return $this->response->withStatus($code)->withType('application/json')->withStringBody((string)json_encode($body));
    }

    private function run(callable $fn)
    {
        try {
            return $this->out(200, ['status' => true, 'data' => $fn()]);
        } catch (\DomainException $e) {
            $msg = $e->getMessage();
            $gone = str_contains($msg, 'not paired') || str_contains($msg, 'no longer paired');

            return $this->out($gone ? 401 : 200, ['status' => false, 'message' => $msg, 'unpaired' => $gone]);
        } catch (\Throwable $e) {
            Log::error('hooks/bus: ' . $e->getMessage());

            return $this->out(500, ['status' => false, 'message' => 'Something went wrong. Please try again.']);
        }
    }

    private function device(): array
    {
        return BusTracking::deviceVehicle((string)$this->request->getHeaderLine('X-Bus-Device'));
    }

    private function data(): array
    {
        $d = $this->request->getData();
        if (!$d) {
            $d = json_decode((string)$this->request->getBody(), true);
        }

        return is_array($d) ? $d : [];
    }

    public function pair()
    {
        $this->request->allowMethod(['post']);

        return $this->run(function () {
            $d = $this->data();

            return BusTracking::devicePair((string)($d['school'] ?? ''), (string)($d['code'] ?? ''), (string)($d['device_name'] ?? ''));
        });
    }

    public function home()
    {
        $this->request->allowMethod(['get']);

        return $this->run(function () {
            [$c, $v] = $this->device();

            return BusTracking::deviceHome($c, $v);
        });
    }

    public function ping()
    {
        $this->request->allowMethod(['post']);

        return $this->run(function () {
            [$c, $v] = $this->device();
            $d = $this->data();

            return BusTracking::vehiclePing($c, $v, is_array($d['points'] ?? null) ? $d['points'] : [], is_numeric($d['now'] ?? null) ? (float)$d['now'] : null, 'phone');
        });
    }

    public function trip()
    {
        $this->request->allowMethod(['post']);

        return $this->run(function () {
            [$c, $v] = $this->device();
            $d = $this->data();

            return BusTracking::deviceTrip($c, $v, (string)($d['action'] ?? ''), (string)($d['direction'] ?? ''), (int)($d['route_id'] ?? 0));
        });
    }

    public function gps(string $client = '', string $key = '')
    {
        $this->request->allowMethod(['get', 'post']);
        try {
            $raw = (string)$this->request->getBody();
            [$code, $msg] = BusTracking::gpsHook($client, $key, (array)$this->request->getQueryParams() + (array)$this->request->getParsedBody(), json_decode($raw, true));
        } catch (\Throwable $e) {
            Log::error('hooks/bus/gps: ' . $e->getMessage());
            [$code, $msg] = [500, 'error'];
        }

        return $this->response->withStatus($code)->withType('text/plain')->withStringBody($msg);
    }
}
