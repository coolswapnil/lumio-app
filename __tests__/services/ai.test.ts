/**
 * Unit tests for AI service — tests provider routing, error handling,
 * JSON response parsing, and the Gemini key-in-header fix.
 *
 * All fetch calls are mocked to avoid real network requests.
 */

// Mock fetch globally before importing the module
global.fetch = jest.fn();

import { summarizeItem } from '../../src/services/ai';
import type { AISettings } from '../../src/types';

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

const baseSettings: AISettings = {
  provider: 'openai',
  apiKey: 'test-key-openai',
  model: 'gpt-4o-mini',
};

/** Creates a mock Response with JSON body */
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── OpenAI provider ─────────────────────────────────────────────────────────
describe('summarizeItem — OpenAI provider', () => {
  it('returns parsed summary from JSON response', async () => {
    const responseBody = {
      summary: 'A great article',
      suggestedTags: ['tech', 'ai'],
      suggestedTitle: 'Tech Article',
    };
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        choices: [{ message: { content: JSON.stringify(responseBody) } }],
      })
    );

    const result = await summarizeItem(baseSettings, 'My Article', 'https://example.com');
    expect(result.summary).toBe('A great article');
    expect(result.suggestedTags).toEqual(['tech', 'ai']);
    expect(result.suggestedTitle).toBe('Tech Article');
  });

  it('sends Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ choices: [{ message: { content: '{"summary":"s","suggestedTags":[]}' } }] })
    );
    await summarizeItem(baseSettings, 'Title');
    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('api.openai.com');
    const headers = options?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key-openai');
  });

  it('does not use non-JSON AI text as a description', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ choices: [{ message: { content: 'plain text summary' } }] })
    );
    const result = await summarizeItem(baseSettings, 'Title');
    expect(result.summary).toBe('');
    expect(result.suggestedTags).toEqual([]);
  });

  it('filters URL-access refusal text from the summary', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        choices: [{ message: { content: '{"summary":"I cannot access that URL.","suggestedTags":[]}' } }],
      })
    );
    const result = await summarizeItem(baseSettings, 'Title');
    expect(result.summary).toBe('');
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Unauthorized' }, 401));
    await expect(summarizeItem(baseSettings, 'Title')).rejects.toThrow('401');
  });
});

// ─── Gemini provider — key must NOT be in URL ─────────────────────────────────
describe('summarizeItem — Gemini provider (CRIT-001 fix)', () => {
  const geminiSettings: AISettings = {
    provider: 'gemini',
    apiKey: 'AIza-test-gemini-key',
    model: 'gemini-2.0-flash',
  };

  it('does NOT put the API key in the URL query string', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        candidates: [{ content: { parts: [{ text: '{"summary":"s","suggestedTags":[]}' }] } }],
      })
    );
    await summarizeItem(geminiSettings, 'Title');
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).not.toContain('AIza-test-gemini-key');
    expect(String(url)).not.toContain('key=');
  });

  it('sends API key in x-goog-api-key header', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        candidates: [{ content: { parts: [{ text: '{"summary":"s","suggestedTags":[]}' }] } }],
      })
    );
    await summarizeItem(geminiSettings, 'Title');
    const [, options] = mockFetch.mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('AIza-test-gemini-key');
  });
});

// ─── Anthropic provider ───────────────────────────────────────────────────────
describe('summarizeItem — Anthropic provider', () => {
  const anthropicSettings: AISettings = {
    provider: 'anthropic',
    apiKey: 'ant-test-key',
    model: 'claude-3-haiku-20240307',
  };

  it('sends x-api-key header', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ content: [{ text: '{"summary":"s","suggestedTags":[]}' }] })
    );
    await summarizeItem(anthropicSettings, 'Title');
    const [, options] = mockFetch.mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('ant-test-key');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'bad_request' }, 400));
    await expect(summarizeItem(anthropicSettings, 'Title')).rejects.toThrow('400');
  });
});

// ─── Unknown provider ─────────────────────────────────────────────────────────
describe('summarizeItem — unknown provider', () => {
  it('throws for unsupported provider', async () => {
    const badSettings = { ...baseSettings, provider: 'unknown-provider' as AISettings['provider'] };
    await expect(summarizeItem(badSettings, 'Title')).rejects.toThrow('Unknown AI provider');
  });
});
