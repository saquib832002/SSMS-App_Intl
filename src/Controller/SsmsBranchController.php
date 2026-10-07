<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\ORM\Table;
/**
 * SsmsBranch Controller
 *
 * @property \App\Model\Table\SsmsBranchTable $SsmsBranch
 */
class SsmsBranchController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
	

    public function index()
    {
		$session = $this->request->getSession();
        $query = $this->SsmsBranch->find()->where(['ssms_client_code' => $session->read('ssms_client_code')]);
        $ssmsBranch = $this->paginate($query);
		//print_r($query);
        $this->set(compact('ssmsBranch'));
    }

    /**
     * Setup method — renders the setup/admin menu dashboard
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function setup()
    {
        // No data needed — all navigation links are static
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Branch id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsBranch = $this->SsmsBranch->get($id, contain: []);
        $this->set(compact('ssmsBranch'));
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
				$ssmsBranch = $this->SsmsBranch->newEmptyEntity();
				if ($this->request->is('post')) {
					$data = array_merge($this->request->getData(), ['ssms_client_code' => $session->read('ssms_client_code')]);
					$ssmsBranch = $this->SsmsBranch->patchEntity($ssmsBranch, $data);
					if ($this->SsmsBranch->save($ssmsBranch)) {
						$this->Flash->success(__('The ssms branch has been saved.'));

					   return $this->redirect(['action' => 'add']);
					}
					$this->Flash->error(__('The ssms branch could not be saved. May be Branch Name already exist. Please, try again.'));
				}
        
				$query = $this->SsmsBranch->find()->where(['ssms_client_code' => $session->read('ssms_client_code')]);
				$ssmsBranchList = $this->paginate($query);
        		//$ssmsBranchList = $this->paginate($query, [
    			//'limit' => 10,
    			//'order' => ['SsmsBranch.created' => 'desc']]);

				  //  $staffCategoryList = $this->paginate($this->StaffCategory);
				$this->set(compact('ssmsBranchList'));
				}
		else
			 {
                $this->Flash->error(__('You are not authorized to do this activity.'));
                 return $this->redirect(['controller'=>'SaweraSsmsUsers', 'action' => 'login']);
            }
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Branch id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $ssmsBranch = $this->SsmsBranch->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsBranch = $this->SsmsBranch->patchEntity($ssmsBranch, $this->request->getData());
            if ($this->SsmsBranch->save($ssmsBranch)) {
                $this->Flash->success(__('The ssms branch has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms branch could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsBranch'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Branch id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsBranch = $this->SsmsBranch->get($id);
        if ($this->SsmsBranch->delete($ssmsBranch)) {
            $this->Flash->success(__('The ssms branch has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms branch could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
