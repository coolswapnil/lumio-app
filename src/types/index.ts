// Type definitions for Lumio app
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

/**
 * Strongly-typed Ionicons icon name.
 * Eliminates `as any` casts throughout the codebase.
 */
export type IconName = ComponentProps<typeof Ionicons>['name'];

export type ContentType =
  | 'link'
  | 'article'
  | 'video'
  | 'recipe'
  | 'book'
  | 'movie'
  | 'workout'
  | 'place'
  | 'restaurant'
  | 'tool'
  | 'idea'
  | 'travel'
  | 'social'
  | 'podcast'
  | 'course'
  | 'product';

export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'watsonx'
  | 'gemini'
  | 'deepseek'
  | 'groq'
  | 'indus'
  | 'local';

export interface SavedItem {
  /** UUID v4 */
  id: string;
  /** Max 200 characters */
  title: string;
  /** Max 2000 characters */
  description?: string;
  /** Validated http(s) URL, max 2048 characters */
  url?: string;
  imageUrl?: string;
  contentType: ContentType;
  collectionId?: string;
  /** Array of lowercase tags, each max 50 chars, max 20 tags */
  tags: string[];
  /** Max 5000 characters */
  notes?: string;
  /** Place name / address text from saved content, max 300 chars */
  address?: string;
  /** GPS latitude (optional, from expo-location) */
  latitude?: number;
  /** GPS longitude (optional, from expo-location) */
  longitude?: number;
  isCompleted: boolean;
  isFavorite: boolean;
  aiSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  /** Ionicons icon name */
  icon: IconName;
  color: string;
  /** Cached item count from the database JOIN */
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AISettings {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  // IBM watsonx extras
  watsonxProjectId?: string;
  watsonxRegion?: string;
  // Local LLM (Ollama / LM Studio / any OpenAI-compatible server)
  localBaseUrl?: string;
}

export type AppearanceStyle = 'classic' | 'material-you' | 'expressive';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  appearanceStyle?: AppearanceStyle;
  dynamicColors?: boolean;
  useThemedIcon?: boolean;
  amoledBlack?: boolean;
  edgeToEdge?: boolean;
  dynamicNavigationBar?: boolean;
  dynamicStatusBar?: boolean;
  reduceMotion?: boolean;
  compactLayout?: boolean;
  largeTouchTargets?: boolean;
  highContrast?: boolean;
  defaultCollection?: string;
  aiSettings?: AISettings;
  mapDefaultLat?: number;
  mapDefaultLng?: number;
}

export type SortOption = 'newest' | 'oldest' | 'alphabetical' | 'type';
export type FilterOption = ContentType | 'all' | 'favorites' | 'completed';
