import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Linking,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { getItemById, deleteItem, toggleFavorite, toggleCompleted, updateItem } from '../../src/database/items';
import { getAISettings } from '../../src/services/settings';
import { summarizeItem } from '../../src/services/ai';
import { CONTENT_TYPE_CONFIG } from '../../src/constants';
import type { SavedItem } from '../../src/types';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { collections, refreshAll } = useData();
  const router = useRouter();
  const [item, setItem] = useState<SavedItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const loadItem = async () => {
    if (!id) return;
    const fetched = await getItemById(id);
    setItem(fetched);
    setEditNotes(fetched?.notes ?? '');
  };

  useEffect(() => {
    loadItem();
  }, [id]);

  if (!item) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loading}>
          <ActivityIndicator color="#3b82f6" />
        </View>
      </SafeAreaView>
    );
  }

  const config = CONTENT_TYPE_CONFIG[item.contentType];
  const collection = collections.find((c) => c.id === item.collectionId);

  const handleDelete = () => {
    Alert.alert('Delete Item', `Remove "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteItem(item.id);
          await refreshAll();
          router.back();
        },
      },
    ]);
  };

  const handleFavorite = async () => {
    await toggleFavorite(item.id, item.isFavorite);
    await loadItem();
    await refreshAll();
  };

  const handleComplete = async () => {
    await toggleCompleted(item.id, item.isCompleted);
    await loadItem();
    await refreshAll();
  };

  const handleSaveNotes = async () => {
    await updateItem(item.id, { notes: editNotes.trim() || undefined });
    await loadItem();
    setIsEditing(false);
  };

  const handleOpenUrl = () => {
    if (item.url) Linking.openURL(item.url);
  };

  const handleAISummarize = async () => {
    const aiSettings = await getAISettings();
    if (!aiSettings) {
      Alert.alert('No AI provider', 'Go to Settings to configure your AI provider and API key.');
      return;
    }
    setAiLoading(true);
    try {
      const result = await summarizeItem(
        aiSettings,
        item.title,
        item.url,
        item.description,
        item.contentType
      );
      await updateItem(item.id, { aiSummary: result.summary });
      await loadItem();
    } catch {
      Alert.alert('AI Error', 'Could not reach the AI provider. Check your API key in Settings.');
    }
    setAiLoading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Navigation Bar */}
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#3b82f6" />
          <Text style={{ color: '#3b82f6', fontSize: 16 }}>Back</Text>
        </TouchableOpacity>
        <View style={styles.navActions}>
          <TouchableOpacity onPress={handleFavorite}>
            <Ionicons
              name={item.isFavorite ? 'heart' : 'heart-outline'}
              size={22}
              color={item.isFavorite ? '#ef4444' : colors.icon}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Type badge */}
        <View style={[styles.typeBadge, { backgroundColor: config.color + '20' }]}>
          <Ionicons name={config.icon as any} size={14} color={config.color} />
          <Text style={[styles.typeLabel, { color: config.color }]}>{config.label}</Text>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>

        {/* Meta row */}
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {dayjs(item.createdAt).format('MMM D, YYYY')}
          </Text>
          {collection && (
            <View style={[styles.collectionChip, { backgroundColor: collection.color + '20' }]}>
              <Ionicons name={collection.icon as any} size={11} color={collection.color} />
              <Text style={[styles.collectionChipText, { color: collection.color }]}>
                {collection.name}
              </Text>
            </View>
          )}
        </View>

        {/* URL */}
        {item.url && (
          <TouchableOpacity
            onPress={handleOpenUrl}
            style={[styles.urlRow, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Ionicons name="link" size={15} color="#3b82f6" />
            <Text style={[styles.urlText, { color: '#3b82f6' }]} numberOfLines={1}>
              {item.url}
            </Text>
            <Ionicons name="open-outline" size={15} color="#3b82f6" />
          </TouchableOpacity>
        )}

        {/* Description */}
        {item.description && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>DESCRIPTION</Text>
            <Text style={[styles.bodyText, { color: colors.text }]}>{item.description}</Text>
          </View>
        )}

        {/* AI Summary */}
        <View style={[styles.section, { backgroundColor: '#8b5cf608', borderColor: '#8b5cf630' }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="sparkles" size={14} color="#8b5cf6" />
              <Text style={[styles.sectionTitle, { color: '#8b5cf6' }]}>AI SUMMARY</Text>
            </View>
            <TouchableOpacity onPress={handleAISummarize} disabled={aiLoading}>
              {aiLoading ? (
                <ActivityIndicator size="small" color="#8b5cf6" />
              ) : (
                <Text style={{ color: '#8b5cf6', fontSize: 13, fontWeight: '600' }}>
                  {item.aiSummary ? 'Refresh' : 'Generate'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
          {item.aiSummary ? (
            <Text style={[styles.bodyText, { color: colors.text }]}>{item.aiSummary}</Text>
          ) : (
            <Text style={[styles.bodyText, { color: colors.textMuted }]}>
              Tap Generate to get an AI summary of this item.
            </Text>
          )}
        </View>

        {/* Notes */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>MY NOTES</Text>
            <TouchableOpacity onPress={() => (isEditing ? handleSaveNotes() : setIsEditing(true))}>
              <Text style={{ color: '#3b82f6', fontSize: 13, fontWeight: '600' }}>
                {isEditing ? 'Save' : 'Edit'}
              </Text>
            </TouchableOpacity>
          </View>
          {isEditing ? (
            <TextInput
              value={editNotes}
              onChangeText={setEditNotes}
              multiline
              placeholder="Add your notes here…"
              placeholderTextColor={colors.placeholder}
              style={[styles.notesInput, { color: colors.text, borderColor: colors.border }]}
              autoFocus
              textAlignVertical="top"
            />
          ) : (
            <Text style={[styles.bodyText, { color: item.notes ? colors.text : colors.textMuted }]}>
              {item.notes ?? 'No notes yet. Tap Edit to add.'}
            </Text>
          )}
        </View>

        {/* Tags */}
        {item.tags.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>TAGS</Text>
            <View style={styles.tagsRow}>
              {item.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.tagText, { color: colors.textSecondary }]}>#{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Location */}
        {item.latitude && item.longitude && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="location" size={14} color="#06b6d4" />
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>LOCATION</Text>
            </View>
            {item.address && (
              <Text style={[styles.bodyText, { color: colors.text }]}>{item.address}</Text>
            )}
            <Text style={[styles.meta, { color: colors.textMuted, marginTop: 4 }]}>
              {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
            </Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            onPress={handleComplete}
            style={[
              styles.actionBtn,
              {
                backgroundColor: item.isCompleted ? colors.success + '20' : colors.surfaceSecondary,
                borderColor: item.isCompleted ? colors.success : colors.border,
              },
            ]}
          >
            <Ionicons
              name={item.isCompleted ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={20}
              color={item.isCompleted ? colors.success : colors.textSecondary}
            />
            <Text style={[styles.actionBtnText, { color: item.isCompleted ? colors.success : colors.textSecondary }]}>
              {item.isCompleted ? 'Completed!' : 'Mark as Done'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navActions: { flexDirection: 'row', gap: 16 },
  content: { padding: 16, paddingBottom: 60, gap: 14 },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  typeLabel: { fontSize: 12, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', lineHeight: 28 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { fontSize: 12 },
  collectionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  collectionChipText: { fontSize: 11, fontWeight: '600' },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  urlText: { flex: 1, fontSize: 13 },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bodyText: { fontSize: 14, lineHeight: 21 },
  notesInput: {
    fontSize: 14,
    lineHeight: 21,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minHeight: 80,
  },
  tagsSection: { gap: 8 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  tagText: { fontSize: 13 },
  actionButtons: { gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  actionBtnText: { fontSize: 15, fontWeight: '600' },
});
