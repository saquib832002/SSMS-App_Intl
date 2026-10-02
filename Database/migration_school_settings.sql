-- ============================================================
-- Migration: ssms_school_settings
-- Run once per installation in phpMyAdmin or MySQL CLI.
-- ============================================================

CREATE TABLE IF NOT EXISTS ssms_school_settings (
  id                  INT          NOT NULL AUTO_INCREMENT,
  client_code         VARCHAR(50)  NOT NULL,

  -- Comma-separated day numbers: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  working_days        VARCHAR(20)  NOT NULL DEFAULT '1,2,3,4,5',
  weekend_days        VARCHAR(20)  NOT NULL DEFAULT '6,7',

  -- Month the academic session starts (1=January … 12=December)
  session_start_month TINYINT      NOT NULL DEFAULT 4,

  -- Overall school hours (HH:MM, 24-hour)
  school_start_time   VARCHAR(10)  NOT NULL DEFAULT '08:00',
  school_end_time     VARCHAR(10)  NOT NULL DEFAULT '14:00',

  created             DATETIME     DEFAULT CURRENT_TIMESTAMP,
  modified            DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY unique_client (client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
