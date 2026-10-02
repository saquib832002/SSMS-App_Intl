<?php
/**
 * Controllers/TimeTableServiceApiController.php
 *
 * Periods + Timetable API
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes to add in config/routes.php:
 *
 *   // Periods
 *   $builder->get('/TimeTableServiceApi/getPeriods',         ['controller'=>'TimeTableServiceApi','action'=>'getPeriods']);
 *   $builder->post('/TimeTableServiceApi/createPeriod',      ['controller'=>'TimeTableServiceApi','action'=>'createPeriod']);
 *   $builder->post('/TimeTableServiceApi/updatePeriod/:id',  ['controller'=>'TimeTableServiceApi','action'=>'updatePeriod'])->setPass(['id']);
 *   $builder->delete('/TimeTableServiceApi/deletePeriod/:id',['controller'=>'TimeTableServiceApi','action'=>'deletePeriod'])->setPass(['id']);
 *
 *   // Timetable
 *   $builder->get('/TimeTableServiceApi/getTimetable',           ['controller'=>'TimeTableServiceApi','action'=>'getTimetable']);
 *   $builder->post('/TimeTableServiceApi/saveTimetableSlot',     ['controller'=>'TimeTableServiceApi','action'=>'saveTimetableSlot']);
 *   $builder->delete('/TimeTableServiceApi/deleteTimetableSlot/:id',['controller'=>'TimeTableServiceApi','action'=>'deleteTimetableSlot'])->setPass(['id']);
 *   $builder->get('/TimeTableServiceApi/getTeacherTimetable',    ['controller'=>'TimeTableServiceApi','action'=>'getTeacherTimetable']);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

class TimeTableServiceApiController extends AppController
{
    public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
    }

    public function beforeFilter(\Cake\Event\EventInterface $event): void
    {
        parent::beforeFilter($event);
        $this->autoRender = false;
        $this->response = $this->response->withType('application/json');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function getClientCode(): string
    {
        return $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? '';
    }

    private function db(): \Cake\Database\Connection
    {
        return \Cake\Datasource\ConnectionManager::get('default');
    }

    private function isAdminOrOwner(): bool
    {
        $role = strtolower(trim(
            $this->request->getHeaderLine('ssmsUserRole') ?? ''
        ));
        return in_array($role, ['admin', 'owner'], true);
    }

    private function jsonOk(array $data = []): void
    {
        $this->response = $this->response
            ->withStringBody(json_encode(array_merge(['status' => true], $data)));
    }

    private function jsonError(int $code, string $msg): void
    {
        $this->response = $this->response
            ->withStatus($code)
            ->withStringBody(json_encode(['status' => false, 'message' => $msg]));
    }

    // =========================================================================
    // PERIODS
    // =========================================================================

    // GET /TimeTableServiceApi/getPeriods
    public function getPeriods(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $rows = $this->db()->execute(
            "SELECT period_id, period_number, period_name, start_time, end_time, is_break,
                    created_at, updated_at
             FROM   ssms_periods
             WHERE  ssms_client_code = ?
             ORDER  BY period_number ASC",
            [$clientCode]
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows]);
    }

    // POST /TimeTableServiceApi/createPeriod
    public function createPeriod(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        $body       = $this->request->getData();

        $periodNumber = isset($body['period_number']) ? (int)$body['period_number'] : null;
        $periodName   = trim((string)($body['period_name'] ?? ''));
        $startTime    = trim((string)($body['start_time']  ?? ''));
        $endTime      = trim((string)($body['end_time']    ?? ''));
        $isBreak      = isset($body['is_break']) ? (int)(bool)$body['is_break'] : 0;

        if (!$periodNumber)       { $this->jsonError(422, 'period_number is required.'); return; }
        if (empty($periodName))   { $this->jsonError(422, 'period_name is required.');   return; }
        if (empty($startTime))    { $this->jsonError(422, 'start_time is required.');    return; }
        if (empty($endTime))      { $this->jsonError(422, 'end_time is required.');      return; }

        // Duplicate period_number check
        $dup = $this->db()->execute(
            "SELECT period_id FROM ssms_periods
             WHERE  period_number = ? AND ssms_client_code = ?",
            [$periodNumber, $clientCode]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, "Period number {$periodNumber} already exists."); return; }

        $this->db()->execute(
            "INSERT INTO ssms_periods
                (ssms_client_code, period_number, period_name, start_time, end_time, is_break, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [$clientCode, $periodNumber, $periodName, $startTime, $endTime, $isBreak]
        );
        $newId = $this->db()->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;

        Log::info("createPeriod [{$clientCode}] id={$newId} name={$periodName}");
        $this->jsonOk(['message' => 'Period created successfully.', 'period_id' => $newId]);
    }

    // POST /TimeTableServiceApi/updatePeriod/:id
    public function updatePeriod(?int $id = null): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $body         = $this->request->getData();
        $periodNumber = isset($body['period_number']) ? (int)$body['period_number'] : null;
        $periodName   = trim((string)($body['period_name'] ?? ''));
        $startTime    = trim((string)($body['start_time']  ?? ''));
        $endTime      = trim((string)($body['end_time']    ?? ''));
        $isBreak      = isset($body['is_break']) ? (int)(bool)$body['is_break'] : 0;

        if (!$periodNumber)       { $this->jsonError(422, 'period_number is required.'); return; }
        if (empty($periodName))   { $this->jsonError(422, 'period_name is required.');   return; }
        if (empty($startTime))    { $this->jsonError(422, 'start_time is required.');    return; }
        if (empty($endTime))      { $this->jsonError(422, 'end_time is required.');      return; }

        $existing = $this->db()->execute(
            "SELECT period_id FROM ssms_periods WHERE period_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Period not found.'); return; }

        // Duplicate number check (excluding self)
        $dup = $this->db()->execute(
            "SELECT period_id FROM ssms_periods
             WHERE  period_number = ? AND ssms_client_code = ? AND period_id != ?",
            [$periodNumber, $clientCode, $id]
        )->fetchAssoc();
        if ($dup) { $this->jsonError(409, "Period number {$periodNumber} already exists."); return; }

        $this->db()->execute(
            "UPDATE ssms_periods
             SET    period_number = ?, period_name = ?, start_time = ?, end_time = ?,
                    is_break = ?, updated_at = NOW()
             WHERE  period_id = ? AND ssms_client_code = ?",
            [$periodNumber, $periodName, $startTime, $endTime, $isBreak, $id, $clientCode]
        );

        Log::info("updatePeriod [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Period updated successfully.', 'period_id' => $id]);
    }

    // DELETE /TimeTableServiceApi/deletePeriod/:id
    public function deletePeriod(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $existing = $this->db()->execute(
            "SELECT period_id FROM ssms_periods WHERE period_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Period not found.'); return; }

        // Block deletion if used in timetable
        $inUse = $this->db()->execute(
            "SELECT timetable_id FROM ssms_timetable WHERE period_id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();
        if ($inUse) {
            $this->jsonError(409, 'Cannot delete — this period is used in the timetable.');
            return;
        }

        $this->db()->execute(
            "DELETE FROM ssms_periods WHERE period_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deletePeriod [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Period deleted successfully.']);
    }

    // =========================================================================
    // TIMETABLE
    // =========================================================================

    /**
     * GET /TimeTableServiceApi/getTimetable
     * Query params: classId, sectionId (optional), sessionId (optional)
     *
     * Returns a flat list of timetable rows joined with period, subject and staff names.
     * The app groups them into a day × period grid.
     */
    public function getTimetable(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $classId   = $this->request->getQuery('classId');
        $sectionId = $this->request->getQuery('sectionId');
        $sessionId = $this->request->getQuery('sessionId');
        $branchId  = $this->request->getQuery('branchId');

        if (!$classId) { $this->jsonError(422, 'classId is required.'); return; }

        $params = [$clientCode, $classId];
        $where  = "t.ssms_client_code = ? AND t.class_id = ?";

        if ($sectionId) { $where .= " AND t.section_id = ?"; $params[] = $sectionId; }
        if ($sessionId) { $where .= " AND t.session_id = ?"; $params[] = $sessionId; }

        // When a branch is selected: show branch-specific rows AND null-branch rows (legacy/global).
        // ORDER BY puts null-branch rows first so branch-specific rows are processed last and
        // overwrite them in the frontend gridMap — branch-specific always wins.
        if ($branchId) {
            $where .= " AND (t.branch_id = ? OR t.branch_id IS NULL)";
            $params[] = $branchId;
        }

        $rows = $this->db()->execute(
            "SELECT
                t.timetable_id,
                t.day_of_week,
                t.period_id,
                t.class_subject_id,
                t.staff_id,
                t.room,
                t.session_id,
                t.class_id,
                t.section_id,
                t.branch_id,
                p.period_number,
                p.period_name,
                p.start_time,
                p.end_time,
                p.is_break,
                s.subject_name,
                cs.subject_code,
                CONCAT(COALESCE(st.first_name,''), ' ', COALESCE(st.last_name,'')) AS teacher_name,
                c.class_name,
                sec.section_name
             FROM   ssms_timetable t
             JOIN   ssms_periods p          ON p.period_id         = t.period_id
             LEFT JOIN ssms_class_subjects cs ON cs.id             = t.class_subject_id
             LEFT JOIN ssms_subjects s        ON s.subject_id      = cs.subject_id
             LEFT JOIN ssms_staff st           ON st.staff_id      = t.staff_id
             LEFT JOIN ssms_classes c          ON c.class_id       = t.class_id
             LEFT JOIN ssms_sections sec       ON sec.section_id   = t.section_id
             WHERE  {$where}
             ORDER  BY (t.branch_id IS NULL) DESC, t.day_of_week, p.period_number",
            $params
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows]);
    }

    /**
     * POST /TimeTableServiceApi/saveTimetableSlot
     * Upserts a single timetable cell.
     * Body: { session_id, class_id, section_id, day_of_week, period_id,
     *          class_subject_id, staff_id, room }
     */
    public function saveTimetableSlot(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        $body       = $this->request->getData();

        $classId        = isset($body['class_id'])        ? (int)$body['class_id']        : null;
        $sectionId      = isset($body['section_id'])      ? (int)$body['section_id']      : null;
        $sessionId      = isset($body['session_id'])      ? (int)$body['session_id']      : null;
        $branchId       = !empty($body['branch_id'])      ? (int)$body['branch_id']       : null;
        $dayOfWeek      = isset($body['day_of_week'])     ? (int)$body['day_of_week']     : null;
        $periodId       = isset($body['period_id'])       ? (int)$body['period_id']       : null;
        $classSubjectId = isset($body['class_subject_id'])? (int)$body['class_subject_id']: null;
        $staffId        = !empty($body['staff_id'])       ? (int)$body['staff_id']        : null;
        $room           = trim((string)($body['room']     ?? ''));

        if (!$clientCode)    { $this->jsonError(422, 'Client code missing.'); return; }
        if (!$classId)       { $this->jsonError(422, 'Please select a class.'); return; }
        if (!$sectionId)     { $this->jsonError(422, 'Please select a section.'); return; }
        if (!$sessionId)     { $this->jsonError(422, 'Please select a session.'); return; }
        if (!$dayOfWeek)     { $this->jsonError(422, 'day_of_week is required.'); return; }
        if (!$periodId)      { $this->jsonError(422, 'period_id is required.'); return; }
        if (!$classSubjectId){ $this->jsonError(422, 'class_subject_id is required.'); return; }

        $db = $this->db();

        $sectionClause     = $sectionId ? "AND section_id = {$sectionId}" : "AND section_id IS NULL";
        $sessionClause     = $sessionId ? "AND session_id = {$sessionId}" : "AND session_id IS NULL";
        $branchClause      = $branchId  ? "AND branch_id = {$branchId}"   : "AND (branch_id IS NULL OR branch_id = 0)";
        $branchNullClause  = "AND (branch_id IS NULL OR branch_id = 0)";

        // 1. Look for an exact-branch match
        $existing = $db->execute(
            "SELECT timetable_id FROM ssms_timetable
             WHERE  ssms_client_code = ? AND class_id = ? AND day_of_week = ? AND period_id = ?
                    {$sectionClause} {$sessionClause} {$branchClause}",
            [$clientCode, $classId, $dayOfWeek, $periodId]
        )->fetchAssoc();

        // 2. If saving with a branch but no branch-specific row found, fall back to the
        //    legacy null-branch row and claim it by updating its branch_id.
        if (!$existing && $branchId) {
            $existing = $db->execute(
                "SELECT timetable_id FROM ssms_timetable
                 WHERE  ssms_client_code = ? AND class_id = ? AND day_of_week = ? AND period_id = ?
                        {$sectionClause} {$sessionClause} {$branchNullClause}",
                [$clientCode, $classId, $dayOfWeek, $periodId]
            )->fetchAssoc();
        }

        if ($existing) {
            // Update (also writes branch_id, migrating legacy null rows in place)
            $db->execute(
                "UPDATE ssms_timetable
                 SET    class_subject_id = ?, staff_id = ?, room = ?, branch_id = ?, updated_at = NOW()
                 WHERE  timetable_id = ?",
                [$classSubjectId, $staffId, $room, $branchId, $existing['timetable_id']]
            );
            $slotId = $existing['timetable_id'];
            $msg    = 'Slot updated successfully.';
        } else {
            // Insert
            $db->execute(
                "INSERT INTO ssms_timetable
                    (ssms_client_code, session_id, class_id, section_id, branch_id, day_of_week,
                     period_id, class_subject_id, staff_id, room, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                [$clientCode, $sessionId, $classId, $sectionId, $branchId, $dayOfWeek,
                 $periodId, $classSubjectId, $staffId, $room]
            );
            $slotId = $db->execute("SELECT LAST_INSERT_ID() AS id")->fetchAssoc()['id'] ?? null;
            $msg    = 'Slot saved successfully.';
        }

        Log::info("saveTimetableSlot [{$clientCode}] id={$slotId} day={$dayOfWeek} period={$periodId}");
        $this->jsonOk(['message' => $msg, 'timetable_id' => $slotId]);
    }

    /**
     * POST /TimeTableServiceApi/copyDay
     * Copies all slots from one day to other days, replacing existing.
     * Body: { class_id, section_id, session_id, source_day, mode }
     *   mode: "all"      → days 1-6
     *         "weekdays" → days 1-5
     */
    public function copyDay(): void
    {
        $this->request->allowMethod(['post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        $body       = $this->request->getData();

        $classId   = isset($body['class_id'])   ? (int)$body['class_id']   : null;
        $sectionId = isset($body['section_id'])  ? (int)$body['section_id'] : null;
        $sessionId = isset($body['session_id'])  ? (int)$body['session_id'] : null;
        $branchId  = !empty($body['branch_id'])  ? (int)$body['branch_id']  : null;
        $sourceDay = isset($body['source_day'])  ? (int)$body['source_day'] : null;
        $mode      = trim((string)($body['mode'] ?? 'all'));

        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }
        if (!$classId)    { $this->jsonError(422, 'Please select a class.'); return; }
        if (!$sectionId)  { $this->jsonError(422, 'Please select a section.'); return; }
        if (!$sessionId)  { $this->jsonError(422, 'Please select a session.'); return; }
        if (!$sourceDay)  { $this->jsonError(422, 'source_day is required.'); return; }

        $targetDays = $mode === 'weekdays' ? [1,2,3,4,5] : [1,2,3,4,5,6];
        $targetDays = array_filter($targetDays, fn($d) => $d !== $sourceDay);

        $db = $this->db();

        // Fetch source day slots.
        // When a branch is selected, include null-branch rows as fallback so legacy data
        // is picked up and then written as branch-specific rows on the target days.
        $sectionClause   = $sectionId ? "AND section_id = {$sectionId}" : "AND (section_id IS NULL OR section_id = 0)";
        $sessionClause   = $sessionId ? "AND session_id = {$sessionId}" : "AND (session_id IS NULL OR session_id = 0)";
        $branchClause    = $branchId  ? "AND branch_id = {$branchId}"   : "AND (branch_id IS NULL OR branch_id = 0)";
        $branchFetchClause = $branchId
            ? "AND (branch_id = {$branchId} OR branch_id IS NULL)"
            : "AND (branch_id IS NULL OR branch_id = 0)";

        // ORDER BY (branch_id IS NULL) ASC puts branch-specific rows first (IS NULL=0),
        // null-branch rows last (IS NULL=1). First-seen wins in the dedup loop below.
        $sourceSlots = $db->execute(
            "SELECT period_id, class_subject_id, staff_id, room
             FROM   ssms_timetable
             WHERE  ssms_client_code = ? AND class_id = ? AND day_of_week = ?
                    {$sectionClause} {$sessionClause} {$branchFetchClause}
             ORDER  BY (branch_id IS NULL) ASC",
            [$clientCode, $classId, $sourceDay]
        )->fetchAll('assoc');

        // Deduplicate by period_id — branch-specific row wins over null-branch fallback
        $dedupedSlots = [];
        foreach ($sourceSlots as $slot) {
            $pid = $slot['period_id'];
            if (!isset($dedupedSlots[$pid])) {
                $dedupedSlots[$pid] = $slot;
            }
        }
        $sourceSlots = array_values($dedupedSlots);

        $copied = 0;
        foreach ($targetDays as $targetDay) {
            // Delete existing slots for this target day (both branch-specific and null-branch)
            $db->execute(
                "DELETE FROM ssms_timetable
                 WHERE  ssms_client_code = ? AND class_id = ? AND day_of_week = ?
                        {$sectionClause} {$sessionClause} {$branchFetchClause}",
                [$clientCode, $classId, $targetDay]
            );

            // Insert source slots into target day
            foreach ($sourceSlots as $slot) {
                $db->execute(
                    "INSERT INTO ssms_timetable
                        (ssms_client_code, session_id, class_id, section_id, branch_id, day_of_week,
                         period_id, class_subject_id, staff_id, room, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                    [
                        $clientCode, $sessionId, $classId, $sectionId, $branchId, $targetDay,
                        $slot['period_id'], $slot['class_subject_id'],
                        $slot['staff_id'] ?: null, $slot['room'],
                    ]
                );
                $copied++;
            }
        }

        $dayCount = count($targetDays);
        Log::info("copyDay [{$clientCode}] from={$sourceDay} mode={$mode} targets={$dayCount} slots={$copied}");
        $this->jsonOk(['message' => "Copied to {$dayCount} day(s) ({$copied} slots)."]);
    }

    // DELETE /TimeTableServiceApi/deleteTimetableSlot/:id
    public function deleteTimetableSlot(?int $id = null): void
    {
        $this->request->allowMethod(['delete', 'post']);
        if (!$this->isAdminOrOwner()) { $this->jsonError(403, 'Admin or owner required.'); return; }

        $clientCode = $this->getClientCode();
        if (!$clientCode || !$id) { $this->jsonError(422, 'Invalid request.'); return; }

        $existing = $this->db()->execute(
            "SELECT timetable_id FROM ssms_timetable WHERE timetable_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        )->fetchAssoc();
        if (!$existing) { $this->jsonError(404, 'Slot not found.'); return; }

        $this->db()->execute(
            "DELETE FROM ssms_timetable WHERE timetable_id = ? AND ssms_client_code = ?",
            [$id, $clientCode]
        );

        Log::info("deleteTimetableSlot [{$clientCode}] id={$id}");
        $this->jsonOk(['message' => 'Slot deleted successfully.']);
    }

    /**
     * GET /TimeTableServiceApi/getMasterTimetable
     * School-wide view: all class-sections (rows) × all periods (columns).
     *
     * Query params: sessionId (optional), branchId (optional), dayOfWeek (default: 1)
     * Response: { periods, columns, grid }
     *   periods: [{period_id, period_number, period_name, start_time, end_time, is_break}]
     *   columns: [{key, label, class_id, section_id}]
     *   grid:    { "period_id": { "col_key": { subject_name, subject_code, staff_name, room } } }
     */
    public function getMasterTimetable(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $sessionId = $this->request->getQuery('sessionId');
        $branchId  = $this->request->getQuery('branchId');
        $dayOfWeek = 1; // Master view always uses Monday as the canonical day

        // All periods for this school
        $periods = $this->db()->execute(
            "SELECT period_id, period_number, period_name, start_time, end_time, is_break
             FROM   ssms_periods
             WHERE  ssms_client_code = ?
             ORDER  BY period_number ASC",
            [$clientCode]
        )->fetchAll('assoc');

        // Timetable rows with joins
        $params = [$clientCode, $dayOfWeek];
        $where  = "t.ssms_client_code = ? AND t.day_of_week = ?";
        if ($sessionId) { $where .= " AND t.session_id = ?"; $params[] = $sessionId; }
        if ($branchId)  { $where .= " AND t.branch_id = ?";  $params[] = $branchId; }

        $rows = $this->db()->execute(
            "SELECT
                t.period_id,
                t.class_id,
                t.section_id,
                s.subject_name,
                cs.subject_code,
                TRIM(CONCAT(COALESCE(st.first_name,''), ' ', COALESCE(st.last_name,''))) AS staff_name,
                t.room,
                c.class_name,
                sec.section_name,
                CASE WHEN sec.section_name IS NOT NULL
                     THEN CONCAT(c.class_name, ' – ', sec.section_name)
                     ELSE c.class_name END AS col_label
             FROM   ssms_timetable t
             JOIN   ssms_classes c           ON c.class_id     = t.class_id
             LEFT JOIN ssms_sections sec     ON sec.section_id  = t.section_id
             LEFT JOIN ssms_class_subjects cs ON cs.id          = t.class_subject_id
             LEFT JOIN ssms_subjects s        ON s.subject_id   = cs.subject_id
             LEFT JOIN ssms_staff st          ON st.staff_id    = t.staff_id
             WHERE  {$where}
             ORDER  BY c.class_name, sec.section_name, t.period_id",
            $params
        )->fetchAll('assoc');

        // Build unique columns (class-sections in appearance order) and nested grid
        $columns = [];
        $grid    = [];
        $seen    = [];

        foreach ($rows as $row) {
            $key = $row['class_id'] . '_' . ($row['section_id'] ?? '0');
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $columns[]  = [
                    'key'        => $key,
                    'label'      => $row['col_label'],
                    'class_id'   => $row['class_id'],
                    'section_id' => $row['section_id'],
                ];
            }
            $pid = (string)$row['period_id'];
            if (!isset($grid[$pid])) $grid[$pid] = [];
            $grid[$pid][$key] = [
                'subject_name' => $row['subject_name'] ?? '',
                'subject_code' => $row['subject_code'] ?? '',
                'staff_name'   => trim($row['staff_name'] ?? ''),
                'room'         => $row['room'] ?? '',
            ];
        }

        $this->jsonOk([
            'periods' => $periods,
            'columns' => $columns,
            'grid'    => $grid,
        ]);
    }

    /**
     * GET /TimeTableServiceApi/getBusyMap
     * Returns a map of which teachers are already assigned at which day/period,
     * EXCLUDING the current class+section so we only flag cross-class conflicts.
     *
     * Query params: classId, sectionId (optional), sessionId (optional)
     * Response: { "staff_id": { "day_of_week": { "period_id": "Class – Section" } } }
     */
    public function getBusyMap(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $classId   = $this->request->getQuery('classId');
        $sectionId = $this->request->getQuery('sectionId');
        $sessionId = $this->request->getQuery('sessionId');

        $params        = [$clientCode];
        $excludeClause = '';
        $sessionClause = '';

        // Exclude the current class+section (own assignments are not conflicts)
        if ($classId && $sectionId) {
            $excludeClause = "AND NOT (t.class_id = ? AND t.section_id = ?)";
            $params[] = $classId;
            $params[] = $sectionId;
        } elseif ($classId) {
            $excludeClause = "AND t.class_id != ?";
            $params[] = $classId;
        }

        if ($sessionId) {
            $sessionClause = "AND t.session_id = ?";
            $params[] = $sessionId;
        }

        $rows = $this->db()->execute(
            "SELECT
                t.staff_id,
                t.day_of_week,
                t.period_id,
                CONCAT(
                    COALESCE(c.class_name, ''),
                    CASE WHEN sec.section_name IS NOT NULL
                         THEN CONCAT(' – ', sec.section_name) ELSE '' END
                ) AS label
             FROM   ssms_timetable t
             LEFT JOIN ssms_classes  c   ON c.class_id    = t.class_id
             LEFT JOIN ssms_sections sec ON sec.section_id = t.section_id
             WHERE  t.ssms_client_code = ?
             AND    t.staff_id IS NOT NULL
             {$excludeClause}
             {$sessionClause}",
            $params
        )->fetchAll('assoc');

        // Build nested map: staff_id → day → period_id → label
        $map = [];
        foreach ($rows as $row) {
            $sid = (string)$row['staff_id'];
            $day = (string)$row['day_of_week'];
            $pid = (string)$row['period_id'];
            if (!isset($map[$sid]))       $map[$sid] = [];
            if (!isset($map[$sid][$day])) $map[$sid][$day] = [];
            $map[$sid][$day][$pid] = $row['label'];
        }

        $this->jsonOk(['data' => $map]);
    }

    /**
     * GET /TimeTableServiceApi/getTeacherTimetable
     * Query params: staffId (required), sessionId (optional)
     *
     * Returns all slots assigned to the given teacher.
     */
    public function getTeacherTimetable(): void
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->getClientCode();
        if (!$clientCode) { $this->jsonError(422, 'Client code missing.'); return; }

        $staffId   = $this->request->getQuery('staffId');
        $sessionId = $this->request->getQuery('sessionId');

        if (!$staffId) { $this->jsonError(422, 'staffId is required.'); return; }

        $params = [$clientCode, $staffId];
        $where  = "t.ssms_client_code = ? AND t.staff_id = ?";
        if ($sessionId) { $where .= " AND t.session_id = ?"; $params[] = $sessionId; }

        $rows = $this->db()->execute(
            "SELECT
                t.timetable_id,
                t.day_of_week,
                t.period_id,
                t.class_subject_id,
                t.staff_id,
                t.room,
                p.period_number,
                p.period_name,
                p.start_time,
                p.end_time,
                s.subject_name,
                cs.subject_code,
                c.class_name,
                sec.section_name
             FROM   ssms_timetable t
             JOIN   ssms_periods p            ON p.period_id       = t.period_id
             LEFT JOIN ssms_class_subjects cs  ON cs.id            = t.class_subject_id
             LEFT JOIN ssms_subjects s          ON s.subject_id    = cs.subject_id
             LEFT JOIN ssms_classes c           ON c.class_id      = t.class_id
             LEFT JOIN ssms_sections sec        ON sec.section_id  = t.section_id
             WHERE  {$where}
             ORDER  BY t.day_of_week, p.period_number",
            $params
        )->fetchAll('assoc');

        $this->jsonOk(['data' => $rows]);
    }
}
