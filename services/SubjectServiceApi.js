/**
 * services/SubjectServiceApi.js
 * All API calls for Subject management
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";

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

// ── Subjects (school-wide catalogue) ─────────────────────────────────────────

// GET /SubjectServiceApi/getSubjects — returns subjects with class_count
export const fetchSubjects = (user) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/getSubjects`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

// POST /SubjectServiceApi/createSubject  { subject_name }
export const createSubject = (user, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/createSubject`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify({ subject_name: payload.subject_name }),
  }).then(handleResponse);

// POST /SubjectServiceApi/updateSubject/:id  { subject_name }
export const updateSubject = (user, subjectId, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/updateSubject/${subjectId}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify({ subject_name: payload.subject_name }),
  }).then(handleResponse);

// DELETE /SubjectServiceApi/deleteSubject/:id
export const deleteSubject = (user, subjectId) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/deleteSubject/${subjectId}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

// ── Class Subjects (subject ↔ class assignments) ──────────────────────────────

// GET /SubjectServiceApi/getClassSubjects?classId=X
export const fetchClassSubjects = (user, classId) => {
  const url = classId
    ? `${BASE_URL}/SubjectServiceApi/getClassSubjects?classId=${classId}`
    : `${BASE_URL}/SubjectServiceApi/getClassSubjects`;
  return safeFetch(url, { method: "GET", headers: buildHeaders(user) })
    .then(handleResponse).then(d => d.data ?? []);
};

// POST /SubjectServiceApi/createClassSubject  { subject_id, class_id, subject_code, display_order }
export const createClassSubject = (user, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/createClassSubject`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

// POST /SubjectServiceApi/updateClassSubject/:id
export const updateClassSubject = (user, id, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/updateClassSubject/${id}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

// DELETE /SubjectServiceApi/deleteClassSubject/:id
export const deleteClassSubject = (user, id) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/deleteClassSubject/${id}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

// ── Subject Teacher assignments ───────────────────────────────────────────────

export const fetchSubjectTeachers = (user) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/getSubjectTeachers`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

// Fetch only assignments for a specific staff member (teacher-scoped)
export const fetchTeacherAssignments = (user, staffId) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/getSubjectTeachers?staffId=${staffId}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

export const createSubjectTeacher = (user, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/createSubjectTeacher`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const updateSubjectTeacher = (user, id, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/updateSubjectTeacher/${id}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const deleteSubjectTeacher = (user, id) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/deleteSubjectTeacher/${id}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

  // ── Max Marks ─────────────────────────────────────────────────────────────────
 
export const fetchMaxMarks = (user, classId) => {
  const url = classId
    ? `${BASE_URL}/SubjectServiceApi/getMaxMarks?classId=${classId}`
    : `${BASE_URL}/SubjectServiceApi/getMaxMarks`;
  return safeFetch(url, { method: "GET", headers: buildHeaders(user) })
    .then(handleResponse).then(d => d.data ?? []);
};
 
export const createMaxMarks = (user, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/createMaxMarks`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);
 
export const updateMaxMarks = (user, id, payload) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/updateMaxMarks/${id}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);
 
export const deleteMaxMarks = (user, id) =>
  safeFetch(`${BASE_URL}/SubjectServiceApi/deleteMaxMarks/${id}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);