import { getDatabase } from './db';
import type { SavedItem, ContentType, SortOption, FilterOption } from '../types';

function rowToItem(row: Record<string, unknown>): SavedItem {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | undefined,
    url: row.url as string | undefined,
    imageUrl: row.image_url as string | undefined,
    contentType: row.content_type as ContentType,
    collectionId: row.collection_id as string | undefined,
    tags: JSON.parse((row.tags as string) || '[]'),
    notes: row.notes as string | undefined,
    latitude: row.latitude as number | undefined,
    longitude: row.longitude as number | undefined,
    address: row.address as string | undefined,
    isCompleted: Boolean(row.is_completed),
    isFavorite: Boolean(row.is_favorite),
    aiSummary: row.ai_summary as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getAllItems(
  filter: FilterOption = 'all',
  sort: SortOption = 'newest',
  searchQuery?: string
): Promise<SavedItem[]> {
  const db = await getDatabase();

  let whereClause = '';
  const params: (string | number)[] = [];

  if (filter === 'favorites') {
    whereClause = 'WHERE is_favorite = 1';
  } else if (filter === 'completed') {
    whereClause = 'WHERE is_completed = 1';
  } else if (filter !== 'all') {
    whereClause = 'WHERE content_type = ?';
    params.push(filter);
  }

  if (searchQuery && searchQuery.trim()) {
    const q = `%${searchQuery.trim()}%`;
    whereClause += whereClause ? ' AND' : 'WHERE';
    whereClause += ' (title LIKE ? OR description LIKE ? OR notes LIKE ? OR tags LIKE ?)';
    params.push(q, q, q, q);
  }

  const orderMap: Record<SortOption, string> = {
    newest: 'ORDER BY created_at DESC',
    oldest: 'ORDER BY created_at ASC',
    alphabetical: 'ORDER BY title ASC',
    type: 'ORDER BY content_type ASC, created_at DESC',
  };

  const sql = `SELECT * FROM saved_items ${whereClause} ${orderMap[sort]}`;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, params);
  return rows.map(rowToItem);
}

export async function getItemsByCollection(collectionId: string): Promise<SavedItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM saved_items WHERE collection_id = ? ORDER BY created_at DESC',
    [collectionId]
  );
  return rows.map(rowToItem);
}

export async function getItemById(id: string): Promise<SavedItem | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM saved_items WHERE id = ?',
    [id]
  );
  return row ? rowToItem(row) : null;
}

export async function saveItem(item: SavedItem): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO saved_items
      (id, title, description, url, image_url, content_type, collection_id, tags, notes,
       latitude, longitude, address, is_completed, is_favorite, ai_summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.title,
      item.description ?? null,
      item.url ?? null,
      item.imageUrl ?? null,
      item.contentType,
      item.collectionId ?? null,
      JSON.stringify(item.tags),
      item.notes ?? null,
      item.latitude ?? null,
      item.longitude ?? null,
      item.address ?? null,
      item.isCompleted ? 1 : 0,
      item.isFavorite ? 1 : 0,
      item.aiSummary ?? null,
      item.createdAt,
      item.updatedAt,
    ]
  );
}

export async function updateItem(id: string, updates: Partial<SavedItem>): Promise<void> {
  const db = await getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description ?? null); }
  if (updates.url !== undefined) { fields.push('url = ?'); values.push(updates.url ?? null); }
  if (updates.imageUrl !== undefined) { fields.push('image_url = ?'); values.push(updates.imageUrl ?? null); }
  if (updates.contentType !== undefined) { fields.push('content_type = ?'); values.push(updates.contentType); }
  if (updates.collectionId !== undefined) { fields.push('collection_id = ?'); values.push(updates.collectionId ?? null); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
  if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes ?? null); }
  if (updates.latitude !== undefined) { fields.push('latitude = ?'); values.push(updates.latitude ?? null); }
  if (updates.longitude !== undefined) { fields.push('longitude = ?'); values.push(updates.longitude ?? null); }
  if (updates.address !== undefined) { fields.push('address = ?'); values.push(updates.address ?? null); }
  if (updates.isCompleted !== undefined) { fields.push('is_completed = ?'); values.push(updates.isCompleted ? 1 : 0); }
  if (updates.isFavorite !== undefined) { fields.push('is_favorite = ?'); values.push(updates.isFavorite ? 1 : 0); }
  if (updates.aiSummary !== undefined) { fields.push('ai_summary = ?'); values.push(updates.aiSummary ?? null); }

  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(
    `UPDATE saved_items SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteItem(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM saved_items WHERE id = ?', [id]);
}

export async function toggleFavorite(id: string, current: boolean): Promise<void> {
  await updateItem(id, { isFavorite: !current });
}

export async function toggleCompleted(id: string, current: boolean): Promise<void> {
  await updateItem(id, { isCompleted: !current });
}

export async function getItemCounts(): Promise<Record<string, number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ content_type: string; count: number }>(
    'SELECT content_type, COUNT(*) as count FROM saved_items GROUP BY content_type'
  );
  const counts: Record<string, number> = { all: 0 };
  for (const row of rows) {
    counts[row.content_type] = row.count;
    counts.all += row.count;
  }
  return counts;
}
