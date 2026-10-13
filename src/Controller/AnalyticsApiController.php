<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Analytics;

/**
 * AnalyticsApi – the school dashboard: attendance trends, at-risk students, fee collection
 * against what is due and the school's targets, and class performance (JWT protected, app only).
 *
 * Every GET takes the same filters: session_id, class_id, section_id, branch_id, from, to (YYYY-MM-DD), exam_id.
 *   GET  /AnalyticsApi/filters       sessions, classes in scope, branches, what this person can see
 *   GET  /AnalyticsApi/overview      headline figures
 *   GET  /AnalyticsApi/attendance    daily / weekly trend, by class, by weekday, low attendance
 *   GET  /AnalyticsApi/atRisk        students needing attention, with reasons
 *   GET  /AnalyticsApi/fees          monthly due vs collected vs target, by class, by method, top owing
 *   GET  /AnalyticsApi/performance   class comparison, subjects, trend across exams
 *   GET  /AnalyticsApi/settings      thresholds + this session's monthly targets
 *   POST /AnalyticsApi/saveSettings  { session_id?, settings?: {...}, targets?: {"2026-04": 150000, …} }
 *   GET  /AnalyticsApi/exportAtRisk  CSV (Reports & analytics · export)
 */
class AnalyticsApiController extends AppController
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

    /** Anything printed by mistake (a notice, a stray echo) would break the JSON – drop it and log it. */
    private function cleanBuffer(): void
    {
        if ($this->bufLevel !== null && ob_get_level() >= $this->bufLevel) {
            while (ob_get_level() > $this->bufLevel) {
                ob_end_flush();
            }
            $stray = (string)ob_get_clean();
            $this->bufLevel = null;
            if (trim($stray) !== '') {
                \Cake\Log\Log::warning('AnalyticsApi: unexpected output removed from reply: ' . mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($stray))), 0, 1000));
            }
        }
    }

    protected function _out(array $data, int $status = 200)
    {
        $this->cleanBuffer();

        return $this->_traitOut($data, $status);
    }

    private function ctx(?array $f = null): array
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app for reports & analytics.');
        }
        $q = $f ?? $this->request->getQueryParams();
        $pick = [];
        foreach (['session_id', 'class_id', 'section_id', 'branch_id', 'from', 'to', 'exam_id'] as $k) {
            if (isset($q[$k]) && is_scalar($q[$k]) && (string)$q[$k] !== '') {
                $pick[$k] = (string)$q[$k];
            }
        }

        return Analytics::context($this->_client(), ['user' => $this->_user(), 'role' => $this->_role(),
            'custom_role' => $this->request->getAttribute('jwt_custom_role')], $pick);
    }

    private function serve(callable $fn)
    {
        $this->request->allowMethod(['get']);
        @set_time_limit(60);

        return $this->_try(fn() => $fn($this->ctx()));
    }

    public function filters()
    {
        return $this->serve(fn($c) => Analytics::filters($c));
    }

    public function overview()
    {
        return $this->serve(fn($c) => Analytics::overview($c) + ['can' => $c['can'], 'from' => $c['from'], 'to' => $c['to'], 'today' => $c['today']]);
    }

    public function attendance()
    {
        return $this->serve(fn($c) => Analytics::attendance($c) + ['from' => $c['from'], 'to' => $c['to'], 'settings' => $c['settings']]);
    }

    public function atRisk()
    {
        return $this->serve(fn($c) => Analytics::atRisk($c) + ['can' => $c['can'], 'from' => $c['from'], 'to' => $c['to']]);
    }

    public function fees()
    {
        return $this->serve(fn($c) => Analytics::fees($c) + ['from' => $c['from'], 'to' => $c['to'], 'can_edit' => $c['can']['edit']]);
    }

    public function performance()
    {
        return $this->serve(fn($c) => Analytics::performance($c));
    }

    public function settings()
    {
        return $this->serve(fn($c) => ['settings' => $c['settings'], 'defaults' => Analytics::DEFAULTS, 'limits' => Analytics::LIMITS,
            'targets' => $c['can']['fees'] ? (object)Analytics::targets($c['client'], (int)$c['session_id']) : null,
            'session_id' => $c['session_id'], 'sessions' => $c['sessions'], 'can' => $c['can'], 'from' => $c['from'], 'to' => $c['to'], 'session_start' => $c['session_start'],
            'currency' => $c['can']['fees'] ? Analytics::currency($c['client']) : null]);
    }

    public function saveSettings()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $d = (array)$this->request->getData();
            $c = $this->ctx(['session_id' => $d['session_id'] ?? null]);
            $before = $c['settings'];
            $res = Analytics::saveSettings($c, $d);
            if ($res['changed']) {
                $diff = [];
                foreach ($res['settings'] as $k => $v) {
                    if (($before[$k] ?? null) !== $v) {
                        $diff[$k] = ['from' => $before[$k] ?? null, 'to' => $v];
                    }
                }
                if (in_array('targets', $res['changed'], true)) {
                    $diff['targets'] = ['session_id' => $c['session_id'], 'months' => count($res['targets'])];
                }
                $this->_audit('analytics.settings_changed', ['category' => 'settings', 'entity_type' => 'analytics_settings', 'entity_id' => $this->_client(),
                    'summary' => 'Analytics thresholds / collection targets changed', 'changes' => $diff]);
            }
            $res['targets'] = (object)$res['targets'];

            return $res;
        });
    }

    public function exportAtRisk()
    {
        $this->request->allowMethod(['get']);
        try {
            $c = $this->ctx();
            $csv = Analytics::atRiskCsv($c);
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            \Cake\Log\Log::error(static::class . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());

            return $this->_out(['status' => false, 'message' => 'Something went wrong. Please try again.'], 500);
        }
        $this->_audit('analytics.exported', ['category' => 'privacy', 'entity_type' => 'analytics', 'summary' => 'At-risk students list exported (CSV)',
            'changes' => array_intersect_key($c, array_flip(['session_id', 'class_id', 'section_id', 'branch_id', 'from', 'to']))]);
        $this->cleanBuffer();
        $this->autoRender = false;

        return $this->response->withType('text/csv')
            ->withHeader('Content-Disposition', 'attachment; filename="at-risk-students-' . $c['today'] . '.csv"')
            ->withStringBody($csv);
    }
}
