/**
 * services/AnalyticsApi.js – the school dashboard: attendance trends, at-risk students,
 * fee collection against what is due and the school's targets, class performance.
 * Every report takes the same filters: session_id, class_id, section_id, branch_id, from, to, exam_id.
 */
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";

import { fmtDate, fmtMoney } from "./Locale";
import { _t, _tx } from "./i18n";
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
    res = await safeFetch(`${BASE_URL}/AnalyticsApi/${path}`, {
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
const get = (user, path, f) => { const q = qs(f); return call(user, q ? `${path}?${q}` : path); };

export const getFilters     = (user, f) => get(user, "filters", f);
export const getOverview    = (user, f) => get(user, "overview", f);
export const getAttendance  = (user, f) => get(user, "attendance", f);
export const getAtRisk      = (user, f) => get(user, "atRisk", f);
export const getFees        = (user, f) => get(user, "fees", f);
export const getPerformance = (user, f) => get(user, "performance", f);
export const getSettings    = (user, f) => get(user, "settings", f);
export const saveSettings   = (user, body) => call(user, "saveSettings", "POST", body);

/** Downloads the at-risk list as a CSV and opens the share sheet. */
export async function shareAtRiskCsv(user, f) {
  const day = new Date().toISOString().slice(0, 10);
  const target = `${FileSystem.cacheDirectory}at-risk-students-${day}.csv`;
  let r;
  try {
    r = await FileSystem.downloadAsync(`${BASE_URL}/AnalyticsApi/exportAtRisk?${qs(f)}`, target, { headers: headers(user) });
  } catch {
    throw new Error(_t("Could not download the list. Check your connection and try again."));
  }
  if (r.status !== 200) {
    let msg = "Could not export the list.";
    try { msg = JSON.parse(await FileSystem.readAsStringAsync(r.uri)).message || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(r.uri, { mimeType: "text/csv", dialogTitle: "At-risk students", UTI: "public.comma-separated-values-text" });
  return r.uri;
}

// ── formatting helpers shared by the analytics screens ─────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(String(ym || "")); return m ? `${_tx(MONTHS[+m[2] - 1])}` : String(ym || ""); };
export const monthYear = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(String(ym || "")); return m ? `${_tx(MONTHS[+m[2] - 1])} ${m[1]}` : String(ym || ""); };
export const shortDate = (d) => fmtDate(d, "dayMonth") || String(d || "");   // Region & formats
export const fullDate = (d) => fmtDate(d, "medium") || String(d || "");
export const pct = (v) => (v === null || v === undefined || Number.isNaN(+v) ? "–" : `${(+v).toFixed(1).replace(/\.0$/, "")}%`);

/** Money in the school's currency and number style (Region & formats); no currency → number only (chart axes). */
export function money(v, currency, compact = false) {
  return fmtMoney(v, { compact, decimals: 0, symbol: !!currency });
}
