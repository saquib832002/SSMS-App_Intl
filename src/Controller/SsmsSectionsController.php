<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * SsmsSections Controller
 *
 * @property \App\Model\Table\SsmsSectionsTable $SsmsSections
 */
class SsmsSectionsController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $session = $this->request->getSession();
         if($session->read('ssms_user_role') != 'user')
         {
            $this->paginate = [
                'contain' => ['SsmsClasses']
            ];
            $ssmsSections = $this->SsmsSections->find()->where(['SsmsSections.ssms_client_code' => $session->read('ssms_client_code')]);

            $this->set(compact('ssmsSections'));
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
     * @param string|null $id Ssms Section id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
         $ssmsSection = $this->SsmsSections->get($id, [
            'contain' => ['SsmsClasses']
        ]);

        $this->set('ssmsSection', $ssmsSection);
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
       $session = $this->request->getSession();
         if($session->read('ssms_user_role') != 'user')
         {

                $ssmsSection = $this->SsmsSections->newEmptyEntity();
                if ($this->request->is('post')) {
					$data = $this->request->getData();
					$ssmsSectionsList = $this->paginate($this->SsmsSections->find()->where(['SsmsSections.ssms_client_code' => $session->read('ssms_client_code')]));
					
                    $data['ssms_client_code'] = $session->read('ssms_client_code');
                    $ssmsSection = $this->SsmsSections->patchEntity($ssmsSection, $data);
                    if ($this->SsmsSections->save($ssmsSection)) {
                        $this->Flash->success(__('The section has been saved.'));

                        return $this->redirect(['action' => 'index']);
                    }
                     else
                    {
                        $this->Flash->error(__('The section could not be saved. This section may have already created for this class. Please, try again.'));
                    }
                }
                $classes = $this->SsmsSections->SsmsClasses->find()->select(['class_id', 'class_name'])->where(['ssms_client_code' => $session->read('ssms_client_code')])->all()->combine('class_id', 'class_name')->toArray();
                $this->set(compact('ssmsSection'));
                $this->set(compact('classes'));
                 $ssmsSectionsList = $this->SsmsSections->find()->contain(['SsmsClasses', 'SsmsStaff'])->where(['SsmsSections.ssms_client_code' => $session->read('ssms_client_code')]);
			 	$ssmsTeachers = $this->SsmsSections->SsmsStaff->find()->select(['staff_id', 'first_name', 'last_name'])->where(['ssms_client_code' => $session->read('ssms_client_code'), 'hired' => 'yes', 'resigned IS' => null])->orderBy(['first_name' => 'ASC']);
                $this->set(compact('ssmsSectionsList','ssmsTeachers'));
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
     * @param string|null $id Ssms Section id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $session = $this->request->getSession();
		 $ssmsSection = $this->SsmsSections->find()->where(['ssms_client_code' => $session->read('ssms_client_code'), 'section_id' => $id]);
		
         if($ssmsSection->count() <= 0 || $session->read('ssms_user_role') == 'user')
        {
			  $this->Flash->error(__('You are not authorized to do this activity.'));

                 return $this->redirect(['controller'=>'SaweraSsmsUsers', 'action' => 'login']);
		}
        
        $ssmsSection = $this->SsmsSections->get($id, [
                    'contain' => []
                ]);
                if ($this->request->is(['patch', 'post', 'put'])) {
                    $ssmsSection = $this->SsmsSections->patchEntity($ssmsSection, $this->request->getData());
                    if ($this->SsmsSections->save($ssmsSection)) {
                        $this->Flash->success(__('The section has been saved.'));

                        return $this->redirect(['action' => 'index']);
                    }
                    else
                    {
                       $this->Flash->error(__('The section could not be saved. This section may have already created for this class. Please, try again.'));
                    }

                }
                $classes = $this->SsmsSections->SsmsClasses->find()->select(['class_id', 'class_name'])->where(['ssms_client_code' => $session->read('ssms_client_code')])->all()->combine('class_id', 'class_name')->toArray();
			$ssmsTeachers = $this->SsmsSections->SsmsStaff->find()->select(['staff_id', 'first_name', 'last_name'])->where(['ssms_client_code' => $session->read('ssms_client_code'), 'hired' => 'yes', 'resigned IS' => null])->orderBy(['first_name' => 'ASC']);
                 $this->set(compact('ssmsSection'));
                 $this->set(compact('classes'));
		$this->set(compact('ssmsTeachers'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Section id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $session = $this->request->getSession();
        $this->request->allowMethod(['post', 'delete']);
		if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner')
		{ 
		
        $ssmsSection = $this->SsmsSections->get($id);
		try {
				
				$this->SsmsSections->delete($ssmsSection);
				$this->Flash->success(__('The Section entry has been deleted.'));						  
			    }
			  catch (\Exception $e) 
					{
					 $this->Flash->success(__('The item you are trying to delete is associated with other records. It can not be deleted.'));
					return $this->redirect(['action' => 'index']);
			  }	

        return $this->redirect(['action' => 'index']);
		}
		else {
            $this->Flash->error(__('You are not authorized to do this activity.'));
                 return $this->redirect(['controller'=>'SaweraSsmsUsers', 'action' => 'login']);
        	}
    }
	
	public function getClassSections()
    {
             $session = $this->request->getSession();
             $response = [];
            if(($this->request->getQuery('class_id') !== null) ){
                  $ssmsSections = $this->SsmsSections->find()->select(['section_id', 'section_name'])->where(['ssms_client_code' => $session->read('ssms_client_code'), 'class_id' => $this->request->getQuery('class_id')]);
                 
                $response =  json_encode($ssmsSections);
                
            }
            // var_dump($response);
            $this->set(compact('response'));
    }
}
