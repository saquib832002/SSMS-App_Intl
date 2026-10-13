<?php
declare(strict_types=1);

namespace App\Command;

use App\Service\StaffAttendance;
use Cake\Command\Command;
use Cake\Console\Arguments;
use Cake\Console\ConsoleIo;

/**
 * bin/cake staff_checkin_reminders
 *
 * Pushes "You haven't checked in yet" to staff who have not checked in by school start + grace
 * (only schools with the reminder turned on; once per person per day; school days only).
 * Schedule it every 5 minutes on school mornings:
 *   Linux / cPanel cron:  every 5 min, 6-12h, Mon-Sat:  cd /path/to/app && bin/cake staff_checkin_reminders
 *   Windows (XAMPP):      Task Scheduler → C:\xampp\php\php.exe C:\xampp\htdocs\bin\cake.php staff_checkin_reminders
 * Without it, reminders still go out whenever the office code screen (or a staff/admin attendance screen) is open.
 */
class StaffCheckinRemindersCommand extends Command
{
    public static function defaultName(): string
    {
        return 'staff_checkin_reminders';
    }

    public function execute(Arguments $args, ConsoleIo $io): int
    {
        $done = StaffAttendance::remindAll();
        foreach ($done as $code => $n) {
            $io->out("{$code}: reminded {$n}");
        }
        if (!$done) {
            $io->out('No school has check-in reminders turned on.');
        }

        return static::CODE_SUCCESS;
    }
}
