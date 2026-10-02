/**
 * services/NoticeServiceApi.js
 * API calls for ssms_notices (school notice board / circulars).
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

/** Fetch notices list.
 *  @param {object} user
 *  @param {object} opts  { limit?, category?, priority? }
 */
export const fetchNotices = (user, opts = {}) => {
  const params = new URLSearchParams();
  if (opts.limit)    params.set("limit",    String(opts.limit));
  if (opts.category) params.set("category", opts.category);
  if (opts.priority) params.set("priority", opts.priority);
  const qs = params.toString() ? `?${params}` : "";
  return safeFetch(`${BASE_URL}/NoticeApi/list${qs}`, {
    method: "GET", headers: buildHeaders(user),
  }).then(handleResponse).then(d => d.data ?? []);
};

export const createNotice = (user, payload) =>
  safeFetch(`${BASE_URL}/NoticeApi/create`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const updateNotice = (user, id, payload) =>
  safeFetch(`${BASE_URL}/NoticeApi/update/${id}`, {
    method: "POST", headers: buildHeaders(user),
    body: JSON.stringify(payload),
  }).then(handleResponse);

export const deleteNotice = (user, id) =>
  safeFetch(`${BASE_URL}/NoticeApi/delete/${id}`, {
    method: "POST", headers: buildHeaders(user),
  }).then(handleResponse);
