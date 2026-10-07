-- ============================================================================
-- Subscription phase 2 – plans, Stripe subscriptions, webhook log
-- Run after 2026_10_subscription_phase1.sql. Does not touch existing tables.
-- ============================================================================

-- Plans offered to subscription (international) schools.
-- price_minor is for DISPLAY only (e.g. 2900 = 29.00). The real price lives
-- in Stripe – copy the Stripe Price ID (price_...) into stripe_price_id.
CREATE TABLE IF NOT EXISTS ssms_plans (
  plan_code         VARCHAR(30)  NOT NULL,
  name              VARCHAR(100) NOT NULL,
  description       VARCHAR(255) NULL,
  price_minor       INT          NULL,
  currency          CHAR(3)      NOT NULL DEFAULT 'USD',
  billing_interval  VARCHAR(10)  NOT NULL DEFAULT 'month',
  stripe_price_id   VARCHAR(100) NULL,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order        INT          NOT NULL DEFAULT 0,
  created           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_code),
  UNIQUE KEY uq_plan_stripe_price (stripe_price_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which paid modules each plan unlocks ('core' is always free).
CREATE TABLE IF NOT EXISTS ssms_plan_modules (
  plan_code   VARCHAR(30) NOT NULL,
  module_key  VARCHAR(50) NOT NULL,
  PRIMARY KEY (plan_code, module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One Stripe subscription per school (latest state from webhooks).
CREATE TABLE IF NOT EXISTS ssms_subscriptions (
  id                      INT          NOT NULL AUTO_INCREMENT,
  ssms_client_code        VARCHAR(20)  NOT NULL,
  plan_code               VARCHAR(30)  NULL,
  status                  VARCHAR(30)  NOT NULL,   -- trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired | paused
  stripe_customer_id      VARCHAR(100) NULL,
  stripe_subscription_id  VARCHAR(100) NULL,
  current_period_end      DATETIME     NULL,
  trial_end               DATETIME     NULL,
  cancel_at_period_end    TINYINT(1)   NOT NULL DEFAULT 0,
  canceled_at             DATETIME     NULL,
  created                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sub_client (ssms_client_code),
  UNIQUE KEY uq_sub_stripe (stripe_subscription_id),
  KEY idx_sub_customer (stripe_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every Stripe webhook event, so retries are processed only once.
CREATE TABLE IF NOT EXISTS ssms_billing_events (
  stripe_event_id   VARCHAR(255) NOT NULL,
  event_type        VARCHAR(100) NOT NULL,
  ssms_client_code  VARCHAR(20)  NULL,
  payload           MEDIUMTEXT   NULL,
  received_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at      DATETIME     NULL,
  error             TEXT         NULL,
  PRIMARY KEY (stripe_event_id),
  KEY idx_be_client (ssms_client_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Starter plans (edit names / prices; fill stripe_price_id from Stripe) ──
INSERT IGNORE INTO ssms_plans (plan_code, name, description, price_minor, currency, billing_interval, sort_order) VALUES
 ('BASIC', 'Basic', 'Attendance, notice board, fees and exams', NULL, 'USD', 'month', 1),
 ('PRO',   'Pro',   'Everything: Basic + timetable, homework, question bank, test series, hostel, transport, chat, gallery, certificates', NULL, 'USD', 'month', 2);

INSERT IGNORE INTO ssms_plan_modules (plan_code, module_key) VALUES
 ('BASIC','attendance'), ('BASIC','notices'), ('BASIC','fees'), ('BASIC','exams'),
 ('PRO','attendance'), ('PRO','notices'), ('PRO','fees'), ('PRO','exams'),
 ('PRO','academics'), ('PRO','assessments'), ('PRO','hostel'), ('PRO','transport'), ('PRO','communication');

-- After creating the products in Stripe (Dashboard → Product catalog), e.g.:
--   UPDATE ssms_plans SET price_minor = 2900, stripe_price_id = 'price_XXXX' WHERE plan_code = 'BASIC';
--   UPDATE ssms_plans SET price_minor = 5900, stripe_price_id = 'price_YYYY' WHERE plan_code = 'PRO';
