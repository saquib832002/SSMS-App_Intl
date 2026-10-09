// export const BASE_URL = "http://192.168.4.90/ssms5/"; // change to PC IP on real device
// export const HOST_NAME = "http://192.168.4.90";

// Environment/EnvironmentConfig.js
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra ?? {};

export const BASE_URL       = extra.BASE_URL  ?? "http://192.168.4.115/";
export const HOST_NAME      = extra.HOST_NAME ?? "http://192.168.4.115/";
export const APP_ENV        = extra.APP_ENV   ?? "development";
export const IS_PROD        = APP_ENV === "production";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.sawera.ssms";

// RevenueCat public Android SDK key for Google Play subscriptions ("" = purchases disabled)
export const REVENUECAT_ANDROID_KEY = extra.REVENUECAT_ANDROID_KEY ?? "";

// "Version 1.0.2 (66) · built 09 Oct 2026, 14:32" – identifies the installed build.
// (66) is the Play versionCode; it must match the latest release in Play Console.
import * as Application from "expo-application";
const _built = extra.BUILD_TIME ? new Date(extra.BUILD_TIME) : null;
export const APP_VERSION_LABEL =
  `Version ${Application.nativeApplicationVersion ?? "?"} (${Application.nativeBuildVersion ?? "?"})`
  + (_built ? ` · built ${_built.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : "");
