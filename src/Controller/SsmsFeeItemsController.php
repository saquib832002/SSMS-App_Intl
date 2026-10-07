<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * SsmsFeeItems Controller
 *
 * @property \App\Model\Table\SsmsFeeItemsTable $SsmsFeeItems
 */
class SsmsFeeItemsController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $query = $this->SsmsFeeItems->find();
        $ssmsFeeItems = $this->paginate($query);

        $this->set(compact('ssmsFeeItems'));
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Fee Item id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsFeeItem = $this->SsmsFeeItems->get($id, contain: []);
        $this->set(compact('ssmsFeeItem'));
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
        $ssmsFeeItem = $this->SsmsFeeItems->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsFeeItem = $this->SsmsFeeItems->patchEntity($ssmsFeeItem, $this->request->getData());
            if ($this->SsmsFeeItems->save($ssmsFeeItem)) {
                $this->Flash->success('Fee item saved successfully.');
                return $this->redirect(['action' => 'add']);
            }
            $this->Flash->error('Could not save fee item. Please try again.');
        }
        // Pass the full list so the combined add+list screen can render below the form
        $ssmsFeeItems = $this->SsmsFeeItems->find()
            ->orderAsc('fee_item_name')
            ->all();
        $this->set(compact('ssmsFeeItem', 'ssmsFeeItems'));
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Fee Item id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $ssmsFeeItem = $this->SsmsFeeItems->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsFeeItem = $this->SsmsFeeItems->patchEntity($ssmsFeeItem, $this->request->getData());
            if ($this->SsmsFeeItems->save($ssmsFeeItem)) {
                $this->Flash->success('Fee item updated successfully.');
                return $this->redirect(['action' => 'add']); // back to combined screen
            }
            $this->Flash->error('Could not update fee item. Please try again.');
        }
        $ssmsFeeItems = $this->SsmsFeeItems->find()
            ->orderAsc('fee_item_name')
            ->all();
        $this->set(compact('ssmsFeeItem', 'ssmsFeeItems'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Fee Item id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsFeeItem = $this->SsmsFeeItems->get($id);
        if ($this->SsmsFeeItems->delete($ssmsFeeItem)) {
            $this->Flash->success(__('The ssms fee item has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms fee item could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
