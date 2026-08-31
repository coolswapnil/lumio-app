import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { SearchBar } from '../../src/components/SearchBar';
import { CONTENT_TYPE_CONFIG } from '../../src/constants';
import type { SavedItem } from '../../src/types';

dayjs.extend(relativeTime);

function openInGoogleMaps(item: SavedItem) {
  // Prefer GPS coords for precision; fall back to address text search
  let mapsUrl: string;
  let fallbackUrl: string;
  if (item.latitude && item.longitude) {
    mapsUrl = `geo:${item.latitude},${item.longitude}?q=${item.latitude},${item.longitude}`;
    fallbackUrl = `https://maps.google.com/?q=${item.latitude},${item.longitude}`;
  } else {
    const encoded = encodeURIComponent(item.address ?? '');
    mapsUrl = `geo:0,0?q=${encoded}`;
    fallbackUrl = `https://maps.google.com/?q=${encoded}`;
  }
  Linking.canOpenURL(mapsUrl)
    .then((supported) => Linking.openURL(supported ? mapsUrl : fallbackUrl))
    .catch(() => Linking.openURL(fallbackUrl));
}

export default function LocationsScreen() {
  const { colors } = useTheme();
  const { items } = useData();
  const router = useRouter();
  const [search, setSearch] = useState('');

  // Only items that have an address or GPS coords stored
  const locationItems = useMemo(() => {
    const withLocation = items.filter((item) => item.address?.trim() || (item.latitude && item.longitude));
    if (!search.trim()) return withLocation;
    const q = search.trim().toLowerCase();
    return withLocation.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.address!.toLowerCase().includes(q) ||
        item.tags.some((t) => t.includes(q))
    );
  }, [items, search]);

  const renderItem = ({ item }: { item: SavedItem }) => {
    const config = CONTENT_TYPE_CONFIG[item.contentType];
    return (
      <TouchableOpacity
        onPress={() => router.push(`/item/${item.id}`)}
        activeOpacity={0.75}
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        {/* Left accent */}
        <View style={[styles.accentBar, { backgroundColor: config.color }]} />

        <View style={styles.cardBody}>
          {/* Type badge */}
          <View style={[styles.typeBadge, { backgroundColor: config.color + '20' }]}>
            <Ionicons name={config.icon as any} size={11} color={config.color} />
            <Text style={[styles.typeLabel, { color: config.color }]}>{config.label}</Text>
          </View>

          {/* Title */}
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>

          {/* Address row */}
          {item.address && (
            <View style={styles.addressRow}>
              <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.addressText, { color: colors.textSecondary }]} numberOfLines={2}>
                {item.address}
              </Text>
            </View>
          )}

          {/* GPS badge */}
          {item.latitude && item.longitude && (
            <View style={styles.gpsBadgeRow}>
              <Ionicons name="navigate" size={11} color="#10b981" />
              <Text style={[styles.gpsBadgeText, { color: '#10b981' }]}>
                {`${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`}
              </Text>
            </View>
          )}

          {/* Date */}
          <Text style={[styles.dateText, { color: colors.textMuted }]}>
            {dayjs(item.createdAt).fromNow()}
          </Text>
        </View>

        {/* Open in Maps button */}
        <TouchableOpacity
          onPress={() => openInGoogleMaps(item)}
          style={[styles.mapsBtn, { backgroundColor: '#34a85320' }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="navigate" size={16} color="#34a853" />
          <Text style={[styles.mapsBtnText, { color: '#34a853' }]}>Maps</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Locations</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {locationItems.length} saved {locationItems.length === 1 ? 'place' : 'places'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/save')}
          style={[styles.addBtn, { backgroundColor: '#3b82f6' }]}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search places, addresses…"
        />
      </View>

      {/* List */}
      <FlatList
        data={locationItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, locationItems.length === 0 && styles.emptyList]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="location-outline" size={52} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {search ? 'No places match your search' : 'No locations saved yet'}
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
              {search
                ? 'Try a different search term'
                : 'When you save a YouTube video, Instagram reel, or any content with a place — add the location name and it appears here.'}
            </Text>
            {!search && (
              <TouchableOpacity onPress={() => router.push('/save')} style={styles.emptyBtn}>
                <Text style={styles.emptyBtnText}>Save a place</Text>
              </TouchableOpacity>
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
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 1 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  emptyList: { flex: 1 },
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
    alignItems: 'center',
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  cardBody: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    gap: 3,
    marginBottom: 2,
  },
  typeLabel: { fontSize: 10, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 2,
  },
  addressText: { fontSize: 13, flex: 1, lineHeight: 18 },
  gpsBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  gpsBadgeText: { fontSize: 11, fontFamily: 'monospace' },
  dateText: { fontSize: 11, marginTop: 2 },
  mapsBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 4,
    alignSelf: 'stretch',
  },
  mapsBtnText: { fontSize: 10, fontWeight: '700' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  emptyBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
