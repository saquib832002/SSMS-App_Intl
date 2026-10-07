<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\LibraryApiTrait;

/**
 * LibraryUserApiController — staff accounts for the library.
 *
 * Owns: sawera_ssms_users (scoped to one client)
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Every action here is owner-only. The owner is the institution's account: the
 * person who signed up. Admins run the library; the owner decides who the
 * admins are. Keeping staff management out of the admin tier means a
 * compromised or departing admin cannot quietly grant themselves a colleague.
 *
 * ── Roles this controller may assign ────────────────────────────────────────
 *   admin       everything in the library, including deletes and waivers
 *   librarian   the desk; no deletes, no writing off money
 *
 * 'owner' is deliberately not assignable. There is one owner per institution
 * and promoting a second one from inside the library module would be a
 * privilege escalation path — the owner tier controls this very screen.
 *
 * ── Passwords ───────────────────────────────────────────────────────────────
 * Hashing here must match UserServiceApiController::login() exactly or the new
 * user simply cannot log in. login() compares against crypt() with a fixed
 * salt, so that is what is used below.
 *
 * That scheme is weak — a hard-coded salt means two users with the same
 * password get identical hashes, and the salt is in source control. It is not
 * this controller's place to change it unilaterally, because every existing
 * account depends on it; changing it needs a migration that rehashes on next
 * login across all modules. Flagged in api/SERVER_NOTE_password_scheme.md
 * rather than silently forked here, which would lock new users out.
 *
 * ── Multi-tenancy ───────────────────────────────────────────────────────────
 * ssms_client_code comes from the JWT and is applied to every read and write,
 * so one institution can never see or edit another's staff. The client code in
 * a request body is ignored.
 */
class LibraryUserApiController extends AppController
{
    use LibraryApiTrait;

    /** Roles the owner may hand out from this screen. */
    private const ASSIGNABLE_ROLES = ['admin', 'librarian'];

    /**
     * Roles that count as library staff and are therefore listed here. Other
     * school roles (Teacher, Accountant…) exist in the same table but have
     * nothing to do with the library, so they are not shown or touched.
     */
    private const LIBRARY_ROLES = ['owner', 'admin', 'librarian', 'library'];

    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    /** Same scheme as UserServiceApiController::login(). Must not diverge. */
    private function encryptPassword(string $plain): string
    {
        return crypt($plain, '$2y$10$iusesomecrazystrings22');
    }

    /**
     * A branch to attach a new account to.
     *
     * Preference order: whichever branch the owner creating the account is in,
     * then the client's first branch. Returns null only when the institution
     * genuinely has no branches, which the caller reports as a real error
     * rather than letting the NOT NULL constraint surface as a 500.
     */
    private function defaultBranchId(string $clientCode): ?int
    {
        $db = $this->db();

        $mine = $db->execute(
            'SELECT branch_id FROM sawera_ssms_users
             WHERE  LOWER(ssms_user_name) = ? AND ssms_client_code = ? LIMIT 1',
            [strtolower($this->actor()), $clientCode]
        )->fetch('assoc') ?: null;

        if ($mine !== null && $mine['branch_id'] !== null && (int)$mine['branch_id'] > 0) {
            return (int)$mine['branch_id'];
        }

        $first = $db->execute(
            'SELECT branch_id FROM ssms_branch
             WHERE  ssms_client_code = ? ORDER BY branch_id ASC LIMIT 1',
            [$clientCode]
        )->fetch('assoc') ?: null;

        return $first !== null && $first['branch_id'] !== null ? (int)$first['branch_id'] : null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LIST
    // ══════════════════════════════════════════════════════════════════════════

    /** GET /libraryUserApi/users */
    public function users(): void
    {
        $this->request->allowMethod(['get']);
        if (!$clientCode = $this->guardOwner()) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count(self::LIBRARY_ROLES), '?'));

        $rows = $this->db()->execute(
            "SELECT u.ssms_user_name, u.ssms_user_firstname, u.ssms_user_lastname,
                    u.ssms_user_email, u.ssms_user_role, u.ssms_user_status,
                    u.mobile_number, u.branch_id, u.validationStatus, u.created,
                    b.branch_name
             FROM   sawera_ssms_users u
             LEFT   JOIN ssms_branch b ON b.branch_id = u.branch_id
             WHERE  u.ssms_client_code = ?
               AND  LOWER(u.ssms_user_role) IN ({$placeholders})
             ORDER  BY FIELD(LOWER(u.ssms_user_role), 'owner', 'admin', 'librarian', 'library'),
                       u.ssms_user_name",
            array_merge([$clientCode], self::LIBRARY_ROLES)
        )->fetchAll('assoc');

        $me = strtolower($this->actor());

        foreach ($rows as &$r) {
            $r['branch_id'] = $r['branch_id'] === null ? null : (int)$r['branch_id'];
            $r['full_name'] = trim(($r['ssms_user_firstname'] ?? '') . ' ' . ($r['ssms_user_lastname'] ?? ''))
                ?: $r['ssms_user_name'];
            // The owner cannot demote, deactivate or delete themselves — doing so
            // would leave the institution with nobody able to manage staff.
            $r['is_self']     = strtolower((string)$r['ssms_user_name']) === $me;
            $r['is_owner']    = strtolower((string)$r['ssms_user_role']) === 'owner';
            $r['is_editable'] = !$r['is_owner'];
        }
        unset($r);

        // Branches populate the dropdown on the add/edit form. branch_id is NOT
        // NULL on the users table, so the form needs the real list rather than
        // a free-text field that can produce an id nobody has.
        $branches = $this->db()->execute(
            'SELECT branch_id, branch_name FROM ssms_branch
             WHERE  ssms_client_code = ? ORDER BY branch_id ASC',
            [$clientCode]
        )->fetchAll('assoc') ?: [];

        foreach ($branches as &$b) {
            $b['branch_id']   = (int)$b['branch_id'];
            $b['branch_name'] = (string)($b['branch_name'] ?? '') ?: ('Branch ' . $b['branch_id']);
        }
        unset($b);

        $this->ok([
            'users'         => $rows,
            'roles'         => self::ASSIGNABLE_ROLES,
            'branches'      => $branches,
            // What the form should pre-select. Matches what the server would
            // have chosen anyway, so the visible default and the saved value
            // cannot disagree.
            'defaultBranch' => $this->defaultBranchId($clientCode),
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CREATE / UPDATE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryUserApi/saveUser
     *
     * Body: { username*, first_name*, last_name, email*, mobile, role*,
     *         password (required when creating), branch_id, is_new }
     *
     * The username is the identity and is immutable once created — it is what
     * appears in every audit row and every "issued by" field, so letting it
     * change would rewrite history.
     */
    public function saveUser(): void
    {
        $this->request->allowMethod(['post', 'put']);
        if (!$clientCode = $this->guardOwner()) {
            return;
        }

        $body     = (array)$this->request->getData();
        $username = strtolower(trim((string)($body['username'] ?? '')));
        $db       = $this->db();

        // fetch() returns false — not null — when there is no row, so the ?: is
        // load-bearing. Without it $existing is false, `$existing === null` is
        // false, and creating a brand-new user takes the edit branch and reads
        // an array offset off a bool.
        $existing = $username === '' ? null : ($db->execute(
            'SELECT ssms_user_name, ssms_user_role, ssms_client_code
             FROM   sawera_ssms_users
             WHERE  LOWER(ssms_user_name) = ? LIMIT 1',
            [$username]
        )->fetch('assoc') ?: null);

        // A username taken by another institution is still taken — the login
        // lookup is global, so uniqueness has to be too.
        $isNew = !$existing;

        $errors = [];

        if ($username === '') {
            $errors['username'] = 'Required';
        } elseif (!preg_match('/^[a-z0-9._-]{3,50}$/', $username)) {
            $errors['username'] = 'Use 3–50 characters: letters, numbers, dot, dash or underscore';
        }

        $firstName = trim((string)($body['first_name'] ?? ''));
        if ($firstName === '') {
            $errors['first_name'] = 'Required';
        }

        $email = trim((string)($body['email'] ?? ''));
        if ($email === '') {
            $errors['email'] = 'Required';
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Not a valid email address';
        }

        $role = strtolower(trim((string)($body['role'] ?? '')));
        if (!in_array($role, self::ASSIGNABLE_ROLES, true)) {
            $errors['role'] = 'Choose Admin or Librarian';
        }

        $password = (string)($body['password'] ?? '');

        if (!$isNew) {
            // Editing. Refuse if the row belongs to someone else's institution,
            // or if it is an owner account — owners are not managed from here.
            if ((string)$existing['ssms_client_code'] !== $clientCode) {
                $errors['username'] = 'That username is already taken';
            } elseif (strtolower((string)$existing['ssms_user_role']) === 'owner') {
                $this->fail(403, 'The owner account cannot be edited here.', 'FORBIDDEN');

                return;
            }
        } elseif ($password === '') {
            $errors['password'] = 'Required';
        }

        if ($password !== '' && strlen($password) < 8) {
            $errors['password'] = 'At least 8 characters';
        }

        if ($errors !== []) {
            $this->invalid('Some details need fixing.', $errors);

            return;
        }

        $lastName = trim((string)($body['last_name'] ?? ''));
        $mobile   = trim((string)($body['mobile'] ?? ''));

        // branch_id is NOT NULL on sawera_ssms_users, and the owner should not
        // have to answer a question about branches to add a librarian — most
        // institutions have exactly one. New accounts inherit a branch instead;
        // see defaultBranchId().
        //
        // On edit the branch is left exactly as it is unless one was explicitly
        // sent. Recomputing the default here would quietly move an existing
        // member of staff to a different branch every time someone corrected a
        // typo in their surname.
        $branchGiven = isset($body['branch_id']) && $body['branch_id'] !== ''
            ? (int)$body['branch_id']
            : null;

        // The dropdown only offers this client's branches, but the dropdown is
        // not the security boundary — a request can carry any number. Attaching
        // staff to another institution's branch would be a tenancy leak.
        if ($branchGiven !== null) {
            $owned = $db->execute(
                'SELECT 1 FROM ssms_branch WHERE branch_id = ? AND ssms_client_code = ? LIMIT 1',
                [$branchGiven, $clientCode]
            )->fetch('assoc') ?: null;

            if ($owned === null) {
                $this->invalid('That branch does not belong to your institution.', [
                    'branch_id' => 'Choose a branch from the list',
                ]);

                return;
            }
        }

        if ($isNew) {
            $branchId = $branchGiven ?? $this->defaultBranchId($clientCode);

            if ($branchId === null) {
                // No branch anywhere for this client. Inserting would violate
                // the NOT NULL constraint, so say what is actually wrong rather
                // than letting the driver throw an integrity error at the user.
                $this->fail(
                    409,
                    'This institution has no branch set up yet, so an account cannot be created. Add a branch first.',
                    'NO_BRANCH'
                );

                return;
            }

            // Created active. This account is made by the owner, in person, for
            // a colleague standing in the library — the email-verification dance
            // that self-signup needs would only stop them working today.
            $db->execute(
                'INSERT INTO sawera_ssms_users (
                    ssms_user_name, ssms_user_firstname, ssms_user_lastname,
                    ssms_user_password, ssms_user_role, ssms_user_email,
                    mobile_number, branch_id, ssms_user_status, ssms_client_code,
                    validationStatus, created, modified
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                [
                    $username, $firstName, $lastName,
                    $this->encryptPassword($password), $role, $email,
                    $mobile, $branchId, 'active', $clientCode,
                    'Verified',
                ]
            );

            $this->audit('user', null, 'create', null, [
                'username' => $username, 'role' => $role,
            ]);

            $this->ok(['username' => $username], null, ucfirst($role) . ' account created.');

            return;
        }

        $fields = [
            'ssms_user_firstname' => $firstName,
            'ssms_user_lastname'  => $lastName,
            'ssms_user_email'     => $email,
            'mobile_number'       => $mobile,
            'ssms_user_role'      => $role,
        ];

        if ($branchGiven !== null) {
            $fields['branch_id'] = $branchGiven;
        }

        if ($password !== '') {
            $fields['ssms_user_password'] = $this->encryptPassword($password);
        }

        $set = implode(', ', array_map(fn($k) => "`{$k}` = ?", array_keys($fields)));

        $db->execute(
            "UPDATE sawera_ssms_users SET {$set}, modified = NOW()
             WHERE  LOWER(ssms_user_name) = ? AND ssms_client_code = ?",
            array_merge(array_values($fields), [$username, $clientCode])
        );

        $this->audit('user', null, 'update', null, [
            'username' => $username,
            'role'     => $role,
            'password' => $password !== '' ? 'changed' : 'unchanged',
        ]);

        $this->ok(['username' => $username], null, 'Account updated.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STATUS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * POST /libraryUserApi/setUserStatus
     * Body: { username*, active* }
     *
     * Deactivating rather than deleting: login() already refuses anything whose
     * status is not 'active', and the account stays attached to its history in
     * the audit log. A deleted user would leave "issued by" pointing at nobody.
     */
    public function setUserStatus(): void
    {
        $this->request->allowMethod(['post']);
        if (!$clientCode = $this->guardOwner()) {
            return;
        }

        $body     = (array)$this->request->getData();
        $username = strtolower(trim((string)($body['username'] ?? '')));
        $active   = !empty($body['active']);

        if ($username === '') {
            $this->invalid('Which account?', ['username' => 'Required']);

            return;
        }

        if ($username === strtolower($this->actor())) {
            $this->fail(409, 'You cannot deactivate your own account.', 'SELF_LOCKOUT');

            return;
        }

        $row = $this->db()->execute(
            'SELECT ssms_user_role FROM sawera_ssms_users
             WHERE  LOWER(ssms_user_name) = ? AND ssms_client_code = ? LIMIT 1',
            [$username, $clientCode]
        )->fetch('assoc');

        if (!$row) {
            $this->notFound('Account');

            return;
        }

        if (strtolower((string)$row['ssms_user_role']) === 'owner') {
            $this->fail(403, 'The owner account cannot be deactivated.', 'FORBIDDEN');

            return;
        }

        $this->db()->execute(
            'UPDATE sawera_ssms_users SET ssms_user_status = ?, modified = NOW()
             WHERE  LOWER(ssms_user_name) = ? AND ssms_client_code = ?',
            [$active ? 'active' : 'inactive', $username, $clientCode]
        );

        $this->audit('user', null, $active ? 'activate' : 'deactivate', null, ['username' => $username]);

        $this->ok(
            ['username' => $username, 'active' => $active],
            null,
            $active ? 'Account reactivated.' : 'Account deactivated. They can no longer sign in.'
        );
    }
}
