/**
 * services/TestSeriesServiceApi.js
 * Test Series module — Admin & Student API service
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { fetchWithLockCheck } from "./apiInterceptor";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const buildHeaders = (user) => ({
  Accept:           "application/json",
  "Content-Type":   "application/json",
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

/** Build a query string from an object, dropping falsy values. */
const buildQuery = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))
  ).toString();
  return qs ? `?${qs}` : "";
};

// ─── ADMIN — SERIES ───────────────────────────────────────────────────────────

/**
 * Create a new test series.
 * @param {object} user  - Authenticated user object (token, role, etc.)
 * @param {object} data  - Series payload (name, description, class_id, session_id, branch_id, …)
 * @returns {Promise<object>} API response containing the new series record.
 */
export const createSeries = (user, data) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/createSeries`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(data),
  }).then(handleResponse);

/**
 * Fetch the list of test series with optional filters.
 * @param {object} user                   - Authenticated user object.
 * @param {object} [filters={}]           - Optional query filters.
 * @param {string|number} [filters.branch_id]
 * @param {string|number} [filters.session_id]
 * @param {string|number} [filters.class_id]
 * @returns {Promise<object>} API response containing the series list.
 */
export const getSeriesList = (user, filters = {}) => {
  const { branch_id, session_id, class_id } = filters;
  return fetchWithLockCheck(
    `${BASE_URL}/TestSeriesApi/getSeriesList${buildQuery({ branch_id, session_id, class_id })}`,
    { method: "GET", headers: buildHeaders(user) }
  ).then(handleResponse);
};

/**
 * Update an existing test series.
 * @param {object}       user - Authenticated user object.
 * @param {string|number} id  - ID of the series to update.
 * @param {object}       data - Fields to update.
 * @returns {Promise<object>} API response.
 */
export const updateSeries = (user, id, data) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/updateSeries`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ ...data, id }),
  }).then(handleResponse);

/**
 * Delete a test series by ID.
 * @param {object}       user - Authenticated user object.
 * @param {string|number} id  - ID of the series to delete.
 * @returns {Promise<object>} API response.
 */
export const deleteSeries = (user, id) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/deleteSeries`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ id }),
  }).then(handleResponse);

// ─── ADMIN — TESTS ────────────────────────────────────────────────────────────

/**
 * Create a new test inside a series.
 * @param {object} user - Authenticated user object.
 * @param {object} data - Test payload (series_id, title, duration_minutes, total_marks, …)
 * @returns {Promise<object>} API response containing the new test record.
 */
export const createTest = (user, data) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/createTest`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(data),
  }).then(handleResponse);

/**
 * Fetch all tests belonging to a series.
 * @param {object}       user     - Authenticated user object.
 * @param {string|number} seriesId - The series whose tests to fetch.
 * @returns {Promise<object>} API response containing the test list.
 */
export const getTestsBySeriesId = (user, seriesId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getTestsBySeriesId${buildQuery({ series_id: seriesId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

/**
 * Update an existing test.
 * @param {object}       user - Authenticated user object.
 * @param {string|number} id  - ID of the test to update.
 * @param {object}       data - Fields to update.
 * @returns {Promise<object>} API response.
 */
export const updateTest = (user, id, data) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/updateTest`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ ...data, id }),
  }).then(handleResponse);

/**
 * Delete a test by ID.
 * @param {object}       user - Authenticated user object.
 * @param {string|number} id  - ID of the test to delete.
 * @returns {Promise<object>} API response.
 */
export const deleteTest = (user, id) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/deleteTest`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ id }),
  }).then(handleResponse);

// ─── ADMIN — SECTIONS ─────────────────────────────────────────────────────────

/**
 * Add a section to a test (e.g. Physics, Chemistry).
 * @param {object} user - Authenticated user object.
 * @param {object} data - Section payload (test_id, name, instructions, …)
 * @returns {Promise<object>} API response containing the new section record.
 */
export const addSection = (user, data) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/addSection`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(data),
  }).then(handleResponse);

/**
 * Fetch all sections of a test.
 * @param {object}       user   - Authenticated user object.
 * @param {string|number} testId - The test whose sections to fetch.
 * @returns {Promise<object>} API response containing the sections list.
 */
export const getSections = (user, testId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getSections${buildQuery({ test_id: testId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

/**
 * Delete a section by ID.
 * @param {object}       user - Authenticated user object.
 * @param {string|number} id  - ID of the section to delete.
 * @returns {Promise<object>} API response.
 */
export const deleteSection = (user, id) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/deleteSection`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ id }),
  }).then(handleResponse);

// ─── ADMIN — QUESTIONS ────────────────────────────────────────────────────────

/**
 * Add one or more questions to a test.
 * @param {object}       user      - Authenticated user object.
 * @param {string|number} testId   - Target test ID.
 * @param {Array<object>} questions - Array of question objects (question_id, marks, …)
 * @returns {Promise<object>} API response.
 */
export const addQuestions = (user, testId, questions) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/addQuestions`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ test_id: testId, questions }),
  }).then(handleResponse);

/**
 * Remove a question from a test.
 * @param {object}       user           - Authenticated user object.
 * @param {string|number} testQuestionId - The test_question mapping ID to remove.
 * @returns {Promise<object>} API response.
 */
export const removeQuestion = (user, testQuestionId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/removeQuestion`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ id: testQuestionId }),
  }).then(handleResponse);

/**
 * Fetch all questions assigned to a test.
 * @param {object}       user   - Authenticated user object.
 * @param {string|number} testId - The test whose questions to fetch.
 * @returns {Promise<object>} API response containing the question list.
 */
export const getTestQuestions = (user, testId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getTestQuestions${buildQuery({ test_id: testId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ─── ADMIN — PUBLISH & ANALYTICS ──────────────────────────────────────────────

/**
 * Publish a test, making it visible and accessible to enrolled students.
 * @param {object}       user   - Authenticated user object.
 * @param {string|number} testId - ID of the test to publish.
 * @returns {Promise<object>} API response.
 */
export const publishTest = (user, testId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/publishTest`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ id: testId }),
  }).then(handleResponse);

/**
 * Fetch all student attempts for a test (admin view).
 * @param {object}       user   - Authenticated user object.
 * @param {string|number} testId - The test whose attempts to fetch.
 * @returns {Promise<object>} API response containing the attempts list.
 */
export const getTestAttempts = (user, testId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getTestAttempts${buildQuery({ test_id: testId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

/**
 * Fetch batch-level (class/group) analytics for a test.
 * @param {object}       user   - Authenticated user object.
 * @param {string|number} testId - The test to analyse.
 * @returns {Promise<object>} API response containing aggregated analytics.
 */
export const getBatchAnalysis = (user, testId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getBatchAnalysis${buildQuery({ test_id: testId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ─── STUDENT — SERIES & TESTS ─────────────────────────────────────────────────

/**
 * Fetch all series the logged-in student is enrolled in.
 * @param {object} user - Authenticated student user object.
 * @returns {Promise<object>} API response containing the student's series list.
 */
export const getMySeriesList = (user) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getMySeriesList`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

/**
 * Fetch the student's tests within a given series.
 * @param {object}       user     - Authenticated student user object.
 * @param {string|number} seriesId - The series to list tests from.
 * @returns {Promise<object>} API response containing the student's test list.
 */
export const getMyTests = (user, seriesId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getMyTests${buildQuery({ series_id: seriesId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ─── STUDENT — ATTEMPT LIFECYCLE ──────────────────────────────────────────────

/**
 * Start (or resume) a test attempt for the logged-in student.
 * @param {object}       user   - Authenticated student user object.
 * @param {string|number} testId - The test to start.
 * @returns {Promise<object>} API response containing the attempt_id and initial state.
 */
export const startAttempt = (user, testId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/startAttempt`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ test_id: testId }),
  }).then(handleResponse);

/**
 * Persist the student's in-progress responses (auto-save).
 * @param {object}       user      - Authenticated student user object.
 * @param {string|number} attemptId - The active attempt ID.
 * @param {Array<object>} responses - Array of response objects
 *   e.g. [{ question_id, chosen_option, is_marked_for_review }, …]
 * @returns {Promise<object>} API response.
 */
export const saveResponses = (user, attemptId, responses) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/saveResponses`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ attempt_id: attemptId, responses }),
  }).then(handleResponse);

/**
 * Submit a completed attempt and trigger server-side evaluation.
 * @param {object}       user        - Authenticated student user object.
 * @param {string|number} attemptId  - The attempt to submit.
 * @param {number}        timeSpent  - Total time spent in seconds.
 * @returns {Promise<object>} API response containing submission confirmation.
 */
export const submitAttempt = (user, attemptId, timeSpent, responses = null) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/submitAttempt`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({
      attempt_id:         attemptId,
      time_spent_seconds: timeSpent,
      responses,          // optional: include responses so submit is atomic even if saveResponses is blocked
    }),
  }).then(handleResponse);

// ─── STUDENT — RESULTS & ANALYTICS ───────────────────────────────────────────

/**
 * Fetch the result (score, rank, pass/fail) for a submitted attempt.
 * @param {object}       user      - Authenticated student user object.
 * @param {string|number} attemptId - The attempt whose result to fetch.
 * @returns {Promise<object>} API response containing score, rank, and summary.
 */
export const getResult = (user, attemptId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getResult${buildQuery({ attempt_id: attemptId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

/**
 * Fetch per-question analysis (correct/wrong/skipped, time per question) for an attempt.
 * @param {object}       user      - Authenticated student user object.
 * @param {string|number} attemptId - The attempt to analyse.
 * @returns {Promise<object>} API response containing detailed question-level breakdown.
 */
export const getAnalysis = (user, attemptId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getAnalysis${buildQuery({ attempt_id: attemptId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

/**
 * Fetch the leaderboard (top scores) for a test.
 * @param {object}       user   - Authenticated student user object.
 * @param {string|number} testId - The test whose leaderboard to fetch.
 * @returns {Promise<object>} API response containing ranked student scores.
 */
export const getLeaderboard = (user, testId) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getLeaderboard${buildQuery({ test_id: testId })}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ─── CHAPTERS (chapter-wise test series) ──────────────────────────────────────

/** GET /TestSeriesApi/getChapters?class_id=X&subject_id=Y */
export const fetchChapters = (user, classId, subjectId, subjectName) => {
  const params = new URLSearchParams();
  if (classId)     params.append("class_id",     classId);
  if (subjectId)   params.append("subject_id",   subjectId);
  if (subjectName) params.append("subject_name", subjectName);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/getChapters${qs}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

/** POST /TestSeriesApi/createChapter */
export const createChapter = (user, payload) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/createChapter`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/** POST /TestSeriesApi/updateChapter/:id */
export const updateChapter = (user, id, payload) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/updateChapter/${id}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/** DELETE /TestSeriesApi/deleteChapter/:id */
export const deleteChapter = (user, id) =>
  fetchWithLockCheck(`${BASE_URL}/TestSeriesApi/deleteChapter/${id}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);
