-- ============================================================================
-- Staff attendance: daily check-in / check-out (app, office code), manual
-- marking by admin, approved staff leave → "L", monthly report → payroll days.
-- Safe to run more than once (MariaDB / XAMPP: ADD COLUMN IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssms_staff_attendance (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code     VARCHAR(20)  NOT NULL,
  staff_id             INT          NOT NULL,
  att_date             DATE         NOT NULL,
  status               VARCHAR(3)   NOT NULL,          -- P present | A absent | HD half day | L leave | H holiday
  check_in             TIME         NULL,
  check_out            TIME         NULL,
  method               VARCHAR(10)  NULL,              -- app | code | manual | leave
  late_minutes         INT          NOT NULL DEFAULT 0,
  note                 VARCHAR(255) NULL,
  leave_application_id INT          NULL,              -- ssms_leave_applications.id when status came from approved leave
  leave_half           TINYINT(1)   NOT NULL DEFAULT 0,
  prev_status          VARCHAR(3)   NULL,              -- what the day was before the leave (NULL = no row)
  marked_by            VARCHAR(100) NULL,
  created              DATETIME     NULL,
  modified             DATETIME     NULL,
  UNIQUE KEY uq_staff_day (ssms_client_code, staff_id, att_date),
  KEY idx_sta_day (ssms_client_code, att_date),
  KEY idx_sta_leave (leave_application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_staff_attendance_settings (
  ssms_client_code    VARCHAR(20)  NOT NULL PRIMARY KEY,
  late_grace_minutes  INT          NOT NULL DEFAULT 10,   -- late if checked in later than school start + grace
  half_day_after      TIME         NULL,                  -- check-in after this time = half day (empty = never)
  require_office_code TINYINT(1)   NOT NULL DEFAULT 0,    -- staff must type the code shown on the office screen
  office_secret       VARCHAR(64)  NULL,
  self_checkin        TINYINT(1)   NOT NULL DEFAULT 1,    -- staff can check themselves in from the app
  updated_by          VARCHAR(100) NULL,
  modified            DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Paid or unpaid leave type (unpaid leave reduces payable days for payroll)
ALTER TABLE ssms_leave_types
  ADD COLUMN IF NOT EXISTS is_paid TINYINT(1) NOT NULL DEFAULT 1;

-- Payroll: allow half days in "days present" (e.g. 24.5 from staff attendance). Skip this line if you do not use Finance › Payroll.
ALTER TABLE fin_payroll MODIFY days_present DECIMAL(5,1) NOT NULL DEFAULT 26;
