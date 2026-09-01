import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme, Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { Colors, LightTheme, DarkTheme, type ThemeColors, buildDynamicPaperTheme } from '../constants/colors';
import { getAppSettings, saveAppSettings } from '../services/settings';
import type { AppSettings } from '../types';

interface ThemeContextValue {
  isDark: boolean;
  colors: ThemeColors;
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  colors: Colors.light,
  settings: { theme: 'system' },
  updateSettings: async () => {},
});

/**
 * Attempts to read the Android 12+ Material You system color palette.
 * Falls back to `null` on older Android versions and on iOS.
 * Importing dynamically avoids crashes on platforms without the native module.
 */
async function getMaterialYouPalette(): Promise<Record<string, string> | null> {
  if (Platform.OS !== 'android') return null;
  try {
    // react-native-material-you-colors ships a native module; available from Android 12 (S / API 31+)
    const { getMaterialYouColors } = await import('react-native-material-you-colors');
    const palette = await getMaterialYouColors();
    return palette ?? null;
  } catch {
    // Module not available (Android < 12, not installed, or running on Expo Go)
    return null;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [settings, setSettings] = useState<AppSettings>({ theme: 'system' });
  const [dynamicPalette, setDynamicPalette] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    getAppSettings().then(setSettings);
    // Fetch Material You palette once on mount (Android 12+ only)
    getMaterialYouPalette().then(setDynamicPalette);
  }, []);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && systemScheme === 'dark');

  const colors = isDark ? Colors.dark : Colors.light;

  // Build the Paper theme: use dynamic palette when available, static seed otherwise
  const paperTheme = buildDynamicPaperTheme(isDark, dynamicPalette);

  const updateSettings = async (updates: Partial<AppSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    await saveAppSettings(next);
  };

  // Memoize to prevent all ThemeContext consumers from re-rendering on unrelated parent changes
  const contextValue = useMemo(
    () => ({ isDark, colors, settings, updateSettings }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDark, colors, settings]
    // updateSettings is intentionally excluded — it's stable (doesn't change identity)
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <PaperProvider theme={paperTheme}>
        {children}
      </PaperProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
