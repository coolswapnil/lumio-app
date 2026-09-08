import { getDatabase, initDatabase } from '../database/db';
import { enqueueCapture } from './captureQueue';
import { diagLog } from './diagnostics';
import { waitForServicesReady, getReadinessSnapshot } from './serviceReadiness';
import { generateId } from '../utils/uuid';
import { sanitizeUrl } from '../utils/validation';

export interface PendingShare {
  id: string;
  text: string;
  url: string;
  title: string;
  subject: string;
  raw_path: string;
  extraction_source: string;
  status: 'pending' | 'processed' | 'failed';
  createdAt: string;
}

export class ShareIngestionManager {
  /**
   * Main entry point to ingest an incoming lumio://share?... URI.
   *
   * Contract:
   *   1. Persist the raw path immediately (PENDING_SHARE_RAW_CAPTURED) — no
   *      data is ever lost even if subsequent steps crash.
   *   2. Collect every distinct http(s) URL from every param (text, urls, url,
   *      subject) applying regex extraction where needed.
   *   3. Create one queue item per unique URL.
   *   4. Return all created itemIds.
   *
   * The `urls=` param in the synthetic URI contains a pipe-delimited list of
   * pre-extracted URLs from the native layer's full-collection pass.  This is
   * the primary source.  `text=` and `subject=` are re-scanned with regex as
   * a second pass to catch anything the native layer missed.
   */
  static async ingest(path: string): Promise<{ itemIds: string[]; wasProcessed: boolean }> {
    // ── Step 0: Wait for all required services ────────────────────────────
    // On a cold-start share this method is called from redirectSystemPath
    // (inside getInitialURL) before DataProvider and CaptureQueueContext have
    // mounted.  We wait here so that enqueueCapture() below has full collection
    // context and the queue item is immediately observable by the UI.
    const snap = getReadinessSnapshot();
    diagLog.addEntry(
      'SHARE_PAYLOAD_RECEIVED',
      `ingest called — DATABASE=${snap.database} DATAPROVIDER=${snap.dataProvider} CAPTURE_QUEUE=${snap.captureQueue} path="${path.slice(0, 80)}"`
    );
    await waitForServicesReady();

    // Ensure database is initialized and the tables (including pending_shares) exist.
    await initDatabase();

    const now       = new Date().toISOString();
    const pendingId = generateId();
    const db        = await getDatabase();

    // ── Step 1: Persist raw path BEFORE any parsing ───────────────────────
    // This is the failsafe write. Even if extractPayload() or enqueueCapture()
    // throws, we have a SQLite row with the verbatim intent URI that can be
    // recovered on next launch.
    const { text, url, title, subject, src, mime, urls: urlsParam } = this.extractPayload(path);

    await db.runAsync(
      `INSERT INTO pending_shares
         (id, text, url, title, subject, raw_path, extraction_source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pendingId,
        text     || null,
        url      || null,
        title    || null,
        subject  || null,
        path.slice(0, 2000),   // raw_path — verbatim synthetic URI, length-capped
        src      || null,
        'pending',
        now,
      ]
    );

    diagLog.addEntry(
      'PENDING_SHARE_RAW_CAPTURED',
      `pendingId=${pendingId} src="${src}" mime="${mime}" textLen=${text.length} urlsParam="${urlsParam.slice(0, 120)}"`
    );

    // Guard: if everything is empty there is nothing to queue.
    if (!text && !url && !title && !subject && !urlsParam) {
      diagLog.addEntry(
        'SHARE_NO_URL_FOUND',
        `pendingId=${pendingId} — all params empty; action=ingest src="${src}" mime="${mime}"`
      );
      return { itemIds: [], wasProcessed: false };
    }

    // ── Step 2: Collect all unique URLs ───────────────────────────────────
    const candidates = this.collectUrls({ text, url, subject, urlsParam });

    diagLog.addEntry(
      'SHARE_PAYLOAD_PERSISTED',
      `pendingId=${pendingId} urlCount=${candidates.length} text="${text.slice(0, 80)}" firstUrl="${candidates[0] ?? ''}"`
    );

    if (candidates.length === 0) {
      // Text content present but no extractable URL — leave pending for manual
      // entry recovery and log a full diagnostic dump.
      diagLog.addEntry(
        'SHARE_NO_URL_FOUND',
        `pendingId=${pendingId}` +
        ` src="${src}"` +
        ` mime="${mime}"` +
        ` text="${text.slice(0, 120)}"` +
        ` subject="${subject.slice(0, 80)}"` +
        ` urlsParam="${urlsParam.slice(0, 120)}"` +
        ` — no http(s) URL found in any source`
      );
      return { itemIds: [], wasProcessed: false };
    }

    // ── Step 3: One queue item per URL ────────────────────────────────────
    const itemIds: string[] = [];
    try {
      for (const resolvedUrl of candidates) {
        const titleHint = title || subject || '';
        const itemId    = await enqueueCapture(resolvedUrl, { titleHint });
        itemIds.push(itemId);
        diagLog.addEntry(
          'QUEUE_ITEM_CREATED',
          `pendingId=${pendingId} itemId=${itemId} url="${resolvedUrl.slice(0, 120)}"`
        );
      }

      await db.runAsync(
        `UPDATE pending_shares SET status = 'processed' WHERE id = ?`,
        [pendingId]
      );

      return { itemIds, wasProcessed: true };
    } catch (error) {
      await db.runAsync(
        `UPDATE pending_shares SET status = 'failed' WHERE id = ?`,
        [pendingId]
      );
      diagLog.addEntry(
        'SAVE_FAILED',
        `Ingestion failed for pendingId=${pendingId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Recovery routine on startup: checks for pending shares and enqueues them.
   * Pending shares are rows whose ingest() call completed step 1 but not step 3
   * (e.g. app was killed during enrichment, or no network at share time).
   */
  static async recoverPendingShares(): Promise<void> {
    try {
      await initDatabase();

      const db      = await getDatabase();
      const pending = await db.getAllAsync<any>(
        `SELECT * FROM pending_shares WHERE status = 'pending'`
      );

      if (!pending || pending.length === 0) return;

      diagLog.addEntry('PENDING_SHARE_FOUND', `Found ${pending.length} pending shares for recovery`);

      for (const share of pending) {
        try {
          // Re-derive URLs from whichever fields were persisted.
          const rawText   = share.text    ?? '';
          const rawUrl    = share.url     ?? '';
          const rawSubject = share.subject ?? '';

          // Recovery: also re-parse from raw_path if available (contains urls= param)
          let urlsParam = '';
          if (share.raw_path) {
            try {
              urlsParam = new URL(share.raw_path).searchParams.get('urls') ?? '';
            } catch { /* malformed raw_path — ignore */ }
          }

          const candidates = this.collectUrls({
            text:      rawText,
            url:       rawUrl,
            subject:   rawSubject,
            urlsParam,
          });

          if (candidates.length === 0) {
            // No URL recoverable — mark processed to avoid infinite retry.
            await db.runAsync(
              `UPDATE pending_shares SET status = 'processed' WHERE id = ?`,
              [share.id]
            );
            diagLog.addEntry(
              'SHARE_NO_URL_FOUND',
              `Recovery: no URL for pendingId=${share.id} — marked processed`
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
          await db.runAsync(
            `UPDATE pending_shares SET status = 'failed' WHERE id = ?`,
            [share.id]
          );
          diagLog.addEntry(
            'SAVE_FAILED',
            `Recovery failed for share ${share.id}: ${err instanceof Error ? err.message : String(err)}`
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
   * Parse the synthetic lumio://share?... URI.
   *
   * Params produced by MainActivity:
   *   text=    primary share text (EXTRA_TEXT or best fallback)
   *   title=   EXTRA_TITLE
   *   subject= EXTRA_SUBJECT
   *   urls=    pipe-delimited list of pre-extracted http(s) URLs (may be empty)
   *   src=     comma-separated source labels from native extraction chain
   *   mime=    MIME type of the original intent
   *   url=     legacy param kept for backward compatibility
   */
  static extractPayload(path: string): {
    text:     string;
    url:      string;
    title:    string;
    subject:  string;
    src:      string;
    mime:     string;
    urls:     string;
  } {
    let text    = '';
    let url     = '';
    let title   = '';
    let subject = '';
    let src     = '';
    let mime    = '';
    let urls    = '';

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
      // Fallback: manual regex extraction for malformed URIs
      const get = (key: string) => {
        const m = path.match(new RegExp(`[?&]${key}=([^&]*)`));
        return m ? safeDecodeURIComponent(m[1]) : '';
      };
      text    = get('text');
      url     = get('url');
      title   = get('title');
      subject = get('subject');
      src     = get('src');
      mime    = get('mime');
      urls    = get('urls');
    }

    return { text, url, title, subject, src, mime, urls };
  }

  /**
   * Collect all distinct, sanitized http(s) URLs from every available param.
   *
   * Sources (applied in order, deduped by URL string):
   *   1. `urlsParam` — pre-extracted pipe-delimited list from native layer
   *   2. `url`       — explicit url= param (legacy)
   *   3. `text`      — regex scan of full text payload
   *   4. `subject`   — regex scan of subject
   *
   * Returns a deduplicated ordered array ready for enqueueCapture().
   */
  static collectUrls(params: {
    text:      string;
    url:       string;
    subject:   string;
    urlsParam: string;
  }): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    const add = (raw: string) => {
      const clean = sanitizeUrl(raw.trim().replace(/[.)>\s]+$/, ''));
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    };

    // 1. Native-extracted URLs (most reliable, already regex-filtered)
    if (params.urlsParam) {
      params.urlsParam.split('|').forEach(u => { if (u) add(u); });
    }

    // 2. Legacy url= param
    if (params.url) add(params.url);

    // 3. Regex scan of text
    if (params.text) {
      extractUrlsFromText(params.text).forEach(add);
    }

    // 4. Regex scan of subject
    if (params.subject) {
      extractUrlsFromText(params.subject).forEach(add);
    }

    return out;
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────

/** Extract all http(s) URLs from a free-form text string. */
function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) ?? [];
  return matches.map(u => u.replace(/[.)>]+$/, ''));
}

/** decodeURIComponent that never throws. */
function safeDecodeURIComponent(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
