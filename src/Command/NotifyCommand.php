<?php
declare(strict_types=1);

namespace App\Command;

use App\Service\Notify;
use Cake\Command\Command;
use Cake\Console\Arguments;
use Cake\Console\ConsoleIo;
use Cake\Console\ConsoleOptionParser;

/**
 * bin/cake notify  [--school CODE]
 *
 * Automatic notifications: finds new absences, late/early records, notices, homework, fee due dates and
 * published report cards, and sends the push / e-mail messages that are due. Schedule it every 5 minutes:
 *   Linux / cPanel cron:  every 5 minutes  →  cd /path/to/app && bin/cake notify
 *   Windows (XAMPP):      Task Scheduler, every 5 min → C:\xampp\php\php.exe C:\xampp\htdocs\bin\cake.php notify
 * Without it, messages still go out (at most once a minute per school) whenever someone opens the app.
 */
class NotifyCommand extends Command
{
    public static function defaultName(): string
    {
        return 'notify';
    }

    protected function buildOptionParser(ConsoleOptionParser $parser): ConsoleOptionParser
    {
        return $parser->addOption('school', ['help' => 'Only this school (client code)']);
    }

    public function execute(Arguments $args, ConsoleIo $io): int
    {
        $school = $args->getOption('school');
        $n = Notify::run($school !== null && $school !== '' ? (string)$school : null);
        $io->out("Notifications sent: {$n}");

        return static::CODE_SUCCESS;
    }
}
