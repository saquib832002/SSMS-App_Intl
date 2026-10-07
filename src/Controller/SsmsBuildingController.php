<?php
declare(strict_types=1);
namespace App\Controller;
use Cake\Datasource\ConnectionManager;

class SsmsBuildingController extends AppController
{
    private function _cc(): string { return (string)$this->request->getSession()->read('ssms_client_code'); }

    public function index()
    {
        $cc = $this->_cc();
        $db = $this->SsmsBuilding->getConnection();

        $stats = [
            'buildings' => (int)$db->execute("SELECT COUNT(*) AS n FROM ssms_building WHERE ssms_client_code=?", [$cc])->fetchAssoc()['n'],
            'rooms'     => (int)$db->execute("SELECT COUNT(*) AS n FROM ssms_rooms r JOIN ssms_building b ON b.building_id=r.building_id WHERE b.ssms_client_code=?", [$cc])->fetchAssoc()['n'],
            'seats'     => (int)$db->execute("SELECT COUNT(*) AS n FROM ssms_room_seats WHERE ssms_client_code=?", [$cc])->fetchAssoc()['n'],
            'enrolled'  => (int)$db->execute("SELECT COUNT(*) AS n FROM ssms_hostel_enrollment WHERE ssms_client_code=? AND current_status='active'", [$cc])->fetchAssoc()['n'],
        ];

        $buildings = $db->execute(
            "SELECT b.building_id, b.building_name, b.building_number, b.building_type,
                    COUNT(r.room_id) AS room_count,
                    COUNT(s.seat_id) AS seat_count
             FROM   ssms_building b
             LEFT JOIN ssms_rooms r      ON r.building_id = b.building_id
             LEFT JOIN ssms_room_seats s ON s.building_id = b.building_id
             WHERE  b.ssms_client_code = ?
             GROUP  BY b.building_id ORDER BY b.building_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $this->set(compact('buildings', 'stats'));
    }

    public function add()
    {
        $ssmsBuilding = $this->SsmsBuilding->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = $this->_cc();
            $ssmsBuilding = $this->SsmsBuilding->patchEntity($ssmsBuilding, $data);
            if ($this->SsmsBuilding->save($ssmsBuilding)) {
                $this->Flash->success('Building saved.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save building.');
        }
        $this->set(compact('ssmsBuilding'));
    }

    public function edit($id = null)
    {
        $ssmsBuilding = $this->SsmsBuilding->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsBuilding = $this->SsmsBuilding->patchEntity($ssmsBuilding, $this->request->getData());
            if ($this->SsmsBuilding->save($ssmsBuilding)) {
                $this->Flash->success('Building updated.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update building.');
        }
        $this->set(compact('ssmsBuilding'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsBuilding = $this->SsmsBuilding->get($id);
        if ($this->SsmsBuilding->delete($ssmsBuilding)) {
            $this->Flash->success('Building deleted.');
        } else {
            $this->Flash->error('Could not delete building.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
