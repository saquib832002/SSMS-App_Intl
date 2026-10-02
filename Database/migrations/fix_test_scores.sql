-- ============================================================
-- Fix scoring data for all already-submitted test attempts.
--
-- The original submitAttempt bug stored 0 neg deduction, so:
--   ssms_test_responses.marks_awarded  →  always 0 for wrong answers
--   ssms_test_attempts.score           →  sum of correct marks only
--
-- This script corrects both tables using section-level
-- negative_per_question as the fallback neg-marks value
-- (same logic now used in the application code).
--
-- Run ONCE after deploying the application fix.
-- Safe to re-run: only rows that need changing are updated.
-- ============================================================

-- ── Step 1: Fix per-question marks_awarded ────────────────────
UPDATE ssms_test_responses tr
JOIN   ssms_test_questions  tq  ON tq.id  = tr.test_question_id
LEFT JOIN ssms_test_sections sec ON sec.id = tq.section_id
                                AND sec.client_code = tr.client_code
JOIN   ssms_test_attempts   ta  ON ta.id  = tr.attempt_id
                                AND ta.client_code = tr.client_code
SET    tr.marks_awarded = CASE
           WHEN tr.is_attempted = 0 THEN 0
           WHEN tr.is_correct   = 1 THEN tq.marks
           ELSE -1.0 * COALESCE(NULLIF(tq.negative_marks, 0),
                                sec.negative_per_question, 0)
       END
WHERE  ta.status = 'submitted';

-- ── Step 2: Fix attempt-level score (sum of corrected marks) ─
UPDATE ssms_test_attempts ta
SET    ta.score = (
    SELECT COALESCE(SUM(
        CASE
            WHEN tr.is_attempted = 0 THEN 0
            WHEN tr.is_correct   = 1 THEN tq.marks
            ELSE -1.0 * COALESCE(NULLIF(tq.negative_marks, 0),
                                 sec.negative_per_question, 0)
        END
    ), 0)
    FROM   ssms_test_responses  tr
    JOIN   ssms_test_questions  tq  ON tq.id  = tr.test_question_id
    LEFT JOIN ssms_test_sections sec ON sec.id = tq.section_id
                                    AND sec.client_code = tr.client_code
    WHERE  tr.attempt_id  = ta.id
      AND  tr.client_code = ta.client_code
)
WHERE  ta.status = 'submitted';
