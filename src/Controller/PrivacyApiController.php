<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\AccountSecurity;
use App\Service\Consents;
use App\Service\PrivacyRequests;
use App\Service\StudentLeave;

/**
 * PrivacyApi – consents and data requests (JWT protected).
 *
 * Parents / students / staff:
 *   GET  /PrivacyApi/pending                   consents still to answer (shown after sign-in)
 *   POST /PrivacyApi/answer   { answers: [{subject_id, type_id, granted}] }
 *   GET  /PrivacyApi/mine                      my choices + my data requests
 *   POST /PrivacyApi/ask      { type: export|correction|delete, subject_id?, details? }
 *   POST /PrivacyApi/withdraw { id }
 *   GET  /PrivacyApi/download?id=              the data copy (requester only, 7 days)
 * Staff (consent report): owner, admin, principal – all classes; teachers – their own classes
 *   GET  /PrivacyApi/consentReport?typeId=&classId=&sectionId=
 * Owner / admin ("Privacy & audit · edit"):
 *   GET  /PrivacyApi/consentTypes     POST /PrivacyApi/saveConsentType { id?, title, body, audience, required, active }
 *   POST /PrivacyApi/recordPaper { subject_id, type_id, granted, given_by, note }
 *   GET  /PrivacyApi/history?subjectId=
 *   GET  /PrivacyApi/requests?status=open|done|all     POST /PrivacyApi/logRequest { … channel office }
 *   GET  /PrivacyApi/plan?id=        POST /PrivacyApi/setStatus { id, status, note }
 *   POST /PrivacyApi/approveDelete { id, code }   (owner only)
 *   GET  /PrivacyApi/openCount
 */
class PrivacyApiController extends AppController
{
    use SecurityApiTrait;

    private function isAdmin(): bool
    {
        return $this->_isOwner() || $this->_can('privacy', 'edit');
    }

    private function meta(): array
    {
        return ['method' => 'app', 'ip' => $this->_ip(), 'app_version' => (string)$this->request->getHeaderLine('X-App-Version')];
    }

    // ── Consents (everyone) ─────────────────────────────────────────────────

    public function pending()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(fn() => Consents::pending($this->_client(), $this->_user(), $this->_role(),
            (string)$this->request->getAttribute('jwt_enrollment_id')));
    }

    public function answer()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $answers = (array)$this->request->getData('answers');
            $n = Consents::answer($this->_client(), $this->_user(), $this->_role(), $answers, $this->meta());
            $types = array_column(Consents::types($this->_client()), 'title', 'id');
            $summary = [];
            foreach ($answers as $a) {
                $summary[] = ($types[(int)($a['type_id'] ?? 0)] ?? '?') . ': ' . (!empty($a['granted']) ? 'yes' : 'no') . ' (' . ($a['subject_id'] ?? '') . ')';
            }
            if ($n) {
                $this->_audit('consent.answered', ['category' => 'privacy', 'summary' => "Consent choices saved ({$n})", 'changes' => $summary]);
            }

            return ['saved' => $n, 'pending' => Consents::pending($this->_client(), $this->_user(), $this->_role())];
        });
    }

    public function mine()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(fn() => [
            'consents' => Consents::mine($this->_client(), $this->_user(), $this->_role()),
            'requests' => PrivacyRequests::mine($this->_client(), $this->_user()),
            'subjects' => Consents::subjects($this->_client(), $this->_user(), $this->_role()),
            'is_staff' => !in_array($this->_role(), ['parent', 'student'], true),
        ]);
    }

    // ── Data requests (everyone) ────────────────────────────────────────────

    public function ask()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $d = (array)$this->request->getData();
            unset($d['channel']);
            $r = PrivacyRequests::create($this->_client(), $this->_user(), $this->_role(), $d, (string)$this->request->getAttribute('jwt_enrollment_id'));
            $this->_audit('privacy.request', ['category' => 'privacy', 'entity_type' => $r['subject_type'], 'entity_id' => $r['subject_id'],
                'summary' => ucfirst($r['type']) . ' request for ' . $r['subject_name'] . ' (#' . $r['id'] . ')']);

            return $r;
        });
    }

    public function withdraw()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $r = PrivacyRequests::withdraw($this->_client(), (int)$this->request->getData('id'), $this->_user());
            $this->_audit('privacy.withdrawn', ['category' => 'privacy', 'entity_id' => (string)$r['id'], 'summary' => 'Request #' . $r['id'] . ' withdrawn']);

            return $r;
        });
    }

    public function download()
    {
        $this->request->allowMethod(['get']);
        try {
            [$path, $name] = PrivacyRequests::downloadPath($this->_client(), (int)$this->request->getQuery('id'), $this->_user(), $this->_role());
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        }
        $this->_audit('privacy.downloaded', ['category' => 'privacy', 'entity_id' => (string)$this->request->getQuery('id'),
            'summary' => 'Data copy downloaded (request #' . (int)$this->request->getQuery('id') . ')']);
        $this->autoRender = false;

        return $this->response->withFile($path, ['download' => true, 'name' => $name])
            ->withType(str_ends_with($path, '.zip') ? 'application/zip' : 'text/html');
    }

    // ── Consent report (staff) ──────────────────────────────────────────────

    public function consentReport()
    {
        $this->request->allowMethod(['get']);
        $role = $this->_role();
        if (in_array($role, ['parent', 'student', 'accountant'], true)) {
            return $this->_forbidden();
        }

        return $this->_try(function () use ($role) {
            $q = $this->request->getQueryParams();
            $typeId = (int)($q['typeId'] ?? 0);
            if (!$typeId) {
                $types = array_values(array_filter(Consents::types($this->_client(), true), fn($t) => $t['audience'] === 'parent'));
                return ['types' => Consents::types($this->_client(), true), 'report' => null, 'default_type' => $types[1]['id'] ?? ($types[0]['id'] ?? null)];
            }
            $scope = [];
            if (!in_array($role, ['owner', 'admin', 'principal'], true)) {
                $scope = StudentLeave::teacherScope($this->_client(), $role, $this->_user()) ?: null;   // no classes → nothing
            }
            $t = Consents::type($this->_client(), $typeId);
            if ($t['audience'] === 'staff' && !in_array($role, ['owner', 'admin', 'principal'], true)) {
                throw new \DomainException('Only the owner, admins and the principal can see staff consents.');
            }

            return ['types' => Consents::types($this->_client(), true),
                    'report' => Consents::report($this->_client(), $typeId, (int)($q['classId'] ?? 0) ?: null, (int)($q['sectionId'] ?? 0) ?: null, $scope)];
        });
    }

    // ── Admin: consent types / paper forms / history ────────────────────────

    public function consentTypes()
    {
        $this->request->allowMethod(['get']);
        if (!$this->isAdmin()) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => ['types' => Consents::types($this->_client()), 'settings' => AccountSecurity::settings($this->_client())]);
    }

    public function saveConsentType()
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdmin()) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $d  = (array)$this->request->getData();
            $id = (int)($d['id'] ?? 0) ?: null;
            $before = $id ? Consents::type($this->_client(), $id) : null;
            $t = Consents::saveType($this->_client(), $id, $d, $this->_user());
            $this->_audit($id ? 'consent.type_changed' : 'consent.type_added', ['category' => 'privacy', 'entity_type' => 'consent_type',
                'entity_id' => (string)$t['id'], 'summary' => ($id ? 'Consent changed: ' : 'Consent added: ') . $t['title']
                    . ($before && $before['version'] !== $t['version'] ? ' (new version ' . $t['version'] . ' – everyone is asked again)' : ''),
                'changes' => $before ? array_filter(['title' => $before['title'] !== $t['title'] ? [$before['title'], $t['title']] : null,
                    'required' => $before['required'] !== $t['required'] ? [$before['required'], $t['required']] : null,
                    'active' => $before['active'] !== $t['active'] ? [$before['active'], $t['active']] : null,
                    'text_changed' => $before['body'] !== $t['body'] ?: null]) : null]);

            return $t;
        });
    }

    public function recordPaper()
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdmin() && !in_array($this->_role(), ['principal'], true)) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $d = (array)$this->request->getData();
            $n = Consents::answer($this->_client(), $this->_user(), $this->_role(), [[
                'subject_id' => $d['subject_id'] ?? '', 'type_id' => $d['type_id'] ?? 0, 'granted' => !empty($d['granted']),
                'given_by' => trim((string)($d['given_by'] ?? '')) ?: 'paper form', 'note' => $d['note'] ?? null,
            ]], ['method' => 'paper', 'ip' => $this->_ip()], true);
            if (!$n) {
                throw new \InvalidArgumentException('Choose the person and the consent.');
            }
            $this->_audit('consent.paper', ['category' => 'privacy', 'entity_id' => (string)($d['subject_id'] ?? ''),
                'summary' => 'Consent from a paper form recorded (' . (!empty($d['granted']) ? 'yes' : 'no') . ')']);

            return ['saved' => $n];
        });
    }

    public function history()
    {
        $this->request->allowMethod(['get']);
        if (!$this->isAdmin() && $this->_role() !== 'principal') {
            return $this->_forbidden();
        }

        return $this->_try(fn() => Consents::history($this->_client(), (string)$this->request->getQuery('subjectId')));
    }

    // ── Admin: data requests ────────────────────────────────────────────────

    public function requests()
    {
        $this->request->allowMethod(['get']);
        if (!$this->isAdmin()) {
            return $this->_forbidden();
        }
        PrivacyRequests::runDue($this->_client());   // finish deletions whose 7 days have passed

        return $this->_try(fn() => ['requests' => PrivacyRequests::list($this->_client(), (string)($this->request->getQuery('status') ?: 'open')),
            'is_owner' => $this->_isOwner()]);
    }

    public function openCount()
    {
        $this->request->allowMethod(['get']);
        if (!$this->isAdmin()) {
            return $this->_out(['status' => true, 'data' => ['open' => 0]]);
        }

        return $this->_try(fn() => ['open' => PrivacyRequests::openCount($this->_client())]);
    }

    public function logRequest()
    {
        $this->request->allowMethod(['post']);
        if (!in_array($this->_role(), PrivacyRequests::ADMINS, true)) {
            return $this->_forbidden('Only the owner or an admin can log a request received by e-mail or on paper.');
        }

        return $this->_try(function () {
            $d = (array)$this->request->getData();
            $d['channel'] = 'office';
            $r = PrivacyRequests::create($this->_client(), $this->_user(), $this->_role(), $d);
            $this->_audit('privacy.request', ['category' => 'privacy', 'entity_type' => $r['subject_type'], 'entity_id' => $r['subject_id'],
                'summary' => ucfirst($r['type']) . ' request logged by the office for ' . $r['subject_name'] . ' (#' . $r['id'] . ')']);

            return $r;
        });
    }

    public function plan()
    {
        $this->request->allowMethod(['get']);
        if (!$this->isAdmin()) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => PrivacyRequests::plan($this->_client(), (int)$this->request->getQuery('id')) + ['is_owner' => $this->_isOwner()]);
    }

    public function setStatus()
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdmin()) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $d = (array)$this->request->getData();
            $r = PrivacyRequests::setStatus($this->_client(), (int)($d['id'] ?? 0), (string)($d['status'] ?? ''), $this->_user(),
                isset($d['note']) ? (string)$d['note'] : null);
            $this->_audit('privacy.' . $r['status'], ['category' => 'privacy', 'entity_type' => $r['subject_type'], 'entity_id' => $r['subject_id'],
                'summary' => ucfirst($r['type']) . ' request #' . $r['id'] . ' → ' . str_replace('_', ' ', $r['status'])
                    . ($r['decision_note'] ? ' · ' . mb_substr((string)$r['decision_note'], 0, 80) : '')]);

            return $r;
        });
    }

    public function approveDelete()
    {
        $this->request->allowMethod(['post']);
        if (!$this->_isOwner()) {
            return $this->_forbidden('Only the school owner can approve a deletion.');
        }

        return $this->_try(function () {
            $this->_stepUp($this->request->getData('code'));
            $r = PrivacyRequests::approveDelete($this->_client(), (int)$this->request->getData('id'), $this->_user());
            $this->_audit('privacy.deletion_approved', ['category' => 'privacy', 'entity_type' => $r['subject_type'], 'entity_id' => $r['subject_id'],
                'summary' => 'Deletion approved for ' . $r['subject_name'] . ' · runs ' . substr((string)$r['delete_after'], 0, 10) . ' unless cancelled']);

            return $r;
        });
    }
}
