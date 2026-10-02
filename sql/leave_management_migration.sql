-- ============================================================
-- Staff Leave Management — SQL Migration
-- Run once on your SSMS database
-- ============================================================

-- 1. Leave Types  (CL, ML, EL, etc.)
CREATE TABLE IF NOT EXISTS `ssms_leave_types` (
  `id`                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `branch_id`         INT UNSIGNED   NOT NULL DEFAULT 0 COMMENT '0 = all branches',
  `name`              VARCHAR(80)    NOT NULL,
  `abbreviation`      VARCHAR(10)    NOT NULL DEFAULT '',
  `max_days_per_year` DECIMAL(5,1)   NOT NULL DEFAULT 12,
  `carry_forward`     TINYINT(1)     NOT NULL DEFAULT 0 COMMENT '1 = unused days carry to next year',
  `status`            TINYINT(1)     NOT NULL DEFAULT 1,
  `created_at`        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default leave types
INSERT IGNORE INTO `ssms_leave_types` (`id`, `name`, `abbreviation`, `max_days_per_year`, `carry_forward`) VALUES
  (1, 'Casual Leave',     'CL',  12, 0),
  (2, 'Medical Leave',    'ML',  10, 0),
  (3, 'Earned Leave',     'EL',  15, 1),
  (4, 'Maternity Leave',  'MAT', 90, 0),
  (5, 'Paternity Leave',  'PAT',  7, 0);

-- 2. Leave Applications
CREATE TABLE IF NOT EXISTS `ssms_leave_applications` (
  `id`            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `staff_id`      INT UNSIGNED   NOT NULL,
  `branch_id`     INT UNSIGNED   NOT NULL DEFAULT 0,
  `leave_type_id` INT UNSIGNED   NOT NULL,
  `from_date`     DATE           NOT NULL,
  `to_date`       DATE           NOT NULL,
  `days`          DECIMAL(4,1)   NOT NULL DEFAULT 1,
  `reason`        TEXT           NOT NULL,
  `is_half_day`   TINYINT(1)     NOT NULL DEFAULT 0,
  `half_day_slot` ENUM('morning','afternoon') DEFAULT NULL,
  `status`        ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `approved_by`   INT UNSIGNED   DEFAULT NULL COMMENT 'staff_id of approver',
  `approved_at`   DATETIME       DEFAULT NULL,
  `remarks`       TEXT           DEFAULT NULL COMMENT 'Approver remarks',
  `created_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_staff`  (`staff_id`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_status` (`status`),
  KEY `idx_dates`  (`from_date`, `to_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Leave Balances  (auto-refreshed by the backend per year)
CREATE TABLE IF NOT EXISTS `ssms_leave_balances` (
  `id`            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `staff_id`      INT UNSIGNED   NOT NULL,
  `branch_id`     INT UNSIGNED   NOT NULL DEFAULT 0,
  `leave_type_id` INT UNSIGNED   NOT NULL,
  `year`          YEAR           NOT NULL,
  `total_days`    DECIMAL(5,1)   NOT NULL DEFAULT 0,
  `used_days`     DECIMAL(5,1)   NOT NULL DEFAULT 0,
  `carried_days`  DECIMAL(5,1)   NOT NULL DEFAULT 0 COMMENT 'Carried forward from previous year',
  `created_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_balance` (`staff_id`, `leave_type_id`, `year`),
  KEY `idx_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
