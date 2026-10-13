/**
 * services/StudentLeaveApi.js – parent absence notes, student leave, late arrival & early pickup
 */
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";

import { fmtDate, fmtTime } from "./Locale";
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
  const res = await safeFetch(`${BASE_URL}/StudentLeaveApi/${path}`, {
    method,
    headers: buildHeaders(user),
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(data.message || _t("Something went wrong. Please try again."));
  return data;
}

const qs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export const TYPE_LABEL = {
  absence: "Absence", leave: "Leave", late_arrival: "Late arrival", early_pickup: "Early pickup",
};
export const STATUS_STYLE = {
  pending:   { bg: "#fef3c7", fg: "#92400e", get label() { return _t("Pending"); } },
  teacher_approved: { bg: "#e0e7ff", fg: "#3730a3", get label() { return _t("Waiting for principal"); } },
  approved:  { bg: "#dcfce7", fg: "#15803d", get label() { return _t("Approved"); } },
  rejected:  { bg: "#fee2e2", fg: "#b91c1c", get label() { return _t("Not approved"); } },
  cancelled: { bg: "#f1f5f9", fg: "#64748b", get label() { return _t("Cancelled"); } },
};

// Parents / students
export const getMyChildren  = async (user) => call(user, "myChildren");                // { data, reasons }
export const getMyRequests  = async (user) => (await call(user, "myRequests")).data;   // { requests, arrivals }
export const submitRequest  = async (user, req) => (await call(user, "submit", "POST", req)).data.request;
export const cancelRequest  = async (user, id, note) => (await call(user, "cancel", "POST", { id, ...(note ? { note } : {}) })).data.request;
export const updateRequest  = async (user, id, req) => (await call(user, "update", "POST", { ...req, id })).data.request;

// Staff
export const getRequests    = async (user, { status, classId, sectionId, date } = {}) =>
  (await call(user, `requests?${qs({ status, classId, sectionId, date })}`)).data;
export const reviewRequest  = async (user, id, decision, note) =>
  (await call(user, "review", "POST", { id, decision, note })).data.request;
export const getDayStatus   = async (user, classId, sectionId, date) =>
  (await call(user, `dayStatus?${qs({ classId, sectionId, date })}`)).data ?? {};
export const recordArrival  = async (user, rec) => (await call(user, "recordArrival", "POST", rec)).data.arrival;
export const getArrivals    = async (user, date, classId) => (await call(user, `arrivals?${qs({ date, classId })}`)).data;
export const getPendingCount = async (user) => (await call(user, "pendingCount")).data?.pending ?? 0;
export const getLeaveSettings  = async (user) => (await call(user, "settings")).data;   // { principal_days, can_edit, is_final_approver }
export const saveLeaveSettings = async (user, principalDays) =>
  (await call(user, "saveSettings", "POST", { principal_days: principalDays })).data.principal_days;
export const countSchoolDays = async (user, enrollmentId, from, to) =>
  (await call(user, `countDays?${qs({ enrollmentId, from, to })}`)).data;   // { school_days, calendar_days, skipped[], needs_principal }
export const searchStudents = async (user, q) => (await call(user, `searchStudents?${qs({ q })}`)).data;

export const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
export const niceDate = (s) => {
  if (!s) return "";
  return fmtDate(s, "weekdayDayMonth") || s;
};
export const niceTime = (t) => {
  if (!t) return "";
  return fmtTime(t);
};
/** "3 school days" – weekly off days and holidays are not counted. */
export const schoolDaysText = (r) => {
  const n = r.school_days ?? r.days;
  return n > 1 || (r.days > 1) ? ` · ${_t("{n} school days", { n })}` : "";
};
export const when = (r) => (r.from_date === r.to_date ? niceDate(r.from_date) : `${niceDate(r.from_date)} – ${niceDate(r.to_date)}`)
  + (r.time_at ? ` · ${niceTime(r.time_at)}` : "");
