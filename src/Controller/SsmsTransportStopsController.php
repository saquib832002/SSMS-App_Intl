<?php
declare(strict_types=1);

namespace App\Controller;

class SsmsTransportStopsController extends AppController
{
    public function index()
    {
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $db = $this->SsmsTransportStops->getConnection();

        // Raw SQL so we can filter stops by client via joined route
        $stops = $db->execute(
            "SELECT s.*, r.route_name
             FROM ssms_transport_stops s
             JOIN ssms_transport_routes r ON r.route_id = s.route_id
             WHERE r.ssms_client_code = ?
             ORDER BY r.route_name ASC, s.stop_order ASC, s.stop_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $routesList = $db->execute(
            "SELECT route_id, route_name FROM ssms_transport_routes WHERE ssms_client_code=? AND status='active' ORDER BY route_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $this->set(compact('stops', 'routesList'));
    }

    public function add()
    {
        $ssmsTransportStop = $this->SsmsTransportStops->newEmptyEntity();
        if ($this->request->is('post')) {
            $ssmsTransportStop = $this->SsmsTransportStops->patchEntity($ssmsTransportStop, $this->request->getData());
            if ($this->SsmsTransportStops->save($ssmsTransportStop)) {
                $this->Flash->success('Stop saved successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save stop. Please try again.');
        }
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $ssmsTransportRoutes = $this->SsmsTransportStops->SsmsTransportRoutes->find('list', limit: 200)
            ->where(['ssms_client_code' => $cc])->all();
        $this->set(compact('ssmsTransportStop', 'ssmsTransportRoutes'));
    }

    public function edit($id = null)
    {
        $ssmsTransportStop = $this->SsmsTransportStops->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsTransportStop = $this->SsmsTransportStops->patchEntity($ssmsTransportStop, $this->request->getData());
            if ($this->SsmsTransportStops->save($ssmsTransportStop)) {
                $this->Flash->success('Stop updated successfully.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update stop. Please try again.');
        }
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $ssmsTransportRoutes = $this->SsmsTransportStops->SsmsTransportRoutes->find('list', limit: 200)
            ->where(['ssms_client_code' => $cc])->all();
        $this->set(compact('ssmsTransportStop', 'ssmsTransportRoutes'));
    }

    public function view($id = null)
    {
        $ssmsTransportStop = $this->SsmsTransportStops->get($id, contain: ['SsmsTransportRoutes']);
        $this->set(compact('ssmsTransportStop'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsTransportStop = $this->SsmsTransportStops->get($id);
        if ($this->SsmsTransportStops->delete($ssmsTransportStop)) {
            $this->Flash->success('Stop deleted.');
        } else {
            $this->Flash->error('Could not delete stop.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
