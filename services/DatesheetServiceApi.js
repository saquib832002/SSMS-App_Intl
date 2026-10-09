/**
 * services/DatesheetServiceApi.js
 * Exam Date Sheet API calls
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { fetchWithLockCheck } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept:           "application/json",
  "Content-Type":   "application/json",
  ssmsUserName:     user?.ssmsUserName   ?? "",
  ssmsUserRole:     user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode:   user?.ssmsClientCode ?? "",
  ssmsEnrollmentId: user?.enrollmentId ?? "",
  Authorization:    user?.token ? `Bearer ${user.token}` : "",
});

const handleResponse = async (res) => {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

/**
 * Admin: fetch all subjects for a class+branch+session with saved date/time info.
 * Returns { entries, is_published, exam_id, class_id, branch_id, session_id }
 */
export const fetchDatesheet = (user, examId, classId, branchId = 0, sessionId = 0) => {
  const params = new URLSearchParams({ examId, classId, branchId, sessionId });
  return fetchWithLockCheck(`${BASE_URL}/DatesheetApi/getDatesheet?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? { entries: [], is_published: false });
};

/**
 * Admin: save (upsert) date sheet entries.
 * payload: { exam_id, class_id, branch_id, session_id,
 *            entries: [{subject_id, exam_date, start_time, end_time, venue}] }
 * start_time / end_time stored in 24h "HH:MM" format.
 */
export const saveDatesheet = (user, payload) =>
  fetchWithLockCheck(`${BASE_URL}/DatesheetApi/saveDatesheet`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/**
 * Admin: toggle publish state for an exam+class+branch+session date sheet.
 * Returns { is_published: bool, message: string }
 */
export const togglePublish = (user, examId, classId, branchId = 0, sessionId = 0) =>
  fetchWithLockCheck(`${BASE_URL}/DatesheetApi/togglePublish`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify({ exam_id: examId, class_id: classId, branch_id: branchId, session_id: sessionId }),
  }).then(handleResponse).then(d => d.data ?? {});

/**
 * Admin: fetch ALL published datesheets for every class in one exam (for PDF printing).
 * Returns { exam_name, classes: [{ class_id, class_name, entries[] }] }
 */
export const fetchAllDatesheets = (user, examId, branchId = 0, sessionId = 0) => {
  const params = new URLSearchParams({ examId, branchId, sessionId });
  return fetchWithLockCheck(`${BASE_URL}/DatesheetApi/getAllDatesheets?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? { exam_name: "", classes: [] });
};

/**
 * Student/Parent: fetch all published date sheets for the student's enrolled class.
 * Backend auto-resolves branch_id + session_id from the enrollment header.
 * Returns array of { exam_id, exam_name, exam_category, class_id, entries[] }
 * where each entry has start_time / end_time in 24h format (display as 12h in the screen).
 */
export const fetchMyDatesheet = (user) =>
  fetchWithLockCheck(`${BASE_URL}/DatesheetApi/getMyDatesheet`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
