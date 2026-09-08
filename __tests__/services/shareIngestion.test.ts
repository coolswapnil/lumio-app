import { ShareIngestionManager } from '../../src/services/shareIngestion';
import { getDatabase, initDatabase } from '../../src/database/db';
import { enqueueCapture } from '../../src/services/captureQueue';
import { diagLog } from '../../src/services/diagnostics';

// Mock DB module
jest.mock('../../src/database/db', () => {
  const mockDb = {
    runAsync: jest.fn().mockResolvedValue({}),
    getAllAsync: jest.fn().mockResolvedValue([]),
  };
  return {
    getDatabase: jest.fn().mockResolvedValue(mockDb),
    initDatabase: jest.fn().mockResolvedValue(undefined),
  };
});

// Mock CaptureQueue module
jest.mock('../../src/services/captureQueue', () => ({
  enqueueCapture: jest.fn().mockResolvedValue('mock-item-id-123'),
}));

// Mock Diagnostics module
jest.mock('../../src/services/diagnostics', () => ({
  diagLog: {
    addEntry: jest.fn(),
  },
}));

// Mock serviceReadiness — all services are considered ready immediately in tests.
jest.mock('../../src/services/serviceReadiness', () => ({
  waitForServicesReady: jest.fn().mockResolvedValue(undefined),
  getReadinessSnapshot: jest.fn().mockReturnValue({ database: true, dataProvider: true, captureQueue: true }),
  signalDatabaseInitialized: jest.fn(),
  signalDataProviderReady: jest.fn(),
  signalCaptureQueueReady: jest.fn(),
}));

describe('ShareIngestionManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── extractPayload ──────────────────────────────────────────────────────────

  describe('extractPayload', () => {
    it('extracts text, title, subject from a standard synthetic URI', () => {
      const path = 'lumio://share?text=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3D123&title=YouTube+Video&subject=Subject';
      const payload = ShareIngestionManager.extractPayload(path);
      expect(payload.text).toBe('https://youtube.com/watch?v=123');
      expect(payload.title).toBe('YouTube Video');
      expect(payload.subject).toBe('Subject');
      expect(payload.url).toBe('');
      expect(payload.urls).toBe('');
      expect(payload.src).toBe('');
      expect(payload.mime).toBe('');
    });

    it('extracts the new urls= and src= and mime= params', () => {
      const text    = encodeURIComponent('Check this out https://instagram.com/reel/abc123/');
      const urls    = encodeURIComponent('https://instagram.com/reel/abc123/');
      const src     = encodeURIComponent('CLIP_DATA_TEXT[0]');
      const mime    = encodeURIComponent('image/jpeg');
      const path    = `lumio://share?text=${text}&urls=${urls}&src=${src}&mime=${mime}`;
      const payload = ShareIngestionManager.extractPayload(path);
      expect(payload.urls).toBe('https://instagram.com/reel/abc123/');
      expect(payload.src).toBe('CLIP_DATA_TEXT[0]');
      expect(payload.mime).toBe('image/jpeg');
    });

    it('falls back to regex extraction for malformed synthetic URLs', () => {
      const path = 'lumio://share?text=https%3A%2F%2Fyoutube.com&title=Some%20Title';
      const payload = ShareIngestionManager.extractPayload(path);
      expect(payload.text).toBe('https://youtube.com');
      expect(payload.title).toBe('Some Title');
    });

    it('extracts pipe-delimited multi-URL urls= param', () => {
      const urls = encodeURIComponent('https://youtube.com/watch?v=aaa|https://youtube.com/watch?v=bbb');
      const path = `lumio://share?text=two+videos&urls=${urls}`;
      const payload = ShareIngestionManager.extractPayload(path);
      expect(payload.urls).toBe('https://youtube.com/watch?v=aaa|https://youtube.com/watch?v=bbb');
    });
  });

  // ── collectUrls ─────────────────────────────────────────────────────────────

  describe('collectUrls', () => {
    it('returns URL directly from urlsParam', () => {
      const result = ShareIngestionManager.collectUrls({
        text: '', url: '', subject: '',
        urlsParam: 'https://instagram.com/reel/abc/',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('instagram.com');
    });

    it('extracts URL from text via regex when urlsParam is empty', () => {
      const result = ShareIngestionManager.collectUrls({
        text: 'Check this out https://youtu.be/abc123 on YouTube!',
        url: '', subject: '', urlsParam: '',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('youtu.be/abc123');
    });

    it('deduplicates URLs that appear in multiple sources', () => {
      const url = 'https://x.com/user/status/123';
      const result = ShareIngestionManager.collectUrls({
        text:      `Tweet: ${url}`,
        url:       url,
        subject:   url,
        urlsParam: url,
      });
      expect(result).toHaveLength(1);
    });

    it('extracts multiple distinct URLs from urlsParam', () => {
      const result = ShareIngestionManager.collectUrls({
        text: '', url: '', subject: '',
        urlsParam: 'https://youtube.com/watch?v=aaa|https://youtube.com/watch?v=bbb',
      });
      expect(result).toHaveLength(2);
    });

    it('extracts multiple URLs from text with regex', () => {
      const result = ShareIngestionManager.collectUrls({
        text: 'Watch https://youtu.be/aaa and https://youtu.be/bbb',
        url: '', subject: '', urlsParam: '',
      });
      expect(result).toHaveLength(2);
    });

    it('uses legacy url= param as a source', () => {
      const result = ShareIngestionManager.collectUrls({
        text: '', url: 'https://linkedin.com/posts/abc', subject: '', urlsParam: '',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('linkedin.com');
    });

    it('extracts URL from subject when text is empty', () => {
      const result = ShareIngestionManager.collectUrls({
        text: '', url: '', urlsParam: '',
        subject: 'https://linkedin.com/posts/abc123',
      });
      expect(result).toHaveLength(1);
    });

    it('returns empty array when no URL is present anywhere', () => {
      const result = ShareIngestionManager.collectUrls({
        text: 'Just a plain note with no URL', url: '', subject: '', urlsParam: '',
      });
      expect(result).toHaveLength(0);
    });

    it('strips trailing punctuation from extracted URLs', () => {
      const result = ShareIngestionManager.collectUrls({
        text: 'See https://example.com/page.',
        url: '', subject: '', urlsParam: '',
      });
      // URL should not end with '.'
      expect(result[0]).not.toMatch(/\.$/);
    });
  });

  // ── ingest ──────────────────────────────────────────────────────────────────

  describe('ingest', () => {
    it('persists raw path and enqueues one item for a single URL share', async () => {
      const path = 'lumio://share?text=https%3A%2F%2Fgoogle.com&title=Google';
      const db = await getDatabase();

      const result = await ShareIngestionManager.ingest(path);

      expect(initDatabase).toHaveBeenCalled();
      // Step 1: raw persist
      expect(db.runAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pending_shares'),
        expect.arrayContaining(['https://google.com', 'Google'])
      );
      expect(diagLog.addEntry).toHaveBeenCalledWith(
        'PENDING_SHARE_RAW_CAPTURED',
        expect.any(String)
      );
      expect(diagLog.addEntry).toHaveBeenCalledWith(
        'SHARE_PAYLOAD_PERSISTED',
        expect.stringContaining('urlCount=1')
      );
      // Step 3: queue item created
      expect(enqueueCapture).toHaveBeenCalledWith('https://google.com', { titleHint: 'Google' });
      expect(diagLog.addEntry).toHaveBeenCalledWith(
        'QUEUE_ITEM_CREATED',
        expect.stringContaining('https://google.com')
      );
      expect(db.runAsync).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE pending_shares SET status = 'processed'"),
        expect.any(Array)
      );
      expect(result.itemIds).toEqual(['mock-item-id-123']);
      expect(result.wasProcessed).toBe(true);
    });

    it('enqueues one item per URL for a multi-URL share', async () => {
      const urls = encodeURIComponent('https://youtube.com/watch?v=aaa|https://youtube.com/watch?v=bbb');
      const path = `lumio://share?text=two+videos&urls=${urls}`;

      // Increment mock item IDs so we can verify two separate calls
      (enqueueCapture as jest.Mock)
        .mockResolvedValueOnce('item-id-1')
        .mockResolvedValueOnce('item-id-2');

      const result = await ShareIngestionManager.ingest(path);

      expect(enqueueCapture).toHaveBeenCalledTimes(2);
      expect(result.itemIds).toEqual(['item-id-1', 'item-id-2']);
      expect(result.wasProcessed).toBe(true);
    });

    it('returns wasProcessed=false and logs SHARE_NO_URL_FOUND when no URL is found', async () => {
      const path = 'lumio://share?text=Just%20some%20ideas%20without%20URL';
      const db = await getDatabase();

      const result = await ShareIngestionManager.ingest(path);

      // Step 1 INSERT must still have happened (failsafe)
      expect(db.runAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pending_shares'),
        expect.any(Array)
      );
      expect(diagLog.addEntry).toHaveBeenCalledWith(
        'SHARE_NO_URL_FOUND',
        expect.stringContaining('no http(s) URL found')
      );
      expect(enqueueCapture).not.toHaveBeenCalled();
      expect(result.itemIds).toEqual([]);
      expect(result.wasProcessed).toBe(false);
    });

    it('persists raw path even when all params are empty', async () => {
      // Simulate a lumio:/// (empty payload) reaching ingest
      const path = 'lumio://share?text=&title=&subject=&urls=';
      const result = await ShareIngestionManager.ingest(path);

      expect(diagLog.addEntry).toHaveBeenCalledWith(
        'SHARE_NO_URL_FOUND',
        expect.stringContaining('all params empty')
      );
      expect(result.itemIds).toEqual([]);
      expect(result.wasProcessed).toBe(false);
    });
  });

  // ── recoverPendingShares ────────────────────────────────────────────────────

  describe('recoverPendingShares', () => {
    it('recovers pending items and enqueues them successfully', async () => {
      const db = await getDatabase();
      const mockPendingShares = [
        {
          id: 'ps-1',
          text: 'https://twitter.com/status/1',
          url: '',
          title: 'Tweet',
          subject: '',
          raw_path: null,
          status: 'pending',
        },
      ];
      (db.getAllAsync as jest.Mock).mockResolvedValueOnce(mockPendingShares);

      await ShareIngestionManager.recoverPendingShares();

      expect(initDatabase).toHaveBeenCalled();
      expect(db.getAllAsync).toHaveBeenCalledWith(expect.stringContaining("status = 'pending'"));
      expect(diagLog.addEntry).toHaveBeenCalledWith(
        'PENDING_SHARE_FOUND',
        expect.stringContaining('Found 1 pending shares')
      );
      expect(enqueueCapture).toHaveBeenCalledWith('https://twitter.com/status/1', { titleHint: 'Tweet' });
      expect(db.runAsync).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE pending_shares SET status = 'processed' WHERE id = ?"),
        ['ps-1']
      );
      expect(diagLog.addEntry).toHaveBeenCalledWith(
        'PENDING_SHARE_PROCESSED',
        expect.stringContaining('Recovered and enqueued share id=ps-1')
      );
    });

    it('re-parses urls= from raw_path during recovery', async () => {
      const db = await getDatabase();
      const encodedUrls = encodeURIComponent('https://instagram.com/reel/abc/');
      const mockPendingShares = [
        {
          id: 'ps-2',
          text: '',
          url: '',
          title: '',
          subject: '',
          raw_path: `lumio://share?text=&urls=${encodedUrls}`,
          status: 'pending',
        },
      ];
      (db.getAllAsync as jest.Mock).mockResolvedValueOnce(mockPendingShares);

      await ShareIngestionManager.recoverPendingShares();

      expect(enqueueCapture).toHaveBeenCalledWith('https://instagram.com/reel/abc/', expect.any(Object));
    });
  });
});
