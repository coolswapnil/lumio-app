import { getDatabase } from './db';
import { generateId } from '../utils/uuid';
import type { Topic, SavedItem } from '../types';
import { rowToItem } from './items';

function rowToTopic(row: Record<string, unknown>): Topic {
  return {
    id: row.id as string,
    label: row.label as string,
    normalizedLabel: row.normalized_label as string,
    parentCollectionId: row.parent_collection_id as string,
    itemCount: row.item_count as number,
    createdAt: row.created_at as string,
  };
}

export async function getTopicsByCollection(collectionId: string): Promise<Topic[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM topics WHERE parent_collection_id = ? ORDER BY item_count DESC, label ASC',
    [collectionId]
  );
  return rows.map(rowToTopic);
}

export async function getAllTopics(): Promise<Topic[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM topics ORDER BY parent_collection_id, item_count DESC'
  );
  return rows.map(rowToTopic);
}

export async function getTopicById(id: string): Promise<Topic | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM topics WHERE id = ?',
    [id]
  );
  return row ? rowToTopic(row) : null;
}

export async function getItemsByTopic(topicId: string): Promise<SavedItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM saved_items WHERE topic_id = ? ORDER BY created_at DESC',
    [topicId]
  );
  return rows.map(rowToItem);
}

export async function maybeAutoCreateTopic(
  normalizedLabel: string,
  rawLabel: string,
  collectionId: string
): Promise<Topic | null> {
  const db = await getDatabase();

  const countRow = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) as total FROM saved_items WHERE topic_suggestion = ? AND collection_id = ?',
    [normalizedLabel, collectionId]
  );
  const total = countRow?.total ?? 0;

  const daysRow = await db.getFirstAsync<{ distinct_days: number }>(
    "SELECT COUNT(DISTINCT DATE(created_at)) as distinct_days FROM saved_items WHERE topic_suggestion = ? AND collection_id = ?",
    [normalizedLabel, collectionId]
  );
  const distinctDays = daysRow?.distinct_days ?? 0;

  const meetsThreshold = total >= 5 || (total >= 3 && distinctDays >= 2);
  if (!meetsThreshold) return null;

  // Check for an existing topic
  const existing = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM topics WHERE normalized_label = ? AND parent_collection_id = ?',
    [normalizedLabel, collectionId]
  );

  if (existing) {
    await db.runAsync(
      'UPDATE topics SET item_count = ? WHERE id = ?',
      [total, existing.id as string]
    );
    return rowToTopic({ ...existing, item_count: total });
  }

  // Insert new topic
  const newId = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO topics (id, label, normalized_label, parent_collection_id, item_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [newId, rawLabel, normalizedLabel, collectionId, total, now]
  );

  // Back-fill topic_id on matching items
  await db.runAsync(
    'UPDATE saved_items SET topic_id = ? WHERE topic_suggestion = ? AND collection_id = ?',
    [newId, normalizedLabel, collectionId]
  );

  return {
    id: newId,
    label: rawLabel,
    normalizedLabel,
    parentCollectionId: collectionId,
    itemCount: total,
    createdAt: now,
  };
}
