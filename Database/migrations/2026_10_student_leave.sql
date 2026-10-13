-- ============================================================================
-- Parent absence notes, student leave, late arrivals & early pickups
--   ssms_student_leave_requests  parent/student requests (absence, leave,
--                                late arrival, early pickup) → teacher approves
--   ssms_student_arrivals        what actually happened at the gate / office:
--                                late arrivals and early pickups recorded by staff
-- Enrollment IDs are text (e.g. ETWF-2026-0001). Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssms_student_leave_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,
  class_id         INT          NULL,
  section_id       INT          NULL,
  session_id       INT          NULL,
  request_type     VARCHAR(20)  NOT NULL,            -- absence | leave | late_arrival | early_pickup
  from_date        DATE         NOT NULL,
  to_date          DATE         NOT NULL,
  time_at          TIME         NULL,                -- expected arrival / pickup time
  reason_category  VARCHAR(30)  NULL,                -- Sick, Medical appointment, Family, Travel, Religious, Other
  reason           TEXT         NULL,
  pickup_person    VARCHAR(100) NULL,                -- early pickup: who collects the child
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',   -- pending | teacher_approved | approved | rejected | cancelled
  submitted_by     VARCHAR(100) NULL,
  submitted_role   VARCHAR(20)  NULL,
  reviewed_by      VARCHAR(100) NULL,
  reviewed_at      DATETIME     NULL,
  review_note      VARCHAR(255) NULL,
  created          DATETIME     NULL,
  modified         DATETIME     NULL,
  KEY idx_slr_status (ssms_client_code, status),
  KEY idx_slr_enroll (ssms_client_code, enrollment_id),
  KEY idx_slr_dates  (ssms_client_code, from_date, to_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_student_arrivals (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,
  class_id         INT          NULL,
  section_id       INT          NULL,
  event_date       DATE         NOT NULL,
  kind             VARCHAR(10)  NOT NULL,            -- late | early
  event_time       TIME         NOT NULL,
  reason           VARCHAR(255) NULL,
  picked_up_by     VARCHAR(100) NULL,                -- early pickup
  relation         VARCHAR(40)  NULL,                -- Mother, Father, Grandparent, Driver …
  request_id       INT          NULL,                -- the parent's request, if there was one
  recorded_by      VARCHAR(100) NULL,
  created          DATETIME     NULL,
  KEY idx_sa_day (ssms_client_code, event_date),
  KEY idx_sa_enroll (ssms_client_code, enrollment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Two-level approval for long leave ───────────────────────────────────────
-- Leave / absence longer than principal_days needs the class teacher AND the
-- principal or owner. principal_days is set per school (0 = teacher is enough).
CREATE TABLE IF NOT EXISTS ssms_student_leave_settings (
  ssms_client_code VARCHAR(20)  NOT NULL PRIMARY KEY,
  principal_days   INT          NOT NULL DEFAULT 3,
  updated_by       VARCHAR(100) NULL,
  modified         DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- status can now also be 'teacher_approved' (first level done, waiting for principal / owner)
ALTER TABLE ssms_student_leave_requests
  MODIFY status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS needs_final       TINYINT(1)   NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN IF NOT EXISTS first_approved_by VARCHAR(100) NULL AFTER submitted_role,
  ADD COLUMN IF NOT EXISTS first_approved_at DATETIME     NULL AFTER first_approved_by,
  ADD COLUMN IF NOT EXISTS first_note        VARCHAR(255) NULL AFTER first_approved_at;

-- ── Leave → attendance ──────────────────────────────────────────────────────
-- Approved leave / absence marks each school day "L" (Leave) in student_attendance.
-- Each day changed is remembered here so cancelling or editing the leave can put
-- the day back exactly as it was (prev_status) or remove the row it created.
CREATE TABLE IF NOT EXISTS ssms_student_leave_days (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  request_id       INT          NOT NULL,
  ssms_client_code VARCHAR(20)  NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,
  att_date         DATE         NOT NULL,
  prev_status      VARCHAR(5)   NULL,          -- attendance before the leave (NULL = no row)
  inserted         TINYINT(1)   NOT NULL DEFAULT 0,
  created          DATETIME     NULL,
  UNIQUE KEY uq_sld (request_id, att_date),
  KEY idx_sld_enroll (ssms_client_code, enrollment_id, att_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── School days ─────────────────────────────────────────────────────────────
-- Number of real school days in the request (weekly off days from School Settings
-- and holidays excluded). Used for the principal-approval limit and shown in the app.
ALTER TABLE ssms_student_leave_requests
  ADD COLUMN IF NOT EXISTS school_days INT NULL AFTER needs_final;
