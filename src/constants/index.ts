import type { ContentType, IconName } from '../types';

export const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  { label: string; icon: IconName; color: string }
> = {
  link:       { label: 'Web Link',   icon: 'link',            color: '#3b82f6' },
  article:    { label: 'Article',    icon: 'newspaper',       color: '#0ea5e9' },
  video:      { label: 'Video',      icon: 'play-circle',     color: '#ef4444' },
  social:     { label: 'Social Post',icon: 'chatbubbles',     color: '#ec4899' },
  recipe:     { label: 'Recipe',     icon: 'restaurant',      color: '#f97316' },
  book:       { label: 'Book',       icon: 'book',            color: '#10b981' },
  podcast:    { label: 'Podcast',    icon: 'mic',             color: '#a855f7' },
  course:     { label: 'Course',     icon: 'school',          color: '#14b8a6' },
  movie:      { label: 'Movie',      icon: 'film',            color: '#8b5cf6' },
  product:    { label: 'Product',    icon: 'cart',            color: '#f59e0b' },
  workout:    { label: 'Workout',    icon: 'barbell',         color: '#ef4444' },
  place:      { label: 'Place',      icon: 'location',        color: '#06b6d4' },
  restaurant: { label: 'Restaurant', icon: 'cafe',            color: '#f59e0b' },
  tool:       { label: 'Tool / App', icon: 'construct',       color: '#6366f1' },
  idea:       { label: 'Idea',       icon: 'bulb',            color: '#eab308' },
  travel:     { label: 'Travel',     icon: 'airplane',        color: '#06b6d4' },
};

export const ALL_CONTENT_TYPES = Object.keys(CONTENT_TYPE_CONFIG) as ContentType[];

export const COLLECTION_ICONS: IconName[] = [
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
    description: 'Claude 3.5 Sonnet, Haiku, Opus',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
    modelPlaceholder: 'claude-3-haiku-20240307',
  },
  {
    id: 'gemini' as const,
    name: 'Google Gemini',
    description: 'Gemini 2.0 Flash, 1.5 Pro',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    modelPlaceholder: 'gemini-2.0-flash',
  },
  {
    id: 'deepseek' as const,
    name: 'DeepSeek',
    description: 'DeepSeek-V3, DeepSeek-R1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    modelPlaceholder: 'deepseek-chat',
  },
  {
    id: 'groq' as const,
    name: 'Groq',
    description: 'Llama 3, Mixtral — ultra fast',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    modelPlaceholder: 'llama-3.3-70b-versatile',
  },
  {
    id: 'indus' as const,
    name: 'Indus',
    description: 'Indus AI models (Indian languages)',
    models: ['indus-1', 'indus-multilingual'],
    modelPlaceholder: 'indus-1',
    requiresBaseUrl: true,
  },
  {
    id: 'watsonx' as const,
    name: 'IBM watsonx',
    description: 'Granite & Llama models',
    models: ['ibm/granite-13b-instruct-v2', 'ibm/granite-3-8b-instruct', 'meta-llama/llama-3-1-70b-instruct'],
    modelPlaceholder: 'ibm/granite-13b-instruct-v2',
    requiresProjectId: true,
  },
  {
    id: 'local' as const,
    name: 'Local LLM',
    description: 'Ollama, LM Studio, or any OpenAI-compatible server',
    models: ['llama3.2', 'mistral', 'phi4', 'gemma3', 'qwen2.5', 'deepseek-r1'],
    modelPlaceholder: 'llama3.2',
    requiresBaseUrl: true,
    isLocal: true,
  },
];
