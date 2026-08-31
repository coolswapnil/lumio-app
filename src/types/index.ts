// Type definitions for Lumio app

export type ContentType =
  | 'link'
  | 'video'
  | 'recipe'
  | 'book'
  | 'movie'
  | 'workout'
  | 'place'
  | 'restaurant'
  | 'tool'
  | 'idea'
  | 'travel';

export type AIProvider = 'openai' | 'anthropic' | 'watsonx' | 'gemini';

export interface SavedItem {
  id: string;
  title: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  contentType: ContentType;
  collectionId?: string;
  tags: string[];
  notes?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
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
  icon: string;
  color: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AISettings {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  watsonxProjectId?: string;
  watsonxRegion?: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  defaultCollection?: string;
  aiSettings?: AISettings;
  mapDefaultLat?: number;
  mapDefaultLng?: number;
}

export type SortOption = 'newest' | 'oldest' | 'alphabetical' | 'type';
export type FilterOption = ContentType | 'all' | 'favorites' | 'completed';
