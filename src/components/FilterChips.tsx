import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FilterOption } from '../types';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../constants';
import { useTheme } from '../context/ThemeContext';

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
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {FILTER_OPTIONS.map((opt) => {
        const isActive = active === opt.id;
        const count = counts?.[opt.id];

        return (
          <TouchableOpacity
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            style={[
              styles.chip,
              {
                backgroundColor: isActive ? '#3b82f6' : colors.surfaceSecondary,
                borderColor: isActive ? '#3b82f6' : colors.border,
              },
            ]}
          >
            <Ionicons
              name={opt.icon as any}
              size={14}
              color={isActive ? '#ffffff' : colors.textSecondary}
            />
            <Text
              style={[
                styles.label,
                { color: isActive ? '#ffffff' : colors.textSecondary },
              ]}
            >
              {opt.label}
            </Text>
            {count !== undefined && count > 0 && (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    { color: isActive ? '#fff' : colors.textMuted },
                  ]}
                >
                  {count > 99 ? '99+' : count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
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
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
