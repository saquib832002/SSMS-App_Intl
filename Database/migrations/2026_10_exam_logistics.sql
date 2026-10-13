-- ============================================================================
-- Exam logistics: exam halls, seating plans, invigilation duties, admit cards / hall tickets.
-- Builds on the existing date sheet (ssms_exam_datesheet), exams, enrollments and staff.
-- Hostel rooms (ssms_rooms / ssms_room_seats) are NOT reused – those are beds, not exam desks.
-- Safe to run more than once (MariaDB / MySQL 8).
-- ============================================================================

-- Rooms used for exams, laid out as rows × desks. blocked = seats that can't be used ("A3,B5").
CREATE TABLE IF NOT EXISTS ssms_exam_halls (
  hall_id          INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  branch_id        INT          NOT NULL DEFAULT 0,      -- 0 = any branch
  name             VARCHAR(80)  NOT NULL,
  location         VARCHAR(120) NULL,
  seat_rows        SMALLINT     NOT NULL,
  seat_cols        SMALLINT     NOT NULL,
  blocked          VARCHAR(1000) NULL,
  active           TINYINT(1)   NOT NULL DEFAULT 1,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  UNIQUE KEY uq_hall_name (ssms_client_code, name),
  KEY idx_hall_client (ssms_client_code, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One seating plan per sitting (exam + date + start time), built from the date sheet.
CREATE TABLE IF NOT EXISTS ssms_exam_seat_plans (
  plan_id          INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  exam_id          INT          NOT NULL,
  session_id       INT          NOT NULL,
  branch_id        INT          NOT NULL DEFAULT 0,
  exam_date        DATE         NOT NULL,
  start_time       VARCHAR(5)   NOT NULL,
  end_time         VARCHAR(5)   NULL,
  mode             VARCHAR(10)  NOT NULL DEFAULT 'mixed',   -- mixed | class
  spacing          VARCHAR(10)  NOT NULL DEFAULT 'all',     -- all | alternate | checker
  classes_json     TEXT         NOT NULL,                   -- [{class_id, section_id|null}]
  halls_json       TEXT         NOT NULL,                   -- [hall_id, …] in fill order
  students         INT          NOT NULL DEFAULT 0,
  status           VARCHAR(10)  NOT NULL DEFAULT 'draft',   -- draft | published
  created_by       VARCHAR(100) NULL,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  UNIQUE KEY uq_sitting (ssms_client_code, exam_id, session_id, branch_id, exam_date, start_time),
  KEY idx_plan_exam (ssms_client_code, exam_id, session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_exam_seats (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  plan_id          INT          NOT NULL,
  ssms_client_code VARCHAR(50)  NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,
  class_id         INT          NOT NULL,
  section_id       INT          NULL,
  hall_id          INT          NOT NULL,
  seat_row         SMALLINT     NOT NULL,
  seat_col         SMALLINT     NOT NULL,
  seat_no          INT          NOT NULL,
  UNIQUE KEY uq_seat_student (plan_id, enrollment_id),
  UNIQUE KEY uq_seat_place (plan_id, hall_id, seat_row, seat_col),
  KEY idx_seat_enrollment (ssms_client_code, enrollment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_exam_duties (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  plan_id          INT          NOT NULL,
  hall_id          INT          NOT NULL,
  staff_id         INT          NOT NULL,
  duty_role        VARCHAR(20)  NOT NULL DEFAULT 'invigilator',   -- chief | invigilator | reliever
  created_by       VARCHAR(100) NULL,
  created          DATETIME     NOT NULL,
  UNIQUE KEY uq_duty (plan_id, hall_id, staff_id),
  KEY idx_duty_staff (ssms_client_code, staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admit card rules per exam + session, and the cards issued.
CREATE TABLE IF NOT EXISTS ssms_exam_admit_settings (
  ssms_client_code VARCHAR(50)  NOT NULL,
  exam_id          INT          NOT NULL,
  session_id       INT          NOT NULL,
  instructions     TEXT         NULL,
  rule_fees        TINYINT(1)   NOT NULL DEFAULT 0,   -- withhold when fees are overdue
  fee_tolerance    DECIMAL(12,2) NOT NULL DEFAULT 0,  -- ignore dues up to this amount
  rule_attendance  TINYINT      NULL,                 -- withhold below this attendance %
  show_photo       TINYINT(1)   NOT NULL DEFAULT 1,
  published        TINYINT(1)   NOT NULL DEFAULT 0,
  published_at     DATETIME     NULL,
  published_by     VARCHAR(100) NULL,
  modified         DATETIME     NOT NULL,
  PRIMARY KEY (ssms_client_code, exam_id, session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_exam_admit_cards (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  exam_id          INT          NOT NULL,
  session_id       INT          NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,
  ticket_no        VARCHAR(30)  NULL,
  override         VARCHAR(10)  NULL,                 -- allow | withhold (decided by the office)
  reason           VARCHAR(200) NULL,
  issued_at        DATETIME     NULL,
  viewed_at        DATETIME     NULL,
  modified         DATETIME     NOT NULL,
  UNIQUE KEY uq_admit (ssms_client_code, exam_id, session_id, enrollment_id),
  UNIQUE KEY uq_ticket (ssms_client_code, ticket_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
