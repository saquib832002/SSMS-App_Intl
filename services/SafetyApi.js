/**
 * services/SafetyApi.js – visitor management and authorised pick-up.
 * Reception: sign visitors in / out, expected visitors (pass code), watch list, log, CSV, badge.
 * Gate: find a student, see who may collect them (with photos), hand over / refuse, class dismissal list.
 * Parents: who may collect my child, add a one-off person (with a code) or a regular one.
 */
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Alert } from "react-native";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW, HOST_NAME } from "../Environment/EnvironmentConfig";
import { _t, _tx } from "./i18n";

const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");
const APP_VERSION = Constants.expoConfig?.version ?? "";

export const authHeaders = (user) => ({
  Accept: "application/json",
  "X-App-Version": APP_VERSION,
  Authorization: user?.token ? `Bearer ${user.token}` : "",
});

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

async function readReply(res) {
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = JSON.parse(text); } catch {
    const at = text.indexOf('{"status"');
    if (at > 0) { try { data = JSON.parse(text.slice(at)); } catch { data = null; } }
  }
  if (!data || typeof data !== "object") {
    const e = new Error(_t("The server sent an unexpected reply (HTTP {status}).", { status: res.status }));
    e.status = res.status;
    throw e;
  }
  if (!res.ok || data.status === false) {
    const e = new Error(data.message || (res.status === 413 ? _t("The file is too big for the server.") : _t("Something went wrong. Please try again.")));
    e.status = res.status;
    throw e;
  }
  if (data.data === undefined || data.data === null) throw new Error(_t("The server sent an empty reply. Please try again."));
  return data.data;
}

async function call(user, path, method = "GET", body = null) {
  const res = await timedFetch(`${BASE_URL}/SafetyApi/${path}`, {
    method,
    headers: { ...authHeaders(user), "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  }, 30000);
  return readReply(res);
}

const qs = (o) => Object.entries(o ?? {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// ── Visitors ────────────────────────────────────────────────────────────
export const getVisitorsToday = (user, date) => call(user, `visitorsToday?${qs({ date })}`);
export const lookupVisitor = (user, phone) => call(user, `lookupVisitor?${qs({ phone })}`);
export const signInVisitor = (user, d) => call(user, "signIn", "POST", d);
export const signOutVisitor = (user, id) => call(user, "signOut", "POST", { id });
export const signOutAll = (user) => call(user, "signOutAll", "POST", {});
export const findByCode = (user, code) => call(user, "findByCode", "POST", { code });
export const getVisitHistory = (user, f) => call(user, `history?${qs(f)}`);
export const deleteVisit = (user, id) => call(user, "deleteVisit", "POST", { id });
export const getWatchlist = (user) => call(user, "watchlist");
export const saveWatch = (user, d) => call(user, "saveWatch", "POST", d);
export const removeWatch = (user, id) => call(user, "removeWatch", "POST", { id });
export const getSafetySettings = (user) => call(user, "settings");
export const saveSafetySettings = (user, d) => call(user, "saveSettings", "POST", d);
export const getMyVisitors = (user) => call(user, "myVisitors");
export const expectVisitor = (user, d) => call(user, "expectVisitor", "POST", d);
export const cancelExpected = (user, id) => call(user, "cancelExpected", "POST", { id });
export const newVisitCode = (user, id) => call(user, "newVisitCode", "POST", { id });
/** The text to send a guest (or a group) with their pass code. */
export const passCodeMessage = (code, visits, fmt) => {
  const v = visits?.[0] ?? {};
  const names = (visits ?? []).map((x) => x.name).join(", ");
  return _t("Your visit on {date}{time}: show this pass code at reception – {code}", {
    date: fmt.date(v.date), time: v.expected_time ? ` ${_t("at {time}", { time: fmt.time(v.expected_time) })}` : "", code })
    + (visits?.length > 1 ? `\n${_t("Guests: {names}", { names })}` : "");
};
export const getStaff = (user) => call(user, "staff").then((d) => d.staff ?? []);

// ── Pick-up ─────────────────────────────────────────────────────────────
export const searchStudents = (user, q) => call(user, `searchStudents?${qs({ q })}`).then((d) => d.students ?? []);
export const getPickupCard = (user, eid) => call(user, `pickupCard?${qs({ enrollment_id: eid })}`);
export const recordPickup = (user, d) => call(user, "recordPickup", "POST", d);
export const refusePickup = (user, d) => call(user, "refusePickup", "POST", d);
export const getPickupLog = (user, f) => call(user, `pickupLog?${qs(f)}`);
export const getPersons = (user, eid) => call(user, `persons?${qs({ enrollment_id: eid })}`);
export const savePerson = (user, eid, d) => call(user, "savePerson", "POST", { ...d, enrollment_id: eid });
export const approvePerson = (user, id, approve) => call(user, "approvePerson", "POST", { id, approve: approve ? 1 : 0 });
export const removePerson = (user, id) => call(user, "removePerson", "POST", { id });

// ── Parents ─────────────────────────────────────────────────────────────
export const getMyPickup = (user, eid) => call(user, `myPickup?${qs({ enrollment_id: eid })}`);
export const addMyPerson = (user, eid, d) => call(user, "addMyPerson", "POST", { ...d, enrollment_id: eid });
export const removeMyPerson = (user, eid, id) => call(user, "removeMyPerson", "POST", { enrollment_id: eid, id });
export const newMyCode = (user, eid, id) => call(user, "newMyCode", "POST", { enrollment_id: eid, id });

// ── Photos ──────────────────────────────────────────────────────────────
/** Image source for a stored photo (sent with the sign-in, never a public link). */
export const photoSource = (user, type, id, eid, v = 0) => ({
  uri: `${BASE_URL}/SafetyApi/photo?${qs({ type, id, enrollment_id: eid, v })}`,
  headers: authHeaders(user),
});

/** The student's own photo (the school's student folder). */
export const studentPhotoUri = (user, s) => (s?.photo && s?.registration_id
  ? `${HOST_NAME}/clients/${user?.ssmsClientCode}/Students/${s.registration_id}/${s.photo}` : null);

/** Take (or pick) a photo, made small (640 px, JPEG) before it is sent. → { uri, base64 } or null */
export async function takePhoto({ camera = true } = {}) {
  try {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(_t("Permission needed"), camera ? _t("Allow camera access to take a photo.") : _t("Allow access to your photos to choose one."));
      return null;
    }
    const opts = { mediaTypes: "images", quality: 0.8, allowsEditing: true, aspect: [3, 4] };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.[0]?.uri) return null;
    const small = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 640 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    return { uri: small.uri, base64: small.base64 };
  } catch (e) {
    Alert.alert(_t("Camera Error"), _tx(e?.message) ?? String(e));
    return null;
  }
}

async function sendPhoto(user, path, fields, photo) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  form.append("file", { uri: photo.uri, name: "photo.jpg", type: "image/jpeg" });
  const res = await timedFetch(`${BASE_URL}/SafetyApi/${path}`, { method: "POST", headers: authHeaders(user), body: form }, 120000);
  return readReply(res);
}
export const uploadPhoto = (user, type, id, photo) => sendPhoto(user, "uploadPhoto", { type, id }, photo);
export const uploadMyPersonPhoto = (user, eid, id, photo) => sendPhoto(user, "myPersonPhoto", { enrollment_id: eid, id }, photo);

/** A stored photo as a data: URI (for the printed badge). */
export async function photoDataUri(user, type, id) {
  const target = `${FileSystem.cacheDirectory}badge_${type}_${id}_${Date.now()}.jpg`;
  try {
    const r = await FileSystem.downloadAsync(`${BASE_URL}/SafetyApi/photo?${qs({ type, id })}`, target, { headers: authHeaders(user) });
    if (r.status !== 200) return null;
    const b64 = await FileSystem.readAsStringAsync(r.uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/jpeg;base64,${b64}`;
  } catch { return null; } finally {
    FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  }
}

/** Download the visitor log as CSV and open the share sheet. */
export async function exportVisitsCsv(user, f) {
  const target = `${FileSystem.cacheDirectory}visitors_${Date.now()}.csv`;
  const r = await FileSystem.downloadAsync(`${BASE_URL}/SafetyApi/exportVisits?${qs(f)}`, target, { headers: authHeaders(user) });
  if (r.status !== 200) {
    let msg = _t("Something went wrong. Please try again.");
    try { msg = JSON.parse(await FileSystem.readAsStringAsync(r.uri)).message || msg; } catch { /* not JSON */ }
    FileSystem.deleteAsync(r.uri, { idempotent: true }).catch(() => {});
    throw new Error(msg);
  }
  try {
    await Sharing.shareAsync(r.uri, { mimeType: "text/csv", dialogTitle: _t("Visitor log") });
  } finally {
    setTimeout(() => FileSystem.deleteAsync(r.uri, { idempotent: true }).catch(() => {}), 5 * 60 * 1000);
  }
}

// ── Labels ──────────────────────────────────────────────────────────────
export const STATUS_LABEL = {
  expected: () => _t("Expected"), in: () => _t("On site"), out: () => _t("Left"), denied: () => _t("Refused"),
  cancelled: () => _t("Cancelled"), no_show: () => _t("Did not come"),
};
export const opts = (map) => Object.entries(map ?? {}).map(([value, label]) => ({ value, label: _tx(label) }));
export const hm = (dt) => (dt ? String(dt).slice(11, 16) : "");
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
