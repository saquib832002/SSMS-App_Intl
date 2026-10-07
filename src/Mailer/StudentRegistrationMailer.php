<?php
declare(strict_types=1);
namespace App\Mailer;

use Cake\Mailer\Mailer;

/**
 * Student registration confirmation email.
 *
 * Usage:
 *   (new StudentRegistrationMailer())->send('confirm', [$toEmail, $studentName, $regId, $schoolName]);
 */
class StudentRegistrationMailer extends Mailer
{
    public function confirm(string $toEmail, string $studentName, string $regId, string $schoolName): void
    {
        if (empty(trim($toEmail))) return;

        $this
            ->setTo($toEmail, $studentName)
            ->setSubject('Registration Confirmed — ' . $schoolName . ' | Reg# ' . $regId)
            ->setViewVars(compact('studentName', 'regId', 'schoolName'))
            ->setEmailFormat('html')
            ->viewBuilder()
                ->setTemplate('student_registration_confirm');
    }
}
