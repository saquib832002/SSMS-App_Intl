<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsMaxMarks Controller
 */
class SsmsMaxMarksController extends AppController
{
    /**
     * Load subjects grouped by class from the new ssms_class_subjects table.
     * Returns an array of assoc rows: [{class_id, subject_id, subject_name, subject_code}, …]
     */
    private function _loadSubjectsForClient(string $clientCode): array
    {
        $conn = ConnectionManager::get('default');
        return $conn->execute(
            "SELECT cs.class_id, s.subject_id, s.subject_name, cs.subject_code
             FROM ssms_class_subjects cs
             JOIN ssms_subjects s ON s.subject_id = cs.subject_id
                                  AND s.ssms_client_code = cs.ssms_client_code
             WHERE cs.ssms_client_code = ?
             ORDER BY cs.class_id, cs.display_order, s.subject_name",
            [$clientCode]
        )->fetchAll('assoc');
    }

    // ── index ─────────────────────────────────────────────────────────────────

    public function index()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');
        $conn       = ConnectionManager::get('default');

        $query = $this->SsmsMaxMarks->find()
            ->where(['SsmsMaxMarks.ssms_client_code' => $clientCode]);
        $ssmsMaxMarks = $this->paginate($query);

        $classes = $this->fetchTable('SsmsClasses')
            ->find()->select(['class_id', 'class_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->all()->combine('class_id', 'class_name')->toArray();

        // Subject name lookup by subject_id (no class_id needed here)
        $subjectRows = $conn->execute(
            "SELECT subject_id, subject_name FROM ssms_subjects
             WHERE ssms_client_code = ? ORDER BY subject_name",
            [$clientCode]
        )->fetchAll('assoc');
        $subjects = array_column($subjectRows, 'subject_name', 'subject_id');

        $this->set(compact('ssmsMaxMarks', 'classes', 'subjects'));
    }

    // ── view ──────────────────────────────────────────────────────────────────

    public function view($id = null)
    {
        $ssmsMaxMark = $this->SsmsMaxMarks->get($id, contain: []);
        $this->set(compact('ssmsMaxMark'));
    }

    // ── add ───────────────────────────────────────────────────────────────────

    public function add()
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');

        $ssmsMaxMark = $this->SsmsMaxMarks->newEmptyEntity();
        if ($this->request->is('post')) {
            $data = $this->request->getData();
            $data['ssms_client_code'] = $clientCode;

            // Friendly duplicate check before hitting ORM validation
            $conn = ConnectionManager::get('default');
            $dup  = $conn->execute(
                "SELECT id FROM ssms_max_marks
                 WHERE class_id = ? AND subject_id = ? AND ssms_client_code = ?",
                [$data['class_id'] ?? null, $data['subject_id'] ?? null, $clientCode]
            )->fetchAssoc();

            if ($dup) {
                $this->Flash->error('Max marks for the selected class and subject have already been configured.');
            } else {
                $ssmsMaxMark = $this->SsmsMaxMarks->patchEntity($ssmsMaxMark, $data);
                if ($this->SsmsMaxMarks->save($ssmsMaxMark)) {
                    $this->Flash->success('Max marks saved successfully.');
                    return $this->redirect(['action' => 'add']);
                }
                $this->Flash->error('Could not save. Please check all fields and try again.');
            }
        }

        $classes = $this->fetchTable('SsmsClasses')
            ->find()->select(['class_id', 'class_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['class_name' => 'ASC'])
            ->all()->combine('class_id', 'class_name')->toArray();

        // Subjects with class_id from ssms_class_subjects
        $subjects = $this->_loadSubjectsForClient($clientCode);

        $ssmsMaxMarksList = $this->SsmsMaxMarks->find()
            ->where(['SsmsMaxMarks.ssms_client_code' => $clientCode])
            ->orderBy(['SsmsMaxMarks.id' => 'DESC'])
            ->all()->toArray();

        $this->set(compact('ssmsMaxMark', 'classes', 'subjects', 'ssmsMaxMarksList'));
    }

    // ── edit ──────────────────────────────────────────────────────────────────

    public function edit($id = null)
    {
        $session    = $this->request->getSession();
        $clientCode = $session->read('ssms_client_code');

        $ssmsMaxMark = $this->SsmsMaxMarks->get($id, contain: []);
        if ($this->request->is(['patch', 'post', 'put'])) {
            $ssmsMaxMark = $this->SsmsMaxMarks->patchEntity($ssmsMaxMark, $this->request->getData());
            if ($this->SsmsMaxMarks->save($ssmsMaxMark)) {
                $this->Flash->success(__('The max mark has been saved.'));
                return $this->redirect(['action' => 'index']);
            }
            $this->Flash->error(__('The max mark could not be saved. Please, try again.'));
        }

        $classes = $this->fetchTable('SsmsClasses')
            ->find()->select(['class_id', 'class_name'])
            ->where(['ssms_client_code' => $clientCode])
            ->orderBy(['class_name' => 'ASC'])
            ->all()->combine('class_id', 'class_name')->toArray();

        // Subjects with class_id from ssms_class_subjects
        $subjects = $this->_loadSubjectsForClient($clientCode);

        $this->set(compact('ssmsMaxMark', 'classes', 'subjects'));
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $ssmsMaxMark = $this->SsmsMaxMarks->get($id);
        if ($this->SsmsMaxMarks->delete($ssmsMaxMark)) {
            $this->Flash->success(__('The ssms max mark has been deleted.'));
        } else {
            $this->Flash->error(__('The ssms max mark could not be deleted. Please, try again.'));
        }
        return $this->redirect(['action' => 'index']);
    }
}
