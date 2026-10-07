<?php
declare(strict_types=1);

namespace App\Controller;

class SsmsTransportVehiclesController extends AppController
{
    public function index()
    {
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $query = $this->SsmsTransportVehicles->find()
            ->where(['ssms_client_code' => $cc])
            ->orderBy(['vehicle_number' => 'ASC']);
        $ssmsTransportVehicles = $this->paginate($query);
        $this->set(compact('ssmsTransportVehicles'));
    }

    public function add()
    {
        $ssmsTransportVehicle = $this->SsmsTransportVehicles->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = (string)$this->request->getSession()->read('ssms_client_code');
            $data['status'] = $data['status'] ?? 'active';
            $ssmsTransportVehicle = $this->SsmsTransportVehicles->patchEntity($ssmsTransportVehicle, $data);
            if ($this->SsmsTransportVehicles->save($ssmsTransportVehicle)) {
                $this->Flash->success('Vehicle saved successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save vehicle. Please try again.');
        }
        $this->set(compact('ssmsTransportVehicle'));
    }

    public function edit($id = null)
    {
        $ssmsTransportVehicle = $this->SsmsTransportVehicles->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsTransportVehicle = $this->SsmsTransportVehicles->patchEntity($ssmsTransportVehicle, $this->request->getData());
            if ($this->SsmsTransportVehicles->save($ssmsTransportVehicle)) {
                $this->Flash->success('Vehicle updated successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update vehicle. Please try again.');
        }
        $this->set(compact('ssmsTransportVehicle'));
    }

    public function view($id = null)
    {
        $ssmsTransportVehicle = $this->SsmsTransportVehicles->get($id, contain: ['SsmsTransportAssignments']);
        $this->set(compact('ssmsTransportVehicle'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsTransportVehicle = $this->SsmsTransportVehicles->get($id);
        if ($this->SsmsTransportVehicles->delete($ssmsTransportVehicle)) {
            $this->Flash->success('Vehicle deleted.');
        } else {
            $this->Flash->error('Could not delete vehicle.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
