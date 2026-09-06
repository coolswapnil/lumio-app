/**
 * languageDetection.ts — Script-based language detection and AI translation
 *
 * Detection uses Unicode script ranges (no external dependency).
 * Translation is requested through the same AI provider the user has configured.
 */

import type { AISettings } from '../types';
import type { AIMessage } from './ai';

// ─── Supported languages ──────────────────────────────────────────────────────

export type DetectedLanguage =
  | 'Japanese'
  | 'Chinese'
  | 'Korean'
  | 'German'
  | 'French'
  | 'Spanish'
  | 'Marathi'
  | 'Hindi'
  | 'English'
  | 'Unknown';

// ─── Script-range detection ───────────────────────────────────────────────────

/**
 * Returns the fraction of characters in `text` that fall within the supplied
 * Unicode code-point ranges (supplied as [start, end] pairs).
 */
function scriptRatio(text: string, ranges: [number, number][]): number {
  if (!text.length) return 0;
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) count++;
  }
  return count / text.length;
}

// Minimum fraction of script-specific characters to trigger a detection.
const SCRIPT_THRESHOLD = 0.15;

/**
 * Strip hashtags, mentions, emoji, and URLs from a text string before
 * running Latin-script language heuristics. These elements are language-neutral
 * and dilute the signal on short social-media captions.
 */
function stripSocialNoise(text: string): string {
  return text
    // Remove URLs
    .replace(/https?:\/\/\S+/g, ' ')
    // Remove hashtags (#word) — keep the text after if it's a long phrase
    .replace(/#\S+/g, ' ')
    // Remove @mentions
    .replace(/@\S+/g, ' ')
    // Remove emoji (broad Unicode ranges: emoticons, misc symbols, supplemental)
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, ' ')
    .replace(/[\u{2600}-\u{27BF}]/gu, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect the primary language of a text string using Unicode block heuristics.
 * Returns 'Unknown' when no script matches above the threshold.
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (!text || text.trim().length < 4) return 'Unknown';

  const clean = text.replace(/\s+/g, ' ').trim();

  // Kana only (Hiragana + Katakana) — U+3040–U+30FF
  const kanaRatio = scriptRatio(clean, [[0x3040, 0x30ff]]);
  // CJK Unified Ideographs — U+4E00–U+9FFF (shared between Japanese and Chinese)
  const cjkRatio = scriptRatio(clean, [[0x4e00, 0x9fff]]);
  // Korean: Hangul syllables U+AC00–U+D7A3, Jamo U+1100–U+11FF
  const koRatio = scriptRatio(clean, [[0xac00, 0xd7a3], [0x1100, 0x11ff]]);
  // Devanagari (Hindi + Marathi): U+0900–U+097F
  const devaRatio = scriptRatio(clean, [[0x0900, 0x097f]]);

  if (koRatio >= SCRIPT_THRESHOLD) return 'Korean';
  // Japanese: presence of kana is the primary signal; may co-occur with CJK
  if (kanaRatio >= SCRIPT_THRESHOLD) return 'Japanese';
  // Chinese: significant CJK without kana
  if (cjkRatio >= SCRIPT_THRESHOLD && kanaRatio < 0.05) return 'Chinese';

  if (devaRatio >= SCRIPT_THRESHOLD) {
    // Marathi vs Hindi: keyword list. No \b used — word boundaries are
    // unreliable with non-ASCII scripts in JS regex.
    // Expanded list covers common grammatical words unique to Marathi.
    const marathiKeywords = /(आहे|नाही|मराठी|महाराष्ट्र|पुणे|केला|गेला|येतो|घर|काम|दिला|मिळाला|आला|गेले|होते|सांगितले|झाले|लागले|आणि|किंवा)/u;
    return marathiKeywords.test(clean) ? 'Marathi' : 'Hindi';
  }

  // Latin-script languages — strip social noise (hashtags, emoji, mentions, URLs)
  // before applying word-level heuristics so short captions still signal correctly.
  const latinClean = stripSocialNoise(clean).toLowerCase();
  if (latinClean.length < 3) return 'Unknown';

  // German: common function words + nouns/verbs that appear in short captions.
  // Two separate regexes — stopwords (high confidence) and content words (lower).
  const germanStopwords = /\b(und|der|die|das|ist|nicht|ein|eine|mit|auf|für|von|sie|wir|ich|du|er|es|ihr|uns|dem|den|des|zum|zur|im|am|um|bei|nach|seit|vor|über|unter|zwischen|durch|gegen|ohne|während)\b/;
  const germanContent   = /\b(schön|heute|immer|aber|auch|beim|sehr|dann|nach|noch|oder|wie|wenn|weil|was|nur|mal|ja|nein|gut|neu|alt|gern|echt|viel|mehr|hier|jetzt|schon|doch|so|aus|ab|an)\b/;
  if (germanStopwords.test(latinClean) || germanContent.test(latinClean)) {
    return 'German';
  }
  // French: common determiners / prepositions
  if (/\b(le|la|les|de|du|des|et|un|une|est|pour|dans|sur|avec|je|vous|nous|ils|elle|ce|cet|cette|ces|mon|ma|mes|son|sa|ses|notre|votre|leur|qui|que|quoi|dont|où|mais|ou|ni|car|donc|or|soit)\b/.test(latinClean)) {
    return 'French';
  }
  // Spanish: common words
  if (/\b(el|los|las|de|del|es|en|que|y|un|una|por|con|para|esto|este|esta|los|las|al|se|lo|me|mi|tu|su|nos|son|ser|hay|fue|era|han|hoy|muy|bien|todo|más|pero|como|cuando|también|así|ya|él|ella|ellos|ellas)\b/.test(latinClean)) {
    return 'Spanish';
  }

  // Default to English for plain ASCII/Latin text
  if (/^[\x00-\x7f\s.,!?'"()\-:;@#]+$/.test(clean)) return 'English';

  return 'Unknown';
}

// ─── Translation ──────────────────────────────────────────────────────────────

export interface TranslationResult {
  translatedSummary?: string;
  translatedTags?: string[];
  translatedTitle?: string;
  error?: string;
}

/**
 * Translate AI-generated content (summary, tags, title) from a detected
 * foreign language into the app's target language.
 *
 * Called only when:
 *  - autoTranslate is true
 *  - detectedLanguage is not English and not in the neverTranslateList
 */
export async function translateContent(
  settings: AISettings,
  payload: {
    summary?: string;
    tags?: string[];
    title?: string;
    sourceLanguage: DetectedLanguage;
    targetLanguage?: string; // defaults to 'English'
  },
  callAIFn: (settings: AISettings, messages: AIMessage[], jsonMode: boolean) => Promise<string>
): Promise<TranslationResult> {
  const target = payload.targetLanguage ?? 'English';
  const source = payload.sourceLanguage;

  const inputParts: string[] = [];
  if (payload.summary) inputParts.push(`"summary": ${JSON.stringify(payload.summary)}`);
  if (payload.tags?.length) inputParts.push(`"tags": ${JSON.stringify(payload.tags)}`);
  if (payload.title) inputParts.push(`"title": ${JSON.stringify(payload.title)}`);

  if (!inputParts.length) return {};

  const messages: AIMessage[] = [
    {
      role: 'system',
      content:
        `You are a professional translator. Translate the following JSON fields from ${source} to ${target}. ` +
        'Preserve the original meaning exactly. For tags, keep them lowercase and concise. ' +
        'Output ONLY a single raw JSON object with the same keys that were provided — no prose, no markdown. ' +
        'Example output: {"summary":"...", "tags":["...","..."], "title":"..."}',
    },
    {
      role: 'user',
      content: `Translate:\n{${inputParts.join(', ')}}`,
    },
  ];

  try {
    const raw = await callAIFn(settings, messages, true);

    // Extract JSON from response
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fenceMatch ? fenceMatch[1].trim() : raw;
    let parsed: Record<string, unknown> | null = null;
    let idx = 0;
    while (idx < jsonText.length) {
      const start = jsonText.indexOf('{', idx);
      if (start === -1) break;
      let depth = 0, end = -1;
      for (let i = start; i < jsonText.length; i++) {
        if (jsonText[i] === '{') depth++;
        else if (jsonText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) break;
      try { parsed = JSON.parse(jsonText.slice(start, end + 1)) as Record<string, unknown>; break; }
      catch { idx = start + 1; }
    }

    if (!parsed) return { error: 'Translation response could not be parsed.' };

    return {
      translatedSummary: typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined,
      translatedTags: Array.isArray(parsed.tags)
        ? (parsed.tags as unknown[]).filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase())
        : undefined,
      translatedTitle: typeof parsed.title === 'string' ? parsed.title.trim() : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Translation failed.' };
  }
}

/**
 * Check whether a language should be translated given user settings.
 */
export function shouldTranslate(
  lang: DetectedLanguage,
  autoTranslate: boolean,
  neverTranslateList: string[]
): boolean {
  if (!autoTranslate) return false;
  if (lang === 'English' || lang === 'Unknown') return false;
  if (neverTranslateList.includes(lang)) return false;
  return true;
}
