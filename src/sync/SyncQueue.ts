/**
 * SyncQueue — SQLite-backed persistent operation queue.
 *
 * Responsibilities:
 * - Durably persist every write operation before it is applied.
 * - Expose dequeue/markFailed/markDead/clearCompleted lifecycle methods for
 *   the SyncEngine to drive.
 * - Track retry eligibility via `next_retry_at` (computed by SyncEngine).
 */

import { getDatabase } from '../database/db';
import type { SyncQueueEntry, SyncEntityType, SyncOperationType } from './types';

// ---------------------------------------------------------------------------
// Internal row → domain mapper
// ---------------------------------------------------------------------------

function rowToEntry(row: Record<string, unknown>): SyncQueueEntry {
  return {
    id: row.id as number,
    entityId: row.entity_id as string,
    entityType: row.entity_type as SyncEntityType,
    operation: row.operation as SyncOperationType,
    payload: row.payload as string | null,
    enqueuedAt: row.enqueued_at as string,
    attempts: row.attempts as number,
    nextRetryAt: row.next_retry_at as string | null,
    status: row.status as SyncQueueEntry['status'],
    lastError: row.last_error as string | null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a new operation to the queue.
 * Always called *before* the local write so no operation is ever lost on crash.
 */
export async function enqueue(
  entityId: string,
  entityType: SyncEntityType,
  operation: SyncOperationType,
  payload: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO sync_queue
       (entity_id, entity_type, operation, payload, enqueued_at, attempts, status)
     VALUES (?, ?, ?, ?, ?, 0, 'pending')`,
    [entityId, entityType, operation, payload, new Date().toISOString()]
  );
}

/**
 * Return all entries that are due for processing (status=pending|failed, next_retry_at
 * is NULL or in the past), ordered FIFO.
 */
export async function dequeueBatch(limit = 20): Promise<SyncQueueEntry[]> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sync_queue
     WHERE status IN ('pending','failed')
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY enqueued_at ASC
     LIMIT ?`,
    [now, limit]
  );
  return rows.map(rowToEntry);
}

/** Mark entries as 'processing' to prevent double-processing across concurrent calls. */
export async function markProcessing(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDatabase();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE sync_queue SET status = 'processing' WHERE id IN (${placeholders})`,
    ids
  );
}

/** Remove successfully synced entries from the queue. */
export async function markSuccess(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDatabase();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `DELETE FROM sync_queue WHERE id IN (${placeholders})`,
    ids
  );
}

/**
 * Record a failed attempt.  nextRetryAt is computed externally by the engine
 * (exponential back-off).  If attempts >= MAX_ATTEMPTS the entry is moved to
 * the dead-letter state.
 */
export async function markFailed(
  id: number,
  error: string,
  nextRetryAt: string,
  isDead: boolean
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE sync_queue
     SET status        = ?,
         attempts      = attempts + 1,
         last_error    = ?,
         next_retry_at = ?
     WHERE id = ?`,
    [isDead ? 'dead' : 'failed', error, nextRetryAt, id]
  );
}

/** Return all dead-letter entries (for display in settings / diagnostics). */
export async function getDeadLetters(): Promise<SyncQueueEntry[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sync_queue WHERE status = 'dead' ORDER BY enqueued_at ASC`
  );
  return rows.map(rowToEntry);
}

/** Delete all dead-letter entries (user-initiated clear). */
export async function clearDeadLetters(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM sync_queue WHERE status = 'dead'`);
}

/** Count pending + failed entries (shown in the UI badge). */
export async function getPendingCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('pending','failed','processing')`
  );
  return row?.count ?? 0;
}

/** Count dead-letter entries. */
export async function getDeadLetterCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'dead'`
  );
  return row?.count ?? 0;
}

/**
 * Record a tombstone so that deleted entities can be synced even after
 * their local rows are gone.
 */
export async function addTombstone(
  entityId: string,
  entityType: SyncEntityType
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_tombstones (entity_id, entity_type, deleted_at)
     VALUES (?, ?, ?)`,
    [entityId, entityType, new Date().toISOString()]
  );
}

/** Read a metadata key. */
export async function getMetaValue(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_metadata WHERE key = ?`,
    [key]
  );
  return row?.value ?? null;
}

/** Write a metadata key. */
export async function setMetaValue(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)`,
    [key, value]
  );
}
