import type { AISettings, ContentCategory, ContentLocation } from '../types';
import { decodeHtmlEntities } from '../utils/validation';
import { logError } from '../utils/errors';
import { safeErrorMessage } from './aiHealth';
import { diagLog } from './diagnostics';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AISummarizeResult {
  summary: string;
  suggestedTags: string[];
  suggestedTitle?: string;
  /** AI-generated primary category */
  category?: ContentCategory;
  /** Up to 3 collection name suggestions (not IDs — matched by name in the UI) */
  suggestedCollectionNames?: string[];
  /** Location data extracted from the content */
  location?: ContentLocation;
  /** Set when the AI call itself failed (network, auth, parse). Distinct from an empty-but-valid response. */
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared helper: OpenAI-compatible chat completions endpoint
// Used by: OpenAI, DeepSeek, Groq, Indus, Local LLM (Ollama/LM Studio)
// ────────────────────────────────────────────────────────────────────────────
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AIMessage[],
  jsonMode = false
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Local LLM (Ollama) may not require a key, but include if provided
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 512,
    temperature: 0.3,
  };
  // json_object mode instructs the model to output raw JSON with no prose or markdown.
  // Supported by: OpenAI, Groq, DeepSeek, most OpenAI-compatible servers.
  if (jsonMode) {
    body['response_format'] = { type: 'json_object' };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`AI API error (${response.status}): ${errText.slice(0, 120)}`);
  }
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? '';
}

// ────────────────────────────────────────────────────────────────────────────
// OpenAI
// ────────────────────────────────────────────────────────────────────────────
async function callOpenAI(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  jsonMode = false
): Promise<string> {
  return callOpenAICompatible(
    'https://api.openai.com/v1',
    apiKey,
    model || 'gpt-4o-mini',
    messages,
    jsonMode
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Anthropic Claude
// ────────────────────────────────────────────────────────────────────────────
async function callAnthropic(
  apiKey: string,
  model: string,
  messages: AIMessage[]
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages.filter((m) => m.role !== 'system');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: 512,
      system: systemMsg,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Anthropic API error (${response.status}): ${errText.slice(0, 120)}`);
  }
  const data = (await response.json()) as {
    content: Array<{ text: string }>;
  };
  return data.content[0]?.text ?? '';
}

// ────────────────────────────────────────────────────────────────────────────
// IBM watsonx
// ────────────────────────────────────────────────────────────────────────────
async function callWatsonx(
  apiKey: string,
  model: string,
  projectId: string,
  region: string,
  messages: AIMessage[]
): Promise<string> {
  // Exchange API key for IAM bearer token
  const tokenResponse = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
  });
  if (!tokenResponse.ok) {
    throw new Error(`IBM IAM token error: ${tokenResponse.status}`);
  }
  const tokenData = (await tokenResponse.json()) as { access_token: string };

  const regionBase = region || 'us-south';
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  const response = await fetch(
    `https://${regionBase}.ml.cloud.ibm.com/ml/v1/text/generation?version=2023-05-29`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        model_id: model || 'ibm/granite-13b-instruct-v2',
        input: prompt,
        parameters: { max_new_tokens: 512, temperature: 0.3 },
        project_id: projectId,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`watsonx API error: ${response.status}`);
  }
  const data = (await response.json()) as {
    results: Array<{ generated_text: string }>;
  };
  return data.results[0]?.generated_text ?? '';
}

// ────────────────────────────────────────────────────────────────────────────
// Google Gemini
// ────────────────────────────────────────────────────────────────────────────
async function callGemini(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  jsonMode = false
): Promise<string> {
  const geminiModel = model || 'gemini-2.0-flash';
  const systemMsg = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

  const requestBody: Record<string, unknown> = { contents };

  // Pass the system instruction via the dedicated field so Gemini treats it
  // with full system-prompt authority rather than as a turn in the conversation.
  if (systemMsg) {
    requestBody['systemInstruction'] = { parts: [{ text: systemMsg }] };
  }

  // responseMimeType enforces JSON-only output at the API level — the model
  // cannot emit prose, markdown fences, or any non-JSON text when this is set.
  if (jsonMode) {
    requestBody['generationConfig'] = { responseMimeType: 'application/json' };
  }

  // API key sent via header (not URL query param) to prevent exposure in logs/history
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }
  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content?.parts[0]?.text ?? '';
}

// ────────────────────────────────────────────────────────────────────────────
// DeepSeek  (OpenAI-compatible)
// ────────────────────────────────────────────────────────────────────────────
async function callDeepSeek(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  jsonMode = false
): Promise<string> {
  return callOpenAICompatible(
    'https://api.deepseek.com/v1',
    apiKey,
    model || 'deepseek-chat',
    messages,
    jsonMode
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Groq  (OpenAI-compatible, very fast inference)
// ────────────────────────────────────────────────────────────────────────────
async function callGroq(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  jsonMode = false
): Promise<string> {
  return callOpenAICompatible(
    'https://api.groq.com/openai/v1',
    apiKey,
    model || 'llama-3.3-70b-versatile',
    messages,
    jsonMode
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Indus AI  (OpenAI-compatible, base URL required)
// ────────────────────────────────────────────────────────────────────────────
async function callIndus(
  apiKey: string,
  model: string,
  baseUrl: string,
  messages: AIMessage[],
  jsonMode = false
): Promise<string> {
  const url = (baseUrl || 'https://api.indusai.in/v1').replace(/\/$/, '');
  return callOpenAICompatible(url, apiKey, model || 'indus-1', messages, jsonMode);
}

// ────────────────────────────────────────────────────────────────────────────
// Local LLM — Ollama / LM Studio / llama.cpp / GGUF
//
// Source defaults:
//   ollama   → http://localhost:11434/v1  (no key needed)
//   lmstudio → http://localhost:1234/v1   (no key needed)
//   llamacpp → http://localhost:8080/v1   (no key needed)
//   gguf     → routed through llama.cpp server at localBaseUrl
// ────────────────────────────────────────────────────────────────────────────
function resolveLocalBaseUrl(
  source: import('../types').LocalAISource | undefined,
  customUrl: string | undefined
): string {
  if (customUrl?.trim()) return customUrl.trim().replace(/\/$/, '');
  switch (source) {
    case 'lmstudio':          return 'http://localhost:1234/v1';
    case 'llamacpp':          return 'http://localhost:8080/v1';
    case 'openai-compatible': return 'http://localhost:8080/v1';
    case 'gguf':              return 'http://localhost:8080/v1';
    case 'ollama':
    default:                  return 'http://localhost:11434/v1';
  }
}

async function callLocalLLM(
  apiKey: string,
  model: string,
  baseUrl: string,
  messages: AIMessage[],
  source?: import('../types').LocalAISource,
  jsonMode = false
): Promise<string> {
  const url = resolveLocalBaseUrl(source, baseUrl);
  const defaultModel = (source === 'lmstudio') ? 'local-model' : 'llama3.2';
  return callOpenAICompatible(url, apiKey, model || defaultModel, messages, jsonMode);
}

// ────────────────────────────────────────────────────────────────────────────
// Unified dispatcher
// ────────────────────────────────────────────────────────────────────────────
async function callAI(
  settings: AISettings,
  messages: AIMessage[],
  jsonMode = false
): Promise<string> {
  switch (settings.provider) {
    case 'openai':
      return callOpenAI(settings.apiKey, settings.model ?? 'gpt-4o-mini', messages, jsonMode);

    case 'anthropic':
      return callAnthropic(settings.apiKey, settings.model ?? 'claude-3-haiku-20240307', messages);

    case 'gemini':
      return callGemini(settings.apiKey, settings.model ?? 'gemini-2.0-flash', messages, jsonMode);

    case 'deepseek':
      return callDeepSeek(settings.apiKey, settings.model ?? 'deepseek-chat', messages, jsonMode);

    case 'groq':
      return callGroq(settings.apiKey, settings.model ?? 'llama-3.3-70b-versatile', messages, jsonMode);

    case 'indus':
      return callIndus(
        settings.apiKey,
        settings.model ?? 'indus-1',
        settings.localBaseUrl ?? 'https://api.indusai.in/v1',
        messages,
        jsonMode
      );

    case 'watsonx':
      return callWatsonx(
        settings.apiKey,
        settings.model ?? 'ibm/granite-13b-instruct-v2',
        settings.watsonxProjectId ?? '',
        settings.watsonxRegion ?? 'us-south',
        messages
      );

    case 'local':
      return callLocalLLM(
        settings.apiKey,
        settings.model ?? 'llama3.2',
        settings.localBaseUrl ?? '',
        messages,
        settings.localSource,
        jsonMode
      );

    default:
      throw new Error('Unknown AI provider');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
//
// FAIL-SAFE: these functions must NEVER let raw AI error messages reach
// caller-visible return values. All errors are caught here and converted
// to safe empty/fallback results. The description field is NEVER populated
// with an AI error message — callers receive { summary:'', suggestedTags:[] }.
// ────────────────────────────────────────────────────────────────────────────
/**
 * Extract the first valid JSON object from a raw AI response string.
 *
 * Handles:
 *   1. Plain JSON          { "summary": "..." }
 *   2. Markdown-fenced     ```json\n{ ... }\n```
 *   3. Prose with embedded { ... } anywhere in the text
 *
 * Strategy: strip any markdown fence first, then walk candidate substrings
 * starting at each '{' character and attempt JSON.parse on each. Returns the
 * first substring that parses successfully, or null if none do.
 */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  // 1. Try stripping a markdown code fence (```json ... ``` or ``` ... ```)
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fenceMatch ? [fenceMatch[1].trim(), raw] : [raw];

  for (const text of candidates) {
    // Walk every '{' position and try to parse outward
    let idx = 0;
    while (idx < text.length) {
      const start = text.indexOf('{', idx);
      if (start === -1) break;
      // Find the matching closing brace by tracking depth
      let depth = 0;
      let end = -1;
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end === -1) break; // unmatched brace — no point continuing
      try {
        const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
        return parsed;
      } catch {
        // This substring wasn't valid JSON; try the next '{'
        idx = start + 1;
      }
    }
  }
  return null;
}

export async function summarizeItem(
  settings: AISettings,
  title: string,
  url?: string,
  description?: string,
  contentType?: string,
  collectionNames?: string[]
): Promise<AISummarizeResult> {
  const context = [
    `Title: ${title}`,
    contentType ? `Type: ${contentType}` : '',
    description ? `Extracted page metadata:\n${description}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const collectionHint = collectionNames && collectionNames.length > 0
    ? `\nAvailable collections the user has: ${collectionNames.join(', ')}. Suggest up to 3 that fit best (by exact name). If none fit, return an empty array.`
    : '';

  const categoryList = 'Finance, Technology, Health, Travel, Food, Career, Learning, Entertainment, Science, Sports, Politics, Design, Business, Lifestyle, Other';

  const messages: AIMessage[] = [
    {
      role: 'system',
      content:
        'You are a smart content categorization assistant for a personal knowledge manager. ' +
        'Use only the supplied title and extracted page metadata. Do not claim to access a URL or webpage. ' +
        'If there is insufficient information, return empty values. ' +
        'Output ONLY a single raw JSON object — no prose, no markdown, no code fences, no explanation. ' +
        'The JSON must have exactly these keys:\n' +
        '{\n' +
        '  "summary": "2-3 sentence summary of the content",\n' +
        '  "suggestedTitle": "Concise title, max 8 words, key topic only, no filler or social media phrasing",\n' +
        '  "suggestedTags": ["tag1", "tag2", "tag3"],\n' +
        `  "category": "One of: ${categoryList}",\n` +
        '  "suggestedCollectionNames": ["Name1", "Name2"],\n' +
        '  "location": { "venue": "...", "city": "...", "country": "..." }\n' +
        '}\n' +
        'For location, only include fields that are clearly stated in the content. If no location is evident, use null for the location field.',
    },
    {
      role: 'user',
      content: `Analyze this saved item and fill in all fields:\n\n${context}${collectionHint}`,
    },
  ];

  let raw: string;
  try {
    raw = await callAI(settings, messages, true);
    diagLog.addEntry('AI_RESPONSE_RAW', `provider=${settings.provider} model=${settings.model ?? '(default)'} length=${raw.length} content="${raw.slice(0, 1000)}"`);
    diagLog.addEntry('AI_RESPONSE_RECEIVED', `provider=${settings.provider} rawLength=${raw.length} preview="${raw.slice(0, 120)}"`);
  } catch (callErr) {
    // Surface the error to the caller via the `error` field so the UI can show
    // a meaningful message instead of silently doing nothing.
    logError(callErr, { action: 'summarizeItem:callAI', provider: settings.provider });
    const safeMsg = safeErrorMessage(callErr);
    diagLog.addEntry('PROVIDER_ERROR', `provider=${settings.provider} err="${safeMsg}"`);
    return { summary: '', suggestedTags: [], error: safeMsg };
  }

  try {
    diagLog.addEntry('AI_RESPONSE_PARSED', 'attempting JSON extraction');
    const parsed = extractJsonObject(raw) as {
      summary?: string;
      suggestedTags?: unknown;
      suggestedTitle?: string;
      category?: string;
      suggestedCollectionNames?: unknown;
      location?: unknown;
    } | null;
    if (parsed) {
      const rawSummary = typeof parsed.summary === 'string' ? parsed.summary : '';
      const summary = decodeHtmlEntities(rawSummary).trim();
      const isRefusal = /\b(i (?:cannot|can't|am unable)|unable to access|do not have access|can't access)\b/i.test(summary);

      // Validate category against the known list
      const validCategories: ContentCategory[] = ['Finance','Technology','Health','Travel','Food','Career','Learning','Entertainment','Science','Sports','Politics','Design','Business','Lifestyle','Other'];
      const rawCategory = typeof parsed.category === 'string' ? decodeHtmlEntities(parsed.category).trim() as ContentCategory : undefined;
      const category = rawCategory && validCategories.includes(rawCategory) ? rawCategory : undefined;

      // Suggested collection names — up to 3 strings
      const suggestedCollectionNames = Array.isArray(parsed.suggestedCollectionNames)
        ? (parsed.suggestedCollectionNames as unknown[])
            .filter((s): s is string => typeof s === 'string')
            .map((s) => decodeHtmlEntities(s).trim())
            .slice(0, 3)
        : undefined;

      // Location — only accept well-formed objects with at least one string field
      let location: ContentLocation | undefined;
      if (parsed.location && typeof parsed.location === 'object' && !Array.isArray(parsed.location)) {
        const loc = parsed.location as Record<string, unknown>;
        const venue = typeof loc.venue === 'string' ? decodeHtmlEntities(loc.venue).trim() || undefined : undefined;
        const city = typeof loc.city === 'string' ? decodeHtmlEntities(loc.city).trim() || undefined : undefined;
        const country = typeof loc.country === 'string' ? decodeHtmlEntities(loc.country).trim() || undefined : undefined;
        if (venue || city || country) {
          location = { venue, city, country };
        }
      }

      const rawTitle = typeof parsed.suggestedTitle === 'string' ? decodeHtmlEntities(parsed.suggestedTitle).trim() : undefined;
      const suggestedTags = Array.isArray(parsed.suggestedTags)
        ? (parsed.suggestedTags as string[]).map((t) => typeof t === 'string' ? decodeHtmlEntities(t).trim() : '').filter(Boolean)
        : [];

      const result: AISummarizeResult = {
        summary: isRefusal ? '' : summary,
        suggestedTags,
        suggestedTitle: rawTitle || undefined,
        category,
        suggestedCollectionNames,
        location,
      };
      diagLog.addEntry('AI_RESPONSE_PARSED', `ok summary="${result.summary.slice(0, 80)}" tags=${result.suggestedTags.length} title="${result.suggestedTitle ?? ''}" category="${result.category ?? ''}" collections=${result.suggestedCollectionNames?.length ?? 0}`);
      return result;
    }
    // Raw response contained no parseable JSON object — treat as parse failure
    diagLog.addEntry('AI_RESPONSE_PARSED', `no JSON found raw="${raw.slice(0, 200)}"`);
    return { summary: '', suggestedTags: [], error: 'AI returned an unexpected response format.' };
  } catch (parseErr) {
    logError(parseErr, { action: 'parseAISummarizeResult', provider: settings.provider });
    diagLog.addEntry('AI_RESPONSE_PARSED', `extraction threw: ${String(parseErr)}`);
    return { summary: '', suggestedTags: [], error: 'AI response could not be parsed.' };
  }
}

export async function chatWithAI(
  settings: AISettings,
  userMessage: string,
  context?: string
): Promise<string> {
  const messages: AIMessage[] = [
    {
      role: 'system',
      content:
        'You are a helpful assistant for Lumio, a personal save-for-later app. ' +
        'Help users organize, recall, and act on their saved content.' +
        (context ? `\n\nCurrent context:\n${context}` : ''),
    },
    { role: 'user', content: userMessage },
  ];
  try {
    return await callAI(settings, messages);
  } catch (err) {
    logError(err, { action: 'chatWithAI', provider: settings.provider });
    // Return a user-friendly message — never the raw error.
    return safeErrorMessage(err);
  }
}
