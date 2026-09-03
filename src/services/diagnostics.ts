/**
 * Diagnostics log — in-memory ring buffer for developer event tracing.
 *
 * Disabled by default. Enable via Settings → Advanced → Enable Developer Diagnostics.
 * Captures pipeline events across all key workflows:
 *
 *   Share intent:    SHARE_INTENT_RECEIVED | SHARE_INTENT_PARSED
 *   Metadata:        METADATA_FOUND
 *   AI pipeline:     AI_REQUEST_STARTED | AI_RESPONSE_RECEIVED |
 *                    AI_RESPONSE_PARSED | PROVIDER_ERROR
 *   Save workflow:   SAVE_STARTED | SAVE_COMPLETED | SAVE_FAILED
 *   Form:            FORM_UPDATE_COMPLETED
 *
 * Keeps the latest MAX_ENTRIES entries. Safe to call when disabled — calls
 * are silently ignored so instrumented code paths carry zero overhead.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type DiagEventType =
  | 'SHARE_INTENT_RECEIVED'
  | 'SHARE_ACTION'
  | 'SHARE_MIME_TYPE'
  | 'SHARE_TEXT'
  | 'SHARE_URL_EXTRACTED'
  | 'SHARE_SCREEN_OPENED'
  | 'SHARE_FORM_POPULATED'
  | 'SHARE_INTENT_PARSED'
  | 'METADATA_FOUND'
  | 'AI_REQUEST_STARTED'
  | 'AI_RESPONSE_RECEIVED'
  | 'AI_RESPONSE_PARSED'
  | 'PROVIDER_ERROR'
  | 'SAVE_STARTED'
  | 'SAVE_COMPLETED'
  | 'SAVE_FAILED'
  | 'FORM_UPDATE_COMPLETED';

export interface DiagEntry {
  /** Monotonically-increasing counter */
  seq: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  event: DiagEventType;
  /** Structured detail string — must never contain API keys, tokens, or PII */
  detail: string;
}

const MAX_ENTRIES = 100;

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
   * Append an entry. No-op when diagnostics is disabled.
   * `detail` must never contain API keys, tokens, or personal data.
   */
  addEntry(event: DiagEventType, detail: string): void {
    if (!this._enabled) return;
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
        .map((e) => `[${e.timestamp}] #${e.seq} ${e.event.padEnd(24)}  ${e.detail}`)
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
