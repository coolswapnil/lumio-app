import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { initDatabase } from '../database/db';
import { getAllItems, getItemCounts } from '../database/items';
import { getAllCollections } from '../database/collections';
import { syncWidgetCount } from '../services/widget_bridge';
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

  useEffect(() => {
    initDatabase().then(() => {
      refreshAll().finally(() => setIsLoading(false));
    });
  }, []);

  useEffect(() => {
    refreshItems();
  }, [filter, sort, searchQuery]);

  return (
    <DataContext.Provider
      value={{
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
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
