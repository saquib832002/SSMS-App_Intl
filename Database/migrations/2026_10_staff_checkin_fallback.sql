-- Staff check-in: "Location, or the office code / QR if GPS fails".
-- Run AFTER 2026_10_staff_checkin_gps_qr.sql. Safe to run more than once.
ALTER TABLE ssms_staff_attendance_settings
  ADD COLUMN IF NOT EXISTS location_or_code TINYINT(1) NOT NULL DEFAULT 0;
