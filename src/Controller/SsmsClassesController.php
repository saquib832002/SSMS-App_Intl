<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * SsmsClasses Controller
 *
 * @property \App\Model\Table\SsmsClassesTable $SsmsClasses
 */
class SsmsClassesController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $session = $this->request->getSession();
         if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner')
         {
            $session = $this->request->getSession();
            $ssmsClasses = $this->paginate($this->SsmsClasses->find()->where(['ssms_client_code' => $session->read('ssms_client_code')]));

        $this->set(compact('ssmsClasses'));
         }
        else
        {
            $this->Flash->error(__('You dont have permission to view this page.'));
             return $this->redirect(['controller'=>'SaweraSsmsUsers', 'action' => 'login']);
        }
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Class id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsClass = $this->SsmsClasses->get($id, [
            'contain' => []
        ]);

        $this->set('ssmsClass', $ssmsClass);
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
            $ssmsClass = $this->SsmsClasses->newEmptyEntity();
            if ($this->request->is('post')) {
				$data = $this->request->getData();
                $data['ssms_client_code'] = $session->read('ssms_client_code');
                $ssmsClass = $this->SsmsClasses->patchEntity($ssmsClass, $data);
				
				try{
					$this->SsmsClasses->save($ssmsClass);
					$this->Flash->success(__('The class has been saved.'));

                    return $this->redirect(['action' => 'index']);
				}
                catch(\Exception $e)
				{
					 $this->Flash->error(__('The class could not be saved. This may have already exist. Please, try again.'));
				}
				
				
//                if ($this->SsmsClasses->save($ssmsClass)) {
//                    $this->Flash->success(__('The ssms class has been saved.'));
//
//                    return $this->redirect(['action' => 'add']);
//                }
//                else {
//                $this->Flash->error(__('The ssms class could not be saved. Please, try again.'));
//                }
            }
            $ssmsClassesList = $this->paginate($this->SsmsClasses->find()->where(['ssms_client_code' => $session->read('ssms_client_code')]));
            $this->set(compact('ssmsClass','ssmsClassesList'));
         }
         else
        {
            $this->Flash->error(__('You dont have permission to view this page.'));
             return $this->redirect(['controller'=>'SaweraSsmsUsers','action' => 'index']);
        }
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Class id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
         $session = $this->request->getSession();
			 $ssmsClass = $this->SsmsClasses->find()->where(['ssms_client_code' => $session->read('ssms_client_code'), 'class_id' => $id]);
			 if($ssmsClass->count() > 0 && ($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner'))
			{
            	$ssmsClass = $this->SsmsClasses->get($id, [
                'contain' => []
				]);
            	if ($this->request->is(['patch', 'post', 'put'])) {
                $ssmsClass = $this->SsmsClasses->patchEntity($ssmsClass, $this->request->getData());
				try{
					$this->SsmsClasses->save($ssmsClass);
					$this->Flash->success(__('The class has been saved.'));

                    return $this->redirect(['action' => 'index']);
				}
                catch(\Exception $e)
				{
					 $this->Flash->error(__('The class could not be saved. This may have already exist. Please, try again.'));
				}
               
            }
            $this->set(compact('ssmsClass'));
         }
         else
        {
            $this->Flash->error(__('You dont have permission to view this page.'));
             return $this->redirect(['controller'=>'SaweraSsmsUsers','action' => 'index']);
        }
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Class id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsClass = $this->SsmsClasses->get($id);
        if ($this->SsmsClasses->delete($ssmsClass)) {
            $this->Flash->success(__('The ssms class has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms class could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
