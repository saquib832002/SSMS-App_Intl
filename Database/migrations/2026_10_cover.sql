-- ============================================================================
-- Teacher cover & substitution.
-- Builds on the existing timetable (ssms_timetable, ssms_periods, ssms_class_subjects), staff,
-- approved staff leave (ssms_leave_applications), staff attendance (A / L) and exam duties.
-- Who is away is worked out from those tables; only the decisions are stored here.
-- Safe to run more than once (MariaDB 10.3+ / MySQL 8).
-- ============================================================================

-- Per-school rules.
CREATE TABLE IF NOT EXISTS ssms_cover_settings (
  ssms_client_code VARCHAR(50)  NOT NULL PRIMARY KEY,
  max_per_day      TINYINT      NOT NULL DEFAULT 2,     -- cover periods one teacher should get in a day (0 = no limit)
  max_per_week     TINYINT      NOT NULL DEFAULT 6,     -- … in a week (0 = no limit)
  notify_teacher   TINYINT(1)   NOT NULL DEFAULT 1,     -- bell + push to the cover teacher
  allow_decline    TINYINT(1)   NOT NULL DEFAULT 1,     -- the cover teacher may say "I can't"
  alert_on         TINYINT(1)   NOT NULL DEFAULT 1,     -- morning message to the office when periods still need cover
  alert_time       VARCHAR(5)   NOT NULL DEFAULT '07:00',
  alerted_on       DATE         NULL,                   -- last morning message (sent once a day)
  modified         DATETIME     NULL,
  modified_by      VARCHAR(100) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per timetable period (on one date) whose teacher is away: who covers it, or "no cover".
CREATE TABLE IF NOT EXISTS ssms_cover_assignments (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code     VARCHAR(50)  NOT NULL,
  cover_date           DATE         NOT NULL,
  timetable_id         INT          NOT NULL,
  period_id            INT          NOT NULL,
  class_id             INT          NOT NULL,
  section_id           INT          NULL,
  branch_id            INT          NULL,
  class_subject_id     INT          NULL,
  absent_staff_id      INT          NOT NULL,
  cover_staff_id       INT          NULL,               -- NULL with kind 'free' = no cover (self-study, merged class …)
  hold_staff_id        INT          NULL,               -- = cover_staff_id while assigned / accepted (one cover per teacher per period)
  kind                 VARCHAR(10)  NOT NULL DEFAULT 'cover',   -- cover | free
  status               VARCHAR(12)  NOT NULL DEFAULT 'assigned', -- assigned | accepted | declined
  reason               VARCHAR(12)  NULL,               -- leave | absent | away | exam_duty
  leave_application_id INT          NULL,
  note                 VARCHAR(255) NULL,
  response_note        VARCHAR(255) NULL,
  assigned_by          VARCHAR(100) NULL,
  responded_at         DATETIME     NULL,
  created              DATETIME     NOT NULL,
  modified             DATETIME     NOT NULL,
  UNIQUE KEY uq_cover_slot (ssms_client_code, cover_date, timetable_id),
  UNIQUE KEY uq_cover_teacher (ssms_client_code, cover_date, period_id, hold_staff_id),
  KEY idx_cover_staff (ssms_client_code, cover_staff_id, cover_date),
  KEY idx_cover_leave (ssms_client_code, leave_application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- "Away" marked by the office when there is no leave application (training, school trip, meeting …).
-- from / to period numbers: NULL = the whole day.
CREATE TABLE IF NOT EXISTS ssms_cover_absences (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  staff_id         INT          NOT NULL,
  absent_date      DATE         NOT NULL,
  from_period      INT          NULL,
  to_period        INT          NULL,
  reason           VARCHAR(120) NULL,
  created_by       VARCHAR(100) NULL,
  created          DATETIME     NOT NULL,
  KEY idx_away_day (ssms_client_code, absent_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every "I can't" from a cover teacher (kept for the month report even after the period goes to someone else).
CREATE TABLE IF NOT EXISTS ssms_cover_declines (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  assignment_id    INT          NULL,
  cover_date       DATE         NOT NULL,
  timetable_id     INT          NOT NULL,
  staff_id         INT          NOT NULL,
  note             VARCHAR(255) NULL,
  created          DATETIME     NOT NULL,
  KEY idx_decline_month (ssms_client_code, cover_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
