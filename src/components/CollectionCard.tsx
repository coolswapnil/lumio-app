import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Collection } from '../types';

interface CollectionCardProps {
  collection: Collection;
}

/**
 * MD3 Expressive collection card using react-native-paper Card.
 * Uses elevated mode for a subtle tonal surface lift.
 */
export function CollectionCard({ collection }: CollectionCardProps) {
  const paper = usePaperTheme();
  const router = useRouter();

  return (
    <Card
      mode="elevated"
      onPress={() => router.push(`/collection/${collection.id}`)}
      style={styles.card}
      contentStyle={styles.content}
      accessible
      accessibilityLabel={`${collection.name}, ${collection.itemCount ?? 0} items`}
      accessibilityRole="button"
    >
      <View style={[styles.iconContainer, { backgroundColor: collection.color + '22' }]}>
        <Ionicons name={collection.icon as any} size={24} color={collection.color} />
      </View>
      <View style={styles.info}>
        <Text
          variant="titleMedium"
          numberOfLines={1}
          style={{ color: paper.colors.onSurface }}
        >
          {collection.name}
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}
        >
          {(collection.itemCount ?? 0) === 1 ? '1 item' : `${collection.itemCount ?? 0} items`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={paper.colors.onSurfaceVariant} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 8,
    borderRadius: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
});

// Memoize — re-render only when collection data changes
export { CollectionCard as _CollectionCardBase };
const CollectionCardMemo = React.memo(CollectionCard, (prev, next) =>
  prev.collection.id === next.collection.id &&
  prev.collection.name === next.collection.name &&
  prev.collection.itemCount === next.collection.itemCount &&
  prev.collection.icon === next.collection.icon &&
  prev.collection.color === next.collection.color
);
export { CollectionCardMemo as CollectionCard };
