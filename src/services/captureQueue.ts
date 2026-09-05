/**
 * captureQueue.ts — Lumio Capture Queue
 *
 * Provides a lightweight, in-process capture queue that:
 *   1. Accepts a URL (from Share or paste) and immediately persists a
 *      skeleton SavedItem to the database so the item is never lost.
 *   2. Runs a multi-step background enrichment pipeline:
 *        Source Detection → Thumbnail Extraction → Metadata Extraction →
 *        AI Summary → Tag Generation → Category Classification →
 *        Collection Suggestion → Location Detection
 *   3. Exposes reactive state (queue entries + status) that the UI can
 *      subscribe to via CaptureQueueContext.
 *   4. Auto-assigns to a collection when AI confidence ≥ 90 %.
 *
 * The queue is intentionally in-memory (no AsyncStorage dependency).
 * The database is the source of truth — the queue is only needed while
 * enrichment is in flight or pending.
 */

import { saveItem, updateItem } from '../database/items';
import { getAISettings, getAutoAssignRules } from './settings';
import { summarizeItem } from './ai';
import {
  fetchPageMetadata,
  formatMetadataForAI,
  detectUrlSource,
  detectMediaType,
  suggestContentType,
} from './metadata';
import { diagLog } from './diagnostics';
import { generateId } from '../utils/uuid';
import { sanitizeText, sanitizeUrl, parseTags, LIMITS } from '../utils/validation';
import type { SavedItem, ContentType } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaptureStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type EnrichmentStep =
  | 'source'
  | 'thumbnail'
  | 'metadata'
  | 'ai_summary'
  | 'tags'
  | 'category'
  | 'collections'
  | 'location';

export interface CaptureEntry {
  /** The persisted item's ID — always set immediately on enqueue. */
  itemId: string;
  url: string;
  /** Display title generated or derived for this entry. */
  displayTitle?: string;
  /** Original title hint (from share text / clipboard). May be empty. */
  titleHint: string;
  status: CaptureStatus;
  /** Which enrichment step is currently running. */
  currentStep?: EnrichmentStep;
  /** Steps completed so far. */
  completedSteps: EnrichmentStep[];
  /** Human-readable error if status === 'failed'. */
  error?: string;
  enqueuedAt: number;
  completedAt?: number;
  /**
   * Set after enrichment completes when there is exactly one collection
   * suggestion AND no auto-assign rule for the category yet.
   * The UI layer (CaptureQueueContext) reads this to show the prompt.
   */
  pendingAutoAssignPrompt?: {
    category: string;
    collectionId: string;
    collectionName: string;
  };
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _queue: CaptureEntry[] = [];
const _listeners: Array<(queue: CaptureEntry[]) => void> = [];
/** Temporary store for pending auto-assign prompts, keyed by itemId. */
const _pendingPrompts = new Map<string, NonNullable<CaptureEntry['pendingAutoAssignPrompt']>>();

function notify() {
  const snapshot = [..._queue];
  _listeners.forEach((fn) => fn(snapshot));
}

function updateEntry(itemId: string, patch: Partial<CaptureEntry>) {
  _queue = _queue.map((e) => (e.itemId === itemId ? { ...e, ...patch } : e));
  notify();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function subscribeQueue(fn: (queue: CaptureEntry[]) => void): () => void {
  _listeners.push(fn);
  fn([..._queue]);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

/** Get the current queue snapshot. */
export function getQueue(): CaptureEntry[] {
  return [..._queue];
}

/**
 * Enqueue a URL for immediate save + background enrichment.
 *
 * Steps:
 *   1. Detect source + content type synchronously (no network).
 *   2. Persist a skeleton item to SQLite immediately.
 *   3. Notify subscribers (status = queued).
 *   4. Kick off async enrichment pipeline.
 *
 * Returns the new itemId so callers can navigate to it if desired.
 */
export async function enqueueCapture(
  url: string,
  opts: {
    titleHint?: string;
    onItemSaved?: (itemId: string) => void;
    onRefresh?: () => Promise<void>;
    /** Collections available for AI matching. */
    collectionNames?: string[];
    collectionIds?: Record<string, string>; // name (lowercase) → id
    /** id → display name, for building auto-assign prompt text. */
    collectionDisplayNames?: Record<string, string>;
  } = {}
): Promise<string> {
  const cleanUrl = sanitizeUrl(url) ?? url;
  const titleHint = sanitizeText(opts.titleHint ?? '', LIMITS.TITLE) ?? '';

  // ── Step 0: Fast synchronous source detection ────────────────────────────
  let contentType: ContentType = 'link';
  let source;
  let mediaType;
  try {
    source = detectUrlSource(cleanUrl);
    mediaType = detectMediaType(source, cleanUrl);
    const suggested = suggestContentType(source);
    if (suggested) contentType = suggested;
  } catch {
    // Invalid URL at this point — continue with defaults
  }

  // ── Step 1: Persist skeleton item immediately ────────────────────────────
  const itemId = generateId();
  const now = new Date().toISOString();
  const skeletonItem: SavedItem = {
    id: itemId,
    title: titleHint || cleanUrl,
    url: cleanUrl,
    contentType,
    source,
    mediaType,
    tags: [],
    isCompleted: false,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  };

  await saveItem(skeletonItem);
  diagLog.addEntry('SAVE_COMPLETED', `captureQueue: skeleton saved id=${itemId} url="${cleanUrl.slice(0, 80)}"`);

  // Notify caller that item is in the DB (so they can navigate away)
  opts.onItemSaved?.(itemId);
  if (opts.onRefresh) await opts.onRefresh();

  // ── Step 2: Register queue entry ─────────────────────────────────────────
  const entry: CaptureEntry = {
    itemId,
    url: cleanUrl,
    titleHint,
    status: 'queued',
    completedSteps: [],
    enqueuedAt: Date.now(),
  };
  _queue = [..._queue, entry];
  notify();

  // ── Step 3: Start background enrichment (fire-and-forget) ────────────────
  _runEnrichment(entry, opts).catch((err) => {
    diagLog.addEntry('PROVIDER_ERROR', `captureQueue: enrichment crashed for ${itemId}: ${err instanceof Error ? err.message : String(err)}`);
    updateEntry(itemId, { status: 'failed', error: 'Enrichment failed unexpectedly.' });
  });

  return itemId;
}

/** Remove completed/failed entries from the visible queue. */
export function clearFinishedEntries() {
  _queue = _queue.filter((e) => e.status === 'queued' || e.status === 'processing');
  notify();
}

// ─── Enrichment pipeline ──────────────────────────────────────────────────────

async function _runEnrichment(
  entry: CaptureEntry,
  opts: {
    onRefresh?: () => Promise<void>;
    collectionNames?: string[];
    collectionIds?: Record<string, string>;
    collectionDisplayNames?: Record<string, string>;
  }
) {
  const { itemId, url } = entry;

  updateEntry(itemId, { status: 'processing', currentStep: 'source' });

  // Collect the DB updates — apply them in a single updateItem call at the end
  const dbUpdates: Partial<SavedItem> = {};

  try {
    // ── Source detection (already done synchronously, mark complete) ─────
    _markStep(itemId, 'source');

    // ── Metadata + thumbnail ────────────────────────────────────────────
    updateEntry(itemId, { currentStep: 'metadata' });
    let metadata = null;
    try {
      metadata = await fetchPageMetadata(url);
      if (metadata) {
        if (metadata.title) dbUpdates.title = sanitizeText(metadata.title, LIMITS.TITLE) ?? undefined;
        if (metadata.description) dbUpdates.description = sanitizeText(metadata.description, LIMITS.DESCRIPTION) ?? undefined;
        if (metadata.image) { dbUpdates.imageUrl = metadata.image; }
        if (metadata.source) dbUpdates.source = metadata.source;
        if (metadata.mediaType) dbUpdates.mediaType = metadata.mediaType;
        diagLog.addEntry('METADATA_FOUND', `captureQueue: source=${metadata.source} title="${(metadata.title ?? '').slice(0, 60)}"`);
      }
    } catch (e) {
      diagLog.addEntry('METADATA_FOUND', `captureQueue: metadata fetch failed — ${e instanceof Error ? e.message : String(e)}`);
    }
    _markStep(itemId, 'metadata');
    if (metadata?.image) _markStep(itemId, 'thumbnail');

    // ── AI enrichment ────────────────────────────────────────────────────
    const aiSettings = await getAISettings().catch(() => null);
    if (aiSettings) {
      updateEntry(itemId, { currentStep: 'ai_summary' });

      const metadataText = metadata ? formatMetadataForAI(metadata) : '';
      const aiInputTitle = metadata?.title ?? entry.titleHint ?? url;

      try {
        const result = await summarizeItem(
          aiSettings,
          aiInputTitle,
          undefined,
          metadataText || undefined,
          dbUpdates.contentType ?? entry.status as any,  // pass current contentType
          opts.collectionNames ?? []
        );

        if (!result.error) {
          if (result.summary) {
            dbUpdates.aiSummary = result.summary;
            _markStep(itemId, 'ai_summary');
          }
          if (result.suggestedTags.length > 0) {
            dbUpdates.tags = parseTags(result.suggestedTags.join(', '));
            _markStep(itemId, 'tags');
          }
          if (result.category) {
            dbUpdates.category = result.category;
            _markStep(itemId, 'category');

            // Apply auto-assign rule if one exists for this category
            if (!dbUpdates.collectionId) {
              const rules: Record<string, string> = await getAutoAssignRules().catch(() => ({}));
              const ruleCollectionId = rules[result.category];
              if (ruleCollectionId) {
                dbUpdates.collectionId = ruleCollectionId;
                diagLog.addEntry('FORM_UPDATE_COMPLETED', `captureQueue: applied auto-assign rule for ${result.category} → ${ruleCollectionId}`);
              }
            }
          }
          if (result.suggestedTitle) {
            const cleanTitle = sanitizeText(result.suggestedTitle, LIMITS.TITLE);
            if (cleanTitle) {
              dbUpdates.title = cleanTitle;
              updateEntry(itemId, { displayTitle: cleanTitle });
            }
          }

          // Collection suggestion + auto-assign at ≥90% confidence
          if (result.suggestedCollectionNames && result.suggestedCollectionNames.length > 0 && opts.collectionIds) {
            const matchedIds = result.suggestedCollectionNames
              .map((name) => opts.collectionIds![name.toLowerCase()])
              .filter(Boolean)
              .slice(0, 3);
            if (matchedIds.length > 0) {
              dbUpdates.suggestedCollections = matchedIds;
              _markStep(itemId, 'collections');

              // Auto-assign first suggestion when AI suggested exactly one collection
              // (high-specificity = ≥90% confidence heuristic).
              if (matchedIds.length === 1) {
                const singleId = matchedIds[0];
                dbUpdates.collectionId = singleId;
                diagLog.addEntry('FORM_UPDATE_COMPLETED', `captureQueue: auto-assigned to collection id=${singleId}`);

                // Check whether we should prompt the user to create an auto-assign rule.
                // Only prompt when:
                //   • there is a detected category, AND
                //   • no rule already exists for that category.
                const category = result.category ?? dbUpdates.category;
                if (category) {
                  const existingRules: Record<string, string> = await getAutoAssignRules().catch(() => ({}));
                  if (!existingRules[category]) {
                    const collectionName =
                      opts.collectionDisplayNames?.[singleId] ??
                      Object.entries(opts.collectionIds ?? {}).find(([, v]) => v === singleId)?.[0] ??
                      singleId;
                    // Signal to the UI layer to show the prompt after completion
                    _pendingPrompts.set(itemId, {
                      category,
                      collectionId: singleId,
                      collectionName,
                    });
                  }
                }
              }
            }
          }

          // Location
          if (result.location) {
            const parts = [result.location.venue, result.location.city, result.location.country].filter(Boolean);
            if (parts.length) { dbUpdates.address = sanitizeText(parts.join(', '), LIMITS.ADDRESS) ?? undefined; }
            if (result.location.coordinates) {
              dbUpdates.latitude = result.location.coordinates.lat;
              dbUpdates.longitude = result.location.coordinates.lng;
            }
            _markStep(itemId, 'location');
          }

          diagLog.addEntry('AI_RESPONSE_RECEIVED', `captureQueue: itemId=${itemId} summary=${Boolean(result.summary)} tags=${result.suggestedTags.length} category=${result.category ?? ''}`);
        } else {
          diagLog.addEntry('PROVIDER_ERROR', `captureQueue: AI failed for ${itemId}: ${result.error}`);
        }
      } catch (e) {
        diagLog.addEntry('PROVIDER_ERROR', `captureQueue: AI call threw for ${itemId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── Persist all enrichment results in one update ──────────────────────
    if (Object.keys(dbUpdates).length > 0) {
      await updateItem(itemId, dbUpdates);
    }

    // Refresh the global data context
    if (opts.onRefresh) await opts.onRefresh();

    // Attach pending auto-assign prompt (if any) to the completed entry
    const prompt = _pendingPrompts.get(itemId);
    _pendingPrompts.delete(itemId);

    updateEntry(itemId, {
      status: 'completed',
      currentStep: undefined,
      completedAt: Date.now(),
      ...(prompt ? { pendingAutoAssignPrompt: prompt } : {}),
    });
    diagLog.addEntry('SAVE_COMPLETED', `captureQueue: enrichment done for ${itemId}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diagLog.addEntry('SAVE_FAILED', `captureQueue: pipeline failed for ${itemId}: ${msg}`);
    updateEntry(itemId, { status: 'failed', error: msg, currentStep: undefined });
    if (opts.onRefresh) await opts.onRefresh().catch(() => {});
  }
}

function _markStep(itemId: string, step: EnrichmentStep) {
  _queue = _queue.map((e) => {
    if (e.itemId !== itemId) return e;
    const completedSteps = e.completedSteps.includes(step)
      ? e.completedSteps
      : [...e.completedSteps, step];
    return { ...e, completedSteps };
  });
  notify();
}
