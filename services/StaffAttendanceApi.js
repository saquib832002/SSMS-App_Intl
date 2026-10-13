/**
 * services/StaffAttendanceApi.js – staff check-in / out, daily marking, monthly report
 */
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";

import { fmtDate } from "./Locale";
import { _t } from "./i18n";
const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");

const buildHeaders = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

async function call(user, path, method = "GET", body = null) {
  const res = await safeFetch(`${BASE_URL}/StaffAttendanceApi/${path}`, {
    method,
    headers: buildHeaders(user),
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(data.message || _t("Something went wrong. Please try again."));
  return data.data;
}

// Staff self
export const getMyToday   = (user) => call(user, "myToday");                     // { linked, is_admin, today, record, settings }
export const checkIn      = async (user, code) => (await call(user, "checkIn", "POST", code ? { code } : {})).record;
export const checkOut     = async (user) => (await call(user, "checkOut", "POST")).record;
export const getMyMonth   = (user, month) => call(user, `myMonth?month=${month}`);   // { summary, working_days, off_days }

// Admin
export const getOfficeCode = (user) => call(user, "officeCode");                  // { code, expires_in }
export const getSettings   = (user) => call(user, "settings");
export const saveSettings  = (user, s) => call(user, "saveSettings", "POST", s);
export const setSchoolLocation = (user, lat, lng) => call(user, "setLocation", "POST", { lat, lng });   // { settings }
export const getDay        = (user, date) => call(user, `day?date=${date}`);     // { date, school_day, off_reason, staff[] }
export const markDay       = async (user, date, marks) => (await call(user, "mark", "POST", { date, marks })).saved;
export const getMonth      = (user, month) => call(user, `month?month=${month}`);

export const STATUS = {
  P:  { get label() { return _t("Present"); },  short: "P",  bg: "#dcfce7", fg: "#15803d" },
  A:  { get label() { return _t("Absent"); },   short: "A",  bg: "#fee2e2", fg: "#b91c1c" },
  HD: { get label() { return _t("Half day"); }, short: "½",  bg: "#fef3c7", fg: "#92400e" },
  L:  { get label() { return _t("Leave"); },    short: "L",  bg: "#e0e7ff", fg: "#3730a3" },
  H:  { get label() { return _t("Holiday"); },  short: "H",  bg: "#f1f5f9", fg: "#475569" },
};

export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const addMonths = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const monthName = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return fmtDate(`${y}-${String(m).padStart(2, "0")}-01`, "monthYearLong");
};
/** 18.5 → "18½", 18 → "18" */
export const days = (n) => {
  const x = Number(n) || 0;
  const whole = Math.floor(x);
  return x - whole >= 0.5 ? `${whole || ""}½` : String(whole);
};
