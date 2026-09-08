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
 *   INTENT_ACTION | INTENT_MIME_TYPE | INTENT_EXTRAS | EXTRA_TEXT | EXTRA_STREAM |
 *   APP_COLD_START | APP_ALREADY_RUNNING |
 *   DATABASE_INITIALIZED | DATAPROVIDER_READY | CAPTURE_QUEUE_READY |
 *   SHARE_MANAGER_READY | SHARE_PAYLOAD_RECEIVED |
 *   SHARE_INTENT_RECEIVED | SHARE_ACTION | SHARE_MIME_TYPE | SHARE_PAYLOAD |
 *   URL_EXTRACTED | ROUTE_TO_SHARE_SCREEN | QUEUE_ITEM_CREATED |
 *   SHARE_PAYLOAD_PERSISTED |
 *   COLLECTION_MATCHED | COLLECTION_ASSIGNED | COLLECTION_COUNT_UPDATED |
 *   COLLECTION_REFRESHED | COLLECTION_SKIPPED |
 *   ENRICHMENT_STARTED | ENRICHMENT_COMPLETED
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
  | 'EXTRA_TEXT'
  | 'EXTRA_STREAM'
  | 'CLIP_DATA'
  | 'INTENT_DATA'
  | 'SHARE_EXTRACT_RESULT'
  // ── Service readiness events (always-on) ──────────────────────────────────
  | 'DATABASE_INITIALIZED'
  | 'DATAPROVIDER_READY'
  | 'CAPTURE_QUEUE_READY'
  | 'SHARE_MANAGER_READY'
  | 'SHARE_PAYLOAD_RECEIVED'
  // ── Always-on share pipeline ──────────────────────────────────────────────
  | 'APP_COLD_START'
  | 'APP_ALREADY_RUNNING'
  | 'SHARE_INTENT_RECEIVED'
  | 'SHARE_ACTION'
  | 'SHARE_MIME_TYPE'
  | 'SHARE_PAYLOAD'
  | 'SHARE_TEXT'
  | 'URL_EXTRACTED'
  | 'ROUTE_TO_SHARE_SCREEN'
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
  'EXTRA_TEXT',
  'EXTRA_STREAM',
  'CLIP_DATA',
  'INTENT_DATA',
  'SHARE_EXTRACT_RESULT',
  'DATABASE_INITIALIZED',
  'DATAPROVIDER_READY',
  'CAPTURE_QUEUE_READY',
  'SHARE_MANAGER_READY',
  'SHARE_PAYLOAD_RECEIVED',
  'APP_COLD_START',
  'APP_ALREADY_RUNNING',
  'SHARE_INTENT_RECEIVED',
  'SHARE_ACTION',
  'SHARE_MIME_TYPE',
  'SHARE_PAYLOAD',
  'SHARE_TEXT',
  'URL_EXTRACTED',
  'ROUTE_TO_SHARE_SCREEN',
  'SHARE_ROUTE_SOURCE',
  'SHARE_URI_RAW',
  'SHARE_URI_REWRITTEN',
  'SHARE_REWRITE_SUCCESS',
  'SHARE_REWRITE_SKIPPED',
  'PENDING_SHARE_RAW_CAPTURED',
  'SHARE_NO_URL_FOUND',
  'SHARE_MULTI_URL_FOUND',
  'QUEUE_ITEM_CREATED',
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
    return (
      header +
      this.entries
        .map((e) => `[${e.timestamp}] #${e.seq} ${e.event.padEnd(26)}  ${e.detail}`)
        .join('\n')
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

/** Singleton — import this from anywhere in the app. */
export const diagLog = new DiagnosticsLog();
