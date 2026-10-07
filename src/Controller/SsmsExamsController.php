<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class SsmsExamsController extends AppController
{
    public function index()
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $query = $this->SsmsExams->find()->where(['ssms_client_code' => $clientCode]);
        $ssmsExams = $this->paginate($query);
        $this->set(compact('ssmsExams'));
    }

    public function view($id = null)
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $ssmsExam = $this->SsmsExams->find()
            ->where(['exam_id' => $id, 'ssms_client_code' => $clientCode])
            ->firstOrFail();
        $this->set(compact('ssmsExam'));
    }

    public function add()
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        // Keep an ORM entity only so Form->create() has proper context
        $ssmsExam = $this->SsmsExams->newEmptyEntity();

        if ($this->request->is('post')) {
            $examName = trim((string)$this->request->getData('exam_name'));

            if ($examName === '') {
                $this->Flash->error('Exam name is required.');
            } else {
                $conn = ConnectionManager::get('default');

                // Duplicate check scoped to this client only
                $dup = $conn->execute(
                    "SELECT exam_id FROM ssms_exams
                     WHERE LOWER(exam_name) = LOWER(?) AND ssms_client_code = ?",
                    [$examName, $clientCode]
                )->fetchAssoc();

                if ($dup) {
                    $this->Flash->error("An exam named \"{$examName}\" already exists.");
                } else {
                    $conn->execute(
                        "INSERT INTO ssms_exams (exam_name, ssms_client_code) VALUES (?, ?)",
                        [$examName, $clientCode]
                    );
                    $this->Flash->success('Exam saved successfully.');
                    return $this->redirect(['action' => 'index']);
                }
            }
        }

        $this->set(compact('ssmsExam'));
    }

    public function edit($id = null)
    {
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $ssmsExam = $this->SsmsExams->find()
            ->where(['exam_id' => $id, 'ssms_client_code' => $clientCode])
            ->firstOrFail();

        if ($this->request->is(['patch', 'post', 'put'])) {
            $examName = trim((string)$this->request->getData('exam_name'));

            if ($examName === '') {
                $this->Flash->error('Exam name is required.');
            } else {
                $conn = ConnectionManager::get('default');

                // Duplicate check excluding self, scoped to this client
                $dup = $conn->execute(
                    "SELECT exam_id FROM ssms_exams
                     WHERE LOWER(exam_name) = LOWER(?) AND ssms_client_code = ? AND exam_id != ?",
                    [$examName, $clientCode, $id]
                )->fetchAssoc();

                if ($dup) {
                    $this->Flash->error("An exam named \"{$examName}\" already exists.");
                } else {
                    $conn->execute(
                        "UPDATE ssms_exams SET exam_name = ? WHERE exam_id = ? AND ssms_client_code = ?",
                        [$examName, $id, $clientCode]
                    );
                    $this->Flash->success('Exam updated successfully.');
                    return $this->redirect(['action' => 'index']);
                }
            }
        }

        $this->set(compact('ssmsExam'));
    }

    public function delete($id = null)
    {
        $this->request->allowMethod(['post', 'delete']);
        $clientCode = $this->request->getSession()->read('ssms_client_code');
        $conn = ConnectionManager::get('default');
        $conn->execute(
            "DELETE FROM ssms_exams WHERE exam_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );
        $this->Flash->success('Exam deleted successfully.');
        return $this->redirect(['action' => 'index']);
    }
}
