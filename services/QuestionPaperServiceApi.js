/**
 * services/QuestionPaperServiceApi.js
 * Question Bank + Question Paper API service
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";

const buildHeaders = (user) => ({
  Accept:           "application/json",
  "Content-Type":   "application/json",
  ssmsUserName:     user?.ssmsUserName   ?? "",
  ssmsUserRole:     user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode:   user?.ssmsClientCode ?? "",
  ssmsEnrollmentId: user?.enrollmentId   ?? "",
  Authorization:    user?.token ? `Bearer ${user.token}` : "",
});

const buildMultipartHeaders = (user) => ({
  Accept:           "application/json",
  ssmsUserName:     user?.ssmsUserName   ?? "",
  ssmsUserRole:     user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode:   user?.ssmsClientCode ?? "",
  ssmsEnrollmentId: user?.enrollmentId   ?? "",
  Authorization:    user?.token ? `Bearer ${user.token}` : "",
});

const handleResponse = async (res) => {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

// ─── QUESTION BANK ────────────────────────────────────────────────────────────

/** List questions. Optional filters: subject_id, class_id, type, difficulty, keyword */
export const fetchQuestions = (user, filters = {}) => {
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
  ).toString();
  return fetch(`${BASE_URL}/QuestionBankApi/getQuestions${params ? `?${params}` : ""}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

/** Create a question (with optional image) */
export const createQuestion = (user, payload) => {
  // If payload has an imageUri, send as multipart; otherwise JSON
  if (payload.imageUri) {
    const fd = new FormData();
    Object.entries(payload).forEach(([k, v]) => {
      if (k === "imageUri") {
        fd.append("image", { uri: v, name: "question_image.jpg", type: "image/jpeg" });
      } else if (typeof v === "object" && v !== null) {
        fd.append(k, JSON.stringify(v));
      } else {
        fd.append(k, String(v ?? ""));
      }
    });
    return fetch(`${BASE_URL}/QuestionBankApi/createQuestion`, {
      method: "POST", headers: buildMultipartHeaders(user), body: fd,
    }).then(handleResponse);
  }
  return fetch(`${BASE_URL}/QuestionBankApi/createQuestion`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);
};

/**
 * Update a question.
 * Sends id in the POST body to createQuestion — which detects id and runs update logic.
 * This avoids the need for a separate updateQuestion route in routes.php.
 */
export const updateQuestion = (user, qId, payload) => {
  if (payload.imageUri) {
    const fd = new FormData();
    fd.append("id", String(qId));
    Object.entries(payload).forEach(([k, v]) => {
      if (k === "imageUri") {
        fd.append("image", { uri: v, name: "question_image.jpg", type: "image/jpeg" });
      } else if (typeof v === "object" && v !== null) {
        fd.append(k, JSON.stringify(v));
      } else {
        fd.append(k, String(v ?? ""));
      }
    });
    return fetch(`${BASE_URL}/QuestionBankApi/createQuestion`, {
      method: "POST", headers: buildMultipartHeaders(user), body: fd,
    }).then(handleResponse);
  }
  return fetch(`${BASE_URL}/QuestionBankApi/createQuestion`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify({ ...payload, id: qId }),
  }).then(handleResponse);
};

/** Soft-delete a question — id goes in the body to avoid URL-parameter routing issues */
export const deleteQuestion = (user, qId) =>
  fetch(`${BASE_URL}/QuestionBankApi/deleteQuestion`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify({ id: qId }),
  }).then(handleResponse);

// ─── BULK IMPORT ──────────────────────────────────────────────────────────────

/**
 * Fetch reference data (branches, sessions, classes, subjects) so the app can
 * build the Excel template's Reference sheet and validate names client-side.
 */
export const getImportReference = (user) =>
  fetch(`${BASE_URL}/QuestionBankApi/getImportReference`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? {});

/**
 * Bulk-import questions parsed from an Excel file.
 * @param {object} user
 * @param {Array}  rows   Parsed question rows (plain objects matching the Excel columns).
 * @returns {Promise<{imported, failed, errors}>}
 */
export const importQuestions = (user, rows) =>
  fetch(`${BASE_URL}/QuestionBankApi/importQuestions`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify({ questions: rows }),
  }).then(handleResponse);

// ─── QUESTION PAPERS ──────────────────────────────────────────────────────────

/** List all papers (filter: class_id, subject_id, session, status) */
export const fetchPapers = (user, filters = {}) => {
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
  ).toString();
  return fetch(`${BASE_URL}/QuestionPaperApi/getPapers${params ? `?${params}` : ""}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

/** Create a paper (header only; returns paper_id) */
export const createPaper = (user, payload) =>
  fetch(`${BASE_URL}/QuestionPaperApi/createPaper`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse).then(d => d.data ?? d);

/** Update paper header/config */
export const updatePaper = (user, paperId, payload) =>
  fetch(`${BASE_URL}/QuestionPaperApi/updatePaper/${paperId}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/** Delete a paper */
export const deletePaper = (user, paperId) =>
  fetch(`${BASE_URL}/QuestionPaperApi/deletePaper/${paperId}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

/** Get full paper with all questions (for preview) */
export const fetchPaperDetail = (user, paperId) =>
  fetch(`${BASE_URL}/QuestionPaperApi/getPaper/${paperId}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? {});

/** Add a question to a paper */
export const addQuestionToPaper = (user, paperId, payload) =>
  fetch(`${BASE_URL}/QuestionPaperApi/addQuestion/${paperId}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/** Update order/marks of a question in a paper */
export const updatePaperQuestion = (user, paperId, pqId, payload) =>
  fetch(`${BASE_URL}/QuestionPaperApi/updateQuestion/${paperId}/${pqId}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/** Remove a question from a paper */
export const removeQuestionFromPaper = (user, paperId, pqId) =>
  fetch(`${BASE_URL}/QuestionPaperApi/removeQuestion/${paperId}/${pqId}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);

/** Publish a paper (status → published) */
export const publishPaper = (user, paperId) =>
  fetch(`${BASE_URL}/QuestionPaperApi/publishPaper/${paperId}`, {
    method: "POST", headers: buildHeaders(user),
  }).then(handleResponse);

/** Get Word export URL (server-side .docx) */
export const getWordExportUrl = (user, paperId) =>
  `${BASE_URL}/QuestionPaperApi/exportDocx/${paperId}?token=${encodeURIComponent(user?.token ?? "")}`;
