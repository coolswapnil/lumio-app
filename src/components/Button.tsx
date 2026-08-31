import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = false,
}: ButtonProps) {
  const { colors } = useTheme();

  const bgColors: Record<string, string> = {
    primary: '#3b82f6',
    secondary: colors.surfaceSecondary,
    danger: colors.danger,
    ghost: 'transparent',
  };

  const textColors: Record<string, string> = {
    primary: '#ffffff',
    secondary: colors.text,
    danger: '#ffffff',
    ghost: '#3b82f6',
  };

  const paddingMap: Record<string, number> = { sm: 8, md: 12, lg: 16 };
  const fontSizeMap: Record<string, number> = { sm: 13, md: 15, lg: 17 };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        styles.base,
        {
          backgroundColor: bgColors[variant],
          paddingVertical: paddingMap[size],
          paddingHorizontal: paddingMap[size] * 1.8,
          opacity: disabled ? 0.5 : 1,
          width: fullWidth ? '100%' : undefined,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColors[variant]} size="small" />
      ) : (
        <Text
          style={[
            styles.text,
            { color: textColors[variant], fontSize: fontSizeMap[size] },
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  text: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
