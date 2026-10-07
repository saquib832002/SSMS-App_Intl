<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinPayrollController extends AppController
{
    public function initialize(): void { parent::initialize(); $this->loadComponent('Flash'); }
    private function db()   { return ConnectionManager::get('default'); }
    private function code() { return $this->request->getSession()->read('ssms_client_code'); }
    private function user() { return $this->request->getSession()->read('ssms_user_name') ?? 'system'; }

    private function isOwner(): bool
    {
        return strtolower((string)$this->request->getSession()->read('ssms_user_role')) === 'owner';
    }

    private function currentFy(): ?array
    {
        return $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code=? AND is_current=1 LIMIT 1",
            [$this->code()]
        )->fetch('assoc') ?: null;
    }

    private function postJournal(array $h, array $lines): int
    {
        $db = $this->db();
        $db->execute(
            "INSERT INTO fin_journal_entries (ssms_client_code,fy_id,journal_date,reference_no,description,source_type,source_id,status,created_by)
             VALUES (?,?,?,?,?,?,?,'posted',?)",
            [$this->code(),$h['fy_id'],$h['date'],$h['ref'],$h['description'],$h['source_type'],$h['source_id']??null,$this->user()]
        );
        $jid = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
        foreach ($lines as $l) {
            $db->execute(
                "INSERT INTO fin_journal_lines (journal_id,account_id,debit_amount,credit_amount,narration) VALUES (?,?,?,?,?)",
                [$jid,$l['account_id'],$l['debit']??0,$l['credit']??0,$l['narration']??null]
            );
        }
        return $jid;
    }

    // ─────────────────────────────────────────────────────────────────────
    // SALARY STRUCTURES
    // ─────────────────────────────────────────────────────────────────────

    public function salaryStructures()
    {
        $structures = $this->db()->execute(
            "SELECT ss.*
             FROM fin_salary_structures ss
             WHERE ss.ssms_client_code=?
             ORDER BY ss.department, ss.staff_name",
            [$this->code()]
        )->fetchAll('assoc');

        $totalGross = array_sum(array_column($structures,'basic')) +
                      array_sum(array_column($structures,'hra'))   +
                      array_sum(array_column($structures,'da'))    +
                      array_sum(array_column($structures,'other_allowances'));
        $this->set(compact('structures','totalGross'));
    }

    public function addSalaryStructure()
    {
        $staff = $this->db()->execute(
            "SELECT s.staff_id,
                    CONCAT(s.first_name,' ',s.last_name) AS full_name,
                    s.specialty AS designation,
                    sc.category_name AS department
             FROM ssms_staff s
             LEFT JOIN staff_category sc ON sc.category_id=s.category_id AND sc.ssms_client_code=s.ssms_client_code
             WHERE s.ssms_client_code=? AND (s.hired IS NULL OR s.hired != 'yes') AND (s.resigned IS NULL OR s.resigned = 'no')
             ORDER BY s.first_name, s.last_name",
            [$this->code()]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $basic = (float)($d['basic'] ?? 0);
            if ($basic <= 0) {
                $this->Flash->error('Basic salary must be greater than zero.');
            } else {
                // Upsert — delete old inactive if exists for this staff
                $this->db()->execute(
                    "DELETE FROM fin_salary_structures WHERE ssms_client_code=? AND staff_id=?",
                    [$this->code(), $d['staff_id']]
                );
                $this->db()->execute(
                    "INSERT INTO fin_salary_structures
                     (ssms_client_code,staff_id,staff_name,designation,department,
                      basic,hra,da,other_allowances,
                      pf_applicable,pf_employee_pct,pf_employer_pct,
                      esi_applicable,esi_employee_pct,esi_employer_pct,
                      tds_monthly,professional_tax,
                      bank_account_no,bank_ifsc,bank_name,
                      effective_from,notes,created_by)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [
                        $this->code(), $d['staff_id'], $d['staff_name'], $d['designation']??null, $d['department']??null,
                        $basic, (float)($d['hra']??0), (float)($d['da']??0), (float)($d['other_allowances']??0),
                        (int)($d['pf_applicable']??1), (float)($d['pf_employee_pct']??12), (float)($d['pf_employer_pct']??12),
                        (int)($d['esi_applicable']??0), (float)($d['esi_employee_pct']??0.75), (float)($d['esi_employer_pct']??3.25),
                        (float)($d['tds_monthly']??0), (float)($d['professional_tax']??200),
                        $d['bank_account_no']??null, $d['bank_ifsc']??null, $d['bank_name']??null,
                        $d['effective_from'] ?? date('Y-m-01'),
                        $d['notes']??null, $this->user()
                    ]
                );
                $this->Flash->success('Salary structure saved.');
                return $this->redirect(['action'=>'salaryStructures']);
            }
        }
        $this->set(compact('staff'));
    }

    public function editSalaryStructure(int $id)
    {
        $structure = $this->db()->execute(
            "SELECT * FROM fin_salary_structures WHERE structure_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$structure) { $this->Flash->error('Record not found.'); return $this->redirect(['action'=>'salaryStructures']); }

        if ($this->request->is(['post','put'])) {
            $d = $this->request->getData();
            $this->db()->execute(
                "UPDATE fin_salary_structures SET
                 staff_name=?,designation=?,department=?,
                 basic=?,hra=?,da=?,other_allowances=?,
                 pf_applicable=?,pf_employee_pct=?,pf_employer_pct=?,
                 esi_applicable=?,esi_employee_pct=?,esi_employer_pct=?,
                 tds_monthly=?,professional_tax=?,
                 bank_account_no=?,bank_ifsc=?,bank_name=?,
                 effective_from=?,notes=?,modified=NOW()
                 WHERE structure_id=? AND ssms_client_code=?",
                [
                    $d['staff_name'], $d['designation']??null, $d['department']??null,
                    (float)($d['basic']??0), (float)($d['hra']??0), (float)($d['da']??0), (float)($d['other_allowances']??0),
                    (int)($d['pf_applicable']??1), (float)($d['pf_employee_pct']??12), (float)($d['pf_employer_pct']??12),
                    (int)($d['esi_applicable']??0), (float)($d['esi_employee_pct']??0.75), (float)($d['esi_employer_pct']??3.25),
                    (float)($d['tds_monthly']??0), (float)($d['professional_tax']??200),
                    $d['bank_account_no']??null, $d['bank_ifsc']??null, $d['bank_name']??null,
                    $d['effective_from'] ?? $structure['effective_from'],
                    $d['notes']??null,
                    $id, $this->code()
                ]
            );
            $this->Flash->success('Salary structure updated.');
            return $this->redirect(['action'=>'salaryStructures']);
        }
        $this->set(compact('structure'));
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADVANCES
    // ─────────────────────────────────────────────────────────────────────

    public function advances()
    {
        $advances = $this->db()->execute(
            "SELECT a.*, ss.staff_name
             FROM fin_staff_advances a
             LEFT JOIN fin_salary_structures ss ON ss.staff_id=a.staff_id AND ss.ssms_client_code=a.ssms_client_code
             WHERE a.ssms_client_code=? ORDER BY a.created DESC",
            [$this->code()]
        )->fetchAll('assoc');
        $this->set(compact('advances'));
    }

    public function addAdvance()
    {
        $staff = $this->db()->execute(
            "SELECT structure_id, staff_id, staff_name FROM fin_salary_structures
             WHERE ssms_client_code=? ORDER BY staff_name",
            [$this->code()]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $amount = (float)($d['advance_amount'] ?? 0);
            if ($amount <= 0) {
                $this->Flash->error('Advance amount must be greater than zero.');
            } else {
                $this->db()->execute(
                    "INSERT INTO fin_staff_advances
                     (ssms_client_code,staff_id,advance_date,advance_amount,monthly_deduction,balance_remaining,reason,created_by)
                     VALUES (?,?,?,?,?,?,?,?)",
                    [$this->code(), $d['staff_id'], $d['advance_date'], $amount,
                     (float)($d['monthly_deduction']??0), $amount,
                     $d['reason']??null, $this->user()]
                );
                $this->Flash->success('Advance recorded.');
                return $this->redirect(['action'=>'advances']);
            }
        }
        $this->set(compact('staff'));
    }

    // ─────────────────────────────────────────────────────────────────────
    // PAYROLL RUNS
    // ─────────────────────────────────────────────────────────────────────

    public function index()
    {
        $fy   = $this->currentFy();
        $runs = $this->db()->execute(
            "SELECT * FROM fin_payroll_runs WHERE ssms_client_code=? ORDER BY pay_month DESC",
            [$this->code()]
        )->fetchAll('assoc');
        $this->set(compact('runs','fy'));
    }

    public function processPayroll()
    {
        $fy = $this->currentFy();
        if (!$fy) {
            $this->Flash->error('No active fiscal year.');
            return $this->redirect(['action'=>'index']);
        }

        $structures = $this->db()->execute(
            "SELECT * FROM fin_salary_structures WHERE ssms_client_code=? ORDER BY staff_name",
            [$this->code()]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $payMonth = $d['pay_month']; // e.g. 2026-07-01
            $label    = $d['run_label'] ?? date('F Y', strtotime($payMonth)) . ' Payroll';

            // Check for duplicate
            $existing = $this->db()->execute(
                "SELECT run_id FROM fin_payroll_runs WHERE ssms_client_code=? AND pay_month=?",
                [$this->code(), $payMonth]
            )->fetch('assoc');
            if ($existing) {
                $this->Flash->error("Payroll for " . date('F Y', strtotime($payMonth)) . " has already been processed.");
            } else {
                $db           = $this->db();
                $totalGross   = 0;
                $totalDed     = 0;
                $totalNet     = 0;
                $staffCount   = 0;
                $payrollLines = [];

                // Working days for the month
                $workingDays = (int)($d['working_days'] ?? 26);

                foreach ($structures as $s) {
                    $staffId    = $s['staff_id'];
                    $daysPresent = (int)($d['attendance'][$staffId] ?? $workingDays);
                    $ratio       = $workingDays > 0 ? $daysPresent / $workingDays : 1;

                    // Gross components (pro-rated by attendance)
                    $basic     = round((float)$s['basic']           * $ratio, 2);
                    $hra       = round((float)$s['hra']             * $ratio, 2);
                    $da        = round((float)$s['da']              * $ratio, 2);
                    $otherAlw  = round((float)$s['other_allowances']* $ratio, 2);
                    $gross     = $basic + $hra + $da + $otherAlw;

                    // PF
                    $pfEmp = $pfEmr = 0;
                    if ($s['pf_applicable']) {
                        $pfEmp = round($basic * (float)$s['pf_employee_pct'] / 100, 2);
                        $pfEmr = round($basic * (float)$s['pf_employer_pct'] / 100, 2);
                    }

                    // ESI (only if gross ≤ 21000)
                    $esiEmp = $esiEmr = 0;
                    if ($s['esi_applicable'] && $gross <= 21000) {
                        $esiEmp = round($gross * (float)$s['esi_employee_pct'] / 100, 2);
                        $esiEmr = round($gross * (float)$s['esi_employer_pct'] / 100, 2);
                    }

                    $tds  = (float)$s['tds_monthly'];
                    $pt   = (float)$s['professional_tax'];

                    // Advance deduction — pick oldest active advance
                    $advDed = 0;
                    $advance = $db->execute(
                        "SELECT * FROM fin_staff_advances WHERE ssms_client_code=? AND staff_id=? AND status='active' ORDER BY advance_date ASC LIMIT 1",
                        [$this->code(), $staffId]
                    )->fetch('assoc');
                    if ($advance) {
                        $advDed = min((float)$advance['monthly_deduction'], (float)$advance['balance_remaining']);
                    }

                    $totalDedLocal = $pfEmp + $esiEmp + $tds + $pt + $advDed;
                    $net           = round($gross - $totalDedLocal, 2);

                    $totalGross += $gross;
                    $totalDed   += $totalDedLocal;
                    $totalNet   += $net;
                    $staffCount++;

                    $payrollLines[] = [
                        'staff_id'         => $staffId,
                        'staff_name'       => $s['staff_name'],
                        'designation'      => $s['designation'],
                        'department'       => $s['department'],
                        'working_days'     => $workingDays,
                        'days_present'     => $daysPresent,
                        'basic'            => $basic,
                        'hra'              => $hra,
                        'da'               => $da,
                        'other_allowances' => $otherAlw,
                        'gross_pay'        => $gross,
                        'pf_employee'      => $pfEmp,
                        'pf_employer'      => $pfEmr,
                        'esi_employee'     => $esiEmp,
                        'esi_employer'     => $esiEmr,
                        'tds'              => $tds,
                        'professional_tax' => $pt,
                        'advance_deduction'=> $advDed,
                        'total_deductions' => $totalDedLocal,
                        'net_pay'          => $net,
                        'bank_account_no'  => $s['bank_account_no'],
                        'bank_ifsc'        => $s['bank_ifsc'],
                        'bank_name'        => $s['bank_name'],
                        'advance_id'       => $advance['advance_id'] ?? null,
                    ];
                }

                // Insert run header
                $runLabel = $label;
                $db->execute(
                    "INSERT INTO fin_payroll_runs (ssms_client_code,fy_id,pay_month,run_label,total_gross,total_deductions,total_net_pay,staff_count,status,processed_by)
                     VALUES (?,?,?,?,?,?,?,?,'draft',?)",
                    [$this->code(),$fy['fy_id'],$payMonth,$runLabel,$totalGross,$totalDed,$totalNet,$staffCount,$this->user()]
                );
                $runId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

                // Insert individual slips
                $slipSeq = 1;
                foreach ($payrollLines as $line) {
                    $slipNo = 'SLIP-' . date('Ym', strtotime($payMonth)) . '-' . str_pad((string)$slipSeq, 3, '0', STR_PAD_LEFT);
                    $db->execute(
                        "INSERT INTO fin_payroll
                         (ssms_client_code,run_id,staff_id,staff_name,designation,department,pay_month,
                          working_days,days_present,basic,hra,da,other_allowances,gross_pay,
                          pf_employee,pf_employer,esi_employee,esi_employer,tds,professional_tax,
                          advance_deduction,total_deductions,net_pay,bank_account_no,bank_ifsc,bank_name,slip_no)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        [
                            $this->code(),$runId,$line['staff_id'],$line['staff_name'],$line['designation'],$line['department'],$payMonth,
                            $line['working_days'],$line['days_present'],$line['basic'],$line['hra'],$line['da'],$line['other_allowances'],$line['gross_pay'],
                            $line['pf_employee'],$line['pf_employer'],$line['esi_employee'],$line['esi_employer'],$line['tds'],$line['professional_tax'],
                            $line['advance_deduction'],$line['total_deductions'],$line['net_pay'],
                            $line['bank_account_no'],$line['bank_ifsc'],$line['bank_name'],$slipNo
                        ]
                    );
                    // Reduce advance balance
                    if ($line['advance_id'] && $line['advance_deduction'] > 0) {
                        $db->execute(
                            "UPDATE fin_staff_advances SET balance_remaining = balance_remaining - ?,
                             status = IF(balance_remaining - ? <= 0,'closed','active')
                             WHERE advance_id=?",
                            [$line['advance_deduction'], $line['advance_deduction'], $line['advance_id']]
                        );
                    }
                    $slipSeq++;
                }

                $this->Flash->success("Payroll processed for $staffCount staff. Total net pay: ₹" . number_format($totalNet,2) . ". Review and approve to post journal.");
                return $this->redirect(['action'=>'view',$runId]);
            }
        }

        $this->set(compact('fy','structures'));
    }

    public function view(int $id)
    {
        $run = $this->db()->execute(
            "SELECT * FROM fin_payroll_runs WHERE run_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$run) { $this->Flash->error('Payroll run not found.'); return $this->redirect(['action'=>'index']); }

        $slips = $this->db()->execute(
            "SELECT * FROM fin_payroll WHERE run_id=? ORDER BY department, staff_name",
            [$id]
        )->fetchAll('assoc');

        $isOwner = $this->isOwner();
        $this->set(compact('run','slips','isOwner'));
    }

    public function approve(int $id)
    {
        if (!$this->isOwner()) {
            $this->Flash->error('Only the Owner can approve payroll.');
            return $this->redirect(['action'=>'view',$id]);
        }
        $this->request->allowMethod(['post']);

        $run = $this->db()->execute(
            "SELECT * FROM fin_payroll_runs WHERE run_id=? AND ssms_client_code=? AND status='draft'",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$run) { $this->Flash->error('Run not found or already processed.'); return $this->redirect(['action'=>'index']); }

        $fy = $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE fy_id=? AND ssms_client_code=?",
            [$run['fy_id'], $this->code()]
        )->fetch('assoc');
        if (!$fy || $fy['is_locked']) {
            $this->Flash->error('Fiscal year is locked. Cannot post journal.');
            return $this->redirect(['action'=>'view',$id]);
        }

        $slips = $this->db()->execute(
            "SELECT * FROM fin_payroll WHERE run_id=?", [$id]
        )->fetchAll('assoc');

        // Get salary expense and PF/ESI liability account IDs
        $salaryAcct  = $this->getCoa('salary_expense');
        $pfAcct      = $this->getCoa('pf_payable');
        $esiAcct     = $this->getCoa('esi_payable');
        $ptAcct      = $this->getCoa('pt_payable');
        $tdsAcct     = $this->getCoa('tds_payable');
        $bankAcct    = $this->getCoa('payroll_bank');

        // Build journal: DR Salary Expense (gross), CR Bank (net pays), CR Liabilities (deductions)
        $totalGross = (float)$run['total_gross'];
        $totalNet   = (float)$run['total_net_pay'];
        $totalPfEmp = array_sum(array_column($slips,'pf_employee'));
        $totalPfEmr = array_sum(array_column($slips,'pf_employer'));
        $totalEsiEmp= array_sum(array_column($slips,'esi_employee'));
        $totalEsiEmr= array_sum(array_column($slips,'esi_employer'));
        $totalTds   = array_sum(array_column($slips,'tds'));
        $totalPt    = array_sum(array_column($slips,'professional_tax'));
        $totalAdv   = array_sum(array_column($slips,'advance_deduction'));

        $jLines = [];

        if ($salaryAcct) {
            $jLines[] = ['account_id'=>$salaryAcct,'debit'=>$totalGross,'credit'=>0,'narration'=>$run['run_label'].' — Salary Expense'];
            // Employer contributions also DR expense
            if ($totalPfEmr > 0 && $pfAcct) {
                $jLines[] = ['account_id'=>$salaryAcct,'debit'=>$totalPfEmr,'credit'=>0,'narration'=>'Employer PF Contribution'];
            }
            if ($totalEsiEmr > 0 && $esiAcct) {
                $jLines[] = ['account_id'=>$salaryAcct,'debit'=>$totalEsiEmr,'credit'=>0,'narration'=>'Employer ESI Contribution'];
            }
        }
        if ($bankAcct && $totalNet > 0) {
            $jLines[] = ['account_id'=>$bankAcct,'debit'=>0,'credit'=>$totalNet,'narration'=>'Net Salary Payout'];
        }
        if ($pfAcct && ($totalPfEmp+$totalPfEmr) > 0) {
            $jLines[] = ['account_id'=>$pfAcct,'debit'=>0,'credit'=>$totalPfEmp+$totalPfEmr,'narration'=>'PF Payable (Employee+Employer)'];
        }
        if ($esiAcct && ($totalEsiEmp+$totalEsiEmr) > 0) {
            $jLines[] = ['account_id'=>$esiAcct,'debit'=>0,'credit'=>$totalEsiEmp+$totalEsiEmr,'narration'=>'ESI Payable (Employee+Employer)'];
        }
        if ($tdsAcct && $totalTds > 0) {
            $jLines[] = ['account_id'=>$tdsAcct,'debit'=>0,'credit'=>$totalTds,'narration'=>'TDS Payable'];
        }
        if ($ptAcct && $totalPt > 0) {
            $jLines[] = ['account_id'=>$ptAcct,'debit'=>0,'credit'=>$totalPt,'narration'=>'Professional Tax Payable'];
        }
        // Advance recoveries reduce advance receivable (asset)
        $advAsset = $this->getCoa('advance_receivable');
        if ($advAsset && $totalAdv > 0) {
            $jLines[] = ['account_id'=>$advAsset,'debit'=>0,'credit'=>$totalAdv,'narration'=>'Advance Recovery'];
        }

        $ref = 'PAY-' . date('Ym', strtotime($run['pay_month']));
        $jid = !empty($jLines) ? $this->postJournal(
            ['fy_id'=>$run['fy_id'],'date'=>date('Y-m-t', strtotime($run['pay_month'])),
             'ref'=>$ref,'description'=>$run['run_label'],'source_type'=>'payroll','source_id'=>$id],
            $jLines
        ) : null;

        $this->db()->execute(
            "UPDATE fin_payroll_runs SET status='approved', journal_id=?, approved_by=?, approved_at=NOW() WHERE run_id=?",
            [$jid, $this->user(), $id]
        );

        // Auto-insert into fin_expenses so payroll appears on the finance dashboard
        // and in budget vs actual reports. Inserted as 'approved' since the run is approved.
        if ($salaryAcct) {
            $expenseDate = date('Y-m-t', strtotime($run['pay_month'])); // last day of pay month
            $totalSalaryExpense = $totalGross + $totalPfEmr + $totalEsiEmr;
            $this->db()->execute(
                "INSERT INTO fin_expenses
                 (ssms_client_code, fy_id, expense_date, expense_type, account_id,
                  amount, payee_name, description, payment_mode, reference_no,
                  voucher_no, status, created_by)
                 VALUES (?,?,?,'Salary',?,?,?,?,'Bank Transfer',?,?,'approved',?)",
                [
                    $this->code(), $run['fy_id'], $expenseDate, $salaryAcct,
                    $totalSalaryExpense,
                    'Staff Payroll — ' . $run['staff_count'] . ' staff',
                    $run['run_label'],
                    $ref,
                    $ref,
                    $this->user(),
                ]
            );
        }

        $this->Flash->success("Payroll approved. Journal posted as $ref.");
        return $this->redirect(['action'=>'view',$id]);
    }

    public function salarySlip(int $payrollId)
    {
        $slip = $this->db()->execute(
            "SELECT p.*, r.run_label, r.pay_month AS run_month
             FROM fin_payroll p JOIN fin_payroll_runs r ON r.run_id=p.run_id
             WHERE p.payroll_id=? AND p.ssms_client_code=?",
            [$payrollId, $this->code()]
        )->fetch('assoc');
        if (!$slip) { $this->Flash->error('Slip not found.'); return $this->redirect(['action'=>'index']); }

        $school = $this->db()->execute(
            "SELECT * FROM ssms_clients WHERE ssms_client_code=? LIMIT 1",
            [$this->code()]
        )->fetch('assoc');

        $this->set(compact('slip','school'));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Resolve a known account role to its account_id in this client's COA.
     * Falls back to null if not seeded (journal will still be built, minus that line).
     */
    private function getCoa(string $role): ?int
    {
        // Map role → account_name fragment to search
        $map = [
            'salary_expense'    => ['account_type'=>'expense', 'name_like'=>'%salary%'],
            'pf_payable'        => ['account_type'=>'liability','name_like'=>'%provident%'],
            'esi_payable'       => ['account_type'=>'liability','name_like'=>'%esi%'],
            'pt_payable'        => ['account_type'=>'liability','name_like'=>'%professional tax%'],
            'tds_payable'       => ['account_type'=>'liability','name_like'=>'%tds%'],
            'payroll_bank'      => ['account_type'=>'asset',    'name_like'=>'%bank%'],
            'advance_receivable'=> ['account_type'=>'asset',    'name_like'=>'%advance%'],
        ];
        if (!isset($map[$role])) return null;
        $m = $map[$role];
        $row = $this->db()->execute(
            "SELECT account_id FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_type=? AND account_name LIKE ? AND is_active=1
             LIMIT 1",
            [$this->code(), $m['account_type'], $m['name_like']]
        )->fetch('assoc');
        return $row ? (int)$row['account_id'] : null;
    }
}
