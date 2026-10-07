<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;
use Cake\Log\Log;

/**
 * LibraryAdminApiController
 * File: src/Controller/LibraryAdminApiController.php
 *
 * Owns: lib_settings, lib_notifications, lib_stock_takes, lib_stock_take_items
 * Reads everything else for the dashboard and reports.
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibraryAdminApi' to $apiControllers in AppController.php
 *   3. Paste the admin block from api/routes.snippet.php into config/routes.php
 */
class LibraryAdminApiController extends AppController
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
    // ⭐ DASHBOARD
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryAdminApi/dashboard
     *
     * Every tile in one request. The obvious implementation is eight endpoints
     * and eight round trips, which on school Wi-Fi is the difference between a
     * dashboard that appears and one that visibly assembles itself.
     *
     * Each tile carries the filter the app should apply when it is tapped, so
     * the dashboard needs no hardcoded knowledge of the screens behind it.
     */
    public function dashboard(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db       = $this->db();
        $settings = $this->settings($clientCode);
        $today    = date('Y-m-d');

        // One round trip for the scalar counts. UNION ALL of cheap indexed
        // aggregates beats eight separate statements.
        $rows = $db->execute(
            "SELECT 'issued_today' AS k, COUNT(*) AS v FROM lib_checkouts
              WHERE ssms_client_code = ? AND issue_date = ?
             UNION ALL
             SELECT 'returned_today', COUNT(*) FROM lib_checkouts
              WHERE ssms_client_code = ? AND return_date = ?
             UNION ALL
             SELECT 'due_today', COUNT(*) FROM lib_checkouts
              WHERE ssms_client_code = ? AND status IN ('Active','Overdue') AND due_date = ?
             UNION ALL
             SELECT 'out_now', COUNT(*) FROM lib_checkouts
              WHERE ssms_client_code = ? AND status IN ('Active','Overdue')
             UNION ALL
             SELECT 'overdue', COUNT(*) FROM lib_checkouts
              WHERE ssms_client_code = ? AND status IN ('Active','Overdue') AND due_date < CURDATE()
             UNION ALL
             SELECT 'holds_ready', COUNT(*) FROM lib_reservations
              WHERE ssms_client_code = ? AND status = 'Notified'
             UNION ALL
             SELECT 'holds_waiting', COUNT(*) FROM lib_reservations
              WHERE ssms_client_code = ? AND status = 'Waiting'
             UNION ALL
             SELECT 'titles', COUNT(*) FROM lib_books WHERE ssms_client_code = ?
             UNION ALL
             SELECT 'copies', COUNT(*) FROM lib_book_copies
              WHERE ssms_client_code = ? AND status <> 'Withdrawn'
             UNION ALL
             SELECT 'members_active', COUNT(*) FROM lib_members
              WHERE ssms_client_code = ? AND status = 'Active'
             UNION ALL
             SELECT 'computers_in_use', COUNT(*) FROM lib_computer_bookings
              WHERE ssms_client_code = ? AND booking_date = ? AND status = 'Active'
             UNION ALL
             SELECT 'acquisitions_pending', COUNT(*) FROM lib_acquisitions
              WHERE ssms_client_code = ? AND status = 'Pending'
             UNION ALL
             SELECT 'notifications_pending', COUNT(*) FROM lib_notifications
              WHERE ssms_client_code = ? AND status = 'Pending'",
            [
                $clientCode, $today,
                $clientCode, $today,
                $clientCode, $today,
                $clientCode,
                $clientCode,
                $clientCode,
                $clientCode,
                $clientCode,
                $clientCode,
                $clientCode,
                $clientCode, $today,
                $clientCode,
                $clientCode,
            ]
        )->fetchAll('assoc');

        $counts = [];
        foreach ($rows as $r) {
            $counts[$r['k']] = (int)$r['v'];
        }

        $money = $db->execute(
            "SELECT COALESCE(SUM(amount - paid_amount - waived_amount), 0) AS outstanding,
                    (SELECT COALESCE(SUM(p.amount_paid), 0)
                       FROM lib_fine_payments p
                       JOIN lib_fines f2 ON f2.id = p.fine_id
                      WHERE f2.ssms_client_code = ? AND DATE(p.paid_at) = ?) AS collected_today
             FROM   lib_fines
             WHERE  ssms_client_code = ? AND status IN ('Pending','Partial')",
            [$clientCode, $today, $clientCode]
        )->fetch('assoc') ?: [];

        $currency = $settings['currency_symbol'] ?? '';

        $tiles = [
            ['key' => 'issuedToday',   'label' => 'Issued today',   'value' => $counts['issued_today'] ?? 0,
             'route' => 'Checkouts',   'params' => ['status' => 'all', 'from' => $today, 'to' => $today]],
            ['key' => 'returnedToday', 'label' => 'Returned today', 'value' => $counts['returned_today'] ?? 0,
             'route' => 'Checkouts',   'params' => ['status' => 'returned']],
            ['key' => 'dueToday',      'label' => 'Due today',      'value' => $counts['due_today'] ?? 0,
             'route' => 'Checkouts',   'params' => ['status' => 'out']],
            ['key' => 'outNow',        'label' => 'Books out',      'value' => $counts['out_now'] ?? 0,
             'route' => 'Checkouts',   'params' => ['status' => 'out']],
            ['key' => 'overdue',       'label' => 'Overdue',        'value' => $counts['overdue'] ?? 0,
             'tone' => 'warn',         'route' => 'Overdue', 'params' => []],
            ['key' => 'holdsReady',    'label' => 'Holds to collect', 'value' => $counts['holds_ready'] ?? 0,
             'route' => 'Reservations', 'params' => ['status' => 'Notified']],
            ['key' => 'finesDue',      'label' => 'Fines outstanding',
             'value' => (float)($money['outstanding'] ?? 0), 'format' => 'money', 'currency' => $currency,
             'tone' => 'warn',         'route' => 'Fines', 'params' => ['status' => 'outstanding']],
            ['key' => 'collectedToday', 'label' => 'Collected today',
             'value' => (float)($money['collected_today'] ?? 0), 'format' => 'money', 'currency' => $currency,
             'route' => 'FineCollection', 'params' => []],
            ['key' => 'computersInUse', 'label' => 'Computers in use', 'value' => $counts['computers_in_use'] ?? 0,
             'route' => 'Computers',    'params' => []],
        ];

        // Two short lists worth showing under the tiles — both are what a
        // librarian would look at first thing in the morning.
        $dueSoon = $db->execute(
            "SELECT ck.id, ck.due_date, m.full_name AS member_name, m.class_section, b.title
             FROM   lib_checkouts ck
             JOIN   lib_members m      ON m.id  = ck.member_id
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             WHERE  ck.ssms_client_code = ? AND ck.status IN ('Active','Overdue')
               AND  ck.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 2 DAY)
             ORDER  BY ck.due_date ASC
             LIMIT  10",
            [$clientCode]
        )->fetchAll('assoc');

        $holdsReady = $db->execute(
            "SELECT r.id, r.collect_by, m.full_name AS member_name, b.title,
                    TIMESTAMPDIFF(HOUR, NOW(), r.collect_by) AS hours_left
             FROM   lib_reservations r
             JOIN   lib_members m ON m.id = r.member_id
             JOIN   lib_books b   ON b.id = r.book_id
             WHERE  r.ssms_client_code = ? AND r.status = 'Notified'
             ORDER  BY r.collect_by ASC
             LIMIT  10",
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok([
            'tiles'      => $tiles,
            'counts'     => $counts,
            'currency'   => $currency,
            'dueSoon'    => $this->castRows($dueSoon, ['id']),
            'holdsReady' => $this->castRows($holdsReady, ['id', 'hours_left']),
            'library'    => [
                'opens'  => $settings['library_opens'] ?? null,
                'closes' => $settings['library_closes'] ?? null,
            ],
            'asOf'       => date('Y-m-d H:i:s'),
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SETTINGS
    // ══════════════════════════════════════════════════════════════════════════

    /** Whitelist of writable settings columns — anything else in the body is ignored. */
    private const SETTING_INTS = [
        'loan_period_student', 'loan_period_staff', 'loan_period_guest',
        'max_books_student', 'max_books_staff', 'max_books_guest',
        'max_renewals', 'reservation_hold_hours', 'computer_slot_hours',
        'computer_daily_limit', 'computer_noshowgrace', 'grace_period_days',
    ];

    private const SETTING_DECIMALS = [
        'fine_per_day', 'fine_max_cap', 'block_issue_when_fine_over', 'lost_book_default_fine',
    ];

    // currency_symbol is deliberately absent. Currency comes from
    // ssms_clients.currency — see settings() in LibraryApiTrait — so accepting
    // writes here would create a second source of truth that silently disagrees
    // with the fee module and with every printed receipt.
    private const SETTING_STRINGS = [
        'accession_prefix', 'membership_prefix', 'receipt_prefix', 'closed_days',
    ];

    private const SETTING_TIMES = ['library_opens', 'library_closes'];

    /**
     * GET /libraryAdminApi/settings
     *
     * Named getSettings rather than settings because the trait already provides
     * a settings() helper that every controller depends on.
     */
    public function getSettings(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $row = $this->settings($clientCode);

        $this->ok($this->castRow(
            $row,
            array_merge(['id'], self::SETTING_INTS),
            self::SETTING_DECIMALS
        ));
    }

    /**
     * POST|PUT /libraryAdminApi/settings
     *
     * Admin only. Every value is range-checked: a loan period of 0 or a negative
     * fine rate would quietly corrupt every due date and every charge from that
     * moment on, and nobody would notice for a week.
     */
    public function saveSettings(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $body   = (array)$this->request->getData();
        $before = $this->settings($clientCode);

        $fields = [];
        $errors = [];

        foreach (self::SETTING_INTS as $col) {
            if (!array_key_exists($col, $body)) {
                continue;
            }
            $v = (int)$body[$col];
            if ($v < 0 || $v > 3650) {
                $errors[$col] = 'Out of range';
                continue;
            }
            if (str_starts_with($col, 'loan_period') && $v < 1) {
                $errors[$col] = 'Must be at least 1 day';
                continue;
            }
            $fields[$col] = $v;
        }

        foreach (self::SETTING_DECIMALS as $col) {
            if (!array_key_exists($col, $body)) {
                continue;
            }
            if ($body[$col] === null || $body[$col] === '') {
                $fields[$col] = null;   // NULL is meaningful: "no cap", "never block"
                continue;
            }
            $v = (float)$body[$col];
            if ($v < 0) {
                $errors[$col] = 'Cannot be negative';
                continue;
            }
            $fields[$col] = number_format($v, 2, '.', '');
        }

        foreach (self::SETTING_STRINGS as $col) {
            if (!array_key_exists($col, $body)) {
                continue;
            }
            $fields[$col] = trim((string)$body[$col]) ?: null;
        }

        foreach (self::SETTING_TIMES as $col) {
            if (!array_key_exists($col, $body)) {
                continue;
            }
            $v = trim((string)$body[$col]);
            if ($v === '') {
                $fields[$col] = null;
                continue;
            }
            if (!preg_match('/^\d{1,2}:\d{2}(:\d{2})?$/', $v)) {
                $errors[$col] = 'Use HH:MM';
                continue;
            }
            $fields[$col] = strlen($v) === 5 ? $v . ':00' : $v;
        }

        if ($errors !== []) {
            $this->invalid('Some settings could not be saved.', $errors);

            return;
        }
        if ($fields === []) {
            $this->invalid('Nothing to update.');

            return;
        }

        $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
        $this->db()->execute(
            "UPDATE lib_settings SET {$set} WHERE ssms_client_code = ?",
            array_merge(array_values($fields), [$clientCode])
        );

        $this->audit('settings', null, 'update', $before, $fields);

        // Drop the request cache so the response reflects what was just written.
        $this->clearSettingsCache();

        $this->ok($this->settings($clientCode), null, 'Settings saved.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MAINTENANCE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryAdminApi/reconcileCounters
     *
     * Rebuilds lib_books.total_copies / available_copies from lib_book_copies for
     * the whole client. The counters are a cache; the copies table is the truth.
     *
     * The application keeps them in step inside each transaction, so in normal
     * operation this changes nothing. It exists because "in normal operation" is
     * doing a lot of work in that sentence — a killed PHP process or a MySQL
     * restart mid-transaction can still leave drift, and a book stuck at
     * "0 available" is invisible until someone tries to borrow it.
     *
     * Run nightly from cron; also exposed as a button in Settings for support.
     */
    public function reconcileCounters(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $db = $this->db();

        $drifted = (int)($db->execute(
            "SELECT COUNT(*) AS c
             FROM   lib_books b
             LEFT   JOIN (
                       SELECT book_id,
                              COUNT(*) AS total,
                              SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) AS avail
                       FROM   lib_book_copies
                       WHERE  status <> 'Withdrawn'
                       GROUP  BY book_id
                   ) c ON c.book_id = b.id
             WHERE  b.ssms_client_code = ?
               AND  (b.total_copies <> COALESCE(c.total, 0) OR b.available_copies <> COALESCE(c.avail, 0))",
            [$clientCode]
        )->fetch('assoc')['c'] ?? 0);

        $db->execute(
            "UPDATE lib_books b
             LEFT   JOIN (
                       SELECT book_id,
                              COUNT(*) AS total,
                              SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) AS avail
                       FROM   lib_book_copies
                       WHERE  status <> 'Withdrawn'
                       GROUP  BY book_id
                   ) c ON c.book_id = b.id
             SET    b.total_copies     = COALESCE(c.total, 0),
                    b.available_copies = COALESCE(c.avail, 0)
             WHERE  b.ssms_client_code = ?",
            [$clientCode]
        );

        // A copy marked Issued with no open checkout can never be returned
        // through the normal flow, so surface it rather than silently fixing it.
        $orphans = $db->execute(
            "SELECT cp.id, cp.accession_no, b.title
             FROM   lib_book_copies cp
             JOIN   lib_books b ON b.id = cp.book_id
             WHERE  cp.ssms_client_code = ? AND cp.status = 'Issued'
               AND  NOT EXISTS (SELECT 1 FROM lib_checkouts ck
                                WHERE ck.copy_id = cp.id AND ck.status IN ('Active','Overdue'))
             LIMIT  50",
            [$clientCode]
        )->fetchAll('assoc');

        $this->audit('settings', null, 'reconcile', null, ['drifted' => $drifted]);

        $this->ok(
            [
                'booksRepaired' => $drifted,
                'orphanCopies'  => $this->castRows($orphans, ['id']),
                'orphanCount'   => count($orphans),
            ],
            null,
            $drifted === 0 ? 'Counters were already correct.' : $drifted . ' book(s) repaired.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryAdminApi/notifications?status=&type=&memberId=&page= */
    public function notifications(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['n.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('status')) !== null) {
            $where[] = 'n.status = ?';
            $params[] = $v;
        }
        if (($v = $this->q('type')) !== null) {
            $where[] = 'n.notification_type = ?';
            $params[] = $v;
        }
        if (($v = $this->qInt('memberId')) !== null) {
            $where[] = 'n.member_id = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_notifications n WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT n.id, n.member_id, n.notification_type, n.ref_id, n.message,
                    n.sent_at, n.status, n.created_at,
                    m.full_name AS member_name, m.membership_no, m.phone, m.email
             FROM   lib_notifications n
             LEFT   JOIN lib_members m ON m.id = n.member_id
             WHERE  {$whereSql}
             ORDER  BY FIELD(n.status, 'Failed', 'Pending', 'Sent'), n.created_at DESC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $counts = $db->execute(
            "SELECT status, COUNT(*) AS c FROM lib_notifications
             WHERE ssms_client_code = ? GROUP BY status",
            [$clientCode]
        )->fetchAll('assoc');

        $byStatus = [];
        foreach ($counts as $c) {
            $byStatus[$c['status']] = (int)$c['c'];
        }

        $this->ok(
            $this->castRows($rows, ['id', 'member_id', 'ref_id']),
            array_merge($this->paginationMeta($page, $limit, $total), ['byStatus' => $byStatus])
        );
    }

    /**
     * POST /libraryAdminApi/markNotifications
     * Body: { ids: [..], status: Sent|Failed|Pending }
     *
     * The gateway that actually delivers messages calls this back. Keeping
     * delivery out of this API means an SMS outage can never fail a return.
     */
    public function markNotifications(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body   = (array)$this->request->getData();
        $ids    = is_array($body['ids'] ?? null)
            ? array_values(array_filter(array_map('intval', $body['ids'])))
            : [];
        $status = $this->str($body, 'status');

        if ($ids === []) {
            $this->invalid('No notifications selected.', ['ids' => 'Required']);

            return;
        }
        if (!in_array($status, ['Pending', 'Sent', 'Failed'], true)) {
            $this->invalid('Status must be Pending, Sent or Failed.', ['status' => 'Invalid']);

            return;
        }

        $ph = implode(', ', array_fill(0, count($ids), '?'));

        $this->db()->execute(
            "UPDATE lib_notifications
             SET    status = ?, sent_at = CASE WHEN ? = 'Sent' THEN NOW() ELSE sent_at END
             WHERE  ssms_client_code = ? AND id IN ({$ph})",
            array_merge([$status, $status, $clientCode], $ids)
        );

        $this->ok(['updated' => count($ids), 'status' => $status], null, 'Notifications updated.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // REPORTS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryAdminApi/reportCirculation?from=&to=&groupBy=day|class|memberType|category
     * Issues and returns over a period. Defaults to the last 30 days.
     */
    public function reportCirculation(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        [$from, $to] = $this->dateRange('-30 days');
        $db = $this->db();

        $groupBy = $this->q('groupBy', 'day');
        [$select, $group] = match ($groupBy) {
            'class'      => ["COALESCE(m.class_section, 'Unassigned') AS bucket", 'm.class_section'],
            'memberType' => ['m.member_type AS bucket', 'm.member_type'],
            'category'   => ["COALESCE(cat.name, 'Uncategorised') AS bucket", 'cat.name'],
            default      => ['DATE(ck.issue_date) AS bucket', 'DATE(ck.issue_date)'],
        };

        $series = $db->execute(
            "SELECT {$select},
                    COUNT(*) AS issued,
                    SUM(CASE WHEN ck.return_date IS NOT NULL THEN 1 ELSE 0 END) AS returned
             FROM   lib_checkouts ck
             JOIN   lib_members m      ON m.id  = ck.member_id
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             LEFT   JOIN lib_categories cat ON cat.id = b.category_id
             WHERE  ck.ssms_client_code = ? AND ck.issue_date BETWEEN ? AND ?
             GROUP  BY {$group}
             ORDER  BY bucket ASC",
            [$clientCode, $from, $to]
        )->fetchAll('assoc');

        $totals = $db->execute(
            "SELECT COUNT(*) AS issued,
                    SUM(CASE WHEN return_date IS NOT NULL THEN 1 ELSE 0 END) AS returned,
                    COUNT(DISTINCT member_id) AS active_members,
                    AVG(CASE WHEN return_date IS NOT NULL
                             THEN DATEDIFF(return_date, issue_date) END) AS avg_days_kept
             FROM   lib_checkouts
             WHERE  ssms_client_code = ? AND issue_date BETWEEN ? AND ?",
            [$clientCode, $from, $to]
        )->fetch('assoc') ?: [];

        $this->ok([
            'from'    => $from,
            'to'      => $to,
            'groupBy' => $groupBy,
            'series'  => $this->castRows($series, ['issued', 'returned']),
            'totals'  => [
                'issued'        => (int)($totals['issued'] ?? 0),
                'returned'      => (int)($totals['returned'] ?? 0),
                'activeMembers' => (int)($totals['active_members'] ?? 0),
                'avgDaysKept'   => $totals['avg_days_kept'] !== null
                    ? round((float)$totals['avg_days_kept'], 1) : null,
            ],
        ]);
    }

    /**
     * GET /libraryAdminApi/reportPopular?from=&to=&limit=
     * Most borrowed titles over a period, and the categories driving demand.
     */
    public function reportPopular(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        [$from, $to] = $this->dateRange('-365 days');
        $limit = max(1, min(100, $this->qInt('limit', 20) ?? 20));
        $db = $this->db();

        $titles = $db->execute(
            "SELECT b.id, b.title, b.isbn, b.cover_image, b.total_copies, b.available_copies,
                    cat.name AS category_name,
                    COUNT(*) AS times_issued,
                    COUNT(DISTINCT ck.member_id) AS distinct_readers
             FROM   lib_checkouts ck
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             LEFT   JOIN lib_categories cat ON cat.id = b.category_id
             WHERE  ck.ssms_client_code = ? AND ck.issue_date BETWEEN ? AND ?
             GROUP  BY b.id
             ORDER  BY times_issued DESC, b.title ASC
             LIMIT  {$limit}",
            [$clientCode, $from, $to]
        )->fetchAll('assoc');

        $categories = $db->execute(
            "SELECT COALESCE(cat.name, 'Uncategorised') AS category_name, COUNT(*) AS times_issued
             FROM   lib_checkouts ck
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             LEFT   JOIN lib_categories cat ON cat.id = b.category_id
             WHERE  ck.ssms_client_code = ? AND ck.issue_date BETWEEN ? AND ?
             GROUP  BY cat.name
             ORDER  BY times_issued DESC",
            [$clientCode, $from, $to]
        )->fetchAll('assoc');

        $this->ok([
            'from'       => $from,
            'to'         => $to,
            'titles'     => $this->castRows(
                $titles,
                ['id', 'total_copies', 'available_copies', 'times_issued', 'distinct_readers']
            ),
            'categories' => $this->castRows($categories, ['times_issued']),
        ]);
    }

    /**
     * GET /libraryAdminApi/reportDeadStock?months=12&page=
     *
     * Titles that have not been borrowed in N months. Weeding candidates — the
     * report that keeps a collection from silently filling up with shelf-filler,
     * and the one nobody builds until the shelves are already full.
     */
    public function reportDeadStock(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();
        $months = max(1, min(120, $this->qInt('months', 12) ?? 12));
        $db = $this->db();

        $where = "b.ssms_client_code = ?
                  AND b.total_copies > 0
                  AND NOT EXISTS (
                      SELECT 1 FROM lib_checkouts ck
                      JOIN   lib_book_copies cp2 ON cp2.id = ck.copy_id
                      WHERE  cp2.book_id = b.id
                        AND  ck.issue_date >= DATE_SUB(CURDATE(), INTERVAL {$months} MONTH))";

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_books b WHERE {$where}",
            [$clientCode]
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT b.id, b.title, b.isbn, b.total_copies, b.times_issued, b.created_at,
                    cat.name AS category_name,
                    (SELECT MAX(ck.issue_date)
                       FROM lib_checkouts ck
                       JOIN lib_book_copies cp3 ON cp3.id = ck.copy_id
                      WHERE cp3.book_id = b.id) AS last_issued
             FROM   lib_books b
             LEFT   JOIN lib_categories cat ON cat.id = b.category_id
             WHERE  {$where}
             ORDER  BY b.total_copies DESC, b.title ASC
             LIMIT  {$limit} OFFSET {$offset}",
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['id', 'total_copies', 'times_issued']),
            array_merge($this->paginationMeta($page, $limit, $total), ['months' => $months])
        );
    }

    /**
     * GET /libraryAdminApi/reportInventory
     * Collection health at a glance: copies by status, condition, category and shelf.
     */
    public function reportInventory(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db = $this->db();

        $byStatus = $db->execute(
            'SELECT status, COUNT(*) AS copies FROM lib_book_copies
             WHERE ssms_client_code = ? GROUP BY status ORDER BY copies DESC',
            [$clientCode]
        )->fetchAll('assoc');

        $byCondition = $db->execute(
            "SELECT condition_grade, COUNT(*) AS copies FROM lib_book_copies
             WHERE ssms_client_code = ? AND status <> 'Withdrawn'
             GROUP BY condition_grade",
            [$clientCode]
        )->fetchAll('assoc');

        $byCategory = $db->execute(
            "SELECT COALESCE(cat.name, 'Uncategorised') AS category_name,
                    COUNT(DISTINCT b.id) AS titles,
                    COUNT(cp.id) AS copies
             FROM   lib_books b
             LEFT   JOIN lib_categories cat  ON cat.id = b.category_id
             LEFT   JOIN lib_book_copies cp  ON cp.book_id = b.id AND cp.status <> 'Withdrawn'
             WHERE  b.ssms_client_code = ?
             GROUP  BY cat.name
             ORDER  BY copies DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $byShelf = $db->execute(
            "SELECT COALESCE(NULLIF(shelf_location, ''), 'Unshelved') AS shelf, COUNT(*) AS copies
             FROM   lib_book_copies
             WHERE  ssms_client_code = ? AND status <> 'Withdrawn'
             GROUP  BY shelf
             ORDER  BY copies DESC
             LIMIT  50",
            [$clientCode]
        )->fetchAll('assoc');

        $value = $db->execute(
            "SELECT COALESCE(SUM(purchase_price), 0) AS total_value, COUNT(*) AS priced
             FROM   lib_book_copies
             WHERE  ssms_client_code = ? AND status <> 'Withdrawn' AND purchase_price IS NOT NULL",
            [$clientCode]
        )->fetch('assoc') ?: [];

        $settings = $this->settings($clientCode);

        $this->ok([
            'byStatus'    => $this->castRows($byStatus, ['copies']),
            'byCondition' => $this->castRows($byCondition, ['copies']),
            'byCategory'  => $this->castRows($byCategory, ['titles', 'copies']),
            'byShelf'     => $this->castRows($byShelf, ['copies']),
            'value'       => [
                'total'    => (float)($value['total_value'] ?? 0),
                'priced'   => (int)($value['priced'] ?? 0),
                'currency' => $settings['currency_symbol'] ?? '',
            ],
        ]);
    }

    /**
     * GET /libraryAdminApi/reportMembers?from=&to=&limit=
     * Who is actually using the library — and who owes the most.
     */
    public function reportMembers(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        [$from, $to] = $this->dateRange('-90 days');
        $limit = max(1, min(100, $this->qInt('limit', 20) ?? 20));
        $db = $this->db();

        $topReaders = $db->execute(
            "SELECT m.id, m.membership_no, m.full_name, m.class_section, m.member_type,
                    COUNT(*) AS borrowed
             FROM   lib_checkouts ck
             JOIN   lib_members m ON m.id = ck.member_id
             WHERE  ck.ssms_client_code = ? AND ck.issue_date BETWEEN ? AND ?
             GROUP  BY m.id
             ORDER  BY borrowed DESC, m.full_name ASC
             LIMIT  {$limit}",
            [$clientCode, $from, $to]
        )->fetchAll('assoc');

        $defaulters = $db->execute(
            "SELECT m.id, m.membership_no, m.full_name, m.class_section, m.phone,
                    COUNT(DISTINCT ck.id) AS overdue_items,
                    COALESCE(SUM(DISTINCT f.amount - f.paid_amount - f.waived_amount), 0) AS owed
             FROM   lib_members m
             LEFT   JOIN lib_checkouts ck
                    ON ck.member_id = m.id AND ck.status IN ('Active','Overdue') AND ck.due_date < CURDATE()
             LEFT   JOIN lib_fines f
                    ON f.member_id = m.id AND f.status IN ('Pending','Partial')
             WHERE  m.ssms_client_code = ?
             GROUP  BY m.id
             HAVING overdue_items > 0 OR owed > 0
             ORDER  BY owed DESC, overdue_items DESC
             LIMIT  {$limit}",
            [$clientCode]
        )->fetchAll('assoc');

        $byType = $db->execute(
            'SELECT member_type, COUNT(*) AS members,
                    SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS active
             FROM   lib_members WHERE ssms_client_code = ? GROUP BY member_type',
            ['Active', $clientCode]
        )->fetchAll('assoc');

        $inactive = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_members m
             WHERE  m.ssms_client_code = ? AND m.status = 'Active'
               AND  NOT EXISTS (SELECT 1 FROM lib_checkouts ck
                                WHERE ck.member_id = m.id AND ck.issue_date >= ?)",
            [$clientCode, $from]
        )->fetch('assoc')['c'] ?? 0);

        $settings = $this->settings($clientCode);

        $this->ok([
            'from'        => $from,
            'to'          => $to,
            'topReaders'  => $this->castRows($topReaders, ['id', 'borrowed']),
            'defaulters'  => $this->castRows($defaulters, ['id', 'overdue_items'], ['owed']),
            'byType'      => $this->castRows($byType, ['members', 'active']),
            'neverBorrowedInPeriod' => $inactive,
            'currency'    => $settings['currency_symbol'] ?? '',
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ⭐ STOCKTAKE
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryAdminApi/stockTakes?status=&page= */
    public function stockTakes(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['st.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('status')) !== null) {
            $where[] = 'st.status = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_stock_takes st WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT st.*,
                    (SELECT COUNT(*) FROM lib_stock_take_items i
                      WHERE i.stock_take_id = st.id AND i.result = 'Found') AS found,
                    (SELECT COUNT(*) FROM lib_stock_take_items i
                      WHERE i.stock_take_id = st.id AND i.result = 'Misshelved') AS misshelved,
                    (SELECT COUNT(*) FROM lib_stock_take_items i
                      WHERE i.stock_take_id = st.id AND i.result = 'Unexpected') AS unexpected
             FROM   lib_stock_takes st
             WHERE  {$whereSql}
             ORDER  BY st.started_at DESC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows(
                $rows,
                ['id', 'expected_count', 'found_count', 'found', 'misshelved', 'unexpected']
            ),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /**
     * POST /libraryAdminApi/startStockTake
     * Body: { name*, shelf_prefix, category_id }
     *
     * Snapshots how many copies are in scope at the moment it opens, so the
     * closing report can say "412 expected, 408 found, 4 missing" rather than
     * comparing against a collection that moved underneath it.
     */
    public function startStockTake(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();
        $name = $this->str($body, 'name');

        if ($name === '') {
            $this->invalid('Give this stocktake a name.', ['name' => 'Required']);

            return;
        }

        $db = $this->db();

        $open = $db->execute(
            "SELECT id, name FROM lib_stock_takes
             WHERE ssms_client_code = ? AND status = 'Open' LIMIT 1",
            [$clientCode]
        )->fetch('assoc');

        if ($open) {
            $this->conflict('"' . $open['name'] . '" is still open. Close it before starting another.', 'IN_USE');

            return;
        }

        $shelfPrefix = $this->str($body, 'shelf_prefix');
        $categoryId  = $this->intOrNull($body, 'category_id');

        [$scopeSql, $scopeParams] = $this->stockTakeScope($clientCode, $shelfPrefix, $categoryId);

        $expected = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_book_copies cp
             JOIN lib_books b ON b.id = cp.book_id
             WHERE {$scopeSql}",
            $scopeParams
        )->fetch('assoc')['c'] ?? 0);

        $scopeLabel = trim(($shelfPrefix !== '' ? 'Shelf ' . $shelfPrefix : '')
            . ($categoryId ? ' Category #' . $categoryId : '')) ?: 'Whole collection';

        $db->execute(
            'INSERT INTO lib_stock_takes
                (ssms_client_code, name, scope_filter, expected_count, started_by, status)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$clientCode, $name, $scopeLabel, $expected, $this->actor(), 'Open']
        );

        $id = $this->insertId();
        $this->audit('stocktake', $id, 'start', null, ['name' => $name, 'expected' => $expected]);

        $this->ok(
            ['id' => $id, 'name' => $name, 'scope' => $scopeLabel, 'expected' => $expected],
            null,
            'Stocktake started — ' . $expected . ' copies in scope.'
        );
    }

    /**
     * POST /libraryAdminApi/scanStockTake
     * Body: { stock_take_id*, codes: [..] }
     *
     * Takes a burst of scans rather than one at a time, so the app can buffer
     * while the librarian keeps scanning down the shelf and never blocks on the
     * network between books.
     *
     * A copy whose shelf_location does not match the scope is Misshelved, not
     * missing — it is in the building, just in the wrong place, and conflating
     * the two is what makes stocktake reports useless.
     */
    public function scanStockTake(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body  = (array)$this->request->getData();
        $takeId = $this->intOrNull($body, 'stock_take_id');
        $codes = is_array($body['codes'] ?? null) ? $body['codes'] : [];

        if (!$takeId) {
            $this->invalid('A stocktake must be selected.', ['stock_take_id' => 'Required']);

            return;
        }

        $codes = array_values(array_unique(array_filter(array_map(
            fn($c) => trim((string)$c),
            $codes
        ))));

        if ($codes === []) {
            $this->invalid('No codes were scanned.', ['codes' => 'Required']);

            return;
        }

        $db = $this->db();

        $take = $db->execute(
            'SELECT * FROM lib_stock_takes WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$takeId, $clientCode]
        )->fetch('assoc');

        if (!$take) {
            $this->notFound('Stocktake');

            return;
        }
        if ($take['status'] !== 'Open') {
            $this->conflict('This stocktake is ' . strtolower((string)$take['status']) . '.');

            return;
        }

        $actor    = $this->actor();
        $expected = (string)($take['scope_filter'] ?? '');
        $results  = [];

        foreach ($codes as $code) {
            $copy = $db->execute(
                'SELECT cp.id, cp.accession_no, cp.shelf_location, cp.status, b.title
                 FROM   lib_book_copies cp
                 JOIN   lib_books b ON b.id = cp.book_id
                 WHERE  cp.ssms_client_code = ? AND (cp.barcode = ? OR cp.accession_no = ?)
                 LIMIT  1',
                [$clientCode, $code, $code]
            )->fetch('assoc');

            if (!$copy) {
                $db->execute(
                    'INSERT INTO lib_stock_take_items
                        (stock_take_id, copy_id, scanned_code, result, scanned_by)
                     VALUES (?, NULL, ?, ?, ?)',
                    [$takeId, $code, 'Unexpected', $actor]
                );
                $results[] = ['code' => $code, 'result' => 'Unexpected', 'title' => null];
                continue;
            }

            $shelf   = (string)($copy['shelf_location'] ?? '');
            $inScope = !str_starts_with($expected, 'Shelf ')
                || str_starts_with($shelf, trim(substr($expected, 6)));

            $result = $inScope ? 'Found' : 'Misshelved';

            // One row per copy per take — rescanning the same book corrects the
            // earlier row rather than inflating the count.
            $db->execute(
                'INSERT INTO lib_stock_take_items
                    (stock_take_id, copy_id, scanned_code, result, expected_shelf, actual_shelf, scanned_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE result = VALUES(result), actual_shelf = VALUES(actual_shelf),
                                         scanned_at = NOW(), scanned_by = VALUES(scanned_by)',
                [$takeId, (int)$copy['id'], $code, $result, $expected, $shelf ?: null, $actor]
            );

            $db->execute(
                'UPDATE lib_book_copies SET last_seen_at = NOW() WHERE id = ?',
                [(int)$copy['id']]
            );

            $results[] = [
                'code'   => $code,
                'result' => $result,
                'title'  => $copy['title'],
                'shelf'  => $shelf,
                'status' => $copy['status'],
            ];
        }

        $found = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_stock_take_items
             WHERE stock_take_id = ? AND result IN ('Found','Misshelved')",
            [$takeId]
        )->fetch('assoc')['c'] ?? 0);

        $db->execute('UPDATE lib_stock_takes SET found_count = ? WHERE id = ?', [$found, $takeId]);

        $this->ok([
            'results'  => $results,
            'found'    => $found,
            'expected' => (int)$take['expected_count'],
            'progress' => (int)$take['expected_count'] > 0
                ? round($found / (int)$take['expected_count'] * 100, 1) : null,
        ]);
    }

    /**
     * POST /libraryAdminApi/closeStockTake
     * Body: { stock_take_id*, mark_missing (bool) }
     *
     * Closing works out what was never scanned. With `mark_missing` those copies
     * are recorded as Missing items on the take — a deliberate opt-in, because
     * a half-finished stocktake closed by accident should not condemn a shelf.
     */
    public function closeStockTake(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body   = (array)$this->request->getData();
        $takeId = $this->intOrNull($body, 'stock_take_id');

        if (!$takeId) {
            $this->invalid('A stocktake must be selected.', ['stock_take_id' => 'Required']);

            return;
        }

        $db = $this->db();

        $take = $db->execute(
            'SELECT * FROM lib_stock_takes WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$takeId, $clientCode]
        )->fetch('assoc');

        if (!$take) {
            $this->notFound('Stocktake');

            return;
        }
        if ($take['status'] !== 'Open') {
            $this->conflict('This stocktake is already ' . strtolower((string)$take['status']) . '.');

            return;
        }

        $scope = (string)($take['scope_filter'] ?? '');
        $shelfPrefix = str_starts_with($scope, 'Shelf ') ? trim(substr($scope, 6)) : '';

        [$scopeSql, $scopeParams] = $this->stockTakeScope($clientCode, $shelfPrefix, null);

        // In scope, not scanned, and not legitimately out on loan.
        $missing = $db->execute(
            "SELECT cp.id, cp.accession_no, cp.shelf_location, cp.status, b.title
             FROM   lib_book_copies cp
             JOIN   lib_books b ON b.id = cp.book_id
             WHERE  {$scopeSql}
               AND  cp.status NOT IN ('Issued','Withdrawn')
               AND  NOT EXISTS (SELECT 1 FROM lib_stock_take_items i
                                WHERE i.stock_take_id = ? AND i.copy_id = cp.id)",
            array_merge($scopeParams, [$takeId])
        )->fetchAll('assoc');

        if (!empty($body['mark_missing'])) {
            $actor = $this->actor();
            foreach ($missing as $mrow) {
                $db->execute(
                    'INSERT IGNORE INTO lib_stock_take_items
                        (stock_take_id, copy_id, scanned_code, result, expected_shelf, scanned_by)
                     VALUES (?, ?, NULL, ?, ?, ?)',
                    [$takeId, (int)$mrow['id'], 'Missing', $mrow['shelf_location'], $actor]
                );
            }
        }

        $db->execute(
            "UPDATE lib_stock_takes
             SET    status = 'Closed', closed_at = NOW(), closed_by = ?
             WHERE  id = ? AND ssms_client_code = ?",
            [$this->actor(), $takeId, $clientCode]
        );

        $summary = $db->execute(
            'SELECT result, COUNT(*) AS c FROM lib_stock_take_items
             WHERE stock_take_id = ? GROUP BY result',
            [$takeId]
        )->fetchAll('assoc');

        $byResult = [];
        foreach ($summary as $s) {
            $byResult[$s['result']] = (int)$s['c'];
        }

        $this->audit('stocktake', $takeId, 'close', null, $byResult);

        $this->ok([
            'id'           => $takeId,
            'expected'     => (int)$take['expected_count'],
            'byResult'     => $byResult,
            'missing'      => $this->castRows($missing, ['id']),
            'missingCount' => count($missing),
        ], null, 'Stocktake closed.');
    }

    /** GET /libraryAdminApi/stockTake/{id}?result=&page= */
    public function stockTake(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $takeId = (int)$id;
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $db = $this->db();

        $take = $db->execute(
            'SELECT * FROM lib_stock_takes WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$takeId, $clientCode]
        )->fetch('assoc');

        if (!$take) {
            $this->notFound('Stocktake');

            return;
        }

        $where  = ['i.stock_take_id = ?'];
        $params = [$takeId];

        if (($v = $this->q('result')) !== null) {
            $where[] = 'i.result = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_stock_take_items i WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $items = $total === 0 ? [] : $db->execute(
            "SELECT i.*, cp.accession_no, cp.shelf_location, cp.status AS copy_status, b.title
             FROM   lib_stock_take_items i
             LEFT   JOIN lib_book_copies cp ON cp.id = i.copy_id
             LEFT   JOIN lib_books b        ON b.id  = cp.book_id
             WHERE  {$whereSql}
             ORDER  BY FIELD(i.result, 'Missing', 'Misshelved', 'Unexpected', 'Found'), i.id ASC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $summary = $db->execute(
            'SELECT result, COUNT(*) AS c FROM lib_stock_take_items
             WHERE stock_take_id = ? GROUP BY result',
            [$takeId]
        )->fetchAll('assoc');

        $byResult = [];
        foreach ($summary as $s) {
            $byResult[$s['result']] = (int)$s['c'];
        }

        $this->ok(
            [
                'stockTake' => $this->castRow($take, ['id', 'expected_count', 'found_count']),
                'byResult'  => $byResult,
                'items'     => $this->castRows($items, ['id', 'stock_take_id', 'copy_id']),
            ],
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /** Scope clause shared by start and close, so both count the same population. */
    private function stockTakeScope(string $clientCode, string $shelfPrefix, ?int $categoryId): array
    {
        $sql    = ["cp.ssms_client_code = ?", "cp.status <> 'Withdrawn'"];
        $params = [$clientCode];

        if ($shelfPrefix !== '') {
            $sql[] = 'cp.shelf_location LIKE ?';
            $params[] = $this->like($shelfPrefix, 'prefix');
        }
        if ($categoryId !== null) {
            $sql[] = 'b.category_id = ?';
            $params[] = $categoryId;
        }

        return [implode(' AND ', $sql), $params];
    }

    /** from/to query params with a sensible default window. */
    private function dateRange(string $defaultFrom): array
    {
        $from = date('Y-m-d', strtotime($this->q('from') ?? $defaultFrom) ?: time());
        $to   = date('Y-m-d', strtotime($this->q('to') ?? 'today') ?: time());

        if (strtotime($from) > strtotime($to)) {
            [$from, $to] = [$to, $from];
        }

        return [$from, $to];
    }
}
