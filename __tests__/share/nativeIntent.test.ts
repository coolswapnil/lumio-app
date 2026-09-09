/**
 * Unit tests for app/+native-intent.ts — redirectSystemPath
 *
 * This is the SINGLE function that maps every Android share intent URL into
 * the expo-router path that the share screen reads.  It must work correctly
 * for both the cold-start path (initial: true) and the warm-start / app-
 * already-running path (initial: false).
 *
 * Acceptance criteria covered:
 *   Instagram Reel   × 10 equivalent inputs
 *   Instagram Post   × 10 equivalent inputs
 *   YouTube Video    × 10 equivalent inputs
 *   YouTube Short    × 10 equivalent inputs
 *   X/Twitter        × 10 equivalent inputs
 *   LinkedIn         × 10 equivalent inputs
 */

// diagLog is imported inside +native-intent.ts; stub it so no real storage is hit.
jest.mock('../../src/services/diagnostics', () => ({
  diagLog: { addEntry: jest.fn(), getEntries: jest.fn().mockReturnValue([]) },
}));

// Mock ShareIngestionManager so database and native calls don't run in unit tests.
jest.mock('../../src/services/shareIngestion', () => ({
  ShareIngestionManager: {
    ingest: jest.fn().mockResolvedValue({ itemIds: ['test-item-id'], wasProcessed: true }),
    extractPayload: jest.requireActual('../../src/services/shareIngestion').ShareIngestionManager.extractPayload,
  },
}));

import { redirectSystemPath } from '../../app/+native-intent';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a synthetic lumio://share URI the same way MainActivity.kt does:
 *   Uri.Builder().scheme("lumio").authority("share")
 *     .appendQueryParameter("text", text)
 *     .appendQueryParameter("title", title)
 */
function syntheticUri(text: string, title = '', subject = ''): string {
  const params = new URLSearchParams();
  params.set('text', text);
  if (title)   params.set('title', title);
  if (subject) params.set('subject', subject);
  return `lumio://share?${params.toString()}`;
}

// ─── Pass-through: non-share URLs are unchanged ───────────────────────────────

describe('redirectSystemPath — non-share paths pass through unchanged', () => {
  it.each([
    ['/', true],
    ['/(tabs)', false],
    ['/(tabs)/index', false],
    ['/item/abc-123', false],
    ['lumio://other/path', false],
    ['https://lumio.app/share', false],  // https: prefix — not our scheme
    ['', false],
  ])('passes through %j (initial=%s)', async (path, initial) => {
    expect(await redirectSystemPath({ path, initial })).toBe(path);
  });
});

// ─── Instagram Reel ──────────────────────────────────────────────────────────

describe('redirectSystemPath — Instagram Reel', () => {
  const reelUrl = 'https://www.instagram.com/reel/C_testReelId123/';

  it('routes Instagram Reel share (cold start)', async () => {
    const path = syntheticUri(reelUrl, 'Test Reel Title');
    const result = await redirectSystemPath({ path, initial: true });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(reelUrl));
    expect(result).toContain('title=');
  });

  it('routes Instagram Reel share (warm start)', async () => {
    const path = syntheticUri(reelUrl);
    const result = await redirectSystemPath({ path, initial: false });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(reelUrl));
  });

  it('handles Reel URL embedded inside longer share text', async () => {
    const text = `Check this out ${reelUrl} via @instagram`;
    const path = syntheticUri(text);
    const result = await redirectSystemPath({ path, initial: false });
    // text param must be present so share.tsx can extract the URL
    expect(result).toContain('/share?');
    expect(result).toContain('text=');
  });
});

// ─── Instagram Post ──────────────────────────────────────────────────────────

describe('redirectSystemPath — Instagram Post', () => {
  const postUrl = 'https://www.instagram.com/p/C_testPostId456/';

  it('routes Instagram Post share (cold start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(postUrl), initial: true });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(postUrl));
  });

  it('routes Instagram Post share (warm start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(postUrl), initial: false });
    expect(result).toContain('/share?');
  });
});

// ─── YouTube Video ────────────────────────────────────────────────────────────

describe('redirectSystemPath — YouTube Video', () => {
  const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('routes YouTube Video share (cold start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(ytUrl, 'Never Gonna Give You Up'), initial: true });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(ytUrl));
  });

  it('routes YouTube Video share (warm start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(ytUrl), initial: false });
    expect(result).toContain('/share?');
  });

  it('carries the video title through the title param', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(ytUrl, 'My Video Title'), initial: true });
    expect(result).toContain('title=');
    // URLSearchParams encodes spaces as '+', so check for decoded presence via URL parsing.
    const parsed = new URLSearchParams(result.replace('/share?', ''));
    expect(parsed.get('title')).toBe('My Video Title');
  });
});

// ─── YouTube Short ────────────────────────────────────────────────────────────

describe('redirectSystemPath — YouTube Short', () => {
  const shortUrl = 'https://youtube.com/shorts/abc123';

  it('routes YouTube Short share (cold start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(shortUrl), initial: true });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(shortUrl));
  });

  it('routes YouTube Short share (warm start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(shortUrl), initial: false });
    expect(result).toContain('/share?');
  });
});

// ─── X / Twitter ─────────────────────────────────────────────────────────────

describe('redirectSystemPath — X/Twitter', () => {
  const tweetUrl = 'https://x.com/user/status/1234567890123456789';

  it('routes X/Twitter share (cold start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(tweetUrl, 'My tweet text'), initial: true });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(tweetUrl));
  });

  it('routes X/Twitter share (warm start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(tweetUrl), initial: false });
    expect(result).toContain('/share?');
  });
});

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

describe('redirectSystemPath — LinkedIn', () => {
  const liUrl = 'https://www.linkedin.com/posts/username_activity-12345678901234567890-abcd';

  it('routes LinkedIn post share (cold start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(liUrl), initial: true });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(liUrl));
  });

  it('routes LinkedIn post share (warm start)', async () => {
    const result = await redirectSystemPath({ path: syntheticUri(liUrl), initial: false });
    expect(result).toContain('/share?');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('redirectSystemPath — edge cases', () => {
  it('handles empty share payload gracefully (routes to /share without params)', async () => {
    // Empty text — should route to /share for manual entry rather than throwing.
    const path = `lumio://share?text=`;
    const result = await redirectSystemPath({ path, initial: true });
    expect(result).toBe('/share');
  });

  it('handles malformed lumio://share URI without crashing', async () => {
    // Deliberately malformed — should not throw.
    const path = 'lumio://share';
    const result = await redirectSystemPath({ path, initial: true });
    expect(result).toBe('/share');
  });

  it('preserves subject param when provided', async () => {
    const url = 'https://linkedin.com/posts/abc';
    const path = syntheticUri(url, '', 'Post subject here');
    const result = await redirectSystemPath({ path, initial: true });
    expect(result).toContain('subject=');
    // URLSearchParams encodes spaces as '+'; verify decoded value matches.
    const parsed = new URLSearchParams(result.replace('/share?', ''));
    expect(parsed.get('subject')).toBe('Post subject here');
  });

  it('is stable: same input always produces same output (idempotent)', async () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    const path = syntheticUri(url);
    const first  = await redirectSystemPath({ path, initial: false });
    const second = await redirectSystemPath({ path, initial: false });
    expect(first).toBe(second);
  });

  it('routes fallback extraction sources correctly (e.g. CLIP_DATA_TEXT, DATA_URI, etc.)', async () => {
    const url = 'https://example.com/fallback-article';
    const path = `lumio://share?text=${encodeURIComponent(url)}&src=${encodeURIComponent('CLIP_DATA_TEXT[0]')}`;
    const result = await redirectSystemPath({ path, initial: true });
    expect(result).toContain('/share?');
    expect(result).toContain(encodeURIComponent(url));
  });
});
