/**
 * ConflictResolver unit tests.
 *
 * Exercises all four resolution paths:
 *   1. Remote is newer (remote timestamp > local)
 *   2. Local is newer  (local timestamp > remote)
 *   3. Same timestamp, remote has higher version
 *   4. Same timestamp and version → local wins (optimistic local-first)
 */

import { resolveConflict, remoteIsNewer } from '../../src/sync/ConflictResolver';
import type { VersionedEntity } from '../../src/sync/types';

// Helpers
function makeEntity(
  id: string,
  updatedAt: string,
  version: number
): VersionedEntity {
  return { id, updatedAt, version };
}

const T1 = '2025-01-01T10:00:00.000Z';
const T2 = '2025-01-01T11:00:00.000Z'; // T2 > T1

describe('ConflictResolver — resolveConflict', () => {
  it('returns remote when remote timestamp is newer', () => {
    const local  = makeEntity('x', T1, 1);
    const remote = makeEntity('x', T2, 1);
    const result = resolveConflict(local, remote);
    expect(result.winner).toBe(remote);
    expect(result.loser).toBe(local);
    expect(result.strategy).toBe('last-write-wins');
  });

  it('returns local when local timestamp is newer', () => {
    const local  = makeEntity('x', T2, 2);
    const remote = makeEntity('x', T1, 1);
    const result = resolveConflict(local, remote);
    expect(result.winner).toBe(local);
    expect(result.loser).toBe(remote);
  });

  it('uses version as tie-breaker when timestamps are equal and remote version is higher', () => {
    const local  = makeEntity('x', T1, 3);
    const remote = makeEntity('x', T1, 5);
    const result = resolveConflict(local, remote);
    expect(result.winner).toBe(remote);
    expect(result.loser).toBe(local);
  });

  it('returns local when timestamps AND versions are equal (optimistic local-first)', () => {
    const local  = makeEntity('x', T1, 4);
    const remote = makeEntity('x', T1, 4);
    const result = resolveConflict(local, remote);
    expect(result.winner).toBe(local);
    expect(result.loser).toBe(remote);
  });

  it('returns local when local version is higher and timestamps equal', () => {
    const local  = makeEntity('x', T1, 7);
    const remote = makeEntity('x', T1, 2);
    const result = resolveConflict(local, remote);
    expect(result.winner).toBe(local);
    expect(result.loser).toBe(remote);
  });

  it('always sets strategy to last-write-wins', () => {
    const local  = makeEntity('x', T2, 1);
    const remote = makeEntity('x', T1, 1);
    const { strategy } = resolveConflict(local, remote);
    expect(strategy).toBe('last-write-wins');
  });
});

describe('ConflictResolver — remoteIsNewer', () => {
  it('returns true when remote timestamp is later', () => {
    expect(remoteIsNewer(makeEntity('x', T1, 1), makeEntity('x', T2, 1))).toBe(true);
  });

  it('returns false when local timestamp is later', () => {
    expect(remoteIsNewer(makeEntity('x', T2, 1), makeEntity('x', T1, 1))).toBe(false);
  });

  it('returns true when remote has higher version with same timestamp', () => {
    expect(remoteIsNewer(makeEntity('x', T1, 1), makeEntity('x', T1, 3))).toBe(true);
  });

  it('returns false when timestamps and versions are equal (local wins)', () => {
    expect(remoteIsNewer(makeEntity('x', T1, 2), makeEntity('x', T1, 2))).toBe(false);
  });

  it('returns false when local has higher version with same timestamp', () => {
    expect(remoteIsNewer(makeEntity('x', T1, 9), makeEntity('x', T1, 1))).toBe(false);
  });
});

describe('ConflictResolver — edge cases', () => {
  it('handles future timestamps gracefully', () => {
    const future = '2099-12-31T23:59:59.999Z';
    const local  = makeEntity('x', T1, 1);
    const remote = makeEntity('x', future, 1);
    const result = resolveConflict(local, remote);
    expect(result.winner).toBe(remote);
  });

  it('handles identical entities (both same id)', () => {
    const entity = makeEntity('abc', T1, 1);
    const result = resolveConflict(entity, entity);
    // Same reference → local wins by definition
    expect(result.winner).toBe(entity);
  });
});
