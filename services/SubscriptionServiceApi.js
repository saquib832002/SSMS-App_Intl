/**
 * services/SubscriptionServiceApi.js
 * Plan & billing calls for subscription (international) schools.
 *   GET  /SubscriptionApi/getSubscription   → status, plan, trial end, features
 *   GET  /SubscriptionApi/getPlans          → plans + features + Play product ids
 *   POST /SubscriptionApi/syncPlayPurchase  → server re-reads Google Play (RevenueCat) and unlocks features
 */
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";

const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");

const buildHeaders = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

async function call(user, path, method = "GET") {
  const res  = await safeFetch(`${BASE_URL}/SubscriptionApi/${path}`, {
    method,
    headers: buildHeaders(user),
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    throw new Error(data.message || "Something went wrong. Please try again.");
  }
  return data.data;
}

export const fetchSubscriptionStatus = (user) => call(user, "getSubscription");
export const fetchPlans              = (user) => call(user, "getPlans");
export const syncPlayPurchase        = (user) => call(user, "syncPlayPurchase", "POST");
