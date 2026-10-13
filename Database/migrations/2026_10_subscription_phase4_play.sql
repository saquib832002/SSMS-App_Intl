-- ============================================================================
-- Subscription phase 4 – Google Play in-app subscriptions (via RevenueCat)
-- Run after phases 1–3. Safe to run once; does not touch existing data.
-- ============================================================================

-- Google Play subscription ID for each plan (Play Console → Monetize →
-- Subscriptions → "Product ID"). Create subscriptions with exactly these IDs,
-- or change them here to match yours.
ALTER TABLE ssms_plans
  ADD COLUMN play_product_id VARCHAR(150) NULL,
  ADD UNIQUE KEY uq_plan_play_product (play_product_id);

UPDATE ssms_plans SET play_product_id = 'ssms_basic' WHERE plan_code = 'BASIC' AND play_product_id IS NULL;
UPDATE ssms_plans SET play_product_id = 'ssms_pro'   WHERE plan_code = 'PRO'   AND play_product_id IS NULL;

-- Which store the school's subscription comes from (one row per school).
ALTER TABLE ssms_subscriptions
  ADD COLUMN provider         VARCHAR(20)  NOT NULL DEFAULT 'stripe',   -- stripe | google_play
  ADD COLUMN store_product_id VARCHAR(150) NULL;
