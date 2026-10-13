-- ============================================================================
-- Phase 7 – Online fee payments (parents pay school fees online)
--   Each school connects ITS OWN account – money goes straight to the school:
--     • Stripe Connect (international schools)  – one-click onboarding
--     • Razorpay (Indian schools)               – school pastes its API keys
--   ssms_payment_settings : one row per school (provider, status, keys)
--   ssms_online_payments  : every online payment attempt (pay link) + result
-- Paid online payments are written to ssms_fee_paid_details exactly like a
-- counter payment (admin_review = 'Pending', payment_method 'Online - …') so the
-- owner approves them in Collection Approval as usual.
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssms_payment_settings (
  ssms_client_code         VARCHAR(20)  NOT NULL,
  provider                 VARCHAR(20)  NULL COMMENT 'stripe | razorpay',
  online_enabled           TINYINT(1)   NOT NULL DEFAULT 0,
  stripe_account_id        VARCHAR(64)  NULL,
  stripe_charges_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  stripe_details_submitted TINYINT(1)   NOT NULL DEFAULT 0,
  razorpay_key_id          VARCHAR(64)  NULL,
  razorpay_key_secret      TEXT         NULL COMMENT 'encrypted',
  razorpay_webhook_secret  TEXT         NULL COMMENT 'encrypted (optional)',
  updated_by               VARCHAR(100) NULL,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ssms_client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_online_payments (
  id                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  pay_token           CHAR(40)      NOT NULL,
  ssms_client_code    VARCHAR(20)   NOT NULL,
  enrollment_id       VARCHAR(50)   NOT NULL,
  registration_id     VARCHAR(50)   NULL,
  student_name        VARCHAR(150)  NULL,
  provider            VARCHAR(20)   NOT NULL,
  provider_ref        VARCHAR(100)  NULL COMMENT 'Stripe checkout session id / Razorpay order id',
  provider_payment_id VARCHAR(100)  NULL,
  amount              DECIMAL(12,2) NOT NULL,
  currency            CHAR(3)       NOT NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'pending' COMMENT 'pending | paid | failed | cancelled',
  items_json          MEDIUMTEXT    NOT NULL COMMENT 'fee items snapshot at link creation',
  receipt_number      VARCHAR(40)   NULL,
  payer_user          VARCHAR(100)  NULL,
  payer_role          VARCHAR(30)   NULL,
  error               VARCHAR(500)  NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at          DATETIME      NULL,
  paid_at             DATETIME      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_online_pay_token (pay_token),
  KEY idx_online_pay_client (ssms_client_code, status),
  KEY idx_online_pay_ref (provider_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
