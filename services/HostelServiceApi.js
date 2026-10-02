/**
 * services/HostelServiceApi.js
 * All API calls for Hostel Management (buildings, rooms, seats)
 */
import { checkExpired, safeFetch } from './apiInterceptor';
import { BASE_URL } from "./../Environment/EnvironmentConfig";

//const SERVER   = BASE_URL;
const BASE     = `${BASE_URL}/HostelServiceApi`;

const buildHeaders = (user) => ({
  Accept:         "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

const handleResponse = async (res) => {
  // Global 401/403 handler — redirects to Login if token expired
  checkExpired(res);
  const text = await res.text();
  //console.log(`[HostelApi] ${res.status} ${res.url}`);
 // console.log(`[HostelApi] response:`, text.substring(0, 300));
  let json = {};
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.substring(0, 100)}`); }
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

export const fetchBuildings = (user) => {
  const url = `${BASE}/getBuildings`;
  //console.log('[HostelApi] fetchBuildings GET →', url);
  return safeFetch(url, { headers: buildHeaders(user) })
    .then(handleResponse)
    .then(d => d.buildings ?? []);
};

export const saveBuilding = (user, data) => {
  const url = `${BASE}/saveBuilding`;
  //console.log('[HostelApi] saveBuilding POST →', url, JSON.stringify(data));
  return safeFetch(url, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify(data),
  }).then(handleResponse);
};

export const deleteBuilding = (user, buildingId) =>
  safeFetch(`${BASE}/deleteBuilding/${buildingId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ── ROOMS ─────────────────────────────────────────────────────────────────────

export const fetchRooms = (user, buildingId) =>
  safeFetch(`${BASE}/getRooms?buildingId=${buildingId}`, { headers: buildHeaders(user) })
    .then(handleResponse)
    .then(d => d.rooms ?? []);

export const saveRoom = (user, data) =>
  safeFetch(`${BASE}/saveRoom`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify(data),
  }).then(handleResponse);

export const deleteRoom = (user, roomId) =>
  safeFetch(`${BASE}/deleteRoom/${roomId}`, {
    method:  "DELETE",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ── SEATS ─────────────────────────────────────────────────────────────────────

export const fetchSeats = (user, roomId) =>
  safeFetch(`${BASE}/getSeats?roomId=${roomId}`, { headers: buildHeaders(user) })
    .then(handleResponse)
    .then(d => d.seats ?? []);

export const saveSeat = (user, data) =>
  safeFetch(`${BASE}/saveSeat`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify(data),
  }).then(handleResponse);

export const deleteSeat = (user, seatId) =>
  safeFetch(`${BASE}/deleteSeat/${seatId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  }).then(handleResponse);

// ── HOSTEL ENROLLMENT ─────────────────────────────────────────────────────────

/** Fetch existing hostel enrollment for a student (if any) */
export const fetchHostelEnrollment = (user, enrollmentId) =>
  safeFetch(`${BASE}/getHostelEnrollment?enrollmentId=${enrollmentId}`, {
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.enrollment ?? null);

/** Save (insert or update) a hostel enrollment */
export const saveHostelEnrollment = (user, data) =>
  safeFetch(`${BASE}/saveHostelEnrollment`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify(data),
  }).then(handleResponse);

/** De-enroll a student from hostel */
export const deEnrollHostel = (user, hostelEnrollmentId, deEnrollDate) =>
  safeFetch(`${BASE}/deEnrollHostel`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify({ hostelEnrollmentId, deEnrollDate }),
  }).then(handleResponse);

/** Fetch available (unoccupied) seats for a room */
export const fetchAvailableSeats = (user, roomId) =>
  safeFetch(`${BASE}/getAvailableSeats?roomId=${roomId}`, {
    headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.seats ?? []);

  export async function getHostelEnrolledStudents(user, {
        page = 1,
        limit = 20,
        search = "",
        classId = "",
        section = "",
      } = {}) {
        const params = new URLSearchParams();
  
        params.append("page", String(page));
        params.append("limit", String(limit));
  
        if (search.trim()) params.append("search", search.trim());
        if (classId) params.append("classId", classId);
        if (section) params.append("section", section);
        const response = await safeFetch(`${BASE}/getHostelEnrolledStudents?${params.toString()}`, {
          method: "GET",
          headers: buildHeaders(user),
        });
         
        const data = await response.json();
        if (!response.status || !response.ok) {
          throw new Error(data.message || "Failed to load students");
        }
  
        return {
          students: data.data || [],
          pagination: data.pagination || {},
        };
      }
  
  export const updateHostelEnrollment = async (user, payload) => {
    const res  = await safeFetch(`${BASE}/updateEnrollment`, {
      method:  'PUT',
      headers: buildHeaders(user),
      body:    JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status === false)
      throw new Error(json.message ?? `HTTP ${res.status}`);
    return json;
  };