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
import { setAutoAssignRule, getAppSettings, saveAppSettings } from '../services/settings';
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
  // Whether we've already shown the auto-translate first-run prompt this session
  const autoTranslatePromptedRef = useRef(false);

  // Watch for completed entries — two separate prompt flows:
  //   1. Auto-assign rule prompt (existing)
  //   2. First-run Auto Translate prompt when a foreign-language item completes
  useEffect(() => {
    for (const entry of queue) {
      if (entry.status !== 'completed') continue;

      // ── Auto-assign rule prompt ──────────────────────────────────────────
      if (entry.pendingAutoAssignPrompt && !promptedRef.current.has(entry.itemId)) {
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

  // ── First-run Auto Translate prompt ──────────────────────────────────────
  // When the first foreign-language item is saved and the user has not yet
  // configured the auto-translate preference, show a one-time prompt.
  useEffect(() => {
    if (autoTranslatePromptedRef.current) return;
    const foreignEntry = queue.find(
      (e) =>
        e.status === 'completed' &&
        !promptedRef.current.has('autoTranslate:' + e.itemId)
    );
    if (!foreignEntry) return;

    // Only show prompt when the item actually has a foreign language detected.
    // We check this asynchronously after the entry completes.
    (async () => {
      const settings = await getAppSettings().catch(() => null);
      // If the user already set the preference (either way), skip.
      if (settings?.autoTranslateForeignContent !== undefined) return;

      // Check the database for detectedLanguage on this item
      const { getItemById } = await import('../database/items');
      const item = await getItemById(foreignEntry.itemId).catch(() => null);
      if (!item?.detectedLanguage || item.detectedLanguage === 'English' || item.detectedLanguage === 'Unknown') return;

      // Guard against double-showing
      if (autoTranslatePromptedRef.current) return;
      autoTranslatePromptedRef.current = true;
      promptedRef.current.add('autoTranslate:' + foreignEntry.itemId);

      Alert.alert(
        'Auto Translate Foreign Content',
        `This item appears to be in ${item.detectedLanguage}. Enable automatic translation so summaries and tags are shown in English?`,
        [
          {
            text: 'No',
            style: 'cancel',
            onPress: async () => {
              const s = await getAppSettings();
              await saveAppSettings({ ...s, autoTranslateForeignContent: false });
            },
          },
          {
            text: 'Enable',
            onPress: async () => {
              const s = await getAppSettings();
              await saveAppSettings({ ...s, autoTranslateForeignContent: true });
            },
          },
        ]
      );
    })();
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
