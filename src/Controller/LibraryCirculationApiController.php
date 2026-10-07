<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;
use Cake\Log\Log;

/**
 * LibraryCirculationApiController
 * File: src/Controller/LibraryCirculationApiController.php
 *
 * Owns: lib_checkouts, lib_renewals, lib_reservations
 * Writes (inside the same transactions): lib_book_copies.status,
 *        lib_books.available_copies / times_issued, lib_fines, lib_notifications
 *
 * This is the transactional core of the system. Every state change here touches
 * three to five tables, and a partial write corrupts inventory in a way that is
 * not self-healing — a copy stuck on "Issued" with no checkout row can never be
 * returned, and a decremented counter never recovers. So:
 *
 *   - every mutation runs inside transact()
 *   - the copy row is locked with SELECT ... FOR UPDATE before it is read,
 *     so two librarians scanning the same book cannot both succeed
 *   - counters are refreshed from lib_book_copies inside the same transaction
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibraryCirculationApi' to $apiControllers in AppController.php
 *   3. Paste the circulation block from api/routes.snippet.php into config/routes.php
 */
class LibraryCirculationApiController extends AppController
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

    // ══════════════════════════════════════════════════════════════════════════
    // LIST + DETAIL
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryCirculationApi/checkouts
     *
     * Query: status (out|overdue|returned|lost|all), memberId, q, from, to,
     *        classSection, sort (dueDate|issueDate|member|title), page, limit
     *
     * `out` means Active or Overdue — the two enum values that both mean "the
     * book is not back yet". Keeping them separate in the database is useful for
     * reporting, but no screen ever wants only one of them.
     */
    public function checkouts(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        // Interpolated, not bound — see the note in LibraryCatalogApiController::books().
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['ck.ssms_client_code = ?'];
        $params = [$clientCode];

        switch ($this->q('status', 'out')) {
            case 'overdue':
                $where[] = "ck.status IN ('Active','Overdue') AND ck.due_date < CURDATE()";
                break;
            case 'returned':
                $where[] = "ck.status = 'Returned'";
                break;
            case 'lost':
                $where[] = "ck.status = 'Lost'";
                break;
            case 'all':
                break;
            default:
                $where[] = "ck.status IN ('Active','Overdue')";
        }

        if (($v = $this->qInt('memberId')) !== null) {
            $where[] = 'ck.member_id = ?';
            $params[] = $v;
        }
        if (($v = $this->q('classSection')) !== null) {
            $where[] = 'm.class_section = ?';
            $params[] = $v;
        }
        if (($v = $this->q('from')) !== null) {
            $where[] = 'ck.issue_date >= ?';
            $params[] = date('Y-m-d', strtotime($v) ?: time());
        }
        if (($v = $this->q('to')) !== null) {
            $where[] = 'ck.issue_date <= ?';
            $params[] = date('Y-m-d', strtotime($v) ?: time());
        }
        if (($v = $this->q('q')) !== null) {
            $where[] = '(m.full_name LIKE ? OR m.membership_no LIKE ?
                         OR b.title LIKE ? OR cp.accession_no LIKE ? OR cp.barcode LIKE ?)';
            array_push(
                $params,
                $this->like($v),
                $this->like($v, 'prefix'),
                $this->like($v),
                $this->like($v, 'prefix'),
                $this->like($v, 'prefix')
            );
        }

        $whereSql = implode(' AND ', $where);

        $orderBy = match ($this->q('sort', 'dueDate')) {
            'issueDate' => 'ck.issue_date DESC, ck.id DESC',
            'member'    => 'm.full_name ASC, ck.due_date ASC',
            'title'     => 'b.title ASC, ck.due_date ASC',
            default     => 'ck.due_date ASC, ck.id ASC',
        };

        $db = $this->db();

        $joins = 'JOIN lib_members m      ON m.id  = ck.member_id
                  JOIN lib_book_copies cp ON cp.id = ck.copy_id
                  JOIN lib_books b        ON b.id  = cp.book_id';

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_checkouts ck {$joins} WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        if ($total === 0) {
            $this->ok([], $this->paginationMeta($page, $limit, 0));

            return;
        }

        $rows = $db->execute(
            "SELECT ck.id, ck.member_id, ck.copy_id, ck.issue_date, ck.due_date,
                    ck.return_date, ck.renewals_count, ck.status, ck.issued_by,
                    ck.returned_to, ck.condition_on_return,
                    DATEDIFF(CURDATE(), ck.due_date) AS days_late,
                    m.membership_no, m.full_name AS member_name, m.member_type,
                    m.class_section, m.photo AS member_photo,
                    cp.accession_no, cp.barcode,
                    b.id AS book_id, b.title, b.cover_image,
                    (SELECT COALESCE(SUM(f.amount - f.paid_amount - f.waived_amount), 0)
                       FROM lib_fines f
                      WHERE f.checkout_id = ck.id AND f.status IN ('Pending','Partial')) AS fine_due
             FROM   lib_checkouts ck
             {$joins}
             WHERE  {$whereSql}
             ORDER  BY {$orderBy}
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        foreach ($rows as &$r) {
            $r = $this->castRow(
                $r,
                ['id', 'member_id', 'copy_id', 'book_id', 'renewals_count', 'days_late'],
                ['fine_due']
            );
            // Negative means not yet due; the UI only ever wants the positive part.
            $r['days_late']  = max(0, (int)$r['days_late']);
            $r['is_overdue'] = $r['days_late'] > 0 && $r['return_date'] === null;
        }
        unset($r);

        $this->ok($rows, $this->paginationMeta($page, $limit, $total));
    }

    /**
     * GET /libraryCirculationApi/checkout/{id}
     * The full timeline: issue, every renewal, return, and any fine raised.
     */
    public function checkout(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $checkoutId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            "SELECT ck.*, DATEDIFF(CURDATE(), ck.due_date) AS days_late,
                    m.membership_no, m.full_name AS member_name, m.member_type,
                    m.class_section, m.photo AS member_photo,
                    cp.accession_no, cp.barcode, cp.shelf_location, cp.condition_grade,
                    b.id AS book_id, b.title, b.subtitle, b.isbn, b.cover_image
             FROM   lib_checkouts ck
             JOIN   lib_members m      ON m.id  = ck.member_id
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             WHERE  ck.id = ? AND ck.ssms_client_code = ?
             LIMIT  1",
            [$checkoutId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Checkout');

            return;
        }

        $renewals = $db->execute(
            'SELECT id, old_due_date, new_due_date, renewed_by, renewed_at
             FROM   lib_renewals WHERE checkout_id = ? ORDER BY id ASC',
            [$checkoutId]
        )->fetchAll('assoc');

        $fines = $db->execute(
            'SELECT id, fine_type, days_overdue, amount, paid_amount, waived_amount, status, created_at,
                    (amount - paid_amount - waived_amount) AS balance
             FROM   lib_fines WHERE checkout_id = ? ORDER BY id ASC',
            [$checkoutId]
        )->fetchAll('assoc');

        $row = $this->castRow($row, ['id', 'member_id', 'copy_id', 'book_id', 'renewals_count', 'days_late']);
        $row['days_late'] = max(0, (int)$row['days_late']);

        $settings = $this->settings($clientCode);

        $this->ok([
            'checkout'    => $row,
            'renewals'    => $this->castRows($renewals, ['id']),
            'fines'       => $this->castRows(
                $fines,
                ['id', 'days_overdue'],
                ['amount', 'paid_amount', 'waived_amount', 'balance']
            ),
            'maxRenewals' => (int)($settings['max_renewals'] ?? 2),
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ⭐ ISSUE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryCirculationApi/issue
     *
     * Body: { member_id | member_code,
     *         copies: [ id | barcode | accession_no, ... ]   (or copy_id / copy_code) }
     *
     * Accepts a batch because that is how the desk works: scan the card, scan
     * four books, confirm once.
     *
     * Each copy is issued in its own transaction and reported separately, so one
     * reference-only book does not throw away the three that were fine. The
     * response is always a per-item list:
     *
     *   { issued: [...], failed: [{ code, message, ... }], issuedCount, failedCount }
     *
     * Every eligibility rule is enforced here, not in the app. Two devices must
     * never be able to disagree about whether a loan was allowed.
     */
    public function issue(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();

        $member = $this->resolveMember($clientCode, $body);
        if (!$member) {
            $this->fail(404, 'Member not found.', 'NOT_FOUND');

            return;
        }

        $refs = $this->copyRefs($body);
        if ($refs === []) {
            $this->invalid('Scan or select at least one book.', ['copies' => 'Required']);

            return;
        }

        $settings  = $this->settings($clientCode);
        $memberId  = (int)$member['id'];
        $issueDate = $this->dateOrNull($body, 'issue_date') ?? date('Y-m-d');
        $actor     = $this->actor();

        // Standing is read once. booksOut is then incremented locally as the
        // batch proceeds, so scanning a fourth book against a 3-book limit fails
        // on the fourth rather than letting all four through.
        $summary  = $this->memberSummary($clientCode, $member);
        $booksOut = (int)$summary['loans']['out'];
        $maxBooks = (int)$summary['loans']['maxBooks'];

        // Blocks that apply to the member rather than to a specific copy fail the
        // whole batch — there is no point reporting the same reason four times.
        // The limit is the exception: it is reported per copy below, so scanning
        // a fourth book against a 3-book limit still issues the first three.
        if ($summary['blockedCode'] !== null && $summary['blockedCode'] !== 'LIMIT_REACHED') {
            $this->fail(409, (string)$summary['blockedReason'], (string)$summary['blockedCode']);

            return;
        }

        $issued = [];
        $failed = [];

        foreach ($refs as $ref) {
            if ($booksOut >= $maxBooks) {
                $failed[] = [
                    'ref'     => $ref,
                    'code'    => 'LIMIT_REACHED',
                    'message' => 'Book limit reached (' . $maxBooks . ').',
                ];
                continue;
            }

            try {
                $result = $this->transact(function () use (
                    $clientCode, $memberId, $ref, $issueDate, $settings, $actor, $member
                ) {
                    return $this->issueOne($clientCode, $memberId, $ref, $issueDate, $settings, $actor, $member);
                });
            } catch (\Throwable $e) {
                Log::error('issue failed for ' . $ref . ': ' . $e->getMessage());
                $failed[] = [
                    'ref'     => $ref,
                    'code'    => 'SERVER_ERROR',
                    'message' => 'Could not issue this book. Nothing was changed.',
                ];
                continue;
            }

            if (($result['ok'] ?? false) === true) {
                $issued[] = $result['data'];
                $booksOut++;
            } else {
                $failed[] = array_merge(['ref' => $ref], $result['error']);
            }
        }

        $this->ok(
            [
                'member'       => $this->memberSummary($clientCode, $this->reloadMember($clientCode, $memberId) ?: $member),
                'issued'       => $issued,
                'failed'       => $failed,
                'issuedCount'  => count($issued),
                'failedCount'  => count($failed),
            ],
            null,
            count($issued) . ' of ' . count($refs) . ' issued.'
        );
    }

    /**
     * One copy, inside a transaction. Returns ['ok'=>true,'data'=>...] or
     * ['ok'=>false,'error'=>['code'=>..,'message'=>..]].
     *
     * Business rules are checked in the order a librarian would explain them.
     */
    private function issueOne(
        string $clientCode,
        int $memberId,
        string $ref,
        string $issueDate,
        array $settings,
        string $actor,
        array $member
    ): array {
        $db = $this->db();

        // FOR UPDATE is the whole point: it serialises two librarians scanning
        // the same copy at the same moment. Without it both read "Available",
        // both insert a checkout, and the copy is issued twice.
        //
        // The lock is deliberately taken on lib_book_copies alone. Locking
        // through a JOIN would also lock the lib_books row, serialising every
        // copy of the same title against each other, and `FOR UPDATE OF` is not
        // available on MySQL 5.7. Book fields are read separately, unlocked.
        $copy = $db->execute(
            'SELECT * FROM lib_book_copies
             WHERE  ssms_client_code = ?
               AND  (id = ? OR barcode = ? OR accession_no = ?)
             LIMIT  1
             FOR UPDATE',
            [$clientCode, ctype_digit($ref) ? (int)$ref : 0, $ref, $ref]
        )->fetch('assoc');

        if (!$copy) {
            return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'No copy matches "' . $ref . '".']];
        }

        $copyId = (int)$copy['id'];
        $bookId = (int)$copy['book_id'];

        $book = $db->execute(
            'SELECT id, title, is_reference FROM lib_books WHERE id = ? LIMIT 1',
            [$bookId]
        )->fetch('assoc');

        if (!$book) {
            return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Catalogue record missing for this copy.']];
        }

        $copy['title'] = $book['title'];

        if ((int)$book['is_reference'] === 1) {
            return ['ok' => false, 'error' => [
                'code'    => 'REFERENCE_ONLY',
                'message' => '"' . $copy['title'] . '" is reference-only and cannot be borrowed.',
            ]];
        }

        if ($copy['status'] === 'Issued') {
            $holder = $db->execute(
                "SELECT m.full_name, ck.due_date
                 FROM   lib_checkouts ck
                 JOIN   lib_members m ON m.id = ck.member_id
                 WHERE  ck.copy_id = ? AND ck.status IN ('Active','Overdue')
                 ORDER  BY ck.id DESC LIMIT 1",
                [$copyId]
            )->fetch('assoc');

            return ['ok' => false, 'error' => [
                'code'    => 'ALREADY_ISSUED',
                'message' => $holder
                    ? 'Already issued to ' . $holder['full_name'] . ', due ' . $holder['due_date'] . '.'
                    : 'This copy is already issued.',
            ]];
        }

        if (!in_array($copy['status'], ['Available', 'Reserved'], true)) {
            return ['ok' => false, 'error' => [
                'code'    => 'NOT_AVAILABLE',
                'message' => 'This copy is marked ' . strtolower((string)$copy['status']) . '.',
            ]];
        }

        // A copy trapped for someone else's hold must not be handed to whoever
        // walks up next — that is how hold queues lose all credibility.
        $hold = $db->execute(
            "SELECT r.id, r.member_id, r.queue_position, m.full_name
             FROM   lib_reservations r
             JOIN   lib_members m ON m.id = r.member_id
             WHERE  r.book_id = ? AND r.status IN ('Waiting','Notified')
               AND  (r.copy_id IS NULL OR r.copy_id = ?)
             ORDER  BY r.queue_position ASC, r.id ASC
             LIMIT  1",
            [$bookId, $copyId]
        )->fetch('assoc');

        if ($hold && (int)$hold['member_id'] !== $memberId) {
            return ['ok' => false, 'error' => [
                'code'    => 'HOLD_FOR_OTHER',
                'message' => 'Held for ' . $hold['full_name'] . ' (position ' . $hold['queue_position'] . ').',
            ]];
        }

        $days    = $this->loanPeriodFor((string)$member['member_type'], $settings);
        $dueDate = $this->dueDate($issueDate, $days, $settings);

        $db->execute(
            'INSERT INTO lib_checkouts
                (ssms_client_code, member_id, copy_id, issue_date, due_date, issued_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$clientCode, $memberId, $copyId, $issueDate, $dueDate, $actor, 'Active']
        );
        $checkoutId = $this->insertId();

        $db->execute(
            "UPDATE lib_book_copies SET status = 'Issued' WHERE id = ? AND ssms_client_code = ?",
            [$copyId, $clientCode]
        );

        // Counters are a cache over lib_book_copies — refreshed in the same
        // transaction, never after it.
        $this->syncBookCounters($bookId, $db);
        $db->execute('UPDATE lib_books SET times_issued = times_issued + 1 WHERE id = ?', [$bookId]);

        // Issuing to the member who was holding it fulfils the hold.
        if ($hold && (int)$hold['member_id'] === $memberId) {
            $db->execute(
                "UPDATE lib_reservations SET status = 'Fulfilled', copy_id = ? WHERE id = ?",
                [$copyId, (int)$hold['id']]
            );
            $this->resequenceQueue($bookId, $db);
        }

        return ['ok' => true, 'data' => [
            'checkout_id'  => $checkoutId,
            'copy_id'      => $copyId,
            'book_id'      => $bookId,
            'accession_no' => $copy['accession_no'],
            'title'        => $copy['title'],
            'issue_date'   => $issueDate,
            'due_date'     => $dueDate,
        ]];
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ⭐ RETURN
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryCirculationApi/return   (action name is returnBook —
     * "return" is a PHP reserved word and cannot be a method name)
     *
     * Body: { copies: [ id | barcode | accession_no, ... ]  (or copy_id / copy_code),
     *         condition (Good|Fair|Poor|Damaged), damage_fine, notes, return_date }
     *
     * Return does five things atomically: closes the checkout, sets the copy's
     * new state from its condition, refreshes the counters, raises an overdue
     * fine if late, and either traps the copy for the next hold or puts it back
     * on the shelf.
     *
     * Returning is deliberately permissive about who scans it — the book is
     * physically here, so refusing to accept it helps nobody.
     */
    public function returnBook(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();
        $refs = $this->copyRefs($body);

        if ($refs === []) {
            $this->invalid('Scan or select at least one book.', ['copies' => 'Required']);

            return;
        }

        $condition  = $this->str($body, 'condition') ?: 'Good';
        if (!in_array($condition, ['Good', 'Fair', 'Poor', 'Damaged'], true)) {
            $this->invalid('Condition must be Good, Fair, Poor or Damaged.', ['condition' => 'Invalid']);

            return;
        }

        $returnDate = $this->dateOrNull($body, 'return_date') ?? date('Y-m-d');
        $damageFine = $this->decOrNull($body, 'damage_fine');
        $notes      = $this->str($body, 'notes');
        $settings   = $this->settings($clientCode);
        $actor      = $this->actor();

        $returned = [];
        $failed   = [];

        foreach ($refs as $ref) {
            try {
                $result = $this->transact(function () use (
                    $clientCode, $ref, $returnDate, $condition, $damageFine, $notes, $settings, $actor
                ) {
                    return $this->returnOne(
                        $clientCode, $ref, $returnDate, $condition, $damageFine, $notes, $settings, $actor
                    );
                });
            } catch (\Throwable $e) {
                Log::error('return failed for ' . $ref . ': ' . $e->getMessage());
                $failed[] = ['ref' => $ref, 'code' => 'SERVER_ERROR',
                             'message' => 'Could not return this book. Nothing was changed.'];
                continue;
            }

            if (($result['ok'] ?? false) === true) {
                $returned[] = $result['data'];
            } else {
                $failed[] = array_merge(['ref' => $ref], $result['error']);
            }
        }

        $this->ok(
            [
                'returned'      => $returned,
                'failed'        => $failed,
                'returnedCount' => count($returned),
                'failedCount'   => count($failed),
                'totalFine'     => array_sum(array_column($returned, 'fine_amount')),
                'currency'      => $settings['currency_symbol'] ?? '',
            ],
            null,
            count($returned) . ' of ' . count($refs) . ' returned.'
        );
    }

    private function returnOne(
        string $clientCode,
        string $ref,
        string $returnDate,
        string $condition,
        ?string $damageFine,
        string $notes,
        array $settings,
        string $actor
    ): array {
        $db = $this->db();

        // Single-table lock — see the note in issueOne().
        $copy = $db->execute(
            'SELECT * FROM lib_book_copies
             WHERE  ssms_client_code = ?
               AND  (id = ? OR barcode = ? OR accession_no = ?)
             LIMIT  1
             FOR UPDATE',
            [$clientCode, ctype_digit($ref) ? (int)$ref : 0, $ref, $ref]
        )->fetch('assoc');

        if (!$copy) {
            return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'No copy matches "' . $ref . '".']];
        }

        $copyId = (int)$copy['id'];
        $bookId = (int)$copy['book_id'];

        $copy['title'] = (string)($db->execute(
            'SELECT title FROM lib_books WHERE id = ? LIMIT 1',
            [$bookId]
        )->fetch('assoc')['title'] ?? '');

        $checkout = $db->execute(
            "SELECT ck.*, m.id AS mem_id, m.full_name, m.membership_no
             FROM   lib_checkouts ck
             JOIN   lib_members m ON m.id = ck.member_id
             WHERE  ck.copy_id = ? AND ck.status IN ('Active','Overdue')
             ORDER  BY ck.id DESC
             LIMIT  1",
            [$copyId]
        )->fetch('assoc');

        if (!$checkout) {
            // Reshelve it anyway. A copy sitting in the returns trolley marked
            // Issued with no checkout row is a data fault, not the member's
            // problem, and blocking here just hides it.
            if ($copy['status'] === 'Issued') {
                $db->execute(
                    "UPDATE lib_book_copies SET status = 'Available' WHERE id = ? AND ssms_client_code = ?",
                    [$copyId, $clientCode]
                );
                $this->syncBookCounters($bookId, $db);
            }

            return ['ok' => false, 'error' => [
                'code'    => 'NOT_ISSUED',
                'message' => '"' . $copy['title'] . '" was not on loan. It has been marked available.',
            ]];
        }

        $checkoutId = (int)$checkout['id'];
        $memberId   = (int)$checkout['mem_id'];

        $daysLate = (int)max(
            0,
            (strtotime($returnDate) - strtotime((string)$checkout['due_date'])) / 86400
        );

        $db->execute(
            "UPDATE lib_checkouts
             SET    return_date = ?, status = ?, returned_to = ?, condition_on_return = ?,
                    notes = CONCAT(COALESCE(notes, ''), ?)
             WHERE  id = ? AND ssms_client_code = ?",
            [
                $returnDate, 'Returned', $actor, $condition,
                $notes !== '' ? "\n" . $returnDate . ' — ' . $notes : '',
                $checkoutId, $clientCode,
            ]
        );

        // ── Where does the copy go now? ───────────────────────────────────────
        // Damaged copies leave circulation. Otherwise, if someone is waiting,
        // the copy is trapped for them rather than reshelved — this is what makes
        // a hold queue actually work.
        $nextHold = null;
        if ($condition === 'Damaged') {
            $newStatus = 'Damaged';
        } else {
            $nextHold = $db->execute(
                "SELECT r.id, r.member_id, m.full_name
                 FROM   lib_reservations r
                 JOIN   lib_members m ON m.id = r.member_id
                 WHERE  r.book_id = ? AND r.status = 'Waiting'
                 ORDER  BY r.queue_position ASC, r.id ASC
                 LIMIT  1",
                [$bookId]
            )->fetch('assoc');

            $newStatus = $nextHold ? 'Reserved' : 'Available';
        }

        $db->execute(
            'UPDATE lib_book_copies SET condition_grade = ?, status = ? WHERE id = ? AND ssms_client_code = ?',
            [$condition === 'Damaged' ? 'Poor' : $condition, $newStatus, $copyId, $clientCode]
        );

        $this->syncBookCounters($bookId, $db);

        // ── Fines ─────────────────────────────────────────────────────────────
        $fineAmount = 0.0;
        $fineId     = null;

        if ($daysLate > 0) {
            $amount = $this->overdueFine($daysLate, $settings);
            if ((float)$amount > 0) {
                // The nightly sweep may already have raised this fine. Update it
                // rather than creating a second one for the same loan.
                $existing = $db->execute(
                    "SELECT id FROM lib_fines
                     WHERE checkout_id = ? AND fine_type = 'Overdue' AND status IN ('Pending','Partial')
                     LIMIT 1",
                    [$checkoutId]
                )->fetch('assoc');

                if ($existing) {
                    $fineId = (int)$existing['id'];
                    $db->execute(
                        'UPDATE lib_fines SET days_overdue = ?, amount = ? WHERE id = ?',
                        [$this->chargeableDays($daysLate, $settings), $amount, $fineId]
                    );
                } else {
                    $db->execute(
                        'INSERT INTO lib_fines
                            (ssms_client_code, checkout_id, member_id, fine_type, days_overdue,
                             amount, status)
                         VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [
                            $clientCode, $checkoutId, $memberId, 'Overdue',
                            $this->chargeableDays($daysLate, $settings), $amount, 'Pending',
                        ]
                    );
                    $fineId = $this->insertId();
                }
                $fineAmount = (float)$amount;
            }
        }

        if ($condition === 'Damaged' && $damageFine !== null && (float)$damageFine > 0) {
            $db->execute(
                'INSERT INTO lib_fines
                    (ssms_client_code, checkout_id, member_id, fine_type, amount, status, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$clientCode, $checkoutId, $memberId, 'Damaged', $damageFine, 'Pending', $notes ?: null]
            );
            $fineAmount += (float)$damageFine;
        }

        // ── Promote the next hold ─────────────────────────────────────────────
        $notified = null;
        if ($nextHold) {
            $hours = (int)($settings['reservation_hold_hours'] ?? 48);
            $db->execute(
                "UPDATE lib_reservations
                 SET    status = 'Notified', copy_id = ?, notified_on = NOW(),
                        collect_by = DATE_ADD(NOW(), INTERVAL ? HOUR)
                 WHERE  id = ?",
                [$copyId, $hours, (int)$nextHold['id']]
            );

            $this->queueNotification(
                $clientCode,
                (int)$nextHold['member_id'],
                'HoldReady',
                (int)$nextHold['id'],
                '"' . $copy['title'] . '" is ready to collect. Please collect within ' . $hours . ' hours.'
            );

            $notified = ['member_id' => (int)$nextHold['member_id'], 'full_name' => $nextHold['full_name']];
        }

        return ['ok' => true, 'data' => [
            'checkout_id'  => $checkoutId,
            'copy_id'      => $copyId,
            'accession_no' => $copy['accession_no'],
            'title'        => $copy['title'],
            'member_id'    => $memberId,
            'member_name'  => $checkout['full_name'],
            'due_date'     => $checkout['due_date'],
            'return_date'  => $returnDate,
            'days_late'    => $daysLate,
            'fine_amount'  => $fineAmount,
            'fine_id'      => $fineId,
            'copy_status'  => $newStatus,
            'holdNotified' => $notified,
        ]];
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RENEW
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryCirculationApi/renew
     * Body: { checkout_ids: [..] } or { checkout_id }
     *
     * A renewal extends from the current due date when the book is not yet due,
     * and from today when it is already late — so renewing an overdue book gives
     * a full fresh loan period rather than a due date in the past.
     *
     * Blocked when someone is waiting for the title: a renewal that jumps a hold
     * queue is how members stop trusting holds.
     */
    public function renew(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();

        $ids = is_array($body['checkout_ids'] ?? null)
            ? array_values(array_filter(array_map('intval', $body['checkout_ids'])))
            : array_values(array_filter([(int)($body['checkout_id'] ?? 0)]));

        if ($ids === []) {
            $this->invalid('Select at least one loan to renew.', ['checkout_ids' => 'Required']);

            return;
        }

        $settings    = $this->settings($clientCode);
        $maxRenewals = (int)($settings['max_renewals'] ?? 2);
        $actor       = $this->actor();

        $renewed = [];
        $failed  = [];

        foreach ($ids as $checkoutId) {
            try {
                $result = $this->transact(function () use ($clientCode, $checkoutId, $settings, $maxRenewals, $actor) {
                    return $this->renewOne($clientCode, $checkoutId, $settings, $maxRenewals, $actor);
                });
            } catch (\Throwable $e) {
                Log::error('renew failed for ' . $checkoutId . ': ' . $e->getMessage());
                $failed[] = ['checkout_id' => $checkoutId, 'code' => 'SERVER_ERROR',
                             'message' => 'Could not renew. Nothing was changed.'];
                continue;
            }

            if (($result['ok'] ?? false) === true) {
                $renewed[] = $result['data'];
            } else {
                $failed[] = array_merge(['checkout_id' => $checkoutId], $result['error']);
            }
        }

        $this->ok(
            [
                'renewed'      => $renewed,
                'failed'       => $failed,
                'renewedCount' => count($renewed),
                'failedCount'  => count($failed),
            ],
            null,
            count($renewed) . ' of ' . count($ids) . ' renewed.'
        );
    }

    private function renewOne(
        string $clientCode,
        int $checkoutId,
        array $settings,
        int $maxRenewals,
        string $actor
    ): array {
        $db = $this->db();

        // Lock the checkout row only — see the note in issueOne().
        $ck = $db->execute(
            'SELECT * FROM lib_checkouts WHERE id = ? AND ssms_client_code = ? LIMIT 1 FOR UPDATE',
            [$checkoutId, $clientCode]
        )->fetch('assoc');

        if (!$ck) {
            return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Loan not found.']];
        }

        $ctx = $db->execute(
            'SELECT cp.book_id, b.title, m.member_type, m.full_name
             FROM   lib_book_copies cp
             JOIN   lib_books b   ON b.id = cp.book_id
             JOIN   lib_members m ON m.id = ?
             WHERE  cp.id = ? LIMIT 1',
            [(int)$ck['member_id'], (int)$ck['copy_id']]
        )->fetch('assoc');

        if (!$ctx) {
            return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Loan record is incomplete.']];
        }

        $ck = array_merge($ck, $ctx);

        if (!in_array($ck['status'], ['Active', 'Overdue'], true)) {
            return ['ok' => false, 'error' => [
                'code'    => 'NOT_ISSUED',
                'message' => 'This loan is already closed.',
            ]];
        }

        if ((int)$ck['renewals_count'] >= $maxRenewals) {
            return ['ok' => false, 'error' => [
                'code'    => 'MAX_RENEWALS',
                'message' => 'Renewal limit reached (' . $maxRenewals . ').',
            ]];
        }

        $waiting = $db->execute(
            "SELECT COUNT(*) AS c FROM lib_reservations
             WHERE book_id = ? AND status IN ('Waiting','Notified')",
            [(int)$ck['book_id']]
        )->fetch('assoc');

        if ((int)($waiting['c'] ?? 0) > 0) {
            return ['ok' => false, 'error' => [
                'code'    => 'HOLD_FOR_OTHER',
                'message' => 'Someone is waiting for "' . $ck['title'] . '" — it cannot be renewed.',
            ]];
        }

        $days   = $this->loanPeriodFor((string)$ck['member_type'], $settings);
        $oldDue = (string)$ck['due_date'];
        // Extend from the due date if still in the future, otherwise from today.
        $base   = max(strtotime($oldDue), strtotime(date('Y-m-d')));
        $newDue = $this->dueDate(date('Y-m-d', $base), $days, $settings);

        $db->execute(
            "UPDATE lib_checkouts
             SET    due_date = ?, renewals_count = renewals_count + 1, status = 'Active'
             WHERE  id = ? AND ssms_client_code = ?",
            [$newDue, $checkoutId, $clientCode]
        );

        $db->execute(
            'INSERT INTO lib_renewals (checkout_id, old_due_date, new_due_date, renewed_by)
             VALUES (?, ?, ?, ?)',
            [$checkoutId, $oldDue, $newDue, $actor]
        );

        return ['ok' => true, 'data' => [
            'checkout_id'    => $checkoutId,
            'title'          => $ck['title'],
            'member_name'    => $ck['full_name'],
            'old_due_date'   => $oldDue,
            'new_due_date'   => $newDue,
            'renewals_count' => (int)$ck['renewals_count'] + 1,
            'renewals_left'  => $maxRenewals - ((int)$ck['renewals_count'] + 1),
        ]];
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LOST
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryCirculationApi/markLost
     * Body: { checkout_id*, amount, notes }
     *
     * Charges the copy's purchase price when known, otherwise the settings
     * default. The copy leaves the collection permanently, so the counters drop.
     */
    public function markLost(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body       = (array)$this->request->getData();
        $checkoutId = $this->intOrNull($body, 'checkout_id');
        $notes      = $this->str($body, 'notes');

        if (!$checkoutId) {
            $this->invalid('A loan must be selected.', ['checkout_id' => 'Required']);

            return;
        }

        $settings = $this->settings($clientCode);
        $override = $this->decOrNull($body, 'amount');
        $actor    = $this->actor();

        try {
            $result = $this->transact(function () use ($clientCode, $checkoutId, $override, $notes, $settings, $actor) {
                $db = $this->db();

                // Lock the checkout row only — see the note in issueOne().
                $ck = $db->execute(
                    'SELECT * FROM lib_checkouts WHERE id = ? AND ssms_client_code = ? LIMIT 1 FOR UPDATE',
                    [$checkoutId, $clientCode]
                )->fetch('assoc');

                if (!$ck) {
                    return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Loan not found.']];
                }

                $ctx = $db->execute(
                    'SELECT cp.id AS cp_id, cp.book_id, cp.purchase_price, cp.accession_no, b.title
                     FROM   lib_book_copies cp
                     JOIN   lib_books b ON b.id = cp.book_id
                     WHERE  cp.id = ? LIMIT 1',
                    [(int)$ck['copy_id']]
                )->fetch('assoc');

                if (!$ctx) {
                    return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Loan record is incomplete.']];
                }

                $ck = array_merge($ck, $ctx);
                if (!in_array($ck['status'], ['Active', 'Overdue'], true)) {
                    return ['ok' => false, 'error' => ['code' => 'NOT_ISSUED', 'message' => 'This loan is already closed.']];
                }

                $amount = $override
                    ?? ($ck['purchase_price'] !== null && (float)$ck['purchase_price'] > 0
                        ? number_format((float)$ck['purchase_price'], 2, '.', '')
                        : ($settings['lost_book_default_fine'] !== null
                            ? number_format((float)$settings['lost_book_default_fine'], 2, '.', '')
                            : null));

                if ($amount === null) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'VALIDATION',
                        'message' => 'No purchase price on record. Enter a replacement charge.',
                    ]];
                }

                $db->execute(
                    "UPDATE lib_checkouts SET status = 'Lost', returned_to = ? WHERE id = ?",
                    [$actor, $checkoutId]
                );
                $db->execute(
                    "UPDATE lib_book_copies SET status = 'Lost', notes = CONCAT(COALESCE(notes, ''), ?)
                     WHERE id = ? AND ssms_client_code = ?",
                    ["\n" . date('Y-m-d') . ' — reported lost' . ($notes ? ': ' . $notes : ''),
                     (int)$ck['cp_id'], $clientCode]
                );

                $this->syncBookCounters((int)$ck['book_id'], $db);

                $db->execute(
                    'INSERT INTO lib_fines
                        (ssms_client_code, checkout_id, member_id, fine_type, amount, status, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [$clientCode, $checkoutId, (int)$ck['member_id'], 'Lost', $amount, 'Pending', $notes ?: null]
                );

                return ['ok' => true, 'data' => [
                    'checkout_id'  => $checkoutId,
                    'fine_id'      => $this->insertId(),
                    'amount'       => (float)$amount,
                    'title'        => $ck['title'],
                    'accession_no' => $ck['accession_no'],
                ]];
            });
        } catch (\Throwable $e) {
            Log::error('markLost failed: ' . $e->getMessage());
            $this->fail(500, 'Could not record the loss. Nothing was changed.', 'SERVER_ERROR');

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

        $this->audit('checkout', $checkoutId, 'lost', null, $result['data']);
        $this->ok($result['data'], null, 'Recorded as lost and charged.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // OVERDUE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryCirculationApi/overdue?bucket=&page=&limit=
     *
     * Aging buckets are the standard way libraries triage overdue items: a book
     * three days late needs a reminder, one ninety days late needs a phone call.
     * The bucket totals come back with every page so the tabs can show counts.
     */
    public function overdue(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ["ck.ssms_client_code = ? AND ck.status IN ('Active','Overdue') AND ck.due_date < CURDATE()"];
        $params = [$clientCode];

        switch ($this->q('bucket', 'all')) {
            case '1-7':
                $where[] = 'DATEDIFF(CURDATE(), ck.due_date) BETWEEN 1 AND 7';
                break;
            case '8-14':
                $where[] = 'DATEDIFF(CURDATE(), ck.due_date) BETWEEN 8 AND 14';
                break;
            case '15-30':
                $where[] = 'DATEDIFF(CURDATE(), ck.due_date) BETWEEN 15 AND 30';
                break;
            case '30+':
                $where[] = 'DATEDIFF(CURDATE(), ck.due_date) > 30';
                break;
        }

        if (($v = $this->q('classSection')) !== null) {
            $where[] = 'm.class_section = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();
        $settings = $this->settings($clientCode);

        $buckets = $db->execute(
            "SELECT
                SUM(CASE WHEN DATEDIFF(CURDATE(), ck.due_date) BETWEEN 1 AND 7   THEN 1 ELSE 0 END) AS b1,
                SUM(CASE WHEN DATEDIFF(CURDATE(), ck.due_date) BETWEEN 8 AND 14  THEN 1 ELSE 0 END) AS b2,
                SUM(CASE WHEN DATEDIFF(CURDATE(), ck.due_date) BETWEEN 15 AND 30 THEN 1 ELSE 0 END) AS b3,
                SUM(CASE WHEN DATEDIFF(CURDATE(), ck.due_date) > 30              THEN 1 ELSE 0 END) AS b4,
                COUNT(*) AS total
             FROM lib_checkouts ck
             WHERE ck.ssms_client_code = ? AND ck.status IN ('Active','Overdue') AND ck.due_date < CURDATE()",
            [$clientCode]
        )->fetch('assoc') ?: [];

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c
             FROM   lib_checkouts ck
             JOIN   lib_members m ON m.id = ck.member_id
             WHERE  {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = [];
        if ($total > 0) {
            $rows = $db->execute(
                "SELECT ck.id, ck.member_id, ck.due_date, ck.issue_date,
                        DATEDIFF(CURDATE(), ck.due_date) AS days_late,
                        m.membership_no, m.full_name AS member_name, m.class_section,
                        m.phone, m.email, m.member_type,
                        cp.accession_no, b.title
                 FROM   lib_checkouts ck
                 JOIN   lib_members m      ON m.id  = ck.member_id
                 JOIN   lib_book_copies cp ON cp.id = ck.copy_id
                 JOIN   lib_books b        ON b.id  = cp.book_id
                 WHERE  {$whereSql}
                 ORDER  BY days_late DESC, m.full_name ASC
                 LIMIT  {$limit} OFFSET {$offset}",
                $params
            )->fetchAll('assoc');

            foreach ($rows as &$r) {
                $r = $this->castRow($r, ['id', 'member_id', 'days_late']);
                // Projected fine if returned today — the number the librarian
                // quotes on the phone.
                $r['fine_so_far'] = (float)$this->overdueFine((int)$r['days_late'], $settings);
            }
            unset($r);
        }

        $this->ok($rows, array_merge($this->paginationMeta($page, $limit, $total), [
            'buckets' => [
                '1-7'   => (int)($buckets['b1'] ?? 0),
                '8-14'  => (int)($buckets['b2'] ?? 0),
                '15-30' => (int)($buckets['b3'] ?? 0),
                '30+'   => (int)($buckets['b4'] ?? 0),
                'total' => (int)($buckets['total'] ?? 0),
            ],
        ]));
    }

    /**
     * POST /libraryCirculationApi/sendReminders
     * Body: { checkout_ids: [..] } — or omit to queue for every overdue loan.
     *
     * Queues into lib_notifications rather than sending inline, so the desk
     * never waits on an SMS gateway and a gateway outage cannot fail the request.
     */
    public function sendReminders(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();
        $ids  = is_array($body['checkout_ids'] ?? null)
            ? array_values(array_filter(array_map('intval', $body['checkout_ids'])))
            : [];

        $db = $this->db();
        $settings = $this->settings($clientCode);

        if ($ids !== []) {
            $ph = implode(', ', array_fill(0, count($ids), '?'));
            $sql = "SELECT ck.id, ck.member_id, ck.due_date,
                           DATEDIFF(CURDATE(), ck.due_date) AS days_late, b.title
                    FROM   lib_checkouts ck
                    JOIN   lib_book_copies cp ON cp.id = ck.copy_id
                    JOIN   lib_books b        ON b.id  = cp.book_id
                    WHERE  ck.ssms_client_code = ? AND ck.status IN ('Active','Overdue')
                      AND  ck.id IN ({$ph})";
            $params = array_merge([$clientCode], $ids);
        } else {
            $sql = "SELECT ck.id, ck.member_id, ck.due_date,
                           DATEDIFF(CURDATE(), ck.due_date) AS days_late, b.title
                    FROM   lib_checkouts ck
                    JOIN   lib_book_copies cp ON cp.id = ck.copy_id
                    JOIN   lib_books b        ON b.id  = cp.book_id
                    WHERE  ck.ssms_client_code = ? AND ck.status IN ('Active','Overdue')
                      AND  ck.due_date < CURDATE()";
            $params = [$clientCode];
        }

        $rows = $db->execute($sql, $params)->fetchAll('assoc');

        $queued = 0;
        foreach ($rows as $r) {
            $late = (int)$r['days_late'];
            $fine = $this->overdueFine(max(0, $late), $settings);
            $currency = $settings['currency_symbol'] ?? '';

            $message = $late > 0
                ? '"' . $r['title'] . '" was due on ' . $r['due_date'] . ' (' . $late . ' day'
                  . ($late === 1 ? '' : 's') . ' late). Fine so far: ' . $currency . $fine . '.'
                : '"' . $r['title'] . '" is due on ' . $r['due_date'] . '.';

            $this->queueNotification(
                $clientCode,
                (int)$r['member_id'],
                $late > 0 ? 'OverdueAlert' : 'DueReminder',
                (int)$r['id'],
                $message
            );
            $queued++;
        }

        $this->ok(['queued' => $queued], null, $queued . ' reminder' . ($queued === 1 ? '' : 's') . ' queued.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RESERVATIONS / HOLDS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryCirculationApi/reservations?status=&bookId=&memberId=&page= */
    public function reservations(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['r.ssms_client_code = ?'];
        $params = [$clientCode];

        $status = $this->q('status', 'active');
        if ($status === 'active') {
            $where[] = "r.status IN ('Waiting','Notified')";
        } elseif ($status !== 'all') {
            $where[] = 'r.status = ?';
            $params[] = $status;
        }

        if (($v = $this->qInt('bookId')) !== null) {
            $where[] = 'r.book_id = ?';
            $params[] = $v;
        }
        if (($v = $this->qInt('memberId')) !== null) {
            $where[] = 'r.member_id = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_reservations r WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT r.id, r.member_id, r.book_id, r.copy_id, r.reserved_on, r.notified_on,
                    r.collect_by, r.queue_position, r.status,
                    TIMESTAMPDIFF(HOUR, NOW(), r.collect_by) AS hours_left,
                    m.membership_no, m.full_name AS member_name, m.class_section, m.phone,
                    b.title, b.cover_image, b.available_copies,
                    cp.accession_no
             FROM   lib_reservations r
             JOIN   lib_members m ON m.id = r.member_id
             JOIN   lib_books b   ON b.id = r.book_id
             LEFT   JOIN lib_book_copies cp ON cp.id = r.copy_id
             WHERE  {$whereSql}
             ORDER  BY FIELD(r.status, 'Notified', 'Waiting'), r.queue_position ASC, r.id ASC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows(
                $rows,
                ['id', 'member_id', 'book_id', 'copy_id', 'queue_position', 'hours_left', 'available_copies']
            ),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /**
     * POST /libraryCirculationApi/reserve
     * Body: { member_id | member_code, book_id* }
     *
     * If a copy is on the shelf right now the hold is still created, but the
     * response says `availableNow` so the desk can simply hand the book over
     * instead of making the member wait for a queue that does not need to exist.
     */
    public function reserve(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body   = (array)$this->request->getData();
        $bookId = $this->intOrNull($body, 'book_id');

        if (!$bookId) {
            $this->invalid('A book must be selected.', ['book_id' => 'Required']);

            return;
        }

        $member = $this->resolveMember($clientCode, $body);
        if (!$member) {
            $this->fail(404, 'Member not found.', 'NOT_FOUND');

            return;
        }

        $memberId = (int)$member['id'];
        $db = $this->db();

        $book = $db->execute(
            'SELECT id, title, available_copies, is_reference FROM lib_books
             WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$bookId, $clientCode]
        )->fetch('assoc');

        if (!$book) {
            $this->notFound('Book');

            return;
        }
        if ((int)$book['is_reference'] === 1) {
            $this->conflict('Reference books cannot be reserved.', 'REFERENCE_ONLY');

            return;
        }
        if (strtolower((string)$member['status']) !== 'active') {
            $this->conflict('Membership is ' . strtolower((string)$member['status']) . '.', 'MEMBER_BLOCKED');

            return;
        }

        $already = $db->execute(
            "SELECT id, queue_position FROM lib_reservations
             WHERE member_id = ? AND book_id = ? AND status IN ('Waiting','Notified') LIMIT 1",
            [$memberId, $bookId]
        )->fetch('assoc');

        if ($already) {
            $this->conflict(
                'Already reserved — position ' . $already['queue_position'] . ' in the queue.',
                'DUPLICATE'
            );

            return;
        }

        $holding = $db->execute(
            "SELECT ck.id FROM lib_checkouts ck
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             WHERE  ck.member_id = ? AND cp.book_id = ? AND ck.status IN ('Active','Overdue')
             LIMIT  1",
            [$memberId, $bookId]
        )->fetch('assoc');

        if ($holding) {
            $this->conflict('This member already has a copy of "' . $book['title'] . '" on loan.', 'DUPLICATE');

            return;
        }

        $reservationId = $this->transact(function () use ($db, $clientCode, $memberId, $bookId) {
            $next = $db->execute(
                "SELECT COALESCE(MAX(queue_position), 0) + 1 AS pos
                 FROM   lib_reservations
                 WHERE  book_id = ? AND status IN ('Waiting','Notified')",
                [$bookId]
            )->fetch('assoc');

            $db->execute(
                'INSERT INTO lib_reservations
                    (ssms_client_code, member_id, book_id, queue_position, status)
                 VALUES (?, ?, ?, ?, ?)',
                [$clientCode, $memberId, $bookId, (int)($next['pos'] ?? 1), 'Waiting']
            );

            return $this->insertId();
        });

        $position = (int)($db->execute(
            'SELECT queue_position FROM lib_reservations WHERE id = ?',
            [$reservationId]
        )->fetch('assoc')['queue_position'] ?? 1);

        $this->ok(
            [
                'reservation_id' => $reservationId,
                'book_id'        => $bookId,
                'title'          => $book['title'],
                'queue_position' => $position,
                'availableNow'   => (int)$book['available_copies'] > 0,
            ],
            null,
            (int)$book['available_copies'] > 0
                ? 'Reserved — a copy is on the shelf now and can be issued straight away.'
                : 'Reserved — position ' . $position . ' in the queue.'
        );
    }

    /**
     * POST /libraryCirculationApi/cancelReservation
     * Body: { reservation_id*, reason }
     *
     * Frees a trapped copy and closes the queue gap so the remaining positions
     * stay meaningful.
     */
    public function cancelReservation(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body   = (array)$this->request->getData();
        $id     = $this->intOrNull($body, 'reservation_id');
        $reason = $this->str($body, 'reason');

        if (!$id) {
            $this->invalid('A reservation must be selected.', ['reservation_id' => 'Required']);

            return;
        }

        $db = $this->db();

        $res = $db->execute(
            'SELECT * FROM lib_reservations WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$id, $clientCode]
        )->fetch('assoc');

        if (!$res) {
            $this->notFound('Reservation');

            return;
        }
        if (!in_array($res['status'], ['Waiting', 'Notified'], true)) {
            $this->conflict('This reservation is already ' . strtolower((string)$res['status']) . '.');

            return;
        }

        $this->transact(function () use ($db, $id, $res, $reason, $clientCode) {
            $db->execute(
                "UPDATE lib_reservations SET status = 'Cancelled', cancelled_reason = ? WHERE id = ?",
                [$reason ?: null, $id]
            );

            // A Notified hold has a copy trapped for it — release it, unless the
            // next in queue immediately claims it.
            if ($res['status'] === 'Notified' && !empty($res['copy_id'])) {
                $this->releaseOrPromote($clientCode, (int)$res['copy_id'], (int)$res['book_id'], $db);
            }

            $this->resequenceQueue((int)$res['book_id'], $db);
        });

        $this->audit('reservation', $id, 'cancel', $res, ['reason' => $reason]);
        $this->ok(['id' => $id], null, 'Reservation cancelled.');
    }

    /**
     * POST /libraryCirculationApi/expireHolds
     *
     * Maintenance sweep — run from cron. Any Notified hold past its collect_by
     * deadline is expired, and the copy passes to the next member in the queue.
     * Without this, one member who never collects blocks a title indefinitely.
     */
    public function expireHolds(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db = $this->db();

        $stale = $db->execute(
            "SELECT r.*, b.title
             FROM   lib_reservations r
             JOIN   lib_books b ON b.id = r.book_id
             WHERE  r.ssms_client_code = ? AND r.status = 'Notified'
               AND  r.collect_by IS NOT NULL AND r.collect_by < NOW()",
            [$clientCode]
        )->fetchAll('assoc');

        $expired = 0;

        foreach ($stale as $res) {
            try {
                $this->transact(function () use ($db, $res, $clientCode) {
                    $db->execute(
                        "UPDATE lib_reservations SET status = 'Expired' WHERE id = ?",
                        [(int)$res['id']]
                    );

                    $this->queueNotification(
                        $clientCode,
                        (int)$res['member_id'],
                        'HoldExpired',
                        (int)$res['id'],
                        'Your hold on "' . $res['title'] . '" expired because it was not collected in time.'
                    );

                    if (!empty($res['copy_id'])) {
                        $this->releaseOrPromote($clientCode, (int)$res['copy_id'], (int)$res['book_id'], $db);
                    }

                    $this->resequenceQueue((int)$res['book_id'], $db);
                });
                $expired++;
            } catch (\Throwable $e) {
                Log::error('expireHolds failed for reservation ' . $res['id'] . ': ' . $e->getMessage());
            }
        }

        $this->ok(['expired' => $expired], null, $expired . ' hold' . ($expired === 1 ? '' : 's') . ' expired.');
    }

    /**
     * POST /libraryCirculationApi/sweepOverdue
     *
     * Maintenance sweep — run nightly from cron. Flips Active loans past their
     * due date to Overdue and raises or tops up the overdue fine.
     *
     * Fines must exist before the book comes back, otherwise a member who never
     * returns anything appears to owe nothing, and the overdue report understates
     * what is outstanding.
     */
    public function sweepOverdue(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db       = $this->db();
        $settings = $this->settings($clientCode);

        $db->execute(
            "UPDATE lib_checkouts
             SET    status = 'Overdue'
             WHERE  ssms_client_code = ? AND status = 'Active' AND due_date < CURDATE()",
            [$clientCode]
        );

        $rows = $db->execute(
            "SELECT ck.id, ck.member_id, DATEDIFF(CURDATE(), ck.due_date) AS days_late
             FROM   lib_checkouts ck
             WHERE  ck.ssms_client_code = ? AND ck.status = 'Overdue' AND ck.due_date < CURDATE()",
            [$clientCode]
        )->fetchAll('assoc');

        $created = 0;
        $updated = 0;

        foreach ($rows as $r) {
            $daysLate = (int)$r['days_late'];
            $amount   = $this->overdueFine($daysLate, $settings);
            if ((float)$amount <= 0) {
                continue;   // still inside the grace period
            }

            $existing = $db->execute(
                "SELECT id, amount FROM lib_fines
                 WHERE checkout_id = ? AND fine_type = 'Overdue' AND status IN ('Pending','Partial')
                 LIMIT 1",
                [(int)$r['id']]
            )->fetch('assoc');

            if ($existing) {
                if ((float)$existing['amount'] !== (float)$amount) {
                    $db->execute(
                        'UPDATE lib_fines SET days_overdue = ?, amount = ? WHERE id = ?',
                        [$this->chargeableDays($daysLate, $settings), $amount, (int)$existing['id']]
                    );
                    $updated++;
                }
            } else {
                $db->execute(
                    'INSERT INTO lib_fines
                        (ssms_client_code, checkout_id, member_id, fine_type, days_overdue, amount, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        $clientCode, (int)$r['id'], (int)$r['member_id'], 'Overdue',
                        $this->chargeableDays($daysLate, $settings), $amount, 'Pending',
                    ]
                );
                $created++;
            }
        }

        $this->ok(
            ['scanned' => count($rows), 'finesCreated' => $created, 'finesUpdated' => $updated],
            null,
            'Overdue sweep complete.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SHARED HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    // resolveMember() lives in LibraryApiTrait — facility bookings need the
    // same "who is this?" resolution, so it is shared rather than duplicated.

    private function reloadMember(string $clientCode, int $memberId): ?array
    {
        $row = $this->db()->execute(
            'SELECT * FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$memberId, $clientCode]
        )->fetch('assoc');

        return $row ?: null;
    }

    /**
     * Normalise the several shapes the desk can send copies in — a scanned code,
     * a list of scanned codes, a single id, or a list of ids — into one list of
     * strings that issueOne / returnOne can resolve.
     *
     * @return array<int,string>
     */
    private function copyRefs(array $body): array
    {
        $raw = [];

        foreach (['copies', 'copy_ids', 'codes'] as $key) {
            if (is_array($body[$key] ?? null)) {
                $raw = array_merge($raw, $body[$key]);
            }
        }
        foreach (['copy_id', 'copy_code', 'code'] as $key) {
            if (!empty($body[$key])) {
                $raw[] = $body[$key];
            }
        }

        $refs = [];
        foreach ($raw as $r) {
            $r = trim((string)$r);
            if ($r !== '' && !in_array($r, $refs, true)) {
                $refs[] = $r;
            }
        }

        return $refs;
    }

    /**
     * A copy has just been freed from a hold. Give it to the next member waiting,
     * or put it back on the shelf if the queue is empty.
     */
    private function releaseOrPromote(string $clientCode, int $copyId, int $bookId, $db): void
    {
        $settings = $this->settings($clientCode);

        $next = $db->execute(
            "SELECT r.id, r.member_id, b.title
             FROM   lib_reservations r
             JOIN   lib_books b ON b.id = r.book_id
             WHERE  r.book_id = ? AND r.status = 'Waiting'
             ORDER  BY r.queue_position ASC, r.id ASC
             LIMIT  1",
            [$bookId]
        )->fetch('assoc');

        if ($next) {
            $hours = (int)($settings['reservation_hold_hours'] ?? 48);
            $db->execute(
                "UPDATE lib_reservations
                 SET    status = 'Notified', copy_id = ?, notified_on = NOW(),
                        collect_by = DATE_ADD(NOW(), INTERVAL ? HOUR)
                 WHERE  id = ?",
                [$copyId, $hours, (int)$next['id']]
            );

            $this->queueNotification(
                $clientCode,
                (int)$next['member_id'],
                'HoldReady',
                (int)$next['id'],
                '"' . $next['title'] . '" is ready to collect. Please collect within ' . $hours . ' hours.'
            );

            return;
        }

        // Nobody waiting — only reshelve if the copy is still trapped, never
        // touch one that has since been issued.
        $db->execute(
            "UPDATE lib_book_copies SET status = 'Available'
             WHERE id = ? AND ssms_client_code = ? AND status = 'Reserved'",
            [$copyId, $clientCode]
        );

        $this->syncBookCounters($bookId, $db);
    }

    /**
     * Close gaps in a hold queue after a fulfilment, cancellation or expiry, so
     * "position 3" always means there are two people ahead.
     */
    private function resequenceQueue(int $bookId, $db): void
    {
        $open = $db->execute(
            "SELECT id FROM lib_reservations
             WHERE book_id = ? AND status IN ('Waiting','Notified')
             ORDER BY queue_position ASC, id ASC",
            [$bookId]
        )->fetchAll('assoc');

        $pos = 1;
        foreach ($open as $row) {
            $db->execute(
                'UPDATE lib_reservations SET queue_position = ? WHERE id = ?',
                [$pos++, (int)$row['id']]
            );
        }
    }
}
