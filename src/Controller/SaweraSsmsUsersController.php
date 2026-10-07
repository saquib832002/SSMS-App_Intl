<?php
declare(strict_types=1);

namespace App\Controller;
use Cake\Datasource\ConnectionManager;
use Cake\I18n\Date;
use Cake\Routing\Router;
use Psr\Http\Message\UploadedFileInterface;
use Cake\Log\Log;

/**
 * SaweraSsmsUsers Controller
 *
 * @property \App\Model\Table\SaweraSsmsUsersTable $SaweraSsmsUsers
 */
class SaweraSsmsUsersController extends AppController
{
    protected \App\Model\Table\SaweraSsmsUsersTable $SaweraSsmsUsers;
    protected \App\Model\Table\SsmsBranchTable $SsmsBranch;
	protected \App\Model\Table\SsmsStaffTable $SsmsStaff;

	public function beforeFilter(\Cake\Event\EventInterface $event): void
	{
		parent::beforeFilter($event);
		$this->Authentication->addUnauthenticatedActions(['login', 'sendResetPin', 'verifyResetPin']);
	}

    public function initialize(): void
{
    parent::initialize();

    $this->SsmsStaff = $this->fetchTable('SsmsStaff');
    $this->SsmsBranch = $this->fetchTable('SsmsBranch');
     $this->SaweraSsmsUsers = $this->fetchTable('SaweraSsmsUsers');
}
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $query = $this->SaweraSsmsUsers->find();
        $saweraSsmsUsers = $this->paginate($query);

        $this->set(compact('saweraSsmsUsers'));

		$session = $this->request->getSession();
        $connection = ConnectionManager::get('default');
       	if($session->read('ssms_user_role') == 'owner') {
            $saweraSsmsUsers = $connection->execute(
                "SELECT * FROM sawera_ssms_users su, ssms_branch sb WHERE su.ssms_client_code = sb.ssms_client_code AND sb.ssms_client_code = ? and su.branch_id = sb.branch_id and ssms_user_status = 'active'",
                [$session->read('ssms_client_code')]
            );

			$saweraDeactivatedUsers = $connection->execute(
                "SELECT * FROM sawera_ssms_users su, ssms_branch sb WHERE su.ssms_client_code = sb.ssms_client_code AND sb.ssms_client_code = ? and su.branch_id = sb.branch_id and ssms_user_status = 'In-active'",
                [$session->read('ssms_client_code')]
            );
			$this->set(compact('saweraSsmsUsers','saweraDeactivatedUsers'));
		}
		 else if($session->read('ssms_user_role') == 'superuser') {
            $saweraSsmsUsers = $connection->execute(
                "SELECT su.*, sb.branch_name
                 FROM sawera_ssms_users su
                 LEFT JOIN ssms_branch sb ON sb.branch_id = su.branch_id AND sb.ssms_client_code = su.ssms_client_code"
            );
		   $saweraDeactivatedUsers = $connection->execute(
                "SELECT * FROM sawera_ssms_users su, ssms_branch sb WHERE su.branch_id = sb.branch_id AND SSMS_USER_ROLE IN ('admin', 'user') and su.ssms_client_code = ? AND sb.branch_id = ? and ssms_user_status = 'In-active'",
                [$session->read('ssms_client_code'), $session->read('branch_id')]
            );
			 $this->set(compact('saweraSsmsUsers','saweraDeactivatedUsers'));
        }
        else if($session->read('ssms_user_role') == 'admin') {
               $saweraSsmsUsers = $connection->execute(
                "SELECT * FROM sawera_ssms_users su, ssms_branch sb WHERE su.branch_id = sb.branch_id AND SSMS_USER_ROLE IN ('admin', 'user') and su.ssms_client_code = ? AND sb.branch_id = ? and ssms_user_status = 'active'",
                [$session->read('ssms_client_code'), $session->read('branch_id')]
            );
			$saweraDeactivatedUsers = $connection->execute(
                "SELECT * FROM sawera_ssms_users su, ssms_branch sb WHERE su.branch_id = sb.branch_id AND SSMS_USER_ROLE IN ('admin', 'user') and su.ssms_client_code = ? AND sb.branch_id = ? and ssms_user_status = 'In-active'",
                [$session->read('ssms_client_code'), $session->read('branch_id')]
            );
			$this->set(compact('saweraSsmsUsers','saweraDeactivatedUsers'));
            }
        else if($session->read('ssms_user_role') == 'user')
        {
			 $saweraSsmsUsers = $connection->execute(
                "SELECT * FROM sawera_ssms_users su, ssms_branch sb WHERE su.branch_id = sb.branch_id AND ssms_user_name = ? and su.ssms_client_code = ? AND sb.branch_id = ?",
                [$session->read('ssms_user_name'), $session->read('ssms_client_code'), $session->read('branch_id')]
            );
			$this->set(compact('saweraSsmsUsers'));
        }
		else{

			return $this->redirect(['action' => 'login']);
		}

    }

    /**
     * View method
     *
     * @param string|null $id Sawera Ssms User id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
		$session = $this->request->getSession();
        $connection = ConnectionManager::get('default');

        // Superusers can view any user; others are scoped to their own client
        if ($session->read('ssms_user_role') === 'superuser') {
            $userDetails = $connection->execute(
                "SELECT su.*, sb.branch_name
                 FROM sawera_ssms_users su
                 LEFT JOIN ssms_branch sb ON sb.branch_id = su.branch_id AND sb.ssms_client_code = su.ssms_client_code
                 WHERE su.ssms_user_name = ?",
                [$id]
            )->fetchAll('assoc');
        } else {
            $userDetails = $connection->execute(
                "SELECT su.*, sb.branch_name
                 FROM sawera_ssms_users su
                 LEFT JOIN ssms_branch sb ON sb.branch_id = su.branch_id AND sb.ssms_client_code = su.ssms_client_code
                 WHERE su.ssms_client_code = ? AND su.ssms_user_name = ?",
                [$session->read('ssms_client_code'), $id]
            )->fetchAll('assoc');
        }
        // Pass both the full list (for foreach compatibility) and the first row as a single var
        $userDetail = $userDetails[0] ?? null;
		$this->set(compact('userDetails', 'userDetail'));
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
       $session = $this->request->getSession();
       if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner')
       {
        if($this->request->is('post')){
			$saweraSsmsUser = $this->SaweraSsmsUsers->find()->where(['ssms_user_name' => $this->request->getData('ssms_user_name')]);
   			if($saweraSsmsUser->count() > 0)
			{
				$this->Flash->error(__('User Name already exist. Please choose a different name.'));
						return $this->redirect(['action' => 'add']);
			}
            $session = $this->request->getSession();
            $username = $this->request->getData('ssms_user_name');
            $userFirstName = $this->request->getData('ssms_user_firstname');
            $userLastName = $this->request->getData('ssms_user_lastname');
			$userEmail = $this->request->getData('ssms_user_email');
			$userBranch = $this->request->getData('branch_id');
            $userRole = $this->request->getData('ssms_user_role');

            // Composite uniqueness: email + role must not already exist for this client
            $emailRoleDupe = $this->SaweraSsmsUsers->find()->where([
                'ssms_user_email'  => $userEmail,
                'ssms_user_role'   => $userRole,
                'ssms_client_code' => $session->read('ssms_client_code'),
            ]);
            if ($emailRoleDupe->count() > 0) {
                $this->Flash->error(__('A user with this email address and role already exists. Please use a different email or role.'));
                return $this->redirect(['action' => 'add']);
            }
            $userSSMSClientCode = $this->request->getData('ssms_client_code');
			$staffId = $this->request->getData('staff_id');
            $userStatus = "active";
			if($session->read('ssms_user_role') == 'admin' && $userRole == 'owner')
			{
				$this->Flash->success(__('You are not allowed to create user as Owner'));
                return $this->redirect(['action' => 'index']);
			}
            $hashFormat = '$2y$10$';
            $salt = 'iusesomecrazystrings22';
            $hashSalt = $hashFormat . $salt;
            $password = crypt($this->request->getData('ssms_user_password'), $hashSalt);
            $users_table = $this->fetchTable('SaweraSsmsUsers');
           $file   = $this->request->getData('ssms_user_image');
            $filename = "";

             if ($file instanceof UploadedFileInterface && $file->getError() === UPLOAD_ERR_OK) {

            $filename = $file->getClientFilename();
            }
            $users = $this->SaweraSsmsUsers->newEntity([]);
            $users->ssms_user_image = $filename;
            $users->ssms_user_password = $password;

            $users->ssms_client_code =  $session->read('ssms_client_code');
            $users->ssms_user_status = $userStatus;
             $data = $this->request->getData();
            unset($data['ssms_user_image']);
            $this->SaweraSsmsUsers->patchEntity($users, $data);

            if($this->SaweraSsmsUsers->save($users))
                {
                if ($file instanceof UploadedFileInterface && $file->getError() === UPLOAD_ERR_OK && $filename !== '') {
                    $uploadFolder = $_SERVER['DOCUMENT_ROOT'] ."/". "clients/" . $session->read('ssms_client_code')."/users/".$username;
                    $uploadPath   = $_SERVER['DOCUMENT_ROOT'] ."/". "clients/" . $session->read('ssms_client_code')."/users/".$username."/".$filename;
                    if (!is_dir($uploadFolder)) {
                        mkdir($uploadFolder, 0755, true);
                    }
                    $file->moveTo($uploadPath);
                }
               $this->Flash->success(__('the sawera ssms user has been saved.'));
			  return $this->redirect(['action' => 'index']);
                }

            else
                $this->Flash->error(__('The sawera ssms user could not be saved. Please, try again.'));
         }
		   else
		   {
			   $ssmsStaff = $this->fetchTable("SsmsStaff");
			   $ssmsBranch = $this->fetchTable("SsmsBranch");

			    $staffIds = $this->SsmsStaff->find()->where(['ssms_client_code' => $session->read('ssms_client_code')])->select(['staff_id', 'first_name']);
			   $ssmsBranchList = $this->SsmsBranch->find()->where(['ssms_client_code' => $session->read('ssms_client_code')])->select(['branch_id', 'branch_name']);

			    $this->set(compact('staffIds','ssmsBranchList'));

		   }
       }
        else
        {
            $this->Flash->error(__('You are not authorized to add user.'));
             return $this->redirect(['action' => 'login']);
        }

    }


	 public function addClientUser()
    {
       $session = $this->request->getSession();
       if($session->read('ssms_user_role') == 'superuser')
       {

        if($this->request->is('post')){
			$saweraSsmsUser = $this->SaweraSsmsUsers->newEmptyEntity();

			$saweraSsmsUserExs = $this->SaweraSsmsUsers->find()->where(['ssms_user_name' => $this->request->getData('ssms_user_name')]);
   			if($saweraSsmsUserExs->count() > 0)
			{
				$this->Flash->error(__('User Name already exist. Please choose a different name.'));
						return $this->redirect(['action' => 'addClientUser']);
			}
            $session = $this->request->getSession();
            $username = $this->request->getData('ssms_user_name');
            $userFirstName = $this->request->getData('ssms_user_firstname');
            $userLastName = $this->request->getData('ssms_user_lastname');
			$userEmail = $this->request->getData('ssms_user_email');
            $userRole = $this->request->getData('ssms_user_role');
            $userSSMSClientCode = $this->request->getData('ssms_client_code');
            $userStatus = 'active';
            $hashFormat = '$2y$10$';
            $salt = 'iusesomecrazystrings22';
            $hashSalt = $hashFormat . $salt;
            $password = crypt($this->request->getData('ssms_user_password'), $hashSalt);
            $saweraSsmsUser->ssms_user_name = $username;
            $saweraSsmsUser->ssms_user_password = $password;
            $saweraSsmsUser->ssms_user_firstname = $userFirstName;
            $saweraSsmsUser->ssms_user_lastname = $userLastName;
			$saweraSsmsUser->ssms_user_email = $userEmail;
			$saweraSsmsUser->branch_id = 0;
            $saweraSsmsUser->ssms_user_role = $userRole;
            $saweraSsmsUser->ssms_client_code =  $userSSMSClientCode;
            $saweraSsmsUser->ssms_user_status = $userStatus;
			$saweraSsmsUser = $this->SaweraSsmsUsers->patchEntity($saweraSsmsUser, $this->request->getData());

            if ($this->SaweraSsmsUsers->save($saweraSsmsUser))
                {
				$path = $_SERVER['DOCUMENT_ROOT'] ."/"."../clients/" . $userSSMSClientCode."/users/".$username;
				mkdir($path, 0777, true);

                $this->Flash->success(__('The sawera ssms user has been saved.'));
                return $this->redirect(['action' => 'index']);
                }

            $this->Flash->error(__('The sawera ssms user could not be saved. Please, try again.'));
         }
       }
        else
        {
             $this->Flash->error(__('You are not authorized to add user.'));
             return $this->redirect(['action' => 'login']);
        }

    }
    /**
     * Edit method
     *
     * @param string|null $id Sawera Ssms User id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
       $session = $this->request->getSession();
        if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'superuser' || $session->read('ssms_user_role') == 'owner')
            {
            // Superusers can edit any user across all clients; others are scoped to their own client
            if ($session->read('ssms_user_role') === 'superuser') {
                $saweraSsmsUser = $this->SaweraSsmsUsers->find()->where(['ssms_user_name' => $id]);
            } else {
                $saweraSsmsUser = $this->SaweraSsmsUsers->find()->where(['ssms_client_code' => $session->read('ssms_client_code'), 'ssms_user_name' => $id]);
            }
   			if($saweraSsmsUser->count() < 1)
			{
				$this->Flash->error(__('You are not authorized to do this activity.'));
						return $this->redirect(['action' => 'index']);
			}
            $isSuperuser = ($session->read('ssms_user_role') === 'superuser');

            // Resolve the actual client_code of the target user (needed for cross-client superuser edits)
            $connection = ConnectionManager::get('default');
            $targetUser = $connection->execute(
                "SELECT ssms_client_code FROM sawera_ssms_users WHERE ssms_user_name = ? LIMIT 1",
                [$id]
            )->fetch('assoc');
            $targetClientCode = $targetUser['ssms_client_code'] ?? $session->read('ssms_client_code');

            if($this->request->is('post'))
                 {
                    $username = $this->request->getData('ssms_user_name');
                    $userFirstName = $this->request->getData('ssms_user_firstname');
                    $userLastName = $this->request->getData('ssms_user_lastname');
					$userEmail = $this->request->getData('ssms_user_email');
					$userBranch = $this->request->getData('branch_id');
                    $userRole = $this->request->getData('ssms_user_role');
                    $userStatus = $this->request->getData('ssms_user_status');
					$staffId = $this->request->getData('staff_id');
				    $password = $this->request->getData('ssms_user_password');

                    // Composite uniqueness: email + role must not already belong to another user
                    $emailRoleDupe = $connection->execute(
                        "SELECT ssms_user_name FROM sawera_ssms_users
                         WHERE ssms_user_email = ? AND ssms_user_role = ? AND ssms_client_code = ? AND ssms_user_name != ? LIMIT 1",
                        [$userEmail, $userRole, $targetClientCode, $id]
                    )->fetch('assoc');
                    if ($emailRoleDupe) {
                        $this->Flash->error(__('Another user (' . $emailRoleDupe['ssms_user_name'] . ') already has this email address and role. Please use a different email or role.'));
                        return $this->redirect(['action' => 'edit', $id]);
                    }

                    $connection->execute(
                        "UPDATE sawera_ssms_users SET ssms_user_firstname = ?, ssms_user_lastname = ?, ssms_user_role = ?, ssms_user_status = ?, staff_id = ?, ssms_user_email = ? WHERE ssms_client_code = ? AND ssms_user_name = ?",
                        [$userFirstName, $userLastName, $userRole, $userStatus, $staffId, $userEmail, $targetClientCode, $id]
                    );
                    $this->Flash->success(__('User updated successfully.'));
                    return $this->redirect(['action' => 'index']);
                 }
			else {
					$users = $connection->execute(
                        "SELECT * FROM sawera_ssms_users WHERE ssms_user_name = ? AND ssms_client_code = ?",
                        [$id, $targetClientCode]
                    );
					foreach($users as $user)
						{
						$ssms_user_name = $user['ssms_user_name'];
						$ssms_user_firstname = $user['ssms_user_firstname'];
						$ssms_user_lastname = $user['ssms_user_lastname'];
						$ssms_user_email = $user['ssms_user_email'];
						$ssms_branch_id = $user['branch_id'];
						$ssms_user_role = $user['ssms_user_role'];
						$ssms_user_status = $user['ssms_user_status'];
						$ssms_staff_id = $user['staff_id'] ?? '';
						$this->set(compact('ssms_user_name','ssms_user_firstname','ssms_user_lastname','ssms_user_role','ssms_user_status','ssms_user_email','ssms_branch_id','ssms_staff_id'));

						$staffIds = $connection->execute(
								"SELECT staff_id, first_name, last_name FROM ssms_staff
								 WHERE ssms_client_code = ?
								   AND LOWER(TRIM(hired)) IN ('yes','y','1')
								   AND (resigned IS NULL OR LOWER(TRIM(resigned)) IN ('no','n','0',''))
								 ORDER BY first_name, last_name",
								[$targetClientCode]
							)->fetchAll('assoc');
						$ssmsBranchList = $this->fetchTable('SsmsBranch')->find()->where(['ssms_client_code' => $targetClientCode])->select(['branch_id', 'branch_name']);
				    	$this->set(compact('staffIds','ssmsBranchList'));
						}
				}
             	}
		else
		{
			$this->Flash->error(__('You are not authorized to do this activity.'));
						return $this->redirect(['action' => 'index']);

		}

            $this->set(compact('saweraSsmsUser'));


    }

    /**
     * Delete method
     *
     * @param string|null $id Sawera Ssms User id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    /*public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $saweraSsmsUser = $this->SaweraSsmsUsers->get($id);
        if ($this->SaweraSsmsUsers->delete($saweraSsmsUser)) {
            $this->Flash->success(__('The sawera ssms user has been deleted.'));
        } else {
            $this->Flash->error(__('The sawera ssms user could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }*/

	public function login()
	{
		$this->request->allowMethod(['get', 'post']);
		$result = $this->Authentication->getResult();
		// regardless of POST or GET, redirect if user is logged in
		if ($result && $result->isValid()) {
			 $user = $this->Authentication->getIdentity();
            \Cake\Log\Log::error("LOGIN DEBUG: status=" . ($user->ssms_user_status ?? 'NULL') . " role=" . ($user->ssms_user_role ?? 'NULL') . " client=" . ($user->ssms_client_code ?? 'NULL'));
			 // Case-insensitive status check — handles 'active', 'Active', 'ACTIVE'
			 if (strtolower(trim($user->ssms_user_status ?? '')) === 'active')
			 {
				 $session = $this->request->getSession();
				 $session->write('ssms_client_code', $user->ssms_client_code);
				 $session->write('ssms_user_name', $user->ssms_user_name);
				 $session->write('ssms_user_firstname', $user->ssms_user_firstname);
				 $session->write('ssms_user_role', $user->ssms_user_role);
				 $session->write('ssms_user_image', $user->ssms_user_image);
				 $session->write('ssms_user_email', $user->ssms_user_email);
				 $session->write('branch_id', $user->branch_id);
				 $session->write('staff_id', $user->staff_id);
				 $connection = ConnectionManager::get('default');
				 $results = $connection->execute(
                     "SELECT * FROM ssms_clients where ssms_client_code = ?",
                     [$user->ssms_client_code]
                 )->fetchAll('assoc');
				 foreach($results as $row) {
					$session->write('expiry_date', $row['ssms_client_expiry_date']);
					$session->write('ssms_client_header_text', $row['ssms_client_header_text']);
					$session->write('logo_name', $row['logo_name']);
					}

				 // Load active modules — wrapped in try/catch in case table not yet migrated in prod
				 try {
				     $moduleRows = $connection->execute(
				         "SELECT module_key FROM ssms_client_modules WHERE ssms_client_code = ?",
				         [$user->ssms_client_code]
				     )->fetchAll('assoc');
				     $activeModules = array_column($moduleRows, 'module_key');
				 } catch (\Exception $e) {
				     $activeModules = [];
				 }
				 if (empty($activeModules)) {
				     $activeModules = ['school']; // safe fallback
				 }
				 $session->write('active_modules', $activeModules);

				$valid_till = $session->read('expiry_date');
				// Guard against null/empty expiry date in prod
				if (empty($valid_till)) {
					$userRole = $session->read('ssms_user_role');
					if (in_array($userRole, ['Student', 'Parent'], true)) {
						return $this->redirect(['controller' => 'StudentPortal', 'action' => 'dashboard']);
					}
					return $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
				}
				$dt   = new Date($valid_till);
				$date = $dt->format('Y-m-d');
				if ($date >= date('Y-m-d')) {
					$userRole = $session->read('ssms_user_role');
					if (in_array($userRole, ['Student', 'Parent'], true)) {
						return $this->redirect(['controller' => 'StudentPortal', 'action' => 'dashboard']);
					}
					return $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
				} else {
					$this->Flash->error(__('User licence has expired. Please renew your license.'));
					return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'logout']);
				}
			  }
			 else {
				$session = $this->request->getSession();
				$session->destroy();
				$this->Flash->error(__('You are not allowed to login. Please contact adminitrator.'));
			}


		}


			// redirect to /articles after login success


		// display error if user submitted and authentication failed
		if ($this->request->is('post') && !$result->isValid()) {
			$this->Flash->error(__('Invalid username or password'));
		}
	}

	public function logout()
	{


		 $session = $this->request->getSession();
         $this->Flash->success('You are now logged out.');
         $session->delete('ssms_client_code');
         $session->delete('ssms_user_firstname');
         $session->delete('ssms_user_role');
         $session->delete('session_start_month');
         $session->delete('expiry_date');
         $session->delete('ssms_client_header_text');
         $session->delete('logo_name');
		 $session->delete('staff_id');
		 $session->delete('branch_id');
		 $session->destroy();
		 $this->Authentication->logout();

     return $this->redirect(['controller'=>'SaweraSsmsUsers', 'action'=>'login']);
	}

	public function delete($id = null)
    {
         $session = $this->request->getSession();
        if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner')
            {
               $connection = ConnectionManager::get('default');
               $connection->execute(
                   "UPDATE sawera_ssms_users SET ssms_user_status = 'In-active' where ssms_client_code = ? AND ssms_user_name = ?",
                   [$session->read('ssms_client_code'), $id]
               );

               $this->Flash->error(__('User de-activated successfully.'));
               return $this->redirect(['action' => 'index']);
             }
           else
            {
                $this->Flash->error(__('You are not authorized to do this activity.'));
                 return $this->redirect(['action' => 'login']);
              }
    }

	public function activate($id = null)
    {
         $session = $this->request->getSession();
        if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner')
            {
               $connection = ConnectionManager::get('default');
               $connection->execute(
                   "UPDATE sawera_ssms_users SET ssms_user_status = 'active' where ssms_client_code = ? AND ssms_user_name = ?",
                   [$session->read('ssms_client_code'), $id]
               );

                        $this->Flash->error(__('User activated successfully.'));
                        return $this->redirect(['action' => 'index']);
             }
           else
            {
                $this->Flash->error(__('You are not authorized to do this activity.'));
                 return $this->redirect(['action' => 'login']);
              }
    }

	public function changePassword()
    {
       $session = $this->request->getSession();

        if($this->request->is('post')){
            $session = $this->request->getSession();
            $username = $this->request->getData('ssms_user_name');
            $hashFormat = '$2y$10$';
            $salt = 'iusesomecrazystrings22';
            $hashSalt = $hashFormat . $salt;
            $password = crypt($this->request->getData('ssms_user_password'), $hashSalt);
            $newPassword = crypt($this->request->getData('new_password'), $hashSalt);
            $saweraSsmsUser = $this->SaweraSsmsUsers->find()->where(['ssms_client_code' => $session->read('ssms_client_code'), 'ssms_user_name' => $username, 'ssms_user_password' => $password]);
            $userCount = $saweraSsmsUser->count();
            if($userCount >= 1)
                {

                    $connection = ConnectionManager::get('default');
                    $results = $connection->execute(
                        "UPDATE sawera_ssms_users SET ssms_user_password = ? where ssms_client_code = ? AND ssms_user_name = ?",
                        [$newPassword, $session->read('ssms_client_code'), $username]
                    );
                    $this->Flash->success(__('The user password has been changed.'));
                        return $this->redirect(['action' => 'index']);
            }
            else
            {
              $this->Flash->error(__('The user not found. Please check the entered user name and password.'));

            }
         }

    }

	public function profile($id = null)
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $connection = ConnectionManager::get('default');

        // Username to view/edit — URL param, or fall back to logged-in user
        $targetUser = $id ?: $session->read('ssms_user_name');

        // ── POST/PUT: save changes (Form helper injects _method=PUT for existing entities) ──
        if ($this->request->is(['post', 'put', 'patch'])) {
            $username  = $session->read('ssms_user_name');
            $userFname = $this->request->getData('ssms_user_firstname');
            $userLname = $this->request->getData('ssms_user_lastname');

            // Verify current password before saving
            $hashSalt  = '$2y$10$iusesomecrazystrings22';
            $password  = crypt($this->request->getData('ssms_user_password'), $hashSalt);
            $userCount = $this->SaweraSsmsUsers->find()
                ->where(['ssms_client_code' => $clientCode, 'ssms_user_name' => $username, 'ssms_user_password' => $password])
                ->count();

            if ($userCount >= 1) {
                $photoFile = $this->request->getData('ssms_user_image');
                $hasNewPhoto = ($photoFile instanceof \Psr\Http\Message\UploadedFileInterface)
                    && $photoFile->getError() === UPLOAD_ERR_OK
                    && $photoFile->getClientFilename() !== '';

                if ($hasNewPhoto) {
                    $photoName  = basename($photoFile->getClientFilename());
                    // Build path the same way add() does — no trailing slash on dir
                    $uploadDir  = $_SERVER['DOCUMENT_ROOT'] . DIRECTORY_SEPARATOR . 'clients'
                                  . DIRECTORY_SEPARATOR . $clientCode
                                  . DIRECTORY_SEPARATOR . 'users'
                                  . DIRECTORY_SEPARATOR . $username;
                    $uploadPath = $uploadDir . DIRECTORY_SEPARATOR . $photoName;

                    // Create full directory tree if it doesn't exist
                    if (!is_dir($uploadDir)) {
                        mkdir($uploadDir, 0755, true);
                    }

                    // Delete any existing files in the user's photo folder
                    $existing = glob($uploadDir . DIRECTORY_SEPARATOR . '*');
                    if (is_array($existing)) {
                        foreach ($existing as $existingFile) {
                            if (is_file($existingFile)) {
                                unlink($existingFile);
                            }
                        }
                    }

                    try {
                        $photoFile->moveTo($uploadPath);
                        // Only update DB if file was actually saved
                        $connection->execute(
                            "UPDATE sawera_ssms_users SET ssms_user_firstname = ?, ssms_user_lastname = ?, ssms_user_image = ? WHERE ssms_client_code = ? AND ssms_user_name = ?",
                            [$userFname, $userLname, $photoName, $clientCode, $username]
                        );
                        $this->Flash->success(__('Profile updated successfully.'));
                    } catch (\Exception $e) {
                        \Cake\Log\Log::error('Profile photo upload failed: ' . $e->getMessage() . ' | path: ' . $uploadPath);
                        $this->Flash->error(__('Photo upload failed: ' . $e->getMessage()));
                    }
                } else {
                    // No new photo — update names only
                    $connection->execute(
                        "UPDATE sawera_ssms_users SET ssms_user_firstname = ?, ssms_user_lastname = ? WHERE ssms_client_code = ? AND ssms_user_name = ?",
                        [$userFname, $userLname, $clientCode, $username]
                    );
                    $this->Flash->success(__('Profile updated successfully.'));
                }
                return $this->redirect(['action' => 'profile', $targetUser]);
            } else {
                $this->Flash->error(__('Password is incorrect. Please try again.'));
                // fall through to re-render form with current data
            }
        }

        // ── GET (or failed POST): load user for display ───────────────────────
        $row = $connection->execute(
            "SELECT * FROM sawera_ssms_users WHERE ssms_client_code = ? AND ssms_user_name = ? LIMIT 1",
            [$clientCode, $targetUser]
        )->fetchAssoc();

        // Safe defaults — prevent undefined-variable warnings in the template
        $ssms_user_firstname  = $row['ssms_user_firstname']  ?? '';
        $ssms_user_lastname   = $row['ssms_user_lastname']   ?? '';
        $ssms_user_image_path = ($row['ssms_user_image'] ?? '')
            ? '/clients/' . $clientCode . '/users/' . $targetUser . '/' . $row['ssms_user_image']
            : null;

        $saweraSsmsUser = $this->SaweraSsmsUsers->find()
            ->where(['ssms_client_code' => $clientCode, 'ssms_user_name' => $targetUser])
            ->first();

        $this->set(compact('saweraSsmsUser', 'ssms_user_firstname', 'ssms_user_lastname', 'ssms_user_image_path'));
    }

    // ── Step 1: validate user, generate PIN, email it ──────────────────────
    public function sendResetPin()
    {
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->setClassName('Json');

        $username  = trim((string)$this->request->getData('ssms_user_name', ''));
        $userEmail = trim((string)$this->request->getData('ssms_user_email', ''));

        if (!$username || !$userEmail) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'Username and email are required.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        $userCount = $this->SaweraSsmsUsers->find()
            ->where(['ssms_user_name' => $username, 'ssms_user_email' => $userEmail])
            ->count();

        if ($userCount < 1) {
            $this->response = $this->response->withStatus(404);
            $this->set(['success' => false, 'message' => 'No account found with that username and email address.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        // Generate 6-digit PIN and store in session for 15 minutes
        $pin = (string)rand(100000, 999999);
        $session = $this->request->getSession();
        $session->write('fp_pin',      $pin);
        $session->write('fp_username', $username);
        $session->write('fp_email',    $userEmail);
        $session->write('fp_expires',  time() + 900);

        try {
            $html = "
            <div style='font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;
                        background:#f8faff;border-radius:16px;'>
              <div style='text-align:center;margin-bottom:24px'>
                <div style='display:inline-block;background:linear-gradient(135deg,#2f7ef5,#1355c1);
                            border-radius:14px;padding:14px 18px;'>
                  <span style='font-size:28px;color:#fff'>&#128274;</span>
                </div>
              </div>
              <h2 style='color:#0b1f4b;text-align:center;margin:0 0 8px'>Password Reset PIN</h2>
              <p style='color:#64748b;text-align:center;margin:0 0 24px'>Hi <strong>{$username}</strong>,<br>
                 Use the PIN below to reset your ManageMyAcademy password.</p>
              <div style='font-size:40px;font-weight:800;letter-spacing:10px;color:#2f7ef5;
                          background:#eff6ff;border:2px dashed #bfdbfe;border-radius:14px;
                          padding:22px 12px;text-align:center;margin:0 0 24px'>
                {$pin}
              </div>
              <p style='color:#94a3b8;font-size:12px;text-align:center;margin:0'>
                This PIN expires in <strong>15 minutes</strong>. Do not share it with anyone.<br>
                If you did not request this, please ignore the email.
              </p>
            </div>";

            $mailer = new \Cake\Mailer\Mailer('default');
            $mailer->setFrom(['admin@managemyacademy.com' => 'SAWERA SSMS'])
                   ->setTo($userEmail)
                   ->setSubject('Your ManageMyAcademy Password Reset PIN')
                   ->setEmailFormat('html')
                   ->deliver($html);

            $this->set(['success' => true, 'message' => 'PIN sent to ' . $userEmail]);
        } catch (\Exception $e) {
            \Cake\Log\Log::error('sendResetPin email failed: ' . $e->getMessage());
            $this->response = $this->response->withStatus(502);
            $this->set(['success' => false, 'message' => 'Could not send email. Please try again later.']);
        }

        $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    }

    // ── Step 2: verify PIN and set new password ──────────────────────────────
    public function verifyResetPin()
    {
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->setClassName('Json');

        $pin         = trim((string)$this->request->getData('pin', ''));
        $newPassword = trim((string)$this->request->getData('new_password', ''));
        $confirmPass = trim((string)$this->request->getData('confirm_password', ''));

        $session       = $this->request->getSession();
        $storedPin     = (string)$session->read('fp_pin');
        $storedUser    = (string)$session->read('fp_username');
        $storedEmail   = (string)$session->read('fp_email');
        $storedExpires = (int)$session->read('fp_expires');

        if (!$storedPin) {
            $this->response = $this->response->withStatus(400);
            $this->set(['success' => false, 'message' => 'No PIN request found. Please start over.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        if (time() > $storedExpires) {
            $session->delete('fp_pin');
            $this->response = $this->response->withStatus(400);
            $this->set(['success' => false, 'message' => 'PIN has expired. Please request a new one.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        if ($pin !== $storedPin) {
            $this->response = $this->response->withStatus(400);
            $this->set(['success' => false, 'message' => 'Invalid PIN. Please check your email and try again.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        if (strlen($newPassword) < 6) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'Password must be at least 6 characters.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        if ($newPassword !== $confirmPass) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'Passwords do not match.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        $hashSalt   = '$2y$10$' . 'iusesomecrazystrings22';
        $newHash    = crypt($newPassword, $hashSalt);

        $connection = ConnectionManager::get('default');
        $connection->execute(
            "UPDATE sawera_ssms_users SET ssms_user_password = ? WHERE ssms_user_name = ? AND ssms_user_email = ?",
            [$newHash, $storedUser, $storedEmail]
        );

        // Clear PIN from session
        $session->delete('fp_pin');
        $session->delete('fp_username');
        $session->delete('fp_email');
        $session->delete('fp_expires');

        $this->set(['success' => true, 'message' => 'Password reset successfully. You can now log in.']);
        $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    }

    // ── Legacy redirect (kept for any bookmarked links) ──────────────────────
    public function resetPassword()
    {
        return $this->redirect(['action' => 'login']);
    }
}
?>
