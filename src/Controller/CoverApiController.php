<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Cover;

/**
 * CoverApi – teacher cover & substitution (JWT, app only).
 *
 * Office (Roles & permissions › Timetable: view = see, edit = arrange):
 *   GET  day?date                         who is away, their periods, cover, open count, staff list, settings
 *   GET  suggest?date&timetable_id        free teachers best first (+ who is not free and why)
 *   POST assign {date, timetable_id, staff_id|null, note, force}   (staff_id empty = "no cover")
 *   POST unassign {date, timetable_id}
 *   POST autoAssign {date, apply, plan?}  "Suggest for all" (apply 0 = only show the plan; plan = the shown plan to store)
 *   POST markAway {staff_id, date, from_period, to_period, reason}   POST removeAway {id}
 *   GET  report?month=YYYY-MM             GET settings   POST saveSettings {...}
 * Everyone (own):
 *   GET  myCovers   POST respond {id, accept, note}   GET myDay?date
 */
class CoverApiController extends AppController
{
    use SecurityApiTrait;

    private function acc(): array
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app for teacher cover.');
        }
        $role = strtolower($this->_role());
        if (in_array($role, ['parent', 'student'], true)) {
            throw new \DomainException('Not allowed.');
        }

        return Cover::access($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(),
            'custom_role' => $this->request->getAttribute('jwt_custom_role')]);
    }

    private function str(string $k): ?string
    {
        $v = $this->request->getData($k);

        return $v === null ? null : (string)$v;
    }

    private function flag(string $k): bool
    {
        $v = $this->request->getData($k);

        return $v === true || $v === 1 || in_array((string)$v, ['1', 'true', 'yes'], true);
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

    // ── Office ──────────────────────────────────────────────────────────────

    public function day()
    {
        return $this->reading(fn() => Cover::day($this->acc(), (string)$this->request->getQuery('date', '')));
    }

    public function suggest()
    {
        return $this->reading(fn() => Cover::suggest($this->acc(), (string)$this->request->getQuery('date', ''), (int)$this->request->getQuery('timetable_id')));
    }

    public function assign()
    {
        return $this->writing(function () {
            $sid = (int)$this->request->getData('staff_id');
            $r = Cover::assign($this->acc(), $this->str('date'), (int)$this->request->getData('timetable_id'), $sid ?: null, $this->str('note'), $this->flag('force'));
            if (isset($r['slot'])) {
                $s = $r['slot'];
                $what = $s['class_label'] . ', ' . ($s['period_name'] ?: '#' . $s['period_number']) . ' on ' . ($this->str('date') ?: 'today');
                $this->audit('cover.assigned', $sid ? 'Cover: ' . ($s['cover']['name'] ?? '') . ' takes ' . $what . ' for ' . $s['teacher'] : 'No cover for ' . $what . ' (' . $s['teacher'] . ' away)',
                    'cover', $s['cover']['id'] ?? $s['timetable_id']);
            }

            return $r;
        });
    }

    public function unassign()
    {
        return $this->writing(function () {
            $r = Cover::unassign($this->acc(), $this->str('date'), (int)$this->request->getData('timetable_id'));
            $this->audit('cover.removed', 'Cover removed' . ($r['removed']['name'] ? ': ' . $r['removed']['name'] : '') . ' (' . ($this->str('date') ?: 'today') . ')', 'cover', $r['removed']['id']);

            return $r;
        });
    }

    public function autoAssign()
    {
        return $this->writing(function () {
            $apply = $this->flag('apply');
            $plan = $this->request->getData('plan');
            $r = Cover::autoAssign($this->acc(), $this->str('date'), $apply, $apply && is_array($plan) ? array_values(array_filter($plan, 'is_array')) : null);
            if ($apply && $r['plan']) {
                $this->audit('cover.auto_assigned', count($r['plan']) . ' cover periods filled by "Suggest for all" (' . ($this->str('date') ?: 'today') . ')', 'cover', $this->str('date') ?: 'today');
            }

            return $r;
        });
    }

    public function markAway()
    {
        return $this->writing(function () {
            $r = Cover::markAway($this->acc(), (array)$this->request->getData());
            $this->audit('cover.away_marked', $r['name'] . ' marked away on ' . $r['date'] . ($r['from_period'] !== null ? ' (periods ' . $r['from_period'] . '–' . $r['to_period'] . ')' : '')
                . ($r['reason'] ? ': ' . $r['reason'] : ''), 'cover_away', $r['id']);

            return $r;
        });
    }

    public function removeAway()
    {
        return $this->writing(function () {
            $r = Cover::removeAway($this->acc(), (int)$this->request->getData('id'));
            $this->audit('cover.away_removed', 'Away removed (' . $r['date'] . ')', 'cover_away', $r['removed']);

            return $r;
        });
    }

    public function report()
    {
        return $this->reading(fn() => Cover::report($this->acc(), (string)$this->request->getQuery('month', '')));
    }

    public function settings()
    {
        return $this->reading(function () {
            $a = $this->acc();
            if (!$a['view']) {
                throw new \DomainException("You don't have permission to see the cover sheet. Ask the school owner if you need it.");
            }

            return ['settings' => Cover::settings($a['client']), 'can_edit' => (bool)$a['edit']];
        });
    }

    public function saveSettings()
    {
        return $this->writing(function () {
            $s = Cover::saveSettings($this->acc(), (array)$this->request->getData());
            $this->audit('cover.settings', 'Cover rules changed: ' . $s['max_per_day'] . ' a day, ' . $s['max_per_week'] . ' a week', 'cover_settings', $this->_client(), $s);

            return ['settings' => $s];
        });
    }

    // ── Own ─────────────────────────────────────────────────────────────────

    public function myCovers()
    {
        return $this->reading(fn() => Cover::myCovers($this->acc()));
    }

    public function respond()
    {
        return $this->writing(fn() => Cover::respond($this->acc(), (int)$this->request->getData('id'), $this->flag('accept'), $this->str('note')));
    }

    public function myDay()
    {
        return $this->reading(fn() => Cover::myDay($this->acc(), (string)$this->request->getQuery('date', '')));
    }
}
