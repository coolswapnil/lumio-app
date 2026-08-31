import type { AISettings } from '../types';

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
// OpenAI
// ────────────────────────────────────────────────────────────────────────────
async function callOpenAI(
  apiKey: string,
  model: string,
  messages: AIMessage[]
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages,
      max_tokens: 512,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? '';
}

// ────────────────────────────────────────────────────────────────────────────
// Anthropic
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
    throw new Error(`Anthropic API error: ${response.status}`);
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
  // Get IAM token first
  const tokenResponse = await fetch(
    'https://iam.cloud.ibm.com/identity/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
    }
  );
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
  const geminiModel = model || 'gemini-1.5-flash';
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
// Unified call
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
    case 'watsonx':
      return callWatsonx(
        settings.apiKey,
        settings.model ?? 'ibm/granite-13b-instruct-v2',
        settings.watsonxProjectId ?? '',
        settings.watsonxRegion ?? 'us-south',
        messages
      );
    case 'gemini':
      return callGemini(settings.apiKey, settings.model ?? 'gemini-1.5-flash', messages);
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
  } catch {
    // Fallback if parsing fails
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
        'You are a helpful assistant for Albo, a personal save-for-later app. ' +
        'Help users organize, recall, and act on their saved content.' +
        (context ? `\n\nCurrent context:\n${context}` : ''),
    },
    { role: 'user', content: userMessage },
  ];
  return callAI(settings, messages);
}
