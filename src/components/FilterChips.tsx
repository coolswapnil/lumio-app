import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, useTheme as usePaperTheme } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import type { FilterOption } from '../types';
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
  const paper = usePaperTheme();

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
            // MD3 filter chip uses 'outlined' mode; selected state uses primary container
            mode={isActive ? 'flat' : 'outlined'}
            selectedColor={paper.colors.onPrimaryContainer}
            style={[
              styles.chip,
              isActive && { backgroundColor: paper.colors.primaryContainer },
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
