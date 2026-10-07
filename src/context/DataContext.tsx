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
import { startShareEventListener, stopShareEventListener } from '../services/shareEventManager';
import { diagLog } from '../services/diagnostics';
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
    // Detect newly appeared items
    const existingIds = new Set(items.map((i) => i.id));
    const newItems = fetchedItems.filter((i) => !existingIds.has(i.id));
    if (newItems.length > 0) {
      diagLog.addEntry(
        'LIBRARY_ITEM_APPEARED',
        `DataContext: ${newItems.length} new item(s) appeared — ${newItems.map((i) => i.id).join(', ')}`
      );
      diagLog.addEntry(
        'LIBRARY_UPDATED',
        `DataContext: library updated with ${newItems.length} new item(s) (total=${fetchedItems.length})`
      );
    }
    setItems(fetchedItems);
    setCounts(fetchedCounts);
    // Keep Android widget count in sync
    syncWidgetCount(fetchedCounts.all ?? 0);
  }, [filter, sort, searchQuery, items]);

  const refreshCollections = useCallback(async () => {
    const fetchedCollections = await getAllCollections();
    setCollections(fetchedCollections);
  }, []);

  const refreshAll = useCallback(async () => {
    diagLog.addEntry('LIBRARY_REFRESH_TRIGGERED', 'DataContext: refreshAll called');
    await Promise.all([refreshItems(), refreshCollections()]);
    diagLog.addEntry('LIBRARY_REFRESH_COMPLETED', 'DataContext: refreshAll completed');
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
                  // Register refresh callback for native share ingestion pipeline
                  ShareIngestionManager.registerRefreshCallback(() => refreshAllRef.current());

                  setIsLoading(false);
                  signalDataProviderReady();
                  SplashScreen.hideAsync().catch(() => {}); // FIX M-18: dismiss splash after DB init

                  // Start the live pending_shares watcher (polling fallback, always on).
                  startPendingSharesWatcher(
                    () => refreshAllRef.current(),
                    () => _isQueueActiveRef.current(),
                  );
                  // Start native-event-driven refresh listener (Issue 3).
                  // useNativeShareEvents feature flag is false by default for RC;
                  // when false startShareEventListener is a no-op.
                  startShareEventListener(() => refreshAllRef.current());
                }
              });
            }
          });
      }
    });
    return () => {
      cancelled = true;
      stopPendingSharesWatcher();
      stopShareEventListener();
      ShareIngestionManager.clearRefreshCallback();
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
