#!/usr/bin/env node
/**
 * Lumio Stability Gate — Pre-Release Validation Runner
 *
 * Usage:
 *   node scripts/stability-gate.js
 *   node scripts/stability-gate.js --full          (also runs full jest suite)
 *   node scripts/stability-gate.js --report        (write JSON report to .bob/stability-report.json)
 *   node scripts/stability-gate.js --full --report
 *
 * Exit codes:
 *   0  — PASS  — all gates green, APK may be released
 *   1  — FAIL  — one or more gates red, APK is BLOCKED
 *
 * This script enforces the Lumio Regression Gate and Release Gate defined in:
 *   docs/lumio-stability-baseline.md
 *
 * Gates executed:
 *   RG-1  Automated stability baseline (Jest)
 *   RG-2  Full Jest suite (--full only)
 *   RG-3  Native plugin source checks (static assertions on Kotlin templates)
 *   RG-4  NativeShareActivity source presence check
 *   RG-5  ShareWorker source presence check
 *   RG-6  Database path contract check
 *   RG-7  withShareBridge legacy flag check (must be false)
 *   RG-8  Key diagnostic events in NativeShareActivity source
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const FULL_SUITE  = ARGS.includes('--full');
const WRITE_REPORT = ARGS.includes('--report');

// ─── Formatting ───────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

function pass(label) { console.log(`  ${GREEN}✓${RESET}  ${label}`); }
function fail(label, reason) { console.log(`  ${RED}✗${RESET}  ${BOLD}${label}${RESET}${reason ? `\n       ${RED}→ ${reason}${RESET}` : ''}`); }
function info(msg)  { console.log(`  ${YELLOW}ℹ${RESET}  ${msg}`); }
function header(msg) { console.log(`\n${BOLD}${msg}${RESET}`); }
function rule() { console.log(`${'═'.repeat(62)}`); }

// ─── Result tracking ──────────────────────────────────────────────────────────

const results = [];
let overallPass = true;

function record(id, label, passed, detail = '') {
  results.push({ id, label, passed, detail });
  if (passed) {
    pass(`[${id}] ${label}`);
  } else {
    fail(`[${id}] ${label}`, detail);
    overallPass = false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function runJest(testPath, label) {
  // On Windows, npx is a .cmd file — must be invoked via cmd.exe.
  const isWin = process.platform === 'win32';
  const cmd   = isWin ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    cmd,
    ['jest', testPath, '--no-coverage', '--forceExit', '--passWithNoTests=false'],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', shell: isWin }
  );
  // Jest writes its output to stderr. Exit code 0 = all tests passed.
  const ok = result.status === 0;
  const output = (result.stderr || '') + (result.stdout || '');
  const detail = ok ? '' : output.split('\n').find(l => /FAIL|●|Tests:|failed/.test(l)) || 'see jest output';
  record(label.id, label.name, ok, ok ? '' : detail);
  return ok;
}

function loadPlugin(name) {
  try {
    return require(path.join(ROOT, 'plugins', name));
  } catch (e) {
    return null;
  }
}

// ─── Gate RG-1: Stability Baseline (Jest) ─────────────────────────────────────

header('RG-1 — Automated Stability Baseline');
runJest('__tests__/stability/baseline.test.ts', { id: 'RG-1', name: 'Stability baseline suite passes (all 8 BSL tests)' });

// ─── Gate RG-2: Full Jest suite (optional) ────────────────────────────────────

if (FULL_SUITE) {
  header('RG-2 — Full Jest Suite');
  runJest('.', { id: 'RG-2', name: 'Full Jest suite passes (zero failures)' });
} else {
  header('RG-2 — Full Jest Suite');
  info('Skipped — run with --full to include the full Jest suite.');
  results.push({ id: 'RG-2', label: 'Full Jest suite', passed: null, detail: 'skipped — use --full' });
}

// ─── Gate RG-3: Native plugin source — NativeShareActivity ────────────────────

header('RG-3 — NativeShareActivity Source Checks');
const withNativeShare = loadPlugin('withNativeShare');

if (!withNativeShare) {
  record('RG-3a', 'withNativeShare plugin loads',                   false, 'plugins/withNativeShare.js not found');
  record('RG-3b', 'NativeShareActivity Kotlin source present',      false, 'plugin failed to load');
  record('RG-3c', 'ACTION_SEND intent filter in source',            false, 'plugin failed to load');
  record('RG-3d', 'finish() present in NativeShareActivity',        false, 'plugin failed to load');
  record('RG-3e', 'persistToSQLite in NativeShareActivity',         false, 'plugin failed to load');
  record('RG-3f', 'Diagnostic events in NativeShareActivity',       false, 'plugin failed to load');
} else {
  record('RG-3a', 'withNativeShare plugin loads', true);

  const kt = withNativeShare.NATIVE_SHARE_ACTIVITY_KT || '';
  record('RG-3b', 'NativeShareActivity Kotlin source present',
    typeof kt === 'string' && kt.length > 100,
    'NATIVE_SHARE_ACTIVITY_KT is empty or missing');

  record('RG-3c', 'ACTION_SEND intent filter in NativeShareActivity source',
    kt.includes('Intent.ACTION_SEND'),
    'Intent.ACTION_SEND not found in source');

  record('RG-3d', 'finish() called in NativeShareActivity source',
    kt.includes('finish()'),
    'finish() not found — activity may stay open after share');

  record('RG-3e', 'persistToSQLite present (native DB write path intact)',
    kt.includes('persistToSQLite'),
    'persistToSQLite not found — native capture may be broken');

  record('RG-3f', 'NATIVE_SHARE_RECEIVED + NATIVE_SHARE_SAVED + NATIVE_SHARE_FAILED events present',
    kt.includes('NATIVE_SHARE_RECEIVED') && kt.includes('NATIVE_SHARE_SAVED') && kt.includes('NATIVE_SHARE_FAILED'),
    'One or more diagnostic events missing from NativeShareActivity');

  // Gate RG-4: NativeShareActivity writes to pending_shares (not saved_items directly)
  header('RG-4 — NativeShareActivity Database Write Contract');
  record('RG-4a', 'NativeShareActivity inserts into pending_shares',
    kt.includes('INSERT OR REPLACE INTO pending_shares'),
    'pending_shares INSERT not found');

  record('RG-4b', 'NativeShareActivity does NOT write directly to saved_items',
    !kt.includes('INSERT INTO saved_items'),
    'Direct INSERT INTO saved_items found — this bypasses the queue and can cause data loss');

  record('RG-4c', 'DB path uses File(filesDir, "SQLite/lumio.db") — correct expo-sqlite path',
    kt.includes('File(filesDir, "SQLite/lumio.db")'),
    'Correct DB path not found — DB path mismatch will cause missing captures');

  record('RG-4d', 'filesDir.parentFile is NOT used (previous bug path)',
    !kt.includes('filesDir.parentFile'),
    'filesDir.parentFile found — this resolved to databases/ not files/ in a previous regression');

  record('RG-4e', 'PRAGMA journal_mode = WAL is applied by native opener',
    kt.includes('PRAGMA journal_mode = WAL'),
    'WAL mode not set — SQLite locking conflicts with expo-sqlite possible');
}

// ─── Gate RG-5: ShareWorker ───────────────────────────────────────────────────

header('RG-5 — ShareWorker Source Checks');
if (!withNativeShare) {
  record('RG-5', 'ShareWorker Kotlin source present', false, 'plugin failed to load');
} else {
  const swKt = withNativeShare.SHARE_WORKER_KT || '';
  record('RG-5a', 'ShareWorker class present',
    swKt.includes('class ShareWorker'),
    'ShareWorker class not found in source');

  record('RG-5b', 'ShareWorker uses CoroutineWorker (non-blocking)',
    swKt.includes('CoroutineWorker'),
    'CoroutineWorker not found — worker may block the main thread');

  record('RG-5c', 'ShareWorker emits WORKMANAGER_STARTED event',
    swKt.includes('WORKMANAGER_STARTED'),
    'WORKMANAGER_STARTED not found — queue state transitions untracked');

  record('RG-5d', 'ShareWorker emits WORKMANAGER_COMPLETED event',
    swKt.includes('WORKMANAGER_COMPLETED'),
    'WORKMANAGER_COMPLETED not found — queue state transitions untracked');
}

// ─── Gate RG-6: LumioSharedPrefsModule (settings bridge) ─────────────────────

header('RG-6 — LumioSharedPrefsModule Source Checks');
if (!withNativeShare) {
  record('RG-6', 'LumioSharedPrefsModule source present', false, 'plugin failed to load');
} else {
  const modKt = withNativeShare.LUMIO_SHARED_PREFS_MODULE_KT || '';
  const pkgKt = withNativeShare.LUMIO_SHARED_PREFS_PACKAGE_KT || '';
  record('RG-6a', 'LumioSharedPrefsModule class present',
    modKt.includes('class LumioSharedPrefsModule'),
    'Class not found — settings bridge broken');

  record('RG-6b', 'getAll() method present (reads settings into React Native)',
    modKt.includes('fun getAll('),
    'getAll() not found — settings cannot be read from JS side');

  record('RG-6c', 'remove() method present (settings can be cleared)',
    modKt.includes('fun remove('),
    'remove() not found — settings cleanup broken');

  record('RG-6d', 'LumioSharedPrefsPackage implements ReactPackage',
    pkgKt.includes('class LumioSharedPrefsPackage : ReactPackage'),
    'ReactPackage implementation not found — native module will not be registered');
}

// ─── Gate RG-7: withShareBridge legacy flag ───────────────────────────────────

header('RG-7 — Legacy Share Bridge Flag');
const withShareBridge = loadPlugin('withShareBridge');
if (!withShareBridge) {
  record('RG-7', 'withShareBridge plugin loads', false, 'plugins/withShareBridge.js not found');
} else {
  record('RG-7', 'ENABLE_LEGACY_SHARE_BRIDGE is false (legacy path disabled)',
    withShareBridge.ENABLE_LEGACY_SHARE_BRIDGE === false,
    'ENABLE_LEGACY_SHARE_BRIDGE is not false — legacy share path may intercept shares');
}

// ─── Gate RG-8: shareBehavior / Open After Share setting key ─────────────────

header('RG-8 — Open After Share Setting Key');
if (!withNativeShare) {
  record('RG-8', 'shareBehavior key in NativeShareActivity', false, 'plugin failed to load');
} else {
  const kt = withNativeShare.NATIVE_SHARE_ACTIVITY_KT || '';
  // The native side reads "shareBehavior" from lumio_share_settings prefs.
  // Value "open_lumio" = launch MainActivity; "stay" = do not launch.
  record('RG-8', 'shareBehavior SharedPreferences key present in NativeShareActivity',
    kt.includes('shareBehavior'),
    'shareBehavior key not found — Open After Share setting will have no effect');
}

// ─── Final verdict ────────────────────────────────────────────────────────────

rule();
const failedGates = results.filter(r => r.passed === false);
const skippedGates = results.filter(r => r.passed === null);
const passedGates  = results.filter(r => r.passed === true);

console.log(`\n${BOLD}LUMIO STABILITY GATE RESULTS${RESET}`);
console.log(`  Passed:   ${GREEN}${passedGates.length}${RESET}`);
console.log(`  Failed:   ${RED}${failedGates.length}${RESET}`);
if (skippedGates.length) console.log(`  Skipped:  ${YELLOW}${skippedGates.length}${RESET}`);

if (failedGates.length > 0) {
  console.log(`\n${RED}${BOLD}FAILED GATES:${RESET}`);
  failedGates.forEach(g => console.log(`  ${RED}✗${RESET} [${g.id}] ${g.label}${g.detail ? ` — ${g.detail}` : ''}`));
}

rule();

const timestamp = new Date().toISOString();
const verdict = overallPass ? 'PASS' : 'FAIL';
const verdictColour = overallPass ? GREEN : RED;
console.log(`\n${verdictColour}${BOLD}STABILITY GATE: ${verdict}${RESET}`);
if (overallPass) {
  console.log(`${GREEN}  APK is a candidate for release. Complete manual BSL device tests before distribution.${RESET}`);
} else {
  console.log(`${RED}  APK is BLOCKED. Fix all failed gates before declaring READY.${RESET}`);
  console.log(`${RED}  No APK may be declared FIXED, READY, or VALIDATED until this gate is GREEN.${RESET}`);
}
rule();

// ─── Optional JSON report ─────────────────────────────────────────────────────

if (WRITE_REPORT) {
  const reportDir = path.join(ROOT, '.bob');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'stability-report.json');
  const report = {
    version: '1.0',
    timestamp,
    verdict,
    passed: passedGates.length,
    failed: failedGates.length,
    skipped: skippedGates.length,
    gates: results,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n${YELLOW}ℹ${RESET}  Report written → ${reportPath}`);
}

process.exit(overallPass ? 0 : 1);
