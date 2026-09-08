import React, { useMemo } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Card, Text } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { Collection, SavedItem, Topic } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useAppTheme } from '../constants/colors';
import { buildCollectionInsights } from '../services/collectionInsights';
import { URL_SOURCE_LABELS } from '../services/metadata';

dayjs.extend(relativeTime);

interface CollectionCardProps {
  collection: Collection;
  items: SavedItem[];
  topics: Topic[];
}

function CollectionCardBase({ collection, items, topics }: CollectionCardProps) {
  const paper = useAppTheme();
  const router = useRouter();
  const { layout } = useTheme();
  const collectionItems = useMemo(() => items.filter((item) => item.collectionId === collection.id), [collection.id, items]);
  const insights = useMemo(() => buildCollectionInsights(collection, collectionItems), [collection, collectionItems]);
  const source = insights.topSource ? URL_SOURCE_LABELS[insights.topSource.label as keyof typeof URL_SOURCE_LABELS] ?? insights.topSource.label : undefined;
  const healthColor = insights.health === 'Growing' ? '#10b981' : insights.health === 'Healthy' ? paper.colors.primary : paper.colors.outline;
  const visibleTopics = topics.slice(0, 3);

  return (
    <Card mode="elevated" onPress={() => router.push(`/collection/${collection.id}`)} style={[styles.card, { borderRadius: layout.cardRadius }]} contentStyle={styles.content} accessible accessibilityLabel={`${collection.name}, ${insights.itemCount} items, ${insights.health}`} accessibilityRole="button">
      <View style={styles.topRow}>
        <View style={[styles.iconContainer, { backgroundColor: collection.color + '22' }]}><Ionicons name={collection.icon} size={24} color={collection.color} /></View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text variant="titleMedium" numberOfLines={1} style={[{ color: paper.colors.onSurface }, styles.nameText]}>{collection.name}</Text>
            {collection.isSystem && (
              <Ionicons name="lock-closed-outline" size={13} color={paper.colors.onSurfaceVariant} style={styles.lockIcon} />
            )}
          </View>
          <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>{insights.itemCount === 1 ? '1 item' : `${insights.itemCount} items`}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={paper.colors.onSurfaceVariant} />
      </View>
      {insights.itemCount > 0 ? <View style={styles.details}>
        <Detail icon="pricetags-outline" label="Top topic" value={insights.mostActiveTopic?.label ?? 'Building knowledge'} color={paper.colors.secondary} />
        <Detail icon="logo-rss" label="Top source" value={source ?? '—'} color={paper.colors.primary} />
        <Detail icon="time-outline" label="Updated" value={insights.lastAddedAt ? dayjs(insights.lastAddedAt).fromNow() : '—'} color={paper.colors.onSurfaceVariant} />
        {visibleTopics.length > 0 && (
          <View style={styles.topicChips}>
            {visibleTopics.map((topic) => (
              <Pressable
                key={topic.id}
                onPress={() => router.push(`/collection/${collection.id}/topic/${topic.id}`)}
                style={[styles.topicChip, { backgroundColor: paper.colors.secondaryContainer }]}
                accessibilityRole="button"
                accessibilityLabel={`Topic: ${topic.label}, ${topic.itemCount} items`}
              >
                <Text style={[styles.topicChipText, { color: paper.colors.onSecondaryContainer }]} numberOfLines={1}>{topic.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.bottomRow}><View style={[styles.health, { backgroundColor: healthColor + '20' }]}><View style={[styles.healthDot, { backgroundColor: healthColor }]} /><Text style={{ color: healthColor, fontSize: 12, fontWeight: '700' }}>{insights.health}</Text></View>{insights.reviewItems.length > 0 && <Text style={{ color: paper.colors.error, fontSize: 12, fontWeight: '700' }}>Review: {insights.reviewItems.length} {insights.reviewItems.length === 1 ? 'item' : 'items'}</Text>}</View>
      </View> : <View style={[styles.emptySuggestion, { backgroundColor: paper.colors.secondaryContainer }]}><Ionicons name="sparkles-outline" size={14} color={paper.colors.onSecondaryContainer} /><Text style={{ color: paper.colors.onSecondaryContainer, fontSize: 12, flex: 1 }}>Suggested content: {collection.name}</Text></View>}
    </Card>
  );
}

function Detail({ icon, label, value, color }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; color: string }) {
  return <View style={styles.detail}><Ionicons name={icon} size={14} color={color} /><Text style={[styles.detailLabel, { color }]}>{label}</Text><Text numberOfLines={1} style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  card: { marginBottom: 10, borderRadius: 16 }, content: { padding: 14 }, topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, iconContainer: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, info: { flex: 1 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, nameText: { flexShrink: 1 }, lockIcon: { marginTop: 1 }, details: { marginTop: 12, gap: 7 }, detail: { flexDirection: 'row', alignItems: 'center', gap: 6 }, detailLabel: { fontSize: 12, fontWeight: '700', width: 72 }, detailValue: { flex: 1, color: '#1f2328', fontSize: 13 }, topicChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 }, topicChip: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 120 }, topicChipText: { fontSize: 11, fontWeight: '600' }, bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }, health: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 }, healthDot: { width: 6, height: 6, borderRadius: 3 }, emptySuggestion: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, padding: 10, borderRadius: 10 },
});

const CollectionCard = React.memo(CollectionCardBase, (prev, next) => prev.collection === next.collection && prev.items === next.items && prev.topics === next.topics);
export { CollectionCard };
