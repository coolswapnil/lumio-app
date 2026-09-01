/**
 * ConflictResolver — last-write-wins strategy.
 *
 * Current strategy: compare (updatedAt, version).
 *   - The entity with the later updatedAt wins.
 *   - If updatedAt is equal, the higher version number wins.
 *   - If both are equal, local wins (optimistic local-first).
 *
 * Future extensibility:
 *   - The VersionedEntity interface has a `version` integer that can be
 *     promoted to a vector clock (per-device logical clock) without changing
 *     callers.
 *   - Add a `vectorClock` field to VersionedEntity and update
 *     compareVersionedEntities() to use Lamport / HLC comparison.
 */

import type { VersionedEntity, ConflictResolutionResult } from './types';

/**
 * Compare two versions of the same entity and return the one that should be
 * kept as the authoritative local record.
 *
 * @param local   The record currently stored in SQLite.
 * @param remote  The record received from the cloud adapter.
 */
export function resolveConflict<T extends VersionedEntity>(
  local: T,
  remote: T
): ConflictResolutionResult<T> {
  const localTs = new Date(local.updatedAt).getTime();
  const remoteTs = new Date(remote.updatedAt).getTime();

  let winner: T;
  let loser: T;

  if (remoteTs > localTs) {
    winner = remote;
    loser = local;
  } else if (localTs > remoteTs) {
    winner = local;
    loser = remote;
  } else if (remote.version > local.version) {
    // Same timestamp — use version as tie-breaker.
    winner = remote;
    loser = local;
  } else {
    // Equal timestamp and version — local wins (optimistic local-first).
    winner = local;
    loser = remote;
  }

  return { winner, loser, strategy: 'last-write-wins' };
}

/**
 * Convenience helper: return true if the remote entity is newer than local.
 * Used by the SyncEngine to decide whether to overwrite local data on pull.
 */
export function remoteIsNewer(
  local: VersionedEntity,
  remote: VersionedEntity
): boolean {
  const result = resolveConflict(local, remote);
  return result.winner === remote;
}
