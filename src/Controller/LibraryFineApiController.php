<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;
use Cake\Log\Log;

/**
 * LibraryFineApiController
 * File: src/Controller/LibraryFineApiController.php
 *
 * Owns: lib_fines, lib_fine_payments
 *
 * Money is the part of a library system people notice when it is wrong, so a few
 * rules are enforced without exception:
 *
 *   - amounts are handled as DECIMAL strings, never PHP floats, up to the point
 *     of display. 0.1 + 0.2 is not 0.3 in binary floating point, and a fine
 *     ledger that drifts by a paisa a week is a ledger nobody trusts
 *   - paid_amount is always recomputed as SUM(lib_fine_payments), never
 *     incremented in place, so the fine row can never disagree with its receipts
 *   - status is derived from the arithmetic, never set by the caller
 *   - one receipt number covers one payment event, even when it clears several
 *     fines at once — that is what the member is handed
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibraryFineApi' to $apiControllers in AppController.php
 *   3. Paste the fine block from api/routes.snippet.php into config/routes.php
 */
class LibraryFineApiController extends AppController
{
    use LibraryApiTrait;

    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->response = $this->response->withType('application/json');
    }

    private function insertId(): int
    {
        return (int)$this->db()->getDriver()->lastInsertId();
    }

    /** Round to 2dp and return as a string, so DECIMAL columns never see a float. */
    private function money(float|string $v): string
    {
        return number_format((float)$v, 2, '.', '');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LIST
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryFineApi/fines
     *
     * Query: status (pending|partial|paid|waived|outstanding|all), memberId,
     *        type (Overdue|Lost|Damaged), from, to, q, classSection,
     *        sort (newest|oldest|amount|member), page, limit
     *
     * `outstanding` means Pending or Partial — anything with money still owed.
     * It is the default because that is the only tab a desk works from.
     *
     * Tab totals come back in the pagination block on every request, so the tab
     * bar never needs a second round trip.
     */
    public function fines(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        // Interpolated, not bound — see the note in LibraryCatalogApiController::books().
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['f.ssms_client_code = ?'];
        $params = [$clientCode];

        switch (strtolower((string)$this->q('status', 'outstanding'))) {
            case 'pending':
                $where[] = "f.status = 'Pending'";
                break;
            case 'partial':
                $where[] = "f.status = 'Partial'";
                break;
            case 'paid':
                $where[] = "f.status = 'Paid'";
                break;
            case 'waived':
                $where[] = "f.status = 'Waived'";
                break;
            case 'all':
                break;
            default:
                $where[] = "f.status IN ('Pending','Partial')";
        }

        if (($v = $this->qInt('memberId')) !== null) {
            $where[] = 'f.member_id = ?';
            $params[] = $v;
        }
        if (($v = $this->q('type')) !== null) {
            $where[] = 'f.fine_type = ?';
            $params[] = $v;
        }
        if (($v = $this->q('classSection')) !== null) {
            $where[] = 'm.class_section = ?';
            $params[] = $v;
        }
        if (($v = $this->q('from')) !== null) {
            $where[] = 'f.created_at >= ?';
            $params[] = date('Y-m-d 00:00:00', strtotime($v) ?: time());
        }
        if (($v = $this->q('to')) !== null) {
            $where[] = 'f.created_at <= ?';
            $params[] = date('Y-m-d 23:59:59', strtotime($v) ?: time());
        }
        if (($v = $this->q('q')) !== null) {
            $where[] = '(m.full_name LIKE ? OR m.membership_no LIKE ? OR b.title LIKE ?)';
            array_push($params, $this->like($v), $this->like($v, 'prefix'), $this->like($v));
        }

        $whereSql = implode(' AND ', $where);

        $orderBy = match ($this->q('sort', 'newest')) {
            'oldest' => 'f.created_at ASC, f.id ASC',
            'amount' => 'balance DESC, f.created_at DESC',
            'member' => 'm.full_name ASC, f.created_at DESC',
            default  => 'f.created_at DESC, f.id DESC',
        };

        $db = $this->db();

        $joins = 'JOIN lib_members m           ON m.id  = f.member_id
                  LEFT JOIN lib_checkouts ck   ON ck.id = f.checkout_id
                  LEFT JOIN lib_book_copies cp ON cp.id = ck.copy_id
                  LEFT JOIN lib_books b        ON b.id  = cp.book_id';

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_fines f {$joins} WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        // Tab counts and money totals across the whole filtered set, not just the
        // page — a desk needs "PKR 4,320 outstanding", not "on this page".
        $totals = $db->execute(
            "SELECT
                COUNT(*) AS all_count,
                SUM(CASE WHEN f.status = 'Pending' THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN f.status = 'Partial' THEN 1 ELSE 0 END) AS partial_count,
                SUM(CASE WHEN f.status = 'Paid'    THEN 1 ELSE 0 END) AS paid_count,
                SUM(CASE WHEN f.status = 'Waived'  THEN 1 ELSE 0 END) AS waived_count,
                COALESCE(SUM(f.amount), 0)        AS charged_total,
                COALESCE(SUM(f.paid_amount), 0)   AS paid_total,
                COALESCE(SUM(f.waived_amount), 0) AS waived_total,
                COALESCE(SUM(CASE WHEN f.status IN ('Pending','Partial')
                             THEN f.amount - f.paid_amount - f.waived_amount ELSE 0 END), 0) AS outstanding_total
             FROM lib_fines f
             WHERE f.ssms_client_code = ?",
            [$clientCode]
        )->fetch('assoc') ?: [];

        $settings = $this->settings($clientCode);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT f.id, f.member_id, f.checkout_id, f.fine_type, f.days_overdue,
                    f.amount, f.paid_amount, f.waived_amount, f.status, f.notes,
                    f.waived_by, f.waive_reason, f.created_at,
                    (f.amount - f.paid_amount - f.waived_amount) AS balance,
                    m.membership_no, m.full_name AS member_name, m.class_section,
                    m.member_type, m.phone,
                    b.title, cp.accession_no, ck.due_date, ck.return_date
             FROM   lib_fines f
             {$joins}
             WHERE  {$whereSql}
             ORDER  BY {$orderBy}
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows(
                $rows,
                ['id', 'member_id', 'checkout_id', 'days_overdue'],
                ['amount', 'paid_amount', 'waived_amount', 'balance']
            ),
            array_merge($this->paginationMeta($page, $limit, $total), [
                'totals' => [
                    'all'         => (int)($totals['all_count'] ?? 0),
                    'pending'     => (int)($totals['pending_count'] ?? 0),
                    'partial'     => (int)($totals['partial_count'] ?? 0),
                    'paid'        => (int)($totals['paid_count'] ?? 0),
                    'waived'      => (int)($totals['waived_count'] ?? 0),
                    'charged'     => (float)($totals['charged_total'] ?? 0),
                    'collected'   => (float)($totals['paid_total'] ?? 0),
                    'waivedValue' => (float)($totals['waived_total'] ?? 0),
                    'outstanding' => (float)($totals['outstanding_total'] ?? 0),
                    'currency'    => $settings['currency_symbol'] ?? '',
                ],
            ])
        );
    }

    /** GET /libraryFineApi/fine/{id} — the fine plus every payment against it. */
    public function fine(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $fineId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT f.*, (f.amount - f.paid_amount - f.waived_amount) AS balance,
                    m.membership_no, m.full_name AS member_name, m.class_section,
                    m.member_type, m.phone, m.email,
                    b.title, cp.accession_no, ck.issue_date, ck.due_date, ck.return_date
             FROM   lib_fines f
             JOIN   lib_members m           ON m.id  = f.member_id
             LEFT   JOIN lib_checkouts ck   ON ck.id = f.checkout_id
             LEFT   JOIN lib_book_copies cp ON cp.id = ck.copy_id
             LEFT   JOIN lib_books b        ON b.id  = cp.book_id
             WHERE  f.id = ? AND f.ssms_client_code = ?
             LIMIT  1',
            [$fineId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Fine');

            return;
        }

        $payments = $db->execute(
            'SELECT id, amount_paid, payment_method, receipt_no, collected_by, paid_at, notes
             FROM   lib_fine_payments WHERE fine_id = ? ORDER BY paid_at ASC, id ASC',
            [$fineId]
        )->fetchAll('assoc');

        $settings = $this->settings($clientCode);

        $this->ok([
            'fine'     => $this->castRow(
                $row,
                ['id', 'member_id', 'checkout_id', 'days_overdue'],
                ['amount', 'paid_amount', 'waived_amount', 'balance']
            ),
            'payments' => $this->castRows($payments, ['id'], ['amount_paid']),
            'currency' => $settings['currency_symbol'] ?? '',
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ⭐ COLLECT PAYMENT
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryFineApi/collectPayment
     *
     * Two shapes, because a desk collects money two ways:
     *
     *   { fine_id, amount, payment_method, notes }
     *       pay one specific fine (part-payment allowed)
     *
     *   { member_id, amount, payment_method, notes }
     *       "here's 200 rupees, clear what you can" — allocated across the
     *       member's outstanding fines oldest first, which is what a librarian
     *       does on paper anyway
     *
     * Either way the whole payment is one transaction under one receipt number.
     * A part-paid receipt that only half-applied would be unreconcilable.
     */
    public function collectPayment(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body     = (array)$this->request->getData();
        $fineId   = $this->intOrNull($body, 'fine_id');
        $memberId = $this->intOrNull($body, 'member_id');
        $amountIn = $this->decOrNull($body, 'amount');
        $method   = $this->str($body, 'payment_method') ?: 'Cash';
        $notes    = $this->str($body, 'notes');

        if (!$fineId && !$memberId) {
            $this->invalid('A fine or a member must be selected.', ['fine_id' => 'Required']);

            return;
        }
        if ($amountIn === null || (float)$amountIn <= 0) {
            $this->invalid('Enter an amount greater than zero.', ['amount' => 'Required']);

            return;
        }
        if (!in_array($method, ['Cash', 'Bank Transfer', 'Online'], true)) {
            $this->invalid('Payment method must be Cash, Bank Transfer or Online.', ['payment_method' => 'Invalid']);

            return;
        }

        $actor    = $this->actor();
        $settings = $this->settings($clientCode);

        try {
            $result = $this->transact(function () use (
                $clientCode, $fineId, $memberId, $amountIn, $method, $notes, $actor, $settings
            ) {
                $db = $this->db();

                // ── Which fines are we paying, and in what order? ─────────────
                if ($fineId) {
                    $targets = $db->execute(
                        "SELECT * FROM lib_fines
                         WHERE id = ? AND ssms_client_code = ? AND status IN ('Pending','Partial')
                         LIMIT 1
                         FOR UPDATE",
                        [$fineId, $clientCode]
                    )->fetchAll('assoc');

                    if ($targets === []) {
                        $exists = $db->execute(
                            'SELECT status FROM lib_fines WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                            [$fineId, $clientCode]
                        )->fetch('assoc');

                        return ['ok' => false, 'error' => $exists
                            ? ['code' => 'ALREADY_SETTLED', 'message' => 'This fine is already ' . strtolower((string)$exists['status']) . '.']
                            : ['code' => 'NOT_FOUND', 'message' => 'Fine not found.']];
                    }
                    $memberId = (int)$targets[0]['member_id'];
                } else {
                    // Oldest first — the same order a librarian would work through
                    // a member's ledger by hand.
                    $targets = $db->execute(
                        "SELECT * FROM lib_fines
                         WHERE member_id = ? AND ssms_client_code = ? AND status IN ('Pending','Partial')
                         ORDER BY created_at ASC, id ASC
                         FOR UPDATE",
                        [$memberId, $clientCode]
                    )->fetchAll('assoc');

                    if ($targets === []) {
                        return ['ok' => false, 'error' => [
                            'code' => 'NOTHING_DUE', 'message' => 'This member has nothing outstanding.',
                        ]];
                    }
                }

                // ── Does the money fit? ───────────────────────────────────────
                $totalDue = '0.00';
                foreach ($targets as $t) {
                    $totalDue = $this->money(
                        (float)$totalDue + ((float)$t['amount'] - (float)$t['paid_amount'] - (float)$t['waived_amount'])
                    );
                }

                if ((float)$amountIn > (float)$totalDue) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'OVERPAYMENT',
                        'message' => 'That is more than the ' . ($settings['currency_symbol'] ?? '')
                                     . $totalDue . ' outstanding. Enter ' . $totalDue . ' or less.',
                    ]];
                }

                $receiptNo = $this->generateReceiptNo($clientCode, $settings);

                // ── Allocate ──────────────────────────────────────────────────
                $remaining = $amountIn;
                $applied   = [];

                foreach ($targets as $t) {
                    if ((float)$remaining <= 0) {
                        break;
                    }

                    $balance = $this->money(
                        (float)$t['amount'] - (float)$t['paid_amount'] - (float)$t['waived_amount']
                    );
                    if ((float)$balance <= 0) {
                        continue;
                    }

                    $take      = (float)$remaining >= (float)$balance ? $balance : $remaining;
                    $remaining = $this->money((float)$remaining - (float)$take);

                    $db->execute(
                        'INSERT INTO lib_fine_payments
                            (fine_id, amount_paid, payment_method, receipt_no, collected_by, notes)
                         VALUES (?, ?, ?, ?, ?, ?)',
                        [(int)$t['id'], $take, $method, $receiptNo, $actor, $notes ?: null]
                    );

                    $status = $this->recomputeFine((int)$t['id'], $db);

                    $applied[] = [
                        'fine_id'     => (int)$t['id'],
                        'fine_type'   => $t['fine_type'],
                        'amount_paid' => (float)$take,
                        'status'      => $status,
                    ];
                }

                return ['ok' => true, 'data' => [
                    'receipt_no'   => $receiptNo,
                    'member_id'    => (int)$memberId,
                    'total_paid'   => (float)$this->money((float)$amountIn - (float)$remaining),
                    'method'       => $method,
                    'collected_by' => $actor,
                    'paid_at'      => date('Y-m-d H:i:s'),
                    'applied'      => $applied,
                ]];
            });
        } catch (\Throwable $e) {
            Log::error('collectPayment failed: ' . $e->getMessage());
            $this->fail(500, 'Payment was not recorded. Nothing was charged.', 'SERVER_ERROR');

            return;
        }

        if (($result['ok'] ?? false) !== true) {
            $err = $result['error'];
            $this->fail($err['code'] === 'NOT_FOUND' ? 404 : 409, $err['message'], $err['code']);

            return;
        }

        $data = $result['data'];
        $this->audit('fine_payment', null, 'collect', null, $data);

        // Clearing a fine can unblock borrowing, so hand back fresh standing —
        // the desk usually collects the fine in order to issue the next book.
        $member = $this->db()->execute(
            'SELECT * FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [(int)$data['member_id'], $clientCode]
        )->fetch('assoc');

        $this->ok(
            array_merge($data, [
                'currency' => $settings['currency_symbol'] ?? '',
                'member'   => $member ? $this->memberSummary($clientCode, $member) : null,
            ]),
            null,
            'Payment recorded — receipt ' . $data['receipt_no'] . '.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // WAIVE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryFineApi/waive
     * Body: { fine_id*, amount, reason* }
     *
     * Omit `amount` to waive the whole balance. Admin only, reason mandatory,
     * always audited — waiving is writing off money, and the one thing an
     * auditor will ask is who approved it and why.
     */
    public function waive(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $body   = (array)$this->request->getData();
        $fineId = $this->intOrNull($body, 'fine_id');
        $reason = $this->str($body, 'reason');
        $amount = $this->decOrNull($body, 'amount');

        if (!$fineId) {
            $this->invalid('A fine must be selected.', ['fine_id' => 'Required']);

            return;
        }
        if ($reason === '') {
            $this->invalid('A reason is required to waive a fine.', ['reason' => 'Required']);

            return;
        }

        $actor = $this->actor();

        try {
            $result = $this->transact(function () use ($clientCode, $fineId, $amount, $reason, $actor) {
                $db = $this->db();

                $fine = $db->execute(
                    'SELECT * FROM lib_fines WHERE id = ? AND ssms_client_code = ? LIMIT 1 FOR UPDATE',
                    [$fineId, $clientCode]
                )->fetch('assoc');

                if (!$fine) {
                    return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Fine not found.']];
                }

                $balance = $this->money(
                    (float)$fine['amount'] - (float)$fine['paid_amount'] - (float)$fine['waived_amount']
                );

                if ((float)$balance <= 0) {
                    return ['ok' => false, 'error' => [
                        'code' => 'ALREADY_SETTLED', 'message' => 'This fine has nothing left to waive.',
                    ]];
                }

                $waive = $amount ?? $balance;
                if ((float)$waive <= 0) {
                    return ['ok' => false, 'error' => ['code' => 'VALIDATION', 'message' => 'Enter an amount greater than zero.']];
                }
                if ((float)$waive > (float)$balance) {
                    return ['ok' => false, 'error' => [
                        'code' => 'OVERPAYMENT', 'message' => 'That is more than the ' . $balance . ' outstanding.',
                    ]];
                }

                $newWaived = $this->money((float)$fine['waived_amount'] + (float)$waive);

                $db->execute(
                    "UPDATE lib_fines
                     SET    waived_amount = ?, waived_by = ?,
                            waive_reason = CONCAT(COALESCE(waive_reason, ''), ?)
                     WHERE  id = ? AND ssms_client_code = ?",
                    [
                        $newWaived, $actor,
                        ($fine['waive_reason'] ? "\n" : '') . date('Y-m-d') . ' — ' . $reason,
                        $fineId, $clientCode,
                    ]
                );

                $status = $this->recomputeFine($fineId, $db);

                return ['ok' => true, 'data' => [
                    'fine_id'       => $fineId,
                    'member_id'     => (int)$fine['member_id'],
                    'waived'        => (float)$waive,
                    'waived_total'  => (float)$newWaived,
                    'status'        => $status,
                    'waived_by'     => $actor,
                ], 'before' => $fine];
            });
        } catch (\Throwable $e) {
            Log::error('waive failed: ' . $e->getMessage());
            $this->fail(500, 'The waiver was not recorded. Nothing was changed.', 'SERVER_ERROR');

            return;
        }

        if (($result['ok'] ?? false) !== true) {
            $err = $result['error'];
            $this->fail(
                $err['code'] === 'NOT_FOUND' ? 404 : ($err['code'] === 'VALIDATION' ? 422 : 409),
                $err['message'],
                $err['code']
            );

            return;
        }

        $this->audit('fine', $fineId, 'waive', $result['before'], array_merge($result['data'], ['reason' => $reason]));

        $settings = $this->settings($clientCode);
        $this->ok(
            array_merge($result['data'], ['currency' => $settings['currency_symbol'] ?? '']),
            null,
            'Waived ' . ($settings['currency_symbol'] ?? '') . $this->money($result['data']['waived']) . '.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MANUAL FINE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryFineApi/createFine
     * Body: { member_id*, fine_type* (Overdue|Lost|Damaged), amount*,
     *         checkout_id, notes }
     *
     * For charges that do not arise from a return — a torn page spotted on the
     * shelf, a replacement charged after the fact.
     */
    public function createFine(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body     = (array)$this->request->getData();
        $memberId = $this->intOrNull($body, 'member_id');
        $type     = $this->str($body, 'fine_type');
        $amount   = $this->decOrNull($body, 'amount');
        $notes    = $this->str($body, 'notes');

        if (!$memberId) {
            $this->invalid('A member must be selected.', ['member_id' => 'Required']);

            return;
        }
        if (!in_array($type, ['Overdue', 'Lost', 'Damaged'], true)) {
            $this->invalid('Fine type must be Overdue, Lost or Damaged.', ['fine_type' => 'Invalid']);

            return;
        }
        if ($amount === null || (float)$amount <= 0) {
            $this->invalid('Enter an amount greater than zero.', ['amount' => 'Required']);

            return;
        }

        $db = $this->db();

        $member = $db->execute(
            'SELECT id, full_name FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$memberId, $clientCode]
        )->fetch('assoc');

        if (!$member) {
            $this->notFound('Member');

            return;
        }

        $checkoutId = $this->intOrNull($body, 'checkout_id');
        if ($checkoutId) {
            $ok = $db->execute(
                'SELECT id FROM lib_checkouts WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                [$checkoutId, $clientCode]
            )->fetch('assoc');

            if (!$ok) {
                $this->notFound('Checkout');

                return;
            }
        }

        $db->execute(
            'INSERT INTO lib_fines
                (ssms_client_code, checkout_id, member_id, fine_type, amount, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$clientCode, $checkoutId, $memberId, $type, $amount, 'Pending', $notes ?: null]
        );
        $fineId = $this->insertId();

        $settings = $this->settings($clientCode);

        $this->queueNotification(
            $clientCode,
            $memberId,
            'FineIssued',
            $fineId,
            'A ' . strtolower($type) . ' charge of ' . ($settings['currency_symbol'] ?? '')
            . $amount . ' has been added to your library account.'
        );

        $this->audit('fine', $fineId, 'create', null, ['type' => $type, 'amount' => $amount, 'notes' => $notes]);

        $this->ok(
            ['fine_id' => $fineId, 'member_id' => $memberId, 'amount' => (float)$amount, 'status' => 'Pending'],
            null,
            'Charge added to ' . $member['full_name'] . '.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RECEIPTS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryFineApi/receipt?no=RCP2600014
     *
     * One receipt number can span several fines, so this returns every line
     * under it plus the school header — everything the printable receipt needs
     * in one call.
     */
    public function receipt(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $no = $this->q('no');
        if ($no === null) {
            $this->invalid('A receipt number is required.', ['no' => 'Required']);

            return;
        }

        $db = $this->db();

        $lines = $db->execute(
            'SELECT p.id, p.fine_id, p.amount_paid, p.payment_method, p.receipt_no,
                    p.collected_by, p.paid_at, p.notes,
                    f.fine_type, f.days_overdue, f.amount AS fine_amount, f.member_id,
                    b.title, cp.accession_no
             FROM   lib_fine_payments p
             JOIN   lib_fines f             ON f.id  = p.fine_id
             LEFT   JOIN lib_checkouts ck   ON ck.id = f.checkout_id
             LEFT   JOIN lib_book_copies cp ON cp.id = ck.copy_id
             LEFT   JOIN lib_books b        ON b.id  = cp.book_id
             WHERE  p.receipt_no = ? AND f.ssms_client_code = ?
             ORDER  BY p.id ASC',
            [$no, $clientCode]
        )->fetchAll('assoc');

        if ($lines === []) {
            $this->notFound('Receipt');

            return;
        }

        $member = $db->execute(
            'SELECT id, membership_no, full_name, member_type, class_section
             FROM   lib_members WHERE id = ? LIMIT 1',
            [(int)$lines[0]['member_id']]
        )->fetch('assoc');

        $school = $db->execute(
            'SELECT ssms_client_header_text FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1',
            [$clientCode]
        )->fetch('assoc');

        $settings = $this->settings($clientCode);

        $this->ok([
            'receipt_no'   => $no,
            'paid_at'      => $lines[0]['paid_at'],
            'collected_by' => $lines[0]['collected_by'],
            'method'       => $lines[0]['payment_method'],
            'member'       => $member ? $this->castRow($member, ['id']) : null,
            'schoolName'   => $school['ssms_client_header_text'] ?? '',
            'currency'     => $settings['currency_symbol'] ?? '',
            'lines'        => $this->castRows(
                $lines,
                ['id', 'fine_id', 'days_overdue', 'member_id'],
                ['amount_paid', 'fine_amount']
            ),
            'total'        => (float)array_sum(array_map(fn($l) => (float)$l['amount_paid'], $lines)),
        ]);
    }

    /**
     * POST /libraryFineApi/reversePayment
     * Body: { payment_id*, reason* }
     *
     * Money gets entered wrong. Deleting the row would leave a receipt in the
     * member's hand with no record behind it, so the payment is removed and the
     * fine recomputed, with the original captured in the audit log.
     *
     * Admin only.
     */
    public function reversePayment(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $body      = (array)$this->request->getData();
        $paymentId = $this->intOrNull($body, 'payment_id');
        $reason    = $this->str($body, 'reason');

        if (!$paymentId) {
            $this->invalid('A payment must be selected.', ['payment_id' => 'Required']);

            return;
        }
        if ($reason === '') {
            $this->invalid('A reason is required to reverse a payment.', ['reason' => 'Required']);

            return;
        }

        $db = $this->db();

        $payment = $db->execute(
            'SELECT p.*, f.ssms_client_code
             FROM   lib_fine_payments p
             JOIN   lib_fines f ON f.id = p.fine_id
             WHERE  p.id = ? AND f.ssms_client_code = ?
             LIMIT  1',
            [$paymentId, $clientCode]
        )->fetch('assoc');

        if (!$payment) {
            $this->notFound('Payment');

            return;
        }

        $fineId = (int)$payment['fine_id'];

        $status = $this->transact(function () use ($db, $paymentId, $fineId) {
            $db->execute('DELETE FROM lib_fine_payments WHERE id = ?', [$paymentId]);

            return $this->recomputeFine($fineId, $db);
        });

        $this->audit('fine_payment', $paymentId, 'reverse', $payment, ['reason' => $reason]);

        $this->ok(
            ['payment_id' => $paymentId, 'fine_id' => $fineId, 'status' => $status],
            null,
            'Payment reversed.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // COLLECTION SUMMARY
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryFineApi/collectionSummary?from=&to=
     *
     * What was collected, by whom, and how — the cash-up a librarian does at the
     * end of a shift and the register an auditor asks for. Defaults to today.
     */
    public function collectionSummary(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $from = date('Y-m-d 00:00:00', strtotime($this->q('from') ?? 'today') ?: time());
        $to   = date('Y-m-d 23:59:59', strtotime($this->q('to') ?? ($this->q('from') ?? 'today')) ?: time());

        $db = $this->db();

        $totals = $db->execute(
            // `lines` is reserved in MySQL/MariaDB (LOAD DATA ... LINES
            // TERMINATED BY), so the alias has to be quoted. Keeping the name
            // rather than renaming it leaves the JSON contract untouched.
            'SELECT COUNT(DISTINCT p.receipt_no) AS receipts,
                    COUNT(*) AS `lines`,
                    COALESCE(SUM(p.amount_paid), 0) AS collected
             FROM   lib_fine_payments p
             JOIN   lib_fines f ON f.id = p.fine_id
             WHERE  f.ssms_client_code = ? AND p.paid_at BETWEEN ? AND ?',
            [$clientCode, $from, $to]
        )->fetch('assoc') ?: [];

        $byMethod = $db->execute(
            'SELECT p.payment_method, COUNT(*) AS `lines`, COALESCE(SUM(p.amount_paid), 0) AS collected
             FROM   lib_fine_payments p
             JOIN   lib_fines f ON f.id = p.fine_id
             WHERE  f.ssms_client_code = ? AND p.paid_at BETWEEN ? AND ?
             GROUP  BY p.payment_method
             ORDER  BY collected DESC',
            [$clientCode, $from, $to]
        )->fetchAll('assoc');

        $byCollector = $db->execute(
            'SELECT p.collected_by, COUNT(DISTINCT p.receipt_no) AS receipts,
                    COALESCE(SUM(p.amount_paid), 0) AS collected
             FROM   lib_fine_payments p
             JOIN   lib_fines f ON f.id = p.fine_id
             WHERE  f.ssms_client_code = ? AND p.paid_at BETWEEN ? AND ?
             GROUP  BY p.collected_by
             ORDER  BY collected DESC',
            [$clientCode, $from, $to]
        )->fetchAll('assoc');

        $waived = $db->execute(
            'SELECT COALESCE(SUM(waived_amount), 0) AS waived, COUNT(*) AS count
             FROM   lib_fines
             WHERE  ssms_client_code = ? AND waived_amount > 0 AND updated_at BETWEEN ? AND ?',
            [$clientCode, $from, $to]
        )->fetch('assoc') ?: [];

        $outstanding = $db->execute(
            "SELECT COALESCE(SUM(amount - paid_amount - waived_amount), 0) AS outstanding,
                    COUNT(*) AS count
             FROM   lib_fines
             WHERE  ssms_client_code = ? AND status IN ('Pending','Partial')",
            [$clientCode]
        )->fetch('assoc') ?: [];

        $settings = $this->settings($clientCode);

        $this->ok([
            'from'        => substr($from, 0, 10),
            'to'          => substr($to, 0, 10),
            'currency'    => $settings['currency_symbol'] ?? '',
            'collected'   => (float)($totals['collected'] ?? 0),
            'receipts'    => (int)($totals['receipts'] ?? 0),
            'lines'       => (int)($totals['lines'] ?? 0),
            'byMethod'    => $this->castRows($byMethod, ['lines'], ['collected']),
            'byCollector' => $this->castRows($byCollector, ['receipts'], ['collected']),
            'waived'      => [
                'amount' => (float)($waived['waived'] ?? 0),
                'count'  => (int)($waived['count'] ?? 0),
            ],
            'outstanding' => [
                'amount' => (float)($outstanding['outstanding'] ?? 0),
                'count'  => (int)($outstanding['count'] ?? 0),
            ],
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SHARED
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Recompute paid_amount from the payment rows and derive the status.
     *
     * paid_amount is rebuilt with SUM() rather than incremented in place, so the
     * fine row can never drift out of step with its own receipts — including
     * after a reversal.
     *
     *   outstanding <= 0  →  Paid   (money was taken)
     *                        Waived (nothing was taken, it was written off)
     *   anything settled  →  Partial
     *   nothing settled   →  Pending
     */
    private function recomputeFine(int $fineId, $db): string
    {
        $db->execute(
            'UPDATE lib_fines f
             SET    f.paid_amount = COALESCE(
                        (SELECT SUM(p.amount_paid) FROM lib_fine_payments p WHERE p.fine_id = f.id), 0)
             WHERE  f.id = ?',
            [$fineId]
        );

        $row = $db->execute(
            'SELECT amount, paid_amount, waived_amount FROM lib_fines WHERE id = ? LIMIT 1',
            [$fineId]
        )->fetch('assoc');

        if (!$row) {
            return 'Pending';
        }

        $paid   = (float)$row['paid_amount'];
        $waived = (float)$row['waived_amount'];
        // Compare in whole cents to keep the decision away from float wobble.
        $outstanding = (int)round(((float)$row['amount'] - $paid - $waived) * 100);

        if ($outstanding <= 0) {
            $status = $paid > 0 ? 'Paid' : 'Waived';
        } elseif ($paid > 0 || $waived > 0) {
            $status = 'Partial';
        } else {
            $status = 'Pending';
        }

        $db->execute('UPDATE lib_fines SET status = ? WHERE id = ?', [$status, $fineId]);

        return $status;
    }

    /**
     * Receipt numbers are PREFIX + 2-digit year + 5-digit sequence, restarting
     * each year — the shape most school accounts offices already file by.
     *
     * Numbers already taken are skipped, the same way accession and membership
     * numbers are generated. Two desks committing in the same instant could in
     * principle still read the same MAX(); with one or two counters that is
     * vanishingly unlikely, and the alternative (a sequence table locked on every
     * payment) costs more than it protects. If you ever run many concurrent
     * collection points, move this to a dedicated counter row with FOR UPDATE.
     */
    private function generateReceiptNo(string $clientCode, array $settings): string
    {
        $db     = $this->db();
        $prefix = ((string)($settings['receipt_prefix'] ?? '') ?: 'RCP') . date('y');

        $row = $db->execute(
            'SELECT MAX(CAST(SUBSTRING(p.receipt_no, ?) AS UNSIGNED)) AS mx
             FROM   lib_fine_payments p
             JOIN   lib_fines f ON f.id = p.fine_id
             WHERE  f.ssms_client_code = ? AND p.receipt_no LIKE ?',
            [strlen($prefix) + 1, $clientCode, $this->like($prefix, 'prefix')]
        )->fetch('assoc');

        $seq = (int)($row['mx'] ?? 0);

        do {
            $seq++;
            $candidate = $prefix . str_pad((string)$seq, 5, '0', STR_PAD_LEFT);
            $taken = $db->execute(
                'SELECT p.id FROM lib_fine_payments p
                 JOIN   lib_fines f ON f.id = p.fine_id
                 WHERE  f.ssms_client_code = ? AND p.receipt_no = ? LIMIT 1',
                [$clientCode, $candidate]
            )->fetch('assoc');
        } while ($taken);

        return $candidate;
    }
}
