/**
 * services/Locale.js – the school's Region & formats (Setup › Region & formats).
 *
 * One place that formats money, numbers, dates and times the way the school wants, for screens and PDFs:
 *   fmtMoney(1234.5)        ₹ 1,234.50 · £1,234.50 · 1.234,50 €
 *   fmtNumber(1234567)      12,34,567 (India) · 1,234,567 · 1.234.567
 *   fmtDate("2026-10-22")   22/10/2026 · 10/22/2026 · 2026-10-22      (style "short")
 *   fmtDate(d, "medium")    22 Oct 2026 · Oct 22, 2026               ("long" adds the weekday, "dayMonth" drops the year)
 *   fmtTime("15:05")        3:05 PM · 15:05
 *   schoolToday()           the school's own date (its time zone), not the phone's
 * Loaded after sign-in (loadLocale) and kept on the phone, so it also works offline.
 * Until it loads, India's formats are used (what the app always did).
 */
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";
import { _t, setLanguage } from "./i18n";

const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const DEFAULT_LOCALE = {
  country: "IN", currency_code: "INR", currency_symbol: "₹", currency_position: "before_space", number_format: "indian",
  date_format: "DD/MM/YYYY", time_format: "12h", tax_label: "GST", postal_label: "PIN code", timezone: "Asia/Kolkata",
  week_start: 1, language: "en", decimals: 2, group_separator: ",", decimal_separator: ".",
};

let current = { ...DEFAULT_LOCALE };
let offsetMin = null;          // school's UTC offset in minutes (from the server)
const listeners = new Set();

export const getLocale = () => current;

// ── language: the person's own choice (My language), else the school's (Region & formats) ──
let userLanguage = "";
const PICK_KEY = "ssms_language_pick";          // chosen on the sign-in screen, saved to the account after sign-in
export const getUserLanguage = () => userLanguage;
export const schoolLanguage = () => current.language || "en";
const applyLanguage = () => setLanguage(userLanguage || current.language || "en");

/** This person's own language ('' = follow the school). */
export function setUserLanguage(code) {
  userLanguage = code || "";
  applyLanguage();
}

/** Language picked on the sign-in screen: used straight away, and kept for the account once signed in. */
export function pickLanguageBeforeSignIn(code) {
  setLanguage(code);
  AsyncStorage.setItem(PICK_KEY, code).catch(() => {});
}

/** Save this person's own language on the server ('' = follow the school). Returns { user_language, language }. */
export async function saveMyLanguage(user, code) {
  const res = await safeFetch(`${BASE_URL}/LocaleApi/myLanguage`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-App-Version": Constants.expoConfig?.version ?? "", Authorization: `Bearer ${user?.token ?? ""}` },
    body: JSON.stringify({ language: code || "" }),
  });
  const data = await res.json().catch(() => null);
  if (!data || !res.ok || data.status === false) throw new Error(data?.message || _t("Something went wrong (HTTP {status}).", { status: res.status }));
  try { await AsyncStorage.setItem(key(user), JSON.stringify({ locale: current, utc_offset: offsetMin, user_language: data.data.user_language || "" })); } catch { /* ignore */ }
  return data.data;
}

export function setLocale(l, utcOffsetMin = null) {
  if (!l || typeof l !== "object") return;
  current = { ...DEFAULT_LOCALE, ...l };
  applyLanguage();
  if (utcOffsetMin !== null && utcOffsetMin !== undefined && !Number.isNaN(+utcOffsetMin)) offsetMin = +utcOffsetMin;
  listeners.forEach((fn) => { try { fn(current); } catch { /* ignore */ } });
}

/** Run fn with other settings for a moment (no re-render elsewhere) – the settings screen's preview. */
export function withLocale(l, fn) {
  const saved = current;
  current = { ...DEFAULT_LOCALE, ...l };
  try { return fn(); } finally { current = saved; }
}

const key = (user) => `ssms_locale_${String(user?.ssmsClientCode ?? "").toUpperCase()}_${String(user?.ssmsUserName ?? "").toLowerCase()}`;

/** Fetch the school's settings (after sign-in); falls back to the copy saved on the phone. */
export async function loadLocale(user) {
  if (!user?.token) return current;
  try {
    const cached = await AsyncStorage.getItem(key(user));
    if (cached) { const c = JSON.parse(cached); userLanguage = c.user_language || ""; setLocale(c.locale, c.utc_offset); }
  } catch { /* ignore */ }
  try {
    const res = await safeFetch(`${BASE_URL}/LocaleApi/current`, {
      method: "GET",
      headers: { Accept: "application/json", "X-App-Version": Constants.expoConfig?.version ?? "", Authorization: `Bearer ${user.token}` },
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.status !== false && data?.data?.locale) {
      let own = data.data.user_language || "";
      // a language picked on the sign-in screen becomes this person's own (unless it is the school's anyway)
      try {
        const pick = await AsyncStorage.getItem(PICK_KEY);
        if (pick) {
          await AsyncStorage.removeItem(PICK_KEY);
          if (!own && pick !== (data.data.locale.language || "en")) {
            try { own = (await saveMyLanguage(user, pick)).user_language || ""; } catch { /* keep the school's */ }
          }
        }
      } catch { /* ignore */ }
      userLanguage = own;
      setLocale(data.data.locale, data.data.utc_offset);
      try { await AsyncStorage.setItem(key(user), JSON.stringify({ locale: data.data.locale, utc_offset: data.data.utc_offset, user_language: own })); } catch { /* ignore */ }
    }
  } catch { /* offline – keep what we have */ }
  return current;
}

/** Re-renders the component when the school's formats change. */
export function useLocale() {
  const [l, setL] = useState(current);
  useEffect(() => {
    const fn = (x) => setL(x);
    listeners.add(fn);
    if (l !== current) setL(current);
    return () => { listeners.delete(fn); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

// ── numbers & money ─────────────────────────────────────────────────────────

const toNum = (v) => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

export function fmtNumber(v, decimals = null) {
  const d = decimals === null || decimals === undefined ? current.decimals : decimals;
  const n = toNum(v);
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(d);
  let [int, frac] = fixed.split(".");
  const g = current.group_separator ?? ",";
  if (current.number_format === "indian" && int.length > 3) {
    const last = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, g);
    int = `${rest}${g}${last}`;
  } else {
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, g);
  }
  return `${neg ? "-" : ""}${int}${d > 0 ? (current.decimal_separator ?? ".") + frac : ""}`;
}

export const currencySymbol = () => current.currency_symbol || current.currency_code || "";

function withSymbol(num, neg) {
  const s = currencySymbol();
  const out = current.currency_position === "before" ? `${s}${num}` : current.currency_position === "after_space" ? `${num} ${s}` : `${s} ${num}`;
  return `${neg ? "-" : ""}${out}`;
}

/**
 * Money in the school's currency. opts: decimals (default: the currency's), compact (12.3K / 4.5L / 1.2M),
 * symbol (false = number only).
 */
export function fmtMoney(v, opts = {}) {
  const n = toNum(v);
  const neg = n < 0;
  const a = Math.abs(n);
  let num;
  if (opts.compact && a >= 1000) {
    const india = current.number_format === "indian";
    const one = (x, unit) => `${x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, "")}`.replace(".", current.decimal_separator ?? ".") + unit;
    if (india && a >= 1e7) num = one(a / 1e7, "Cr");
    else if (india && a >= 1e5) num = one(a / 1e5, "L");
    else if (!india && a >= 1e9) num = one(a / 1e9, "B");
    else if (!india && a >= 1e6) num = one(a / 1e6, "M");
    else num = one(a / 1e3, "K");
  } else {
    num = fmtNumber(a, opts.decimals ?? null);
  }
  return opts.symbol === false ? `${neg ? "-" : ""}${num}` : withSymbol(num, neg);
}

// ── dates & times ───────────────────────────────────────────────────────────

/** "2026-10-22", "2026-10-22 08:30:00", a Date or a timestamp → {y, m, d, hh, mm} (no time-zone shift for plain dates). */
function parts(input) {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return { y: input.getFullYear(), m: input.getMonth() + 1, d: input.getDate(), hh: input.getHours(), mm: input.getMinutes() };
  }
  if (typeof input === "number") return parts(new Date(input));
  const s = String(input);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s.slice(10))) {
    return { y: +m[1], m: +m[2], d: +m[3], hh: m[4] !== undefined ? +m[4] : null, mm: m[5] !== undefined ? +m[5] : null };
  }
  return parts(new Date(s));
}

const pad = (n) => String(n).padStart(2, "0");
const weekday = (p) => _t(DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]);
const mon = (p) => _t(MONTHS[p.m - 1]);
const monLong = (p) => _t(MONTHS_LONG[p.m - 1]);

/** style: short (numeric), medium (22 Oct 2026), long (Thu 22 Oct 2026), full (22 October 2026), dayMonth (22 Oct), monthYear (Oct 2026), weekday (Thursday) */
export function fmtDate(input, style = "short") {
  const p = parts(input);
  if (!p) return "";
  const f = current.date_format || "DD/MM/YYYY";
  const mdy = f.startsWith("MM");
  const ymd = f.startsWith("YYYY");
  switch (style) {
    case "medium":
      return mdy ? `${mon(p)} ${p.d}, ${p.y}` : ymd ? `${p.y} ${mon(p)} ${p.d}` : `${p.d} ${mon(p)} ${p.y}`;
    case "long":
      return `${weekday(p)} ${fmtDate(input, "medium")}`;
    case "full":
      return mdy ? `${monLong(p)} ${p.d}, ${p.y}` : ymd ? `${p.y} ${monLong(p)} ${p.d}` : `${p.d} ${monLong(p)} ${p.y}`;
    case "dayMonth":
      return mdy ? `${mon(p)} ${p.d}` : `${p.d} ${mon(p)}`;
    case "weekdayDayMonth":
      return `${weekday(p)} ${fmtDate(input, "dayMonth")}`;
    case "monthYear":
      return `${mon(p)} ${p.y}`;
    case "weekday":
      return _t(DAYS_LONG[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]);
    case "monthYearLong":
      return `${monLong(p)} ${p.y}`;
    default:
      return f.replace("DD", pad(p.d)).replace("MM", pad(p.m)).replace("YYYY", String(p.y));
  }
}

/** "15:05", "15:05:00", a Date or a date-time → 3:05 PM / 15:05 */
export function fmtTime(input) {
  let hh;
  let mm;
  if (typeof input === "string" && /^\d{1,2}:\d{2}/.test(input)) {
    [hh, mm] = input.split(":").map((x) => parseInt(x, 10));
  } else {
    const p = parts(input);
    if (!p || p.hh === null) return "";
    hh = p.hh; mm = p.mm;
  }
  if (Number.isNaN(hh) || Number.isNaN(mm)) return "";
  if (current.time_format === "24h") return `${pad(hh)}:${pad(mm)}`;
  return `${((hh + 11) % 12) + 1}:${pad(mm)} ${_t(hh < 12 ? "AM" : "PM")}`;
}

/** Date + time: "22 Oct 2026, 3:05 PM" (medium) */
export function fmtDateTime(input, style = "medium") {
  const d = fmtDate(input, style);
  const t = fmtTime(input);
  return t ? `${d}, ${t}` : d;
}

/** The school's date today (YYYY-MM-DD), from its time zone – the phone may be set to another one. */
export function schoolToday() {
  const now = Date.now();
  if (offsetMin === null) {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const d = new Date(now + offsetMin * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const taxLabel = () => current.tax_label || "Tax";
export const postalLabel = () => current.postal_label || "Postal code";
