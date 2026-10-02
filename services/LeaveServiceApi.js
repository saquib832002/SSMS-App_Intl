/**
 * services/LeaveServiceApi.js
 * All API calls for Staff Leave Management
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept:         "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  ssmsBranchId:   String(user?.ssmsBranchId ?? 0),
  ssmsStaffId:    String(user?.staffId ?? ""),   // fast-path — avoids name-JOIN in controller
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

const handleResponse = async (res) => {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

// ── Leave Types ───────────────────────────────────────────────────────────────

/** GET all active leave types */
export const fetchLeaveTypes = (user) =>
  safeFetch(`${BASE_URL}/LeaveApi/getLeaveTypes`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

/**
 * POST save (create/update) a leave type  [admin only]
 * @param {object} type — { id?, name, abbreviation, max_days_per_year, carry_forward, status }
 */
export const saveLeaveType = (user, type) =>
  safeFetch(`${BASE_URL}/LeaveApi/saveLeaveType`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(type),
  }).then(handleResponse);

// ── Applications ──────────────────────────────────────────────────────────────

/**
 * POST apply for leave (staff)
 * @param {object} payload — { leave_type_id, from_date, to_date, reason, is_half_day?, half_day_slot? }
 */
export const applyLeave = (user, payload) =>
  safeFetch(`${BASE_URL}/LeaveApi/applyLeave`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/** GET logged-in staff's own applications for a year */
export const fetchMyLeaves = (user, year = new Date().getFullYear()) =>
  safeFetch(`${BASE_URL}/LeaveApi/getMyLeaves?year=${year}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

/** GET all pending leaves (admin/principal) */
export const fetchPendingLeaves = (user) =>
  safeFetch(`${BASE_URL}/LeaveApi/getPendingLeaves`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

/**
 * GET all leaves (admin)  — optional filters: year, staff_id, status
 */
export const fetchAllLeaves = (user, { year, staffId, status } = {}) => {
  const params = new URLSearchParams();
  if (year)     params.set("year",     year);
  if (staffId)  params.set("staff_id", staffId);
  if (status)   params.set("status",   status);
  return safeFetch(`${BASE_URL}/LeaveApi/getAllLeaves?${params}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

/**
 * POST approve or reject a leave (admin/principal)
 * @param {object} payload — { id, action: 'approved'|'rejected', remarks? }
 */
export const approveLeave = (user, payload) =>
  safeFetch(`${BASE_URL}/LeaveApi/approveLeave`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

/**
 * POST cancel a leave application (staff)
 * @param {number} id — application id
 */
export const cancelLeave = (user, id) =>
  safeFetch(`${BASE_URL}/LeaveApi/cancelLeave`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ id }),
  }).then(handleResponse);

// ── Balance ───────────────────────────────────────────────────────────────────

/**
 * GET leave balance
 * @param {number|null} staffId — null = logged-in staff
 * @param {number} year
 */
export const fetchLeaveBalance = (user, staffId = null, year = new Date().getFullYear()) => {
  const params = new URLSearchParams({ year });
  if (staffId) params.set("staff_id", staffId);
  return safeFetch(`${BASE_URL}/LeaveApi/getLeaveBalance?${params}`, {
    method: "GET",
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};
