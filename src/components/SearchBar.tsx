import React from 'react';
import { StyleSheet } from 'react-native';
import { Searchbar, useTheme as usePaperTheme } from 'react-native-paper';

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

  return (
    <Searchbar
      value={value}
      onChangeText={onChangeText}
      onClearIconPress={onClear ?? (() => onChangeText(''))}
      placeholder={placeholder}
      style={[styles.bar, { backgroundColor: paper.colors.surfaceVariant }]}
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
