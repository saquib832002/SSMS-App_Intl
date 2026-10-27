/**
 * services/BusApi.js – live bus tracking.
 * Driver: start a trip, send positions, mark students, end the trip.
 * Parents / students: where is my child's bus. Office: every bus today, one trip, rules, drivers' logins.
 */
import Constants from "expo-constants";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";
import { _t } from "./i18n";

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
    if (e?.name === "AbortError") {
      const err = new Error(_t("The server took too long to answer. Check your connection and try again."));
      err.network = true;
      throw err;
    }
    e.network = true;
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
    e.network = res.status >= 500;
    throw e;
  }
  if (!res.ok || data.status === false) {
    const e = new Error(data.message || _t("Something went wrong. Please try again."));
    e.status = res.status;
    throw e;
  }
  if (data.data === undefined || data.data === null) throw new Error(_t("The server sent an empty reply. Please try again."));
  return data.data;
}

async function call(user, path, method = "GET", body = null, ms = 30000) {
  const res = await timedFetch(`${BASE_URL}/BusTrackingApi/${path}`, {
    method,
    headers: { ...authHeaders(user), "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  }, ms);
  return readReply(res);
}

const qs = (o) => Object.entries(o ?? {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// ── Driver ──────────────────────────────────────────────────────────────
export const getDriverHome = (user) => call(user, "driverHome");
export const startTrip = (user, routeId, direction) => call(user, "startTrip", "POST", { route_id: routeId, direction });
export const getDriverTrip = (user, id) => call(user, `driverTrip?${qs({ id })}`);
/** points: [{lat, lng, speed, heading, accuracy, t}] (t = ms since 1970) */
export const sendPositions = (user, tripId, points) => call(user, "ping", "POST", { trip_id: tripId, points, now: Date.now() }, 20000);
export const markStudent = (user, tripId, eid, status) => call(user, "markStudent", "POST", { trip_id: tripId, enrollment_id: eid, status });
export const endTrip = (user, tripId, force = false) => call(user, "endTrip", "POST", { trip_id: tripId, force: force ? 1 : 0 });

// ── Office ──────────────────────────────────────────────────────────────
export const getLiveBuses = (user) => call(user, "live");
export const getTrip = (user, id) => call(user, `trip?${qs({ id })}`);
export const getBusSettings = (user) => call(user, "settings");
export const saveBusSettings = (user, d) => call(user, "saveSettings", "POST", d).then((r) => r.settings);
export const getBusDrivers = (user) => call(user, "drivers");
export const linkDriver = (user, driverId, username) => call(user, "linkDriver", "POST", { driver_id: driverId, username: username ?? "" });

// ── Buses: driver's phone / bus phone / GPS tracker ─────────────────────
export const getVehicles = (user) => call(user, "vehicles");
export const setVehicleMode = (user, vehicleId, mode, trackerId = "") => call(user, "setVehicleMode", "POST", { vehicle_id: vehicleId, mode, tracker_id: trackerId });
export const getPairCode = (user, vehicleId) => call(user, "pairCode", "POST", { vehicle_id: vehicleId });
export const unpairBusPhone = (user, vehicleId) => call(user, "unpair", "POST", { vehicle_id: vehicleId });
export const newGpsKey = (user) => call(user, "newGpsKey", "POST", {});
/** The full forwarding address for GPS tracker platforms. */
export const gpsUrl = (path) => `${BASE_URL}${path}`;

// ── The bus phone (no login; its own key) ───────────────────────────────
// Plain fetch: these calls must not touch the signed-in user's session (sign-out / session-expired handling).
async function device(path, token, method = "GET", body = null, ms = 25000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  let res;
  try {
    res = await fetch(`${BASE_URL}/hooks/bus/${path}`, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-App-Version": APP_VERSION, ...(token ? { "X-Bus-Device": token } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (e) {
    const err = new Error(e?.name === "AbortError" ? _t("The server took too long to answer. Check your connection and try again.") : _t("No connection to the server."));
    err.network = true;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!data || data.status === false || !res.ok) {
    const err = new Error(data?.message || _t("Something went wrong. Please try again."));
    err.status = res.status;
    err.unpaired = !!data?.unpaired;
    err.network = res.status >= 500;
    throw err;
  }
  return data.data;
}
/** Pair this phone with a bus (school code + the one-time code from the office's QR). Returns { token, … }. */
export const pairBusPhone = (school, code, deviceName) => device("pair", null, "POST", { school, code, device_name: deviceName });
export const busPhoneHome = (token) => device("home", token);
export const busPhonePing = (token, points) => device("ping", token, "POST", { points, now: Date.now() }, 20000);
export const busPhoneTrip = (token, action, direction, routeId) => device("trip", token, "POST", { action, direction, route_id: routeId });
/** QR text from the office: "MMA-BUS|SCHOOL|CODE" → { school, code } or null. */
export const parsePairQr = (text) => {
  const m = /^MMA-BUS\|([A-Za-z0-9_-]+)\|([A-Za-z0-9]{8})$/.exec(String(text ?? "").trim());
  return m ? { school: m[1].toUpperCase(), code: m[2].toUpperCase() } : null;
};

// ── Parents / students ──────────────────────────────────────────────────
export const getMyBus = (user, eid) => call(user, `myBus?${qs({ enrollment_id: eid })}`, "GET", null, 20000);
export const setMyBusAlert = (user, key, on) => call(user, "setMyAlert", "POST", { key, on: on ? 1 : 0 });

// ── Labels ──────────────────────────────────────────────────────────────
export const DIRECTION_LABEL = { pickup: () => _t("Morning pick-up"), drop: () => _t("Afternoon drop") };
export const ageText = (secs) => {
  if (secs == null) return "";
  if (secs < 60) return _t("{n} s ago", { n: Math.max(0, Math.round(secs)) });
  if (secs < 3600) return _t("{n} min ago", { n: Math.round(secs / 60) });
  return _t("{n} h ago", { n: Math.round(secs / 3600) });
};
