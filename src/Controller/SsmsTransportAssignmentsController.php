<?php
declare(strict_types=1);

namespace App\Controller;

class SsmsTransportAssignmentsController extends AppController
{
    public function index()
    {
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $db = $this->SsmsTransportAssignments->getConnection();

        $assignments = $db->execute(
            "SELECT a.*, r.route_name, r.route_code, v.vehicle_number, v.vehicle_name, d.driver_name, d.mobile_number
             FROM ssms_transport_assignments a
             LEFT JOIN ssms_transport_routes   r ON r.route_id   = a.route_id
             LEFT JOIN ssms_transport_vehicles v ON v.vehicle_id = a.vehicle_id
             LEFT JOIN ssms_transport_drivers  d ON d.driver_id  = a.driver_id
             WHERE r.ssms_client_code = ?
             ORDER BY r.route_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $routesList = $db->execute(
            "SELECT route_id, route_name, route_code FROM ssms_transport_routes WHERE ssms_client_code=? AND status='active' ORDER BY route_name ASC",
            [$cc]
        )->fetchAll('assoc');
        $vehiclesList = $db->execute(
            "SELECT vehicle_id, vehicle_number, vehicle_name FROM ssms_transport_vehicles WHERE ssms_client_code=? AND status='active' ORDER BY vehicle_number ASC",
            [$cc]
        )->fetchAll('assoc');
        $driversList = $db->execute(
            "SELECT driver_id, driver_name, mobile_number FROM ssms_transport_drivers WHERE ssms_client_code=? AND status='active' ORDER BY driver_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $this->set(compact('assignments', 'routesList', 'vehiclesList', 'driversList'));
    }

    public function add()
    {
        $ssmsTransportAssignment = $this->SsmsTransportAssignments->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsTransportAssignment = $this->SsmsTransportAssignments->patchEntity($ssmsTransportAssignment, $this->request->getData());
            if ($this->SsmsTransportAssignments->save($ssmsTransportAssignment)) {
                $this->Flash->success('Assignment saved successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save assignment. Please try again.');
        }
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $ssmsTransportRoutes   = $this->SsmsTransportAssignments->SsmsTransportRoutes->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsTransportVehicles = $this->SsmsTransportAssignments->SsmsTransportVehicles->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsTransportDrivers  = $this->SsmsTransportAssignments->SsmsTransportDrivers->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $this->set(compact('ssmsTransportAssignment', 'ssmsTransportRoutes', 'ssmsTransportVehicles', 'ssmsTransportDrivers'));
    }

    public function edit($id = null)
    {
        $ssmsTransportAssignment = $this->SsmsTransportAssignments->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsTransportAssignment = $this->SsmsTransportAssignments->patchEntity($ssmsTransportAssignment, $this->request->getData());
            if ($this->SsmsTransportAssignments->save($ssmsTransportAssignment)) {
                $this->Flash->success('Assignment updated successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update assignment. Please try again.');
        }
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $ssmsTransportRoutes   = $this->SsmsTransportAssignments->SsmsTransportRoutes->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsTransportVehicles = $this->SsmsTransportAssignments->SsmsTransportVehicles->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsTransportDrivers  = $this->SsmsTransportAssignments->SsmsTransportDrivers->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $this->set(compact('ssmsTransportAssignment', 'ssmsTransportRoutes', 'ssmsTransportVehicles', 'ssmsTransportDrivers'));
    }

    public function view($id = null)
    {
        $ssmsTransportAssignment = $this->SsmsTransportAssignments->get($id, contain: ['SsmsTransportRoutes', 'SsmsTransportVehicles', 'SsmsTransportDrivers']);
        $this->set(compact('ssmsTransportAssignment'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsTransportAssignment = $this->SsmsTransportAssignments->get($id);
        if ($this->SsmsTransportAssignments->delete($ssmsTransportAssignment)) {
            $this->Flash->success('Assignment deleted.');
        } else {
            $this->Flash->error('Could not delete assignment.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
