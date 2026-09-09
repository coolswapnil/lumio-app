#!/usr/bin/env node
/**
 * verify-share-bridge.js
 *
 * Verifies that the native Android share bridge is properly injected into MainActivity.kt
 * and configured in AndroidManifest.xml and app.json.
 *
 * Checks:
 *   1. MainActivity.kt exists
 *   2. MainActivity.kt contains onCreate() intent rewrite
 *   3. MainActivity.kt contains onNewIntent()
 *   4. MainActivity.kt contains rewriteShareIntent()
 *   5. MainActivity.kt contains setIntent()
 *   6. AndroidManifest.xml contains SEND intent-filters
 *   7. app.json contains SEND intent-filters and plugins/withShareBridge
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MAIN_ACTIVITY_PATH = path.join(
  ROOT_DIR,
  'android/app/src/main/java/com/lumio/savelater/MainActivity.kt'
);
const MANIFEST_PATH = path.join(
  ROOT_DIR,
  'android/app/src/main/AndroidManifest.xml'
);
const APP_JSON_PATH = path.join(ROOT_DIR, 'app.json');

let hasError = false;

function check(label, condition, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
  } else {
    console.error(`❌ [FAIL] ${label}${details ? `: ${details}` : ''}`);
    hasError = true;
  }
}

console.log('=== Verifying Lumio Android Share Bridge ===\n');

// 1. Check app.json
if (fs.existsSync(APP_JSON_PATH)) {
  const appJsonContent = fs.readFileSync(APP_JSON_PATH, 'utf8');
  const appJson = JSON.parse(appJsonContent);
  const plugins = appJson.expo?.plugins || [];
  const intentFilters = appJson.expo?.android?.intentFilters || [];

  check(
    'app.json withShareBridge plugin configured',
    plugins.some((p) => (typeof p === 'string' ? p : p[0]).includes('withShareBridge'))
  );

  check(
    'app.json SEND intent-filter configured',
    intentFilters.some((f) => f.action === 'SEND')
  );
} else {
  check('app.json exists', false, 'File not found');
}

// 2. Check MainActivity.kt
if (fs.existsSync(MAIN_ACTIVITY_PATH)) {
  const mainActivity = fs.readFileSync(MAIN_ACTIVITY_PATH, 'utf8');

  check('MainActivity.kt exists', true);
  check(
    'MainActivity.kt has onCreate() intent check',
    mainActivity.includes('rewriteShareIntent(intent, "onCreate")')
  );
  check(
    'MainActivity.kt has onNewIntent() override',
    mainActivity.includes('override fun onNewIntent(')
  );
  check(
    'MainActivity.kt has setIntent()',
    mainActivity.includes('setIntent(intent)')
  );
  check(
    'MainActivity.kt has rewriteShareIntent() implementation',
    mainActivity.includes('fun rewriteShareIntent(')
  );
  check(
    'MainActivity.kt has fallback extraction',
    mainActivity.includes('collectAllUrls(')
  );
} else {
  console.log('ℹ️  MainActivity.kt not found (expected before expo prebuild).');
}

// 3. Check AndroidManifest.xml (if prebuilt)
if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8');
  check(
    'AndroidManifest.xml contains ACTION_SEND',
    manifest.includes('android.intent.action.SEND')
  );
}

console.log('\n===========================================');
if (hasError) {
  console.error('❌ Share Bridge Verification FAILED.');
  process.exit(1);
} else {
  console.log('✅ All Share Bridge checks PASSED.');
  process.exit(0);
}
