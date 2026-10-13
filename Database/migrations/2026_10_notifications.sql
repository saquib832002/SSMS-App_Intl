-- Automatic notifications to parents – phase 1 (in-app inbox, push, e-mail, notice read receipts).
-- Safe to run more than once.

-- What the school sends, per event (absence, homework, notice, fee due, results …)
CREATE TABLE IF NOT EXISTS ssms_notify_settings (
  ssms_client_code VARCHAR(20)  NOT NULL,
  event            VARCHAR(30)  NOT NULL,
  enabled          TINYINT(1)   NOT NULL DEFAULT 1,
  push             TINYINT(1)   NOT NULL DEFAULT 1,
  email            TINYINT(1)   NOT NULL DEFAULT 0,
  essential        TINYINT(1)   NOT NULL DEFAULT 0,
  options          TEXT         NULL,
  updated_by       VARCHAR(100) NULL,
  modified         DATETIME     NULL,
  PRIMARY KEY (ssms_client_code, event)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- What a person turned off for themselves (one row = switched off)
CREATE TABLE IF NOT EXISTS ssms_notify_prefs (
  ssms_client_code VARCHAR(20)  NOT NULL,
  username         VARCHAR(100) NOT NULL,
  event            VARCHAR(30)  NOT NULL,
  channel          VARCHAR(10)  NOT NULL,
  modified         DATETIME     NULL,
  PRIMARY KEY (ssms_client_code, username, event, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- The in-app list (bell)
CREATE TABLE IF NOT EXISTS ssms_notify_inbox (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  ssms_client_code VARCHAR(20)  NOT NULL,
  username         VARCHAR(100) NOT NULL,
  event            VARCHAR(30)  NOT NULL,
  ref              VARCHAR(120) NOT NULL,
  enrollment_id    VARCHAR(30)  NULL,
  title            VARCHAR(255) NOT NULL,
  body             TEXT         NULL,
  data             TEXT         NULL,
  created          DATETIME     NOT NULL,
  read_at          DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inbox_ref (ssms_client_code, username, ref),
  KEY ix_inbox_user (ssms_client_code, username, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Messages waiting to go out / sent (push, e-mail; SMS and WhatsApp later)
CREATE TABLE IF NOT EXISTS ssms_notify_outbox (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  ssms_client_code VARCHAR(20)  NOT NULL,
  event            VARCHAR(30)  NOT NULL,
  ref              VARCHAR(120) NOT NULL,
  channel          VARCHAR(10)  NOT NULL,
  username         VARCHAR(100) NULL,
  address          VARCHAR(190) NOT NULL,
  enrollment_id    VARCHAR(30)  NULL,
  lang             VARCHAR(8)   NULL,
  title            VARCHAR(255) NOT NULL,
  body             TEXT         NULL,
  data             TEXT         NULL,
  status           VARCHAR(12)  NOT NULL DEFAULT 'queued',
  attempts         INT          NOT NULL DEFAULT 0,
  error            VARCHAR(255) NULL,
  send_after       DATETIME     NOT NULL,
  created          DATETIME     NOT NULL,
  sent_at          DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_outbox (ssms_client_code, ref, channel, address),
  KEY ix_outbox_due (status, send_after),
  KEY ix_outbox_client (ssms_client_code, created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Each event is sent once (absence of a child on a day, a notice, a fee reminder …)
CREATE TABLE IF NOT EXISTS ssms_notify_log (
  ssms_client_code VARCHAR(20)  NOT NULL,
  ref              VARCHAR(120) NOT NULL,
  event            VARCHAR(30)  NOT NULL,
  recipients       INT          NOT NULL DEFAULT 0,
  created          DATETIME     NOT NULL,
  PRIMARY KEY (ssms_client_code, ref),
  KEY ix_log_created (ssms_client_code, created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Scanner bookmarks and the worker lock, per school
CREATE TABLE IF NOT EXISTS ssms_notify_state (
  ssms_client_code VARCHAR(20)  NOT NULL,
  k                VARCHAR(40)  NOT NULL,
  v                VARCHAR(255) NULL,
  PRIMARY KEY (ssms_client_code, k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Every phone a person is signed in on (more than one per account)
CREATE TABLE IF NOT EXISTS ssms_push_tokens (
  token            VARCHAR(200) NOT NULL,
  ssms_client_code VARCHAR(20)  NOT NULL,
  username         VARCHAR(100) NOT NULL,
  platform         VARCHAR(10)  NULL,
  modified         DATETIME     NULL,
  PRIMARY KEY (token),
  KEY ix_push_user (ssms_client_code, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Who has read each notice
CREATE TABLE IF NOT EXISTS ssms_notice_reads (
  ssms_client_code VARCHAR(20)  NOT NULL,
  notice_id        INT          NOT NULL,
  username         VARCHAR(100) NOT NULL,
  read_at          DATETIME     NOT NULL,
  PRIMARY KEY (ssms_client_code, notice_id, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
