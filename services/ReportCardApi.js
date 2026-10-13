/**
 * services/ReportCardApi.js – grading scales + report cards
 *
 * Owner / admin:  getScales, saveScale, addPresetScale, setDefaultScale, deleteScale,
 *                 getPlans, savePlan, deletePlan, publishPlan
 * Teachers/staff: getCommentSheet, saveComments, getClassReports, getReportCard, emailReportCard
 * Students/parents: getMyReportCards, getReportCard (published only)
 */
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";
import { _t } from "./i18n";

const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");

const buildHeaders = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

async function call(user, path, method = "GET", body = null) {
  const res = await safeFetch(`${BASE_URL}/ReportCardApi/${path}`, {
    method,
    headers: buildHeaders(user),
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    const err = new Error(data.message || _t("Something went wrong. Please try again."));
    err.code = data.code;
    throw err;
  }
  return data;
}

const qs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

// ── Grading scales ──
export const getScales       = async (user) => (await call(user, "scales")).data;          // { scales, presets, builtin }
export const saveScale       = async (user, scale) => (await call(user, "saveScale", "POST", scale)).data.scale;
export const addPresetScale  = async (user, preset, isDefault = false) =>
  (await call(user, "addPresetScale", "POST", { preset, is_default: isDefault })).data.scale;
export const setDefaultScale = async (user, id) => (await call(user, "setDefaultScale", "POST", { id })).data.scales;
export const deleteScale     = async (user, id) => (await call(user, "deleteScale", "POST", { id })).data.scales;

// ── Report card plans ──
export const getPlans    = async (user, sessionId) => (await call(user, `plans?${qs({ sessionId })}`)).data;
export const savePlan    = async (user, plan) => (await call(user, "savePlan", "POST", plan)).data.plan;
export const deletePlan  = async (user, id) => call(user, "deletePlan", "POST", { id });
export const publishPlan = async (user, id, published) =>
  (await call(user, "publishPlan", "POST", { id, published })).data.plan;

// ── Comments ──
export const getCommentSheet = async (user, planId, classId, sectionId) =>
  (await call(user, `commentSheet?${qs({ planId, classId, sectionId })}`)).data;
export const saveComments = async (user, planId, enrollmentId, comments) =>
  call(user, "saveComments", "POST", { planId, enrollmentId, comments });

// ── Report cards ──
export const getClassReports = async (user, planId, classId, sectionId) =>
  (await call(user, `classReports?${qs({ planId, classId, sectionId })}`)).data;
export const getReportCard = async (user, planId, enrollmentId) =>
  (await call(user, `reportCard?${qs({ planId, enrollmentId })}`)).data;
export const emailReportCard = async (user, planId, enrollmentId, pdfBase64, email) =>
  call(user, "emailReportCard", "POST", { planId, enrollmentId, pdfBase64, ...(email ? { email } : {}) });
export const getMyReportCards = async (user) => (await call(user, "myReportCards")).data;
