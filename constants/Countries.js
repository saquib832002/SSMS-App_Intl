/**
 * constants/Countries.js

 * Country list for school sign-up. The chosen country decides billing:
 *   IN  → 'legacy' (current Indian flow)
 *   any other code → 'subscription' (14-day trial, then monthly plan)
 * The server makes the final decision (UserServiceApiController::registerTrialUser).
 * Add more countries here as needed: { code (ISO-3166 alpha-2), name, currency, dial }.
 */
export const COUNTRIES = [
  { code: "IN", name: "India", currency: "INR", dial: "+91" },
  { code: "US", name: "United States", currency: "USD", dial: "+1" },
  { code: "GB", name: "United Kingdom", currency: "GBP", dial: "+44" },
  { code: "CA", name: "Canada", currency: "CAD", dial: "+1" },
  { code: "AU", name: "Australia", currency: "AUD", dial: "+61" },
  { code: "NZ", name: "New Zealand", currency: "NZD", dial: "+64" },
  { code: "IE", name: "Ireland", currency: "EUR", dial: "+353" },
  { code: "AE", name: "United Arab Emirates", currency: "AED", dial: "+971" },
  { code: "SA", name: "Saudi Arabia", currency: "SAR", dial: "+966" },
  { code: "QA", name: "Qatar", currency: "QAR", dial: "+974" },
  { code: "KW", name: "Kuwait", currency: "KWD", dial: "+965" },
  { code: "OM", name: "Oman", currency: "OMR", dial: "+968" },
  { code: "BH", name: "Bahrain", currency: "BHD", dial: "+973" },
  { code: "SG", name: "Singapore", currency: "SGD", dial: "+65" },
  { code: "MY", name: "Malaysia", currency: "MYR", dial: "+60" },
  { code: "ID", name: "Indonesia", currency: "IDR", dial: "+62" },
  { code: "PH", name: "Philippines", currency: "PHP", dial: "+63" },
  { code: "TH", name: "Thailand", currency: "THB", dial: "+66" },
  { code: "VN", name: "Vietnam", currency: "VND", dial: "+84" },
  { code: "BD", name: "Bangladesh", currency: "BDT", dial: "+880" },
  { code: "NP", name: "Nepal", currency: "NPR", dial: "+977" },
  { code: "LK", name: "Sri Lanka", currency: "LKR", dial: "+94" },
  { code: "PK", name: "Pakistan", currency: "PKR", dial: "+92" },
  { code: "AF", name: "Afghanistan", currency: "AFN", dial: "+93" },
  { code: "MV", name: "Maldives", currency: "MVR", dial: "+960" },
  { code: "NG", name: "Nigeria", currency: "NGN", dial: "+234" },
  { code: "KE", name: "Kenya", currency: "KES", dial: "+254" },
  { code: "GH", name: "Ghana", currency: "GHS", dial: "+233" },
  { code: "ZA", name: "South Africa", currency: "ZAR", dial: "+27" },
  { code: "UG", name: "Uganda", currency: "UGX", dial: "+256" },
  { code: "TZ", name: "Tanzania", currency: "TZS", dial: "+255" },
  { code: "EG", name: "Egypt", currency: "EGP", dial: "+20" },
  { code: "DE", name: "Germany", currency: "EUR", dial: "+49" },
  { code: "FR", name: "France", currency: "EUR", dial: "+33" },
  { code: "NL", name: "Netherlands", currency: "EUR", dial: "+31" },
  { code: "ES", name: "Spain", currency: "EUR", dial: "+34" },
  { code: "IT", name: "Italy", currency: "EUR", dial: "+39" },
  { code: "TR", name: "Turkey", currency: "TRY", dial: "+90" },
  { code: "JP", name: "Japan", currency: "JPY", dial: "+81" },
  { code: "ZZ", name: "Other country", currency: "USD", dial: "" },
];

export const findCountry = (code) => COUNTRIES.find(c => c.code === code) ?? null;

/** Best guess from the device time zone: India → "IN", otherwise "" (user must pick). */
export function guessCountryCode() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "IN";
  } catch {}
  return "";
}

/** Device IANA time zone (e.g. "Europe/London"), or "" if unavailable. */
export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}
