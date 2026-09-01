/**
 * SyncEngine — offline-first sync orchestrator.
 *
 * Responsibilities:
 * - Drain the sync_queue in FIFO batches.
 * - Apply exponential back-off on failures (base 1s, cap 5 min).
 * - Move entries to dead-letter after MAX_ATTEMPTS failures.
 * - Optionally run a background interval (call startBackground / stopBackground).
 * - Expose a one-shot `sync()` method for forced / manual sync.
 *
 * The engine is intentionally framework-agnostic. SyncContext owns the
 * engine instance and bridges it to React state.
 */

import {
  dequeueBatch,
  markProcessing,
  markSuccess,
  markFailed,
  getPendingCount,
  getDeadLetterCount,
  setMetaValue,
} from './SyncQueue';
import { SYNC_META_LAST_PUSH } from './types';
import type { CloudSyncAdapter } from './adapters/CloudSyncAdapter';
import type { SyncQueueEntry } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;      // 1 second
const MAX_BACKOFF_MS = 5 * 60_000;  // 5 minutes
const BACKGROUND_INTERVAL_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncEngineEvent =
  | { type: 'start' }
  | { type: 'success'; successCount: number }
  | { type: 'error'; error: string }
  | { type: 'idle'; pendingCount: number; deadLetterCount: number };

export type SyncEngineListener = (event: SyncEngineEvent) => void;

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private adapter: CloudSyncAdapter;
  private listeners: Set<SyncEngineListener> = new Set();
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  constructor(adapter: CloudSyncAdapter) {
    this.adapter = adapter;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Swap the adapter at runtime (e.g. user logs in to a cloud service). */
  setAdapter(adapter: CloudSyncAdapter): void {
    this.adapter = adapter;
  }

  /** Subscribe to engine events (status changes, counts). */
  addListener(listener: SyncEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start periodic background sync. Safe to call multiple times. */
  startBackground(): void {
    if (this.backgroundTimer !== null) return;
    this.backgroundTimer = setInterval(() => {
      this.sync().catch(() => {/* handled inside sync() */});
    }, BACKGROUND_INTERVAL_MS);
  }

  /** Stop background sync. */
  stopBackground(): void {
    if (this.backgroundTimer !== null) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  /**
   * Run a single sync cycle: check reachability, drain the queue in batches,
   * emit events throughout.
   */
  async sync(): Promise<void> {
    if (this.isSyncing) return; // Prevent concurrent runs.
    this.isSyncing = true;

    try {
      const reachable = await this.adapter.isReachable();
      if (!reachable) {
        this.emit({ type: 'idle', pendingCount: await getPendingCount(), deadLetterCount: await getDeadLetterCount() });
        return;
      }

      this.emit({ type: 'start' });

      let totalSuccess = 0;

      // Drain queue in batches until empty.
      let batch: SyncQueueEntry[];
      do {
        batch = await dequeueBatch(BATCH_SIZE);
        if (batch.length === 0) break;

        const ids = batch.map((e) => e.id);
        await markProcessing(ids);

        const result = await this.adapter.push(batch);

        // Mark successful entries as done.
        const successEntries = batch.filter((e) =>
          result.successIds.includes(e.entityId)
        );
        if (successEntries.length > 0) {
          await markSuccess(successEntries.map((e) => e.id));
          totalSuccess += successEntries.length;
        }

        // Mark failed entries with back-off.
        const failedEntries = batch.filter((e) =>
          result.failedIds.includes(e.entityId)
        );
        for (const entry of failedEntries) {
          const newAttempts = entry.attempts + 1;
          const isDead = newAttempts >= MAX_ATTEMPTS;
          const nextRetryAt = isDead
            ? new Date().toISOString()
            : new Date(Date.now() + computeBackoff(newAttempts)).toISOString();

          await markFailed(
            entry.id,
            `Push failed (attempt ${newAttempts})`,
            nextRetryAt,
            isDead
          );
        }
      } while (batch.length === BATCH_SIZE);

      await setMetaValue(SYNC_META_LAST_PUSH, new Date().toISOString());

      this.emit({ type: 'success', successCount: totalSuccess });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', error: message });
    } finally {
      // Always emit an idle event with the latest counts.
      const pendingCount = await getPendingCount();
      const deadLetterCount = await getDeadLetterCount();
      this.emit({ type: 'idle', pendingCount, deadLetterCount });
      this.isSyncing = false;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private emit(event: SyncEngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Never let a bad listener crash the engine.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Back-off calculator
// ---------------------------------------------------------------------------

/**
 * Exponential back-off: base * 2^(attempts-1), capped at MAX_BACKOFF_MS,
 * with ±20% jitter to avoid thundering-herd on device-wide retry storms.
 */
function computeBackoff(attempts: number): number {
  const exp = Math.min(attempts - 1, 10); // prevent 2^huge overflow
  const base = BASE_BACKOFF_MS * Math.pow(2, exp);
  const capped = Math.min(base, MAX_BACKOFF_MS);
  const jitter = capped * 0.2 * (Math.random() * 2 - 1); // ±20%
  return Math.round(capped + jitter);
}
