<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;
use Cake\Mailer\Mailer;

class SupportTicketsController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
    }

    // =========================================================================
    // GET/POST /contact-support
    // Logged-in users (admin / owner / user) submit a support ticket
    // =========================================================================
    public function submit(): void
    {
        $session   = $this->request->getSession();
        $role      = $session->read('ssms_user_role');

        // Must be logged in as a non-superuser
        if (!$role || $role === 'superuser') {
            $this->Flash->error('Please log in to contact support.');
            $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
            return;
        }

        // Pre-fill from session
        $prefill = [
            'name'             => trim($session->read('ssms_user_firstname') . ' ' . $session->read('ssms_user_lastname')),
            'email_address'    => $session->read('ssms_user_email') ?? '',
            'mobile_number'    => '',
            'problem_description' => '',
            'ssms_client_code' => $session->read('ssms_client_code') ?? '',
        ];

        $success     = false;
        $ticketNumber = '';
        $errors      = [];

        if ($this->request->is('post')) {
            $data = [
                'name'               => trim((string)$this->request->getData('name')),
                'email_address'      => strtolower(trim((string)$this->request->getData('email_address'))),
                'mobile_number'      => trim((string)$this->request->getData('mobile_number')),
                'problem_description'=> trim((string)$this->request->getData('problem_description')),
                'ssms_client_code'   => strtoupper(trim((string)$this->request->getData('ssms_client_code'))),
            ];

            // Validate
            if ($data['name'] === '')               $errors[] = 'Full name is required.';
            if ($data['email_address'] === '')      $errors[] = 'Email address is required.';
            elseif (!filter_var($data['email_address'], FILTER_VALIDATE_EMAIL))
                                                    $errors[] = 'Please enter a valid email address.';
            if ($data['problem_description'] === '') $errors[] = 'Problem description is required.';

            if (empty($errors)) {
                $db         = ConnectionManager::get('default');
                $datePrefix = 'TKT-' . date('Ymd') . '-';
                $lastRow    = $db->execute(
                    "SELECT ticket_number FROM support_tickets WHERE ticket_number LIKE ? ORDER BY ticket_id DESC LIMIT 1",
                    [$datePrefix . '%']
                )->fetch('assoc');

                $seq = 1;
                if ($lastRow) {
                    $parts = explode('-', $lastRow['ticket_number']);
                    $seq   = (int)end($parts) + 1;
                }
                $ticketNumber = $datePrefix . str_pad((string)$seq, 4, '0', STR_PAD_LEFT);
                $now          = date('Y-m-d H:i:s');

                try {
                    $db->execute(
                        "INSERT INTO support_tickets
                            (ticket_number, name, email_address, mobile_number,
                             problem_description, ssms_client_code, status, created, modified)
                         VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?)",
                        [
                            $ticketNumber,
                            $data['name'],
                            $data['email_address'],
                            $data['mobile_number'] ?: null,
                            $data['problem_description'],
                            $data['ssms_client_code'] ?: null,
                            $now,
                            $now,
                        ]
                    );

                    // Send confirmation email to submitter
                    $this->_sendConfirmationEmail($ticketNumber, $data);

                    Log::info("Support ticket submitted via web: {$ticketNumber} by {$data['email_address']}");
                    $success = true;
                    $prefill = $data; // keep values for display in success card
                } catch (\Exception $e) {
                    Log::error('Support ticket submit error: ' . $e->getMessage());
                    $errors[] = 'Could not save your ticket. Please try again.';
                }
            }

            if (!empty($errors)) {
                $prefill = array_merge($prefill, $this->request->getData());
            }
        }

        $this->set(compact('prefill', 'success', 'ticketNumber', 'errors'));
    }

    /** Send acknowledgement email to the ticket submitter */
    private function _sendConfirmationEmail(string $ticketNumber, array $data): void
    {
        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('text')
                ->setTo($data['email_address'], $data['name'])
                ->setFrom(
                    env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                    env('MAIL_FROM_NAME',    'Manage My Academy Support')
                )
                ->setSubject("[{$ticketNumber}] Support Request Received — Manage My Academy");

            $body = "Dear {$data['name']},\n\n"
                  . "Thank you for reaching out. We have received your support request.\n\n"
                  . "Ticket Number : {$ticketNumber}\n"
                  . "Status        : Open\n\n"
                  . "Your Issue:\n{$data['problem_description']}\n\n"
                  . "Our team will respond within 24–48 hours.\n\n"
                  . "— Manage My Academy Support Team\n";

            $mailer->deliver($body);
        } catch (\Exception $e) {
            Log::error("Ticket confirmation email failed [{$ticketNumber}]: " . $e->getMessage());
        }
    }

    // =========================================================================
    // GET /my-tickets
    // Show all tickets the logged-in user submitted (matched by email)
    // =========================================================================
    public function myTickets(): void
    {
        $session = $this->request->getSession();
        $role    = $session->read('ssms_user_role');

        if (!$role || $role === 'superuser') {
            $this->Flash->error('Please log in to view your tickets.');
            $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
            return;
        }

        $db         = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code') ?? '';

        $tickets = $db->execute(
            "SELECT ticket_id, ticket_number, name, email_address,
                    problem_description, status, created, modified
             FROM support_tickets
             WHERE ssms_client_code = ?
             ORDER BY ticket_id DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->set(compact('tickets', 'clientCode'));
    }

    // =========================================================================
    // GET/POST /my-ticket/*
    // User views a single ticket and can add a reply
    // =========================================================================
    public function ticketDetail(int $ticketId = 0): void
    {
        $session   = $this->request->getSession();
        $role      = $session->read('ssms_user_role');

        if (!$role || $role === 'superuser') {
            $this->Flash->error('Please log in to view your tickets.');
            $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
            return;
        }

        $db         = ConnectionManager::get('default');
        $clientCode = $session->read('ssms_client_code') ?? '';
        $firstName  = $session->read('ssms_user_firstname') ?: $session->read('ssms_user_name');

        // Fetch ticket — only if it belongs to this school
        $ticket = $db->execute(
            "SELECT * FROM support_tickets WHERE ticket_id = ? AND ssms_client_code = ? LIMIT 1",
            [$ticketId, $clientCode]
        )->fetch('assoc');

        if (!$ticket) {
            $this->Flash->error('Ticket not found or you do not have access to it.');
            $this->redirect(['action' => 'myTickets']);
            return;
        }

        if ($this->request->is('post')) {
            $reply = trim((string)($this->request->getData('reply') ?? ''));

            if ($reply === '') {
                $this->Flash->error('Please type a reply before submitting.');
            } else {
                $timestamp = date('d M Y, h:i A');
                $entry     = "[{$timestamp}] [{$firstName}]\n{$reply}";
                $existing  = trim((string)($ticket['response'] ?? ''));
                $updated   = $existing !== '' ? $existing . "\n\n" . $entry : $entry;

                $db->execute(
                    "UPDATE support_tickets SET response = ?, modified = NOW() WHERE ticket_id = ?",
                    [$updated, $ticketId]
                );

                // Notify admin about user reply
                $this->_notifyAdminOfUserReply($ticket, $firstName, $reply);

                Log::info("User reply on ticket #{$ticketId} by {$userEmail}");
                $this->Flash->success('Your reply has been sent.');
                $this->redirect(['action' => 'ticketDetail', $ticketId]);
                return;
            }
        }

        // Re-fetch fresh after possible update
        $ticket = $db->execute(
            "SELECT * FROM support_tickets WHERE ticket_id = ? LIMIT 1",
            [$ticketId]
        )->fetch('assoc');

        $this->set(compact('ticket'));
    }

    /** Email admin when a user replies on their ticket */
    private function _notifyAdminOfUserReply(array $ticket, string $userName, string $reply): void
    {
        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('text')
                ->setTo(
                    env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                    'Manage My Academy Support'
                )
                ->setFrom(
                    env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                    env('MAIL_FROM_NAME', 'Manage My Academy Support')
                )
                ->setSubject("[{$ticket['ticket_number']}] User Reply — {$ticket['name']}");

            $body = "A user has replied on their support ticket.\n\n"
                  . "Ticket   : {$ticket['ticket_number']}\n"
                  . "From     : {$ticket['name']} <{$ticket['email_address']}>\n"
                  . "Status   : {$ticket['status']}\n\n"
                  . "Reply:\n{$reply}\n\n"
                  . "Original Issue:\n{$ticket['problem_description']}\n";

            $mailer->deliver($body);
        } catch (\Exception $e) {
            Log::error("Admin notify email failed [{$ticket['ticket_number']}]: " . $e->getMessage());
        }
    }

    /** Guard: superuser only */
    private function _requireSuperuser(): bool
    {
        $session = $this->request->getSession();
        if ($session->read('ssms_user_role') !== 'superuser') {
            $this->Flash->error('You are not authorized to access this page.');
            $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
            return false;
        }
        return true;
    }

    // =========================================================================
    // GET /admin/support-tickets
    // List all tickets with optional status / search filter
    // =========================================================================
    public function index(): void
    {
        if (!$this->_requireSuperuser()) return;

        $db     = ConnectionManager::get('default');
        $status = trim((string)($this->request->getQuery('status') ?? ''));
        $search = trim((string)($this->request->getQuery('q')      ?? ''));

        $where  = [];
        $params = [];

        if ($status && $status !== 'all') {
            $where[]  = 't.status = ?';
            $params[] = $status;
        }
        if ($search !== '') {
            $where[]  = '(t.ticket_number LIKE ? OR t.name LIKE ? OR t.email_address LIKE ? OR t.problem_description LIKE ?)';
            $like     = '%' . $search . '%';
            $params   = array_merge($params, [$like, $like, $like, $like]);
        }

        $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $tickets = $db->execute(
            "SELECT t.*, c.ssms_client_header_text AS school_name
             FROM support_tickets t
             LEFT JOIN ssms_clients c ON c.ssms_client_code = t.ssms_client_code
             {$whereClause}
             ORDER BY
               CASE t.status WHEN 'Open' THEN 0 WHEN 'In Progress' THEN 1 WHEN 'Resolved' THEN 2 ELSE 3 END,
               t.ticket_id DESC",
            $params
        )->fetchAll('assoc');

        // KPI counts
        $counts = $db->execute(
            "SELECT status, COUNT(*) AS cnt FROM support_tickets GROUP BY status"
        )->fetchAll('assoc');
        $kpi = ['Open' => 0, 'In Progress' => 0, 'Resolved' => 0, 'Closed' => 0];
        foreach ($counts as $row) {
            $kpi[$row['status']] = (int)$row['cnt'];
        }

        $this->set(compact('tickets', 'kpi', 'status', 'search'));
    }

    // =========================================================================
    // GET/POST /admin/support-tickets/view/{id}
    // View ticket detail; POST to update status + response
    // =========================================================================
    public function view(int $ticketId = 0): void
    {
        if (!$this->_requireSuperuser()) return;

        $db = ConnectionManager::get('default');

        $ticket = $db->execute(
            "SELECT t.*, c.ssms_client_header_text AS school_name
             FROM support_tickets t
             LEFT JOIN ssms_clients c ON c.ssms_client_code = t.ssms_client_code
             WHERE t.ticket_id = ? LIMIT 1",
            [$ticketId]
        )->fetch('assoc');

        if (!$ticket) {
            $this->Flash->error('Ticket not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        if ($this->request->is('post')) {
            $newStatus   = trim((string)($this->request->getData('status')   ?? $ticket['status']));
            $newResponse = trim((string)($this->request->getData('response') ?? ''));
            $session     = $this->request->getSession();
            $updatedBy   = $session->read('ssms_user_firstname') ?: $session->read('ssms_user_name');

            // Append new reply with timestamp; skip if box was left empty
            if ($newResponse !== '') {
                $timestamp    = date('d M Y, h:i A');
                $entry        = "[{$timestamp}] [{$updatedBy}]\n{$newResponse}";
                $existing     = trim((string)($ticket['response'] ?? ''));
                $saveResponse = $existing !== '' ? $existing . "\n\n" . $entry : $entry;
            } else {
                $saveResponse = $ticket['response'] ?? null;
            }

            $db->execute(
                "UPDATE support_tickets SET status = ?, response = ?, modified = NOW() WHERE ticket_id = ?",
                [$newStatus, $saveResponse, $ticketId]
            );

            Log::info("SupportTicket #{$ticketId} updated: status={$newStatus} by {$updatedBy}");

            // Email the ticket creator
            $this->_sendReplyEmail($ticket, $newStatus, $newResponse);

            $this->Flash->success("Ticket {$ticket['ticket_number']} updated successfully.");
            $this->redirect(['action' => 'view', $ticketId]);
            return;
        }

        // Fetch fresh after possible update
        $ticket = $db->execute(
            "SELECT t.*, c.ssms_client_header_text AS school_name
             FROM support_tickets t
             LEFT JOIN ssms_clients c ON c.ssms_client_code = t.ssms_client_code
             WHERE t.ticket_id = ? LIMIT 1",
            [$ticketId]
        )->fetch('assoc');

        $statusOptions = ['Open', 'In Progress', 'Resolved', 'Closed'];
        $this->set(compact('ticket', 'statusOptions'));
    }

    // =========================================================================
    // POST /admin/support-tickets/delete/{id}
    // Soft-close (sets status = Closed) or hard-delete for superuser
    // =========================================================================
    public function delete(int $ticketId = 0): void
    {
        if (!$this->_requireSuperuser()) return;
        $this->request->allowMethod(['post']);

        $db = ConnectionManager::get('default');
        $db->execute("DELETE FROM support_tickets WHERE ticket_id = ?", [$ticketId]);

        $this->Flash->success('Ticket deleted.');
        $this->redirect(['action' => 'index']);
    }

    // =========================================================================
    // Private helpers
    // =========================================================================
    private function _sendReplyEmail(array $ticket, string $newStatus, string $response): void
    {
        if (empty($ticket['email_address']) || empty($response)) return;

        try {
            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('text')
                ->setTo($ticket['email_address'], $ticket['name'])
                ->setFrom(
                    env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                    env('MAIL_FROM_NAME', 'Manage My Academy Support')
                )
                ->setSubject("Re: [{$ticket['ticket_number']}] Your Support Request — Status: {$newStatus}");

            $body = "Dear {$ticket['name']},\n\n"
                  . "Thank you for contacting Manage My Academy Support.\n\n"
                  . "Your ticket {$ticket['ticket_number']} has been updated.\n\n"
                  . "Status   : {$newStatus}\n"
                  . "Response :\n{$response}\n\n"
                  . "If you have further questions, please reply to this email or submit a new ticket.\n\n"
                  . "— Manage My Academy Support Team\n";

            $mailer->deliver($body);
        } catch (\Exception $e) {
            Log::error('SupportTicket reply email failed: ' . $e->getMessage());
        }
    }
}
