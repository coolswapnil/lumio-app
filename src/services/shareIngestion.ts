/**
 * shareIngestion.ts — production-grade Android Share Ingestion pipeline.
 *
 * ── Guarantees ───────────────────────────────────────────────────────────────
 *
 *  G1  Every incoming share is persisted to SQLite pending_shares BEFORE
 *      waiting for React services (DataProvider, CaptureQueueContext).
 *
 *  G2  Every intent source field is individually logged with its own
 *      CLIPDATA_FOUND / DATA_URI_FOUND / STREAM_URI_FOUND / EXTRA_TEXT event
 *      so failures can be traced to the exact extraction step.
 *
 *  G3  If URL extraction fails, every payload field is written verbatim to
 *      failed_share_capture so nothing is silently discarded.
 *
 *  G4  On every app startup, both recovery paths run:
 *        recoverPendingSharesFromPrefs()  — native SharedPreferences drain
 *        recoverPendingShares()           — SQLite pending_shares drain
 *
 *  G5  No queue item creation depends on Router, ShareScreen, or React
 *      lifecycle.  Queue items are created in +native-intent.ts before
 *      any navigation occurs.
 *
 * ── Ordering inside ingest() ─────────────────────────────────────────────────
 *
 *  STEP A  initDatabase() + INSERT pending_shares       (fail-safe, no wait)
 *  STEP B  Log every intent source field individually
 *  STEP C  Collect all unique URLs (native urls= param first, then regex)
 *  STEP D  If no URL found: INSERT failed_share_capture, emit FAILED_SHARE_CAPTURED
 *  STEP E  waitForServicesReady()                       (blocks until contexts up)
 *  STEP F  enqueueCapture() per URL — skeleton SavedItem + live queue entry
 *  STEP G  Mark pending_shares row processed; clear SharedPreferences entry
 */

import { getDatabase, initDatabase } from '../database/db';
import { enqueueCapture } from './captureQueue';
import { diagLog } from './diagnostics';
import { waitForServicesReady, getReadinessSnapshot } from './serviceReadiness';
import { getLifecycleState } from './lifecycleState';
import { generateId } from '../utils/uuid';
import { sanitizeUrl } from '../utils/validation';
import { NativeModules, Platform } from 'react-native';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PendingShare {
  id: string;
  text: string;
  url: string;
  title: string;
  subject: string;
  raw_path: string;
  extraction_source: string;
  mime: string;
  urls: string;
  status: 'pending' | 'processed' | 'failed';
  createdAt: string;
}

/**
 * All fields captured from the Android intent at the time of failure.
 * Written to failed_share_capture when ingest() cannot produce a queue item.
 */
export interface FailedShareCapture {
  id: string;
  rawPath: string;
  extraText: string;
  extraSubject: string;
  extraTitle: string;
  extraStream: string;
  clipDataText: string;
  clipDataUri: string;
  intentData: string;
  mimeType: string;
  bundleKeys: string;
  urlsParam: string;
  extractionSource: string;
  errorMessage: string;
  lastEvent: string;
  lifecycleState: string;
  payloadSummary: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Key used by MainActivity to store pending shares in SharedPreferences.
 * Must match the value in MainActivity.kt: PREFS_NAME.
 */
const NATIVE_PREFS_NAME = 'lumio_pending_shares';

// ── Main class ────────────────────────────────────────────────────────────────

export class ShareIngestionManager {
  /**
   * Main entry point — ingest an incoming lumio://share?... URI.
   *
   * See module-level ordering comment for the full step-by-step contract.
   * Returns itemIds (may be empty if no URL found) and wasProcessed flag.
   */
  static async ingest(path: string): Promise<{ itemIds: string[]; wasProcessed: boolean }> {
    const snap = getReadinessSnapshot();
    const lifecycle = getLifecycleState();
    diagLog.addEntry(
      'SHARE_PAYLOAD_RECEIVED',
      `ingest called — lifecycle=${lifecycle} DATABASE=${snap.database}` +
      ` DATAPROVIDER=${snap.dataProvider} CAPTURE_QUEUE=${snap.captureQueue}` +
      ` path="${path.slice(0, 80)}"`
    );

    // ── STEP A: Fail-safe SQLite persist (BEFORE services gate) ──────────────
    await initDatabase();

    const now       = new Date().toISOString();
    const pendingId = generateId();
    const db        = await getDatabase();

    const { text, url, title, subject, src, mime, urls: urlsParam } = this.extractPayload(path);

    await db.runAsync(
      `INSERT INTO pending_shares
         (id, text, url, title, subject, raw_path, extraction_source, mime, urls, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pendingId,
        text     || null,
        url      || null,
        title    || null,
        subject  || null,
        path.slice(0, 2000),
        src      || null,
        mime     || null,
        urlsParam || null,
        'pending',
        now,
      ]
    );

    diagLog.addEntry(
      'PENDING_SHARE_RAW_CAPTURED',
      `pendingId=${pendingId} lifecycle=${lifecycle} src="${src}" mime="${mime}"` +
      ` textLen=${text.length} urlsParam="${urlsParam.slice(0, 120)}"`
    );

    // ── STEP B: Log every intent source field individually ──────────────────
    // These events mirror the native Android log so the JS diagnostics trace
    // is a complete record of the extraction chain even without adb logcat.
    this._logSourceFields(path, mime, src);

    // Guard: if everything is empty there is nothing to queue.
    if (!text && !url && !title && !subject && !urlsParam) {
      diagLog.addEntry(
        'SHARE_NO_URL_FOUND',
        `pendingId=${pendingId} — lifecycle=${lifecycle} all params empty;` +
        ` src="${src}" mime="${mime}"`
      );
      await this._persistFailedCapture(db, {
        rawPath: path,
        extraText: text, extraSubject: subject, extraTitle: title,
        extraStream: '', clipDataText: '', clipDataUri: '', intentData: '',
        mimeType: mime, bundleKeys: '', urlsParam,
        extractionSource: src,
        errorMessage: 'All intent params empty — no content to save',
        lastEvent: 'PENDING_SHARE_RAW_CAPTURED',
        lifecycleState: lifecycle,
        payloadSummary: '(empty)',
      });
      return { itemIds: [], wasProcessed: false };
    }

    // ── STEP C: Collect all unique URLs ──────────────────────────────────────
    const candidates = this.collectUrls({ text, url, subject, urlsParam });

    diagLog.addEntry(
      'SHARE_PAYLOAD_PERSISTED',
      `pendingId=${pendingId} lifecycle=${lifecycle} urlCount=${candidates.length}` +
      ` text="${text.slice(0, 80)}" firstUrl="${candidates[0] ?? ''}"`
    );

    // ── STEP D: No URL found — persist failure record ─────────────────────────
    if (candidates.length === 0) {
      diagLog.addEntry(
        'SHARE_NO_URL_FOUND',
        `pendingId=${pendingId} lifecycle=${lifecycle} src="${src}" mime="${mime}"` +
        ` text="${text.slice(0, 120)}" subject="${subject.slice(0, 80)}"` +
        ` urlsParam="${urlsParam.slice(0, 120)}" — no http(s) URL found in any source`
      );
      await this._persistFailedCapture(db, {
        rawPath: path,
        extraText: text, extraSubject: subject, extraTitle: title,
        extraStream: '', clipDataText: '', clipDataUri: '', intentData: '',
        mimeType: mime, bundleKeys: '', urlsParam,
        extractionSource: src,
        errorMessage: `No http(s) URL found in any source. text="${text.slice(0, 120)}"`,
        lastEvent: 'SHARE_PAYLOAD_PERSISTED',
        lifecycleState: lifecycle,
        payloadSummary: text.slice(0, 200) || subject.slice(0, 200) || title.slice(0, 200),
      });
      return { itemIds: [], wasProcessed: false };
    }

    // ── STEP E: Wait for DataProvider + CaptureQueueContext ──────────────────
    await waitForServicesReady();

    // ── STEP F: One queue item per URL ────────────────────────────────────────
    const itemIds: string[] = [];
    try {
      for (const resolvedUrl of candidates) {
        const titleHint = title || subject || '';
        const itemId    = await enqueueCapture(resolvedUrl, { titleHint });
        itemIds.push(itemId);
        diagLog.addEntry(
          'QUEUE_ITEM_CREATED',
          `pendingId=${pendingId} lifecycle=${lifecycle} itemId=${itemId} url="${resolvedUrl.slice(0, 120)}"`
        );
        diagLog.addEntry(
          'QUEUE_ITEM_PERSISTED',
          `pendingId=${pendingId} lifecycle=${lifecycle} itemId=${itemId} url="${resolvedUrl.slice(0, 120)}"`
        );
      }

      if (candidates.length > 1) {
        diagLog.addEntry(
          'SHARE_MULTI_URL_FOUND',
          `pendingId=${pendingId} count=${candidates.length} urls="${candidates.join('|').slice(0, 200)}"`
        );
      }

      // ── STEP G: Mark processed and clean up SharedPreferences ───────────────
      await db.runAsync(
        `UPDATE pending_shares SET status = 'processed' WHERE id = ?`,
        [pendingId]
      );
      await this._clearPrefsEntry(path);

      return { itemIds, wasProcessed: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await db.runAsync(
        `UPDATE pending_shares SET status = 'failed' WHERE id = ?`,
        [pendingId]
      );
      await this._persistFailedCapture(db, {
        rawPath: path,
        extraText: text, extraSubject: subject, extraTitle: title,
        extraStream: '', clipDataText: '', clipDataUri: '', intentData: '',
        mimeType: mime, bundleKeys: '', urlsParam,
        extractionSource: src,
        errorMessage: `enqueueCapture failed: ${errMsg}`,
        lastEvent: 'QUEUE_ITEM_CREATED',
        lifecycleState: lifecycle,
        payloadSummary: candidates[0]?.slice(0, 200) ?? text.slice(0, 200),
      });
      diagLog.addEntry(
        'SAVE_FAILED',
        `Ingestion failed for pendingId=${pendingId}: ${errMsg}`
      );
      throw error;
    }
  }

  /**
   * Recovery — checks for pending SQLite rows and re-enqueues them.
   * Rows stuck in 'pending' survived a JS crash or process kill between
   * STEP A (SQLite write) and STEP F (enqueueCapture).
   */
  static async recoverPendingShares(): Promise<void> {
    try {
      await initDatabase();

      const db      = await getDatabase();
      const pending = await db.getAllAsync<{
        id: string; text: string | null; url: string | null;
        subject: string | null; title: string | null;
        raw_path: string | null; retry_count?: number;
      }>(
        `SELECT * FROM pending_shares WHERE status = 'pending'`
      );

      if (!pending || pending.length === 0) return;

      diagLog.addEntry(
        'PENDING_SHARE_FOUND',
        `Found ${pending.length} pending shares`
      );

      for (const share of pending) {
        try {
          const rawText    = share.text    ?? '';
          const rawUrl     = share.url     ?? '';
          const rawSubject = share.subject ?? '';

          // Re-parse raw_path to recover the native urls= param list
          let urlsParam = '';
          if (share.raw_path) {
            try {
              urlsParam = new URL(share.raw_path).searchParams.get('urls') ?? '';
            } catch { /* malformed raw_path — ignore */ }
          }

          const candidates = this.collectUrls({
            text: rawText, url: rawUrl, subject: rawSubject, urlsParam,
          });

          if (candidates.length === 0) {
            await db.runAsync(
              `UPDATE pending_shares SET status = 'processed' WHERE id = ?`,
              [share.id]
            );
            // Persist the unrecoverable share to failed_share_capture
            await this._persistFailedCapture(db, {
              rawPath: share.raw_path ?? '',
              extraText: rawText, extraSubject: rawSubject,
              extraTitle: share.title ?? '',
              extraStream: '', clipDataText: '', clipDataUri: '', intentData: '',
              mimeType: '', bundleKeys: '', urlsParam,
              extractionSource: '',
              errorMessage: 'Recovery: no URL recoverable from any field',
              lastEvent: 'PENDING_SHARE_FOUND',
              lifecycleState: 'startup_recovery',
              payloadSummary: rawText.slice(0, 200) || rawSubject.slice(0, 200),
            });
            diagLog.addEntry(
              'SHARE_NO_URL_FOUND',
              `recoverPendingShares: no URL for id=${share.id} — marked processed`
            );
            continue;
          }

          for (const resolvedUrl of candidates) {
            const titleHint = share.title || share.subject || '';
            const itemId    = await enqueueCapture(resolvedUrl, { titleHint });
            diagLog.addEntry(
              'PENDING_SHARE_PROCESSED',
              `Recovered and enqueued share id=${share.id} itemId=${itemId} url="${resolvedUrl.slice(0, 80)}"`
            );
          }

          await db.runAsync(
            `UPDATE pending_shares SET status = 'processed' WHERE id = ?`,
            [share.id]
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await db.runAsync(
            `UPDATE pending_shares SET status = 'failed' WHERE id = ?`,
            [share.id]
          );
          await this._persistFailedCapture(db, {
            rawPath: share.raw_path ?? '',
            extraText: share.text ?? '', extraSubject: share.subject ?? '',
            extraTitle: share.title ?? '',
            extraStream: '', clipDataText: '', clipDataUri: '', intentData: '',
            mimeType: '', bundleKeys: '', urlsParam: '',
            extractionSource: '',
            errorMessage: `Recovery enqueue failed: ${errMsg}`,
            lastEvent: 'PENDING_SHARE_FOUND',
            lifecycleState: 'startup_recovery',
            payloadSummary: (share.text ?? share.subject ?? '').slice(0, 200),
          });
          diagLog.addEntry(
            'SAVE_FAILED',
            `recoverPendingShares: id=${share.id} error=${errMsg}`
          );
        }
      }
    } catch (error) {
      diagLog.addEntry(
        'SAVE_FAILED',
        `recoverPendingShares error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Recovery — drains native SharedPreferences entries written by
   * MainActivity.persistShareToPrefs() before the JS engine started.
   * This is the deepest fail-safe: catches app-killed shares even when
   * the SQLite recovery finds nothing (e.g. DB never opened).
   */
  static async recoverPendingSharesFromPrefs(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
      const prefs = await _loadSharedPreferences();
      if (!prefs) return;

      const all = await prefs.getAll(NATIVE_PREFS_NAME);
      if (!all || typeof all !== 'object') return;

      // Group keys by timestamp-id
      const byId = new Map<string, Record<string, string>>();
      for (const [key, value] of Object.entries(all as Record<string, string>)) {
        const m = key.match(/^pending_share_(\d+)_(.+)$/);
        if (!m) continue;
        const [, id, field] = m;
        if (!byId.has(id)) byId.set(id, {});
        const entry = byId.get(id);
        if (entry) entry[field] = value ?? '';
      }

      if (byId.size === 0) return;

      diagLog.addEntry(
        'PENDING_SHARE_FOUND',
        `recoverPendingSharesFromPrefs: found ${byId.size} native prefs entries`
      );

      await initDatabase();
      const db = await getDatabase();

      for (const [id, fields] of byId.entries()) {
        try {
          const rawPath = fields['raw']   ?? '';
          const text    = fields['text']  ?? '';
          const subj    = fields['subj']  ?? '';
          const title   = fields['title'] ?? '';

          const effectivePath = (rawPath && rawPath !== '__PENDING__') ? rawPath : '';

          let candidates: string[] = [];
          if (effectivePath) {
            const parsed = this.extractPayload(effectivePath);
            candidates = this.collectUrls({
              text: parsed.text, url: parsed.url,
              subject: parsed.subject, urlsParam: parsed.urls,
            });
          }
          if (candidates.length === 0 && (text || subj)) {
            candidates = this.collectUrls({ text, url: '', subject: subj, urlsParam: '' });
          }

          if (candidates.length === 0) {
            await _removePrefsEntry(prefs, id, all as Record<string, string>);
            await this._persistFailedCapture(db, {
              rawPath: effectivePath,
              extraText: text, extraSubject: subj, extraTitle: title,
              extraStream: '', clipDataText: '', clipDataUri: '', intentData: '',
              mimeType: fields['mime'] ?? '', bundleKeys: '', urlsParam: '',
              extractionSource: '',
              errorMessage: 'recoverPendingSharesFromPrefs: no URL recoverable',
              lastEvent: 'PENDING_SHARE_FOUND',
              lifecycleState: 'prefs_recovery',
              payloadSummary: text.slice(0, 200) || subj.slice(0, 200),
            });
            diagLog.addEntry(
              'SHARE_NO_URL_FOUND',
              `recoverPendingSharesFromPrefs: no URL for id=${id} — removed`
            );
            continue;
          }

          // Skip if already processed in SQLite
          if (effectivePath) {
            const existing = await db.getFirstAsync<{ id: string }>(
              `SELECT id FROM pending_shares WHERE raw_path = ? AND status = 'processed' LIMIT 1`,
              [effectivePath.slice(0, 2000)]
            );
            if (existing) {
              await _removePrefsEntry(prefs, id, all as Record<string, string>);
              diagLog.addEntry(
                'PENDING_SHARE_PROCESSED',
                `recoverPendingSharesFromPrefs: already processed id=${id} — removed prefs`
              );
              continue;
            }
          }

          for (const resolvedUrl of candidates) {
            const titleHint = title || subj || '';
            const itemId    = await enqueueCapture(resolvedUrl, { titleHint });
            diagLog.addEntry(
              'PENDING_SHARE_PROCESSED',
              `recoverPendingSharesFromPrefs: id=${id} itemId=${itemId} url="${resolvedUrl.slice(0, 80)}"`
            );
          }

          await _removePrefsEntry(prefs, id, all as Record<string, string>);
        } catch (err) {
          diagLog.addEntry(
            'SAVE_FAILED',
            `recoverPendingSharesFromPrefs: id=${id} error=${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    } catch (err) {
      diagLog.addEntry(
        'SAVE_FAILED',
        `recoverPendingSharesFromPrefs outer: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Intent source field logging ─────────────────────────────────────────────

  /**
   * Log every intent source field that was encoded into the synthetic URI.
   *
   * Events emitted:
   *   EXTRA_TEXT    — if text param is non-empty
   *   EXTRA_TITLE   — if title param is non-empty
   *   EXTRA_SUBJECT — if subject param is non-empty
   *   CLIPDATA_FOUND / DATA_URI_FOUND / STREAM_URI_FOUND — per source label in src=
   *
   * This mirrors the native Android log so the JS diagnostics trace is a
   * complete record of the extraction chain even without adb logcat.
   */
  private static _logSourceFields(path: string, mime: string, src: string): void {
    const { text, title, subject, urls: urlsParam } = this.extractPayload(path);

    if (text) {
      diagLog.addEntry('EXTRA_TEXT', `textLen=${text.length} preview="${text.slice(0, 120)}"`);
    }
    if (title) {
      diagLog.addEntry('EXTRA_TITLE', `title="${title.slice(0, 120)}"`);
    }
    if (subject) {
      diagLog.addEntry('EXTRA_SUBJECT', `subject="${subject.slice(0, 120)}"`);
    }
    if (mime) {
      diagLog.addEntry('MIME_TYPE', `mime="${mime}"`);
    }

    // The src= param is a comma-separated list of source labels produced by
    // MainActivity.collectAllUrls().  Each label maps to a diagnostic event.
    if (src) {
      const sources = src.split(',').map(s => s.trim()).filter(Boolean);
      for (const source of sources) {
        if (source.startsWith('CLIP_DATA')) {
          diagLog.addEntry('CLIPDATA_FOUND', `source="${source}" urlsParam="${urlsParam.slice(0, 80)}"`);
        } else if (source === 'INTENT_DATA') {
          diagLog.addEntry('DATA_URI_FOUND', `source="${source}"`);
        } else if (source.startsWith('EXTRA_STREAM')) {
          diagLog.addEntry('STREAM_URI_FOUND', `source="${source}"`);
        }
      }
    }

    // Summarise all pre-extracted URLs from the native layer
    if (urlsParam) {
      const urlList = urlsParam.split('|').filter(Boolean);
      diagLog.addEntry(
        'SHARE_EXTRACT_RESULT',
        `urlCount=${urlList.length} sources="${src}" firstUrl="${urlList[0]?.slice(0, 120) ?? ''}"`
      );
    }
  }

  // ── Persistence helpers ─────────────────────────────────────────────────────

  /**
   * Write a row to failed_share_capture and emit FAILED_SHARE_CAPTURED.
   *
   * Called when:
   *   • all params are empty (no content to save)
   *   • no http(s) URL found in any source
   *   • enqueueCapture() threw
   *   • recovery passes cannot process a row
   *
   * Never throws — failure recording must not crash the caller.
   */
  static async _persistFailedCapture(
    db: Awaited<ReturnType<typeof getDatabase>>,
    fields: {
      rawPath: string;
      extraText: string; extraSubject: string; extraTitle: string;
      extraStream: string; clipDataText: string; clipDataUri: string;
      intentData: string; mimeType: string; bundleKeys: string;
      urlsParam: string; extractionSource: string;
      errorMessage: string; lastEvent: string; lifecycleState: string;
      payloadSummary: string;
    }
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const id  = generateId();

      // ── Forensic derivation from live diagnostics log ─────────────────────
      // Determine the last successful event that fired before this failure and
      // the first required pipeline event that is missing.  Both fields are
      // written into the diagnostics entry so the exported log is self-contained.
      const currentSeq   = diagLog.getEntries().length > 0
        ? diagLog.getEntries()[diagLog.getEntries().length - 1].seq
        : 0;
      const derivedLast  = diagLog.getLastEventBefore(currentSeq + 1) ?? fields.lastEvent;
      const firstMissing = diagLog.firstMissingEvent(
        ['SHARE_PAYLOAD_PERSISTED', 'QUEUE_ITEM_CREATED', 'QUEUE_ITEM_PERSISTED'],
        0
      );

      await db.runAsync(
        `INSERT INTO failed_share_capture (
           id, raw_path,
           extra_text, extra_subject, extra_title, extra_stream,
           clip_data_text, clip_data_uri, intent_data,
           mime_type, bundle_keys, urls_param, extraction_source,
           error_message, last_event, lifecycle_state, payload_summary,
           retry_count, created_at, updated_at
         ) VALUES (
           ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           0, ?, ?
         )`,
        [
          id, fields.rawPath.slice(0, 2000),
          fields.extraText.slice(0, 2000),
          fields.extraSubject.slice(0, 500),
          fields.extraTitle.slice(0, 500),
          fields.extraStream.slice(0, 500),
          fields.clipDataText.slice(0, 2000),
          fields.clipDataUri.slice(0, 1000),
          fields.intentData.slice(0, 1000),
          fields.mimeType.slice(0, 100),
          fields.bundleKeys.slice(0, 500),
          fields.urlsParam.slice(0, 2000),
          fields.extractionSource.slice(0, 500),
          fields.errorMessage.slice(0, 1000),
          derivedLast.toString().slice(0, 100),
          fields.lifecycleState.slice(0, 50),
          fields.payloadSummary.slice(0, 500),
          now, now,
        ]
      );

      // ── Structured FAILED_SHARE_CAPTURED entry ────────────────────────────
      // Format: "Failure Report" block inline in the diagnostics detail so the
      // log entry itself is a fully self-contained forensic record without
      // needing to cross-reference the full export.
      diagLog.addEntry(
        'FAILED_SHARE_CAPTURED',
        [
          `id=${id}`,
          `State: ${fields.lifecycleState}`,
          `Last Successful Event: ${derivedLast}`,
          `First Missing Event: ${firstMissing ?? '(none)'}`,
          `Error: ${fields.errorMessage.slice(0, 200)}`,
        ].join(' | ')
      );
    } catch (persistErr) {
      // Log but never throw — failed_share_capture is diagnostic-only
      diagLog.addEntry(
        'SAVE_FAILED',
        `_persistFailedCapture threw: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`
      );
    }
  }

  /**
   * Remove the SharedPreferences entry that matches a given synthetic URI.
   * Called after successful ingest() to prevent double-processing on restart.
   */
  private static async _clearPrefsEntry(rawPath: string): Promise<void> {
    if (Platform.OS !== 'android') return;
    try {
      const prefs = await _loadSharedPreferences();
      if (!prefs) return;
      const all = await prefs.getAll(NATIVE_PREFS_NAME);
      if (!all || typeof all !== 'object') return;
      for (const [key, value] of Object.entries(all as Record<string, string>)) {
        if (key.endsWith('_raw') && value === rawPath.slice(0, 2000)) {
          const id = key.replace(/^pending_share_(.+)_raw$/, '$1');
          await _removePrefsEntry(prefs, id, all as Record<string, string>);
          return;
        }
      }
    } catch { /* non-critical */ }
  }

  // ── Payload parsing ─────────────────────────────────────────────────────────

  /**
   * Parse the synthetic lumio://share?... URI produced by MainActivity.
   *
   * Params:
   *   text=    primary share text (EXTRA_TEXT or best fallback)
   *   title=   EXTRA_TITLE
   *   subject= EXTRA_SUBJECT
   *   urls=    pipe-delimited pre-extracted http(s) URLs (native layer)
   *   src=     comma-separated extraction source labels
   *   mime=    MIME type of the original intent
   *   url=     legacy param (backward compatibility)
   */
  static extractPayload(path: string): {
    text: string; url: string; title: string; subject: string;
    src: string; mime: string; urls: string;
  } {
    let text = '', url = '', title = '', subject = '', src = '', mime = '', urls = '';
    try {
      const parsed = new URL(path);
      text    = parsed.searchParams.get('text')    ?? '';
      url     = parsed.searchParams.get('url')     ?? '';
      title   = parsed.searchParams.get('title')   ?? '';
      subject = parsed.searchParams.get('subject') ?? '';
      src     = parsed.searchParams.get('src')     ?? '';
      mime    = parsed.searchParams.get('mime')    ?? '';
      urls    = parsed.searchParams.get('urls')    ?? '';
    } catch {
      const get = (key: string) => {
        const m = path.match(new RegExp(`[?&]${key}=([^&]*)`));
        return m ? _safeDecodeURIComponent(m[1]) : '';
      };
      text = get('text'); url = get('url'); title = get('title');
      subject = get('subject'); src = get('src'); mime = get('mime'); urls = get('urls');
    }
    return { text, url, title, subject, src, mime, urls };
  }

  /**
   * Collect all distinct, sanitized http(s) URLs from every available param.
   *
   * Sources (priority order, deduped by URL string):
   *   1. urlsParam — pipe-delimited native pre-extracted list (most reliable)
   *   2. url       — legacy explicit url= param
   *   3. text      — regex scan of full text payload
   *   4. subject   — regex scan of subject
   */
  static collectUrls(params: {
    text: string; url: string; subject: string; urlsParam: string;
  }): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    const add = (raw: string) => {
      const clean = sanitizeUrl(raw.trim().replace(/[.)>\s]+$/, ''));
      if (clean && !seen.has(clean)) { seen.add(clean); out.push(clean); }
    };

    if (params.urlsParam) params.urlsParam.split('|').forEach(u => { if (u) add(u); });
    if (params.url)       add(params.url);
    if (params.text)      _extractUrlsFromText(params.text).forEach(add);
    if (params.subject)   _extractUrlsFromText(params.subject).forEach(add);

    return out;
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────────

/** Extract all http(s) URLs from a free-form text string. */
function _extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) ?? [];
  return matches.map(u => u.replace(/[.)>]+$/, ''));
}

/** decodeURIComponent that never throws. */
function _safeDecodeURIComponent(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ── SharedPreferences helpers ─────────────────────────────────────────────────

/**
 * Load the LumioSharedPrefs native module if available.
 * Gracefully returns null on iOS or when the module is not registered.
 */
async function _loadSharedPreferences(): Promise<_SharedPrefsbridge | null> {
  try {
    const mod = NativeModules.LumioSharedPrefs as _SharedPrefsbridge | undefined;
    if (mod && typeof mod.getAll === 'function') return mod;
    return null;
  } catch {
    return null;
  }
}

async function _removePrefsEntry(
  prefs: _SharedPrefsbridge,
  id: string,
  all: Record<string, string>
): Promise<void> {
  const keysToRemove = Object.keys(all).filter(k => k.startsWith(`pending_share_${id}_`));
  for (const key of keysToRemove) {
    await prefs.remove(NATIVE_PREFS_NAME, key).catch(() => {});
  }
}

interface _SharedPrefsbridge {
  getAll(prefsName: string): Promise<Record<string, string>>;
  remove(prefsName: string, key: string): Promise<void>;
}
