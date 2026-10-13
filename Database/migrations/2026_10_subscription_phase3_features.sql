-- ============================================================================
-- Subscription phase 3 – keep plan features OUT of ssms_client_modules
--
-- ssms_client_modules stays exactly as the web panel uses it: product modules
-- (school, finance, library, donation) managed on the superadmin
-- "Manage Modules" page. School-app plan features for subscription
-- (international) schools – attendance, fees, exams … – live in their own
-- table, so the two never interfere.
-- Run after phase 1 + phase 2. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssms_client_features (
  ssms_client_code  VARCHAR(20) NOT NULL,
  feature_key       VARCHAR(50) NOT NULL,   -- attendance | notices | fees | exams | academics | assessments | hostel | transport | communication
  source            VARCHAR(30) NOT NULL,   -- trial | subscription | manual
  expires_at        DATETIME    NULL,       -- NULL = never expires (manual permanent grant)
  created           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ssms_client_code, feature_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Move rows that the earlier phase-1/2 code wrote into ssms_client_modules ──
-- Only subscription schools, only the plan feature keys, only rows written by
-- the trial / billing code. Product modules (school, finance, …) are untouched.
INSERT INTO ssms_client_features (ssms_client_code, feature_key, source, expires_at)
SELECT m.ssms_client_code,
       m.module_key,
       CASE WHEN m.granted_by LIKE 'trial%'      THEN 'trial'
            WHEN m.granted_by = 'subscription'   THEN 'subscription'
            ELSE 'manual' END,
       m.expires_at
  FROM ssms_client_modules m
  JOIN ssms_clients c ON c.ssms_client_code = m.ssms_client_code
 WHERE c.billing_model = 'subscription'
   AND m.module_key IN ('attendance','notices','fees','exams','academics','assessments','hostel','transport','communication')
   AND (m.granted_by LIKE 'trial%' OR m.granted_by IN ('subscription','manual'))
ON DUPLICATE KEY UPDATE source = VALUES(source), expires_at = VALUES(expires_at);

DELETE m FROM ssms_client_modules m
  JOIN ssms_clients c ON c.ssms_client_code = m.ssms_client_code
 WHERE c.billing_model = 'subscription'
   AND m.module_key IN ('core','attendance','notices','fees','exams','academics','assessments','hostel','transport','communication')
   AND (m.granted_by LIKE 'trial%' OR m.granted_by IN ('subscription','manual'));

-- Optional: the expires_at column added to ssms_client_modules in phase 1 is no
-- longer used by any code. It is harmless to keep; to remove it:
-- ALTER TABLE ssms_client_modules DROP COLUMN expires_at;

-- ── Handy admin queries ─────────────────────────────────────────────────────
-- Extend a school's free trial: change only its expiry date
--   UPDATE ssms_clients SET ssms_client_expiry_date = '2026-12-31' WHERE ssms_client_code = 'ABC';
-- Unlock a feature after an offline payment (bank transfer etc.) for 30 days:
--   INSERT INTO ssms_client_features (ssms_client_code, feature_key, source, expires_at)
--   VALUES ('ABC', 'fees', 'manual', DATE_ADD(NOW(), INTERVAL 30 DAY))
--   ON DUPLICATE KEY UPDATE source = VALUES(source), expires_at = VALUES(expires_at);
