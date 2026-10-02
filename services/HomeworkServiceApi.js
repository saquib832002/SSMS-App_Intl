// services/HomeworkServiceApi.js
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept:             "application/json",
  "Content-Type":     "application/json",
  ssmsUserName:       user?.ssmsUserName   ?? "",
  ssmsUserRole:       user?.ssmsUserRole   ?? "",
  ssmsClientCode:     user?.ssmsClientCode ?? "",
  ssmsEnrollmentId:   user?.enrollmentId   ?? "",   // backend fallback for studentView
  Authorization:      user?.token ? `Bearer ${user.token}` : "",
});

const BASE = `${BASE_URL}HomeworkApi`;

// ── Create homework ─────────────────────────────────────────────────────────
export const createHomework = async (user, payload) => {
  const res  = await safeFetch(`${BASE}/create`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json;
};

// ── List homework ───────────────────────────────────────────────────────────
export const listHomework = async (user, params = {}) => {
  const qs  = new URLSearchParams(Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
  )).toString();
  const res  = await safeFetch(`${BASE}/list${qs ? `?${qs}` : ""}`, {
    method:  "GET",
    headers: buildHeaders(user),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json.data ?? [];
};

// ── Homework detail with per-student status ─────────────────────────────────
export const getHomeworkDetail = async (user, homeworkId, sessionId) => {
  const qs  = sessionId ? `?sessionId=${sessionId}` : "";
  const res  = await safeFetch(`${BASE}/detail/${homeworkId}${qs}`, {
    method:  "GET",
    headers: buildHeaders(user),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json; // { homework, summary, students }
};

// ── Bulk mark students ──────────────────────────────────────────────────────
export const markStudents = async (user, homeworkId, students, markedBy) => {
  const res  = await safeFetch(`${BASE}/markStudents`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify({ homeworkId, markedBy, students }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json;
};

// ── Mark single student ─────────────────────────────────────────────────────
export const markStudent = async (user, payload) => {
  const res  = await safeFetch(`${BASE}/markStudent`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json;
};

// ── Student / parent view ───────────────────────────────────────────────────
// Pass date as "YYYY-MM-DD" to filter to that day; pass null/undefined for all active homework.
export const getStudentHomework = async (user, enrollmentId, date) => {
  const params = { enrollmentId };
  if (date) params.date = date;                     // omit date key when not provided
  const qs  = new URLSearchParams(params).toString();
  const res  = await safeFetch(`${BASE}/studentView?${qs}`, {
    method:  "GET",
    headers: buildHeaders(user),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json.data ?? [];
};

// ── Delete homework ─────────────────────────────────────────────────────────
export const deleteHomework = async (user, homeworkId) => {
  const res  = await safeFetch(`${BASE}/delete/${homeworkId}`, {
    method:  "POST",
    headers: buildHeaders(user),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json;
};
