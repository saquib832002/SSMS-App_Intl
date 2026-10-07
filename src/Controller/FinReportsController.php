<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinReportsController extends AppController
{
    public function initialize(): void { parent::initialize(); $this->loadComponent('Flash'); }
    private function db()   { return ConnectionManager::get('default'); }
    private function code() { return $this->request->getSession()->read('ssms_client_code'); }

    private function currentFy(): ?array
    {
        return $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code=? AND is_current=1 LIMIT 1",
            [$this->code()]
        )->fetch('assoc') ?: null;
    }

    /**
     * Day Book — all journal entries for a date range, with lines expanded
     */
    public function daybook()
    {
        $fy          = $this->currentFy();
        $from        = $this->request->getQuery('from', $fy ? $fy['start_date'] : date('Y-m-01'));
        $to          = $this->request->getQuery('to',   date('Y-m-d'));
        $showVoids   = (bool)$this->request->getQuery('show_voids', 0);

        // show_voids controls only the reversal journal (source_type='income_void')
        // The original income journal always shows — marked as voided via LEFT JOIN
        $voidFilter = $showVoids ? '' : "AND je.source_type != 'income_void'";

        $entries = $this->db()->execute(
            "SELECT je.journal_id, je.journal_date, je.reference_no, je.description,
                    je.source_type, je.status,
                    jl.line_id, jl.account_id, jl.debit_amount, jl.credit_amount, jl.narration,
                    a.account_code, a.account_name,
                    CASE WHEN fi.status='voided' THEN 1 ELSE 0 END AS is_voided_income
             FROM fin_journal_entries je
             JOIN fin_journal_lines jl ON jl.journal_id = je.journal_id
             JOIN fin_chart_of_accounts a ON a.account_id = jl.account_id
             LEFT JOIN fin_income fi ON fi.journal_id = je.journal_id
                   AND fi.ssms_client_code = je.ssms_client_code
             WHERE je.ssms_client_code=? AND je.journal_date BETWEEN ? AND ? $voidFilter
             ORDER BY je.journal_date ASC, je.journal_id ASC, jl.debit_amount DESC",
            [$this->code(), $from, $to]
        )->fetchAll('assoc');

        // Group lines under each journal entry
        $journals = [];
        foreach ($entries as $row) {
            $jid = $row['journal_id'];
            if (!isset($journals[$jid])) {
                $journals[$jid] = [
                    'journal_id'       => $jid,
                    'journal_date'     => $row['journal_date'],
                    'reference_no'     => $row['reference_no'],
                    'description'      => $row['description'],
                    'source_type'      => $row['source_type'],
                    'status'           => $row['status'],
                    'is_voided_income' => (bool)$row['is_voided_income'],
                    'lines'            => [],
                    'total_debit'      => 0,
                    'total_credit'     => 0,
                ];
            }
            $journals[$jid]['lines'][] = $row;
            $journals[$jid]['total_debit']  += (float)$row['debit_amount'];
            $journals[$jid]['total_credit'] += (float)$row['credit_amount'];
        }

        $totalDebit  = array_sum(array_column($journals, 'total_debit'));
        $totalCredit = array_sum(array_column($journals, 'total_credit'));

        $this->set(compact('journals','from','to','fy','totalDebit','totalCredit','showVoids'));
    }

    /**
     * Ledger — running balance for a specific account
     */
    public function ledger()
    {
        $fy   = $this->currentFy();
        $from = $this->request->getQuery('from', $fy ? $fy['start_date'] : date('Y-m-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));
        $accountId = (int)$this->request->getQuery('account_id', 0);

        // All COA accounts for dropdown
        $accounts = $this->db()->execute(
            "SELECT account_id, account_code, account_name, account_type, normal_balance
             FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND is_active=1 ORDER BY account_type, account_code",
            [$this->code()]
        )->fetchAll('assoc');

        $ledger  = [];
        $account = null;
        $openingBalance = 0;

        if ($accountId) {
            $account = $this->db()->execute(
                "SELECT * FROM fin_chart_of_accounts WHERE account_id=? AND ssms_client_code=?",
                [$accountId, $this->code()]
            )->fetch('assoc');

            if ($account && $fy) {
                // Opening balance = net movement before $from within this FY
                $ob = $this->db()->execute(
                    "SELECT COALESCE(SUM(jl.debit_amount),0) AS dr, COALESCE(SUM(jl.credit_amount),0) AS cr
                     FROM fin_journal_lines jl
                     JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
                     WHERE jl.account_id=? AND je.ssms_client_code=? AND je.journal_date >= ? AND je.journal_date < ?",
                    [$accountId, $this->code(), $fy['start_date'], $from]
                )->fetch('assoc');
                $openingBalance = (float)$ob['dr'] - (float)$ob['cr'];
                if ($account['normal_balance'] === 'credit') $openingBalance = -$openingBalance;

                // Fetch lines in range
                $rows = $this->db()->execute(
                    "SELECT je.journal_date, je.reference_no, je.description, je.source_type,
                            jl.debit_amount, jl.credit_amount, jl.narration
                     FROM fin_journal_lines jl
                     JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
                     WHERE jl.account_id=? AND je.ssms_client_code=? AND je.journal_date BETWEEN ? AND ?
                     ORDER BY je.journal_date ASC, je.journal_id ASC",
                    [$accountId, $this->code(), $from, $to]
                )->fetchAll('assoc');

                $balance = $openingBalance;
                foreach ($rows as $row) {
                    $dr = (float)$row['debit_amount'];
                    $cr = (float)$row['credit_amount'];
                    if ($account['normal_balance'] === 'debit') {
                        $balance += $dr - $cr;
                    } else {
                        $balance += $cr - $dr;
                    }
                    $ledger[] = array_merge($row, ['running_balance' => $balance]);
                }
            }
        }

        $this->set(compact('accounts','account','accountId','ledger','openingBalance','from','to','fy'));
    }

    // ── Helper: sum journal lines by account_type for a date range ─────────
    private function accountTypeTotals(string $type, string $from, string $to): array
    {
        return $this->db()->execute(
            "SELECT a.account_id, a.account_code, a.account_name, a.account_subtype,
                    COALESCE(SUM(jl.debit_amount),0)  AS total_debit,
                    COALESCE(SUM(jl.credit_amount),0) AS total_credit
             FROM fin_chart_of_accounts a
             LEFT JOIN fin_journal_lines jl ON jl.account_id=a.account_id
             LEFT JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
                   AND je.ssms_client_code=? AND je.journal_date BETWEEN ? AND ?
             WHERE a.ssms_client_code=? AND a.account_type=? AND a.is_active=1
             GROUP BY a.account_id
             ORDER BY a.account_code",
            [$this->code(), $from, $to, $this->code(), $type]
        )->fetchAll('assoc');
    }

    // ── Helper: cumulative balance up to a date ────────────────────────────
    private function accountBalances(string $type, string $asAt): array
    {
        return $this->db()->execute(
            "SELECT a.account_id, a.account_code, a.account_name, a.account_subtype, a.normal_balance,
                    COALESCE(SUM(jl.debit_amount),0)  AS total_debit,
                    COALESCE(SUM(jl.credit_amount),0) AS total_credit
             FROM fin_chart_of_accounts a
             LEFT JOIN fin_journal_lines jl ON jl.account_id=a.account_id
             LEFT JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
                   AND je.ssms_client_code=? AND je.journal_date <= ?
             WHERE a.ssms_client_code=? AND a.account_type=? AND a.is_active=1
             GROUP BY a.account_id
             ORDER BY a.account_code",
            [$this->code(), $asAt, $this->code(), $type]
        )->fetchAll('assoc');
    }

    // ── Profit & Loss ──────────────────────────────────────────────────────
    public function profitLoss()
    {
        $fy   = $this->currentFy();
        $from = $this->request->getQuery('from', $fy ? $fy['start_date'] : date('Y-01-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));

        $income   = $this->accountTypeTotals('income',  $from, $to);
        $expenses = $this->accountTypeTotals('expense',  $from, $to);

        // Income: normal_balance=credit → net = credit - debit
        foreach ($income as &$r) {
            $r['net'] = (float)$r['total_credit'] - (float)$r['total_debit'];
        }
        // Expense: normal_balance=debit → net = debit - credit
        foreach ($expenses as &$r) {
            $r['net'] = (float)$r['total_debit'] - (float)$r['total_credit'];
        }

        $totalIncome   = array_sum(array_column($income,   'net'));
        $totalExpenses = array_sum(array_column($expenses, 'net'));
        $netSurplus    = $totalIncome - $totalExpenses;

        $this->set(compact('income','expenses','totalIncome','totalExpenses','netSurplus','from','to','fy'));
    }

    // ── Balance Sheet ──────────────────────────────────────────────────────
    public function balanceSheet()
    {
        $fy    = $this->currentFy();
        $asAt  = $this->request->getQuery('as_at', date('Y-m-d'));

        $assets      = $this->accountBalances('asset',     $asAt);
        $liabilities = $this->accountBalances('liability',  $asAt);
        $equity      = $this->accountBalances('equity',     $asAt);

        // Assets: normal=debit → balance = debit - credit
        foreach ($assets as &$r) {
            $r['balance'] = (float)$r['total_debit'] - (float)$r['total_credit'];
        }
        // Liabilities & Equity: normal=credit → balance = credit - debit
        foreach ($liabilities as &$r) {
            $r['balance'] = (float)$r['total_credit'] - (float)$r['total_debit'];
        }
        foreach ($equity as &$r) {
            $r['balance'] = (float)$r['total_credit'] - (float)$r['total_debit'];
        }

        // Retained earnings (P&L net) from FY start to asAt
        $fyStart = $fy ? $fy['start_date'] : date('Y-01-01');
        $incRows = $this->accountTypeTotals('income',  $fyStart, $asAt);
        $expRows = $this->accountTypeTotals('expense', $fyStart, $asAt);
        $retainedEarnings = array_sum(array_column($incRows,'total_credit'))
                          - array_sum(array_column($incRows,'total_debit'))
                          - array_sum(array_column($expRows,'total_debit'))
                          + array_sum(array_column($expRows,'total_credit'));

        $totalAssets      = array_sum(array_column($assets,      'balance'));
        $totalLiabilities = array_sum(array_column($liabilities, 'balance'));
        $totalEquity      = array_sum(array_column($equity,      'balance')) + $retainedEarnings;

        $this->set(compact('assets','liabilities','equity','totalAssets','totalLiabilities',
                           'totalEquity','retainedEarnings','asAt','fy'));
    }

    // ── Trial Balance ──────────────────────────────────────────────────────
    public function trialBalance()
    {
        $fy   = $this->currentFy();
        $from = $this->request->getQuery('from', $fy ? $fy['start_date'] : date('Y-01-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));

        $rows = $this->db()->execute(
            "SELECT a.account_code, a.account_name, a.account_type,
                    COALESCE(SUM(jl.debit_amount),0)  AS total_debit,
                    COALESCE(SUM(jl.credit_amount),0) AS total_credit
             FROM fin_chart_of_accounts a
             LEFT JOIN fin_journal_lines jl ON jl.account_id=a.account_id
             LEFT JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
                   AND je.ssms_client_code=? AND je.journal_date BETWEEN ? AND ?
             WHERE a.ssms_client_code=? AND a.is_active=1
             HAVING total_debit > 0 OR total_credit > 0
             ORDER BY a.account_type, a.account_code",
            [$this->code(), $from, $to, $this->code()]
        )->fetchAll('assoc');

        $grandDebit  = array_sum(array_column($rows, 'total_debit'));
        $grandCredit = array_sum(array_column($rows, 'total_credit'));

        $this->set(compact('rows','grandDebit','grandCredit','from','to','fy'));
    }

    // ── Cash Flow Statement ────────────────────────────────────────────────
    public function cashFlow()
    {
        $fy   = $this->currentFy();
        $from = $this->request->getQuery('from', $fy ? $fy['start_date'] : date('Y-01-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));

        // Operating: income received (fee, donation, grant, other) & expenses paid
        $operating = $this->db()->execute(
            "SELECT
               COALESCE(SUM(CASE WHEN je.source_type IN ('income','fee') THEN jl.credit_amount - jl.debit_amount ELSE 0 END),0) AS cash_from_income,
               COALESCE(SUM(CASE WHEN je.source_type = 'expense' THEN jl.debit_amount - jl.credit_amount ELSE 0 END),0) AS cash_for_expenses,
               COALESCE(SUM(CASE WHEN je.source_type = 'payroll' THEN jl.debit_amount - jl.credit_amount ELSE 0 END),0) AS cash_for_payroll
             FROM fin_journal_entries je
             JOIN fin_journal_lines jl ON jl.journal_id=je.journal_id
             JOIN fin_chart_of_accounts a ON a.account_id=jl.account_id
             WHERE je.ssms_client_code=? AND je.journal_date BETWEEN ? AND ?
               AND a.account_type IN ('income','expense')",
            [$this->code(), $from, $to]
        )->fetch('assoc');

        // Bank movements (credits = inflows, debits = outflows on bank/cash accounts)
        $bankFlow = $this->db()->execute(
            "SELECT
               COALESCE(SUM(CASE WHEN txn_type='credit' THEN amount ELSE 0 END),0) AS total_inflow,
               COALESCE(SUM(CASE WHEN txn_type='debit'  THEN amount ELSE 0 END),0) AS total_outflow
             FROM fin_bank_transactions
             WHERE ssms_client_code=? AND txn_date BETWEEN ? AND ?",
            [$this->code(), $from, $to]
        )->fetch('assoc');

        // Opening & closing bank balances
        $bankAccounts = $this->db()->execute(
            "SELECT bank_account_id, bank_name, current_balance, opening_balance
             FROM fin_bank_accounts WHERE ssms_client_code=? AND is_active=1",
            [$this->code()]
        )->fetchAll('assoc');

        $openingCash  = array_sum(array_column($bankAccounts, 'opening_balance'));
        $closingCash  = array_sum(array_column($bankAccounts, 'current_balance'));

        $cashFromOps  = (float)($operating['cash_from_income']   ?? 0)
                      - (float)($operating['cash_for_expenses']  ?? 0)
                      - (float)($operating['cash_for_payroll']   ?? 0);

        $this->set(compact('operating','bankFlow','bankAccounts','openingCash','closingCash',
                           'cashFromOps','from','to','fy'));
    }

    // ── Tally XML Export ───────────────────────────────────────────────────
    public function tallyExport()
    {
        $fy   = $this->currentFy();
        $from = $this->request->getQuery('from', $fy ? $fy['start_date'] : date('Y-01-01'));
        $to   = $this->request->getQuery('to',   date('Y-m-d'));

        if ($this->request->is('post')) {
            $from = $this->request->getData('from', $from);
            $to   = $this->request->getData('to',   $to);

            // Fetch all journal entries with their lines and accounts
            $entries = $this->db()->execute(
                "SELECT je.journal_id, je.journal_date, je.reference_no, je.description, je.source_type,
                        jl.debit_amount, jl.credit_amount, jl.narration,
                        a.account_code, a.account_name, a.account_type
                 FROM fin_journal_entries je
                 JOIN fin_journal_lines jl ON jl.journal_id = je.journal_id
                 JOIN fin_chart_of_accounts a ON a.account_id = jl.account_id
                 WHERE je.ssms_client_code=? AND je.journal_date BETWEEN ? AND ?
                 ORDER BY je.journal_date, je.journal_id, jl.debit_amount DESC",
                [$this->code(), $from, $to]
            )->fetchAll('assoc');

            // Get school info for Tally company header
            $school = $this->db()->execute(
                "SELECT ssms_client_header_text FROM ssms_clients WHERE ssms_client_code=? LIMIT 1",
                [$this->code()]
            )->fetch('assoc');
            $companyName = $school ? $school['ssms_client_header_text'] : $this->code();

            // Group lines by journal
            $journals = [];
            foreach ($entries as $row) {
                $jid = $row['journal_id'];
                if (!isset($journals[$jid])) {
                    $journals[$jid] = [
                        'date'        => $row['journal_date'],
                        'ref'         => $row['reference_no'],
                        'description' => $row['description'],
                        'lines'       => [],
                    ];
                }
                $journals[$jid]['lines'][] = $row;
            }

            // Build Tally XML
            $xml  = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
            $xml .= '<ENVELOPE>' . "\n";
            $xml .= '  <HEADER>' . "\n";
            $xml .= '    <TALLYREQUEST>Import Data</TALLYREQUEST>' . "\n";
            $xml .= '  </HEADER>' . "\n";
            $xml .= '  <BODY>' . "\n";
            $xml .= '    <IMPORTDATA>' . "\n";
            $xml .= '      <REQUESTDESC>' . "\n";
            $xml .= '        <REPORTNAME>Vouchers</REPORTNAME>' . "\n";
            $xml .= '        <STATICVARIABLES>' . "\n";
            $xml .= '          <SVCURRENTCOMPANY>' . htmlspecialchars($companyName) . '</SVCURRENTCOMPANY>' . "\n";
            $xml .= '        </STATICVARIABLES>' . "\n";
            $xml .= '      </REQUESTDESC>' . "\n";
            $xml .= '      <REQUESTDATA>' . "\n";

            foreach ($journals as $jid => $j) {
                $tallyDate = date('Ymd', strtotime($j['date']));  // Tally date format: YYYYMMDD
                $voucherType = $this->_tallyVoucherType($j['lines']);

                $xml .= '        <TALLYMESSAGE xmlns:UDF="TallyUDF">' . "\n";
                $xml .= '          <VOUCHER REMOTEID="' . $jid . '" VCHTYPE="' . $voucherType . '" ACTION="Create">' . "\n";
                $xml .= '            <DATE>' . $tallyDate . '</DATE>' . "\n";
                $xml .= '            <NARRATION>' . htmlspecialchars($j['description']) . '</NARRATION>' . "\n";
                $xml .= '            <VOUCHERTYPENAME>' . $voucherType . '</VOUCHERTYPENAME>' . "\n";
                $xml .= '            <VOUCHERNUMBER>' . htmlspecialchars($j['ref']) . '</VOUCHERNUMBER>' . "\n";

                foreach ($j['lines'] as $line) {
                    $amount  = (float)$line['debit_amount'] > 0 ? (float)$line['debit_amount'] : -(float)$line['credit_amount'];
                    $xml .= '            <ALLLEDGERENTRIES.LIST>' . "\n";
                    $xml .= '              <LEDGERNAME>' . htmlspecialchars($line['account_name']) . '</LEDGERNAME>' . "\n";
                    $xml .= '              <ISDEEMEDPOSITIVE>' . ($amount >= 0 ? 'Yes' : 'No') . '</ISDEEMEDPOSITIVE>' . "\n";
                    $xml .= '              <AMOUNT>' . number_format(abs($amount), 2, '.', '') . '</AMOUNT>' . "\n";
                    if (!empty($line['narration'])) {
                        $xml .= '              <NARRATION>' . htmlspecialchars($line['narration']) . '</NARRATION>' . "\n";
                    }
                    $xml .= '            </ALLLEDGERENTRIES.LIST>' . "\n";
                }

                $xml .= '          </VOUCHER>' . "\n";
                $xml .= '        </TALLYMESSAGE>' . "\n";
            }

            $xml .= '      </REQUESTDATA>' . "\n";
            $xml .= '    </IMPORTDATA>' . "\n";
            $xml .= '  </BODY>' . "\n";
            $xml .= '</ENVELOPE>';

            $filename = 'tally-export-' . $from . '-to-' . $to . '.xml';
            return $this->response
                ->withType('application/xml')
                ->withHeader('Content-Disposition', 'attachment; filename="' . $filename . '"')
                ->withStringBody($xml);
        }

        $this->set(compact('from', 'to', 'fy'));
    }

    private function _tallyVoucherType(array $lines): string
    {
        // Determine Tally voucher type from account types in the lines
        $types = array_unique(array_column($lines, 'account_type'));
        if (in_array('income', $types))  return 'Receipt';
        if (in_array('expense', $types)) return 'Payment';
        if (in_array('asset', $types) && in_array('liability', $types)) return 'Journal';
        return 'Journal';
    }
}
