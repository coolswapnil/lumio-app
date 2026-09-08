/**
 * Topic Normalization
 *
 * Provides a canonical merge map and a 5-step normalization pipeline so that
 * topic labels created from different sources converge to a consistent form.
 */

/**
 * Maps a post-step-4-normalized label to its canonical equivalent.
 *
 * Keys must be in the form that the string has AFTER the full pipeline runs
 * through steps 1–4 (lowercase, possessives stripped, leading stop words
 * stripped, plural-s stripped from words ≥ 6 chars). Step 5 then looks up the
 * result in this map.
 */
export const TOPIC_CANONICAL_MAP: Record<string, string> = {
  // "dividend stocks" → step4 → "dividend stock"
  'dividend stock': 'dividend investing',
  // "dividend shares" → step4 → "dividend share"
  'dividend share': 'dividend investing',
  // "property deals" — "deals" is 5 chars, not stripped → key unchanged
  'property deals': 'property investment',
  // "renting" — 7 chars, ends in 'g' → not stripped
  'renting': 'rental properties',
  // "real estate listings" → step4 → "real estate listing"
  'real estate listing': 'property investment',
  // "stock picking" — "picking" ends in 'g' → not stripped
  'stock picking': 'stock market',
  // "equity investing" — "investing" ends in 'g', "equity" ends in 'y' → not stripped
  'equity investing': 'stock market',
  // "machine learning" — ends in 'g' → not stripped
  'machine learning': 'artificial intelligence',
  // "deep learning" — same
  'deep learning': 'artificial intelligence',
  // "neural networks" → step4 → "neural network" (8 chars stripped)
  // Canonical merge: treat "neural network" as an alias for AI
  'neural network': 'artificial intelligence',
};

/** Leading stop words that are stripped from the very start of a label. */
const LEADING_STOP_WORDS = ['the', 'a', 'an', 'in', 'on', 'for', 'of'];

/**
 * Normalizes a raw topic label through a 5-step pipeline:
 *
 * 1. Lowercase + trim.
 * 2. Strip possessive `'s` at the end of any word.
 * 3. Strip a single leading stop word (the, a, an, in, on, for, of).
 * 4. Strip trailing "s" from words that are ≥ 6 characters long before stripping.
 * 5. Canonical map lookup — if the result matches a key, return its value.
 */
export function normalizeTopicLabel(raw: string): string {
  if (!raw) return '';

  // Step 1: lowercase + trim
  let result = raw.toLowerCase().trim();

  // Step 2: strip possessive 's from any word
  result = result.replace(/(\w)'s\b/g, '$1');

  // Step 3: strip a single leading stop word
  for (const stop of LEADING_STOP_WORDS) {
    const prefix = stop + ' ';
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      break; // only strip one leading stop word
    }
  }

  // Step 4: strip trailing "s" from words that are ≥ 6 chars before stripping
  result = result
    .split(' ')
    .map((word) => (word.length >= 6 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ');

  // Step 5: canonical map lookup
  const canonical = TOPIC_CANONICAL_MAP[result];
  if (canonical !== undefined) {
    return canonical;
  }

  return result.trim();
}
