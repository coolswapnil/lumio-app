/**
 * ShareEventManager.ts — Native Event Driven Refresh (Issue 3)
 *
 * Replaces the polling architecture for immediate library refresh on share.
 *
 * Architecture:
 *   NativeShareActivity
 *     → ShareEventManager.kt (emitShareSaved)
 *       → RCTDeviceEventEmitter (NATIVE_SHARE_SAVED)
 *         → NativeEventEmitter (JS)
 *           → refreshAll()
 *
 * Feature flag: useNativeShareEvents (default false for RC).
 * When false, this module registers no listeners; pendingSharesWatcher
 * continues as the sole refresh mechanism.
 *
 * Deduplication: events within DEDUP_WINDOW_MS with the same shareId are
 * dropped so a rapid share sequence never triggers multiple redundant reloads.
 *
 * Diagnostics emitted (always-on):
 *   NATIVE_EVENT_RECEIVED       — raw event arrived from native
 *   LIBRARY_REFRESH_FROM_EVENT  — refreshAll triggered by native event
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { diagLog } from './diagnostics';

// ── Feature flag ─────────────────────────────────────────────────────────────
// Default true for live native-event-driven refresh.
export const USE_NATIVE_SHARE_EVENTS = true;

// ── Event names (must match ShareEventManager.kt constants) ─────────────────
export const EVENT_NATIVE_SHARE_SAVED   = 'NATIVE_SHARE_SAVED';
export const EVENT_QUEUE_ITEM_CREATED   = 'QUEUE_ITEM_CREATED';
export const EVENT_QUEUE_ITEM_COMPLETED = 'QUEUE_ITEM_COMPLETED';
export const EVENT_QUEUE_ITEM_FAILED    = 'QUEUE_ITEM_FAILED';

const DEDUP_WINDOW_MS = 2_000;

// ── Module state ─────────────────────────────────────────────────────────────
let _subscriptions: Array<{ remove: () => void }> = [];
let _refreshCallback: (() => Promise<void>) | null = null;
// Map of shareId → last event timestamp (ms) for deduplication
const _recentEvents = new Map<string, number>();

/**
 * Start listening for native share events.
 * @param onRefresh  Called when a native event demands a library refresh.
 */
export function startShareEventListener(onRefresh: () => Promise<void>): void {
  if (!USE_NATIVE_SHARE_EVENTS) return;
  if (Platform.OS !== 'android') return;

  _refreshCallback = onRefresh;

  const mod = NativeModules.LumioShareEvent;
  if (!mod) {
    diagLog.addEntry('NATIVE_EVENT_RECEIVED', 'ShareEventManager: LumioShareEvent module not found — falling back to polling');
    return;
  }

  const emitter = new NativeEventEmitter(mod);

  _subscriptions.push(
    emitter.addListener(EVENT_NATIVE_SHARE_SAVED, (payload: ShareEventPayload) => {
      _handleEvent(EVENT_NATIVE_SHARE_SAVED, payload);
    })
  );

  _subscriptions.push(
    emitter.addListener(EVENT_QUEUE_ITEM_CREATED, (payload: ShareEventPayload) => {
      _handleEvent(EVENT_QUEUE_ITEM_CREATED, payload);
    })
  );

  _subscriptions.push(
    emitter.addListener(EVENT_QUEUE_ITEM_COMPLETED, (payload: ShareEventPayload) => {
      _handleEvent(EVENT_QUEUE_ITEM_COMPLETED, payload);
    })
  );

  _subscriptions.push(
    emitter.addListener(EVENT_QUEUE_ITEM_FAILED, (payload: ShareEventPayload) => {
      _handleEvent(EVENT_QUEUE_ITEM_FAILED, payload);
    })
  );

  diagLog.addEntry('NATIVE_EVENT_RECEIVED', 'ShareEventManager: listeners registered (useNativeShareEvents=true)');
}

export function stopShareEventListener(): void {
  for (const sub of _subscriptions) {
    try { sub.remove(); } catch { /* ignore */ }
  }
  _subscriptions = [];
  _refreshCallback = null;
}

interface ShareEventPayload {
  shareId?: string;
  itemId?: string;
  url?: string;
  reason?: string;
  timestamp?: string;
}

function _handleEvent(event: string, payload: ShareEventPayload): void {
  const shareId = payload?.shareId ?? 'unknown';
  const ts = payload?.timestamp ?? new Date().toISOString();

  diagLog.addEntry(
    'NATIVE_EVENT_RECEIVED',
    `event=${event} shareId=${shareId} url=${payload?.url ?? ''} ts=${ts}`
  );

  // Deduplication: skip if we already processed this shareId recently
  const lastSeen = _recentEvents.get(shareId);
  const now = Date.now();
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
    diagLog.addEntry(
      'NATIVE_EVENT_RECEIVED',
      `event=${event} shareId=${shareId} DEDUPLICATED (within ${DEDUP_WINDOW_MS}ms window)`
    );
    return;
  }
  _recentEvents.set(shareId, now);

  // Evict stale entries to prevent unbounded growth
  if (_recentEvents.size > 50) {
    const cutoff = now - DEDUP_WINDOW_MS * 10;
    for (const [id, t] of _recentEvents) {
      if (t < cutoff) _recentEvents.delete(id);
    }
  }

  if (_refreshCallback) {
    diagLog.addEntry(
      'LIBRARY_REFRESH_FROM_EVENT',
      `Triggering refreshAll from ${event} shareId=${shareId} ts=${ts}`
    );
    _refreshCallback().catch((err: unknown) => {
      diagLog.addEntry(
        'LIBRARY_REFRESH_FROM_EVENT',
        `refreshAll error after ${event}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
}
