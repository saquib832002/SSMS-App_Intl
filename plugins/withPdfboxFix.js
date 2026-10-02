/**
 * plugins/withPdfboxFix.js
 *
 * Applied during `npx expo prebuild`. Does two things:
 *  1. Sets targetSdkVersion=36 in gradle.properties (Play Store requires API 36+)
 *  2. Injects release signing config into android/app/build.gradle
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ── Signing credentials ───────────────────────────────────────────────────────
// Keystore lives at project root (two levels up from android/app/)
const KEYSTORE_FILE    = '../../@saquib832002__SchoolManagementSystem.jks';
const STORE_PASSWORD   = '67345168164cbd9d377d8d27ccc18ce6';
const KEY_ALIAS        = '71b9a61efb423aee5954c317846ac707';
const KEY_PASSWORD     = '641be395235a97ae3e07ba122edc3eff';

const withPdfboxFix = (config) => {

  // ── 1. Patch gradle.properties → targetSdkVersion=36 ─────────────────────
  config = withDangerousMod(config, ['android', async (config) => {
    const propsPath = path.join(config.modRequest.platformProjectRoot, 'gradle.properties');
    let c = fs.readFileSync(propsPath, 'utf8');

    c = /android\.targetSdkVersion=\d+/.test(c)
      ? c.replace(/android\.targetSdkVersion=\d+/, 'android.targetSdkVersion=36')
      : c + '\nandroid.targetSdkVersion=36\n';

    c = /android\.compileSdkVersion=\d+/.test(c)
      ? c.replace(/android\.compileSdkVersion=\d+/, 'android.compileSdkVersion=36')
      : c + '\nandroid.compileSdkVersion=36\n';

    fs.writeFileSync(propsPath, c);
    console.log('[withPdfboxFix] gradle.properties → targetSdkVersion=36, compileSdkVersion=36');
    return config;
  }]);

  // ── 2. Inject signingConfigs into android/app/build.gradle ───────────────
  config = withDangerousMod(config, ['android', async (config) => {
    const buildGradlePath = path.join(
      config.modRequest.platformProjectRoot, 'app', 'build.gradle'
    );
    let c = fs.readFileSync(buildGradlePath, 'utf8');

    if (c.includes('signingConfigs')) {
      console.log('[withPdfboxFix] signingConfigs already present, skipping');
      return config;
    }

    // Insert signingConfigs block just before the buildTypes block
    const signingBlock = `
    signingConfigs {
        release {
            storeFile file("${KEYSTORE_FILE}")
            storePassword "${STORE_PASSWORD}"
            keyAlias "${KEY_ALIAS}"
            keyPassword "${KEY_PASSWORD}"
        }
    }`;

    c = c.replace(/(\n[ \t]*buildTypes[ \t]*\{)/, signingBlock + '$1');

    // Add signingConfig reference inside the release buildType
    c = c.replace(
      /([ \t]*release[ \t]*\{[^}]*)([ \t]*\})/,
      '$1            signingConfig signingConfigs.release\n$2'
    );

    fs.writeFileSync(buildGradlePath, c);
    console.log('[withPdfboxFix] android/app/build.gradle → signingConfig injected');
    return config;
  }]);

  return config;
};

module.exports = withPdfboxFix;
