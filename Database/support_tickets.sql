-- ============================================================
-- Support Tickets Table
-- Run this on your MySQL / MariaDB database.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
    ticket_id          INT            NOT NULL AUTO_INCREMENT,
    ticket_number      VARCHAR(25)    NOT NULL,          -- e.g. TKT-20260804-0001
    name               VARCHAR(100)   NOT NULL,
    email_address      VARCHAR(150)   NOT NULL,
    mobile_number      VARCHAR(20)    DEFAULT NULL,
    problem_description TEXT          NOT NULL,
    ssms_client_code   VARCHAR(10)    DEFAULT NULL,      -- optional, if school is registered
    status             ENUM(
                           'Open',
                           'In Progress',
                           'Resolved',
                           'Closed'
                       )              NOT NULL DEFAULT 'Open',
    response           TEXT           DEFAULT NULL,      -- admin/owner only
    created            DATETIME       NOT NULL,
    modified           DATETIME       NOT NULL,

    PRIMARY KEY (ticket_id),
    UNIQUE  KEY uq_ticket_number (ticket_number),
    INDEX       idx_email        (email_address),
    INDEX       idx_status       (status),
    INDEX       idx_client_code  (ssms_client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
