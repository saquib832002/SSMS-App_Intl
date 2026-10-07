<?php
declare(strict_types=1);

namespace App\Controller\Traits;

use Cake\Database\Connection;
use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * LibraryApiTrait
 * File: src/Controller/Traits/LibraryApiTrait.php
 *
 * Shared plumbing for every Library*ApiController. In NewSMS these helpers were
 * copy-pasted into all thirteen controllers; here they exist once.
 *
 * Every controller using this trait must call, in initialize():
 *     $this->viewBuilder()->setClassName('Json');
 *
 * ── Response contract (identical on every endpoint) ──────────────────────────
 *   success single : { "status": true,  "data": {...} }
 *   success list   : { "status": true,  "data": [...], "pagination": {...} }
 *   error          : { "status": false, "message": "...", "code": "...", "errors": {...} }
 *
 * ── Error codes ─────────────────────────────────────────────────────────────
 * The app switches on `code`, never on the English message, so messages can be
 * reworded or translated without breaking the client.
 *
 *   UNAUTHORIZED        no / invalid JWT                          401
 *   FORBIDDEN           authenticated but wrong role              403
 *   NOT_FOUND           record does not exist for this client     404
 *   VALIDATION          bad or missing input                      422
 *   DUPLICATE           unique constraint would be violated       409
 *   IN_USE              cannot delete, referenced elsewhere       409
 *   LIMIT_REACHED       member is at their book limit             409
 *   ALREADY_ISSUED      copy is already out                       409
 *   NOT_AVAILABLE       copy is Lost / Damaged / Withdrawn        409
 *   REFERENCE_ONLY      book cannot be borrowed                   409
 *   HOLD_FOR_OTHER      a hold for another member blocks this     409
 *   MEMBER_BLOCKED      expired, suspended, or over fine limit    409
 *   MAX_RENEWALS        renewal limit reached                     409
 *   SERVER_ERROR        unexpected failure                        500
 */
trait LibraryApiTrait
{
    /** Per-request cache of the lib_settings row. */
    private ?array $libSettingsCache = null;

    /**
     * Page-size bounds. Deliberately static properties rather than constants:
     * constants in traits require PHP 8.2, and CakePHP 5 supports 8.1.
     */
    private static int $maxPageLimit = 100;

    private static int $defaultPageLimit = 25;

    // ══════════════════════════════════════════════════════════════════════════
    // CONNECTION
    // ══════════════════════════════════════════════════════════════════════════

    protected function db(): Connection
    {
        /** @var Connection $conn */
        $conn = ConnectionManager::get('default');

        return $conn;
    }

    /**
     * Run a closure inside a transaction. Any exception rolls back.
     *
     * Every write that touches more than one library table must go through this.
     * A partial write to lib_checkouts / lib_book_copies / lib_books corrupts
     * inventory in a way that is not self-healing.
     */
    protected function transact(callable $fn): mixed
    {
        return $this->db()->transactional($fn);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // IDENTITY — always from the JWT, never from a request parameter
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Tenant code. Falls back to the header only so that local tooling and the
     * existing NewSMS clients keep working; the JWT attribute wins when present.
     *
     * Never accept this from query string or body — that is the one bug class
     * that leaks another school's data.
     */
    protected function clientCode(): string
    {
        $code = (string)($this->request->getAttribute('jwt_client_code') ?? '');
        if ($code === '') {
            $code = trim($this->request->getHeaderLine('ssmsClientCode'));
        }

        return $code;
    }

    /** Username of the caller — stored in issued_by / collected_by / audit rows. */
    protected function actor(): string
    {
        $user = (string)($this->request->getAttribute('jwt_user') ?? '');
        if ($user === '') {
            $user = trim($this->request->getHeaderLine('ssmsUserName'));
        }

        return $user !== '' ? $user : 'system';
    }

    protected function role(): string
    {
        $role = (string)($this->request->getAttribute('jwt_role') ?? '');
        if ($role === '') {
            $role = $this->request->getHeaderLine('ssmsUserRole');
        }

        return strtolower(trim($role));
    }

    protected function hasRole(array $roles): bool
    {
        return in_array($this->role(), array_map('strtolower', $roles), true);
    }

    /**
     * ── The three tiers ───────────────────────────────────────────────────────
     *
     *   owner       the institution account. Manages staff. One per client.
     *   admin       everything in the library, including anything destructive.
     *   librarian   the desk: issue, return, renew, reserve, catalogue, members,
     *               take payments. Cannot delete records and cannot write off
     *               money.
     *
     * The line between admin and librarian is deliberately drawn at
     * irreversibility, not at seniority. A librarian can do anything that can be
     * undone by doing the opposite: issue and return, book and cancel, charge
     * and collect. Deleting a member, withdrawing a copy or waiving a fine
     * cannot be undone from the app, so those need an admin.
     */
    protected function isOwner(): bool
    {
        return $this->hasRole(['owner']);
    }

    protected function isAdminOrOwner(): bool
    {
        return $this->hasRole(['admin', 'owner']);
    }

    /** Anyone who may operate the circulation desk. */
    protected function isLibraryStaff(): bool
    {
        return $this->hasRole(['admin', 'owner', 'librarian', 'library']);
    }

    /**
     * Guard helper. Returns the client code on success, or emits the error
     * response and returns null — callers do: if (!$c = $this->guard()) return;
     *
     * Levels are ordered, so a higher tier always satisfies a lower one.
     */
    protected function guard(bool $adminOnly = false): ?string
    {
        return $this->guardLevel($adminOnly ? 'admin' : 'staff');
    }

    /** Owner-only actions — currently staff management. */
    protected function guardOwner(): ?string
    {
        return $this->guardLevel('owner');
    }

    /** @param string $level one of 'staff', 'admin', 'owner' */
    protected function guardLevel(string $level): ?string
    {
        $clientCode = $this->clientCode();
        if ($clientCode === '') {
            $this->fail(401, 'Your session is not valid. Please log in again.', 'UNAUTHORIZED');

            return null;
        }

        $ok = match ($level) {
            'owner' => $this->isOwner(),
            'admin' => $this->isAdminOrOwner(),
            default => $this->isLibraryStaff(),
        };

        if (!$ok) {
            // Say which tier is required. "Access denied" sends the librarian to
            // the help desk; naming the tier tells them who to ask.
            $needed = match ($level) {
                'owner' => 'the institution owner',
                'admin' => 'an administrator',
                default => 'library staff',
            };
            $this->fail(403, 'This action can only be done by ' . $needed . '.', 'FORBIDDEN');

            return null;
        }

        return $clientCode;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RESPONSES
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @param mixed $data       Object for a single record, list for a collection.
     * @param array|null $pagination Include on every list endpoint.
     * @param string|null $message   Optional human-readable confirmation.
     */
    protected function ok(mixed $data = null, ?array $pagination = null, ?string $message = null): void
    {
        $payload = ['status' => true, 'data' => $data];
        if ($pagination !== null) {
            $payload['pagination'] = $pagination;
        }
        if ($message !== null) {
            $payload['message'] = $message;
        }

        $this->set($payload);
        $this->viewBuilder()->setOption('serialize', array_keys($payload));
    }

    protected function fail(int $status, string $message, string $code = 'SERVER_ERROR', array $errors = []): void
    {
        $this->response = $this->response->withStatus($status);

        $payload = ['status' => false, 'message' => $message, 'code' => $code];
        if ($errors !== []) {
            $payload['errors'] = $errors;
        }

        $this->set($payload);
        $this->viewBuilder()->setOption('serialize', array_keys($payload));
    }

    protected function notFound(string $what = 'Record'): void
    {
        $this->fail(404, $what . ' not found.', 'NOT_FOUND');
    }

    protected function invalid(string $message, array $errors = []): void
    {
        $this->fail(422, $message, 'VALIDATION', $errors);
    }

    protected function conflict(string $message, string $code = 'DUPLICATE'): void
    {
        $this->fail(409, $message, $code);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PAGINATION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @return array{page:int, limit:int, offset:int}
     */
    protected function pageParams(): array
    {
        $q = $this->request->getQueryParams();

        $page  = max(1, (int)($q['page'] ?? 1));
        $limit = (int)($q['limit'] ?? self::$defaultPageLimit);
        if ($limit < 1) {
            $limit = self::$defaultPageLimit;
        }
        // Cap server-side regardless of what the client sends. A catalogue can
        // be 50k rows; an uncapped limit is a guaranteed timeout.
        //
        // page and limit are hard-cast to int here because callers interpolate
        // them straight into LIMIT/OFFSET — see the note in pageParams' callers.
        $limit = min($limit, self::$maxPageLimit);

        return ['page' => $page, 'limit' => $limit, 'offset' => ($page - 1) * $limit];
    }

    protected function paginationMeta(int $page, int $limit, int $total): array
    {
        return [
            'page'    => $page,
            'limit'   => $limit,
            'total'   => $total,
            'pages'   => $limit > 0 ? (int)ceil($total / $limit) : 0,
            'hasMore' => ($page * $limit) < $total,
        ];
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INPUT HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    protected function q(string $key, ?string $default = null): ?string
    {
        $v = $this->request->getQuery($key, $default);
        if ($v === null) {
            return null;
        }
        $v = trim((string)$v);

        return $v === '' ? $default : $v;
    }

    protected function qInt(string $key, ?int $default = null): ?int
    {
        $v = $this->request->getQuery($key);

        return ($v === null || $v === '') ? $default : (int)$v;
    }

    protected function qBool(string $key, bool $default = false): bool
    {
        $v = $this->request->getQuery($key);
        if ($v === null || $v === '') {
            return $default;
        }

        return in_array(strtolower((string)$v), ['1', 'true', 'yes', 'on'], true);
    }

    protected function str(array $body, string $key, string $default = ''): string
    {
        return trim((string)($body[$key] ?? $default));
    }

    protected function intOrNull(array $body, string $key): ?int
    {
        return empty($body[$key]) ? null : (int)$body[$key];
    }

    protected function decOrNull(array $body, string $key): ?string
    {
        return (isset($body[$key]) && $body[$key] !== '' && $body[$key] !== null)
            ? number_format((float)$body[$key], 2, '.', '')
            : null;
    }

    /** Normalise a date to Y-m-d, or null. Accepts anything strtotime understands. */
    protected function dateOrNull(array $body, string $key): ?string
    {
        $v = trim((string)($body[$key] ?? ''));
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);

        return $ts === false ? null : date('Y-m-d', $ts);
    }

    /** Escape a user string for a LIKE clause, then wrap it. */
    protected function like(string $term, string $mode = 'both'): string
    {
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $term);

        return match ($mode) {
            'prefix' => $escaped . '%',
            'suffix' => '%' . $escaped,
            default  => '%' . $escaped . '%',
        };
    }

    /**
     * Turn a search phrase into a safe MySQL boolean-mode FULLTEXT expression.
     * Strips operators, drops tokens below the index minimum, prefix-matches the
     * last token so results narrow as the user types.
     *
     * Returns null when nothing usable is left — caller should fall back to LIKE.
     */
    protected function fulltextExpr(string $term, int $minToken = 3): ?string
    {
        $clean  = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $term) ?? '';
        $tokens = array_values(array_filter(
            preg_split('/\s+/u', trim($clean)) ?: [],
            fn($t) => mb_strlen($t) >= $minToken
        ));

        if ($tokens === []) {
            return null;
        }

        $last  = array_pop($tokens);
        $parts = array_map(fn($t) => '+' . $t, $tokens);
        $parts[] = '+' . $last . '*';

        return implode(' ', $parts);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SETTINGS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * lib_settings for the current client, cached for the request.
     * Creates the row with schema defaults if a client somehow has none, so no
     * caller ever has to null-check.
     */
    protected function settings(?string $clientCode = null): array
    {
        if ($this->libSettingsCache !== null) {
            return $this->libSettingsCache;
        }

        $clientCode = $clientCode ?? $this->clientCode();
        $db = $this->db();

        $row = $db->execute(
            'SELECT * FROM lib_settings WHERE ssms_client_code = ? LIMIT 1',
            [$clientCode]
        )->fetch('assoc');

        if (!$row) {
            $db->execute('INSERT IGNORE INTO lib_settings (ssms_client_code) VALUES (?)', [$clientCode]);
            $row = $db->execute(
                'SELECT * FROM lib_settings WHERE ssms_client_code = ? LIMIT 1',
                [$clientCode]
            )->fetch('assoc') ?: [];
        }

        // ── Currency belongs to the client, not to the library module ─────────
        // ssms_clients.currency is authoritative: it is what the fee module
        // bills in, and a library cannot sensibly charge fines in a different
        // currency from the rest of the institution.
        //
        // lib_settings.currency_symbol also exists, with a DEFAULT of 'PKR'.
        // An earlier version of this method preferred the client value but fell
        // back to that column, which meant any client whose currency was blank
        // still saw PKR — confidently wrong, and indistinguishable from a real
        // setting. So the column is now ignored outright rather than used as a
        // fallback: it is overwritten below so nothing downstream can read a
        // stale value, and saveSettings() no longer accepts writes to it.
        //
        // A blank client currency yields a blank symbol. money() then renders
        // the bare number, which is honest — the fix is to set the currency on
        // the client, not to guess one here.
        $client = $db->execute(
            'SELECT currency FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1',
            [$clientCode]
        )->fetch('assoc');

        $row['currency_symbol'] = trim((string)($client['currency'] ?? ''));

        return $this->libSettingsCache = $row;
    }

    /**
     * Drop the request-scoped settings cache. Only needed after writing to
     * lib_settings within the same request, so the response reflects the change.
     */
    protected function clearSettingsCache(): void
    {
        $this->libSettingsCache = null;
    }

    /** Loan period in days for a member type, from settings. */
    protected function loanPeriodFor(string $memberType, array $settings): int
    {
        return (int)match (strtolower($memberType)) {
            'staff' => $settings['loan_period_staff'] ?? 30,
            'guest' => $settings['loan_period_guest'] ?? 7,
            default => $settings['loan_period_student'] ?? 14,
        };
    }

    /** Book limit for a member type, from settings. */
    protected function maxBooksFor(string $memberType, array $settings): int
    {
        return (int)match (strtolower($memberType)) {
            'staff' => $settings['max_books_staff'] ?? 5,
            'guest' => $settings['max_books_guest'] ?? 1,
            default => $settings['max_books_student'] ?? 3,
        };
    }

    /**
     * Due date = issue date + loan period, rolled forward past closed days.
     * A book due on a day the library is shut is due the next working day —
     * otherwise members are fined for the library's own closure.
     */
    protected function dueDate(string $issueDate, int $days, array $settings): string
    {
        $due = strtotime($issueDate . ' +' . $days . ' days');

        $closed = array_filter(array_map(
            'trim',
            explode(',', (string)($settings['closed_days'] ?? ''))
        ));
        if ($closed !== []) {
            $closed = array_map(fn($d) => strtolower(substr($d, 0, 3)), $closed);
            $guard = 0;
            while (in_array(strtolower(date('D', $due)), $closed, true) && $guard++ < 14) {
                $due = strtotime('+1 day', $due);
            }
        }

        return date('Y-m-d', $due);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MEMBER STANDING
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Resolve a member from `member_id`, or from a scanned card / membership
     * number in `member_code`.
     *
     * Circulation and facility bookings both start with "who is this?", and both
     * accept either a picked id or a scanned card, so the resolution lives here.
     */
    protected function resolveMember(string $clientCode, array $body): ?array
    {
        $memberId = $this->intOrNull($body, 'member_id');
        $code     = $this->str($body, 'member_code');

        if ($memberId) {
            $row = $this->db()->execute(
                'SELECT * FROM lib_members WHERE id = ? AND ssms_client_code = ? LIMIT 1',
                [$memberId, $clientCode]
            )->fetch('assoc');

            return $row ?: null;
        }

        if ($code !== '') {
            // Prefer a barcode hit over a membership-number hit when both match.
            $row = $this->db()->execute(
                'SELECT * FROM lib_members
                 WHERE ssms_client_code = ? AND (barcode = ? OR membership_no = ?)
                 ORDER BY (barcode = ?) DESC LIMIT 1',
                [$clientCode, $code, $code, $code]
            )->fetch('assoc');

            return $row ?: null;
        }

        return null;
    }

    /**
     * Loans, fines and borrowing eligibility for one member.
     *
     * Lives in the trait because three different screens need the same answer —
     * the scanner (via /lookup), the member detail screen, and issue itself.
     * If each computed its own version they would eventually disagree, and the
     * desk would see "can borrow" on one screen and a refusal on the next.
     *
     * `canBorrow` / `blockedReason` are authoritative. Clients display them; they
     * do not re-derive them.
     *
     * @param array $member A full lib_members row.
     * @return array{member:array, loans:array, fines:array, canBorrow:bool, blockedReason:?string}
     */
    protected function memberSummary(string $clientCode, array $member): array
    {
        $db = $this->db();
        $memberId = (int)$member['id'];

        $loans = $db->execute(
            "SELECT COUNT(*) AS out_count,
                    SUM(CASE WHEN due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_count
             FROM   lib_checkouts
             WHERE  member_id = ? AND status IN ('Active','Overdue')",
            [$memberId]
        )->fetch('assoc') ?: ['out_count' => 0, 'overdue_count' => 0];

        $fines = $db->execute(
            "SELECT COALESCE(SUM(amount - paid_amount - waived_amount), 0) AS outstanding,
                    COUNT(*) AS open_count
             FROM   lib_fines
             WHERE  member_id = ? AND status IN ('Pending','Partial')",
            [$memberId]
        )->fetch('assoc') ?: ['outstanding' => 0, 'open_count' => 0];

        $settings = $this->settings($clientCode);
        $maxBooks = (int)($member['max_books'] ?: $this->maxBooksFor((string)$member['member_type'], $settings));
        $fineLimit = $settings['block_issue_when_fine_over'] ?? null;

        // Checked in the order a librarian would explain them. blockedCode is the
        // machine-readable twin of blockedReason: callers branch on the code and
        // display the reason, so wording can change without breaking behaviour.
        $blockedReason = null;
        $blockedCode   = null;

        if (strtolower((string)$member['status']) !== 'active') {
            $blockedCode   = 'MEMBER_BLOCKED';
            $blockedReason = 'Membership is ' . strtolower((string)$member['status']) . '.';
        } elseif (!empty($member['valid_to']) && strtotime((string)$member['valid_to']) < strtotime(date('Y-m-d'))) {
            $blockedCode   = 'MEMBER_EXPIRED';
            $blockedReason = 'Membership expired on ' . $member['valid_to'] . '.';
        } elseif ((int)$loans['out_count'] >= $maxBooks) {
            $blockedCode   = 'LIMIT_REACHED';
            $blockedReason = 'Book limit reached (' . $maxBooks . ').';
        } elseif ($fineLimit !== null && (float)$fines['outstanding'] > (float)$fineLimit) {
            $blockedCode   = 'FINE_LIMIT';
            $blockedReason = 'Outstanding fine of ' . ($settings['currency_symbol'] ?? '')
                . number_format((float)$fines['outstanding'], 2) . ' must be cleared.';
        }

        return [
            'member' => $this->castRow($member, ['id', 'max_books']),
            'loans'  => [
                'out'       => (int)$loans['out_count'],
                'overdue'   => (int)$loans['overdue_count'],
                'maxBooks'  => $maxBooks,
                'remaining' => max(0, $maxBooks - (int)$loans['out_count']),
            ],
            'fines'  => [
                'outstanding' => (float)$fines['outstanding'],
                'openCount'   => (int)$fines['open_count'],
                'currency'    => $settings['currency_symbol'] ?? '',
            ],
            'canBorrow'     => $blockedReason === null,
            'blockedReason' => $blockedReason,
            'blockedCode'   => $blockedCode,
        ];
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FINES
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Overdue fine for a number of days late.
     *
     *   fine = max(0, daysLate - grace) x fine_per_day,  capped at fine_max_cap
     *
     * Computed here rather than in a controller because return, the nightly
     * sweep and the fine screen must all produce the same number. Returns a
     * string so the value goes into DECIMAL(10,2) without float rounding drift.
     */
    protected function overdueFine(int $daysLate, array $settings): string
    {
        $grace     = (int)($settings['grace_period_days'] ?? 0);
        $perDay    = (float)($settings['fine_per_day'] ?? 0);
        $chargeable = max(0, $daysLate - $grace);

        $amount = $chargeable * $perDay;

        $cap = $settings['fine_max_cap'] ?? null;
        if ($cap !== null && $amount > (float)$cap) {
            $amount = (float)$cap;
        }

        return number_format($amount, 2, '.', '');
    }

    /** Chargeable days after the grace period — stored on the fine row. */
    protected function chargeableDays(int $daysLate, array $settings): int
    {
        return max(0, $daysLate - (int)($settings['grace_period_days'] ?? 0));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Queue a message for a member. Writing to lib_notifications rather than
     * sending inline keeps the circulation desk fast: the desk never waits on an
     * SMS gateway, and a gateway outage cannot fail an issue or a return.
     */
    protected function queueNotification(
        string $clientCode,
        int $memberId,
        string $type,
        ?int $refId,
        string $message
    ): void {
        try {
            $this->db()->execute(
                'INSERT INTO lib_notifications
                    (ssms_client_code, member_id, notification_type, ref_id, message, status)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$clientCode, $memberId, $type, $refId, $message, 'Pending']
            );
        } catch (\Throwable $e) {
            Log::warning('lib_notifications queue failed: ' . $e->getMessage());
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // COUNTER MAINTENANCE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Recompute total_copies / available_copies for one book from lib_book_copies.
     *
     * Call this inside the same transaction as any copy status change. The
     * counters are a cache; lib_book_copies.status is the source of truth.
     */
    protected function syncBookCounters(int $bookId, ?Connection $db = null): void
    {
        ($db ?? $this->db())->execute(
            "UPDATE lib_books b
             LEFT JOIN (
                 SELECT book_id,
                        COUNT(*) AS total,
                        SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) AS avail
                 FROM   lib_book_copies
                 WHERE  book_id = ? AND status <> 'Withdrawn'
                 GROUP  BY book_id
             ) c ON c.book_id = b.id
             SET b.total_copies     = COALESCE(c.total, 0),
                 b.available_copies = COALESCE(c.avail, 0)
             WHERE b.id = ?",
            [$bookId, $bookId]
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUDIT
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Write an audit row. Never allowed to break the caller — a failed audit
     * write is logged and swallowed.
     */
    protected function audit(
        string $entity,
        ?int $entityId,
        string $action,
        ?array $before = null,
        ?array $after = null
    ): void {
        try {
            $this->db()->execute(
                'INSERT INTO lib_audit_log
                    (ssms_client_code, entity, entity_id, action, before_json, after_json, actor, ip_address)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $this->clientCode(),
                    $entity,
                    $entityId,
                    $action,
                    $before !== null ? json_encode($before, JSON_UNESCAPED_UNICODE) : null,
                    $after !== null ? json_encode($after, JSON_UNESCAPED_UNICODE) : null,
                    $this->actor(),
                    $this->request->clientIp(),
                ]
            );
        } catch (\Throwable $e) {
            Log::warning('lib_audit_log write failed: ' . $e->getMessage());
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MISC
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Cast the numeric-ish columns MySQL returns as strings back to real types,
     * so the app never has to do `Number(x)` in a render path.
     */
    protected function castRow(array $row, array $ints = [], array $floats = [], array $bools = []): array
    {
        foreach ($ints as $k) {
            if (array_key_exists($k, $row)) {
                $row[$k] = $row[$k] === null ? null : (int)$row[$k];
            }
        }
        foreach ($floats as $k) {
            if (array_key_exists($k, $row)) {
                $row[$k] = $row[$k] === null ? null : (float)$row[$k];
            }
        }
        foreach ($bools as $k) {
            if (array_key_exists($k, $row)) {
                $row[$k] = (bool)$row[$k];
            }
        }

        return $row;
    }

    /** @param array<int,array> $rows */
    protected function castRows(array $rows, array $ints = [], array $floats = [], array $bools = []): array
    {
        return array_map(fn(array $r) => $this->castRow($r, $ints, $floats, $bools), $rows);
    }
}
