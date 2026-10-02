<?php
/**
 * Controllers/CertificateApiController.php
 * Returns student + school data needed to generate any of the 4 school certificates
 * on the React Native side (Transfer, Bonafide, Character, Conduct).
 *
 * ── Routes (add inside the JWT-protected scope in config/routes.php) ──────────
 *   $builder->get('/CertificateApi/getCertificateData', ['controller'=>'CertificateApi','action'=>'getCertificateData']);
 *
 * ── AppController.php — add 'CertificateApi' to the allowedControllers array ──
 * ─────────────────────────────────────────────────────────────────────────────
 */
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

class CertificateApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->autoRender = false;
        $this->response   = $this->response->withType('application/json');
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private function db(): \Cake\Database\Connection
    {
        return \Cake\Datasource\ConnectionManager::get('default');
    }

    private function getClientCode(): string
    {
        return trim(
            ($this->request->getAttribute('jwt_client_code') ?: null)
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? ''
        );
    }

    private function jsonOk(array $extra = []): void
    {
        $this->response = $this->response
            ->withStringBody(json_encode(array_merge(['status' => true], $extra)));
    }

    private function jsonError(int $code, string $msg): void
    {
        $this->response = $this->response
            ->withStatus($code)
            ->withStringBody(json_encode(['status' => false, 'message' => $msg]));
    }

    // =========================================================================
    // GET /CertificateApi/getCertificateData?enrollment_id=123
    // Returns student info + school info needed to render any certificate type.
    // =========================================================================
    public function getCertificateData(): void
    {
        $this->request->allowMethod(['get']);

        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $enrollmentId = trim((string)($this->request->getQuery('enrollment_id') ?? ''));
        if (!$enrollmentId) { $this->jsonError(422, 'enrollment_id is required.'); return; }

        $db = $this->db();

        // ── Student row ───────────────────────────────────────────────────────
        $student = $db->execute("
            SELECT
                e.enrollment_id,
                e.roll_number,
                CONCAT_WS(' ',
                    NULLIF(TRIM(r.student_first_name), ''),
                    NULLIF(TRIM(r.student_last_name),  '')
                )                                   AS student_name,
                r.admission_number,
                r.student_father_name               AS father_name,
                r.student_mother_name               AS mother_name,
                r.student_dob                       AS dob,
                r.student_gender                    AS gender,
                r.blood_group,
                r.mobile_number,
                r.admission_date                    AS admission_date,
                CONCAT_WS(', ',
                    NULLIF(TRIM(r.student_c_address_line_1), ''),
                    NULLIF(TRIM(r.student_c_address_line_2), ''),
                    NULLIF(TRIM(r.student_c_address_city),   ''),
                    NULLIF(TRIM(r.student_c_address_state),  ''),
                    NULLIF(TRIM(r.student_c_address_zip),    '')
                )                                   AS address,
                c.class_name,
                sec.section_name,
                s.session_name
            FROM  ssms_student_enrollment e
            JOIN  ssms_student_registration r   ON r.registration_id = e.registration_id
            JOIN  ssms_classes              c   ON c.class_id        = e.class_id
            JOIN  ssms_sessions             s   ON s.session_id      = e.session_id
            JOIN  ssms_sections             sec ON sec.section_id    = e.section_id
            WHERE e.enrollment_id  = ?
              AND e.ssms_client_code = ?
            LIMIT 1
        ", [$enrollmentId, $clientCode])->fetchAssoc();

        if (!$student) {
            $this->jsonError(404, 'Student enrollment not found.'); return;
        }

        // ── School row ────────────────────────────────────────────────────────
        $school = $db->execute("
            SELECT
                c.ssms_client_header_text           AS school_name,
                c.ssms_client_name                  AS principal_name,
                CONCAT_WS(', ',
                    NULLIF(c.ssms_client_address, ''),
                    NULLIF(c.ssms_client_city,    ''),
                    NULLIF(c.ssms_client_state,   '')
                )                                   AS school_address,
                c.ssms_client_phone                 AS school_phone,
                c.ssms_client_email                 AS school_email,
                c.logo_name,
                COALESCE(ss.principal_signature, '') AS principal_signature
            FROM ssms_clients c
            LEFT JOIN ssms_school_settings ss ON ss.client_code = c.ssms_client_code
            WHERE c.ssms_client_code = ?
            LIMIT 1
        ", [$clientCode])->fetchAssoc();

        // Normalise date fields
        $fmtDate = function ($val): string {
            if (empty($val)) return '';
            $str = is_object($val) ? $val->format('Y-m-d') : substr((string)$val, 0, 10);
            return $str;
        };

        // ── Base64-encode logo + signature server-side ────────────────────────
        // expo-print WebView cannot load remote URLs, so we embed the images
        // as data URIs. Reading from disk is more reliable than client-side fetch.
        $baseDir = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '', '/\\') . '/';

        $imgToBase64 = function (string $path): ?string {
            if (!file_exists($path) || !is_readable($path)) return null;
            $ext  = strtolower(pathinfo($path, PATHINFO_EXTENSION));
            $mime = match($ext) {
                'png'  => 'image/png',
                'gif'  => 'image/gif',
                'webp' => 'image/webp',
                default => 'image/jpeg',
            };
            $data = file_get_contents($path);
            return ($data !== false) ? 'data:' . $mime . ';base64,' . base64_encode($data) : null;
        };

        // ── Resolve logo file path ────────────────────────────────────────────
        // logo_name may be empty for older clients whose logo was uploaded before
        // the DB column was introduced. Fall back to {clientCode}.jpg / .png.
        $logoName = trim((string)($school['logo_name'] ?? ''));
        $logoB64  = null;
        if ($logoName !== '') {
            $logoB64 = $imgToBase64($baseDir . 'clients/' . $clientCode . '/' . $logoName);
        }
        if ($logoB64 === null) {
            // Auto-detect: try png then jpg (savePhoto always uses one of these)
            foreach (['png', 'jpg', 'jpeg'] as $ext) {
                $guess = $baseDir . 'clients/' . $clientCode . '/' . $clientCode . '.' . $ext;
                $logoB64 = $imgToBase64($guess);
                if ($logoB64 !== null) break;
            }
        }
        Log::error("[CertAPI] logoName='{$logoName}' logo=" . ($logoB64 ? 'ok' : 'null') . " baseDir={$baseDir}");

        // ── Resolve signature file path ───────────────────────────────────────
        $sigName = trim((string)($school['principal_signature'] ?? ''));
        $sigB64  = ($sigName !== '')
            ? $imgToBase64($baseDir . 'clients/' . $clientCode . '/' . $sigName)
            : null;

        Log::error("getCertificateData [{$clientCode}] enroll={$enrollmentId} logo=" . ($logoB64 ? 'ok' : 'null'));

        $this->jsonOk([
            'student' => [
                'enrollment_id'    => $student['enrollment_id'],
                'student_name'     => $student['student_name']     ?? '',
                'admission_number' => $student['admission_number'] ?? '',
                'roll_number'      => $student['roll_number']      ?? '',
                'father_name'      => $student['father_name']      ?? '',
                'mother_name'      => $student['mother_name']      ?? '',
                'dob'              => $fmtDate($student['dob']),
                'gender'           => $student['gender']           ?? '',
                'blood_group'      => $student['blood_group']      ?? '',
                'address'          => $student['address']          ?? '',
                'mobile'           => $student['mobile_number']    ?? '',
                'class_name'       => $student['class_name']       ?? '',
                'section_name'     => $student['section_name']     ?? '',
                'session_name'     => $student['session_name']     ?? '',
                'admission_date'   => $fmtDate($student['admission_date']),
            ],
            'school' => [
                'school_name'    => $school['school_name']    ?? '',
                'principal_name' => $school['principal_name'] ?? '',
                'school_address' => $school['school_address'] ?? '',
                'school_phone'   => $school['school_phone']   ?? '',
                'school_email'   => $school['school_email']   ?? '',
                'logo_name'      => $school['logo_name']           ?? null,
                'signature_name' => $school['principal_signature'] ?? null,
                'logo_b64'       => $logoB64,
                'signature_b64'  => $sigB64,
            ],
        ]);
    }
}
