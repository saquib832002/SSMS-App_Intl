/**
 * services/ExamServiceApi.js
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";

const buildHeaders = (user) => ({
  Accept:            "application/json",
  "Content-Type":    "application/json",
  ssmsUserName:      user?.ssmsUserName   ?? "",
  ssmsUserRole:      user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode:    user?.ssmsClientCode ?? "",
  ssmsEnrollmentId:  user?.enrollmentId   ?? "",
  Authorization:     user?.token ? `Bearer ${user.token}` : "",
});

const handleResponse = async (res) => {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

export const fetchClientInfo = (user) =>
  fetch(`${BASE_URL}/ExamServiceApi/getClientInfo`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? null);

export const fetchSchoolInfo = (user) =>
  fetch(`${BASE_URL}/ExamServiceApi/getSchoolInfo`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? null);

export const fetchExams = (user) =>
  fetch(`${BASE_URL}/ExamServiceApi/getExams`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

export const createExam = (user, payload) =>
  fetch(`${BASE_URL}/ExamServiceApi/createExam`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const updateExam = (user, examId, payload) =>
  fetch(`${BASE_URL}/ExamServiceApi/updateExam/${examId}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const deleteExam = (user, examId) =>
  fetch(`${BASE_URL}/ExamServiceApi/deleteExam/${examId}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

export const toggleExamRelease = (user, examId) =>
  fetch(`${BASE_URL}/ExamServiceApi/toggleExamRelease/${examId}`, {
    method: "POST", headers: buildHeaders(user),
  }).then(handleResponse);

// Fetch the correct max marks for a subject in a class.
// If examId is supplied, exam-specific row takes priority over class-level.
export const fetchSubjectMaxMarks = (user, classId, subjectId, examId) => {
  const params = new URLSearchParams({ classId, subjectId });
  if (examId) params.set('examId', examId);
  return fetch(`${BASE_URL}/ExamServiceApi/getSubjectMaxMarks?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? null);
};

// Fetch saved max marks for a specific exam + class (exam-specific rows only).
export const fetchQuickTestMaxMarks = (user, examId, classId) => {
  const params = new URLSearchParams({ examId, classId });
  return fetch(`${BASE_URL}/ExamServiceApi/getQuickTestMaxMarks?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

// Saves per-exam per-subject max marks for a quick test.
// payload: { exam_id, class_id, subjects: [{subject_id, max_marks}] }
export const saveQuickTestMaxMarks = (user, payload) =>
  fetch(`${BASE_URL}/ExamServiceApi/saveQuickTestMaxMarks`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

// ── Marks ─────────────────────────────────────────────────────────────────────

// Fetch enrolled students for marks entry (with existing marks if any)
export const fetchStudentsForMarks = (user, { branchId, examId, sessionId, classId, sectionId, subjectId }) => {
  const params = new URLSearchParams();
  if (branchId)  params.set('branchId',  branchId);
  if (examId)    params.set('examId',    examId);
  if (sessionId) params.set('sessionId', sessionId);
  if (classId)   params.set('classId',   classId);
  if (sectionId) params.set('sectionId', sectionId);
  if (subjectId) params.set('subjectId', subjectId);
  return fetch(`${BASE_URL}/ExamServiceApi/getStudentsForMarks?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

// Save marks for multiple students in one call
export const saveMarks = (user, payload) =>
  fetch(`${BASE_URL}/ExamServiceApi/saveMarks`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);


  // ── Marksheet ─────────────────────────────────────────────────────────────────
 
// Fetch full marksheet for a student — all subjects for a given exam/session/class
export const fetchMarksheet = (user, { enrollmentId, examId, sessionId, classId, branchId }) => {
  const params = new URLSearchParams();
  if (enrollmentId) params.set('enrollmentId', enrollmentId);
  if (examId)       params.set('examId',       examId);
  if (sessionId)    params.set('sessionId',    sessionId);
  if (classId)      params.set('classId',      classId);
  if (branchId)     params.set('branchId',     branchId);
  return fetch(`${BASE_URL}/ExamServiceApi/getMarksheet?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? null);
};
 
// Fetch all students' marks for a class+exam as a pivot matrix
export const fetchClassMarksMatrix = (user, { examId, classId, sessionId, sectionId, branchId }) => {
  const params = new URLSearchParams();
  if (examId)    params.set('examId',    examId);
  if (classId)   params.set('classId',   classId);
  if (sessionId) params.set('sessionId', sessionId);
  if (sectionId) params.set('sectionId', sectionId);
  if (branchId)  params.set('branchId',  branchId);
  return fetch(`${BASE_URL}/ExamServiceApi/getClassMarksMatrix?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => ({ subjects: d.subjects ?? [], students: d.students ?? [] }));
};

// Fetch list of students who have marks for a given exam/session/class
export const fetchStudentsWithMarks = (user, { examId, sessionId, classId, sectionId, branchId }) => {
  const params = new URLSearchParams();
  if (examId)     params.set('examId',     examId);
  if (sessionId)  params.set('sessionId',  sessionId);
  if (classId)    params.set('classId',    classId);
  if (sectionId)  params.set('sectionId',  sectionId);
  if (branchId)   params.set('branchId',   branchId);
  return fetch(`${BASE_URL}/ExamServiceApi/getStudentsWithMarks?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

// Alias used by GenerateMarksheetScreen — only classId + examId required
export const fetchStudentsForMarksheet = (user, { branchId, examId, sessionId, classId, sectionId }) => {
  const params = new URLSearchParams();
  if (branchId)  params.set('branchId',  branchId);
  if (examId)    params.set('examId',    examId);
  if (sessionId) params.set('sessionId', sessionId);
  if (classId)   params.set('classId',   classId);
  if (sectionId) params.set('sectionId', sectionId);
  return fetch(`${BASE_URL}/ExamServiceApi/getStudentsWithMarks?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};
// Fetch all marksheets for the logged-in student (student portal)
export const fetchMyMarksheets = (user) =>
  fetch(`${BASE_URL}/ExamServiceApi/getMyMarksheets`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => ({ student: d.student ?? null, exams: d.exams ?? [] }));

// Fetch student rankings for an exam + class
export const fetchExamRankings = (user, { examId, classId, sessionId, sectionId, branchId }) => {
  const params = new URLSearchParams();
  if (examId)    params.set('examId',    examId);
  if (classId)   params.set('classId',   classId);
  if (sessionId) params.set('sessionId', sessionId);
  if (sectionId) params.set('sectionId', sectionId);
  if (branchId)  params.set('branchId',  branchId);
  return fetch(`${BASE_URL}/ExamServiceApi/getExamRankings?${params}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => ({ data: d.data ?? [], exam: d.exam ?? null, total: d.total ?? 0 }));
};

// Promote students to a new class / section / session
export const promoteStudents = (user, payload) =>
  fetch(`${BASE_URL}/ExamServiceApi/promoteStudents`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);