/**
 * Unit tests for runLegacyCollectionMigration
 *
 * Verifies:
 *  - Pass 1 (rename-and-adopt): correct SQL for item FK update + collection row update
 *  - Pass 2 (alias remap): correct item FK update SQL for alias entries
 *  - Idempotent: no diagLog.addEntry when changes = 0
 *  - diagLog.addEntry called when changes > 0
 */

import { runLegacyCollectionMigration } from '../../src/database/migrations';
import type { SQLiteDatabase } from 'expo-sqlite';

// Mock diagnostics
jest.mock('../../src/services/diagnostics', () => ({
  diagLog: {
    addEntry: jest.fn(),
  },
}));

import { diagLog } from '../../src/services/diagnostics';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Creates a mock SQLiteDatabase whose runAsync returns a controlled result. */
function makeMockDb(changes = 0): jest.Mocked<Pick<SQLiteDatabase, 'runAsync'>> {
  return {
    runAsync: jest.fn().mockResolvedValue({ changes, lastInsertRowId: 0 }),
  } as unknown as jest.Mocked<Pick<SQLiteDatabase, 'runAsync'>>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Pass 1: rename-and-adopt ───────────────────────────────────────────────────
describe('runLegacyCollectionMigration — Pass 1 rename-and-adopt', () => {
  it('issues UPDATE saved_items with collection_id = sys-finance for "Finance"', async () => {
    const db = makeMockDb(1);

    await runLegacyCollectionMigration(db as unknown as SQLiteDatabase);

    // Step A: item FK update for "Finance" → sys-finance
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE saved_items SET collection_id = ?'),
      expect.arrayContaining(['sys-finance', 'Finance', 'sys-finance'])
    );

    // The item FK SQL must use a sub-select that filters by lower(name) and excludes the sysId
    const itemFkCall = (db.runAsync as jest.Mock).mock.calls.find(
      ([sql, params]: [string, unknown[]]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE saved_items SET collection_id = ?') &&
        sql.includes("SELECT id FROM collections WHERE lower(name) = lower(?)") &&
        Array.isArray(params) &&
        params[0] === 'sys-finance' &&
        params[1] === 'Finance' &&
        params[2] === 'sys-finance'
    );
    expect(itemFkCall).toBeDefined();
  });

  it('issues UPDATE collections with id = sys-finance, is_system = 1 for "Finance"', async () => {
    const db = makeMockDb(1);

    await runLegacyCollectionMigration(db as unknown as SQLiteDatabase);

    // Step B: collection row adopt for "Finance" → sys-finance
    const collectionsCall = (db.runAsync as jest.Mock).mock.calls.find(
      ([sql, params]: [string, unknown[]]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE collections SET id = ?') &&
        sql.includes('is_system = 1') &&
        Array.isArray(params) &&
        params[0] === 'sys-finance' &&
        params[1] === 'Finance' &&
        params[2] === 'sys-finance'
    );
    expect(collectionsCall).toBeDefined();
  });
});

// ── Pass 2: alias remap ────────────────────────────────────────────────────────
describe('runLegacyCollectionMigration — Pass 2 alias remap', () => {
  it('issues UPDATE saved_items for "Property & Land Deals" → sys-real-estate', async () => {
    const db = makeMockDb(1);

    await runLegacyCollectionMigration(db as unknown as SQLiteDatabase);

    const aliasCall = (db.runAsync as jest.Mock).mock.calls.find(
      ([sql, params]: [string, unknown[]]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE saved_items SET collection_id = ?') &&
        sql.includes("SELECT id FROM collections WHERE lower(name) = lower(?)") &&
        Array.isArray(params) &&
        params[0] === 'sys-real-estate' &&
        params[1] === 'Property & Land Deals'
    );
    expect(aliasCall).toBeDefined();
  });
});

// ── Idempotency: changes = 0 → no diagLog entries ─────────────────────────────
describe('runLegacyCollectionMigration — idempotency (changes = 0)', () => {
  it('does not call diagLog.addEntry when all runAsync calls return changes = 0', async () => {
    const db = makeMockDb(0); // changes = 0 for every call

    await runLegacyCollectionMigration(db as unknown as SQLiteDatabase);

    expect(diagLog.addEntry).not.toHaveBeenCalled();
  });
});

// ── diagLog called when changes > 0 ───────────────────────────────────────────
describe('runLegacyCollectionMigration — diagLog on changes > 0', () => {
  it('calls diagLog.addEntry with DATABASE_INITIALIZED when changes > 0', async () => {
    const db = makeMockDb(3); // all calls return 3 changes

    await runLegacyCollectionMigration(db as unknown as SQLiteDatabase);

    expect(diagLog.addEntry).toHaveBeenCalledWith(
      'DATABASE_INITIALIZED',
      expect.any(String)
    );
  });

  it('includes "Finance" and "sys-finance" in the log entry for Pass 1 item FK update', async () => {
    const db = makeMockDb(2);

    await runLegacyCollectionMigration(db as unknown as SQLiteDatabase);

    const financeEntry = (diagLog.addEntry as jest.Mock).mock.calls.find(
      ([, msg]: [string, string]) =>
        typeof msg === 'string' &&
        msg.includes('Finance') &&
        msg.includes('sys-finance')
    );
    expect(financeEntry).toBeDefined();
  });
});
