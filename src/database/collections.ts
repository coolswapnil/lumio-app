import { getDatabase } from './db';
import type { Collection, IconName } from '../types';

function rowToCollection(row: Record<string, unknown>): Collection {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    icon: row.icon as IconName,
    color: row.color as string,
    isSystem: Boolean(row.is_system),
    itemCount: (row.item_count as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getAllCollections(): Promise<Collection[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT c.*, COUNT(i.id) as item_count
     FROM collections c
     LEFT JOIN saved_items i ON i.collection_id = c.id
     GROUP BY c.id
     ORDER BY c.name ASC`
  );
  return rows.map(rowToCollection);
}

export async function getCollectionById(id: string): Promise<Collection | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT c.*, COUNT(i.id) as item_count
     FROM collections c
     LEFT JOIN saved_items i ON i.collection_id = c.id
     WHERE c.id = ?
     GROUP BY c.id`,
    [id]
  );
  return row ? rowToCollection(row) : null;
}

export async function saveCollection(collection: Omit<Collection, 'itemCount'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO collections (id, name, description, icon, color, is_system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      collection.id,
      collection.name,
      collection.description ?? null,
      collection.icon,
      collection.color,
      collection.isSystem ? 1 : 0,
      collection.createdAt,
      collection.updatedAt,
    ]
  );
}

export async function updateCollection(
  id: string,
  updates: Partial<Pick<Collection, 'name' | 'description' | 'icon' | 'color'>>
): Promise<void> {
  const db = await getDatabase();
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description ?? null); }
  if (updates.icon !== undefined) { fields.push('icon = ?'); values.push(updates.icon); }
  if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }

  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(
    `UPDATE collections SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM collections WHERE id = ?', [id]);
}
