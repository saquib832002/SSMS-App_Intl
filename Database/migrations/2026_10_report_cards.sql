-- ============================================================================
-- Configurable grading scales + report cards
--   ssms_grading_scales / ssms_grading_bands   school-defined grading scales
--   ssms_report_card_plans / _terms            which exams make up a report card
--                                              and how much each one counts
--   ssms_report_card_comments                  teacher comments (overall + per subject)
--   ssms_report_card_sends                     log of report cards emailed to parents
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssms_grading_scales (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  name             VARCHAR(80)  NOT NULL,
  scale_type       VARCHAR(20)  NOT NULL DEFAULT 'letter',  -- letter | gpa | ib | cambridge | standards | cbse | custom
  is_default       TINYINT(1)   NOT NULL DEFAULT 0,
  show_gpa         TINYINT(1)   NOT NULL DEFAULT 0,
  created          DATETIME     NULL,
  modified         DATETIME     NULL,
  KEY idx_gs_client (ssms_client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_grading_bands (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  scale_id    INT           NOT NULL,
  min_percent DECIMAL(5,2)  NOT NULL,           -- band applies from this % upwards
  label       VARCHAR(20)   NOT NULL,           -- A+, 7, A*, 4, A1 …
  gpa_points  DECIMAL(4,2)  NULL,               -- 4.00, 10 … (optional)
  descriptor  VARCHAR(100)  NULL,               -- Excellent, Meets standard …
  is_pass     TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order  INT           NOT NULL DEFAULT 0,
  KEY idx_gb_scale (scale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_report_card_plans (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code  VARCHAR(20)  NOT NULL,
  name              VARCHAR(120) NOT NULL,       -- "Annual Report Card 2026-27"
  session_id        INT          NULL,
  class_id          INT          NULL,           -- NULL = all classes
  scale_id          INT          NULL,           -- NULL = the school's default scale
  template          VARCHAR(20)  NOT NULL DEFAULT 'classic',  -- classic | modern | compact
  show_rank         TINYINT(1)   NOT NULL DEFAULT 0,
  show_attendance   TINYINT(1)   NOT NULL DEFAULT 1,
  show_gpa          TINYINT(1)   NOT NULL DEFAULT 0,
  show_term_columns TINYINT(1)   NOT NULL DEFAULT 1,
  principal_name    VARCHAR(100) NULL,
  footer_note       VARCHAR(255) NULL,
  is_published      TINYINT(1)   NOT NULL DEFAULT 0,  -- students / parents can see it in the app
  created           DATETIME     NULL,
  modified          DATETIME     NULL,
  KEY idx_rcp_client (ssms_client_code, session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_report_card_terms (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  plan_id    INT           NOT NULL,
  label      VARCHAR(60)   NOT NULL,            -- "Term 1", "Mid-year", "Final"
  exam_id    INT           NOT NULL,
  weight     DECIMAL(5,2)  NOT NULL DEFAULT 0,  -- % of the final result (all terms add up to 100)
  sort_order INT           NOT NULL DEFAULT 0,
  KEY idx_rct_plan (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_report_card_comments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  plan_id          INT          NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,          -- e.g. ETWF-2026-0001
  subject_id       INT          NOT NULL DEFAULT 0,   -- 0 = overall / class-teacher comment
  comment          TEXT         NOT NULL,
  ssms_client_code VARCHAR(20)  NOT NULL,
  updated_by       VARCHAR(100) NULL,
  modified         DATETIME     NULL,
  UNIQUE KEY uq_rcc (plan_id, enrollment_id, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_report_card_sends (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  plan_id          INT          NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,
  ssms_client_code VARCHAR(20)  NOT NULL,
  email            VARCHAR(190) NOT NULL,
  status           VARCHAR(20)  NOT NULL,          -- sent | failed
  error            VARCHAR(255) NULL,
  sent_by          VARCHAR(100) NULL,
  created          DATETIME     NULL,
  KEY idx_rcs_plan (plan_id, enrollment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Enrollment IDs are text (e.g. ETWF-2026-0001). Fix tables created by an earlier copy of this file.
ALTER TABLE ssms_report_card_comments MODIFY enrollment_id VARCHAR(50) NOT NULL;
ALTER TABLE ssms_report_card_sends    MODIFY enrollment_id VARCHAR(50) NOT NULL;
