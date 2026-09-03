import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme, Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { Colors, type ThemeColors, buildDynamicPaperTheme } from '../constants/colors';
import { DEFAULT_APP_SETTINGS, getAppSettings, saveAppSettings } from '../services/settings';
import type { AppSettings } from '../types';

export interface AppearanceLayout {
  cardRadius: number;
  dialogRadius: number;
  sheetRadius: number;
  touchTarget: number;
  spacing: number;
  sectionSpacing: number;
  isExpressive: boolean;
}

interface ThemeContextValue {
  isDark: boolean;
  colors: ThemeColors;
  settings: AppSettings;
  layout: AppearanceLayout;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  colors: Colors.light,
  settings: DEFAULT_APP_SETTINGS,
  layout: { cardRadius: 16, dialogRadius: 24, sheetRadius: 24, touchTarget: 48, spacing: 8, sectionSpacing: 16, isExpressive: false },
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
    const { default: MaterialYou } = await import('react-native-material-you-colors');
    if (!MaterialYou.isSupported) return null;
    const palette = MaterialYou.getMaterialYouPalette('#1A6EE8');
    const accent = palette.system_accent1;
    const neutral = palette.system_neutral1;
    const neutralVariant = palette.system_neutral2;
    return {
      primary: accent[7], onPrimary: accent[1], primaryContainer: accent[3], onPrimaryContainer: accent[11],
      secondary: palette.system_accent2[7], onSecondary: palette.system_accent2[1], secondaryContainer: palette.system_accent2[3], onSecondaryContainer: palette.system_accent2[11],
      tertiary: palette.system_accent3[7], onTertiary: palette.system_accent3[1], tertiaryContainer: palette.system_accent3[3], onTertiaryContainer: palette.system_accent3[11],
      background: neutral[1], surface: neutral[1], surfaceVariant: neutralVariant[3], onBackground: neutral[11], onSurface: neutral[11], onSurfaceVariant: neutralVariant[11],
      outline: neutralVariant[8], outlineVariant: neutralVariant[4],
      surfaceContainer: neutral[2], surfaceContainerHigh: neutral[3],
    };
  } catch {
    // Native system colors are unavailable in Expo Go and Android versions before 12.
    return null;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [dynamicPalette, setDynamicPalette] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    getAppSettings().then(setSettings);
    // Fetch Material You palette once on mount (Android 12+ only)
    getMaterialYouPalette().then(setDynamicPalette);
  }, []);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && systemScheme === 'dark');

  const useDynamicPalette = settings.appearanceStyle !== 'classic' && settings.dynamicColors;
  const paperTheme = buildDynamicPaperTheme(isDark, useDynamicPalette ? dynamicPalette : null);
  const paperColors = paperTheme.colors;
  const colors: ThemeColors = {
    background: settings.amoledBlack && isDark ? '#000000' : paperColors.background,
    surface: settings.amoledBlack && isDark ? '#000000' : paperColors.surface,
    surfaceSecondary: settings.amoledBlack && isDark ? '#000000' : paperColors.surfaceVariant,
    surfaceContainer: settings.amoledBlack && isDark ? '#000000' : paperColors.surfaceContainer,
    surfaceContainerHigh: settings.amoledBlack && isDark ? '#000000' : paperColors.surfaceContainerHigh,
    border: settings.highContrast ? paperColors.outline : paperColors.outlineVariant,
    text: paperColors.onBackground,
    textSecondary: paperColors.onSurfaceVariant,
    textMuted: paperColors.outline,
    icon: paperColors.onSurfaceVariant,
    tabBar: settings.amoledBlack && isDark ? '#000000' : paperColors.surface,
    card: settings.amoledBlack && isDark ? '#000000' : paperColors.surface,
    inputBackground: settings.amoledBlack && isDark ? '#000000' : paperColors.surfaceVariant,
    placeholder: paperColors.outline,
    danger: paperColors.error,
    success: isDark ? '#88D8A3' : '#1B6B3A',
    warning: isDark ? '#FFB951' : '#7A5900',
  };
  const layout: AppearanceLayout = settings.appearanceStyle === 'expressive'
    ? { cardRadius: 24, dialogRadius: 28, sheetRadius: 28, touchTarget: settings.largeTouchTargets ? 56 : 48, spacing: 8, sectionSpacing: 24, isExpressive: true }
    : { cardRadius: 16, dialogRadius: 24, sheetRadius: 24, touchTarget: settings.largeTouchTargets ? 56 : 48, spacing: 8, sectionSpacing: 16, isExpressive: false };

  const updateSettings = async (updates: Partial<AppSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    await saveAppSettings(next);
  };

  // Memoize to prevent all ThemeContext consumers from re-rendering on unrelated parent changes
  const contextValue = useMemo(
    () => ({ isDark, colors, settings, layout, updateSettings }),
    // eslint-disable-next-line -- intentional: updateSettings excluded; it's stable (recreated only when settings changes)
    [isDark, colors, settings, layout]
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
