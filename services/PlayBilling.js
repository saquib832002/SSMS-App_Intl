/**
 * services/PlayBilling.js
 * Google Play in-app subscriptions through RevenueCat (react-native-purchases).
 *
 * The RevenueCat app user id is "school_<CLIENTCODE>", so a subscription
 * belongs to the SCHOOL (any owner/admin device can restore it) and the
 * server can match RevenueCat webhooks to the school.
 *
 * Only works in a development / release build on Android (not in Expo Go).
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import Purchases from "react-native-purchases";
import { REVENUECAT_ANDROID_KEY } from "../Environment/EnvironmentConfig";

const IS_EXPO_GO = Constants.executionEnvironment === "storeClient";
const PACKAGE_NAME = "com.sawera.ssms";

export const MANAGE_SUBSCRIPTIONS_URL =
  `https://play.google.com/store/account/subscriptions?package=${PACKAGE_NAME}`;

let configuredFor = null;

/** Why purchases are unavailable, or null when they are available. */
export function playBillingUnavailableReason() {
  if (Platform.OS !== "android") return "Subscriptions can be purchased from the Android app.";
  if (IS_EXPO_GO)               return "In-app purchases don't work in Expo Go. Use the development build.";
  if (!REVENUECAT_ANDROID_KEY)  return "In-app purchases are not configured yet (REVENUECAT_ANDROID_KEY).";
  return null;
}

export const schoolAppUserId = (clientCode) => `school_${String(clientCode ?? "").toUpperCase()}`;

/** Configure RevenueCat for this school (safe to call many times). */
export async function initPlayBilling(clientCode) {
  if (playBillingUnavailableReason() || !clientCode) return false;
  const appUserID = schoolAppUserId(clientCode);
  if (configuredFor === appUserID) return true;
  if (configuredFor === null) {
    Purchases.configure({ apiKey: REVENUECAT_ANDROID_KEY, appUserID });
  } else {
    await Purchases.logIn(appUserID);
  }
  configuredFor = appUserID;
  return true;
}

/** Packages of the "current" offering (configured in RevenueCat). */
export async function getPlayPackages() {
  const offerings = await Purchases.getOfferings();
  return offerings?.current?.availablePackages ?? [];
}

/** "ssms_basic:monthly" → "ssms_basic" */
export const baseProductId = (id) => String(id ?? "").split(":")[0];

/**
 * Buy a package. When the school already has another Play plan, Google
 * switches (upgrade/downgrade) the existing subscription instead of adding one.
 */
export async function buyPackage(pkg, currentStoreProductId = null) {
  try {
    const change = currentStoreProductId && baseProductId(currentStoreProductId) !== baseProductId(pkg?.product?.identifier)
      ? { oldProductIdentifier: currentStoreProductId }
      : null;
    await Purchases.purchasePackage(pkg, null, change);
    return { ok: true };
  } catch (e) {
    if (e?.userCancelled) return { ok: false, cancelled: true };
    throw e;
  }
}

export async function restorePlayPurchases() {
  await Purchases.restorePurchases();
}
