<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * Consent records (GDPR / COPPA / FERPA / India DPDP).
 *
 * The school decides what it asks (consent types, each with versioned text). Parents answer
 * once per child, staff for themselves. Every answer is a NEW row (never overwritten), with the
 * text version, how it was given (app / web / paper entered by the office) and who entered it.
 * Changing a type's text bumps its version, so everyone is asked again.
 *
 * Tables: ssms_consent_types, ssms_consents
 */
class Consents
{
    public const AUDIENCES = ['parent', 'staff'];

    public const DEFAULT_TYPES = [
        ['key' => 'terms', 'audience' => 'parent', 'required' => 1, 'title' => 'Terms & privacy notice',
         'body' => "The school keeps your child's details (name, class, contact details, attendance, marks, fees, leave notes and photos you or the school upload) to run the school and to keep you informed. Only school staff and you can see them. You can ask for a copy, a correction or deletion at any time from Privacy in the app."],
        ['key' => 'gallery_photos', 'audience' => 'parent', 'required' => 0, 'title' => 'Photos in the school gallery',
         'body' => "Photos of school events that include your child may be shown in the app's gallery. Only parents and staff of this school can see them."],
        ['key' => 'social_media', 'audience' => 'parent', 'required' => 0, 'title' => 'Photos on public social media',
         'body' => "The school may post event photos that include your child on its public website or social media pages."],
        ['key' => 'directory', 'audience' => 'parent', 'required' => 0, 'title' => 'Name in the class directory',
         'body' => "Other parents in your child's class can see your child's name and class (\"directory information\")."],
        ['key' => 'newsletter', 'audience' => 'parent', 'required' => 0, 'title' => 'School news by e-mail',
         'body' => "Receive newsletters and event announcements by e-mail."],
        ['key' => 'staff_terms', 'audience' => 'staff', 'required' => 1, 'title' => 'Staff privacy notice',
         'body' => "The school keeps your details (contact details, attendance, leave, payroll and documents) to manage your employment. Only authorised staff can see them."],
        ['key' => 'staff_location', 'audience' => 'staff', 'required' => 0, 'title' => 'Location at check-in',
         'body' => "When the school uses location for staff check-in, your phone's location is checked and saved only at the moment you check in."],
    ];

    // ── Types ───────────────────────────────────────────────────────────────

    public static function types(string $client, bool $activeOnly = false): array
    {
        self::seed($client);
        $rows = self::db()->execute(
            'SELECT * FROM ssms_consent_types WHERE ssms_client_code = ?' . ($activeOnly ? ' AND active = 1' : '') . ' ORDER BY audience, required DESC, id',
            [$client]
        )->fetchAll('assoc');

        return array_map([self::class, 'castType'], $rows);
    }

    private static function seed(string $client): void
    {
        $n = (int)self::db()->execute('SELECT COUNT(*) n FROM ssms_consent_types WHERE ssms_client_code = ?', [$client])->fetch('assoc')['n'];
        if ($n > 0) {
            return;
        }
        foreach (self::DEFAULT_TYPES as $t) {
            self::db()->execute(
                'INSERT INTO ssms_consent_types (ssms_client_code, type_key, title, body, audience, required, version, active, modified)
                 VALUES (?,?,?,?,?,?,1,1,?)',
                [$client, $t['key'], $t['title'], $t['body'], $t['audience'], $t['required'], AccountSecurity::now()]
            );
        }
    }

    /** Admin: add / edit a type. Changing the title or text makes a new version (everyone is asked again). */
    public static function saveType(string $client, ?int $id, array $d, string $by): array
    {
        self::seed($client);
        $title = trim((string)($d['title'] ?? ''));
        $body  = trim((string)($d['body'] ?? ''));
        if ($title === '' || mb_strlen($title) > 120) {
            throw new \InvalidArgumentException('Give it a short title (up to 120 characters).');
        }
        if ($body === '') {
            throw new \InvalidArgumentException('Write what people are agreeing to.');
        }
        $aud = in_array($d['audience'] ?? '', self::AUDIENCES, true) ? $d['audience'] : 'parent';
        if ($id) {
            $cur = self::type($client, $id);
            $ver = $cur['version'] + (($cur['title'] !== $title || $cur['body'] !== $body) ? 1 : 0);
            self::db()->execute(
                'UPDATE ssms_consent_types SET title = ?, body = ?, required = ?, active = ?, version = ?, modified = ?, updated_by = ?
                  WHERE id = ? AND ssms_client_code = ?',
                [$title, $body, !empty($d['required']) ? 1 : 0, !isset($d['active']) || !empty($d['active']) ? 1 : 0, $ver,
                 AccountSecurity::now(), mb_substr($by, 0, 100), $id, $client]
            );
        } else {
            $key = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($title)), '_') . '_' . substr(bin2hex(random_bytes(2)), 0, 3);
            self::db()->execute(
                'INSERT INTO ssms_consent_types (ssms_client_code, type_key, title, body, audience, required, version, active, modified, updated_by)
                 VALUES (?,?,?,?,?,?,1,1,?,?)',
                [$client, mb_substr($key, 0, 60), $title, $body, $aud, !empty($d['required']) ? 1 : 0, AccountSecurity::now(), mb_substr($by, 0, 100)]
            );
            $id = (int)self::db()->execute('SELECT LAST_INSERT_ID() id')->fetch('assoc')['id'];
        }

        return self::type($client, $id);
    }

    public static function type(string $client, int $id): array
    {
        $r = self::db()->execute('SELECT * FROM ssms_consent_types WHERE id = ? AND ssms_client_code = ?', [$id, $client])->fetch('assoc');
        if (!$r) {
            throw new \InvalidArgumentException('Consent type not found.');
        }

        return self::castType($r);
    }

    // ── Who answers for whom ──────────────────────────────────────────────

    /** → [ {subject_type, subject_id, name, audience} ] */
    public static function subjects(string $client, string $user, string $role, ?string $jwtEnrollment = null): array
    {
        $role = strtolower($role);
        if ($role === 'parent') {
            $out = [];
            foreach (StudentLeave::myEnrollmentIds($client, 'parent', $user, null) as $eid) {
                $s = StudentLeave::enrollment($client, $eid);
                $out[] = ['subject_type' => 'student', 'subject_id' => $eid, 'name' => $s['student_name'] ?? $eid,
                          'detail' => trim(($s['class_name'] ?? '') . ' ' . ($s['section_name'] ?? '')), 'audience' => 'parent'];
            }

            return $out;
        }
        if ($role === 'student' || $role === 'owner') {
            return [];   // parents answer for their children; the owner is the school itself
        }
        $u = self::db()->execute('SELECT ssms_user_firstname, ssms_user_lastname FROM sawera_ssms_users WHERE ssms_user_name = ? LIMIT 1', [$user])->fetch('assoc');

        return [['subject_type' => 'staff', 'subject_id' => $user,
                 'name' => trim(($u['ssms_user_firstname'] ?? '') . ' ' . ($u['ssms_user_lastname'] ?? '')) ?: $user, 'detail' => '', 'audience' => 'staff']];
    }

    /** Latest answer per (subject, type) */
    private static function latest(string $client, array $subjectIds): array
    {
        if (!$subjectIds) {
            return [];
        }
        $in   = implode(',', array_fill(0, count($subjectIds), '?'));
        $rows = self::db()->execute(
            "SELECT c.* FROM ssms_consents c
               JOIN (SELECT subject_id, type_id, MAX(id) mx FROM ssms_consents WHERE ssms_client_code = ? AND subject_id IN ($in) GROUP BY subject_id, type_id) l
                 ON l.mx = c.id",
            array_merge([$client], array_values($subjectIds))
        )->fetchAll('assoc');
        $out = [];
        foreach ($rows as $r) {
            $out[$r['subject_id'] . '|' . $r['type_id']] = $r;
        }

        return $out;
    }

    /** What still needs an answer (new person, or the text changed since). */
    public static function pending(string $client, string $user, string $role, ?string $jwtEnrollment = null): array
    {
        if (!AccountSecurity::settings($client)['consent_enabled']) {
            return [];
        }
        $subjects = self::subjects($client, $user, $role, $jwtEnrollment);
        if (!$subjects) {
            return [];
        }
        $types  = self::types($client, true);
        $latest = self::latest($client, array_column($subjects, 'subject_id'));
        $out    = [];
        foreach ($subjects as $s) {
            $items = [];
            foreach ($types as $t) {
                if ($t['audience'] !== $s['audience']) {
                    continue;
                }
                $l = $latest[$s['subject_id'] . '|' . $t['id']] ?? null;
                if (!$l || (int)$l['version'] < $t['version']) {
                    $items[] = $t + ['previous' => $l ? (int)$l['granted'] === 1 : null];
                }
            }
            if ($items) {
                $out[] = $s + ['types' => $items];
            }
        }

        return $out;
    }

    /**
     * Save answers. $answers = [{subject_id, type_id, granted}]; $meta = method (app|web|paper), ip, app_version, recorded_by
     * Returns how many were saved.
     */
    public static function answer(string $client, string $user, string $role, array $answers, array $meta = [], bool $asOffice = false): int
    {
        $allowed = $asOffice ? null : array_column(self::subjects($client, $user, $role), null, 'subject_id');
        $types   = array_column(self::types($client), null, 'id');
        $n       = 0;
        foreach ($answers as $a) {
            $sid = trim((string)($a['subject_id'] ?? ''));
            $tid = (int)($a['type_id'] ?? 0);
            $t   = $types[$tid] ?? null;
            if (!$t || $sid === '' || ($allowed !== null && !isset($allowed[$sid]))) {
                continue;
            }
            if ($allowed !== null && $allowed[$sid]['audience'] !== $t['audience']) {
                continue;
            }
            $granted = !empty($a['granted']);
            if ($t['required'] && !$granted && !$asOffice) {
                throw new \DomainException('"' . $t['title'] . '" is needed to use the app. If you don\'t agree, please contact the school.');
            }
            self::db()->execute(
                'INSERT INTO ssms_consents (ssms_client_code, type_id, version, subject_type, subject_id, given_by, granted, method,
                        recorded_by, note, ip, app_version, created)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$client, $tid, $t['version'], $t['audience'] === 'staff' ? 'staff' : 'student', mb_substr($sid, 0, 64),
                 mb_substr($asOffice ? (string)($a['given_by'] ?? 'paper form') : $user, 0, 100), $granted ? 1 : 0,
                 in_array($meta['method'] ?? 'app', ['app', 'web', 'paper'], true) ? ($meta['method'] ?? 'app') : 'app',
                 $asOffice ? mb_substr($user, 0, 100) : null, mb_substr((string)($a['note'] ?? ''), 0, 255) ?: null,
                 mb_substr((string)($meta['ip'] ?? ''), 0, 45), mb_substr((string)($meta['app_version'] ?? ''), 0, 30), AccountSecurity::now()]
            );
            $n++;
        }

        return $n;
    }

    /** Current choices + history for the signed-in person (Privacy screen). */
    public static function mine(string $client, string $user, string $role): array
    {
        $subjects = self::subjects($client, $user, $role);
        $types    = self::types($client, true);
        $ids      = array_column($subjects, 'subject_id');
        $latest   = self::latest($client, $ids);
        $out      = [];
        foreach ($subjects as $s) {
            $items = [];
            foreach ($types as $t) {
                if ($t['audience'] !== $s['audience']) {
                    continue;
                }
                $l = $latest[$s['subject_id'] . '|' . $t['id']] ?? null;
                $items[] = $t + [
                    'granted'  => $l ? (int)$l['granted'] === 1 : null,
                    'answered' => $l['created'] ?? null,
                    'outdated' => $l && (int)$l['version'] < $t['version'],
                ];
            }
            $out[] = $s + ['types' => $items];
        }

        return $out;
    }

    public static function history(string $client, string $subjectId): array
    {
        return self::db()->execute(
            'SELECT c.id, c.version, c.granted, c.method, c.given_by, c.recorded_by, c.note, c.created, t.title
               FROM ssms_consents c JOIN ssms_consent_types t ON t.id = c.type_id
              WHERE c.ssms_client_code = ? AND c.subject_id = ? ORDER BY c.id DESC LIMIT 200',
            [$client, $subjectId]
        )->fetchAll('assoc');
    }

    /**
     * Report for one type: yes / no / not answered, per student (classId optional).
     * $scope = teacher's classes ([] = all; null = none).
     */
    public static function report(string $client, int $typeId, ?int $classId = null, ?int $sectionId = null, ?array $scope = []): array
    {
        $t = self::type($client, $typeId);
        if ($t['audience'] === 'staff') {
            $people = array_map(fn($r) => ['subject_id' => $r['ssms_user_name'],
                'name' => trim($r['ssms_user_firstname'] . ' ' . $r['ssms_user_lastname']) ?: $r['ssms_user_name'], 'class' => $r['ssms_user_role']],
                self::db()->execute("SELECT ssms_user_name, ssms_user_firstname, ssms_user_lastname, ssms_user_role FROM sawera_ssms_users
                    WHERE ssms_client_code = ? AND LOWER(ssms_user_role) NOT IN ('parent','student') AND LOWER(COALESCE(ssms_user_status,'')) = 'active'",
                    [$client])->fetchAll('assoc'));
        } else {
            if ($scope === null) {
                return ['type' => $t, 'yes' => [], 'no' => [], 'unanswered' => [], 'outdated' => []];
            }
            $w = ["e.ssms_client_code = ?", "COALESCE(e.status,'active') = 'active'"];
            $p = [$client];
            if ($classId) {
                $w[] = 'e.class_id = ?';
                $p[] = $classId;
            }
            if ($sectionId) {
                $w[] = 'e.section_id = ?';
                $p[] = $sectionId;
            }
            if ($scope) {
                $or = [];
                foreach ($scope as $sc) {
                    $or[] = $sc['section_id'] ? '(e.class_id = ? AND e.section_id = ?)' : '(e.class_id = ?)';
                    $p[]  = $sc['class_id'];
                    if ($sc['section_id']) {
                        $p[] = $sc['section_id'];
                    }
                }
                $w[] = '(' . implode(' OR ', $or) . ')';
            }
            $people = array_map(fn($r) => ['subject_id' => (string)$r['enrollment_id'], 'name' => $r['student_name'],
                'class' => trim(($r['class_name'] ?? '') . ' ' . ($r['section_name'] ?? ''))],
                self::db()->execute(
                    "SELECT e.enrollment_id, TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) student_name,
                            c.class_name, s.section_name
                       FROM ssms_student_enrollment e
                       JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                  LEFT JOIN ssms_classes c ON c.class_id = e.class_id
                  LEFT JOIN ssms_sections s ON s.section_id = e.section_id
                      WHERE " . implode(' AND ', $w) . ' ORDER BY student_name LIMIT 3000', $p
                )->fetchAll('assoc'));
        }
        $latest = self::latest($client, array_column($people, 'subject_id'));
        $out    = ['type' => $t, 'yes' => [], 'no' => [], 'unanswered' => [], 'outdated' => []];
        foreach ($people as $pp) {
            $l = $latest[$pp['subject_id'] . '|' . $typeId] ?? null;
            if (!$l) {
                $out['unanswered'][] = $pp;
                continue;
            }
            $pp['since'] = substr((string)$l['created'], 0, 10);
            $out[(int)$l['granted'] === 1 ? 'yes' : 'no'][] = $pp;
            if ((int)$l['version'] < $t['version']) {
                $out['outdated'][] = $pp;
            }
        }

        return $out;
    }

    /** COPPA: under-13 student logins wait for a parent's "Terms" consent (when the school uses parent consent). */
    public static function studentBlocked(string $client, string $enrollmentId): ?string
    {
        try {
            if (AccountSecurity::settings($client)['coppa_mode'] !== 'parent') {
                return null;
            }
            $r = self::db()->execute(
                'SELECT r.student_dob FROM ssms_student_enrollment e JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                  WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1', [$enrollmentId, $client]
            )->fetch('assoc');
            $dob = $r['student_dob'] ?? null;
            if (!$dob || strtotime((string)$dob) === false || strtotime((string)$dob) < strtotime('-13 years', AccountSecurity::time())) {
                return null;   // 13 or older, or no birth date on file
            }
            $terms = self::db()->execute("SELECT id FROM ssms_consent_types WHERE ssms_client_code = ? AND type_key = 'terms' LIMIT 1", [$client])->fetch('assoc');
            if (!$terms) {
                return null;
            }
            $l = self::latest($client, [$enrollmentId])[$enrollmentId . '|' . $terms['id']] ?? null;

            return $l && (int)$l['granted'] === 1 ? null
                : 'A parent needs to accept the school\'s terms in the parent app before this student account can be used.';
        } catch (\Throwable $e) {
            return null;
        }
    }

    private static function castType(array $r): array
    {
        return ['id' => (int)$r['id'], 'key' => $r['type_key'], 'title' => $r['title'], 'body' => $r['body'], 'audience' => $r['audience'],
                'required' => (int)$r['required'] === 1, 'version' => (int)$r['version'], 'active' => (int)$r['active'] === 1,
                'modified' => $r['modified'] ?? null];
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
