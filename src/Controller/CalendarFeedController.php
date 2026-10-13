<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Calendar;
use Cake\Event\EventInterface;
use Cake\Log\Log;

/**
 * The calendar file Google Calendar, Outlook and Apple Calendar subscribe to:
 *   GET /cal/{id}-{signature}.ics
 * No sign-in: the signature in the link is the key (made in the app, can be reset there).
 */
class CalendarFeedController extends AppController
{
    public function beforeFilter(EventInterface $event): void
    {
        // Public: no login, no module checks (parent.beforeFilter is skipped on purpose, as for the webhooks).
        $this->Authentication->allowUnauthenticated(['feed']);
        $this->autoRender = false;
    }

    public function feed(string $token = '')
    {
        $this->request->allowMethod(['get', 'head']);
        try {
            [$status, $body, $etag] = Calendar::feed($token);
        } catch (\Throwable $e) {
            Log::error('cal feed failed: ' . $e->getMessage());
            [$status, $body, $etag] = [500, 'Please try again later.', null];
        }
        $res = $this->response->withHeader('X-Robots-Tag', 'noindex, nofollow')->withHeader('Referrer-Policy', 'no-referrer');
        if ($status !== 200) {
            return $res->withStatus($status)->withType('text/plain')->withStringBody($body);
        }
        $res = $res->withHeader('ETag', $etag)->withHeader('Cache-Control', 'private, max-age=900');
        $match = trim($this->request->getHeaderLine('If-None-Match'));
        $tags = array_map(fn($t) => preg_replace('#^W/#', '', trim($t)), explode(',', $match));   // proxies may weaken the tag
        if ($match !== '' && (in_array($etag, $tags, true) || in_array('*', $tags, true))) {
            return $res->withStatus(304);
        }

        return $res->withType('text/calendar')->withCharset('UTF-8')
            ->withHeader('Content-Disposition', 'inline; filename="calendar.ics"')
            ->withStringBody($this->request->is('head') ? '' : $body);
    }
}
