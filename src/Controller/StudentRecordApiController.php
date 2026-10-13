<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Permissions;
use App\Service\StudentLeave;
use App\Service\StudentRecord;
use Psr\Http\Message\UploadedFileInterface;

/**
 * StudentRecordApi – the complete student record (JWT protected).
 * Every call names the student with registrationId (or enrollmentId); access is checked by
 * StudentRecord::access (staff permissions + own classes, parents: own children only).
 *
 *   GET  /StudentRecordApi/record?registrationId=|enrollmentId=
 *   POST /StudentRecordApi/saveGuardian     { registration_id, id?, name, relation, phone, email, occupation, address,
 *                                             is_primary, lives_with, can_pickup, app_access, gets_notices, restriction_note }
 *   POST /StudentRecordApi/removeGuardian   { registration_id, id }
 *   POST /StudentRecordApi/saveContact      { registration_id, id?, name, relation, phone, alt_phone, notes, priority }
 *   POST /StudentRecordApi/removeContact    { registration_id, id }
 *   POST /StudentRecordApi/saveMedical      { registration_id, blood_group, alert_level, allergies, conditions, medications,
 *                                             dietary, doctor, insurance, notes }
 *   GET  /StudentRecordApi/medicalList?classId=&sectionId=      health alerts for a class
 *   POST /StudentRecordApi/uploadDocument   multipart: registration_id, file, doc_type, title, doc_number, expires_on, visible_to_parent
 *   POST /StudentRecordApi/updateDocument   { registration_id, id, doc_type, title, doc_number, expires_on, visible_to_parent, verified }
 *   POST /StudentRecordApi/deleteDocument   { registration_id, id }
 *   GET  /StudentRecordApi/downloadDocument?registrationId=&id=
 *   GET  /StudentRecordApi/expiringDocuments?days=60
 *   POST /StudentRecordApi/saveFields       { registration_id, values: {field_id: value} }
 *   GET  /StudentRecordApi/fieldDefs?all=1
 *   POST /StudentRecordApi/saveFieldDef     { id?, label, field_type, options, help_text, required, visible_to_parent,
 *                                             parent_can_edit, sort_order, active }
 */
class StudentRecordApiController extends AppController
{
    use SecurityApiTrait {
        _out as private _traitOut;
    }

    /** Output buffer level started for this request (stray PHP notices are caught here). */
    private ?int $bufLevel = null;

    public function initialize(): void
    {
        parent::initialize();
        // In debug mode PHP warnings are printed straight into the reply, in front of the
        // JSON, which the app then can't read. Catch anything printed and log it instead.
        if (ob_start()) {
            $this->bufLevel = ob_get_level();
        }
    }

    private function dropStrayOutput(): void
    {
        if ($this->bufLevel !== null && ob_get_level() >= $this->bufLevel) {
            while (ob_get_level() > $this->bufLevel) {
                ob_end_flush();
            }
            $stray = (string)ob_get_clean();
            $this->bufLevel = null;
            if (trim($stray) !== '') {
                \Cake\Log\Log::warning('StudentRecordApi: unexpected output removed from reply: '
                    . mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($stray))), 0, 1000));
            }
        }
    }

    protected function _out(array $data, int $status = 200)
    {
        $this->dropStrayOutput();

        return $this->_traitOut($data, $status);
    }

    private function actor(): array
    {
        // app only: the web session path doesn't carry custom roles, so it isn't accepted here
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please use the app to open student records.');
        }

        return ['user' => $this->_user(), 'role' => $this->_role(), 'custom_role' => $this->request->getAttribute('jwt_custom_role'),
                'enrollment' => (string)$this->request->getAttribute('jwt_enrollment_id')];
    }

    /** Access for the student named in the request (query for GET, body for POST). */
    private function acc(): array
    {
        $get = $this->request->is('get');
        $reg = $get ? $this->request->getQuery('registrationId') : $this->request->getData('registration_id');
        $eid = $get ? $this->request->getQuery('enrollmentId') : $this->request->getData('enrollment_id');

        return StudentRecord::access($this->_client(), $this->actor(), is_scalar($reg) ? (string)$reg : null, is_scalar($eid) ? (string)$eid : null);
    }

    private function need(array $acc, string $what, string $msg): void
    {
        if (empty($acc['can'][$what])) {
            throw new \DomainException($msg);
        }
    }

    private function recordAudit(array $acc, string $event, string $summary, $changes = null, string $category = 'records'): void
    {
        $this->_audit($event, ['category' => $category, 'entity_type' => 'student', 'entity_id' => $acc['student']['registration_id'],
            'summary' => $summary . ' · ' . $acc['student']['name'], 'changes' => $changes]);
    }

    // ── Whole record ────────────────────────────────────────────────────────

    public function record()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $acc = $this->acc();

            return StudentRecord::record($this->_client(), $acc);
        });
    }

    // ── Guardians ───────────────────────────────────────────────────────────

    public function saveGuardian()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'edit_guardians', 'You don\'t have permission to change guardians.');
            $res = StudentRecord::saveGuardian($this->_client(), $acc['student']['registration_id'], (array)$this->request->getData(),
                $this->_user(), (bool)$acc['can']['app_access'], (bool)$acc['can']['protect']);
            $g = $res['guardian'];
            $this->recordAudit($acc, 'student.guardian_saved', (empty($this->request->getData('id')) ? 'Guardian added: ' : 'Guardian updated: ')
                . $g['name'], $res['changes'] ?: null);
            if ($res['restriction_changed']) {
                $this->recordAudit($acc, 'student.guardian_restriction', ($g['can_pickup'] && !$g['restriction_note'] ? 'Collection restriction lifted for ' : 'Collection restriction set for ')
                    . $g['name'], null, 'access');
            }
            if ($res['app_changed']) {
                $this->recordAudit($acc, 'student.guardian_app_access', ($g['app_access'] ? 'App sign-in given to ' : 'App sign-in removed from ') . $g['name'], null, 'access');
            }

            return ['guardians' => StudentRecord::guardians($this->_client(), $acc['student']['registration_id'])];
        });
    }

    public function removeGuardian()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'edit_guardians', 'You don\'t have permission to change guardians.');
            $this->need($acc, 'delete', 'You don\'t have permission to remove guardians.');
            $g = StudentRecord::deleteGuardian($this->_client(), $acc['student']['registration_id'], (int)$this->request->getData('id'));
            $this->recordAudit($acc, 'student.guardian_removed', 'Guardian removed: ' . $g['name'], ['relation' => $g['relation'], 'had_app_access' => $g['app_access']]);

            return ['guardians' => StudentRecord::guardians($this->_client(), $acc['student']['registration_id'])];
        });
    }

    // ── Emergency contacts ──────────────────────────────────────────────────

    public function saveContact()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'edit_contacts', 'You don\'t have permission to change emergency contacts.');
            $d = (array)$this->request->getData();
            $list = StudentRecord::saveContact($this->_client(), $acc['student']['registration_id'], $d, $this->_user(), $acc['level'] === 'staff' ? $this->_role() : $acc['level']);
            $this->recordAudit($acc, 'student.contact_saved', (empty($d['id']) ? 'Emergency contact added: ' : 'Emergency contact updated: ') . trim((string)($d['name'] ?? '')));

            return ['contacts' => $list];
        });
    }

    public function removeContact()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'edit_contacts', 'You don\'t have permission to change emergency contacts.');
            if ($acc['level'] === 'staff') {
                $this->need($acc, 'delete', 'You don\'t have permission to remove emergency contacts.');
            }
            $r = StudentRecord::deleteContact($this->_client(), $acc['student']['registration_id'], (int)$this->request->getData('id'));
            $this->recordAudit($acc, 'student.contact_removed', 'Emergency contact removed: ' . $r['name']);

            return ['contacts' => StudentRecord::contacts($this->_client(), $acc['student']['registration_id'])];
        });
    }

    // ── Medical ─────────────────────────────────────────────────────────────

    public function saveMedical()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'edit_medical', 'You don\'t have permission to change health details.');
            $res = StudentRecord::saveMedical($this->_client(), $acc['student']['registration_id'], (array)$this->request->getData(),
                $this->_user(), $acc['level'] === 'staff' ? $this->_role() : $acc['level']);
            if ($res['changed']) {
                // which details changed – never the health details themselves
                $this->recordAudit($acc, 'student.medical_saved', 'Health details updated', ['fields' => $res['changed']]);
            }

            return ['medical' => $res['medical']];
        });
    }

    public function medicalList()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $role = $this->_role();
            if (in_array($role, ['parent', 'student'], true) || !$this->_can('health', 'view') || !$this->_can('students', 'view')) {
                throw new \DomainException("You don't have permission to see student health details.");
            }
            $scope = [];
            if (!$this->_isOwner() && Permissions::ownClassesOnly($this->_client(), $role, $this->request->getAttribute('jwt_custom_role'))) {
                $scope = StudentLeave::teacherScope($this->_client(), $role, $this->_user());
                if (!$scope) {
                    return ['students' => []];
                }
            }
            $c = (int)$this->request->getQuery('classId');
            $s = (int)$this->request->getQuery('sectionId');
            $list = StudentRecord::medicalList($this->_client(), $c ?: null, $s ?: null, $scope);
            $this->_audit('student.medical_list', ['category' => 'records', 'entity_type' => 'class', 'entity_id' => (string)($c ?: 'all'),
                'summary' => 'Viewed health alerts list (' . count($list) . ' students)']);

            return ['students' => $list];
        });
    }

    // ── Documents ───────────────────────────────────────────────────────────

    public function uploadDocument()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'upload', 'You don\'t have permission to upload documents.');
            $file = $this->request->getData('file');
            if (!$file instanceof UploadedFileInterface) {
                throw new \InvalidArgumentException('Choose a file to upload.');
            }
            $err = $file->getError();
            if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
                throw new \InvalidArgumentException('The file is too big for the server. The limit is ' . StudentRecord::MAX_BYTES / 1048576 . ' MB.');
            }
            if ($err !== UPLOAD_ERR_OK) {
                throw new \InvalidArgumentException('The upload did not finish. Please try again.');
            }
            if ((int)$file->getSize() > StudentRecord::MAX_BYTES) {
                throw new \InvalidArgumentException('The file is too big. The limit is ' . StudentRecord::MAX_BYTES / 1048576 . ' MB.');
            }
            $tmp = StudentRecord::incomingPath();
            $file->moveTo($tmp);
            $staff = $acc['level'] === 'staff';
            $doc = StudentRecord::addDocument($this->_client(), $acc['student']['registration_id'], (array)$this->request->getData(), $tmp,
                (string)$file->getClientFilename(), $this->_user(), $staff ? $this->_role() : $acc['level'], $staff);
            $this->recordAudit($acc, 'student.document_uploaded', ($doc['replaced'] ? 'Document replaced: ' : 'Document uploaded: ') . $doc['title'] . ($staff ? '' : ' (by parent)'),
                ['type' => $doc['doc_type'], 'file' => $doc['file_name'], 'size' => $doc['size_bytes'], 'replaced_copies' => $doc['replaced']]);

            return ['document' => $doc, 'documents' => StudentRecord::documents($this->_client(), $acc['student']['registration_id'], $staff)];
        });
    }

    public function updateDocument()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'edit_documents', 'You don\'t have permission to change documents.');
            $doc = StudentRecord::updateDocument($this->_client(), $acc['student']['registration_id'], (int)$this->request->getData('id'),
                (array)$this->request->getData(), $this->_user(), (bool)$acc['can']['protect']);
            $this->recordAudit($acc, 'student.document_updated', 'Document details updated: ' . $doc['title'],
                ['type' => $doc['doc_type'], 'expires_on' => $doc['expires_on'], 'verified' => $doc['verified'], 'parent_can_see' => $doc['visible_to_parent']]);

            return ['documents' => StudentRecord::documents($this->_client(), $acc['student']['registration_id'])];
        });
    }

    public function deleteDocument()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $staff = $acc['level'] === 'staff';
            if ($staff) {
                $this->need($acc, 'delete', 'You don\'t have permission to delete documents.');
            } elseif ($acc['level'] !== 'parent') {
                throw new \DomainException('Not allowed.');
            }
            $doc = StudentRecord::deleteDocument($this->_client(), $acc['student']['registration_id'], (int)$this->request->getData('id'),
                $staff ? null : $this->_user());
            $this->recordAudit($acc, 'student.document_deleted', 'Document deleted: ' . $doc['title'], ['type' => $doc['doc_type'], 'file' => $doc['file_name']]);

            return ['documents' => StudentRecord::documents($this->_client(), $acc['student']['registration_id'], $staff)];
        });
    }

    public function downloadDocument()
    {
        $this->request->allowMethod(['get']);
        try {
            $acc = $this->acc();
            $this->need($acc, 'download', 'You don\'t have permission to open student documents.');
            [$path, $name, $mime] = StudentRecord::documentFile($this->_client(), $acc['student']['registration_id'],
                (string)$this->request->getQuery('id'), $acc['level'] === 'staff');
        } catch (\DomainException | \InvalidArgumentException $e) {
            return $this->_out(['status' => false, 'message' => $e->getMessage()], $e instanceof \DomainException ? 403 : 404);
        }
        $this->recordAudit($acc, 'student.document_opened', 'Document opened: ' . $name, null, 'privacy');
        $this->dropStrayOutput();
        $this->autoRender = false;

        return $this->response->withFile($path, ['download' => true, 'name' => $name])->withType($mime)
            ->withHeader('Cache-Control', 'private, no-store')->withHeader('X-Content-Type-Options', 'nosniff');
    }

    public function expiringDocuments()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $role = $this->_role();
            if (in_array($role, ['parent', 'student'], true) || !$this->_can('students', 'edit')
                || (!$this->_isOwner() && Permissions::ownClassesOnly($this->_client(), $role, $this->request->getAttribute('jwt_custom_role')))) {
                throw new \DomainException('Only the school office can see this list.');
            }
            $days = max(1, min(365, (int)($this->request->getQuery('days') ?: 60)));

            return ['documents' => StudentRecord::expiring($this->_client(), $days), 'days' => $days];
        });
    }

    // ── Custom fields ───────────────────────────────────────────────────────

    public function saveFields()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $acc = $this->acc();
            $this->need($acc, 'edit_fields', 'You don\'t have permission to change these details.');
            $values = $this->request->getData('values');
            if (!is_array($values)) {
                throw new \InvalidArgumentException('Nothing to save.');
            }
            $staff = $acc['level'] === 'staff';
            $res = StudentRecord::saveFieldValues($this->_client(), $acc['student']['registration_id'], $values, $this->_user(), $staff);
            if ($res['changed']) {
                $this->recordAudit($acc, 'student.fields_saved', 'Extra details updated' . ($staff ? '' : ' (by parent)'), ['fields' => $res['changed']]);
            }

            return ['fields' => $res['fields']];
        });
    }

    public function fieldDefs()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            if (in_array($this->_role(), ['parent', 'student'], true)) {
                throw new \DomainException('Not allowed.');
            }
            $all = (bool)$this->request->getQuery('all');

            return ['fields' => StudentRecord::fieldDefs($this->_client(), !$all), 'types' => StudentRecord::FIELD_TYPES,
                    'can_manage' => $this->_can('settings', 'edit')];
        });
    }

    public function saveFieldDef()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            if (!$this->_can('settings', 'edit')) {
                throw new \DomainException('Only someone who can change school settings can manage student fields.');
            }
            $res = StudentRecord::saveFieldDef($this->_client(), (array)$this->request->getData(), $this->_user());
            $f = $res['field'];
            $this->_audit($res['is_new'] ? 'student_field.created' : 'student_field.changed', ['category' => 'settings', 'entity_type' => 'custom_field',
                'entity_id' => (string)$f['id'], 'summary' => ($res['is_new'] ? 'Student field added: ' : 'Student field changed: ') . $f['label']
                . ($f['active'] ? '' : ' (hidden)'), 'changes' => $f]);

            return ['field' => $f, 'fields' => StudentRecord::fieldDefs($this->_client(), false)];
        });
    }
}
