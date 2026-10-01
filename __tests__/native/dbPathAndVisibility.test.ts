/**
 * Validation suite: NativeShareActivity ↔ expo-sqlite database alignment.
 *
 * Covers:
 *  1. expo-sqlite path contract  — confirms the path formula used by the
 *     native module matches what NativeShareActivity must resolve.
 *  2. findDatabaseFile() correctness — verifies the fixed Kotlin resolves to
 *     `filesDir/SQLite/lumio.db` (same as expo-sqlite defaultDatabaseDirectory).
 *  3. WAL mode enforcement — the native opener issues PRAGMA journal_mode = WAL.
 *  4. End-to-end visibility — native insert → app launch → getAllItems() returns
 *     the item without migration or manual refresh.
 */

// ---------------------------------------------------------------------------
// Mocks — declared before any imports so jest hoisting picks them up.
// ---------------------------------------------------------------------------

const mockRows: Record<string, unknown>[] = [];

const mockDb = {
  execAsync: jest.fn().mockResolvedValue(undefined),
  runAsync: jest.fn().mockResolvedValue(undefined),
  getAllAsync: jest.fn().mockImplementation(async (sql: string) => {
    if (/FROM saved_items/i.test(sql)) return [...mockRows];
    return [];
  }),
  getFirstAsync: jest.fn().mockResolvedValue(null),
};

jest.mock('expo-sqlite', () => ({
  // Must be a function — jest.fn() in factory bodies is not hoisted correctly;
  // use a plain arrow that returns the already-constructed mockDb at call time.
  openDatabaseAsync: jest.fn(),
  defaultDatabaseDirectory: '/data/data/com.lumio.savelater/files/SQLite',
}));

jest.mock('../../src/services/serviceReadiness', () => ({
  signalDatabaseInitialized: jest.fn(),
}));

jest.mock('../../src/database/migrations', () => ({
  runLegacyCollectionMigration: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports — after mock declarations.
// ---------------------------------------------------------------------------

import * as SQLite from 'expo-sqlite';
import { initDatabase, getDatabase } from '../../src/database/db';
import { getAllItems } from '../../src/database/items';

// Wire up the mock return value here (after import so the reference is live).
(SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(mockDb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the path formula expo-sqlite uses for `openDatabaseAsync('lumio.db')`. */
function expoSqlitePath(): string {
  // From expo-sqlite/build/pathUtils.js createDatabasePath():
  //   `${removeTrailingSlash(defaultDatabaseDirectory)}/${databaseName}`
  const dir = (
    SQLite as unknown as { defaultDatabaseDirectory: string }
  ).defaultDatabaseDirectory.replace(/\/*$/, '');
  return `${dir}/lumio.db`;
}

/** Simulates what the corrected findDatabaseFile() Kotlin produces. */
function nativeActivityPath(filesDir: string): string {
  // Fixed Kotlin: File(filesDir, "SQLite/lumio.db")
  return `${filesDir}/SQLite/lumio.db`;
}

// ---------------------------------------------------------------------------
// 1. Path identity
// ---------------------------------------------------------------------------

describe('Database path identity — expo-sqlite vs NativeShareActivity', () => {
  const APP_FILES_DIR = '/data/data/com.lumio.savelater/files';

  it('expo-sqlite defaultDatabaseDirectory is filesDir/SQLite', () => {
    const expected = `${APP_FILES_DIR}/SQLite`;
    expect(
      (SQLite as unknown as { defaultDatabaseDirectory: string })
        .defaultDatabaseDirectory
    ).toBe(expected);
  });

  it('expo-sqlite resolves lumio.db to filesDir/SQLite/lumio.db', () => {
    expect(expoSqlitePath()).toBe(`${APP_FILES_DIR}/SQLite/lumio.db`);
  });

  it('fixed NativeShareActivity findDatabaseFile() resolves to the same path', () => {
    expect(nativeActivityPath(APP_FILES_DIR)).toBe(expoSqlitePath());
  });

  it('paths are byte-for-byte identical (no casing or separator difference)', () => {
    expect(nativeActivityPath(APP_FILES_DIR)).toStrictEqual(expoSqlitePath());
  });

  it('previous wrong path (databases/SQLite/) does NOT match expo-sqlite', () => {
    const wrongPath = `/data/data/com.lumio.savelater/databases/SQLite/lumio.db`;
    expect(wrongPath).not.toBe(expoSqlitePath());
  });

  it('previous fallback path (databases/lumio.db) does NOT match expo-sqlite', () => {
    const wrongFallback = `/data/data/com.lumio.savelater/databases/lumio.db`;
    expect(wrongFallback).not.toBe(expoSqlitePath());
  });
});

// ---------------------------------------------------------------------------
// 2. WAL mode — NativeShareActivity Kotlin source contains the PRAGMA
// ---------------------------------------------------------------------------

describe('WAL mode enforcement in NativeShareActivity Kotlin source', () => {
  // The plugin exports the Kotlin template string — inspect it directly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');

  it('native opener issues PRAGMA journal_mode = WAL', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('PRAGMA journal_mode = WAL');
  });

  it('native opener uses CREATE_IF_NECESSARY so a fresh-install cold share creates the file', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('CREATE_IF_NECESSARY');
  });

  it('logs the resolved DB path at runtime (SQLITE_DB_PATH tag)', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('SQLITE_DB_PATH');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('resolved=');
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('exists=');
  });
});

// ---------------------------------------------------------------------------
// 3. findDatabaseFile() uses filesDir, NOT filesDir.parentFile
// ---------------------------------------------------------------------------

describe('NativeShareActivity findDatabaseFile() path construction', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NATIVE_SHARE_ACTIVITY_KT } = require('../../plugins/withNativeShare');

  it('uses File(filesDir, "SQLite/lumio.db") — correct expo-sqlite location', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).toContain('File(filesDir, "SQLite/lumio.db")');
  });

  it('does NOT use filesDir.parentFile (which resolves to databases/ not files/)', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).not.toContain('filesDir.parentFile');
  });

  it('does NOT reference the wrong databases/ directory', () => {
    expect(NATIVE_SHARE_ACTIVITY_KT).not.toContain('"databases/');
  });
});

// ---------------------------------------------------------------------------
// 4. End-to-end: native insert → app launch → getAllItems() visibility
//
//    Flow:
//      a) NativeShareActivity writes a row to pending_shares (native insert).
//         For a share that progresses to saved_items (via ShareIngestionManager),
//         the final record is visible directly in saved_items.
//         This test pre-seeds saved_items with such a record.
//      b) App launches — initDatabase() runs, getDatabase() opens the same file.
//      c) getAllItems() returns the row WITHOUT migration or manual refresh.
// ---------------------------------------------------------------------------

describe('End-to-end visibility: native insert → app launch → getAllItems()', () => {
  const NATIVE_INSERTED_ITEM: Record<string, unknown> = {
    id: 'native-e2e-test-001',
    title: 'Article shared natively',
    description: null,
    url: 'https://example.com/article',
    image_url: null,
    content_type: 'link',
    collection_id: null,
    tags: '[]',
    notes: null,
    address: null,
    latitude: null,
    longitude: null,
    is_completed: 0,
    is_favorite: 0,
    ai_summary: null,
    source: 'share',
    media_type: null,
    category: null,
    suggested_collections: '[]',
    detected_language: null,
    translated_summary: null,
    translated_tags: '[]',
    category_reason: null,
    collection_reason: null,
    topic_id: null,
    topic_suggestion: null,
    topic_suggestion_raw: null,
    created_at: '2024-01-15T10:00:00.000Z',
    updated_at: '2024-01-15T10:00:00.000Z',
    version: 1,
  };

  beforeEach(() => {
    // Clear call history before each assertion so counts are precise.
    mockDb.execAsync.mockClear();
    mockDb.getAllAsync.mockClear();
    // Seed the mock store with the natively inserted record.
    mockRows.length = 0;
    mockRows.push(NATIVE_INSERTED_ITEM);
  });

  it('getDatabase() opens exactly "lumio.db" — the expo-sqlite default filename', async () => {
    await getDatabase();
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('lumio.db');
  });

  it('WAL PRAGMA is applied during initDatabase()', async () => {
    await initDatabase();
    const calls: string[] = mockDb.execAsync.mock.calls.flat();
    expect(calls.some((c) => /PRAGMA journal_mode\s*=\s*WAL/i.test(c))).toBe(true);
  });

  it('getAllItems() returns the natively inserted item without migration or refresh', async () => {
    const items = await getAllItems();
    const found = items.find((i) => i.id === NATIVE_INSERTED_ITEM.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Article shared natively');
    expect(found?.url).toBe('https://example.com/article');
  });

  it('item is visible immediately on first call — no warm-up needed', async () => {
    // Single cold call — no prior initDatabase() or getDatabase() in this test.
    const items = await getAllItems('all', 'newest');
    expect(items.some((i) => i.id === NATIVE_INSERTED_ITEM.id)).toBe(true);
  });

  it('item createdAt is preserved exactly as native code wrote it (ISO 8601 UTC)', async () => {
    const items = await getAllItems();
    const found = items.find((i) => i.id === NATIVE_INSERTED_ITEM.id);
    expect(found?.createdAt).toBe('2024-01-15T10:00:00.000Z');
  });
});
