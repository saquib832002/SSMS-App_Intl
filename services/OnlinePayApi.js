/**
 * services/OnlinePayApi.js – online fee payments (phase 7)
 *
 * School settings (owner / admin):
 *   getPaymentSettings, connectStripe, refreshStripe, saveRazorpay, setOnlineEnabled
 * Paying (parents / students / staff):
 *   getOnlinePayAvailability, createFeePayment, emailPayLink
 * The amount is always calculated on the server from the real fee dues.
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
  const res = await safeFetch(`${BASE_URL}/OnlinePayApi/${path}`, {
    method,
    headers: buildHeaders(user),
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    const err = new Error(data.message || _t("Something went wrong. Please try again."));
    err.code = data.code;           // e.g. "COUNTRY_REQUIRED"
    throw err;
  }
  return data;
}

export const getPaymentSettings  = async (user) => (await call(user, "getSettings")).data;
export const connectStripe       = async (user, country = null) =>
  (await call(user, "connectStripe", "POST", country ? { country } : {})).data;   // { url }
export const refreshStripe       = async (user) => (await call(user, "refreshStripe", "POST")).data;
export const saveRazorpay        = async (user, keyId, keySecret, webhookSecret) =>
  (await call(user, "saveRazorpay", "POST", { key_id: keyId, key_secret: keySecret, webhook_secret: webhookSecret })).data;
export const setOnlineEnabled    = async (user, enabled, provider = null) =>
  (await call(user, "setEnabled", "POST", { enabled, ...(provider ? { provider } : {}) })).data;

/** { available, provider, currency } – never throws (returns unavailable on errors). */
export async function getOnlinePayAvailability(user) {
  try {
    return (await call(user, "availability")).data ?? { available: false };
  } catch {
    return { available: false };
  }
}

/** → { payUrl, amount, currency, id }. items optional: [{ fee_id, fee_item_id }] (default: all due). */
export const createFeePayment = async (user, enrollmentId, items = []) =>
  (await call(user, "createFeePayment", "POST", { enrollment_id: enrollmentId, items })).data;

/** → { status: pending|paid|failed|expired, receipt, amount, currency } */
export const getPaymentStatus = async (user, id) =>
  (await call(user, `paymentStatus?id=${encodeURIComponent(id)}`)).data;

/** Staff: create a link and email it to the parent. → { emailed, message, data: { payUrl, … } } */
export const emailPayLink = async (user, enrollmentId) =>
  call(user, "emailPayLink", "POST", { enrollment_id: enrollmentId });
