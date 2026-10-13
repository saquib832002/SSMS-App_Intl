-- ============================================================================
-- School locale: currency, number / date / time formats, local labels.
-- Anything left empty falls back to the country preset (App\Service\Locale::PRESETS).
-- The currency symbol and time zone are also kept in ssms_clients (currency, timezone).
-- Safe to run more than once.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ssms_locale_settings (
  ssms_client_code  VARCHAR(50)  NOT NULL PRIMARY KEY,
  currency_code     CHAR(3)      NULL,               -- ISO 4217, e.g. INR, GBP, AED
  currency_symbol   VARCHAR(8)   NULL,               -- ₹, £, AED …
  currency_position VARCHAR(12)  NULL,               -- before | before_space | after_space
  number_format     VARCHAR(10)  NULL,               -- intl | indian | eu | space | swiss
  date_format       VARCHAR(12)  NULL,               -- DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD | DD-MM-YYYY | DD.MM.YYYY
  time_format       VARCHAR(4)   NULL,               -- 12h | 24h
  tax_label         VARCHAR(30)  NULL,               -- GST, VAT, Sales tax …
  postal_label      VARCHAR(30)  NULL,               -- PIN code, Postcode, ZIP code …
  week_start        TINYINT      NULL,               -- 1 Monday, 6 Saturday, 7 Sunday
  language          VARCHAR(8)   NULL,               -- en (more with translations)
  updated_by        VARCHAR(100) NULL,
  modified          DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
