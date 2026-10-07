<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;

/**
 * LibrarySerialApiController
 * File: src/Controller/LibrarySerialApiController.php
 *
 * Owns: lib_periodicals, lib_periodical_issues
 *
 * Serials work differently from books: the library subscribes to a title, and
 * individual issues arrive on a cadence. The two things that actually go wrong
 * are a subscription lapsing unnoticed and an issue never arriving, so both get
 * first-class treatment here rather than being left to someone's memory.
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibrarySerialApi' to $apiControllers in AppController.php
 *   3. Paste the serial block from api/routes.snippet.php into config/routes.php
 */
class LibrarySerialApiController extends AppController
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
    // PERIODICALS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /librarySerialApi/periodicals?q=&type=&status=&expiring=&page=
     *
     * Each row carries its issue count and latest issue, plus days_to_expiry —
     * the number that lets the app show an amber banner before a subscription
     * lapses rather than after.
     */
    public function periodicals(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        // Interpolated, not bound — see the note in LibraryCatalogApiController::books().
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['p.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('q')) !== null) {
            $where[] = '(p.title LIKE ? OR p.publisher LIKE ? OR p.issn LIKE ?)';
            array_push($params, $this->like($v), $this->like($v), $this->like($v, 'prefix'));
        }
        if (($v = $this->q('type')) !== null) {
            $where[] = 'p.periodical_type = ?';
            $params[] = $v;
        }
        if (($v = $this->q('status')) !== null) {
            $where[] = 'p.status = ?';
            $params[] = $v;
        }
        if (($v = $this->q('subjectArea')) !== null) {
            $where[] = 'p.subject_area = ?';
            $params[] = $v;
        }
        if ($this->qBool('expiring')) {
            $where[] = 'p.subscription_end IS NOT NULL
                        AND p.subscription_end <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)';
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_periodicals p WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT p.*,
                    DATEDIFF(p.subscription_end, CURDATE()) AS days_to_expiry,
                    (SELECT COUNT(*) FROM lib_periodical_issues i
                      WHERE i.periodical_id = p.id) AS issue_count,
                    (SELECT COUNT(*) FROM lib_periodical_issues i
                      WHERE i.periodical_id = p.id AND i.status = 'Missing') AS missing_count,
                    (SELECT MAX(i.publication_date) FROM lib_periodical_issues i
                      WHERE i.periodical_id = p.id) AS latest_issue_date
             FROM   lib_periodicals p
             WHERE  {$whereSql}
             ORDER  BY p.title ASC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $counts = $db->execute(
            "SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN subscription_end IS NOT NULL
                          AND subscription_end < CURDATE() THEN 1 ELSE 0 END) AS lapsed,
                SUM(CASE WHEN subscription_end IS NOT NULL
                          AND subscription_end BETWEEN CURDATE()
                              AND DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 1 ELSE 0 END) AS expiring_soon
             FROM lib_periodicals WHERE ssms_client_code = ?",
            [$clientCode]
        )->fetch('assoc') ?: [];

        $this->ok(
            $this->castRows(
                $rows,
                ['id', 'days_to_expiry', 'issue_count', 'missing_count'],
                [],
                ['is_borrowable']
            ),
            array_merge($this->paginationMeta($page, $limit, $total), [
                'summary' => [
                    'total'        => (int)($counts['total'] ?? 0),
                    'active'       => (int)($counts['active'] ?? 0),
                    'lapsed'       => (int)($counts['lapsed'] ?? 0),
                    'expiringSoon' => (int)($counts['expiring_soon'] ?? 0),
                ],
            ])
        );
    }

    /** GET /librarySerialApi/periodical/{id} — title plus its recent issues. */
    public function periodical(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $periodicalId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT p.*, DATEDIFF(p.subscription_end, CURDATE()) AS days_to_expiry
             FROM   lib_periodicals p
             WHERE  p.id = ? AND p.ssms_client_code = ? LIMIT 1',
            [$periodicalId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Periodical');

            return;
        }

        $issues = $db->execute(
            'SELECT id, volume_no, issue_no, publication_date, received_date, status, location
             FROM   lib_periodical_issues
             WHERE  periodical_id = ?
             ORDER  BY publication_date DESC, id DESC
             LIMIT  60',
            [$periodicalId]
        )->fetchAll('assoc');

        $this->ok([
            'periodical' => $this->castRow($row, ['id', 'days_to_expiry'], [], ['is_borrowable']),
            'issues'     => $this->castRows($issues, ['id']),
            'expected'   => $this->expectedIssues($row, $issues),
        ]);
    }

    /**
     * POST|PUT /librarySerialApi/savePeriodical
     * Body: { id?, title*, periodical_type, publisher, frequency, subject_area,
     *         language, issn, is_borrowable, subscription_end, status }
     */
    public function savePeriodical(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body  = (array)$this->request->getData();
        $id    = $this->intOrNull($body, 'id');
        $title = $this->str($body, 'title');

        if ($title === '') {
            $this->invalid('A title is required.', ['title' => 'Required']);

            return;
        }

        $type = $this->str($body, 'periodical_type') ?: 'Magazine';
        if (!in_array($type, ['Magazine', 'Journal', 'Newspaper', 'Newsletter'], true)) {
            $this->invalid('Invalid periodical type.', ['periodical_type' => 'Invalid']);

            return;
        }

        $frequency = $this->str($body, 'frequency');
        if ($frequency !== '' && !in_array(
            $frequency,
            ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Annual'],
            true
        )) {
            $this->invalid('Invalid frequency.', ['frequency' => 'Invalid']);

            return;
        }

        $status = $this->str($body, 'status') ?: 'Active';
        if (!in_array($status, ['Active', 'Discontinued'], true)) {
            $this->invalid('Status must be Active or Discontinued.', ['status' => 'Invalid']);

            return;
        }

        $db = $this->db();

        $dupe = $db->execute(
            'SELECT id FROM lib_periodicals
             WHERE ssms_client_code = ? AND LOWER(title) = LOWER(?) AND (? IS NULL OR id <> ?) LIMIT 1',
            [$clientCode, $title, $id, $id]
        )->fetch('assoc');

        if ($dupe) {
            $this->conflict('"' . $title . '" is already in the serials list.');

            return;
        }

        $fields = [
            'title'            => $title,
            'periodical_type'  => $type,
            'publisher'        => $this->str($body, 'publisher') ?: null,
            'frequency'        => $frequency ?: null,
            'subject_area'     => $this->str($body, 'subject_area') ?: null,
            'language'         => $this->str($body, 'language') ?: 'English',
            'issn'             => $this->str($body, 'issn') ?: null,
            'is_borrowable'    => !empty($body['is_borrowable']) ? 1 : 0,
            'subscription_end' => $this->dateOrNull($body, 'subscription_end'),
            'status'           => $status,
        ];

        if ($id) {
            $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
            $db->execute(
                "UPDATE lib_periodicals SET {$set} WHERE id = ? AND ssms_client_code = ?",
                array_merge(array_values($fields), [$id, $clientCode])
            );
        } else {
            $cols = array_merge(['ssms_client_code'], array_keys($fields));
            $ph   = implode(', ', array_fill(0, count($cols), '?'));
            $db->execute(
                'INSERT INTO lib_periodicals (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                array_merge([$clientCode], array_values($fields))
            );
            $id = $this->insertId();
        }

        $this->audit('periodical', $id, 'save', null, $fields);
        $this->ok(['id' => $id], null, 'Periodical saved.');
    }

    /** DELETE /librarySerialApi/deletePeriodical/{id} */
    public function deletePeriodical(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $periodicalId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT * FROM lib_periodicals WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$periodicalId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Periodical');

            return;
        }

        $issues = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_periodical_issues WHERE periodical_id = ?',
            [$periodicalId]
        )->fetch('assoc')['c'] ?? 0);

        if ($issues > 0) {
            $this->conflict(
                'This title has ' . $issues . ' issue(s) on record. Set it to Discontinued instead.',
                'IN_USE'
            );

            return;
        }

        $db->execute('DELETE FROM lib_periodicals WHERE id = ? AND ssms_client_code = ?', [$periodicalId, $clientCode]);

        $this->audit('periodical', $periodicalId, 'delete', $row, null);
        $this->ok(['id' => $periodicalId], null, 'Periodical deleted.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ISSUES
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /librarySerialApi/issues?periodicalId=&status=&page= */
    public function issues(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['p.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->qInt('periodicalId')) !== null) {
            $where[] = 'i.periodical_id = ?';
            $params[] = $v;
        }
        if (($v = $this->q('status')) !== null) {
            $where[] = 'i.status = ?';
            $params[] = $v;
        }

        $whereSql = implode(' AND ', $where);
        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c
             FROM   lib_periodical_issues i
             JOIN   lib_periodicals p ON p.id = i.periodical_id
             WHERE  {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        $rows = $total === 0 ? [] : $db->execute(
            "SELECT i.*, p.title, p.periodical_type, p.frequency
             FROM   lib_periodical_issues i
             JOIN   lib_periodicals p ON p.id = i.periodical_id
             WHERE  {$whereSql}
             ORDER  BY i.publication_date DESC, i.id DESC
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows($rows, ['id', 'periodical_id']),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    /**
     * POST|PUT /librarySerialApi/saveIssue
     * Body: { id?, periodical_id*, volume_no, issue_no, publication_date,
     *         received_date, status, location }
     *
     * Recording receipt is the daily job here — an issue arrives, someone ticks
     * it off. Defaults received_date to today so that is one tap, not two.
     */
    public function saveIssue(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body         = (array)$this->request->getData();
        $id           = $this->intOrNull($body, 'id');
        $periodicalId = $this->intOrNull($body, 'periodical_id');

        if (!$periodicalId) {
            $this->invalid('A periodical must be selected.', ['periodical_id' => 'Required']);

            return;
        }

        $status = $this->str($body, 'status') ?: 'Available';
        if (!in_array($status, ['Available', 'Borrowed', 'Missing'], true)) {
            $this->invalid('Status must be Available, Borrowed or Missing.', ['status' => 'Invalid']);

            return;
        }

        $db = $this->db();

        $periodical = $db->execute(
            'SELECT id, title FROM lib_periodicals WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$periodicalId, $clientCode]
        )->fetch('assoc');

        if (!$periodical) {
            $this->notFound('Periodical');

            return;
        }

        $volume = $this->str($body, 'volume_no');
        $issue  = $this->str($body, 'issue_no');

        // Volume + issue identifies an issue. Recording the same one twice is
        // almost always a slip, and it quietly breaks the missing-issue report.
        if ($issue !== '') {
            $dupe = $db->execute(
                "SELECT id FROM lib_periodical_issues
                 WHERE periodical_id = ? AND COALESCE(volume_no, '') = ? AND issue_no = ?
                   AND (? IS NULL OR id <> ?) LIMIT 1",
                [$periodicalId, $volume, $issue, $id, $id]
            )->fetch('assoc');

            if ($dupe) {
                $this->conflict(
                    'Issue ' . ($volume !== '' ? 'vol ' . $volume . ' ' : '') . '#' . $issue
                    . ' of "' . $periodical['title'] . '" is already recorded.'
                );

                return;
            }
        }

        $fields = [
            'periodical_id'    => $periodicalId,
            'volume_no'        => $volume ?: null,
            'issue_no'         => $issue ?: null,
            'publication_date' => $this->dateOrNull($body, 'publication_date'),
            'received_date'    => $this->dateOrNull($body, 'received_date')
                ?? ($status === 'Available' ? date('Y-m-d') : null),
            'status'           => $status,
            'location'         => $this->str($body, 'location') ?: null,
        ];

        if ($id) {
            $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
            $db->execute(
                "UPDATE lib_periodical_issues SET {$set} WHERE id = ?",
                array_merge(array_values($fields), [$id])
            );
        } else {
            $cols = array_keys($fields);
            $ph   = implode(', ', array_fill(0, count($cols), '?'));
            $db->execute(
                'INSERT INTO lib_periodical_issues (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                array_values($fields)
            );
            $id = $this->insertId();
        }

        $this->audit('periodical_issue', $id, 'save', null, $fields);
        $this->ok(['id' => $id], null, 'Issue recorded.');
    }

    /**
     * DELETE /librarySerialApi/deleteIssue/{id}
     *
     * Admin-only, like every other delete: a mis-recorded issue should be
     * corrected by editing it, not by removing the holding record.
     */
    public function deleteIssue(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $issueId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT i.* FROM lib_periodical_issues i
             JOIN   lib_periodicals p ON p.id = i.periodical_id
             WHERE  i.id = ? AND p.ssms_client_code = ? LIMIT 1',
            [$issueId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Issue');

            return;
        }

        $db->execute('DELETE FROM lib_periodical_issues WHERE id = ?', [$issueId]);

        $this->audit('periodical_issue', $issueId, 'delete', $row, null);
        $this->ok(['id' => $issueId], null, 'Issue deleted.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SUBSCRIPTION WATCH
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /librarySerialApi/expiring?days=60
     *
     * Subscriptions lapsing soon, and ones that already have. A lapsed
     * subscription is usually discovered when a reader asks where this month's
     * issue is, which is several weeks too late to renew quietly.
     */
    public function expiring(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $days = max(1, min(365, $this->qInt('days', 60) ?? 60));
        $db = $this->db();

        $rows = $db->execute(
            "SELECT id, title, periodical_type, publisher, frequency, subscription_end,
                    DATEDIFF(subscription_end, CURDATE()) AS days_to_expiry, status
             FROM   lib_periodicals
             WHERE  ssms_client_code = ? AND status = 'Active'
               AND  subscription_end IS NOT NULL
               AND  subscription_end <= DATE_ADD(CURDATE(), INTERVAL {$days} DAY)
             ORDER  BY subscription_end ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $lapsed = [];
        $soon   = [];
        foreach ($this->castRows($rows, ['id', 'days_to_expiry']) as $r) {
            if ((int)$r['days_to_expiry'] < 0) {
                $lapsed[] = $r;
            } else {
                $soon[] = $r;
            }
        }

        $this->ok([
            'windowDays'   => $days,
            'lapsed'       => $lapsed,
            'expiringSoon' => $soon,
            'lapsedCount'  => count($lapsed),
            'soonCount'    => count($soon),
        ]);
    }

    /**
     * GET /librarySerialApi/filters
     * Enum lists and the subject areas already in use, in one call.
     */
    public function filters(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $subjects = $this->db()->execute(
            "SELECT DISTINCT subject_area FROM lib_periodicals
             WHERE ssms_client_code = ? AND subject_area IS NOT NULL AND subject_area <> ''
             ORDER BY subject_area",
            [$clientCode]
        )->fetchAll('assoc');

        $this->ok([
            'types'        => ['Magazine', 'Journal', 'Newspaper', 'Newsletter'],
            'frequencies'  => ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Annual'],
            'statuses'     => ['Active', 'Discontinued'],
            'issueStatus'  => ['Available', 'Borrowed', 'Missing'],
            'subjectAreas' => array_column($subjects, 'subject_area'),
        ]);
    }

    /**
     * Work out which issues should have arrived since the last recorded one,
     * based on the title's stated frequency.
     *
     * This is a hint for the receiving screen, not a record: it turns "is
     * anything missing?" from a memory exercise into a visible gap. Titles with
     * no frequency set get nothing, because guessing would be worse than silence.
     *
     * @return array<int,array{expected_date:string, overdue_days:int}>
     */
    private function expectedIssues(array $periodical, array $issues): array
    {
        $interval = match ((string)($periodical['frequency'] ?? '')) {
            'Daily'       => '+1 day',
            'Weekly'      => '+1 week',
            'Fortnightly' => '+2 weeks',
            'Monthly'     => '+1 month',
            'Quarterly'   => '+3 months',
            'Annual'      => '+1 year',
            default       => null,
        };

        if ($interval === null || (string)($periodical['status'] ?? '') !== 'Active') {
            return [];
        }

        $latest = null;
        foreach ($issues as $i) {
            if (!empty($i['publication_date'])) {
                $ts = strtotime((string)$i['publication_date']);
                if ($ts !== false && ($latest === null || $ts > $latest)) {
                    $latest = $ts;
                }
            }
        }

        if ($latest === null) {
            return [];
        }

        $expected = [];
        $cursor   = strtotime($interval, $latest);
        $today    = strtotime(date('Y-m-d'));
        $guard    = 0;

        while ($cursor !== false && $cursor <= $today && $guard++ < 24) {
            $expected[] = [
                'expected_date' => date('Y-m-d', $cursor),
                'overdue_days'  => (int)floor(($today - $cursor) / 86400),
            ];
            $cursor = strtotime($interval, $cursor);
        }

        return $expected;
    }
}
