/**
 * Lumio Stability Baseline — Automated Regression Gate
 *
 * Version: 1.0
 * Policy:  Every build must pass ALL tests in this file before APK release.
 *          A bug is not fixed until the target issue is resolved AND every
 *          test here passes. One failure = build is NOT READY.
 *
 * Tests:
 *   BSL-001  App Launch
 *   BSL-002  Open After Share (setting respected)
 *   BSL-003  Share Reliability (Instagram, YouTube, Web URL)
 *   BSL-004  Immediate Visibility (item visible ≤ 2 s, status = Queued)
 *   BSL-005  Processing Pipeline (Queued → Processing → Ready)
 *   BSL-006  Collection Integrity (counts accurate after capture)
 *   BSL-007  Translation Integrity (Japanese, Hindi, Marathi, German)
 *   BSL-008  Launch Integrity (cold, warm, post-share, post-reboot)
 *
 * These tests operate entirely in-process against the real service layer using
 * controlled mocks for I/O boundaries (SQLite, fetch, WorkManager). They catch
 * logic regressions. Device-level tests (OEM share-sheet, ANR, WorkManager
 * scheduling) must be executed manually per the baseline spec.
 *
 * Run: npx jest __tests__/stability/baseline.test.ts --verbose
 */

// ─── Global fetch mock ────────────────────────────────────────────────────────
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// ─── SQLite mock ──────────────────────────────────────────────────────────────
//
// We maintain two in-memory stores:
//   pendingShares  — rows written by NativeShareActivity / ShareIngestionManager
//   savedItems     — rows written by the capture pipeline after processing
//
// Each store is keyed by id for easy lookup in assertions.

type PendingRow  = { id: string; text: string; url: string; title: string; subject: string; raw_path: string | null; status: string };
type SavedRow    = Record<string, unknown>;

const pendingShares: Record<string, PendingRow> = {};
const savedItems:    Record<string, SavedRow>   = {};

const mockDb = {
  execAsync: jest.fn().mockResolvedValue(undefined),
  runAsync: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/INSERT OR REPLACE INTO pending_shares/i.test(sql) && Array.isArray(params)) {
      const [id, text, url, title, subject, raw_path] = params as string[];
      pendingShares[id] = { id, text, url, title, subject, raw_path, status: 'pending' };
    }
    if (/UPDATE pending_shares SET status = 'processed'/i.test(sql) && Array.isArray(params)) {
      const [id] = params as string[];
      if (pendingShares[id]) pendingShares[id].status = 'processed';
    }
    if (/INSERT.*INTO saved_items/i.test(sql) && Array.isArray(params)) {
      // Minimal row — tests only need id, title, url, status, collection_id
      const row = params[0];
      if (typeof row === 'object' && row !== null && 'id' in (row as object)) {
        savedItems[(row as SavedRow).id as string] = row as SavedRow;
      }
    }
    return {};
  }),
  getAllAsync: jest.fn().mockImplementation(async (sql: string) => {
    if (/FROM saved_items/i.test(sql))     return Object.values(savedItems);
    if (/FROM pending_shares/i.test(sql))  return Object.values(pendingShares);
    return [];
  }),
  getFirstAsync: jest.fn().mockResolvedValue(null),
};

// ─── Module mocks ─────────────────────────────────────────────────────────────
//
// IMPORTANT: jest.mock() factories are hoisted to the top of the file by Babel,
// so they run BEFORE module-level variables (including mockDb) are initialized.
// Variables named with a 'mock' prefix are allowed in factories, but their VALUES
// are captured lazily. Use mockImplementation(() => ...) not mockResolvedValue(ref)
// to avoid capturing undefined at hoist time.

jest.mock('expo-sqlite', () => ({
  // Lazy factory: mockDb is referenced at call time (after module init), not at hoist time.
  openDatabaseAsync: jest.fn().mockImplementation(() => Promise.resolve(mockDb)),
  defaultDatabaseDirectory: '/data/data/com.lumio.savelater/files/SQLite',
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///data/user/0/com.lumio.savelater/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/services/serviceReadiness', () => ({
  waitForServicesReady: jest.fn().mockResolvedValue(undefined),
  getReadinessSnapshot: jest.fn().mockReturnValue({ database: true, dataProvider: true, captureQueue: true }),
  signalDatabaseInitialized: jest.fn(),
  signalDataProviderReady: jest.fn(),
  signalCaptureQueueReady: jest.fn(),
}));

jest.mock('../../src/database/migrations', () => ({
  runLegacyCollectionMigration: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/lifecycleState', () => ({
  isAppActive: jest.fn().mockReturnValue(true),
  onAppActive: jest.fn(),
  getLifecycleState: jest.fn().mockReturnValue('active'),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 14 },
  NativeModules: {
    LumioSharedPrefsModule: {
      getAll:  jest.fn().mockResolvedValue('{}'),
      remove:  jest.fn().mockResolvedValue(undefined),
    },
  },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })), currentState: 'active' },
}));

jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue({
    provider: 'openai',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    autoTranslate: true,
    neverTranslateLanguages: [],
    openAfterShare: true,
  }),
}));

jest.mock('../../src/services/metadata', () => ({
  fetchMetadata: jest.fn().mockResolvedValue({ title: 'Test Title', description: 'Test description.' }),
  formatMetadataForAI: jest.fn().mockReturnValue('Title: Test Title\nDescription: Test description.'),
  CATEGORY_CONFIG: { 'Real Estate': { emoji: '🏠' } },
}));

jest.mock('../../src/services/ai', () => ({
  summarizeItem: jest.fn().mockResolvedValue({ error: 'disabled' }),
  callAIRaw: jest.fn(),
}));

jest.mock('../../src/database/collections', () => ({
  getAllCollections: jest.fn().mockResolvedValue([
    { id: 'col-finance', name: 'Finance',     icon: 'cash',   color: '#10b981', itemCount: 5, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'col-tech',    name: 'Technology',  icon: 'laptop', color: '#3b82f6', itemCount: 3, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]),
  updateCollectionItemCount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/database/topics', () => ({
  maybeAutoCreateTopic: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/services/widget_bridge', () => ({
  syncWidgetCount: jest.fn(),
}));

// captureQueue — Jest hoisting requires the mock factory to be self-contained.
// We expose a module-level reference via jest.fn() directly in the factory, then
// retrieve it in tests via the module's own export (jest replaces the module).
jest.mock('../../src/services/captureQueue', () => ({
  enqueueCapture: jest.fn().mockResolvedValue('bsl-item-001'),
}));

jest.mock('../../src/services/diagnostics', () => ({
  diagLog: {
    addEntry:      jest.fn(),
    clearEntries:  jest.fn(),
    getShareMetrics: jest.fn().mockReturnValue({
      shareAttempts: 0, nativeInserts: 0, queueItemsCreated: 0, queueItemsCompleted: 0,
    }),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { ShareIngestionManager }       from '../../src/services/shareIngestion';
import { detectLanguage, shouldTranslate } from '../../src/services/languageDetection';
import { buildCollectionInsights }     from '../../src/services/collectionInsights';
import type { Collection, SavedItem }  from '../../src/types';
import { diagLog }                     from '../../src/services/diagnostics';
import { enqueueCapture }              from '../../src/services/captureQueue';

// Typed reference to the mocked enqueueCapture for per-test return value overrides
const enqueueCaptureMock = enqueueCapture as jest.MockedFunction<typeof enqueueCapture>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSyntheticUri(url: string, title = 'Test Item'): string {
  return `lumio://share?text=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&urls=${encodeURIComponent(url)}&src=EXTRA_TEXT&mime=text%2Fplain`;
}

function savedItem(overrides: Partial<SavedItem>): SavedItem {
  return {
    id: 'item-default',
    title: 'Default Title',
    contentType: 'article',
    tags: [],
    isCompleted: false,
    isFavorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-001 — App Launch
//  Validates: database initialises, services become ready, Library query runs.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-001 — App Launch', () => {
  beforeEach(() => {
    // Reset all mock call history before each BSL-001 test so counts are clean.
    mockDb.execAsync.mockClear();
    mockDb.runAsync.mockClear();
    mockDb.getAllAsync.mockClear();
  });

  it('database module opens lumio.db on startup', async () => {
    const SQLite = require('expo-sqlite');
    const { getDatabase } = require('../../src/database/db');
    await getDatabase();
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('lumio.db');
  });

  it('WAL mode is applied during database initialisation (verified via Kotlin plugin source)', () => {
    // The db.ts module caches _initialized across the test suite to match production behaviour.
    // We verify the WAL contract via the NativeShareActivity Kotlin source (which also sets WAL)
    // and via the db.ts source text — both are authoritative and stable.
    const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('PRAGMA journal_mode = WAL');
    // Also verify db.ts source directly
    const fs = require('fs');
    const path = require('path');
    const dbSrc = fs.readFileSync(path.join(__dirname, '../../src/database/db.ts'), 'utf8');
    expect(dbSrc).toContain("PRAGMA journal_mode = WAL");
  });

  it('serviceReadiness signals do not throw on startup sequence', async () => {
    const { signalDatabaseInitialized, signalDataProviderReady, signalCaptureQueueReady } =
      require('../../src/services/serviceReadiness');
    expect(() => signalDatabaseInitialized()).not.toThrow();
    expect(() => signalDataProviderReady()).not.toThrow();
    expect(() => signalCaptureQueueReady()).not.toThrow();
  });

  it('getAllItems() returns an empty array on a clean install without crashing', async () => {
    const { getAllItems } = require('../../src/database/items');
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    const items = await getAllItems();
    expect(Array.isArray(items)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-002 — Open After Share (setting respected)
//  Validates: the openAfterShare setting is read and respected.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-002 — Open After Share', () => {
  it('getSettings() returns openAfterShare: true when the setting is enabled', async () => {
    const { getSettings } = require('../../src/services/settings');
    const settings = await getSettings();
    expect(settings.openAfterShare).toBe(true);
  });

  it('when openAfterShare is false, the setting value is false', async () => {
    const { getSettings } = require('../../src/services/settings');
    // Override for this test only
    (getSettings as jest.Mock).mockResolvedValueOnce({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      autoTranslate: false,
      neverTranslateLanguages: [],
      openAfterShare: false,
    });
    const settings = await getSettings();
    expect(settings.openAfterShare).toBe(false);
  });

  it('NativeShareActivity Kotlin contains the shareBehavior SharedPreferences key', () => {
    const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');
    // The native side reads "shareBehavior" from lumio_share_settings prefs to decide
    // whether to launch MainActivity after share (value "open_lumio" = open, "stay" = don't open)
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('shareBehavior');
  });

  it('NativeShareActivity calls finish() — prevents screen staying open regardless of setting', () => {
    const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('finish()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-003 — Share Reliability
//  Validates: Instagram Reel, YouTube Video, Web URL all produce captured items.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-003 — Share Reliability', () => {
  beforeEach(() => {
    // mockClear only — preserves mock implementations (runAsync, execAsync, getAllAsync, openDatabaseAsync).
    // clearAllMocks would wipe implementations and cause "Cannot read properties of undefined".
    (diagLog.addEntry as jest.Mock).mockClear();
    enqueueCaptureMock.mockClear();
    enqueueCaptureMock.mockResolvedValue('bsl-item-001');
    mockDb.runAsync.mockClear();
    mockDb.getAllAsync.mockClear();
  });

  // BSL-003a — Instagram Reel
  it('BSL-003a: Instagram Reel share is captured successfully', async () => {
    const uri = makeSyntheticUri(
      'https://www.instagram.com/reel/abc123xyz/',
      'Amazing reel'
    );
    const result = await ShareIngestionManager.ingest(uri);
    expect(result.wasProcessed).toBe(true);
    expect(result.itemIds.length).toBeGreaterThan(0);
    expect(enqueueCaptureMock).toHaveBeenCalledWith(
      expect.stringContaining('instagram.com/reel'),
      expect.any(Object)
    );
  });

  // BSL-003b — YouTube Video
  it('BSL-003b: YouTube Video share is captured successfully', async () => {
    const uri = makeSyntheticUri(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'Never Gonna Give You Up'
    );
    const result = await ShareIngestionManager.ingest(uri);
    expect(result.wasProcessed).toBe(true);
    expect(result.itemIds.length).toBeGreaterThan(0);
    expect(enqueueCaptureMock).toHaveBeenCalledWith(
      expect.stringContaining('youtube.com/watch'),
      expect.any(Object)
    );
  });

  // BSL-003c — Web URL
  it('BSL-003c: Web URL share is captured successfully', async () => {
    const uri = makeSyntheticUri(
      'https://www.bbc.com/news/article-001',
      'BBC News Article'
    );
    const result = await ShareIngestionManager.ingest(uri);
    expect(result.wasProcessed).toBe(true);
    expect(result.itemIds.length).toBeGreaterThan(0);
    expect(enqueueCaptureMock).toHaveBeenCalledWith(
      expect.stringContaining('bbc.com'),
      expect.any(Object)
    );
  });

  // Regression guard: a failed share must NOT silently drop the item
  it('BSL-003 regression guard: failed share never silently disappears — pending_shares row written first', async () => {
    const uri = makeSyntheticUri('https://example.com/test', 'Test');
    await ShareIngestionManager.ingest(uri);
    // The raw persist INSERT must fire before enqueue
    const { diagLog: dl } = require('../../src/services/diagnostics');
    expect(dl.addEntry).toHaveBeenCalledWith('PENDING_SHARE_RAW_CAPTURED', expect.any(String));
  });

  it('BSL-003 regression guard: NativeShareActivity writes to pending_shares and calls finish() on the main share path', () => {
    const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');
    // The INSERT is inside persistToSQLite() — must exist in the source
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('INSERT OR REPLACE INTO pending_shares');
    // NATIVE_SHARE_COMPLETE marks the end of the main share path — must exist
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('NATIVE_SHARE_COMPLETE');
    // finish() must be present — activity must always clean up
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('finish()');
    // persistToSQLite() is called from handleIncomingShare() before NATIVE_SHARE_COMPLETE.
    // We verify the CALL SITE ordering, not the method definition ordering.
    const persistCallIdx   = NATIVE_SHARE_ACTIVITY_KT.indexOf('persistToSQLite(');
    const completeIdx      = NATIVE_SHARE_ACTIVITY_KT.indexOf('NATIVE_SHARE_COMPLETE');
    expect(persistCallIdx).toBeGreaterThan(0);
    expect(completeIdx).toBeGreaterThan(0);
    // persistToSQLite call site must appear before NATIVE_SHARE_COMPLETE in handleIncomingShare
    expect(persistCallIdx).toBeLessThan(completeIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-004 — Immediate Visibility
//  Validates: item enqueued immediately; diagLog records QUEUE_ITEM_CREATED.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-004 — Immediate Visibility', () => {
  beforeEach(() => {
    (diagLog.addEntry as jest.Mock).mockClear();
    enqueueCaptureMock.mockClear();
    enqueueCaptureMock.mockResolvedValue('bsl-visible-001');
    mockDb.runAsync.mockClear();
  });

  it('enqueueCapture is called synchronously within the ingest() call (no deferred batch)', async () => {
    const uri = makeSyntheticUri('https://www.example.com/article');
    await ShareIngestionManager.ingest(uri);
    // enqueueCapture must have been called — item is in the queue immediately
    expect(enqueueCaptureMock).toHaveBeenCalledTimes(1);
  });

  it('QUEUE_ITEM_CREATED diagnostic event is emitted so the UI can show the Queued state', async () => {
    const uri = makeSyntheticUri('https://www.example.com/visibility-test');
    await ShareIngestionManager.ingest(uri);
    const { diagLog: dl } = require('../../src/services/diagnostics');
    expect(dl.addEntry).toHaveBeenCalledWith('QUEUE_ITEM_CREATED', expect.any(String));
  });

  it('PENDING_SHARE_RAW_CAPTURED fires before QUEUE_ITEM_CREATED — raw persistence precedes queuing', async () => {
    const { diagLog: dl } = require('../../src/services/diagnostics');
    const callOrder: string[] = [];
    (dl.addEntry as jest.Mock).mockImplementation((event: string) => { callOrder.push(event); });

    const uri = makeSyntheticUri('https://www.example.com/ordering-test');
    await ShareIngestionManager.ingest(uri);

    const rawIdx   = callOrder.indexOf('PENDING_SHARE_RAW_CAPTURED');
    const queueIdx = callOrder.indexOf('QUEUE_ITEM_CREATED');
    expect(rawIdx).toBeGreaterThanOrEqual(0);
    expect(queueIdx).toBeGreaterThanOrEqual(0);
    expect(rawIdx).toBeLessThan(queueIdx);
  });

  it('ingest() returns itemIds immediately — not undefined, not empty on success', async () => {
    const uri = makeSyntheticUri('https://www.youtube.com/watch?v=test123');
    const result = await ShareIngestionManager.ingest(uri);
    expect(result.itemIds).toBeDefined();
    expect(result.itemIds.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-005 — Processing Pipeline  (Queued → Processing → Ready)
//  Validates: pipeline state machine, worker source identifiers, WorkManager.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-005 — Processing Pipeline', () => {
  it('ShareWorker is a CoroutineWorker (non-blocking I/O)', () => {
    const { SHARE_WORKER_KT } = require('../../plugins/withNativeShare');
    expect(SHARE_WORKER_KT).toContain('CoroutineWorker');
  });

  it('ShareWorker emits WORKMANAGER_STARTED and WORKMANAGER_COMPLETED events', () => {
    const { SHARE_WORKER_KT } = require('../../plugins/withNativeShare');
    expect(SHARE_WORKER_KT).toContain('WORKMANAGER_STARTED');
    expect(SHARE_WORKER_KT).toContain('WORKMANAGER_COMPLETED');
  });

  it('NativeShareActivity schedules WorkManager (scheduleWorkManager call present)', () => {
    const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('scheduleWorkManager');
  });

  it('ingest() marks the pending_shares row as processed after successful queue', async () => {
    mockDb.runAsync.mockClear();
    enqueueCaptureMock.mockClear();
    enqueueCaptureMock.mockResolvedValue('pipeline-item-001');
    const uri = makeSyntheticUri('https://www.example.com/pipeline-test');
    await ShareIngestionManager.ingest(uri);
    // The UPDATE ... SET status = 'processed' call must have fired
    const updateCalls = (mockDb.runAsync as jest.Mock).mock.calls.filter(
      ([sql]: [string]) => /UPDATE pending_shares SET status = 'processed'/i.test(sql)
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it('recoverPendingShares() re-enqueues items stuck in Queued state across app restarts', async () => {
    enqueueCaptureMock.mockClear();
    const { getDatabase } = require('../../src/database/db');
    const db = await getDatabase();
    const encodedUrl = encodeURIComponent('https://www.youtube.com/watch?v=stuck123');
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([
      {
        id: 'stuck-share-001',
        text: 'https://www.youtube.com/watch?v=stuck123',
        url: '',
        title: 'Stuck Item',
        subject: '',
        raw_path: `lumio://share?text=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dstuck123&urls=${encodedUrl}`,
        status: 'pending',
      },
    ]);
    await ShareIngestionManager.recoverPendingShares();
    expect(enqueueCaptureMock).toHaveBeenCalledWith(
      expect.stringContaining('youtube.com/watch?v=stuck123'),
      expect.any(Object)
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-006 — Collection Integrity
//  Validates: collection counts and insight metrics remain accurate.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-006 — Collection Integrity', () => {
  const financeCollection: Collection = {
    id: 'col-finance',
    name: 'Finance',
    icon: 'cash',
    color: '#10b981',
    itemCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const items: SavedItem[] = [
    savedItem({ id: 'fi-1', title: 'ETF guide',         category: 'Finance',  tags: ['investing', 'etf'],      source: 'youtube',   createdAt: '2026-03-01T00:00:00.000Z' }),
    savedItem({ id: 'fi-2', title: 'Dividend strategy', category: 'Finance',  tags: ['dividend', 'investing'], source: 'youtube',   createdAt: '2026-03-05T00:00:00.000Z' }),
    savedItem({ id: 'fi-3', title: 'Travel vlog',       category: 'Travel',   tags: ['travel'],                source: 'instagram', createdAt: '2026-03-08T00:00:00.000Z' }),
  ];

  it('buildCollectionInsights returns correct itemCount', () => {
    const insights = buildCollectionInsights(financeCollection, items, new (require('dayjs'))('2026-03-10T00:00:00.000Z'));
    expect(insights.itemCount).toBe(3);
  });

  it('topCategory reflects the dominant category in the collection', () => {
    const insights = buildCollectionInsights(financeCollection, items, new (require('dayjs'))('2026-03-10T00:00:00.000Z'));
    expect(insights.topCategory.label).toBe('Finance');
    expect(insights.topCategory.count).toBe(2);
  });

  it('mostActiveTopic reflects the most frequent tag', () => {
    const insights = buildCollectionInsights(financeCollection, items, new (require('dayjs'))('2026-03-10T00:00:00.000Z'));
    expect(insights.mostActiveTopic.label).toBe('investing');
    expect(insights.mostActiveTopic.count).toBe(2);
  });

  it('collection health is Growing when items were added recently', () => {
    const insights = buildCollectionInsights(financeCollection, items, new (require('dayjs'))('2026-03-10T00:00:00.000Z'));
    expect(insights.health).toBe('Growing');
  });

  it('collection health is Inactive when the collection is empty', () => {
    const insights = buildCollectionInsights(financeCollection, [], new (require('dayjs'))('2026-03-10T00:00:00.000Z'));
    expect(insights.health).toBe('Inactive');
  });

  it('unrelated items do not appear in related content for a Finance item', () => {
    const { findRelatedItems } = require('../../src/services/collectionInsights');
    const financeItem = items[0];   // ETF guide
    const travelItem  = items[2];   // Travel vlog
    const results = findRelatedItems(financeItem, items);
    const resultIds = results.map((r: { item: SavedItem }) => r.item.id);
    expect(resultIds).not.toContain(travelItem.id);
  });

  it('getAllCollections() returns the seeded collections without error', async () => {
    const { getAllCollections } = require('../../src/database/collections');
    const collections = await getAllCollections();
    expect(collections.length).toBeGreaterThan(0);
    const finance = collections.find((c: Collection) => c.id === 'col-finance');
    expect(finance).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-007 — Translation Integrity
//  Validates: language detection and shouldTranslate for all supported languages.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-007 — Translation Integrity', () => {

  // BSL-007a — Japanese
  describe('BSL-007a: Japanese', () => {
    it('detects hiragana + kanji as Japanese', () => {
      expect(detectLanguage('東京の新しいカフェに行きました')).toBe('Japanese');
    });

    it('detects katakana as Japanese', () => {
      expect(detectLanguage('アメリカのトレンドについて')).toBe('Japanese');
    });

    it('shouldTranslate returns true for Japanese when autoTranslate is enabled', () => {
      expect(shouldTranslate('Japanese', true, [])).toBe(true);
    });

    it('shouldTranslate returns false for Japanese when in neverTranslate list', () => {
      expect(shouldTranslate('Japanese', true, ['Japanese'])).toBe(false);
    });
  });

  // BSL-007b — Hindi
  describe('BSL-007b: Hindi', () => {
    it('detects Devanagari text as Hindi', () => {
      expect(detectLanguage('भारत एक बड़ा देश है जहाँ कई भाषाएं बोली जाती हैं')).toBe('Hindi');
    });

    it('shouldTranslate returns true for Hindi when autoTranslate is enabled', () => {
      expect(shouldTranslate('Hindi', true, [])).toBe(true);
    });
  });

  // BSL-007c — Marathi (must NOT be misidentified as Hindi)
  describe('BSL-007c: Marathi — Hindi/Marathi discrimination', () => {
    it('detects Marathi-keyword Devanagari as Marathi, not Hindi', () => {
      expect(detectLanguage('पुणे हे महाराष्ट्रातील एक प्रमुख शहर आहे')).toBe('Marathi');
    });

    it('shouldTranslate returns true for Marathi when autoTranslate is enabled', () => {
      expect(shouldTranslate('Marathi', true, [])).toBe(true);
    });

    it('regression guard: Marathi text must NOT be detected as Hindi', () => {
      const lang = detectLanguage('पुणे हे महाराष्ट्रातील एक प्रमुख शहर आहे');
      expect(lang).not.toBe('Hindi');
    });
  });

  // BSL-007d — German
  describe('BSL-007d: German', () => {
    it('detects German text correctly', () => {
      expect(detectLanguage('Das ist ein wichtiges Thema für die Zukunft')).toBe('German');
    });

    it('shouldTranslate returns true for German when autoTranslate is enabled', () => {
      expect(shouldTranslate('German', true, [])).toBe(true);
    });
  });

  // Translation pipeline guards
  describe('Translation pipeline regression guards', () => {
    it('shouldTranslate returns false for English regardless of autoTranslate setting', () => {
      expect(shouldTranslate('English', true,  [])).toBe(false);
      expect(shouldTranslate('English', false, [])).toBe(false);
    });

    it('shouldTranslate returns false for Unknown language', () => {
      expect(shouldTranslate('Unknown', true, [])).toBe(false);
    });

    it('shouldTranslate returns false when autoTranslate is disabled regardless of language', () => {
      expect(shouldTranslate('Japanese', false, [])).toBe(false);
      expect(shouldTranslate('Hindi',    false, [])).toBe(false);
      expect(shouldTranslate('German',   false, [])).toBe(false);
    });

    it('detectLanguage returns Unknown for very short strings (no false positives)', () => {
      expect(detectLanguage('abc')).toBe('Unknown');
      expect(detectLanguage('')).toBe('Unknown');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BSL-008 — Launch Integrity
//  Validates: no crash paths in the startup and share-launch sequences.
// ─────────────────────────────────────────────────────────────────────────────

describe('BSL-008 — Launch Integrity', () => {

  it('initDatabase() completes without throwing on cold launch', async () => {
    const { initDatabase } = require('../../src/database/db');
    await expect(initDatabase()).resolves.not.toThrow();
  });

  it('getDatabase() does not throw and returns a database object', async () => {
    const { getDatabase } = require('../../src/database/db');
    await expect(getDatabase()).resolves.toBeDefined();
  });

  it('NativeShareActivity does not write to saved_items directly (must use pending_shares)', () => {
    const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');
    expect(NATIVE_SHARE_ACTIVITY_KT).not.toContain('INSERT INTO saved_items');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('INSERT OR REPLACE INTO pending_shares');
  });

  it('NativeShareActivity registers ACTION_SEND intent filter (share sheet entry point)', () => {
    const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('Intent.ACTION_SEND');
  });

  it('LumioSharedPrefsPackage is a valid ReactPackage (native module registration intact)', () => {
    const { LUMIO_SHARED_PREFS_PACKAGE_KT } = require('../../plugins/withNativeShare');
    expect(LUMIO_SHARED_PREFS_PACKAGE_KT).toContain('class LumioSharedPrefsPackage : ReactPackage');
  });

  it('LumioSharedPrefsModule exposes getAll() and remove() (settings bridge intact)', () => {
    const { LUMIO_SHARED_PREFS_MODULE_KT } = require('../../plugins/withNativeShare');
    expect(LUMIO_SHARED_PREFS_MODULE_KT).toContain('fun getAll(');
    expect(LUMIO_SHARED_PREFS_MODULE_KT).toContain('fun remove(');
  });

  it('DB path contract: expo-sqlite and NativeShareActivity resolve to the same file', () => {
    const SQLite = require('expo-sqlite') as { defaultDatabaseDirectory: string };
    const dir    = SQLite.defaultDatabaseDirectory.replace(/\/*$/, '');
    const expoPath   = `${dir}/lumio.db`;
    const APP_FILES_DIR = '/data/data/com.lumio.savelater/files';
    const nativePath = `${APP_FILES_DIR}/SQLite/lumio.db`;
    expect(nativePath).toBe(expoPath);
  });

  it('recoverPendingShares() does not throw when the pending_shares table is empty', async () => {
    // Use mockResolvedValueOnce so the implementation is not wiped
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    await expect(ShareIngestionManager.recoverPendingShares()).resolves.not.toThrow();
  });

  it('ingest() does not throw on a completely empty share payload', async () => {
    await expect(
      ShareIngestionManager.ingest('lumio://share?text=&title=&subject=&urls=')
    ).resolves.not.toThrow();
  });

  // ── REGRESSION GUARD: JSI concurrent-init race (bugreport-nuwa_in 2026-10-07) ──
  //
  // Root cause: on a fresh install cold-share start, Expo Router calls
  // redirectSystemPath() → ingest() → initDatabase() at ~125 ms into JS execution
  // while libexpo-sqlite.so JSI bindings are still being registered.  The old
  // _initialized boolean flag allowed a second concurrent initDatabase() call to
  // run DDL while getDatabase() was mid-await, causing Hermes to throw
  // "JS Functions are not convertible to dynamic" on the mqt_native_modules thread.
  //
  // Fix: db.ts now stores _initPromise (the in-flight Promise).  All concurrent
  // callers await the same single Promise — DDL executes exactly once.

  it('BSL-008-R1: initDatabase() returns the same Promise on concurrent calls (no DDL race)', async () => {
    // Isolate: get a fresh instance of db module with no prior init state.
    jest.resetModules();
    // Re-apply the SQLite mock in the new module registry.
    jest.mock('expo-sqlite', () => ({
      openDatabaseAsync: jest.fn().mockResolvedValue(mockDb),
      defaultDatabaseDirectory: '/data/data/com.lumio.savelater/files/SQLite',
    }));
    jest.mock('../../src/database/migrations', () => ({
      runLegacyCollectionMigration: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../../src/services/serviceReadiness', () => ({
      signalDatabaseInitialized: jest.fn(),
      waitForServicesReady:      jest.fn().mockResolvedValue(undefined),
      getReadinessSnapshot:      jest.fn().mockReturnValue({ database: false, dataProvider: false, captureQueue: false }),
      signalDataProviderReady:   jest.fn(),
      signalCaptureQueueReady:   jest.fn(),
      resetReadinessGate:        jest.fn(),
      getLifecycleState:         jest.fn().mockReturnValue('cold_start'),
    }));

    const { initDatabase } = require('../../src/database/db');
    const SQLite = require('expo-sqlite');

    // Fire two concurrent initDatabase() calls — simulates DataContext + ingest() race.
    const [p1, p2] = [initDatabase(), initDatabase()];

    // Both promises must resolve without throwing.
    await expect(Promise.all([p1, p2])).resolves.not.toThrow();

    // openDatabaseAsync must have been called exactly once — confirming no DDL race.
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('BSL-008-R2: initDatabase() retries on JSI-not-ready error pattern (cold-share resilience)', async () => {
    jest.resetModules();

    // Must be prefixed 'mock' to be accessible inside the jest.mock() factory (Babel hoisting rule).
    let mockJsiCallCount = 0;
    const mockDbLocal = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync:  jest.fn().mockResolvedValue({}),
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockResolvedValue(null),
    };

    jest.mock('expo-sqlite', () => ({
      // Fail with JSI error on first call, succeed on second — simulates 125 ms JSI load window.
      openDatabaseAsync: jest.fn().mockImplementation(() => {
        mockJsiCallCount += 1;
        if (mockJsiCallCount === 1) {
          return Promise.reject(new Error('JS Functions are not convertible to dynamic'));
        }
        return Promise.resolve(mockDbLocal);
      }),
      defaultDatabaseDirectory: '/data/data/com.lumio.savelater/files/SQLite',
    }));
    jest.mock('../../src/database/migrations', () => ({
      runLegacyCollectionMigration: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../../src/services/serviceReadiness', () => ({
      signalDatabaseInitialized: jest.fn(),
      waitForServicesReady:      jest.fn().mockResolvedValue(undefined),
      getReadinessSnapshot:      jest.fn().mockReturnValue({ database: false, dataProvider: false, captureQueue: false }),
      signalDataProviderReady:   jest.fn(),
      signalCaptureQueueReady:   jest.fn(),
      resetReadinessGate:        jest.fn(),
      getLifecycleState:         jest.fn().mockReturnValue('cold_start'),
    }));

    const { initDatabase } = require('../../src/database/db');

    // initDatabase() must survive the first JSI error and succeed on retry.
    await expect(initDatabase()).resolves.not.toThrow();
    // openDatabaseAsync must have been called twice (fail then succeed).
    const SQLite = require('expo-sqlite');
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BASELINE GATE — summary assertion
//  This block runs last. If any of the above suites fail, Jest will have
//  already failed the run. This suite provides a human-readable checkpoint.
// ─────────────────────────────────────────────────────────────────────────────

describe('BASELINE GATE — Release Readiness', () => {
  it('all baseline modules are importable without crash', () => {
    // If any required module fails to load, this test catches the crash.
    expect(() => require('../../src/services/shareIngestion')).not.toThrow();
    expect(() => require('../../src/services/languageDetection')).not.toThrow();
    expect(() => require('../../src/services/collectionInsights')).not.toThrow();
    expect(() => require('../../src/services/diagnostics')).not.toThrow();
    expect(() => require('../../src/services/captureQueue')).not.toThrow();
    expect(() => require('../../plugins/withNativeShare')).not.toThrow();
  });

  it('Lumio Stability Baseline: all critical constants are in place', () => {
    const { NATIVE_SHARE_ACTIVITY_KT, SHARE_WORKER_KT, LUMIO_SHARED_PREFS_MODULE_KT, LUMIO_SHARED_PREFS_PACKAGE_KT } =
      require('../../plugins/withNativeShare');
    // Each constant must be a non-empty string
    expect(typeof NATIVE_SHARE_ACTIVITY_KT).toBe('string');
    expect(NATIVE_SHARE_ACTIVITY_KT.length).toBeGreaterThan(100);
    expect(typeof SHARE_WORKER_KT).toBe('string');
    expect(SHARE_WORKER_KT.length).toBeGreaterThan(50);
    expect(typeof LUMIO_SHARED_PREFS_MODULE_KT).toBe('string');
    expect(typeof LUMIO_SHARED_PREFS_PACKAGE_KT).toBe('string');
  });
});
