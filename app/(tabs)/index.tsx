import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FAB, IconButton, Chip, useTheme as usePaperTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { SearchBar } from '../../src/components/SearchBar';
import { FilterChips } from '../../src/components/FilterChips';
import { ItemCard, ITEM_CARD_HEIGHT } from '../../src/components/ItemCard';
import type { SavedItem } from '../../src/types';

import type { ThemeColors } from '../../src/constants/colors';

/** Simple shimmer skeleton card shown while data loads */
function SkeletonCard({ colors }: { colors: ThemeColors }) {
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
  card: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, marginBottom: 10, height: 88 },
  accentBar: { width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  body: { flex: 1, padding: 12, gap: 10 },
  badge: { height: 18, width: 72, borderRadius: 8 },
  titleLine: { height: 14, width: '75%', borderRadius: 8 },
  descLine: { height: 12, width: '50%', borderRadius: 8 },
});

export default function LibraryScreen() {
  const { colors } = useTheme();
  const paper = usePaperTheme();
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
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.logoText, { color: paper.colors.primary }]}>Lumio</Text>
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* MD3 App Bar */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.logoText, { color: paper.colors.primary }]}>Lumio</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {counts.all ?? 0} saved {(counts.all ?? 0) === 1 ? 'item' : 'items'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            icon="swap-vertical"
            iconColor={colors.icon}
            size={22}
            onPress={() => setSort(sort === 'newest' ? 'alphabetical' : 'newest')}
            style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 12 }}
          />
        </View>
      </View>

      {/* MD3 Search */}
      <View style={styles.searchContainer}>
        <SearchBar value={searchQuery} onChangeText={setSearchQuery} />
      </View>

      {/* MD3 Filter chips */}
      <FilterChips active={filter} onSelect={setFilter} counts={counts} />

      {/* List */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        // Optimization: pre-calculated item height avoids layout measurement on every render
        getItemLayout={(_data, index) => ({
          length: ITEM_CARD_HEIGHT,
          offset: ITEM_CARD_HEIGHT * index,
          index,
        })}
        removeClippedSubviews
        windowSize={5}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 && styles.emptyList,
        ]}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyIcon, { color: colors.textMuted }]}>🔖</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {searchQuery ? 'No results found' : 'Nothing saved yet'}
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
              {searchQuery
                ? 'Try a different search term'
                : 'Tap + below, or share any link from your browser into Lumio'}
            </Text>
            {!searchQuery && (
              <Text style={[styles.emptyHint, { color: colors.textMuted }]}>
                💡 Tip: tap Share in any app and choose Lumio
              </Text>
            )}
          </View>
        }
      />

      {/* MD3 Extended FAB */}
      <FAB
        icon="plus"
        label="Save"
        onPress={() => router.push('/save')}
        style={[styles.fab, { backgroundColor: paper.colors.primaryContainer }]}
        color={paper.colors.onPrimaryContainer}
        variant="extended"
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
    fontSize: 26,
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
    gap: 4,
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
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  emptyHint: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    borderRadius: 16,
  },
});
