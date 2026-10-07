<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinPurchaseOrdersController extends AppController
{
    private function db() { return ConnectionManager::get('default'); }
    private function code(): string { return (string)$this->request->getSession()->read('ssms_client_code'); }
    private function user(): string { return (string)$this->request->getSession()->read('ssms_sawera_id'); }
    private function isOwner(): bool { return in_array(strtolower((string)$this->request->getSession()->read('ssms_user_role')), ['owner','admin'], true); }

    private function nextPoNumber(): string
    {
        $last = $this->db()->execute(
            "SELECT po_number FROM fin_purchase_orders WHERE ssms_client_code=? ORDER BY po_id DESC LIMIT 1",
            [$this->code()]
        )->fetch('assoc');
        if ($last && preg_match('/PO-(\d+)/', $last['po_number'], $m)) {
            return 'PO-' . str_pad((string)((int)$m[1] + 1), 5, '0', STR_PAD_LEFT);
        }
        return 'PO-00001';
    }

    private function nextGrnNumber(): string
    {
        $last = $this->db()->execute(
            "SELECT grn_number FROM fin_grn WHERE ssms_client_code=? ORDER BY grn_id DESC LIMIT 1",
            [$this->code()]
        )->fetch('assoc');
        if ($last && preg_match('/GRN-(\d+)/', $last['grn_number'], $m)) {
            return 'GRN-' . str_pad((string)((int)$m[1] + 1), 5, '0', STR_PAD_LEFT);
        }
        return 'GRN-00001';
    }

    private function vendors(): array
    {
        return $this->db()->execute(
            "SELECT vendor_id, vendor_name, payment_terms, tds_applicable, tds_rate
             FROM fin_vendors WHERE ssms_client_code=? AND status='active' ORDER BY vendor_name",
            [$this->code()]
        )->fetchAll('assoc');
    }

    private function activeFy(): ?array
    {
        return $this->db()->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code=? AND is_current=1 LIMIT 1",
            [$this->code()]
        )->fetch('assoc') ?: null;
    }

    // ── PO List ───────────────────────────────────────────────────────────────
    public function index()
    {
        $status   = $this->request->getQuery('status') ?? 'all';
        $vendorId = $this->request->getQuery('vendor_id') ?? '';

        $where  = "WHERE po.ssms_client_code=?";
        $params = [$this->code()];
        if ($status !== 'all') { $where .= " AND po.status=?"; $params[] = $status; }
        if ($vendorId) { $where .= " AND po.vendor_id=?"; $params[] = $vendorId; }

        $orders = $this->db()->execute(
            "SELECT po.*, v.vendor_name,
                    (SELECT COUNT(*) FROM fin_grn g WHERE g.po_id=po.po_id) AS grn_count,
                    (SELECT COUNT(*) FROM fin_vendor_invoices vi WHERE vi.po_id=po.po_id) AS inv_count
             FROM fin_purchase_orders po
             JOIN fin_vendors v ON v.vendor_id=po.vendor_id
             $where ORDER BY po.po_date DESC",
            $params
        )->fetchAll('assoc');

        $vendors = $this->vendors();
        $this->set(compact('orders', 'status', 'vendors', 'vendorId'));
    }

    // ── Create PO ─────────────────────────────────────────────────────────────
    public function add()
    {
        $vendors = $this->vendors();
        $fy      = $this->activeFy();

        // Pre-select vendor from query string (from vendor view page)
        $preVendorId = $this->request->getQuery('vendor_id') ?? '';

        if ($this->request->is('post')) {
            $d     = $this->request->getData();
            $lines = array_filter($d['lines'] ?? [], fn($l) => !empty($l['item_description']) && (float)($l['qty'] ?? 0) > 0);

            if (empty($lines)) {
                $this->Flash->error('Add at least one line item.');
            } else {
                $total = 0; $taxTotal = 0;
                foreach ($lines as $l) {
                    $lineTotal = (float)$l['qty'] * (float)$l['unit_price'];
                    $tax       = $lineTotal * ((float)($l['tax_pct'] ?? 0) / 100);
                    $total    += $lineTotal;
                    $taxTotal += $tax;
                }
                $grand = $total + $taxTotal;

                $this->db()->execute(
                    "INSERT INTO fin_purchase_orders
                     (ssms_client_code,po_number,vendor_id,po_date,expected_delivery,fy_id,
                      department,total_amount,tax_amount,grand_total,status,notes,created_by)
                     VALUES (?,?,?,?,?,?,?,?,?,?,'draft',?,?)",
                    [
                        $this->code(), $this->nextPoNumber(), (int)$d['vendor_id'],
                        $d['po_date'], $d['expected_delivery'] ?: null,
                        $fy ? $fy['fy_id'] : null,
                        $d['department'] ?? null,
                        $total, $taxTotal, $grand,
                        $d['notes'] ?? null, $this->user()
                    ]
                );
                $poId = (int)$this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

                foreach ($lines as $l) {
                    $qty       = (float)$l['qty'];
                    $price     = (float)$l['unit_price'];
                    $taxPct    = (float)($l['tax_pct'] ?? 0);
                    $lineTotal = $qty * $price * (1 + $taxPct / 100);
                    $this->db()->execute(
                        "INSERT INTO fin_po_lines (po_id,item_description,unit,qty,unit_price,tax_pct,line_total,account_id)
                         VALUES (?,?,?,?,?,?,?,?)",
                        [$poId, $l['item_description'], $l['unit'] ?? null, $qty, $price, $taxPct, $lineTotal,
                         !empty($l['account_id']) ? (int)$l['account_id'] : null]
                    );
                }
                $this->Flash->success("Purchase Order created.");
                return $this->redirect(['action' => 'view', $poId]);
            }
        }

        $expenseAccounts = $this->db()->execute(
            "SELECT account_id, account_name FROM fin_chart_of_accounts
             WHERE ssms_client_code=? AND account_type='expense' AND is_active=1 ORDER BY account_name",
            [$this->code()]
        )->fetchAll('assoc');

        $this->set(compact('vendors', 'expenseAccounts', 'preVendorId'));
    }

    // ── View PO ───────────────────────────────────────────────────────────────
    public function view(int $id)
    {
        $po = $this->db()->execute(
            "SELECT po.*, v.vendor_name, v.gst_number, v.payment_terms, v.tds_applicable, v.tds_rate
             FROM fin_purchase_orders po JOIN fin_vendors v ON v.vendor_id=po.vendor_id
             WHERE po.po_id=? AND po.ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$po) { $this->Flash->error('PO not found.'); return $this->redirect(['action' => 'index']); }

        $lines = $this->db()->execute(
            "SELECT pl.*, c.account_name FROM fin_po_lines pl
             LEFT JOIN fin_chart_of_accounts c ON c.account_id=pl.account_id
             WHERE pl.po_id=?", [$id]
        )->fetchAll('assoc');

        $grns = $this->db()->execute(
            "SELECT * FROM fin_grn WHERE po_id=? AND ssms_client_code=? ORDER BY grn_date DESC",
            [$id, $this->code()]
        )->fetchAll('assoc');

        $invoices = $this->db()->execute(
            "SELECT * FROM fin_vendor_invoices WHERE po_id=? AND ssms_client_code=? ORDER BY invoice_date DESC",
            [$id, $this->code()]
        )->fetchAll('assoc');

        $isOwner = $this->isOwner();
        $bankAccounts = $this->db()->execute(
            "SELECT bank_account_id, bank_name, current_balance FROM fin_bank_accounts
             WHERE ssms_client_code=? AND is_active=1 ORDER BY is_default DESC, bank_name",
            [$this->code()]
        )->fetchAll('assoc');
        $this->set(compact('po', 'lines', 'grns', 'invoices', 'isOwner', 'bankAccounts'));
    }

    // ── Approve PO ────────────────────────────────────────────────────────────
    public function approve(int $id)
    {
        if (!$this->isOwner()) { $this->Flash->error('Only Owner/Admin can approve POs.'); return $this->redirect(['action' => 'view', $id]); }
        $this->request->allowMethod(['post']);
        $this->db()->execute(
            "UPDATE fin_purchase_orders SET status='approved', approved_by=?, approved_at=NOW() WHERE po_id=? AND ssms_client_code=? AND status='draft'",
            [$this->user(), $id, $this->code()]
        );
        $this->Flash->success('Purchase Order approved.');
        return $this->redirect(['action' => 'view', $id]);
    }

    // ── Record GRN ────────────────────────────────────────────────────────────
    public function addGrn(int $poId)
    {
        $po = $this->db()->execute(
            "SELECT po.*, v.vendor_name FROM fin_purchase_orders po
             JOIN fin_vendors v ON v.vendor_id=po.vendor_id
             WHERE po.po_id=? AND po.ssms_client_code=? AND po.status IN ('approved','partial')",
            [$poId, $this->code()]
        )->fetch('assoc');
        if (!$po) { $this->Flash->error('PO not found or not yet approved.'); return $this->redirect(['action' => 'index']); }

        $lines = $this->db()->execute(
            "SELECT * FROM fin_po_lines WHERE po_id=?", [$poId]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d        = $this->request->getData();
            $grnLines = $d['lines'] ?? [];
            $hasItems = false;

            $grnId = null;
            $this->db()->execute(
                "INSERT INTO fin_grn (ssms_client_code,grn_number,po_id,vendor_id,grn_date,received_by,notes,status,created_by)
                 VALUES (?,?,?,?,?,?,?,'confirmed',?)",
                [$this->code(), $this->nextGrnNumber(), $poId, $po['vendor_id'],
                 $d['grn_date'], $d['received_by'] ?? null, $d['notes'] ?? null, $this->user()]
            );
            $grnId = (int)$this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

            foreach ($lines as $line) {
                $qtyRec = (float)($grnLines[$line['line_id']]['qty_received'] ?? 0);
                if ($qtyRec <= 0) continue;
                $hasItems = true;
                $lineTotal = $qtyRec * (float)$line['unit_price'];
                $this->db()->execute(
                    "INSERT INTO fin_grn_lines (grn_id,po_line_id,item_description,qty_ordered,qty_received,unit_price,line_total,condition_note)
                     VALUES (?,?,?,?,?,?,?,?)",
                    [$grnId, $line['line_id'], $line['item_description'],
                     $line['qty'], $qtyRec, $line['unit_price'], $lineTotal,
                     $grnLines[$line['line_id']]['condition_note'] ?? null]
                );
                // Update qty_received on PO line
                $this->db()->execute(
                    "UPDATE fin_po_lines SET qty_received=qty_received+? WHERE line_id=?",
                    [$qtyRec, $line['line_id']]
                );
            }

            if (!$hasItems) {
                $this->db()->execute("DELETE FROM fin_grn WHERE grn_id=?", [$grnId]);
                $this->Flash->error('No items received. GRN not saved.');
            } else {
                // Update PO status
                $allReceived = $this->db()->execute(
                    "SELECT COUNT(*) AS cnt FROM fin_po_lines WHERE po_id=? AND qty_received < qty", [$poId]
                )->fetch('assoc')['cnt'] == 0;
                $newStatus = $allReceived ? 'received' : 'partial';
                $this->db()->execute("UPDATE fin_purchase_orders SET status=? WHERE po_id=?", [$newStatus, $poId]);
                $this->Flash->success("GRN recorded.");
                return $this->redirect(['action' => 'view', $poId]);
            }
        }
        $this->set(compact('po', 'lines'));
    }

    // ── Record Vendor Invoice ─────────────────────────────────────────────────
    public function addInvoice(int $poId)
    {
        $po = $this->db()->execute(
            "SELECT po.*, v.vendor_name, v.tds_applicable, v.tds_rate, v.payment_terms
             FROM fin_purchase_orders po JOIN fin_vendors v ON v.vendor_id=po.vendor_id
             WHERE po.po_id=? AND po.ssms_client_code=?",
            [$poId, $this->code()]
        )->fetch('assoc');
        if (!$po) { $this->Flash->error('PO not found.'); return $this->redirect(['action' => 'index']); }

        $grns = $this->db()->execute(
            "SELECT * FROM fin_grn WHERE po_id=? AND ssms_client_code=? AND status='confirmed'",
            [$poId, $this->code()]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $d        = $this->request->getData();
            $amount   = (float)($d['amount'] ?? 0);
            $tax      = (float)($d['tax_amount'] ?? 0);
            $grand    = $amount + $tax;
            $tds      = $po['tds_applicable'] ? round($amount * ($po['tds_rate'] / 100), 2) : 0;
            $netPay   = $grand - $tds;
            $dueDate  = !empty($d['invoice_date'])
                ? date('Y-m-d', strtotime($d['invoice_date'] . ' +' . $po['payment_terms'] . ' days'))
                : null;

            // 'all' means invoice covers all GRNs — store no specific grn_id but mark as matched
            $grnId = ($d['grn_id'] ?? '' === 'all' || empty($d['grn_id'])) ? null : (int)$d['grn_id'];
            $matchStatus = (!empty($d['grn_id'])) ? 'matched' : 'unmatched';

            $this->db()->execute(
                "INSERT INTO fin_vendor_invoices
                 (ssms_client_code,invoice_number,vendor_id,po_id,grn_id,invoice_date,due_date,
                  amount,tax_amount,grand_total,tds_deducted,net_payable,payment_status,match_status,notes,created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'unpaid',?,?,?)",
                [
                    $this->code(), $d['invoice_number'], $po['vendor_id'], $poId, $grnId,
                    $d['invoice_date'], $dueDate, $amount, $tax, $grand, $tds, $netPay,
                    $matchStatus, $d['notes'] ?? null, $this->user()
                ]
            );
            $this->Flash->success('Invoice recorded. Net payable: ₹' . number_format($netPay, 2) . ($tds > 0 ? " (TDS ₹{$tds} deducted)" : ''));
            return $this->redirect(['action' => 'view', $poId]);
        }
        $this->set(compact('po', 'grns'));
    }

    // ── Pay Invoice ───────────────────────────────────────────────────────────
    public function payInvoice(int $invoiceId)
    {
        if (!$this->isOwner()) { $this->Flash->error('Only Owner/Admin can mark invoices as paid.'); return $this->redirect(['action' => 'index']); }
        $this->request->allowMethod(['post']);

        $inv = $this->db()->execute(
            "SELECT vi.*, v.vendor_name, po.po_id
             FROM fin_vendor_invoices vi
             JOIN fin_vendors v ON v.vendor_id=vi.vendor_id
             JOIN fin_purchase_orders po ON po.po_id=vi.po_id
             WHERE vi.invoice_id=? AND vi.ssms_client_code=? AND vi.payment_status='unpaid'",
            [$invoiceId, $this->code()]
        )->fetch('assoc');

        if (!$inv) {
            $this->Flash->error('Invoice not found or already paid.');
            return $this->redirect(['action' => 'index']);
        }

        $d           = $this->request->getData();
        $bankAcctId  = (int)($d['bank_account_id'] ?? 0);
        $payDate     = $d['pay_date'] ?? date('Y-m-d');
        $ref         = $d['reference_no'] ?? ('INV-PAY-' . $invoiceId);
        $netPayable  = (float)$inv['net_payable'];

        // Find expense account from first PO line
        $expAcct = $this->db()->execute(
            "SELECT account_id FROM fin_po_lines WHERE po_id=? AND account_id IS NOT NULL LIMIT 1",
            [$inv['po_id']]
        )->fetch('assoc');

        // Get bank account's COA account_id
        $bankCoa = $this->db()->execute(
            "SELECT account_id FROM fin_bank_accounts WHERE bank_account_id=? AND ssms_client_code=?",
            [$bankAcctId, $this->code()]
        )->fetch('assoc');

        // Resolve active fiscal year
        $fy = $this->activeFy();
        $fyId = $fy ? $fy['fy_id'] : null;
        if (!$fyId) {
            $this->Flash->error('No active fiscal year found. Please set one in Finance Setup.');
            return $this->redirect(['action' => 'view', $inv['po_id']]);
        }

        // Insert into fin_expenses (auto-approved)
        $this->db()->execute(
            "INSERT INTO fin_expenses
             (ssms_client_code,fy_id,expense_date,expense_type,account_id,amount,payee_name,
              description,payment_mode,reference_no,voucher_no,status,created_by)
             VALUES (?,?,?,'Vendor Payment',?,?,?,?,'Bank Transfer',?,?,'approved',?)",
            [
                $this->code(), $fyId, $payDate,
                $expAcct ? $expAcct['account_id'] : null,
                $netPayable,
                $inv['vendor_name'],
                'Payment for Invoice ' . $inv['invoice_number'],
                $ref, $ref, $this->user()
            ]
        );
        $expenseId = (int)$this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

        // Post journal: DR Expense A/c, CR Bank A/c
        if ($expAcct && $bankCoa) {
            $this->db()->execute(
                "INSERT INTO fin_journal_entries
                 (ssms_client_code,fy_id,journal_date,reference_no,description,source_type,source_id,status,created_by)
                 VALUES (?,?,?,?,?,'expense',?,'posted',?)",
                [$this->code(), $fyId, $payDate, $ref,
                 'Vendor Payment — ' . $inv['invoice_number'] . ' — ' . $inv['vendor_name'],
                 $expenseId, $this->user()]
            );
            $journalId = (int)$this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];
            // DR: Expense account
            $this->db()->execute(
                "INSERT INTO fin_journal_lines (journal_id,account_id,debit_amount,credit_amount,narration) VALUES (?,?,?,0,?)",
                [$journalId, $expAcct['account_id'], $netPayable, 'Vendor payment ' . $inv['invoice_number']]
            );
            // CR: Bank account
            $this->db()->execute(
                "INSERT INTO fin_journal_lines (journal_id,account_id,debit_amount,credit_amount,narration) VALUES (?,?,0,?,?)",
                [$journalId, $bankCoa['account_id'], $netPayable, 'Vendor payment ' . $inv['invoice_number']]
            );
        }

        // Debit bank account balance
        if ($bankAcctId) {
            $this->db()->execute(
                "UPDATE fin_bank_accounts SET current_balance=current_balance-? WHERE bank_account_id=? AND ssms_client_code=?",
                [$netPayable, $bankAcctId, $this->code()]
            );
            // Record bank transaction
            $this->db()->execute(
                "INSERT INTO fin_bank_transactions
                 (ssms_client_code,bank_account_id,txn_date,txn_type,amount,description,reference_no,party_name,category,source_type,created_by)
                 VALUES (?,?,?,'debit',?,?,?,?,'vendor','vendor_invoice',?)",
                [$this->code(), $bankAcctId, $payDate, $netPayable,
                 'Invoice ' . $inv['invoice_number'] . ' — ' . $inv['vendor_name'],
                 $ref, $inv['vendor_name'], $this->user()]
            );
        }

        // Mark invoice as paid
        $this->db()->execute(
            "UPDATE fin_vendor_invoices SET payment_status='paid', amount_paid=net_payable WHERE invoice_id=?",
            [$invoiceId]
        );

        $this->Flash->success('Invoice marked as paid. ₹' . number_format($netPayable, 2) . ' recorded as expense.');
        return $this->redirect(['action' => 'view', $inv['po_id']]);
    }
}
