// app.config.js
const IS_PROD = process.env.APP_ENV === "production";

// Server the app talks to. Default: live server for production builds,
// your PC for development builds. Override for one run, e.g. (PowerShell):
//   $env:API_URL="https://managemyacademy.com/"; npx expo start --dev-client
const API_URL = process.env.API_URL || (IS_PROD ? "https://managemyacademy.com/" : "http://192.168.4.30/");

export default {
  name:        IS_PROD ? "ManageMyAcademy" : "SSMS (Dev)",
  slug:        "SchoolManagementSystem",
  version:     "1.0.2",
  orientation: "portrait",
  userInterfaceStyle: "light",  // ← force light mode — prevents white-on-white in dark mode
  icon:        "./assets/smsLogo4.png",
  splash: {
    image:           "./assets/smsLogo4.png",
    resizeMode:      "contain",
    backgroundColor: "#ffffff",
  },

  android: {
    // Development builds get their own package ("…ssms.dev", app name "SSMS (Dev)")
    // so they install NEXT TO the Play Store app – no uninstalling, no signature clash.
    // (Google Play purchases only work in the real com.sawera.ssms app.)
    package:      IS_PROD ? "com.sawera.ssms" : "com.sawera.ssms.dev",
    adaptiveIcon: {
      foregroundImage: "./assets/smsLogo4.png",
      backgroundColor: "#ffffff",
    },
    versionCode: 67,
    permissions: [
      "CAMERA",
    ],
  },

  ios: {
    bundleIdentifier: "com.sawera.ssms",
    supportsTablet:   true,
    buildNumber:      "1",
  },

  web: {
    favicon: "./assets/favicon.png",
  },

  plugins: [
    [
      "expo-image-picker",
      {
        photosPermission: "Allow $(PRODUCT_NAME) to access your photos for student ID upload.",
        cameraPermission: "Allow $(PRODUCT_NAME) to use the camera to take student photos.",
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          targetSdkVersion: 36,
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          useLegacyPackaging: false,   // Android 15+: load .so from APK directly (16 KB page size)
        },
      },
    ],
  ],
  // ── ALL extra values in ONE flat extra block ──────────────────────────────
  // Do NOT nest another "expo: {}" object — that causes EAS to misread the config
  extra: {
    eas: {
      projectId: "c9de8370-e67a-4710-bcd4-1ab5869a3b02",
    },
    BASE_URL:  API_URL,
    HOST_NAME: API_URL,
    APP_ENV:   IS_PROD ? "production"                 : "development",
    // RevenueCat PUBLIC Android SDK key (goog_…) – safe to ship in the app.
    // Set it in eas.json "env" or before building: $env:REVENUECAT_ANDROID_KEY="goog_..."
    REVENUECAT_ANDROID_KEY: process.env.REVENUECAT_ANDROID_KEY ?? "",
    // Stamped when the app is built – shown on Login + More menu so you can
    // check the installed app is the latest build.
    BUILD_TIME: new Date().toISOString(),
}
};