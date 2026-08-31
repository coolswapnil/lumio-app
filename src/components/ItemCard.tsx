import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { SavedItem } from '../types';
import { CONTENT_TYPE_CONFIG } from '../constants';
import { useTheme } from '../context/ThemeContext';
import { toggleFavorite, toggleCompleted, deleteItem } from '../database/items';
import { useData } from '../context/DataContext';

dayjs.extend(relativeTime);

interface ItemCardProps {
  item: SavedItem;
  compact?: boolean;
}

const SWIPE_THRESHOLD = -80; // px left-swipe to reveal delete

export function ItemCard({ item, compact = false }: ItemCardProps) {
  const { colors } = useTheme();
  const { refreshAll } = useData();
  const router = useRouter();
  const config = CONTENT_TYPE_CONFIG[item.contentType];

  // ── Swipe-to-delete ──────────────────────────────────────────────────────
  const translateX = useRef(new Animated.Value(0)).current;
  const revealed = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dy) < Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        const x = Math.max(SWIPE_THRESHOLD * 1.2, Math.min(0, g.dx + (revealed.current ? SWIPE_THRESHOLD : 0)));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        const finalDx = g.dx + (revealed.current ? SWIPE_THRESHOLD : 0);
        if (finalDx < SWIPE_THRESHOLD / 2) {
          // Reveal delete button
          Animated.spring(translateX, { toValue: SWIPE_THRESHOLD, useNativeDriver: true }).start();
          revealed.current = true;
        } else {
          // Snap back
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          revealed.current = false;
        }
      },
    })
  ).current;

  const snapBack = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    revealed.current = false;
  };

  const handleDelete = () => {
    Alert.alert('Delete Item', `Remove "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel', onPress: snapBack },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteItem(item.id);
          await refreshAll();
        },
      },
    ]);
  };

  const handleFavorite = async () => {
    await toggleFavorite(item.id, item.isFavorite);
    await refreshAll();
  };

  const handleComplete = async () => {
    await toggleCompleted(item.id, item.isCompleted);
    await refreshAll();
  };

  const handlePress = () => {
    if (revealed.current) {
      snapBack();
      return;
    }
    router.push(`/item/${item.id}`);
  };

  return (
    <View style={styles.wrapper}>
      {/* Delete background revealed on left swipe */}
      <View style={[styles.deleteBackground, { backgroundColor: '#ef4444' }]}>
        <TouchableOpacity onPress={handleDelete} style={styles.deleteAction}>
          <Ionicons name="trash" size={22} color="#ffffff" />
          <Text style={styles.deleteLabel}>Delete</Text>
        </TouchableOpacity>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    marginBottom: 10,
    overflow: 'hidden',
    borderRadius: 12,
  },
  deleteBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 80,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 12,
  },
  deleteLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
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
