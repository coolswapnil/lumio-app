export const Colors = {
  // Brand
  primary: '#3b82f6',
  primaryDark: '#1d4ed8',
  accent: '#8b5cf6',

  // Light theme
  light: {
    background: '#ffffff',
    surface: '#f8fafc',
    surfaceSecondary: '#f1f5f9',
    border: '#e2e8f0',
    text: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    icon: '#475569',
    tabBar: '#ffffff',
    card: '#ffffff',
    inputBackground: '#f8fafc',
    placeholder: '#94a3b8',
    danger: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
  },

  // Dark theme
  dark: {
    background: '#0f172a',
    surface: '#1e293b',
    surfaceSecondary: '#334155',
    border: '#334155',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    icon: '#94a3b8',
    tabBar: '#1e293b',
    card: '#1e293b',
    inputBackground: '#334155',
    placeholder: '#64748b',
    danger: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
  },
};

export type ThemeColors = typeof Colors.light;
