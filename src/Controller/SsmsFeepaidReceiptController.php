<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * SsmsFeepaidReceipt Controller
 *
 * @property \App\Model\Table\SsmsFeepaidReceiptTable $SsmsFeepaidReceipt
 */
class SsmsFeepaidReceiptController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $query = $this->SsmsFeepaidReceipt->find();
        $ssmsFeepaidReceipt = $this->paginate($query);

        $this->set(compact('ssmsFeepaidReceipt'));
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Feepaid Receipt id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsFeepaidReceipt = $this->SsmsFeepaidReceipt->get($id, contain: []);
        $this->set(compact('ssmsFeepaidReceipt'));
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
        $ssmsFeepaidReceipt = $this->SsmsFeepaidReceipt->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsFeepaidReceipt = $this->SsmsFeepaidReceipt->patchEntity($ssmsFeepaidReceipt, $this->request->getData());
            if ($this->SsmsFeepaidReceipt->save($ssmsFeepaidReceipt)) {
                $this->Flash->success(__('The ssms feepaid receipt has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms feepaid receipt could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsFeepaidReceipt'));
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Feepaid Receipt id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $ssmsFeepaidReceipt = $this->SsmsFeepaidReceipt->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsFeepaidReceipt = $this->SsmsFeepaidReceipt->patchEntity($ssmsFeepaidReceipt, $this->request->getData());
            if ($this->SsmsFeepaidReceipt->save($ssmsFeepaidReceipt)) {
                $this->Flash->success(__('The ssms feepaid receipt has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms feepaid receipt could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsFeepaidReceipt'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Feepaid Receipt id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsFeepaidReceipt = $this->SsmsFeepaidReceipt->get($id);
        if ($this->SsmsFeepaidReceipt->delete($ssmsFeepaidReceipt)) {
            $this->Flash->success(__('The ssms feepaid receipt has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms feepaid receipt could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
