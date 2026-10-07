<?php
declare(strict_types=1);

namespace App\Controller;

class SsmsTransportRoutesController extends AppController
{
    public function index()
    {
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $db = $this->SsmsTransportRoutes->getConnection();

        $stats = [
            'routes'   => (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_routes      WHERE ssms_client_code=? AND status='active'", [$cc])->fetchColumn(0),
            'vehicles' => (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_vehicles    WHERE ssms_client_code=? AND status='active'", [$cc])->fetchColumn(0),
            'drivers'  => (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_drivers     WHERE ssms_client_code=? AND status='active'", [$cc])->fetchColumn(0),
            'enrolled' => (int)$db->execute("SELECT COUNT(*) FROM ssms_transport_enrollments WHERE ssms_client_code=? AND status='active'", [$cc])->fetchColumn(0),
        ];

        $activeRoutes = $db->execute(
            "SELECT route_id, route_name, route_code, start_point, end_point, distance_km, monthly_fare
             FROM ssms_transport_routes WHERE ssms_client_code=? AND status='active' ORDER BY route_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $query = $this->SsmsTransportRoutes->find()
            ->where(['ssms_client_code' => $cc])
            ->orderBy(['route_name' => 'ASC']);
        $ssmsTransportRoutes = $this->paginate($query);

        $this->set(compact('ssmsTransportRoutes', 'stats', 'activeRoutes'));
    }

    public function add()
    {
        $ssmsTransportRoute = $this->SsmsTransportRoutes->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = (string)$this->request->getSession()->read('ssms_client_code');
            $data['status'] = $data['status'] ?? 'active';
            $ssmsTransportRoute = $this->SsmsTransportRoutes->patchEntity($ssmsTransportRoute, $data);
            if ($this->SsmsTransportRoutes->save($ssmsTransportRoute)) {
                $this->Flash->success('Route saved successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save route. Please try again.');
        }
        $this->set(compact('ssmsTransportRoute'));
    }

    public function edit($id = null)
    {
        $ssmsTransportRoute = $this->SsmsTransportRoutes->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsTransportRoute = $this->SsmsTransportRoutes->patchEntity($ssmsTransportRoute, $this->request->getData());
            if ($this->SsmsTransportRoutes->save($ssmsTransportRoute)) {
                $this->Flash->success('Route updated successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update route. Please try again.');
        }
        $this->set(compact('ssmsTransportRoute'));
    }

    public function view($id = null)
    {
        $ssmsTransportRoute = $this->SsmsTransportRoutes->get($id, contain: ['SsmsTransportStops', 'SsmsTransportAssignments']);
        $this->set(compact('ssmsTransportRoute'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsTransportRoute = $this->SsmsTransportRoutes->get($id);
        if ($this->SsmsTransportRoutes->delete($ssmsTransportRoute)) {
            $this->Flash->success('Route deleted.');
        } else {
            $this->Flash->error('Could not delete route.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
