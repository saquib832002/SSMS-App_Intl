<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * School-defined grading scales.
 *
 * A scale is a list of bands: "from X % upwards → label (+ GPA points, descriptor, pass/fail)".
 * Schools start from a preset (letter grades, CBSE 9-point, US GPA 4.0, IB 1–7,
 * Cambridge A*–U, standards-based 4–1) and can edit every band.
 *
 * Schools that never set up a scale keep the old built-in A+ … F grades
 * (labelIfConfigured() returns null so existing screens stay unchanged).
 */
class Grading
{
    public const TYPES = ['letter', 'gpa', 'ib', 'cambridge', 'standards', 'cbse', 'custom'];

    /** @var array<string, array|null> default scale per school (request cache) */
    private static array $defaultCache = [];

    // ── Presets ──────────────────────────────────────────────────────────────

    public static function presets(): array
    {
        $b = static fn(array $rows): array => array_map(static fn($r) => [
            'min_percent' => $r[0], 'label' => $r[1], 'gpa_points' => $r[2],
            'descriptor'  => $r[3], 'is_pass' => $r[4],
        ], $rows);

        return [
            'letter' => [
                'name' => 'Letter grades (A+ to F)', 'scale_type' => 'letter', 'show_gpa' => 0,
                'note' => 'The grades the app used before. Fail below 40%.',
                'bands' => $b([
                    [90, 'A+', null, 'Outstanding', 1], [80, 'A', null, 'Excellent', 1],
                    [70, 'B+', null, 'Very good', 1],   [60, 'B', null, 'Good', 1],
                    [50, 'C', null, 'Average', 1],      [40, 'D', null, 'Pass', 1],
                    [0, 'F', null, 'Fail', 0],
                ]),
            ],
            'cbse' => [
                'name' => 'CBSE 9-point (A1 to E)', 'scale_type' => 'cbse', 'show_gpa' => 1,
                'note' => 'India – CBSE style grades with grade points. Pass from 33%.',
                'bands' => $b([
                    [91, 'A1', 10, 'Outstanding', 1], [81, 'A2', 9, 'Excellent', 1],
                    [71, 'B1', 8, 'Very good', 1],    [61, 'B2', 7, 'Good', 1],
                    [51, 'C1', 6, 'Fair', 1],         [41, 'C2', 5, 'Average', 1],
                    [33, 'D', 4, 'Pass', 1],          [0, 'E', 0, 'Needs improvement', 0],
                ]),
            ],
            'gpa' => [
                'name' => 'US letter grades + GPA 4.0', 'scale_type' => 'gpa', 'show_gpa' => 1,
                'note' => 'A to F with +/- and grade points on a 4.0 scale.',
                'bands' => $b([
                    [93, 'A', 4.0, 'Excellent', 1],  [90, 'A-', 3.7, 'Excellent', 1],
                    [87, 'B+', 3.3, 'Good', 1],      [83, 'B', 3.0, 'Good', 1],
                    [80, 'B-', 2.7, 'Good', 1],      [77, 'C+', 2.3, 'Satisfactory', 1],
                    [73, 'C', 2.0, 'Satisfactory', 1], [70, 'C-', 1.7, 'Satisfactory', 1],
                    [67, 'D+', 1.3, 'Poor', 1],      [65, 'D', 1.0, 'Poor', 1],
                    [0, 'F', 0.0, 'Failing', 0],
                ]),
            ],
            'ib' => [
                'name' => 'IB 1–7', 'scale_type' => 'ib', 'show_gpa' => 0,
                'note' => 'International Baccalaureate grades. Adjust the % boundaries to match your school.',
                'bands' => $b([
                    [80, '7', null, 'Excellent', 1],     [70, '6', null, 'Very good', 1],
                    [60, '5', null, 'Good', 1],          [50, '4', null, 'Satisfactory', 1],
                    [40, '3', null, 'Mediocre', 0],      [25, '2', null, 'Poor', 0],
                    [0, '1', null, 'Very poor', 0],
                ]),
            ],
            'cambridge' => [
                'name' => 'Cambridge IGCSE (A* to U)', 'scale_type' => 'cambridge', 'show_gpa' => 0,
                'note' => 'A* to G, U = ungraded. Boundaries vary by series – adjust as needed.',
                'bands' => $b([
                    [90, 'A*', null, 'Exceptional', 1], [80, 'A', null, 'Excellent', 1],
                    [70, 'B', null, 'Very good', 1],    [60, 'C', null, 'Good', 1],
                    [50, 'D', null, 'Satisfactory', 1], [40, 'E', null, 'Pass', 1],
                    [30, 'F', null, 'Weak', 1],         [20, 'G', null, 'Very weak', 1],
                    [0, 'U', null, 'Ungraded', 0],
                ]),
            ],
            'standards' => [
                'name' => 'Standards-based (4 to 1)', 'scale_type' => 'standards', 'show_gpa' => 0,
                'note' => 'US elementary style: Exceeds / Meets / Approaching / Beginning.',
                'bands' => $b([
                    [90, '4', null, 'Exceeds the standard', 1],
                    [75, '3', null, 'Meets the standard', 1],
                    [60, '2', null, 'Approaching the standard', 1],
                    [0, '1', null, 'Beginning – not yet meeting', 0],
                ]),
            ],
        ];
    }

    /** Built-in fallback when a school has no scale (same grades as before). */
    public static function builtin(): array
    {
        $p = self::presets()['letter'];

        return ['id' => null, 'name' => $p['name'], 'scale_type' => 'letter', 'is_default' => 1,
                'show_gpa' => 0, 'builtin' => true, 'bands' => self::sortBands($p['bands'])];
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    public static function scales(string $clientCode): array
    {
        $rows = self::db()->execute(
            'SELECT id, name, scale_type, is_default, show_gpa FROM ssms_grading_scales
              WHERE ssms_client_code = ? ORDER BY is_default DESC, name ASC',
            [$clientCode]
        )->fetchAll('assoc');
        if (!$rows) {
            return [];
        }
        $ids   = array_map(static fn($r) => (int)$r['id'], $rows);
        $bands = self::bandsFor($ids);
        foreach ($rows as &$r) {
            $r = self::castScale($r);
            $r['bands'] = $bands[$r['id']] ?? [];
        }

        return $rows;
    }

    /** A school's scale by id, or null. */
    public static function scale(string $clientCode, ?int $id): ?array
    {
        if (!$id) {
            return null;
        }
        $row = self::db()->execute(
            'SELECT id, name, scale_type, is_default, show_gpa FROM ssms_grading_scales
              WHERE id = ? AND ssms_client_code = ? LIMIT 1',
            [$id, $clientCode]
        )->fetch('assoc');
        if (!$row) {
            return null;
        }
        $row = self::castScale($row);
        $row['bands'] = self::bandsFor([$row['id']])[$row['id']] ?? [];

        return $row;
    }

    /** The school's default scale, or null when the school never set one up. */
    public static function configuredDefault(string $clientCode): ?array
    {
        if (array_key_exists($clientCode, self::$defaultCache)) {
            return self::$defaultCache[$clientCode];
        }
        $scale = null;
        try {
            $row = self::db()->execute(
                'SELECT id FROM ssms_grading_scales WHERE ssms_client_code = ?
                  ORDER BY is_default DESC, id ASC LIMIT 1',
                [$clientCode]
            )->fetch('assoc');
            if ($row) {
                $scale = self::scale($clientCode, (int)$row['id']);
                if ($scale && !$scale['bands']) {
                    $scale = null;
                }
            }
        } catch (\Throwable $e) {
            $scale = null; // tables not migrated yet → old behaviour
        }

        return self::$defaultCache[$clientCode] = $scale;
    }

    /** The scale to use: the requested one, else the school default, else built-in. */
    public static function resolve(string $clientCode, ?int $scaleId = null): array
    {
        return self::scale($clientCode, $scaleId)
            ?? self::configuredDefault($clientCode)
            ?? self::builtin();
    }

    /** Band for a percentage (bands sorted high → low). */
    public static function band(float $pct, array $bands): ?array
    {
        foreach ($bands as $b) {
            if ($pct + 1e-9 >= (float)$b['min_percent']) {
                return $b;
            }
        }

        return $bands ? $bands[count($bands) - 1] : null;
    }

    /** The lowest (failing) band of a scale. */
    public static function lowest(array $bands): ?array
    {
        return $bands ? $bands[count($bands) - 1] : null;
    }

    /**
     * Grade label from the school's own default scale, or null when the school
     * has no scale (callers then keep their old built-in grades).
     * $forceFail: the student failed a subject → lowest band.
     */
    public static function labelIfConfigured(string $clientCode, float $pct, bool $forceFail = false): ?string
    {
        $s = self::configuredDefault($clientCode);
        if (!$s) {
            return null;
        }
        $b = $forceFail ? self::lowest($s['bands']) : self::band($pct, $s['bands']);

        return $b['label'] ?? null;
    }

    /**
     * Grade + pass/fail from the school's own default scale, or null when the
     * school has no scale. A failed subject means the lowest (failing) grade.
     *
     * @return array{label:string, is_pass:bool}|null
     */
    public static function applyConfigured(string $clientCode, float $pct, bool $failedSubject = false): ?array
    {
        $s = self::configuredDefault($clientCode);
        if (!$s) {
            return null;
        }
        $b = $failedSubject ? self::lowest($s['bands']) : self::band($pct, $s['bands']);

        return ['label' => (string)$b['label'], 'is_pass' => !$failedSubject && (bool)$b['is_pass']];
    }

    // ── Writing ──────────────────────────────────────────────────────────────

    /**
     * Create or update a scale with its bands.
     * $data = { id?, name, scale_type, show_gpa, is_default, bands: [{min_percent,label,gpa_points,descriptor,is_pass}] }
     */
    public static function saveScale(string $clientCode, array $data): array
    {
        $name = trim((string)($data['name'] ?? ''));
        if ($name === '') {
            throw new \InvalidArgumentException('Please enter a name for the grading scale.');
        }
        $type  = in_array($data['scale_type'] ?? '', self::TYPES, true) ? $data['scale_type'] : 'custom';
        $bands = self::cleanBands((array)($data['bands'] ?? []));
        $db    = self::db();
        $id    = (int)($data['id'] ?? 0);
        $now   = date('Y-m-d H:i:s');

        $db->begin();
        try {
            if ($id > 0) {
                $own = $db->execute('SELECT id FROM ssms_grading_scales WHERE id = ? AND ssms_client_code = ?', [$id, $clientCode])->fetch('assoc');
                if (!$own) {
                    throw new \DomainException('Grading scale not found.');
                }
                $db->execute(
                    'UPDATE ssms_grading_scales SET name = ?, scale_type = ?, show_gpa = ?, modified = ? WHERE id = ?',
                    [mb_substr($name, 0, 80), $type, !empty($data['show_gpa']) ? 1 : 0, $now, $id]
                );
                $db->execute('DELETE FROM ssms_grading_bands WHERE scale_id = ?', [$id]);
            } else {
                $db->execute(
                    'INSERT INTO ssms_grading_scales (ssms_client_code, name, scale_type, is_default, show_gpa, created, modified)
                     VALUES (?, ?, ?, 0, ?, ?, ?)',
                    [$clientCode, mb_substr($name, 0, 80), $type, !empty($data['show_gpa']) ? 1 : 0, $now, $now]
                );
                $id = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetch('assoc')['id'];
            }
            foreach ($bands as $i => $b) {
                $db->execute(
                    'INSERT INTO ssms_grading_bands (scale_id, min_percent, label, gpa_points, descriptor, is_pass, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [$id, $b['min_percent'], $b['label'], $b['gpa_points'], $b['descriptor'], $b['is_pass'], $i]
                );
            }
            // First scale of a school, or explicitly asked → default.
            $hasDefault = $db->execute(
                'SELECT COUNT(*) AS c FROM ssms_grading_scales WHERE ssms_client_code = ? AND is_default = 1 AND id <> ?',
                [$clientCode, $id]
            )->fetch('assoc');
            if (!empty($data['is_default']) || (int)$hasDefault['c'] === 0) {
                $db->execute('UPDATE ssms_grading_scales SET is_default = (id = ?) WHERE ssms_client_code = ?', [$id, $clientCode]);
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollback();
            throw $e;
        }
        unset(self::$defaultCache[$clientCode]);

        return self::scale($clientCode, $id);
    }

    public static function createFromPreset(string $clientCode, string $key, bool $makeDefault = false): array
    {
        $p = self::presets()[$key] ?? null;
        if (!$p) {
            throw new \InvalidArgumentException('Unknown preset.');
        }

        return self::saveScale($clientCode, $p + ['is_default' => $makeDefault ? 1 : 0]);
    }

    public static function setDefault(string $clientCode, int $id): void
    {
        if (!self::scale($clientCode, $id)) {
            throw new \DomainException('Grading scale not found.');
        }
        self::db()->execute('UPDATE ssms_grading_scales SET is_default = (id = ?) WHERE ssms_client_code = ?', [$id, $clientCode]);
        unset(self::$defaultCache[$clientCode]);
    }

    public static function deleteScale(string $clientCode, int $id): void
    {
        $s = self::scale($clientCode, $id);
        if (!$s) {
            throw new \DomainException('Grading scale not found.');
        }
        $used = self::db()->execute(
            'SELECT COUNT(*) AS c FROM ssms_report_card_plans WHERE scale_id = ? AND ssms_client_code = ?',
            [$id, $clientCode]
        )->fetch('assoc');
        if ((int)$used['c'] > 0) {
            throw new \DomainException('This scale is used by a report card. Change the report card to another scale first.');
        }
        $db = self::db();
        $db->execute('DELETE FROM ssms_grading_bands WHERE scale_id = ?', [$id]);
        $db->execute('DELETE FROM ssms_grading_scales WHERE id = ?', [$id]);
        if ($s['is_default']) {
            $db->execute(
                'UPDATE ssms_grading_scales SET is_default = 1 WHERE ssms_client_code = ? ORDER BY id ASC LIMIT 1',
                [$clientCode]
            );
        }
        unset(self::$defaultCache[$clientCode]);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** Validate + normalise bands; sorted high → low, lowest band starts at 0 %. */
    public static function cleanBands(array $bands): array
    {
        $out  = [];
        $seen = [];
        foreach ($bands as $b) {
            $label = trim((string)($b['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $min = round((float)($b['min_percent'] ?? 0), 2);
            if ($min < 0 || $min > 100) {
                throw new \InvalidArgumentException("The % for grade {$label} must be between 0 and 100.");
            }
            if (isset($seen[(string)$min])) {
                throw new \InvalidArgumentException("Two grades start at {$min}% – each grade needs its own starting %.");
            }
            $seen[(string)$min] = true;
            $gpa   = $b['gpa_points'] ?? null;
            $out[] = [
                'min_percent' => $min,
                'label'       => mb_substr($label, 0, 20),
                'gpa_points'  => ($gpa === null || $gpa === '') ? null : round((float)$gpa, 2),
                'descriptor'  => mb_substr(trim((string)($b['descriptor'] ?? '')), 0, 100) ?: null,
                'is_pass'     => (!isset($b['is_pass']) || !empty($b['is_pass']) && $b['is_pass'] !== '0') ? 1 : 0,
            ];
        }
        if (count($out) < 2) {
            throw new \InvalidArgumentException('A grading scale needs at least two grades.');
        }
        usort($out, static fn($a, $b) => $b['min_percent'] <=> $a['min_percent']);
        $out[count($out) - 1]['min_percent'] = 0.0; // the lowest grade covers everything below

        return $out;
    }

    private static function sortBands(array $bands): array
    {
        usort($bands, static fn($a, $b) => (float)$b['min_percent'] <=> (float)$a['min_percent']);

        return $bands;
    }

    private static function bandsFor(array $scaleIds): array
    {
        if (!$scaleIds) {
            return [];
        }
        $in   = implode(',', array_fill(0, count($scaleIds), '?'));
        $rows = self::db()->execute(
            "SELECT scale_id, min_percent, label, gpa_points, descriptor, is_pass
               FROM ssms_grading_bands WHERE scale_id IN ($in)
              ORDER BY scale_id, min_percent DESC",
            $scaleIds
        )->fetchAll('assoc');
        $out = [];
        foreach ($rows as $r) {
            $out[(int)$r['scale_id']][] = [
                'min_percent' => (float)$r['min_percent'],
                'label'       => (string)$r['label'],
                'gpa_points'  => $r['gpa_points'] === null ? null : (float)$r['gpa_points'],
                'descriptor'  => $r['descriptor'],
                'is_pass'     => (int)$r['is_pass'] === 1,
            ];
        }

        return $out;
    }

    private static function castScale(array $r): array
    {
        return [
            'id'         => (int)$r['id'],
            'name'       => (string)$r['name'],
            'scale_type' => (string)$r['scale_type'],
            'is_default' => (int)$r['is_default'] === 1,
            'show_gpa'   => (int)$r['show_gpa'] === 1,
        ];
    }

    /** For tests. */
    public static function resetCache(): void
    {
        self::$defaultCache = [];
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
