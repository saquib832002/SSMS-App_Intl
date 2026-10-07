<?php
namespace App\Controller;

use App\Controller\AppController;
use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SchoolSettingsServiceApiController
 *
 * SQL (run once — adds principal signature column):
 *   ALTER TABLE ssms_school_settings
 *     ADD COLUMN principal_signature VARCHAR(255) NOT NULL DEFAULT ''
 *     AFTER school_end_time;
 *
 * SQL (run once — adds ID card config column):
 *   ALTER TABLE ssms_school_settings
 *     ADD COLUMN idcard_config TEXT NULL
 *     AFTER principal_signature;
 *
 * Upload directory (created automatically):
 *   webroot/clients/{clientCode}/
 */
class SchoolSettingsServiceApiController extends AppController
{
    // ── GET /SchoolSettingsServiceApi/getSettings ─────────────────────────────
    public function getSettings()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $baseUrl    = rtrim(env('APP_URL', ''), '/');

        $defaults = [
            'working_days'          => '1,2,3,4,5',
            'weekend_days'          => '6,7',
            'session_start_month'   => 4,
            'school_start_time'     => '08:00',
            'school_end_time'       => '14:00',
            'principal_signature'   => null,
        ];

        try {
            $conn = ConnectionManager::get('default');
            $row  = $conn->execute(
                "SELECT working_days, weekend_days, session_start_month,
                        school_start_time, school_end_time, principal_signature
                 FROM ssms_school_settings
                 WHERE client_code = ?
                 LIMIT 1",
                [$clientCode]
            )->fetch('assoc');

            $sigUrl = null;
            if ($row && !empty($row['principal_signature'])) {
                // Append file mtime as cache-buster so React Native reloads when
                // the file is replaced (same filename, different content).
                $sigFile = dirname(WWW_ROOT) . DS . 'clients' . DS . $clientCode . DS . $row['principal_signature'];
                $mtime   = file_exists($sigFile) ? filemtime($sigFile) : 0;
                $sigUrl  = $baseUrl . '/clients/' . $clientCode . '/' . $row['principal_signature'] . '?t=' . $mtime;
            }

            $data = $row ? [
                'working_days'        => $row['working_days'],
                'weekend_days'        => $row['weekend_days'],
                'session_start_month' => (int) $row['session_start_month'],
                'school_start_time'   => substr($row['school_start_time'], 0, 5),
                'school_end_time'     => substr($row['school_end_time'],   0, 5),
                'principal_signature' => $sigUrl,
            ] : $defaults;

            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'data' => $data]));

        } catch (\Exception $e) {
            Log::error('SchoolSettings::getSettings – ' . $e->getMessage());
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'data' => $defaults]));
        }
    }

    // ── POST /SchoolSettingsServiceApi/saveSettings ───────────────────────────
    // Accepts multipart/form-data so an image file can be uploaded alongside
    // the text fields. If no new signature file is sent, the existing one is kept.
    public function saveSettings()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $data       = $this->request->getData();

        // Sanitise text fields
        $workingDays       = trim($data['working_days']        ?? '1,2,3,4,5');
        $weekendDays       = trim($data['weekend_days']        ?? '6,7');
        $sessionStartMonth = max(1, min(12, (int)($data['session_start_month'] ?? 4)));
        $schoolStartTime   = trim($data['school_start_time']   ?? '08:00');
        $schoolEndTime     = trim($data['school_end_time']     ?? '14:00');

        if (empty($workingDays)) {
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'At least one working day is required.']));
        }

        // ── Handle optional signature upload ──────────────────────────────────
        $newSignatureFilename = null;
        $fileUploadError      = null;

        try {
            $sigFile = $this->request->getUploadedFile('principal_signature');

            Log::debug('[SchoolSettings] clientCode=' . $clientCode
                . ' | sigFile=' . ($sigFile ? 'found' : 'null')
                . ($sigFile ? ' | uploadError=' . $sigFile->getError() . ' | size=' . $sigFile->getSize() . ' | clientName=' . $sigFile->getClientFilename() : ''));

            if ($sigFile && $sigFile->getError() === UPLOAD_ERR_OK) {
                $ext     = strtolower(pathinfo((string)$sigFile->getClientFilename(), PATHINFO_EXTENSION));
                $allowed = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

                if (!in_array($ext, $allowed)) {
                    $fileUploadError = 'Signature must be PNG, JPG, or GIF. Got: ' . $ext;
                } else {
                    $filename = 'principal_signature.' . $ext;
                    $dir      = dirname(WWW_ROOT) . DS . 'clients' . DS . $clientCode . DS;

                    Log::debug('[SchoolSettings] saving to: ' . $dir . $filename);

                    if (!is_dir($dir)) {
                        $made = mkdir($dir, 0755, true);
                        Log::debug('[SchoolSettings] mkdir result: ' . ($made ? 'ok' : 'failed'));
                    }

                    $sigFile->moveTo($dir . $filename);

                    // Process: remove background → always output as principal_signature.png
                    $processedName = 'principal_signature.png';
                    $processedPath = $dir . $processedName;
                    if ($this->processSignatureImage($dir . $filename, $processedPath)) {
                        // Remove original if it was a different format
                        if ($filename !== $processedName && file_exists($dir . $filename)) {
                            @unlink($dir . $filename);
                        }
                        $newSignatureFilename = $processedName;
                    } else {
                        $newSignatureFilename = $filename;
                    }

                    Log::debug('[SchoolSettings] file saved OK as ' . $newSignatureFilename);
                }
            } elseif ($sigFile) {
                Log::debug('[SchoolSettings] upload error code: ' . $sigFile->getError());
            }
        } catch (\Throwable $e) {
            Log::error('[SchoolSettings] file upload exception: ' . $e->getMessage() . ' | ' . $e->getFile() . ':' . $e->getLine());
            $fileUploadError = 'Signature upload failed: ' . $e->getMessage();
        }

        if ($fileUploadError) {
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => $fileUploadError]));
        }

        try {
            $conn     = ConnectionManager::get('default');
            $existing = $conn->execute(
                "SELECT id, principal_signature FROM ssms_school_settings WHERE client_code = ? LIMIT 1",
                [$clientCode]
            )->fetch('assoc');

            // Keep old filename if no new file uploaded
            $sigFilename = $newSignatureFilename
                ?? ($existing['principal_signature'] ?? '');

            if ($existing) {
                $conn->execute(
                    "UPDATE ssms_school_settings
                     SET working_days = ?, weekend_days = ?, session_start_month = ?,
                         school_start_time = ?, school_end_time = ?,
                         principal_signature = ?, modified = NOW()
                     WHERE client_code = ?",
                    [$workingDays, $weekendDays, $sessionStartMonth,
                     $schoolStartTime, $schoolEndTime, $sigFilename, $clientCode]
                );
            } else {
                $conn->execute(
                    "INSERT INTO ssms_school_settings
                         (client_code, working_days, weekend_days, session_start_month,
                          school_start_time, school_end_time, principal_signature, created, modified)
                     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                    [$clientCode, $workingDays, $weekendDays, $sessionStartMonth,
                     $schoolStartTime, $schoolEndTime, $sigFilename]
                );
            }

            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'message' => 'Settings saved successfully.']));

        } catch (\Exception $e) {
            Log::error('SchoolSettings::saveSettings – ' . $e->getMessage());
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => $e->getMessage()]));
        }
    }

    // ── Signature image processor ─────────────────────────────────────────────
    // Removes the background from a signature image using GD:
    //   - Transparent pixels  → white
    //   - Bright/light pixels → white  (background removal)
    //   - Dark pixels         → kept   (the actual pen strokes)
    // Always outputs a PNG regardless of input format.
    private function processSignatureImage(string $src, string $dest): bool
    {
        if (!function_exists('imagecreatetruecolor')) return false;

        $info = @getimagesize($src);
        if (!$info) return false;

        switch ($info['mime']) {
            case 'image/jpeg': $im = @imagecreatefromjpeg($src); break;
            case 'image/png':  $im = @imagecreatefrompng($src);  break;
            case 'image/gif':  $im = @imagecreatefromgif($src);  break;
            case 'image/webp': $im = @imagecreatefromwebp($src); break;
            default: return false;
        }
        if (!$im) return false;

        $w = imagesx($im);
        $h = imagesy($im);

        // Enable alpha reading on the source
        imagesavealpha($im, true);
        imagealphablending($im, false);

        // ── Step 1: find the brightest luminance in the whole image ──────────
        // The brightest pixel is the paper/background (even if it's grey or cream).
        // We threshold relative to this so it works regardless of lighting conditions.
        $maxLum = 0;
        for ($x = 0; $x < $w; $x++) {
            for ($y = 0; $y < $h; $y++) {
                $c     = imagecolorat($im, $x, $y);
                $alpha = ($c >> 24) & 0x7F;
                if ($alpha > 50) continue;               // skip transparent
                $r = ($c >> 16) & 0xFF;
                $g = ($c >>  8) & 0xFF;
                $b =  $c        & 0xFF;
                $lum = 0.299 * $r + 0.587 * $g + 0.114 * $b;
                if ($lum > $maxLum) $maxLum = $lum;
            }
        }
        // Safety: if the whole image is very dark assume a white background
        if ($maxLum < 80) $maxLum = 255;

        // Keep only pixels darker than 55% of the brightest pixel.
        // Paper (near max) → removed.  Ink strokes (much darker) → kept.
        $threshold = $maxLum * 0.55;

        // ── Step 2: build white-background output, keeping only ink pixels ───
        $out = imagecreatetruecolor($w, $h);
        imagefill($out, 0, 0, imagecolorallocate($out, 255, 255, 255));

        for ($x = 0; $x < $w; $x++) {
            for ($y = 0; $y < $h; $y++) {
                $rgba  = imagecolorat($im, $x, $y);
                $r     = ($rgba >> 16) & 0xFF;
                $g     = ($rgba >>  8) & 0xFF;
                $b     =  $rgba        & 0xFF;
                $alpha = ($rgba >> 24) & 0x7F;

                if ($alpha > 50) continue; // transparent → leave white

                $lum = 0.299 * $r + 0.587 * $g + 0.114 * $b;
                if ($lum > $threshold) continue; // background → leave white

                // Ink stroke → draw (darken a bit toward pure black for clean result)
                imagesetpixel($out, $x, $y, imagecolorallocate($out, $r, $g, $b));
            }
        }

        imagedestroy($im);
        $ok = imagepng($out, $dest);
        imagedestroy($out);
        return (bool)$ok;
    }

    // ── GET /SchoolSettingsServiceApi/getIdCardConfig ─────────────────────────
    public function getIdCardConfig()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');

        $defaults = [
            // School header
            'showSchoolLogo'         => true,
            'showSchoolAddress'      => true,
            'showSchoolPhone'        => true,
            'showTagline'            => true,
            // Student identity
            'showStudentPhoto'       => true,
            'showAdmissionNo'        => true,
            'showDateOfBirth'        => true,
            'showBloodGroup'         => true,
            'showGender'             => true,
            'showSessionYear'        => true,
            // Family / parent
            'showFatherName'         => true,
            'showMotherName'         => true,
            'showParentPhone'        => true,
            'showStudentAddress'     => true,
            // Transport
            'showBusRoute'           => true,
            // Card features
            'showEstdYear'           => true,
            'showQrCode'             => true,
            'showPrincipalSignature' => true,
            'showValidityYear'       => true,
            // Footer
            'showIfFoundBar'         => true,
            'showSchoolPhoneInFooter'=> true,
            // Customizable text
            'taglineText'            => 'LEARN | GROW | SUCCEED',
            'ifFoundText'            => 'If found, please return this card to the school.',
            'estdYear'               => '2020',
            // Language
            'cardLanguage'           => 'en',
        ];

        try {
            $conn = ConnectionManager::get('default');
            $row  = $conn->execute(
                "SELECT idcard_config FROM ssms_school_settings WHERE client_code = ? LIMIT 1",
                [$clientCode]
            )->fetch('assoc');

            $saved = [];
            if ($row && !empty($row['idcard_config'])) {
                $decoded = json_decode($row['idcard_config'], true);
                if (is_array($decoded)) $saved = $decoded;
            }

            // Merge: saved values override defaults (so new fields default to true)
            $config = array_merge($defaults, $saved);

            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'config' => $config]));

        } catch (\Exception $e) {
            Log::error('SchoolSettings::getIdCardConfig – ' . $e->getMessage());
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'config' => $defaults]));
        }
    }

    // ── POST /SchoolSettingsServiceApi/saveIdCardConfig ───────────────────────
    public function saveIdCardConfig()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->request->getHeaderLine('ssmsClientCode');
        $body       = $this->request->getData();

        // Boolean toggle keys
        $boolFields = [
            'showSchoolLogo', 'showSchoolAddress', 'showSchoolPhone', 'showTagline',
            'showStudentPhoto', 'showAdmissionNo', 'showDateOfBirth',
            'showBloodGroup', 'showGender', 'showSessionYear',
            'showFatherName', 'showMotherName', 'showParentPhone',
            'showStudentAddress', 'showBusRoute',
            'showEstdYear', 'showQrCode', 'showPrincipalSignature', 'showValidityYear',
            'showIfFoundBar', 'showSchoolPhoneInFooter',
        ];
        // Free-text keys (max 300 chars each)
        $textFields = ['taglineText', 'ifFoundText', 'estdYear', 'cardLanguage'];

        $config = [];
        foreach ($boolFields as $key) {
            if (array_key_exists($key, $body)) {
                $config[$key] = filter_var($body[$key], FILTER_VALIDATE_BOOLEAN);
            }
        }
        foreach ($textFields as $key) {
            if (array_key_exists($key, $body)) {
                $config[$key] = substr(trim((string)($body[$key] ?? '')), 0, 300);
            }
        }

        try {
            $conn     = ConnectionManager::get('default');
            $existing = $conn->execute(
                "SELECT id FROM ssms_school_settings WHERE client_code = ? LIMIT 1",
                [$clientCode]
            )->fetch('assoc');

            $json = json_encode($config);

            if ($existing) {
                $conn->execute(
                    "UPDATE ssms_school_settings SET idcard_config = ?, modified = NOW() WHERE client_code = ?",
                    [$json, $clientCode]
                );
            } else {
                $conn->execute(
                    "INSERT INTO ssms_school_settings (client_code, idcard_config, created, modified) VALUES (?, ?, NOW(), NOW())",
                    [$clientCode, $json]
                );
            }

            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'message' => 'ID card settings saved.']));

        } catch (\Exception $e) {
            Log::error('SchoolSettings::saveIdCardConfig – ' . $e->getMessage());
            return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => $e->getMessage()]));
        }
    }
}
