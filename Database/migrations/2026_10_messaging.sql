-- Automatic notifications – phase 2: SMS and WhatsApp (needs 2026_10_notifications.sql first).
-- Safe to run more than once on MariaDB (XAMPP): ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

-- Which events go by SMS / WhatsApp (next to push and e-mail)
ALTER TABLE ssms_notify_settings
  ADD COLUMN IF NOT EXISTS sms      TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp TINYINT(1) NOT NULL DEFAULT 0;

-- Each school's SMS and WhatsApp connection: its own provider account, or ManageMyAcademy's
CREATE TABLE IF NOT EXISTS ssms_notify_channels (
  ssms_client_code   VARCHAR(20)   NOT NULL,
  channel            VARCHAR(10)   NOT NULL,          -- sms | whatsapp
  mode               VARCHAR(10)   NOT NULL DEFAULT 'off',   -- off | own | managed
  provider           VARCHAR(20)   NULL,
  config             TEXT          NULL,              -- provider keys, encrypted
  sender             VARCHAR(40)   NULL,              -- sender ID / number
  status             VARCHAR(12)   NOT NULL DEFAULT 'new',   -- new | connected | error
  last_error         VARCHAR(255)  NULL,
  tested_at          DATETIME      NULL,
  monthly_limit      INT           NULL,              -- own account: messages per month (NULL = no limit)
  managed_allowance  INT           NULL,              -- ManageMyAcademy account: set by the platform (NULL = platform default)
  cost_per_message   DECIMAL(10,4) NULL,              -- own account: estimate per SMS part / WhatsApp message
  currency           VARCHAR(5)    NULL,
  quiet_start        CHAR(5)       NULL,              -- NULL = the country's usual hours
  quiet_end          CHAR(5)       NULL,
  consent_required   TINYINT(1)    NULL,              -- NULL = the country's default
  sms_after_whatsapp TINYINT(1)    NOT NULL DEFAULT 1, -- SMS only when WhatsApp did not reach the family
  warned_month       CHAR(7)       NULL,
  stopped_month      CHAR(7)       NULL,
  updated_by         VARCHAR(100)  NULL,
  modified           DATETIME      NULL,
  PRIMARY KEY (ssms_client_code, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Registered texts: India DLT template IDs, WhatsApp template names / IDs, the school's own wording
CREATE TABLE IF NOT EXISTS ssms_notify_templates (
  ssms_client_code VARCHAR(20)  NOT NULL,
  kind             VARCHAR(30)  NOT NULL,             -- absence, fee_soon, notice …
  channel          VARCHAR(10)  NOT NULL,
  lang             VARCHAR(8)   NOT NULL,
  provider_ref     VARCHAR(190) NULL,
  status           VARCHAR(12)  NOT NULL DEFAULT 'none',   -- none | submitted | approved | rejected
  text             TEXT         NULL,                 -- NULL = the standard text
  updated_by       VARCHAR(100) NULL,
  modified         DATETIME     NULL,
  PRIMARY KEY (ssms_client_code, kind, channel, lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Numbers that replied STOP (or were stopped by the office)
CREATE TABLE IF NOT EXISTS ssms_notify_optouts (
  ssms_client_code VARCHAR(20) NOT NULL,
  channel          VARCHAR(10) NOT NULL,
  phone            VARCHAR(20) NOT NULL,
  source           VARCHAR(20) NULL,
  created          DATETIME    NOT NULL,
  PRIMARY KEY (ssms_client_code, channel, phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ManageMyAcademy's own provider accounts (set with bin/cake notify_platform)
CREATE TABLE IF NOT EXISTS ssms_notify_platform (
  channel           VARCHAR(10)   NOT NULL,
  provider          VARCHAR(20)   NOT NULL,
  config            TEXT          NULL,
  sender            VARCHAR(40)   NULL,
  default_allowance INT           NOT NULL DEFAULT 0,
  cost_per_message  DECIMAL(10,4) NULL,
  currency          VARCHAR(5)    NULL,
  modified          DATETIME      NULL,
  PRIMARY KEY (channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Delivery details for SMS / WhatsApp
ALTER TABLE ssms_notify_outbox
  ADD COLUMN IF NOT EXISTS provider     VARCHAR(20)   NULL,
  ADD COLUMN IF NOT EXISTS provider_id  VARCHAR(120)  NULL,
  ADD COLUMN IF NOT EXISTS via          VARCHAR(10)   NULL,
  ADD COLUMN IF NOT EXISTS segments     INT           NULL,
  ADD COLUMN IF NOT EXISTS cost         DECIMAL(10,4) NULL,
  ADD COLUMN IF NOT EXISTS delivered_at DATETIME      NULL,
  ADD COLUMN IF NOT EXISTS read_at      DATETIME      NULL;
CREATE INDEX IF NOT EXISTS ix_outbox_provider ON ssms_notify_outbox (provider, provider_id);
CREATE INDEX IF NOT EXISTS ix_outbox_usage ON ssms_notify_outbox (ssms_client_code, channel, sent_at);
