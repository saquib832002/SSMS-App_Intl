/**
 * services/StudentRecordApi.js – the complete student record:
 * guardians, emergency contacts, medical & allergies, documents and custom fields.
 * Every student call names the student with { registrationId } or { enrollmentId }.
 */
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";
import { _t } from "./i18n";

const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");
const APP_VERSION = Constants.expoConfig?.version ?? "";

const auth = (user) => ({
  Accept: "application/json",
  "X-App-Version": APP_VERSION,
  Authorization: user?.token ? `Bearer ${user.token}` : "",
});

const fail = (data, res) => {
  const e = new Error(data?.message || (res?.status === 413 ? _t("The file is too big for the server.") : _t("Something went wrong. Please try again.")));
  e.code = data?.code;
  e.status = res?.status;
  return e;
};

/** fetch that gives up after `ms` instead of spinning forever (slow / unreachable server). */
async function timedFetch(url, opts, ms) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await safeFetch(url, { ...opts, ...(ctrl ? { signal: ctrl.signal } : {}) });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(_t("The server took too long to answer. Check your connection and try again."));
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Read the server's JSON reply. A reply that isn't the expected JSON (an error page,
 * PHP warnings in front of the JSON, a login page …) becomes a clear error instead of
 * an empty result – an empty result used to leave the screen loading for ever.
 */
async function readReply(res) {
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = JSON.parse(text); } catch {
    const at = text.indexOf('{"status"');
    if (at > 0) { try { data = JSON.parse(text.slice(at)); } catch { data = null; } }
  }
  if (!data || typeof data !== "object") {
    const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    const e = new Error(_t("The server sent an unexpected reply (HTTP {status}).{v}", { status: res.status, v: snippet ? ` ${snippet}` : "" }));
    e.status = res.status;
    throw e;
  }
  if (!res.ok || data.status === false) throw fail(data, res);
  if (data.data === undefined || data.data === null) {
    const e = new Error(_t("The server sent an empty reply. Please try again."));
    e.status = res.status;
    throw e;
  }
  return data.data;
}

async function call(user, path, method = "GET", body = null) {
  const res = await timedFetch(`${BASE_URL}/StudentRecordApi/${path}`, {
    method,
    headers: { ...auth(user), "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  }, 30000);
  return readReply(res);
}

const qs = (o) => Object.entries(o ?? {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/** who: { registrationId } or { enrollmentId } → body keys */
const who = (w) => ({ registration_id: w?.registrationId || undefined, enrollment_id: w?.registrationId ? undefined : (w?.enrollmentId || undefined) });

export const getStudentRecord = (user, w) => call(user, `record?${qs({ registrationId: w?.registrationId, enrollmentId: w?.registrationId ? "" : w?.enrollmentId })}`);

export const saveGuardian   = (user, w, g) => call(user, "saveGuardian", "POST", { ...g, ...who(w) });
export const removeGuardian = (user, w, id) => call(user, "removeGuardian", "POST", { id, ...who(w) });
export const saveContact    = (user, w, c) => call(user, "saveContact", "POST", { ...c, ...who(w) });
export const removeContact  = (user, w, id) => call(user, "removeContact", "POST", { id, ...who(w) });
export const saveMedical    = (user, w, m) => call(user, "saveMedical", "POST", { ...m, ...who(w) });
export const saveFieldValues = (user, w, values) => call(user, "saveFields", "POST", { values, ...who(w) });
export const updateDocument = (user, w, d) => call(user, "updateDocument", "POST", { ...d, ...who(w) });
export const deleteDocument = (user, w, id) => call(user, "deleteDocument", "POST", { id, ...who(w) });

export const getMedicalList = (user, f) => call(user, `medicalList?${qs(f)}`);
export const getExpiringDocuments = (user, days = 60) => call(user, `expiringDocuments?days=${days}`);
export const getFieldDefs = (user, all = false) => call(user, `fieldDefs${all ? "?all=1" : ""}`);
export const saveFieldDef = (user, f) => call(user, "saveFieldDef", "POST", f);

/** file: { uri, name, type } from the document / image picker. meta: doc_type, title, doc_number, expires_on, visible_to_parent */
export async function uploadDocument(user, w, file, meta) {
  const form = new FormData();
  const b = who(w);
  if (b.registration_id) form.append("registration_id", b.registration_id);
  if (b.enrollment_id) form.append("enrollment_id", b.enrollment_id);
  Object.entries(meta ?? {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    form.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  });
  form.append("file", { uri: file.uri, name: file.name || "document", type: file.type || "application/octet-stream" });
  // sent by XMLHttpRequest (apiInterceptor) – the app's fetch can't send file parts
  const res = await timedFetch(`${BASE_URL}/StudentRecordApi/uploadDocument`, { method: "POST", headers: auth(user), body: form }, 180000);
  return readReply(res);
}

/** Download a document and open the share / preview sheet. */
export async function openDocument(user, w, doc) {
  const safe = (doc.file_name || `document-${doc.id}`).replace(/[^A-Za-z0-9._-]/g, "_");
  const target = `${FileSystem.cacheDirectory}${Date.now()}_${safe}`;
  const url = `${BASE_URL}/StudentRecordApi/downloadDocument?${qs({ registrationId: w?.registrationId, enrollmentId: w?.registrationId ? "" : w?.enrollmentId, id: doc.id })}`;
  const r = await FileSystem.downloadAsync(url, target, { headers: auth(user) });
  if (r.status !== 200) {
    let msg = "Could not open the document.";
    try { msg = JSON.parse(await FileSystem.readAsStringAsync(r.uri)).message || msg; } catch { /* binary */ }
    FileSystem.deleteAsync(r.uri, { idempotent: true }).catch(() => {});
    throw new Error(msg);
  }
  // don't leave copies of passports / medical papers in the app's cache
  const cleanUp = () => setTimeout(() => FileSystem.deleteAsync(r.uri, { idempotent: true }).catch(() => {}), 5 * 60 * 1000);
  if (!(await Sharing.isAvailableAsync())) {
    FileSystem.deleteAsync(r.uri, { idempotent: true }).catch(() => {});
    throw new Error(_t("Sharing isn't available on this device."));
  }
  try {
    await Sharing.shareAsync(r.uri, { mimeType: doc.mime || undefined, dialogTitle: doc.title || "Document" });
  } finally {
    cleanUp();
  }
  return r.uri;
}

/** Children a parent / student can open (same list as absence notes). */
export async function getMyChildren(user) {
  const res = await timedFetch(`${BASE_URL}/StudentLeaveApi/myChildren`, { headers: { ...auth(user), "Content-Type": "application/json" } }, 30000);
  const list = await readReply(res);
  return Array.isArray(list) ? list : [];
}

export const ALERT_STYLE = {
  severe:  { get label() { return _t("Severe"); }, bg: "#fee2e2", fg: "#991b1b" },
  serious: { get label() { return _t("Serious"); }, bg: "#ffedd5", fg: "#9a3412" },
  info:    { get label() { return _t("Info"); }, bg: "#e0f2fe", fg: "#075985" },
  none:    { get label() { return _t("None"); }, bg: "#f1f5f9", fg: "#475569" },
};

export const FIELD_TYPE_LABEL = {
  get text() { return _t("Short text"); }, long_text: "Long text", number: "Number", date: "Date", select: "List (choose one)",
  yes_no: "Yes / No", phone: "Phone number", email: "E-mail",
};
