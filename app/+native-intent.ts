/**
 * +native-intent.ts — expo-router system intent interceptor
 *
 * Expo Router calls `redirectSystemPath` for every URL before routing:
 *   • On cold start (initial: true)  — called from getInitialURL()
 *   • On warm start (initial: false) — called from Linking.addEventListener('url')
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
 * This file intercepts that URI and rewrites it to the expo-router path
 * that the share screen expects:
 *
 *   /share?text=<decoded>&title=<decoded>
 *
 * Both legs (cold-start getInitialURL + warm-start Linking 'url' event)
 * pass through redirectSystemPath, so this single function covers all cases.
 */

import { diagLog } from '../src/services/diagnostics';

const SHARE_PREFIX = 'lumio://share';

/**
 * Rewrites lumio://share? URIs to /share? paths.
 * All other URLs are returned unchanged.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  diagLog.addEntry(
    'ROUTE_TO_SHARE_SCREEN',
    `redirectSystemPath initial=${initial} path="${path.slice(0, 120)}"`,
  );

  if (!path || !path.startsWith(SHARE_PREFIX)) {
    return path;
  }

  // Parse the synthetic lumio://share?... URI
  let text = '';
  let title = '';
  let subject = '';

  try {
    // Use URL constructor — works in React Native's JS runtime.
    const parsed = new URL(path);
    text    = parsed.searchParams.get('text')    ?? '';
    title   = parsed.searchParams.get('title')   ?? '';
    subject = parsed.searchParams.get('subject') ?? '';
  } catch {
    // Malformed URI — fall back to regex extraction
    const textMatch    = path.match(/[?&]text=([^&]*)/);
    const titleMatch   = path.match(/[?&]title=([^&]*)/);
    const subjectMatch = path.match(/[?&]subject=([^&]*)/);
    text    = textMatch    ? decodeURIComponent(textMatch[1])    : '';
    title   = titleMatch   ? decodeURIComponent(titleMatch[1])   : '';
    subject = subjectMatch ? decodeURIComponent(subjectMatch[1]) : '';
  }

  diagLog.addEntry('SHARE_TEXT', `text="${text.slice(0, 120)}" title="${title.slice(0, 80)}"`);

  if (!text && !title && !subject) {
    diagLog.addEntry('URL_EXTRACTED', 'empty share payload — routing to /share for manual entry');
    return '/share';
  }

  // Build the /share route path with query params that share.tsx reads.
  // The text field may itself be a URL (e.g. an Instagram share) or
  // plain text with an embedded URL — share.tsx resolves this.
  const params = new URLSearchParams();
  if (text)    params.set('text',  text);
  if (title)   params.set('title', title);
  if (subject) params.set('subject', subject);

  const sharePath = `/share?${params.toString()}`;

  diagLog.addEntry('URL_EXTRACTED', `routed to "${sharePath.slice(0, 160)}"`);

  return sharePath;
}
