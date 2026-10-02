-- ============================================================
-- Migration: fix ssms_timetable unique key to include branch_id
--
-- Run this in phpMyAdmin or MySQL CLI BEFORE using branch-specific
-- timetables, otherwise inserting a branch-specific slot for an
-- existing class/section/session/day/period will cause a duplicate
-- key error.
--
-- STEP 1: Find the current unique key name on your installation.
-- ============================================================
SHOW INDEXES FROM ssms_timetable WHERE Non_unique = 0;

-- ============================================================
-- STEP 2: Drop the old unique key (adjust name to match STEP 1 output).
-- Common names: unique_slot, timetable_unique, uk_slot, etc.
-- If the index name shown is something else, replace it below.
-- ============================================================

-- Option A — if your unique key is named 'unique_slot':
-- ALTER TABLE ssms_timetable DROP INDEX unique_slot;

-- Option B — drop ALL non-primary unique keys safely (generic):
-- SET @sql = (
--     SELECT CONCAT('ALTER TABLE ssms_timetable DROP INDEX `', INDEX_NAME, '`')
--     FROM   information_schema.STATISTICS
--     WHERE  TABLE_SCHEMA = DATABASE()
--       AND  TABLE_NAME   = 'ssms_timetable'
--       AND  NON_UNIQUE   = 0
--       AND  INDEX_NAME  != 'PRIMARY'
--     LIMIT 1
-- );
-- PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- STEP 3: Add the new unique key that includes branch_id.
-- In MySQL, two rows where branch_id IS NULL are NOT considered
-- duplicates in a unique index, so old null-branch rows coexist
-- safely alongside new branch-specific rows.
-- ============================================================
ALTER TABLE ssms_timetable
    ADD UNIQUE KEY unique_slot_branch
        (ssms_client_code, class_id, section_id, session_id, day_of_week, period_id, branch_id);

-- ============================================================
-- STEP 4 (optional): Add an index on branch_id for query speed.
-- Skip if it already exists.
-- ============================================================
-- ALTER TABLE ssms_timetable ADD INDEX idx_branch_id (branch_id);
