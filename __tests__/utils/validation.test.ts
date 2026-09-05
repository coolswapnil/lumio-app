/**
 * Unit tests for src/utils/validation.ts
 */
import {
  isValidUrl,
  sanitizeUrl,
  asString,
  isValidId,
  sanitizeText,
  decodeHtmlEntities,
  parseTags,
  extractSafeUrl,
  LIMITS,
} from '../../src/utils/validation';

describe('isValidUrl', () => {
  it('accepts valid https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('accepts valid http URLs', () => {
    expect(isValidUrl('http://localhost:3000')).toBe(true);
  });

  it('rejects javascript: scheme', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URIs', () => {
    expect(isValidUrl('data:text/html,<h1>test</h1>')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl('   ')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('ftp://files.example.com')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isValidUrl('http://..invalid..')).toBe(false);
  });
});

describe('sanitizeUrl', () => {
  it('returns trimmed valid URL', () => {
    expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('returns empty string for invalid URL', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('not-a-url')).toBe('');
  });

  it('enforces max length', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(LIMITS.URL);
    expect(sanitizeUrl(longUrl).length).toBeLessThanOrEqual(LIMITS.URL);
  });
});

describe('asString', () => {
  it('returns empty string for undefined', () => {
    expect(asString(undefined)).toBe('');
  });

  it('returns first element of array', () => {
    expect(asString(['first', 'second'])).toBe('first');
  });

  it('returns the string if plain string', () => {
    expect(asString('hello')).toBe('hello');
  });

  it('strips control characters', () => {
    expect(asString('hello\x00world')).toBe('helloworld');
  });

  it('trims whitespace', () => {
    expect(asString('  hello  ')).toBe('hello');
  });
});

describe('isValidId', () => {
  it('accepts UUID v4 format', () => {
    expect(isValidId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts simple alphanumeric IDs', () => {
    expect(isValidId('abc123')).toBe(true);
    expect(isValidId('my-collection_1')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('rejects IDs that are too long', () => {
    expect(isValidId('a'.repeat(65))).toBe(false);
  });

  it('rejects IDs with special characters', () => {
    expect(isValidId('id with spaces')).toBe(false);
    expect(isValidId('<script>')).toBe(false);
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes hex and decimal numeric entities', () => {
    expect(decodeHtmlEntities('&#x1f4c8; &#x20b9; &#x2019; &#x1f4b0;')).toBe('📈 ₹ ’ 💰');
    expect(decodeHtmlEntities('&#8377; 500')).toBe('₹ 500');
  });

  it('decodes named entities', () => {
    expect(decodeHtmlEntities('&amp; &quot; &#39; &lt; &gt; &nbsp;')).toBe('& " \' < >  ');
  });

  it('handles empty or non-string inputs safely', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

describe('sanitizeText', () => {
  it('trims whitespace and decodes html entities', () => {
    expect(sanitizeText('  &#x20b9;1.2L Dividend Income Plan  ', 100)).toBe('₹1.2L Dividend Income Plan');
  });

  it('enforces max length', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeText(long, 200).length).toBe(200);
  });

  it('allows empty string', () => {
    expect(sanitizeText('', 100)).toBe('');
  });
});

describe('parseTags', () => {
  it('splits on commas and trims', () => {
    expect(parseTags('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('lowercases all tags', () => {
    expect(parseTags('React, Native')).toEqual(['react', 'native']);
  });

  it('deduplicates tags', () => {
    expect(parseTags('a, a, b')).toEqual(['a', 'b']);
  });

  it('removes empty entries', () => {
    expect(parseTags('a,,b,')).toEqual(['a', 'b']);
  });

  it('truncates tags exceeding max count', () => {
    const tooMany = Array.from({ length: 30 }, (_, i) => `tag${i}`).join(',');
    expect(parseTags(tooMany).length).toBe(LIMITS.TAG_COUNT);
  });

  it('truncates individual tags exceeding max length', () => {
    const longTag = 'a'.repeat(100);
    const result = parseTags(longTag);
    expect(result[0].length).toBe(LIMITS.TAG);
  });

  it('returns empty array for empty input', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags('  ')).toEqual([]);
  });
});

describe('extractSafeUrl', () => {
  it('returns the URL for valid http(s) links', () => {
    expect(extractSafeUrl('https://example.com')).toBe('https://example.com');
  });

  it('returns null for non-URL text', () => {
    expect(extractSafeUrl('some plain text')).toBeNull();
  });

  it('returns null for dangerous schemes', () => {
    expect(extractSafeUrl('javascript:alert(1)')).toBeNull();
    expect(extractSafeUrl('data:text/html,<b>hi</b>')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractSafeUrl('')).toBeNull();
  });
});
