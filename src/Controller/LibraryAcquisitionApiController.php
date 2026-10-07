<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;
use Cake\Log\Log;

/**
 * LibraryAcquisitionApiController
 * File: src/Controller/LibraryAcquisitionApiController.php
 *
 * Owns: lib_acquisitions
 * Writes on receipt: lib_books, lib_book_copies, lib_authors, lib_book_authors
 *
 * The workflow is deliberately linear, because a purchase trail that can go
 * backwards is a purchase trail nobody can audit:
 *
 *   Pending ──approve──▶ Approved ──order──▶ Ordered ──receive──▶ Received
 *      │                     │                  │
 *      └──reject──▶ Rejected └──────cancel──────┴──▶ Cancelled
 *
 * `receive` is the interesting one: it creates the catalogue record and the
 * physical copies in a single transaction, turning a delivery into shelf-ready
 * stock without anyone retyping the title.
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibraryAcquisitionApi' to $apiControllers in AppController.php
 *   3. Paste the acquisition block from api/routes.snippet.php into config/routes.php
 */
class LibraryAcquisitionApiController extends AppController
{
    use LibraryApiTrait;

    /** status => statuses it may move to. Anything else is rejected. */
    private const TRANSITIONS = [
        'Pending'  => ['Approved', 'Rejected', 'Cancelled'],
        'Approved' => ['Ordered', 'Received', 'Cancelled'],
        'Ordered'  => ['Received', 'Cancelled'],
        'Received' => [],
        'Rejected' => [],
        'Cancelled' => [],
    ];

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
    // LIST
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryAcquisitionApi/acquisitions
     *
     * Query: status, type (Purchase|Donation|Exchange|Transfer), q, from, to,
     *        vendor, sort (newest|oldest|cost|title), page, limit
     *
     * Tab counts and budget totals come back with every page, because the
     * question behind this screen is always "what have we committed?" not
     * "what is on this page?".
     */
    public function acquisitions(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        // Interpolated, not bound — see the note in LibraryCatalogApiController::books().
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['a.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('status')) !== null && $v !== 'all') {
            $where[] = 'a.status = ?';
            $params[] = $v;
        }
        if (($v = $this->q('type')) !== null) {
            $where[] = 'a.acquisition_type = ?';
            $params[] = $v;
        }
        if (($v = $this->q('vendor')) !== null) {
            $where[] = 'a.vendor = ?';
            $params[] = $v;
        }
        if (($v = $this->q('from')) !== null) {
            $where[] = 'a.created_at >= ?';
            $params[] = date('Y-m-d 00:00:00', strtotime($v) ?: time());
        }
        if (($v = $this->q('to')) !== null) {
            $where[] = 'a.created_at <= ?';
            $params[] = date('Y-m-d 23:59:59', strtotime($v) ?: time());
        }
        if (($v = $this->q('q')) !== null) {
            $where[] = '(a.title LIKE ? OR a.author LIKE ? OR a.isbn LIKE ?
                         OR a.vendor LIKE ? OR a.requested_by LIKE ? OR a.donor_name LIKE ?)';
            array_push(
                $params,
                $this->like($v),
                $this->like($v),
                $this->like($v, 'prefix'),
                $this->like($v),
                $this->like($v),
                $this->like($v)
            );
        }

        $whereSql = implode(' AND ', $where);

        $orderBy = match ($this->q('sort', 'newest')) {
            'oldest' => 'a.created_at ASC, a.id ASC',
            'cost'   => 'COALESCE(a.actual_cost, a.estimated_cost) DESC',
            'title'  => 'a.title ASC',
            default  => 'a.created_at DESC, a.id DESC',
        };

        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_acquisitions a WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT a.*,
                    COALESCE(a.actual_cost, a.estimated_cost * a.qty_requested) AS committed_cost,
                    (a.qty_requested - a.qty_received) AS qty_outstanding
             FROM   lib_acquisitions a
             WHERE  {$whereSql}
             ORDER  BY {$orderBy}
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $totals = $db->execute(
            "SELECT
                COUNT(*) AS all_count,
                SUM(CASE WHEN status = 'Pending'   THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN status = 'Approved'  THEN 1 ELSE 0 END) AS approved_count,
                SUM(CASE WHEN status = 'Ordered'   THEN 1 ELSE 0 END) AS ordered_count,
                SUM(CASE WHEN status = 'Received'  THEN 1 ELSE 0 END) AS received_count,
                SUM(CASE WHEN status = 'Rejected'  THEN 1 ELSE 0 END) AS rejected_count,
                SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
                COALESCE(SUM(CASE WHEN status IN ('Approved','Ordered')
                             THEN estimated_cost * qty_requested ELSE 0 END), 0) AS committed,
                COALESCE(SUM(CASE WHEN status = 'Received' THEN actual_cost ELSE 0 END), 0) AS spent
             FROM lib_acquisitions WHERE ssms_client_code = ?",
            [$clientCode]
        )->fetch('assoc') ?: [];

        $settings = $this->settings($clientCode);

        $this->ok(
            $this->castRows(
                $rows,
                ['id', 'qty_requested', 'qty_received', 'qty_outstanding'],
                ['estimated_cost', 'actual_cost', 'committed_cost']
            ),
            array_merge($this->paginationMeta($page, $limit, $total), [
                'totals' => [
                    'all'       => (int)($totals['all_count'] ?? 0),
                    'pending'   => (int)($totals['pending_count'] ?? 0),
                    'approved'  => (int)($totals['approved_count'] ?? 0),
                    'ordered'   => (int)($totals['ordered_count'] ?? 0),
                    'received'  => (int)($totals['received_count'] ?? 0),
                    'rejected'  => (int)($totals['rejected_count'] ?? 0),
                    'cancelled' => (int)($totals['cancelled_count'] ?? 0),
                    'committed' => (float)($totals['committed'] ?? 0),
                    'spent'     => (float)($totals['spent'] ?? 0),
                    'currency'  => $settings['currency_symbol'] ?? '',
                ],
            ])
        );
    }

    /** GET /libraryAcquisitionApi/acquisition/{id} */
    public function acquisition(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $row = $this->db()->execute(
            'SELECT a.*, (a.qty_requested - a.qty_received) AS qty_outstanding
             FROM   lib_acquisitions a
             WHERE  a.id = ? AND a.ssms_client_code = ? LIMIT 1',
            [(int)$id, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Acquisition');

            return;
        }

        $settings = $this->settings($clientCode);
        $status   = (string)$row['status'];

        $this->ok([
            'acquisition'   => $this->castRow(
                $row,
                ['id', 'qty_requested', 'qty_received', 'qty_outstanding'],
                ['estimated_cost', 'actual_cost']
            ),
            'canMoveTo'     => self::TRANSITIONS[$status] ?? [],
            'currency'      => $settings['currency_symbol'] ?? '',
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CREATE / UPDATE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST|PUT /libraryAcquisitionApi/saveAcquisition
     *
     * Body: { id?, acquisition_type, title*, isbn, author, publisher,
     *         qty_requested, estimated_cost, reason, requested_by, vendor,
     *         expected_date, donor_name, notes }
     *
     * Editable only while Pending or Approved — once something is ordered, the
     * request is a record of what was ordered, not a scratchpad.
     */
    public function saveAcquisition(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body  = (array)$this->request->getData();
        $id    = $this->intOrNull($body, 'id');
        $title = $this->str($body, 'title');
        $type  = $this->str($body, 'acquisition_type') ?: 'Purchase';

        if ($title === '') {
            $this->invalid('A title is required.', ['title' => 'Required']);

            return;
        }
        if (!in_array($type, ['Purchase', 'Donation', 'Exchange', 'Transfer'], true)) {
            $this->invalid('Invalid acquisition type.', ['acquisition_type' => 'Invalid']);

            return;
        }

        $qty = (int)($body['qty_requested'] ?? 1);
        if ($qty < 1 || $qty > 500) {
            $this->invalid('Quantity must be between 1 and 500.', ['qty_requested' => 'Out of range']);

            return;
        }

        $db = $this->db();

        if ($id) {
            $existing = $db->execute(
                'SELECT * FROM lib_acquisitions WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                [$id, $clientCode]
            )->fetch('assoc');

            if (!$existing) {
                $this->notFound('Acquisition');

                return;
            }
            if (!in_array($existing['status'], ['Pending', 'Approved'], true)) {
                $this->conflict(
                    'This request is ' . strtolower((string)$existing['status'])
                    . ' and can no longer be edited.'
                );

                return;
            }
        }

        $fields = [
            'acquisition_type' => $type,
            'title'            => $title,
            'isbn'             => $this->str($body, 'isbn') ?: null,
            'author'           => $this->str($body, 'author') ?: null,
            'publisher'        => $this->str($body, 'publisher') ?: null,
            'qty_requested'    => $qty,
            'estimated_cost'   => $this->decOrNull($body, 'estimated_cost'),
            'reason'           => $this->str($body, 'reason') ?: null,
            'requested_by'     => $this->str($body, 'requested_by') ?: $this->actor(),
            'vendor'           => $this->str($body, 'vendor') ?: null,
            'expected_date'    => $this->dateOrNull($body, 'expected_date'),
            'donor_name'       => $this->str($body, 'donor_name') ?: null,
            'notes'            => $this->str($body, 'notes') ?: null,
        ];

        if ($id) {
            $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
            $db->execute(
                "UPDATE lib_acquisitions SET {$set} WHERE id = ? AND ssms_client_code = ?",
                array_merge(array_values($fields), [$id, $clientCode])
            );
        } else {
            $cols = array_merge(['ssms_client_code'], array_keys($fields), ['status']);
            $vals = array_merge([$clientCode], array_values($fields), ['Pending']);
            $ph   = implode(', ', array_fill(0, count($cols), '?'));
            $db->execute(
                'INSERT INTO lib_acquisitions (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                $vals
            );
            $id = $this->insertId();
        }

        $this->audit('acquisition', $id, 'save', null, $fields);
        $this->ok(['id' => $id], null, $type === 'Donation' ? 'Donation recorded.' : 'Request saved.');
    }

    /**
     * POST /libraryAcquisitionApi/setStatus
     * Body: { id*, status* (Approved|Rejected|Ordered|Cancelled), remarks,
     *         order_date, expected_date, actual_cost }
     *
     * The one door for every move except receipt. Illegal transitions are
     * refused with the list of legal ones, so the app never has to encode the
     * workflow itself.
     *
     * Approve and reject are admin-only: a purchase request that can approve
     * itself is not a purchase request.
     */
    public function setStatus(): void
    {
        $this->request->allowMethod(['post']);

        $body    = (array)$this->request->getData();
        $status  = $this->str($body, 'status');
        $needsAdmin = in_array($status, ['Approved', 'Rejected'], true);

        if (!$clientCode = $this->guard($needsAdmin)) {
            return;
        }

        $id      = $this->intOrNull($body, 'id');
        $remarks = $this->str($body, 'remarks');

        if (!$id) {
            $this->invalid('A request must be selected.', ['id' => 'Required']);

            return;
        }
        if (!in_array($status, ['Approved', 'Rejected', 'Ordered', 'Cancelled'], true)) {
            $this->invalid(
                'Status must be Approved, Rejected, Ordered or Cancelled. Use receive() for Received.',
                ['status' => 'Invalid']
            );

            return;
        }

        $db = $this->db();

        $row = $db->execute(
            'SELECT * FROM lib_acquisitions WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$id, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Acquisition');

            return;
        }

        $current = (string)$row['status'];
        $allowed = self::TRANSITIONS[$current] ?? [];

        if (!in_array($status, $allowed, true)) {
            $this->conflict(
                'A ' . strtolower($current) . ' request cannot become ' . strtolower($status) . '.'
                . ($allowed ? ' It can only move to: ' . implode(', ', $allowed) . '.' : ''),
                'INVALID_TRANSITION'
            );

            return;
        }

        if ($status === 'Rejected' && $remarks === '') {
            $this->invalid('A reason is required when rejecting a request.', ['remarks' => 'Required']);

            return;
        }

        $fields = ['status' => $status];

        if (in_array($status, ['Approved', 'Rejected'], true)) {
            $fields['approved_by'] = $this->actor();
            $fields['approved_at'] = date('Y-m-d H:i:s');
        }
        if ($status === 'Ordered') {
            $fields['order_date']    = $this->dateOrNull($body, 'order_date') ?? date('Y-m-d');
            $fields['expected_date'] = $this->dateOrNull($body, 'expected_date') ?? $row['expected_date'];
            if (($v = $this->str($body, 'vendor')) !== '') {
                $fields['vendor'] = $v;
            }
            if (($c = $this->decOrNull($body, 'actual_cost')) !== null) {
                $fields['actual_cost'] = $c;
            }
        }
        if ($remarks !== '') {
            $fields['notes'] = trim((string)($row['notes'] ?? '') . "\n"
                . date('Y-m-d') . ' — ' . $status . ': ' . $remarks);
        }

        $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
        $db->execute(
            "UPDATE lib_acquisitions SET {$set} WHERE id = ? AND ssms_client_code = ?",
            array_merge(array_values($fields), [$id, $clientCode])
        );

        $this->audit('acquisition', $id, strtolower($status), ['status' => $current], $fields);

        $this->ok(
            ['id' => $id, 'status' => $status, 'canMoveTo' => self::TRANSITIONS[$status] ?? []],
            null,
            'Request marked ' . strtolower($status) . '.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ⭐ RECEIVE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryAcquisitionApi/receive
     *
     * Body: { id*, qty_received*, actual_cost, received_date,
     *         book_id,               — attach to an existing catalogue record
     *         category_id, publisher_id, book_type, language, shelf_location,
     *         condition_grade, accession_prefix, notes }
     *
     * Turns a delivery into shelf-ready stock in one transaction:
     *   1. finds an existing book by book_id, then by ISBN, or creates one
     *   2. creates the author record if the request named one
     *   3. generates N copies with sequential accession numbers
     *   4. refreshes the availability counters
     *   5. closes the acquisition (or leaves it Ordered if partly delivered)
     *
     * Partial deliveries are normal — a carton of 40 arrives as 25 then 15 — so
     * receiving is additive and the request only closes when the count is met.
     */
    public function receive(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();
        $id   = $this->intOrNull($body, 'id');
        $qty  = (int)($body['qty_received'] ?? 0);

        if (!$id) {
            $this->invalid('A request must be selected.', ['id' => 'Required']);

            return;
        }
        if ($qty < 1 || $qty > 500) {
            $this->invalid('Quantity received must be between 1 and 500.', ['qty_received' => 'Out of range']);

            return;
        }

        $db       = $this->db();
        $settings = $this->settings($clientCode);
        $actor    = $this->actor();

        try {
            $result = $this->transact(function () use ($clientCode, $id, $qty, $body, $settings, $actor) {
                $db = $this->db();

                $acq = $db->execute(
                    'SELECT * FROM lib_acquisitions WHERE id = ? AND ssms_client_code = ? LIMIT 1 FOR UPDATE',
                    [$id, $clientCode]
                )->fetch('assoc');

                if (!$acq) {
                    return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Request not found.']];
                }

                if (!in_array($acq['status'], ['Approved', 'Ordered'], true)) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'INVALID_TRANSITION',
                        'message' => 'A ' . strtolower((string)$acq['status'])
                                     . ' request cannot receive stock.',
                    ]];
                }

                $alreadyIn  = (int)$acq['qty_received'];
                $requested  = (int)$acq['qty_requested'];
                $outstanding = $requested - $alreadyIn;

                if ($qty > $outstanding) {
                    return ['ok' => false, 'error' => [
                        'code'    => 'OVER_RECEIPT',
                        'message' => 'Only ' . $outstanding . ' of ' . $requested . ' still outstanding.',
                    ]];
                }

                // ── 1. Find or create the catalogue record ────────────────────
                $bookId = $this->intOrNull($body, 'book_id');

                if ($bookId) {
                    $book = $db->execute(
                        'SELECT id, title FROM lib_books WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                        [$bookId, $clientCode]
                    )->fetch('assoc');

                    if (!$book) {
                        return ['ok' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Catalogue record not found.']];
                    }
                    $createdBook = false;
                } else {
                    $isbn = trim((string)($acq['isbn'] ?? ''));
                    $book = null;

                    if ($isbn !== '') {
                        $book = $db->execute(
                            'SELECT id, title FROM lib_books WHERE ssms_client_code = ? AND isbn = ? LIMIT 1',
                            [$clientCode, $isbn]
                        )->fetch('assoc');
                    }

                    if ($book) {
                        $bookId      = (int)$book['id'];
                        $createdBook = false;
                    } else {
                        $db->execute(
                            'INSERT INTO lib_books
                                (ssms_client_code, category_id, publisher_id, isbn, title,
                                 language, book_type, description)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            [
                                $clientCode,
                                $this->intOrNull($body, 'category_id'),
                                $this->intOrNull($body, 'publisher_id'),
                                $isbn !== '' ? $isbn : null,
                                $acq['title'],
                                $this->str($body, 'language') ?: 'English',
                                $this->str($body, 'book_type') ?: 'Other',
                                $acq['acquisition_type'] === 'Donation' && !empty($acq['donor_name'])
                                    ? 'Donated by ' . $acq['donor_name'] : null,
                            ]
                        );
                        $bookId      = (int)$db->getDriver()->lastInsertId();
                        $createdBook = true;

                        // ── 2. Credit the author named on the request ─────────
                        $authorName = trim((string)($acq['author'] ?? ''));
                        if ($authorName !== '') {
                            $first = $authorName;
                            $last  = '';
                            if (str_contains($authorName, ' ')) {
                                $pos   = strrpos($authorName, ' ');
                                $last  = trim(substr($authorName, $pos + 1));
                                $first = trim(substr($authorName, 0, $pos));
                            }

                            $found = $db->execute(
                                'SELECT id FROM lib_authors
                                 WHERE ssms_client_code = ? AND LOWER(first_name) = LOWER(?)
                                   AND LOWER(last_name) = LOWER(?) LIMIT 1',
                                [$clientCode, $first, $last]
                            )->fetch('assoc');

                            if ($found) {
                                $authorId = (int)$found['id'];
                            } else {
                                $db->execute(
                                    'INSERT INTO lib_authors (ssms_client_code, first_name, last_name)
                                     VALUES (?, ?, ?)',
                                    [$clientCode, $first, $last]
                                );
                                $authorId = (int)$db->getDriver()->lastInsertId();
                            }

                            $db->execute(
                                'INSERT IGNORE INTO lib_book_authors (book_id, author_id, author_order)
                                 VALUES (?, ?, 1)',
                                [$bookId, $authorId]
                            );
                        }
                    }
                }

                // ── 3. Generate the physical copies ───────────────────────────
                $prefix = $this->str($body, 'accession_prefix')
                    ?: ((string)($settings['accession_prefix'] ?? '') ?: 'ACC');

                $seqRow = $db->execute(
                    'SELECT MAX(CAST(SUBSTRING(accession_no, ?) AS UNSIGNED)) AS mx
                     FROM   lib_book_copies
                     WHERE  ssms_client_code = ? AND accession_no LIKE ?',
                    [strlen($prefix) + 1, $clientCode, $this->like($prefix, 'prefix')]
                )->fetch('assoc');

                $seq = (int)($seqRow['mx'] ?? 0);

                $unitCost = $this->decOrNull($body, 'actual_cost');
                if ($unitCost !== null && $qty > 0) {
                    // actual_cost is the invoice total; copies carry unit price.
                    $unitCost = number_format((float)$unitCost / $qty, 2, '.', '');
                }
                if ($unitCost === null && $acq['estimated_cost'] !== null) {
                    $unitCost = number_format((float)$acq['estimated_cost'], 2, '.', '');
                }

                $received = $this->dateOrNull($body, 'received_date') ?? date('Y-m-d');
                $shelf    = $this->str($body, 'shelf_location') ?: null;
                $grade    = $this->str($body, 'condition_grade') ?: 'New';
                $copies   = [];

                for ($i = 0; $i < $qty; $i++) {
                    do {
                        $seq++;
                        $accession = $prefix . str_pad((string)$seq, 5, '0', STR_PAD_LEFT);
                        $taken = $db->execute(
                            'SELECT id FROM lib_book_copies
                             WHERE ssms_client_code = ? AND accession_no = ? LIMIT 1',
                            [$clientCode, $accession]
                        )->fetch('assoc');
                    } while ($taken);

                    $db->execute(
                        'INSERT INTO lib_book_copies
                            (ssms_client_code, book_id, accession_no, barcode, condition_grade,
                             shelf_location, status, purchase_date, purchase_price)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $clientCode, $bookId, $accession, $accession, $grade,
                            $shelf, 'Available', $received, $unitCost,
                        ]
                    );

                    $copies[] = ['id' => (int)$db->getDriver()->lastInsertId(), 'accession_no' => $accession];
                }

                // ── 4. Counters ───────────────────────────────────────────────
                $this->syncBookCounters($bookId, $db);

                // ── 5. Close, or leave open for the rest of the delivery ──────
                $totalIn   = $alreadyIn + $qty;
                $newStatus = $totalIn >= $requested ? 'Received' : (string)$acq['status'];

                $updates = [
                    'qty_received'  => $totalIn,
                    'received_date' => $received,
                    'status'        => $newStatus,
                ];
                if (($c = $this->decOrNull($body, 'actual_cost')) !== null) {
                    $updates['actual_cost'] = number_format(
                        (float)($acq['actual_cost'] ?? 0) + (float)$c,
                        2,
                        '.',
                        ''
                    );
                }
                if (($n = $this->str($body, 'notes')) !== '') {
                    $updates['notes'] = trim((string)($acq['notes'] ?? '') . "\n"
                        . $received . ' — received ' . $qty . ': ' . $n);
                }

                $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($updates)));
                $db->execute(
                    "UPDATE lib_acquisitions SET {$set} WHERE id = ? AND ssms_client_code = ?",
                    array_merge(array_values($updates), [$id, $clientCode])
                );

                return ['ok' => true, 'data' => [
                    'acquisition_id' => $id,
                    'book_id'        => $bookId,
                    'bookCreated'    => $createdBook,
                    'title'          => $acq['title'],
                    'copies'         => $copies,
                    'copyCount'      => count($copies),
                    'qty_received'   => $totalIn,
                    'qty_requested'  => $requested,
                    'status'         => $newStatus,
                ]];
            });
        } catch (\Throwable $e) {
            Log::error('receive failed: ' . $e->getMessage());
            $this->fail(500, 'Stock was not received. Nothing was changed.', 'SERVER_ERROR');

            return;
        }

        if (($result['ok'] ?? false) !== true) {
            $err = $result['error'];
            $this->fail($err['code'] === 'NOT_FOUND' ? 404 : 409, $err['message'], $err['code']);

            return;
        }

        $data = $result['data'];
        $this->audit('acquisition', $id, 'receive', null, $data);

        $this->ok(
            $data,
            null,
            $data['copyCount'] . ' cop' . ($data['copyCount'] === 1 ? 'y' : 'ies')
            . ' of "' . $data['title'] . '" added'
            . ($data['bookCreated'] ? ' and catalogued' : '') . '.'
        );
    }

    /**
     * DELETE /libraryAcquisitionApi/deleteAcquisition/{id}
     * Only while nothing has been received against it.
     */
    public function deleteAcquisition(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $acqId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT * FROM lib_acquisitions WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$acqId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Acquisition');

            return;
        }
        if ((int)$row['qty_received'] > 0) {
            $this->conflict(
                'Stock has been received against this request, so it cannot be deleted.',
                'IN_USE'
            );

            return;
        }

        $db->execute('DELETE FROM lib_acquisitions WHERE id = ? AND ssms_client_code = ?', [$acqId, $clientCode]);

        $this->audit('acquisition', $acqId, 'delete', $row, null);
        $this->ok(['id' => $acqId], null, 'Request deleted.');
    }

    /**
     * GET /libraryAcquisitionApi/filters
     * Enums, known vendors and requesters — one call for the whole filter sheet.
     */
    public function filters(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db = $this->db();

        $vendors = $db->execute(
            "SELECT DISTINCT vendor FROM lib_acquisitions
             WHERE ssms_client_code = ? AND vendor IS NOT NULL AND vendor <> ''
             ORDER BY vendor",
            [$clientCode]
        )->fetchAll('assoc');

        $requesters = $db->execute(
            "SELECT DISTINCT requested_by FROM lib_acquisitions
             WHERE ssms_client_code = ? AND requested_by IS NOT NULL AND requested_by <> ''
             ORDER BY requested_by",
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok([
            'types'       => ['Purchase', 'Donation', 'Exchange', 'Transfer'],
            'statuses'    => ['Pending', 'Approved', 'Ordered', 'Received', 'Rejected', 'Cancelled'],
            'transitions' => self::TRANSITIONS,
            'vendors'     => array_column($vendors, 'vendor'),
            'requesters'  => array_column($requesters, 'requested_by'),
        ]);
    }
}
