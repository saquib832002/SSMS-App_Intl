-- ============================================================================
-- Safety: visitor management and authorised pick-up.
--
-- Reused:
--   ssms_student_guardians  the people who may collect a child (can_pickup / restriction_note already there).
--                           New columns: photo, ID (type + last 4 only), a date window for one-off persons,
--                           approval for persons added by parents, a pick-up code, and "pick-up only"
--                           (drivers, nannies … who are not guardians: no app sign-in, no messages).
--   ssms_student_arrivals   the late / early log; gate hand-overs are written here too (kind early | pickup)
--                           with who collected the child and how they were checked. Parents are told
--                           through the existing "late arrival / early pick-up" notifications.
-- New:
--   ssms_visits             the visitor log (expected → signed in → signed out, or refused at the door)
--   ssms_visitor_watchlist  people who must not be let in (deny) or the office should know about (alert)
--   ssms_safety_settings    per-school rules
-- Safe to run more than once (MariaDB 10.3+).
-- ============================================================================

ALTER TABLE ssms_student_guardians
  ADD COLUMN IF NOT EXISTS photo_name       VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS id_type          VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS id_last4         VARCHAR(8)   NULL,
  ADD COLUMN IF NOT EXISTS pickup_from      DATE         NULL,       -- one-off / temporary person: valid from …
  ADD COLUMN IF NOT EXISTS pickup_until     DATE         NULL,       -- … until (NULL = no end)
  ADD COLUMN IF NOT EXISTS pickup_status    VARCHAR(10)  NOT NULL DEFAULT 'approved',   -- approved | pending | rejected
  ADD COLUMN IF NOT EXISTS pickup_code_hash CHAR(64)     NULL,       -- code the person shows at the gate (stored as a hash)
  ADD COLUMN IF NOT EXISTS pickup_only      TINYINT(1)   NOT NULL DEFAULT 0,          -- 1 = driver / nanny / one-off person, not a guardian
  ADD COLUMN IF NOT EXISTS added_by_role    VARCHAR(20)  NULL,
  ADD COLUMN IF NOT EXISTS approved_by      VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS approved_at      DATETIME     NULL;

ALTER TABLE ssms_student_arrivals
  ADD COLUMN IF NOT EXISTS guardian_id      INT          NULL,       -- who collected the child (ssms_student_guardians.id)
  ADD COLUMN IF NOT EXISTS verify_method    VARCHAR(12)  NULL,       -- photo | id | code | known | override
  ADD COLUMN IF NOT EXISTS override_reason  VARCHAR(255) NULL;       -- collected by someone not on the list (with permission)

CREATE TABLE IF NOT EXISTS ssms_safety_settings (
  ssms_client_code   VARCHAR(50)  NOT NULL PRIMARY KEY,
  require_photo      TINYINT(1)   NOT NULL DEFAULT 0,     -- visitor photo needed to sign in
  require_id         TINYINT(1)   NOT NULL DEFAULT 0,     -- visitor ID (type + last 4) needed to sign in
  visitor_rules      TEXT         NULL,                   -- shown at sign-in, the visitor must agree
  notify_host        TINYINT(1)   NOT NULL DEFAULT 1,     -- tell the staff member a visitor has arrived
  retention_days     SMALLINT     NOT NULL DEFAULT 90,    -- visits older than this are deleted (nightly clean-up)
  parent_pickup      VARCHAR(10)  NOT NULL DEFAULT 'approve',   -- parents add pick-up persons: approve | direct | off
  temp_code          TINYINT(1)   NOT NULL DEFAULT 1,     -- one-off persons must show a pick-up code
  daily_on           DATE         NULL,                   -- last daily clean-up
  modified           DATETIME     NULL,
  modified_by        VARCHAR(100) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Default retention 90 days (was 365 in the first version). Schools that never saved their rules move to 90.
ALTER TABLE ssms_safety_settings ALTER COLUMN retention_days SET DEFAULT 90;
UPDATE ssms_safety_settings SET retention_days = 90 WHERE retention_days = 365 AND modified IS NULL;

-- One row per visit. Times are the school's local time.
CREATE TABLE IF NOT EXISTS ssms_visits (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  visit_date       DATE         NOT NULL,
  status           VARCHAR(10)  NOT NULL DEFAULT 'in',   -- expected | in | out | denied | cancelled | no_show
  name             VARCHAR(120) NOT NULL,
  phone            VARCHAR(30)  NULL,
  phone_last10     VARCHAR(10)  NULL,
  company          VARCHAR(120) NULL,
  purpose          VARCHAR(20)  NOT NULL DEFAULT 'meeting',
  host_staff_id    INT          NULL,
  host_name        VARCHAR(120) NULL,
  enrollment_id    VARCHAR(50)  NULL,                    -- visiting / collecting a student
  id_type          VARCHAR(30)  NULL,
  id_last4         VARCHAR(8)   NULL,
  vehicle_no       VARCHAR(30)  NULL,
  badge_no         VARCHAR(20)  NULL,
  photo_name       VARCHAR(100) NULL,
  note             VARCHAR(500) NULL,
  agreed_rules     TINYINT(1)   NOT NULL DEFAULT 0,
  watch_level      VARCHAR(10)  NULL,                    -- alert | deny (matched the watch list)
  pass_code_hash   CHAR(64)     NULL,                    -- expected visitors: the code they were given
  expected_time    VARCHAR(5)   NULL,
  signed_in_at     DATETIME     NULL,
  signed_out_at    DATETIME     NULL,
  auto_out         TINYINT(1)   NOT NULL DEFAULT 0,      -- not signed out, closed by the night clean-up
  signed_in_by     VARCHAR(100) NULL,
  signed_out_by    VARCHAR(100) NULL,
  created_by       VARCHAR(100) NULL,
  purged           TINYINT(1)   NOT NULL DEFAULT 0,      -- personal details removed (retention)
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  KEY idx_visit_day   (ssms_client_code, visit_date, status),
  KEY idx_visit_phone (ssms_client_code, phone_last10),
  KEY idx_visit_host  (ssms_client_code, host_staff_id, visit_date),
  KEY idx_visit_code  (ssms_client_code, pass_code_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_visitor_watchlist (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  name             VARCHAR(120) NOT NULL,
  phone_last10     VARCHAR(10)  NULL,
  id_last4         VARCHAR(8)   NULL,
  level            VARCHAR(10)  NOT NULL DEFAULT 'deny',  -- deny | alert
  reason           VARCHAR(300) NULL,
  active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       VARCHAR(100) NULL,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  KEY idx_watch (ssms_client_code, active, phone_last10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
