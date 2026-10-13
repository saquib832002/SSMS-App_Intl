import { _t } from "./i18n";
/**
 * services/DeviceSensors.js – camera (QR scan) and location, loaded safely.
 *
 * expo-camera / expo-location have native parts. An app build made before they were
 * added cannot load them, so we require them inside try/catch: on an old build the
 * features simply report "update the app" instead of crashing.
 */
let Location = null;
let Camera = null;
try { Location = require("expo-location"); } catch { Location = null; }
try { Camera = require("expo-camera"); } catch { Camera = null; }

export const hasLocation = () => !!Location?.getCurrentPositionAsync;
export const hasCamera   = () => !!Camera?.CameraView;
export const CameraModule = () => Camera;

const UPDATE_MSG = "Please update the app from the Play Store to use this.";

const withTimeout = (p, ms) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
]);

/** → { lat, lng, accuracy } or throws an Error with a friendly message */
export async function getPosition() {
  if (!hasLocation()) throw new Error(UPDATE_MSG);
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error(_t("Location permission is needed so the app can check you are at school. Allow it in your phone settings for this app."));
  }
  if (Location.hasServicesEnabledAsync && !(await Location.hasServicesEnabledAsync())) {
    throw new Error(_t("Turn on Location (GPS) on your phone and try again."));
  }
  let pos = null;
  try {
    pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 15000);
  } catch {
    pos = await Location.getLastKnownPositionAsync({ maxAge: 120000 }).catch(() => null);
  }
  if (!pos?.coords) throw new Error(_t("Could not get your location. Step near a window or outside and try again."));
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: Math.round(pos.coords.accuracy ?? 0),
  };
}

/** Ask for camera permission → true / false */
export async function askCamera() {
  if (!hasCamera()) throw new Error(UPDATE_MSG);
  const r = await Camera.Camera.requestCameraPermissionsAsync();
  return r.status === "granted";
}
