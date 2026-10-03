/**
 * Diagnostics log — in-memory ring buffer for developer event tracing.
 *
 * Two tiers:
 *   ALWAYS-ON  — Share-pipeline events are written unconditionally so a share
 *                failure always produces a trace even in production builds.
 *   OPT-IN     — All other events require the user to enable diagnostics via
 *                Settings → Advanced → Enable Developer Diagnostics.
 *
 * Always-on events (written regardless of _enabled):
 *   MAIN_ACTIVITY_CREATED | MAIN_ACTIVITY_ON_NEW_INTENT |
 *   INTENT_ACTION | INTENT_MIME_TYPE | INTENT_EXTRAS | INTENT_DATA |
 *   EXTRA_TEXT | EXTRA_STREAM | CLIPDATA_FOUND |
 *   APP_STATE | APP_COLD_START | APP_FOREGROUND | APP_BACKGROUND | APP_ALREADY_RUNNING |
 *   DATABASE_INITIALIZED | DATAPROVIDER_READY | CAPTURE_QUEUE_READY |
 *   SHARE_MANAGER_READY | SHARE_PAYLOAD_RECEIVED |
 *   SHARE_INTENT_RECEIVED | SHARE_ACTION | SHARE_MIME_TYPE | SHARE_PAYLOAD |
 *   URL_EXTRACTED | ROUTE_TO_SHARE_SCREEN | QUEUE_ITEM_CREATED |
 *   QUEUE_ITEM_PERSISTED | SHARE_PAYLOAD_PERSISTED |
 *   COLLECTION_MATCHED | COLLECTION_ASSIGNED | COLLECTION_COUNT_UPDATED |
 *   COLLECTION_REFRESHED | COLLECTION_SKIPPED |
 *   ENRICHMENT_STARTED | ENRICHMENT_COMPLETED |
 *   FAILED_SHARE_CAPTURED
 *
 * Opt-in events:
 *   SHARE_INTENT_PARSED | SHARE_URL_EXTRACTED | SHARE_SCREEN_OPENED |
 *   SHARE_FORM_POPULATED | METADATA_FOUND | AI_REQUEST_STARTED |
 *   AI_RESPONSE_RAW | AI_RESPONSE_RECEIVED | AI_RESPONSE_PARSED |
 *   PROVIDER_ERROR | SAVE_STARTED | SAVE_COMPLETED | SAVE_FAILED |
 *   FORM_UPDATE_STARTED | FORM_UPDATE_COMPLETED
 *
 * Keeps the latest MAX_ENTRIES entries.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type DiagEventType =
  // ── Native Android share pipeline (logged via android.util.Log, mirrored here) ──
  | 'MAIN_ACTIVITY_CREATED'
  | 'MAIN_ACTIVITY_ON_NEW_INTENT'
  | 'INTENT_ACTION'
  | 'INTENT_MIME_TYPE'
  | 'INTENT_EXTRAS'
  | 'ACTION'
  | 'MIME_TYPE'
  | 'EXTRA_TEXT'
  | 'EXTRA_STREAM'
  | 'EXTRA_SUBJECT'
  | 'EXTRA_TITLE'
  | 'CLIP_DATA'
  | 'INTENT_DATA'
  | 'CLIPDATA_FOUND'
  | 'DATA_URI_FOUND'
  | 'STREAM_URI_FOUND'
  | 'INTENT_URI_FOUND'
  | 'SHARE_EXTRACT_RESULT'
  // ── Service readiness events (always-on) ──────────────────────────────────
  | 'DATABASE_INITIALIZED'
  | 'DATAPROVIDER_READY'
  | 'CAPTURE_QUEUE_READY'
  | 'SHARE_MANAGER_READY'
  | 'SHARE_PAYLOAD_RECEIVED'
  // ── App lifecycle (always-on) ─────────────────────────────────────────────
  | 'APP_STATE'
  | 'APP_COLD_START'
  | 'APP_FOREGROUND'
  | 'APP_BACKGROUND'
  | 'APP_ALREADY_RUNNING'
  | 'SHARE_INTENT_RECEIVED'
  | 'SHARE_ACTION'
  | 'SHARE_MIME_TYPE'
  | 'SHARE_PAYLOAD'
  | 'SHARE_TEXT'
  | 'URL_EXTRACTED'
  | 'ROUTE_TO_SHARE_SCREEN'
  // ── Native Share & WorkManager diagnostics (always-on) ────────────────────
  | 'NATIVE_SHARE_ACTIVITY_CREATED'
  | 'NATIVE_SHARE_RECEIVED'
  | 'NATIVE_SHARE_SAVED'
  | 'NATIVE_DB_WRITE_SUCCESS'
  | 'NATIVE_DB_WRITE_FAILED'
  | 'DB_PATH_RESOLVED'
  | 'DB_OPEN_SUCCESS'
  | 'DB_OPEN_FAILED'
  | 'DB_INSERT_SUCCESS'
  | 'DB_INSERT_FAILED'
  | 'WORKMANAGER_ENQUEUED'
  | 'WORKMANAGER_STARTED'
  | 'WORKMANAGER_COMPLETED'
  | 'NATIVE_SHARE_FAILED'
  | 'PENDING_SHARE_FAILED'
  // ── Share URI rewrite diagnostics ─────────────────────────────────────────
  | 'SHARE_ROUTE_SOURCE'
  | 'SHARE_URI_RAW'
  | 'SHARE_URI_REWRITTEN'
  | 'SHARE_REWRITE_SUCCESS'
  | 'SHARE_REWRITE_SKIPPED'
  | 'PENDING_SHARE_RAW_CAPTURED'
  | 'SHARE_NO_URL_FOUND'
  | 'SHARE_MULTI_URL_FOUND'
  | 'QUEUE_ITEM_CREATED'
  | 'QUEUE_ITEM_PERSISTED'
  | 'QUEUE_ITEM_COMPLETED'
  | 'LIBRARY_ITEM_CREATED'
  | 'COLLECTION_MATCHED'
  | 'COLLECTION_ASSIGNED'
  | 'COLLECTION_COUNT_UPDATED'
  | 'COLLECTION_REFRESHED'
  | 'COLLECTION_SKIPPED'
  | 'TOPIC_SUGGESTED'
  | 'ENRICHMENT_STARTED'
  | 'ENRICHMENT_COMPLETED'
  | 'SHARE_PAYLOAD_PERSISTED'
  | 'PENDING_SHARE_FOUND'
  | 'PENDING_SHARE_PROCESSED'
  | 'FAILED_SHARE_CAPTURED'
  | 'SHARE_SCREEN_SUCCESS'
  | 'SHARE_SCREEN_ERROR'
  | 'NAVIGATION_SUCCESS'
  | 'NAVIGATION_ERROR'
  | 'ROUTE_REDIRECT_START'
  | 'ROUTE_REDIRECT_COMPLETE'
  // ── Live library refresh (FIX 3) ──────────────────────────────────────────
  | 'LIBRARY_REFRESH_TRIGGERED'
  | 'LIBRARY_REFRESH_COMPLETED'
  // ── Opt-in events ─────────────────────────────────────────────────────────
  | 'SHARE_URL_EXTRACTED'
  | 'SHARE_SCREEN_OPENED'
  | 'SHARE_FORM_POPULATED'
  | 'SHARE_INTENT_PARSED'
  | 'METADATA_FOUND'
  | 'AI_REQUEST_STARTED'
  | 'AI_RESPONSE_RAW'
  | 'AI_RESPONSE_RECEIVED'
  | 'AI_RESPONSE_PARSED'
  | 'PROVIDER_ERROR'
  | 'SAVE_STARTED'
  | 'SAVE_COMPLETED'
  | 'SAVE_FAILED'
  | 'FORM_UPDATE_STARTED'
  | 'FORM_UPDATE_COMPLETED';

/**
 * Events that are always written to the ring buffer, even when the user has
 * not enabled the full diagnostics log.  These are the minimal signals needed
 * to reconstruct a share pipeline failure in any build.
 */
const ALWAYS_ON_EVENTS = new Set<DiagEventType>([
  'MAIN_ACTIVITY_CREATED',
  'MAIN_ACTIVITY_ON_NEW_INTENT',
  'INTENT_ACTION',
  'INTENT_MIME_TYPE',
  'INTENT_EXTRAS',
  'ACTION',
  'MIME_TYPE',
  'EXTRA_TEXT',
  'EXTRA_STREAM',
  'EXTRA_SUBJECT',
  'EXTRA_TITLE',
  'CLIP_DATA',
  'INTENT_DATA',
  'CLIPDATA_FOUND',
  'DATA_URI_FOUND',
  'STREAM_URI_FOUND',
  'INTENT_URI_FOUND',
  'SHARE_EXTRACT_RESULT',
  'DATABASE_INITIALIZED',
  'DATAPROVIDER_READY',
  'CAPTURE_QUEUE_READY',
  'SHARE_MANAGER_READY',
  'SHARE_PAYLOAD_RECEIVED',
  'APP_STATE',
  'APP_COLD_START',
  'APP_FOREGROUND',
  'APP_BACKGROUND',
  'APP_ALREADY_RUNNING',
  'SHARE_INTENT_RECEIVED',
  'SHARE_ACTION',
  'SHARE_MIME_TYPE',
  'SHARE_PAYLOAD',
  'SHARE_TEXT',
  'URL_EXTRACTED',
  'ROUTE_TO_SHARE_SCREEN',
  'NATIVE_SHARE_ACTIVITY_CREATED',
  'NATIVE_SHARE_RECEIVED',
  'NATIVE_SHARE_SAVED',
  'NATIVE_DB_WRITE_SUCCESS',
  'NATIVE_DB_WRITE_FAILED',
  'DB_PATH_RESOLVED',
  'DB_OPEN_SUCCESS',
  'DB_OPEN_FAILED',
  'DB_INSERT_SUCCESS',
  'DB_INSERT_FAILED',
  'WORKMANAGER_ENQUEUED',
  'WORKMANAGER_STARTED',
  'WORKMANAGER_COMPLETED',
  'NATIVE_SHARE_FAILED',
  'PENDING_SHARE_FAILED',
  'SHARE_ROUTE_SOURCE',
  'SHARE_URI_RAW',
  'SHARE_URI_REWRITTEN',
  'SHARE_REWRITE_SUCCESS',
  'SHARE_REWRITE_SKIPPED',
  'PENDING_SHARE_RAW_CAPTURED',
  'SHARE_NO_URL_FOUND',
  'SHARE_MULTI_URL_FOUND',
  'QUEUE_ITEM_CREATED',
  'QUEUE_ITEM_PERSISTED',
  'QUEUE_ITEM_COMPLETED',
  'LIBRARY_ITEM_CREATED',
  'COLLECTION_MATCHED',
  'COLLECTION_ASSIGNED',
  'COLLECTION_COUNT_UPDATED',
  'COLLECTION_REFRESHED',
  'COLLECTION_SKIPPED',
  'ENRICHMENT_STARTED',
  'ENRICHMENT_COMPLETED',
  'SHARE_PAYLOAD_PERSISTED',
  'PENDING_SHARE_FOUND',
  'PENDING_SHARE_PROCESSED',
  'FAILED_SHARE_CAPTURED',
  'SHARE_SCREEN_SUCCESS',
  'SHARE_SCREEN_ERROR',
  'NAVIGATION_SUCCESS',
  'NAVIGATION_ERROR',
  'ROUTE_REDIRECT_START',
  'ROUTE_REDIRECT_COMPLETE',
]);

export interface DiagEntry {
  /** Monotonically-increasing counter */
  seq: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  event: DiagEventType;
  /** Structured detail string — must never contain API keys, tokens, or PII */
  detail: string;
}

const MAX_ENTRIES = 200;

class DiagnosticsLog {
  private entries: DiagEntry[] = [];
  private seq = 0;
  private _enabled = false;

  get enabled(): boolean {
    return this._enabled;
  }

  enable(): void {
    this._enabled = true;
  }

  disable(): void {
    this._enabled = false;
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
  }

  /**
   * Append an entry.
   * Always-on events (share pipeline) are written even when diagnostics is
   * disabled.  All other events are silently ignored when disabled.
   * `detail` must never contain API keys, tokens, or personal data.
   */
  addEntry(event: DiagEventType, detail: string): void {
    if (!this._enabled && !ALWAYS_ON_EVENTS.has(event)) return;
    const entry: DiagEntry = {
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      event,
      detail,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES);
    }
  }

  /** Returns a shallow copy of all current entries, oldest first. */
  getEntries(): DiagEntry[] {
    return [...this.entries];
  }

  /**
   * Returns true if a QUEUE_ITEM_CREATED event exists in the current session log,
   * confirming that share ingestion has already persisted and queued the item.
   */
  hasQueueItemCreated(): boolean {
    return this.entries.some((e) => e.event === 'QUEUE_ITEM_CREATED');
  }

  /**
   * Returns the last event written before the given sequence number (exclusive).
   * Used by failure forensics to determine the last successful pipeline step.
   */
  getLastEventBefore(seqExclusive: number): DiagEventType | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].seq < seqExclusive) return this.entries[i].event;
    }
    return null;
  }

  /**
   * Given an ordered list of required pipeline events, returns the first one
   * that does NOT appear anywhere in the current log at or after `afterSeq`.
   * Returns null if all are present.
   */
  firstMissingEvent(
    required: DiagEventType[],
    afterSeq = 0
  ): DiagEventType | null {
    const seen = new Set(
      this.entries.filter((e) => e.seq >= afterSeq).map((e) => e.event)
    );
    return required.find((ev) => !seen.has(ev)) ?? null;
  }

  /** Returns the last N entries (or fewer if the buffer is smaller). */
  getLastNEntries(n: number): DiagEntry[] {
    return this.entries.slice(-n);
  }

  /**
   * Calculates real-time Share & Queue Pipeline metrics from recorded diagnostics events.
   */
  getShareMetrics(): {
    shareAttempts: number;
    nativeInserts: number;
    queueItemsCreated: number;
    queueItemsCompleted: number;
  } {
    const shareAttempts = this.entries.filter(
      (e) => e.event === 'NATIVE_SHARE_RECEIVED' || e.event === 'SHARE_INTENT_RECEIVED' || e.event === 'SHARE_ACTION'
    ).length;

    const nativeInserts = this.entries.filter(
      (e) => e.event === 'NATIVE_SHARE_SAVED' || e.event === 'PENDING_SHARE_RAW_CAPTURED' || e.event === 'SHARE_PAYLOAD_PERSISTED'
    ).length;

    const queueItemsCreated = this.entries.filter(
      (e) => e.event === 'QUEUE_ITEM_CREATED'
    ).length;

    const queueItemsCompleted = this.entries.filter(
      (e) => e.event === 'QUEUE_ITEM_COMPLETED' || e.event === 'ENRICHMENT_COMPLETED'
    ).length;

    return {
      shareAttempts,
      nativeInserts,
      queueItemsCreated,
      queueItemsCompleted,
    };
  }

  clearEntries(): void {
    this.entries = [];
    this.seq = 0;
  }

  /** Formats all entries as plain text suitable for clipboard / bug reports. */
  formatForExport(): string {
    const header = [
      '=== Lumio Developer Diagnostics ===',
      `Generated: ${new Date().toISOString()}`,
      `Entries: ${this.entries.length} (latest ${MAX_ENTRIES} kept)`,
      '===================================',
      '',
    ].join('\n');
    if (this.entries.length === 0) return header + '(no entries recorded)';

    // Append a native share proof block — always shown so it is visible even
    // when no failure occurred and no FAILED_SHARE_CAPTURED entry exists.
    const nativeProofEntries = this.entries.filter(
      (e) =>
        e.event === 'NATIVE_SHARE_ACTIVITY_CREATED' ||
        e.event === 'NATIVE_SHARE_RECEIVED' ||
        e.event === 'NATIVE_SHARE_SAVED'
    );
    let nativeProofBlock = '';
    if (nativeProofEntries.length > 0) {
      nativeProofBlock =
        '\n=== Native Share Activity Proof ===\n' +
        nativeProofEntries
          .map((e) => `[${e.timestamp}] #${e.seq} ${e.event.padEnd(30)}  ${e.detail}`)
          .join('\n') +
        '\n===================================';
    } else {
      nativeProofBlock =
        '\n=== Native Share Activity Proof ===\n' +
        'NATIVE_SHARE_ACTIVITY_CREATED : NOT PRESENT — NativeShareActivity.onCreate() was never called this session.\n' +
        'NATIVE_SHARE_RECEIVED         : NOT PRESENT\n' +
        'NATIVE_SHARE_SAVED            : NOT PRESENT\n' +
        '===================================';
    }

    // Append a failure report block if a FAILED_SHARE_CAPTURED event exists.
    const failureEntries = this.entries.filter((e) => e.event === 'FAILED_SHARE_CAPTURED');
    let failureBlock = '';
    if (failureEntries.length > 0) {
      const last = failureEntries[failureEntries.length - 1];
      const lastSuccessful = this.getLastEventBefore(last.seq);
      const missing = this.firstMissingEvent(
        ['SHARE_PAYLOAD_PERSISTED', 'QUEUE_ITEM_CREATED', 'QUEUE_ITEM_PERSISTED'],
        0
      );
      const stateEntry = [...this.entries].reverse().find(
        (e) => e.event === 'APP_STATE' || e.event === 'APP_COLD_START' ||
               e.event === 'APP_FOREGROUND' || e.event === 'APP_BACKGROUND'
      );
      failureBlock = [
        '',
        '=== Failure Report ===',
        `State:             ${stateEntry?.detail ?? 'unknown'}`,
        `Last Successful Event:  ${lastSuccessful ?? '(none)'}`,
        `First Missing Event:    ${missing ?? '(none — all present)'}`,
        `Root Cause Candidate:   ${_rootCauseCandidate(lastSuccessful, missing, stateEntry?.detail ?? '')}`,
        '=====================',
      ].join('\n');
    }

    return (
      header +
      this.entries
        .map((e) => `[${e.timestamp}] #${e.seq} ${e.event.padEnd(26)}  ${e.detail}`)
        .join('\n') +
      nativeProofBlock +
      failureBlock
    );
  }

  /**
   * Write the log to a temp file and open the system share sheet.
   * Throws if sharing is unavailable on the device.
   */
  async exportForSharing(): Promise<void> {
    const text = this.formatForExport();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const fileName = `lumio-diagnostics-${timestamp}.txt`;
    const fileUri = `${FileSystem.cacheDirectory ?? ''}${fileName}`;

    await FileSystem.writeAsStringAsync(fileUri, text, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/plain',
      dialogTitle: 'Export Lumio Diagnostics',
      UTI: 'public.plain-text',
    });
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Derive a human-readable root cause candidate from the forensic fields.
 * This is intentionally coarse — it produces a starting hypothesis, not a verdict.
 */
function _rootCauseCandidate(
  lastEvent: DiagEventType | null,
  firstMissing: DiagEventType | null,
  lifecycleState: string
): string {
  if (!firstMissing) return 'No missing pipeline events — failure occurred post-queue.';

  if (firstMissing === 'SHARE_PAYLOAD_PERSISTED') {
    if (lifecycleState.includes('cold')) {
      return 'cold_start: rewriteShareIntent() may have silently failed (EXTRA_TEXT null or URLEncoder threw) — intent arrived as lumio:/// with no payload.';
    }
    if (lifecycleState.includes('background')) {
      return 'background_resume: DataProvider resetReadinessGate() fired but rewrite was skipped — check SHARE_REWRITE_SKIPPED in log.';
    }
    return 'warm_start: redirectSystemPath received non-share URI or empty payload — check SHARE_ROUTE_SOURCE in log.';
  }

  if (firstMissing === 'QUEUE_ITEM_CREATED') {
    if (lastEvent === 'SHARE_PAYLOAD_PERSISTED') {
      return 'Payload persisted to pending_shares but waitForServicesReady() timed out or enqueueCapture() threw — check CAPTURE_QUEUE_READY / SAVE_FAILED in log.';
    }
    return `Pipeline stalled after ${lastEvent ?? '(unknown)'} — enqueueCapture never called.`;
  }

  if (firstMissing === 'QUEUE_ITEM_PERSISTED') {
    return `enqueueCapture was called but QUEUE_ITEM_PERSISTED not emitted — saveItem() or in-memory queue push likely threw. Last event: ${lastEvent ?? '(unknown)'}.`;
  }

  return `Unknown gap — last event: ${lastEvent ?? '(none)'}, missing: ${firstMissing}.`;
}

/** Singleton — import this from anywhere in the app. */
export const diagLog = new DiagnosticsLog();
