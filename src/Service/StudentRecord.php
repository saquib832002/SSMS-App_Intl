<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * Complete student record: guardians, emergency contacts, medical & allergies, documents
 * and custom fields per school. Everything is keyed by registration_id so it follows the
 * student from one school year (enrollment) to the next.
 *
 * Who sees what
 *   Staff     – "Students · view" (teachers with "own classes only": only their classes).
 *               Medical needs "Student health · view"; downloading a document needs
 *               "Students · export"; changing anything needs "… · edit", deleting "… · delete".
 *               Turning on a guardian's app sign-in needs "Users & roles · edit".
 *   Parents   – their own children. They see guardians (not restricted ones or notes),
 *               emergency contacts, medical, documents marked "parent can see", and custom
 *               fields marked visible. They can update emergency contacts, medical details,
 *               fields marked "parent can edit", and upload documents (staff verify them).
 *   Students  – read only, no medical notes and no restricted details.
 */
class StudentRecord
{
    public const RELATIONS = ['mother' => 'Mother', 'father' => 'Father', 'guardian' => 'Guardian', 'grandparent' => 'Grandparent',
        'step_parent' => 'Step-parent', 'foster_parent' => 'Foster parent', 'sibling' => 'Brother / sister', 'aunt_uncle' => 'Aunt / uncle',
        'other' => 'Other'];

    public const DOC_TYPES = ['birth_certificate' => 'Birth certificate', 'passport' => 'Passport', 'visa' => 'Visa / residence permit',
        'national_id' => 'National ID', 'transfer_certificate' => 'Transfer / leaving certificate', 'previous_report' => 'Previous school report',
        'medical' => 'Medical certificate', 'immunisation' => 'Immunisation record', 'address_proof' => 'Address proof',
        'custody' => 'Custody / court order', 'photo' => 'Photo', 'other' => 'Other'];

    /**
     * A student has one current copy of these: uploading the same type again replaces the
     * earlier file (it is deleted from the server). Other types (previous reports, medical
     * certificates, custody papers, "other") can have several.
     */
    public const SINGLE_TYPES = ['birth_certificate', 'passport', 'visa', 'national_id', 'transfer_certificate', 'immunisation', 'address_proof', 'photo'];

    /** Only staff can see these document types (never parents). */
    public const STAFF_ONLY_DOCS = ['custody'];

    public const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    public const ALERT_LEVELS = ['none', 'info', 'serious', 'severe'];
    public const FIELD_TYPES = ['text', 'long_text', 'number', 'date', 'select', 'yes_no', 'phone', 'email'];
    public const MEDICAL_FIELDS = ['allergies', 'conditions', 'medications', 'dietary', 'doctor', 'insurance', 'notes'];

    public const MAX_BYTES = 10 * 1024 * 1024;
    public const MIMES = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
        'image/heic' => 'heic', 'image/heif' => 'heif'];
    public const MAX_GUARDIANS = 10;
    public const MAX_CONTACTS = 10;
    public const MAX_DOCS = 60;
    public const MAX_FIELDS = 60;

    public const ADMINS = ['owner', 'admin', 'principal'];

    /** tests: override the old private storage folder (files uploaded before 21 Oct 2026) */
    public static $storageRoot = null;
    /** tests: override the web root (documents live in <webroot>/clients/<code>/Students/<reg>/) */
    public static $legacyRoot = null;

    /**
     * File names: <registration id>_<type>.<ext>, e.g. RTWF-2026-0002_DOB_Cert.jpg;
     * a second file of the same type gets _2, _3 … The folder's .htaccess blocks direct
     * links to these names (photos and admission-form files in the folder stay reachable).
     * Files uploaded before 22 Oct 2026 are named rec_<32 hex>.<ext> and stay protected too.
     */
    public const FILE_CODES = ['birth_certificate' => 'DOB_Cert', 'passport' => 'Passport', 'visa' => 'Visa', 'national_id' => 'National_ID',
        'transfer_certificate' => 'Transfer_Cert', 'previous_report' => 'Marksheet', 'medical' => 'Medical_Cert', 'immunisation' => 'Immunisation',
        'address_proof' => 'Address_Proof', 'custody' => 'Custody_Order', 'photo' => 'Photo_ID', 'other' => 'Document'];
    public const FILE_PATTERN = '/^rec_[0-9a-f]{32}\.[a-z0-9]{2,5}$/';
    private const HTACCESS_MARK = '# ManageMyAcademy: student record documents are private';
    private const HTACCESS_END  = '# /ManageMyAcademy student record documents';

    // ── Who is asking ───────────────────────────────────────────────────────

    /**
     * Resolve the student and what this person may do with their record.
     * $actor = [user, role, custom_role, enrollment (portal student)]
     * → ['student' => […], 'level' => staff|parent|student, 'can' => [...]]
     */
    public static function access(string $client, array $actor, ?string $regId, ?string $enrollmentId = null): array
    {
        $role = strtolower(trim((string)($actor['role'] ?? '')));
        $role = $role === 'teacher' ? 'user' : $role;
        $user = (string)($actor['user'] ?? '');
        $stu  = self::student($client, $regId, $enrollmentId);
        if (!$stu) {
            throw new \InvalidArgumentException('Student not found.');
        }
        if ($role === 'parent' || $role === 'student') {
            if ($user === '') {
                throw new \DomainException('Please sign in again.');
            }
            $mine = $role === 'parent'
                ? self::parentRegistrations($client, $user)
                : self::studentRegistrations($client, (string)($actor['enrollment'] ?: $user));
            if (!in_array($stu['registration_id'], $mine, true)) {
                throw new \DomainException('You can only see your own child\'s record.');
            }
            $parent = $role === 'parent';

            return ['student' => $stu, 'level' => $role, 'can' => [
                'view' => true, 'edit_guardians' => false, 'app_access' => false, 'edit_contacts' => $parent,
                'view_medical' => true, 'edit_medical' => $parent, 'medical_notes' => $parent,
                'upload' => $parent, 'edit_documents' => false, 'delete' => false, 'download' => $parent,
                'edit_fields' => $parent, 'restricted' => false, 'protect' => false,
            ]];
        }
        if ($role === '' || $user === '') {
            throw new \DomainException('Please sign in again.');
        }
        $owner = $role === 'owner';
        $grid  = $owner ? [] : Permissions::forUser($client, $role, $actor['custom_role'] ?? null);
        $g     = fn(string $m, string $k) => $owner || !empty($grid[$m][$k]);
        if (!$g('students', 'view')) {
            throw new \DomainException("You don't have permission to see students. Ask the school owner if you need it.");
        }
        if (!$owner && Permissions::ownClassesOnly($client, $role, $actor['custom_role'] ?? null)) {
            $scope = StudentLeave::teacherScope($client, $role, $user);
            $inScope = false;
            foreach ($scope as $sc) {
                if ((int)$sc['class_id'] === (int)$stu['class_id'] && (!$sc['section_id'] || (int)$sc['section_id'] === (int)$stu['section_id'])) {
                    $inScope = true;
                }
            }
            if (!$inScope) {
                throw new \DomainException('You can only see the records of students in your own classes.');
            }
        }

        return ['student' => $stu, 'level' => 'staff', 'can' => [
            'view' => true, 'edit_guardians' => $g('students', 'edit'), 'app_access' => $g('users', 'edit'),
            'edit_contacts' => $g('students', 'edit'), 'view_medical' => $g('health', 'view'), 'edit_medical' => $g('health', 'edit'),
            'medical_notes' => $g('health', 'view'), 'upload' => $g('students', 'edit'), 'edit_documents' => $g('students', 'edit'),
            'delete' => $g('students', 'delete'), 'download' => $g('students', 'export'), 'edit_fields' => $g('students', 'edit'),
            'restricted' => true,
            // lifting a collection restriction or showing custody papers: owner / admin / "Users & roles · edit"
            'protect' => $owner || in_array($role, ['admin'], true) || $g('users', 'edit'),
        ]];
    }

    /** Registration + current (latest active) class. */
    public static function student(string $client, ?string $regId, ?string $enrollmentId = null): ?array
    {
        $regId = trim((string)$regId);
        $enrollmentId = trim((string)$enrollmentId);
        if ($regId === '' && $enrollmentId !== '') {
            $r = self::db()->execute('SELECT registration_id FROM ssms_student_enrollment WHERE enrollment_id = ? AND ssms_client_code = ? LIMIT 1',
                [$enrollmentId, $client])->fetch('assoc');
            $regId = (string)($r['registration_id'] ?? '');
        }
        if ($regId === '') {
            return null;
        }
        $r = self::db()->execute(
            "SELECT r.registration_id, r.student_first_name, r.student_last_name, r.mobile_number, r.email_address,
                    r.student_father_name, r.student_mother_name, r.student_dob
               FROM ssms_student_registration r WHERE r.registration_id = ? AND r.ssms_client_code = ? LIMIT 1",
            [$regId, $client])->fetch('assoc');
        if (!$r) {
            return null;
        }
        $e = self::db()->execute(
            "SELECT e.enrollment_id, e.class_id, e.section_id, e.roll_number, c.class_name, s.section_name
               FROM ssms_student_enrollment e
          LEFT JOIN ssms_classes c ON c.class_id = e.class_id
          LEFT JOIN ssms_sections s ON s.section_id = e.section_id
              WHERE e.registration_id = ? AND e.ssms_client_code = ?
           ORDER BY (COALESCE(e.status,'active') = 'active') DESC, e.session_id DESC LIMIT 1",
            [$regId, $client])->fetch('assoc') ?: [];

        return [
            'registration_id' => (string)$r['registration_id'],
            'enrollment_id'   => $e['enrollment_id'] ?? null,
            'name'            => trim(($r['student_first_name'] ?? '') . ' ' . ($r['student_last_name'] ?? '')),
            'class_id'        => isset($e['class_id']) ? (int)$e['class_id'] : null,
            'section_id'      => isset($e['section_id']) ? (int)$e['section_id'] : null,
            'class_name'      => trim(($e['class_name'] ?? '') . ' ' . ($e['section_name'] ?? '')),
            'roll_number'     => $e['roll_number'] ?? null,
            'mobile_number'   => $r['mobile_number'] ?? null,
            'email_address'   => $r['email_address'] ?? null,
            'father_name'     => $r['student_father_name'] ?? null,
            'mother_name'     => $r['student_mother_name'] ?? null,
        ];
    }

    /** Registrations a parent account can see: the admission-form mobile, or a guardian given app sign-in. */
    public static function parentRegistrations(string $client, string $user): array
    {
        $last10 = self::parentLast10($client, $user);
        if ($last10 === null) {
            return [];
        }
        // same rule as the portal's child list (StudentApi/getLinkedStudents): the last 10 digits of the
        // admission-form mobile, whatever spaces, dots or dashes it was typed with
        $out = [];
        foreach (self::db()->execute(
            "SELECT DISTINCT r.registration_id, r.mobile_number FROM ssms_student_registration r
               JOIN ssms_student_enrollment e ON e.registration_id = r.registration_id AND e.ssms_client_code = r.ssms_client_code
              WHERE r.ssms_client_code = ? AND COALESCE(e.status,'active') = 'active' AND TRIM(r.mobile_number) LIKE ?",
            [$client, '%' . substr($last10, -1)])->fetchAll('assoc') as $r) {
            if (substr(preg_replace('/\D/', '', (string)$r['mobile_number']), -10) === $last10) {
                $out[] = $r['registration_id'];
            }
        }
        foreach (self::guardianRegistrations($client, $last10) as $reg) {
            $out[] = $reg;
        }

        return array_values(array_unique(array_map('strval', $out)));
    }

    /** Registrations where a guardian with this phone has been given app sign-in. */
    public static function guardianRegistrations(string $client, string $last10): array
    {
        try {
            return array_map('strval', array_column(self::db()->execute(
                "SELECT DISTINCT g.registration_id FROM ssms_student_guardians g
                   JOIN ssms_student_enrollment e ON e.registration_id = g.registration_id AND e.ssms_client_code = g.ssms_client_code
                  WHERE g.ssms_client_code = ? AND g.phone_last10 = ? AND g.app_access = 1 AND g.can_pickup = 1
                    AND COALESCE(g.restriction_note, '') = '' AND COALESCE(e.status,'active') = 'active'",
                [$client, $last10])->fetchAll('assoc'), 'registration_id'));
        } catch (\Throwable $e) {
            return [];   // table not created yet
        }
    }

    /** Active enrollment ids for guardians with app sign-in (used by parent linking elsewhere). */
    public static function guardianEnrollments(string $client, string $mobileOrUser): array
    {
        $last10 = substr(preg_replace('/\D/', '', $mobileOrUser), -10);
        if (strlen($last10) < 6) {
            return [];
        }
        try {
            return array_map('strval', array_column(self::db()->execute(
                "SELECT DISTINCT e.enrollment_id FROM ssms_student_guardians g
                   JOIN ssms_student_enrollment e ON e.registration_id = g.registration_id AND e.ssms_client_code = g.ssms_client_code
                  WHERE g.ssms_client_code = ? AND g.phone_last10 = ? AND g.app_access = 1 AND g.can_pickup = 1
                    AND COALESCE(g.restriction_note, '') = '' AND COALESCE(e.status,'active') = 'active'",
                [$client, $last10])->fetchAll('assoc'), 'enrollment_id'));
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** Is this mobile a guardian with app sign-in for the enrollment? (parent self-registration) */
    public static function isAppGuardian(string $client, string $enrollmentId, string $mobile): bool
    {
        return in_array($enrollmentId, self::guardianEnrollments($client, $mobile), true);
    }

    private static function parentLast10(string $client, string $user): ?string
    {
        $row = self::db()->execute('SELECT mobile_number FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ? LIMIT 1',
            [$user, $client])->fetch('assoc');
        if (!$row) {
            return null;
        }
        $digits = preg_replace('/\D/', '', (string)($row['mobile_number'] ?? ''));
        $last10 = substr(strlen($digits) >= 6 ? $digits : preg_replace('/\D/', '', $user), -10);

        return strlen($last10) >= 6 ? $last10 : null;
    }

    private static function studentRegistrations(string $client, string $enrollmentId): array
    {
        $r = self::db()->execute('SELECT registration_id FROM ssms_student_enrollment WHERE enrollment_id = ? AND ssms_client_code = ? LIMIT 1',
            [$enrollmentId, $client])->fetch('assoc');

        return $r ? [(string)$r['registration_id']] : [];
    }

    // ── Whole record ────────────────────────────────────────────────────────

    public static function record(string $client, array $acc): array
    {
        $reg = $acc['student']['registration_id'];
        $can = $acc['can'];
        $staff = $acc['level'] === 'staff';
        $guardians = self::guardians($client, $reg, $staff);
        $medical = $can['view_medical'] ? self::medical($client, $reg, $can['medical_notes']) : null;
        $stu = $acc['student'];
        if (!$staff) {
            unset($stu['class_id'], $stu['section_id']);
        }

        return [
            'student'    => $stu,
            'level'      => $acc['level'],
            'can'        => $can,
            'guardians'  => $guardians,
            'suggested_guardians' => $staff && !$guardians && $can['edit_guardians'] ? self::suggestions($acc['student']) : [],
            'contacts'   => self::contacts($client, $reg),
            'medical'    => $medical,
            'documents'  => self::documents($client, $reg, $staff),
            'fields'     => self::fieldValues($client, $reg, $staff),
            'alerts'     => self::alerts($guardians, $medical, $staff),
            'options'    => self::options(),
        ];
    }

    public static function options(): array
    {
        return ['relations' => self::RELATIONS, 'doc_types' => self::DOC_TYPES, 'blood_groups' => self::BLOOD_GROUPS,
                'alert_levels' => self::ALERT_LEVELS, 'field_types' => self::FIELD_TYPES, 'max_mb' => (int)(self::MAX_BYTES / 1048576),
                'single_types' => self::SINGLE_TYPES];
    }

    /** Short warnings shown at the top of the record (and as a badge on the profile). */
    private static function alerts(array $guardians, ?array $medical, bool $staff): array
    {
        $out = [];
        if ($medical && in_array($medical['alert_level'], ['serious', 'severe'], true)) {
            $what = $medical['allergies'] ?? null;
            $out[] = ['kind' => 'medical', 'level' => $medical['alert_level'],
                      'text' => ($medical['alert_level'] === 'severe' ? 'Severe medical alert' : 'Medical alert') . ($what ? ': ' . mb_substr($what, 0, 120) : '')];
        }
        if ($staff) {
            foreach ($guardians as $g) {
                if (!$g['can_pickup']) {
                    $out[] = ['kind' => 'pickup', 'level' => 'severe', 'text' => $g['name'] . ' is NOT allowed to collect this student'
                        . ($g['restriction_note'] ? ' – ' . mb_substr((string)$g['restriction_note'], 0, 120) : '')];
                }
            }
        }

        return $out;
    }

    private static function suggestions(array $stu): array
    {
        $out = [];
        $phone = trim((string)($stu['mobile_number'] ?? ''));
        if (trim((string)$stu['father_name']) !== '') {
            $out[] = ['name' => trim((string)$stu['father_name']), 'relation' => 'father', 'phone' => $phone, 'email' => (string)($stu['email_address'] ?? ''), 'is_primary' => true];
        }
        if (trim((string)$stu['mother_name']) !== '') {
            $out[] = ['name' => trim((string)$stu['mother_name']), 'relation' => 'mother', 'phone' => $out ? '' : $phone, 'email' => '', 'is_primary' => !$out];
        }

        return $out;
    }

    // ── Guardians ───────────────────────────────────────────────────────────

    public static function guardians(string $client, string $reg, bool $staff = true): array
    {
        try {   // pick-up-only persons (drivers, one-off …) are kept in Safety, not shown as guardians
            $rows = self::q('SELECT * FROM ssms_student_guardians WHERE ssms_client_code = ? AND registration_id = ? AND COALESCE(pickup_only, 0) = 0 ORDER BY is_primary DESC, sort_order, id',
                [$client, $reg]);
        } catch (\Throwable $e) {   // before the safety update
            $rows = self::q('SELECT * FROM ssms_student_guardians WHERE ssms_client_code = ? AND registration_id = ? ORDER BY is_primary DESC, sort_order, id',
                [$client, $reg]);
        }
        $out = [];
        foreach ($rows as $r) {
            $g = self::castGuardian($r);
            if (!$staff) {
                if (!$g['can_pickup'] || $g['restriction_note']) {
                    continue;   // restricted people are never shown to parents
                }
                unset($g['restriction_note'], $g['created_by']);
            }
            $out[] = $g;
        }

        return $out;
    }

    public static function saveGuardian(string $client, string $reg, array $d, string $by, bool $mayAppAccess, bool $mayProtect = true): array
    {
        $id = (int)($d['id'] ?? 0);
        $old = $id ? self::guardian($client, $id) : null;
        if ($id && (!$old || $old['registration_id'] !== $reg)) {
            throw new \InvalidArgumentException('Guardian not found.');
        }
        if (!$id && count(self::guardians($client, $reg)) >= self::MAX_GUARDIANS) {
            throw new \DomainException('A student can have up to ' . self::MAX_GUARDIANS . ' guardians.');
        }
        $name = self::text($d['name'] ?? '', 150);
        if ($name === '') {
            throw new \InvalidArgumentException('Enter the guardian\'s name.');
        }
        $relation = strtolower(trim((string)($d['relation'] ?? 'guardian')));
        if (!isset(self::RELATIONS[$relation])) {
            $relation = 'other';
        }
        $phone = self::phone($d['phone'] ?? '', 'Phone');
        $email = self::email($d['email'] ?? '');
        $app   = !empty($d['app_access']);
        $oldApp = $old ? $old['app_access'] : false;
        $canPickup = !array_key_exists('can_pickup', $d) || !empty($d['can_pickup']);
        $note = self::text($d['restriction_note'] ?? '', 500);
        $restricted = !$canPickup || $note !== '';
        $wasRestricted = $old && (!$old['can_pickup'] || (string)$old['restriction_note'] !== '');
        if ($wasRestricted && !$restricted && !$mayProtect) {
            throw new \DomainException('Only the owner or an admin can lift a collection restriction.');
        }
        if ($restricted && $app) {
            if ($app !== $oldApp) {
                throw new \DomainException('A guardian who is not allowed to collect the student can\'t be given app sign-in.');
            }
            $app = false;   // restriction added → app sign-in ends
        }
        $oldLast10 = $old && $old['phone'] ? substr(preg_replace('/\D/', '', (string)$old['phone']), -10) : null;
        $newLast10 = $phone ? substr(preg_replace('/\D/', '', $phone), -10) : null;
        // app sign-in follows the phone number, so changing the phone of a guardian with app
        // sign-in is the same as giving it to someone new
        $appChanging = $app !== $oldApp || ($app && $oldApp && $newLast10 !== $oldLast10);
        if ($appChanging && !$mayAppAccess && !(!$app && $restricted)) {
            throw new \DomainException($app && $oldApp
                ? 'This guardian can sign in to the app, so only someone who can manage users can change their mobile number.'
                : 'Only someone who can manage users can turn app sign-in on or off.');
        }
        if ($app && $phone === null) {
            throw new \InvalidArgumentException('Add a mobile number to give this guardian app sign-in.');
        }
        $vals = [
            'name' => $name, 'relation' => $relation, 'phone' => $phone, 'phone_last10' => $phone ? substr(preg_replace('/\D/', '', $phone), -10) : null,
            'email' => $email, 'occupation' => self::text($d['occupation'] ?? '', 100) ?: null, 'address' => self::text($d['address'] ?? '', 300) ?: null,
            'is_primary' => !empty($d['is_primary']) ? 1 : 0, 'lives_with' => !array_key_exists('lives_with', $d) || !empty($d['lives_with']) ? 1 : 0,
            'can_pickup' => $canPickup ? 1 : 0, 'app_access' => $app ? 1 : 0,
            'gets_notices' => !array_key_exists('gets_notices', $d) || !empty($d['gets_notices']) ? 1 : 0,
            'restriction_note' => $note !== '' ? $note : null,
            'sort_order' => (int)($d['sort_order'] ?? ($old['sort_order'] ?? 0)),
        ];
        $now = AccountSecurity::now();
        if ($vals['is_primary']) {
            self::db()->execute('UPDATE ssms_student_guardians SET is_primary = 0 WHERE ssms_client_code = ? AND registration_id = ?', [$client, $reg]);
        }
        if ($old) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($vals)));
            self::db()->execute("UPDATE ssms_student_guardians SET $set, modified = ? WHERE id = ? AND ssms_client_code = ?",
                array_merge(array_values($vals), [$now, $id, $client]));
        } else {
            $cols = array_keys($vals);
            self::db()->execute('INSERT INTO ssms_student_guardians (ssms_client_code, registration_id, ' . implode(', ', $cols) . ', created_by, created, modified)
                VALUES (?, ?, ' . implode(', ', array_fill(0, count($cols), '?')) . ', ?, ?, ?)',
                array_merge([$client, $reg], array_values($vals), [mb_substr($by, 0, 100), $now, $now]));
            $id = self::lastId();
        }
        $new = self::guardian($client, $id);

        return ['guardian' => $new, 'changes' => self::diff($old, $new, ['restriction_note']), 'app_changed' => $appChanging,
                'restriction_changed' => $restricted !== (bool)$wasRestricted];
    }

    public static function deleteGuardian(string $client, string $reg, int $id): array
    {
        $g = self::guardian($client, $id);
        if (!$g || $g['registration_id'] !== $reg) {
            throw new \InvalidArgumentException('Guardian not found.');
        }
        self::db()->execute('DELETE FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ?', [$id, $client]);

        return $g;
    }

    private static function guardian(string $client, int $id): ?array
    {
        $r = self::db()->execute('SELECT * FROM ssms_student_guardians WHERE id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc');
        if ($r && (int)($r['pickup_only'] ?? 0) === 1) {
            return null;   // a pick-up-only person: managed in Safety
        }

        return $r ? self::castGuardian($r) : null;
    }

    private static function castGuardian(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'registration_id' => (string)$r['registration_id'], 'name' => (string)$r['name'],
            'relation' => (string)$r['relation'], 'relation_label' => self::RELATIONS[$r['relation']] ?? ucfirst((string)$r['relation']),
            'phone' => $r['phone'], 'email' => $r['email'], 'occupation' => $r['occupation'], 'address' => $r['address'],
            'is_primary' => (int)$r['is_primary'] === 1, 'lives_with' => (int)$r['lives_with'] === 1, 'can_pickup' => (int)$r['can_pickup'] === 1,
            'app_access' => (int)$r['app_access'] === 1, 'gets_notices' => (int)$r['gets_notices'] === 1,
            'restriction_note' => $r['restriction_note'], 'sort_order' => (int)$r['sort_order'], 'created_by' => $r['created_by'],
        ];
    }

    // ── Emergency contacts ──────────────────────────────────────────────────

    public static function contacts(string $client, string $reg): array
    {
        return array_map(fn($r) => [
            'id' => (int)$r['id'], 'name' => $r['name'], 'relation' => $r['relation'], 'phone' => $r['phone'], 'alt_phone' => $r['alt_phone'],
            'notes' => $r['notes'], 'priority' => (int)$r['priority'], 'updated_by_role' => $r['updated_by_role'], 'modified' => $r['modified'],
        ], self::q('SELECT * FROM ssms_student_emergency_contacts WHERE ssms_client_code = ? AND registration_id = ? ORDER BY priority, id', [$client, $reg]));
    }

    public static function saveContact(string $client, string $reg, array $d, string $by, string $byRole): array
    {
        $id = (int)($d['id'] ?? 0);
        $old = null;
        if ($id) {
            $old = self::db()->execute('SELECT * FROM ssms_student_emergency_contacts WHERE id = ? AND ssms_client_code = ? AND registration_id = ?',
                [$id, $client, $reg])->fetch('assoc') ?: null;
            if (!$old) {
                throw new \InvalidArgumentException('Contact not found.');
            }
        } elseif (count(self::contacts($client, $reg)) >= self::MAX_CONTACTS) {
            throw new \DomainException('A student can have up to ' . self::MAX_CONTACTS . ' emergency contacts.');
        }
        $name = self::text($d['name'] ?? '', 150);
        if ($name === '') {
            throw new \InvalidArgumentException('Enter the contact\'s name.');
        }
        $phone = self::phone($d['phone'] ?? '', 'Phone');
        if ($phone === null) {
            throw new \InvalidArgumentException('Enter a phone number for the emergency contact.');
        }
        $vals = ['name' => $name, 'relation' => self::text($d['relation'] ?? '', 40) ?: null, 'phone' => $phone,
                 'alt_phone' => self::phone($d['alt_phone'] ?? '', 'Other phone'), 'notes' => self::text($d['notes'] ?? '', 300) ?: null,
                 'priority' => max(1, min(99, (int)($d['priority'] ?? ($old['priority'] ?? (count(self::contacts($client, $reg)) + 1))))),
                 'updated_by' => mb_substr($by, 0, 100), 'updated_by_role' => mb_substr($byRole, 0, 20)];
        $now = AccountSecurity::now();
        if ($old) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($vals)));
            self::db()->execute("UPDATE ssms_student_emergency_contacts SET $set, modified = ? WHERE id = ?", array_merge(array_values($vals), [$now, $id]));
        } else {
            $cols = array_keys($vals);
            self::db()->execute('INSERT INTO ssms_student_emergency_contacts (ssms_client_code, registration_id, ' . implode(', ', $cols) . ', created, modified)
                VALUES (?, ?, ' . implode(', ', array_fill(0, count($cols), '?')) . ', ?, ?)', array_merge([$client, $reg], array_values($vals), [$now, $now]));
        }

        return self::contacts($client, $reg);
    }

    public static function deleteContact(string $client, string $reg, int $id): array
    {
        $r = self::db()->execute('SELECT * FROM ssms_student_emergency_contacts WHERE id = ? AND ssms_client_code = ? AND registration_id = ?',
            [$id, $client, $reg])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Contact not found.');
        }
        self::db()->execute('DELETE FROM ssms_student_emergency_contacts WHERE id = ?', [$id]);

        return $r;
    }

    // ── Medical & allergies ─────────────────────────────────────────────────

    public static function medical(string $client, string $reg, bool $withNotes = true): array
    {
        $r = self::db()->execute('SELECT * FROM ssms_student_medical WHERE ssms_client_code = ? AND registration_id = ?', [$client, $reg])->fetch('assoc');
        $out = ['blood_group' => null, 'alert_level' => 'none', 'has_allergies' => false, 'modified' => null, 'updated_by_role' => null];
        foreach (self::MEDICAL_FIELDS as $f) {
            $out[$f] = null;
        }
        $regBlood = self::registrationBlood($client, $reg);
        if (!$r) {
            $out['blood_group'] = $regBlood ?: null;

            return $out;
        }
        // the admission form's blood group (student profile) is the one source of truth when the column exists
        $out['blood_group'] = $regBlood !== false ? ($regBlood ?: null) : $r['blood_group'];
        $out['alert_level'] = $r['alert_level'] ?: 'none';
        $out['has_allergies'] = (int)$r['has_allergies'] === 1;
        $out['modified'] = $r['modified'];
        $out['updated_by_role'] = $r['updated_by_role'];
        foreach (self::MEDICAL_FIELDS as $f) {
            if (!$withNotes && in_array($f, ['notes', 'insurance', 'doctor'], true)) {
                continue;
            }
            $v = $r['enc_' . $f] ?? null;
            $out[$f] = $v ? AccountSecurity::decrypt((string)$v, 'student-medical') : null;
        }

        return $out;
    }

    public static function saveMedical(string $client, string $reg, array $d, string $by, string $byRole): array
    {
        $old = self::medical($client, $reg);
        $blood = self::bloodGroup($d['blood_group'] ?? ($old['blood_group'] ?? ''));
        if ($blood !== '' && !in_array($blood, self::BLOOD_GROUPS, true)) {
            if (!array_key_exists('blood_group', $d)) {
                $blood = '';   // an old free-text value we can't read – leave the admission form as it is
            } else {
            throw new \InvalidArgumentException('Choose a blood group from the list.');
            }
        }
        $level = strtolower(trim((string)($d['alert_level'] ?? ($old['alert_level'] ?? 'none'))));
        if (!in_array($level, self::ALERT_LEVELS, true)) {
            throw new \InvalidArgumentException('Choose an alert level from the list.');
        }
        $vals = [];
        foreach (self::MEDICAL_FIELDS as $f) {
            $vals[$f] = array_key_exists($f, $d) ? self::text($d[$f], 2000) : (string)($old[$f] ?? '');
        }
        $enc = [];
        foreach ($vals as $f => $v) {
            $enc['enc_' . $f] = $v !== '' ? AccountSecurity::encrypt($v, 'student-medical') : null;
        }
        $row = array_merge(['blood_group' => $blood ?: null, 'alert_level' => $level, 'has_allergies' => $vals['allergies'] !== '' ? 1 : 0], $enc,
            ['updated_by' => mb_substr($by, 0, 100), 'updated_by_role' => mb_substr($byRole, 0, 20), 'modified' => AccountSecurity::now()]);
        $exists = self::db()->execute('SELECT 1 FROM ssms_student_medical WHERE ssms_client_code = ? AND registration_id = ?', [$client, $reg])->fetch('assoc');
        if ($exists) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($row)));
            self::db()->execute("UPDATE ssms_student_medical SET $set WHERE ssms_client_code = ? AND registration_id = ?", array_merge(array_values($row), [$client, $reg]));
        } else {
            $cols = array_keys($row);
            self::db()->execute('INSERT INTO ssms_student_medical (ssms_client_code, registration_id, ' . implode(', ', $cols) . ')
                VALUES (?, ?, ' . implode(', ', array_fill(0, count($cols), '?')) . ')', array_merge([$client, $reg], array_values($row)));
        }
        if (self::registrationBlood($client, $reg) !== false && ($blood !== '' || array_key_exists('blood_group', $d))) {
            self::db()->execute('UPDATE ssms_student_registration SET blood_group = ? WHERE registration_id = ? AND ssms_client_code = ?',
                [$blood !== '' ? $blood : null, $reg, $client]);
        }
        $new = self::medical($client, $reg);
        // the audit log only records WHICH health details changed, never the details themselves
        $changed = [];
        foreach (array_merge(['blood_group', 'alert_level'], self::MEDICAL_FIELDS) as $f) {
            if ((string)($old[$f] ?? '') !== (string)($new[$f] ?? '')) {
                $changed[] = $f;
            }
        }

        return ['medical' => $new, 'changed' => $changed];
    }

    /** Health alerts for a class (staff: trips, sports day, cover teachers). */
    public static function medicalList(string $client, ?int $classId, ?int $sectionId, array $scope = []): array
    {
        $sql = "SELECT e.enrollment_id, e.registration_id, e.roll_number, c.class_name, s.section_name, r.student_first_name, r.student_last_name,
                       m.blood_group, m.alert_level, m.has_allergies, m.enc_allergies, m.enc_conditions, m.enc_medications, m.enc_dietary
                  FROM ssms_student_medical m
                  JOIN ssms_student_enrollment e ON e.registration_id = m.registration_id AND e.ssms_client_code = m.ssms_client_code
                       AND COALESCE(e.status,'active') = 'active'
                  JOIN ssms_student_registration r ON r.registration_id = m.registration_id AND r.ssms_client_code = m.ssms_client_code
             LEFT JOIN ssms_classes c ON c.class_id = e.class_id
             LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                 WHERE m.ssms_client_code = ? AND (m.alert_level <> 'none' OR m.has_allergies = 1 OR m.enc_conditions IS NOT NULL
                       OR m.enc_medications IS NOT NULL OR m.enc_dietary IS NOT NULL)";
        $p = [$client];
        if ($classId) {
            $sql .= ' AND e.class_id = ?';
            $p[] = $classId;
        }
        if ($sectionId) {
            $sql .= ' AND e.section_id = ?';
            $p[] = $sectionId;
        }
        if ($scope) {
            $or = [];
            foreach ($scope as $sc) {
                if ($sc['section_id']) {
                    $or[] = '(e.class_id = ? AND e.section_id = ?)';
                    $p[] = (int)$sc['class_id'];
                    $p[] = (int)$sc['section_id'];
                } else {
                    $or[] = 'e.class_id = ?';
                    $p[] = (int)$sc['class_id'];
                }
            }
            $sql .= ' AND (' . implode(' OR ', $or) . ')';
        }
        $sql .= " ORDER BY FIELD(m.alert_level,'severe','serious','info','none'), c.class_name, s.section_name, r.student_first_name LIMIT 1000";
        $dec = fn($v) => $v ? AccountSecurity::decrypt((string)$v, 'student-medical') : null;
        $seen = [];
        $rows = array_values(array_filter(self::q($sql, $p), function ($r) use (&$seen) {
            if (isset($seen[$r['registration_id']])) {
                return false;   // more than one active enrollment – show the student once
            }

            return $seen[$r['registration_id']] = true;
        }));

        return array_map(fn($r) => [
            'enrollment_id' => $r['enrollment_id'], 'registration_id' => $r['registration_id'], 'roll_number' => $r['roll_number'],
            'name' => trim($r['student_first_name'] . ' ' . $r['student_last_name']), 'class_name' => trim(($r['class_name'] ?? '') . ' ' . ($r['section_name'] ?? '')),
            'blood_group' => $r['blood_group'], 'alert_level' => $r['alert_level'], 'allergies' => $dec($r['enc_allergies']),
            'conditions' => $dec($r['enc_conditions']), 'medications' => $dec($r['enc_medications']), 'dietary' => $dec($r['enc_dietary']),
        ], $rows);
    }

    /** "B Positive", "b +ve", "O pos" → "B+", "O+" (unknown text is returned as typed). */
    public static function bloodGroup($v): string
    {
        $t = strtoupper(trim((string)$v));
        $t = preg_replace(['/\s*(POSITIVE|POS|\+VE|\(\+\))\s*$/', '/\s*(NEGATIVE|NEG|-VE|\(-\))\s*$/'], ['+', '-'], $t);
        $t = str_replace(' ', '', (string)$t);

        return mb_substr($t, 0, 10);
    }

    /** Blood group on the admission form; false when that column doesn't exist. */
    private static function registrationBlood(string $client, string $reg)
    {
        try {
            $r = self::db()->execute('SELECT blood_group FROM ssms_student_registration WHERE registration_id = ? AND ssms_client_code = ?', [$reg, $client])->fetch('assoc');

            return (string)($r['blood_group'] ?? '');
        } catch (\Throwable $e) {
            return false;
        }
    }

    // ── Documents ───────────────────────────────────────────────────────────

    public static function documents(string $client, string $reg, bool $staff = true): array
    {
        $out = [];
        foreach (self::q('SELECT * FROM ssms_student_documents WHERE ssms_client_code = ? AND registration_id = ? ORDER BY created DESC, id DESC', [$client, $reg]) as $r) {
            $doc = self::castDoc($r);
            if (!$staff && (!$doc['visible_to_parent'] || in_array($doc['doc_type'], self::STAFF_ONLY_DOCS, true))) {
                continue;
            }
            $out[] = $doc;
        }
        if ($staff) {
            foreach (self::legacyDocs($client, $reg) as $l) {
                $out[] = $l;
            }
        }

        return $out;
    }

    /**
     * Store an uploaded file. $tmpPath is where the controller moved the upload; it is
     * removed if the file is not accepted.
     */
    public static function addDocument(string $client, string $reg, array $d, string $tmpPath, string $origName, string $by, string $byRole, bool $staff): array
    {
        try {
            if (!is_file($tmpPath)) {
                throw new \InvalidArgumentException('Choose a file to upload.');
            }
            $size = (int)filesize($tmpPath);
            if ($size <= 0) {
                throw new \InvalidArgumentException('The file is empty.');
            }
            if ($size > self::MAX_BYTES) {
                throw new \InvalidArgumentException('The file is too big. The limit is ' . (int)(self::MAX_BYTES / 1048576) . ' MB.');
            }
            $mime = self::mimeOf($tmpPath);
            if (!isset(self::MIMES[$mime])) {
                \Cake\Log\Log::warning('StudentRecord upload refused: detected type "' . $mime . '" for "' . basename($origName) . '" (' . $size . ' bytes), first bytes '
                    . bin2hex((string)file_get_contents($tmpPath, false, null, 0, 12)));
                throw new \InvalidArgumentException('This file type can\'t be stored' . ($mime !== '' ? ' (' . $mime . ')' : '')
                    . '. Upload a PDF or a photo (JPG, PNG, WebP or HEIC).');
            }
            $meta = self::docMeta($d, $staff, null);
            // the copies this upload replaces (parents only replace copies they can see)
            $old = [];
            if (in_array($meta['doc_type'], self::SINGLE_TYPES, true)) {
                $old = self::q('SELECT id, stored_name FROM ssms_student_documents WHERE ssms_client_code = ? AND registration_id = ? AND doc_type = ?'
                    . ($staff ? '' : ' AND visible_to_parent = 1'), [$client, $reg, $meta['doc_type']]);
            }
            $n = (int)(self::db()->execute('SELECT COUNT(*) n FROM ssms_student_documents WHERE ssms_client_code = ? AND registration_id = ?', [$client, $reg])->fetch('assoc')['n'] ?? 0);
            if ($n - count($old) >= self::MAX_DOCS) {
                throw new \DomainException('This student already has ' . self::MAX_DOCS . ' documents. Delete old ones first.');
            }
            $dir = self::docDir($client, $reg);
            $stored = self::storedName($client, $reg, $meta['doc_type'], self::MIMES[$mime], $dir);
            if (!@rename($tmpPath, $dir . $stored)) {
                if (!@copy($tmpPath, $dir . $stored)) {
                    throw new \RuntimeException('Could not store the file.');
                }
                @unlink($tmpPath);
            }
            @chmod($dir . $stored, 0600);
            $name = self::cleanFileName($origName, self::MIMES[$mime]);
            $now = AccountSecurity::now();
            self::db()->execute(
                'INSERT INTO ssms_student_documents (ssms_client_code, registration_id, doc_type, title, doc_number, expires_on, file_name, stored_name, mime,
                     size_bytes, sha256, visible_to_parent, verified, verified_by, verified_at, uploaded_by, uploaded_by_role, created, modified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$client, $reg, $meta['doc_type'], $meta['title'], $meta['doc_number'], $meta['expires_on'], $name, $stored, $mime, $size,
                 hash_file('sha256', $dir . $stored), $meta['visible_to_parent'], $staff ? 1 : 0, $staff ? mb_substr($by, 0, 100) : null, $staff ? $now : null,
                 mb_substr($by, 0, 100), mb_substr($byRole, 0, 20), $now, $now]
            );
            $id = self::lastId();
            // the new copy is safely stored – now remove the copies it replaces
            foreach ($old as $o) {
                $p = self::findFile($client, $reg, (string)$o['stored_name']);
                self::db()->execute('DELETE FROM ssms_student_documents WHERE id = ? AND ssms_client_code = ?', [(int)$o['id'], $client]);
                if ($p !== null) {
                    @unlink($p);
                }
            }
            if ($old) {
                // take the plain name (<reg>_<type>.<ext>) now that it is free
                $plain = self::storedName($client, $reg, $meta['doc_type'], self::MIMES[$mime], $dir);
                if ($plain !== $stored && strlen($plain) < strlen($stored) && @rename($dir . $stored, $dir . $plain)) {
                    self::db()->execute('UPDATE ssms_student_documents SET stored_name = ? WHERE id = ?', [$plain, $id]);
                }
            }

            return self::doc($client, $id) + ['replaced' => count($old)];
        } finally {
            if (is_file($tmpPath)) {
                @unlink($tmpPath);
            }
        }
    }

    public static function updateDocument(string $client, string $reg, int $id, array $d, string $by, bool $mayProtect = true): array
    {
        $old = self::doc($client, $id);
        if (!$old || $old['registration_id'] !== $reg) {
            throw new \InvalidArgumentException('Document not found.');
        }
        $newType = strtolower(trim((string)($d['doc_type'] ?? $old['doc_type'])));
        if (in_array($old['doc_type'], self::STAFF_ONLY_DOCS, true) && $newType !== $old['doc_type'] && !$mayProtect) {
            throw new \DomainException('Only the owner or an admin can change a custody document.');
        }
        $meta = self::docMeta($d + $old, true, $old);
        $verified = array_key_exists('verified', $d) ? (!empty($d['verified']) ? 1 : 0) : ($old['verified'] ? 1 : 0);
        $now = AccountSecurity::now();
        if ($meta['doc_type'] !== $old['doc_type']) {
            // keep the <reg>_<type> naming when the type changes
            $row = self::db()->execute('SELECT stored_name FROM ssms_student_documents WHERE id = ?', [$id])->fetch('assoc');
            $path = self::findFile($client, $reg, (string)$row['stored_name']);
            if ($path !== null) {
                $dir = self::docDir($client, $reg);
                $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION)) ?: 'pdf';
                $newName = self::storedName($client, $reg, $meta['doc_type'], $ext, $dir);
                if (@rename($path, $dir . $newName)) {
                    self::db()->execute('UPDATE ssms_student_documents SET stored_name = ? WHERE id = ?', [$newName, $id]);
                }
            }
        }
        self::db()->execute(
            'UPDATE ssms_student_documents SET doc_type = ?, title = ?, doc_number = ?, expires_on = ?, visible_to_parent = ?, verified = ?,
                    verified_by = ?, verified_at = ?, modified = ? WHERE id = ? AND ssms_client_code = ?',
            [$meta['doc_type'], $meta['title'], $meta['doc_number'], $meta['expires_on'], $meta['visible_to_parent'], $verified,
             $verified ? ($old['verified'] ? $old['verified_by'] : mb_substr($by, 0, 100)) : null,
             $verified ? ($old['verified'] ? $old['verified_at'] : $now) : null, $now, $id, $client]
        );

        return self::doc($client, $id);
    }

    /** Parents may delete their own uploads until the school has checked them. */
    public static function deleteDocument(string $client, string $reg, int $id, ?string $onlyOwnBy = null): array
    {
        $doc = self::doc($client, $id);
        if (!$doc || $doc['registration_id'] !== $reg) {
            throw new \InvalidArgumentException('Document not found.');
        }
        if ($onlyOwnBy !== null && ($doc['uploaded_by'] !== $onlyOwnBy || $doc['verified'])) {
            throw new \DomainException('You can only remove a document you uploaded, before the school has checked it.');
        }
        $row = self::db()->execute('SELECT stored_name FROM ssms_student_documents WHERE id = ?', [$id])->fetch('assoc');
        self::db()->execute('DELETE FROM ssms_student_documents WHERE id = ? AND ssms_client_code = ?', [$id, $client]);
        $path = self::findFile($client, $reg, (string)$row['stored_name']);
        if ($path !== null) {
            @unlink($path);
        }

        return $doc;
    }

    /** → [path, download name, mime] after the caller has checked access to the student. */
    public static function documentFile(string $client, string $reg, string $id, bool $staff): array
    {
        if (str_starts_with($id, 'legacy:')) {
            if (!$staff) {
                throw new \DomainException('Not allowed.');
            }
            foreach (self::legacyDocs($client, $reg, true) as $l) {
                if ($l['id'] === $id) {
                    return [$l['_path'], $l['file_name'], self::mimeOf($l['_path']) ?: 'application/octet-stream'];
                }
            }
            throw new \InvalidArgumentException('Document not found.');
        }
        $r = self::db()->execute('SELECT * FROM ssms_student_documents WHERE id = ? AND ssms_client_code = ? AND registration_id = ?',
            [(int)$id, $client, $reg])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Document not found.');
        }
        if (!$staff && ((int)$r['visible_to_parent'] !== 1 || in_array($r['doc_type'], self::STAFF_ONLY_DOCS, true))) {
            throw new \DomainException('Not allowed.');
        }
        $path = self::findFile($client, $reg, (string)$r['stored_name']);
        if ($path === null) {
            throw new \DomainException('The file is missing on the server. Please upload it again.');
        }

        return [$path, (string)$r['file_name'], (string)$r['mime']];
    }

    /** Documents (passports, visas, …) that expire within $days – for the office. */
    public static function expiring(string $client, int $days = 60): array
    {
        $to = date('Y-m-d', AccountSecurity::time() + $days * 86400);

        return array_map(fn($r) => self::castDoc($r) + ['student_name' => trim($r['student_first_name'] . ' ' . $r['student_last_name'])],
            self::q("SELECT d.*, r.student_first_name, r.student_last_name FROM ssms_student_documents d
                       JOIN ssms_student_registration r ON r.registration_id = d.registration_id AND r.ssms_client_code = d.ssms_client_code
                       WHERE d.ssms_client_code = ? AND d.expires_on IS NOT NULL AND d.expires_on <= ?
                         AND EXISTS (SELECT 1 FROM ssms_student_enrollment e WHERE e.registration_id = d.registration_id
                                     AND e.ssms_client_code = d.ssms_client_code AND COALESCE(e.status,'active') = 'active')
                       ORDER BY d.expires_on LIMIT 500", [$client, $to]));
    }

    private static function doc(string $client, int $id): ?array
    {
        $r = self::db()->execute('SELECT * FROM ssms_student_documents WHERE id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc');

        return $r ? self::castDoc($r) : null;
    }

    private static function castDoc(array $r): array
    {
        $exp = $r['expires_on'] ?: null;
        $today = date('Y-m-d', AccountSecurity::time());

        return [
            'id' => (int)$r['id'], 'registration_id' => (string)$r['registration_id'], 'doc_type' => $r['doc_type'],
            'type_label' => self::DOC_TYPES[$r['doc_type']] ?? 'Other', 'title' => $r['title'], 'doc_number' => $r['doc_number'],
            'expires_on' => $exp, 'expired' => $exp !== null && $exp < $today,
            'expires_soon' => $exp !== null && $exp >= $today && $exp <= date('Y-m-d', AccountSecurity::time() + 60 * 86400),
            'file_name' => $r['file_name'], 'mime' => $r['mime'], 'size_bytes' => (int)$r['size_bytes'],
            'visible_to_parent' => (int)$r['visible_to_parent'] === 1, 'verified' => (int)$r['verified'] === 1,
            'verified_by' => $r['verified_by'], 'verified_at' => $r['verified_at'],
            'uploaded_by' => $r['uploaded_by'], 'uploaded_by_role' => $r['uploaded_by_role'], 'created' => $r['created'], 'legacy' => false,
        ];
    }

    private static function docMeta(array $d, bool $staff, ?array $old): array
    {
        $type = strtolower(trim((string)($d['doc_type'] ?? 'other')));
        if (!isset(self::DOC_TYPES[$type])) {
            $type = 'other';
        }
        if (!$staff && in_array($type, self::STAFF_ONLY_DOCS, true)) {
            $type = 'other';
        }
        $title = self::text($d['title'] ?? '', 150);
        if ($title === '') {
            $title = self::DOC_TYPES[$type];
        }
        $exp = trim((string)($d['expires_on'] ?? ''));
        if ($exp !== '') {
            $dt = \DateTime::createFromFormat('Y-m-d', $exp);
            if (!$dt || $dt->format('Y-m-d') !== $exp) {
                throw new \InvalidArgumentException('Enter the expiry date as YYYY-MM-DD.');
            }
        }
        $visible = $staff ? (!array_key_exists('visible_to_parent', $d) || !empty($d['visible_to_parent'])) : true;
        if (in_array($type, self::STAFF_ONLY_DOCS, true)) {
            $visible = false;
        }

        return ['doc_type' => $type, 'title' => $title, 'doc_number' => self::text($d['doc_number'] ?? '', 60) ?: null,
                'expires_on' => $exp ?: null, 'visible_to_parent' => $visible ? 1 : 0];
    }

    /** Files uploaded with the old admission form (webroot/clients/<code>/Students/<reg>/). */
    private static function legacyDocs(string $client, string $reg, bool $withPath = false): array
    {
        $r = self::db()->execute('SELECT dob_cert, prev_marksheet, prev_slc FROM ssms_student_registration WHERE registration_id = ? AND ssms_client_code = ?',
            [$reg, $client])->fetch('assoc');
        if (!$r) {
            return [];
        }
        try {
            $root = self::webRoot();
        } catch (\Throwable $e) {
            return [];
        }
        $safeClient = preg_replace('/[^A-Za-z0-9_-]/', '', $client);
        $safeReg = preg_replace('/[^A-Za-z0-9_-]/', '', $reg);
        $dirs = [$root . '/clients/' . $safeClient . '/Students/' . $safeReg . '/', $root . '/clients/' . $safeClient . '/' . $safeReg . '/'];
        $out = [];
        foreach (['dob_cert' => ['birth_certificate', 'Birth certificate (admission form)'], 'prev_marksheet' => ['previous_report', 'Previous marksheet (admission form)'],
                  'prev_slc' => ['transfer_certificate', 'Leaving certificate (admission form)']] as $col => [$type, $title]) {
            $file = basename(trim((string)($r[$col] ?? '')));
            if ($file === '' || $file === '.' || $file === '..') {
                continue;
            }
            foreach ($dirs as $dir) {
                if (is_file($dir . $file)) {
                    $doc = ['id' => 'legacy:' . $col, 'registration_id' => $reg, 'doc_type' => $type, 'type_label' => self::DOC_TYPES[$type], 'title' => $title,
                            'doc_number' => null, 'expires_on' => null, 'expired' => false, 'expires_soon' => false, 'file_name' => $file,
                            'mime' => null, 'size_bytes' => (int)filesize($dir . $file), 'visible_to_parent' => false, 'verified' => true,
                            'verified_by' => null, 'verified_at' => null, 'uploaded_by' => null, 'uploaded_by_role' => null, 'created' => null, 'legacy' => true];
                    if ($withPath) {
                        $doc['_path'] = $dir . $file;
                    }
                    $out[] = $doc;
                    break;
                }
            }
        }

        return $out;
    }

    /** The site's public folder (webroot / DOCUMENT_ROOT). */
    public static function webRoot(): string
    {
        if (self::$legacyRoot !== null) {
            return rtrim((string)self::$legacyRoot, '/\\');
        }
        // Same folder the admission form and photos use: DOCUMENT_ROOT/clients/… (e.g. C:\xampp\htdocs\clients\TWF\Students\).
        // Command-line jobs have no DOCUMENT_ROOT: use the app folder if it holds "clients", else webroot.
        $doc = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
        if ($doc !== '' && is_dir($doc)) {
            return $doc;
        }
        if (defined('ROOT') && is_dir(rtrim(ROOT, '/\\') . DIRECTORY_SEPARATOR . 'clients')) {
            return rtrim(ROOT, '/\\');
        }
        if (defined('WWW_ROOT')) {
            return rtrim(WWW_ROOT, '/\\');
        }
        throw new \RuntimeException('The web folder is not known.');
    }

    /** Folder used before 21 Oct 2026 (outside the web folder). Only read to find older uploads. */
    public static function storageRoot(): string
    {
        $root = self::$storageRoot ?? ((defined('ROOT') ? ROOT : dirname(__DIR__, 2)) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'student_documents');

        return rtrim($root, '/\\') . DIRECTORY_SEPARATOR;
    }

    /** A private place (tmp, not the web folder) the controller moves an upload to before it is checked. */
    public static function incomingPath(): string
    {
        $dir = (defined('TMP') ? TMP : sys_get_temp_dir() . DIRECTORY_SEPARATOR) . 'student_doc_incoming' . DIRECTORY_SEPARATOR;
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }

        return $dir . bin2hex(random_bytes(12)) . '.part';
    }

    /**
     * The school's existing student folder: <webroot>/clients/<code>/Students/<registration id>/
     * (the same folder as the photo and the admission-form files). Record files get random
     * rec_… names and the folder's .htaccess refuses direct links to them, so they can only
     * be opened through the app after a permission check. Photos in the folder keep working.
     */
    private static function docDir(string $client, string $reg): string
    {
        $dir = self::webRoot() . DIRECTORY_SEPARATOR . 'clients' . DIRECTORY_SEPARATOR . self::safeName($client) . DIRECTORY_SEPARATOR
             . 'Students' . DIRECTORY_SEPARATOR . self::safeName($reg) . DIRECTORY_SEPARATOR;
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create the student\'s document folder.');
        }
        self::protectFolder($dir, $reg);

        return $dir;
    }

    /** <reg>_<type>.<ext>, or <reg>_<type>_2.<ext> … when that name is taken. */
    public static function storedName(string $client, string $reg, string $type, string $ext, string $dir): string
    {
        $base = self::safeName($reg) . '_' . (self::FILE_CODES[$type] ?? 'Document');
        for ($n = 1; $n < 1000; $n++) {
            $name = $base . ($n > 1 ? '_' . $n : '') . '.' . $ext;
            $taken = is_file($dir . $name) || self::db()->execute(
                'SELECT 1 FROM ssms_student_documents WHERE ssms_client_code = ? AND registration_id = ? AND stored_name = ? LIMIT 1',
                [$client, $reg, $name])->fetch('assoc');
            if (!$taken) {
                return $name;
            }
        }
        throw new \RuntimeException('Too many documents of this type.');
    }

    /** The folder's .htaccess block that blocks direct links to record files (kept up to date). */
    private static function protectFolder(string $dir, string $reg): void
    {
        $file = $dir . '.htaccess';
        $existing = is_file($file) ? (string)@file_get_contents($file) : '';
        $codes = implode('|', array_values(self::FILE_CODES));
        $block = self::HTACCESS_MARK . "\n"
            . "<FilesMatch \"^(rec_[0-9a-f]{32}|" . preg_quote(self::safeName($reg), '/') . "_(" . $codes . ")(_[0-9]+)?)\\.[A-Za-z0-9]+$\">\n"
            . "  <IfModule mod_authz_core.c>\n    Require all denied\n  </IfModule>\n"
            . "  <IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n  </IfModule>\n"
            . "</FilesMatch>\n" . self::HTACCESS_END . "\n";
        if (str_contains($existing, $block)) {
            return;
        }
        // remove an older version of our block (first version had no end marker)
        $start = strpos($existing, self::HTACCESS_MARK);
        if ($start !== false) {
            $endMark = strpos($existing, self::HTACCESS_END, $start);
            $end = $endMark !== false ? $endMark + strlen(self::HTACCESS_END) : strpos($existing, '</FilesMatch>', $start);
            $end = $end === false ? strlen($existing) : ($endMark !== false ? $end : $end + strlen('</FilesMatch>'));
            $existing = substr($existing, 0, $start) . ltrim(substr($existing, $end));
        }
        $existing = trim($existing);
        if (@file_put_contents($file, ($existing !== '' ? $existing . "\n\n" : '') . $block) === false) {
            throw new \RuntimeException('Could not protect the student\'s document folder.');
        }
    }

    /** Where a stored file is: the student folder, or the older private folder. */
    private static function findFile(string $client, string $reg, string $stored): ?string
    {
        $stored = basename($stored);
        if ($stored === '' || $stored === '.' || $stored === '..') {
            return null;
        }
        $new = self::webRoot() . DIRECTORY_SEPARATOR . 'clients' . DIRECTORY_SEPARATOR . self::safeName($client) . DIRECTORY_SEPARATOR
             . 'Students' . DIRECTORY_SEPARATOR . self::safeName($reg) . DIRECTORY_SEPARATOR . $stored;
        if (is_file($new)) {
            return $new;
        }
        $old = self::storageRoot() . preg_replace('/[^A-Za-z0-9_-]/', '_', $client) . DIRECTORY_SEPARATOR
             . preg_replace('/[^A-Za-z0-9_-]/', '_', $reg) . DIRECTORY_SEPARATOR . $stored;

        return is_file($old) ? $old : null;
    }

    private static function safeName(string $v): string
    {
        $v = preg_replace('/[^A-Za-z0-9_-]/', '', $v);
        if ($v === '') {
            throw new \InvalidArgumentException('Student not found.');
        }

        return $v;
    }

    private static function mimeOf(string $path): string
    {
        $mime = '';
        if (function_exists('finfo_open')) {
            $f = finfo_open(FILEINFO_MIME_TYPE);
            $mime = (string)finfo_file($f, $path);
            finfo_close($f);
        } elseif (function_exists('mime_content_type')) {
            $mime = (string)mime_content_type($path);
        }
        if ($mime === 'image/jpg') {
            $mime = 'image/jpeg';
        }
        if (!isset(self::MIMES[$mime])) {   // finfo unsure (or missing): trust only well-known file signatures
            $head = (string)file_get_contents($path, false, null, 0, 12);
            if (str_starts_with($head, '%PDF')) {
                $mime = 'application/pdf';
            } elseif (str_starts_with($head, "\xFF\xD8\xFF")) {
                $mime = 'image/jpeg';
            } elseif (str_starts_with($head, "\x89PNG")) {
                $mime = 'image/png';
            } elseif (substr($head, 0, 4) === 'RIFF' && substr($head, 8, 4) === 'WEBP') {
                $mime = 'image/webp';
            } elseif (substr($head, 4, 4) === 'ftyp' && in_array(substr($head, 8, 4), ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'], true)) {
                $mime = 'image/heic';
            }
        }

        return in_array($mime, ['image/jpg', 'image/pjpeg'], true) ? 'image/jpeg' : $mime;
    }

    private static function cleanFileName(string $name, string $ext): string
    {
        $base = pathinfo(basename($name), PATHINFO_FILENAME);
        $base = trim(preg_replace('/[^\p{L}\p{N} ._()-]+/u', '_', $base), ' ._');

        return mb_substr($base !== '' ? $base : 'document', 0, 120) . '.' . $ext;
    }

    // ── Custom fields ───────────────────────────────────────────────────────

    public static function fieldDefs(string $client, bool $activeOnly = true): array
    {
        $sql = "SELECT * FROM ssms_custom_fields WHERE ssms_client_code = ? AND entity = 'student'" . ($activeOnly ? ' AND active = 1' : '') . ' ORDER BY sort_order, id';

        return array_map([self::class, 'castField'], self::q($sql, [$client]));
    }

    public static function saveFieldDef(string $client, array $d, string $by): array
    {
        $id = (int)($d['id'] ?? 0);
        $old = null;
        if ($id) {
            $old = self::db()->execute("SELECT * FROM ssms_custom_fields WHERE id = ? AND ssms_client_code = ? AND entity = 'student'", [$id, $client])->fetch('assoc') ?: null;
            if (!$old) {
                throw new \InvalidArgumentException('Field not found.');
            }
        } elseif (count(self::fieldDefs($client, false)) >= self::MAX_FIELDS) {
            throw new \DomainException('A school can have up to ' . self::MAX_FIELDS . ' custom fields.');
        }
        $label = self::text($d['label'] ?? '', 100);
        if ($label === '') {
            throw new \InvalidArgumentException('Give the field a name.');
        }
        foreach (self::fieldDefs($client, false) as $f) {
            if ($f['id'] !== $id && mb_strtolower($f['label']) === mb_strtolower($label)) {
                throw new \DomainException('There is already a field called "' . $f['label'] . '".');
            }
        }
        $type = strtolower(trim((string)($d['field_type'] ?? ($old['field_type'] ?? 'text'))));
        if (!in_array($type, self::FIELD_TYPES, true)) {
            throw new \InvalidArgumentException('Choose a field type from the list.');
        }
        if ($old && $old['field_type'] !== $type && self::fieldHasValues($client, $id)) {
            throw new \DomainException('This field already has answers, so its type can\'t be changed. Add a new field instead.');
        }
        $options = null;
        if ($type === 'select') {
            $opts = is_array($d['options'] ?? null) ? $d['options'] : preg_split('/\r\n|\n|,/', (string)($d['options'] ?? ''));
            $opts = array_values(array_unique(array_filter(array_map(fn($o) => self::text($o, 80), $opts), fn($o) => $o !== '')));
            if (count($opts) < 2) {
                throw new \InvalidArgumentException('A list field needs at least two choices.');
            }
            if (count($opts) > 50) {
                throw new \InvalidArgumentException('A list field can have up to 50 choices.');
            }
            $options = json_encode($opts, JSON_UNESCAPED_UNICODE);
        }
        $visible = !empty($d['visible_to_parent']);
        $vals = ['label' => $label, 'field_type' => $type, 'options' => $options, 'help_text' => self::text($d['help_text'] ?? '', 200) ?: null,
                 'required' => !empty($d['required']) ? 1 : 0, 'visible_to_parent' => $visible ? 1 : 0,
                 'parent_can_edit' => $visible && !empty($d['parent_can_edit']) ? 1 : 0,
                 'sort_order' => (int)($d['sort_order'] ?? ($old['sort_order'] ?? count(self::fieldDefs($client, false)) + 1)),
                 'active' => array_key_exists('active', $d) ? (!empty($d['active']) ? 1 : 0) : ($old ? (int)$old['active'] : 1)];
        $now = AccountSecurity::now();
        if ($old) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($vals)));
            self::db()->execute("UPDATE ssms_custom_fields SET $set, modified = ? WHERE id = ?", array_merge(array_values($vals), [$now, $id]));
        } else {
            $cols = array_keys($vals);
            self::db()->execute("INSERT INTO ssms_custom_fields (ssms_client_code, entity, " . implode(', ', $cols) . ", created_by, created, modified)
                VALUES (?, 'student', " . implode(', ', array_fill(0, count($cols), '?')) . ', ?, ?, ?)',
                array_merge([$client], array_values($vals), [mb_substr($by, 0, 100), $now, $now]));
            $id = self::lastId();
        }
        $row = self::db()->execute('SELECT * FROM ssms_custom_fields WHERE id = ?', [$id])->fetch('assoc');

        return ['field' => self::castField($row), 'is_new' => !$old];
    }

    /** Active fields with this student's answers (parents: only the ones marked visible). */
    public static function fieldValues(string $client, string $reg, bool $staff = true): array
    {
        $vals = [];
        foreach (self::q('SELECT field_id, value, modified FROM ssms_custom_field_values WHERE ssms_client_code = ? AND record_id = ?', [$client, $reg]) as $v) {
            $vals[(int)$v['field_id']] = $v;
        }
        $out = [];
        foreach (self::fieldDefs($client) as $f) {
            if (!$staff && !$f['visible_to_parent']) {
                continue;
            }
            $f['value'] = $vals[$f['id']]['value'] ?? null;
            $out[] = $f;
        }

        return $out;
    }

    /** $values: {field_id: value}. Parents can only change fields marked "parent can edit". */
    public static function saveFieldValues(string $client, string $reg, array $values, string $by, bool $staff): array
    {
        $defs = [];
        foreach (self::fieldDefs($client) as $f) {
            $defs[$f['id']] = $f;
        }
        $current = [];
        foreach (self::fieldValues($client, $reg) as $f) {
            $current[$f['id']] = $f['value'];
        }
        $changed = [];
        $errors = [];
        $clean = [];
        foreach ($values as $fid => $raw) {
            $fid = (int)$fid;
            $f = $defs[$fid] ?? null;
            if (!$f) {
                continue;   // retired or unknown field – ignore
            }
            if (!$staff && !$f['parent_can_edit']) {
                continue;
            }
            try {
                $clean[$fid] = self::fieldValue($f, $raw);
            } catch (\InvalidArgumentException $e) {
                $errors[] = $e->getMessage();
            }
        }
        // a required field can't be cleared (fields not sent are left as they are)
        foreach ($clean as $fid => $v) {
            if ($defs[$fid]['required'] && (string)$v === '') {
                $errors[] = $defs[$fid]['label'] . ' is required.';
            }
        }
        if ($errors) {
            throw new \InvalidArgumentException(implode("\n", array_unique($errors)));
        }
        $now = AccountSecurity::now();
        foreach ($clean as $fid => $v) {
            if ((string)($current[$fid] ?? '') === (string)$v) {
                continue;
            }
            $changed[] = $defs[$fid]['label'];
            if ($v === '') {
                self::db()->execute('DELETE FROM ssms_custom_field_values WHERE field_id = ? AND record_id = ? AND ssms_client_code = ?', [$fid, $reg, $client]);
                continue;
            }
            $exists = self::db()->execute('SELECT 1 FROM ssms_custom_field_values WHERE field_id = ? AND record_id = ?', [$fid, $reg])->fetch('assoc');
            if ($exists) {
                self::db()->execute('UPDATE ssms_custom_field_values SET value = ?, updated_by = ?, modified = ? WHERE field_id = ? AND record_id = ?',
                    [$v, mb_substr($by, 0, 100), $now, $fid, $reg]);
            } else {
                self::db()->execute('INSERT INTO ssms_custom_field_values (ssms_client_code, field_id, record_id, value, updated_by, modified) VALUES (?, ?, ?, ?, ?, ?)',
                    [$client, $fid, $reg, $v, mb_substr($by, 0, 100), $now]);
            }
        }

        return ['fields' => self::fieldValues($client, $reg, $staff), 'changed' => $changed];
    }

    private static function fieldValue(array $f, $raw): string
    {
        if (is_bool($raw)) {
            $raw = $raw ? '1' : '0';
        }
        $v = is_scalar($raw) || $raw === null ? trim((string)$raw) : '';
        if ($v === '') {
            return '';
        }
        $label = $f['label'];
        switch ($f['field_type']) {
            case 'number':
                if (!is_numeric($v)) {
                    throw new \InvalidArgumentException("$label must be a number.");
                }

                return mb_substr($v, 0, 30);
            case 'date':
                $dt = \DateTime::createFromFormat('Y-m-d', $v);
                if (!$dt || $dt->format('Y-m-d') !== $v) {
                    throw new \InvalidArgumentException("$label must be a date (YYYY-MM-DD).");
                }

                return $v;
            case 'select':
                if (!in_array($v, $f['options'], true)) {
                    throw new \InvalidArgumentException("Choose $label from the list.");
                }

                return $v;
            case 'yes_no':
                $l = strtolower($v);
                if (in_array($l, ['1', 'yes', 'true', 'y'], true)) {
                    return '1';
                }
                if (in_array($l, ['0', 'no', 'false', 'n'], true)) {
                    return '0';
                }
                throw new \InvalidArgumentException("$label must be yes or no.");
            case 'email':
                if (!filter_var($v, FILTER_VALIDATE_EMAIL)) {
                    throw new \InvalidArgumentException("$label must be an e-mail address.");
                }

                return mb_substr($v, 0, 150);
            case 'phone':
                $digits = preg_replace('/\D/', '', $v);
                if (strlen($digits) < 6 || strlen($digits) > 15 || !preg_match('/^[+\d\s().-]+$/', $v)) {
                    throw new \InvalidArgumentException("$label must be a phone number.");
                }

                return mb_substr($v, 0, 30);
            case 'long_text':
                return self::text($v, 2000);
            default:
                return self::text($v, 255);
        }
    }

    private static function fieldHasValues(string $client, int $id): bool
    {
        return (bool)self::db()->execute('SELECT 1 FROM ssms_custom_field_values WHERE field_id = ? AND ssms_client_code = ? LIMIT 1', [$id, $client])->fetch('assoc');
    }

    private static function castField(array $r): array
    {
        $opts = $r['options'] ? json_decode((string)$r['options'], true) : [];

        return ['id' => (int)$r['id'], 'label' => $r['label'], 'field_type' => $r['field_type'], 'options' => is_array($opts) ? $opts : [],
                'help_text' => $r['help_text'], 'required' => (int)$r['required'] === 1, 'visible_to_parent' => (int)$r['visible_to_parent'] === 1,
                'parent_can_edit' => (int)$r['parent_can_edit'] === 1, 'sort_order' => (int)$r['sort_order'], 'active' => (int)$r['active'] === 1];
    }

    // ── Privacy: copy and delete (used by PrivacyRequests) ───────────────────

    /**
     * The record as it goes into a family's data copy: the same view the parent (or the
     * student) gets in the app – no restricted guardians, restriction notes, custody papers
     * or staff-only fields; students don't get medical notes, doctor or insurance.
     */
    public static function exportFor(string $client, string $reg, string $level = 'parent'): array
    {
        $out = [];
        try {
            $out['guardians'] = array_map(fn($g) => array_diff_key($g, array_flip(['id', 'registration_id', 'sort_order', 'created_by', 'restriction_note'])),
                self::guardians($client, $reg, false));
            $out['emergency_contacts'] = array_map(fn($c) => array_diff_key($c, array_flip(['id'])), self::contacts($client, $reg));
            $m = self::medical($client, $reg, $level !== 'student');
            $out['medical'] = $m['modified'] ? [$m] : [];
            $out['documents'] = array_map(fn($d) => ['type' => $d['type_label'], 'title' => $d['title'], 'file' => $d['file_name'],
                'expires_on' => $d['expires_on'], 'uploaded' => $d['created']], self::documents($client, $reg, false));
            $out['custom_fields'] = array_values(array_map(fn($f) => ['field' => $f['label'], 'value' => $f['value']],
                array_filter(self::fieldValues($client, $reg, false), fn($f) => $f['value'] !== null)));
        } catch (\Throwable $e) {
            // tables not created yet
        }

        return array_filter($out, fn($v) => $v !== []);
    }

    /** Remove everything this feature holds about a student (deletion requests). */
    public static function eraseFor(string $client, string $reg): array
    {
        $done = [];
        try {
            foreach (self::q('SELECT stored_name FROM ssms_student_documents WHERE ssms_client_code = ? AND registration_id = ?', [$client, $reg]) as $d) {
                $p = self::findFile($client, $reg, (string)$d['stored_name']);
                if ($p !== null) {
                    @unlink($p);
                }
            }
            // the student folder itself stays (photo, admission files are handled by the profile clean-up)
            $old = self::storageRoot() . preg_replace('/[^A-Za-z0-9_-]/', '_', $client) . DIRECTORY_SEPARATOR . preg_replace('/[^A-Za-z0-9_-]/', '_', $reg);
            if (is_dir($old)) {
                @rmdir($old);
            }
            foreach ([
                ['DELETE FROM ssms_student_documents WHERE ssms_client_code = ? AND registration_id = ?', 'uploaded documents'],
                ['DELETE FROM ssms_student_medical WHERE ssms_client_code = ? AND registration_id = ?', 'medical details'],
                ['DELETE FROM ssms_student_guardians WHERE ssms_client_code = ? AND registration_id = ?', 'guardians'],
                ['DELETE FROM ssms_student_emergency_contacts WHERE ssms_client_code = ? AND registration_id = ?', 'emergency contacts'],
                ['DELETE FROM ssms_custom_field_values WHERE ssms_client_code = ? AND record_id = ?', 'extra fields'],
            ] as [$sql, $label]) {
                self::db()->execute($sql, [$client, $reg]);
                $done[] = $label;
            }
        } catch (\Throwable $e) {
            // tables not created yet
        }

        return $done;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static function diff(?array $old, array $new, array $hide = []): array
    {
        $out = [];
        foreach ($new as $k => $v) {
            if (in_array($k, ['id', 'registration_id', 'relation_label', 'created_by', 'sort_order'], true)) {
                continue;
            }
            $o = $old[$k] ?? null;
            if ($old === null || $o !== $v) {
                $out[$k] = in_array($k, $hide, true) ? '(changed)' : ['from' => $old === null ? null : $o, 'to' => $v];
            }
        }

        return $out;
    }

    private static function text($v, int $max): string
    {
        $v = is_scalar($v) ? (string)$v : '';
        $v = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '');

        return mb_substr($v, 0, $max);
    }

    private static function phone($v, string $label): ?string
    {
        $v = self::text($v, 30);
        if ($v === '') {
            return null;
        }
        $digits = preg_replace('/\D/', '', $v);
        if (strlen($digits) < 6 || strlen($digits) > 15 || !preg_match('/^[+\d\s().-]+$/', $v)) {
            throw new \InvalidArgumentException("$label: enter a valid phone number.");
        }

        return $v;
    }

    private static function email($v): ?string
    {
        $v = self::text($v, 150);
        if ($v === '') {
            return null;
        }
        if (!filter_var($v, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('Enter a valid e-mail address.');
        }

        return $v;
    }

    private static function lastId(): int
    {
        return (int)(self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'] ?? 0);
    }

    private static function q(string $sql, array $p): array
    {
        return self::db()->execute($sql, $p)->fetchAll('assoc');
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
