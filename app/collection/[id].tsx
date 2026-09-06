import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Searchbar } from 'react-native-paper';
import { useTheme } from '../../src/context/ThemeContext';
import { useAppTheme } from '../../src/constants/colors';
import { useData } from '../../src/context/DataContext';
import { ItemCard } from '../../src/components/ItemCard';
import { getItemsByCollection } from '../../src/database/items';
import { deleteCollection } from '../../src/database/collections';
import { buildCollectionInsights, searchCollectionItems } from '../../src/services/collectionInsights';
import { URL_SOURCE_LABELS } from '../../src/services/metadata';
import type { SavedItem } from '../../src/types';

dayjs.extend(relativeTime);

function InsightChips({ values, color }: { values: { label: string; count: number }[]; color: string }) {
  if (values.length === 0) return <Text style={[styles.emptyValue, { color }]}>No signals yet</Text>;
  return <View style={styles.chips}>{values.map((value) => <View key={value.label} style={[styles.chip, { borderColor: color + '50' }]}><Text style={[styles.chipText, { color }]}>#{value.label} · {value.count}</Text></View>)}</View>;
}

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const paper = useAppTheme();
  const insets = useSafeAreaInsets();
  const { collections, items: contextItems, refreshAll } = useData();
  const router = useRouter();
  const navigation = useNavigation();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [query, setQuery] = useState('');

  const collection = collections.find((candidate) => candidate.id === id);
  const loadItems = useCallback(() => { if (id) getItemsByCollection(id).then(setItems); }, [id]);
  useEffect(() => { loadItems(); }, [loadItems]);
  useFocusEffect(useCallback(() => { loadItems(); }, [loadItems]));
  useEffect(() => { loadItems(); }, [contextItems, loadItems]);

  const insights = useMemo(() => collection ? buildCollectionInsights(collection, items) : null, [collection, items]);
  const filteredItems = useMemo(() => searchCollectionItems(items, query), [items, query]);

  const handleDelete = () => Alert.alert('Delete Collection', `Delete "${collection?.name}"? Items will not be deleted.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { if (id) { await deleteCollection(id); await refreshAll(); router.back(); } } },
  ]);

  if (!collection || !insights) return <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}><View style={styles.empty}><Text style={{ color: colors.text }}>Collection not found.</Text></View></SafeAreaView>;

  const sourceLabel = insights.topSource ? (URL_SOURCE_LABELS[insights.topSource.label as keyof typeof URL_SOURCE_LABELS] ?? insights.topSource.label) : '—';
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backBtn}><Ionicons name="chevron-back" size={20} color={paper.colors.primary} /><Text style={{ color: paper.colors.primary, fontSize: 16 }}>Back</Text></TouchableOpacity>
        <TouchableOpacity onPress={handleDelete} accessibilityLabel="Delete collection"><Ionicons name="trash-outline" size={20} color={paper.colors.error} /></TouchableOpacity>
      </View>
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          const previous = filteredItems[index - 1];
          const timeline = timelineLabel(item.createdAt);
          return <>{(!previous || timelineLabel(previous.createdAt) !== timeline) && <Text style={[styles.timelineLabel, { color: colors.textSecondary }]}>{timeline}</Text>}<ItemCard item={item} /></>;
        }}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }, filteredItems.length === 0 && styles.emptyList]}
        ListHeaderComponent={<>
          <View style={[styles.hero, { backgroundColor: collection.color + '16', borderColor: collection.color + '40' }]}>
            <View style={[styles.iconContainer, { backgroundColor: collection.color + '22' }]}><Ionicons name={collection.icon} size={28} color={collection.color} /></View>
            <View style={styles.headerInfo}><Text style={[styles.collectionName, { color: colors.text }]}>{collection.name}</Text><Text style={[styles.itemCount, { color: colors.textMuted }]}>{insights.itemCount} {insights.itemCount === 1 ? 'item' : 'items'}</Text></View>
          </View>
          <View style={[styles.section, { backgroundColor: paper.colors.secondaryContainer }]}><Text style={[styles.sectionLabel, { color: paper.colors.onSecondaryContainer }]}>COLLECTION SUMMARY</Text><Text style={[styles.summary, { color: paper.colors.onSecondaryContainer }]}>{insights.summary}</Text></View>
          <View style={styles.metrics}>
            <Metric icon="pricetag-outline" label="Top category" value={insights.topCategory?.label ?? '—'} color={paper.colors.primary} />
            <Metric icon="logo-rss" label="Top source" value={sourceLabel} color={paper.colors.primary} />
            <Metric icon="time-outline" label="Last saved" value={insights.lastAddedAt ? dayjs(insights.lastAddedAt).fromNow() : '—'} color={paper.colors.primary} />
            <Metric icon="calendar-outline" label="Added in 30 days" value={String(insights.itemsAddedLast30Days)} color={paper.colors.primary} />
          </View>
          <Section title="Top topics" icon="pricetags-outline" color={paper.colors.secondary}><InsightChips values={insights.topTags} color={paper.colors.secondary} /></Section>
          <Section title="AI details" icon="sparkles-outline" color={paper.colors.tertiary}>
            <DetailRow label="Categories" value={insights.topCategories.map((value) => value.label).join(', ') || 'No categories yet'} color={colors.textSecondary} />
            <DetailRow label="Sources" value={insights.topSources.map((value) => URL_SOURCE_LABELS[value.label as keyof typeof URL_SOURCE_LABELS] ?? value.label).join(', ') || 'No sources yet'} color={colors.textSecondary} />
            <DetailRow label="Locations" value={insights.topLocations.map((value) => value.label).join(', ') || 'No locations yet'} color={colors.textSecondary} />
          </Section>
          {insights.highlyRepresentedTopic && <View style={[styles.health, { backgroundColor: paper.colors.tertiaryContainer }]}><Ionicons name="layers-outline" size={18} color={paper.colors.onTertiaryContainer} /><View style={{ flex: 1 }}><Text style={[styles.sectionLabel, { color: paper.colors.onTertiaryContainer }]}>HIGHLY REPRESENTED TOPIC</Text><Text style={{ color: paper.colors.onTertiaryContainer }}>#{insights.highlyRepresentedTopic.label} appears in {insights.highlyRepresentedTopic.count} items</Text></View></View>}
          {insights.reviewItems.length > 0 && <Section title="Review suggested" icon="eye-outline" color={paper.colors.error}>{insights.reviewItems.map(({ item, reason }) => <TouchableOpacity key={item.id} onPress={() => router.push(`/item/${item.id}`)} style={[styles.reviewRow, { borderTopColor: colors.border }]}><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600' }}>{item.title}</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>{reason} · {dayjs(item.createdAt).fromNow()}</Text></View><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></TouchableOpacity>)}</Section>}
          <Text style={[styles.contentLabel, { color: colors.textSecondary }]}>SAVED KNOWLEDGE</Text>
          <Searchbar placeholder="Search title, tags, summary, category, source" value={query} onChangeText={setQuery} style={styles.search} inputStyle={{ fontSize: 13 }} />
        </>}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="bookmark-outline" size={40} color={paper.colors.onSurfaceVariant} /><Text style={[styles.emptyText, { color: paper.colors.onSurface }]}>{items.length === 0 ? 'No items in this collection' : 'No matching knowledge found'}</Text>{items.length === 0 && <TouchableOpacity onPress={() => router.push('/save')} style={[styles.addBtn, { backgroundColor: paper.colors.primary }]}><Text style={[styles.addBtnText, { color: paper.colors.onPrimary }]}>Save something here</Text></TouchableOpacity>}</View>}
      />
    </SafeAreaView>
  );
}

function timelineLabel(createdAt: string): string {
  const date = dayjs(createdAt);
  if (date.isSame(dayjs(), 'day')) return 'Today';
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  if (date.isAfter(dayjs().subtract(7, 'day'))) return 'Last week';
  return date.format('MMMM YYYY');
}

function Metric({ icon, label, value, color }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; color: string }) { return <View style={styles.metric}><Ionicons name={icon} size={16} color={color} /><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue} numberOfLines={1}>{value}</Text></View>; }
function Section({ title, icon, color, children }: { title: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string; children: React.ReactNode }) { return <View style={styles.section}><View style={styles.sectionHeader}><Ionicons name={icon} size={15} color={color} /><Text style={[styles.sectionLabel, { color }]}>{title}</Text></View>{children}</View>; }
function DetailRow({ label, value, color }: { label: string; value: string; color: string }) { return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailValue, { color }]}>{value}</Text></View>; }

const styles = StyleSheet.create({
  container: { flex: 1 }, navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1 }, backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 }, list: { padding: 16 }, emptyList: { flexGrow: 1 }, hero: { flexDirection: 'row', alignItems: 'center', padding: 16, borderWidth: 1, borderRadius: 18, gap: 14, marginBottom: 12 }, iconContainer: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, headerInfo: { flex: 1 }, collectionName: { fontSize: 22, fontWeight: '800' }, itemCount: { fontSize: 13, marginTop: 3 }, section: { borderRadius: 14, padding: 14, marginBottom: 12 }, sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }, sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: .7, textTransform: 'uppercase' }, summary: { fontSize: 15, lineHeight: 22 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }, metric: { width: '48%', padding: 12, borderRadius: 12, backgroundColor: '#00000008', gap: 3 }, metricLabel: { color: '#687076', fontSize: 11 }, metricValue: { color: '#1f2328', fontSize: 14, fontWeight: '700' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 5 }, chipText: { fontSize: 12, fontWeight: '600' }, emptyValue: { fontSize: 13 }, detailRow: { marginTop: 7 }, detailLabel: { color: '#687076', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, detailValue: { fontSize: 13, marginTop: 1 }, health: { borderRadius: 14, flexDirection: 'row', gap: 10, padding: 14, marginBottom: 12 }, reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 1 }, contentLabel: { fontSize: 12, fontWeight: '800', letterSpacing: .7, marginTop: 4, marginBottom: 8 }, search: { marginBottom: 12 }, timelineLabel: { fontSize: 12, fontWeight: '800', letterSpacing: .5, textTransform: 'uppercase', marginTop: 4, marginBottom: 8 }, empty: { alignItems: 'center', paddingTop: 42, gap: 8 }, emptyText: { fontSize: 15, fontWeight: '500', marginTop: 8 }, addBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, marginTop: 8 }, addBtnText: { fontWeight: '600', fontSize: 14 },
});
