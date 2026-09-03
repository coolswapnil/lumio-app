import * as SecureStore from 'expo-secure-store';
import type { AISettings, AppSettings } from '../types';

const SETTINGS_KEY = 'lumio_app_settings';
const AI_KEY = 'lumio_ai_settings';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  appearanceStyle: 'classic',
  dynamicColors: true,
  useThemedIcon: true,
  amoledBlack: false,
  edgeToEdge: true,
  dynamicNavigationBar: true,
  dynamicStatusBar: true,
  reduceMotion: false,
  compactLayout: false,
  largeTouchTargets: false,
  highContrast: false,
  diagnosticsEnabled: false,
};

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_APP_SETTINGS, ...(JSON.parse(raw) as AppSettings) };
  } catch {
    // Return defaults on error
  }
  return DEFAULT_APP_SETTINGS;
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
}

export async function getAISettings(): Promise<AISettings | null> {
  try {
    const raw = await SecureStore.getItemAsync(AI_KEY);
    if (raw) return JSON.parse(raw) as AISettings;
  } catch {
    // Return null on error
  }
  return null;
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  // Store the API key securely — never log or expose it
  await SecureStore.setItemAsync(AI_KEY, JSON.stringify(settings));
}

export async function clearAISettings(): Promise<void> {
  await SecureStore.deleteItemAsync(AI_KEY);
}
