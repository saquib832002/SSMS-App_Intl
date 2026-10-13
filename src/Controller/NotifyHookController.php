<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Messaging;
use Cake\Event\EventInterface;
use Cake\Log\Log;

/**
 * SMS / WhatsApp providers' webhooks (no login – the 24-character key in the URL is the school's secret;
 * Meta and Twilio signatures are checked as well).
 *
 *   GET|POST /hooks/notify/{provider}/{SCHOOL}/{key}
 *       delivery reports (sent / delivered / read / failed), replies (STOP / START), and Meta's subscription check.
 * The URL to paste into the provider's dashboard is shown in Setup › Notifications › Messaging.
 */
class NotifyHookController extends AppController
{
    public function beforeFilter(EventInterface $event): void
    {
        // Public: no login, no module checks (parent.beforeFilter is skipped on purpose, as for the payment webhooks).
        $this->Authentication->allowUnauthenticated(['receive']);
        $this->autoRender = false;
    }

    public function receive(string $provider = '', string $client = '', string $key = '')
    {
        $this->request->allowMethod(['get', 'post']);
        $raw = (string)file_get_contents('php://input');
        if ($raw === '') {
            $raw = (string)$this->request->getBody();
        }
        $headers = [];
        foreach ($this->request->getHeaders() as $k => $v) {
            $headers[strtolower((string)$k)] = implode(',', (array)$v);
        }
        $form = (array)$this->request->getParsedBody();
        if (!$form && $raw !== '' && !str_starts_with(ltrim($raw), '{') && !str_starts_with(ltrim($raw), '[')) {
            parse_str($raw, $form);
        }
        $uri = $this->request->getUri();
        $req = [
            'method' => $this->request->getMethod(),
            'query' => (array)$this->request->getQueryParams(),
            'form' => $form,
            'json' => json_decode($raw, true),
            'raw' => $raw,
            'headers' => $headers,
            'url' => $uri->getScheme() . '://' . $uri->getAuthority() . $uri->getPath() . ($uri->getQuery() !== '' ? '?' . $uri->getQuery() : ''),
        ];
        try {
            [$status, $body, $type] = Messaging::hook(strtolower($provider), $client, strtolower($key), $req);
        } catch (\Throwable $e) {
            Log::error("hooks/notify/$provider failed: " . $e->getMessage());
            [$status, $body, $type] = [500, 'error', 'text/plain'];
        }
        if ($status === 200 && strtolower($provider) === 'twilio') {
            [$body, $type] = ['<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 'text/xml'];   // no automatic reply
        }

        return $this->response->withStatus($status)->withType($type)->withStringBody($body);
    }
}
