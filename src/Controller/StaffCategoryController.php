<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * StaffCategory Controller
 *
 * @property \App\Model\Table\StaffCategoryTable $StaffCategory
 */
class StaffCategoryController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $session = $this->request->getSession();
        $query = $this->StaffCategory->find()
            ->where(['ssms_client_code' => $session->read('ssms_client_code')])
            ->orderBy(['category_name' => 'ASC']);
        $staffCategory = $this->paginate($query);

        $this->set(compact('staffCategory'));
    }

    /**
     * View method
     *
     * @param string|null $id Staff Category id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $staffCategory = $this->StaffCategory->get($id, contain: []);
        $this->set(compact('staffCategory'));
    }

    /**
     * Add method
     *
     * @return \Cake\Http\Response|null|void Redirects on successful add, renders view otherwise.
     */
    public function add()
    {
        $session = $this->request->getSession();
        $cc = $session->read('ssms_client_code');

        $staffCategory = $this->StaffCategory->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = $cc;
            $staffCategory = $this->StaffCategory->patchEntity($staffCategory, $data);
            if ($this->StaffCategory->save($staffCategory)) {
                $this->Flash->success(__('Staff category saved.'));
                return $this->redirect(['action' => 'add']);
            }
            $this->Flash->error(__('Could not save. Please try again.'));
        }

        $list = $this->StaffCategory->find()
            ->where(['ssms_client_code' => $cc])
            ->orderBy(['category_name' => 'ASC'])
            ->all()->toArray();

        $this->set(compact('staffCategory', 'list'));
    }

    /**
     * Edit method
     *
     * @param string|null $id Staff Category id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $staffCategory = $this->StaffCategory->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $staffCategory = $this->StaffCategory->patchEntity($staffCategory, $this->request->getData());
            if ($this->StaffCategory->save($staffCategory)) {
                $this->Flash->success(__('The staff category has been saved.'));

                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The staff category could not be saved. Please, try again.'));
        }
        $this->set(compact('staffCategory'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Staff Category id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $staffCategory = $this->StaffCategory->get($id);
        if ($this->StaffCategory->delete($staffCategory)) {
            $this->Flash->success(__('The staff category has been deleted.'));
        } else {
            $this->Flash->error(__('The staff category could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
