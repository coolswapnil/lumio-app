/**
 * CloudSyncAdapter — provider-agnostic interface.
 *
 * Implement this interface to add a real sync backend (e.g. IBM AppID +
 * Cloudant, Supabase, Firebase, custom REST API). The SyncEngine depends
 * only on this interface; swapping adapters requires zero engine changes.
 */

import type { SyncQueueEntry, PushResult, PullResult } from '../types';
import type { SavedItem, Collection } from '../../types';

export interface CloudSyncAdapter {
  /**
   * Push a batch of queue entries to the remote.
   * The adapter is responsible for serialising and transmitting them.
   * Returns which entity IDs succeeded and which failed (transient errors).
   */
  push(entries: SyncQueueEntry[]): Promise<PushResult>;

  /**
   * Pull records that changed on the server since `since` (ISO-8601).
   * Pass null to do a full initial sync.
   */
  pullItems(since: string | null): Promise<PullResult<SavedItem>>;
  pullCollections(since: string | null): Promise<PullResult<Collection>>;

  /**
   * Check whether the adapter can reach the remote endpoint.
   * The engine calls this before each sync cycle to skip gracefully when
   * offline.
   */
  isReachable(): Promise<boolean>;
}
