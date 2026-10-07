<?php
declare(strict_types=1);
namespace App\Controller;

class SsmsRoomsController extends AppController
{
    private function _cc(): string { return (string)$this->request->getSession()->read('ssms_client_code'); }

    public function index()
    {
        $cc         = $this->_cc();
        $db         = $this->SsmsRooms->getConnection();
        $buildingId = $this->request->getQuery('building_id');

        $sql = "SELECT r.room_id, r.room_name, r.building_id, b.building_name, b.building_type,
                       COUNT(s.seat_id) AS seat_count,
                       SUM(s.status='available') AS available_seats,
                       SUM(s.status='occupied')  AS occupied_seats
                FROM   ssms_rooms r
                JOIN   ssms_building b ON b.building_id = r.building_id
                LEFT JOIN ssms_room_seats s ON s.room_id = r.room_id
                WHERE  b.ssms_client_code = ?";
        $params = [$cc];
        if ($buildingId) { $sql .= " AND r.building_id = ?"; $params[] = (int)$buildingId; }
        $sql .= " GROUP BY r.room_id ORDER BY b.building_name ASC, r.room_name ASC";
        $rooms = $db->execute($sql, $params)->fetchAll('assoc');

        $buildingsList = $db->execute(
            "SELECT building_id, building_name FROM ssms_building WHERE ssms_client_code=? ORDER BY building_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $currentBuilding = null;
        if ($buildingId) {
            foreach ($buildingsList as $b) {
                if ((string)$b['building_id'] === (string)$buildingId) { $currentBuilding = $b; break; }
            }
        }

        $this->set(compact('rooms', 'buildingsList', 'currentBuilding', 'buildingId'));
    }

    public function add()
    {
        $ssmsRoom = $this->SsmsRooms->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = $this->_cc();
            $ssmsRoom = $this->SsmsRooms->patchEntity($ssmsRoom, $data);
            if ($this->SsmsRooms->save($ssmsRoom)) {
                $this->Flash->success('Room saved.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save room.');
        }
        $cc = $this->_cc();
        $ssmsBuilding = $this->SsmsRooms->SsmsBuilding->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $this->set(compact('ssmsRoom', 'ssmsBuilding'));
    }

    public function edit($id = null)
    {
        $ssmsRoom = $this->SsmsRooms->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsRoom = $this->SsmsRooms->patchEntity($ssmsRoom, $this->request->getData());
            if ($this->SsmsRooms->save($ssmsRoom)) {
                $this->Flash->success('Room updated.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update room.');
        }
        $cc = $this->_cc();
        $ssmsBuilding = $this->SsmsRooms->SsmsBuilding->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $this->set(compact('ssmsRoom', 'ssmsBuilding'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsRoom = $this->SsmsRooms->get($id);
        if ($this->SsmsRooms->delete($ssmsRoom)) {
            $this->Flash->success('Room deleted.');
        } else {
            $this->Flash->error('Could not delete room.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
