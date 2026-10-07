<?php
namespace App\Controller;
use Cake\Datasource\ConnectionManager;
use App\Controller\AppController;
use Cake\Log\Log;
use Cake\Routing\Router;
use App\Mailer\StudentRegistrationMailer;

/**
 * SsmsStudentRegistration Controller
 * Updated for CakePHP 4/5 compatibility — removed $this->request->data, loadModel, $_GET, $_FILES
 */
class SsmsStudentRegistrationController extends AppController
{
    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        // studReg is the public registration form — no login required
        $this->Authentication->allowUnauthenticated(['studReg']);
    }

    // ── Index ──────────────────────────────────────────────────────────────
    public function index()
    {
        $session = $this->request->getSession();

        if ($session->read('ssms_user_role') != 'user') {
            $query = $this->SsmsStudentRegistration->find()
                ->contain(['SsmsClasses', 'SsmsBranch'])
                ->where([
                    'SsmsStudentRegistration.ssms_client_code' => $session->read('ssms_client_code'),
                    'SsmsStudentRegistration.enroll_status'    => 'pending',
                ]);
            $ssmsStudentRegistration = $this->paginate($query);
        } else {
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $this->set(compact('ssmsStudentRegistration'));
    }

    // ── Registered Students ────────────────────────────────────────────────
    public function registeredStudents()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');

        $role = $session->read('ssms_user_role');
        if (in_array($role, ['admin', 'owner', 'user'])) {
            $query = $this->SsmsStudentRegistration->find()
                ->contain(['SsmsClasses'])
                ->where([
                    'SsmsStudentRegistration.ssms_client_code' => $clientCode,
                    'SsmsStudentRegistration.enroll_status'    => 'pending',
                ]);
            $ssmsStudentRegistration = $this->paginate($query);
        }

        // Dropdown data for bulk-enroll modal
        $ssmsSessions = $this->SsmsStudentRegistration->SsmsSessions->find()
            ->select(['session_id', 'session_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['session_name' => 'ASC'])
            ->all()->combine('session_id', 'session_name')->toArray();

        $ssmsClasses = $this->SsmsStudentRegistration->SsmsClasses->find()
            ->select(['class_id', 'class_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['class_name' => 'ASC'])
            ->all()->combine('class_id', 'class_name')->toArray();

        $ssmsSections = $this->fetchTable('SsmsSections')->find()
            ->select(['section_id', 'section_name', 'class_id'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['section_name' => 'ASC'])
            ->all()->toArray();

        $ssmsBranch = $this->SsmsStudentRegistration->SsmsBranch->find()
            ->select(['branch_id', 'branch_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['branch_name' => 'ASC'])
            ->all()->combine('branch_id', 'branch_name')->toArray();

        $this->set(compact('ssmsStudentRegistration', 'ssmsSessions', 'ssmsClasses', 'ssmsSections', 'ssmsBranch'));
    }

    // ── View ───────────────────────────────────────────────────────────────
    public function view($id = null)
    {
        $ssmsStudentRegistration = $this->SsmsStudentRegistration->get($id, contain: ['SsmsClasses']);
        $this->set('ssmsStudentRegistration', $ssmsStudentRegistration);
    }

    // ── Student Details ────────────────────────────────────────────────────
    public function studentDetails($id = null)
    {
        $ssmsStudentRegistration = $this->SsmsStudentRegistration->get($id, contain: ['SsmsClasses']);
        $this->set('ssmsStudentRegistration', $ssmsStudentRegistration);
    }

    // ── Add (scaffold — real form is studReg) ─────────────────────────────
    public function add()
    {
        $session  = $this->request->getSession();
        $clientId = $this->request->getQuery('clientId');

        if (!$clientId) {
            return $this->redirect(['action' => 'index']);
        }

        $ssmsStudentRegistration = $this->SsmsStudentRegistration->newEntity([]);

        if ($this->request->is('post')) {
            $raw = $this->request->getData();

            // Build DOB from string value
            if (!empty($raw['student_dob'])) {
                $raw['student_dob'] = date('Y-m-d', strtotime($raw['student_dob']));
            }
            $raw['ssms_client_code'] = $session->read('ssms_client_code');

            $ssmsStudentRegistration = $this->SsmsStudentRegistration->patchEntity($ssmsStudentRegistration, $raw);

            if ($this->SsmsStudentRegistration->save($ssmsStudentRegistration)) {
                $this->Flash->success(__('The student registration has been saved.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The student registration could not be saved. Please, try again.'));
        }

        $ssmsClasses  = $this->SsmsStudentRegistration->SsmsClasses->find('list',  ['limit' => 200]);
        $ssmsSessions = $this->SsmsStudentRegistration->SsmsSessions->find('list', ['limit' => 200]);
        $ssmsBranch   = $this->SsmsStudentRegistration->SsmsBranch->find('list',   ['limit' => 200]);

        $this->set(compact('ssmsStudentRegistration', 'ssmsClasses', 'ssmsBranch', 'ssmsSessions'));
    }

    // ── Stud Reg (main 5-step wizard) ─────────────────────────────────────
    public function studReg()
    {
        $session     = $this->request->getSession();
        $client_code = null;

        // Guest registration link: ?clntcd=XXXX
        $clntcd = $this->request->getQuery('clntcd');
        if ($clntcd) {
            $client_code = strtoupper($clntcd);
            $SsmsClients = $this->fetchTable('SsmsClients');
            $clientDetails = $SsmsClients->find()
                ->select(['ssms_client_name', 'ssms_client_header_text', 'logo_name', 'ssms_client_code'])
                ->where(['ssms_client_code' => $client_code]);

            if ($clientDetails->count() > 0) {
                foreach ($clientDetails as $row) {
                    $session->write('ssms_client_header_text', $row->ssms_client_header_text);
                    $session->write('ssms_client_name',        $row->ssms_client_name);
                    $session->write('logo_name',               $row->logo_name);
                    $session->write('ssms_user_name',          'Guest');
                    $session->write('ssms_client_code',        $row->ssms_client_code);
                }
            } else {
                $session->destroy();
            }
        }

        // Fall back to session client code
        if (!$client_code) {
            $client_code = $session->read('ssms_client_code');
        }

        if (!$client_code) {
            return $this->redirect(['action' => 'index']);
        }

        $ssmsStudentRegistration = $this->SsmsStudentRegistration->newEntity([]);

        if ($this->request->is('post')) {
            $raw = $this->request->getData();

            // Resolve uploaded files via CakePHP 4/5 API
            $uploads = $this->request->getUploadedFiles();

            $student_photo  = $uploads['student_photo']  ?? null;
            $dob_cert       = $uploads['dob_cert']       ?? null;
            $prev_slc       = $uploads['prev_slc']       ?? null;
            $prev_marksheet = $uploads['prev_marksheet'] ?? null;

            $photoName      = ($student_photo  && $student_photo->getError()  === UPLOAD_ERR_OK) ? $student_photo->getClientFilename()  : '';
            $dobCertName    = ($dob_cert       && $dob_cert->getError()       === UPLOAD_ERR_OK) ? $dob_cert->getClientFilename()       : '';
            $prevSlcName    = ($prev_slc       && $prev_slc->getError()       === UPLOAD_ERR_OK) ? $prev_slc->getClientFilename()       : '';
            $prevMsheetName = ($prev_marksheet && $prev_marksheet->getError() === UPLOAD_ERR_OK) ? $prev_marksheet->getClientFilename() : '';

            // Build DOB from separate year/month/day dropdowns
            $year  = $raw['year']  ?? '';
            $month = $raw['month'] ?? '';
            $day   = $raw['day']   ?? '';
            $dob   = date('Y-m-d', strtotime("$year-$month-$day"));

            // Concatenate country code + local number → single mobile_number value
            $countryCode  = trim($raw['mobile_country_code'] ?? '+91');
            $localNumber  = preg_replace('/\D/', '', trim($raw['mobile_number_local'] ?? ''));
            $mobileNumber = $countryCode . $localNumber;

            // Build clean data array — never write to $this->request->data
            $data = array_merge($raw, [
                'mobile_number' => $mobileNumber,
                'student_dob'      => $dob,
                'ssms_client_code' => $client_code,
                'student_photo'    => $photoName,
                'dob_cert'         => $dobCertName,
                'prev_slc'         => $prevSlcName,
                'prev_marksheet'   => $prevMsheetName,
                'registration_id'  => $this->generateRegistrationNumber($client_code),
                'enroll_status'    => 'pending',
                // Defaults for required fields not always present in form
                'student_nationality'          => $raw['student_nationality']          ?? 'Pakistani',
                'student_mother_name'          => $raw['student_mother_name']          ?? '',
                'mother_age'                   => $raw['mother_age']                   ?? 0,
                'father_age'                   => $raw['father_age']                   ?? 0,
                'student_physically_challenged'=> $raw['student_physically_challenged'] ?? 'No',
            ]);

            // Use newEntity with the full data so CakePHP treats it as INSERT not UPDATE
            $ssmsStudentRegistration = $this->SsmsStudentRegistration->newEntity($data, [
                'accessibleFields' => ['registration_id' => true],
            ]);

            if (!empty($ssmsStudentRegistration->getErrors())) {
                Log::write('error', 'Validation errors: ' . json_encode($ssmsStudentRegistration->getErrors()));
                $this->Flash->error(__('Validation failed. Please check all required fields.'));
            } else {
                try {
                    $result = $this->SsmsStudentRegistration->save($ssmsStudentRegistration);

                    if ($result === false) {
                        // Log entity errors to help diagnose DB-level failures
                        Log::write('error', 'Save failed. Entity errors: ' . json_encode($ssmsStudentRegistration->getErrors()));
                        $this->Flash->error(__('The student registration could not be saved. Please try again.'));
                    } else {
                        $this->Flash->success(__('Student registered successfully. Reg# ' . $result->registration_id));

                        // ── Confirmation email ─────────────────────────────
                        $toEmail = trim($raw['email_address'] ?? '');
                        if ($toEmail !== '' && class_exists('App\Mailer\StudentRegistrationMailer')) {
                            try {
                                $studentName = trim(
                                    ($raw['student_first_name'] ?? '') . ' ' .
                                    ($raw['student_middle_name'] ?? '') . ' ' .
                                    ($raw['student_last_name'] ?? '')
                                );
                                $schoolName = $session->read('ssms_client_name') ?? 'the school';
                                (new StudentRegistrationMailer())->send('confirm', [
                                    $toEmail, $studentName, $result->registration_id, $schoolName
                                ]);
                            } catch (\Exception $mailEx) {
                                Log::write('error', 'Registration confirmation email failed: ' . $mailEx->getMessage());
                            }
                        }

                        $this->saveFiles(
                            $photoName,      $student_photo,
                            $dobCertName,    $dob_cert,
                            $prevSlcName,    $prev_slc,
                            $prevMsheetName, $prev_marksheet,
                            $client_code,
                            $result->registration_id
                        );

                        return $this->redirect(['action' => 'registeredStudents']);
                    }

                } catch (\Exception $e) {
                    Log::write('error', 'Exception: ' . $e->getMessage());
                    $this->Flash->error(__('The student registration could not be saved. Please try again.'));
                }
            }
        }

        $connection   = ConnectionManager::get('default');
        $ssmsSessions = $connection->execute(
            "SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code = ? AND active='Yes' ORDER BY session_name",
            [$client_code]
        );
        $ssmsClasses  = $connection->execute(
            "SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code = ? ORDER BY class_name",
            [$client_code]
        );
        $ssmsBranches = $connection->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_name",
            [$client_code]
        );

        $this->set(compact('ssmsStudentRegistration', 'ssmsClasses', 'ssmsSessions', 'ssmsBranches'));
    }

    // ── Import Reg ─────────────────────────────────────────────────────────
    public function importReg()
    {
        $session = $this->request->getSession();
        $ssmsStudentRegistration = $this->SsmsStudentRegistration->newEntity([]);

        if ($this->request->is('post')) {
            $uploads = $this->request->getUploadedFiles();
            $file    = $uploads['file_name'] ?? null;

            if ($file && $file->getError() === UPLOAD_ERR_OK) {
                $tmpPath = $file->getStream()->getMetadata('uri');
                require_once $_SERVER['DOCUMENT_ROOT'] . '/ssms/ssmslibs/excel_reader2.php';
                $xls = new Spreadsheet_Excel_Reader($tmpPath);
                // process $xls here
            }
        }
    }

    // ── Upload Document ────────────────────────────────────────────────────
    public function uploaddocument($id = null)
    {
        $session = $this->request->getSession();

        $ssmsStudentRegistration = $this->SsmsStudentRegistration->get($id, contain: []);

        if ($this->request->is('post')) {
            $connection = ConnectionManager::get('default');
            $uploads    = $this->request->getUploadedFiles();

            $student_photo  = $uploads['student_photo']  ?? null;
            $dob_cert       = $uploads['dob_cert']       ?? null;
            $prev_slc       = $uploads['prev_slc']       ?? null;
            $prev_marksheet = $uploads['prev_marksheet'] ?? null;

            $photoName      = ($student_photo  && $student_photo->getError()  === UPLOAD_ERR_OK) ? $student_photo->getClientFilename()  : '';
            $dobCertName    = ($dob_cert       && $dob_cert->getError()       === UPLOAD_ERR_OK) ? $dob_cert->getClientFilename()       : '';
            $prevSlcName    = ($prev_slc       && $prev_slc->getError()       === UPLOAD_ERR_OK) ? $prev_slc->getClientFilename()       : '';
            $prevMsheetName = ($prev_marksheet && $prev_marksheet->getError() === UPLOAD_ERR_OK) ? $prev_marksheet->getClientFilename() : '';

            // Fetch existing filenames
            $getFileNames = $connection->execute(
                "SELECT student_photo, dob_cert, prev_slc, prev_marksheet FROM ssms_student_registration WHERE registration_id = ?",
                [$id]
            );
            $existing = ['student_photo' => null, 'dob_cert' => null, 'prev_slc' => null, 'prev_marksheet' => null];
            foreach ($getFileNames as $row) {
                $existing = $row;
            }

            $clientCode  = $session->read('ssms_client_code');
            $uploadPath  = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') . '/clients/' . $clientCode . '/' . $id . '/';
            $setClauses  = [];
            $bindings    = [];

            if ($photoName) {
                $setClauses[] = 'student_photo = ?'; $bindings[] = $photoName;
                if ($existing['student_photo'] && is_file($uploadPath . $existing['student_photo'])) @unlink($uploadPath . $existing['student_photo']);
            }
            if ($dobCertName) {
                $setClauses[] = 'dob_cert = ?'; $bindings[] = $dobCertName;
                if ($existing['dob_cert'] && is_file($uploadPath . $existing['dob_cert'])) @unlink($uploadPath . $existing['dob_cert']);
            }
            if ($prevSlcName) {
                $setClauses[] = 'prev_slc = ?'; $bindings[] = $prevSlcName;
                if ($existing['prev_slc'] && is_file($uploadPath . $existing['prev_slc'])) @unlink($uploadPath . $existing['prev_slc']);
            }
            if ($prevMsheetName) {
                $setClauses[] = 'prev_marksheet = ?'; $bindings[] = $prevMsheetName;
                if ($existing['prev_marksheet'] && is_file($uploadPath . $existing['prev_marksheet'])) @unlink($uploadPath . $existing['prev_marksheet']);
            }

            if ($setClauses) {
                $bindings[] = $clientCode;
                $bindings[] = $id;
                $connection->execute(
                    "UPDATE ssms_student_registration SET " . implode(', ', $setClauses) . " WHERE ssms_client_code = ? AND registration_id = ?",
                    $bindings
                );
                $this->Flash->success(__('Files saved. Reg# ' . $id));
            }

            $this->saveFiles(
                $photoName,      $student_photo,
                $dobCertName,    $dob_cert,
                $prevSlcName,    $prev_slc,
                $prevMsheetName, $prev_marksheet,
                $clientCode, $id
            );

            return $this->redirect(['action' => 'registeredStudents']);
        }

        $connection  = ConnectionManager::get('default');
        $clientCode  = $session->read('ssms_client_code');
        $fileRow = $connection->execute(
            "SELECT student_photo, dob_cert, prev_slc, prev_marksheet FROM ssms_student_registration WHERE ssms_client_code = ? AND registration_id = ?",
            [$clientCode, $id]
        )->fetch('assoc') ?: [];

        $student_photo  = $fileRow['student_photo']  ?? null;
        $dob_cert       = $fileRow['dob_cert']       ?? null;
        $prev_slc       = $fileRow['prev_slc']       ?? null;
        $prev_marksheet = $fileRow['prev_marksheet'] ?? null;

        $this->set(compact('ssmsStudentRegistration', 'student_photo', 'dob_cert', 'prev_slc', 'prev_marksheet'));
    }

    // ── Save Files (uses PSR-7 UploadedFileInterface objects) ──────────────
    public function saveFiles($photoName, $photoFile, $dobName, $dobFile, $slcName, $slcFile, $msheetName, $msheetFile, $client_code, $regId)
    {
        $uploadPath = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') . '/clients/' . $client_code . '/Students/' . $regId . '/';
        if (!is_dir($uploadPath)) { mkdir($uploadPath, 0755, true); }

        $pairs = [
            [$photoName,  $photoFile],
            [$dobName,    $dobFile],
            [$slcName,    $slcFile],
            [$msheetName, $msheetFile],
        ];

        foreach ($pairs as [$name, $file]) {
            if ($name && $file && $file->getError() === UPLOAD_ERR_OK) {
                $dest = $uploadPath . $name;
                if (!file_exists($dest)) {
                    $file->moveTo($dest);
                }
            }
        }
    }

    // ── Edit ───────────────────────────────────────────────────────────────
    public function edit($id = null)
    {
        $session = $this->request->getSession();

        $count = $this->SsmsStudentRegistration->find()
            ->where([
                'ssms_client_code' => $session->read('ssms_client_code'),
                'registration_id'  => $id,
            ]);

        if ($count->count() <= 0 || $session->read('ssms_user_role') === 'user') {
            $this->Flash->error(__('You are not authorized to do this activity.'));
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'index']);
        }

        $ssmsStudentRegistration = $this->SsmsStudentRegistration->get($id, contain: []);

        if ($this->request->is(['patch', 'post', 'put'])) {
            $raw = $this->request->getData();
                           log::error("Raw data is : ". json_encode($raw));

            if (!empty($raw['student_dob'])) {
                $raw['student_dob'] = date('Y-m-d', strtotime($raw['student_dob']));
            }
            // Process file uploads before patchEntity — same logic as mobile saveStudentPhoto().
            // Valid upload  → delete old file, move new file, store filename string in $raw.
            // No file chosen → unset field so patchEntity leaves existing DB value untouched.
            $clientCode    = $session->read('ssms_client_code');
            $regId         = $id;
            $uploadDir     = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') . '/clients/' . $clientCode . '/Students/' . $regId . '/';
            $allowedMimes  = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp',
                              'application/pdf'];
            $maxBytes      = 5 * 1024 * 1024; // 5 MB

            if (!is_dir($uploadDir)) {
               log::error(" dir does not exist. Upload path is : ". $uploadDir);

                mkdir($uploadDir, 0755, true);
            }

            foreach ($raw as $key => $value) {
                if (!($value instanceof \Psr\Http\Message\UploadedFileInterface)) continue;

                if ($value->getError() !== UPLOAD_ERR_OK) {
                    unset($raw[$key]);
                    continue;
                }

                // MIME validation
                $mime = $value->getClientMediaType();
                if (!in_array($mime, $allowedMimes, true)) {
                    $this->Flash->error("File for '{$key}': invalid type '{$mime}'. Only JPEG, PNG, WebP, PDF allowed.");
                    unset($raw[$key]);
                    continue;
                }

                // Size validation
                if ($value->getSize() > $maxBytes) {
                    $mb = round($value->getSize() / 1024 / 1024, 1);
                    $this->Flash->error("File for '{$key}' is too large ({$mb} MB). Max 5 MB.");
                    unset($raw[$key]);
                    continue;
                }

                // Build sanitised filename
                $firstName  = trim((string)($raw['student_first_name'] ?? $raw['student_name'] ?? ''));
                $lastName   = trim((string)($raw['student_last_name']  ?? ''));
                $fullName   = trim($firstName . '_' . $lastName);
                $safeName   = preg_replace('/[^A-Za-z0-9_\-]/', '_', $fullName);
                if (empty(trim($safeName, '_'))) { $safeName = $regId; }

                $ext      = in_array($mime, ['image/png'], true) ? 'png'
                          : (($mime === 'application/pdf') ? 'pdf' : 'jpg');
                $filename = $safeName . '_' . date('Ymd_Hi') . '_' . substr(uniqid('', false), -5) . '.' . $ext;

                // Delete existing file for this field
                $oldFilename = $ssmsStudentRegistration->get($key);
                if ($oldFilename && file_exists($uploadDir . $oldFilename)) {
                    unlink($uploadDir . $oldFilename);
                }

                try {
                    $value->moveTo($uploadDir . $filename);
                    log::error(" dir exist. Upload path is : ". $uploadDir);
                    $raw[$key] = $filename;
                    \Cake\Log\Log::error("Student file saved [{$key}]: {$filename}");
                } catch (\Exception $e) {
                    \Cake\Log\Log::error("Edit moveTo failed [{$key}]: " . $e->getMessage());
                    $this->Flash->error("Could not save file for '{$key}': " . $e->getMessage());
                    unset($raw[$key]);
                }
            }

            $ssmsStudentRegistration = $this->SsmsStudentRegistration->patchEntity($ssmsStudentRegistration, $raw);

            if ($this->SsmsStudentRegistration->save($ssmsStudentRegistration)) {
                $this->Flash->success(__('The student registration has been saved.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The student registration could not be saved. Please, try again.'));
        }

        $clientCode   = $session->read('ssms_client_code');
        $ssmsClasses  = $this->SsmsStudentRegistration->SsmsClasses->find('list')->where(['ssms_client_code' => $clientCode]);
        $ssmsBranch   = $this->SsmsStudentRegistration->SsmsBranch->find('list')->where(['ssms_client_code' => $clientCode]);
        $ssmsSessions = $this->SsmsStudentRegistration->SsmsSessions->find('list')->where(['ssms_client_code' => $clientCode]);

        $this->set(compact('ssmsStudentRegistration', 'ssmsClasses', 'ssmsBranch', 'ssmsSessions'));
    }

    // ── Delete ─────────────────────────────────────────────────────────────
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsStudentRegistration = $this->SsmsStudentRegistration->get($id);

        if ($this->SsmsStudentRegistration->delete($ssmsStudentRegistration)) {
            $this->Flash->success(__('The student registration has been deleted.'));
        } else {
            $this->Flash->error(__('The student registration could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'registeredStudents']);
    }

    // ── Import Students from XLSX / CSV ───────────────────────────────────
    public function importStudents()
    {
        $this->request->allowMethod(['post']);
        $session     = $this->request->getSession();
        $client_code = $session->read('ssms_client_code');

        $result = ['inserted' => 0, 'skipped' => 0, 'errors' => []];

        $uploads = $this->request->getUploadedFiles();
        $file    = $uploads['import_file'] ?? null;

        if (!$file || $file->getError() !== UPLOAD_ERR_OK) {
            $this->Flash->error('No file uploaded or upload error.');
            return $this->redirect(['action' => 'registeredStudents']);
        }

        $tmpPath  = $file->getStream()->getMetadata('uri');
        $origName = strtolower($file->getClientFilename());
        $ext      = pathinfo($origName, PATHINFO_EXTENSION);

        $rows = [];

        if ($ext === 'csv') {
            $handle  = fopen($tmpPath, 'r');
            $headers = null;
            while (($row = fgetcsv($handle)) !== false) {
                if ($headers === null) {
                    $headers = array_map(fn($h) => $this->_normaliseHeader($h), $row);
                    continue;
                }
                if (count(array_filter($row)) === 0) continue;
                $rows[] = array_combine(
                    array_slice($headers, 0, count($row)),
                    array_slice($row,    0, count($headers))
                );
            }
            fclose($handle);

        } elseif (in_array($ext, ['xlsx', 'xlsm'])) {
            $rows = $this->_parseXlsx($tmpPath);

        } else {
            $this->Flash->error('Unsupported file type. Please upload .xlsx or .csv');
            return $this->redirect(['action' => 'registeredStudents']);
        }

        if (empty($rows)) {
            $this->Flash->error('No data rows found in the file.');
            return $this->redirect(['action' => 'registeredStudents']);
        }

        foreach ($rows as $idx => $row) {
            $rowNum = $idx + 2;

            // Core required fields
            $firstName = $row['first_name']      ?? $row['student_first_name'] ?? '';
            $lastName  = $row['last_name']       ?? $row['student_last_name']  ?? '';
            $mobile    = $row['mobile']          ?? $row['mobile_number']      ?? '';
            $gender    = $row['gender']          ?? $row['student_gender']     ?? '';
            $natl      = $row['nationality']     ?? $row['student_nationality']?? 'Pakistani';
            $pc        = $row['student_physically_challenged'] ?? $row['physically_challenged'] ?? 'No';
            $title     = $row['student_title']   ?? $row['title']              ?? '';
            $admType   = $row['student_admission_type'] ?? $row['admission_type'] ?? '';
            $birthPl   = $row['student_birth_place']   ?? $row['birth_place']    ?? '';
            $medium    = $row['course_medium']   ?? '';

            // Address: current and permanent address lines from XLS
            $cAddr     = $row['student_c_address_line_1'] ?? $row['address'] ?? $row['student_address'] ?? '';
            $pAddr     = $row['student_p_address_line_1'] ?? $cAddr;

            // Numeric FK fields — only use if they look like integers
            $branchId  = (isset($row['branch_id'])  && ctype_digit((string)$row['branch_id']))  ? (int)$row['branch_id']  : null;
            $sessionId = (isset($row['session_id']) && ctype_digit((string)$row['session_id'])) ? (int)$row['session_id'] : null;
            $classId   = (isset($row['class_id']) && ctype_digit((string)$row['class_id'])) ? (int)$row['class_id'] : null;

            if ($firstName === '') {
                $result['skipped']++;
                $result['errors'][] = "Row $rowNum: first_name / last_name missing — skipped.";
                continue;
            }

            // DOB
            $dob    = '';
            $dobRaw = $row['dob'] ?? $row['date_of_birth'] ?? $row['student_dob'] ?? '';
            if ($dobRaw !== '') {
                $ts  = strtotime($dobRaw);
                $dob = $ts ? date('Y-m-d', $ts) : '';
            }

            $data = [
                'registration_id'               => (!empty($row['registration_id'])) ? $row['registration_id'] : $this->generateRegistrationNumber($client_code),
                'ssms_client_code'              => $client_code,
                // Personal
                'student_title'                 => $title,
                'student_first_name'            => $firstName,
                'student_last_name'             => $lastName,
                'student_gender'                => $gender,
                'student_dob'                   => $dob,
                'student_birth_place'           => $birthPl,
                'student_nationality'           => $natl ?: 'No value',
                'student_physically_challenged' => in_array(strtolower($pc), ['yes','y','1']) ? 'Yes' : 'No',
                'student_admission_type'        => $admType,
                // Family
                'student_father_name'           => $row['father_name']   ?? $row['student_father_name']  ?? '',
                'student_mother_name'           => $row['mother_name']   ?? $row['student_mother_name']  ?? '',
                'father_age'                    => (int)($row['father_age'] ?? 0),
                'mother_age'                    => (int)($row['mother_age'] ?? 0),
                'father_occupation'             => $row['father_occupation'] ?? '',
                'mother_occupation'             => $row['mother_occupation'] ?? '',
                // Contact
                'email_address'                 => $row['email']         ?? $row['email_address']        ?? '',
                'mobile_number'                 => $mobile,
                // Address — city/state keys must be present (requirePresence); default to empty
                'student_c_address_line_1'      => $cAddr,
                'student_c_address_city'        => $row['student_c_address_city'] ?? $row['c_address_city'] ?? $row['city'] ?? '',
                'student_c_address_state'       => $row['student_c_address_state'] ?? $row['c_address_state'] ?? $row['state'] ?? '',
                'student_p_address_line_1'      => $pAddr,
                'student_p_address_city'        => $row['student_p_address_city'] ?? $row['p_address_city'] ?? $row['student_c_address_city'] ?? $row['city'] ?? '',
                'student_p_address_state'       => $row['student_p_address_state'] ?? $row['p_address_state'] ?? $row['student_c_address_state'] ?? $row['state'] ?? '',
                // Academic
                'course_medium'                 => $medium,
                'admission_number'              => $row['admission_number'] ?? '',
                'caste'                         => $row['caste']            ?? '',
                'religion'                      => $row['religion']         ?? '',
                // FKs (null if not a valid integer)
                'branch_id'                     => $branchId,
                'session_id'                    => $sessionId,
                'class_id'                      => $classId,
                'registered_class_id_for'       => $classId,
                // Enrollment & files
                'enroll_status'                 => 'pending',
                'student_photo'                 => '',
                'dob_cert'                      => '',
                'prev_slc'                      => '',
                'prev_marksheet'                => '',
            ];

            $entity = $this->SsmsStudentRegistration->newEntity($data, [
                'accessibleFields' => ['registration_id' => true],
            ]);

            try {
                if ($this->SsmsStudentRegistration->save($entity)) {
                    $result['inserted']++;
                } else {
                    $result['skipped']++;
                    $errs = array_map(fn($e) => implode(', ', $e), $entity->getErrors());
                    $result['errors'][] = "Row $rowNum ($firstName $lastName): " . implode('; ', $errs);
                }
            } catch (\Exception $e) {
                $result['skipped']++;
                $msg = $e->getMessage();
                if (stripos($msg, 'Duplicate') !== false || stripos($msg, '1062') !== false) {
                    $result['errors'][] = "Row $rowNum ($firstName $lastName): duplicate — skipped.";
                } else {
                    $result['errors'][] = "Row $rowNum ($firstName $lastName): DB error — " . substr($msg, 0, 120);
                }
            }
        }

        if ($result['inserted'] > 0) {
            $this->Flash->success("{$result['inserted']} student(s) imported successfully." .
                ($result['skipped'] ? " {$result['skipped']} row(s) skipped." : ''));
        } else {
            $this->Flash->error('No students were imported.');
        }

        if (!empty($result['errors'])) {
            $this->Flash->error('Skipped rows: ' . implode(' | ', $result['errors']));
        }

        return $this->redirect(['action' => 'registeredStudents']);
    }

    // Download Import Template (CSV)
    public function importTemplate()
    {
        $headers = [
            'first_name','last_name','father_name','mother_name',
            'email','mobile','gender','dob','address','nationality','blood_group','cnic'
        ];
        $sample = ['Ali','Khan','Ahmad Khan','Sara Khan','ali@example.com','03001234567','Male','2005-03-15','House 12 Street 4 Lahore','Pakistani','O+','1234567890123'];

        $this->response = $this->response
            ->withHeader('Content-Type', 'text/csv; charset=UTF-8')
            ->withHeader('Content-Disposition', 'attachment; filename="student_import_template.csv"');

        $body = fopen('php://temp', 'w+');
        fputcsv($body, $headers);
        fputcsv($body, $sample);
        rewind($body);
        $csv = stream_get_contents($body);
        fclose($body);

        $this->response->getBody()->write($csv);
        $this->autoRender = false;
    }

    // Normalise a header string: lowercase, replace whitespace/NBSP/dash with underscore, trim
    private function _normaliseHeader(string $h): string
    {
        // Remove UTF-8 non-breaking space (0xC2 0xA0) and regular whitespace
        $h = preg_replace('/[\x{00A0}\s]+/u', '_', trim($h));
        $h = str_replace('-', '_', $h);
        $h = preg_replace('/_+/', '_', $h);
        return strtolower(trim($h, '_'));
    }

    // Pure-PHP XLSX parser — handles default XML namespace and sparse cells
    private function _parseXlsx(string $path): array
    {
        $zip = new \ZipArchive();
        if ($zip->open($path) !== true) return [];

        // Shared strings
        $sharedStrings = [];
        $ssXml = $zip->getFromName('xl/sharedStrings.xml');
        if ($ssXml) {
            // Strip default namespace so SimpleXML can access elements without prefix
            $ssXml = preg_replace('/\s+xmlns(?::[a-z0-9]+)?="[^"]*"/', '', $ssXml);
            $ss = @simplexml_load_string($ssXml);
            if ($ss) {
                foreach ($ss->si as $si) {
                    // Rich text: collect all <t> descendants
                    $text = '';
                    foreach ($si->r as $r) {
                        $text .= (string)($r->t ?? '');
                    }
                    if ($text === '') {
                        $text = (string)($si->t ?? '');
                    }
                    $sharedStrings[] = $text;
                }
            }
        }

        // First worksheet
        $wsXml = $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();
        if (!$wsXml) return [];

        $wsXml = preg_replace('/\s+xmlns(?::[a-z0-9]+)?="[^"]*"/', '', $wsXml);
        $ws = @simplexml_load_string($wsXml);
        if (!$ws) return [];

        // Column letter(s) -> zero-based index  e.g. A->0, Z->25, AA->26
        $colIdx = function(string $ref): int {
            $letters = preg_replace('/[0-9]/', '', strtoupper($ref));
            $idx = 0;
            for ($i = 0; $i < strlen($letters); $i++) {
                $idx = $idx * 26 + (ord($letters[$i]) - 64);
            }
            return $idx - 1;
        };

        $rawRows = [];
        foreach ($ws->sheetData->row as $row) {
            $rowData = [];
            foreach ($row->c as $cell) {
                $ref    = (string)($cell['r'] ?? '');
                $ci     = $ref ? $colIdx($ref) : count($rowData);
                // Pad gaps (sparse cells)
                while (count($rowData) < $ci) $rowData[] = '';
                $t = (string)($cell['t'] ?? '');
                $v = (string)($cell->v ?? '');
                if ($t === 's') {
                    $rowData[] = $sharedStrings[(int)$v] ?? '';
                } elseif ($t === 'inlineStr') {
                    $rowData[] = (string)($cell->is->t ?? '');
                } else {
                    $rowData[] = $v;
                }
            }
            $rawRows[] = $rowData;
        }

        if (count($rawRows) < 2) return [];

        // First row = headers; normalise each one
        $headerRaw = array_shift($rawRows);
        $headers   = array_map(fn($h) => $this->_normaliseHeader($h), $headerRaw);

        $out = [];
        foreach ($rawRows as $row) {
            // Skip blank rows
            if (count(array_filter($row, fn($v) => $v !== '')) === 0) continue;
            $combined = [];
            foreach ($headers as $i => $h) {
                $combined[$h] = isset($row[$i]) ? trim((string)$row[$i]) : '';
            }
            $out[] = $combined;
        }
        return $out;
    }

    // ── Generate Registration Number ───────────────────────────────────────
    public function generateRegistrationNumber($client_code)
    {
        $year = date('Y');

        $lastReg = $this->SsmsStudentRegistration->find()
            ->select(['registration_id'])
            ->where(['ssms_client_code' => $client_code])
            ->orderByDesc('registration_id')
            ->limit(1);

        $current_reg_number = null;
        foreach ($lastReg as $row) {
            $current_reg_number = $row->registration_id;
        }

        if ($current_reg_number) {
            $pieces       = explode('-', $current_reg_number);
            $lastYear     = $pieces[1] ?? '';
            $thirdPart    = ($year === $lastYear)
                ? str_pad((int)($pieces[2] ?? 0) + 1, 4, '0', STR_PAD_LEFT)
                : '0001';
        } else {
            $thirdPart = '0001';
        }

        return "R{$client_code}-{$year}-{$thirdPart}";
    }
}
