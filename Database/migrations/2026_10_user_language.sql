-- Region & formats, phase 4: each person's own language (app, notifications and e-mails).
-- No row = the person follows the school's language (Setup › Region & formats). Safe to run more than once.
CREATE TABLE IF NOT EXISTS ssms_user_language (
  ssms_client_code VARCHAR(20)  NOT NULL,
  username         VARCHAR(100) NOT NULL,
  language         VARCHAR(8)   NOT NULL,
  modified         DATETIME     NULL,
  PRIMARY KEY (ssms_client_code, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
