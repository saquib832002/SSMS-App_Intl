// app.config.js
const IS_PROD = process.env.APP_ENV === "production";

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
    package:      "com.sawera.ssms",
    adaptiveIcon: {
      foregroundImage: "./assets/smsLogo4.png",
      backgroundColor: "#ffffff",
    },
    versionCode: 61,
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
          kotlinVersion: "1.9.25",
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
    BASE_URL:  IS_PROD ? "https://managemyacademy.com/"  : "http://192.168.4.115/",
    HOST_NAME: IS_PROD ? "https://managemyacademy.com/"  : "http://192.168.4.115/",
    APP_ENV:   IS_PROD ? "production"                 : "development",
}
};