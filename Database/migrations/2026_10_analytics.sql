-- ============================================================================
-- Analytics dashboard: per-school thresholds (at-risk rules) and monthly fee
-- collection targets. Everything else is calculated from existing tables
-- (student_attendance, ssms_fee_structure, ssms_fee_paid_details, ssms_marks …).
-- Safe to run more than once.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ssms_analytics_settings (
  ssms_client_code VARCHAR(50)  NOT NULL PRIMARY KEY,
  settings_json    TEXT         NULL,     -- thresholds (see App\Service\Analytics::DEFAULTS)
  targets_json     TEXT         NULL,     -- {"<session_id>": {"2026-04": 150000, …}}
  updated_by       VARCHAR(100) NULL,
  modified         DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Speeds up the attendance and marks summaries (skipped if they already exist).
-- MariaDB / MySQL 8 accept IF NOT EXISTS on CREATE INDEX; on older MySQL, remove "IF NOT EXISTS".
CREATE INDEX IF NOT EXISTS idx_att_client_date ON student_attendance (ssms_client_code, attendance_date);
CREATE INDEX IF NOT EXISTS idx_att_enrollment  ON student_attendance (enrollment_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_marks_exam      ON ssms_marks (ssms_client_code, exam_id, class_id);
CREATE INDEX IF NOT EXISTS idx_feepaid_client  ON ssms_fee_paid_details (ssms_client_code, session_id);
CREATE INDEX IF NOT EXISTS idx_feepaid_enr_fee ON ssms_fee_paid_details (enrollment_id, fee_id);
CREATE INDEX IF NOT EXISTS idx_feestr_class    ON ssms_fee_structure (ssms_client_code, session_id, class_id, fee_item_id);
