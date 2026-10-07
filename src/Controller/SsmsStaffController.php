<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Psr\Http\Message\UploadedFileInterface;

/**
 * SsmsStaff Controller
 *
 * @property \App\Model\Table\SsmsStaffTable $SsmsStaff
 */
class SsmsStaffController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $query      = $this->SsmsStaff->find()->where(['ssms_client_code' => $clientCode, 'hired !=' => 'yes']);
        $ssmsStaff  = $this->paginate($query);

        $this->set(compact('ssmsStaff'));
    }

    /**
     * Staffs — client-scoped staff listing with role-based filtering.
     */
    public function staffs()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $userRole   = strtolower(trim((string)$session->read('ssms_user_role')));
        $branchId   = $session->read('branch_id');
        $connection = ConnectionManager::get('default');

        if ($userRole === 'owner' || $userRole === 'superuser') {
            // All staff for this client
            $staffList = $connection->execute(
                "SELECT s.*, sc.category_name, sb.branch_name
                 FROM ssms_staff s
                 LEFT JOIN staff_category sc ON sc.category_id = s.category_id AND sc.ssms_client_code = s.ssms_client_code
                 LEFT JOIN ssms_branch sb ON sb.branch_id = s.branch_id AND sb.ssms_client_code = s.ssms_client_code
                 WHERE s.ssms_client_code = ?
                 ORDER BY s.first_name, s.last_name",
                [$clientCode]
            )->fetchAll('assoc');
        } elseif ($userRole === 'admin') {
            // Staff in the admin's branch only
            $staffList = $connection->execute(
                "SELECT s.*, sc.category_name, sb.branch_name
                 FROM ssms_staff s
                 LEFT JOIN staff_category sc ON sc.category_id = s.category_id AND sc.ssms_client_code = s.ssms_client_code
                 LEFT JOIN ssms_branch sb ON sb.branch_id = s.branch_id AND sb.ssms_client_code = s.ssms_client_code
                 WHERE s.ssms_client_code = ? AND s.branch_id = ?
                 ORDER BY s.first_name, s.last_name",
                [$clientCode, $branchId]
            )->fetchAll('assoc');
        } else {
            $this->Flash->error(__('You are not authorized to view staff.'));
            return $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
        }

        $this->set(compact('staffList', 'clientCode'));
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Staff id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsStaff = $this->SsmsStaff->get($id, contain: []);
        $this->set(compact('ssmsStaff'));
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
        $ssmsStaff = $this->SsmsStaff->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsStaff = $this->SsmsStaff->patchEntity($ssmsStaff, $this->request->getData());
            if ($this->SsmsStaff->save($ssmsStaff)) {
                $this->Flash->success(__('The ssms staff has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms staff could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsStaff'));
    }

    /**
     * registerStaff — full staff registration with file uploads, role guard,
     * and client-code isolation from session.
     */
    public function registerStaff()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $userRole   = strtolower(trim((string)$session->read('ssms_user_role')));

        if (!in_array($userRole, ['admin', 'owner', 'superuser'])) {
            $this->Flash->error(__('You are not authorized to register staff.'));
            return $this->redirect(['action' => 'index']);
        }

        $connection = ConnectionManager::get('default');

        // Load dropdowns
        $categories = $connection->execute(
            "SELECT category_id, category_name FROM staff_category WHERE ssms_client_code = ? ORDER BY category_name",
            [$clientCode]
        )->fetchAll('assoc');

        $branches = $connection->execute(
            "SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = ? ORDER BY branch_name",
            [$clientCode]
        )->fetchAll('assoc');

        if ($this->request->is('post')) {
            $data = $this->request->getData();

            // Helper: move an uploaded file, return saved filename or ''
            $moveFile = function (string $field, string $staffDir) use ($data): string {
                $file = $data[$field] ?? null;
                if (!($file instanceof UploadedFileInterface) || $file->getError() !== UPLOAD_ERR_OK) {
                    return '';
                }
                $filename = basename($file->getClientFilename());
                if (!$filename) return '';
                if (!is_dir($staffDir)) mkdir($staffDir, 0755, true);
                $file->moveTo($staffDir . DIRECTORY_SEPARATOR . $filename);
                return $filename;
            };

            // Insert core record first to get the auto-increment staff_id
            $connection->execute(
                "INSERT INTO ssms_staff
                    (ssms_client_code, staff_title, first_name, last_name, gender,
                     date_of_birth, father_name, mother_name, email_address,
                     mobile_number, address, state, specialty, category_id,
                     date_of_hiring, years_of_experience, salary, branch_id,
                     hired, resigned, resignation_date,
                     staff_photo, id_proof, address_proof, experience_letter)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    $clientCode,
                    $data['staff_title']          ?? '',
                    $data['first_name']            ?? '',
                    $data['last_name']             ?? '',
                    $data['gender']                ?? '',
                    $data['date_of_birth']         ?: null,
                    $data['father_name']           ?? '',
                    $data['mother_name']           ?? '',
                    $data['email_address']         ?? '',
                    $data['mobile_number']         ?? '',
                    $data['address']               ?? '',
                    $data['state']                 ?? '',
                    $data['specialty']             ?? '',
                    $data['category_id']           ?? 0,
                    $data['date_of_hiring']        ?: null,
                    $data['years_of_experience']   ?? 0,
                    $data['salary']                ?? 0,
                    $data['branch_id']             ?? 0,
                    $data['hired']                 ?? 'no',
                    $data['resigned']              ?? null,
                    $data['resignation_date']      ?: null,
                    '', '', '', ''   // placeholders — updated below after upload
                ]
            );

            $staffId  = $connection->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'];
            $staffDir = $_SERVER['DOCUMENT_ROOT']
                . DIRECTORY_SEPARATOR . 'clients'
                . DIRECTORY_SEPARATOR . $clientCode
                . DIRECTORY_SEPARATOR . 'staff'
                . DIRECTORY_SEPARATOR . $staffId;

            $photoName   = $moveFile('staff_photo',       $staffDir);
            $idProof     = $moveFile('id_proof',          $staffDir);
            $addrProof   = $moveFile('address_proof',     $staffDir);
            $expLetter   = $moveFile('experience_letter', $staffDir);

            // Update file columns now that we have paths
            $connection->execute(
                "UPDATE ssms_staff SET staff_photo = ?, id_proof = ?, address_proof = ?, experience_letter = ?
                 WHERE staff_id = ?",
                [$photoName, $idProof, $addrProof, $expLetter, $staffId]
            );

            $this->Flash->success(__('Staff member registered successfully.'));
            return $this->redirect(['action' => 'index']);
        }

        $this->set(compact('categories', 'branches', 'clientCode'));
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Staff id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $connection = ConnectionManager::get('default');

        // ORM entity — used by FormHelper for field pre-population and form URL
        $ssmsStaff = $this->SsmsStaff->get($id, contain: []);

        if ($this->request->is(['patch', 'post', 'put'])) {
            $data = $this->request->getData();

            // Helper: move uploaded file, return saved filename or false (no upload)
            $moveFile = function (string $field, string $staffDir) use ($data): string|false {
                $file = $data[$field] ?? null;
                if (!($file instanceof \Psr\Http\Message\UploadedFileInterface) || $file->getError() !== UPLOAD_ERR_OK) {
                    return false; // no new upload
                }
                $filename = basename($file->getClientFilename());
                if (!$filename) return false;
                if (!is_dir($staffDir)) mkdir($staffDir, 0755, true);
                $file->moveTo($staffDir . DIRECTORY_SEPARATOR . $filename);
                return $filename;
            };

            $staffDir = $_SERVER['DOCUMENT_ROOT']
                . DIRECTORY_SEPARATOR . 'clients'
                . DIRECTORY_SEPARATOR . $clientCode
                . DIRECTORY_SEPARATOR . 'staff'
                . DIRECTORY_SEPARATOR . $id;

            $photoName  = $moveFile('staff_photo',       $staffDir);
            $idProof    = $moveFile('id_proof',          $staffDir);
            $addrProof  = $moveFile('address_proof',     $staffDir);
            $expLetter  = $moveFile('experience_letter', $staffDir);

            // Keep existing file values if no new file was uploaded
            $finalPhoto   = $photoName  !== false ? $photoName  : ($ssmsStaff->staff_photo      ?? '');
            $finalIdProof = $idProof    !== false ? $idProof    : ($ssmsStaff->id_proof          ?? '');
            $finalAddr    = $addrProof  !== false ? $addrProof  : ($ssmsStaff->address_proof     ?? '');
            $finalExp     = $expLetter  !== false ? $expLetter  : ($ssmsStaff->experience_letter ?? '');

            $connection->execute(
                "UPDATE ssms_staff SET
                    staff_title       = ?,
                    first_name        = ?,
                    last_name         = ?,
                    gender            = ?,
                    date_of_birth     = ?,
                    father_name       = ?,
                    mother_name       = ?,
                    email_address     = ?,
                    mobile_number     = ?,
                    address           = ?,
                    state             = ?,
                    specialty         = ?,
                    category_id       = ?,
                    date_of_hiring    = ?,
                    years_of_experience = ?,
                    salary            = ?,
                    branch_id         = ?,
                    hired             = ?,
                    resigned          = ?,
                    resignation_date  = ?,
                    staff_photo       = ?,
                    id_proof          = ?,
                    address_proof     = ?,
                    experience_letter = ?
                 WHERE staff_id = ? AND ssms_client_code = ?",
                [
                    $data['staff_title']         ?? '',
                    $data['first_name']           ?? '',
                    $data['last_name']            ?? '',
                    $data['gender']               ?? '',
                    !empty($data['date_of_birth'])     ? $data['date_of_birth']     : null,
                    $data['father_name']          ?? '',
                    $data['mother_name']          ?? '',
                    $data['email_address']        ?? '',
                    $data['mobile_number']        ?? '',
                    $data['address']              ?? '',
                    $data['state']                ?? '',
                    $data['specialty']            ?? '',
                    !empty($data['category_id'])       ? (int)$data['category_id']       : null,
                    !empty($data['date_of_hiring'])    ? $data['date_of_hiring']    : null,
                    $data['years_of_experience']  ?? 0,
                    $data['salary']               ?? 0,
                    !empty($data['branch_id'])         ? (int)$data['branch_id']         : null,
                    $data['hired']                ?? '',
                    $data['resigned']             ?? null,
                    !empty($data['resignation_date'])  ? $data['resignation_date']  : null,
                    $finalPhoto,
                    $finalIdProof,
                    $finalAddr,
                    $finalExp,
                    $id,
                    $clientCode,
                ]
            );

            $this->Flash->success(__('Staff record updated successfully.'));
            return $this->redirect(['action' => 'staffs']);
        }

        $categoryRows = $connection->execute(
            "SELECT category_id, category_name FROM staff_category
             WHERE ssms_client_code = ? ORDER BY category_name",
            [$clientCode]
        )->fetchAll('assoc');
        $categories = array_column($categoryRows, 'category_name', 'category_id');

        $branchRows = $connection->execute(
            "SELECT branch_id, branch_name FROM ssms_branch
             WHERE ssms_client_code = ? ORDER BY branch_name",
            [$clientCode]
        )->fetchAll('assoc');
        $branches = array_column($branchRows, 'branch_name', 'branch_id');

        $this->set(compact('ssmsStaff', 'categories', 'branches'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Staff id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsStaff = $this->SsmsStaff->get($id);
        if ($this->SsmsStaff->delete($ssmsStaff)) {
            $this->Flash->success(__('The ssms staff has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms staff could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
