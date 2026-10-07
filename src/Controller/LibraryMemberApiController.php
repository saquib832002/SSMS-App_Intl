<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;
use Cake\Log\Log;

/**
 * LibraryMemberApiController
 * File: src/Controller/LibraryMemberApiController.php
 *
 * Owns: lib_members
 *
 * Reads (never writes) these school-system tables so library membership can be
 * created from records that already exist rather than retyped:
 *   ssms_student_registration   registration_id, student_first_name/middle/last,
 *                               email_address, mobile_number, student_photo
 *   ssms_student_enrollment     registration_id, class_id, section_id, status
 *   ssms_classes                class_id, class_name
 *   ssms_sections               section_id, section_name
 *   ssms_staff                  staff_id, staff_title, first_name, last_name,
 *                               email_address, mobile_number, staff_photo, resigned
 *
 * lib_members.ref_id holds the source key: registration_id for students,
 * staff_id for staff. That is the join back to the school record, and it is what
 * stops the same person being enrolled twice.
 *
 * Install:
 *   1. Copy to <app-root>/src/Controller/
 *   2. Add 'LibraryMemberApi' to $apiControllers in AppController.php
 *   3. Paste the member block from api/routes.snippet.php into config/routes.php
 */
class LibraryMemberApiController extends AppController
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
    // LIST
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryMemberApi/members
     *
     * Query: q, type (student|staff|guest), status (Active|Suspended|Expired),
     *        classSection, hasOverdue (bool), hasFine (bool), expiringSoon (bool),
     *        sort (name|newest|membership|mostOverdue), page, limit
     *
     * Each row carries books_out / overdue_count / outstanding_fine so the list
     * can show the badges the desk actually looks for, without a second request
     * per member.
     */
    public function members(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        // Interpolated, not bound — see the note in LibraryCatalogApiController::books().
        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();

        $where  = ['m.ssms_client_code = ?'];
        $params = [$clientCode];

        if (($v = $this->q('q')) !== null) {
            $where[] = '(m.full_name LIKE ? OR m.membership_no LIKE ? OR m.barcode LIKE ?
                         OR m.ref_id LIKE ? OR m.email LIKE ? OR m.phone LIKE ?)';
            array_push(
                $params,
                $this->like($v),
                $this->like($v, 'prefix'),
                $this->like($v, 'prefix'),
                $this->like($v, 'prefix'),
                $this->like($v, 'prefix'),
                $this->like($v, 'prefix')
            );
        }
        if (($v = $this->q('type')) !== null) {
            $where[] = 'm.member_type = ?';
            $params[] = $v;
        }
        if (($v = $this->q('status')) !== null) {
            $where[] = 'm.status = ?';
            $params[] = $v;
        }
        if (($v = $this->q('classSection')) !== null) {
            $where[] = 'm.class_section = ?';
            $params[] = $v;
        }
        if ($this->qBool('hasOverdue')) {
            $where[] = "EXISTS (SELECT 1 FROM lib_checkouts ck
                                WHERE ck.member_id = m.id AND ck.status IN ('Active','Overdue')
                                  AND ck.due_date < CURDATE())";
        }
        if ($this->qBool('hasFine')) {
            $where[] = "EXISTS (SELECT 1 FROM lib_fines f
                                WHERE f.member_id = m.id AND f.status IN ('Pending','Partial'))";
        }
        if ($this->qBool('expiringSoon')) {
            $where[] = 'm.valid_to IS NOT NULL AND m.valid_to BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
        }

        $whereSql = implode(' AND ', $where);

        $orderBy = match ($this->q('sort', 'name')) {
            'newest'      => 'm.created_at DESC, m.id DESC',
            'membership'  => 'm.membership_no ASC',
            'mostOverdue' => 'overdue_count DESC, m.full_name ASC',
            default       => 'm.full_name ASC',
        };

        $db = $this->db();

        $total = (int)($db->execute(
            "SELECT COUNT(*) AS c FROM lib_members m WHERE {$whereSql}",
            $params
        )->fetch('assoc')['c'] ?? 0);

        if ($total === 0) {
            $this->ok([], $this->paginationMeta($page, $limit, 0));

            return;
        }

        // Correlated subqueries rather than joined aggregates: MySQL evaluates
        // them only for the rows that survive LIMIT, so the cost is bounded by
        // page size (max 100) instead of by the size of lib_checkouts.
        $rows = $db->execute(
            "SELECT m.id, m.membership_no, m.barcode, m.member_type, m.ref_id, m.full_name,
                    m.email, m.phone, m.class_section, m.max_books, m.valid_from, m.valid_to,
                    m.status, m.photo, m.created_at,
                    (SELECT COUNT(*) FROM lib_checkouts ck
                      WHERE ck.member_id = m.id AND ck.status IN ('Active','Overdue')) AS books_out,
                    (SELECT COUNT(*) FROM lib_checkouts ck
                      WHERE ck.member_id = m.id AND ck.status IN ('Active','Overdue')
                        AND ck.due_date < CURDATE()) AS overdue_count,
                    (SELECT COALESCE(SUM(f.amount - f.paid_amount - f.waived_amount), 0)
                       FROM lib_fines f
                      WHERE f.member_id = m.id AND f.status IN ('Pending','Partial')) AS outstanding_fine
             FROM   lib_members m
             WHERE  {$whereSql}
             ORDER  BY {$orderBy}
             LIMIT  {$limit} OFFSET {$offset}",
            $params
        )->fetchAll('assoc');

        $this->ok(
            $this->castRows(
                $rows,
                ['id', 'max_books', 'books_out', 'overdue_count'],
                ['outstanding_fine']
            ),
            $this->paginationMeta($page, $limit, $total)
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DETAIL
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryMemberApi/member/{id}?historyLimit=20
     *
     * Everything the four tabs of the member screen need, in one call:
     * standing (from the shared trait), current loans, recent history, open
     * fines, and active holds.
     */
    public function member(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $memberId = (int)$id;
        $db = $this->db();

        $row = $db->execute(
            'SELECT * FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$memberId, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Member');

            return;
        }

        $historyLimit = max(1, min(100, $this->qInt('historyLimit', 20) ?? 20));

        $current = $db->execute(
            "SELECT ck.id, ck.issue_date, ck.due_date, ck.renewals_count, ck.status,
                    DATEDIFF(CURDATE(), ck.due_date) AS days_late,
                    cp.id AS copy_id, cp.accession_no, cp.barcode,
                    b.id AS book_id, b.title, b.cover_image
             FROM   lib_checkouts ck
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             WHERE  ck.member_id = ? AND ck.status IN ('Active','Overdue')
             ORDER  BY ck.due_date ASC",
            [$memberId]
        )->fetchAll('assoc');

        foreach ($current as &$c) {
            $c = $this->castRow($c, ['id', 'renewals_count', 'copy_id', 'book_id', 'days_late']);
            $c['days_late'] = max(0, (int)$c['days_late']);
            $c['is_overdue'] = $c['days_late'] > 0;
        }
        unset($c);

        $history = $db->execute(
            "SELECT ck.id, ck.issue_date, ck.due_date, ck.return_date, ck.status,
                    ck.condition_on_return,
                    cp.accession_no, b.title
             FROM   lib_checkouts ck
             JOIN   lib_book_copies cp ON cp.id = ck.copy_id
             JOIN   lib_books b        ON b.id  = cp.book_id
             WHERE  ck.member_id = ? AND ck.status NOT IN ('Active','Overdue')
             ORDER  BY ck.return_date DESC, ck.id DESC
             LIMIT  {$historyLimit}",
            [$memberId]
        )->fetchAll('assoc');

        $fines = $db->execute(
            "SELECT f.id, f.fine_type, f.days_overdue, f.amount, f.paid_amount, f.waived_amount,
                    f.status, f.created_at, f.checkout_id,
                    (f.amount - f.paid_amount - f.waived_amount) AS balance,
                    b.title
             FROM   lib_fines f
             LEFT   JOIN lib_checkouts ck   ON ck.id = f.checkout_id
             LEFT   JOIN lib_book_copies cp ON cp.id = ck.copy_id
             LEFT   JOIN lib_books b        ON b.id  = cp.book_id
             WHERE  f.member_id = ?
             ORDER  BY FIELD(f.status, 'Pending', 'Partial', 'Paid', 'Waived'), f.created_at DESC
             LIMIT  50",
            [$memberId]
        )->fetchAll('assoc');

        $holds = $db->execute(
            "SELECT r.id, r.book_id, r.status, r.queue_position, r.reserved_on,
                    r.notified_on, r.collect_by, b.title, b.cover_image
             FROM   lib_reservations r
             JOIN   lib_books b ON b.id = r.book_id
             WHERE  r.member_id = ? AND r.status IN ('Waiting','Notified')
             ORDER  BY r.queue_position ASC",
            [$memberId]
        )->fetchAll('assoc');

        $summary = $this->memberSummary($clientCode, $row);

        $this->ok(array_merge($summary, [
            'currentLoans' => $current,
            'history'      => $history,
            'fines'        => $this->castRows(
                $fines,
                ['id', 'days_overdue', 'checkout_id'],
                ['amount', 'paid_amount', 'waived_amount', 'balance']
            ),
            'holds'        => $this->castRows($holds, ['id', 'book_id', 'queue_position']),
            // Overwrite the trait's aggregate block with the itemised fine list
            // above; keep the totals under a distinct key so both are available.
            'fineTotals'   => $summary['fines'],
        ]));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CREATE / UPDATE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST|PUT /libraryMemberApi/saveMember
     *
     * Body: { id?, membership_no, member_type*, ref_id, full_name*, email, phone,
     *         class_section, max_books, valid_from, valid_to, status, photo,
     *         barcode, notes }
     *
     * membership_no is generated when omitted. barcode defaults to it, so a card
     * printed straight after creation is immediately scannable.
     */
    public function saveMember(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body     = (array)$this->request->getData();
        $memberId = $this->intOrNull($body, 'id');
        $fullName = $this->str($body, 'full_name');
        $type     = strtolower($this->str($body, 'member_type', 'student'));

        if ($fullName === '') {
            $this->invalid('Full name is required.', ['full_name' => 'Required']);

            return;
        }
        if (!in_array($type, ['student', 'staff', 'guest'], true)) {
            $this->invalid('Member type must be student, staff or guest.', ['member_type' => 'Invalid']);

            return;
        }

        $db       = $this->db();
        $settings = $this->settings($clientCode);

        $membershipNo = $this->str($body, 'membership_no')
            ?: ($memberId ? '' : $this->generateMembershipNo($clientCode, $settings));

        if ($memberId && $membershipNo === '') {
            $existing = $db->execute(
                'SELECT membership_no FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                [$memberId, $clientCode]
            )->fetch('assoc');

            if (!$existing) {
                $this->notFound('Member');

                return;
            }
            $membershipNo = (string)$existing['membership_no'];
        }

        $dupe = $db->execute(
            'SELECT id FROM lib_members
             WHERE ssms_client_code = ? AND membership_no = ? AND (? IS NULL OR id <> ?) LIMIT 1',
            [$clientCode, $membershipNo, $memberId, $memberId]
        )->fetch('assoc');

        if ($dupe) {
            $this->conflict('Membership number "' . $membershipNo . '" is already in use.');

            return;
        }

        // One library membership per school record. Without this the same student
        // ends up with two cards and two independent book limits.
        $refId = $this->str($body, 'ref_id');
        if ($refId !== '' && in_array($type, ['student', 'staff'], true)) {
            $dupeRef = $db->execute(
                'SELECT id, membership_no FROM lib_members
                 WHERE ssms_client_code = ? AND ref_id = ? AND member_type = ?
                   AND (? IS NULL OR id <> ?) LIMIT 1',
                [$clientCode, $refId, $type, $memberId, $memberId]
            )->fetch('assoc');

            if ($dupeRef) {
                $this->conflict(
                    'This ' . $type . ' already holds membership ' . $dupeRef['membership_no'] . '.'
                );

                return;
            }
        }

        $barcode = $this->str($body, 'barcode') ?: $membershipNo;

        $dupeBarcode = $db->execute(
            'SELECT id FROM lib_members
             WHERE ssms_client_code = ? AND barcode = ? AND (? IS NULL OR id <> ?) LIMIT 1',
            [$clientCode, $barcode, $memberId, $memberId]
        )->fetch('assoc');

        if ($dupeBarcode) {
            $this->conflict('Card barcode "' . $barcode . '" is already assigned to another member.');

            return;
        }

        $status = $this->str($body, 'status') ?: 'Active';
        if (!in_array($status, ['Active', 'Suspended', 'Expired'], true)) {
            $this->invalid('Status must be Active, Suspended or Expired.', ['status' => 'Invalid']);

            return;
        }

        $validFrom = $this->dateOrNull($body, 'valid_from') ?? date('Y-m-d');
        $validTo   = $this->dateOrNull($body, 'valid_to');

        if ($validTo !== null && strtotime($validTo) < strtotime($validFrom)) {
            $this->invalid('Valid-to date cannot be before valid-from.', ['valid_to' => 'Before start']);

            return;
        }

        // 0 means "use the type default from settings" — stored as-is so a later
        // settings change flows through automatically.
        $maxBooks = $this->intOrNull($body, 'max_books') ?? 0;

        $fields = [
            'membership_no' => $membershipNo,
            'barcode'       => $barcode,
            'member_type'   => $type,
            'ref_id'        => $refId !== '' ? $refId : null,
            'full_name'     => $fullName,
            'email'         => $this->str($body, 'email') ?: null,
            'phone'         => $this->str($body, 'phone') ?: null,
            'class_section' => $this->str($body, 'class_section') ?: null,
            'max_books'     => $maxBooks,
            'valid_from'    => $validFrom,
            'valid_to'      => $validTo,
            'status'        => $status,
            'photo'         => $this->str($body, 'photo') ?: null,
            'notes'         => $this->str($body, 'notes') ?: null,
        ];

        try {
            if ($memberId) {
                $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));
                $db->execute(
                    "UPDATE lib_members SET {$set} WHERE id = ? AND ssms_client_code = ?",
                    array_merge(array_values($fields), [$memberId, $clientCode])
                );
                $savedId = $memberId;
            } else {
                $cols = array_merge(['ssms_client_code'], array_keys($fields));
                $ph   = implode(', ', array_fill(0, count($cols), '?'));
                $db->execute(
                    'INSERT INTO lib_members (`' . implode('`, `', $cols) . "`) VALUES ({$ph})",
                    array_merge([$clientCode], array_values($fields))
                );
                $savedId = $this->insertId();
            }
        } catch (\PDOException $e) {
            // uq_membership can still fire between the duplicate check above and
            // the insert if two librarians enrol at the same moment. Report it as
            // a conflict the app can act on rather than a 500.
            if ((string)$e->getCode() === '23000') {
                $this->conflict(
                    'Membership number "' . $membershipNo . '" was taken a moment ago. '
                    . 'Save again to get the next number.'
                );

                return;
            }
            throw $e;
        }

        $this->audit('member', $savedId, $memberId ? 'update' : 'create', null, $fields);

        $saved = $db->execute(
            'SELECT * FROM lib_members WHERE id = ? LIMIT 1',
            [$savedId]
        )->fetch('assoc');

        $this->ok(
            $this->castRow($saved ?: [], ['id', 'max_books']),
            null,
            $memberId ? 'Member updated.' : 'Member enrolled — membership ' . $membershipNo . '.'
        );
    }

    /**
     * POST /libraryMemberApi/setStatus
     * Body: { id*, status* (Active|Suspended|Expired), reason }
     *
     * Suspension is a deliberate, audited action rather than an edit buried in a
     * form, because it is what stops someone borrowing.
     */
    public function setStatus(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body     = (array)$this->request->getData();
        $memberId = $this->intOrNull($body, 'id');
        $status   = $this->str($body, 'status');
        $reason   = $this->str($body, 'reason');

        if (!$memberId) {
            $this->invalid('A member must be selected.', ['id' => 'Required']);

            return;
        }
        if (!in_array($status, ['Active', 'Suspended', 'Expired'], true)) {
            $this->invalid('Status must be Active, Suspended or Expired.', ['status' => 'Invalid']);

            return;
        }
        if ($status === 'Suspended' && $reason === '') {
            $this->invalid('A reason is required when suspending a member.', ['reason' => 'Required']);

            return;
        }

        $db = $this->db();

        $member = $db->execute(
            'SELECT * FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$memberId, $clientCode]
        )->fetch('assoc');

        if (!$member) {
            $this->notFound('Member');

            return;
        }

        $note = $reason !== ''
            ? trim((string)($member['notes'] ?? '') . "\n" . date('Y-m-d') . ' — ' . $status . ': ' . $reason)
            : ($member['notes'] ?? null);

        $db->execute(
            'UPDATE lib_members SET status = ?, notes = ? WHERE id = ? AND ssms_client_code = ?',
            [$status, $note, $memberId, $clientCode]
        );

        $this->audit('member', $memberId, 'status', ['status' => $member['status']], ['status' => $status, 'reason' => $reason]);

        $this->ok(['id' => $memberId, 'status' => $status], null, 'Member set to ' . $status . '.');
    }

    /**
     * DELETE /libraryMemberApi/deleteMember/{id}
     *
     * Blocked once the member has any circulation or fine history — deleting
     * would orphan those rows and silently distort every report. Expire or
     * suspend instead.
     */
    public function deleteMember(?string $id = null): void
    {
        $this->request->allowMethod(['delete']);
        if (!$clientCode = $this->guard(true)) {
            return;
        }

        $memberId = (int)$id;
        $db = $this->db();

        $member = $db->execute(
            'SELECT * FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$memberId, $clientCode]
        )->fetch('assoc');

        if (!$member) {
            $this->notFound('Member');

            return;
        }

        $checkouts = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_checkouts WHERE member_id = ?',
            [$memberId]
        )->fetch('assoc')['c'] ?? 0);

        $fines = (int)($db->execute(
            'SELECT COUNT(*) AS c FROM lib_fines WHERE member_id = ?',
            [$memberId]
        )->fetch('assoc')['c'] ?? 0);

        if ($checkouts > 0 || $fines > 0) {
            $this->conflict(
                'This member has borrowing history and cannot be deleted. '
                . 'Set the membership to Expired instead.',
                'IN_USE'
            );

            return;
        }

        $this->transact(function () use ($db, $memberId, $clientCode) {
            $db->execute('DELETE FROM lib_reservations WHERE member_id = ?', [$memberId]);
            $db->execute('DELETE FROM lib_members WHERE id = ? AND ssms_client_code = ?', [$memberId, $clientCode]);
        });

        $this->audit('member', $memberId, 'delete', $member, null);
        $this->ok(['id' => $memberId], null, 'Member deleted.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MEMBERSHIP NUMBERS
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryMemberApi/nextMembershipNo?prefix=LIB */
    public function nextMembershipNo(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $settings = $this->settings($clientCode);
        $prefix   = $this->q('prefix') ?? ((string)($settings['membership_prefix'] ?? '') ?: 'LIB');

        $this->ok([
            'prefix'       => $prefix,
            'membershipNo' => $this->generateMembershipNo($clientCode, $settings, $prefix),
        ]);
    }

    /** Next free membership number for a prefix. */
    private function generateMembershipNo(string $clientCode, array $settings, ?string $prefix = null): string
    {
        $prefix = $prefix ?? ((string)($settings['membership_prefix'] ?? '') ?: 'LIB');

        $row = $this->db()->execute(
            'SELECT MAX(CAST(SUBSTRING(membership_no, ?) AS UNSIGNED)) AS mx
             FROM   lib_members
             WHERE  ssms_client_code = ? AND membership_no LIKE ?',
            [strlen($prefix) + 1, $clientCode, $this->like($prefix, 'prefix')]
        )->fetch('assoc');

        return $prefix . str_pad((string)((int)($row['mx'] ?? 0) + 1), 5, '0', STR_PAD_LEFT);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BULK ENROLMENT FROM SCHOOL RECORDS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryMemberApi/enrolCandidates
     *
     * Query: type (student|staff)*, classId, sectionId, q, includeEnrolled (bool),
     *        page, limit
     *
     * Students and staff who could be enrolled, with an `already_member` flag.
     * Enrolled people are filtered out by default so the librarian sees only
     * what is left to do.
     */
    public function enrolCandidates(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $type = strtolower((string)$this->q('type', 'student'));
        if (!in_array($type, ['student', 'staff'], true)) {
            $this->invalid('Type must be student or staff.', ['type' => 'Invalid']);

            return;
        }

        ['page' => $page, 'limit' => $limit, 'offset' => $offset] = $this->pageParams();
        $includeEnrolled = $this->qBool('includeEnrolled');

        $db = $this->db();

        if ($type === 'student') {
            $where  = ['sr.ssms_client_code = ?'];
            $params = [$clientCode];

            if (($v = $this->qInt('classId')) !== null) {
                $where[] = 'se.class_id = ?';
                $params[] = $v;
            }
            if (($v = $this->qInt('sectionId')) !== null) {
                $where[] = 'se.section_id = ?';
                $params[] = $v;
            }
            if (($v = $this->q('q')) !== null) {
                $where[] = "(CONCAT_WS(' ', sr.student_first_name, sr.student_middle_name, sr.student_last_name) LIKE ?
                             OR sr.registration_id LIKE ?)";
                array_push($params, $this->like($v), $this->like($v, 'prefix'));
            }
            if (!$includeEnrolled) {
                $where[] = "NOT EXISTS (SELECT 1 FROM lib_members lm
                                        WHERE lm.ssms_client_code = sr.ssms_client_code
                                          AND lm.member_type = 'student'
                                          AND lm.ref_id = sr.registration_id)";
            }

            $whereSql = implode(' AND ', $where);

            $total = (int)($db->execute(
                "SELECT COUNT(DISTINCT sr.registration_id) AS c
                 FROM   ssms_student_registration sr
                 LEFT   JOIN ssms_student_enrollment se
                        ON se.registration_id = sr.registration_id
                       AND se.ssms_client_code = sr.ssms_client_code
                 WHERE  {$whereSql}",
                $params
            )->fetch('assoc')['c'] ?? 0);

            $rows = $db->execute(
                "SELECT sr.registration_id AS ref_id,
                        TRIM(CONCAT_WS(' ', sr.student_first_name, sr.student_middle_name,
                                       sr.student_last_name)) AS full_name,
                        sr.email_address AS email,
                        sr.mobile_number AS phone,
                        sr.student_photo AS photo,
                        c.class_name,
                        s.section_name,
                        TRIM(CONCAT_WS(' ', c.class_name, s.section_name)) AS class_section,
                        (SELECT lm.membership_no FROM lib_members lm
                          WHERE lm.ssms_client_code = sr.ssms_client_code
                            AND lm.member_type = 'student'
                            AND lm.ref_id = sr.registration_id LIMIT 1) AS already_member
                 FROM   ssms_student_registration sr
                 LEFT   JOIN ssms_student_enrollment se
                        ON se.registration_id = sr.registration_id
                       AND se.ssms_client_code = sr.ssms_client_code
                 LEFT   JOIN ssms_classes  c ON c.class_id   = se.class_id
                 LEFT   JOIN ssms_sections s ON s.section_id = se.section_id
                 WHERE  {$whereSql}
                 GROUP  BY sr.registration_id
                 ORDER  BY full_name ASC
                 LIMIT  {$limit} OFFSET {$offset}",
                $params
            )->fetchAll('assoc');
        } else {
            $where  = ['s.ssms_client_code = ?'];
            $params = [$clientCode];

            if (($v = $this->q('q')) !== null) {
                $where[] = "(CONCAT_WS(' ', s.first_name, s.last_name) LIKE ? OR s.staff_id LIKE ?)";
                array_push($params, $this->like($v), $this->like($v, 'prefix'));
            }
            if (!$includeEnrolled) {
                $where[] = "NOT EXISTS (SELECT 1 FROM lib_members lm
                                        WHERE lm.ssms_client_code = s.ssms_client_code
                                          AND lm.member_type = 'staff'
                                          AND lm.ref_id = s.staff_id)";
            }

            $whereSql = implode(' AND ', $where);

            $total = (int)($db->execute(
                "SELECT COUNT(*) AS c FROM ssms_staff s WHERE {$whereSql}",
                $params
            )->fetch('assoc')['c'] ?? 0);

            $rows = $db->execute(
                "SELECT s.staff_id AS ref_id,
                        TRIM(CONCAT_WS(' ', s.staff_title, s.first_name, s.last_name)) AS full_name,
                        s.email_address AS email,
                        s.mobile_number AS phone,
                        s.staff_photo AS photo,
                        NULL AS class_name,
                        NULL AS section_name,
                        NULL AS class_section,
                        (SELECT lm.membership_no FROM lib_members lm
                          WHERE lm.ssms_client_code = s.ssms_client_code
                            AND lm.member_type = 'staff'
                            AND lm.ref_id = s.staff_id LIMIT 1) AS already_member
                 FROM   ssms_staff s
                 WHERE  {$whereSql}
                 ORDER  BY full_name ASC
                 LIMIT  {$limit} OFFSET {$offset}",
                $params
            )->fetchAll('assoc');
        }

        $this->ok($rows, $this->paginationMeta($page, $limit, $total));
    }

    /**
     * POST /libraryMemberApi/bulkEnrol
     *
     * Body: { member_type* (student|staff), refs*: [ref_id, ...],
     *         valid_from, valid_to, max_books, prefix }
     *
     * Enrols a whole class or the entire staff list in one transaction. Names,
     * contact details, photo and class/section are pulled from the school record
     * rather than retyped, and anyone already enrolled is skipped rather than
     * failing the batch.
     */
    public function bulkEnrol(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $body = (array)$this->request->getData();
        $type = strtolower($this->str($body, 'member_type', 'student'));
        $refs = is_array($body['refs'] ?? null) ? array_values(array_unique(array_filter(
            array_map(fn($r) => trim((string)$r), $body['refs'])
        ))) : [];

        if (!in_array($type, ['student', 'staff'], true)) {
            $this->invalid('Type must be student or staff.', ['member_type' => 'Invalid']);

            return;
        }
        if ($refs === []) {
            $this->invalid('Select at least one person to enrol.', ['refs' => 'Required']);

            return;
        }
        if (count($refs) > 1000) {
            $this->invalid('Enrol at most 1000 people at a time.', ['refs' => 'Too many']);

            return;
        }

        $db        = $this->db();
        $settings  = $this->settings($clientCode);
        $prefix    = $this->str($body, 'prefix') ?: ((string)($settings['membership_prefix'] ?? '') ?: 'LIB');
        $validFrom = $this->dateOrNull($body, 'valid_from') ?? date('Y-m-d');
        $validTo   = $this->dateOrNull($body, 'valid_to');
        $maxBooks  = $this->intOrNull($body, 'max_books') ?? 0;

        $placeholders = implode(', ', array_fill(0, count($refs), '?'));

        // Pull every source record in one query rather than one per person.
        if ($type === 'student') {
            $sources = $db->execute(
                "SELECT sr.registration_id AS ref_id,
                        TRIM(CONCAT_WS(' ', sr.student_first_name, sr.student_middle_name,
                                       sr.student_last_name)) AS full_name,
                        sr.email_address AS email,
                        sr.mobile_number AS phone,
                        sr.student_photo AS photo,
                        TRIM(CONCAT_WS(' ', c.class_name, s.section_name)) AS class_section
                 FROM   ssms_student_registration sr
                 LEFT   JOIN ssms_student_enrollment se
                        ON se.registration_id = sr.registration_id
                       AND se.ssms_client_code = sr.ssms_client_code
                 LEFT   JOIN ssms_classes  c ON c.class_id   = se.class_id
                 LEFT   JOIN ssms_sections s ON s.section_id = se.section_id
                 WHERE  sr.ssms_client_code = ? AND sr.registration_id IN ({$placeholders})
                 GROUP  BY sr.registration_id",
                array_merge([$clientCode], $refs)
            )->fetchAll('assoc');
        } else {
            $sources = $db->execute(
                "SELECT s.staff_id AS ref_id,
                        TRIM(CONCAT_WS(' ', s.staff_title, s.first_name, s.last_name)) AS full_name,
                        s.email_address AS email,
                        s.mobile_number AS phone,
                        s.staff_photo AS photo,
                        NULL AS class_section
                 FROM   ssms_staff s
                 WHERE  s.ssms_client_code = ? AND s.staff_id IN ({$placeholders})",
                array_merge([$clientCode], $refs)
            )->fetchAll('assoc');
        }

        $byRef = [];
        foreach ($sources as $s) {
            $byRef[(string)$s['ref_id']] = $s;
        }

        // Already enrolled — skipped, not treated as an error.
        $existing = $db->execute(
            "SELECT ref_id FROM lib_members
             WHERE ssms_client_code = ? AND member_type = ? AND ref_id IN ({$placeholders})",
            array_merge([$clientCode, $type], $refs)
        )->fetchAll('assoc');

        $alreadyEnrolled = array_column($existing, 'ref_id');

        $created = [];
        $skipped = [];

        try {
            [$created, $skipped] = $this->transact(function () use (
                $db, $clientCode, $type, $refs, $byRef, $alreadyEnrolled,
                $prefix, $validFrom, $validTo, $maxBooks, $settings
            ) {
                $made = [];
                $miss = [];

                // Take the running sequence once, then increment locally — one
                // MAX() per batch instead of one per person.
                $seqRow = $db->execute(
                    'SELECT MAX(CAST(SUBSTRING(membership_no, ?) AS UNSIGNED)) AS mx
                     FROM   lib_members
                     WHERE  ssms_client_code = ? AND membership_no LIKE ?',
                    [strlen($prefix) + 1, $clientCode, $this->like($prefix, 'prefix')]
                )->fetch('assoc');
                $seq = (int)($seqRow['mx'] ?? 0);

                foreach ($refs as $ref) {
                    if (in_array($ref, $alreadyEnrolled, true)) {
                        $miss[] = ['ref_id' => $ref, 'reason' => 'Already a member'];
                        continue;
                    }
                    if (!isset($byRef[$ref])) {
                        $miss[] = ['ref_id' => $ref, 'reason' => 'No matching school record'];
                        continue;
                    }

                    $src  = $byRef[$ref];
                    $name = trim((string)$src['full_name']);
                    if ($name === '') {
                        $miss[] = ['ref_id' => $ref, 'reason' => 'School record has no name'];
                        continue;
                    }

                    // Skip numbers already taken, e.g. from a manual enrolment.
                    do {
                        $seq++;
                        $membershipNo = $prefix . str_pad((string)$seq, 5, '0', STR_PAD_LEFT);
                        $taken = $db->execute(
                            'SELECT id FROM lib_members
                             WHERE ssms_client_code = ? AND membership_no = ? LIMIT 1',
                            [$clientCode, $membershipNo]
                        )->fetch('assoc');
                    } while ($taken);

                    $db->execute(
                        'INSERT INTO lib_members
                            (ssms_client_code, membership_no, barcode, member_type, ref_id,
                             full_name, email, phone, class_section, max_books,
                             valid_from, valid_to, status, photo)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $clientCode, $membershipNo, $membershipNo, $type, $ref,
                            $name,
                            $src['email'] ?: null,
                            $src['phone'] ?: null,
                            $src['class_section'] ?: null,
                            $maxBooks,
                            $validFrom, $validTo, 'Active',
                            $src['photo'] ?: null,
                        ]
                    );

                    $made[] = [
                        'id'            => (int)$db->getDriver()->lastInsertId(),
                        'ref_id'        => $ref,
                        'membership_no' => $membershipNo,
                        'full_name'     => $name,
                    ];
                }

                return [$made, $miss];
            });
        } catch (\Throwable $e) {
            Log::error('bulkEnrol failed: ' . $e->getMessage());
            $this->fail(500, 'Enrolment failed. No members were created.', 'SERVER_ERROR');

            return;
        }

        $this->audit('member', null, 'bulk_enrol', null, [
            'type' => $type, 'requested' => count($refs), 'created' => count($created),
        ]);

        $this->ok(
            [
                'created'      => $created,
                'skipped'      => $skipped,
                'createdCount' => count($created),
                'skippedCount' => count($skipped),
            ],
            null,
            count($created) . ' of ' . count($refs) . ' enrolled.'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CARD + FILTERS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /libraryMemberApi/card/{id}
     * Everything the printable membership card needs, including the school name
     * for the card header.
     */
    public function card(?string $id = null): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db = $this->db();

        $member = $db->execute(
            'SELECT id, membership_no, barcode, member_type, full_name, class_section,
                    photo, valid_from, valid_to, status
             FROM   lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [(int)$id, $clientCode]
        )->fetch('assoc');

        if (!$member) {
            $this->notFound('Member');

            return;
        }

        $school = $db->execute(
            'SELECT ssms_client_header_text FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1',
            [$clientCode]
        )->fetch('assoc');

        $settings = $this->settings($clientCode);

        $this->ok([
            'member'     => $this->castRow($member, ['id']),
            'schoolName' => $school['ssms_client_header_text'] ?? '',
            'library'    => [
                'opens'  => $settings['library_opens'] ?? null,
                'closes' => $settings['library_closes'] ?? null,
            ],
        ]);
    }

    /**
     * GET /libraryMemberApi/filters
     * Classes, sections and the distinct class_section values already in use —
     * one call to populate every dropdown on the members screen.
     */
    public function filters(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guard()) {
            return;
        }

        $db = $this->db();

        $classes = $db->execute(
            'SELECT class_id, class_name FROM ssms_classes
             WHERE ssms_client_code = ? ORDER BY class_name ASC',
            [$clientCode]
        )->fetchAll('assoc');

        $sections = $db->execute(
            'SELECT section_id, section_name, class_id FROM ssms_sections
             WHERE ssms_client_code = ? ORDER BY section_name ASC',
            [$clientCode]
        )->fetchAll('assoc');

        $classSections = $db->execute(
            "SELECT DISTINCT class_section FROM lib_members
             WHERE ssms_client_code = ? AND class_section IS NOT NULL AND class_section <> ''
             ORDER BY class_section ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $settings = $this->settings($clientCode);

        $this->ok([
            'classes'       => $this->castRows($classes, ['class_id']),
            'sections'      => $this->castRows($sections, ['section_id', 'class_id']),
            'classSections' => array_column($classSections, 'class_section'),
            'memberTypes'   => ['student', 'staff', 'guest'],
            'statuses'      => ['Active', 'Suspended', 'Expired'],
            'defaults'      => [
                'maxBooksStudent'    => (int)($settings['max_books_student'] ?? 3),
                'maxBooksStaff'      => (int)($settings['max_books_staff'] ?? 5),
                'maxBooksGuest'      => (int)($settings['max_books_guest'] ?? 1),
                'loanPeriodStudent'  => (int)($settings['loan_period_student'] ?? 14),
                'loanPeriodStaff'    => (int)($settings['loan_period_staff'] ?? 30),
                'loanPeriodGuest'    => (int)($settings['loan_period_guest'] ?? 7),
                'membershipPrefix'   => (string)($settings['membership_prefix'] ?? '') ?: 'LIB',
            ],
        ]);
    }
}
