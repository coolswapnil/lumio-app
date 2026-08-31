import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { Colors, type ThemeColors } from '../constants/colors';
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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [settings, setSettings] = useState<AppSettings>({ theme: 'system' });

  useEffect(() => {
    getAppSettings().then(setSettings);
  }, []);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && systemScheme === 'dark');

  const colors = isDark ? Colors.dark : Colors.light;

  const updateSettings = async (updates: Partial<AppSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    await saveAppSettings(next);
  };

  return (
    <ThemeContext.Provider value={{ isDark, colors, settings, updateSettings }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
