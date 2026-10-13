<?php
declare(strict_types=1);

namespace App\Command;

use App\Service\Messaging;
use App\Service\MessagingProviders;
use Cake\Command\Command;
use Cake\Console\Arguments;
use Cake\Console\ConsoleIo;
use Cake\Console\ConsoleOptionParser;
use Cake\Datasource\ConnectionManager;

/**
 * ManageMyAcademy's own SMS / WhatsApp accounts, for schools that choose "Use ManageMyAcademy's account".
 * The keys are typed here (never through the app) and stored encrypted.
 *
 *   bin/cake notify_platform show
 *   bin/cake notify_platform set sms twilio          (asks for each key, the sender, the monthly allowance per school and the price)
 *   bin/cake notify_platform allowance SCHOOL sms 500   (this school's messages per month; "default" = the platform default)
 *   bin/cake notify_platform off whatsapp            (stop offering it)
 */
class NotifyPlatformCommand extends Command
{
    public static function defaultName(): string
    {
        return 'notify_platform';
    }

    protected function buildOptionParser(ConsoleOptionParser $parser): ConsoleOptionParser
    {
        return $parser->setDescription("ManageMyAcademy's SMS / WhatsApp accounts")
            ->addArgument('action', ['help' => 'show | set | allowance | off', 'required' => true])
            ->addArgument('a', ['help' => 'set/off: channel (sms|whatsapp) · allowance: school code'])
            ->addArgument('b', ['help' => 'set: provider · allowance: channel'])
            ->addArgument('c', ['help' => 'allowance: messages per month, or "default"']);
    }

    public function execute(Arguments $args, ConsoleIo $io): int
    {
        $action = (string)$args->getArgument('action');
        $db = ConnectionManager::get('default');
        if ($action === 'show') {
            foreach (Messaging::CHANNELS as $ch) {
                $p = Messaging::platform($ch);
                $io->out(strtoupper($ch) . ': ' . ($p ? MessagingProviders::LIST[$p['provider']]['name'] . ' · sender ' . ($p['sender'] ?: '–') . ' · ' . $p['default_allowance']
                    . ' a month per school · price ' . ($p['cost_per_message'] ?? '–') . ' ' . $p['currency'] : 'not set up'));
                if ($p) {
                    $io->out('    webhook for delivery reports and replies: ' . Messaging::hookUrl('platform', (string)$p['provider'])
                        . ($p['provider'] === 'meta' ? '  (verify token ' . Messaging::hookKey('platform') . ')' : ''));
                }
            }
            foreach ($db->execute("SELECT ssms_client_code, channel, mode, managed_allowance FROM ssms_notify_channels WHERE mode = 'managed' OR managed_allowance IS NOT NULL ORDER BY 1, 2")->fetchAll('assoc') as $r) {
                $io->out("  {$r['ssms_client_code']} {$r['channel']}: {$r['mode']}, allowance " . ($r['managed_allowance'] ?? 'default') . ', used this month ' . Messaging::used($r['ssms_client_code'], $r['channel'], 'managed'));
            }

            return static::CODE_SUCCESS;
        }
        if ($action === 'set') {
            $ch = (string)$args->getArgument('a');
            $provider = (string)$args->getArgument('b');
            if (!in_array($ch, Messaging::CHANNELS, true) || !MessagingProviders::supports($provider, $ch)) {
                $io->err('Usage: notify_platform set sms|whatsapp PROVIDER  (providers: ' . implode(', ', array_keys(MessagingProviders::LIST)) . ')');

                return static::CODE_ERROR;
            }
            $cfg = [];
            foreach (MessagingProviders::LIST[$provider]['fields'] as [$key, $label, $secret, $required, $help]) {
                $cfg[$key] = trim((string)$io->ask($label . ($required ? '' : ' (optional)') . " – $help"));
            }
            $sender = trim((string)$io->ask('Sender ID / number'));
            $allow = (int)$io->ask('Messages per school per month (default allowance)', '0');
            $cost = trim((string)$io->ask('Price per SMS part / WhatsApp message (for the usage screen, optional)', ''));
            $cur = trim((string)$io->ask('Currency (e.g. USD)', 'USD'));
            Messaging::setPlatform($ch, $provider, $cfg, $sender, $allow, $cost === '' ? null : (float)$cost, $cur);
            $io->success(strtoupper($ch) . " is now offered through $provider.");

            return static::CODE_SUCCESS;
        }
        if ($action === 'allowance') {
            $school = (string)$args->getArgument('a');
            $ch = (string)$args->getArgument('b');
            $n = (string)$args->getArgument('c');
            if ($school === '' || !in_array($ch, Messaging::CHANNELS, true) || ($n !== 'default' && !ctype_digit($n))) {
                $io->err('Usage: notify_platform allowance SCHOOL sms|whatsapp NUMBER|default');

                return static::CODE_ERROR;
            }
            Messaging::setAllowance($school, $ch, $n === 'default' ? null : (int)$n);
            $io->success("$school $ch: " . ($n === 'default' ? 'platform default' : "$n a month"));

            return static::CODE_SUCCESS;
        }
        if ($action === 'off') {
            $ch = (string)$args->getArgument('a');
            $db->execute('DELETE FROM ssms_notify_platform WHERE channel = ?', [$ch]);
            $io->success("ManageMyAcademy's $ch account removed. Schools using it stop sending $ch until they connect their own.");

            return static::CODE_SUCCESS;
        }
        $io->err('Actions: show | set | allowance | off');

        return static::CODE_ERROR;
    }
}
