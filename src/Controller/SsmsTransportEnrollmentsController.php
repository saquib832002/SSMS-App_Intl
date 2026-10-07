<?php
declare(strict_types=1);

namespace App\Controller;

class SsmsTransportEnrollmentsController extends AppController
{
    public function index()
    {
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $db = $this->SsmsTransportEnrollments->getConnection();

        $enrollments = $db->execute(
            "SELECT te.*,
                    COALESCE(CONCAT(reg.student_first_name,' ',reg.student_last_name), CONCAT('Student #',te.enrollment_id)) AS student_name,
                    COALESCE(rt.route_name, CONCAT('Route #',te.route_id))  AS route_name,
                    COALESCE(st.stop_name,  CONCAT('Stop #', te.stop_id))   AS stop_name
             FROM ssms_transport_enrollments te
             LEFT JOIN ssms_student_enrollment   enr ON CAST(enr.enrollment_id AS CHAR) = CAST(te.enrollment_id AS CHAR)
             LEFT JOIN ssms_student_registration reg ON reg.registration_id = enr.registration_id
             LEFT JOIN ssms_transport_routes     rt  ON rt.route_id  = te.route_id
             LEFT JOIN ssms_transport_stops      st  ON st.stop_id   = te.stop_id
             WHERE te.ssms_client_code = ? AND te.status = 'active'
             ORDER BY student_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $routesList = $db->execute(
            "SELECT route_id, route_name FROM ssms_transport_routes WHERE ssms_client_code=? AND status='active' ORDER BY route_name ASC",
            [$cc]
        )->fetchAll('assoc');
        $stopsList = $db->execute(
            "SELECT s.stop_id, s.stop_name, s.route_id, r.route_name
             FROM ssms_transport_stops s
             JOIN ssms_transport_routes r ON r.route_id = s.route_id
             WHERE r.ssms_client_code = ?
             ORDER BY r.route_name ASC, s.stop_order ASC, s.stop_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $this->set(compact('enrollments', 'routesList', 'stopsList'));
    }

    public function add()
    {
        $ssmsTransportEnrollment = $this->SsmsTransportEnrollments->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = (string)$this->request->getSession()->read('ssms_client_code');
            $data['status'] = 'active';
            $ssmsTransportEnrollment = $this->SsmsTransportEnrollments->patchEntity($ssmsTransportEnrollment, $data);
            if ($this->SsmsTransportEnrollments->save($ssmsTransportEnrollment)) {
                $this->Flash->success('Student enrolled in transport.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not save enrollment. Please try again.');
        }
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $ssmsTransportRoutes = $this->SsmsTransportEnrollments->SsmsTransportRoutes->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsTransportStops  = $this->SsmsTransportEnrollments->SsmsTransportStops->find('list', limit: 200)->all();
        $this->set(compact('ssmsTransportEnrollment', 'ssmsTransportRoutes', 'ssmsTransportStops'));
    }

    public function edit($id = null)
    {
        $ssmsTransportEnrollment = $this->SsmsTransportEnrollments->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsTransportEnrollment = $this->SsmsTransportEnrollments->patchEntity($ssmsTransportEnrollment, $this->request->getData());
            if ($this->SsmsTransportEnrollments->save($ssmsTransportEnrollment)) {
                $this->Flash->success('Enrollment updated.');
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error('Could not update enrollment. Please try again.');
        }
        $cc = (string)$this->request->getSession()->read('ssms_client_code');
        $ssmsTransportRoutes = $this->SsmsTransportEnrollments->SsmsTransportRoutes->find('list', limit: 200)->where(['ssms_client_code' => $cc])->all();
        $ssmsTransportStops  = $this->SsmsTransportEnrollments->SsmsTransportStops->find('list', limit: 200)->all();
        $this->set(compact('ssmsTransportEnrollment', 'ssmsTransportRoutes', 'ssmsTransportStops'));
    }

    public function view($id = null)
    {
        $ssmsTransportEnrollment = $this->SsmsTransportEnrollments->get($id, contain: ['SsmsTransportRoutes', 'SsmsTransportStops']);
        $this->set(compact('ssmsTransportEnrollment'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsTransportEnrollment = $this->SsmsTransportEnrollments->get($id);
        if ($this->SsmsTransportEnrollments->delete($ssmsTransportEnrollment)) {
            $this->Flash->success('Enrollment removed.');
        } else {
            $this->Flash->error('Could not remove enrollment.');
        }
        return $this->redirect(['action' => 'index']);
    }
}
