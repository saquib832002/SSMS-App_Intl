/**
 * services/CalendarApi.js – calendar sync links (Google Calendar, Outlook, Apple Calendar).
 * Each person gets a private link with their school events, holidays, exams, meetings … that calendar apps keep up to date;
 * the office can also switch on a public link with the school's events and holidays (for the website).
 */
import Constants from "expo-constants";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";
import { _t } from "./i18n";

const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");
const APP_VERSION = Constants.expoConfig?.version ?? "";

const headers = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-App-Version": APP_VERSION,
  Authorization: user?.token ? `Bearer ${user.token}` : "",
});

async function call(user, path, method = "GET", body = null, timeoutMs = 30000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await safeFetch(`${BASE_URL}/CalendarApi/${path}`, {
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
    e.status = res.status;
    throw e;
  }
  if (data.data === undefined || data.data === null) throw new Error(_t("The server sent an empty reply. Please try again."));
  return data.data;
}

const qs = (o) => Object.entries(o ?? {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

export const getMyCalendar = (user) => call(user, "myFeed");
export const saveMyCalendar = (user, include) => call(user, "saveFeed", "POST", { include });
export const resetMyCalendar = (user) => call(user, "resetFeed", "POST", {});
export const removeMyCalendar = (user) => call(user, "removeFeed", "POST", {});
export const previewCalendar = (user, include) => call(user, `preview?${qs({ include: (include ?? []).join(",") })}`);
export const getSchoolCalendar = (user) => call(user, "schoolFeed");
export const setSchoolCalendar = (user, op) => call(user, "setSchoolFeed", "POST", { op });

/** Labels for the parts (the server sends English; these are translated). */
export const partLabel = (key) => ({
  events: _t("School events"), holidays: _t("Holidays"), exams: _t("Exam timetable"), meetings: _t("Parent–teacher meetings"),
  homework: _t("Homework due dates"), duties: _t("My exam duties"), cover: _t("My cover periods"), leave: _t("My leave"),
}[key] ?? key);

export const partHint = (key, portal) => ({
  events: portal ? _t("Sports day, trips, functions …") : _t("Including staff-only events"),
  holidays: _t("Days the school is closed"),
  exams: portal ? _t("Each subject's exam with time and room") : _t("Exams of the classes you teach (all classes for the office)"),
  meetings: portal ? _t("Meetings you booked with teachers") : _t("Your parent–teacher meeting times"),
  homework: _t("Can be a lot – off unless you want it"),
  duties: _t("Invigilation with hall and time"),
  cover: _t("Classes you cover for colleagues"),
  leave: _t("Your approved leave"),
}[key] ?? "");


// ── Dashboard "Upcoming" card ─────────────────────────────────────────────
/** Events, holidays, exams, meetings (+ staff: exam duties, cover, leave), soonest first. child = the parent's picked child. */
export const getUpcoming = (user, { limit = 20, days = 90, child } = {}) =>
  call(user, `upcoming?${qs({ limit, days, child })}`).then((d) => d.items ?? []);

/** Old servers: school events only, in the same shape. */
export const eventsAsUpcoming = (rows = []) => rows.map((ev) => ({
  kind: ev.event_type === "holiday" ? "holiday" : "event", title: ev.event_title, date: String(ev.event_date ?? "").slice(0, 10),
  end_date: String(ev.event_end_date || ev.event_date || "").slice(0, 10), start: null, end: null, where: "", cat: ev.event_category ?? "", event: ev,
}));

/** Look of each kind on the dashboard. */
export const UPCOMING_STYLE = {
  event:   { icon: "flag",      color: "#1355c1", bg: "#eff6ff", get label() { return _t("Event"); } },
  holiday: { icon: "sun",       color: "#b45309", bg: "#fef9c3", get label() { return _t("Holiday"); } },
  exam:    { icon: "edit-3",    color: "#7c3aed", bg: "#ede9fe", get label() { return _t("Exam"); } },
  meeting: { icon: "users",     color: "#0f766e", bg: "#ccfbf1", get label() { return _t("Meeting"); } },
  duty:    { icon: "clipboard", color: "#be185d", bg: "#fce7f3", get label() { return _t("Exam duty"); } },
  cover:   { icon: "repeat",    color: "#c2410c", bg: "#ffedd5", get label() { return _t("Cover"); } },
  leave:   { icon: "coffee",    color: "#475569", bg: "#f1f5f9", get label() { return _t("Leave"); } },
};

/** The title as shown on the dashboard (a school event shows its own title; the badge says "Holiday"). */
export const upcomingTitle = (it) => (it.event?.event_title ?? it.title ?? "");

/** Where a tap on an item goes → [screen, params] (null = nowhere). */
export function upcomingTarget(it, portal) {
  switch (it.kind) {
    case "exam":    return portal ? ["My Portal", { screen: "MyDatesheet" }] : ["School", { screen: "ExamDatesheet" }];
    case "meeting": return portal ? ["MyMeetings"] : ["Meetings"];
    case "duty":    return ["MyExamDuties"];
    case "cover":   return ["MyCovers"];
    case "leave":   return ["School", { screen: "StaffLeave" }];
    default:        return null;
  }
}
