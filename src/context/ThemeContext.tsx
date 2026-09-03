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
 * Tone indices are chosen per MD3 spec:
 *   - Light: primary=40, container=90, on-container=10
 *   - Dark:  primary=80, container=30, on-container=90
 */
async function getMaterialYouPalette(isDark: boolean): Promise<Record<string, string> | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const { default: MaterialYou } = await import('react-native-material-you-colors');
    if (!MaterialYou.isSupported) return null;
    const palette = MaterialYou.getMaterialYouPalette('#1A6EE8');
    const accent = palette.system_accent1;
    const accent2 = palette.system_accent2;
    const accent3 = palette.system_accent3;
    const neutral = palette.system_neutral1;
    const neutralVariant = palette.system_neutral2;

    // MD3 tonal palette: indices 0–12 map to tones 0,10,20,30,40,50,60,70,80,90,95,99,100
    // Light scheme: primary=tone40 (idx4), container=tone90 (idx9), on-container=tone10 (idx1)
    // Dark scheme:  primary=tone80 (idx8), container=tone30 (idx3), on-container=tone90 (idx9)
    if (isDark) {
      return {
        primary: accent[8],          onPrimary: accent[2],
        primaryContainer: accent[3], onPrimaryContainer: accent[9],
        secondary: accent2[8],       onSecondary: accent2[2],
        secondaryContainer: accent2[3], onSecondaryContainer: accent2[9],
        tertiary: accent3[8],        onTertiary: accent3[2],
        tertiaryContainer: accent3[3], onTertiaryContainer: accent3[9],
        background: neutral[2],      onBackground: neutral[10],
        surface: neutral[2],         onSurface: neutral[10],
        surfaceVariant: neutralVariant[4], onSurfaceVariant: neutralVariant[10],
        surfaceContainer: neutral[3],
        surfaceContainerHigh: neutral[4],
        surfaceContainerLowest: neutral[1],
        surfaceContainerLow: neutral[2],
        surfaceContainerHighest: neutral[5],
        outline: neutralVariant[7],
        outlineVariant: neutralVariant[4],
      };
    }
    return {
      primary: accent[4],            onPrimary: accent[10],
      primaryContainer: accent[9],   onPrimaryContainer: accent[1],
      secondary: accent2[4],         onSecondary: accent2[10],
      secondaryContainer: accent2[9], onSecondaryContainer: accent2[1],
      tertiary: accent3[4],          onTertiary: accent3[10],
      tertiaryContainer: accent3[9], onTertiaryContainer: accent3[1],
      background: neutral[11],       onBackground: neutral[2],
      surface: neutral[11],          onSurface: neutral[2],
      surfaceVariant: neutralVariant[9], onSurfaceVariant: neutralVariant[4],
      surfaceContainer: neutral[10],
      surfaceContainerHigh: neutral[9],
      surfaceContainerLowest: neutral[12],
      surfaceContainerLow: neutral[11],
      surfaceContainerHighest: neutral[8],
      outline: neutralVariant[5],
      outlineVariant: neutralVariant[9],
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
  }, []);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && systemScheme === 'dark');

  // Re-fetch Material You palette whenever isDark or the appearance style changes,
  // so the dark/light tone selection is always correct.
  useEffect(() => {
    const useDynamic = settings.appearanceStyle !== 'classic' && settings.dynamicColors;
    if (!useDynamic) {
      setDynamicPalette(null);
      return;
    }
    getMaterialYouPalette(isDark).then(setDynamicPalette);
  }, [isDark, settings.appearanceStyle, settings.dynamicColors]);

  const amoledBlack = Boolean(settings.amoledBlack && isDark);
  const useDynamicPalette = settings.appearanceStyle !== 'classic' && settings.dynamicColors;

  // paperTheme is the single source of truth for ALL Paper components.
  // AMOLED overrides are baked in here so Card, Chip, Searchbar, etc. pick them up.
  const paperTheme = buildDynamicPaperTheme(
    isDark,
    useDynamicPalette ? dynamicPalette : null,
    amoledBlack
  );
  const paperColors = paperTheme.colors;

  // Custom ThemeColors mirrors the Paper colors so non-Paper components
  // (TextInput, plain View, etc.) can also use themed values.
  const colors: ThemeColors = {
    background: paperColors.background,
    surface: paperColors.surface,
    surfaceSecondary: paperColors.surfaceVariant,
    surfaceContainer: paperColors.surfaceContainer,
    surfaceContainerHigh: paperColors.surfaceContainerHigh,
    border: settings.highContrast ? paperColors.outline : paperColors.outlineVariant,
    text: paperColors.onBackground,
    textSecondary: paperColors.onSurfaceVariant,
    textMuted: paperColors.outline,
    icon: paperColors.onSurfaceVariant,
    tabBar: paperColors.surface,
    card: paperColors.surface,
    inputBackground: paperColors.surfaceVariant,
    placeholder: paperColors.outline,
    danger: paperColors.error,
    success: isDark ? '#88D8A3' : '#1B6B3A',
    warning: isDark ? '#FFB951' : '#7A5900',
  };

  const layout: AppearanceLayout = settings.appearanceStyle === 'expressive'
    ? {
        cardRadius: 28,
        dialogRadius: 28,
        sheetRadius: 28,
        touchTarget: settings.largeTouchTargets ? 56 : 52,
        spacing: 12,
        sectionSpacing: 28,
        isExpressive: true,
      }
    : {
        cardRadius: 16,
        dialogRadius: 24,
        sheetRadius: 24,
        touchTarget: settings.largeTouchTargets ? 56 : 48,
        spacing: 8,
        sectionSpacing: 16,
        isExpressive: false,
      };

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
