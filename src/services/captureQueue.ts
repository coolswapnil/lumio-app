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
import { maybeAutoCreateTopic } from '../database/topics';
import { getAISettings, getAutoAssignRules, getAppSettings } from './settings';
import { summarizeItem, callAIRaw } from './ai';
import { SYSTEM_COLLECTION_MAP, SYSTEM_COLLECTION_NAMES } from '../constants/systemCollections';
import { normalizeTopicLabel } from './topicNormalization';
import {
  fetchPageMetadata,
  formatMetadataForAI,
  detectUrlSource,
  detectMediaType,
  suggestContentType,
  getExactSourceLabel,
  type PageMetadataEnhanced,
} from './metadata';
import { detectLanguage, shouldTranslate, translateContent } from './languageDetection';
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
  /**
   * Exact source label set synchronously on enqueue (e.g. "Instagram Reel",
   * "YouTube Video").  Used as the queue-row label before the AI title arrives.
   */
  sourceLabel?: string;
  /**
   * Content type detected synchronously at enqueue time.
   * Passed to the AI call so the model knows the kind of content it is
   * summarising (video, social, article, etc.).
   */
  contentType: ContentType;
  status: CaptureStatus;
  /** Which enrichment step is currently running. */
  currentStep?: EnrichmentStep;
  /** Steps completed so far. */
  completedSteps: EnrichmentStep[];
  /** Human-readable error if status === 'failed'. */
  error?: string;
  enqueuedAt: number;
  completedAt?: number;
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _queue: CaptureEntry[] = [];
const _listeners: Array<(queue: CaptureEntry[]) => void> = [];

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

  // ── FIX 5: Record enqueue timestamp for queue duration measurement ───────
  const enqueueTs = Date.now();
  diagLog.addEntry('QUEUE_ITEM_CREATED', `captureQueue: NATIVE_SHARE_RECEIVED→QUEUE_ITEM_CREATED ts=${enqueueTs} url="${cleanUrl.slice(0, 80)}"`);

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
  diagLog.addEntry('ITEM_VISIBLE', `captureQueue: minimal skeleton visible in DB id=${itemId} title="${(titleHint || cleanUrl).slice(0, 60)}" status=queued`);
  diagLog.addEntry('LIBRARY_ITEM_APPEARED', `captureQueue: skeleton item created id=${itemId} url="${cleanUrl.slice(0, 80)}" — triggering refresh`);

  // Notify caller that item is in the DB (so they can navigate away)
  opts.onItemSaved?.(itemId);
  if (opts.onRefresh) await opts.onRefresh();

  // ── Step 2: Register queue entry ─────────────────────────────────────────
  // Derive an exact source label synchronously so the queue row shows
  // "Instagram Reel" / "YouTube Video" immediately, before AI runs.
  const sourceLabel = getExactSourceLabel(source, mediaType, cleanUrl);

  const entry: CaptureEntry = {
    itemId,
    url: cleanUrl,
    titleHint,
    sourceLabel,
    contentType,
    status: 'queued',
    completedSteps: [],
    enqueuedAt: Date.now(),
  };
  _queue = [..._queue, entry];
  notify();

  diagLog.addEntry('QUEUE_ITEM_CREATED', `captureQueue: id=${itemId} url="${cleanUrl.slice(0, 80)}" contentType=${contentType} source=${source ?? 'unknown'} enqueuedAt=${enqueueTs}`);

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
  }
) {
  const { itemId, url, contentType: entryContentType } = entry;

  diagLog.addEntry('ITEM_ENRICHMENT_STARTED', `captureQueue: background enrichment started for itemId=${itemId} url="${url.slice(0, 80)}"`);
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

      const metadataEnhanced = metadata as PageMetadataEnhanced | null;

      // When the page fetch was blocked (e.g. Instagram login wall) metadata is
      // null. Build a fallback metadata text from the share-sheet titleHint and
      // any URL path segments so the AI still has something useful to work with.
      let metadataText: string;
      let aiInputTitle: string;
      if (metadata) {
        metadataText = formatMetadataForAI(metadata);
        aiInputTitle = metadata.title ?? entry.titleHint ?? url;
      } else {
        // No metadata — synthesise what we can from the share payload.
        // titleHint is the text selected/shared alongside the URL (often the
        // post caption or video title from the share sheet).
        aiInputTitle = entry.titleHint || url;
        const fallbackParts: string[] = [
          `Source: ${entry.contentType}`,
          entry.titleHint ? `Caption: ${entry.titleHint}` : '',
        ].filter(Boolean);
        metadataText = fallbackParts.join('\n');
        diagLog.addEntry('METADATA_FOUND', `captureQueue: no metadata — using titleHint fallback for ${itemId}`);
      }

      // ── Language detection ──────────────────────────────────────────────
      // Detect from all available text signals before calling the AI
      const textForLangDetection = [aiInputTitle, metadata?.description, metadataEnhanced?.caption]
        .filter(Boolean)
        .join(' ');
      const detectedLang = detectLanguage(textForLangDetection);
      if (detectedLang !== 'Unknown') {
        dbUpdates.detectedLanguage = detectedLang;
        diagLog.addEntry('METADATA_FOUND', `captureQueue: detected language=${detectedLang} for ${itemId}`);
      }

      // Decide whether to translate before sending to the AI
      const appSettings = await getAppSettings().catch(() => null);
      const autoTranslate = appSettings?.autoTranslateForeignContent ?? false;
      const neverTranslate = appSettings?.neverTranslateLanguages ?? [];
      const needsTranslation = shouldTranslate(detectedLang, autoTranslate, neverTranslate);

      // Always log translation decision so failures are diagnosable in any build.
      if (!needsTranslation) {
        let fallbackReason: string;
        if (!autoTranslate) {
          fallbackReason = 'autoTranslate=false (disabled in settings)';
        } else if (detectedLang === 'English') {
          fallbackReason = 'lang=English (no translation needed)';
        } else if (detectedLang === 'Unknown') {
          fallbackReason = 'lang=Unknown (could not detect language)';
        } else if (neverTranslate.includes(detectedLang)) {
          fallbackReason = `lang=${detectedLang} is in neverTranslateLanguages`;
        } else {
          fallbackReason = `lang=${detectedLang} skipped (unknown reason)`;
        }
        diagLog.addEntry('FORM_UPDATE_COMPLETED', `captureQueue: translation skipped for ${itemId} — ${fallbackReason}`);
      } else {
        diagLog.addEntry('FORM_UPDATE_COMPLETED', `captureQueue: translation scheduled for ${itemId} lang=${detectedLang} → English`);
      }


      try {
        const result = await summarizeItem(
          aiSettings,
          aiInputTitle,
          undefined,
          metadataText || undefined,
          // Use the content type stored on the queue entry (detected synchronously
          // at enqueue time), not entry.status which is a CaptureStatus string.
          entryContentType,
          SYSTEM_COLLECTION_NAMES
        );

        if (!result.error) {
          // ── Auto-translation ──────────────────────────────────────────────
          // If translation is needed, translate summary, tags, and title
          // before storing, so the user sees content in their app language.
          if (needsTranslation && (result.summary || result.suggestedTags.length > 0 || result.suggestedTitle)) {
            try {
              const translation = await translateContent(
                aiSettings,
                {
                  summary: result.summary || undefined,
                  tags: result.suggestedTags.length > 0 ? result.suggestedTags : undefined,
                  title: result.suggestedTitle,
                  sourceLanguage: detectedLang,
                  targetLanguage: 'English',
                },
                callAIRaw
              );
              if (!translation.error) {
                if (translation.translatedSummary) dbUpdates.translatedSummary = sanitizeText(translation.translatedSummary, LIMITS.DESCRIPTION) || translation.translatedSummary;
                if (translation.translatedTags) dbUpdates.translatedTags = parseTags(translation.translatedTags.join(', '));
                diagLog.addEntry('AI_RESPONSE_RECEIVED', `captureQueue: translation done for ${itemId} lang=${detectedLang}`);
              }
            } catch (translErr) {
              diagLog.addEntry('PROVIDER_ERROR', `captureQueue: translation failed for ${itemId}: ${translErr instanceof Error ? translErr.message : String(translErr)}`);
            }
          }

          if (result.summary) {
            // Sanitize AI output: decode HTML entities, trim, enforce length limit.
            dbUpdates.aiSummary = sanitizeText(result.summary, LIMITS.DESCRIPTION) || result.summary;
            _markStep(itemId, 'ai_summary');
          }
          if (result.suggestedTags.length > 0) {
            dbUpdates.tags = parseTags(result.suggestedTags.join(', '));
            _markStep(itemId, 'tags');
          }
          if (result.categoryReason) {
            dbUpdates.categoryReason = sanitizeText(result.categoryReason, 300) || result.categoryReason;
          }
          if (result.collectionReason) {
            dbUpdates.collectionReason = sanitizeText(result.collectionReason, 300) || result.collectionReason;
          }
          if (result.category) {
            dbUpdates.category = result.category;
            _markStep(itemId, 'category');

            // Deterministic Level 1 system collection assignment
            const systemCollectionId = SYSTEM_COLLECTION_MAP[result.category];
            if (systemCollectionId) {
              dbUpdates.collectionId = systemCollectionId;
              _markStep(itemId, 'collections');
              diagLog.addEntry('COLLECTION_ASSIGNED', `captureQueue: deterministic system collection category=${result.category} → collectionId=${systemCollectionId} itemId=${itemId}`);
            }

            if (result.topicSuggestion) {
              const normalizedTopic = normalizeTopicLabel(result.topicSuggestion);
              if (normalizedTopic) {
                dbUpdates.topicSuggestion = normalizedTopic;
                dbUpdates.topicSuggestionRaw = result.topicSuggestion;
                diagLog.addEntry('TOPIC_SUGGESTED', `captureQueue: topicSuggestion="${normalizedTopic}" raw="${result.topicSuggestion}" itemId=${itemId}`);
              }
            }

            // Apply custom auto-assign rule override if one exists for this category (when not mapped by system collection)
            if (!systemCollectionId && !dbUpdates.collectionId) {
              const rules: Record<string, string> = await getAutoAssignRules().catch(() => ({}));
              const ruleCollectionId = rules[result.category];
              if (ruleCollectionId) {
                dbUpdates.collectionId = ruleCollectionId;
                _markStep(itemId, 'collections');
                diagLog.addEntry('COLLECTION_ASSIGNED', `captureQueue: auto-assign rule matched category=${result.category} → collectionId=${ruleCollectionId} itemId=${itemId}`);
                diagLog.addEntry('FORM_UPDATE_COMPLETED', `captureQueue: applied auto-assign rule for ${result.category} → ${ruleCollectionId}`);
              } else {
                diagLog.addEntry('COLLECTION_SKIPPED', `captureQueue: no auto-assign rule for category=${result.category} itemId=${itemId}`);
              }
            }
          }
          if (result.suggestedTitle) {
            // sanitizeText decodes HTML entities (&#x20b9; → ₹, &#x2019; → ', etc.)
            const cleanTitle = sanitizeText(result.suggestedTitle, LIMITS.TITLE);
            if (cleanTitle) {
              dbUpdates.title = cleanTitle;
              // Update queue entry so the banner row immediately shows the AI title
              updateEntry(itemId, { displayTitle: cleanTitle });
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

    // Topic auto-creation — runs after the item is fully persisted
    if (dbUpdates.topicSuggestion && dbUpdates.collectionId) {
      try {
        const createdTopic = await maybeAutoCreateTopic(
          dbUpdates.topicSuggestion,
          dbUpdates.topicSuggestionRaw ?? dbUpdates.topicSuggestion,
          dbUpdates.collectionId
        );
        if (createdTopic) {
          diagLog.addEntry(
            'QUEUE_ITEM_CREATED',
            `topic auto-created: label="${createdTopic.label}" id=${createdTopic.id} collectionId=${dbUpdates.collectionId}`
          );
          // Trigger UI refresh so the new topic chip appears in the Knowledge Hub
          if (opts.onRefresh) {
            await opts.onRefresh();
          }
        } else {
          diagLog.addEntry(
            'QUEUE_ITEM_CREATED',
            `topic threshold not met yet: suggestion="${dbUpdates.topicSuggestion}" collectionId=${dbUpdates.collectionId}`
          );
        }
      } catch (topicErr) {
        // Topic auto-creation is non-critical — log but do not fail the item save
        diagLog.addEntry(
          'SAVE_FAILED',
          `topic auto-creation error: ${topicErr instanceof Error ? topicErr.message : String(topicErr)}`
        );
      }
    }

    // Refresh the global data context
    if (opts.onRefresh) await opts.onRefresh();

    const completedAt = Date.now();
    const queueDurationMs = completedAt - entry.enqueuedAt;
    updateEntry(itemId, {
      status: 'completed',
      currentStep: undefined,
      completedAt,
    });
    diagLog.addEntry('ITEM_ENRICHMENT_COMPLETED', `captureQueue: enrichment pipeline finished for itemId=${itemId} duration=${queueDurationMs}ms`);
    diagLog.addEntry('QUEUE_ITEM_COMPLETED', `captureQueue: enrichment completed for ${itemId} queueDuration=${queueDurationMs}ms enqueuedAt=${entry.enqueuedAt} completedAt=${completedAt}`);
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
