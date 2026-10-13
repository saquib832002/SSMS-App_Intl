-- ============================================================================
-- Calendar sync (iCal / webcal links for Google Calendar, Outlook, Apple Calendar).
-- Everything in the feeds comes from tables the school already has: ssms_school_events (events and
-- holidays), ssms_exam_datesheet, ssms_ptm_* (parent–teacher meetings), ssms_homework, ssms_exam_duties,
-- ssms_cover_assignments and ssms_leave_applications. Only the private links are stored here.
-- Safe to run more than once (MariaDB 10.3+ / MySQL 8).
-- ============================================================================

-- One private link per person (kind 'user'), and optionally one public link per school (kind 'school':
-- events and holidays marked "visible to students / parents", e.g. for the school website).
-- The link itself is never stored: it is a signature of (id, school, person, nonce) with the app's secret,
-- so "Reset link" (a new nonce) stops the old one at once.
CREATE TABLE IF NOT EXISTS ssms_calendar_feeds (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  kind             VARCHAR(10)  NOT NULL DEFAULT 'user',   -- user | school
  username         VARCHAR(100) NOT NULL DEFAULT '',       -- '' for the school link
  enrollment_id    VARCHAR(50)  NULL,                      -- students: their own enrollment (from the sign-in)
  account_ref      VARCHAR(40)  NOT NULL DEFAULT '',       -- which account (a deleted-and-remade username gets no old link)
  nonce            CHAR(32)     NOT NULL,
  include_what     VARCHAR(200) NOT NULL DEFAULT '',       -- events,holidays,exams,meetings,homework,duties,cover,leave
  created          DATETIME     NOT NULL,
  created_by       VARCHAR(100) NULL,
  modified         DATETIME     NOT NULL,
  last_used        DATETIME     NULL,
  uses             INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uq_cal_user (ssms_client_code, kind, username),
  KEY idx_cal_client (ssms_client_code, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- (an earlier draft of this table)
ALTER TABLE ssms_calendar_feeds ADD COLUMN IF NOT EXISTS account_ref VARCHAR(40) NOT NULL DEFAULT '' AFTER enrollment_id;
UPDATE ssms_calendar_feeds SET username = '' WHERE username IS NULL;
ALTER TABLE ssms_calendar_feeds MODIFY username VARCHAR(100) NOT NULL DEFAULT '';
