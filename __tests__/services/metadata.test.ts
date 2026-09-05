import { detectUrlSource, fetchPageMetadata, formatMetadataForAI, getExactSourceLabel } from '../../src/services/metadata';

global.fetch = jest.fn();

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

function mockResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe('metadata service', () => {
  beforeEach(() => mockFetch.mockReset());

  it.each([
    ['https://www.instagram.com/p/example/', 'instagram'],
    ['https://youtu.be/example', 'youtube'],
    ['https://x.com/example/status/1', 'twitter'],
    ['https://www.linkedin.com/posts/example', 'linkedin'],
    ['https://medium.com/@author/example', 'medium'],
    ['https://www.bbc.com/news/example', 'news'],
    ['https://example.com/blog/post', 'blog'],
  ])('detects %s as %s', (url, source) => {
    expect(detectUrlSource(url)).toBe(source);
  });

  it('extracts OpenGraph metadata for AI input', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(`
        <meta property="og:title" content="OpenGraph title">
        <meta property="og:description" content="OpenGraph description">
        <meta property="og:image" content="https://example.com/image.jpg">
        <title>Document title</title>
      `)
    );

    const metadata = await fetchPageMetadata('https://example.com/article');

    expect(metadata).toEqual({
      source: 'website',
      mediaType: 'web',
      location: undefined,
      title: 'OpenGraph title',
      description: 'OpenGraph description',
      image: 'https://example.com/image.jpg',
    });
    expect(formatMetadataForAI(metadata!)).toContain('OpenGraph description');
  });

  it('resolves exact source labels properly', () => {
    expect(getExactSourceLabel('instagram', 'video', 'https://instagram.com/reel/123')).toBe('Instagram Reel');
    expect(getExactSourceLabel('instagram', 'social_post', 'https://instagram.com/p/123')).toBe('Instagram Post');
    expect(getExactSourceLabel('youtube', 'video', 'https://youtube.com/watch?v=123')).toBe('YouTube Video');
    expect(getExactSourceLabel('youtube', 'video', 'https://youtube.com/shorts/123')).toBe('YouTube Short');
    expect(getExactSourceLabel('medium', 'article', 'https://medium.com/@user/story')).toBe('Medium Article');
  });

  it('returns null when page metadata cannot be extracted', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('', 403));
    await expect(fetchPageMetadata('https://example.com/private')).resolves.toBeNull();
  });
});
