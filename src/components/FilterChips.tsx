import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import type { FilterOption } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useAppTheme } from '../constants/colors';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../constants';

const FILTER_OPTIONS: Array<{ id: FilterOption; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: 'grid' },
  { id: 'favorites', label: 'Favorites', icon: 'heart' },
  { id: 'completed', label: 'Done', icon: 'checkmark-circle' },
  ...ALL_CONTENT_TYPES.map((t) => ({
    id: t as FilterOption,
    label: CONTENT_TYPE_CONFIG[t].label,
    icon: CONTENT_TYPE_CONFIG[t].icon,
  })),
];

interface FilterChipsProps {
  active: FilterOption;
  onSelect: (f: FilterOption) => void;
  counts?: Record<string, number>;
}

export function FilterChips({ active, onSelect, counts }: FilterChipsProps) {
  const paper = useAppTheme();
  const { layout } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {FILTER_OPTIONS.map((opt) => {
        const isActive = active === opt.id;
        const count = counts?.[opt.id];
        const label = count !== undefined && count > 0
          ? `${opt.label} ${count > 99 ? '99+' : count}`
          : opt.label;

        return (
          <Chip
            key={opt.id}
            selected={isActive}
            onPress={() => onSelect(opt.id)}
            // MD3 filter chip: flat + primaryContainer when selected,
            // surfaceContainerHigh background when inactive so chips are
            // visible and correctly tinted in all themes including dark / AMOLED.
            mode="flat"
            selectedColor={paper.colors.onPrimaryContainer}
            style={[
              styles.chip,
              {
                borderRadius: layout.isExpressive ? 20 : 8,
                minHeight: layout.touchTarget,
                backgroundColor: isActive
                  ? paper.colors.primaryContainer
                  : paper.colors.surfaceContainerHigh,
              },
            ]}
            textStyle={[
              styles.chipText,
              { color: isActive ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant },
            ]}
            icon={() => (
              <Ionicons
                name={opt.icon as any}
                size={14}
                color={isActive ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant}
              />
            )}
            compact
            accessibilityLabel={`Filter by ${opt.label}`}
          >
            {label}
          </Chip>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 6,
  },
  chip: {
    borderRadius: 8,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
