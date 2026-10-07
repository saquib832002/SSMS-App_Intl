<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;

/**
 * SsmsSchoolEvents Controller
 * Manages school events and holidays.
 * Admin / Owner: full CRUD.
 * All other authenticated roles: read-only (index).
 */
class SsmsSchoolEventsController extends AppController
{
    // ── helpers ──────────────────────────────────────────────────────────────

    private function _clientCode(): string
    {
        return (string) $this->request->getSession()->read('ssms_client_code');
    }

    private function _role(): string
    {
        return (string) $this->request->getSession()->read('ssms_user_role');
    }

    private function _isAdminOrOwner(): bool
    {
        return in_array($this->_role(), ['admin', 'owner', 'superuser'], true);
    }

    private function _requireAdminOrOwner(): ?object
    {
        if (!$this->_isAdminOrOwner()) {
            $this->Flash->error('You do not have permission to perform this action.');
            return $this->redirect(['action' => 'index']);
        }
        return null;
    }

    private function _categories(): array
    {
        return [
            'Sports'            => 'Sports',
            'Cultural'          => 'Cultural',
            'Academic'          => 'Academic',
            'Exam'              => 'Exam',
            'Meeting'           => 'Meeting',
            'National Holiday'  => 'National Holiday',
            'Religious Holiday' => 'Religious Holiday',
            'Other'             => 'Other',
        ];
    }

    private function _colors(): array
    {
        return [
            '#2f7ef5' => 'Blue',
            '#10b981' => 'Green',
            '#f59e0b' => 'Amber',
            '#ef4444' => 'Red',
            '#8b5cf6' => 'Purple',
            '#0891b2' => 'Cyan',
            '#f97316' => 'Orange',
            '#64748b' => 'Slate',
        ];
    }

    // ── index ─────────────────────────────────────────────────────────────────

    public function index()
    {
        $clientCode = $this->_clientCode();
        if (!$clientCode) {
            return $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        }

        $conn   = ConnectionManager::get('default');
        $filter = $this->request->getQuery('type', 'all');   // all | event | holiday
        $month  = $this->request->getQuery('month', date('Y-m'));

        // List for selected month
        [$year, $mon] = explode('-', $month . '-' . date('m'));
        $typeClause = ($filter !== 'all') ? "AND event_type = '$filter'" : '';

        $events = $conn->execute(
            "SELECT * FROM ssms_school_events
             WHERE ssms_client_code = ?
               AND (
                     (event_end_date IS NULL AND DATE_FORMAT(event_date,'%Y-%m') = ?)
                  OR (event_end_date IS NOT NULL AND event_date <= LAST_DAY(?) AND event_end_date >= ?)
               )
               $typeClause
             ORDER BY event_date ASC, event_title ASC",
            [$clientCode, $month, "$month-01", "$month-01"]
        )->fetchAll('assoc');

        // All events for calendar dots (current month only for perf)
        $calEvents = $events;

        // Upcoming 10 for sidebar preview (from today onward)
        $upcoming = $conn->execute(
            "SELECT * FROM ssms_school_events
             WHERE ssms_client_code = ?
               AND (event_end_date IS NULL AND event_date >= CURDATE()
                    OR event_end_date >= CURDATE())
             ORDER BY event_date ASC LIMIT 10",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact('events', 'calEvents', 'upcoming', 'filter', 'month'));
        $this->set('isAdminOrOwner', $this->_isAdminOrOwner());
    }

    // ── add ───────────────────────────────────────────────────────────────────

    public function add()
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;

        $clientCode = $this->_clientCode();
        $saved = false;

        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $conn = ConnectionManager::get('default');

            // Validate required fields
            if (empty($d['event_title']) || empty($d['event_date'])) {
                $this->Flash->error('Event title and date are required.');
            } else {
                $endDate   = !empty($d['event_end_date']) ? $d['event_end_date'] : null;
                $desc      = !empty($d['event_description']) ? $d['event_description'] : null;
                $isPublic  = isset($d['is_public']) ? 1 : 0;
                $color     = $d['event_color'] ?? '#2f7ef5';
                $category  = $d['event_category'] ?? 'Other';
                $type      = in_array($d['event_type'] ?? '', ['event','holiday']) ? $d['event_type'] : 'event';
                $createdBy = $this->request->getSession()->read('ssms_user_name');

                try {
                    $conn->execute(
                        "INSERT INTO ssms_school_events
                            (ssms_client_code, event_title, event_type, event_category,
                             event_date, event_end_date, event_description,
                             event_color, is_public, created_by)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [
                            $clientCode, $d['event_title'], $type, $category,
                            $d['event_date'], $endDate, $desc,
                            $color, $isPublic, $createdBy,
                        ]
                    );
                    $this->Flash->success('Event saved successfully.');
                    return $this->redirect(['action' => 'index']);
                } catch (\Exception $e) {
                    $this->Flash->error('Could not save the event. ' . $e->getMessage());
                }
            }
        }

        $this->set('categories', $this->_categories());
        $this->set('colors', $this->_colors());
        $this->set('formData', $this->request->getData());
    }

    // ── edit ──────────────────────────────────────────────────────────────────

    public function edit($id = null)
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;

        // Resolve id: pass[0] is the URL segment (e.g. /edit/5), fallback to named param or arg
        $pass = $this->request->getParam('pass');
        $id   = (!empty($pass[0]) ? $pass[0] : null)
             ?? $this->request->getParam('id')
             ?? $id;
        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $event = $conn->execute(
            "SELECT * FROM ssms_school_events WHERE event_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        )->fetch('assoc');

        if (!$event) {
            $this->Flash->error('Event not found.');
            return $this->redirect(['action' => 'index']);
        }

        if ($this->request->is(['post', 'put'])) {
            $d = $this->request->getData();

            if (empty($d['event_title']) || empty($d['event_date'])) {
                $this->Flash->error('Event title and date are required.');
            } else {
                $endDate   = !empty($d['event_end_date']) ? $d['event_end_date'] : null;
                $desc      = !empty($d['event_description']) ? $d['event_description'] : null;
                $isPublic  = isset($d['is_public']) ? 1 : 0;
                $color     = $d['event_color'] ?? '#2f7ef5';
                $category  = $d['event_category'] ?? 'Other';
                $type      = in_array($d['event_type'] ?? '', ['event','holiday']) ? $d['event_type'] : 'event';

                try {
                    $params = [
                        $d['event_title'], $type, $category,
                        $d['event_date'], $endDate, $desc,
                        $color, $isPublic,
                        (int)$id, $clientCode,
                    ];
                    $conn->execute(
                        "UPDATE ssms_school_events SET
                            event_title       = ?,
                            event_type        = ?,
                            event_category    = ?,
                            event_date        = ?,
                            event_end_date    = ?,
                            event_description = ?,
                            event_color       = ?,
                            is_public         = ?
                         WHERE event_id = ? AND ssms_client_code = ?",
                        $params
                    );
                    $this->Flash->success('Event updated successfully.');
                    return $this->redirect(['action' => 'index']);
                } catch (\Exception $e) {
                    $this->Flash->error('Could not update the event. ' . $e->getMessage());
                }
            }
        }

        $this->set(compact('event'));
        $this->set('categories', $this->_categories());
        $this->set('colors', $this->_colors());
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function delete($id = null)
    {
        if ($r = $this->_requireAdminOrOwner()) return $r;
        $this->request->allowMethod(['post', 'delete']);

        $pass = $this->request->getParam('pass');
        $id   = (!empty($pass[0]) ? $pass[0] : null)
             ?? $this->request->getParam('id')
             ?? $id;

        $clientCode = $this->_clientCode();
        $conn       = ConnectionManager::get('default');

        $conn->execute(
            "DELETE FROM ssms_school_events WHERE event_id = ? AND ssms_client_code = ?",
            [(int)$id, $clientCode]
        );

        $this->Flash->success('Event deleted.');
        return $this->redirect(['action' => 'index']);
    }
}
