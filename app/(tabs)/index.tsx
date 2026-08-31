import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { SearchBar } from '../../src/components/SearchBar';
import { FilterChips } from '../../src/components/FilterChips';
import { ItemCard } from '../../src/components/ItemCard';
import type { SavedItem } from '../../src/types';

/** Simple shimmer skeleton card shown while data loads */
function SkeletonCard({ colors }: { colors: any }) {
  const opacity = React.useRef(new Animated.Value(0.4)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[skeletonStyles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity }]}>
      <View style={[skeletonStyles.accentBar, { backgroundColor: colors.border }]} />
      <View style={skeletonStyles.body}>
        <View style={[skeletonStyles.badge, { backgroundColor: colors.surfaceSecondary }]} />
        <View style={[skeletonStyles.titleLine, { backgroundColor: colors.surfaceSecondary }]} />
        <View style={[skeletonStyles.descLine, { backgroundColor: colors.surfaceSecondary }]} />
      </View>
    </Animated.View>
  );
}

const skeletonStyles = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, marginBottom: 10, height: 88 },
  accentBar: { width: 4, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  body: { flex: 1, padding: 12, gap: 10 },
  badge: { height: 18, width: 72, borderRadius: 6 },
  titleLine: { height: 14, width: '75%', borderRadius: 6 },
  descLine: { height: 12, width: '50%', borderRadius: 6 },
});

export default function LibraryScreen() {
  const { colors } = useTheme();
  const {
    items,
    counts,
    isLoading,
    filter,
    sort,
    searchQuery,
    setFilter,
    setSort,
    setSearchQuery,
    refreshItems,
  } = useData();
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshItems();
    setRefreshing(false);
  }, [refreshItems]);

  const renderItem = ({ item }: { item: SavedItem }) => <ItemCard item={item} />;

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.logoText, { color: colors.text }]}>
              <Text style={{ color: '#3b82f6' }}>Lumio</Text>
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Loading…</Text>
          </View>
        </View>
        <View style={{ padding: 16, gap: 0 }}>
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} colors={colors} />)}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.logoText, { color: colors.text }]}>
            <Text style={{ color: '#3b82f6' }}>Lumio</Text>
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {counts.all ?? 0} saved {(counts.all ?? 0) === 1 ? 'item' : 'items'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setSort(sort === 'newest' ? 'alphabetical' : 'newest')}
            style={[styles.iconBtn, { backgroundColor: colors.surfaceSecondary }]}
          >
            <Ionicons name="swap-vertical" size={18} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/save')}
            style={[styles.saveBtn]}
          >
            <Ionicons name="add" size={20} color="#ffffff" />
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Filter chips */}
      <FilterChips active={filter} onSelect={setFilter} counts={counts} />

      {/* List */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 && styles.emptyList,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textSecondary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="bookmark-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {searchQuery ? 'No results found' : 'Nothing saved yet'}
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
              {searchQuery
                ? 'Try a different search term'
                : 'Tap Save, or share any link from your browser into Lumio'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity
                onPress={() => router.push('/save')}
                style={styles.emptyBtn}
              >
                <Text style={styles.emptyBtnText}>+ Save your first item</Text>
              </TouchableOpacity>
            )}
            {!searchQuery && (
              <Text style={[styles.emptyHint, { color: colors.textMuted }]}>
                💡 Tip: tap Share in any app and choose Lumio
              </Text>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  logoText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3b82f6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,
  },
  emptyList: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  emptyBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  emptyHint: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
});
