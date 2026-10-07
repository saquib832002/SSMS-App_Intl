<?php
declare(strict_types=1);
namespace App\Mailer;

use Cake\Mailer\Mailer;

/**
 * Marketing campaign mailer.
 *
 * Usage:
 *   (new MarketingMailer())->send('campaign', [$toEmail, $clientName, $androidLink]);
 */
class MarketingMailer extends Mailer
{
    public function campaign(string $toEmail, string $clientName, string $androidLink = ''): void
    {
        if (empty(trim($toEmail))) return;

        $this
            ->setTo($toEmail, $clientName)
            ->setSubject('Manage My Academy — School Management Features & Subscription Plans')
            ->setViewVars(compact('clientName', 'androidLink'))
            ->setEmailFormat('html')
            ->viewBuilder()
                ->setTemplate('marketing_campaign');
    }
}
