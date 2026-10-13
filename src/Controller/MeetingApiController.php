<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Meetings;
use App\Service\StudentLeave;

/**
 * MeetingApi – parent–teacher meeting booking (JWT protected, app only).
 *
 * Staff (Roles & permissions › Parent–teacher meetings):
 *   GET  /MeetingApi/sessions?scope=mine|all&when=upcoming|past
 *   GET  /MeetingApi/session?id=
 *   GET  /MeetingApi/teachers                       (office: whom it can publish for)
 *   POST /MeetingApi/saveSession   { id?, staff_id?, title, meet_date, start_time, end_time, slot_minutes, gap_minutes,
 *                                    mode, location, audience: [{class_id, section_id}]|null, closes_hours, note_for_parents, status }
 *   POST /MeetingApi/cancelSession { id, reason }
 *   POST /MeetingApi/setSlot       { id, block: 1|0 }
 *   POST /MeetingApi/markBooking   { id, status?: attended|no_show|booked, teacher_note? }
 *   POST /MeetingApi/bookFor       { slot_id, enrollment_id, topic }   (a parent phoned)
 *   POST /MeetingApi/staffCancel   { id, reason }
 * Parents / students:
 *   GET  /MeetingApi/available?enrollmentId=
 *   POST /MeetingApi/book          { slot_id, enrollment_id, topic }
 *   GET  /MeetingApi/myBookings
 *   POST /MeetingApi/cancel        { id, reason }
 */
class MeetingApiController extends AppController
{
    use SecurityApiTrait {
        _out as private _traitOut;
    }

    private ?int $bufLevel = null;

    public function initialize(): void
    {
        parent::initialize();
        if (ob_start()) {
            $this->bufLevel = ob_get_level();
        }
    }

    protected function _out(array $data, int $status = 200)
    {
        if ($this->bufLevel !== null && ob_get_level() >= $this->bufLevel) {
            while (ob_get_level() > $this->bufLevel) {
                ob_end_flush();
            }
            $stray = (string)ob_get_clean();
            $this->bufLevel = null;
            if (trim($stray) !== '') {
                \Cake\Log\Log::warning('MeetingApi: unexpected output removed from reply: ' . mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($stray))), 0, 1000));
            }
        }

        return $this->_traitOut($data, $status);
    }

    private function bearer(): void
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app for meeting bookings.');
        }
    }

    private function portal(): bool
    {
        return in_array($this->_role(), ['parent', 'student'], true);
    }

    private function acc(): array
    {
        $this->bearer();
        if ($this->portal()) {
            throw new \DomainException('Not allowed.');
        }

        return Meetings::staffAccess($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(),
            'custom_role' => $this->request->getAttribute('jwt_custom_role')]);
    }

    private function children(): array
    {
        $this->bearer();
        if (!$this->portal()) {
            throw new \DomainException('Not allowed.');
        }
        if ($this->_user() === '') {
            throw new \DomainException('Please sign in again.');
        }

        return Meetings::myChildren($this->_client(), $this->_role(), $this->_user(), (string)$this->request->getAttribute('jwt_enrollment_id'));
    }

    private function auditSession(string $event, string $summary, int $id, $changes = null, string $category = 'records'): void
    {
        $this->_audit($event, ['category' => $category, 'entity_type' => 'ptm_session', 'entity_id' => (string)$id, 'summary' => $summary, 'changes' => $changes]);
    }

    // ── Staff ───────────────────────────────────────────────────────────────

    public function sessions()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $acc = $this->acc();
            Meetings::remindIfDue($this->_client());

            return ['sessions' => Meetings::staffSessions($this->_client(), $acc, ['scope' => (string)$this->request->getQuery('scope'),
                    'when' => (string)$this->request->getQuery('when')]),
                    'can' => ['edit' => $acc['edit'], 'all' => $acc['all'], 'delete' => $acc['delete'], 'has_staff' => $acc['staff_id'] !== null],
                    'modes' => Meetings::MODES, 'now' => Meetings::now($this->_client())];
        });
    }

    public function session()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(fn() => ['session' => Meetings::session($this->_client(), (int)$this->request->getQuery('id'), $this->acc()),
                                    'now' => Meetings::now($this->_client())]);
    }

    public function teachers()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $acc = $this->acc();
            if (!$acc['all']) {
                throw new \DomainException('Only the school office can publish slots for other teachers.');
            }

            return ['teachers' => Meetings::teachers($this->_client())];
        });
    }

    public function saveSession()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $res = Meetings::saveSession($this->_client(), $this->acc(), (array)$this->request->getData());
            $s = $res['session'];
            $this->auditSession($res['is_new'] ? 'ptm.session_created' : 'ptm.session_changed',
                ($res['is_new'] ? 'Meeting slots published: ' : 'Meeting session changed: ') . $s['title'] . ' · ' . $s['teacher'] . ' · ' . $s['meet_date']
                . ' ' . $s['start_time'] . '–' . $s['end_time'], $s['id'],
                ['slots' => count($s['slot_list']), 'mode' => $s['mode'], 'status' => $s['status']]);

            return $res;
        });
    }

    public function cancelSession()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $id = (int)$this->request->getData('id');
            $res = Meetings::cancelSession($this->_client(), $this->acc(), $id, (string)$this->request->getData('reason'));
            $this->auditSession('ptm.session_cancelled', 'Meeting session cancelled: ' . $res['session']['title'] . ' · ' . $res['session']['meet_date']
                . ' (' . $res['cancelled_bookings'] . ' bookings cancelled)', $id);

            return $res;
        });
    }

    public function setSlot()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $block = (bool)(int)$this->request->getData('block');
            $s = Meetings::setSlot($this->_client(), $this->acc(), (int)$this->request->getData('id'), $block);
            $this->auditSession($block ? 'ptm.slot_blocked' : 'ptm.slot_opened', ($block ? 'Meeting slot blocked · ' : 'Meeting slot opened · ') . $s['title'], $s['id'],
                ['slot_id' => (int)$this->request->getData('id')]);

            return ['session' => $s];
        });
    }

    public function markBooking()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $d = (array)$this->request->getData();

            $s = Meetings::markBooking($this->_client(), $this->acc(), (int)($d['id'] ?? 0),
                array_key_exists('status', $d) ? (string)$d['status'] : null, array_key_exists('teacher_note', $d) ? (string)$d['teacher_note'] : null);
            // which things changed – never the note itself
            $this->auditSession('ptm.booking_marked', 'Meeting updated · ' . $s['title'], $s['id'],
                ['booking_id' => (int)($d['id'] ?? 0), 'status' => $d['status'] ?? null, 'note_changed' => array_key_exists('teacher_note', $d)]);

            return ['session' => $s];
        });
    }

    public function bookFor()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $d = (array)$this->request->getData();
            $b = Meetings::book($this->_client(), (int)($d['slot_id'] ?? 0), trim((string)($d['enrollment_id'] ?? '')), $this->_user(), $this->_role(),
                (string)($d['topic'] ?? ''), $acc);
            $this->auditSession('ptm.booked', 'Meeting booked by staff for ' . $b['student']['name'] . ' · ' . $b['start_at'], $b['session_id']);

            return ['booking' => $b, 'session' => Meetings::session($this->_client(), $b['session_id'], $acc)];
        });
    }

    public function staffCancel()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $r = Meetings::cancelBooking($this->_client(), (int)$this->request->getData('id'), $this->_user(), $this->_role(),
                (string)$this->request->getData('reason'), $acc);
            $this->auditSession('ptm.cancelled', 'Meeting cancelled by school: ' . $r['student'] . ' · ' . $r['start_at'], $r['session_id']);

            return ['session' => Meetings::session($this->_client(), $r['session_id'], $acc)];
        });
    }

    // ── Parents ─────────────────────────────────────────────────────────────

    public function available()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $mine = $this->children();
            $eid = trim((string)$this->request->getQuery('enrollmentId'));
            if ($eid === '' && count($mine) === 1) {
                $eid = $mine[0];
            }
            if (!in_array($eid, $mine, true)) {
                throw new \DomainException('Choose one of your children.');
            }
            Meetings::remindIfDue($this->_client());

            return Meetings::available($this->_client(), $eid) + ['now' => Meetings::now($this->_client())];
        });
    }

    public function book()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $mine = $this->children();
            if ($this->_role() !== 'parent') {
                throw new \DomainException('Please ask a parent to book the meeting.');
            }
            $d = (array)$this->request->getData();
            $eid = trim((string)($d['enrollment_id'] ?? ''));
            if (!in_array($eid, $mine, true)) {
                throw new \DomainException('You can only book for your own children.');
            }
            $b = Meetings::book($this->_client(), (int)($d['slot_id'] ?? 0), $eid, $this->_user(), 'parent', (string)($d['topic'] ?? ''));
            $this->auditSession('ptm.booked', 'Meeting booked by parent for ' . $b['student']['name'] . ' · ' . $b['start_at'], $b['session_id']);

            return ['booking' => $b];
        });
    }

    public function myBookings()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $mine = $this->children();
            Meetings::remindIfDue($this->_client());

            return ['bookings' => Meetings::myBookings($this->_client(), $mine, $this->_role() === 'parent'), 'now' => Meetings::now($this->_client())];
        });
    }

    public function cancel()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $mine = $this->children();
            if ($this->_role() !== 'parent') {
                throw new \DomainException('Please ask a parent to cancel the meeting.');
            }
            $r = Meetings::cancelBooking($this->_client(), (int)$this->request->getData('id'), $this->_user(), 'parent',
                (string)$this->request->getData('reason'), null, $mine);
            $this->auditSession('ptm.cancelled', 'Meeting cancelled by parent: ' . $r['student'] . ' · ' . $r['start_at'], $r['session_id']);

            return ['bookings' => Meetings::myBookings($this->_client(), $mine)];
        });
    }
}
