-- Migration: Fix ssms_test_attempts table
--
-- Run ALL statements below in one go on your database.
--
-- Changes:
--   1. enrollment_id  INT → VARCHAR(50)  (system uses string IDs like "ETWF-2026-0001")
--   2. Add rank       INT column (for leaderboard ranking)
--   3. Add percentile DECIMAL(5,2) column (for percentile scoring)

-- Step 1 (optional): Delete corrupt rows where enrollment_id was truncated to 0
-- DELETE FROM ssms_test_attempts WHERE enrollment_id = '0' OR enrollment_id = 0;

-- Step 2: Fix enrollment_id column type
ALTER TABLE ssms_test_attempts
  MODIFY COLUMN enrollment_id VARCHAR(50) NOT NULL;

-- Step 3: Add rank column (ignore error if it already exists)
ALTER TABLE ssms_test_attempts
  ADD COLUMN rank INT NOT NULL DEFAULT 0;

-- Step 4: Add percentile column (ignore error if it already exists)
ALTER TABLE ssms_test_attempts
  ADD COLUMN percentile DECIMAL(5,2) NOT NULL DEFAULT 0;
