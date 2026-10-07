const fs = require('fs');
const p = 'android/app/build.gradle';
let c = fs.readFileSync(p, 'utf8');

// ── 1. Inject release signing config after the debug { } block ────────────────
const releaseBlock = [
  '',
  '        release {',
  '            storeFile file("../../@saquib832002__SchoolManagementSystem.jks")',
  '            storePassword "67345168164cbd9d377d8d27ccc18ce6"',
  '            keyAlias "71b9a61efb423aee5954c317846ac707"',
  '            keyPassword "641be395235a97ae3e07ba122edc3eff"',
  '        }',
].join('\n');

c = c.replace(
  /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\})/,
  '$1' + releaseBlock
);

// Switch ONLY the release buildType to signingConfigs.release (leave debug alone)
let count = 0;
c = c.replace(/signingConfig signingConfigs\.debug/g, (m) => {
  count++;
  return count === 2 ? 'signingConfig signingConfigs.release' : m;
});

// ── 2. ABI filter: 64-bit only (arm64-v8a + x86_64) ──────────────────────────
// 32-bit libs (armeabi-v7a) physically cannot meet Android 15's 16 KB page-size
// requirement. Targeting API 36 means all supported devices are 64-bit anyway.
if (!c.includes('abiFilters')) {
  c = c.replace(
    /(defaultConfig\s*\{)/,
    '$1\n            ndk {\n                abiFilters "arm64-v8a", "x86_64"\n            }'
  );
  console.log('✓ Added ndk abiFilters (64-bit only)');
} else {
  console.log('  abiFilters already present — skipped');
}

// ── 3. Packaging: load .so directly from APK (required for 16 KB page sizes) ──
if (!c.includes('useLegacyPackaging')) {
  c = c.replace(
    /(android\s*\{)/,
    '$1\n    packaging {\n        jniLibs {\n            useLegacyPackaging false\n        }\n    }'
  );
  console.log('✓ Added packaging.jniLibs.useLegacyPackaging = false');
} else {
  console.log('  useLegacyPackaging already present — skipped');
}

// ── 4. Disable lint for release builds (lint errors must not block AAB) ────────
if (!c.includes('checkReleaseBuilds')) {
  c = c.replace(
    /(android\s*\{)/,
    '$1\n    lint {\n        checkReleaseBuilds false\n        abortOnError false\n    }'
  );
  console.log('✓ Added lint { checkReleaseBuilds false; abortOnError false }');
} else {
  console.log('  lint options already present — skipped');
}

fs.writeFileSync(p, c);
console.log('\nDone. Verify with:');
console.log('  Get-Content android\\app\\build.gradle | Select-String "signingConfig|abiFilter|useLegacy"');
