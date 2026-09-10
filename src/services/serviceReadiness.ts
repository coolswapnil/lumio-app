/**
 * serviceReadiness.ts — Startup readiness gate for the share pipeline.
 *
 * Problem
 * ───────
 * On a cold-start share, expo-router calls redirectSystemPath (in
 * +native-intent.ts) during getInitialURL — the very first JS execution —
 * before DataProvider or CaptureQueueContext have mounted.  If
 * ShareIngestionManager.ingest() runs immediately it calls enqueueCapture()
 * without the collection context that CaptureQueueContext normally provides,
 * which causes enrichment to skip collection matching on the first attempt.
 * The user presses "Try Again" and it works because by then both contexts are
 * fully mounted.
 *
 * Solution
 * ────────
 * A Promise-based readiness gate with per-service signals.
 *
 *   • DATABASE_INITIALIZED  — resolved by initDatabase() in DataProvider
 *   • DATAPROVIDER_READY    — resolved by DataProvider after initial data load
 *   • CAPTURE_QUEUE_READY   — resolved by CaptureQueueProvider on mount
 *
 * shareIngestion.ingest() calls waitForServicesReady() AFTER the fail-safe
 * SQLite persist (STEP A) and BEFORE enqueueCapture() (STEP C).
 * The call in redirectSystemPath already awaits ingest(), so the queue item
 * creation only starts after all required services are up.
 *
 * The gate has a READINESS_TIMEOUT_MS safety valve: if any service takes
 * longer than the timeout (e.g. corrupt DB, infinite render loop) we proceed
 * anyway rather than block the share forever.  A SHARE_MANAGER_READY event
 * is emitted when the gate opens (either because all services are ready or
 * the timeout fired).
 *
 * ── Background→Foreground reset ─────────────────────────────────────────────
 *
 * When the app is backgrounded and later brought to the foreground by a new
 * share intent, React may remount the provider tree (DataProvider,
 * CaptureQueueProvider).  Each provider calls its signal* function again.
 * The signal functions are idempotent by default — they skip if the flag is
 * already true.  This means the _readinessPromise stays resolved from the
 * previous session and ingest() will take the fast path even if the services
 * haven't finished re-mounting in the new render cycle.
 *
 * resetReadinessGate() is called by DataProvider on each mount to reset all
 * flags and create a fresh promise.  This guarantees that a warm-start share
 * waits for the fully re-mounted providers before creating queue items.
 *
 * The ready flags are module-level so they survive across re-renders and are
 * not tied to React component lifecycle.
 */

import { diagLog } from './diagnostics';

/** Maximum time (ms) to wait for all services before proceeding anyway. */
const READINESS_TIMEOUT_MS = 8_000;

// ─── Internal state ───────────────────────────────────────────────────────────

let _databaseReady = false;
let _dataProviderReady = false;
let _captureQueueReady = false;

/** Resolves when all required services are ready (or the timeout fires). */
let _readinessPromise: Promise<void> | null = null;
let _resolveReadiness: (() => void) | null = null;

function getReadinessPromise(): Promise<void> {
  if (!_readinessPromise) {
    _readinessPromise = new Promise<void>((resolve) => {
      _resolveReadiness = resolve;
    });
  }
  return _readinessPromise;
}

function checkAndResolve(): void {
  if (_databaseReady && _dataProviderReady && _captureQueueReady) {
    diagLog.addEntry(
      'SHARE_MANAGER_READY',
      `All services ready — DATABASE_INITIALIZED=${_databaseReady}` +
        ` DATAPROVIDER_READY=${_dataProviderReady}` +
        ` CAPTURE_QUEUE_READY=${_captureQueueReady}`
    );
    _resolveReadiness?.();
  }
}

// ─── Signal functions (called by each service when it is ready) ───────────────

/** Called by initDatabase() after all DDL completes. */
export function signalDatabaseInitialized(): void {
  if (_databaseReady) return;
  _databaseReady = true;
  diagLog.addEntry('DATABASE_INITIALIZED', 'SQLite schema ready');
  // Ensure the promise exists even if signalled before waitForServicesReady().
  getReadinessPromise();
  checkAndResolve();
}

/** Called by DataProvider after its initial data load completes. */
export function signalDataProviderReady(): void {
  if (_dataProviderReady) return;
  _dataProviderReady = true;
  diagLog.addEntry('DATAPROVIDER_READY', 'DataProvider initial load complete');
  getReadinessPromise();
  checkAndResolve();
}

/** Called by CaptureQueueProvider on mount. */
export function signalCaptureQueueReady(): void {
  if (_captureQueueReady) return;
  _captureQueueReady = true;
  diagLog.addEntry('CAPTURE_QUEUE_READY', 'CaptureQueueContext mounted');
  getReadinessPromise();
  checkAndResolve();
}

// ─── Reset (called on provider remount after backgrounding) ──────────────────

/**
 * Reset the readiness gate so that a new session of signals is required.
 *
 * Called by DataProvider on every mount.  This covers the case where the app
 * was backgrounded, the provider tree remounted, and a new share arrived —
 * we must not take the already-resolved fast path until the re-mounted
 * providers have all re-signalled.
 *
 * Safe to call any number of times; calling it while ingest() is mid-wait
 * only affects future ingest() calls (the current wait holds the old promise).
 */
export function resetReadinessGate(): void {
  const wasReady = _databaseReady && _dataProviderReady && _captureQueueReady;
  _databaseReady     = false;
  _dataProviderReady = false;
  _captureQueueReady = false;
  _readinessPromise  = null;
  _resolveReadiness  = null;
  diagLog.addEntry(
    'SHARE_MANAGER_READY',
    `readiness gate reset (wasReady=${wasReady}) — waiting for re-mount signals`
  );
}

// ─── Gate ─────────────────────────────────────────────────────────────────────

/**
 * Resolves when DATABASE_INITIALIZED, DATAPROVIDER_READY, and
 * CAPTURE_QUEUE_READY have all fired, or after READINESS_TIMEOUT_MS.
 *
 * Call this from ShareIngestionManager.ingest() AFTER the fail-safe SQLite
 * persist and BEFORE enqueueCapture().
 * It is a no-op (resolves immediately) if all services are already up.
 */
export async function waitForServicesReady(): Promise<void> {
  // Fast path — all services are already up (warm-start or already waited).
  if (_databaseReady && _dataProviderReady && _captureQueueReady) return;

  const missing = [
    !_databaseReady      && 'DATABASE',
    !_dataProviderReady  && 'DATAPROVIDER',
    !_captureQueueReady  && 'CAPTURE_QUEUE',
  ].filter(Boolean).join(', ');

  diagLog.addEntry(
    'SHARE_PAYLOAD_RECEIVED',
    `Share arrived before services ready — waiting (missing: ${missing})`
  );

  await Promise.race([
    getReadinessPromise(),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        diagLog.addEntry(
          'SHARE_MANAGER_READY',
          `Readiness timeout (${READINESS_TIMEOUT_MS}ms) — proceeding anyway.` +
            ` DATABASE_INITIALIZED=${_databaseReady}` +
            ` DATAPROVIDER_READY=${_dataProviderReady}` +
            ` CAPTURE_QUEUE_READY=${_captureQueueReady}`
        );
        resolve();
      }, READINESS_TIMEOUT_MS)
    ),
  ]);
}

/** Read-only snapshot of the current readiness state (for diagnostics). */
export function getReadinessSnapshot(): {
  database: boolean;
  dataProvider: boolean;
  captureQueue: boolean;
} {
  return {
    database: _databaseReady,
    dataProvider: _dataProviderReady,
    captureQueue: _captureQueueReady,
  };
}
