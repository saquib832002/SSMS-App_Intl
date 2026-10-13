<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Audit;

/**
 * AuditApi – read-only audit log (JWT protected). There is no edit or delete.
 *
 *   GET /AuditApi/list?from=&to=&actor=&category=&q=&page=   (owner, or "Privacy & audit · view")
 *   GET /AuditApi/entry?id=
 *   GET /AuditApi/verify                                      re-check the hash chain
 *   GET /AuditApi/export?…same filters                        CSV (owner, or "Privacy & audit · export")
 */
class AuditApiController extends AppController
{
    use SecurityApiTrait;

    public function list()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_can('privacy', 'view')) {
            return $this->_forbidden('Only the owner (or people given "Privacy & audit") can see the audit log.');
        }

        return $this->_try(fn() => Audit::list($this->_client(), $this->request->getQueryParams()) + [
            'can_export' => $this->_can('privacy', 'export'),
            'categories' => Audit::CATEGORIES,
        ]);
    }

    public function entry()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_can('privacy', 'view')) {
            return $this->_forbidden();
        }

        return $this->_try(function () {
            $e = Audit::get($this->_client(), (int)$this->request->getQuery('id'));
            if (!$e) {
                throw new \InvalidArgumentException('Entry not found.');
            }

            return $e;
        });
    }

    public function verify()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_can('privacy', 'view')) {
            return $this->_forbidden();
        }

        return $this->_try(fn() => Audit::verify($this->_client()));
    }

    public function export()
    {
        $this->request->allowMethod(['get']);
        if (!$this->_can('privacy', 'export')) {
            return $this->_forbidden('Only the owner (or people given "Privacy & audit · export") can export the audit log.');
        }
        $f   = $this->request->getQueryParams();
        $csv = Audit::csv($this->_client(), $f);
        $this->_audit('audit.exported', ['category' => 'privacy', 'summary' => 'Audit log exported (CSV)', 'changes' => array_intersect_key($f, array_flip(['from', 'to', 'actor', 'category', 'q']))]);
        $this->autoRender = false;

        return $this->response->withType('text/csv')
            ->withHeader('Content-Disposition', 'attachment; filename="audit-log-' . $this->schoolToday() . '.csv"')
            ->withStringBody($csv);
    }
}
