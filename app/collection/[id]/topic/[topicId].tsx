import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Searchbar } from 'react-native-paper';
import { useTheme } from '../../../../src/context/ThemeContext';
import { useAppTheme } from '../../../../src/constants/colors';
import { ItemCard } from '../../../../src/components/ItemCard';
import { getTopicById, getItemsByTopic } from '../../../../src/database/topics';
import { getCollectionById } from '../../../../src/database/collections';
import { searchCollectionItems } from '../../../../src/services/collectionInsights';
import type { SavedItem, Topic, Collection } from '../../../../src/types';

export default function TopicDetailScreen() {
  const { id, topicId } = useLocalSearchParams<{ id: string; topicId: string }>();
  const { colors } = useTheme();
  const paper = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [query, setQuery] = useState('');

  const loadData = useCallback(() => {
    if (topicId) getTopicById(topicId).then(setTopic);
    if (id) getCollectionById(id).then(setCollection);
    if (topicId) getItemsByTopic(topicId).then(setItems);
  }, [id, topicId]);

  useEffect(() => { loadData(); }, [loadData]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const filteredItems = useMemo(() => searchCollectionItems(items, query), [items, query]);

  if (!topic) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.empty}>
          <Text style={{ color: colors.text }}>Topic not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Nav bar */}
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => navigation.canGoBack() ? router.back() : router.replace(`/collection/${id}` as any)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={20} color={paper.colors.primary} />
          <Text style={{ color: paper.colors.primary, fontSize: 16 }}>
            {collection?.name ?? 'Back'}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ItemCard item={item} />}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
          filteredItems.length === 0 && styles.emptyList,
        ]}
        ListHeaderComponent={
          <>
            {/* Hero */}
            <View style={[styles.hero, { backgroundColor: paper.colors.secondaryContainer }]}>
              <Ionicons name="layers-outline" size={28} color={paper.colors.onSecondaryContainer} />
              <View style={styles.heroInfo}>
                <Text style={[styles.topicLabel, { color: paper.colors.onSecondaryContainer }]}>
                  {topic.label}
                </Text>
                <Text style={[styles.topicMeta, { color: paper.colors.onSecondaryContainer }]}>
                  {topic.itemCount === 1 ? '1 item' : `${topic.itemCount} items`}
                  {collection ? ` · ${collection.name}` : ''}
                </Text>
              </View>
            </View>

            {/* Search */}
            <Searchbar
              placeholder="Search title, tags, summary, category, source"
              value={query}
              onChangeText={setQuery}
              style={styles.search}
              inputStyle={{ fontSize: 13 }}
            />
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={40} color={paper.colors.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: paper.colors.onSurface }]}>
              {items.length === 0
                ? 'No items in this topic'
                : 'No matching items found'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    gap: 14,
    marginBottom: 12,
  },
  heroInfo: { flex: 1 },
  topicLabel: { fontSize: 22, fontWeight: '800' },
  topicMeta: { fontSize: 13, marginTop: 3 },
  list: { padding: 16 },
  emptyList: { flexGrow: 1 },
  search: { marginBottom: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontWeight: '600' },
});
