import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme as usePaperTheme } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { ItemCard } from '../../src/components/ItemCard';
import { getItemsByCollection } from '../../src/database/items';
import { deleteCollection } from '../../src/database/collections';
import type { SavedItem } from '../../src/types';

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const paper = usePaperTheme();
  const { collections, refreshAll } = useData();
  const router = useRouter();
  const [items, setItems] = useState<SavedItem[]>([]);

  const collection = collections.find((c) => c.id === id);

  useEffect(() => {
    if (!id) return;
    getItemsByCollection(id).then(setItems);
  }, [id]);

  const handleDelete = () => {
    Alert.alert(
      'Delete Collection',
      `Delete "${collection?.name}"? Items will not be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            await deleteCollection(id);
            await refreshAll();
            router.back();
          },
        },
      ]
    );
  };

  if (!collection) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.empty}>
          <Text style={[{ color: colors.text }]}>Collection not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={paper.colors.primary} />
          <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDelete}>
          <Ionicons name="trash-outline" size={20} color={paper.colors.error} />
        </TouchableOpacity>
      </View>

      {/* Collection header */}
      <View style={[styles.collectionHeader, { borderBottomColor: colors.border }]}>
        <View style={[styles.iconContainer, { backgroundColor: collection.color + '20' }]}>
          <Ionicons name={collection.icon as any} size={28} color={collection.color} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={[styles.collectionName, { color: colors.text }]}>{collection.name}</Text>
          {collection.description && (
            <Text style={[styles.collectionDesc, { color: colors.textSecondary }]}>
              {collection.description}
            </Text>
          )}
          <Text style={[styles.itemCount, { color: colors.textMuted }]}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ItemCard item={item} />}
        contentContainerStyle={[styles.list, items.length === 0 && styles.emptyList]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={40} color={paper.colors.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: paper.colors.onSurface }]}>
              No items in this collection
            </Text>
            <TouchableOpacity onPress={() => router.push('/save')} style={[styles.addBtn, { backgroundColor: paper.colors.primary }]}>
              <Text style={[styles.addBtnText, { color: paper.colors.onPrimary }]}>Save something here</Text>
            </TouchableOpacity>
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
  collectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    gap: 14,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  collectionName: { fontSize: 20, fontWeight: '800' },
  collectionDesc: { fontSize: 13, marginTop: 2 },
  itemCount: { fontSize: 12, marginTop: 3 },
  list: { padding: 16, paddingBottom: 80 },
  emptyList: { flex: 1 },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyText: { fontSize: 15, fontWeight: '500', marginTop: 8 },
  addBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  addBtnText: { fontWeight: '600', fontSize: 14 },
});
