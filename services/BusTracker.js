/**
 * services/BusTracker.js – the driver's phone shares the bus position while a trip runs.
 *
 * - Foreground: a location watcher (every ~10 s / 15 m).
 * - Background (screen off, app closed): expo-task-manager + an Android foreground-service notification, when the
 *   app build includes expo-task-manager and the driver allowed "all the time" location. Otherwise the driver is
 *   told to keep the app open.
 * - Positions are queued on the phone and sent in batches, so a tunnel or no signal loses nothing: they are sent
 *   when the network is back (the server keeps the late ones for the history and uses the newest one).
 * - When the server says the trip ended (driver, office, or no position for a long time), sharing stops.
 *
 * Import this file once when the app starts (index.js) so the background task is defined before Android wakes it.
 */
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { sendPositions } from "./BusApi";
import { _t } from "./i18n";

let TaskManager = null;
try { TaskManager = require("expo-task-manager"); } catch { TaskManager = null; }

export const TASK = "mma-bus-location";
const STATE_KEY = "mma.bus.trip.v1";   // { tripId, token, username, startedAt, mode }
const QUEUE_KEY = "mma.bus.queue.v1";  // positions not sent yet
const MAX_QUEUE = 3000;
const BATCH = 100;

let watcher = null;
let chain = Promise.resolve();
/** Queue changes one after the other (the watcher, the background task and sending all touch it). */
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
let timer = null;
let flushing = false;
let appSub = null;
const listeners = new Set();
let status = { active: false, tripId: null, mode: null, queued: 0, lastSentAt: null, lastFix: null, error: null, trip: null };

const emit = (patch) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => { try { fn(status); } catch { /* a screen went away */ } });
};
export const subscribe = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
export const getStatus = () => status;

const toPoint = (loc) => ({
  lat: loc?.coords?.latitude, lng: loc?.coords?.longitude,
  speed: loc?.coords?.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null,
  heading: loc?.coords?.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null,
  accuracy: loc?.coords?.accuracy ?? null, t: loc?.timestamp ?? Date.now(),
});

async function readState() {
  try { const s = await AsyncStorage.getItem(STATE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
async function readQueue() {
  try { const s = await AsyncStorage.getItem(QUEUE_KEY); const q = s ? JSON.parse(s) : []; return Array.isArray(q) ? q : []; } catch { return []; }
}
async function writeQueue(q) {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* full storage: keep going */ }
}

function enqueue(points) {
  const good = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!good.length) return Promise.resolve();
  return serial(async () => {
    const st = await readState();
    if (!st?.tripId) return;   // no trip on this phone (a late report after the end)
    good.forEach((p) => { p.trip = st.tripId; });
    const q = await readQueue();
    for (const p of good) {
      const last = q[q.length - 1];
      if (last && p.t <= last.t) continue;   // the watcher and the background task can both report the same fix
      q.push(p);
    }
    await writeQueue(q);
    emit({ queued: q.length, lastFix: good[good.length - 1] });
  });
}

/**
 * Remove what was sent (this trip, up to time t). Positions of the trip now running on the phone are kept – a send
 * that was still running when a new trip started must not delete them; positions of other trips are dropped.
 * Returns what is left for the trip that was being sent.
 */
async function dropSent(tripId, t) {
  const cur = (await readState())?.tripId ?? null;
  const rest = (await readQueue()).filter((p) => p.trip === cur && (p.trip !== tripId || p.t > t));
  await writeQueue(rest);
  return rest.filter((p) => p.trip === tripId);
}

/** Send what is queued. Returns the server's answer for the last batch (or null). */
export async function flush() {
  if (flushing) return null;
  flushing = true;
  let reply = null;
  try {
    const st = await readState();
    if (!st?.tripId || !st?.token) return null;
    // only this trip's positions (a send that was still running when a new trip started cannot mix them)
    let q = (await serial(readQueue)).filter((p) => p.trip === st.tripId);
    while (q.length) {
      const batch = q.slice(0, BATCH).map(({ trip, ...p }) => p);
      try {
        reply = await sendPositions({ token: st.token }, st.tripId, batch);
      } catch (e) {
        const signedOut = e?.status === 401 || e?.name === "LoggedOutError";
        emit({ error: signedOut ? _t("Signed out – sign in again to keep sharing the bus location.") : (e?.network ? _t("No connection – positions are kept and sent later.") : (e?.message ?? String(e))) });
        if (!e?.network && !signedOut && e?.status !== 429) {
          // the server refused them (e.g. not your trip any more): drop this batch, do not retry for ever
          const lastT = batch[batch.length - 1].t;
          q = await serial(() => dropSent(st.tripId, lastT));
          emit({ queued: q.length });
          if (/not found|not the driver/i.test(e?.message ?? "")) await stopSharing({ skipFlush: true });
        }
        return null;
      }
      const sentT = batch[batch.length - 1].t;
      q = await serial(() => dropSent(st.tripId, sentT));
      emit({ queued: q.length, lastSentAt: Date.now(), error: null, trip: reply?.trip ?? status.trip });
      if (reply?.ended) {
        await stopSharing({ skipFlush: true, ended: true });
        break;
      }
    }
    return reply;
  } finally {
    flushing = false;
  }
}

if (TaskManager?.defineTask) {
  try {
    TaskManager.defineTask(TASK, async ({ data, error }) => {
      if (error) return;
      const locs = data?.locations ?? [];
      if (locs.length) await enqueue(locs.map(toPoint));
      await flush();
    });
  } catch { /* defined twice in a fast refresh */ }
}

export const backgroundSupported = () => !!(TaskManager?.defineTask && Location.startLocationUpdatesAsync);

/**
 * Start sharing for a trip. askBackground: request "all the time" location (after the driver read why).
 * Returns { mode: "background" | "foreground" }.
 */
export async function startSharing(user, tripId, { askBackground = true } = {}) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") throw new Error(_t("Allow location for this app so the bus can be shown to parents."));
  let mode = "foreground";
  if (askBackground && backgroundSupported()) {
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === "granted") mode = "background";
    } catch { /* this build has no background location */ }
  }
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify({ tripId, token: user?.token, username: user?.ssmsUserName ?? "", startedAt: Date.now(), mode }));
  await serial(() => writeQueue([]));
  emit({ active: true, tripId, mode, queued: 0, error: null, ended: false, trip: null });
  await startWatch(mode);
  return { mode };
}

let starting = null;
function startWatch(mode) {
  if (!starting) starting = doStartWatch(mode).finally(() => { starting = null; });
  return starting;
}

let gen = 0;
async function doStartWatch(mode) {
  stopWatchOnly();
  const g = gen;
  const w = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 15, mayShowUserSettingsDialog: true },
    (loc) => { enqueue([toPoint(loc)]); },
  );
  if (g !== gen) { try { w.remove(); } catch { /* gone */ } return; }   // stopped while starting
  watcher = w;
  timer = setInterval(() => { flush(); }, 10000);
  appSub = AppState.addEventListener("change", (s) => { if (s === "active") flush(); });
  if (mode === "background") {
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
      if (!started) {
        await Location.startLocationUpdatesAsync(TASK, {
          accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 20, deferredUpdatesInterval: 15000,
          pausesUpdatesAutomatically: false, activityType: Location.ActivityType?.AutomotiveNavigation,
          showsBackgroundLocationIndicator: true,
          foregroundService: { notificationTitle: _t("Sharing the bus location"), notificationBody: _t("Parents can see where the bus is. End the trip in the app to stop."), notificationColor: "#5b21b6", killServiceOnDestroy: false },
        });
      }
    } catch (e) {
      emit({ mode: "foreground", error: _t("Could not share the location in the background. Keep the app open during the trip.") });
    }
  }
  // a first position at once (the watcher can take a while)
  Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then((l) => enqueue([toPoint(l)]).then(flush)).catch(() => {});
}

function stopWatchOnly() {
  gen += 1;
  try { watcher?.remove(); } catch { /* already gone */ }
  watcher = null;
  if (timer) clearInterval(timer);
  timer = null;
  try { appSub?.remove(); } catch { /* already gone */ }
  appSub = null;
}

/** Signed out: stop the location (no account to send it with) but keep the trip on this phone for the next sign-in. */
export async function pauseSharing() {
  stopWatchOnly();
  try {
    if (TaskManager && (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false))) await Location.stopLocationUpdatesAsync(TASK);
  } catch { /* not running */ }
  if (status.active) emit({ active: false, error: _t("Signed out – sign in again to keep sharing the bus location.") });
}

/** Stop sharing (trip ended). */
export async function stopSharing({ skipFlush = false, ended = false } = {}) {
  if (!skipFlush) await flush().catch(() => {});
  stopWatchOnly();
  try {
    if (TaskManager && (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false))) await Location.stopLocationUpdatesAsync(TASK);
  } catch { /* not running */ }
  try { await AsyncStorage.multiRemove([STATE_KEY, QUEUE_KEY]); } catch { /* ignore */ }
  emit({ active: false, tripId: null, mode: null, queued: 0, ended });
}

/** After the app was closed / reopened: carry on with the trip that is still running on this phone. */
export async function resumeIfRunning(user) {
  const st = await readState();
  if (!st?.tripId) return null;
  if (user?.ssmsUserName && st.username && st.username !== user.ssmsUserName) {
    await stopSharing({ skipFlush: true });   // someone else signed in on this phone
    return null;
  }
  if (user?.token && user.token !== st.token) {
    st.token = user.token;   // a new sign-in: use the fresh token
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(st));
  }
  const q = await readQueue();
  emit({ active: true, tripId: st.tripId, mode: st.mode, queued: q.length, ended: false, error: null });
  if (!watcher) await startWatch(st.mode);   // startWatch: one start at a time
  flush();
  return st.tripId;
}

export const isAndroid = Platform.OS === "android";
