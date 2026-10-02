-- ============================================================
-- Question Paper Feature — Database Migration
-- Run this script once on your MySQL server.
-- ============================================================

-- ── 1. Question Bank ─────────────────────────────────────────
-- Stores reusable questions scoped per school (ssms_client_code).

CREATE TABLE IF NOT EXISTS ssms_question_bank (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    ssms_client_code VARCHAR(50)   NOT NULL,
    subject_id       INT           NULL,
    class_id         INT           NULL,
    chapter          VARCHAR(150)  NULL,
    type             ENUM('fill_blank','mcq','true_false','match','short','long','passage','figure')
                     NOT NULL DEFAULT 'short',
    question_text    TEXT          NOT NULL,
    options          JSON          NULL,        -- [{text, isCorrect}] for MCQ / True-False
    match_pairs      JSON          NULL,        -- [{left, right}] for Match the Following
    answer           TEXT          NULL,        -- Model answer / explanation (for answer key)
    image_path       VARCHAR(255)  NULL,        -- Relative web path to attached figure image
    difficulty       ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
    marks            TINYINT UNSIGNED NOT NULL DEFAULT 2,
    answer_lines     TINYINT UNSIGNED NOT NULL DEFAULT 6,   -- Ruled lines to print for Short/Long
    tags             JSON          NULL,        -- ["chapter6", "geometry"] etc.
    created_by       INT           NULL,        -- FK → ssms_users.id
    is_deleted       TINYINT(1)    NOT NULL DEFAULT 0,
    created_at       DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_client             (ssms_client_code),
    INDEX idx_client_subject     (ssms_client_code, subject_id),
    INDEX idx_client_class       (ssms_client_code, class_id),
    INDEX idx_client_type        (ssms_client_code, type),
    INDEX idx_deleted            (is_deleted),
    FULLTEXT INDEX ft_question   (question_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 2. Question Papers ───────────────────────────────────────
-- One record per exam paper (header info + config).

CREATE TABLE IF NOT EXISTS ssms_question_papers (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    ssms_client_code VARCHAR(50)   NOT NULL,
    title            VARCHAR(255)  NOT NULL,
    class_id         INT           NULL,        -- FK → ssms_class.id
    subject_id       INT           NULL,        -- FK → ssms_subjects.id
    session          VARCHAR(20)   NULL,        -- e.g. "2026-27"
    exam_type        VARCHAR(50)   NULL DEFAULT 'Unit Test',
    total_marks      SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- auto-synced from paper_questions
    duration_minutes SMALLINT UNSIGNED NULL,
    instructions     JSON          NULL,        -- ["All questions compulsory", ...]
    header_config    JSON          NULL,        -- {schoolName, address, logo}
    status           ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
    created_by       INT           NULL,        -- FK → ssms_users.id
    created_at       DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_client        (ssms_client_code),
    INDEX idx_client_status (ssms_client_code, status),
    INDEX idx_client_class  (ssms_client_code, class_id),
    INDEX idx_client_sub    (ssms_client_code, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 3. Paper Questions (junction) ────────────────────────────
-- Links questions from the bank to a paper with per-paper marks & order.

CREATE TABLE IF NOT EXISTS ssms_paper_questions (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    paper_id      INT               NOT NULL,   -- FK → ssms_question_papers.id
    question_id   INT               NOT NULL,   -- FK → ssms_question_bank.id
    section_label VARCHAR(50)       NULL,       -- e.g. "Section A" / "खंड-क"
    order_index   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    marks         TINYINT UNSIGNED  NOT NULL DEFAULT 2,
    sub_questions JSON              NULL,       -- Inline sub-questions not in the bank

    UNIQUE KEY uq_paper_question (paper_id, question_id),
    INDEX idx_paper              (paper_id),
    INDEX idx_question           (question_id),

    CONSTRAINT fk_pq_paper    FOREIGN KEY (paper_id)    REFERENCES ssms_question_papers (id) ON DELETE CASCADE,
    CONSTRAINT fk_pq_question FOREIGN KEY (question_id) REFERENCES ssms_question_bank   (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ssms_question_papers
  ADD COLUMN branch_id  INT NULL AFTER ssms_client_code,
  ADD COLUMN session_id INT NULL AFTER branch_id,
  ADD INDEX idx_client_branch  (ssms_client_code, branch_id),
  ADD INDEX idx_client_session (ssms_client_code, session_id);
  
  
  ALTER TABLE ssms_question_bank
  ADD COLUMN branch_id  INT NOT NULL DEFAULT 0 AFTER ssms_client_code,
  ADD COLUMN session_id INT NOT NULL DEFAULT 0 AFTER branch_id,
  ADD INDEX idx_client_branch  (ssms_client_code, branch_id),
  ADD INDEX idx_client_session (ssms_client_code, session_id);

-- Then remove the DEFAULT 0 so new rows must supply values:
ALTER TABLE ssms_question_bank
  MODIFY COLUMN branch_id  INT NOT NULL,
  MODIFY COLUMN session_id INT NOT NULL;
  
  
-- Backfill any existing NULLs before tightening
UPDATE ssms_question_bank SET subject_id = 0 WHERE subject_id IS NULL;
UPDATE ssms_question_bank SET class_id   = 0 WHERE class_id   IS NULL;

-- Then tighten all four columns together
ALTER TABLE ssms_question_bank
  MODIFY COLUMN branch_id  INT NOT NULL,
  MODIFY COLUMN session_id INT NOT NULL,
  MODIFY COLUMN subject_id INT NOT NULL,
  MODIFY COLUMN class_id   INT NOT NULL;
-- ── 4. Image upload directory (create on the server) ─────────
-- Run this shell command on your server to create the upload directory:
--
--   mkdir -p /path/to/webroot/clients/YOUR_CLIENT_CODE/question_images
--   chmod 775 /path/to/webroot/clients/YOUR_CLIENT_CODE/question_images
--
-- The QuestionBankApiController creates subdirectories automatically
-- per client_code when the first image is uploaded.


-- ── 5. PHPWord (for Word export) ─────────────────────────────
-- Run this in your CakePHP project root to install PHPWord:
--
--   composer require phpoffice/phpword
--
-- The exportDocx endpoint will return a 500 with a helpful message
-- if PHPWord is not installed, so the rest of the app still works.


-- ── 6. Routes snippet ────────────────────────────────────────
-- Add the following inside the JWT-authenticated scope in config/routes.php:
--
-- // Question Bank
-- $builder->get('/QuestionBankApi/getQuestions',            ['controller'=>'QuestionBankApi','action'=>'getQuestions']);
-- $builder->post('/QuestionBankApi/createQuestion',          ['controller'=>'QuestionBankApi','action'=>'createQuestion']);
-- $builder->post('/QuestionBankApi/updateQuestion',          ['controller'=>'QuestionBankApi','action'=>'updateQuestion']);   -- id in POST body
-- $builder->post('/QuestionBankApi/deleteQuestion',          ['controller'=>'QuestionBankApi','action'=>'deleteQuestion']);   -- id in POST body
--
-- // Question Papers
-- $builder->get('/QuestionPaperApi/getPapers',                    ['controller'=>'QuestionPaperApi','action'=>'getPapers']);
-- $builder->post('/QuestionPaperApi/createPaper',                 ['controller'=>'QuestionPaperApi','action'=>'createPaper']);
-- $builder->post('/QuestionPaperApi/updatePaper/:id',             ['controller'=>'QuestionPaperApi','action'=>'updatePaper'])->setPass(['id']);
-- $builder->delete('/QuestionPaperApi/deletePaper/:id',           ['controller'=>'QuestionPaperApi','action'=>'deletePaper'])->setPass(['id']);
-- $builder->post('/QuestionPaperApi/deletePaper/:id',             ['controller'=>'QuestionPaperApi','action'=>'deletePaper'])->setPass(['id']);
-- $builder->get('/QuestionPaperApi/getPaper/:id',                 ['controller'=>'QuestionPaperApi','action'=>'getPaper'])->setPass(['id']);
-- $builder->post('/QuestionPaperApi/addQuestion/:id',             ['controller'=>'QuestionPaperApi','action'=>'addQuestion'])->setPass(['id']);
-- $builder->post('/QuestionPaperApi/updateQuestion/:id/:pqId',    ['controller'=>'QuestionPaperApi','action'=>'updatePaperQuestion'])->setPass(['id','pqId']);
-- $builder->delete('/QuestionPaperApi/removeQuestion/:id/:pqId',  ['controller'=>'QuestionPaperApi','action'=>'removeQuestion'])->setPass(['id','pqId']);
-- $builder->post('/QuestionPaperApi/removeQuestion/:id/:pqId',    ['controller'=>'QuestionPaperApi','action'=>'removeQuestion'])->setPass(['id','pqId']);
-- $builder->post('/QuestionPaperApi/publishPaper/:id',            ['controller'=>'QuestionPaperApi','action'=>'publishPaper'])->setPass(['id']);
-- $builder->get('/QuestionPaperApi/exportDocx/:id',               ['controller'=>'QuestionPaperApi','action'=>'exportDocx'])->setPass(['id']);
