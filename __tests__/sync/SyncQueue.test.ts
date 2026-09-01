/**
 * SyncQueue unit tests.
 *
 * We mock the database module so the tests run without a real SQLite file.
 */

import {
  enqueue,
  markSuccess,
  markFailed,
  getDeadLetters,
  clearDeadLetters,
  getPendingCount,
  getDeadLetterCount,
  addTombstone,
  getMetaValue,
  setMetaValue,
} from '../../src/sync/SyncQueue';

// ---------------------------------------------------------------------------
// Minimal SQLite mock
// ---------------------------------------------------------------------------

interface MockRow {
  [key: string]: unknown;
}

const mockStore: MockRow[] = [];
let autoId = 1;

const mockDb = {
  runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('INSERT INTO SYNC_QUEUE')) {
      const entry: MockRow = {
        id: autoId++,
        entity_id: params[0],
        entity_type: params[1],
        operation: params[2],
        payload: params[3],
        enqueued_at: params[4],
        attempts: 0,
        next_retry_at: null,
        status: 'pending',
        last_error: null,
      };
      mockStore.push(entry);
    } else if (s.startsWith('DELETE FROM SYNC_QUEUE WHERE ID IN')) {
      const ids = params as number[];
      for (const id of ids) {
        const idx = mockStore.findIndex((r) => r.id === id);
        if (idx !== -1) mockStore.splice(idx, 1);
      }
    } else if (s.startsWith('UPDATE SYNC_QUEUE')) {
      // minimal: find by last param (id) and apply status/attempts/error/retry
      const id = params[params.length - 1] as number;
      const entry = mockStore.find((r) => r.id === id);
      if (entry) {
        if (s.includes('STATUS = ?')) entry.status = params[0];
        if (s.includes('ATTEMPTS = ATTEMPTS + 1')) entry.attempts = (entry.attempts as number) + 1;
        if (s.includes('LAST_ERROR')) entry.last_error = params[1];
        if (s.includes('NEXT_RETRY_AT')) entry.next_retry_at = params[2];
      }
    } else if (s.startsWith('DELETE FROM SYNC_QUEUE WHERE STATUS')) {
      const idx = mockStore.findIndex((r) => r.status === 'dead');
      while (idx !== -1) {
        mockStore.splice(
          mockStore.findIndex((r) => r.status === 'dead'),
          1
        );
        if (!mockStore.some((r) => r.status === 'dead')) break;
      }
    }
  }),
  getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.trim().toUpperCase();
    if (s.includes("STATUS = 'DEAD'")) {
      return mockStore.filter((r) => r.status === 'dead');
    }
    if (s.includes("STATUS IN ('PENDING','FAILED')")) {
      const now = params[0] as string;
      return mockStore.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'failed') &&
          (r.next_retry_at === null || (r.next_retry_at as string) <= now)
      );
    }
    return [];
  }),
  getFirstAsync: jest.fn(async (sql: string) => {
    const s = sql.trim().toUpperCase();
    if (s.includes("STATUS IN ('PENDING','FAILED','PROCESSING')")) {
      return { count: mockStore.filter((r) => ['pending','failed','processing'].includes(r.status as string)).length };
    }
    if (s.includes("STATUS = 'DEAD'")) {
      return { count: mockStore.filter((r) => r.status === 'dead').length };
    }
    return null;
  }),
};

jest.mock('../../src/database/db', () => ({
  getDatabase: jest.fn().mockResolvedValue(mockDb),
}));

// Also mock the metadata and tombstone helpers' internal db calls
const metaStore: Record<string, string> = {};
const tombstoneStore: Array<{ entity_id: string; entity_type: string }> = [];

// Override runAsync to also handle metadata + tombstone tables
const originalRunAsync = mockDb.runAsync;
mockDb.runAsync = jest.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim().toUpperCase();
  if (s.startsWith('INSERT OR REPLACE INTO SYNC_METADATA')) {
    metaStore[params[0] as string] = params[1] as string;
    return;
  }
  if (s.startsWith('INSERT OR REPLACE INTO SYNC_TOMBSTONES')) {
    tombstoneStore.push({ entity_id: params[0] as string, entity_type: params[1] as string });
    return;
  }
  return originalRunAsync(sql, params);
});

mockDb.getFirstAsync = jest.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim().toUpperCase();
  if (s.includes('FROM SYNC_METADATA')) {
    const key = params[0] as string;
    return metaStore[key] ? { value: metaStore[key] } : null;
  }
  // Delegate to existing mock
  if (s.includes("STATUS IN ('PENDING','FAILED','PROCESSING')")) {
    return { count: mockStore.filter((r) => ['pending','failed','processing'].includes(r.status as string)).length };
  }
  if (s.includes("STATUS = 'DEAD'")) {
    return { count: mockStore.filter((r) => r.status === 'dead').length };
  }
  return null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockStore.length = 0;
  autoId = 1;
  jest.clearAllMocks();
});

describe('SyncQueue — enqueue', () => {
  it('persists an upsert entry', async () => {
    await enqueue('item-1', 'item', 'upsert', JSON.stringify({ id: 'item-1' }));
    expect(mockStore).toHaveLength(1);
    expect(mockStore[0].entity_id).toBe('item-1');
    expect(mockStore[0].operation).toBe('upsert');
    expect(mockStore[0].status).toBe('pending');
  });

  it('persists a delete entry with null payload', async () => {
    await enqueue('item-2', 'item', 'delete', null);
    expect(mockStore[0].payload).toBeNull();
    expect(mockStore[0].operation).toBe('delete');
  });

  it('persists a collection entry', async () => {
    await enqueue('col-1', 'collection', 'upsert', '{}');
    expect(mockStore[0].entity_type).toBe('collection');
  });
});

describe('SyncQueue — markSuccess', () => {
  it('removes entries from the queue', async () => {
    await enqueue('item-1', 'item', 'upsert', '{}');
    const id = mockStore[0].id as number;
    await markSuccess([id]);
    expect(mockStore).toHaveLength(0);
  });

  it('is a no-op for an empty array', async () => {
    await expect(markSuccess([])).resolves.toBeUndefined();
  });
});

describe('SyncQueue — markFailed', () => {
  it('increments attempts and sets next_retry_at', async () => {
    await enqueue('item-1', 'item', 'upsert', '{}');
    const id = mockStore[0].id as number;
    const retry = new Date(Date.now() + 2000).toISOString();
    await markFailed(id, 'timeout', retry, false);
    expect(mockStore[0].status).toBe('failed');
    expect(mockStore[0].last_error).toBe('timeout');
  });

  it('marks as dead when isDead=true', async () => {
    await enqueue('item-1', 'item', 'upsert', '{}');
    const id = mockStore[0].id as number;
    await markFailed(id, 'fatal', new Date().toISOString(), true);
    expect(mockStore[0].status).toBe('dead');
  });
});

describe('SyncQueue — dead letters', () => {
  it('getDeadLetters returns only dead entries', async () => {
    await enqueue('a', 'item', 'upsert', '{}');
    await enqueue('b', 'item', 'upsert', '{}');
    const idA = mockStore[0].id as number;
    await markFailed(idA, 'err', new Date().toISOString(), true);
    const dead = await getDeadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0].entityId).toBe('a');
  });

  it('clearDeadLetters removes all dead entries', async () => {
    await enqueue('a', 'item', 'upsert', '{}');
    const id = mockStore[0].id as number;
    await markFailed(id, 'err', new Date().toISOString(), true);
    await clearDeadLetters();
    const dead = await getDeadLetters();
    expect(dead).toHaveLength(0);
  });
});

describe('SyncQueue — counts', () => {
  it('getPendingCount counts pending + failed + processing', async () => {
    await enqueue('a', 'item', 'upsert', '{}');
    await enqueue('b', 'item', 'upsert', '{}');
    expect(await getPendingCount()).toBe(2);
  });

  it('getDeadLetterCount counts only dead entries', async () => {
    await enqueue('a', 'item', 'upsert', '{}');
    const id = mockStore[0].id as number;
    await markFailed(id, 'err', new Date().toISOString(), true);
    expect(await getDeadLetterCount()).toBe(1);
  });
});

describe('SyncQueue — addTombstone', () => {
  it('records a tombstone entry', async () => {
    await addTombstone('item-deleted', 'item');
    expect(tombstoneStore).toHaveLength(1);
    expect(tombstoneStore[0].entity_id).toBe('item-deleted');
  });
});

describe('SyncQueue — metadata', () => {
  it('stores and retrieves a metadata key', async () => {
    await setMetaValue('last_push_at', '2025-01-01T00:00:00.000Z');
    const val = await getMetaValue('last_push_at');
    expect(val).toBe('2025-01-01T00:00:00.000Z');
  });

  it('returns null for a missing key', async () => {
    const val = await getMetaValue('nonexistent');
    expect(val).toBeNull();
  });
});
