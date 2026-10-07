<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;

/**
 * LibraryProgramApiController
 * File: src/Controller/LibraryProgramApiController.php
 *
 * Owns: lib_reading_programs, lib_reading_logs
 *
 * Reading challenges are the part of a school library that actually changes
 * behaviour, and the reason they usually fail is administrative friction: if
 * logging a book takes a librarian two minutes, nobody logs anything.
 *
 * So logging accepts a checkout_id and fills in the rest, progress is computed
 * server-side, and the leaderboard is one query rather than a per-member loop.
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibraryProgramApi' to $apiControllers in AppController.php
 *   3. Paste the program block from api/routes.snippet.php into config/routes.php
 */
class LibraryProgramApiController extends AppController
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
    // PROGRAMS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryProgramApi/programs?status=&q=&page= */
    public function programs(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        // Interpolated, not bound — see the note in LibraryCatalogApiController::books().
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['p.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('status')) !== null && $v !== 'all') {
            $where[] = 'p.status = ?';
            $params[] = $v;
        }
        if (($v = $this->q('q')) !== null) {
            $where[] = 'p.name LIKE ?';
            $params[] = $this->like($v);
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_reading_programs p WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT p.*,
                    DATEDIFF(p.end_date, CURDATE()) AS days_left,
                    (SELECT COUNT(DISTINCT l.member_id) FROM lib_reading_logs l
                      WHERE l.program_id = p.id) AS participants,
                    (SELECT COUNT(*) FROM lib_reading_logs l
                      WHERE l.program_id = p.id) AS books_logged
             FROM   lib_reading_programs p
             WHERE  {$whereSql}
             ORDER  BY FIELD(p.status, 'Active', 'Draft', 'Completed', 'Cancelled'),
                       p.start_date DESC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['id', 'target_books', 'days_left', 'participants', 'books_logged']),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /**
     * GET /libraryProgramApi/program/{id}
     * The programme plus headline stats: how many joined, how many finished,
     * and the books being read most.
     */
    public function program(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $programId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT p.*, DATEDIFF(p.end_date, CURDATE()) AS days_left
             FROM   lib_reading_programs p
             WHERE  p.id = ? AND p.ssms_client_code = ? LIMIT 1',
            [$programId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Programme');

            return;
        }

        $target = max(1, (int)$row['target_books']);

        $stats = $db->execute(
            "SELECT COUNT(DISTINCT member_id) AS participants,
                    COUNT(*) AS books_logged,
                    AVG(rating) AS avg_rating
             FROM   lib_reading_logs WHERE program_id = ?",
            [$programId]
        )->fetch('assoc') ?: [];

        // "Finished" = logged at least the target number of books.
        $completed = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM (
                 SELECT member_id FROM lib_reading_logs
                 WHERE program_id = ?
                 GROUP BY member_id
                 HAVING COUNT(*) >= ?
             ) t",
            [$programId, $target]
        )->fetch('assoc')['c'] ?? 0);

        $popular = $db->execute(
            "SELECT COALESCE(b.title, l.book_title) AS title,
                    COUNT(*) AS times_logged,
                    AVG(l.rating) AS avg_rating
             FROM   lib_reading_logs l
             LEFT   JOIN lib_books b ON b.id = l.book_id
             WHERE  l.program_id = ?
             GROUP  BY title
             ORDER  BY times_logged DESC
             LIMIT  10",
            [$programId]
        )->fetchAll('assoc');

        $this->ok([
            'program'   => $this->castRow($row, ['id', 'target_books', 'days_left']),
            'stats'     => [
                'participants' => (int)($stats['participants'] ?? 0),
                'booksLogged'  => (int)($stats['books_logged'] ?? 0),
                'completed'    => $completed,
                'avgRating'    => $stats['avg_rating'] !== null
                    ? round((float)$stats['avg_rating'], 2) : null,
            ],
            'popular'   => array_map(
                fn($p) => [
                    'title'        => $p['title'],
                    'times_logged' => (int)$p['times_logged'],
                    'avg_rating'   => $p['avg_rating'] !== null ? round((float)$p['avg_rating'], 2) : null,
                ],
                $popular
            ),
        ]);
    }

    /**
     * POST|PUT /libraryProgramApi/saveProgram
     * Body: { id?, name*, description, start_date, end_date, target_books,
     *         eligible_classes, reward_description, status }
     */
    public function saveProgram(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();
        $id   = $this->intOrNull($body, 'id');
        $name = $this->str($body, 'name');

        if ($name === '') {
            $this->invalid('A name is required.', ['name' => 'Required']);

            return;
        }

        $status = $this->str($body, 'status') ?: 'Draft';
        if (!in_array($status, ['Draft', 'Active', 'Completed', 'Cancelled'], true)) {
            $this->invalid('Invalid status.', ['status' => 'Invalid']);

            return;
        }

        $start  = $this->dateOrNull($body, 'start_date');
        $end    = $this->dateOrNull($body, 'end_date');
        $target = (int)($body['target_books'] ?? 5);

        if ($start !== null && $end !== null && strtotime($end) < strtotime($start)) {
            $this->invalid('End date cannot be before start date.', ['end_date' => 'Before start']);

            return;
        }
        if ($target < 1 || $target > 255) {
            $this->invalid('Target must be between 1 and 255 books.', ['target_books' => 'Out of range']);

            return;
        }

        $db = $this->db();

        $dupe = $db->execute(
            'SELECT id FROM lib_reading_programs
             WHERE ssms_client_code = ? AND LOWER(name) = LOWER(?) AND (? IS NULL OR id <> ?) LIMIT 1',
            [$clientCode, $name, $id, $id]
        )->fetch('assoc');

        if ($dupe) {
            $this->conflict('A programme called "' . $name . '" already exists.');

            return;
        }

        $fields = [
            'name'               => $name,
            'description'        => $this->str($body, 'description') ?: null,
            'start_date'         => $start,
            'end_date'           => $end,
            'target_books'       => $target,
            'eligible_classes'   => $this->str($body, 'eligible_classes') ?: 'All',
            'reward_description' => $this->str($body, 'reward_description') ?: null,
            'status'             => $status,
        ];

        if ($id) {
            $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
            $db->execute(
                "UPDATE lib_reading_programs SET {$set} WHERE id = ? AND ssms_client_code = ?",
                array_merge(array_values($fields), [$id, $clientCode])
            );
        } else {
            $fields['created_by'] = $this->actor();
            $cols = array_merge(['ssms_client_code'], array_keys($fields));
            $ph   = implode(', ', array_fill(0, count($cols), '?'));
            $db->execute(
                'INSERT INTO lib_reading_programs (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                array_merge([$clientCode], array_values($fields))
            );
            $id = $this->insertId();
        }

        $this->audit('reading_program', $id, 'save', null, $fields);
        $this->ok(['id' => $id], null, 'Programme saved.');
    }

    /** DELETE /libraryProgramApi/deleteProgram/{id} */
    public function deleteProgram(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $programId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT * FROM lib_reading_programs WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$programId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Programme');

            return;
        }

        $logs = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_reading_logs WHERE program_id = ?',
            [$programId]
        )->fetch('assoc')['c'] ?? 0);

        if ($logs > 0) {
            $this->conflict(
                'This programme has ' . $logs . ' logged book(s). Set it to Cancelled instead — '
                . 'deleting would erase the children\'s reading records.',
                'IN_USE'
            );

            return;
        }

        $db->execute(
            'DELETE FROM lib_reading_programs WHERE id = ? AND ssms_client_code = ?',
            [$programId, $clientCode]
        );

        $this->audit('reading_program', $programId, 'delete', $row, null);
        $this->ok(['id' => $programId], null, 'Programme deleted.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PARTICIPANTS + LEADERBOARD
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryProgramApi/participants?programId=*&classSection=&completed=&page=
     *
     * Progress per member against the programme target. One grouped query, not a
     * loop — with 600 pupils in a summer challenge, a per-member query would be
     * 600 round trips.
     */
    public function participants(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $programId = $this->qInt('programId');
        if (!$programId) {
            $this->invalid('A programme must be selected.', ['programId' => 'Required']);

            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();
        $db = $this->db();

        $program = $db->execute(
            'SELECT id, name, target_books FROM lib_reading_programs
             WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$programId, $clientCode]
        )->fetch('assoc');

        if (!$program) {
            $this->notFound('Programme');

            return;
        }

        $target = max(1, (int)$program['target_books']);

        $having = [];
        if ($this->qBool('completed')) {
            $having[] = 'books_read >= ' . $target;
        }

        $where  = ['l.program_id = ?'];
        $params = [$programId];

        if (($v = $this->q('classSection')) !== null) {
            $where[] = 'm.class_section = ?';
            $params[] = $v;
        }

        $whereSql  = implode(' AND ', $where);
        $havingSql = $having === [] ? '' : 'HAVING ' . implode(' AND ', $having);

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM (
                 SELECT l.member_id, COUNT(*) AS books_read
                 FROM   lib_reading_logs l
                 JOIN   lib_members m ON m.id = l.member_id
                 WHERE  {$whereSql}
                 GROUP  BY l.member_id
                 {$havingSql}
             ) t",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT m.id, m.membership_no, m.full_name, m.class_section, m.member_type, m.photo,
                    COUNT(*) AS books_read,
                    AVG(l.rating) AS avg_rating,
                    MAX(l.read_date) AS last_read
             FROM   lib_reading_logs l
             JOIN   lib_members m ON m.id = l.member_id
             WHERE  {$whereSql}
             GROUP  BY m.id
             {$havingSql}
             ORDER  BY books_read DESC, m.full_name ASC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $rank = $offset;
        $out  = [];
        foreach ($rows as $r) {
            $read = (int)$r['books_read'];
            $out[] = [
                'rank'          => ++$rank,
                'member_id'     => (int)$r['id'],
                'membership_no' => $r['membership_no'],
                'full_name'     => $r['full_name'],
                'class_section' => $r['class_section'],
                'member_type'   => $r['member_type'],
                'photo'         => $r['photo'],
                'books_read'    => $read,
                'target'        => $target,
                'progress'      => min(100, (int)round($read / $target * 100)),
                'completed'     => $read >= $target,
                'avg_rating'    => $r['avg_rating'] !== null ? round((float)$r['avg_rating'], 2) : null,
                'last_read'     => $r['last_read'],
            ];
        }

        $this->ok(
            $out,
            array_merge($this->paginationMeta($page, $limit, $total), [
                'program' => ['id' => (int)$program['id'], 'name' => $program['name'], 'target' => $target],
            ])
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // READING LOGS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryProgramApi/logs?programId=&memberId=&page= */
    public function logs(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['p.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->qInt('programId')) !== null) {
            $where[] = 'l.program_id = ?';
            $params[] = $v;
        }
        if (($v = $this->qInt('memberId')) !== null) {
            $where[] = 'l.member_id = ?';
            $params[] = $v;
        }
        if (($v = $this->qInt('minRating')) !== null) {
            $where[] = 'l.rating >= ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c
             FROM   lib_reading_logs l
             JOIN   lib_reading_programs p ON p.id = l.program_id
             WHERE  {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT l.*, COALESCE(b.title, l.book_title) AS title, b.cover_image,
                    m.full_name AS member_name, m.membership_no, m.class_section,
                    p.name AS program_name
             FROM   lib_reading_logs l
             JOIN   lib_reading_programs p ON p.id = l.program_id
             JOIN   lib_members m          ON m.id = l.member_id
             LEFT   JOIN lib_books b       ON b.id = l.book_id
             WHERE  {$whereSql}
             ORDER  BY l.read_date DESC, l.id DESC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['id', 'program_id', 'member_id', 'checkout_id', 'book_id', 'rating']),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /**
     * POST|PUT /libraryProgramApi/saveLog
     *
     * Body: { id?, program_id*, member_id | member_code, checkout_id, book_id,
     *         book_title, read_date, rating, mini_review }
     *
     * Pass a `checkout_id` and the book and member are taken from the loan —
     * a librarian logging from a returned book supplies one number, not four.
     * A free-text `book_title` is still accepted, because children read books
     * that never came from this library.
     */
    public function saveLog(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body      = (array)$this->request->getData();
        $id        = $this->intOrNull($body, 'id');
        $programId = $this->intOrNull($body, 'program_id');

        if (!$programId) {
            $this->invalid('A programme must be selected.', ['program_id' => 'Required']);

            return;
        }

        $db = $this->db();

        $program = $db->execute(
            'SELECT id, name, status, start_date, end_date FROM lib_reading_programs
             WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$programId, $clientCode]
        )->fetch('assoc');

        if (!$program) {
            $this->notFound('Programme');

            return;
        }
        if (in_array($program['status'], ['Draft', 'Cancelled'], true)) {
            $this->conflict(
                'Books cannot be logged against a ' . strtolower((string)$program['status']) . ' programme.'
            );

            return;
        }

        $memberId   = null;
        $bookId     = $this->intOrNull($body, 'book_id');
        $bookTitle  = $this->str($body, 'book_title');
        $checkoutId = $this->intOrNull($body, 'checkout_id');

        // Derive everything possible from the loan.
        if ($checkoutId) {
            $ck = $db->execute(
                'SELECT ck.id, ck.member_id, ck.return_date, cp.book_id, b.title
                 FROM   lib_checkouts ck
                 JOIN   lib_book_copies cp ON cp.id = ck.copy_id
                 JOIN   lib_books b        ON b.id  = cp.book_id
                 WHERE  ck.id = ? AND ck.ssms_client_code = ? LIMIT 1',
                [$checkoutId, $clientCode]
            )->fetch('assoc');

            if (!$ck) {
                $this->notFound('Loan');

                return;
            }

            $memberId  = (int)$ck['member_id'];
            $bookId    = $bookId ?: (int)$ck['book_id'];
            $bookTitle = $bookTitle ?: (string)$ck['title'];
        } else {
            $member = $this->resolveMember($clientCode, $body);
            if (!$member) {
                $this->fail(404, 'Member not found.', 'NOT_FOUND');

                return;
            }
            $memberId = (int)$member['id'];
        }

        if ($bookId) {
            $book = $db->execute(
                'SELECT id, title FROM lib_books WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                [$bookId, $clientCode]
            )->fetch('assoc');

            if (!$book) {
                $this->notFound('Book');

                return;
            }
            $bookTitle = $bookTitle ?: (string)$book['title'];
        }

        if ($bookTitle === '' && !$bookId) {
            $this->invalid('Choose a book or type a title.', ['book_title' => 'Required']);

            return;
        }

        $rating = $this->intOrNull($body, 'rating');
        if ($rating !== null && ($rating < 1 || $rating > 5)) {
            $this->invalid('Rating must be between 1 and 5.', ['rating' => 'Out of range']);

            return;
        }

        $readDate = $this->dateOrNull($body, 'read_date') ?? date('Y-m-d');

        // The same book logged twice against one programme inflates progress and
        // is nearly always a double-tap rather than a genuine reread.
        if ($bookId && !$id) {
            $dupe = $db->execute(
                'SELECT id FROM lib_reading_logs
                 WHERE program_id = ? AND member_id = ? AND book_id = ? LIMIT 1',
                [$programId, $memberId, $bookId]
            )->fetch('assoc');

            if ($dupe) {
                $this->conflict('This book is already logged for this member on this programme.');

                return;
            }
        }

        $fields = [
            'program_id'  => $programId,
            'member_id'   => $memberId,
            'checkout_id' => $checkoutId,
            'book_id'     => $bookId ?: null,
            'book_title'  => $bookTitle ?: null,
            'read_date'   => $readDate,
            'rating'      => $rating,
            'mini_review' => $this->str($body, 'mini_review') ?: null,
            'logged_by'   => $this->actor(),
        ];

        if ($id) {
            $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
            $db->execute(
                "UPDATE lib_reading_logs SET {$set} WHERE id = ?",
                array_merge(array_values($fields), [$id])
            );
        } else {
            $cols = array_keys($fields);
            $ph   = implode(', ', array_fill(0, count($cols), '?'));
            $db->execute(
                'INSERT INTO lib_reading_logs (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                array_values($fields)
            );
            $id = $this->insertId();
        }

        // Hand back fresh progress so the screen can show the ring move.
        $progress = $db->execute(
            'SELECT COUNT(*) AS books_read FROM lib_reading_logs
             WHERE program_id = ? AND member_id = ?',
            [$programId, $memberId]
        )->fetch('assoc') ?: [];

        $target = (int)($db->execute(
            'SELECT target_books FROM lib_reading_programs WHERE id = ? LIMIT 1',
            [$programId]
        )->fetch('assoc')['target_books'] ?? 1);

        $read = (int)($progress['books_read'] ?? 0);

        $this->ok(
            [
                'id'         => $id,
                'member_id'  => $memberId,
                'books_read' => $read,
                'target'     => $target,
                'progress'   => $target > 0 ? min(100, (int)round($read / $target * 100)) : 0,
                'completed'  => $target > 0 && $read >= $target,
            ],
            null,
            'Book logged.'
        );
    }

    /**
     * DELETE /libraryProgramApi/deleteLog/{id}
     *
     * Admin-only: removing a log entry changes a child's standing on the
     * leaderboard and cannot be undone from the app.
     */
    public function deleteLog(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $logId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT l.* FROM lib_reading_logs l
             JOIN   lib_reading_programs p ON p.id = l.program_id
             WHERE  l.id = ? AND p.ssms_client_code = ? LIMIT 1',
            [$logId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Log entry');

            return;
        }

        $db->execute('DELETE FROM lib_reading_logs WHERE id = ?', [$logId]);

        $this->audit('reading_log', $logId, 'delete', $row, null);
        $this->ok(['id' => $logId], null, 'Log entry removed.');
    }

    /**
     * GET /libraryProgramApi/loggableLoans?programId=*&memberId=
     *
     * Returned loans that have not yet been logged against this programme — the
     * shortlist a librarian picks from, so logging is a tap rather than a search.
     */
    public function loggableLoans(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $programId = $this->qInt('programId');
        if (!$programId) {
            $this->invalid('A programme must be selected.', ['programId' => 'Required']);

            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where = [
            'ck.ssms_client_code = ?',
            "ck.status = 'Returned'",
            'NOT EXISTS (SELECT 1 FROM lib_reading_logs l
                         WHERE l.program_id = ? AND l.checkout_id = ck.id)',
        ];
        $params = [$clientCode, $programId];

        if (($v = $this->qInt('memberId')) !== null) {
            $where[] = 'ck.member_id = ?';
            $params[] = $v;
        }
        if (($v = $this->q('classSection')) !== null) {
            $where[] = 'm.class_section = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c
             FROM   lib_checkouts ck
             JOIN   lib_members m ON m.id = ck.member_id
             WHERE  {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT ck.id AS checkout_id, ck.return_date, ck.member_id,
                    m.full_name AS member_name, m.class_section,
                    b.id AS book_id, b.title, b.cover_image
             FROM   lib_checkouts ck
             JOIN   lib_members m      ON m.id  = ck.member_id
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             WHERE  {$whereSql}
             ORDER  BY ck.return_date DESC, ck.id DESC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['checkout_id', 'member_id', 'book_id']),
            $this->paginationMeta($page, $limit, $total)
        );
    }
}
