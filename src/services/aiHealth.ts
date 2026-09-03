/**
 * AI Health Monitoring Service
 *
 * Responsibilities:
 *  - testConnection()    — probe the configured endpoint and classify the result
 *  - classifyError()     — turn raw HTTP / network errors into user-friendly status
 *  - extractQuota()      — pull quota headers from OpenAI-compatible responses
 *  - extractRateLimit()  — detect 429 and parse Retry-After
 *  - load/save health    — persist the last known status via SecureStore
 *
 * IMPORTANT: this module NEVER exposes raw error messages to the UI layer.
 * All public functions return structured data with human-readable strings only.
 */

import * as SecureStore from 'expo-secure-store';
import type {
  AISettings,
  AIHealthStatus,
  AIConnectionStatus,
  AIQuotaInfo,
  AIRateLimitInfo,
} from '../types';

// ─── Storage key ──────────────────────────────────────────────────────────────

const HEALTH_KEY = 'lumio_ai_health_v1';

// ─── Local endpoint defaults (mirrors ai.ts resolveLocalBaseUrl) ───────────

function getBaseUrl(settings: AISettings): string {
  if (settings.provider !== 'local') return '';
  if (settings.localBaseUrl?.trim()) return settings.localBaseUrl.trim().replace(/\/$/, '');
  switch (settings.localSource) {
    case 'lmstudio':          return 'http://localhost:1234/v1';
    case 'llamacpp':          return 'http://localhost:8080/v1';
    case 'openai-compatible': return 'http://localhost:8080/v1';
    case 'gguf':              return 'http://localhost:8080/v1';
    default:                  return 'http://localhost:11434/v1';
  }
}

// ─── Quota header extraction ───────────────────────────────────────────────

/**
 * OpenAI returns these headers on every response:
 *   x-ratelimit-remaining-requests
 *   x-ratelimit-remaining-tokens
 *   x-ratelimit-limit-requests   (daily / per-minute depending on tier)
 *   x-ratelimit-limit-tokens
 */
function extractQuota(headers: Headers): AIQuotaInfo | undefined {
  const rr   = headers.get('x-ratelimit-remaining-requests');
  const rt   = headers.get('x-ratelimit-remaining-tokens');
  const lr   = headers.get('x-ratelimit-limit-requests');
  const lt   = headers.get('x-ratelimit-limit-tokens');

  if (!rr && !rt && !lr && !lt) return undefined;

  const parse = (v: string | null) => (v ? parseInt(v, 10) || undefined : undefined);
  return {
    requestsRemaining: parse(rr),
    tokensRemaining:   parse(rt),
    dailyLimit:        parse(lr),
    monthlyLimit:      undefined, // not exposed in standard headers
  };
}

// ─── Rate-limit extraction ─────────────────────────────────────────────────

function extractRateLimit(headers: Headers): AIRateLimitInfo {
  const retryAfter = headers.get('retry-after') ?? headers.get('x-ratelimit-reset-requests');
  // Retry-After may be a delta-seconds integer or an HTTP-date
  let retrySeconds = 60; // safe fallback
  if (retryAfter) {
    const parsed = parseInt(retryAfter, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      retrySeconds = parsed;
    } else {
      // Try HTTP-date
      const resetDate = new Date(retryAfter).getTime();
      if (!isNaN(resetDate)) {
        retrySeconds = Math.max(0, Math.round((resetDate - Date.now()) / 1000));
      }
    }
  }
  return { retryAfterSeconds: retrySeconds, detectedAt: new Date().toISOString() };
}

// ─── User-friendly error classification ───────────────────────────────────

export interface ClassifiedError {
  status: AIConnectionStatus;
  message: string;        // shown to user
  rateLimit?: AIRateLimitInfo;
  quota?: AIQuotaInfo;    // populated on 429 if headers available
}

export function classifyHttpError(
  statusCode: number,
  headers: Headers,
): ClassifiedError {
  switch (statusCode) {
    case 401:
    case 403:
      return {
        status: 'offline',
        message: 'Authentication failed. Check your API key.',
      };
    case 429: {
      const rateLimit = extractRateLimit(headers);
      const quota     = extractQuota(headers);
      const isQuota   = headers.get('x-ratelimit-type') === 'quota'
                      || (quota?.requestsRemaining === 0)
                      || (quota?.tokensRemaining   === 0);
      return {
        status: 'limited',
        message: isQuota
          ? 'Quota exceeded. You have reached your usage limit.'
          : `Rate limited. Retry in ${rateLimit.retryAfterSeconds}s.`,
        rateLimit,
        quota,
      };
    }
    case 404:
      return {
        status: 'offline',
        message: 'Model or endpoint not found. Check the model name.',
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        status: 'limited',
        message: 'Provider is experiencing issues. Try again later.',
      };
    default:
      return {
        status: statusCode >= 400 ? 'offline' : 'limited',
        message: `Provider returned an unexpected response (HTTP ${statusCode}).`,
      };
  }
}

export function classifyNetworkError(err: unknown): ClassifiedError {
  // Never expose the raw error message — map to safe strings
  const msg = err instanceof Error ? err.message : '';
  if (/ECONNREFUSED|ENOTFOUND|Network request failed|fetch failed/i.test(msg)) {
    return { status: 'offline', message: 'Cannot reach the endpoint. Check URL and network.' };
  }
  if (/timeout|timed out/i.test(msg)) {
    return { status: 'limited', message: 'Connection timed out. The provider may be slow.' };
  }
  if (/SSL|certificate|cert/i.test(msg)) {
    return { status: 'offline', message: 'SSL certificate error. Check the endpoint URL.' };
  }
  return { status: 'offline', message: 'Could not connect. Check your network connection.' };
}

// ─── Probe helpers ─────────────────────────────────────────────────────────

/** Minimal chat completions probe — sends a single token to verify auth + model. */
async function probeOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ ok: true; responseTimeMs: number; confirmedModel: string; quota?: AIQuotaInfo }
         | { ok: false; classified: ClassifiedError }> {
  const start = Date.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      }),
    });
  } catch (err) {
    return { ok: false, classified: classifyNetworkError(err) };
  }

  if (!response.ok) {
    return { ok: false, classified: classifyHttpError(response.status, response.headers) };
  }

  const quota = extractQuota(response.headers);
  let confirmedModel = model;
  try {
    const data = (await response.json()) as { model?: string };
    if (data.model) confirmedModel = data.model;
  } catch { /* ignore parse errors — connection is fine */ }

  return { ok: true, responseTimeMs: Date.now() - start, confirmedModel, quota };
}

/** Probe the Anthropic messages endpoint. */
async function probeAnthropic(
  apiKey: string,
  model: string,
): Promise<{ ok: true; responseTimeMs: number; confirmedModel: string }
         | { ok: false; classified: ClassifiedError }> {
  const start = Date.now();
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
  } catch (err) {
    return { ok: false, classified: classifyNetworkError(err) };
  }
  if (!response.ok) {
    return { ok: false, classified: classifyHttpError(response.status, response.headers) };
  }
  return { ok: true, responseTimeMs: Date.now() - start, confirmedModel: model };
}

/** Probe IBM watsonx via IAM + generation endpoint. */
async function probeWatsonx(
  apiKey: string,
  projectId: string,
  region: string,
  model: string,
): Promise<{ ok: true; responseTimeMs: number; confirmedModel: string }
         | { ok: false; classified: ClassifiedError }> {
  const start = Date.now();
  // Get IAM token
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
    });
  } catch (err) {
    return { ok: false, classified: classifyNetworkError(err) };
  }
  if (!tokenResponse.ok) {
    return { ok: false, classified: { status: 'offline', message: 'IBM IAM authentication failed. Check your API key.' } };
  }
  let accessToken: string;
  try {
    const td = (await tokenResponse.json()) as { access_token: string };
    accessToken = td.access_token;
  } catch {
    return { ok: false, classified: { status: 'offline', message: 'IBM IAM returned an unexpected response.' } };
  }

  const regionBase = region || 'us-south';
  let genResponse: Response;
  try {
    genResponse = await fetch(
      `https://${regionBase}.ml.cloud.ibm.com/ml/v1/text/generation?version=2023-05-29`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          model_id: model || 'ibm/granite-13b-instruct-v2',
          input: 'ping',
          parameters: { max_new_tokens: 1 },
          project_id: projectId,
        }),
      }
    );
  } catch (err) {
    return { ok: false, classified: classifyNetworkError(err) };
  }
  if (!genResponse.ok) {
    return { ok: false, classified: classifyHttpError(genResponse.status, genResponse.headers) };
  }
  return { ok: true, responseTimeMs: Date.now() - start, confirmedModel: model };
}

/** Probe Gemini generateContent endpoint. */
async function probeGemini(
  apiKey: string,
  model: string,
): Promise<{ ok: true; responseTimeMs: number; confirmedModel: string }
         | { ok: false; classified: ClassifiedError }> {
  const start = Date.now();
  const geminiModel = model || 'gemini-2.0-flash';
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
      }
    );
  } catch (err) {
    return { ok: false, classified: classifyNetworkError(err) };
  }
  if (!response.ok) {
    return { ok: false, classified: classifyHttpError(response.status, response.headers) };
  }
  return { ok: true, responseTimeMs: Date.now() - start, confirmedModel: geminiModel };
}

// ─── Public: testConnection ────────────────────────────────────────────────

/**
 * Run a minimal connectivity probe for the given AI settings.
 * Returns a full AIHealthStatus — never throws.
 */
export async function testConnection(settings: AISettings): Promise<AIHealthStatus> {
  const now = new Date().toISOString();
  const base: Pick<AIHealthStatus, 'provider' | 'lastCheckedAt'> = {
    provider:      settings.provider,
    lastCheckedAt: now,
  };

  try {
    let result:
      | { ok: true; responseTimeMs: number; confirmedModel: string; quota?: AIQuotaInfo }
      | { ok: false; classified: ClassifiedError };

    switch (settings.provider) {
      case 'openai':
        result = await probeOpenAICompatible(
          'https://api.openai.com/v1',
          settings.apiKey,
          settings.model || 'gpt-4o-mini',
        );
        break;
      case 'deepseek':
        result = await probeOpenAICompatible(
          'https://api.deepseek.com/v1',
          settings.apiKey,
          settings.model || 'deepseek-chat',
        );
        break;
      case 'groq':
        result = await probeOpenAICompatible(
          'https://api.groq.com/openai/v1',
          settings.apiKey,
          settings.model || 'llama-3.3-70b-versatile',
        );
        break;
      case 'indus':
        result = await probeOpenAICompatible(
          (settings.localBaseUrl || 'https://api.indusai.in/v1').replace(/\/$/, ''),
          settings.apiKey,
          settings.model || 'indus-1',
        );
        break;
      case 'anthropic':
        result = await probeAnthropic(settings.apiKey, settings.model || 'claude-3-haiku-20240307');
        break;
      case 'gemini':
        result = await probeGemini(settings.apiKey, settings.model || 'gemini-2.0-flash');
        break;
      case 'watsonx':
        result = await probeWatsonx(
          settings.apiKey,
          settings.watsonxProjectId ?? '',
          settings.watsonxRegion ?? 'us-south',
          settings.model || 'ibm/granite-13b-instruct-v2',
        );
        break;
      case 'local': {
        const localBase = getBaseUrl(settings);
        result = await probeOpenAICompatible(
          localBase,
          settings.apiKey,
          settings.model || 'llama3.2',
        );
        break;
      }
      default:
        return { ...base, status: 'unknown', lastErrorMessage: 'Unknown provider.' };
    }

    if (result.ok) {
      const health: AIHealthStatus = {
        ...base,
        status:              'connected',
        lastSuccessfulCheck: now,
        responseTimeMs:      result.responseTimeMs,
        confirmedModel:      result.confirmedModel,
        quota:               result.quota,
      };
      await saveHealth(health);
      return health;
    }

    const health: AIHealthStatus = {
      ...base,
      status:           result.classified.status,
      rateLimit:        result.classified.rateLimit,
      quota:            result.classified.quota,
      lastErrorMessage: result.classified.message,
    };
    await saveHealth(health);
    return health;

  } catch {
    // Catch-all: never propagate raw errors
    const health: AIHealthStatus = {
      ...base,
      status:           'offline',
      lastErrorMessage: 'An unexpected error occurred. Check your network.',
    };
    await saveHealth(health);
    return health;
  }
}

// ─── Persistence ───────────────────────────────────────────────────────────

export async function saveHealth(status: AIHealthStatus): Promise<void> {
  try {
    await SecureStore.setItemAsync(HEALTH_KEY, JSON.stringify(status));
  } catch { /* non-critical */ }
}

export async function loadHealth(): Promise<AIHealthStatus | null> {
  try {
    const raw = await SecureStore.getItemAsync(HEALTH_KEY);
    if (raw) return JSON.parse(raw) as AIHealthStatus;
  } catch { /* ignore */ }
  return null;
}

export async function clearHealth(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(HEALTH_KEY);
  } catch { /* ignore */ }
}

// ─── Helpers used by the UI layer ──────────────────────────────────────────

/** Returns a safe, short description of any AI error — NEVER raw messages. */
export function safeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'An error occurred. Please try again.';
  const msg = err.message;

  if (/401|403|authentication|api.?key|unauthorized/i.test(msg))
    return 'Authentication failed. Please check your API key.';
  if (/429|rate.?limit/i.test(msg))
    return 'Too many requests. Please wait a moment and try again.';
  if (/quota|billing|exceeded/i.test(msg))
    return 'Usage quota exceeded. Please check your provider account.';
  if (/404|model.?not.?found/i.test(msg))
    return 'Model not found. Please check the model name in settings.';
  if (/500|502|503|504|server/i.test(msg))
    return 'The AI provider is temporarily unavailable. Try again later.';
  if (/ECONNREFUSED|ENOTFOUND|fetch.?failed|Network/i.test(msg))
    return 'Cannot reach the AI provider. Check your network connection.';
  if (/timeout|timed.?out/i.test(msg))
    return 'The request timed out. The provider may be overloaded.';

  return 'AI is temporarily unavailable. Please try again.';
}

/** Format ISO timestamp as a human-readable relative string. */
export function formatRelativeTime(iso?: string): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)  return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
