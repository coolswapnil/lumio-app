import type { ContentType } from '../types';

export const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  { label: string; icon: string; color: string }
> = {
  link: { label: 'Web Link', icon: 'link', color: '#3b82f6' },
  video: { label: 'Video', icon: 'play-circle', color: '#ef4444' },
  recipe: { label: 'Recipe', icon: 'restaurant', color: '#f97316' },
  book: { label: 'Book', icon: 'book', color: '#10b981' },
  movie: { label: 'Movie / Show', icon: 'film', color: '#8b5cf6' },
  workout: { label: 'Workout', icon: 'barbell', color: '#ef4444' },
  place: { label: 'Place', icon: 'location', color: '#06b6d4' },
  restaurant: { label: 'Restaurant', icon: 'cafe', color: '#f59e0b' },
  tool: { label: 'Tool / App', icon: 'construct', color: '#6366f1' },
  idea: { label: 'Idea', icon: 'bulb', color: '#eab308' },
  travel: { label: 'Travel', icon: 'airplane', color: '#06b6d4' },
};

export const ALL_CONTENT_TYPES = Object.keys(CONTENT_TYPE_CONFIG) as ContentType[];

export const COLLECTION_ICONS = [
  'folder', 'bookmark', 'heart', 'star', 'trophy',
  'airplane', 'restaurant', 'cafe', 'film', 'book',
  'barbell', 'construct', 'bulb', 'location', 'map',
  'school', 'briefcase', 'cart', 'musical-notes', 'camera',
];

export const COLLECTION_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6',
  '#06b6d4', '#f59e0b', '#6366f1', '#eab308', '#ec4899',
  '#14b8a6', '#84cc16', '#f43f5e', '#a855f7', '#0ea5e9',
];

export const AI_PROVIDERS = [
  {
    id: 'openai' as const,
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o-mini',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    modelPlaceholder: 'gpt-4o-mini',
  },
  {
    id: 'anthropic' as const,
    name: 'Anthropic Claude',
    description: 'Claude 3 Haiku, Sonnet, Opus',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
    modelPlaceholder: 'claude-3-haiku-20240307',
  },
  {
    id: 'gemini' as const,
    name: 'Google Gemini',
    description: 'Gemini 1.5 Flash, Pro',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'],
    modelPlaceholder: 'gemini-1.5-flash',
  },
  {
    id: 'watsonx' as const,
    name: 'IBM watsonx',
    description: 'Granite & Llama models',
    models: ['ibm/granite-13b-instruct-v2', 'ibm/granite-3-8b-instruct', 'meta-llama/llama-3-1-70b-instruct'],
    modelPlaceholder: 'ibm/granite-13b-instruct-v2',
    requiresProjectId: true,
  },
];
