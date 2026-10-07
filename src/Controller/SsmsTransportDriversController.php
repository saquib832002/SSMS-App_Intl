<?php
declare(strict_types=1);

namespace App\Controller;

class SsmsTransportDriversController extends AppController
{
    public function index()
    {
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $query = $this->SsmsTransportDrivers->find()
            ->where(['ssms_client_code' => $cc])
            ->orderBy(['driver_name' => 'ASC']);
        $ssmsTransportDrivers = $this->paginate($query);
        $this->set(compact('ssmsTransportDrivers'));
    }

    public function add()
    {
        $ssmsTransportDriver = $this->SsmsTransportDrivers->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = (string)$this->request->getSession()->read('ssms_client_code');
            $data['status'] = $data['status'] ?? 'active';
            $ssmsTransportDriver = $this->SsmsTransportDrivers->patchEntity($ssmsTransportDriver, $data);
            if ($this->SsmsTransportDrivers->save($ssmsTransportDriver)) {
                $this->Flash->success('Driver saved successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save driver. Please try again.');
        }
        $this->set(compact('ssmsTransportDriver'));
    }

    public function edit($id = null)
    {
        $ssmsTransportDriver = $this->SsmsTransportDrivers->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsTransportDriver = $this->SsmsTransportDrivers->patchEntity($ssmsTransportDriver, $this->request->getData());
            if ($this->SsmsTransportDrivers->save($ssmsTransportDriver)) {
                $this->Flash->success('Driver updated successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update driver. Please try again.');
        }
        $this->set(compact('ssmsTransportDriver'));
    }

    public function view($id = null)
    {
        $ssmsTransportDriver = $this->SsmsTransportDrivers->get($id, contain: ['SsmsTransportAssignments']);
        $this->set(compact('ssmsTransportDriver'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsTransportDriver = $this->SsmsTransportDrivers->get($id);
        if ($this->SsmsTransportDrivers->delete($ssmsTransportDriver)) {
            $this->Flash->success('Driver deleted.');
        } else {
            $this->Flash->error('Could not delete driver.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
