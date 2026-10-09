/**
 * services/StaffServiceApi.js
 * All API calls for Staff management
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { fetchWithLockCheck } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept:         "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

const buildMultipartHeaders = (user) => ({
  Accept:         "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
  // No Content-Type — let fetch set multipart boundary automatically
});

const handleResponse = async (res) => {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

// ── Fetch staff list ──────────────────────────────────────────────────────────
// Returns: [{ staff_id, first_name, last_name, display_name, ... }]
export const fetchStaff = (user) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/getStaff`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

// ── Fetch single staff member ─────────────────────────────────────────────────
export const fetchStaffById = (user, staffId) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/getStaffById/${staffId}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? null);

// ── Fetch staff categories ────────────────────────────────────────────────────
export const fetchStaffCategories = (user) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/getStaffCategories`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

// ── Register / Update staff (with file uploads) ───────────────────────────────
// Uses FormData so staff_photo, id_proof, address_proof, experience_letter
// can be uploaded as files. Pass staff_id in payload to update; omit for create.
export const saveStaffRegistration = (user, payload) => {
  const form = new FormData();

  // Text fields
  const TEXT_FIELDS = [
    "staff_id", "staff_title", "first_name", "last_name",
    "email_address", "mobile_number", "address", "state",
    "father_name", "mother_name", "date_of_birth", "gender",
    "date_of_hiring", "years_of_experience", "specialty",
    "expected_salary", "salary", "category_id", "hired", "resigned",
    "resignation_date", "branch_id",
  ];
  TEXT_FIELDS.forEach(f => {
    if (payload[f] != null) form.append(f, String(payload[f]));
  });

  // File fields — each should be { uri, name, type } object
  const FILE_FIELDS = ["staff_photo", "id_proof", "address_proof", "experience_letter"];
  FILE_FIELDS.forEach(f => {
    if (payload[f]?.uri) form.append(f, payload[f]);
  });

  return fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/saveStaffRegistration`, {
    method: "POST",
    headers: buildMultipartHeaders(user),
    body: form,
  }).then(handleResponse);
};

// ── Delete staff ──────────────────────────────────────────────────────────────
export const deleteStaff = (user, staffId) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/deleteStaff/${staffId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ── Update staff status (hired / resigned) ────────────────────────────────────
export const updateStaffStatus = (user, staffId, payload) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/updateStaffStatus/${staffId}`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

// ── Staff Category CRUD ───────────────────────────────────────────────────────

export const createStaffCategory = (user, payload) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/createStaffCategory`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const updateStaffCategory = (user, categoryId, payload) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/updateStaffCategory/${categoryId}`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const deleteStaffCategory = (user, categoryId) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/deleteStaffCategory/${categoryId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ── Hiring management ─────────────────────────────────────────────────────────

// Fetch all staff pending/review list (all registered staff with hiring status)
export const fetchHiringList = (user) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/getHiringList`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

// Update hiring details — date, salary, hired/resigned status
// If hired=Y → backend creates user account + sends welcome email
export const updateHiringDetails = (user, staffId, payload) =>
  fetchWithLockCheck(`${BASE_URL}/StaffServiceApi/updateHiringDetails/${staffId}`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

// ── Fetch only hired staff ────────────────────────────────────────────────────
export const fetchHiredStaff = (user, branchId) => {
  const url = branchId
    ? `${BASE_URL}/StaffServiceApi/getHiredStaff?branchId=${branchId}`
    : `${BASE_URL}/StaffServiceApi/getHiredStaff`;
  return fetchWithLockCheck(url, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};