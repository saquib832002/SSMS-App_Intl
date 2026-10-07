<?php
declare(strict_types=1);

namespace App\Controller;
use Cake\Datasource\ConnectionManager; 
/**
 * SsmsSessions Controller
 *
 * @property \App\Model\Table\SsmsSessionsTable $SsmsSessions
 */
class SsmsSessionsController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $session = $this->request->getSession();
        if($session->read('ssms_client_code') != "")
        {

        $ssmsSessions = $this->paginate($this->SsmsSessions->find()->where(['ssms_client_code' => $session->read('ssms_client_code')]));

        $this->set(compact('ssmsSessions'));
        }
        else
        {
           return $this->redirect(['controller'=>'Users', 'action'=>'login']); 
        }
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Session id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $session = $this->request->getSession();
        if ($session->read('ssms_client_code') != '') {
            $ssmsSession = $this->SsmsSessions->get($id, contain: []);
            $this->set('ssmsSession', $ssmsSession);
        } else {
            return $this->redirect(['controller' => 'Users', 'action' => 'login']);
        }
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
            $ssmsSession = $this->SsmsSessions->newEmptyEntity();
            if ($this->request->is('post')) {
				$data = $this->request->getData();
                $data['ssms_client_code'] = $session->read('ssms_client_code');
               // unset($this->request->data[$this->ssms_client_code][$session->read('ssms_client_code')]);
                //Log::write('debug', 'Session form data   '. print_r($this->request->data));

                $ssmsSession = $this->SsmsSessions->patchEntity($ssmsSession, $data);
				//dump($ssmsSession);
				
				
				try {
					$this->SsmsSessions->save($ssmsSession);
					$this->Flash->success(__('The ssms session has been saved.'));
					return $this->redirect(['action' => 'add']);
				}
				catch(\Exception $e) {
					 $this->Flash->success(__('The session could not be saved. May be this session is already exist.'));
					dump($e);

                    return $this->redirect(['action' => 'add']);
				}
				
				
				
//                if ($this->SsmsSessions->save($ssmsSession)) {
//                    $this->Flash->success(__('The session has been saved.'));
//
//                    //return $this->redirect(['action' => 'index']);
//                }
//                else
//                {
//                $this->Flash->error(__('The session could not be saved. Please, try again.'));
//                }
            }
        
            $ssmsSessionsList = $this->SsmsSessions->find()->where(['ssms_client_code' => $session->read('ssms_client_code')]);
            $this->set(compact('ssmsSession', 'ssmsSessionsList'));
             
         }
        else
        {
            
            $this->Flash->error(__('You dont have permission to view this page.'));
            return $this->redirect(['action' => 'index']);
        }
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Session id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $ssmsSession = $this->SsmsSessions->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsSession = $this->SsmsSessions->patchEntity($ssmsSession, $this->request->getData());
            if ($this->SsmsSessions->save($ssmsSession)) {
                $this->Flash->success(__('The ssms session has been saved.'));

                return $this->redirect(['action' => 'add']);
            }
            $this->Flash->error(__('The ssms session could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsSession'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Session id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsSession = $this->SsmsSessions->get($id);
        if ($this->SsmsSessions->delete($ssmsSession)) {
            $this->Flash->success(__('The ssms session has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms session could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
	
	public function makeCurrentSession($id = null)
    {
		$session = $this->request->getSession();

        $ssmsSession = $this->SsmsSessions->get($id);
		$connection = ConnectionManager::get('default');
				$connection->execute(
			"UPDATE ssms_sessions SET is_current = 'N' WHERE is_current = 'Y' AND ssms_client_code = ?",
			[$session->read('ssms_client_code')]
		);
		if ($connection->execute(
			"UPDATE ssms_sessions SET is_current = 'Y' WHERE ssms_client_code = ? AND session_id = ?",
			[$session->read('ssms_client_code'), $id]
		)) {
            $this->Flash->success(__('The session has been updated to current session.'));
        } else {
            $this->Flash->error(__('The session could not be updated. Please, try again.'));
        }

        return $this->redirect(['action' => 'add']);
    }
}
