-- ============================================================================
-- Privacy & security (Feature 7): sessions, login throttling, set-password links,
-- two-step login, audit log, roles & permissions, consent records, data requests.
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Works on older MariaDB (XAMPP): no "ALTER TABLE IF EXISTS".
-- ============================================================================

-- ── School security settings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ssms_security_settings (
  ssms_client_code      VARCHAR(20)  NOT NULL PRIMARY KEY,
  mfa_roles             VARCHAR(200) NULL,                 -- roles that must use two-step login (owner always)
  mfa_grace_days        INT          NOT NULL DEFAULT 7,
  mfa_required_since    DATE         NULL,
  audit_retention_years INT          NOT NULL DEFAULT 2,
  coppa_mode            VARCHAR(10)  NOT NULL DEFAULT 'parent',   -- parent | school
  consent_enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  permissions_enforced  TINYINT(1)   NOT NULL DEFAULT 1,
  retention_json        TEXT         NULL,                 -- years kept after leaving: fees, academic, attendance, payroll
  updated_by            VARCHAR(100) NULL,
  modified              DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sign-in sessions (revocable) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ssms_user_sessions (
  id               CHAR(32)     NOT NULL PRIMARY KEY,      -- "sid" inside the token
  ssms_client_code VARCHAR(20)  NOT NULL,
  username         VARCHAR(100) NOT NULL,
  device           VARCHAR(120) NULL,
  platform         VARCHAR(20)  NULL,
  app_version      VARCHAR(30)  NULL,
  ip               VARCHAR(45)  NULL,
  mfa              TINYINT(1)   NOT NULL DEFAULT 0,
  created          DATETIME     NOT NULL,
  last_seen        DATETIME     NULL,
  expires          DATETIME     NOT NULL,
  revoked_at       DATETIME     NULL,
  revoked_reason   VARCHAR(60)  NULL,
  KEY idx_sess_user (username, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_user_security (
  username              VARCHAR(100) NOT NULL PRIMARY KEY,
  ssms_client_code      VARCHAR(20)  NOT NULL,
  tokens_valid_after    DATETIME     NULL,                 -- every token issued before this is refused
  sidless_invalid_after DATETIME     NULL                  -- old-app tokens (no session id) issued before this are refused
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_login_attempts (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(120) NOT NULL,                      -- lower-case; "mfa:<user>" for code attempts
  ip           VARCHAR(45)  NULL,
  success      TINYINT(1)   NOT NULL DEFAULT 0,
  attempted_at DATETIME     NOT NULL,
  KEY idx_la_user (username, attempted_at),
  KEY idx_la_ip (ip, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_password_tokens (
  token_hash       CHAR(64)     NOT NULL PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  username         VARCHAR(100) NOT NULL,
  expires          DATETIME     NOT NULL,
  used_at          DATETIME     NULL,
  created          DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Two-step login ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ssms_user_mfa (
  username           VARCHAR(100) NOT NULL PRIMARY KEY,
  ssms_client_code   VARCHAR(20)  NOT NULL,
  method             VARCHAR(10)  NOT NULL DEFAULT 'totp',
  secret_enc         TEXT         NOT NULL,                -- encrypted authenticator key
  enabled            TINYINT(1)   NOT NULL DEFAULT 0,
  enabled_at         DATETIME     NULL,
  last_step          BIGINT       NOT NULL DEFAULT 0,      -- last code used (no re-use)
  backup_codes       TEXT         NULL,                    -- JSON list of hashed one-time codes
  email_code_hash    CHAR(64)     NULL,
  email_code_expires DATETIME     NULL,
  email_sent_at      DATETIME     NULL,
  updated            DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_trusted_devices (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  username         VARCHAR(100) NOT NULL,
  token_hash       CHAR(64)     NOT NULL,
  label            VARCHAR(120) NULL,
  expires          DATETIME     NOT NULL,
  created          DATETIME     NOT NULL,
  KEY idx_td_user (username, token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Audit log (insert-only, hash chain per school) ──────────────────────────
CREATE TABLE IF NOT EXISTS ssms_audit_log (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  created          DATETIME     NOT NULL,
  category         VARCHAR(20)  NOT NULL,                  -- security | access | records | money | privacy | settings
  event            VARCHAR(80)  NOT NULL,
  actor            VARCHAR(100) NULL,
  actor_role       VARCHAR(30)  NULL,
  entity_type      VARCHAR(40)  NULL,
  entity_id        VARCHAR(64)  NULL,
  summary          VARCHAR(255) NULL,
  changes          MEDIUMTEXT   NULL,                      -- JSON, secrets masked
  ip               VARCHAR(45)  NULL,
  app_version      VARCHAR(30)  NULL,
  prev_hash        CHAR(64)     NOT NULL,
  hash             CHAR(64)     NOT NULL,
  KEY idx_audit_school (ssms_client_code, id),
  KEY idx_audit_when (ssms_client_code, created),
  KEY idx_audit_actor (ssms_client_code, actor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Roles & permissions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ssms_roles (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  name             VARCHAR(60)  NOT NULL,
  base_role        VARCHAR(20)  NOT NULL,                  -- owner | admin | principal | user | staff | accountant
  is_system        TINYINT(1)   NOT NULL DEFAULT 0,        -- 1 = an edited built-in role
  own_classes_only TINYINT(1)   NOT NULL DEFAULT 0,
  created_by       VARCHAR(100) NULL,
  created          DATETIME     NULL,
  modified         DATETIME     NULL,
  KEY idx_roles_school (ssms_client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_role_permissions (
  role_id     INT         NOT NULL,
  module      VARCHAR(30) NOT NULL,
  can_view    TINYINT(1)  NOT NULL DEFAULT 0,
  can_edit    TINYINT(1)  NOT NULL DEFAULT 0,
  can_delete  TINYINT(1)  NOT NULL DEFAULT 0,
  can_approve TINYINT(1)  NOT NULL DEFAULT 0,
  can_export  TINYINT(1)  NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sawera_ssms_users ADD COLUMN IF NOT EXISTS custom_role_id INT NULL;

-- ── Consent records ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ssms_consent_types (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  type_key         VARCHAR(60)  NOT NULL,
  title            VARCHAR(120) NOT NULL,
  body             TEXT         NOT NULL,
  audience         VARCHAR(10)  NOT NULL DEFAULT 'parent',   -- parent | staff
  required         TINYINT(1)   NOT NULL DEFAULT 0,
  version          INT          NOT NULL DEFAULT 1,
  active           TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by       VARCHAR(100) NULL,
  modified         DATETIME     NULL,
  KEY idx_ct_school (ssms_client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_consents (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  type_id          INT          NOT NULL,
  version          INT          NOT NULL,
  subject_type     VARCHAR(10)  NOT NULL,                    -- student | staff
  subject_id       VARCHAR(64)  NOT NULL,                    -- enrollment id or staff username
  given_by         VARCHAR(100) NOT NULL,
  granted          TINYINT(1)   NOT NULL,
  method           VARCHAR(10)  NOT NULL DEFAULT 'app',      -- app | web | paper
  recorded_by      VARCHAR(100) NULL,                        -- office user, for paper forms
  note             VARCHAR(255) NULL,
  ip               VARCHAR(45)  NULL,
  app_version      VARCHAR(30)  NULL,
  created          DATETIME     NOT NULL,
  KEY idx_consent_subject (ssms_client_code, subject_id, type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Data requests ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ssms_privacy_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(20)  NOT NULL,
  type             VARCHAR(12)  NOT NULL,                    -- export | correction | delete
  subject_type     VARCHAR(10)  NOT NULL,                    -- student | staff
  subject_id       VARCHAR(64)  NOT NULL,
  subject_name     VARCHAR(150) NULL,
  requested_by     VARCHAR(100) NOT NULL,
  requester_name   VARCHAR(150) NULL,                        -- for requests logged by the office
  channel          VARCHAR(10)  NOT NULL DEFAULT 'app',      -- app | office
  details          TEXT         NULL,
  status           VARCHAR(12)  NOT NULL,                    -- pending | in_review | ready | scheduled | done | rejected | cancelled | expired
  due_date         DATE         NULL,
  file_path        VARCHAR(120) NULL,
  file_name        VARCHAR(150) NULL,
  file_expires     DATETIME     NULL,
  delete_after     DATETIME     NULL,
  handled_by       VARCHAR(100) NULL,
  handled_at       DATETIME     NULL,
  decision_note    TEXT         NULL,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NULL,
  KEY idx_pr_school (ssms_client_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
