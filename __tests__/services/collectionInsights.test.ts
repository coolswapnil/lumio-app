import dayjs from 'dayjs';
import { buildCollectionInsights, findRelatedItems, searchCollectionItems } from '../../src/services/collectionInsights';
import type { Collection, SavedItem } from '../../src/types';

const collection: Collection = {
  id: 'collection-1', name: 'Investing', icon: 'cash', color: '#10b981', itemCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function item(overrides: Partial<SavedItem>): SavedItem {
  return {
    id: 'item-1', title: 'Dividend investing basics', contentType: 'article', tags: ['dividend'],
    isCompleted: false, isFavorite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('collection insights', () => {
  const items = [
    item({ id: '1', title: 'Dividend investing basics', tags: ['dividend', 'stocks'], category: 'Finance', source: 'youtube', address: 'New York', aiSummary: 'Build a dividend portfolio.' }),
    item({ id: '2', title: 'Portfolio dividend strategy', tags: ['dividend', 'portfolio'], category: 'Finance', source: 'youtube', createdAt: '2026-02-20T00:00:00.000Z', aiSummary: 'Stocks for long term income.' }),
    item({ id: '3', title: 'Travel planning', tags: ['travel'], category: 'Travel', source: 'instagram', createdAt: '2026-03-01T00:00:00.000Z' }),
  ];

  it('derives collection dashboard metrics from stored intelligence', () => {
    const insights = buildCollectionInsights(collection, items, dayjs('2026-03-10T00:00:00.000Z'));

    expect(insights.itemCount).toBe(3);
    expect(insights.topCategory).toEqual({ label: 'Finance', count: 2 });
    expect(insights.topSource).toEqual({ label: 'youtube', count: 2 });
    expect(insights.mostActiveTopic).toEqual({ label: 'dividend', count: 2 });
    expect(insights.topLocations).toEqual([{ label: 'New York', count: 1 }]);
    expect(insights.itemsAddedLast30Days).toBe(2);
    expect(insights.health).toBe('Growing');
    expect(insights.reviewItems[0].reason).toBe('Saved 30+ days ago');
  });

  it('marks empty and stale collections as inactive', () => {
    expect(buildCollectionInsights(collection, [], dayjs('2026-03-10T00:00:00.000Z')).health).toBe('Inactive');
    expect(buildCollectionInsights(collection, [items[0]], dayjs('2026-03-10T00:00:00.000Z')).health).toBe('Inactive');
  });

  it('finds related saved items by category, tags, title and summary', () => {
    const results = findRelatedItems(items[0], items);
    expect(results.map((r) => r.item.id)).toEqual(['2']);
  });

  it('attaches explainability data to each match', () => {
    const results = findRelatedItems(items[0], items);
    expect(results).toHaveLength(1);
    const match = results[0];
    expect(match.categoryMatch).toBe(true);
    expect(match.sharedTags).toContain('dividend');
    expect(match.score).toBeGreaterThanOrEqual(0.35);
  });

  it('excludes cross-category content regardless of shared words', () => {
    // Travel item shares the "New York" location with item[0] but different category
    // → must never appear as related
    const results = findRelatedItems(items[0], items);
    expect(results.map((r) => r.item.id)).not.toContain('3');
  });

  it('excludes items that only share a single tag with no category match', () => {
    const base = item({ id: 'base', tags: ['finance', 'stocks'], category: 'Finance', aiSummary: 'investing' });
    const onlyOneTag = item({ id: 'onetag', tags: ['stocks', 'comedy'], category: 'Entertainment', aiSummary: 'stand-up comedy' });
    const results = findRelatedItems(base, [base, onlyOneTag]);
    expect(results.map((r) => r.item.id)).not.toContain('onetag');
  });

  it('searches titles, tags, summaries, categories and sources', () => {
    expect(searchCollectionItems(items, 'income').map((result) => result.id)).toEqual(['2']);
    expect(searchCollectionItems(items, 'finance').map((result) => result.id)).toEqual(['1', '2']);
    expect(searchCollectionItems(items, 'instagram').map((result) => result.id)).toEqual(['3']);
  });
});
