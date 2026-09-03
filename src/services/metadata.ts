import { sanitizeUrl } from '../utils/validation';
import type { ContentType } from '../types';

export type UrlSource =
  | 'instagram'
  | 'youtube'
  | 'twitter'
  | 'linkedin'
  | 'medium'
  | 'news'
  | 'blog'
  | 'website';

export interface PageMetadata {
  source: UrlSource;
  title?: string;
  description?: string;
  image?: string;
}

/** Human-readable name for the detected source platform. */
export const URL_SOURCE_LABELS: Record<UrlSource, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  twitter: 'Twitter / X',
  linkedin: 'LinkedIn',
  medium: 'Medium',
  news: 'News Article',
  blog: 'Blog Post',
  website: 'Web Page',
};

/** Ionicons icon name for the detected source platform. */
export const URL_SOURCE_ICONS: Record<UrlSource, string> = {
  instagram: 'logo-instagram',
  youtube: 'logo-youtube',
  twitter: 'logo-twitter',
  linkedin: 'logo-linkedin',
  medium: 'reader',
  news: 'newspaper',
  blog: 'pencil',
  website: 'globe',
};

/**
 * Returns the display hostname for a URL (e.g. "instagram.com").
 * Falls back to the full URL if parsing fails.
 */
export function getDisplayHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Suggest a ContentType from the detected UrlSource so auto-select is smart.
 */
export function suggestContentType(source: UrlSource): ContentType | null {
  const map: Partial<Record<UrlSource, ContentType>> = {
    instagram: 'social',
    twitter: 'social',
    linkedin: 'social',
    youtube: 'video',
    medium: 'article',
    news: 'article',
    blog: 'article',
  };
  return map[source] ?? null;
}

const NEWS_HOSTS = [
  'bbc.',
  'cnn.',
  'nytimes.',
  'theguardian.',
  'reuters.',
  'apnews.',
  'washingtonpost.',
  'bloomberg.',
];

export function detectUrlSource(url: string): UrlSource {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');

  if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) return 'instagram';
  if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be') return 'youtube';
  if (hostname === 'twitter.com' || hostname.endsWith('.twitter.com') || hostname === 'x.com' || hostname.endsWith('.x.com')) return 'twitter';
  if (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')) return 'linkedin';
  if (hostname === 'medium.com' || hostname.endsWith('.medium.com')) return 'medium';
  if (NEWS_HOSTS.some((host) => hostname === host.slice(0, -1) || hostname.startsWith(host))) return 'news';
  if (hostname.includes('blog') || new URL(url).pathname.startsWith('/blog')) return 'blog';
  return 'website';
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x27;/gi, "'");
}

function cleanValue(value?: string): string | undefined {
  const cleaned = value?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return cleaned ? decodeHtml(cleaned) : undefined;
}

function getMeta(html: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, 'i'),
  ];
  return cleanValue(patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean));
}

function getTitle(html: string): string | undefined {
  return cleanValue(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
}

export function formatMetadataForAI(metadata: PageMetadata): string {
  return [
    `Source: ${metadata.source}`,
    metadata.title ? `Title: ${metadata.title}` : '',
    metadata.description ? `Description: ${metadata.description}` : '',
    metadata.image ? `OpenGraph image: ${metadata.image}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function fetchPageMetadata(url: string): Promise<PageMetadata | null> {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return null;

  const source = detectUrlSource(safeUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(safeUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const html = await response.text();
    const metadata: PageMetadata = {
      source,
      title: getMeta(html, 'og:title') ?? getMeta(html, 'twitter:title') ?? getTitle(html),
      description:
        getMeta(html, 'og:description') ??
        getMeta(html, 'twitter:description') ??
        getMeta(html, 'description'),
      image: getMeta(html, 'og:image') ?? getMeta(html, 'twitter:image'),
    };

    return metadata.title || metadata.description || metadata.image ? metadata : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
