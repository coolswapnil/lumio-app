import React from 'react';
import { ViewStyle, TextStyle } from 'react-native';
import { Button as PaperButton } from 'react-native-paper';

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

/**
 * MD3-compliant button using react-native-paper.
 * Maps the legacy variant names to Paper's MD3 button modes:
 *   primary  → contained  (filled, uses theme primary)
 *   secondary → outlined  (uses theme outline)
 *   danger   → contained  (uses error color)
 *   ghost    → text       (no background)
 */
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
  const modeMap: Record<string, 'contained' | 'outlined' | 'text' | 'contained-tonal' | 'elevated'> = {
    primary: 'contained',
    secondary: 'outlined',
    danger: 'contained',
    ghost: 'text',
  };

  const fontSizeMap: Record<string, number> = { sm: 13, md: 15, lg: 17 };
  const paddingMap: Record<string, number> = { sm: 0, md: 2, lg: 6 };

  return (
    <PaperButton
      mode={modeMap[variant]}
      onPress={onPress}
      loading={loading}
      disabled={disabled || loading}
      buttonColor={variant === 'danger' ? undefined : undefined}
      // Pass buttonColor only for danger to use error role
      {...(variant === 'danger' && { buttonColor: undefined, theme: { colors: { primary: '#BA1A1A' } } })}
      contentStyle={{
        paddingVertical: paddingMap[size],
        width: fullWidth ? '100%' : undefined,
      }}
      labelStyle={[
        {
          fontSize: fontSizeMap[size],
          fontWeight: '600',
          letterSpacing: 0.1,
        },
        textStyle,
      ]}
      style={[
        fullWidth ? { width: '100%' } : undefined,
        style,
      ]}
    >
      {title}
    </PaperButton>
  );
}
