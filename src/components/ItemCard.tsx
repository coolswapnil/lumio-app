import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { SavedItem } from '../types';
import { CONTENT_TYPE_CONFIG } from '../constants';
import { useTheme } from '../context/ThemeContext';
import { toggleFavorite, toggleCompleted } from '../database/items';
import { useData } from '../context/DataContext';

dayjs.extend(relativeTime);

interface ItemCardProps {
  item: SavedItem;
  compact?: boolean;
}

export function ItemCard({ item, compact = false }: ItemCardProps) {
  const { colors } = useTheme();
  const { refreshItems } = useData();
  const router = useRouter();
  const config = CONTENT_TYPE_CONFIG[item.contentType];

  const handleFavorite = async () => {
    await toggleFavorite(item.id, item.isFavorite);
    await refreshItems();
  };

  const handleComplete = async () => {
    await toggleCompleted(item.id, item.isCompleted);
    await refreshItems();
  };

  const handlePress = () => {
    router.push(`/item/${item.id}`);
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.75}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      {/* Color accent bar */}
      <View style={[styles.accentBar, { backgroundColor: config.color }]} />

      <View style={styles.body}>
        {/* Type badge + actions */}
        <View style={styles.topRow}>
          <View style={[styles.typeBadge, { backgroundColor: config.color + '20' }]}>
            <Ionicons name={config.icon as any} size={12} color={config.color} />
            <Text style={[styles.typeLabel, { color: config.color }]}>{config.label}</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity onPress={handleComplete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons
                name={item.isCompleted ? 'checkmark-circle' : 'checkmark-circle-outline'}
                size={20}
                color={item.isCompleted ? colors.success : colors.textMuted}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleFavorite} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons
                name={item.isFavorite ? 'heart' : 'heart-outline'}
                size={20}
                color={item.isFavorite ? '#ef4444' : colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Title */}
        <Text
          style={[styles.title, { color: colors.text }]}
          numberOfLines={compact ? 1 : 2}
        >
          {item.title}
        </Text>

        {/* Description */}
        {!compact && item.description ? (
          <Text style={[styles.description, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        {/* AI Summary chip */}
        {item.aiSummary && !compact ? (
          <View style={[styles.summaryChip, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="sparkles" size={12} color="#8b5cf6" />
            <Text style={[styles.summaryText, { color: colors.textSecondary }]} numberOfLines={2}>
              {item.aiSummary}
            </Text>
          </View>
        ) : null}

        {/* Tags */}
        {item.tags.length > 0 && !compact ? (
          <View style={styles.tagsRow}>
            {item.tags.slice(0, 3).map((tag) => (
              <View key={tag} style={[styles.tag, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.tagText, { color: colors.textSecondary }]}>#{tag}</Text>
              </View>
            ))}
            {item.tags.length > 3 && (
              <Text style={[styles.tagText, { color: colors.textMuted }]}>
                +{item.tags.length - 3}
              </Text>
            )}
          </View>
        ) : null}

        {/* Footer */}
        <View style={styles.footer}>
          {item.url ? (
            <Text style={[styles.url, { color: colors.textMuted }]} numberOfLines={1}>
              {(() => { try { return new URL(item.url).hostname.replace('www.', ''); } catch { return item.url; } })()}
            </Text>
          ) : null}
          <Text style={[styles.date, { color: colors.textMuted }]}>
            {dayjs(item.createdAt).fromNow()}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  accentBar: {
    width: 4,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  body: {
    flex: 1,
    padding: 12,
    gap: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  typeLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 8,
    borderRadius: 8,
    gap: 6,
  },
  summaryText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  url: {
    fontSize: 11,
    flex: 1,
  },
  date: {
    fontSize: 11,
  },
});
