/**
 * +native-intent.ts — expo-router system intent interceptor
 *
 * Expo Router calls `redirectSystemPath` for every URL before routing:
 *   • On cold start  (initial: true)  — called from getInitialURL()
 *   • On warm start  (initial: false) — called from Linking.addEventListener('url')
 *
 * Android share intents (ACTION_SEND) carry their payload in EXTRA_TEXT,
 * not in the intent's data URI.  React Native's IntentAndroid module only
 * reads getIntent().getDataString() — so without intervention getInitialURL()
 * returns null and expo-router never navigates to /share.
 *
 * MainActivity.rewriteShareIntent() converts every incoming ACTION_SEND into
 * an ACTION_VIEW with a synthetic URI:
 *
 *   lumio://share?text=<url-encoded EXTRA_TEXT>&title=<encoded>&subject=<encoded>
 *
 * This file intercepts that URI, persists it immediately to SQLite, creates a queue
 * item, and ONLY after persistence completes, returns the expo-router path that
 * the share screen expects.
 *
 * Both legs (cold-start getInitialURL + warm-start Linking 'url' event)
 * pass through redirectSystemPath, so this single function covers all cases.
 *
 * ── Why lumio:/// still appears ──────────────────────────────────────────────
 *
 * lumio:/// is the URI that Android delivers when MainActivity receives an
 * ACTION_VIEW intent whose data has no authority or path — specifically from
 * two sources:
 *
 *   1. LumioWidget.kt "App logo" button:
 *        data = Uri.parse("lumio://")
 *      Android normalises this to "lumio:///" before delivering it.
 *
 *   2. rewriteShareIntent() falls into its silent catch block:
 *        if (sharedText == null)  → the rewrite is skipped entirely and the
 *        original ACTION_SEND intent is delivered unchanged.  React Native then
 *        reads the intent's data URI (which is null for ACTION_SEND) and Expo
 *        Router synthesises "lumio:///" as a fallback root path.
 *
 * Both scenarios are now explicitly logged by SHARE_ROUTE_SOURCE so the
 * diagnostics trace shows exactly which case occurred.
 */

import { diagLog } from '../src/services/diagnostics';
import { ShareIngestionManager } from '../src/services/shareIngestion';
import { getDatabase, initDatabase } from '../src/database/db';
import {
  classifyAndSetLifecycleState,
  getLifecycleState,
  type LifecycleState,
} from '../src/services/lifecycleState';

const SHARE_PREFIX = 'lumio://share';

/** Paths that are known non-share deep-links — routed without processing. */
const KNOWN_NON_SHARE_PATHS = new Set(['lumio://save', 'lumio://']);

/**
 * Intercepts synthetic lumio://share? URIs, persists them to SQLite, enqueues
 * them in the capture queue, and then returns /share? paths.
 * All other URLs are returned unchanged.
 */
export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  // ── Classify and emit lifecycle state first ──────────────────────────────
  const lifecycle: LifecycleState = classifyAndSetLifecycleState(
    initial,
    diagLog.getEntries().length
  );

  // APP_STATE: always-on banner entry — one per redirectSystemPath call.
  diagLog.addEntry('APP_STATE', `lifecycle=${lifecycle} initial=${initial}`);

  // Emit the specific lifecycle event so filters can isolate by state.
  if (lifecycle === 'cold_start') {
    diagLog.addEntry('APP_COLD_START', `initial=${initial} path="${path.slice(0, 80)}"`);
  } else if (lifecycle === 'background_resume') {
    diagLog.addEntry('APP_BACKGROUND', `resuming from background — initial=${initial} path="${path.slice(0, 80)}"`);
    diagLog.addEntry('APP_FOREGROUND', `brought to foreground by share intent — path="${path.slice(0, 80)}"`);
  } else {
    // warm_start: app already running, share arrived via Linking URL event.
    diagLog.addEntry('APP_FOREGROUND', `warm_start — initial=${initial} path="${path.slice(0, 80)}"`);
  }

  diagLog.addEntry('ROUTE_REDIRECT_START', `redirectSystemPath start initial=${initial} lifecycle=${lifecycle} path="${path.slice(0, 120)}"`);

  // ── Log the raw URI the moment we receive it ────────────────────────────
  diagLog.addEntry('SHARE_URI_RAW', `path="${path.slice(0, 200)}" initial=${initial} lifecycle="${lifecycle}"`);

  diagLog.addEntry(
    'ROUTE_TO_SHARE_SCREEN',
    `redirectSystemPath initial=${initial} lifecycle=${lifecycle} path="${path.slice(0, 120)}"`,
  );

  // ── Identify and log the route source ───────────────────────────────────
  let routeSource: string;
  if (!path) {
    routeSource = 'EMPTY_PATH';
  } else if (path === 'lumio://' || path === 'lumio:///') {
    // This is the primary failure mode: the app was launched from the widget
    // logo button OR rewriteShareIntent() silently failed (EXTRA_TEXT was null
    // or URLEncoder threw) and Android delivered the raw data-less intent URI.
    routeSource = 'WIDGET_OR_REWRITE_FAILED';
  } else if (path.startsWith(SHARE_PREFIX)) {
    // Append the extraction source from the src= param if present so the log
    // entry captures which Android fallback was actually used.
    try {
      const srcParam = new URL(path).searchParams.get('src');
      routeSource = srcParam ? `SHARE_INTENT[${srcParam}]` : 'SHARE_INTENT';
    } catch {
      routeSource = 'SHARE_INTENT';
    }
  } else {
    routeSource = 'DEEP_LINK_OR_ROUTER';
  }

  diagLog.addEntry(
    'SHARE_ROUTE_SOURCE',
    `source="${routeSource}" lifecycle="${lifecycle}" path="${path.slice(0, 120)}"`,
  );

  // ── Pass through all non-share paths unchanged ───────────────────────────
  if (!path || !path.startsWith(SHARE_PREFIX)) {
    if (path === 'lumio://' || path === 'lumio:///') {
      diagLog.addEntry(
        'SHARE_REWRITE_SKIPPED',
        `NOT a share URI — lifecycle=${lifecycle} path="${path}" (widget home tap or missing EXTRA_TEXT). No rewrite performed.`,
      );
    }
    diagLog.addEntry('ROUTE_REDIRECT_COMPLETE', `non-share passthrough result="${path.slice(0, 120)}"`);
    return path;
  }

  // ── Share URI: ingest immediately before routing ─────────────────────────
  // This is entirely synchronous to Expo Router's navigation queue since we
  // await here, fulfilling: "Only after persistence: launch UI/navigation."
  diagLog.addEntry('SHARE_URI_REWRITTEN', `ingesting path="${path.slice(0, 200)}"`);

  try {
    const { itemIds } = await ShareIngestionManager.ingest(path);
    if (itemIds.length > 1) {
      diagLog.addEntry(
        'SHARE_MULTI_URL_FOUND',
        `${itemIds.length} URLs queued: ${itemIds.join(', ').slice(0, 160)}`
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    diagLog.addEntry(
      'SAVE_FAILED',
      `Ingestion failed in redirectSystemPath: ${errMsg}`
    );
    // Persist the failure record so it can be reviewed in diagnostics and
    // the developer can see exactly what went wrong for this share attempt.
    try {
      await initDatabase();
      const db = await getDatabase();
      const { text, url: payloadUrl, title, subject, src, mime, urls: urlsParam } =
        ShareIngestionManager.extractPayload(path);
      await ShareIngestionManager._persistFailedCapture(db, {
        rawPath: path,
        extraText: text,
        extraSubject: subject,
        extraTitle: title,
        extraStream: '',
        clipDataText: '',
        clipDataUri: '',
        intentData: payloadUrl,
        mimeType: mime,
        bundleKeys: '',
        urlsParam,
        extractionSource: src,
        errorMessage: `redirectSystemPath: ${errMsg}`,
        lastEvent: 'SHARE_URI_REWRITTEN',
        lifecycleState: lifecycle,
        payloadSummary: (text || subject || title).slice(0, 200),
      });
    } catch { /* failure recording must never throw */ }
  }

  // ── Parse the synthetic URI to determine the routing path ────────────────
  const { text, url, title, subject, src } = ShareIngestionManager.extractPayload(path);
  if (src) {
    diagLog.addEntry('SHARE_EXTRACT_RESULT', `native extraction source="${src}"`);
  }

  if (!text && !title && !subject) {
    diagLog.addEntry('URL_EXTRACTED', 'empty share payload — routing to /share for manual entry');
    diagLog.addEntry('SHARE_REWRITE_SUCCESS', `result="/share" reason="empty payload"`);
    diagLog.addEntry('ROUTE_REDIRECT_COMPLETE', `empty payload result="/share"`);
    return '/share';
  }

  // Build the /share route path with query params that share.tsx reads.
  // Note: src=/mime=/urls= are diagnostic-only params consumed here; they are
  // NOT forwarded to the share screen to keep the UI params clean.
  const params = new URLSearchParams();
  if (text)    params.set('text',  text);
  if (title)   params.set('title', title);
  if (subject) params.set('subject', subject);

  const sharePath = `/share?${params.toString()}`;

  diagLog.addEntry('URL_EXTRACTED', `routed to "${sharePath.slice(0, 160)}"`);
  diagLog.addEntry('SHARE_REWRITE_SUCCESS', `result="${sharePath.slice(0, 160)}"`);
  diagLog.addEntry('ROUTE_REDIRECT_COMPLETE', `result="${sharePath.slice(0, 160)}"`);

  return sharePath;
}
