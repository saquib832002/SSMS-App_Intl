-- ============================================================
-- Migration: rename `rank` → rank_in_batch
--
-- The original ssms_test_attempts schema used the column name
-- `rank`, which is a reserved word in MySQL 8 and causes SQL
-- errors when unquoted.  The application code now references
-- rank_in_batch everywhere.
--
-- Run ONCE on your database.
-- Safe to skip if rank_in_batch already exists.
-- ============================================================

-- Step 1: Rename the column (backticks needed because `rank` is reserved)
ALTER TABLE ssms_test_attempts
  CHANGE COLUMN `rank` rank_in_batch INT NOT NULL DEFAULT 0;

-- Step 2 (optional safety check): verify the column is now present
-- SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME = 'ssms_test_attempts' AND COLUMN_NAME = 'rank_in_batch';
