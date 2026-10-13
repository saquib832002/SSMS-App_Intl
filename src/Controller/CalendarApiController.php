<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Calendar;

/**
 * CalendarApi – calendar sync links (JWT, app only).
 *
 * Everyone (own link):
 *   GET  myFeed                       what can be in the calendar, the link (if made) and its "add to" links
 *   POST saveFeed {include: [...]}    make the link / change what is in it
 *   POST resetFeed                    new link (the old one stops working)
 *   POST removeFeed                   switch it off
 *   GET  preview?include=a,b          the next events that will be in the calendar
 *   GET  upcoming?limit&days          the dashboard's "Upcoming" card (no link needed)
 * Office (Roles › Notices & events › Edit):
 *   GET  schoolFeed   POST setSchoolFeed {op: on|reset|off}   public link with the school's events and holidays
 *
 * The calendar apps fetch GET /cal/{id}-{signature}.ics (CalendarFeedController, no sign-in).
 */
class CalendarApiController extends AppController
{
    use SecurityApiTrait;

    private function acc(): array
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app for calendar sync.');
        }

        return Calendar::access($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(),
            'custom_role' => $this->request->getAttribute('jwt_custom_role'),
            'enrollment' => (string)$this->request->getAttribute('jwt_enrollment_id')]);
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

    public function myFeed()
    {
        return $this->reading(fn() => Calendar::myFeed($this->acc()));
    }

    public function saveFeed()
    {
        return $this->writing(function () {
            $inc = $this->request->getData('include');
            $r = Calendar::saveFeed($this->acc(), is_array($inc) ? $inc : null);
            $this->_audit('calendar.link_saved', ['category' => 'settings', 'entity_type' => 'calendar_feed', 'entity_id' => $this->_user(),
                'summary' => 'Calendar link: ' . implode(', ', $r['feed']['include'] ?? [])]);

            return $r;
        });
    }

    public function resetFeed()
    {
        return $this->writing(function () {
            $r = Calendar::resetFeed($this->acc());
            $this->_audit('calendar.link_reset', ['category' => 'security', 'entity_type' => 'calendar_feed', 'entity_id' => $this->_user(), 'summary' => 'Calendar link reset (old link stopped)']);

            return $r;
        });
    }

    public function removeFeed()
    {
        return $this->writing(function () {
            $r = Calendar::removeFeed($this->acc());
            $this->_audit('calendar.link_removed', ['category' => 'settings', 'entity_type' => 'calendar_feed', 'entity_id' => $this->_user(), 'summary' => 'Calendar link switched off']);

            return $r;
        });
    }

    public function preview()
    {
        return $this->reading(function () {
            $q = trim((string)$this->request->getQuery('include', ''));

            return Calendar::preview($this->acc(), $q === '' ? null : explode(',', $q));
        });
    }

    /** Dashboard "Upcoming" card: events, holidays, exams, meetings (+ staff: duties, cover, leave). */
    public function upcoming()
    {
        return $this->reading(fn() => Calendar::upcoming($this->acc(), (int)$this->request->getQuery('limit', 20), (int)$this->request->getQuery('days', 90),
            (string)$this->request->getQuery('child', '') ?: null));
    }

    public function schoolFeed()
    {
        return $this->reading(fn() => Calendar::schoolFeed($this->acc()));
    }

    public function setSchoolFeed()
    {
        return $this->writing(function () {
            $op = (string)$this->request->getData('op');
            $r = Calendar::setSchoolFeed($this->acc(), $op);
            $this->_audit('calendar.school_link_' . preg_replace('/[^a-z]/', '', $op), ['category' => 'settings', 'entity_type' => 'calendar_feed', 'entity_id' => 'school',
                'summary' => ['on' => 'Public school calendar link switched on', 'reset' => 'Public school calendar link reset', 'off' => 'Public school calendar link switched off'][$op] ?? $op]);

            return $r;
        });
    }
}
