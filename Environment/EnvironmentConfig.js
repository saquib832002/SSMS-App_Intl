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