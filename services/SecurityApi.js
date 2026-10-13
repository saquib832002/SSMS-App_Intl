/**
 * services/SecurityApi.js – two-step login, sign-ins, security settings, audit log,
 * roles & permissions, consents and data requests.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";

import { fmtDate, fmtTime } from "./Locale";
import { _t } from "./i18n";
const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");
export const APP_VERSION = Constants.expoConfig?.version ?? "";

const headers = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-App-Version": APP_VERSION,
  Authorization: user?.token ? `Bearer ${user.token}` : "",
});

async function call(user, path, method = "GET", body = null) {
  const res = await safeFetch(`${BASE_URL}/${path}`, {
    method,
    headers: headers(user),
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    const e = new Error(data.message || _t("Something went wrong. Please try again."));
    e.code = data.code;
    throw e;
  }
  return data.data;
}

const qs = (o) => Object.entries(o ?? {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

// ── Sign-in (no token yet) ─────────────────────────────────────────────────
async function publicPost(path, body) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-App-Version": APP_VERSION, "X-App-Mfa": "1" },
    body: JSON.stringify(body ?? {}),
  });
  const raw = await res.text();
  const start = raw.indexOf("{");
  let data = {};
  try { data = JSON.parse(start >= 0 ? raw.slice(start) : raw); } catch { data = {}; }
  return data;   // { status, message, data }
}

export const deviceLabel = () => {
  const name = Constants.deviceName || (Platform.OS === "ios" ? "iPhone" : "Android phone");
  return `${name} · app`;
};

const trustKey = (username) => `mma_trust_${String(username || "").toLowerCase()}`;
export const getTrustToken = async (username) => {
  try { return (await AsyncStorage.getItem(trustKey(username))) || ""; } catch { return ""; }
};
export const saveTrustToken = async (username, token) => {
  try { if (token) await AsyncStorage.setItem(trustKey(username), token); } catch { /* ignore */ }
};
export const clearTrustToken = async (username) => {
  try { await AsyncStorage.removeItem(trustKey(username)); } catch { /* ignore */ }
};

/** Step 1: password. Returns the raw reply; data.mfa_required means a code is needed. */
export const loginWithPassword = async (username, password) => publicPost("UserServiceApi/login", {
  username, password, app_mfa: 1, platform: Platform.OS, device_label: deviceLabel(),
  device_token: await getTrustToken(username),
});
export const loginVerify = (challenge, method, code, trust) => publicPost("UserServiceApi/loginVerify", {
  challenge, method, code, trust_device: trust ? 1 : 0, device_label: deviceLabel(), platform: Platform.OS,
});
export const loginEmailCode = (challenge) => publicPost("UserServiceApi/loginEmailCode", { challenge });
export const loginSetupStart = (challenge) => publicPost("UserServiceApi/mfaSetupStart", { challenge });
export const loginSetupConfirm = (challenge, code, trust) => publicPost("UserServiceApi/mfaSetupConfirm", {
  challenge, code, trust_device: trust ? 1 : 0, device_label: deviceLabel(), platform: Platform.OS,
});

/** Login reply → the user object the app keeps (same shape LoginScreen used before). */
export const toUserData = (data) => ({
  ssmsUserName:   data.ssmsUserName   ?? data.username    ?? "",
  firstName:      data.firstName      ?? "",
  lastName:       data.lastName       ?? "",
  userEmail:      data.userEmail      ?? data.email       ?? "",
  ssmsUserRole:   data.ssmsUserRole   ?? data.role        ?? "",
  ssmsClientCode: data.ssmsClientCode ?? data.client_code ?? "",
  token:          data.token          ?? "",
  expiresAt:      data.expiresAt      ?? null,
  branchId:       data.branchId       ?? null,
  enrollmentId:   data.enrollmentId   ?? data.enrollment_id ?? null,
  staffId:        data.staffId        ?? null,
  schoolCountry:  data.schoolCountry  ?? "",
  billingModel:   data.billingModel === "subscription" ? "subscription" : "legacy",
  activeModules:  Array.isArray(data.activeModules) ? data.activeModules : ["school"],
  activeFeatures: Array.isArray(data.activeFeatures) ? data.activeFeatures : ["core"],
  permissions:    data.permissions && typeof data.permissions === "object" ? data.permissions : null,
  mfaEnabled:     !!data.mfaEnabled,
  mfaSetupDue:    data.mfaSetupDue ?? null,
});

// ── My security ────────────────────────────────────────────────────────────
export const getSecurityStatus = (user) => call(user, "SecurityApi/status");
export const mfaStart        = (user) => call(user, "SecurityApi/mfaStart", "POST");
export const mfaConfirm      = (user, code) => call(user, "SecurityApi/mfaConfirm", "POST", { code });
export const mfaDisable      = (user, code) => call(user, "SecurityApi/mfaDisable", "POST", { code });
export const newBackupCodes  = (user, code) => call(user, "SecurityApi/backupCodes", "POST", { code });
export const forgetDevices   = (user, id) => call(user, "SecurityApi/forgetDevices", "POST", id ? { id } : {});
export const revokeSession   = (user, ref) => call(user, "SecurityApi/revokeSession", "POST", { ref });
export const signOutEverywhere = (user, keepCurrent) => call(user, "SecurityApi/signOutEverywhere", "POST", { keep_current: keepCurrent ? 1 : 0 });
export const serverLogout = async (user) => {
  try {
    await fetch(`${BASE_URL}/SecurityApi/logout`, { method: "POST", headers: headers(user), body: "{}" });
  } catch { /* offline – the sign-in simply expires */ }
};

// ── School security (owner / admin) ────────────────────────────────────────
export const getSecuritySettings  = (user) => call(user, "SecurityApi/settings");
export const saveSecuritySettings = (user, s) => call(user, "SecurityApi/saveSettings", "POST", s);
export const getSecurityPeople    = (user) => call(user, "SecurityApi/people");
export const resetMfaFor          = (user, username, code) => call(user, "SecurityApi/resetMfa", "POST", { username, code });
export const sendSetPasswordLink  = (user, username) => call(user, "SecurityApi/sendSetPasswordLink", "POST", { username });

// ── Audit log ──────────────────────────────────────────────────────────────
export const getAuditLog   = (user, f) => call(user, `AuditApi/list?${qs(f)}`);
export const getAuditEntry = (user, id) => call(user, `AuditApi/entry?id=${id}`);
export const verifyAudit   = (user) => call(user, "AuditApi/verify");
export const exportAuditCsv = async (user, f) => {
  const target = `${FileSystem.cacheDirectory}audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  const r = await FileSystem.downloadAsync(`${BASE_URL}/AuditApi/export?${qs(f)}`, target, { headers: headers(user) });
  if (r.status !== 200) throw new Error(_t("Could not export the audit log."));
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(r.uri, { mimeType: "text/csv", dialogTitle: "Audit log" });
  return r.uri;
};

// ── Roles & permissions ────────────────────────────────────────────────────
export const getRoles   = (user) => call(user, "RolesApi/list");
export const getRole    = (user, key) => call(user, `RolesApi/role?key=${encodeURIComponent(key)}`);
export const saveRole   = (user, body) => call(user, "RolesApi/save", "POST", body);
export const removeRole = (user, key, code) => call(user, "RolesApi/remove", "POST", { key, code });
export const getRolePeople = (user) => call(user, "RolesApi/people");
export const assignRole = (user, username, key) => call(user, "RolesApi/assign", "POST", { username, key });
export const getMyPermissions = (user) => call(user, "RolesApi/mine");

// ── Consents ───────────────────────────────────────────────────────────────
export const getPendingConsents = (user) => call(user, "PrivacyApi/pending");
export const answerConsents     = (user, answers) => call(user, "PrivacyApi/answer", "POST", { answers });
export const getMyPrivacy       = (user) => call(user, "PrivacyApi/mine");
export const getConsentReport   = (user, f) => call(user, `PrivacyApi/consentReport?${qs(f)}`);
export const getConsentTypes    = (user) => call(user, "PrivacyApi/consentTypes");
export const saveConsentType    = (user, t) => call(user, "PrivacyApi/saveConsentType", "POST", t);
export const recordPaperConsent = (user, body) => call(user, "PrivacyApi/recordPaper", "POST", body);

// ── Data requests ──────────────────────────────────────────────────────────
export const askPrivacy        = (user, body) => call(user, "PrivacyApi/ask", "POST", body);
export const withdrawPrivacy   = (user, id) => call(user, "PrivacyApi/withdraw", "POST", { id });
export const getPrivacyRequests = (user, status) => call(user, `PrivacyApi/requests?status=${status || "open"}`);
export const getPrivacyOpenCount = async (user) => (await call(user, "PrivacyApi/openCount"))?.open ?? 0;
export const logPrivacyRequest = (user, body) => call(user, "PrivacyApi/logRequest", "POST", body);
export const getDeletionPlan   = (user, id) => call(user, `PrivacyApi/plan?id=${id}`);
export const setPrivacyStatus  = (user, id, status, note) => call(user, "PrivacyApi/setStatus", "POST", { id, status, note });
export const approveDeletion   = (user, id, code) => call(user, "PrivacyApi/approveDelete", "POST", { id, code });
export const downloadPrivacyCopy = async (user, req) => {
  const ext = /\.html$/.test(req.file_name || "") ? "html" : "zip";
  const target = `${FileSystem.cacheDirectory}${(req.file_name || `data-${req.id}.${ext}`).replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const r = await FileSystem.downloadAsync(`${BASE_URL}/PrivacyApi/download?id=${req.id}`, target, { headers: headers(user) });
  if (r.status !== 200) {
    let msg = "Could not download the file.";
    try { msg = JSON.parse(await FileSystem.readAsStringAsync(r.uri)).message || msg; } catch { /* binary */ }
    throw new Error(msg);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(r.uri, { mimeType: ext === "zip" ? "application/zip" : "text/html", dialogTitle: "Your data" });
  }
  return r.uri;
};

// ── labels ─────────────────────────────────────────────────────────────────
export const ROLE_LABEL = { owner: "Owner", admin: "Admin", principal: "Principal", user: "Teacher", teacher: "Teacher",
  staff: "Staff", accountant: "Accountant", parent: "Parent", student: "Student" };
export const REQUEST_LABEL = { export: "Copy of data", correction: "Correction", delete: "Deletion" };
export const REQUEST_STATUS = {
  pending:   { get label() { return _t("Waiting"); },       bg: "#fef3c7", fg: "#92400e" },
  in_review: { get label() { return _t("In review"); },     bg: "#e0e7ff", fg: "#3730a3" },
  ready:     { get label() { return _t("Ready"); },         bg: "#dcfce7", fg: "#15803d" },
  scheduled: { get label() { return _t("Scheduled"); },     bg: "#fee2e2", fg: "#b91c1c" },
  done:      { get label() { return _t("Done"); },          bg: "#dcfce7", fg: "#15803d" },
  rejected:  { get label() { return _t("Not possible"); },  bg: "#f1f5f9", fg: "#475569" },
  cancelled: { get label() { return _t("Cancelled"); },     bg: "#f1f5f9", fg: "#64748b" },
  expired:   { get label() { return _t("Link expired"); },  bg: "#f1f5f9", fg: "#64748b" },
};
export const AUDIT_COLOR = { security: "#b91c1c", access: "#5b21b6", records: "#b45309", money: "#15803d", privacy: "#1d4ed8", settings: "#475569" };
export const niceWhen = (s) => {
  if (!s) return "";
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d) ? s : `${fmtDate(d, "dayMonth")}, ${fmtTime(d)}`;
};
