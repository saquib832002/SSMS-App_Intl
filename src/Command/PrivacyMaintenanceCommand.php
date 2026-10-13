<?php
declare(strict_types=1);

namespace App\Command;

use App\Service\AccountSecurity;
use App\Service\Audit;
use App\Service\PrivacyRequests;
use Cake\Command\Command;
use Cake\Console\Arguments;
use Cake\Console\ConsoleIo;
use Cake\Datasource\ConnectionManager;

/**
 * bin/cake privacy_maintenance      (run once a day)
 *
 *  - finishes approved deletions whose 7-day cancel window has passed
 *  - removes expired data-copy downloads
 *  - removes audit entries older than each school's retention; shortens IPs older than 90 days
 *  - clears old failed sign-in attempts, expired sessions and used set-password links
 *
 * Linux / cPanel cron:  15 2 * * *  cd /path/to/app && bin/cake privacy_maintenance
 * Windows (XAMPP):      Task Scheduler, daily → C:\xampp\php\php.exe C:\xampp\htdocs\bin\cake.php privacy_maintenance
 * (Deletions also run whenever an admin opens Privacy requests in the app.)
 */
class PrivacyMaintenanceCommand extends Command
{
    public static function defaultName(): string
    {
        return 'privacy_maintenance';
    }

    public function execute(Arguments $args, ConsoleIo $io): int
    {
        $db  = ConnectionManager::get('default');
        $due = PrivacyRequests::runDue();
        $io->out("Deletions done: {$due['deleted']} · downloads expired: {$due['expired']}");

        $schools = array_column($db->execute('SELECT DISTINCT ssms_client_code FROM ssms_audit_log')->fetchAll('assoc'), 'ssms_client_code');
        foreach ($schools as $c) {
            $years = AccountSecurity::settings((string)$c)['audit_retention_years'];
            $r = Audit::maintain((string)$c, $years);
            if ($r['deleted'] || $r['ips_shortened']) {
                $io->out("{$c}: audit entries removed {$r['deleted']}, IPs shortened {$r['ips_shortened']}");
            }
        }
        $now = AccountSecurity::now();
        foreach ([
            ['DELETE FROM ssms_login_attempts WHERE attempted_at < ?', date('Y-m-d H:i:s', AccountSecurity::time() - 86400), 'old sign-in attempts'],
            ['DELETE FROM ssms_user_sessions WHERE expires < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', null, 'old sessions'],
            ['DELETE FROM ssms_password_tokens WHERE expires < ?', $now, 'expired set-password links'],
            ['DELETE FROM ssms_trusted_devices WHERE expires < ?', $now, 'expired trusted devices'],
        ] as [$sql, $p, $label]) {
            try {
                $params = $p === null ? [date('Y-m-d H:i:s', AccountSecurity::time() - 60 * 86400), date('Y-m-d H:i:s', AccountSecurity::time() - 60 * 86400)] : [$p];
                $n = $db->execute($sql, $params)->rowCount();
                if ($n) {
                    $io->out("Removed {$n} {$label}");
                }
            } catch (\Throwable $e) {
                $io->warning($label . ': ' . $e->getMessage());
            }
        }

        return static::CODE_SUCCESS;
    }
}
