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

/** Scores saved items using only locally available collection intelligence. */
export function findRelatedItems(item: SavedItem, candidates: SavedItem[], limit = 4): SavedItem[] {
  const titleWords = words(item.title);
  const summaryWords = words(item.translatedSummary ?? item.aiSummary ?? item.description);
  const tags = new Set(displayTags(item).map((tag) => tag.toLocaleLowerCase()));

  return candidates
    .filter((candidate) => candidate.id !== item.id)
    .map((candidate) => {
      const candidateTags = new Set(displayTags(candidate).map((tag) => tag.toLocaleLowerCase()));
      const tagScore = overlap(tags, candidateTags) * 4;
      const categoryScore = item.category && item.category === candidate.category ? 3 : 0;
      const titleScore = overlap(titleWords, words(candidate.title)) * 2;
      const summaryScore = overlap(summaryWords, words(candidate.translatedSummary ?? candidate.aiSummary ?? candidate.description));
      return { candidate, score: tagScore + categoryScore + titleScore + summaryScore };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.candidate.createdAt.localeCompare(a.candidate.createdAt))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
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
