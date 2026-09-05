/**
 * CaptureQueueContext.tsx
 *
 * Provides the capture queue state to all screens and the ProcessingBanner.
 * Wraps the captureQueue service so React components get reactive updates
 * without polling.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  subscribeQueue,
  enqueueCapture,
  clearFinishedEntries,
  type CaptureEntry,
} from '../services/captureQueue';
import { setAutoAssignRule } from '../services/settings';
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

  // Track which itemIds we've already shown a prompt for, to avoid duplicates
  const promptedRef = useRef<Set<string>>(new Set());

  // Watch for completed entries with a pending auto-assign prompt
  useEffect(() => {
    for (const entry of queue) {
      if (
        entry.status === 'completed' &&
        entry.pendingAutoAssignPrompt &&
        !promptedRef.current.has(entry.itemId)
      ) {
        promptedRef.current.add(entry.itemId);
        const { category, collectionId, collectionName } = entry.pendingAutoAssignPrompt;
        Alert.alert(
          'Auto-assign future items?',
          `Auto-assign future ${category} items to "${collectionName}"?`,
          [
            { text: 'No', style: 'cancel' },
            {
              text: 'Yes',
              onPress: () => {
                setAutoAssignRule(category, collectionId).catch(() => {});
              },
            },
          ]
        );
      }
    }
  }, [queue]);

  const enqueue = useCallback(
    async (
      url: string,
      opts: { titleHint?: string; onItemSaved?: (itemId: string) => void } = {}
    ) => {
      // Build a name→id map and id→name map for collection matching
      const collectionNames = collections.map((c) => c.name);
      const collectionIds: Record<string, string> = {};
      const collectionDisplayNames: Record<string, string> = {};
      for (const c of collections) {
        collectionIds[c.name.toLowerCase()] = c.id;
        collectionDisplayNames[c.id] = c.name;
      }

      return enqueueCapture(url, {
        ...opts,
        collectionNames,
        collectionIds,
        collectionDisplayNames,
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
