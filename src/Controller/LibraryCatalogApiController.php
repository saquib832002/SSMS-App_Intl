<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;
use Cake\Log\Log;

/**
 * LibraryCatalogApiController
 * File: src/Controller/LibraryCatalogApiController.php
 *
 * Owns: lib_books, lib_book_authors, lib_book_copies,
 *       lib_categories, lib_authors, lib_publishers
 *
 * Install steps:
 *   1. Copy this file to src/Controller/
 *   2. Copy Traits/LibraryApiTrait.php to src/Controller/Traits/
 *   3. Add 'LibraryCatalogApi' to the $apiControllers array in AppController.php
 *   4. Paste the route block from api/routes.snippet.php into config/routes.php
 *
 * Routes (see routes.snippet.php for the copy-paste block):
 *   GET    /libraryCatalogApi/lookup?code=            ⭐ universal barcode resolver
 *   GET    /libraryCatalogApi/books
 *   GET    /libraryCatalogApi/book/{id}
 *   POST   /libraryCatalogApi/saveBook
 *   PUT    /libraryCatalogApi/saveBook
 *   DELETE /libraryCatalogApi/deleteBook/{id}
 *   GET    /libraryCatalogApi/copies
 *   GET    /libraryCatalogApi/copy/{id}
 *   POST   /libraryCatalogApi/saveCopy
 *   PUT    /libraryCatalogApi/saveCopy
 *   POST   /libraryCatalogApi/generateCopies
 *   POST   /libraryCatalogApi/withdrawCopy
 *   DELETE /libraryCatalogApi/deleteCopy/{id}
 *   GET    /libraryCatalogApi/nextAccession
 *   GET    /libraryCatalogApi/categories   POST saveCategory   DELETE deleteCategory/{id}
 *   GET    /libraryCatalogApi/authors      POST saveAuthor     DELETE deleteAuthor/{id}
 *   POST   /libraryCatalogApi/mergeAuthors
 *   GET    /libraryCatalogApi/publishers   POST savePublisher  DELETE deletePublisher/{id}
 *   GET    /libraryCatalogApi/filters                shared dropdown payload, one call
 */
class LibraryCatalogApiController extends AppController
{
    use LibraryApiTrait;

    /** Columns returned for a book row. Kept in one place so list and detail agree. */
    private const BOOK_INTS = [
        'id', 'category_id', 'publisher_id', 'pages', 'publication_year',
        'total_copies', 'available_copies', 'times_issued',
    ];

    private const BOOK_BOOLS = ['is_reference'];

    public function initialize(): void
    {
        parent::initialize();
        // CakePHP 5: Json view class — no template files needed.
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
    // ⭐ UNIVERSAL LOOKUP — the endpoint the whole scanning UX rests on
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryCatalogApi/lookup?code=XXXX
     *
     * Resolves ANY scanned or typed string in one round trip and returns a typed
     * result, so the scanner screen never has to know what was scanned:
     *
     *   { "status": true, "data": { "type": "copy",   "copy": {...}, "book": {...},
     *                               "checkout": {...}|null, "borrower": {...}|null,
     *                               "hold": {...}|null } }
     *   { "status": true, "data": { "type": "member", "member": {...},
     *                               "loans": {...}, "fines": {...} } }
     *   { "status": true, "data": { "type": "book",   "book": {...} } }
     *
     * Resolution order: copy barcode → accession number → member barcode →
     * membership number → book ISBN.
     *
     * Everything the circulation desk needs to render its panel comes back here.
     * One request per scan, not five — this is what keeps the desk under 400ms.
     */
    public function lookup(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $code = $this->q('code');
        if ($code === null) {
            $this->invalid('A code is required.', ['code' => 'Missing']);

            return;
        }

        $db = $this->db();

        // ── 1 & 2. Copy by barcode, then by accession number ──────────────────
        $copy = $db->execute(
            'SELECT * FROM lib_book_copies
             WHERE ssms_client_code = ? AND (barcode = ? OR accession_no = ?)
             ORDER BY (barcode = ?) DESC
             LIMIT 1',
            [$clientCode, $code, $code, $code]
        )->fetch('assoc');

        if ($copy) {
            $this->ok($this->copyContext($clientCode, $copy));

            return;
        }

        // ── 3 & 4. Member by card barcode, then by membership number ──────────
        $member = $db->execute(
            'SELECT * FROM lib_members
             WHERE ssms_client_code = ? AND (barcode = ? OR membership_no = ?)
             ORDER BY (barcode = ?) DESC
             LIMIT 1',
            [$clientCode, $code, $code, $code]
        )->fetch('assoc');

        if ($member) {
            $this->ok($this->memberContext($clientCode, $member));

            return;
        }

        // ── 5. Book by ISBN (scanning the publisher's barcode on the cover) ───
        $book = $this->fetchBookRow($clientCode, null, $code);
        if ($book) {
            $this->ok(['type' => 'book', 'book' => $book]);

            return;
        }

        $this->fail(404, 'Nothing in the library matches "' . $code . '".', 'NOT_FOUND');
    }

    /**
     * Everything the desk shows after scanning a copy: the copy, its book, who
     * currently has it, and whether a hold is waiting on it.
     */
    private function copyContext(string $clientCode, array $copy): array
    {
        $db = $this->db();
        $copyId = (int)$copy['id'];
        $bookId = (int)$copy['book_id'];

        $checkout = $db->execute(
            "SELECT id, member_id, issue_date, due_date, renewals_count, status,
                    DATEDIFF(CURDATE(), due_date) AS days_late
             FROM   lib_checkouts
             WHERE  copy_id = ? AND status IN ('Active','Overdue')
             ORDER  BY id DESC LIMIT 1",
            [$copyId]
        )->fetch('assoc') ?: null;

        $borrower = null;
        if ($checkout) {
            $borrower = $db->execute(
                'SELECT id, membership_no, full_name, member_type, class_section, photo, status
                 FROM   lib_members WHERE id = ? LIMIT 1',
                [(int)$checkout['member_id']]
            )->fetch('assoc') ?: null;

            $checkout = $this->castRow($checkout, ['id', 'member_id', 'renewals_count', 'days_late']);
            // Negative days_late means it is not yet due — clamp for the UI.
            $checkout['days_late'] = max(0, (int)$checkout['days_late']);
            if ($borrower) {
                $borrower = $this->castRow($borrower, ['id']);
            }
        }

        // A hold waiting on this title means the copy must be trapped on return
        // rather than reshelved.
        $hold = $db->execute(
            "SELECT r.id, r.member_id, r.queue_position, r.status, r.collect_by,
                    m.full_name, m.membership_no
             FROM   lib_reservations r
             JOIN   lib_members m ON m.id = r.member_id
             WHERE  r.book_id = ? AND r.status IN ('Waiting','Notified')
             ORDER  BY r.queue_position ASC, r.id ASC
             LIMIT  1",
            [$bookId]
        )->fetch('assoc') ?: null;

        if ($hold) {
            $hold = $this->castRow($hold, ['id', 'member_id', 'queue_position']);
        }

        return [
            'type'     => 'copy',
            'copy'     => $this->castRow($copy, ['id', 'book_id'], ['purchase_price']),
            'book'     => $this->fetchBookRow($clientCode, $bookId),
            'checkout' => $checkout,
            'borrower' => $borrower,
            'hold'     => $hold,
        ];
    }

    /**
     * Everything the desk shows after scanning a member card.
     * Standing (loans, fines, canBorrow) comes from the trait so this and the
     * member detail screen can never drift apart.
     */
    private function memberContext(string $clientCode, array $member): array
    {
        return array_merge(['type' => 'member'], $this->memberSummary($clientCode, $member));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BOOKS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryCatalogApi/books
     *
     * Query: q, categoryId, publisherId, authorId, bookType, language,
     *        available (bool), reference (bool), since (ISO datetime — delta sync),
     *        sort (relevance|title|newest|popular|available), page, limit
     *
     * Search covers title, subtitle, ISBN, subject area, Dewey number and author
     * name. Titles use FULLTEXT with a prefix-matched final token so results
     * narrow as the librarian types; short queries fall back to LIKE because
     * InnoDB's default token minimum is 3 characters and would silently drop
     * terms like "AI" or "Go".
     */
    public function books(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        // $limit and $offset are hard-cast to int by pageParams() and are
        // interpolated rather than bound: MySQL native prepared statements
        // reject a string-bound LIMIT ('LIMIT ?' becomes LIMIT '25'), and PDO
        // binds untyped params as strings. Injection-safe because both are ints.
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where        = ['b.ssms_client_code = ?'];
        $whereParams  = [$clientCode];
        $selectExtra  = '';
        $selectParams = [];
        $defaultSort  = 'title';

        // ── Search ────────────────────────────────────────────────────────────
        if (($term = $this->q('q')) !== null) {
            $ft        = $this->fulltextExpr($term);
            $likeAny   = $this->like($term);
            $likeStart = $this->like($term, 'prefix');

            $authorExists = "EXISTS (SELECT 1 FROM lib_book_authors ba2
                                     JOIN lib_authors a2 ON a2.id = ba2.author_id
                                     WHERE ba2.book_id = b.id
                                       AND CONCAT(a2.first_name, ' ', a2.last_name) LIKE ?)";

            if ($ft !== null) {
                $selectExtra    = ', MATCH(b.title, b.subtitle) AGAINST (? IN BOOLEAN MODE) AS relevance';
                $selectParams[] = $ft;
                $defaultSort    = 'relevance';

                $where[] = "(MATCH(b.title, b.subtitle) AGAINST (? IN BOOLEAN MODE)
                             OR b.title LIKE ?
                             OR b.isbn LIKE ?
                             OR b.subject_area LIKE ?
                             OR b.dewey_decimal LIKE ?
                             OR {$authorExists})";
                array_push($whereParams, $ft, $likeAny, $likeStart, $likeAny, $likeStart, $likeAny);
            } else {
                $where[] = "(b.title LIKE ?
                             OR b.subtitle LIKE ?
                             OR b.isbn LIKE ?
                             OR b.subject_area LIKE ?
                             OR b.dewey_decimal LIKE ?
                             OR {$authorExists})";
                array_push($whereParams, $likeAny, $likeAny, $likeStart, $likeAny, $likeStart, $likeAny);
            }
        }

        // ── Filters ───────────────────────────────────────────────────────────
        if (($v = $this->qInt('categoryId')) !== null) {
            $where[] = 'b.category_id = ?';
            $whereParams[] = $v;
        }
        if (($v = $this->qInt('publisherId')) !== null) {
            $where[] = 'b.publisher_id = ?';
            $whereParams[] = $v;
        }
        if (($v = $this->qInt('authorId')) !== null) {
            $where[] = 'EXISTS (SELECT 1 FROM lib_book_authors ba3 WHERE ba3.book_id = b.id AND ba3.author_id = ?)';
            $whereParams[] = $v;
        }
        if (($v = $this->q('bookType')) !== null) {
            $where[] = 'b.book_type = ?';
            $whereParams[] = $v;
        }
        if (($v = $this->q('language')) !== null) {
            $where[] = 'b.language = ?';
            $whereParams[] = $v;
        }
        if ($this->qBool('available')) {
            $where[] = 'b.available_copies > 0';
        }
        if ($this->qBool('reference')) {
            $where[] = 'b.is_reference = 1';
        }
        // Delta sync: the app keeps a local catalogue cache and only pulls changes.
        if (($v = $this->q('since')) !== null) {
            $where[] = 'b.updated_at > ?';
            $whereParams[] = date('Y-m-d H:i:s', strtotime($v) ?: 0);
        }

        $whereSql = implode(' AND ', $where);

        // ── Sort — whitelist only, never interpolate user input ───────────────
        $sortKey = $this->q('sort', $defaultSort);
        $orderBy = match ($sortKey) {
            'relevance' => $selectExtra !== '' ? 'relevance DESC, b.title ASC' : 'b.title ASC',
            'newest'    => 'b.created_at DESC, b.id DESC',
            'popular'   => 'b.times_issued DESC, b.title ASC',
            'available' => 'b.available_copies DESC, b.title ASC',
            default     => 'b.title ASC',
        };

        $db = $this->db();

        // ── Count first (no joins, no GROUP BY — keeps it cheap) ──────────────
        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_books b WHERE {$whereSql}",
            $whereParams
        )->fetch('assoc')['c'] ?? 0);

        if ($total === 0) {
            $this->ok([], $this->paginationMeta($page, $limit, 0));

            return;
        }

        // ── Page of rows. Authors are folded in with GROUP_CONCAT so this stays
        //    a single query — no N+1 author fetch per row.
        $rows = $db->execute(
            "SELECT b.id, b.isbn, b.title, b.subtitle, b.edition, b.language, b.pages,
                    b.publication_year, b.cover_image, b.is_reference, b.book_type,
                    b.subject_area, b.dewey_decimal, b.total_copies, b.available_copies,
                    b.times_issued, b.category_id, b.publisher_id, b.updated_at,
                    c.name AS category_name,
                    p.name AS publisher_name,
                    GROUP_CONCAT(CONCAT(a.first_name, ' ', a.last_name)
                                 ORDER BY ba.author_order ASC SEPARATOR ', ') AS authors
                    {$selectExtra}
             FROM   lib_books b
             LEFT   JOIN lib_categories c    ON c.id  = b.category_id
             LEFT   JOIN lib_publishers p    ON p.id  = b.publisher_id
             LEFT   JOIN lib_book_authors ba ON ba.book_id = b.id
             LEFT   JOIN lib_authors a       ON a.id  = ba.author_id
             WHERE  {$whereSql}
             GROUP  BY b.id
             ORDER  BY {$orderBy}
             LIMIT  {$limit} OFFSET {$offset}",
            array_merge($selectParams, $whereParams)
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, self::BOOK_INTS, [], self::BOOK_BOOLS),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /**
     * GET /libraryCatalogApi/book/{id}
     * Book + authors + every copy with its current borrower, in one call.
     */
    public function book(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $bookId = (int)$id;
        $book = $this->fetchBookRow($clientCode, $bookId);
        if (!$book) {
            $this->notFound('Book');

            return;
        }

        $db = $this->db();

        $authors = $db->execute(
            'SELECT a.id, a.first_name, a.last_name, ba.author_order
             FROM   lib_book_authors ba
             JOIN   lib_authors a ON a.id = ba.author_id
             WHERE  ba.book_id = ?
             ORDER  BY ba.author_order ASC',
            [$bookId]
        )->fetchAll('assoc');

        $copies = $db->execute(
            "SELECT cp.id, cp.accession_no, cp.barcode, cp.condition_grade, cp.shelf_location,
                    cp.status, cp.purchase_date, cp.purchase_price, cp.notes, cp.last_seen_at,
                    ck.id AS checkout_id, ck.due_date,
                    m.id AS borrower_id, m.full_name AS borrower_name, m.membership_no
             FROM   lib_book_copies cp
             LEFT   JOIN lib_checkouts ck
                    ON ck.copy_id = cp.id AND ck.status IN ('Active','Overdue')
             LEFT   JOIN lib_members m ON m.id = ck.member_id
             WHERE  cp.book_id = ? AND cp.ssms_client_code = ?
             ORDER  BY cp.accession_no ASC",
            [$bookId, $clientCode]
        )->fetchAll('assoc');

        $holdCount = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_reservations
             WHERE book_id = ? AND status IN ('Waiting','Notified')",
            [$bookId]
        )->fetch('assoc')['c'] ?? 0);

        $this->ok([
            'book'      => $book,
            'authors'   => $this->castRows($authors, ['id', 'author_order']),
            'copies'    => $this->castRows($copies, ['id', 'checkout_id', 'borrower_id'], ['purchase_price']),
            'holdCount' => $holdCount,
        ]);
    }

    /** Single book row with joined names. $isbn is an alternative lookup key. */
    private function fetchBookRow(string $clientCode, ?int $bookId, ?string $isbn = null): ?array
    {
        if ($bookId === null && $isbn === null) {
            return null;
        }

        $sql = "SELECT b.*, c.name AS category_name, p.name AS publisher_name,
                       GROUP_CONCAT(CONCAT(a.first_name, ' ', a.last_name)
                                    ORDER BY ba.author_order ASC SEPARATOR ', ') AS authors
                FROM   lib_books b
                LEFT   JOIN lib_categories c    ON c.id = b.category_id
                LEFT   JOIN lib_publishers p    ON p.id = b.publisher_id
                LEFT   JOIN lib_book_authors ba ON ba.book_id = b.id
                LEFT   JOIN lib_authors a       ON a.id = ba.author_id
                WHERE  b.ssms_client_code = ? AND ";

        $sql .= $bookId !== null ? 'b.id = ?' : 'b.isbn = ?';
        $sql .= ' GROUP BY b.id LIMIT 1';

        $row = $this->db()->execute($sql, [$clientCode, $bookId ?? $isbn])->fetch('assoc');

        return $row ? $this->castRow($row, self::BOOK_INTS, [], self::BOOK_BOOLS) : null;
    }

    /**
     * POST|PUT /libraryCatalogApi/saveBook
     *
     * Body: { id?, title*, subtitle, isbn, edition, language, pages,
     *         publication_year, description, cover_image, is_reference,
     *         book_type, subject_area, dewey_decimal,
     *         category_id, publisher_id,
     *         authors: [ {id} | {first_name, last_name} ]  — order preserved }
     *
     * Authors may be sent as existing ids or as new names; unknown names are
     * created on the fly so cataloguing never requires a detour to another screen.
     */
    public function saveBook(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body   = (array)$this->request->getData();
        $bookId = $this->intOrNull($body, 'id');
        $title  = $this->str($body, 'title');
        $isbn   = $this->str($body, 'isbn');

        if ($title === '') {
            $this->invalid('Title is required.', ['title' => 'Required']);

            return;
        }

        $db = $this->db();

        // ── Duplicate ISBN guard (warn, do not silently merge) ────────────────
        if ($isbn !== '') {
            $dupe = $db->execute(
                'SELECT id, title FROM lib_books
                 WHERE ssms_client_code = ? AND isbn = ? AND (? IS NULL OR id <> ?) LIMIT 1',
                [$clientCode, $isbn, $bookId, $bookId]
            )->fetch('assoc');

            if ($dupe) {
                $this->conflict(
                    'ISBN ' . $isbn . ' is already catalogued as "' . $dupe['title']
                    . '". Add copies to that record instead of creating a duplicate.'
                );

                return;
            }
        }

        $fields = [
            'category_id'      => $this->intOrNull($body, 'category_id'),
            'publisher_id'     => $this->intOrNull($body, 'publisher_id'),
            'isbn'             => $isbn !== '' ? $isbn : null,
            'title'            => $title,
            'subtitle'         => $this->str($body, 'subtitle') ?: null,
            'edition'          => $this->str($body, 'edition') ?: null,
            'language'         => $this->str($body, 'language') ?: 'English',
            'pages'            => $this->intOrNull($body, 'pages'),
            'publication_year' => $this->intOrNull($body, 'publication_year'),
            'description'      => $this->str($body, 'description') ?: null,
            'cover_image'      => $this->str($body, 'cover_image') ?: null,
            'is_reference'     => !empty($body['is_reference']) ? 1 : 0,
            'book_type'        => $this->str($body, 'book_type') ?: 'Other',
            'subject_area'     => $this->str($body, 'subject_area') ?: null,
            'dewey_decimal'    => $this->str($body, 'dewey_decimal') ?: null,
        ];

        $authors = is_array($body['authors'] ?? null) ? $body['authors'] : [];

        try {
            $savedId = $this->transact(function () use ($db, $clientCode, $bookId, $fields, $authors) {
                if ($bookId) {
                    $exists = $db->execute(
                        'SELECT id FROM lib_books WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                        [$bookId, $clientCode]
                    )->fetch('assoc');

                    if (!$exists) {
                        throw new \RuntimeException('NOT_FOUND');
                    }

                    $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
                    $db->execute(
                        "UPDATE lib_books SET {$set} WHERE id = ? AND ssms_client_code = ?",
                        array_merge(array_values($fields), [$bookId, $clientCode])
                    );
                    $id = $bookId;
                } else {
                    $cols = array_merge(['ssms_client_code'], array_keys($fields));
                    $ph   = implode(', ', array_fill(0, count($cols), '?'));
                    $db->execute(
                        'INSERT INTO lib_books (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                        array_merge([$clientCode], array_values($fields))
                    );
                    $id = $this->insertId();
                }

                $this->syncAuthors($clientCode, $id, $authors, $db);

                return $id;
            });
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'NOT_FOUND') {
                $this->notFound('Book');

                return;
            }
            throw $e;
        } catch (\Throwable $e) {
            Log::error('saveBook failed: ' . $e->getMessage());
            $this->fail(500, 'Could not save the book. Please try again.', 'SERVER_ERROR');

            return;
        }

        $this->audit('book', $savedId, $bookId ? 'update' : 'create', null, $fields);

        $this->ok(
            $this->fetchBookRow($clientCode, $savedId),
            null,
            $bookId ? 'Book updated.' : 'Book added to the catalogue.'
        );
    }

    /**
     * Replace the author list for a book. Accepts existing ids or new names;
     * names that do not exist yet are created (matched case-insensitively so the
     * same author is not created twice with different capitalisation).
     */
    private function syncAuthors(string $clientCode, int $bookId, array $authors, $db): void
    {
        $db->execute('DELETE FROM lib_book_authors WHERE book_id = ?', [$bookId]);

        $order = 1;
        $seen  = [];

        foreach ($authors as $a) {
            $authorId = null;

            if (is_array($a) && !empty($a['id'])) {
                $authorId = (int)$a['id'];
            } else {
                $first = trim((string)(is_array($a) ? ($a['first_name'] ?? '') : $a));
                $last  = trim((string)(is_array($a) ? ($a['last_name'] ?? '') : ''));

                // Plain string "Jane Austen" → split on the last space.
                if ($last === '' && str_contains($first, ' ')) {
                    $pos   = strrpos($first, ' ');
                    $last  = trim(substr($first, $pos + 1));
                    $first = trim(substr($first, 0, $pos));
                }
                if ($first === '' && $last === '') {
                    continue;
                }

                $found = $db->execute(
                    'SELECT id FROM lib_authors
                     WHERE ssms_client_code = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
                     LIMIT 1',
                    [$clientCode, $first, $last]
                )->fetch('assoc');

                if ($found) {
                    $authorId = (int)$found['id'];
                } else {
                    $db->execute(
                        'INSERT INTO lib_authors (ssms_client_code, first_name, last_name) VALUES (?, ?, ?)',
                        [$clientCode, $first, $last]
                    );
                    $authorId = (int)$db->getDriver()->lastInsertId();
                }
            }

            if (!$authorId || isset($seen[$authorId])) {
                continue;
            }
            $seen[$authorId] = true;

            $db->execute(
                'INSERT IGNORE INTO lib_book_authors (book_id, author_id, author_order) VALUES (?, ?, ?)',
                [$bookId, $authorId, $order++]
            );
        }
    }

    /**
     * DELETE /libraryCatalogApi/deleteBook/{id}
     *
     * Refuses while copies exist. Deleting a book whose copies have circulation
     * history would orphan lib_checkouts rows and silently break every report —
     * withdraw the copies first, which keeps the history intact.
     */
    public function deleteBook(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $bookId = (int)$id;
        $db = $this->db();

        $book = $db->execute(
            'SELECT * FROM lib_books WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$bookId, $clientCode]
        )->fetch('assoc');

        if (!$book) {
            $this->notFound('Book');

            return;
        }

        $copies = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_book_copies WHERE book_id = ?',
            [$bookId]
        )->fetch('assoc')['c'] ?? 0);

        if ($copies > 0) {
            $this->conflict(
                'This book has ' . $copies . ' physical ' . ($copies === 1 ? 'copy' : 'copies')
                . '. Withdraw them before deleting the catalogue record.',
                'IN_USE'
            );

            return;
        }

        $this->transact(function () use ($db, $bookId, $clientCode) {
            $db->execute('DELETE FROM lib_book_authors WHERE book_id = ?', [$bookId]);
            $db->execute(
                "DELETE FROM lib_reservations WHERE book_id = ? AND status IN ('Waiting','Notified')",
                [$bookId]
            );
            $db->execute('DELETE FROM lib_books WHERE id = ? AND ssms_client_code = ?', [$bookId, $clientCode]);
        });

        $this->audit('book', $bookId, 'delete', $book, null);
        $this->ok(['id' => $bookId], null, 'Book deleted.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // COPIES (accession records)
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryCatalogApi/copies?bookId=&status=&shelf=&q=&page=&limit=
     * Without bookId this is the whole-collection copy register (used by stocktake).
     */
    public function copies(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['cp.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->qInt('bookId')) !== null) {
            $where[] = 'cp.book_id = ?';
            $params[] = $v;
        }
        if (($v = $this->q('status')) !== null) {
            $where[] = 'cp.status = ?';
            $params[] = $v;
        }
        if (($v = $this->q('shelf')) !== null) {
            $where[] = 'cp.shelf_location LIKE ?';
            $params[] = $this->like($v, 'prefix');
        }
        if (($v = $this->q('q')) !== null) {
            $where[] = '(cp.accession_no LIKE ? OR cp.barcode LIKE ? OR b.title LIKE ?)';
            array_push($params, $this->like($v, 'prefix'), $this->like($v, 'prefix'), $this->like($v));
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c
             FROM   lib_book_copies cp
             JOIN   lib_books b ON b.id = cp.book_id
             WHERE  {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $db->execute(
            "SELECT cp.id, cp.book_id, cp.accession_no, cp.barcode, cp.condition_grade,
                    cp.shelf_location, cp.status, cp.purchase_date, cp.purchase_price,
                    cp.notes, cp.last_seen_at,
                    b.title, b.isbn, b.dewey_decimal,
                    ck.id AS checkout_id, ck.due_date,
                    m.id AS borrower_id, m.full_name AS borrower_name
             FROM   lib_book_copies cp
             JOIN   lib_books b ON b.id = cp.book_id
             LEFT   JOIN lib_checkouts ck
                    ON ck.copy_id = cp.id AND ck.status IN ('Active','Overdue')
             LEFT   JOIN lib_members m ON m.id = ck.member_id
             WHERE  {$whereSql}
             ORDER  BY cp.accession_no ASC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['id', 'book_id', 'checkout_id', 'borrower_id'], ['purchase_price']),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /** GET /libraryCatalogApi/copy/{id} */
    public function copy(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $row = $this->db()->execute(
            'SELECT * FROM lib_book_copies WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [(int)$id, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Copy');

            return;
        }

        $this->ok($this->copyContext($clientCode, $row));
    }

    /**
     * POST|PUT /libraryCatalogApi/saveCopy
     * Body: { id?, book_id*, accession_no*, barcode, condition_grade,
     *         shelf_location, status, purchase_date, purchase_price, notes }
     */
    public function saveCopy(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body        = (array)$this->request->getData();
        $copyId      = $this->intOrNull($body, 'id');
        $bookId      = $this->intOrNull($body, 'book_id');
        $accessionNo = $this->str($body, 'accession_no');

        if (!$bookId) {
            $this->invalid('A book must be selected.', ['book_id' => 'Required']);

            return;
        }
        if ($accessionNo === '') {
            $this->invalid('Accession number is required.', ['accession_no' => 'Required']);

            return;
        }

        $db = $this->db();

        $book = $db->execute(
            'SELECT id FROM lib_books WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$bookId, $clientCode]
        )->fetch('assoc');

        if (!$book) {
            $this->notFound('Book');

            return;
        }

        // Accession numbers are unique per school — this is what the whole
        // physical inventory is keyed on.
        $dupe = $db->execute(
            'SELECT id FROM lib_book_copies
             WHERE ssms_client_code = ? AND accession_no = ? AND (? IS NULL OR id <> ?) LIMIT 1',
            [$clientCode, $accessionNo, $copyId, $copyId]
        )->fetch('assoc');

        if ($dupe) {
            $this->conflict('Accession number "' . $accessionNo . '" is already in use.');

            return;
        }

        // Default the barcode to the accession number so every copy is scannable
        // the moment it is created.
        $barcode = $this->str($body, 'barcode') ?: $accessionNo;

        $dupeBarcode = $db->execute(
            'SELECT id FROM lib_book_copies
             WHERE ssms_client_code = ? AND barcode = ? AND (? IS NULL OR id <> ?) LIMIT 1',
            [$clientCode, $barcode, $copyId, $copyId]
        )->fetch('assoc');

        if ($dupeBarcode) {
            $this->conflict('Barcode "' . $barcode . '" is already assigned to another copy.');

            return;
        }

        $status = $this->str($body, 'status') ?: 'Available';

        // Status is owned by circulation, not by this screen. Letting a librarian
        // flip a copy from Issued to Available here would strand the checkout row.
        if ($copyId) {
            $current = $db->execute(
                'SELECT * FROM lib_book_copies WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                [$copyId, $clientCode]
            )->fetch('assoc');

            if (!$current) {
                $this->notFound('Copy');

                return;
            }
            if ($current['status'] === 'Issued' && $status !== 'Issued') {
                $this->conflict(
                    'This copy is currently issued. Return it before changing its status.',
                    'ALREADY_ISSUED'
                );

                return;
            }
        }

        $fields = [
            'book_id'         => $bookId,
            'accession_no'    => $accessionNo,
            'barcode'         => $barcode,
            'condition_grade' => $this->str($body, 'condition_grade') ?: 'Good',
            'shelf_location'  => $this->str($body, 'shelf_location') ?: null,
            'status'          => $status,
            'purchase_date'   => $this->dateOrNull($body, 'purchase_date'),
            'purchase_price'  => $this->decOrNull($body, 'purchase_price'),
            'notes'           => $this->str($body, 'notes') ?: null,
        ];

        $savedId = $this->transact(function () use ($db, $clientCode, $copyId, $bookId, $fields) {
            if ($copyId) {
                $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
                $db->execute(
                    "UPDATE lib_book_copies SET {$set} WHERE id = ? AND ssms_client_code = ?",
                    array_merge(array_values($fields), [$copyId, $clientCode])
                );
                $id = $copyId;
            } else {
                $cols = array_merge(['ssms_client_code'], array_keys($fields));
                $ph   = implode(', ', array_fill(0, count($cols), '?'));
                $db->execute(
                    'INSERT INTO lib_book_copies (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                    array_merge([$clientCode], array_values($fields))
                );
                $id = $this->insertId();
            }

            // Counters are a cache over lib_book_copies — refresh in the same
            // transaction, never after it.
            $this->syncBookCounters($bookId, $db);

            return $id;
        });

        $this->audit('copy', $savedId, $copyId ? 'update' : 'create', null, $fields);

        $this->ok(['id' => $savedId], null, $copyId ? 'Copy updated.' : 'Copy added.');
    }

    /**
     * POST /libraryCatalogApi/generateCopies
     * Body: { book_id*, quantity*, prefix, start_no, shelf_location,
     *         condition_grade, purchase_date, purchase_price }
     *
     * Bulk accession creation. Receiving a carton of 40 identical textbooks is
     * one call, not forty — this is the single biggest time saver in cataloguing.
     */
    public function generateCopies(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body     = (array)$this->request->getData();
        $bookId   = $this->intOrNull($body, 'book_id');
        $quantity = (int)($body['quantity'] ?? 0);

        if (!$bookId) {
            $this->invalid('A book must be selected.', ['book_id' => 'Required']);

            return;
        }
        if ($quantity < 1 || $quantity > 500) {
            $this->invalid('Quantity must be between 1 and 500.', ['quantity' => 'Out of range']);

            return;
        }

        $db = $this->db();

        $book = $db->execute(
            'SELECT id, title FROM lib_books WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$bookId, $clientCode]
        )->fetch('assoc');

        if (!$book) {
            $this->notFound('Book');

            return;
        }

        $settings = $this->settings($clientCode);
        $prefix   = $this->str($body, 'prefix') ?: ((string)($settings['accession_prefix'] ?? '') ?: 'ACC');
        $next     = $this->intOrNull($body, 'start_no') ?? $this->nextAccessionNumber($clientCode, $prefix);

        $common = [
            'condition_grade' => $this->str($body, 'condition_grade') ?: 'New',
            'shelf_location'  => $this->str($body, 'shelf_location') ?: null,
            'purchase_date'   => $this->dateOrNull($body, 'purchase_date'),
            'purchase_price'  => $this->decOrNull($body, 'purchase_price'),
        ];

        $created = [];

        try {
            $created = $this->transact(function () use (
                $db, $clientCode, $bookId, $quantity, $prefix, $next, $common
            ) {
                $made = [];
                $n    = $next;

                for ($i = 0; $i < $quantity; $i++) {
                    // Skip numbers already taken — a previous partial run, or a
                    // manually created copy, must not collide.
                    do {
                        $accession = $prefix . str_pad((string)$n, 5, '0', STR_PAD_LEFT);
                        $taken = $db->execute(
                            'SELECT id FROM lib_book_copies
                             WHERE ssms_client_code = ? AND accession_no = ? LIMIT 1',
                            [$clientCode, $accession]
                        )->fetch('assoc');
                        $n++;
                    } while ($taken);

                    $db->execute(
                        'INSERT INTO lib_book_copies
                            (ssms_client_code, book_id, accession_no, barcode, condition_grade,
                             shelf_location, status, purchase_date, purchase_price)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $clientCode, $bookId, $accession, $accession,
                            $common['condition_grade'], $common['shelf_location'],
                            'Available', $common['purchase_date'], $common['purchase_price'],
                        ]
                    );

                    $made[] = ['id' => (int)$db->getDriver()->lastInsertId(), 'accession_no' => $accession];
                }

                $this->syncBookCounters($bookId, $db);

                return $made;
            });
        } catch (\Throwable $e) {
            Log::error('generateCopies failed: ' . $e->getMessage());
            $this->fail(500, 'Could not create the copies. No copies were added.', 'SERVER_ERROR');

            return;
        }

        $this->audit('copy', $bookId, 'bulk_create', null, ['quantity' => $quantity, 'prefix' => $prefix]);

        $this->ok(
            ['copies' => $created, 'count' => count($created)],
            null,
            count($created) . ' ' . (count($created) === 1 ? 'copy' : 'copies')
                . ' added to "' . $book['title'] . '".'
        );
    }

    /** GET /libraryCatalogApi/nextAccession?prefix=ACC */
    public function nextAccession(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $settings = $this->settings($clientCode);
        $prefix   = $this->q('prefix') ?? ((string)($settings['accession_prefix'] ?? '') ?: 'ACC');
        $n        = $this->nextAccessionNumber($clientCode, $prefix);

        $this->ok([
            'prefix'      => $prefix,
            'next'        => $n,
            'accessionNo' => $prefix . str_pad((string)$n, 5, '0', STR_PAD_LEFT),
        ]);
    }

    /** Highest numeric suffix already used for a prefix, plus one. */
    private function nextAccessionNumber(string $clientCode, string $prefix): int
    {
        $row = $this->db()->execute(
            'SELECT MAX(CAST(SUBSTRING(accession_no, ?) AS UNSIGNED)) AS mx
             FROM   lib_book_copies
             WHERE  ssms_client_code = ? AND accession_no LIKE ?',
            [strlen($prefix) + 1, $clientCode, $this->like($prefix, 'prefix')]
        )->fetch('assoc');

        return (int)($row['mx'] ?? 0) + 1;
    }

    /**
     * POST /libraryCatalogApi/withdrawCopy
     * Body: { id*, reason }
     *
     * Weeding. Keeps the row (so circulation history survives) but takes it out
     * of the collection and out of the counters.
     */
    public function withdrawCopy(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $body   = (array)$this->request->getData();
        $copyId = $this->intOrNull($body, 'id');
        $reason = $this->str($body, 'reason');

        if (!$copyId) {
            $this->invalid('A copy must be selected.', ['id' => 'Required']);

            return;
        }

        $db = $this->db();

        $copy = $db->execute(
            'SELECT * FROM lib_book_copies WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$copyId, $clientCode]
        )->fetch('assoc');

        if (!$copy) {
            $this->notFound('Copy');

            return;
        }
        if ($copy['status'] === 'Issued') {
            $this->conflict('This copy is currently issued. It must be returned first.', 'ALREADY_ISSUED');

            return;
        }

        $this->transact(function () use ($db, $copyId, $clientCode, $reason, $copy) {
            $db->execute(
                "UPDATE lib_book_copies
                 SET status = 'Withdrawn', withdrawn_reason = ?, withdrawn_at = NOW()
                 WHERE id = ? AND ssms_client_code = ?",
                [$reason ?: null, $copyId, $clientCode]
            );
            $this->syncBookCounters((int)$copy['book_id'], $db);
        });

        $this->audit('copy', $copyId, 'withdraw', $copy, ['reason' => $reason]);
        $this->ok(['id' => $copyId], null, 'Copy withdrawn from the collection.');
    }

    /**
     * DELETE /libraryCatalogApi/deleteCopy/{id}
     * Hard delete — only for copies that were never circulated (data-entry fixes).
     * Anything with history must be withdrawn instead.
     */
    public function deleteCopy(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $copyId = (int)$id;
        $db = $this->db();

        $copy = $db->execute(
            'SELECT * FROM lib_book_copies WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$copyId, $clientCode]
        )->fetch('assoc');

        if (!$copy) {
            $this->notFound('Copy');

            return;
        }

        $history = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_checkouts WHERE copy_id = ?',
            [$copyId]
        )->fetch('assoc')['c'] ?? 0);

        if ($history > 0) {
            $this->conflict(
                'This copy has circulation history and cannot be deleted. Withdraw it instead.',
                'IN_USE'
            );

            return;
        }

        $this->transact(function () use ($db, $copyId, $clientCode, $copy) {
            $db->execute('DELETE FROM lib_book_copies WHERE id = ? AND ssms_client_code = ?', [$copyId, $clientCode]);
            $this->syncBookCounters((int)$copy['book_id'], $db);
        });

        $this->audit('copy', $copyId, 'delete', $copy, null);
        $this->ok(['id' => $copyId], null, 'Copy deleted.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORIES
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryCatalogApi/categories — with book counts, unpaginated (small list). */
    public function categories(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $rows = $this->db()->execute(
            'SELECT c.id, c.name, c.description,
                    (SELECT COUNT(*) FROM lib_books b WHERE b.category_id = c.id) AS book_count
             FROM   lib_categories c
             WHERE  c.ssms_client_code = ?
             ORDER  BY c.name ASC',
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok($this->castRows($rows, ['id', 'book_count']));
    }

    /** POST|PUT /libraryCatalogApi/saveCategory — { id?, name*, description } */
    public function saveCategory(): void
    {
        $this->saveSimple('lib_categories', 'category', ['name' => true, 'description' => false]);
    }

    /** DELETE /libraryCatalogApi/deleteCategory/{id} */
    public function deleteCategory(?string $id = null): void
    {
        $this->deleteSimple('lib_categories', 'category', (int)$id, [
            ['sql' => 'SELECT COUNT(*) AS c FROM lib_books WHERE category_id = ?', 'label' => 'book'],
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUTHORS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryCatalogApi/authors?q=&page=&limit= */
    public function authors(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['a.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('q')) !== null) {
            $where[] = "CONCAT(a.first_name, ' ', a.last_name) LIKE ?";
            $params[] = $this->like($v);
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_authors a WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $db->execute(
            "SELECT a.id, a.first_name, a.last_name, a.bio,
                    (SELECT COUNT(*) FROM lib_book_authors ba WHERE ba.author_id = a.id) AS book_count
             FROM   lib_authors a
             WHERE  {$whereSql}
             ORDER  BY a.last_name ASC, a.first_name ASC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['id', 'book_count']),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /** POST|PUT /libraryCatalogApi/saveAuthor — { id?, first_name*, last_name, bio } */
    public function saveAuthor(): void
    {
        $this->saveSimple('lib_authors', 'author', [
            'first_name' => true,
            'last_name'  => false,
            'bio'        => false,
        ], 'first_name');
    }

    /** DELETE /libraryCatalogApi/deleteAuthor/{id} */
    public function deleteAuthor(?string $id = null): void
    {
        $this->deleteSimple('lib_authors', 'author', (int)$id, [
            ['sql' => 'SELECT COUNT(*) AS c FROM lib_book_authors WHERE author_id = ?', 'label' => 'book'],
        ]);
    }

    /**
     * POST /libraryCatalogApi/mergeAuthors
     * Body: { source_id*, target_id* }
     *
     * Cataloguing inevitably produces "J.K. Rowling" and "JK Rowling". This
     * repoints every book to the target and removes the duplicate.
     */
    public function mergeAuthors(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $body     = (array)$this->request->getData();
        $sourceId = $this->intOrNull($body, 'source_id');
        $targetId = $this->intOrNull($body, 'target_id');

        if (!$sourceId || !$targetId || $sourceId === $targetId) {
            $this->invalid('Two different authors must be selected.');

            return;
        }

        $db = $this->db();

        $found = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_authors WHERE id IN (?, ?) AND ssms_client_code = ?',
            [$sourceId, $targetId, $clientCode]
        )->fetch('assoc')['c'] ?? 0);

        if ($found !== 2) {
            $this->notFound('Author');

            return;
        }

        $moved = $this->transact(function () use ($db, $sourceId, $targetId, $clientCode) {
            // IGNORE handles books already credited to both authors.
            $db->execute(
                'UPDATE IGNORE lib_book_authors SET author_id = ? WHERE author_id = ?',
                [$targetId, $sourceId]
            );
            $count = (int)($db->execute(
                'SELECT COUNT(*) AS c FROM lib_book_authors WHERE author_id = ?',
                [$targetId]
            )->fetch('assoc')['c'] ?? 0);

            $db->execute('DELETE FROM lib_book_authors WHERE author_id = ?', [$sourceId]);
            $db->execute('DELETE FROM lib_authors WHERE id = ? AND ssms_client_code = ?', [$sourceId, $clientCode]);

            return $count;
        });

        $this->audit('author', $targetId, 'merge', ['source_id' => $sourceId], ['target_id' => $targetId]);
        $this->ok(['target_id' => $targetId, 'book_count' => $moved], null, 'Authors merged.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PUBLISHERS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryCatalogApi/publishers */
    public function publishers(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $rows = $this->db()->execute(
            'SELECT p.id, p.name, p.city, p.country, p.website,
                    (SELECT COUNT(*) FROM lib_books b WHERE b.publisher_id = p.id) AS book_count
             FROM   lib_publishers p
             WHERE  p.ssms_client_code = ?
             ORDER  BY p.name ASC',
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok($this->castRows($rows, ['id', 'book_count']));
    }

    /** POST|PUT /libraryCatalogApi/savePublisher */
    public function savePublisher(): void
    {
        $this->saveSimple('lib_publishers', 'publisher', [
            'name'    => true,
            'city'    => false,
            'country' => false,
            'website' => false,
        ]);
    }

    /** DELETE /libraryCatalogApi/deletePublisher/{id} */
    public function deletePublisher(?string $id = null): void
    {
        $this->deleteSimple('lib_publishers', 'publisher', (int)$id, [
            ['sql' => 'SELECT COUNT(*) AS c FROM lib_books WHERE publisher_id = ?', 'label' => 'book'],
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FILTERS — one call to populate every dropdown on the catalogue screen
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryCatalogApi/filters
     * Categories, publishers, distinct languages and the book_type enum in a
     * single round trip, so opening the filter sheet costs one request, not four.
     */
    public function filters(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db = $this->db();

        $categories = $db->execute(
            'SELECT id, name FROM lib_categories WHERE ssms_client_code = ? ORDER BY name ASC',
            [$clientCode]
        )->fetchAll('assoc');

        $publishers = $db->execute(
            'SELECT id, name FROM lib_publishers WHERE ssms_client_code = ? ORDER BY name ASC',
            [$clientCode]
        )->fetchAll('assoc');

        $languages = $db->execute(
            "SELECT DISTINCT language FROM lib_books
             WHERE ssms_client_code = ? AND language IS NOT NULL AND language <> ''
             ORDER BY language ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok([
            'categories' => $this->castRows($categories, ['id']),
            'publishers' => $this->castRows($publishers, ['id']),
            'languages'  => array_column($languages, 'language'),
            'bookTypes'  => [
                'Textbook', 'Fiction', 'Non-Fiction', 'Reference',
                'Periodical', 'Journal', 'E-Book', 'Other',
            ],
            'conditions' => ['New', 'Good', 'Fair', 'Poor'],
            'copyStatus' => ['Available', 'Issued', 'Reserved', 'Lost', 'Damaged', 'Withdrawn'],
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SHARED CRUD for the three simple master tables
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @param array<string,bool> $fields column => required
     * @param string $uniqueOn column that must be unique per client
     */
    private function saveSimple(string $table, string $label, array $fields, string $uniqueOn = 'name'): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();
        $id   = $this->intOrNull($body, 'id');

        $values = [];
        foreach ($fields as $col => $required) {
            $v = $this->str($body, $col);
            if ($required && $v === '') {
                $this->invalid(ucfirst(str_replace('_', ' ', $col)) . ' is required.', [$col => 'Required']);

                return;
            }
            $values[$col] = $v !== '' ? $v : null;
        }

        $db = $this->db();

        $dupe = $db->execute(
            "SELECT id FROM {$table}
             WHERE ssms_client_code = ? AND LOWER(`{$uniqueOn}`) = LOWER(?) AND (? IS NULL OR id <> ?)
             LIMIT 1",
            [$clientCode, $values[$uniqueOn], $id, $id]
        )->fetch('assoc');

        if ($dupe) {
            $this->conflict('A ' . $label . ' named "' . $values[$uniqueOn] . '" already exists.');

            return;
        }

        if ($id) {
            $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($values)));
            $db->execute(
                "UPDATE {$table} SET {$set} WHERE id = ? AND ssms_client_code = ?",
                array_merge(array_values($values), [$id, $clientCode])
            );
        } else {
            $cols = array_merge(['ssms_client_code'], array_keys($values));
            $ph   = implode(', ', array_fill(0, count($cols), '?'));
            $db->execute(
                "INSERT INTO {$table} (`" . implode('`, `', $cols) . "`) VALUES ({$ph})",
                array_merge([$clientCode], array_values($values))
            );
            $id = $this->insertId();
        }

        $this->audit($label, $id, 'save', null, $values);
        $this->ok(['id' => $id], null, ucfirst($label) . ' saved.');
    }

    /** @param array<int,array{sql:string,label:string}> $guards */
    private function deleteSimple(string $table, string $label, int $id, array $guards): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $db = $this->db();

        $row = $db->execute(
            "SELECT * FROM {$table} WHERE id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound(ucfirst($label));

            return;
        }

        foreach ($guards as $guard) {
            $count = (int)($db->execute($guard['sql'], [$id])->fetch('assoc')['c'] ?? 0);
            if ($count > 0) {
                $this->conflict(
                    'This ' . $label . ' is used by ' . $count . ' '
                    . $guard['label'] . ($count === 1 ? '' : 's') . ' and cannot be deleted.',
                    'IN_USE'
                );

                return;
            }
        }

        $db->execute("DELETE FROM {$table} WHERE id = ? AND ssms_client_code = ?", [$id, $clientCode]);

        $this->audit($label, $id, 'delete', $row, null);
        $this->ok(['id' => $id], null, ucfirst($label) . ' deleted.');
    }
}
