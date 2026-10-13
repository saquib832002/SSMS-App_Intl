-- ============================================================================
-- Staff check-in, phase 2: QR scan, GPS (school location + radius), and the
-- "you haven't checked in yet" push reminder.
-- Run AFTER 2026_10_staff_attendance.sql. Safe to run more than once.
-- ============================================================================

ALTER TABLE ssms_staff_attendance_settings
  ADD COLUMN IF NOT EXISTS require_location TINYINT(1)    NOT NULL DEFAULT 0,   -- phone must be within the radius
  ADD COLUMN IF NOT EXISTS geo_lat          DECIMAL(10,7) NULL,                 -- school location
  ADD COLUMN IF NOT EXISTS geo_lng          DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS geo_radius_m     INT           NOT NULL DEFAULT 150, -- allowed distance in metres
  ADD COLUMN IF NOT EXISTS allow_qr         TINYINT(1)    NOT NULL DEFAULT 1,   -- office screen shows a QR too
  ADD COLUMN IF NOT EXISTS remind_staff     TINYINT(1)    NOT NULL DEFAULT 0;   -- push reminder after start + grace

ALTER TABLE ssms_staff_attendance
  ADD COLUMN IF NOT EXISTS lat        DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS lng        DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS distance_m INT           NULL;   -- metres from school at check-in

ALTER TABLE ssms_staff_attendance MODIFY method VARCHAR(10) NULL;   -- app | code | qr | manual | leave

-- one reminder per staff member per day
CREATE TABLE IF NOT EXISTS ssms_staff_checkin_reminders (
  ssms_client_code VARCHAR(20) NOT NULL,
  staff_id         INT         NOT NULL,
  rem_date         DATE        NOT NULL,
  sent_at          DATETIME    NULL,
  PRIMARY KEY (ssms_client_code, staff_id, rem_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
