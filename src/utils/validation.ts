/**
 * Input validation and sanitization utilities.
 * Centralizes all validation logic used across save.tsx, share.tsx, and
 * the deep-link handler to prevent injection, over-long inputs, and
 * malformed data reaching the database.
 */

// ─── Field length limits ──────────────────────────────────────────────────────
export const LIMITS = {
  TITLE: 200,
  DESCRIPTION: 2000,
  NOTES: 5000,
  TAG: 50,
  TAG_COUNT: 20,
  URL: 2048,
  ADDRESS: 300,
  COLLECTION_NAME: 100,
  COLLECTION_DESCRIPTION: 500,
} as const;

// ─── URL validation ───────────────────────────────────────────────────────────

/**
 * Returns true if the string is a well-formed http(s) URL.
 * Rejects javascript:, data:, and other dangerous schemes.
 */
export function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Reject hostnames that are only dots or contain consecutive dots
    const hostname = url.hostname;
    if (!hostname || /\.\./.test(hostname) || /^\.|\.$/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes a URL string.
 * Returns the trimmed value if valid, empty string otherwise.
 */
export function sanitizeUrl(value: string): string {
  const trimmed = value.trim().slice(0, LIMITS.URL);
  return isValidUrl(trimmed) ? trimmed : '';
}

// ─── Deep-link param sanitization ────────────────────────────────────────────

/**
 * Safely coerces a string | string[] | undefined deep-link param to a string.
 * Used in share.tsx and any screen reading useLocalSearchParams.
 */
export function asString(v: string | string[] | undefined): string {
  if (!v) return '';
  const raw = Array.isArray(v) ? (v[0] ?? '') : v;
  // Strip null bytes and control characters
  return raw.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
}

/**
 * Validates a deep-link collection ID.
 * A valid collection ID is a non-empty alphanumeric/hyphen/underscore string
 * matching UUID v4 format or simpler slug.
 */
export function isValidId(id: string): boolean {
  if (!id) return false;
  // Accept UUID v4 or simpler alphanumeric IDs up to 64 chars
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

// ─── Text field sanitization & decoding ───────────────────────────────────────

/**
 * Decodes all common named and numeric (decimal + hexadecimal) HTML entities.
 * Handles characters like &#x1f4c8; (📈), &#x20b9; (₹), &#x2019; (’), &#x1f4b0; (💰), &amp;, &quot;, &lt;, &gt;.
 */
export function decodeHtmlEntities(value: string): string {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        const code = parseInt(hex, 16);
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      try {
        const code = parseInt(dec, 10);
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    })
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&copy;/gi, '©')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    .replace(/&euro;/gi, '€')
    .replace(/&pound;/gi, '£')
    .replace(/&yen;/gi, '¥')
    .replace(/&cent;/gi, '¢');
}

/** Decodes HTML entities, trims, and enforces max length on a text field. */
export function sanitizeText(value: string, maxLength: number): string {
  if (!value || typeof value !== 'string') return '';
  const decoded = decodeHtmlEntities(value);
  return decoded.trim().slice(0, maxLength);
}

/**
 * Parses and sanitizes a comma-separated tags string.
 * Trims each tag, lowercases it, removes empty entries, deduplicates,
 * enforces per-tag max length, and caps total tag count.
 */
export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase().slice(0, LIMITS.TAG))
        .filter(Boolean)
    ),
  ].slice(0, LIMITS.TAG_COUNT);
}

// ─── Clipboard URL detection ──────────────────────────────────────────────────

/**
 * Returns the clipboard value if it is a safe http(s) URL,
 * otherwise returns null.
 * Used before auto-populating URL fields.
 */
export function extractSafeUrl(clipboardText: string): string | null {
  const trimmed = clipboardText.trim().slice(0, LIMITS.URL);
  return isValidUrl(trimmed) ? trimmed : null;
}
