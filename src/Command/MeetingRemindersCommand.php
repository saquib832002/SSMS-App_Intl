<?php
declare(strict_types=1);

namespace App\Command;

use App\Service\Meetings;
use Cake\Command\Command;
use Cake\Console\Arguments;
use Cake\Console\ConsoleIo;

/**
 * bin/cake meeting_reminders
 *
 * Parent–teacher meetings: pushes the day-before and the about-an-hour-before reminder to the
 * parent who booked and to the teacher. Each reminder goes out once. Schedule it every 15 minutes:
 *   Linux / cPanel cron (minutes 0,15,30,45 of every hour):  cd /path/to/app && bin/cake meeting_reminders
 *   Windows (XAMPP):      Task Scheduler, every 15 min → C:\xampp\php\php.exe C:\xampp\htdocs\bin\cake.php meeting_reminders
 * Without it, reminders still go out whenever someone opens the meetings screens.
 */
class MeetingRemindersCommand extends Command
{
    public static function defaultName(): string
    {
        return 'meeting_reminders';
    }

    public function execute(Arguments $args, ConsoleIo $io): int
    {
        $n = Meetings::remindDue();
        $io->out("Meeting reminders sent: {$n}");

        return static::CODE_SUCCESS;
    }
}
