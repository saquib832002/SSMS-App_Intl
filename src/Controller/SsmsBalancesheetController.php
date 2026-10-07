<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * SsmsBalancesheet Controller
 *
 * @property \App\Model\Table\SsmsBalancesheetTable $SsmsBalancesheet
 */
class SsmsBalancesheetController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $query = $this->SsmsBalancesheet->find();
        $ssmsBalancesheet = $this->paginate($query);

        $this->set(compact('ssmsBalancesheet'));
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Balancesheet id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsBalancesheet = $this->SsmsBalancesheet->get($id, contain: []);
        $this->set(compact('ssmsBalancesheet'));
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
        $ssmsBalancesheet = $this->SsmsBalancesheet->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsBalancesheet = $this->SsmsBalancesheet->patchEntity($ssmsBalancesheet, $this->request->getData());
            if ($this->SsmsBalancesheet->save($ssmsBalancesheet)) {
                $this->Flash->success(__('The ssms balancesheet has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms balancesheet could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsBalancesheet'));
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Balancesheet id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $ssmsBalancesheet = $this->SsmsBalancesheet->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsBalancesheet = $this->SsmsBalancesheet->patchEntity($ssmsBalancesheet, $this->request->getData());
            if ($this->SsmsBalancesheet->save($ssmsBalancesheet)) {
                $this->Flash->success(__('The ssms balancesheet has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The ssms balancesheet could not be saved. Please, try again.'));
        }
        $this->set(compact('ssmsBalancesheet'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Balancesheet id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsBalancesheet = $this->SsmsBalancesheet->get($id);
        if ($this->SsmsBalancesheet->delete($ssmsBalancesheet)) {
            $this->Flash->success(__('The ssms balancesheet has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms balancesheet could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
