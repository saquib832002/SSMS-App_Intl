<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * SsmsEnquiry Controller
 *
 * @property \App\Model\Table\SsmsEnquiryTable $SsmsEnquiry
 */
class SsmsEnquiryController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $query = $this->SsmsEnquiry->find();
        $ssmsEnquiry = $this->paginate($query);

        $this->set(compact('ssmsEnquiry'));
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Enquiry id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsEnquiry = $this->SsmsEnquiry->get($id, contain: []);
        $this->set(compact('ssmsEnquiry'));
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
        $ssmsEnquiry = $this->SsmsEnquiry->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsEnquiry = $this->SsmsEnquiry->patchEntity($ssmsEnquiry, $this->request->getData());
            if ($this->SsmsEnquiry->save($ssmsEnquiry)) {
                $this->Flash->success(__('The ssms enquiry has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms enquiry could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsEnquiry'));
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Enquiry id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $ssmsEnquiry = $this->SsmsEnquiry->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsEnquiry = $this->SsmsEnquiry->patchEntity($ssmsEnquiry, $this->request->getData());
            if ($this->SsmsEnquiry->save($ssmsEnquiry)) {
                $this->Flash->success(__('The ssms enquiry has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms enquiry could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsEnquiry'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Enquiry id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsEnquiry = $this->SsmsEnquiry->get($id);
        if ($this->SsmsEnquiry->delete($ssmsEnquiry)) {
            $this->Flash->success(__('The ssms enquiry has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms enquiry could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
