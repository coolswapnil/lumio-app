/**
 * SyncContext — React provider bridging the SyncEngine to the component tree.
 *
 * Exposes:
 *   - syncStatus       'idle' | 'syncing' | 'error' | 'offline'
 *   - pendingCount     Number of operations waiting to be pushed.
 *   - deadLetterCount  Number of permanently-failed operations.
 *   - lastSyncAt       ISO-8601 timestamp of the last successful sync.
 *   - lastError        Most recent engine error string (if any).
 *   - forceSync()      Trigger an immediate sync cycle.
 *   - clearDeadLetters() Wipe the dead-letter queue.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { SyncEngine } from '../sync/SyncEngine';
import { NoOpSyncAdapter } from '../sync/adapters/NoOpSyncAdapter';
import {
  clearDeadLetters as dbClearDeadLetters,
  getMetaValue,
} from '../sync/SyncQueue';
import { SYNC_META_LAST_PUSH } from '../sync/types';
import type { SyncState, SyncStatus } from '../sync/types';
import type { SyncEngineEvent } from '../sync/SyncEngine';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface SyncContextValue extends SyncState {
  forceSync: () => Promise<void>;
  clearDeadLetters: () => Promise<void>;
}

const defaultState: SyncState = {
  status: 'idle',
  pendingCount: 0,
  deadLetterCount: 0,
  lastSyncAt: null,
  lastError: null,
};

const SyncContext = createContext<SyncContextValue>({
  ...defaultState,
  forceSync: async () => {},
  clearDeadLetters: async () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Singleton engine — created once, shared across the tree. */
const engine = new SyncEngine(new NoOpSyncAdapter());

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncState, setSyncState] = useState<SyncState>(defaultState);
  const stateRef = useRef<SyncState>(defaultState);

  const updateState = useCallback((patch: Partial<SyncState>) => {
    setSyncState((prev) => {
      const next = { ...prev, ...patch };
      stateRef.current = next;
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Engine event → React state bridge
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Restore persisted lastSyncAt from SQLite metadata.
    getMetaValue(SYNC_META_LAST_PUSH).then((val) => {
      if (val) updateState({ lastSyncAt: val });
    });

    const unsubscribe = engine.addListener((event: SyncEngineEvent) => {
      switch (event.type) {
        case 'start':
          updateState({ status: 'syncing' as SyncStatus, lastError: null });
          break;
        case 'success':
          updateState({ status: 'idle' as SyncStatus, lastSyncAt: new Date().toISOString() });
          break;
        case 'error':
          updateState({ status: 'error' as SyncStatus, lastError: event.error });
          break;
        case 'idle':
          updateState({
            pendingCount: event.pendingCount,
            deadLetterCount: event.deadLetterCount,
            status: stateRef.current.status === 'syncing'
              ? 'idle' as SyncStatus
              : stateRef.current.status,
          });
          break;
      }
    });

    // Start background sync.
    engine.startBackground();

    return () => {
      unsubscribe();
      engine.stopBackground();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Re-sync when app resumes from background.
  // -------------------------------------------------------------------------

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          engine.sync().catch(() => {/* handled by engine */});
        }
      }
    );
    return () => subscription.remove();
  }, []);

  // -------------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------------

  const forceSync = useCallback(async () => {
    await engine.sync();
  }, []);

  const clearDeadLetters = useCallback(async () => {
    await dbClearDeadLetters();
    updateState({ deadLetterCount: 0 });
  }, [updateState]);

  const contextValue = useMemo<SyncContextValue>(
    () => ({
      ...syncState,
      forceSync,
      clearDeadLetters,
    }),
    [syncState, forceSync, clearDeadLetters]
  );

  return (
    <SyncContext.Provider value={contextValue}>
      {children}
    </SyncContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
