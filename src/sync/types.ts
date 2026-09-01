/**
 * Offline-First Sync Architecture — Domain Types
 *
 * Design principles:
 * - Local SQLite is always the single source of truth.
 * - The sync layer is provider-agnostic via the CloudSyncAdapter interface.
 * - Every write is enqueued before it is applied; the engine drains the queue
 *   asynchronously with exponential back-off.
 * - Conflict resolution is last-write-wins by (updated_at, version). The
 *   interfaces are shaped to accept vector-clock metadata in a future upgrade.
 */

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

export type SyncEntityType = 'item' | 'collection';

export type SyncOperationType = 'upsert' | 'delete';

/** A single operation waiting to be pushed to the cloud. */
export interface SyncQueueEntry {
  /** Auto-incremented SQLite rowid. */
  id: number;
  /** UUID of the entity being synced. */
  entityId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  /**
   * Full JSON snapshot of the entity at the time of the write.
   * NULL for delete operations.
   */
  payload: string | null;
  /** ISO-8601 timestamp of when this entry was enqueued. */
  enqueuedAt: string;
  /** How many push attempts have been made. */
  attempts: number;
  /**
   * ISO-8601 timestamp of the next allowed retry.
   * NULL means the entry is immediately eligible.
   */
  nextRetryAt: string | null;
  /** 'pending' | 'processing' | 'failed' | 'dead' */
  status: SyncQueueStatus;
  /** Last error message (for diagnostics). */
  lastError: string | null;
}

export type SyncQueueStatus = 'pending' | 'processing' | 'failed' | 'dead';

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

export interface VersionedEntity {
  id: string;
  updatedAt: string;
  /** Monotonically increasing integer bumped on every local write. */
  version: number;
}

export type ConflictResolutionStrategy = 'last-write-wins';

export interface ConflictResolutionResult<T extends VersionedEntity> {
  winner: T;
  loser: T;
  strategy: ConflictResolutionStrategy;
}

// ---------------------------------------------------------------------------
// Sync metadata
// ---------------------------------------------------------------------------

export interface SyncMetadata {
  key: string;
  value: string;
}

// Known metadata keys
export const SYNC_META_LAST_PUSH = 'last_push_at';
export const SYNC_META_LAST_PULL = 'last_pull_at';
export const SYNC_META_DEVICE_ID = 'device_id';

// ---------------------------------------------------------------------------
// Sync engine state (exposed via SyncContext)
// ---------------------------------------------------------------------------

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'error'
  | 'offline';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  deadLetterCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Cloud adapter interface
// ---------------------------------------------------------------------------

export interface PushResult {
  successIds: string[];
  failedIds: string[];
}

export interface PullResult<T> {
  records: T[];
  serverTimestamp: string;
}
