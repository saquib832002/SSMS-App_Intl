<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\ExamLogistics;

/**
 * ExamLogisticsApi – exam halls, seating plans, invigilation duties, admit cards / hall tickets (JWT, app only).
 *
 * Office (Roles & permissions › Exam halls, seating & admit cards):
 *   GET  setup                                   exams, sessions, branches, what you can do
 *   GET  halls?all=1        POST saveHall {hall_id?, name, location, branch_id, rows, cols, blocked, active}
 *   POST deleteHall {id}
 *   GET  sittings?exam_id&session_id&branch_id   date-sheet sittings with their plans
 *   GET  plan?id            POST generatePlan {exam_id, session_id, branch_id, exam_date, start_time, end_time, classes, hall_ids, mode, spacing}
 *   POST moveSeat {plan_id, enrollment_id, hall_id, row, col}     POST publishPlan {id, publish}     POST deletePlan {id}
 *   GET  duties?plan_id     POST assignDuty {plan_id, hall_id, staff_id, role, force?}   POST unassignDuty {id}   POST autoAssign {plan_id, per_hall}
 *   GET  roster?exam_id&session_id&branch_id
 *   GET  admitList?exam_id&session_id&class_id&section_id    POST saveAdmitSettings {...}   POST setAdmitStatus {exam_id, session_id, enrollment_id, override, reason}
 *   POST publishAdmit {exam_id, session_id, publish}          GET printAdmitCards?exam_id&session_id&class_id&section_id&all&photos
 * Everyone:
 *   GET  myDuties           (staff: own invigilation duties)
 *   GET  myAdmitCards?enrollmentId   (parents / students)
 */
class ExamLogisticsApiController extends AppController
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
                \Cake\Log\Log::warning('ExamLogisticsApi: unexpected output removed from reply: ' . mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($stray))), 0, 1000));
            }
        }

        return $this->_traitOut($data, $status);
    }

    private function bearer(): void
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app for exam halls, seating and admit cards.');
        }
    }

    private function acc(): array
    {
        $this->bearer();

        return ExamLogistics::access($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(),
            'custom_role' => $this->request->getAttribute('jwt_custom_role')]);
    }

    private function q(string $k): int
    {
        return (int)$this->request->getQuery($k);
    }

    private function d(string $k): int
    {
        return (int)$this->request->getData($k);
    }

    private function audit(string $event, string $summary, string $type, $id, $changes = null): void
    {
        $this->_audit($event, ['category' => 'records', 'entity_type' => $type, 'entity_id' => (string)$id, 'summary' => $summary, 'changes' => $changes]);
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

    // ── Halls ───────────────────────────────────────────────────────────────

    public function setup()
    {
        return $this->reading(fn() => ExamLogistics::setup($this->acc()));
    }

    public function letterhead()
    {
        return $this->reading(fn() => ExamLogistics::letterhead($this->acc()));
    }

    public function halls()
    {
        return $this->reading(fn() => ['halls' => ExamLogistics::halls($this->acc(), (bool)$this->q('all'), $this->q('branch_id') ?: null)]);
    }

    public function saveHall()
    {
        return $this->writing(function () {
            $r = ExamLogistics::saveHall($this->acc(), (array)$this->request->getData());
            $h = $r['hall'];
            $this->audit($r['is_new'] ? 'exam.hall_created' : 'exam.hall_changed', 'Exam hall ' . ($r['is_new'] ? 'added' : 'changed') . ': ' . $h['name']
                . ' (' . $h['rows'] . ' × ' . $h['cols'] . ', ' . $h['capacity'] . ' seats)', 'exam_hall', $h['hall_id']);

            return $r;
        });
    }

    public function deleteHall()
    {
        return $this->writing(function () {
            $r = ExamLogistics::deleteHall($this->acc(), $this->d('id'));
            $this->audit($r['deleted'] ? 'exam.hall_deleted' : 'exam.hall_switched_off', 'Exam hall ' . ($r['deleted'] ? 'deleted' : 'switched off') . ': ' . $r['hall']['name'], 'exam_hall', $r['hall']['hall_id']);

            return $r;
        });
    }

    // ── Seating ─────────────────────────────────────────────────────────────

    public function sittings()
    {
        return $this->reading(fn() => ExamLogistics::sittings($this->acc(), $this->q('exam_id'), $this->q('session_id'), $this->q('branch_id')));
    }

    public function plan()
    {
        return $this->reading(fn() => ['plan' => ExamLogistics::plan($this->acc(), $this->q('id'))]);
    }

    public function generatePlan()
    {
        return $this->writing(function () {
            $r = ExamLogistics::generatePlan($this->acc(), (array)$this->request->getData());
            $p = $r['plan'];
            $this->audit('exam.seating_generated', 'Seating plan ' . ($r['is_new'] ? 'made' : 'redone') . ': ' . $p['exam']['name'] . ' · ' . $p['exam_date'] . ' ' . $p['start_time']
                . ' · ' . $p['students'] . ' students in ' . count($p['halls']) . ' halls', 'exam_seat_plan', $p['plan_id'], ['mode' => $p['mode'], 'spacing' => $p['spacing']]);

            return $r;
        });
    }

    public function moveSeat()
    {
        return $this->writing(function () {
            $r = ExamLogistics::moveSeat($this->acc(), (array)$this->request->getData());
            $this->audit('exam.seat_moved', 'Seat changed for student ' . (string)$this->request->getData('enrollment_id') . ' (' . $r['plan']['exam_date'] . ')', 'exam_seat_plan', $r['plan']['plan_id']);

            return $r;
        });
    }

    public function publishPlan()
    {
        return $this->writing(function () {
            $pub = (bool)$this->d('publish');
            $r = ExamLogistics::publishPlan($this->acc(), $this->d('id'), $pub);
            $this->audit($pub ? 'exam.seating_published' : 'exam.seating_unpublished', 'Seating plan ' . ($pub ? 'published' : 'unpublished') . ': ' . $r['plan']['exam']['name'] . ' · ' . $r['plan']['exam_date'],
                'exam_seat_plan', $r['plan']['plan_id']);

            return $r;
        });
    }

    public function deletePlan()
    {
        return $this->writing(function () {
            $id = $this->d('id');
            $r = ExamLogistics::deletePlan($this->acc(), $id);
            $this->audit('exam.seating_deleted', 'Seating plan deleted: ' . $r['exam_date'] . ' ' . $r['start_time'], 'exam_seat_plan', $id);

            return $r;
        });
    }

    // ── Invigilation ────────────────────────────────────────────────────────

    public function duties()
    {
        return $this->reading(fn() => ExamLogistics::duties($this->acc(), $this->q('plan_id')));
    }

    public function assignDuty()
    {
        return $this->writing(function () {
            $r = ExamLogistics::assignDuty($this->acc(), (array)$this->request->getData());
            $this->audit('exam.duty_assigned', 'Invigilation duty: ' . $r['staff'] . ' (plan ' . $this->d('plan_id') . ')', 'exam_seat_plan', $this->d('plan_id'));

            return $r;
        });
    }

    public function unassignDuty()
    {
        return $this->writing(function () {
            $r = ExamLogistics::removeDuty($this->acc(), $this->d('id'));
            $this->audit('exam.duty_removed', 'Invigilation duty removed (plan ' . $r['duties']['plan']['plan_id'] . ')', 'exam_seat_plan', $r['duties']['plan']['plan_id']);

            return $r;
        });
    }

    public function autoAssign()
    {
        return $this->writing(function () {
            $r = ExamLogistics::autoAssign($this->acc(), $this->d('plan_id'), $this->d('per_hall') ?: 2);
            $this->audit('exam.duty_auto', 'Invigilators filled in automatically: ' . $r['added'] . ' added (plan ' . $this->d('plan_id') . ')', 'exam_seat_plan', $this->d('plan_id'));

            return $r;
        });
    }

    public function roster()
    {
        return $this->reading(fn() => ExamLogistics::roster($this->acc(), $this->q('exam_id'), $this->q('session_id'), $this->q('branch_id')));
    }

    public function myDuties()
    {
        return $this->reading(function () {
            $this->bearer();
            if (in_array($this->_role(), ['parent', 'student'], true) || $this->_user() === '') {
                throw new \DomainException('Not allowed.');
            }

            return ExamLogistics::myDuties($this->_client(), $this->_user());
        });
    }

    // ── Admit cards ─────────────────────────────────────────────────────────

    public function admitList()
    {
        return $this->reading(fn() => ExamLogistics::admitList($this->acc(), $this->q('exam_id'), $this->q('session_id'), $this->q('class_id') ?: null, $this->q('section_id') ?: null));
    }

    public function saveAdmitSettings()
    {
        return $this->writing(function () {
            $r = ExamLogistics::saveAdmitSettings($this->acc(), (array)$this->request->getData());
            $s = $r['settings'];
            $this->audit('exam.admit_rules', 'Admit card rules saved (exam ' . $this->d('exam_id') . ')', 'exam_admit', $this->d('exam_id') . ':' . $this->d('session_id'),
                ['fees' => $s['rule_fees'], 'fee_tolerance' => $s['fee_tolerance'], 'attendance' => $s['rule_attendance']]);

            return $r;
        });
    }

    public function setAdmitStatus()
    {
        return $this->writing(function () {
            $r = ExamLogistics::setAdmitOverride($this->acc(), (array)$this->request->getData());
            $ov = $this->request->getData('override');
            $this->audit('exam.admit_override', 'Admit card ' . ($ov === 'allow' ? 'allowed' : ($ov === 'withhold' ? 'withheld' : 'back to the rules')) . ' for student '
                . (string)$this->request->getData('enrollment_id'), 'exam_admit', $this->d('exam_id') . ':' . $this->d('session_id'), ['reason' => (string)$this->request->getData('reason')]);

            return $r;
        });
    }

    public function publishAdmit()
    {
        return $this->writing(function () {
            $pub = (bool)$this->d('publish');
            $r = ExamLogistics::publishAdmit($this->acc(), $this->d('exam_id'), $this->d('session_id'), $pub);
            $this->audit($pub ? 'exam.admit_published' : 'exam.admit_unpublished', 'Admit cards ' . ($pub ? 'published (' . $r['issued'] . ' new hall-ticket numbers)' : 'unpublished')
                . ' – exam ' . $this->d('exam_id'), 'exam_admit', $this->d('exam_id') . ':' . $this->d('session_id'));

            return $r;
        });
    }

    public function printAdmitCards()
    {
        return $this->reading(function () {
            $r = ExamLogistics::printCards($this->acc(), $this->q('exam_id'), $this->q('session_id'), $this->q('class_id') ?: null, $this->q('section_id') ?: null,
                (bool)$this->q('all'), $this->request->getQuery('photos') === null ? true : (bool)$this->q('photos'));
            $this->audit('exam.admit_printed', 'Hall tickets printed: ' . count($r['cards'] ?? []) . ' (class ' . $this->q('class_id') . ')', 'exam_admit', $this->q('exam_id') . ':' . $this->q('session_id'));

            return $r;
        });
    }

    public function myAdmitCards()
    {
        return $this->reading(function () {
            $this->bearer();
            if (!in_array($this->_role(), ['parent', 'student'], true)) {
                throw new \DomainException('Admit cards for a child are shown in the parent / student app.');
            }
            $eid = trim((string)$this->request->getQuery('enrollmentId'));

            return ExamLogistics::myAdmitCards($this->_client(), $this->_role(), $this->_user(), (string)$this->request->getAttribute('jwt_enrollment_id'), $eid !== '' ? $eid : null);
        });
    }
}
