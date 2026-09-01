import type { AISettings } from '../types';
import { logError } from '../utils/errors';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AISummarizeResult {
  summary: string;
  suggestedTags: string[];
  suggestedTitle?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared helper: OpenAI-compatible chat completions endpoint
// Used by: OpenAI, DeepSeek, Groq, Indus, Local LLM (Ollama/LM Studio)
// ────────────────────────────────────────────────────────────────────────────
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AIMessage[]
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Local LLM (Ollama) may not require a key, but include if provided
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 512,
      temperature: 0.3,
    }),
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
  messages: AIMessage[]
): Promise<string> {
  return callOpenAICompatible(
    'https://api.openai.com/v1',
    apiKey,
    model || 'gpt-4o-mini',
    messages
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
  messages: AIMessage[]
): Promise<string> {
  const geminiModel = model || 'gemini-2.0-flash';
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

  // API key sent via header (not URL query param) to prevent exposure in logs/history
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({ contents }),
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
  messages: AIMessage[]
): Promise<string> {
  return callOpenAICompatible(
    'https://api.deepseek.com/v1',
    apiKey,
    model || 'deepseek-chat',
    messages
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Groq  (OpenAI-compatible, very fast inference)
// ────────────────────────────────────────────────────────────────────────────
async function callGroq(
  apiKey: string,
  model: string,
  messages: AIMessage[]
): Promise<string> {
  return callOpenAICompatible(
    'https://api.groq.com/openai/v1',
    apiKey,
    model || 'llama-3.3-70b-versatile',
    messages
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Indus AI  (OpenAI-compatible, base URL required)
// ────────────────────────────────────────────────────────────────────────────
async function callIndus(
  apiKey: string,
  model: string,
  baseUrl: string,
  messages: AIMessage[]
): Promise<string> {
  const url = (baseUrl || 'https://api.indusai.in/v1').replace(/\/$/, '');
  return callOpenAICompatible(url, apiKey, model || 'indus-1', messages);
}

// ────────────────────────────────────────────────────────────────────────────
// Local LLM — Ollama / LM Studio / any OpenAI-compatible local server
//
// Ollama default:    http://localhost:11434/v1   (no key needed)
// LM Studio default: http://localhost:1234/v1    (no key needed)
// Custom server:     user-provided base URL
// ────────────────────────────────────────────────────────────────────────────
async function callLocalLLM(
  apiKey: string,
  model: string,
  baseUrl: string,
  messages: AIMessage[]
): Promise<string> {
  const url = (baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '');
  return callOpenAICompatible(url, apiKey, model || 'llama3.2', messages);
}

// ────────────────────────────────────────────────────────────────────────────
// Unified dispatcher
// ────────────────────────────────────────────────────────────────────────────
async function callAI(
  settings: AISettings,
  messages: AIMessage[]
): Promise<string> {
  switch (settings.provider) {
    case 'openai':
      return callOpenAI(settings.apiKey, settings.model ?? 'gpt-4o-mini', messages);

    case 'anthropic':
      return callAnthropic(settings.apiKey, settings.model ?? 'claude-3-haiku-20240307', messages);

    case 'gemini':
      return callGemini(settings.apiKey, settings.model ?? 'gemini-2.0-flash', messages);

    case 'deepseek':
      return callDeepSeek(settings.apiKey, settings.model ?? 'deepseek-chat', messages);

    case 'groq':
      return callGroq(settings.apiKey, settings.model ?? 'llama-3.3-70b-versatile', messages);

    case 'indus':
      return callIndus(
        settings.apiKey,
        settings.model ?? 'indus-1',
        settings.localBaseUrl ?? 'https://api.indusai.in/v1',
        messages
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
        settings.localBaseUrl ?? 'http://localhost:11434/v1',
        messages
      );

    default:
      throw new Error('Unknown AI provider');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────
export async function summarizeItem(
  settings: AISettings,
  title: string,
  url?: string,
  description?: string,
  contentType?: string
): Promise<AISummarizeResult> {
  const context = [
    `Title: ${title}`,
    url ? `URL: ${url}` : '',
    contentType ? `Type: ${contentType}` : '',
    description ? `Description: ${description}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const messages: AIMessage[] = [
    {
      role: 'system',
      content:
        'You are a helpful assistant that summarizes saved content for a personal knowledge manager. ' +
        'Respond only with valid JSON in this exact format: ' +
        '{"summary":"...","suggestedTags":["tag1","tag2"],"suggestedTitle":"..."}',
    },
    {
      role: 'user',
      content: `Summarize this saved item and suggest 3-5 relevant tags and an improved title:\n\n${context}`,
    },
  ];

  const raw = await callAI(settings, messages);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as AISummarizeResult;
    }
  } catch (parseErr) {
    logError(parseErr, { action: 'parseAISummarizeResult', provider: settings.provider });
    // Fallback: return raw text as summary
  }
  return { summary: raw, suggestedTags: [] };
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
  return callAI(settings, messages);
}
