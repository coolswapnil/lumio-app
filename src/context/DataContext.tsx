import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import * as SplashScreen from 'expo-splash-screen';

// FIX M-18: prevent expo-router from auto-hiding the splash until DB is ready
SplashScreen.preventAutoHideAsync().catch(() => {});
import { initDatabase } from '../database/db';
import { ShareIngestionManager } from '../services/shareIngestion';
import { signalDataProviderReady, resetReadinessGate } from '../services/serviceReadiness';
import { resetLifecycleState } from '../services/lifecycleState';
import { getAllItems, getItemCounts } from '../database/items';
import { getAllCollections } from '../database/collections';
import { syncWidgetCount } from '../services/widget_bridge';
import { startPendingSharesWatcher, stopPendingSharesWatcher } from '../services/pendingSharesWatcher';
import type { SavedItem, Collection, FilterOption, SortOption } from '../types';

interface DataContextValue {
  items: SavedItem[];
  collections: Collection[];
  counts: Record<string, number>;
  isLoading: boolean;
  filter: FilterOption;
  sort: SortOption;
  searchQuery: string;
  setFilter: (f: FilterOption) => void;
  setSort: (s: SortOption) => void;
  setSearchQuery: (q: string) => void;
  refreshItems: () => Promise<void>;
  refreshCollections: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const DataContext = createContext<DataContextValue>({
  items: [],
  collections: [],
  counts: {},
  isLoading: true,
  filter: 'all',
  sort: 'newest',
  searchQuery: '',
  setFilter: () => {},
  setSort: () => {},
  setSearchQuery: () => {},
  refreshItems: async () => {},
  refreshCollections: async () => {},
  refreshAll: async () => {},
});

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [sort, setSort] = useState<SortOption>('newest');
  const [searchQuery, setSearchQuery] = useState('');

  const refreshItems = useCallback(async () => {
    const [fetchedItems, fetchedCounts] = await Promise.all([
      getAllItems(filter, sort, searchQuery),
      getItemCounts(),
    ]);
    setItems(fetchedItems);
    setCounts(fetchedCounts);
    // Keep Android widget count in sync
    syncWidgetCount(fetchedCounts.all ?? 0);
  }, [filter, sort, searchQuery]);

  const refreshCollections = useCallback(async () => {
    const fetchedCollections = await getAllCollections();
    setCollections(fetchedCollections);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshItems(), refreshCollections()]);
  }, [refreshItems, refreshCollections]);

  // Stable ref for refreshAll so the watcher closure captures the latest version.
  const refreshAllRef = useRef(refreshAll);
  useEffect(() => { refreshAllRef.current = refreshAll; }, [refreshAll]);

  // FIX 3: Queue-active ref injected by CaptureQueueContext after mount.
  // DataContext cannot import CaptureQueueContext (circular dep), so we expose
  // a setter that CaptureQueueContext calls once it mounts.
  const _isQueueActiveRef = useRef<() => boolean>(() => false);
  // Exposed for CaptureQueueContext to wire up.
  (DataProvider as unknown as { _setQueueActiveRef: (fn: () => boolean) => void })
    ._setQueueActiveRef = (fn: () => boolean) => { _isQueueActiveRef.current = fn; };

  // Initial load — runs once per mount (which includes background→foreground remounts).
  //
  // resetReadinessGate() MUST be the first call so that ingest() calls arriving
  // on this remount wait for THIS DataProvider to signal ready, not for the
  // already-resolved promise from the previous mount cycle.
  useEffect(() => {
    let cancelled = false;

    // Reset BEFORE starting async work so any ingest() blocked on the gate
    // picks up the fresh promise.  Also reset the lifecycle classification so
    // the next redirectSystemPath call re-classifies from scratch.
    resetReadinessGate();
    resetLifecycleState();

    initDatabase().then(() => {
      if (!cancelled) {
        // 1. Recover any shares persisted to native SharedPreferences before JS started.
        //    This is the deepest fail-safe — catches app-killed shares even when
        //    the SQLite recovery finds nothing.
        ShareIngestionManager.recoverPendingSharesFromPrefs()
          .catch(() => {})
          .then(() => {
            if (!cancelled) {
              // 2. Recover any pending SQLite shares (survived JS crash or enrichment failure).
              return ShareIngestionManager.recoverPendingShares().catch(() => {});
            }
          })
          .finally(() => {
            if (!cancelled) {
              refreshAll().finally(() => {
                if (!cancelled) {
                  setIsLoading(false);
                  signalDataProviderReady();
                  SplashScreen.hideAsync().catch(() => {}); // FIX M-18: dismiss splash after DB init

                  // FIX 3: Start the live pending_shares watcher now that the DB is ready.
                  startPendingSharesWatcher(
                    () => refreshAllRef.current(),
                    () => _isQueueActiveRef.current(),
                  );
                }
              });
            }
          });
      }
    });
    return () => {
      cancelled = true;
      stopPendingSharesWatcher();
    };
  // eslint-disable-next-line -- intentional: runs once on mount; refreshAll is stable
  }, []);

  // Re-fetch items when filter/sort/search change — NOT on initial mount
  // (initial mount is handled by the effect above via refreshAll)
  const isFirstRender = React.useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    refreshItems();
  }, [filter, sort, searchQuery]);

  // Memoize context value to prevent re-rendering all consumers on every state change
  const contextValue = useMemo(
    () => ({
      items,
      collections,
      counts,
      isLoading,
      filter,
      sort,
      searchQuery,
      setFilter,
      setSort,
      setSearchQuery,
      refreshItems,
      refreshCollections,
      refreshAll,
    }),
    [
      items,
      collections,
      counts,
      isLoading,
      filter,
      sort,
      searchQuery,
      setFilter,
      setSort,
      setSearchQuery,
      refreshItems,
      refreshCollections,
      refreshAll,
    ]
  );

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
