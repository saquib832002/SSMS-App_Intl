<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Safety;
use App\Service\StudentRecord;
use Psr\Http\Message\UploadedFileInterface;

/**
 * SafetyApi – visitor management and authorised pick-up (JWT, app only).
 *
 * Reception (Roles › Visitors & safe pick-up):
 *   GET  visitorsToday?date     GET lookupVisitor?phone     POST signIn {...}     POST signOut {id}     POST signOutAll
 *   POST findByCode {code}      GET  history?from&to&q&status&page        GET exportVisits?from&to&q&status (CSV)
 *   POST deleteVisit {id}       GET  watchlist   POST saveWatch {...}   POST removeWatch {id}
 *   GET  settings               POST saveSettings {...}
 * Gate:
 *   GET  searchStudents?q       GET  pickupCard?enrollment_id      POST recordPickup {...}    POST refusePickup {...}
 *   GET  pickupLog?date&class_id&section_id
 *   GET  persons?enrollment_id  POST savePerson {enrollment_id, ...}   POST approvePerson {id, approve}   POST removePerson {id}
 *   POST uploadPhoto (multipart: type visit|person, id, file)          GET photo?type&id
 * Every staff member (own visitors):
 *   GET  myVisitors   POST expectVisitor {... name | names}   POST newVisitCode {id}   POST cancelExpected {id}   GET staff
 * Parents (own child):
 *   GET  myPickup?enrollment_id   POST addMyPerson {...}   POST removeMyPerson {enrollment_id, id}   POST newMyCode {enrollment_id, id}
 *   POST myPersonPhoto (multipart: enrollment_id, id, file)   GET photo?type=person&id&enrollment_id
 */
class SafetyApiController extends AppController
{
    use SecurityApiTrait;

    private function bearer(): void
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app for visitors and pick-up.');
        }
    }

    private function portal(): bool
    {
        return in_array(strtolower($this->_role()), ['parent', 'student'], true);
    }

    private function acc(): array
    {
        $this->bearer();
        if ($this->portal()) {
            throw new \DomainException('Not allowed.');
        }

        return Safety::access($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(), 'custom_role' => $this->request->getAttribute('jwt_custom_role')]);
    }

    private function parent(string $eid): array
    {
        $this->bearer();

        return Safety::parentAccess($this->_client(), ['user' => $this->_user(), 'role' => $this->_role()], $eid);
    }

    private function q(string $k): string
    {
        return trim((string)$this->request->getQuery($k, ''));
    }

    private function d(string $k): string
    {
        return trim((string)$this->request->getData($k, ''));
    }

    private function audit(string $event, string $summary, string $type, $id, array $extra = []): void
    {
        $this->_audit($event, ['category' => 'records', 'entity_type' => $type, 'entity_id' => (string)$id, 'summary' => $summary] + $extra);
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

    // ── Visitors ────────────────────────────────────────────────────────────

    public function visitorsToday()
    {
        return $this->reading(fn() => Safety::visitorsToday($this->acc(), $this->q('date')));
    }

    public function lookupVisitor()
    {
        return $this->reading(fn() => Safety::lookupVisitor($this->acc(), $this->q('phone')));
    }

    public function signIn()
    {
        return $this->writing(function () {
            $r = Safety::signIn($this->acc(), (array)$this->request->getData());
            $v = $r['visit'];
            $this->audit($r['denied'] ? 'safety.visitor_refused' : 'safety.visitor_in', ($r['denied'] ? 'Visitor refused (watch list): ' : 'Visitor signed in: ') . $v['name']
                . ($v['host'] ? ' → ' . $v['host'] : ''), 'visit', $v['id']);

            return $r;
        });
    }

    public function signOut()
    {
        return $this->writing(fn() => Safety::signOut($this->acc(), (int)$this->d('id')));
    }

    public function signOutAll()
    {
        return $this->writing(function () {
            $r = Safety::signOutAll($this->acc());
            $this->audit('safety.visitors_out', $r['signed_out'] . ' visitors signed out at once', 'visit', 'all');

            return $r;
        });
    }

    public function findByCode()
    {
        return $this->writing(fn() => Safety::findByCode($this->acc(), $this->d('code')));
    }

    public function history()
    {
        return $this->reading(fn() => Safety::history($this->acc(), (array)$this->request->getQueryParams()));
    }

    public function exportVisits()
    {
        $this->request->allowMethod(['get']);
        try {
            $acc = $this->acc();
            $csv = Safety::exportCsv($acc, (array)$this->request->getQueryParams());
            $this->audit('safety.visitors_exported', 'Visitor log exported (' . ($this->q('from') ?: '30 days') . ' – ' . ($this->q('to') ?: 'today') . ')', 'visit', 'export', ['category' => 'export']);
            $this->autoRender = false;

            return $this->response->withType('text/csv')->withCharset('UTF-8')->withHeader('Content-Disposition', 'attachment; filename="visitors.csv"')
                ->withHeader('Cache-Control', 'no-store')->withStringBody($csv);
        } catch (\Throwable $e) {
            return $this->_try(function () use ($e) {
                throw $e;
            });
        }
    }

    public function deleteVisit()
    {
        return $this->writing(function () {
            $r = Safety::deleteVisit($this->acc(), (int)$this->d('id'));
            $this->audit('safety.visit_deleted', 'Visit record deleted: ' . $r['name'], 'visit', $r['deleted']);

            return $r;
        });
    }

    public function watchlist()
    {
        return $this->reading(fn() => Safety::watchlist($this->acc()));
    }

    public function saveWatch()
    {
        return $this->writing(function () {
            $r = Safety::saveWatch($this->acc(), (array)$this->request->getData());
            $this->audit('safety.watchlist_saved', 'Watch list: ' . $this->d('name') . ' (' . ($this->d('level') === 'alert' ? 'alert' : 'deny') . ')', 'watchlist', $this->d('id') ?: 'new');

            return $r;
        });
    }

    public function removeWatch()
    {
        return $this->writing(function () {
            $r = Safety::removeWatch($this->acc(), (int)$this->d('id'));
            $this->audit('safety.watchlist_removed', 'Removed from the watch list', 'watchlist', $this->d('id'));

            return $r;
        });
    }

    public function settings()
    {
        return $this->reading(function () {
            $a = $this->acc();
            if (!$a['view']) {
                throw new \DomainException("You don't have permission to see visitors and pick-ups. Ask the school owner if you need it (Roles › Visitors & safe pick-up).");
            }

            return ['settings' => Safety::settings($a['client']), 'can' => array_intersect_key($a, array_flip(['view', 'edit', 'approve', 'delete', 'export']))];
        });
    }

    public function saveSettings()
    {
        return $this->writing(function () {
            $s = Safety::saveSettings($this->acc(), (array)$this->request->getData());
            $this->audit('safety.settings', 'Visitor & pick-up rules changed', 'safety_settings', $this->_client(), ['changes' => $s]);

            return ['settings' => $s];
        });
    }

    // ── Staff's own visitors ────────────────────────────────────────────────

    public function myVisitors()
    {
        return $this->reading(fn() => Safety::myVisitors($this->acc()));
    }

    public function expectVisitor()
    {
        return $this->writing(function () {
            $r = Safety::expectVisitor($this->acc(), (array)$this->request->getData());
            $this->audit('safety.visitor_expected', 'Visitor expected: ' . $r['visit']['name'] . (count($r['visits']) > 1 ? ' +' . (count($r['visits']) - 1) . ' guests' : '') . ' on ' . $r['visit']['date'], 'visit', $r['visit']['id']);

            return $r;
        });
    }

    public function newVisitCode()
    {
        return $this->writing(fn() => Safety::newVisitCode($this->acc(), (int)$this->d('id')));
    }

    public function cancelExpected()
    {
        return $this->writing(fn() => Safety::cancelExpected($this->acc(), (int)$this->d('id')));
    }

    public function staff()
    {
        return $this->reading(fn() => Safety::staffList($this->acc()));
    }

    // ── Pick-up ─────────────────────────────────────────────────────────────

    public function searchStudents()
    {
        return $this->reading(fn() => Safety::searchStudents($this->acc(), $this->q('q')));
    }

    public function pickupCard()
    {
        return $this->reading(fn() => Safety::pickupCard($this->acc(), $this->q('enrollment_id')));
    }

    public function recordPickup()
    {
        return $this->writing(function () {
            $r = Safety::recordPickup($this->acc(), (array)$this->request->getData());
            $p = $r['pickup'];
            $this->audit($p['method'] === 'override' ? 'safety.pickup_override' : 'safety.pickup', 'Student ' . $p['enrollment_id'] . ' collected by ' . $p['by']
                . ' (' . $p['method'] . ')' . ($p['override_reason'] ? ': ' . $p['override_reason'] : ''), 'pickup', $p['id']);

            return $r;
        });
    }

    public function refusePickup()
    {
        return $this->writing(function () {
            $r = Safety::refusePickup($this->acc(), (array)$this->request->getData());
            $this->audit('safety.pickup_refused', 'Pick-up refused: ' . $r['visit']['name'] . ' for ' . $this->d('enrollment_id'), 'visit', $r['visit']['id']);

            return $r;
        });
    }

    public function pickupLog()
    {
        return $this->reading(fn() => Safety::pickupLog($this->acc(), $this->q('date'), (int)$this->q('class_id'), (int)$this->q('section_id')));
    }

    public function persons()
    {
        return $this->reading(fn() => Safety::persons($this->acc(), $this->q('enrollment_id')));
    }

    public function savePerson()
    {
        return $this->writing(function () {
            $r = Safety::savePerson($this->acc(), $this->d('enrollment_id'), (array)$this->request->getData());
            $p = $r['person'];
            $this->audit('safety.person_saved', 'Pick-up person ' . ($this->d('id') ? 'changed' : 'added') . ': ' . $p['name'] . ' (' . $p['relation_label'] . ')'
                . ($p['can_pickup'] ? '' : ' – NOT allowed to collect'), 'pickup_person', $p['id']);

            return $r;
        });
    }

    public function approvePerson()
    {
        return $this->writing(function () {
            $ok = in_array($this->d('approve'), ['1', 'true'], true);
            $r = Safety::approvePerson($this->acc(), (int)$this->d('id'), $ok);
            $this->audit('safety.person_' . ($ok ? 'approved' : 'rejected'), 'Pick-up person ' . ($ok ? 'approved' : 'not approved') . ': ' . $r['person']['name'], 'pickup_person', $r['person']['id']);

            return $r;
        });
    }

    public function removePerson()
    {
        return $this->writing(function () {
            $r = Safety::removePerson($this->acc(), (int)$this->d('id'));
            $this->audit('safety.person_removed', 'Pick-up person removed: ' . $r['name'], 'pickup_person', $r['removed']);

            return $r;
        });
    }

    // ── Photos ──────────────────────────────────────────────────────────────

    private function upload(): string
    {
        $file = $this->request->getData('file');
        if (!$file instanceof UploadedFileInterface || $file->getError() !== UPLOAD_ERR_OK) {
            throw new \InvalidArgumentException('Take or choose a photo (the upload did not finish).');
        }
        if ((int)$file->getSize() > Safety::MAX_PHOTO) {
            throw new \InvalidArgumentException('The photo is too big (the limit is 5 MB).');
        }
        $tmp = StudentRecord::incomingPath();
        $file->moveTo($tmp);

        return $tmp;
    }

    public function uploadPhoto()
    {
        return $this->writing(function () {
            $a = $this->acc();
            if (!$a['edit']) {
                throw new \DomainException("You don't have permission to sign visitors in or hand children over. Ask the school owner if you need it (Roles › Visitors & safe pick-up).");
            }
            $type = $this->d('type') === 'visit' ? 'visit' : 'person';

            return Safety::setPhoto($a['client'], $type, (int)$this->d('id'), $this->upload());
        });
    }

    public function myPersonPhoto()
    {
        return $this->writing(function () {
            $p = $this->parent($this->d('enrollment_id'));
            $id = (int)$this->d('id');
            if (!Safety::parentOwnsPerson($p, $id)) {
                throw new \DomainException('You can only add photos of people you added yourself.');
            }

            return Safety::setPhoto($p['client'], 'person', $id, $this->upload());
        });
    }

    public function photo()
    {
        $this->request->allowMethod(['get']);
        try {
            $type = $this->q('type') === 'visit' ? 'visit' : 'person';
            if ($this->portal()) {
                [$path, $mime] = Safety::photoFile($this->_client(), $type, (int)$this->q('id'), $this->parent($this->q('enrollment_id')));
            } else {
                $a = $this->acc();
                if (!$a['view']) {
                    throw new \DomainException('Not allowed.');
                }
                [$path, $mime] = Safety::photoFile($a['client'], $type, (int)$this->q('id'));
            }
            $this->autoRender = false;

            return $this->response->withType($mime)->withHeader('Cache-Control', 'private, max-age=300')->withHeader('X-Content-Type-Options', 'nosniff')
                ->withStringBody((string)file_get_contents($path));
        } catch (\Throwable $e) {
            return $this->_try(function () use ($e) {
                throw $e;
            });
        }
    }

    // ── Parents ─────────────────────────────────────────────────────────────

    public function myPickup()
    {
        return $this->reading(fn() => Safety::myPickup($this->parent($this->q('enrollment_id'))));
    }

    public function addMyPerson()
    {
        return $this->writing(function () {
            $r = Safety::addMyPerson($this->parent($this->d('enrollment_id')), (array)$this->request->getData());
            $this->audit('safety.parent_person_added', 'Parent added pick-up person: ' . $r['person']['name'] . ' (' . $r['status'] . ')', 'pickup_person', $r['person']['id']);

            return $r;
        });
    }

    public function removeMyPerson()
    {
        return $this->writing(function () {
            $r = Safety::removeMyPerson($this->parent($this->d('enrollment_id')), (int)$this->d('id'));
            $this->audit('safety.parent_person_removed', 'Parent removed a pick-up person', 'pickup_person', $r['removed']);

            return $r;
        });
    }

    public function newMyCode()
    {
        return $this->writing(fn() => Safety::newMyCode($this->parent($this->d('enrollment_id')), (int)$this->d('id')));
    }
}
