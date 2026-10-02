-- ============================================================
-- Chapter / Unit-wise Test Series — DB Migration
-- Run this on your production MySQL/MariaDB database.
-- ============================================================

-- 1. New table: ssms_chapters
--    Stores chapters (and optional unit names) per class + subject.
CREATE TABLE IF NOT EXISTS `ssms_chapters` (
  `id`           INT(11)      NOT NULL AUTO_INCREMENT,
  `client_code`  VARCHAR(50)  NOT NULL,
  `class_id`     INT(11)      NOT NULL,
  `subject_id`   INT(11)      NOT NULL,
  `chapter_no`   INT(5)       NOT NULL DEFAULT 1,
  `chapter_name` VARCHAR(200) NOT NULL,
  `unit_name`    VARCHAR(200)          DEFAULT NULL  COMMENT 'Optional unit grouping above chapters',
  `created_at`   DATETIME              DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chapters_client_class_subject` (`client_code`, `class_id`, `subject_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 2. Add chapter_id to ssms_question_bank (optional — questions can be untagged)
ALTER TABLE `ssms_question_bank`
  ADD COLUMN `chapter_id` INT(11) DEFAULT NULL
    COMMENT 'FK → ssms_chapters.id; NULL = not tagged to a chapter'
  AFTER `subject_id`;


-- 3. Add series_scope to ssms_test_series
ALTER TABLE `ssms_test_series`
  ADD COLUMN `series_scope` ENUM('full_syllabus', 'chapter_wise') NOT NULL DEFAULT 'full_syllabus'
    COMMENT 'full_syllabus = all questions in subject; chapter_wise = filtered by chapter_id'
  AFTER `exam_type`;
