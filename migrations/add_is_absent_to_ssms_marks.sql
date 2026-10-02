-- Migration: add per-component absent flags to ssms_marks
-- Replaces the earlier single is_absent column with three component-level flags.
-- Run once on the database. Safe to re-run (IF NOT EXISTS / IF EXISTS guards).

-- Drop the old single-flag column if it was already added
ALTER TABLE ssms_marks
  DROP COLUMN IF EXISTS is_absent;

-- Add per-component absent flags
ALTER TABLE ssms_marks
  ADD COLUMN IF NOT EXISTS theory_absent   TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = student absent for theory component of this subject',
  ADD COLUMN IF NOT EXISTS internal_absent TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = student absent for internal/viva component',
  ADD COLUMN IF NOT EXISTS practical_absent TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = student absent for practical/lab component';
