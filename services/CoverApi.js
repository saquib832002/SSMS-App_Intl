/**
 * services/CoverApi.js – teacher cover & substitution.
 * Office: who is away today, their periods, free teachers best first, assign / "no cover", suggest for all, away, report, rules.
 * Teachers: my cover periods (accept / can't), my real day (own periods + covers) for class reminders.
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

async function call(user, path, method = "GET", body = null, timeoutMs = 30000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await safeFetch(`${BASE_URL}/CoverApi/${path}`, {
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

// ── Office ──────────────────────────────────────────────────────────────
export const getCoverDay = (user, date) => call(user, `day?${qs({ date })}`);
export const getSuggestions = (user, date, timetableId) => call(user, `suggest?${qs({ date, timetable_id: timetableId })}`);
export const assignCover = (user, { date, timetable_id, staff_id = null, note = "", force = false }) =>
  call(user, "assign", "POST", { date, timetable_id, staff_id, note, ...(force ? { force: 1 } : {}) });
export const unassignCover = (user, date, timetableId) => call(user, "unassign", "POST", { date, timetable_id: timetableId });
/** apply false = preview; apply true with plan = store exactly the previewed plan ([{timetable_id, staff_id}]). */
export const autoAssignCover = (user, date, apply, plan = null) =>
  call(user, "autoAssign", "POST", { date, apply: apply ? 1 : 0, ...(plan ? { plan: plan.map((p) => ({ timetable_id: p.timetable_id, staff_id: p.staff_id })) } : {}) }, 60000);
export const markAway = (user, d) => call(user, "markAway", "POST", d);
export const removeAway = (user, id) => call(user, "removeAway", "POST", { id });
export const getCoverReport = (user, month) => call(user, `report?${qs({ month })}`);
export const getCoverSettings = (user) => call(user, "settings");
export const saveCoverSettings = (user, d) => call(user, "saveSettings", "POST", d);

// ── Teachers ────────────────────────────────────────────────────────────
export const getMyCovers = (user) => call(user, "myCovers");
export const respondCover = (user, id, accept, note = "") => call(user, "respond", "POST", { id, accept: accept ? 1 : 0, note });
export const getMyDay = (user, date) => call(user, `myDay?${qs({ date })}`, "GET", null, 15000);

// ── Helpers ─────────────────────────────────────────────────────────────
export const addDays = (ymd, n) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
export const niceDay = (ymd) => fmtDate(ymd, "long");
export const periodLabel = (s) => `${s.period_name || _t("Period {n}", { n: s.period_number })}${s.start ? ` · ${fmtTime(s.start)}` : ""}`;

/** Why someone is away / not free, in words. */
export const reasonLabel = (type, label = "") => {
  const base = {
    leave: _t("On leave"), absent: _t("Absent"), away: _t("Away"), exam_duty: _t("Exam duty"),
    teaching: _t("Teaching"), covering: _t("Already covering"), declined: _t("Said they can't"),
  }[type] ?? type;
  return label ? `${base} (${label})` : base;
};

/** Short reasons why a teacher is suggested. */
export const fitLabels = (reasons = []) => reasons.map((r) => {
  switch (r.code) {
    case "same_subject": return r.subject ? _t("Teaches {subject}", { subject: r.subject }) : _t("Same subject");
    case "teaches_class": return _t("Teaches this class");
    case "class_teacher": return _t("Class teacher");
    case "same_branch": return _t("Same branch");
    case "no_timetable": return _t("No timetable");
    case "load": return _t("{today} cover today · {week} this week · {teaching} own periods", { today: r.today, week: r.week, teaching: r.teaching });
    default: return null;
  }
}).filter(Boolean);

/** Plain-text cover sheet to share (WhatsApp, e-mail, staff group). */
export function coverSheetText(day, school = "") {
  const lines = [`${_t("Cover for {date}", { date: niceDay(day.date) })}${school ? ` – ${school}` : ""}`];
  const all = [];
  for (const a of day.absent ?? []) for (const s of a.slots ?? []) all.push({ ...s, away: a.name });
  all.sort((x, y) => x.period_number - y.period_number || x.class_label.localeCompare(y.class_label));
  let p = null;
  for (const s of all) {
    if (s.period_number !== p) { lines.push(""); lines.push(periodLabel(s)); p = s.period_number; }
    const who = s.state === "open" || !s.cover || s.cover.status === "declined" ? _t("NOT COVERED")
      : s.cover.kind === "free" ? `${_t("No cover")}${s.cover.note ? ` (${s.cover.note})` : ""}` : s.cover.name;
    lines.push(`• ${s.class_label}${s.subject ? ` ${s.subject}` : ""}${s.room ? ` [${s.room}]` : ""}: ${who} — ${_t("for {teacher}", { teacher: s.away })}`);
  }
  if (!all.length) lines.push(_t("No periods need cover."));
  return lines.join("\n");
}
