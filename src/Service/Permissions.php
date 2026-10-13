<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * Roles & permissions.
 *
 * Every role has, per module, five kinds of access: view, edit (add/edit), delete, approve, export.
 * Built-in roles (owner, admin, principal, user/teacher, staff, accountant) start with DEFAULTS that
 * match how the app behaved before; a school can change them (except owner) and add custom roles.
 * A custom role is always based on a built-in one (its "base role", which is what the rest of the
 * app sees in the token) and adds or removes access on top.
 *
 * Enforcement (JwtAuthMiddleware → check()):
 *   - built-in roles: only the SENSITIVE modules are enforced, so nothing else changes for a school
 *     until it edits a role;
 *   - custom roles and edited built-in roles: every mapped module is enforced;
 *   - parents / students are never checked here (their controllers limit them to their own data).
 *
 * Tables: ssms_roles, ssms_role_permissions (+ sawera_ssms_users.custom_role_id)
 */
class Permissions
{
    public const KINDS = ['view', 'edit', 'delete', 'approve', 'export'];

    public const MODULES = [
        'students'         => 'Students',
        'health'           => 'Student health (medical & allergies)',
        'attendance'       => 'Attendance',
        'student_leave'    => 'Student leave & late/early',
        'safety'           => 'Visitors & safe pick-up',
        'exams'            => 'Exams, marks & report cards',
        'exam_logistics'   => 'Exam halls, seating & admit cards',
        'homework'         => 'Homework',
        'fees'             => 'Fees',
        'finance'          => 'Finance & payroll',
        'staff'            => 'Staff & HR',
        'staff_attendance' => 'Staff attendance',
        'timetable'        => 'Timetable & subjects',
        'transport'        => 'Transport',
        'hostel'           => 'Hostel',
        'library'          => 'Library',
        'notices'          => 'Notices, events & gallery',
        'messages'         => 'Messages',
        'meetings'         => 'Parent–teacher meetings',
        'analytics'        => 'Reports & analytics',
        'settings'         => 'School settings',
        'users'            => 'Users & roles',
        'privacy'          => 'Privacy & audit',
    ];

    /** kinds that make no sense for a module (shown grey in the app) */
    public const NOT_APPLICABLE = [
        'attendance' => ['delete', 'approve'], 'student_leave' => ['delete', 'export'], 'homework' => ['approve'],
        'timetable' => ['approve'], 'transport' => ['approve'], 'hostel' => ['approve'], 'library' => ['approve'],
        'notices' => ['approve', 'export'], 'messages' => ['approve', 'export'], 'settings' => ['delete', 'approve', 'export'],
        'users' => ['export'], 'staff_attendance' => ['delete'], 'students' => ['approve'],
        'health' => ['approve', 'delete'],
        'meetings' => ['export'],
        'analytics' => ['delete', 'approve'],
    ];

    /**
     * Enforced for built-in roles even when not edited (clearly admin-only areas).
     * Fees and finance are enforced once a school edits or customises a role, because some
     * schools let ordinary staff collect fees today.
     */
    public const SENSITIVE = ['users', 'settings', 'privacy'];
    /** Changes to these need the two-step code again (RolesApi). */
    public const CONFIRM_MODULES = ['fees', 'finance', 'users', 'settings', 'privacy'];

    public const BASE_ROLES = ['owner', 'admin', 'principal', 'user', 'teacher', 'staff', 'accountant'];
    public const PORTAL_ROLES = ['parent', 'student'];

    /** Newer modules split out of an older one (roles saved before the split inherit from it). */
    public const DERIVED_FROM = ['health' => 'students', 'meetings' => 'messages', 'analytics' => 'students', 'exam_logistics' => 'exams', 'safety' => 'student_leave'];

    /** Controller → module */
    public const CONTROLLER_MODULES = [
        'FeeApi' => 'fees', 'OnlinePayApi' => 'fees',
        'ExamServiceApi' => 'exams', 'ReportCardApi' => 'exams', 'DatesheetApi' => 'exams', 'QuestionPaperApi' => 'exams',
        'QuestionBankApi' => 'exams', 'TestSeriesApi' => 'exams',
        'StudentApi' => 'students', 'CertificateApi' => 'students', 'StudentRecordApi' => 'students',
        'StudentLeaveApi' => 'student_leave',
        'StaffServiceApi' => 'staff', 'LeaveApi' => 'staff',
        'StaffAttendanceApi' => 'staff_attendance',
        'TimeTableServiceApi' => 'timetable', 'SubjectServiceApi' => 'timetable', 'CoverApi' => 'timetable', 'CalendarApi' => 'notices', 'SafetyApi' => 'safety', 'BusTrackingApi' => 'transport',
        'SetupServiceApi' => 'settings', 'SchoolSettingsServiceApi' => 'settings',
        'TransportServiceApi' => 'transport', 'HostelServiceApi' => 'hostel',
        'LibraryCatalogApi' => 'library', 'LibraryMemberApi' => 'library', 'LibraryCirculationApi' => 'library',
        'LibraryFineApi' => 'library', 'LibraryAdminApi' => 'library', 'LibraryFacilityApi' => 'library',
        'LibrarySerialApi' => 'library', 'LibraryAcquisitionApi' => 'library', 'LibraryProgramApi' => 'library',
        'NoticeApi' => 'notices', 'SchoolEventsApi' => 'notices', 'SchoolGalleryApi' => 'notices',
        'HomeworkApi' => 'homework', 'ChatApi' => 'messages', 'MeetingApi' => 'meetings',
        'AnalyticsApi' => 'analytics', 'ExamLogisticsApi' => 'exam_logistics', 'LocaleApi' => 'settings',
        'NotifyApi' => 'notices',
    ];

    /** Actions on otherwise-unmapped controllers */
    public const ACTION_MODULES = [
        'UserServiceApi' => [
            'getUsers' => 'users', 'createUser' => 'users', 'updateUser' => 'users', 'deleteUser' => 'users',
            'getStudentUsers' => 'users', 'toggleStudentUserStatus' => 'users', 'updateInstituteDetails' => 'settings',
        ],
        'StudentRecordApi' => [
            'saveMedical' => 'health', 'medicalList' => 'health', 'saveFieldDef' => 'settings',
        ],
    ];

    /** Actions everyone signed in may call whatever the module (self-service). */
    public const ALWAYS = [
        'StaffAttendanceApi' => ['myToday', 'checkIn', 'checkOut', 'myMonth', 'settings'],
        'LeaveApi'           => ['getLeaveTypes', 'applyLeave', 'getMyLeaves', 'cancelLeave', 'getLeaveBalance'],
        'StudentLeaveApi'    => ['myChildren', 'myRequests', 'submit', 'cancel', 'update', 'countDays', 'settings'],
        'ExamLogisticsApi'   => ['myDuties', 'myAdmitCards'],
        'CoverApi'           => ['myCovers', 'respond', 'myDay'],
        'CalendarApi'        => ['myFeed', 'saveFeed', 'resetFeed', 'removeFeed', 'preview', 'upcoming'],
        'BusTrackingApi'     => ['driverHome', 'startTrip', 'driverTrip', 'ping', 'markStudent', 'endTrip', 'myBus', 'setMyAlert'],   // the driver of the route / a parent's own child; checked in the service
        'SafetyApi'          => ['myVisitors', 'expectVisitor', 'newVisitCode', 'cancelExpected', 'staff', 'myPickup', 'addMyPerson', 'removeMyPerson', 'newMyCode', 'myPersonPhoto', 'photo'],   // own visitors / a parent's own child; checked in the service   // own calendar link; the school link is checked in the service   // own cover periods; the office pages are checked in the service
        'NotifyApi'          => ['summary', 'inbox', 'markRead', 'prefs', 'savePref', 'registerDevice', 'unregisterDevice', 'noticeRead',
                                 'settings', 'saveSettings', 'deliveryLog', 'retryFailed',
                                 'messaging', 'saveChannel', 'testChannel', 'testSend', 'templates', 'saveTemplate', 'optOut'],   // own inbox / choices; school settings are checked in the controller
        'LocaleApi'          => ['current', 'options', 'myLanguage'],   // everyone formats money / dates the school's way   // own invigilation duties; a family's own admit cards
        'ChatApi'            => ['*'],
        'OnlinePayApi'       => ['availability', 'paymentStatus', 'createFeePayment'],
        'SchoolSettingsServiceApi' => ['getSettings', 'getIdCardConfig'],
        // Shared look-up lists (branches, sessions, classes, sections, subjects) that almost every
        // screen needs for its filters. Reading them is always allowed, so a role with e.g. only
        // Attendance can still pick a class; changing them stays under "School settings".
        'SetupServiceApi'   => ['getBranches', 'getClasses', 'getSections', 'getSessions'],
        'StudentApi'        => ['getClasses', 'getBranches', 'getSessions', 'getSections'],
        'SubjectServiceApi' => ['getSubjects', 'getClassSubjects', 'getSubjectTeachers', 'getMaxMarks'],
    ];

    private static $cache = [];

    // ── Defaults (match the app's behaviour before roles existed) ─────────

    public static function defaults(string $base): array
    {
        $all  = array_fill_keys(self::KINDS, true);
        $none = array_fill_keys(self::KINDS, false);
        $v    = ['view' => true] + $none;
        $ve   = ['view' => true, 'edit' => true] + $none;
        $out  = [];
        foreach (array_keys(self::MODULES) as $m) {
            $out[$m] = $none;
        }
        switch ($base) {
            case 'owner':
                foreach ($out as $m => $_) {
                    $out[$m] = $all;
                }
                break;
            case 'admin':
                foreach ($out as $m => $_) {
                    $out[$m] = $all;
                }
                $out['users']['approve']   = false;   // edit roles: owner, or admins it is given to
                $out['privacy']['export']  = false;   // export audit log: owner
                $out['privacy']['delete']  = false;   // approve deletions: owner
                break;
            case 'principal':
                foreach ($out as $m => $_) {
                    $out[$m] = $v;
                }
                foreach (['students', 'attendance', 'student_leave', 'exams', 'homework', 'staff', 'staff_attendance',
                          'timetable', 'notices', 'messages'] as $m) {
                    $out[$m] = ['view' => true, 'edit' => true, 'approve' => true, 'export' => true] + $none;
                }
                $out['health']  = ['view' => true, 'edit' => true, 'export' => true] + $none;
                $out['meetings'] = ['view' => true, 'edit' => true, 'approve' => true, 'delete' => true] + $none;   // office: every teacher's sessions
                $out['analytics'] = ['view' => true, 'edit' => true, 'export' => true] + $none;
                $out['exam_logistics'] = $all;   // exam office: halls, seating, duties, admit cards
                $out['safety'] = $all;           // visitors, watch list, pick-up persons
                $out['finance'] = $none;
                $out['users']   = $v;
                $out['settings'] = $v;
                $out['privacy'] = ['view' => false] + $none;
                break;
            case 'accountant':
                $out['fees']     = $all;
                $out['finance']  = $all;
                $out['students'] = $v;
                $out['notices']  = $v;
                $out['messages'] = $ve;
                $out['settings'] = $v;
                $out['analytics'] = ['view' => true, 'export' => true] + $none;   // fee collection reports
                break;
            default:   // user / teacher / staff
                foreach (['students', 'health', 'attendance', 'homework', 'messages', 'meetings'] as $m) {
                    $out[$m] = $ve;
                }
                $out['student_leave']    = ['view' => true, 'edit' => true, 'approve' => true] + $none;
                $out['exams']            = ['view' => true, 'edit' => true, 'export' => true] + $none;
                $out['staff']            = $ve;   // apply for own leave
                $out['staff_attendance'] = $v;
                foreach (['timetable', 'transport', 'hostel', 'library', 'notices', 'settings'] as $m) {
                    $out[$m] = $v;
                }
                $out['analytics'] = $v;   // their own classes only (attendance, marks, at-risk)
                $out['exam_logistics'] = $v;   // see seating plans and halls; own duties are always open
                $out['safety'] = $ve;           // reception / gate: sign visitors in, hand children over
                $out['fees'] = $ve;   // some schools let staff collect fees; approve/delete stay with finance roles
                break;
        }

        return $out;
    }

    // ── Roles ─────────────────────────────────────────────────────────────

    /** Built-in + custom roles for the school with member counts. */
    public static function roles(string $client): array
    {
        $counts = [];
        $customCounts = [];
        foreach (self::db()->execute(
            'SELECT LOWER(ssms_user_role) r, ' . self::customCol() . ' c, COUNT(*) n FROM sawera_ssms_users
              WHERE ssms_client_code = ? GROUP BY LOWER(ssms_user_role), c',
            [$client]
        )->fetchAll('assoc') as $r) {
            if (!empty($r['c'])) {
                $customCounts[(int)$r['c']] = ($customCounts[(int)$r['c']] ?? 0) + (int)$r['n'];
            } else {
                $counts[$r['r']] = ($counts[$r['r']] ?? 0) + (int)$r['n'];
            }
        }
        $edited = [];
        $custom = [];
        foreach (self::db()->execute('SELECT * FROM ssms_roles WHERE ssms_client_code = ? ORDER BY name', [$client])->fetchAll('assoc') as $r) {
            if ((int)$r['is_system'] === 1) {
                $edited[$r['base_role']] = (int)$r['id'];
            } else {
                $custom[] = ['id' => (int)$r['id'], 'key' => 'custom:' . $r['id'], 'name' => $r['name'], 'base_role' => $r['base_role'],
                             'system' => false, 'editable' => true, 'own_classes_only' => (int)$r['own_classes_only'] === 1,
                             'members' => $customCounts[(int)$r['id']] ?? 0];
            }
        }
        $labels = ['owner' => 'Owner', 'admin' => 'Admin', 'principal' => 'Principal', 'user' => 'Teacher',
                   'staff' => 'Staff', 'accountant' => 'Accountant'];
        $out = [];
        foreach ($labels as $k => $label) {
            $n = ($counts[$k] ?? 0) + ($k === 'user' ? ($counts['teacher'] ?? 0) : 0);
            $out[] = ['id' => $edited[$k] ?? null, 'key' => $k, 'name' => $label, 'base_role' => $k, 'system' => true,
                      'editable' => $k !== 'owner', 'edited' => isset($edited[$k]), 'own_classes_only' => in_array($k, ['user', 'staff'], true),
                      'members' => $n];
        }

        return array_merge($out, $custom, [
            ['id' => null, 'key' => 'portal', 'name' => 'Parent · Student', 'base_role' => 'parent', 'system' => true,
             'editable' => false, 'portal' => true, 'members' => ($counts['parent'] ?? 0) + ($counts['student'] ?? 0)],
        ]);
    }

    /** One role with its grid. $key: built-in role key, or "custom:<id>" */
    public static function role(string $client, string $key): array
    {
        [$base, $roleId, $name, $own] = self::resolveKey($client, $key);
        $grid = self::grid($client, $base, $roleId);
        $members = [];
        if (str_starts_with($key, 'custom:')) {
            $members = self::db()->execute(
                'SELECT ssms_user_name, ssms_user_firstname, ssms_user_lastname, ssms_user_role FROM sawera_ssms_users
                  WHERE ssms_client_code = ? AND custom_role_id = ? ORDER BY ssms_user_firstname', [$client, $roleId]
            )->fetchAll('assoc');
        }

        return [
            'key' => $key, 'name' => $name, 'base_role' => $base, 'own_classes_only' => $own,
            'system' => !str_starts_with($key, 'custom:'), 'editable' => $base !== 'owner' || str_starts_with($key, 'custom:'),
            'grid' => $grid, 'modules' => self::MODULES, 'kinds' => self::KINDS, 'not_applicable' => self::NOT_APPLICABLE,
            'members' => $members,
        ];
    }

    /**
     * Save a role. $d: name?, base_role? (new custom), own_classes_only?, grid {module: {kind: bool}}
     * $actorGrid = the saving person's own permissions (nobody can give more than they have).
     * Returns [role, changes[]] where changes = ["+ Fees · edit", "− Students · delete"].
     */
    public static function save(string $client, ?string $key, array $d, string $actorRole, array $actorGrid, string $by): array
    {
        $isNew = $key === null || $key === '' || $key === 'new';
        if ($isNew) {
            $base = strtolower((string)($d['base_role'] ?? 'staff'));
            if (!in_array($base, ['admin', 'principal', 'user', 'staff', 'accountant'], true)) {
                throw new \InvalidArgumentException('Choose which built-in role to start from.');
            }
            $name = trim((string)($d['name'] ?? ''));
            if ($name === '' || mb_strlen($name) > 60) {
                throw new \InvalidArgumentException('Give the role a name (up to 60 characters).');
            }
            $dupe = self::db()->execute('SELECT 1 FROM ssms_roles WHERE ssms_client_code = ? AND name = ? LIMIT 1', [$client, $name])->fetch('assoc');
            if ($dupe) {
                throw new \InvalidArgumentException('A role with this name already exists.');
            }
            self::db()->execute(
                'INSERT INTO ssms_roles (ssms_client_code, name, base_role, is_system, own_classes_only, created_by, created, modified)
                 VALUES (?,?,?,0,?,?,?,?)',
                [$client, $name, $base, !empty($d['own_classes_only']) ? 1 : 0, mb_substr($by, 0, 100), AccountSecurity::now(), AccountSecurity::now()]
            );
            $roleId = (int)self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'];
            $key    = 'custom:' . $roleId;
            $before = self::grid($client, $base, null);   // a new role starts as a copy of its base
        } else {
            [$base, $roleId, $name] = self::resolveKey($client, $key);
            if ($base === 'owner' && !str_starts_with($key, 'custom:')) {
                throw new \DomainException('The Owner role can\'t be changed.');
            }
            $before = self::grid($client, $base, $roleId);
            if (!str_starts_with($key, 'custom:') && !$roleId) {
                // first edit of a built-in role → create its override row
                self::db()->execute(
                    'INSERT INTO ssms_roles (ssms_client_code, name, base_role, is_system, own_classes_only, created_by, created, modified)
                     VALUES (?,?,?,1,?,?,?,?)',
                    [$client, $name, $base, in_array($base, ['user', 'staff'], true) ? 1 : 0, mb_substr($by, 0, 100), AccountSecurity::now(), AccountSecurity::now()]
                );
                $roleId = (int)self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'];
            }
            if (str_starts_with($key, 'custom:')) {
                $newName = trim((string)($d['name'] ?? $name));
                if ($newName === '' || mb_strlen($newName) > 60) {
                    throw new \InvalidArgumentException('Give the role a name (up to 60 characters).');
                }
                self::db()->execute('UPDATE ssms_roles SET name = ?, modified = ? WHERE id = ?', [$newName, AccountSecurity::now(), $roleId]);
            }
        }
        if (array_key_exists('own_classes_only', $d)) {
            self::db()->execute('UPDATE ssms_roles SET own_classes_only = ? WHERE id = ?', [!empty($d['own_classes_only']) ? 1 : 0, $roleId]);
        }
        $after = $before;
        foreach ((array)($d['grid'] ?? []) as $m => $kinds) {
            if (!isset(self::MODULES[$m])) {
                continue;
            }
            foreach (self::KINDS as $k) {
                if (!array_key_exists($k, (array)$kinds) || in_array($k, self::NOT_APPLICABLE[$m] ?? [], true)) {
                    continue;
                }
                $want = (bool)$kinds[$k];
                if ($want && !$before[$m][$k] && $actorRole !== 'owner' && empty($actorGrid[$m][$k])) {
                    throw new \DomainException('You can\'t give "' . self::MODULES[$m] . ' · ' . $k . '" because you don\'t have it yourself.');
                }
                $after[$m][$k] = $want;
            }
        }
        $changes = [];
        foreach ($after as $m => $kinds) {
            foreach ($kinds as $k => $v) {
                if ($v !== $before[$m][$k]) {
                    $changes[] = ($v ? '+ ' : '− ') . self::MODULES[$m] . ' · ' . $k;
                }
            }
        }
        self::db()->execute('DELETE FROM ssms_role_permissions WHERE role_id = ?', [$roleId]);
        foreach ($after as $m => $k) {
            self::db()->execute(
                'INSERT INTO ssms_role_permissions (role_id, module, can_view, can_edit, can_delete, can_approve, can_export) VALUES (?,?,?,?,?,?,?)',
                [$roleId, $m, (int)$k['view'], (int)$k['edit'], (int)$k['delete'], (int)$k['approve'], (int)$k['export']]
            );
        }
        self::$cache = [];

        return [self::role($client, $key), $changes, $isNew];
    }

    /** Built-in role back to the defaults / delete a custom role (its members go back to their base role). */
    public static function remove(string $client, string $key): array
    {
        [$base, $roleId] = self::resolveKey($client, $key);
        if (!$roleId) {
            throw new \DomainException('Nothing to reset.');
        }
        $affected = [];
        if (str_starts_with($key, 'custom:')) {
            $affected = array_column(self::db()->execute(
                'SELECT ssms_user_name FROM sawera_ssms_users WHERE ssms_client_code = ? AND custom_role_id = ?', [$client, $roleId]
            )->fetchAll('assoc'), 'ssms_user_name');
            self::db()->execute('UPDATE sawera_ssms_users SET custom_role_id = NULL WHERE ssms_client_code = ? AND custom_role_id = ?', [$client, $roleId]);
        }
        self::db()->execute('DELETE FROM ssms_role_permissions WHERE role_id = ?', [$roleId]);
        self::db()->execute('DELETE FROM ssms_roles WHERE id = ? AND ssms_client_code = ?', [$roleId, $client]);
        self::$cache = [];

        return $affected;
    }

    /** Put a person in a custom role (or back to their built-in role with $key = null). */
    public static function assign(string $client, string $username, ?string $key): array
    {
        $u = self::db()->execute('SELECT ssms_user_name, ssms_user_role FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name = ? LIMIT 1',
            [$client, $username])->fetch('assoc');
        if (!$u) {
            throw new \InvalidArgumentException('User not found.');
        }
        $role = strtolower((string)$u['ssms_user_role']);
        if (in_array($role, ['owner', 'parent', 'student'], true)) {
            throw new \DomainException('Owners, parents and students can\'t be given a custom role.');
        }
        $roleId = null;
        if ($key) {
            [$base, $roleId] = self::resolveKey($client, $key);
            if (!str_starts_with($key, 'custom:')) {
                throw new \InvalidArgumentException('Choose a custom role.');
            }
            // the person's built-in role must match the custom role's base (that is what the rest of the app sees)
            $staffish = ['user', 'teacher', 'staff'];
            $match    = $role === $base || (in_array($role, $staffish, true) && in_array($base, $staffish, true));
            if (!$match) {
                throw new \DomainException('This role is based on "' . $base . '", but ' . $username . ' is "' . $role . '". Change their built-in role first.');
            }
        }
        self::db()->execute('UPDATE sawera_ssms_users SET custom_role_id = ? WHERE ssms_client_code = ? AND ssms_user_name = ?', [$roleId, $client, $username]);
        self::$cache = [];

        return ['username' => $username, 'role' => $role, 'custom_role_id' => $roleId];
    }

    /** People who can be put into a custom role. */
    public static function people(string $client): array
    {
        return self::db()->execute(
            "SELECT ssms_user_name, ssms_user_firstname, ssms_user_lastname, ssms_user_role, " . self::customCol() . " AS custom_role_id
               FROM sawera_ssms_users WHERE ssms_client_code = ? AND LOWER(ssms_user_role) NOT IN ('owner','parent','student')
              ORDER BY ssms_user_firstname, ssms_user_name", [$client]
        )->fetchAll('assoc');
    }

    // ── Effective permissions ─────────────────────────────────────────────

    /** module → kind → bool for a signed-in person */
    public static function forUser(string $client, string $role, $customRoleId = null): array
    {
        $role = strtolower($role);
        if ($role === 'teacher') {
            $role = 'user';
        }
        $k = $client . '|' . $role . '|' . (int)$customRoleId;
        if (isset(self::$cache[$k])) {
            return self::$cache[$k];
        }
        if (in_array($role, self::PORTAL_ROLES, true)) {
            return self::$cache[$k] = [];
        }
        $roleId = $customRoleId ? (int)$customRoleId : self::systemRoleId($client, $role);

        return self::$cache[$k] = self::grid($client, $role, $roleId);
    }

    /** Is enforcement on for this role (custom or edited)? */
    public static function customised(string $client, string $role, $customRoleId = null): bool
    {
        return (bool)$customRoleId || self::systemRoleId($client, strtolower($role) === 'teacher' ? 'user' : strtolower($role)) !== null;
    }

    /** → [module, kind] for an API call, or null when not mapped / always allowed */
    public static function classify(string $controller, string $action, string $method): ?array
    {
        $always = self::ALWAYS[$controller] ?? [];
        if (in_array('*', $always, true) || in_array($action, $always, true)) {
            return null;
        }
        $module = self::ACTION_MODULES[$controller][$action] ?? self::CONTROLLER_MODULES[$controller] ?? null;
        if (!$module) {
            return null;
        }
        $a = strtolower($action);
        if (str_contains($a, 'attendance') && $module === 'students') {
            $module = 'attendance';
        }
        if (preg_match('/export|download|pdf|csv|excel|print/', $a)) {
            $kind = 'export';
        } elseif (preg_match('/^(delete|remove|destroy|purge)|delete|remove/', $a)) {
            $kind = 'delete';
        } elseif (preg_match('/^(approve|reject|review|publish|verify)|approv|reject/', $a)) {
            $kind = 'approve';
        } elseif (strtoupper($method) === 'GET' || preg_match('/^(get|list|fetch|view|search|load|find|check|count|report|summary|show|my|day|month|preview|calc)/', $a)) {
            $kind = 'view';
        } else {
            $kind = 'edit';
        }

        return [$module, $kind];
    }

    /** null = allowed, otherwise the refusal message */
    public static function check(string $client, string $role, $customRoleId, string $controller, string $action, string $method): ?string
    {
        $role = strtolower($role);
        if ($role === 'owner' || in_array($role, self::PORTAL_ROLES, true) || $role === ''
            || !in_array($role, self::BASE_ROLES, true)) {
            return null;   // owner, parents/students (own data only) and platform roles such as superuser
        }
        $c = self::classify($controller, $action, $method);
        if (!$c) {
            return null;
        }
        [$module, $kind] = $c;
        $custom = self::customised($client, $role, $customRoleId);
        if (!$custom && !in_array($module, self::SENSITIVE, true)) {
            return null;
        }
        $grid = self::forUser($client, $role, $customRoleId);
        if (!empty($grid[$module][$kind])) {
            return null;
        }
        $what = ['view' => 'see', 'edit' => 'add or change', 'delete' => 'delete', 'approve' => 'approve', 'export' => 'export'][$kind];

        return "You don't have permission to {$what} " . strtolower(self::MODULES[$module]) . '. Ask the school owner if you need it.';
    }

    /**
     * What the app should hide/block: module → [kinds allowed], only for modules the server
     * actually enforces for this person. Modules left out are allowed (AuthContext.can).
     * null = nothing is enforced (checks switched off, owner, parents/students).
     */
    public static function forApp(string $client, string $role, $customRoleId = null): ?array
    {
        $role = strtolower($role);
        if ($role === 'owner' || $role === '' || !in_array($role, self::BASE_ROLES, true)) {
            return null;
        }
        try {
            if (!AccountSecurity::settings($client)['permissions_enforced']) {
                return null;
            }
        } catch (\Throwable $e) {
            return null;
        }
        $all = self::compact(self::forUser($client, $role, $customRoleId));
        if (self::customised($client, $role, $customRoleId)) {
            return $all;
        }

        // health, meetings and analytics are always checked by their own services, so the app hides them too
        return array_intersect_key($all, array_flip(array_merge(self::SENSITIVE, ['health', 'meetings', 'analytics', 'exam_logistics'])));
    }

    /** Compact list for the app: module → [kinds allowed] */
    public static function compact(array $grid): array
    {
        $out = [];
        foreach ($grid as $m => $kinds) {
            $out[$m] = array_keys(array_filter($kinds));
        }

        return $out;
    }

    // ── internals ───────────────────────────────────────────────────────────

    private static function grid(string $client, string $base, ?int $roleId): array
    {
        $grid = self::defaults($base === 'teacher' ? 'user' : $base);
        if (!$roleId) {
            return $grid;
        }
        $rows = self::db()->execute('SELECT * FROM ssms_role_permissions WHERE role_id = ?', [$roleId])->fetchAll('assoc');
        if (!$rows) {
            return $grid;
        }
        $saved = array_flip(array_column($rows, 'module'));
        foreach ($grid as $m => $_) {
            if (isset($saved[$m])) {
                $grid[$m] = array_fill_keys(self::KINDS, false);
            }
            // a module added after the role was saved keeps the built-in role's defaults …
        }
        foreach ($rows as $r) {
            if (!isset($grid[$r['module']])) {
                continue;
            }
            foreach (self::KINDS as $k) {
                $grid[$r['module']][$k] = (int)$r['can_' . $k] === 1;
            }
        }
        // … but never more than the saved module it grew out of (health came from students)
        foreach (self::DERIVED_FROM as $new => $from) {
            if (!isset($saved[$new]) && isset($saved[$from])) {
                foreach (self::KINDS as $k) {
                    $grid[$new][$k] = $grid[$new][$k] && $grid[$from]['view'] && $grid[$from][$k === 'delete' || $k === 'approve' ? 'edit' : $k];
                }
            }
        }

        return $grid;
    }

    private static function systemRoleId(string $client, string $base): ?int
    {
        $k = 'sys|' . $client . '|' . $base;
        if (array_key_exists($k, self::$cache)) {
            return self::$cache[$k];
        }
        try {
            $r = self::db()->execute('SELECT id FROM ssms_roles WHERE ssms_client_code = ? AND is_system = 1 AND base_role = ? LIMIT 1',
                [$client, $base])->fetch('assoc');
        } catch (\Throwable $e) {
            $r = null;
        }

        return self::$cache[$k] = $r ? (int)$r['id'] : null;
    }

    /** Does this person only see their own classes (Roles & permissions › "own classes only")? */
    public static function ownClassesOnly(string $client, string $role, $customRoleId = null): bool
    {
        $role = strtolower($role) === 'teacher' ? 'user' : strtolower($role);
        if (in_array($role, ['owner', 'admin', 'principal', 'accountant'], true) && !$customRoleId) {
            return false;
        }
        try {
            return self::resolveKey($client, $customRoleId ? 'custom:' . (int)$customRoleId : $role)[3];
        } catch (\Throwable $e) {
            return in_array($role, ['user', 'staff'], true);
        }
    }

    /** → [base, roleId|null, name, own_classes_only] */
    private static function resolveKey(string $client, string $key): array
    {
        if (str_starts_with($key, 'custom:')) {
            $r = self::db()->execute('SELECT * FROM ssms_roles WHERE id = ? AND ssms_client_code = ? AND is_system = 0',
                [(int)substr($key, 7), $client])->fetch('assoc');
            if (!$r) {
                throw new \InvalidArgumentException('Role not found.');
            }

            return [(string)$r['base_role'], (int)$r['id'], (string)$r['name'], (int)$r['own_classes_only'] === 1];
        }
        $key = $key === 'teacher' ? 'user' : $key;
        $names = ['owner' => 'Owner', 'admin' => 'Admin', 'principal' => 'Principal', 'user' => 'Teacher', 'staff' => 'Staff', 'accountant' => 'Accountant'];
        if (!isset($names[$key])) {
            throw new \InvalidArgumentException('Role not found.');
        }
        $id  = self::systemRoleId($client, $key);
        $own = in_array($key, ['user', 'staff'], true);
        if ($id) {
            $own = (int)(self::db()->execute('SELECT own_classes_only FROM ssms_roles WHERE id = ?', [$id])->fetch('assoc')['own_classes_only'] ?? 0) === 1;
        }

        return [$key, $id, $names[$key], $own];
    }

    private static function customCol(): string
    {
        static $has = null;
        if ($has === null) {
            try {
                self::db()->execute('SELECT custom_role_id FROM sawera_ssms_users LIMIT 0');
                $has = true;
            } catch (\Throwable $e) {
                $has = false;
            }
        }

        return $has ? 'custom_role_id' : 'NULL';
    }

    public static function resetCache(): void
    {
        self::$cache = [];
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
