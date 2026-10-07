<?php
declare(strict_types=1);
namespace App\Controller\Traits;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * FinAutoPostTrait
 *
 * Drop this trait into any controller that needs to auto-post
 * a financial transaction to the finance ledger.
 *
 * Requires the host controller to provide $this->_clientCode() (or
 * equivalent) and uses ConnectionManager directly so it works even in
 * controllers that don't extend FinanceBaseController.
 */
trait FinAutoPostTrait
{
    /**
     * Auto-post a fee collection to fin_income + fin_journal_entries.
     *
     * Call this ONCE per receipt after all ssms_fee_paid_details rows have
     * been inserted.  The method is a soft-fail: if the school has no active
     * fiscal year or no mapped COA accounts the fee is still recorded in the
     * fee tables — we just skip the finance posting and log a note.
     *
     * @param  string $clientCode    School client code
     * @param  float  $totalAmount   Total cash collected for this receipt
     * @param  string $receiptNumber Receipt / reference number
     * @param  string $paymentDate   Date of payment (Y-m-d)
     * @param  string $paymentMethod Cash | Online | Cheque | UPI | etc.
     * @param  string $payerName     Student / payer name (for ledger narration)
     * @param  string $createdBy     User who collected the fee
     * @return void
     */
    protected function _autoPostFeeIncome(
        string $clientCode,
        float  $totalAmount,
        string $receiptNumber,
        string $paymentDate,
        string $paymentMethod,
        string $payerName   = '',
        string $createdBy   = 'system'
    ): void {
        if ($totalAmount <= 0) return;

        $db = ConnectionManager::get('default');

        // ── 1. Active fiscal year ─────────────────────────────────────────────
        $fy = $db->execute(
            "SELECT fy_id, is_locked FROM fin_fiscal_years
             WHERE ssms_client_code = ? AND is_current = 1 LIMIT 1",
            [$clientCode]
        )->fetch('assoc');

        if (!$fy) {
            Log::warning("FinAutoPost [{$clientCode}]: No active fiscal year — skipping receipt {$receiptNumber}");
            return;
        }
        if ($fy['is_locked']) {
            Log::warning("FinAutoPost [{$clientCode}]: Fiscal year is locked — skipping receipt {$receiptNumber}");
            return;
        }

        $fyId = (int)$fy['fy_id'];

        // ── 2. Fee Income COA account ─────────────────────────────────────────
        // Prefer an account whose name contains 'Fee', fall back to any income account
        $incAcct = $db->execute(
            "SELECT account_id FROM fin_chart_of_accounts
             WHERE ssms_client_code = ? AND account_type = 'income' AND is_active = 1
             ORDER BY (account_name LIKE '%Fee%') DESC, account_id ASC
             LIMIT 1",
            [$clientCode]
        )->fetch('assoc');

        if (!$incAcct) {
            Log::warning("FinAutoPost [{$clientCode}]: No income COA account found — skipping receipt {$receiptNumber}");
            return;
        }
        $incAccountId = (int)$incAcct['account_id'];

        // ── 3. Resolve bank/cash account ─────────────────────────────────────
        // We need TWO things from fin_bank_accounts:
        //   $finBankAccountId → PK for fin_income.bank_account_id (NOT NULL)
        //   $bankCoaAccountId → FK to fin_chart_of_accounts for journal lines
        //
        // For cash payments prefer an account whose account_type = 'cash' or
        // whose name contains 'Cash'. Fall back to any active bank account.
        $isCash = stripos($paymentMethod, 'cash') !== false;

        $bankRow = $db->execute(
            "SELECT bank_account_id, account_id
             FROM fin_bank_accounts
             WHERE ssms_client_code = ? AND is_active = 1
             ORDER BY
               (CASE WHEN ? = 1 AND (account_type = 'cash' OR bank_name LIKE '%Cash%') THEN 0 ELSE 1 END),
               is_default DESC,
               bank_account_id ASC
             LIMIT 1",
            [$clientCode, $isCash ? 1 : 0]
        )->fetch('assoc');

        if (!$bankRow) {
            Log::warning("FinAutoPost [{$clientCode}]: No bank account found — skipping receipt {$receiptNumber}");
            return;
        }

        $finBankAccountId = (int)$bankRow['bank_account_id'];   // for fin_income.bank_account_id
        $bankCoaAccountId = !empty($bankRow['account_id'])
            ? (int)$bankRow['account_id']
            : null;

        // If bank account has no linked COA, fall back to any asset COA account
        if (!$bankCoaAccountId) {
            $coaRow = $db->execute(
                "SELECT account_id FROM fin_chart_of_accounts
                 WHERE ssms_client_code = ? AND account_type = 'asset' AND is_active = 1
                 ORDER BY (account_name LIKE '%Bank%' OR account_name LIKE '%Cash%') DESC, account_id ASC
                 LIMIT 1",
                [$clientCode]
            )->fetch('assoc');
            if (!empty($coaRow['account_id'])) {
                $bankCoaAccountId = (int)$coaRow['account_id'];
            }
        }

        if (!$bankCoaAccountId) {
            Log::warning("FinAutoPost [{$clientCode}]: No asset COA account found for journal — skipping receipt {$receiptNumber}");
            return;
        }

        // ── 4. Duplicate guard — skip if this receipt was already posted ──────
        $exists = $db->execute(
            "SELECT income_id FROM fin_income
             WHERE ssms_client_code = ? AND receipt_no = ? LIMIT 1",
            [$clientCode, $receiptNumber]
        )->fetch('assoc');

        if ($exists) {
            Log::info("FinAutoPost [{$clientCode}]: Receipt {$receiptNumber} already posted — skipping duplicate");
            return;
        }

        // ── 5. Insert fin_income record ───────────────────────────────────────
        $modeMap = [
            'cash'   => 'cash',
            'online' => 'bank',
            'upi'    => 'upi',
            'cheque' => 'cheque',
            'card'   => 'bank',
        ];
        $normMode = $modeMap[strtolower($paymentMethod)] ?? 'bank';

        $db->execute(
            "INSERT INTO fin_income
                (ssms_client_code, fy_id, income_date, income_type, account_id,
                 bank_account_id, amount, payer_name, description,
                 payment_mode, receipt_no, created_by)
             VALUES (?,?,?,'fee',?,?,?,?,?,?,?,?)",
            [
                $clientCode,
                $fyId,
                $paymentDate,
                $incAccountId,
                $finBankAccountId,
                $totalAmount,
                $payerName ?: 'Student Fee',
                'Fee receipt ' . $receiptNumber,
                $normMode,
                $receiptNumber,
                $createdBy,
            ]
        );
        $incomeId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

        // ── 6. Post journal entry: DR Bank/Cash, CR Fee Income ────────────────
        $db->execute(
            "INSERT INTO fin_journal_entries
                (ssms_client_code, fy_id, journal_date, reference_no, description,
                 source_type, source_id, status, created_by)
             VALUES (?,?,?,?,?,'income',?,'posted',?)",
            [
                $clientCode,
                $fyId,
                $paymentDate,
                $receiptNumber,
                'Fee collection — ' . ($payerName ?: $receiptNumber),
                $incomeId,
                $createdBy,
            ]
        );
        $journalId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

        // DR Bank / Cash account
        $db->execute(
            "INSERT INTO fin_journal_lines (journal_id, account_id, debit_amount, credit_amount, narration)
             VALUES (?, ?, ?, 0, ?)",
            [$journalId, $bankCoaAccountId, $totalAmount, 'Fee received — ' . $receiptNumber]
        );
        // CR Fee Income account
        $db->execute(
            "INSERT INTO fin_journal_lines (journal_id, account_id, debit_amount, credit_amount, narration)
             VALUES (?, ?, 0, ?, ?)",
            [$journalId, $incAccountId, $totalAmount, 'Fee income — ' . ($payerName ?: $receiptNumber)]
        );

        // ── 7. Back-fill journal_id on the income row ─────────────────────────
        $db->execute(
            "UPDATE fin_income SET journal_id = ? WHERE income_id = ?",
            [$journalId, $incomeId]
        );
    }
}
