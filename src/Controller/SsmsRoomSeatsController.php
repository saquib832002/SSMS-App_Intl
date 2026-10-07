<?php
declare(strict_types=1);
namespace App\Controller;

class SsmsRoomSeatsController extends AppController
{
    private function _cc(): string { return (string)$this->request->getSession()->read('ssms_client_code'); }

    public function index()
    {
        $cc         = $this->_cc();
        $db         = $this->SsmsRoomSeats->getConnection();
        $roomId     = $this->request->getQuery('room_id');
        $buildingId = $this->request->getQuery('building_id');

        $sql = "SELECT s.seat_id, s.seat_number, s.status, s.room_id, s.building_id,
                       r.room_name, b.building_name
                FROM   ssms_room_seats s
                JOIN   ssms_rooms    r ON r.room_id     = s.room_id
                JOIN   ssms_building b ON b.building_id = s.building_id
                WHERE  s.ssms_client_code = ?";
        $params = [$cc];
        if ($roomId)     { $sql .= " AND s.room_id = ?";     $params[] = (int)$roomId; }
        if ($buildingId) { $sql .= " AND s.building_id = ?"; $params[] = (int)$buildingId; }
        $sql .= " ORDER BY b.building_name ASC, r.room_name ASC, s.seat_number ASC";
        $seats = $db->execute($sql, $params)->fetchAll('assoc');

        $stats = [
            'available'   => count(array_filter($seats, fn($s) => $s['status'] === 'available')),
            'occupied'    => count(array_filter($seats, fn($s) => $s['status'] === 'occupied')),
            'reserved'    => count(array_filter($seats, fn($s) => $s['status'] === 'reserved')),
            'maintenance' => count(array_filter($seats, fn($s) => $s['status'] === 'maintenance')),
        ];

        $buildingsList = $db->execute(
            "SELECT building_id, building_name FROM ssms_building WHERE ssms_client_code=? ORDER BY building_name",
            [$cc]
        )->fetchAll('assoc');
        $roomsList = $db->execute(
            "SELECT r.room_id, r.room_name, r.building_id, b.building_name
             FROM ssms_rooms r JOIN ssms_building b ON b.building_id=r.building_id
             WHERE b.ssms_client_code=? ORDER BY b.building_name, r.room_name",
            [$cc]
        )->fetchAll('assoc');

        $currentRoom     = null;
        $currentBuilding = null;
        if ($roomId) {
            foreach ($roomsList as $r) { if ((string)$r['room_id'] === (string)$roomId) { $currentRoom = $r; break; } }
        }
        if ($buildingId) {
            foreach ($buildingsList as $b) { if ((string)$b['building_id'] === (string)$buildingId) { $currentBuilding = $b; break; } }
        }

        $this->set(compact('seats', 'stats', 'buildingsList', 'roomsList', 'currentRoom', 'currentBuilding', 'roomId', 'buildingId'));
    }

    public function add()
    {
        $ssmsRoomSeat = $this->SsmsRoomSeats->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = $this->_cc();
            $ssmsRoomSeat = $this->SsmsRoomSeats->patchEntity($ssmsRoomSeat, $data);
            if ($this->SsmsRoomSeats->save($ssmsRoomSeat)) {
                $this->Flash->success('Seat saved.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save seat.');
        }
        $cc = $this->_cc();
        $ssmsBuilding = $this->SsmsRoomSeats->SsmsBuilding->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsRooms    = $this->SsmsRoomSeats->SsmsRooms->find('list', limit: 200)->all();
        $this->set(compact('ssmsRoomSeat', 'ssmsBuilding', 'ssmsRooms'));
    }

    public function edit($id = null)
    {
        $ssmsRoomSeat = $this->SsmsRoomSeats->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsRoomSeat = $this->SsmsRoomSeats->patchEntity($ssmsRoomSeat, $this->request->getData());
            if ($this->SsmsRoomSeats->save($ssmsRoomSeat)) {
                $this->Flash->success('Seat updated.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update seat.');
        }
        $cc = $this->_cc();
        $ssmsBuilding = $this->SsmsRoomSeats->SsmsBuilding->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsRooms    = $this->SsmsRoomSeats->SsmsRooms->find('list', limit: 200)->all();
        $this->set(compact('ssmsRoomSeat', 'ssmsBuilding', 'ssmsRooms'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsRoomSeat = $this->SsmsRoomSeats->get($id);
        if ($this->SsmsRoomSeats->delete($ssmsRoomSeat)) {
            $this->Flash->success('Seat deleted.');
        } else {
            $this->Flash->error('Could not delete seat.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
