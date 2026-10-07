<?php
declare(strict_types=1);
namespace App\Mailer;

use Cake\Mailer\Mailer;

/**
 * Expense approval / rejection email notifications.
 *
 * Usage:
 *   $m = new ExpenseMailer();
 *   $m->send('approved', [$expense, $school]);
 *   $m->send('rejected', [$expense, $school, $remarks]);
 */
class ExpenseMailer extends Mailer
{
    /**
     * Sent to the expense submitter when the owner approves.
     */
    public function approved(array $expense, array $school): void
    {
        $to = $this->resolveRecipient($expense);
        if (!$to) return;

        $this
            ->setTo($to)
            ->setSubject('[ManageMyAcademy] Expense Approved — ' . $expense['voucher_no'])
            ->setViewVars(compact('expense','school'))
            ->setEmailFormat('both')
            ->viewBuilder()
                ->setTemplate('expense_approved');
    }

    /**
     * Sent to the expense submitter when the owner rejects.
     */
    public function rejected(array $expense, array $school, string $remarks = ''): void
    {
        $to = $this->resolveRecipient($expense);
        if (!$to) return;

        $this
            ->setTo($to)
            ->setSubject('[ManageMyAcademy] Expense Rejected — ' . $expense['voucher_no'])
            ->setViewVars(compact('expense','school','remarks'))
            ->setEmailFormat('both')
            ->viewBuilder()
                ->setTemplate('expense_rejected');
    }

    /**
     * Look up the submitter's email from ssms_sawera_users.
     * Falls back to returning null (send() will bail silently).
     */
    private function resolveRecipient(array $expense): ?string
    {
        // created_by stores the login username
        try {
            $conn = \Cake\Datasource\ConnectionManager::get('default');
            $row  = $conn->execute(
                "SELECT ssms_user_email FROM ssms_sawera_users
                 WHERE ssms_user_name=? AND ssms_client_code=? LIMIT 1",
                [$expense['created_by'], $expense['ssms_client_code']]
            )->fetch('assoc');
            return ($row && !empty($row['ssms_user_email'])) ? $row['ssms_user_email'] : null;
        } catch (\Throwable $e) {
            return null;
        }
    }
}
