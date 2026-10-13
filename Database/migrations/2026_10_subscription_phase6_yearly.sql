-- ============================================================================
-- Phase 6 – plans are sold YEARLY (Google Play base plan "yearly")
-- The Play subscription IDs stay the same (ssms_basic, ssms_pro); only the
-- base plan changes from "monthly" to "yearly". Features are unchanged.
-- Safe to run more than once.
-- ============================================================================
UPDATE ssms_plans SET billing_interval = 'year' WHERE plan_code IN ('BASIC', 'PRO');
