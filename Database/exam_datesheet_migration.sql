-- ============================================================
-- Exam Date Sheet Migration
-- Run once on your MySQL database
-- ============================================================

CREATE TABLE IF NOT EXISTS ssms_exam_datesheet (
  datesheet_id     INT          AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  branch_id        INT          NOT NULL DEFAULT 0,   -- 0 = all branches
  session_id       INT          NOT NULL DEFAULT 0,   -- 0 = all sessions
  exam_id          INT          NOT NULL,
  class_id         INT          NOT NULL,
  subject_id       INT          NOT NULL,
  exam_date        DATE         NOT NULL,
  start_time       VARCHAR(8)   DEFAULT NULL,   -- stored 24h "HH:MM", displayed as 12h AM/PM
  end_time         VARCHAR(8)   DEFAULT NULL,
  venue            VARCHAR(150) DEFAULT NULL,
  notes            TEXT         DEFAULT NULL,
  is_published     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at       DATETIME     DEFAULT NOW(),
  updated_at       DATETIME     DEFAULT NOW() ON UPDATE NOW(),

  -- One row per exam + class + subject + branch + session
  UNIQUE KEY uq_slot (ssms_client_code, exam_id, class_id, subject_id, branch_id, session_id),
  INDEX idx_exam_class   (ssms_client_code, exam_id, class_id),
  INDEX idx_branch_sess  (ssms_client_code, branch_id, session_id),
  INDEX idx_published    (ssms_client_code, class_id, is_published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Run this ALTER if the table already exists without branch/session columns
-- ============================================================
-- ALTER TABLE ssms_exam_datesheet
--   ADD COLUMN branch_id  INT NOT NULL DEFAULT 0 AFTER ssms_client_code,
--   ADD COLUMN session_id INT NOT NULL DEFAULT 0 AFTER branch_id,
--   DROP KEY uq_slot,
--   ADD UNIQUE KEY uq_slot (ssms_client_code, exam_id, class_id, subject_id, branch_id, session_id),
--   ADD INDEX idx_branch_sess (ssms_client_code, branch_id, session_id);
