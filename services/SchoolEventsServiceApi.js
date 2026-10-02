/**
 * services/SchoolEventsServiceApi.js
 * API calls for ssms_school_events (upcoming events & holidays).
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

export const fetchUpcomingEvents = (user, limit = 20) =>
  safeFetch(`${BASE_URL}/SchoolEventsApi/getUpcomingEvents?limit=${limit}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);

export const createEvent = (user, payload) =>
  safeFetch(`${BASE_URL}/SchoolEventsApi/createEvent`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const updateEvent = (user, id, payload) =>
  safeFetch(`${BASE_URL}/SchoolEventsApi/updateEvent/${id}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const deleteEvent = (user, id) =>
  safeFetch(`${BASE_URL}/SchoolEventsApi/deleteEvent/${id}`, {
    method: "DELETE", headers: buildHeaders(user),
  }).then(handleResponse);
