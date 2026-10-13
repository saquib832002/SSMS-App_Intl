-- ============================================================================
-- Parent–teacher meeting booking: teachers publish time slots, parents book one,
-- reminders go out the day before and one hour before.
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS). Works on older MariaDB.
-- Times are the SCHOOL's local time (ssms_clients.timezone; India → Asia/Kolkata).
-- ============================================================================

-- A block of meeting time a teacher offers (e.g. 14 Nov, 15:00–18:00, 10-minute slots).
CREATE TABLE IF NOT EXISTS ssms_ptm_sessions (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code   VARCHAR(50)  NOT NULL,
  staff_id           INT          NOT NULL,                 -- the teacher parents meet
  title              VARCHAR(150) NOT NULL,
  meet_date          DATE         NOT NULL,
  start_time         TIME         NOT NULL,
  end_time           TIME         NOT NULL,
  slot_minutes       INT          NOT NULL DEFAULT 10,
  gap_minutes        INT          NOT NULL DEFAULT 0,       -- break between slots
  mode               VARCHAR(12)  NOT NULL DEFAULT 'in_person',   -- in_person | video | phone
  location           VARCHAR(300) NULL,                    -- room, or the video link
  audience           TEXT         NULL,                    -- JSON [{class_id, section_id|null}], NULL = the teacher's own classes
  closes_hours       INT          NOT NULL DEFAULT 12,      -- booking / cancelling stops this many hours before a slot
  note_for_parents   VARCHAR(1000) NULL,
  status             VARCHAR(12)  NOT NULL DEFAULT 'open',  -- open | closed | cancelled
  cancel_reason      VARCHAR(300) NULL,
  created_by         VARCHAR(100) NULL,
  created            DATETIME     NOT NULL,
  modified           DATETIME     NOT NULL,
  KEY idx_ptm_sess_client (ssms_client_code, meet_date),
  KEY idx_ptm_sess_staff  (ssms_client_code, staff_id, meet_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_ptm_slots (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code   VARCHAR(50)  NOT NULL,
  session_id         INT          NOT NULL,
  start_at           DATETIME     NOT NULL,
  end_at             DATETIME     NOT NULL,
  status             VARCHAR(10)  NOT NULL DEFAULT 'open',  -- open | booked | blocked
  UNIQUE KEY uq_ptm_slot (session_id, start_at),
  KEY idx_ptm_slot_client (ssms_client_code, start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per booking. `active` is 1 while booked and NULL once cancelled, so the unique
-- key allows only one live booking per slot (and per child per session).
CREATE TABLE IF NOT EXISTS ssms_ptm_bookings (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code   VARCHAR(50)  NOT NULL,
  session_id         INT          NOT NULL,
  slot_id            INT          NOT NULL,
  enrollment_id      VARCHAR(50)  NOT NULL,
  registration_id    VARCHAR(50)  NULL,
  booked_by          VARCHAR(100) NOT NULL,                -- username of the parent (or staff who booked for them)
  booked_by_role     VARCHAR(20)  NOT NULL,
  parent_name        VARCHAR(150) NULL,
  parent_phone       VARCHAR(30)  NULL,
  topic              VARCHAR(500) NULL,                    -- what the parent wants to talk about
  status             VARCHAR(12)  NOT NULL DEFAULT 'booked', -- booked | cancelled | attended | no_show
  active             TINYINT(1)   NULL DEFAULT 1,
  cancelled_by       VARCHAR(100) NULL,
  cancelled_by_role  VARCHAR(20)  NULL,
  cancel_reason      VARCHAR(300) NULL,
  teacher_note       TEXT         NULL,                    -- private: staff only
  reminded_day_at    DATETIME     NULL,
  reminded_hour_at   DATETIME     NULL,
  created            DATETIME     NOT NULL,
  modified           DATETIME     NOT NULL,
  UNIQUE KEY uq_ptm_book_slot  (slot_id, active),
  UNIQUE KEY uq_ptm_book_child (session_id, enrollment_id, active),
  KEY idx_ptm_book_parent (ssms_client_code, booked_by),
  KEY idx_ptm_book_child  (ssms_client_code, enrollment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
