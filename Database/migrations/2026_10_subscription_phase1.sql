-- ============================================================================
-- Subscription phase 1 – international (subscription) vs Indian (legacy) schools
-- Run ONCE on the shared database BEFORE deploying the phase-1 PHP code.
-- Existing schools get billing_model = 'legacy' and behave exactly as today.
-- ============================================================================

-- 1. Which billing rules apply to a school.
--    'legacy'       = current Indian flow (expiry date, no module paywall)
--    'subscription' = international flow (free 'core' + paid modules)
ALTER TABLE ssms_clients
  ADD COLUMN billing_model VARCHAR(20) NOT NULL DEFAULT 'legacy',
  ADD COLUMN country_code  CHAR(2)     NULL,
  ADD COLUMN timezone      VARCHAR(64) NULL;

-- 2. Module grants can now expire (trial now, paid period in phase 2).
--    NULL = never expires (all existing rows).
ALTER TABLE ssms_client_modules
  ADD COLUMN expires_at DATETIME NULL;

-- 3. One row per school + module. registerTrialUser already uses INSERT IGNORE,
--    so this key probably exists. Check first:
--      SHOW INDEX FROM ssms_client_modules;
--    If there is no unique index on (ssms_client_code, module_key), run:
-- ALTER TABLE ssms_client_modules
--   ADD UNIQUE KEY uq_client_module (ssms_client_code, module_key);

-- ── Handy admin queries ─────────────────────────────────────────────────────
-- Move a school to subscription billing:
--   UPDATE ssms_clients SET billing_model = 'subscription' WHERE ssms_client_code = 'ABC';
-- Give a subscription school a module for 30 days:
--   INSERT INTO ssms_client_modules (ssms_client_code, module_key, granted_by, expires_at)
--   VALUES ('ABC', 'fees', 'manual', DATE_ADD(NOW(), INTERVAL 30 DAY))
--   ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), granted_by = VALUES(granted_by);
