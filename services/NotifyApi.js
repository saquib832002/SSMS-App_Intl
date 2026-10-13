/**
 * services/NotifyApi.js – automatic notifications: the bell (inbox), each person's choices,
 * this phone's push token, notice read receipts, and the school's settings (Setup › Notifications).
 */
import Constants from "expo-constants";
import { Platform } from "react-native";
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

async function call(user, path, method = "GET", body = null) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
  let res;
  try {
    res = await safeFetch(`${BASE_URL}/NotifyApi/${path}`, {
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
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

// ── the bell ─────────────────────────────────────────────────────────────────
// Shared unread count, so every header's bell shows the same number.
let _unread = 0;
const _listeners = new Set();
export function setNotifyUnread(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v === _unread) return;
  _unread = v;
  _listeners.forEach((fn) => fn(v));
}
export const getNotifyUnread = () => _unread;
export function onNotifyUnread(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

export async function refreshSummary(user) {
  try {
    const r = await call(user, "summary");
    setNotifyUnread(r.unread);
    return r.unread;
  } catch {
    return null;   // best effort (older server, offline)
  }
}
export const getInbox  = (user, before = 0, limit = 30) => call(user, `inbox?${qs({ before: before || undefined, limit })}`)
  .then((r) => { setNotifyUnread(r.unread); return r; });
export const markRead  = (user, ids) => call(user, "markRead", "POST", ids === "all" ? { all: true } : { ids })
  .then((r) => { setNotifyUnread(r.unread); return r; });

// ── my choices ───────────────────────────────────────────────────────────────
export const getPrefs  = (user) => call(user, "prefs");
export const savePref  = (user, event, channel, on) => call(user, "savePref", "POST", { event, channel, on: on ? 1 : 0 });

// ── this phone ───────────────────────────────────────────────────────────────
let _myToken = null;
export async function registerDevice(user, token) {
  if (!token) return;
  _myToken = token;
  try { await call(user, "registerDevice", "POST", { token, platform: Platform.OS }); } catch { /* best effort */ }
}
/** Signing out: this phone stops getting the person's notifications. */
export async function unregisterDevice(user, token = _myToken) {
  if (!token || !user?.token) return;
  try { await call(user, "unregisterDevice", "POST", { token }); } catch { /* best effort */ }
}

// ── notices ──────────────────────────────────────────────────────────────────
export async function noticesSeen(user, ids) {
  const list = (ids ?? []).map(Number).filter(Boolean);
  if (!list.length) return;
  try {
    const r = await call(user, "noticeRead", "POST", { notice_ids: list.slice(0, 100) });
    setNotifyUnread(r.unread);
  } catch { /* best effort */ }
}
export const noticeStats   = (user, ids) => call(user, `noticeStats?${qs({ ids: (ids ?? []).join(",") })}`).then((r) => r.stats ?? {});
export const noticeReaders = (user, id) => call(user, `noticeReaders?${qs({ notice_id: id })}`);
export const noticeRemind  = (user, id) => call(user, "noticeRemind", "POST", { notice_id: id });

// ── the school (Setup › Notifications) ──────────────────────────────────────
export const getSettings   = (user) => call(user, "settings");
export const saveSettings  = (user, events) => call(user, "saveSettings", "POST", { events });
export const getLog        = (user, f) => call(user, `log?${qs(f)}`);
export const retryFailed   = (user) => call(user, "retryFailed", "POST", {});

// ── SMS / WhatsApp (phase 2) ────────────────────────────────────────────────
export const getMessaging  = (user) => call(user, "messaging");
export const saveChannel   = (user, channel, d) => call(user, "saveChannel", "POST", { channel, ...d });
export const testChannel   = (user, channel) => call(user, "testChannel", "POST", { channel });
export const testSend      = (user, channel, to) => call(user, "testSend", "POST", { channel, to });
export const getTemplates  = (user) => call(user, "templates");
export const saveTemplate  = (user, t) => call(user, "saveTemplate", "POST", t);
export const setOptOut     = (user, channel, phone, on) => call(user, "optOut", "POST", { channel, phone, on: on ? 1 : 0 });

/** Where a notification opens. Returns [route, params] or null. Parents / students use the portal screens. */
export function targetOf(data, isStudentOrParent) {
  const screen = data?.screen;
  if (!screen) return null;
  const portal = { MyAttendance: 1, MyFee: 1, MyReportCards: 1, MyAbsences: 1, MyHomework: 1, MyMeetings: 1, MyAdmitCard: 1 };
  if (portal[screen] && !isStudentOrParent) return null;
  // homework lives inside the "My Portal" tab: reach it through the tabs (works from any screen)
  if (screen === "MyHomework") return ["MainTabs", { screen: "My Portal", params: { screen: "MyHomework" } }];
  // messages to the office (SMS / WhatsApp limit) open Setup › Notifications
  if (screen === "NotificationSettings") return isStudentOrParent ? null : ["MainTabs", { screen: "Setup", params: { screen: "NotificationSettings" } }];
  // teacher cover: the office's cover sheet for that day / the teacher's own cover periods
  if (screen === "Cover" || screen === "MyCovers") return isStudentOrParent ? null : [screen, data?.date ? { date: String(data.date) } : undefined];
  // live bus tracking: where is my child's bus (parents / students)
  if (screen === "LiveBus") return isStudentOrParent ? [screen, data?.enrollment_id ? { enrollment_id: String(data.enrollment_id) } : undefined] : null;
  // visitors & pick-up: reception / gate (staff), my visitors (staff), who may collect my child (parents)
  if (screen === "VisitorDesk" || screen === "MyVisitors") return isStudentOrParent ? null : [screen];
  if (screen === "PickupDesk") return isStudentOrParent ? null : [screen, data?.enrollment_id ? { enrollment_id: String(data.enrollment_id) } : undefined];
  if (screen === "MyPickup") return isStudentOrParent ? [screen, data?.enrollment_id ? { enrollment_id: String(data.enrollment_id) } : undefined] : null;
  const ok = { NoticeBoard: 1, Inbox: 1, MyExamDuties: 1, ...(isStudentOrParent ? portal : { Meetings: 1 }) };
  return ok[screen] ? [screen, data?.notice_id ? { noticeId: Number(data.notice_id) } : undefined] : null;
}
