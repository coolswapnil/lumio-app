import { MD3LightTheme, MD3DarkTheme, useTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';

// ─── MD3 Expressive static seed palette (blue-toned, Material You fallback) ───
const md3Seeds = {
  primary: '#1A6EE8',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D8E2FF',
  onPrimaryContainer: '#001451',

  secondary: '#575E71',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#DBE2F9',
  onSecondaryContainer: '#141B2C',

  tertiary: '#715573',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FBD7FC',
  onTertiaryContainer: '#29132D',

  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',

  surface: '#F9F9FF',
  onSurface: '#1A1B20',
  surfaceVariant: '#E1E2EC',
  onSurfaceVariant: '#44464F',

  // MD3 Expressive surface container tokens
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F3F3FA',
  surfaceContainer: '#EDEDF4',
  surfaceContainerHigh: '#E7E8EE',
  surfaceContainerHighest: '#E2E2E9',

  outline: '#757780',
  outlineVariant: '#C5C6D0',

  background: '#F9F9FF',
  onBackground: '#1A1B20',

  inverseSurface: '#2F3038',
  inverseOnSurface: '#F1F0F7',
  inversePrimary: '#AEBEFF',

  shadow: '#000000',
  scrim: '#000000',

  surfaceDisabled: 'rgba(26, 27, 32, 0.12)',
  onSurfaceDisabled: 'rgba(26, 27, 32, 0.38)',

  // Extended semantic tokens
  success: '#1B6B3A',
  onSuccess: '#FFFFFF',
  successContainer: '#A4F4BE',

  warning: '#7A5900',
  warningContainer: '#FFDF9E',
};

const md3SeedsDark = {
  primary: '#AEBEFF',
  onPrimary: '#002978',
  primaryContainer: '#0040A9',
  onPrimaryContainer: '#D8E2FF',

  secondary: '#BFC6DC',
  onSecondary: '#293041',
  secondaryContainer: '#3F4759',
  onSecondaryContainer: '#DBE2F9',

  tertiary: '#DEBCDF',
  onTertiary: '#3F2844',
  tertiaryContainer: '#583D5B',
  onTertiaryContainer: '#FBD7FC',

  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',

  surface: '#121318',
  onSurface: '#E3E2EA',
  surfaceVariant: '#44464F',
  onSurfaceVariant: '#C5C6D0',

  // MD3 Expressive surface container tokens (dark)
  surfaceContainerLowest: '#0D0E13',
  surfaceContainerLow: '#1A1B20',
  surfaceContainer: '#1E1F25',
  surfaceContainerHigh: '#282930',
  surfaceContainerHighest: '#33343B',

  outline: '#8E9099',
  outlineVariant: '#44464F',

  background: '#121318',
  onBackground: '#E3E2EA',

  inverseSurface: '#E3E2EA',
  inverseOnSurface: '#2F3038',
  inversePrimary: '#1A6EE8',

  shadow: '#000000',
  scrim: '#000000',

  surfaceDisabled: 'rgba(227, 226, 234, 0.12)',
  onSurfaceDisabled: 'rgba(227, 226, 234, 0.38)',

  success: '#88D8A3',
  onSuccess: '#00391B',
  successContainer: '#00522A',

  warning: '#FFB951',
  warningContainer: '#5E4200',
};

// ─── AMOLED overrides — pure black surfaces, preserve accent colors ───────────
const amoledOverrides = {
  background: '#000000',
  surface: '#000000',
  surfaceVariant: '#0A0A0A',
  surfaceContainerLowest: '#000000',
  surfaceContainerLow: '#000000',
  surfaceContainer: '#0A0A0A',
  surfaceContainerHigh: '#0F0F0F',
  surfaceContainerHighest: '#141414',
};

// ─── Static Paper themes (used when Material You palette is unavailable) ──────
export const LightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...md3Seeds,
  },
};

export const DarkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...md3SeedsDark,
  },
};

/**
 * Builds a Paper MD3 theme by merging:
 *  1. The static seed palette as base.
 *  2. The Android 12+ Material You dynamic palette (when available).
 *  3. AMOLED pure-black surface overrides (when amoledBlack && isDark).
 *
 * All Paper components (Card, Chip, Searchbar…) use `paper.colors.*` directly,
 * so every surface override MUST live in the Paper theme — not just in the
 * custom ThemeContext `colors` object.
 */
export function buildDynamicPaperTheme(
  isDark: boolean,
  dynamicPalette: Record<string, string> | null,
  amoledBlack = false
) {
  const base = isDark ? DarkTheme : LightTheme;

  // Start from base, then apply dynamic palette if available
  const withDynamic = dynamicPalette
    ? { ...base, colors: { ...base.colors, ...dynamicPalette } }
    : base;

  // Apply AMOLED overrides on top when dark mode is active
  if (amoledBlack && isDark) {
    return {
      ...withDynamic,
      colors: {
        ...withDynamic.colors,
        ...amoledOverrides,
      },
    };
  }

  return withDynamic;
}

// ─── Legacy color map for components not yet on Paper ─────────────────────────
export const Colors = {
  primary: '#1A6EE8',
  primaryDark: '#0040A9',
  accent: '#715573',

  light: {
    background: md3Seeds.background,
    surface: md3Seeds.surface,
    surfaceSecondary: md3Seeds.surfaceVariant,
    surfaceContainer: md3Seeds.surfaceContainer,
    surfaceContainerHigh: md3Seeds.surfaceContainerHigh,
    border: md3Seeds.outlineVariant,
    text: md3Seeds.onBackground,
    textSecondary: md3Seeds.onSurfaceVariant,
    textMuted: md3Seeds.outline,
    icon: md3Seeds.onSurfaceVariant,
    tabBar: md3Seeds.surface,
    card: md3Seeds.surface,
    inputBackground: md3Seeds.surfaceVariant,
    placeholder: md3Seeds.outline,
    danger: md3Seeds.error,
    success: md3Seeds.success,
    warning: md3Seeds.warning,
  },

  dark: {
    background: md3SeedsDark.background,
    surface: md3SeedsDark.surface,
    surfaceSecondary: md3SeedsDark.surfaceVariant,
    surfaceContainer: md3SeedsDark.surfaceContainer,
    surfaceContainerHigh: md3SeedsDark.surfaceContainerHigh,
    border: md3SeedsDark.outlineVariant,
    text: md3SeedsDark.onBackground,
    textSecondary: md3SeedsDark.onSurfaceVariant,
    textMuted: md3SeedsDark.outline,
    icon: md3SeedsDark.onSurfaceVariant,
    tabBar: md3SeedsDark.surface,
    card: md3SeedsDark.surface,
    inputBackground: md3SeedsDark.surfaceVariant,
    placeholder: md3SeedsDark.outline,
    danger: md3SeedsDark.error,
    success: md3SeedsDark.success,
    warning: md3SeedsDark.warning,
  },
};

export type ThemeColors = typeof Colors.light;

/**
 * Extended MD3 color roles added on top of the base react-native-paper palette.
 * These are the MD3 Expressive surface container tokens that Paper's type
 * definitions don't include yet (MD3Colors is a `type` alias, not an interface,
 * so declaration merging is not possible).
 */
export type AppColors = MD3Theme['colors'] & {
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
};

export type AppTheme = Omit<MD3Theme, 'colors'> & {
  colors: AppColors;
};

/**
 * Typed variant of react-native-paper's `useTheme` that returns `AppTheme`.
 * Use this instead of `useTheme as usePaperTheme` so that
 * `paper.colors.surfaceContainerHigh` etc. are properly typed.
 */
export function useAppTheme() {
  return useTheme<AppTheme>();
}
