-- ============================================================================
-- Complete student record: guardians, emergency contacts, medical & allergies,
-- documents and custom fields per school.
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS).
-- Works on older MariaDB (XAMPP): no "ALTER TABLE IF EXISTS".
-- Everything is keyed by registration_id, so it follows the student from year to year.
-- ============================================================================

-- Guardians (any number per student). app_access = this person's mobile can sign in
-- to the parent app for this child.
CREATE TABLE IF NOT EXISTS ssms_student_guardians (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  registration_id  VARCHAR(50)  NOT NULL,
  name             VARCHAR(150) NOT NULL,
  relation         VARCHAR(40)  NOT NULL DEFAULT 'guardian',
  phone            VARCHAR(30)  NULL,
  phone_last10     VARCHAR(10)  NULL,
  email            VARCHAR(150) NULL,
  occupation       VARCHAR(100) NULL,
  address          VARCHAR(300) NULL,
  is_primary       TINYINT(1)   NOT NULL DEFAULT 0,
  lives_with       TINYINT(1)   NOT NULL DEFAULT 1,
  can_pickup       TINYINT(1)   NOT NULL DEFAULT 1,
  app_access       TINYINT(1)   NOT NULL DEFAULT 0,
  gets_notices     TINYINT(1)   NOT NULL DEFAULT 1,
  restriction_note VARCHAR(500) NULL,
  sort_order       INT          NOT NULL DEFAULT 0,
  created_by       VARCHAR(100) NULL,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  KEY idx_guard_student (ssms_client_code, registration_id),
  KEY idx_guard_phone   (ssms_client_code, phone_last10, app_access)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_student_emergency_contacts (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  registration_id  VARCHAR(50)  NOT NULL,
  name             VARCHAR(150) NOT NULL,
  relation         VARCHAR(40)  NULL,
  phone            VARCHAR(30)  NOT NULL,
  alt_phone        VARCHAR(30)  NULL,
  notes            VARCHAR(300) NULL,
  priority         INT          NOT NULL DEFAULT 1,
  updated_by       VARCHAR(100) NULL,
  updated_by_role  VARCHAR(20)  NULL,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  KEY idx_emerg_student (ssms_client_code, registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per student. Free-text health details are stored encrypted (enc_*);
-- blood group and the alert level stay readable so lists and badges work.
CREATE TABLE IF NOT EXISTS ssms_student_medical (
  ssms_client_code VARCHAR(50)  NOT NULL,
  registration_id  VARCHAR(50)  NOT NULL,
  blood_group      VARCHAR(10)  NULL,
  alert_level      VARCHAR(10)  NOT NULL DEFAULT 'none',   -- none | info | serious | severe
  has_allergies    TINYINT(1)   NOT NULL DEFAULT 0,
  enc_allergies    TEXT         NULL,
  enc_conditions   TEXT         NULL,
  enc_medications  TEXT         NULL,
  enc_dietary      TEXT         NULL,
  enc_doctor       TEXT         NULL,
  enc_insurance    TEXT         NULL,
  enc_notes        TEXT         NULL,
  updated_by       VARCHAR(100) NULL,
  updated_by_role  VARCHAR(20)  NULL,
  modified         DATETIME     NOT NULL,
  PRIMARY KEY (ssms_client_code, registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Files are kept outside the web folder (storage/student_documents) and only
-- served through StudentRecordApi/downloadDocument after a permission check.
CREATE TABLE IF NOT EXISTS ssms_student_documents (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  registration_id  VARCHAR(50)  NOT NULL,
  doc_type         VARCHAR(30)  NOT NULL DEFAULT 'other',
  title            VARCHAR(150) NOT NULL,
  doc_number       VARCHAR(60)  NULL,
  expires_on       DATE         NULL,
  file_name        VARCHAR(200) NOT NULL,
  stored_name      VARCHAR(100) NOT NULL,
  mime             VARCHAR(80)  NOT NULL,
  size_bytes       INT          NOT NULL DEFAULT 0,
  sha256           CHAR(64)     NULL,
  visible_to_parent TINYINT(1)  NOT NULL DEFAULT 1,
  verified         TINYINT(1)   NOT NULL DEFAULT 0,
  verified_by      VARCHAR(100) NULL,
  verified_at      DATETIME     NULL,
  uploaded_by      VARCHAR(100) NULL,
  uploaded_by_role VARCHAR(20)  NULL,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  KEY idx_doc_student (ssms_client_code, registration_id),
  KEY idx_doc_expiry  (ssms_client_code, expires_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Custom fields each school defines for its students.
CREATE TABLE IF NOT EXISTS ssms_custom_fields (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code  VARCHAR(50)  NOT NULL,
  entity            VARCHAR(20)  NOT NULL DEFAULT 'student',
  label             VARCHAR(100) NOT NULL,
  field_type        VARCHAR(20)  NOT NULL DEFAULT 'text',  -- text | long_text | number | date | select | yes_no | phone | email
  options           TEXT         NULL,                     -- JSON list for "select"
  help_text         VARCHAR(200) NULL,
  required          TINYINT(1)   NOT NULL DEFAULT 0,
  visible_to_parent TINYINT(1)   NOT NULL DEFAULT 0,
  parent_can_edit   TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order        INT          NOT NULL DEFAULT 0,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  created_by        VARCHAR(100) NULL,
  created           DATETIME     NOT NULL,
  modified          DATETIME     NOT NULL,
  KEY idx_cf_client (ssms_client_code, entity, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_custom_field_values (
  ssms_client_code VARCHAR(50)  NOT NULL,
  field_id         INT          NOT NULL,
  record_id        VARCHAR(50)  NOT NULL,                  -- registration_id for students
  value            TEXT         NULL,
  updated_by       VARCHAR(100) NULL,
  modified         DATETIME     NOT NULL,
  PRIMARY KEY (field_id, record_id),
  KEY idx_cfv_record (ssms_client_code, record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
