/**
 * Unit tests for maybeAutoCreateTopic
 *
 * Verifies:
 *  - 5-item threshold triggers topic creation
 *  - 3-item + 2-day threshold triggers topic creation
 *  - Below-threshold cases return null without creating a topic
 *  - Idempotency: existing topic is returned, not duplicated
 *  - Back-fill: UPDATE saved_items is called with the new topic_id
 */

// IMPORTANT: this const must be declared BEFORE jest.mock calls use it.
// Because jest.mock is hoisted, any reference to a const defined in the same
// module scope would be undefined at hoist time — so we inline the literal in
// the factory and keep the const for assertions only.
const MOCK_UUID = 'test-topic-id-0001';

jest.mock('../../src/utils/uuid', () => ({
  generateId: jest.fn().mockReturnValue('test-topic-id-0001'),
}));

// ── Mock DB module ─────────────────────────────────────────────────────────────
// Expose the mock db through jest.requireMock so we can control it per-test
// without running into the jest.mock hoisting / closure timing problem.
jest.mock('../../src/database/db');

import { maybeAutoCreateTopic } from '../../src/database/topics';
import { getDatabase } from '../../src/database/db';

const mockedGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

// A reusable mock db object — replace .mockReturnValue per test via setupDb
const mockDb = {
  getFirstAsync: jest.fn(),
  runAsync: jest.fn(),
};

// Always resolve getDatabase to our mockDb
beforeAll(() => {
  mockedGetDatabase.mockResolvedValue(mockDb as never);
});

beforeEach(() => {
  mockDb.getFirstAsync.mockReset();
  mockDb.runAsync.mockReset().mockResolvedValue({ changes: 0, lastInsertRowId: 0 });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Sets up getFirstAsync to respond to the three SELECT queries in sequence:
 *   1. COUNT(*) → total items
 *   2. COUNT(DISTINCT DATE(...)) → distinct save-days
 *   3. SELECT * FROM topics → existing topic (null = not found)
 */
function setupDb(total: number, distinctDays: number, existingTopic: Record<string, unknown> | null = null) {
  mockDb.getFirstAsync
    .mockResolvedValueOnce({ total })
    .mockResolvedValueOnce({ distinct_days: distinctDays })
    .mockResolvedValueOnce(existingTopic);
}

// ── 5-item threshold ───────────────────────────────────────────────────────────
describe('maybeAutoCreateTopic — 5-item threshold', () => {
  it('creates a new topic when COUNT(*) = 5 and distinctDays = 1', async () => {
    setupDb(5, 1);

    const result = await maybeAutoCreateTopic('dividend-investing', 'Dividend Investing', 'col-finance');

    expect(result).not.toBeNull();
    expect(result!.id).toBe(MOCK_UUID);
    expect(result!.label).toBe('Dividend Investing');
    expect(result!.normalizedLabel).toBe('dividend-investing');
    expect(result!.parentCollectionId).toBe('col-finance');
    expect(result!.itemCount).toBe(5);

    // Must INSERT into topics
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO topics'),
      expect.arrayContaining([MOCK_UUID, 'Dividend Investing', 'dividend-investing', 'col-finance', 5])
    );

    // Must back-fill saved_items
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE saved_items SET topic_id = ?'),
      [MOCK_UUID, 'dividend-investing', 'col-finance']
    );
  });
});

// ── 3-item + 2-day threshold ───────────────────────────────────────────────────
describe('maybeAutoCreateTopic — 3-item + 2-day threshold', () => {
  it('creates a new topic when COUNT(*) = 3 and distinctDays = 2', async () => {
    setupDb(3, 2);

    const result = await maybeAutoCreateTopic('property-investment', 'Property Investment', 'col-real-estate');

    expect(result).not.toBeNull();
    expect(result!.normalizedLabel).toBe('property-investment');
    expect(result!.itemCount).toBe(3);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO topics'),
      expect.arrayContaining([MOCK_UUID, 'Property Investment', 'property-investment', 'col-real-estate', 3])
    );
  });
});

// ── Below threshold — no topic created ────────────────────────────────────────
describe('maybeAutoCreateTopic — below threshold', () => {
  it('returns null when COUNT(*) = 3 and distinctDays = 1', async () => {
    mockDb.getFirstAsync
      .mockResolvedValueOnce({ total: 3 })
      .mockResolvedValueOnce({ distinct_days: 1 });

    const result = await maybeAutoCreateTopic('travel-tips', 'Travel Tips', 'col-travel');

    expect(result).toBeNull();
    expect(mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('returns null when COUNT(*) = 2', async () => {
    mockDb.getFirstAsync
      .mockResolvedValueOnce({ total: 2 })
      .mockResolvedValueOnce({ distinct_days: 2 });

    const result = await maybeAutoCreateTopic('budget-travel', 'Budget Travel', 'col-travel');

    expect(result).toBeNull();
    expect(mockDb.runAsync).not.toHaveBeenCalled();
  });
});

// ── Idempotency — existing topic returned, no duplicate ───────────────────────
describe('maybeAutoCreateTopic — idempotency', () => {
  it('returns the existing topic without inserting a duplicate', async () => {
    const existingTopicRow = {
      id: 'existing-topic-id',
      label: 'Dividend Investing',
      normalized_label: 'dividend-investing',
      parent_collection_id: 'col-finance',
      item_count: 5,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    setupDb(6, 1, existingTopicRow);

    const result = await maybeAutoCreateTopic('dividend-investing', 'Dividend Investing', 'col-finance');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('existing-topic-id');
    expect(result!.itemCount).toBe(6);

    // Must NOT insert a new topic row
    expect(mockDb.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO topics'),
      expect.anything()
    );

    // Must update item_count on the existing topic
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE topics SET item_count = ?'),
      [6, 'existing-topic-id']
    );
  });
});

// ── Back-fill: UPDATE saved_items uses the correct topic_id ───────────────────
describe('maybeAutoCreateTopic — backfill', () => {
  it('calls UPDATE saved_items with the newly created topic_id and correct filters', async () => {
    setupDb(5, 1);

    await maybeAutoCreateTopic('stock-market', 'Stock Market', 'col-finance');

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE saved_items SET topic_id = ? WHERE topic_suggestion = ? AND collection_id = ?',
      [MOCK_UUID, 'stock-market', 'col-finance']
    );
  });
});
