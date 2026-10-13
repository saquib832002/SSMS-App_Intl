/**
 * services/MeetingApi.js – parent–teacher meeting booking.
 * Staff: publish sessions, see bookings, mark meetings. Parents: book, see, cancel.
 */
import Constants from "expo-constants";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";

import { fmtDate, fmtTime } from "./Locale";
import { _t } from "./i18n";
const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");
const APP_VERSION = Constants.expoConfig?.version ?? "";

const headers = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-App-Version": APP_VERSION,
  Authorization: user?.token ? `Bearer ${user.token}` : "",
});

async function call(user, path, method = "GET", body = null) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
  let res;
  try {
    res = await safeFetch(`${BASE_URL}/MeetingApi/${path}`, {
      method,
      headers: headers(user),
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(_t("The server took too long to answer. Check your connection and try again."));
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = JSON.parse(text); } catch {
    const at = text.indexOf('{"status"');
    if (at > 0) { try { data = JSON.parse(text.slice(at)); } catch { data = null; } }
  }
  if (!data || typeof data !== "object") {
    const e = new Error(_t("The server sent an unexpected reply (HTTP {status}).", { status: res.status }));
    e.status = res.status;
    throw e;
  }
  if (!res.ok || data.status === false) {
    const e = new Error(data.message || _t("Something went wrong. Please try again."));
    e.code = data.code;
    e.status = res.status;
    throw e;
  }
  if (data.data === undefined || data.data === null) throw new Error(_t("The server sent an empty reply. Please try again."));
  return data.data;
}

const qs = (o) => Object.entries(o ?? {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

// staff
export const getSessions    = (user, f) => call(user, `sessions?${qs(f)}`);
export const getSession     = (user, id) => call(user, `session?id=${id}`);
export const getTeachers    = (user) => call(user, "teachers");
export const saveSession    = (user, s) => call(user, "saveSession", "POST", s);
export const cancelSession  = (user, id, reason) => call(user, "cancelSession", "POST", { id, reason });
export const setSlot        = (user, id, block) => call(user, "setSlot", "POST", { id, block: block ? 1 : 0 });
export const markBooking    = (user, id, patch) => call(user, "markBooking", "POST", { id, ...patch });
export const bookFor        = (user, slotId, enrollmentId, topic) => call(user, "bookFor", "POST", { slot_id: slotId, enrollment_id: enrollmentId, topic });
export const staffCancel    = (user, id, reason) => call(user, "staffCancel", "POST", { id, reason });
// parents
export const getAvailable   = (user, enrollmentId) => call(user, `available?${qs({ enrollmentId })}`);
export const bookSlot       = (user, slotId, enrollmentId, topic) => call(user, "book", "POST", { slot_id: slotId, enrollment_id: enrollmentId, topic });
export const getMyBookings  = (user) => call(user, "myBookings");
export const cancelMine     = (user, id, reason) => call(user, "cancel", "POST", { id, reason });

// ── formatting (times are the school's local time, sent as "YYYY-MM-DD HH:MM:SS") ──
const parts = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2})?:?(\d{2})?/);
  return m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 } : null;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3:30 PM" from "15:30" or a date-time */
export const niceTime = (s) => {
  const str = String(s || "");
  const m = str.match(/(\d{2}):(\d{2})(?::\d{2})?$/) || str.match(/^(\d{2}):(\d{2})/);
  if (!m) return str;
  return fmtTime(`${m[1]}:${m[2]}`);   // Region & formats (12 / 24 hour)
};
/** "Thu 5 Nov" (weekday computed in UTC so the device's time zone can't shift the day) */
export const niceDay = (s) => {
  const p = parts(s);
  if (!p) return String(s || "");
  return fmtDate(`${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, "weekdayDayMonth");
};
export const niceWhen = (s) => `${niceDay(s)}, ${niceTime(s)}`;

export const MODE_ICON = { in_person: "map-pin", video: "video", phone: "phone" };
export const BOOKING_STATUS = {
  booked:    { get label() { return _t("Booked"); }, bg: "#ede9fe", fg: "#5b21b6" },
  attended:  { get label() { return _t("Held"); }, bg: "#dcfce7", fg: "#166534" },
  no_show:   { get label() { return _t("Missed"); }, bg: "#fee2e2", fg: "#991b1b" },
  cancelled: { get label() { return _t("Cancelled"); }, bg: "#f1f5f9", fg: "#475569" },
};
