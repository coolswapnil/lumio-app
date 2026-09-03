import React from 'react';
import { StyleSheet } from 'react-native';
import { Searchbar, useTheme as usePaperTheme } from 'react-native-paper';
import { useTheme } from '../context/ThemeContext';

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
  const paper = usePaperTheme();
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
          backgroundColor: layout.isExpressive ? colors.surfaceContainerHigh : paper.colors.surfaceVariant,
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
