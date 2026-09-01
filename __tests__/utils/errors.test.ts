/**
 * Unit tests for src/utils/errors.ts
 */
import { logError, getUserMessage } from '../../src/utils/errors';

describe('logError', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not throw when called with an Error', () => {
    expect(() => logError(new Error('test error'))).not.toThrow();
  });

  it('does not throw when called with a string', () => {
    expect(() => logError('something went wrong')).not.toThrow();
  });

  it('does not throw when called with null/undefined', () => {
    expect(() => logError(null)).not.toThrow();
    expect(() => logError(undefined)).not.toThrow();
  });

  it('does not throw when the logger itself throws', () => {
    // Should be resilient even if console.error is broken
    jest.spyOn(console, 'error').mockImplementation(() => { throw new Error('logger broken'); });
    expect(() => logError(new Error('test'))).not.toThrow();
  });
});

describe('getUserMessage', () => {
  it('returns a network error message for fetch errors', () => {
    const msg = getUserMessage(new Error('network request failed'));
    expect(msg.toLowerCase()).toContain('network');
  });

  it('returns an API key message for 401 errors', () => {
    const msg = getUserMessage(new Error('API error (401): Unauthorized'));
    expect(msg.toLowerCase()).toMatch(/api key|permission/i);
  });

  it('returns a rate limit message for 429 errors', () => {
    const msg = getUserMessage(new Error('API error (429): Too Many Requests'));
    expect(msg.toLowerCase()).toContain('rate limit');
  });

  it('returns a service unavailable message for 503 errors', () => {
    const msg = getUserMessage(new Error('API error (503): Service Unavailable'));
    expect(msg.toLowerCase()).toContain('unavailable');
  });

  it('returns a generic message for unknown errors', () => {
    const msg = getUserMessage(new Error('something completely unknown'));
    expect(msg.length).toBeGreaterThan(0);
    // Should not expose raw error details
    expect(msg).not.toContain('something completely unknown');
  });

  it('handles non-Error values', () => {
    const msg = getUserMessage('string error');
    expect(msg.length).toBeGreaterThan(0);
  });
});
