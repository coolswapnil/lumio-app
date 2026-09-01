/**
 * NoOpSyncAdapter — local-only (offline) adapter.
 *
 * This adapter satisfies the CloudSyncAdapter interface but performs no
 * network operations. It is used as the default until a real backend is
 * configured.
 *
 * Usage: pass an instance to SyncEngine when initialising SyncContext.
 *
 *   const engine = new SyncEngine(new NoOpSyncAdapter());
 *
 * To add a real backend, implement CloudSyncAdapter and swap the adapter:
 *
 *   const engine = new SyncEngine(new MyCloudAdapter(config));
 */

import type { CloudSyncAdapter } from './CloudSyncAdapter';
import type { SyncQueueEntry, PushResult, PullResult } from '../types';
import type { SavedItem, Collection } from '../../types';

export class NoOpSyncAdapter implements CloudSyncAdapter {
  async push(_entries: SyncQueueEntry[]): Promise<PushResult> {
    // No remote — report all entries as "succeeded" so the engine clears them.
    const successIds = _entries.map((e) => e.entityId);
    return { successIds, failedIds: [] };
  }

  async pullItems(_since: string | null): Promise<PullResult<SavedItem>> {
    return { records: [], serverTimestamp: new Date().toISOString() };
  }

  async pullCollections(_since: string | null): Promise<PullResult<Collection>> {
    return { records: [], serverTimestamp: new Date().toISOString() };
  }

  async isReachable(): Promise<boolean> {
    // Always "reachable" (local-only mode never blocks).
    return true;
  }
}
