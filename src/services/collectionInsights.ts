import dayjs from 'dayjs';
import type { Collection, SavedItem } from '../types';

export interface InsightValue {
  label: string;
  count: number;
}

export interface ReviewItem {
  item: SavedItem;
  reason: 'Never revisited' | 'Saved 30+ days ago';
}

export interface CollectionInsights {
  itemCount: number;
  topCategory?: InsightValue;
  topSource?: InsightValue;
  topTags: InsightValue[];
  topCategories: InsightValue[];
  topSources: InsightValue[];
  topLocations: InsightValue[];
  lastAddedAt?: string;
  itemsAddedLast30Days: number;
  mostActiveTopic?: InsightValue;
  highlyRepresentedTopic?: InsightValue;
  reviewItems: ReviewItem[];
  health: 'Healthy' | 'Growing' | 'Inactive';
  summary: string;
}

function rankedValues(values: Array<string | undefined>, limit = 5): InsightValue[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value?.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const entry = counts.get(key);
    counts.set(key, (entry ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({ label: values.find((value) => value?.trim().toLocaleLowerCase() === key)?.trim() ?? key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function displayTags(item: SavedItem): string[] {
  return item.translatedTags && item.translatedTags.length > 0 ? item.translatedTags : item.tags;
}

export function buildCollectionInsights(collection: Collection, items: SavedItem[], now = dayjs()): CollectionInsights {
  const topTags = rankedValues(items.flatMap(displayTags));
  const topCategories = rankedValues(items.map((item) => item.category));
  const topSources = rankedValues(items.map((item) => item.source));
  const topLocations = rankedValues(items.map((item) => item.address));
  const lastAddedAt = items.reduce<string | undefined>((latest, item) => !latest || item.createdAt > latest ? item.createdAt : latest, undefined);
  const reviewItems = items
    .filter((item) => now.diff(dayjs(item.createdAt), 'day') >= 30)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 5)
    .map((item) => ({ item, reason: 'Saved 30+ days ago' as const }));
  const topic = topTags[0];
  const category = topCategories[0];
  const source = topSources[0];
  const health = items.length === 0 || !lastAddedAt || now.diff(dayjs(lastAddedAt), 'day') > 30
    ? 'Inactive'
    : items.filter((item) => now.diff(dayjs(item.createdAt), 'day') < 30).length >= 2
      ? 'Growing'
      : 'Healthy';
  const phrases = [
    topic ? `${topic.label} and related resources` : undefined,
    category ? `${category.label.toLocaleLowerCase()} content` : undefined,
    source ? `saved from ${source.label}` : undefined,
  ].filter(Boolean);

  return {
    itemCount: items.length,
    topCategory: category,
    topSource: source,
    topTags,
    topCategories,
    topSources,
    topLocations,
    lastAddedAt,
    itemsAddedLast30Days: items.filter((item) => now.diff(dayjs(item.createdAt), 'day') < 30).length,
    mostActiveTopic: topic,
    highlyRepresentedTopic: topic && topic.count >= 2 ? topic : undefined,
    reviewItems,
    health,
    summary: phrases.length > 0
      ? `This collection focuses on ${phrases.join(', ')}.`
      : collection.description ?? 'Save items here to build a knowledge hub.',
  };
}

function words(value?: string): Set<string> {
  return new Set((value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

function overlap(first: Set<string>, second: Set<string>): number {
  let matches = 0;
  for (const word of first) if (second.has(word)) matches += 1;
  return matches;
}

/**
 * Normalises an overlap count to a [0, 1] similarity fraction.
 * Returns 0 when either set is empty (avoids division-by-zero).
 */
function normalisedOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return overlap(a, b) / Math.max(a.size, b.size);
}

/**
 * Explainability data returned alongside each related item.
 *
 * Surfaces to the UI as:
 *   "Why related?"
 *   Category: Technology
 *   Shared Tags: Productivity, Tools
 */
export interface RelatedItemMatch {
  item: SavedItem;
  /** Composite similarity score in [0, 1]. */
  score: number;
  /** Whether the items share the same category. */
  categoryMatch: boolean;
  /** Tags that appear in both items (display-ready, original casing). */
  sharedTags: string[];
}

/**
 * Score related items using weighted dimensions:
 *   Category  50 %
 *   Tags      25 %
 *   Summary   20 %
 *   Location   5 %
 *
 * Minimum threshold: 0.35 — items below this score are never shown.
 *
 * Hard guards (applied before scoring):
 *   • Category mismatch → excluded outright (location or summary alone
 *     cannot produce a cross-category match above 0.35).
 *   • Single shared tag with no category match → excluded.
 *   • Location match alone (no category, no tags, no summary) → excluded.
 */
const RELATED_WEIGHTS = { category: 0.50, tags: 0.25, summary: 0.20, location: 0.05 };
const RELATED_MIN_SCORE = 0.35;

export function findRelatedItems(item: SavedItem, candidates: SavedItem[], limit = 4): RelatedItemMatch[] {
  const summaryWords = words(item.translatedSummary ?? item.aiSummary ?? item.description);
  const itemTags = displayTags(item).map((tag) => tag.toLocaleLowerCase());
  const tags = new Set(itemTags);
  const itemLocation = item.address?.toLocaleLowerCase().trim();

  const scored = candidates
    .filter((candidate) => candidate.id !== item.id)
    .map((candidate) => {
      // Category — exact match produces full weight
      const categoryMatch = !!(item.category && item.category === candidate.category);
      const categoryScore = categoryMatch ? 1 : 0;

      // Tags — normalised Jaccard-style overlap
      const candidateTagsRaw = displayTags(candidate);
      const candidateTags = new Set(candidateTagsRaw.map((tag) => tag.toLocaleLowerCase()));
      const tagScore = normalisedOverlap(tags, candidateTags);

      // ── Hard guard: single shared tag with no category match → skip ────
      const sharedTagCount = [...tags].filter((t) => candidateTags.has(t)).length;
      if (!categoryMatch && sharedTagCount <= 1) return null;

      // Summary — normalised word overlap across summary / description text
      const candidateSummaryWords = words(
        candidate.translatedSummary ?? candidate.aiSummary ?? candidate.description,
      );
      const summaryScore = normalisedOverlap(summaryWords, candidateSummaryWords);

      // Location — exact string match on address (city / venue level)
      const candidateLocation = candidate.address?.toLocaleLowerCase().trim();
      const locationScore =
        itemLocation && candidateLocation && itemLocation === candidateLocation ? 1 : 0;

      // ── Hard guard: location alone cannot create a match ───────────────
      if (locationScore > 0 && categoryScore === 0 && tagScore === 0 && summaryScore === 0) return null;

      const score =
        categoryScore * RELATED_WEIGHTS.category +
        tagScore      * RELATED_WEIGHTS.tags +
        summaryScore  * RELATED_WEIGHTS.summary +
        locationScore * RELATED_WEIGHTS.location;

      // Collect shared tags in their original display casing
      const sharedTags = candidateTagsRaw.filter((tag) => tags.has(tag.toLocaleLowerCase()));

      return { candidate, score, categoryMatch, sharedTags };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.score >= RELATED_MIN_SCORE);

  return scored
    .sort((a, b) => b.score - a.score || b.candidate.createdAt.localeCompare(a.candidate.createdAt))
    .slice(0, limit)
    .map(({ candidate, score, categoryMatch, sharedTags }) => ({
      item: candidate,
      score,
      categoryMatch,
      sharedTags,
    }));
}

export function searchCollectionItems(items: SavedItem[], query: string): SavedItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => [
    item.title,
    item.category,
    item.source,
    item.aiSummary,
    item.translatedSummary,
    ...displayTags(item),
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
}
