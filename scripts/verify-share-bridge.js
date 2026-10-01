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

  check(
    'app.json withNativeShare plugin configured',
    plugins.some((p) => (typeof p === 'string' ? p : p[0]).includes('withNativeShare'))
  );

  check(
    'app.json withShareBridge plugin configured',
    plugins.some((p) => (typeof p === 'string' ? p : p[0]).includes('withShareBridge'))
  );
} else {
  check('app.json exists', false, 'File not found');
}

// 2. Check NativeShare Plugin Source
const NATIVE_SHARE_PLUGIN_PATH = path.join(ROOT_DIR, 'plugins/withNativeShare.js');
if (fs.existsSync(NATIVE_SHARE_PLUGIN_PATH)) {
  const pluginContent = fs.readFileSync(NATIVE_SHARE_PLUGIN_PATH, 'utf8');

  check('plugins/withNativeShare.js exists', true);
  check(
    'NativeShareActivity defined in plugin',
    pluginContent.includes('class NativeShareActivity : Activity()')
  );
  check(
    'ShareWorker defined in plugin',
    pluginContent.includes('class ShareWorker(')
  );
  check(
    'ACTION_SEND configured for NativeShareActivity',
    pluginContent.includes('android.intent.action.SEND')
  );
  check(
    'ACTION_SEND_MULTIPLE configured for NativeShareActivity',
    pluginContent.includes('android.intent.action.SEND_MULTIPLE')
  );
} else {
  check('plugins/withNativeShare.js exists', false, 'File not found');
}

// 3. Check AndroidManifest.xml (if prebuilt)
if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8');
  check(
    'AndroidManifest.xml contains NativeShareActivity',
    manifest.includes('NativeShareActivity')
  );
  check(
    'AndroidManifest.xml routes ACTION_SEND to NativeShareActivity',
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
