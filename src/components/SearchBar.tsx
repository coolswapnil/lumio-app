import React from 'react';
import { StyleSheet } from 'react-native';
import { Searchbar } from 'react-native-paper';
import { useTheme } from '../context/ThemeContext';
import { useAppTheme } from '../constants/colors';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
}

/**
 * MD3-compliant search bar using react-native-paper Searchbar.
 * Inherits dynamic Material You colors from the Paper theme.
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search saved items…',
  onClear,
}: SearchBarProps) {
  const paper = useAppTheme();
  const { layout, colors } = useTheme();

  return (
    <Searchbar
      value={value}
      onChangeText={onChangeText}
      onClearIconPress={onClear ?? (() => onChangeText(''))}
      placeholder={placeholder}
      style={[
        styles.bar,
        {
          backgroundColor: colors.surfaceContainerHigh,
          borderRadius: layout.isExpressive ? 28 : 24,
          elevation: layout.isExpressive ? 2 : 0,
        },
      ]}
      inputStyle={{ color: paper.colors.onSurface, fontSize: 15 }}
      placeholderTextColor={paper.colors.onSurfaceVariant}
      iconColor={paper.colors.onSurfaceVariant}
      clearIcon="close-circle"
      elevation={0}
      accessibilityLabel="Search"
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: 28,
    height: 48,
  },
});
