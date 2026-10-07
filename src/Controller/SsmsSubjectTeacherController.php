<?php
declare(strict_types=1);

namespace App\Controller;

/**
 * SsmsSubjectTeacher Controller
 *
 * @property \App\Model\Table\SsmsSubjectTeacherTable $SsmsSubjectTeacher
 */
class SsmsSubjectTeacherController extends AppController
{
    /**
     * Index method
     *
     * @return \Cake\Http\Response|null|void Renders view
     */
    public function index()
    {
        $session = $this->request->getSession();
        $cc = $session->read('ssms_client_code');

        $query = $this->SsmsSubjectTeacher->find()
            ->where(['SsmsSubjectTeacher.ssms_client_code' => $cc]);
        $ssmsSubjectTeacher = $this->paginate($query);

        $classes  = $this->fetchTable('SsmsClasses')->find()->select(['class_id','class_name'])->where(['ssms_client_code'=>$cc])->all()->combine('class_id','class_name')->toArray();
        $subjects = $this->fetchTable('SsmsSubjects')->find()->select(['subject_id','subject_name'])->where(['ssms_client_code'=>$cc])->all()->combine('subject_id','subject_name')->toArray();
        $sections = $this->fetchTable('SsmsSections')->find()->select(['section_id','section_name'])->where(['ssms_client_code'=>$cc])->all()->combine('section_id','section_name')->toArray();
        $staffMap = [];
        foreach ($this->fetchTable('SsmsStaff')->find()->select(['staff_id','first_name','last_name'])->where(['ssms_client_code'=>$cc])->all() as $s) {
            $staffMap[$s->staff_id] = $s->first_name . ' ' . $s->last_name;
        }

        $this->set(compact('ssmsSubjectTeacher','classes','subjects','sections','staffMap'));
    }

    /**
     * View method
     *
     * @param string|null $id Ssms Subject Teacher id.
     * @return \Cake\Http\Response|null|void Renders view
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function view($id = null)
    {
        $ssmsSubjectTeacher = $this->SsmsSubjectTeacher->get($id, contain: ['Branches']);
        $this->set(compact('ssmsSubjectTeacher'));
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

        $ssmsSubjectTeacher = $this->SsmsSubjectTeacher->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = $cc;
            $ssmsSubjectTeacher = $this->SsmsSubjectTeacher->patchEntity($ssmsSubjectTeacher, $data);
            if ($this->SsmsSubjectTeacher->save($ssmsSubjectTeacher)) {
                $this->Flash->success(__('Subject teacher assignment saved.'));
                return $this->redirect(['action' => 'add']);
            }
            $this->Flash->error(__('Could not save. Please try again.'));
        }

        $classes  = $this->fetchTable('SsmsClasses')->find()->select(['class_id','class_name'])->where(['ssms_client_code'=>$cc])->orderBy(['class_name'=>'ASC'])->all()->combine('class_id','class_name')->toArray();
        $connection = \Cake\Datasource\ConnectionManager::get('default');
        $subjects = $connection->execute(
            "SELECT cs.class_id, s.subject_id, s.subject_name, cs.subject_code
             FROM ssms_class_subjects cs
             JOIN ssms_subjects s ON s.subject_id = cs.subject_id AND s.ssms_client_code = cs.ssms_client_code
             WHERE cs.ssms_client_code = ?
             ORDER BY s.subject_name ASC",
            [$cc]
        )->fetchAll('assoc');
        $sections = $this->fetchTable('SsmsSections')->find()->select(['section_id','section_name','class_id'])->where(['ssms_client_code'=>$cc])->orderBy(['section_name'=>'ASC'])->all()->toArray();
        $staffRows = $connection->execute(
            "SELECT staff_id, first_name, last_name FROM ssms_staff
             WHERE ssms_client_code = ?
               AND LOWER(TRIM(hired)) IN ('yes','y','1')
               AND (resigned IS NULL OR LOWER(TRIM(resigned)) IN ('no','n','0',''))
             ORDER BY first_name, last_name",
            [$cc]
        )->fetchAll('assoc');
        $staffList = [];
        foreach ($staffRows as $r) {
            $staffList[$r['staff_id']] = $r['first_name'] . ' ' . $r['last_name'];
        }
        $branches = $this->SsmsSubjectTeacher->Branches->find()->select(['branch_id','branch_name'])->where(['ssms_client_code'=>$cc])->orderBy(['branch_name'=>'ASC'])->all()->combine('branch_id','branch_name')->toArray();

        $staffMap = [];
        foreach ($this->fetchTable('SsmsStaff')->find()->select(['staff_id','first_name','last_name'])->where(['ssms_client_code'=>$cc])->all() as $s) {
            $staffMap[$s->staff_id] = $s->first_name . ' ' . $s->last_name;
        }
        $subjectsList = $subjects;
        $sectionsList = $sections;
        $subjectsMap  = array_column($subjects, 'subject_name', 'subject_id');
        $sectionsMap  = array_column(array_map(fn($s)=>['k'=>$s->section_id,'v'=>$s->section_name], $sections), 'v', 'k');

        $list = $this->SsmsSubjectTeacher->find()->where(['SsmsSubjectTeacher.ssms_client_code'=>$cc])->orderBy(['SsmsSubjectTeacher.id'=>'DESC'])->all()->toArray();

        $this->set(compact('ssmsSubjectTeacher','branches','classes','subjectsList','sectionsList','staffList','staffMap','subjectsMap','sectionsMap','list'));
    }

    /**
     * Edit method
     *
     * @param string|null $id Ssms Subject Teacher id.
     * @return \Cake\Http\Response|null|void Redirects on successful edit, renders view otherwise.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function edit($id = null)
    {
        $session = $this->request->getSession();
        $cc      = $session->read('ssms_client_code');

        $ssmsSubjectTeacher = $this->SsmsSubjectTeacher->get($id, contain: []);

        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsSubjectTeacher = $this->SsmsSubjectTeacher->patchEntity($ssmsSubjectTeacher, $this->request->getData());
            $ssmsSubjectTeacher->ssms_client_code = $cc;
            if ($this->SsmsSubjectTeacher->save($ssmsSubjectTeacher)) {
                $this->Flash->success(__('Assignment updated successfully.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('Could not save. Please try again.'));
        }

        $classes  = $this->fetchTable('SsmsClasses')->find()
            ->select(['class_id','class_name'])
            ->where(['ssms_client_code' => $cc])
            ->orderBy(['class_name' => 'ASC'])
            ->all()->combine('class_id','class_name')->toArray();

        // Include class_id so the template can build cascading dropdowns
        $connection = \Cake\Datasource\ConnectionManager::get('default');
        $subjectsList = $connection->execute(
            "SELECT cs.class_id, s.subject_id, s.subject_name, cs.subject_code
             FROM ssms_class_subjects cs
             JOIN ssms_subjects s ON s.subject_id = cs.subject_id AND s.ssms_client_code = cs.ssms_client_code
             WHERE cs.ssms_client_code = ?
             ORDER BY s.subject_name ASC",
            [$cc]
        )->fetchAll('assoc');

        $sectionsList = $this->fetchTable('SsmsSections')->find()
            ->select(['section_id','section_name','class_id'])
            ->where(['ssms_client_code' => $cc])
            ->orderBy(['section_name' => 'ASC'])
            ->all()->toArray();

        $connection = \Cake\Datasource\ConnectionManager::get('default');
        $staffRows = $connection->execute(
            "SELECT staff_id, first_name, last_name FROM ssms_staff
             WHERE ssms_client_code = ?
               AND LOWER(TRIM(hired)) IN ('yes','y','1')
               AND (resigned IS NULL OR LOWER(TRIM(resigned)) IN ('no','n','0',''))
             ORDER BY first_name, last_name",
            [$cc]
        )->fetchAll('assoc');
        $staff = [];
        foreach ($staffRows as $r) {
            $staff[$r['staff_id']] = $r['first_name'] . ' ' . $r['last_name'];
        }

        $branches = $this->SsmsSubjectTeacher->Branches->find()
            ->select(['branch_id','branch_name'])
            ->where(['ssms_client_code' => $cc])
            ->orderBy(['branch_name' => 'ASC'])
            ->all()->combine('branch_id','branch_name')->toArray();

        $this->set(compact('ssmsSubjectTeacher', 'classes', 'subjectsList', 'sectionsList', 'staff', 'branches'));
    }

    /**
     * Delete method
     *
     * @param string|null $id Ssms Subject Teacher id.
     * @return \Cake\Http\Response|null Redirects to index.
     * @throws \Cake\Datasource\Exception\RecordNotFoundException When record not found.
     */
    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsSubjectTeacher = $this->SsmsSubjectTeacher->get($id);
        if ($this->SsmsSubjectTeacher->delete($ssmsSubjectTeacher)) {
            $this->Flash->success(__('The ssms subject teacher has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms subject teacher could not be deleted. Please, try again.'));
        }

        return $this->redirect(['action' => 'index']);
    }
}
