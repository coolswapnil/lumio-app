/**
 * CaptureQueueContext.tsx
 *
 * Provides the capture queue state to all screens and the ProcessingBanner.
 * Wraps the captureQueue service so React components get reactive updates
 * without polling.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  subscribeQueue,
  enqueueCapture,
  clearFinishedEntries,
  type CaptureEntry,
} from '../services/captureQueue';
import { useData } from './DataContext';

interface CaptureQueueContextValue {
  /** Live queue entries. */
  queue: CaptureEntry[];
  /** Number of items currently processing or queued. */
  activeCount: number;
  /** Number of items that completed since last clear. */
  completedCount: number;
  /** Number of items that failed since last clear. */
  failedCount: number;
  /**
   * Enqueue a URL for instant capture + background enrichment.
   * Accepts the same options as the service function.
   */
  enqueue: (
    url: string,
    opts?: {
      titleHint?: string;
      onItemSaved?: (itemId: string) => void;
    }
  ) => Promise<string>;
  /** Dismiss completed/failed entries from the banner. */
  clearFinished: () => void;
}

const CaptureQueueContext = createContext<CaptureQueueContextValue>({
  queue: [],
  activeCount: 0,
  completedCount: 0,
  failedCount: 0,
  enqueue: async () => '',
  clearFinished: () => {},
});

export function CaptureQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<CaptureEntry[]>([]);
  const { collections, refreshAll } = useData();

  // Subscribe to the service's reactive state
  useEffect(() => {
    const unsub = subscribeQueue(setQueue);
    return unsub;
  }, []);

  const enqueue = useCallback(
    async (
      url: string,
      opts: { titleHint?: string; onItemSaved?: (itemId: string) => void } = {}
    ) => {
      // Build a name→id map for collection matching
      const collectionNames = collections.map((c) => c.name);
      const collectionIds: Record<string, string> = {};
      for (const c of collections) {
        collectionIds[c.name.toLowerCase()] = c.id;
      }

      return enqueueCapture(url, {
        ...opts,
        collectionNames,
        collectionIds,
        onRefresh: refreshAll,
      });
    },
    [collections, refreshAll]
  );

  const clearFinished = useCallback(() => {
    clearFinishedEntries();
  }, []);

  const activeCount = queue.filter(
    (e) => e.status === 'queued' || e.status === 'processing'
  ).length;
  const completedCount = queue.filter((e) => e.status === 'completed').length;
  const failedCount = queue.filter((e) => e.status === 'failed').length;

  return (
    <CaptureQueueContext.Provider
      value={{ queue, activeCount, completedCount, failedCount, enqueue, clearFinished }}
    >
      {children}
    </CaptureQueueContext.Provider>
  );
}

export function useCaptureQueue() {
  return useContext(CaptureQueueContext);
}
