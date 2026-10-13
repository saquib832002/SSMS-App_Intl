-- ============================================================================
-- Phase 5 – configurable free trial (platform owner / web superuser)
--   • ssms_platform_settings : platform-wide settings ('trial_days' = default
--                              trial length for NEW international schools)
--   • ssms_trial_changes     : history of every trial change
-- Safe to run more than once. Indian (legacy) schools are not affected.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssms_platform_settings (
  setting_key   VARCHAR(64)  NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  updated_by    VARCHAR(100) NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO ssms_platform_settings (setting_key, setting_value, updated_by)
VALUES ('trial_days', '14', 'migration');

CREATE TABLE IF NOT EXISTS ssms_trial_changes (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ssms_client_code VARCHAR(20)  NULL COMMENT 'NULL = platform default changed',
  action           VARCHAR(30)  NOT NULL COMMENT 'default_days | extend | set_date | end_now | restart | apply_default',
  old_value        VARCHAR(50)  NULL,
  new_value        VARCHAR(50)  NULL,
  note             VARCHAR(255) NULL,
  changed_by       VARCHAR(100) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trial_changes_client (ssms_client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Examples (or use the web page /admin/clients/trials):
--   UPDATE ssms_platform_settings SET setting_value = '60' WHERE setting_key = 'trial_days';
