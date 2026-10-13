<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * School session calendar, driven by School Settings (session_start_month).
 * Works for any start month: Apr (India), Aug (US), May, Jan, …
 *
 *  - startMonth('ABC')            → 8
 *  - startMonthName('ABC')        → 'Aug'   (one-time fees use this month)
 *  - dueDate('Jan', 'ABC', 12)    → '2027-01-01' for session "2026-27"
 */
class SessionCalendar
{
    public const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** @var array<string,int> */
    private static array $cache = [];

    public static function startMonth(?string $clientCode): int
    {
        $code = (string)$clientCode;
        if (isset(self::$cache[$code])) {
            return self::$cache[$code];
        }
        $m = 4;
        try {
            $row = ConnectionManager::get('default')->execute(
                'SELECT session_start_month FROM ssms_school_settings WHERE client_code = ? LIMIT 1',
                [$code]
            )->fetch('assoc');
            $v = (int)($row['session_start_month'] ?? 0);
            if ($v >= 1 && $v <= 12) {
                $m = $v;
            }
        } catch (\Throwable $e) {
        }

        return self::$cache[$code] = $m;
    }

    public static function startMonthName(?string $clientCode): string
    {
        return self::NAMES[self::startMonth($clientCode) - 1];
    }

    /** Session months in order, e.g. Aug … Jul. */
    public static function months(?string $clientCode): array
    {
        $s = self::startMonth($clientCode) - 1;

        return array_merge(array_slice(self::NAMES, $s), array_slice(self::NAMES, 0, $s));
    }

    /** Calendar year the session starts: first 4-digit year in its name, else this year. */
    public static function startYear($sessionId = null): int
    {
        $year = (int)date('Y');
        if (!empty($sessionId)) {
            try {
                $row = ConnectionManager::get('default')->execute(
                    'SELECT session_name FROM ssms_sessions WHERE session_id = ? LIMIT 1',
                    [$sessionId]
                )->fetch('assoc');
                if ($row && preg_match('/(19|20)\d{2}/', (string)$row['session_name'], $m)) {
                    $year = (int)$m[0];
                }
            } catch (\Throwable $e) {
            }
        }

        return $year;
    }

    /** 1st of the given month inside the session (months before the start month → next year). */
    public static function dueDate(string $monthName, ?string $clientCode, $sessionId = null): string
    {
        $start = self::startMonth($clientCode);
        $idx   = array_search(ucfirst(strtolower(substr(trim($monthName), 0, 3))), self::NAMES, true);
        $month = $idx === false ? $start : $idx + 1;
        $year  = self::startYear($sessionId);
        if ($month < $start) {
            $year++;
        }

        return sprintf('%04d-%02d-01', $year, $month);
    }
}
