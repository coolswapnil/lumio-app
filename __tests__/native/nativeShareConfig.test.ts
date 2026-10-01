/**
 * Unit tests for withNativeShare plugin, withShareBridge feature flag,
 * and Share / Queue Diagnostics Metrics.
 */

const withNativeShare = require('../../plugins/withNativeShare');
const withShareBridge = require('../../plugins/withShareBridge');
const { diagLog } = require('../../src/services/diagnostics');

const {
  NATIVE_SHARE_ACTIVITY_KT,
  SHARE_WORKER_KT,
  LUMIO_SHARED_PREFS_MODULE_KT,
  LUMIO_SHARED_PREFS_PACKAGE_KT,
} = withNativeShare;

describe('withNativeShare Config Plugin', () => {
  it('generates valid Kotlin source for NativeShareActivity with ACTION_SEND and diagnostics support', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('class NativeShareActivity : Activity()');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('Intent.ACTION_SEND');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('Intent.ACTION_SEND_MULTIPLE');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('persistUriPermissions');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('persistToSQLite');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('Saved to Lumio');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('finish()');
    // Required diagnostic events
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('NATIVE_SHARE_RECEIVED');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('NATIVE_SHARE_SAVED');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('NATIVE_SHARE_FAILED');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('NATIVE_DB_WRITE_SUCCESS');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('NATIVE_DB_WRITE_FAILED');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('DB_PATH_RESOLVED');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('DB_OPEN_SUCCESS');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('DB_OPEN_FAILED');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('DB_INSERT_SUCCESS');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('DB_INSERT_FAILED');
  });

  it('generates valid Kotlin source for ShareWorker with WorkManager integration & diagnostics', () => {
    expect(SHARE_WORKER_KT).toContain('class ShareWorker(');
    expect(SHARE_WORKER_KT).toContain('CoroutineWorker');
    expect(SHARE_WORKER_KT).toContain('WORKMANAGER_STARTED');
    expect(SHARE_WORKER_KT).toContain('WORKMANAGER_COMPLETED');
  });

  it('generates valid Kotlin source for LumioSharedPrefsModule & LumioSharedPrefsPackage', () => {
    expect(LUMIO_SHARED_PREFS_MODULE_KT).toContain('class LumioSharedPrefsModule');
    expect(LUMIO_SHARED_PREFS_MODULE_KT).toContain('fun getAll(');
    expect(LUMIO_SHARED_PREFS_MODULE_KT).toContain('fun remove(');
    expect(LUMIO_SHARED_PREFS_PACKAGE_KT).toContain('class LumioSharedPrefsPackage : ReactPackage');
  });

  it('correctly handles URI permission taking and sqlite inserts only into pending_shares', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('takePersistableUriPermission');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('INSERT OR REPLACE INTO pending_shares');
    expect(NATIVE_SHARE_ACTIVITY_KT).not.toContain('INSERT INTO saved_items');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('scheduleWorkManager');
  });
});

describe('withShareBridge Legacy Feature Flag', () => {
  it('defaults ENABLE_LEGACY_SHARE_BRIDGE to false', () => {
    expect(withShareBridge.ENABLE_LEGACY_SHARE_BRIDGE).toBe(false);
  });
});

describe('Diagnostics Share Metrics', () => {
  beforeEach(() => {
    diagLog.clearEntries();
  });

  it('accurately computes shareAttempts, nativeInserts, queueItemsCreated, queueItemsCompleted', () => {
    diagLog.addEntry('NATIVE_SHARE_RECEIVED', 'action=SEND');
    diagLog.addEntry('NATIVE_SHARE_SAVED', 'id=123');
    diagLog.addEntry('WORKMANAGER_STARTED', 'id=123');
    diagLog.addEntry('WORKMANAGER_COMPLETED', 'id=123');
    diagLog.addEntry('QUEUE_ITEM_CREATED', 'id=123');
    diagLog.addEntry('QUEUE_ITEM_COMPLETED', 'id=123');

    const metrics = diagLog.getShareMetrics();
    expect(metrics.shareAttempts).toBe(1);
    expect(metrics.nativeInserts).toBe(1);
    expect(metrics.queueItemsCreated).toBe(1);
    expect(metrics.queueItemsCompleted).toBe(1);
  });
});
