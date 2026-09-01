/**
 * SyncRepository — thin write wrapper over the database helpers.
 *
 * Every mutating operation:
 *   1. Enqueues the operation to sync_queue (durable, survives crashes).
 *   2. Bumps the `version` column before writing.
 *   3. Applies the change to the local SQLite database.
 *
 * The queue is drained asynchronously by the SyncEngine. Callers in
 * DataContext and screen components should use this repository instead of
 * calling the database helpers directly.
 */

import * as Items from '../database/items';
import * as Collections from '../database/collections';
import { getDatabase } from '../database/db';
import { enqueue, addTombstone } from './SyncQueue';
import type { SavedItem, Collection } from '../types';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Save (create) a new item.
 * The item must have its `id`, `createdAt`, and `updatedAt` set by the caller.
 */
export async function syncSaveItem(item: SavedItem): Promise<void> {
  const versioned = { ...item, version: 1 };
  await enqueue(item.id, 'item', 'upsert', JSON.stringify(versioned));
  await Items.saveItem(versioned as SavedItem);
}

/**
 * Update an existing item.
 * Bumps version and updatedAt, then enqueues the full patched snapshot.
 */
export async function syncUpdateItem(
  id: string,
  updates: Partial<SavedItem>
): Promise<void> {
  // Read current version so we can increment it.
  const current = await Items.getItemById(id);
  const newVersion = (current as (SavedItem & { version?: number }) | null)?.version ?? 0;

  const patchedUpdatedAt = new Date().toISOString();
  await bumpItemVersion(id, newVersion + 1, patchedUpdatedAt);

  await Items.updateItem(id, { ...updates, updatedAt: patchedUpdatedAt });

  // Build a full snapshot for the queue payload.
  const after = await Items.getItemById(id);
  if (after) {
    await enqueue(id, 'item', 'upsert', JSON.stringify(after));
  }
}

/**
 * Delete an item.
 * Records a tombstone so the deletion can be propagated on next sync.
 */
export async function syncDeleteItem(id: string): Promise<void> {
  await enqueue(id, 'item', 'delete', null);
  await addTombstone(id, 'item');
  await Items.deleteItem(id);
}

export async function syncToggleFavorite(id: string, current: boolean): Promise<void> {
  await syncUpdateItem(id, { isFavorite: !current });
}

export async function syncToggleCompleted(id: string, current: boolean): Promise<void> {
  await syncUpdateItem(id, { isCompleted: !current });
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/**
 * Save (create) a new collection.
 */
export async function syncSaveCollection(
  collection: Omit<Collection, 'itemCount'>
): Promise<void> {
  const versioned = { ...collection, version: 1 };
  await enqueue(collection.id, 'collection', 'upsert', JSON.stringify(versioned));
  await Collections.saveCollection(versioned as Omit<Collection, 'itemCount'>);
}

/**
 * Update a collection's editable fields.
 */
export async function syncUpdateCollection(
  id: string,
  updates: Partial<Pick<Collection, 'name' | 'description' | 'icon' | 'color'>>
): Promise<void> {
  const current = await Collections.getCollectionById(id);
  const newVersion = (current as (Collection & { version?: number }) | null)?.version ?? 0;

  const patchedUpdatedAt = new Date().toISOString();
  await bumpCollectionVersion(id, newVersion + 1, patchedUpdatedAt);

  await Collections.updateCollection(id, updates);

  const after = await Collections.getCollectionById(id);
  if (after) {
    await enqueue(id, 'collection', 'upsert', JSON.stringify(after));
  }
}

/**
 * Delete a collection.
 */
export async function syncDeleteCollection(id: string): Promise<void> {
  await enqueue(id, 'collection', 'delete', null);
  await addTombstone(id, 'collection');
  await Collections.deleteCollection(id);
}

// ---------------------------------------------------------------------------
// Private helpers — version bookkeeping
// ---------------------------------------------------------------------------

async function bumpItemVersion(
  id: string,
  version: number,
  updatedAt: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE saved_items SET version = ?, updated_at = ? WHERE id = ?`,
    [version, updatedAt, id]
  );
}

async function bumpCollectionVersion(
  id: string,
  version: number,
  updatedAt: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE collections SET version = ?, updated_at = ? WHERE id = ?`,
    [version, updatedAt, id]
  );
}
