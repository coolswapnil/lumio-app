import React, { useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  PanResponder,
  Alert,
} from 'react-native';
import { Card, Text, Chip, IconButton, useTheme as usePaperTheme } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { SavedItem } from '../types';
import { CONTENT_TYPE_CONFIG } from '../constants';
import { toggleFavorite, toggleCompleted, deleteItem } from '../database/items';
import { useData } from '../context/DataContext';

dayjs.extend(relativeTime);

interface ItemCardProps {
  item: SavedItem;
  compact?: boolean;
}

/**
 * Estimated card height in pixels used for FlatList getItemLayout.
 * Accounts for card padding + title (2 lines max) + footer. Compact variant is shorter.
 */
export const ITEM_CARD_HEIGHT = 120;
export const ITEM_CARD_HEIGHT_COMPACT = 72;

const SWIPE_THRESHOLD = -80;

function ItemCardBase({ item, compact = false }: ItemCardProps) {
  const paper = usePaperTheme();
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
          Animated.spring(translateX, { toValue: SWIPE_THRESHOLD, useNativeDriver: true }).start();
          revealed.current = true;
        } else {
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

  const hostName = (() => {
    try { return new URL(item.url ?? '').hostname.replace('www.', ''); } catch { return item.url ?? ''; }
  })();

  return (
    <View style={styles.wrapper}>
      {/* Delete background revealed on left-swipe */}
      <View style={[styles.deleteBackground, { backgroundColor: paper.colors.error }]}>
        <IconButton
          icon="trash-can"
          iconColor={paper.colors.onError}
          size={22}
          onPress={handleDelete}
          accessibilityLabel="Delete item"
        />
        <Text style={[styles.deleteLabel, { color: paper.colors.onError }]}>Delete</Text>
      </View>

      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <Card
          mode="elevated"
          onPress={handlePress}
          style={[styles.card, { borderLeftColor: config.color, borderLeftWidth: 4 }]}
          contentStyle={styles.cardContent}
          accessible
          accessibilityLabel={item.title}
          accessibilityRole="button"
        >
          {/* Type badge + actions row */}
          <View style={styles.topRow}>
            <Chip
              compact
              icon={() => (
                <Ionicons name={config.icon} size={12} color={config.color} />
              )}
              style={[styles.typeBadge, { backgroundColor: config.color + '22' }]}
              textStyle={{ color: config.color, fontSize: 11, fontWeight: '600' }}
            >
              {config.label}
            </Chip>

            <View style={styles.actions}>
              <IconButton
                icon={item.isCompleted ? 'check-circle' : 'check-circle-outline'}
                iconColor={item.isCompleted ? paper.colors.primary : paper.colors.onSurfaceVariant}
                size={20}
                onPress={handleComplete}
                accessibilityLabel={item.isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
                style={styles.actionIcon}
              />
              <IconButton
                icon={item.isFavorite ? 'heart' : 'heart-outline'}
                iconColor={item.isFavorite ? paper.colors.error : paper.colors.onSurfaceVariant}
                size={20}
                onPress={handleFavorite}
                accessibilityLabel={item.isFavorite ? 'Remove favorite' : 'Add to favorites'}
                style={styles.actionIcon}
              />
            </View>
          </View>

          {/* Title */}
          <Text
            variant={compact ? 'titleSmall' : 'titleMedium'}
            numberOfLines={compact ? 1 : 2}
            style={{ color: paper.colors.onSurface, marginTop: 4 }}
          >
            {item.title}
          </Text>

          {/* Description */}
          {!compact && item.description ? (
            <Text
              variant="bodySmall"
              numberOfLines={2}
              style={{ color: paper.colors.onSurfaceVariant, marginTop: 4, lineHeight: 18 }}
            >
              {item.description}
            </Text>
          ) : null}

          {/* AI Summary chip */}
          {item.aiSummary && !compact ? (
            <View style={[styles.summaryChip, { backgroundColor: paper.colors.secondaryContainer }]}>
              <Ionicons name="sparkles" size={12} color={paper.colors.onSecondaryContainer} />
              <Text
                variant="bodySmall"
                style={{ flex: 1, color: paper.colors.onSecondaryContainer, lineHeight: 16 }}
                numberOfLines={2}
              >
                {item.aiSummary}
              </Text>
            </View>
          ) : null}

          {/* Tags */}
          {item.tags.length > 0 && !compact ? (
            <View style={styles.tagsRow}>
              {item.tags.slice(0, 3).map((tag) => (
                <Chip
                  key={tag}
                  compact
                  style={{ backgroundColor: paper.colors.surfaceVariant }}
                  textStyle={{ color: paper.colors.onSurfaceVariant, fontSize: 11 }}
                >
                  #{tag}
                </Chip>
              ))}
              {item.tags.length > 3 && (
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant }}>
                  +{item.tags.length - 3}
                </Text>
              )}
            </View>
          ) : null}

          {/* Footer */}
          <View style={styles.footer}>
            {item.url ? (
              <Text variant="bodySmall" style={{ color: paper.colors.outline, flex: 1 }} numberOfLines={1}>
                {hostName}
              </Text>
            ) : null}
            <Text variant="bodySmall" style={{ color: paper.colors.outline }}>
              {dayjs(item.createdAt).fromNow()}
            </Text>
          </View>
        </Card>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    marginBottom: 10,
    overflow: 'hidden',
    borderRadius: 16,
  },
  deleteBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: -4,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardContent: {
    padding: 12,
    paddingLeft: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    borderRadius: 6,
    height: 26,
  },
  actions: {
    flexDirection: 'row',
    marginRight: -8,
  },
  actionIcon: {
    margin: 0,
    width: 32,
    height: 32,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 8,
    borderRadius: 10,
    gap: 6,
    marginTop: 6,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginTop: 6,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
});

// ── Memoize to prevent re-renders when other list items change ────────────────
// Custom equality: only re-render if the item data or compact flag changed.
const ItemCard = React.memo(ItemCardBase, (prev, next) =>
  prev.compact === next.compact &&
  prev.item.id === next.item.id &&
  prev.item.title === next.item.title &&
  prev.item.isCompleted === next.item.isCompleted &&
  prev.item.isFavorite === next.item.isFavorite &&
  prev.item.aiSummary === next.item.aiSummary &&
  prev.item.tags.length === next.item.tags.length
);

export { ItemCard };
