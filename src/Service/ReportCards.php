<?php
declare(strict_types=1);

namespace App\Service;

use Cake\Datasource\ConnectionManager;

/**
 * Report cards built from existing exams + marks.
 *
 * A "plan" says which exams make up a report card and how much each counts
 * (e.g. Term 1 = 30 %, Term 2 = 30 %, Final = 40 %), which grading scale and
 * template to use, and what to show (rank, attendance, GPA).
 *
 * compute() returns everything a template needs for one student:
 * per-subject marks per term, weighted %, grade, GPA points, teacher comments,
 * attendance, overall result and (optionally) class rank.
 */
class ReportCards
{
    public const TEMPLATES = ['classic', 'modern', 'compact'];

    // ── Plans ────────────────────────────────────────────────────────────────

    public static function plans(string $clientCode, ?int $sessionId = null): array
    {
        $sql    = 'SELECT p.*, s.name AS scale_name, ses.session_name, c.class_name
                     FROM ssms_report_card_plans p
                LEFT JOIN ssms_grading_scales s ON s.id = p.scale_id
                LEFT JOIN ssms_sessions ses     ON ses.session_id = p.session_id
                LEFT JOIN ssms_classes c        ON c.class_id = p.class_id
                    WHERE p.ssms_client_code = ?';
        $params = [$clientCode];
        if ($sessionId) {
            $sql     .= ' AND (p.session_id = ? OR p.session_id IS NULL)';
            $params[] = $sessionId;
        }
        $rows = self::db()->execute($sql . ' ORDER BY p.id DESC', $params)->fetchAll('assoc');
        $out  = [];
        foreach ($rows as $r) {
            $p          = self::castPlan($r);
            $p['terms'] = self::terms($p['id']);
            $out[]      = $p;
        }

        return $out;
    }

    public static function plan(string $clientCode, int $id): ?array
    {
        $r = self::db()->execute(
            'SELECT p.*, s.name AS scale_name, ses.session_name, c.class_name
               FROM ssms_report_card_plans p
          LEFT JOIN ssms_grading_scales s ON s.id = p.scale_id
          LEFT JOIN ssms_sessions ses     ON ses.session_id = p.session_id
          LEFT JOIN ssms_classes c        ON c.class_id = p.class_id
              WHERE p.id = ? AND p.ssms_client_code = ? LIMIT 1',
            [$id, $clientCode]
        )->fetch('assoc');
        if (!$r) {
            return null;
        }
        $p          = self::castPlan($r);
        $p['terms'] = self::terms($id);

        return $p;
    }

    /**
     * $data = { id?, name, session_id, class_id, scale_id, template, show_rank, show_attendance,
     *           show_gpa, show_term_columns, principal_name, footer_note,
     *           terms: [{label, exam_id, weight}] }
     */
    public static function savePlan(string $clientCode, array $data): array
    {
        $name = trim((string)($data['name'] ?? ''));
        if ($name === '') {
            throw new \InvalidArgumentException('Please give the report card a name, e.g. "Annual Report 2026-27".');
        }
        $terms = [];
        $sum   = 0.0;
        $seen  = [];
        foreach ((array)($data['terms'] ?? []) as $t) {
            $examId = (int)($t['exam_id'] ?? 0);
            if ($examId <= 0) {
                continue;
            }
            if (isset($seen[$examId])) {
                throw new \InvalidArgumentException('The same exam is added twice.');
            }
            $seen[$examId] = true;
            $w = round((float)($t['weight'] ?? 0), 2);
            if ($w <= 0) {
                throw new \InvalidArgumentException('Each exam needs a weight above 0%.');
            }
            $sum    += $w;
            $terms[] = ['label' => mb_substr(trim((string)($t['label'] ?? '')) ?: 'Term ' . (count($terms) + 1), 0, 60),
                        'exam_id' => $examId, 'weight' => $w];
        }
        if (!$terms) {
            throw new \InvalidArgumentException('Add at least one exam to the report card.');
        }
        if (abs($sum - 100) > 0.01) {
            throw new \InvalidArgumentException('The exam weights must add up to 100% (now ' . rtrim(rtrim(number_format($sum, 2), '0'), '.') . '%).');
        }
        $db = self::db();
        $in = implode(',', array_fill(0, count($terms), '?'));
        $ok = $db->execute(
            "SELECT COUNT(*) AS c FROM ssms_exams WHERE ssms_client_code = ? AND exam_id IN ($in)",
            array_merge([$clientCode], array_column($terms, 'exam_id'))
        )->fetch('assoc');
        if ((int)$ok['c'] !== count($terms)) {
            throw new \InvalidArgumentException('One of the exams was not found.');
        }
        $scaleId = (int)($data['scale_id'] ?? 0) ?: null;
        if ($scaleId && !Grading::scale($clientCode, $scaleId)) {
            throw new \InvalidArgumentException('Grading scale not found.');
        }
        $template = in_array($data['template'] ?? '', self::TEMPLATES, true) ? $data['template'] : 'classic';
        $flag     = static fn($k, $d = 0) => isset($data[$k]) ? (!empty($data[$k]) && $data[$k] !== 'false' ? 1 : 0) : $d;
        $now      = date('Y-m-d H:i:s');
        $vals     = [
            mb_substr($name, 0, 120),
            (int)($data['session_id'] ?? 0) ?: null,
            (int)($data['class_id'] ?? 0) ?: null,
            $scaleId,
            $template,
            $flag('show_rank'), $flag('show_attendance', 1), $flag('show_gpa'), $flag('show_term_columns', 1),
            mb_substr(trim((string)($data['principal_name'] ?? '')), 0, 100) ?: null,
            mb_substr(trim((string)($data['footer_note'] ?? '')), 0, 255) ?: null,
        ];
        $id = (int)($data['id'] ?? 0);

        $db->begin();
        try {
            if ($id > 0) {
                if (!self::plan($clientCode, $id)) {
                    throw new \DomainException('Report card not found.');
                }
                $db->execute(
                    'UPDATE ssms_report_card_plans SET name=?, session_id=?, class_id=?, scale_id=?, template=?,
                            show_rank=?, show_attendance=?, show_gpa=?, show_term_columns=?, principal_name=?,
                            footer_note=?, modified=? WHERE id=?',
                    array_merge($vals, [$now, $id])
                );
                $db->execute('DELETE FROM ssms_report_card_terms WHERE plan_id = ?', [$id]);
            } else {
                $db->execute(
                    'INSERT INTO ssms_report_card_plans (name, session_id, class_id, scale_id, template, show_rank,
                            show_attendance, show_gpa, show_term_columns, principal_name, footer_note,
                            ssms_client_code, is_published, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)',
                    array_merge($vals, [$clientCode, $now, $now])
                );
                $id = (int)$db->execute('SELECT LAST_INSERT_ID() AS id')->fetch('assoc')['id'];
            }
            foreach ($terms as $i => $t) {
                $db->execute(
                    'INSERT INTO ssms_report_card_terms (plan_id, label, exam_id, weight, sort_order) VALUES (?,?,?,?,?)',
                    [$id, $t['label'], $t['exam_id'], $t['weight'], $i]
                );
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollback();
            throw $e;
        }

        return self::plan($clientCode, $id);
    }

    public static function deletePlan(string $clientCode, int $id): void
    {
        if (!self::plan($clientCode, $id)) {
            throw new \DomainException('Report card not found.');
        }
        $db = self::db();
        $db->execute('DELETE FROM ssms_report_card_terms WHERE plan_id = ?', [$id]);
        $db->execute('DELETE FROM ssms_report_card_comments WHERE plan_id = ?', [$id]);
        $db->execute('DELETE FROM ssms_report_card_plans WHERE id = ?', [$id]);
    }

    public static function publish(string $clientCode, int $id, bool $published): array
    {
        if (!self::plan($clientCode, $id)) {
            throw new \DomainException('Report card not found.');
        }
        self::db()->execute(
            'UPDATE ssms_report_card_plans SET is_published = ?, modified = ? WHERE id = ?',
            [$published ? 1 : 0, date('Y-m-d H:i:s'), $id]
        );

        return self::plan($clientCode, $id);
    }

    // ── Students & comments ─────────────────────────────────────────────────

    /** Students of a class/section in the plan's session. */
    public static function students(string $clientCode, array $plan, int $classId, ?int $sectionId = null, ?int $branchId = null): array
    {
        $sql = "SELECT e.enrollment_id, e.roll_number, e.class_id, e.section_id, e.session_id, e.branch_id,
                       TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) AS student_name,
                       r.email_address, r.mobile_number
                  FROM ssms_student_enrollment e
                  JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                 WHERE e.ssms_client_code = ? AND e.class_id = ?";
        $p = [$clientCode, $classId];
        if ($sectionId) {
            $sql .= ' AND e.section_id = ?';
            $p[]  = $sectionId;
        }
        if ($branchId) {
            $sql .= ' AND e.branch_id = ?';
            $p[]  = $branchId;
        }
        if (!empty($plan['session_id'])) {
            $sql .= ' AND e.session_id = ?';
            $p[]  = $plan['session_id'];
        }
        $sql .= ' ORDER BY (e.roll_number + 0), e.roll_number, student_name';

        return self::db()->execute($sql, $p)->fetchAll('assoc');
    }

    /** Subjects that have marks in any of the plan's exams for this class. */
    public static function subjects(string $clientCode, array $plan, int $classId): array
    {
        $examIds = array_column($plan['terms'], 'exam_id');
        if (!$examIds) {
            return [];
        }
        $in = implode(',', array_fill(0, count($examIds), '?'));

        return self::db()->execute(
            "SELECT DISTINCT sub.subject_id, sub.subject_name
               FROM ssms_marks m JOIN ssms_subjects sub ON sub.subject_id = m.subject_id
              WHERE m.ssms_client_code = ? AND m.class_id = ? AND m.exam_id IN ($in)
              ORDER BY sub.subject_name",
            array_merge([$clientCode, $classId], $examIds)
        )->fetchAll('assoc');
    }

    /** [enrollment_id][subject_id] => comment */
    public static function comments(string $clientCode, int $planId, array $enrollmentIds): array
    {
        if (!$enrollmentIds) {
            return [];
        }
        $in   = implode(',', array_fill(0, count($enrollmentIds), '?'));
        $rows = self::db()->execute(
            "SELECT enrollment_id, subject_id, comment FROM ssms_report_card_comments
              WHERE plan_id = ? AND ssms_client_code = ? AND enrollment_id IN ($in)",
            array_merge([$planId, $clientCode], $enrollmentIds)
        )->fetchAll('assoc');
        $out = [];
        foreach ($rows as $r) {
            $out[(string)$r['enrollment_id']][(int)$r['subject_id']] = (string)$r['comment'];
        }

        return $out;
    }

    /** $comments = [{subject_id (0 = overall), comment}] – empty comment removes it. */
    public static function saveComments(string $clientCode, int $planId, string $enrollmentId, array $comments, string $by): int
    {
        if (!self::plan($clientCode, $planId)) {
            throw new \DomainException('Report card not found.');
        }
        if (!self::enrollment($clientCode, $enrollmentId)) {
            throw new \DomainException('Student not found.');
        }
        $db  = self::db();
        $now = date('Y-m-d H:i:s');
        $n   = 0;
        foreach ($comments as $c) {
            $sid  = max(0, (int)($c['subject_id'] ?? 0));
            $text = trim((string)($c['comment'] ?? ''));
            if ($text === '') {
                $db->execute(
                    'DELETE FROM ssms_report_card_comments WHERE plan_id = ? AND enrollment_id = ? AND subject_id = ?',
                    [$planId, $enrollmentId, $sid]
                );
                continue;
            }
            $db->execute(
                'INSERT INTO ssms_report_card_comments (plan_id, enrollment_id, subject_id, comment, ssms_client_code, updated_by, modified)
                 VALUES (?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE comment = VALUES(comment), updated_by = VALUES(updated_by), modified = VALUES(modified)',
                [$planId, $enrollmentId, $sid, mb_substr($text, 0, 2000), $clientCode, mb_substr($by, 0, 100), $now]
            );
            $n++;
        }

        return $n;
    }

    // ── The report card ─────────────────────────────────────────────────────

    public static function enrollment(string $clientCode, string $enrollmentId): ?array
    {
        $row = self::db()->execute(
            "SELECT e.enrollment_id, e.roll_number, e.class_id, e.section_id, e.session_id, e.branch_id,
                    r.registration_id, r.email_address, r.mobile_number,
                    TRIM(CONCAT(COALESCE(r.student_first_name,''),' ',COALESCE(r.student_last_name,''))) AS student_name,
                    c.class_name, sec.section_name, ses.session_name, b.branch_name
               FROM ssms_student_enrollment e
               JOIN ssms_student_registration r ON r.registration_id = e.registration_id
          LEFT JOIN ssms_classes  c   ON c.class_id     = e.class_id
          LEFT JOIN ssms_sections sec ON sec.section_id = e.section_id
          LEFT JOIN ssms_sessions ses ON ses.session_id = e.session_id
          LEFT JOIN ssms_branch   b   ON b.branch_id    = e.branch_id
              WHERE e.enrollment_id = ? AND e.ssms_client_code = ? LIMIT 1",
            [$enrollmentId, $clientCode]
        )->fetch('assoc');

        return $row ?: null;
    }

    /** Full report card for one student. */
    public static function compute(string $clientCode, int $planId, string $enrollmentId, bool $withRank = true): array
    {
        $plan = self::plan($clientCode, $planId);
        if (!$plan) {
            throw new \DomainException('Report card not found.');
        }
        $student = self::enrollment($clientCode, $enrollmentId);
        if (!$student) {
            throw new \DomainException('Student not found.');
        }
        $scale = Grading::resolve($clientCode, $plan['scale_id']);
        $bands = $scale['bands'];

        // Marks per term
        $subjects = [];   // subject_id => [name, terms => [termIdx => {obt,max,pct,absent}]]
        $termTot  = [];
        foreach ($plan['terms'] as $ti => $t) {
            $rows = self::marks($clientCode, $enrollmentId, (int)$t['exam_id']);
            $obt  = 0.0;
            $max  = 0.0;
            foreach ($rows as $m) {
                $sid  = (int)$m['subject_id'];
                $sMax = (float)$m['subject_max_marks'];
                $sObt = (float)$m['total_marks'];
                $abs  = !empty($m['theory_absent']) && !empty($m['internal_absent']) && !empty($m['practical_absent']);
                $subjects[$sid]['subject_id']   = $sid;
                $subjects[$sid]['subject_name'] = (string)$m['subject_name'];
                $subjects[$sid]['terms'][$ti]   = [
                    'obtained' => $sObt, 'max' => $sMax, 'absent' => $abs,
                    'percent'  => $sMax > 0 ? round($sObt / $sMax * 100, 2) : null,
                ];
                if ($sMax > 0) {
                    $obt += $sObt;
                    $max += $sMax;
                }
            }
            $termTot[$ti] = ['obtained' => $obt, 'max' => $max, 'percent' => $max > 0 ? round($obt / $max * 100, 2) : null];
        }

        $comments = self::comments($clientCode, $planId, [$enrollmentId])[(string)$enrollmentId] ?? [];
        $allPass  = true;
        $gpaSum   = 0.0;
        $gpaN     = 0;
        $outSubj  = [];
        uasort($subjects, static fn($a, $b) => strcasecmp($a['subject_name'], $b['subject_name']));
        foreach ($subjects as $sid => $s) {
            $wSum = 0.0;
            $acc  = 0.0;
            $cols = [];
            foreach ($plan['terms'] as $ti => $t) {
                $cell   = $s['terms'][$ti] ?? null;
                $cols[] = $cell;
                if ($cell && $cell['percent'] !== null) {
                    $acc  += $cell['percent'] * (float)$t['weight'];
                    $wSum += (float)$t['weight'];
                }
            }
            $pct  = $wSum > 0 ? round($acc / $wSum, 2) : null;
            $band = $pct === null ? null : Grading::band($pct, $bands);
            if ($band && !$band['is_pass']) {
                $allPass = false;
            }
            if ($band && $band['gpa_points'] !== null) {
                $gpaSum += (float)$band['gpa_points'];
                $gpaN++;
            }
            $outSubj[] = [
                'subject_id'   => $sid,
                'subject_name' => $s['subject_name'],
                'terms'        => $cols,
                'percent'      => $pct,
                'grade'        => $band['label'] ?? null,
                'gpa_points'   => $band['gpa_points'] ?? null,
                'descriptor'   => $band['descriptor'] ?? null,
                'is_pass'      => $band ? (bool)$band['is_pass'] : null,
                'comment'      => $comments[$sid] ?? '',
            ];
        }

        // Overall – weighted average of each term's total %
        $wSum = 0.0;
        $acc  = 0.0;
        foreach ($plan['terms'] as $ti => $t) {
            if ($termTot[$ti]['percent'] !== null) {
                $acc  += $termTot[$ti]['percent'] * (float)$t['weight'];
                $wSum += (float)$t['weight'];
            }
        }
        $overallPct  = $wSum > 0 ? round($acc / $wSum, 2) : null;
        $overallBand = $overallPct === null ? null : Grading::band($overallPct, $bands);
        $passed      = $overallBand !== null && $overallBand['is_pass'] && $allPass;

        $result = [
            'plan'       => $plan,
            'scale'      => ['id' => $scale['id'], 'name' => $scale['name'], 'scale_type' => $scale['scale_type'],
                             'show_gpa' => (bool)$scale['show_gpa'], 'bands' => $bands],
            'student'    => $student,
            'terms'      => array_map(static fn($t, $tot) => [
                                'label' => $t['label'], 'exam_id' => (int)$t['exam_id'], 'exam_name' => $t['exam_name'] ?? '',
                                'weight' => (float)$t['weight'],
                            ] + $tot, $plan['terms'], $termTot),
            'subjects'   => $outSubj,
            'overall'    => [
                'percent'    => $overallPct,
                'grade'      => $overallBand['label'] ?? null,
                'descriptor' => $overallBand['descriptor'] ?? null,
                'gpa'        => $gpaN > 0 ? round($gpaSum / $gpaN, 2) : null,
                'passed'     => $overallPct === null ? null : $passed,
                'result'     => $overallPct === null ? 'No marks yet' : ($passed ? 'Pass' : 'Needs improvement'),
            ],
            'comment'    => $comments[0] ?? '',
            'attendance' => !empty($plan['show_attendance']) ? self::attendance($clientCode, $student, $plan) : null,
            'rank'       => null,
            'class_size' => null,
        ];
        if ($withRank && !empty($plan['show_rank']) && $overallPct !== null) {
            $ranks = self::classRanks($clientCode, $plan, (int)$student['class_id'], (int)($student['section_id'] ?? 0) ?: null);
            $result['rank']       = $ranks['ranks'][(string)$enrollmentId] ?? null;
            $result['class_size'] = $ranks['size'];
        }

        return $result;
    }

    /**
     * For each exam of the plan: how many of these students have marks, and whether
     * max marks are set for the class. Shown on the Report Cards screen so staff can
     * see straight away why a report card has no marks.
     */
    public static function examCoverage(string $clientCode, array $plan, int $classId, array $enrollmentIds): array
    {
        $out = [];
        $db  = self::db();
        foreach ($plan['terms'] as $t) {
            $withMarks = 0;
            if ($enrollmentIds) {
                $in  = implode(',', array_fill(0, count($enrollmentIds), '?'));
                $row = $db->execute(
                    "SELECT COUNT(DISTINCT enrollment_id) AS n FROM ssms_marks
                      WHERE ssms_client_code = ? AND exam_id = ? AND enrollment_id IN ($in)",
                    array_merge([$clientCode, (int)$t['exam_id']], $enrollmentIds)
                )->fetch('assoc');
                $withMarks = (int)($row['n'] ?? 0);
            }
            $any = $db->execute(
                'SELECT COUNT(*) AS n, COUNT(DISTINCT class_id) AS classes FROM ssms_marks WHERE ssms_client_code = ? AND exam_id = ?',
                [$clientCode, (int)$t['exam_id']]
            )->fetch('assoc');
            $max = $db->execute(
                "SELECT COUNT(*) AS n FROM ssms_max_marks
                  WHERE ssms_client_code = ? AND class_id = ?
                    AND (exam_id = ? OR exam_id IS NULL OR exam_id = 0)
                    AND COALESCE(max_marks, COALESCE(theory_max_marks,0)+COALESCE(internal_max_marks,0)+COALESCE(practical_max_marks,0), 0) > 0",
                [$clientCode, $classId, (int)$t['exam_id']]
            )->fetch('assoc');
            $out[] = [
                'label'            => $t['label'],
                'exam_id'          => (int)$t['exam_id'],
                'exam_name'        => $t['exam_name'] ?? '',
                'weight'           => (float)$t['weight'],
                'students_with_marks' => $withMarks,
                'students'         => count($enrollmentIds),
                'marks_in_school'  => (int)($any['n'] ?? 0),
                'max_marks_set'    => (int)($max['n'] ?? 0) > 0,
            ];
        }

        return $out;
    }

    /** Weighted overall % for every student of a class/section → competition rank (1,2,2,4). */
    public static function classRanks(string $clientCode, array $plan, int $classId, ?int $sectionId): array
    {
        $students = self::students($clientCode, $plan, $classId, $sectionId);
        $pcts     = [];
        foreach ($students as $s) {
            $eid  = (string)$s['enrollment_id'];
            $wSum = 0.0;
            $acc  = 0.0;
            foreach ($plan['terms'] as $t) {
                $obt = 0.0;
                $max = 0.0;
                foreach (self::marks($clientCode, $eid, (int)$t['exam_id']) as $m) {
                    if ((float)$m['subject_max_marks'] > 0) {
                        $obt += (float)$m['total_marks'];
                        $max += (float)$m['subject_max_marks'];
                    }
                }
                if ($max > 0) {
                    $acc  += ($obt / $max * 100) * (float)$t['weight'];
                    $wSum += (float)$t['weight'];
                }
            }
            if ($wSum > 0) {
                $pcts[$eid] = round($acc / $wSum, 2);
            }
        }
        arsort($pcts);
        $ranks = [];
        $pos   = 0;
        $prev  = null;
        $rank  = 0;
        foreach ($pcts as $eid => $p) {
            $pos++;
            if ($prev === null || $p < $prev) {
                $rank = $pos;
            }
            $ranks[$eid] = $rank;
            $prev        = $p;
        }

        return ['ranks' => $ranks, 'size' => count($pcts), 'percents' => $pcts];
    }

    /** Same marks query as the marksheet (subject max from ssms_max_marks). */
    public static function marks(string $clientCode, string $enrollmentId, int $examId): array
    {
        return self::db()->execute(
            "SELECT m.subject_id, sub.subject_name,
                    m.theory_absent, m.internal_absent, m.practical_absent,
                    COALESCE(m.total_marks,
                        COALESCE(m.theory_marks,0) + COALESCE(m.internal_marks,0) + COALESCE(m.practical_marks,0), 0) AS total_marks,
                    COALESCE(mm.max_marks,
                        COALESCE(mm.theory_max_marks,0) + COALESCE(mm.internal_max_marks,0) + COALESCE(mm.practical_max_marks,0), 0) AS subject_max_marks
               FROM ssms_marks m
               JOIN ssms_subjects sub ON sub.subject_id = m.subject_id
          LEFT JOIN ssms_max_marks mm ON mm.id = (
                        SELECT id FROM ssms_max_marks
                         WHERE subject_id = m.subject_id AND class_id = m.class_id
                           AND ssms_client_code = m.ssms_client_code
                           AND (exam_id = m.exam_id OR exam_id IS NULL OR exam_id = 0)
                         ORDER BY (exam_id IS NULL OR exam_id = 0) ASC LIMIT 1)
              WHERE m.enrollment_id = ? AND m.exam_id = ? AND m.ssms_client_code = ?",
            [$enrollmentId, $examId, $clientCode]
        )->fetchAll('assoc');
    }

    /** Days present / days marked in the session (holidays not counted). */
    public static function attendance(string $clientCode, array $student, array $plan): ?array
    {
        try {
            $sessionId = $plan['session_id'] ?: ($student['session_id'] ?? null);
            // P = present, A = absent, L = leave (approved / excused – not counted against the student), H = holiday
            $sql = "SELECT COUNT(*) AS total,
                           SUM(CASE WHEN UPPER(attendance) IN ('P','PRESENT') THEN 1 ELSE 0 END) AS present,
                           SUM(CASE WHEN UPPER(attendance) IN ('L','LEAVE') THEN 1 ELSE 0 END) AS leave_days
                      FROM student_attendance
                     WHERE enrollment_id = ? AND ssms_client_code = ?
                       AND UPPER(COALESCE(attendance,'')) NOT IN ('H','HOLIDAY','')";
            $p = [$student['enrollment_id'], $clientCode];
            if ($sessionId) {
                $sql .= ' AND session_id = ?';
                $p[]  = $sessionId;
            }
            $r     = self::db()->execute($sql, $p)->fetch('assoc');
            $leave = (int)($r['leave_days'] ?? 0);
            $total = (int)($r['total'] ?? 0) - $leave;   // school days the student was expected in
            if ($total <= 0) {
                return $leave > 0 ? ['present' => 0, 'total' => 0, 'leave' => $leave, 'percent' => null] : null;
            }
            $present = (int)$r['present'];

            return ['present' => $present, 'total' => $total, 'leave' => $leave, 'percent' => round($present / $total * 100, 1)];
        } catch (\Throwable $e) {
            return null;
        }
    }

    // ── Published report cards (students / parents) ────────────────────────

    /** Published plans that apply to an enrollment (same session/class or "all"). */
    public static function publishedFor(string $clientCode, array $student): array
    {
        $out = [];
        foreach (self::plans($clientCode) as $p) {
            if (!$p['is_published']) {
                continue;
            }
            if ($p['session_id'] && (int)$p['session_id'] !== (int)$student['session_id']) {
                continue;
            }
            if ($p['class_id'] && (int)$p['class_id'] !== (int)$student['class_id']) {
                continue;
            }
            $out[] = ['id' => $p['id'], 'name' => $p['name'], 'session_name' => $p['session_name'], 'modified' => $p['modified']];
        }

        return $out;
    }

    public static function logSend(string $clientCode, int $planId, string $enrollmentId, string $email, string $status, ?string $error, string $by): void
    {
        try {
            self::db()->execute(
                'INSERT INTO ssms_report_card_sends (plan_id, enrollment_id, ssms_client_code, email, status, error, sent_by, created)
                 VALUES (?,?,?,?,?,?,?,?)',
                [$planId, $enrollmentId, $clientCode, mb_substr($email, 0, 190), $status,
                 $error ? mb_substr($error, 0, 255) : null, mb_substr($by, 0, 100), date('Y-m-d H:i:s')]
            );
        } catch (\Throwable $e) {
        }
    }

    /** enrollment_id => last send {status, email, created} */
    public static function lastSends(string $clientCode, int $planId): array
    {
        $rows = self::db()->execute(
            'SELECT s.enrollment_id, s.status, s.email, s.created FROM ssms_report_card_sends s
              WHERE s.plan_id = ? AND s.ssms_client_code = ?
              ORDER BY s.id ASC',
            [$planId, $clientCode]
        )->fetchAll('assoc');
        $out = [];
        foreach ($rows as $r) {
            $out[(string)$r['enrollment_id']] = $r;
        }

        return $out;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static function terms(int $planId): array
    {
        $rows = self::db()->execute(
            'SELECT t.label, t.exam_id, t.weight, e.exam_name
               FROM ssms_report_card_terms t LEFT JOIN ssms_exams e ON e.exam_id = t.exam_id
              WHERE t.plan_id = ? ORDER BY t.sort_order, t.id',
            [$planId]
        )->fetchAll('assoc');

        return array_map(static fn($r) => [
            'label' => (string)$r['label'], 'exam_id' => (int)$r['exam_id'],
            'weight' => (float)$r['weight'], 'exam_name' => (string)($r['exam_name'] ?? ''),
        ], $rows);
    }

    private static function castPlan(array $r): array
    {
        $b = static fn($k) => (int)($r[$k] ?? 0) === 1;

        return [
            'id'                => (int)$r['id'],
            'name'              => (string)$r['name'],
            'session_id'        => $r['session_id'] !== null ? (int)$r['session_id'] : null,
            'session_name'      => $r['session_name'] ?? null,
            'class_id'          => $r['class_id'] !== null ? (int)$r['class_id'] : null,
            'class_name'        => $r['class_name'] ?? null,
            'scale_id'          => $r['scale_id'] !== null ? (int)$r['scale_id'] : null,
            'scale_name'        => $r['scale_name'] ?? null,
            'template'          => (string)$r['template'],
            'show_rank'         => $b('show_rank'),
            'show_attendance'   => $b('show_attendance'),
            'show_gpa'          => $b('show_gpa'),
            'show_term_columns' => $b('show_term_columns'),
            'principal_name'    => $r['principal_name'],
            'footer_note'       => $r['footer_note'],
            'is_published'      => $b('is_published'),
            'modified'          => $r['modified'],
        ];
    }

    private static function db()
    {
        return ConnectionManager::get('default');
    }
}
