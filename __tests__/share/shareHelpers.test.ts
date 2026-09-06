/**
 * Unit tests for app/share.tsx — pure helper functions
 *
 * Tests extractUrlFromText, guessContentType, and isDuplicate —
 * the three functions that run on every Android share intent before
 * a queue item is created.  All must be deterministic.
 *
 * These helpers are exported only for testing via the _testOnly namespace.
 */

// share.tsx imports many React Native / Expo modules; mock the ones that
// cause resolution failures in the Jest (Node) environment.
// Paths are module IDs (not relative) so Jest resolves them from the project root.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));
jest.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => ({ colors: {} }),
}));
jest.mock('../../src/constants/colors', () => ({
  useAppTheme: () => ({ colors: {} }),
}));
jest.mock('../../src/context/DataContext', () => ({
  useData: () => ({ collections: [], refreshAll: jest.fn() }),
}));
jest.mock('../../src/context/CaptureQueueContext', () => ({
  useCaptureQueue: () => ({ enqueue: jest.fn() }),
}));
jest.mock('../../src/services/diagnostics', () => ({
  diagLog: { addEntry: jest.fn() },
}));
jest.mock('../../src/services/ai', () => ({}));
jest.mock('../../src/services/settings', () => ({
  getAISettings: jest.fn(),
}));
jest.mock('../../src/utils/errors', () => ({
  logError: jest.fn(),
  getUserMessage: jest.fn(() => 'Error'),
}));

import { _testOnly } from '../../app/share';

const { extractUrlFromText, guessContentType, isDuplicate, DEDUP_TTL_MS, _capturedUrls } = _testOnly;

// Clear the dedup map before each test so tests are isolated.
beforeEach(() => {
  _capturedUrls.clear();
});

// ─── extractUrlFromText ───────────────────────────────────────────────────────

describe('extractUrlFromText', () => {
  // Instagram — share text is typically: "<title>\n<url>\n..."
  it('extracts URL from Instagram Reel share text', () => {
    const text = 'Check out this reel!\nhttps://www.instagram.com/reel/C_testId/\n#reels';
    expect(extractUrlFromText(text)).toBe('https://www.instagram.com/reel/C_testId/');
  });

  it('extracts URL from Instagram Post share text', () => {
    const text = 'Look at this post\nhttps://www.instagram.com/p/C_postId456/\nvia Instagram';
    expect(extractUrlFromText(text)).toBe('https://www.instagram.com/p/C_postId456/');
  });

  // YouTube — share text is the plain URL or "Title\nhttps://youtu.be/..."
  it('extracts YouTube video URL', () => {
    const text = 'Never Gonna Give You Up\nhttps://youtu.be/dQw4w9WgXcQ';
    expect(extractUrlFromText(text)).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('extracts YouTube short URL', () => {
    const text = 'Funny clip https://youtube.com/shorts/abc123XYZ end';
    expect(extractUrlFromText(text)).toBe('https://youtube.com/shorts/abc123XYZ');
  });

  it('extracts full youtube.com/watch URL', () => {
    const text = 'Watch: https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(extractUrlFromText(text)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // X / Twitter
  it('extracts X/Twitter tweet URL', () => {
    const text = 'Interesting thread https://x.com/user/status/1234567890 worth reading';
    expect(extractUrlFromText(text)).toBe('https://x.com/user/status/1234567890');
  });

  it('extracts twitter.com URL', () => {
    const text = 'Look at https://twitter.com/user/status/9876543210 today';
    expect(extractUrlFromText(text)).toBe('https://twitter.com/user/status/9876543210');
  });

  // LinkedIn
  it('extracts LinkedIn post URL', () => {
    const text = 'Great article!\nhttps://www.linkedin.com/posts/user_keyword-12345678901234567890-abcd/';
    expect(extractUrlFromText(text)).toBe(
      'https://www.linkedin.com/posts/user_keyword-12345678901234567890-abcd/'
    );
  });

  // Generic URL extraction edge cases
  it('strips trailing punctuation from extracted URL', () => {
    expect(extractUrlFromText('See https://example.com/path.')).toBe('https://example.com/path');
    expect(extractUrlFromText('See https://example.com/path)')).toBe('https://example.com/path');
    expect(extractUrlFromText('See https://example.com/path>')).toBe('https://example.com/path');
  });

  it('returns empty string when no URL present', () => {
    expect(extractUrlFromText('just plain text, no link here')).toBe('');
    expect(extractUrlFromText('')).toBe('');
  });

  it('returns first URL when multiple URLs present', () => {
    const text = 'https://first.com/a and https://second.com/b';
    expect(extractUrlFromText(text)).toBe('https://first.com/a');
  });

  it('handles http:// URLs (not only https)', () => {
    expect(extractUrlFromText('See http://example.com/page')).toBe('http://example.com/page');
  });

  it('is stable: same input always produces same output', () => {
    const text = 'Link: https://instagram.com/reel/test123/ #share';
    expect(extractUrlFromText(text)).toBe(extractUrlFromText(text));
  });
});

// ─── guessContentType ─────────────────────────────────────────────────────────

describe('guessContentType', () => {
  it('detects YouTube as video', () => {
    expect(guessContentType('https://youtube.com/watch?v=abc', '')).toBe('video');
    expect(guessContentType('https://youtu.be/abc', '')).toBe('video');
    expect(guessContentType('https://vimeo.com/123456', '')).toBe('video');
  });

  it('detects YouTube Shorts as video', () => {
    expect(guessContentType('https://youtube.com/shorts/abc', '')).toBe('video');
  });

  it('detects recipe content', () => {
    expect(guessContentType('https://food52.com/recipes/pasta', 'easy pasta recipe')).toBe('recipe');
  });

  it('detects book from Amazon context', () => {
    expect(guessContentType('https://amazon.com/dp/123', 'this book is great')).toBe('book');
  });

  it('detects movie content', () => {
    expect(guessContentType('https://imdb.com/title/tt123', '')).toBe('movie');
    expect(guessContentType('https://netflix.com/watch/123', '')).toBe('movie');
  });

  it('detects restaurant content', () => {
    expect(guessContentType('https://yelp.com/biz/place', '')).toBe('restaurant');
  });

  it('detects place/maps content', () => {
    expect(guessContentType('https://maps.google.com/maps?q=place', '')).toBe('place');
  });

  it('detects tool from GitHub URL', () => {
    expect(guessContentType('https://github.com/user/repo', '')).toBe('tool');
    expect(guessContentType('https://npmjs.com/package/react', '')).toBe('tool');
  });

  it('returns link for generic https URL', () => {
    expect(guessContentType('https://example.com/article', '')).toBe('link');
  });

  it('returns idea for non-URL text', () => {
    expect(guessContentType('', 'some random text without a link')).toBe('idea');
  });

  it('Instagram is classified as link (not overridden)', () => {
    // Instagram has no special content type — it stays as 'link'
    expect(guessContentType('https://instagram.com/reel/abc', '')).toBe('link');
  });

  it('X/Twitter is classified as link', () => {
    expect(guessContentType('https://x.com/user/status/123', '')).toBe('link');
  });
});

// ─── isDuplicate ──────────────────────────────────────────────────────────────

describe('isDuplicate', () => {
  it('returns false for a freshly seen URL', () => {
    const url = 'https://example.com/fresh-url';
    expect(isDuplicate(url)).toBe(false);
  });

  it('returns true for the same URL called twice within TTL', () => {
    const url = 'https://example.com/same-url';
    isDuplicate(url); // first call — registers it
    expect(isDuplicate(url)).toBe(true); // second call within TTL
  });

  it('returns false for two different URLs', () => {
    expect(isDuplicate('https://example.com/url-a')).toBe(false);
    expect(isDuplicate('https://example.com/url-b')).toBe(false);
  });

  it('returns false for the same URL after TTL expires', () => {
    jest.useFakeTimers();

    const url = 'https://example.com/ttl-test';
    isDuplicate(url); // registers it

    // Advance time past DEDUP_TTL_MS
    jest.advanceTimersByTime(DEDUP_TTL_MS + 1);

    expect(isDuplicate(url)).toBe(false); // evicted — not a duplicate

    jest.useRealTimers();
  });

  it('handles rapid shares of 5 different URLs (all accepted)', () => {
    const urls = [
      'https://instagram.com/reel/a1',
      'https://instagram.com/p/b2',
      'https://youtube.com/watch?v=c3',
      'https://youtube.com/shorts/d4',
      'https://x.com/user/status/e5',
    ];
    for (const url of urls) {
      expect(isDuplicate(url)).toBe(false);
    }
  });

  it('blocks second share of the same Instagram Reel within TTL', () => {
    const url = 'https://instagram.com/reel/testReelId';
    expect(isDuplicate(url)).toBe(false);
    expect(isDuplicate(url)).toBe(true);
  });

  it('DEDUP_TTL_MS is 5000 ms', () => {
    expect(DEDUP_TTL_MS).toBe(5_000);
  });
});
