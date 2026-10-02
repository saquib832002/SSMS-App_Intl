/**
 * services/TimeTableServiceApi.js
 * API calls for Periods and Timetable management
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";

const buildHeaders = (user) => ({
  Accept:         "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

const handleResponse = async (res) => {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

// ── Periods ───────────────────────────────────────────────────────────────────

export const fetchPeriods = (user) =>
  fetch(`${BASE_URL}/TimeTableServiceApi/getPeriods`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

export const createPeriod = (user, payload) =>
  fetch(`${BASE_URL}/TimeTableServiceApi/createPeriod`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const updatePeriod = (user, id, payload) =>
  fetch(`${BASE_URL}/TimeTableServiceApi/updatePeriod/${id}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const deletePeriod = (user, id) =>
  fetch(`${BASE_URL}/TimeTableServiceApi/deletePeriod/${id}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

// ── Timetable ─────────────────────────────────────────────────────────────────

/**
 * Fetch timetable grid for a class/section/session.
 * @param {object} user
 * @param {{ classId, sectionId?, sessionId? }} params
 */
export const fetchTimetable = (user, { classId, sectionId, sessionId, branchId } = {}) => {
  const qs = new URLSearchParams({ classId });
  if (sectionId) qs.set("sectionId", sectionId);
  if (sessionId) qs.set("sessionId", sessionId);
  if (branchId)  qs.set("branchId",  branchId);
  return fetch(`${BASE_URL}/TimeTableServiceApi/getTimetable?${qs}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

/**
 * Upsert a single timetable slot.
 * payload: { session_id, class_id, section_id, day_of_week, period_id,
 *             class_subject_id, staff_id, room }
 */
export const saveTimetableSlot = (user, payload) =>
  fetch(`${BASE_URL}/TimeTableServiceApi/saveTimetableSlot`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/**
 * Fetch the school-wide master timetable.
 * Returns { periods, columns, grid } for one day across all class-sections.
 * @param {{ sessionId?, branchId?, dayOfWeek? }} params
 */
export const fetchMasterTimetable = (user, { sessionId, branchId } = {}) => {
  const qs = new URLSearchParams();
  if (sessionId) qs.set("sessionId", sessionId);
  if (branchId)  qs.set("branchId",  branchId);
  return fetch(`${BASE_URL}/TimeTableServiceApi/getMasterTimetable?${qs}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse);
};

/**
 * Fetch busy map: which teachers are already assigned elsewhere at each day/period.
 * Returns { staff_id: { day_of_week: { period_id: "Class – Section" } } }
 */
export const fetchBusyMap = (user, { classId, sectionId, sessionId, branchId } = {}) => {
  const qs = new URLSearchParams();
  if (classId)   qs.set("classId",   classId);
  if (sectionId) qs.set("sectionId", sectionId);
  if (sessionId) qs.set("sessionId", sessionId);
  if (branchId)  qs.set("branchId",  branchId);
  return fetch(`${BASE_URL}/TimeTableServiceApi/getBusyMap?${qs}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? {});
};

/**
 * Copy one day's schedule to other days.
 * payload: { class_id, section_id, session_id, source_day, mode: "all"|"weekdays" }
 */
/** payload: { class_id, section_id, session_id, branch_id?, source_day, mode } */
export const copyDay = (user, payload) =>
  fetch(`${BASE_URL}/TimeTableServiceApi/copyDay`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const deleteTimetableSlot = (user, id) =>
  fetch(`${BASE_URL}/TimeTableServiceApi/deleteTimetableSlot/${id}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

/**
 * Fetch a teacher's full weekly timetable.
 * @param {{ staffId, sessionId? }} params
 */
export const fetchTeacherTimetable = (user, { staffId, sessionId } = {}) => {
  const qs = new URLSearchParams({ staffId });
  if (sessionId) qs.set("sessionId", sessionId);
  return fetch(`${BASE_URL}/TimeTableServiceApi/getTeacherTimetable?${qs}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};
