import { sanitizeUrl, decodeHtmlEntities } from '../utils/validation';
import type { ContentType, UrlSource, MediaType, ContentLocation } from '../types';

export type { UrlSource };

export interface PageMetadata {
  source: UrlSource;
  mediaType: MediaType;
  title?: string;
  description?: string;
  /** Best available thumbnail: OG image, Twitter card, or YouTube thumbnail */
  image?: string;
  location?: ContentLocation;
}

/** Human-readable name for the detected source platform. */
export const URL_SOURCE_LABELS: Record<UrlSource, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  twitter: 'Twitter / X',
  linkedin: 'LinkedIn',
  medium: 'Medium',
  spotify: 'Spotify',
  amazon: 'Amazon',
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
  spotify: 'musical-notes',
  amazon: 'cart',
  news: 'newspaper',
  blog: 'pencil',
  website: 'globe',
};

/** Human-readable label for media type. */
export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  article: 'Article',
  product: 'Product',
  social_post: 'Social Post',
  web: 'Web Page',
};

/** Ionicons icon name for media type. */
export const MEDIA_TYPE_ICONS: Record<MediaType, string> = {
  video: 'play-circle',
  audio: 'mic',
  image: 'image',
  article: 'newspaper',
  product: 'cart',
  social_post: 'chatbubbles',
  web: 'globe',
};

/** Category to icon/emoji and color mapping */
export const CATEGORY_CONFIG: Record<
  string,
  { emoji: string; icon: string; color: string }
> = {
  Finance:       { emoji: '📊', icon: 'cash-outline', color: '#10b981' },
  Technology:    { emoji: '💻', icon: 'hardware-chip-outline', color: '#0ea5e9' },
  Health:        { emoji: '🌿', icon: 'fitness-outline', color: '#14b8a6' },
  Travel:        { emoji: '✈️', icon: 'airplane-outline', color: '#06b6d4' },
  Food:          { emoji: '🍳', icon: 'restaurant-outline', color: '#f97316' },
  Career:        { emoji: '💼', icon: 'briefcase-outline', color: '#8b5cf6' },
  Learning:      { emoji: '📚', icon: 'school-outline', color: '#3b82f6' },
  Entertainment: { emoji: '🎬', icon: 'film-outline', color: '#ec4899' },
  Science:       { emoji: '🔬', icon: 'flask-outline', color: '#6366f1' },
  Sports:        { emoji: '⚽', icon: 'football-outline', color: '#ef4444' },
  Politics:      { emoji: '🏛️', icon: 'globe-outline', color: '#f59e0b' },
  Design:        { emoji: '🎨', icon: 'color-palette-outline', color: '#a855f7' },
  Business:      { emoji: '📈', icon: 'trending-up-outline', color: '#059669' },
  Lifestyle:     { emoji: '☕', icon: 'cafe-outline', color: '#f59e0b' },
  Other:         { emoji: '📌', icon: 'bookmark-outline', color: '#64748b' },
};

/**
 * Derives an exact, descriptive source label (e.g., "Instagram Reel", "YouTube Video", "Medium Article").
 */
export function getExactSourceLabel(source?: UrlSource, mediaType?: MediaType, url?: string): string {
  if (!source && url) {
    source = detectUrlSource(url);
  }
  if (!source || source === 'website') {
    if (url) {
      const host = getDisplayHostname(url);
      if (host) return host;
    }
    return 'Web Page';
  }

  const pathname = (() => {
    if (!url) return '';
    try { return new URL(url).pathname.toLowerCase(); } catch { return ''; }
  })();

  if (source === 'instagram') {
    if (pathname.includes('/reel/') || pathname.includes('/reels/') || mediaType === 'video') {
      return 'Instagram Reel';
    }
    return 'Instagram Post';
  }

  if (source === 'youtube') {
    if (pathname.includes('/shorts/') || pathname.includes('/short/')) {
      return 'YouTube Short';
    }
    return 'YouTube Video';
  }

  if (source === 'medium') {
    return 'Medium Article';
  }

  if (source === 'twitter') {
    return 'X / Twitter Post';
  }

  if (source === 'linkedin') {
    if (pathname.includes('/pulse/') || pathname.includes('/article/')) {
      return 'LinkedIn Article';
    }
    return 'LinkedIn Post';
  }

  if (source === 'spotify') {
    if (pathname.includes('/episode/') || pathname.includes('/show/')) {
      return 'Spotify Podcast';
    }
    return 'Spotify Track';
  }

  if (source === 'amazon') {
    return 'Amazon Product';
  }

  if (source === 'news') {
    return 'News Article';
  }

  if (source === 'blog') {
    return 'Blog Post';
  }

  return URL_SOURCE_LABELS[source] || 'Web Page';
}

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
    spotify: 'podcast',
    amazon: 'product',
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
  if (hostname === 'spotify.com' || hostname.endsWith('.spotify.com')) return 'spotify';
  if (hostname === 'amazon.com' || hostname.endsWith('.amazon.com') || hostname === 'amazon.co.uk' || hostname === 'amazon.de' || hostname === 'amazon.in' || hostname === 'amazon.ca' || hostname === 'amazon.com.au' || hostname === 'amazon.fr' || hostname === 'amazon.es' || hostname === 'amazon.it' || hostname === 'amazon.co.jp') return 'amazon';
  if (NEWS_HOSTS.some((host) => hostname === host.slice(0, -1) || hostname.startsWith(host))) return 'news';
  if (hostname.includes('blog') || new URL(url).pathname.startsWith('/blog')) return 'blog';
  return 'website';
}

/**
 * Derive the broad media type from the detected source and URL pathname.
 * Instagram Reels → social_post + video hint is handled in detectMediaType separately.
 */
export function detectMediaType(source: UrlSource, url: string): MediaType {
  const pathname = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();

  switch (source) {
    case 'youtube':
      return 'video';
    case 'spotify':
      // Podcasts and episodes → audio; playlists → audio
      return 'audio';
    case 'amazon':
      return 'product';
    case 'instagram':
      // Reels are video; regular posts are social_post
      if (pathname.includes('/reel/') || pathname.includes('/reels/')) return 'video';
      return 'social_post';
    case 'twitter':
    case 'linkedin':
      return 'social_post';
    case 'medium':
    case 'news':
    case 'blog':
      return 'article';
    default:
      return 'web';
  }
}

/**
 * Extract YouTube video ID from various YouTube URL forms.
 * Returns null if the URL is not a YouTube video.
 */
function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, '');
    if (hostname === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      // Embedded / short URLs: /embed/<id>, /shorts/<id>
      const match = u.pathname.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Returns the best thumbnail URL for the given URL and source.
 * For YouTube, this is always the hqdefault thumbnail (no network needed).
 * For other sources, the OG/Twitter card image from fetchPageMetadata is used.
 */
export function deriveYouTubeThumbnail(url: string): string | null {
  const id = extractYouTubeVideoId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

function cleanValue(value?: string): string | undefined {
  const cleaned = value?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return cleaned ? decodeHtmlEntities(cleaned) : undefined;
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

/**
 * Extract location hints from HTML meta tags and JSON-LD structured data.
 * Looks for schema.org Place/Event/Article geo annotations and og:locality tags.
 */
function extractLocationFromHtml(html: string): ContentLocation | undefined {
  const location: ContentLocation = {};

  // og:locality, og:country-name (Open Graph extended)
  const city = getMeta(html, 'og:locality') ?? getMeta(html, 'place:location:city');
  const country = getMeta(html, 'og:country-name') ?? getMeta(html, 'place:location:country');
  if (city) location.city = city;
  if (country) location.country = country;

  // JSON-LD: look for "addressLocality", "addressCountry", "latitude", "longitude"
  const jsonLdBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of jsonLdBlocks) {
    try {
      const content = block.replace(/<\/?script[^>]*>/gi, '');
      const data = JSON.parse(content);
      const flatten = (obj: unknown): Record<string, unknown> => {
        if (typeof obj !== 'object' || obj === null) return {};
        if (Array.isArray(obj)) {
          return obj.reduce((acc, item) => ({ ...acc, ...flatten(item) }), {});
        }
        return obj as Record<string, unknown>;
      };
      const flat = flatten(data);

      if (!location.venue && typeof flat.name === 'string') location.venue = flat.name;
      if (!location.city && typeof flat.addressLocality === 'string') location.city = flat.addressLocality;
      if (!location.country && typeof flat.addressCountry === 'string') location.country = flat.addressCountry;
      if (!location.coordinates && typeof flat.latitude === 'number' && typeof flat.longitude === 'number') {
        location.coordinates = { lat: flat.latitude, lng: flat.longitude };
      }
    } catch {
      // Malformed JSON-LD — skip
    }
  }

  const hasData = location.venue || location.city || location.country || location.coordinates;
  return hasData ? location : undefined;
}

export function formatMetadataForAI(metadata: PageMetadata): string {
  const locationParts: string[] = [];
  if (metadata.location?.venue) locationParts.push(metadata.location.venue);
  if (metadata.location?.city) locationParts.push(metadata.location.city);
  if (metadata.location?.country) locationParts.push(metadata.location.country);

  return [
    `Source: ${metadata.source}`,
    `Media type: ${metadata.mediaType}`,
    metadata.title ? `Title: ${metadata.title}` : '',
    metadata.description ? `Description: ${metadata.description}` : '',
    metadata.image ? `Thumbnail: ${metadata.image}` : '',
    locationParts.length > 0 ? `Location: ${locationParts.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function fetchPageMetadata(url: string): Promise<PageMetadata | null> {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return null;

  const source = detectUrlSource(safeUrl);
  const mediaType = detectMediaType(source, safeUrl);

  // For YouTube, derive thumbnail directly from the video ID — no fetch needed.
  const ytThumbnail = source === 'youtube' ? deriveYouTubeThumbnail(safeUrl) : null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(safeUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
    });
    if (!response.ok) {
      // Even if the page 4xx/5xx, we can still return partial data for YouTube.
      if (ytThumbnail) {
        return { source, mediaType, image: ytThumbnail };
      }
      return null;
    }

    const html = await response.text();

    // Thumbnail: prefer OG/Twitter, fall back to YouTube derived thumbnail.
    const ogImage = getMeta(html, 'og:image') ?? getMeta(html, 'twitter:image');
    const image = ogImage ?? ytThumbnail ?? undefined;

    const location = extractLocationFromHtml(html);

    const metadata: PageMetadata = {
      source,
      mediaType,
      title: getMeta(html, 'og:title') ?? getMeta(html, 'twitter:title') ?? getTitle(html),
      description:
        getMeta(html, 'og:description') ??
        getMeta(html, 'twitter:description') ??
        getMeta(html, 'description'),
      image,
      location,
    };

    return metadata.title || metadata.description || metadata.image ? metadata : null;
  } catch {
    // Network error — still return YouTube thumbnail if we have it.
    if (ytThumbnail) {
      return { source, mediaType, image: ytThumbnail };
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
