/**
 * services/TransportServiceApi.js
 * All transport module API calls
 */
import { BASE_URL as _RAW } from "../Environment/EnvironmentConfig";
const BASE_URL = _RAW.replace(/\/+$/, "");

const buildHeaders = (user) => ({
  "Content-Type": "application/json",
  Accept:          "application/json",
  ssmsUserName:    user?.ssmsUserName   ?? "",
  ssmsUserRole:    user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode:  user?.ssmsClientCode ?? "",
  Authorization:   user?.token ? `Bearer ${user.token}` : "",
});

const BASE = `${BASE_URL}/TransportServiceApi`;
const api = (user) => ({
  get:    (path)       => fetch(`${BASE}/${path}`, { method: "GET",    headers: buildHeaders(user) }).then(r => r.json()),
  post:   (path, body) => fetch(`${BASE}/${path}`, { method: "POST",   headers: buildHeaders(user), body: JSON.stringify(body) }).then(r => r.json()),
  put:    (path, body) => fetch(`${BASE}/${path}`, { method: "PUT",    headers: buildHeaders(user), body: JSON.stringify(body) }).then(r => r.json()),
  delete: (path)       => fetch(`${BASE}/${path}`, { method: "DELETE", headers: buildHeaders(user) }).then(r => r.json()),
});

const ok = (res) => { if (!res || res.status === false) throw new Error(res?.message ?? "Request failed"); return res; };

// ── Routes ────────────────────────────────────────────────────────────────────
export const fetchRoutes          = (user)              => api(user).get("getRoutes").then(ok).then(r => r.data ?? []);
export const createRoute          = (user, payload)     => api(user).post("createRoute", payload).then(ok);
export const updateRoute          = (user, id, payload) => api(user).put(`updateRoute/${id}`, payload).then(ok);
export const deleteRoute          = (user, id)          => api(user).delete(`deleteRoute/${id}`).then(ok);

// ── Stops ─────────────────────────────────────────────────────────────────────
export const fetchStops           = (user, routeId)     => api(user).get(`getStops?routeId=${routeId}`).then(ok).then(r => r.data ?? []);
export const createStop           = (user, payload)     => api(user).post("createStop", payload).then(ok);
export const updateStop           = (user, id, payload) => api(user).put(`updateStop/${id}`, payload).then(ok);
export const deleteStop           = (user, id)          => api(user).delete(`deleteStop/${id}`).then(ok);
export const reorderStops         = (user, routeId, orderedIds) => api(user).post("reorderStops", { route_id: routeId, ordered_ids: orderedIds }).then(ok);

// ── Vehicles ──────────────────────────────────────────────────────────────────
export const fetchVehicles        = (user)              => api(user).get("getVehicles").then(ok).then(r => r.data ?? []);
export const createVehicle        = (user, payload)     => api(user).post("createVehicle", payload).then(ok);
export const updateVehicle        = (user, id, payload) => api(user).put(`updateVehicle/${id}`, payload).then(ok);
export const deleteVehicle        = (user, id)          => api(user).delete(`deleteVehicle/${id}`).then(ok);

// ── Drivers ───────────────────────────────────────────────────────────────────
export const fetchDrivers         = (user)              => api(user).get("getDrivers").then(ok).then(r => r.data ?? []);
export const createDriver         = (user, payload)     => api(user).post("createDriver", payload).then(ok);
export const updateDriver         = (user, id, payload) => api(user).put(`updateDriver/${id}`, payload).then(ok);
export const deleteDriver         = (user, id)          => api(user).delete(`deleteDriver/${id}`).then(ok);

// ── Assignments (route + vehicle + driver per session) ────────────────────────
export const fetchAssignments     = (user, sessionId)   => api(user).get(`getAssignments?sessionId=${sessionId}`).then(ok).then(r => r.data ?? []);
export const saveAssignment       = (user, payload)     => api(user).post("saveAssignment", payload).then(ok);
export const deleteAssignment     = (user, id)          => api(user).delete(`deleteAssignment/${id}`).then(ok);

// ── Student enrollments ───────────────────────────────────────────────────────
export const fetchTransportEnrollments = (user, filters = {}) => {
  const p = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v]) => v)));
  return api(user).get(`getTransportEnrollments?${p}`).then(ok).then(r => r.data ?? []);
};
export const enrollStudentTransport   = (user, payload)  => api(user).post("enrollStudentTransport", payload).then(ok);
export const updateTransportEnrollment = (user, id, payload) => api(user).put(`updateTransportEnrollment/${id}`, payload).then(ok);
export const removeTransportEnrollment = (user, id)      => api(user).delete(`removeTransportEnrollment/${id}`).then(ok);

// ── Single student enrollment ───────────────────────────────────────────────────
// Returns the current active transport enrollment for one student, or null
export const fetchStudentTransportEnrollment = async (user, enrollmentId) => {
  try {
    const r = await api(user).get(`getStudentTransportEnrollment?enrollmentId=${enrollmentId}`);
    console.log('[TransportServiceApi] getStudentTransportEnrollment:', JSON.stringify(r));
    return (r && r.status !== false) ? (r.data ?? null) : null;
  } catch (e) {
    console.warn('[TransportServiceApi] fetchStudentTransportEnrollment error:', e.message);
    return null;
  }
};

// ── Summary (dashboard stats) ─────────────────────────────────────────────────
export const fetchTransportSummary = (user, sessionId) =>
  api(user).get(`getTransportSummary?sessionId=${sessionId}`).then(ok).then(r => r.data ?? {});