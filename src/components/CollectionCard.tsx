import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Collection } from '../types';
import { useTheme } from '../context/ThemeContext';

interface CollectionCardProps {
  collection: Collection;
}

export function CollectionCard({ collection }: CollectionCardProps) {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <TouchableOpacity
      onPress={() => router.push(`/collection/${collection.id}`)}
      activeOpacity={0.75}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.iconContainer, { backgroundColor: collection.color + '20' }]}>
        <Ionicons name={collection.icon as any} size={24} color={collection.color} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {collection.name}
        </Text>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {collection.itemCount} {collection.itemCount === 1 ? 'item' : 'items'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
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
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  count: {
    fontSize: 13,
    marginTop: 2,
  },
});
