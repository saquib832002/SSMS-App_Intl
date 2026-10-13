-- Enrollment / registration IDs are text in this system (e.g. ETWF-2026-0001, RTWF-2026-0001).
-- The first version of the online payments table stored them as numbers.
ALTER TABLE ssms_online_payments MODIFY enrollment_id   VARCHAR(50) NOT NULL;
ALTER TABLE ssms_online_payments MODIFY registration_id VARCHAR(50) NULL;
