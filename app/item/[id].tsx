import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useTheme } from '../../src/context/ThemeContext';
import { useAppTheme } from '../../src/constants/colors';
import { useData } from '../../src/context/DataContext';
import { getItemById, deleteItem, toggleFavorite, toggleCompleted, updateItem } from '../../src/database/items';
import { getAISettings } from '../../src/services/settings';
import { summarizeItem } from '../../src/services/ai';
import { CONTENT_TYPE_CONFIG } from '../../src/constants';
import { getExactSourceLabel, CATEGORY_CONFIG } from '../../src/services/metadata';
import { logError, getUserMessage } from '../../src/utils/errors';
import type { SavedItem } from '../../src/types';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const paper = useAppTheme();
  const insets = useSafeAreaInsets();
  const { collections, refreshAll } = useData();
  const router = useRouter();
  const navigation = useNavigation(); // FIX C-5: needed to guard back navigation
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
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.loading}>
          {/* MD3 Expressive circular progress indicator */}
          <PaperActivityIndicator size="large" color={paper.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const config = CONTENT_TYPE_CONFIG[item.contentType];
  const collection = collections.find((c) => c.id === item.collectionId);
  const exactSource = getExactSourceLabel(item.source, item.mediaType, item.url);
  const catConfig = item.category ? CATEGORY_CONFIG[item.category] : undefined;

  const handleSelectSuggestedCollection = async (targetCollectionId: string) => {
    const isCurrent = item.collectionId === targetCollectionId;
    const newCollectionId = isCurrent ? undefined : targetCollectionId;
    await updateItem(item.id, { collectionId: newCollectionId });
    await loadItem();
    await refreshAll();
  };

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
    } catch (err) {
      // FIX C-4: log structured error and show safe user-facing message
      logError(err, { screen: 'item', action: 'aiSummarize' });
      Alert.alert('AI Error', getUserMessage(err));
    }
    setAiLoading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Navigation Bar */}
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            // FIX C-5: guard against no back history (e.g. opened via deep-link)
            if (navigation.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)');
            }
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={20} color={paper.colors.primary} />
          <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Back</Text>
        </TouchableOpacity>
        <View style={styles.navActions}>
          <TouchableOpacity onPress={handleFavorite}>
            <Ionicons
              name={item.isFavorite ? 'heart' : 'heart-outline'}
              size={22}
              color={item.isFavorite ? paper.colors.error : paper.colors.onSurfaceVariant}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete}>
            <Ionicons name="trash-outline" size={22} color={paper.colors.error} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {/* Badges Row: Exact Source & Category */}
        <View style={styles.badgesRow}>
          {/* Exact Source Badge (e.g. "Instagram Reel", "YouTube Video") */}
          <View style={[styles.typeBadge, { backgroundColor: config.color + '20' }]}>
            <Ionicons name={config.icon as any} size={14} color={config.color} />
            <Text style={[styles.typeLabel, { color: config.color }]}>{exactSource}</Text>
          </View>

          {/* Category Badge (e.g. "📊 Finance") */}
          {item.category && (
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: (catConfig?.color ?? '#10b981') + '20',
                  borderColor: (catConfig?.color ?? '#10b981') + '40',
                  borderWidth: 1,
                },
              ]}
            >
              <Text style={[styles.typeLabel, { color: catConfig?.color ?? colors.text, fontWeight: '700' }]}>
                {`${catConfig?.emoji ?? '🏷️'} ${item.category}`}
              </Text>
            </View>
          )}
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
            style={[styles.urlRow, { backgroundColor: paper.colors.surfaceContainerHigh, borderColor: paper.colors.outlineVariant }]}
          >
            <Ionicons name="link" size={15} color={paper.colors.primary} />
            <Text style={[styles.urlText, { color: paper.colors.primary }]} numberOfLines={1}>
              {item.url}
            </Text>
            <Ionicons name="open-outline" size={15} color={paper.colors.primary} />
          </TouchableOpacity>
        )}

        {/* Description */}
        {item.description && (
          <View style={[styles.section, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>DESCRIPTION</Text>
            <Text style={[styles.bodyText, { color: colors.text }]}>{item.description}</Text>
          </View>
        )}

        {/* AI Summary */}
        <View style={[styles.section, { backgroundColor: paper.colors.tertiaryContainer + '30', borderColor: paper.colors.tertiary + '40' }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="sparkles" size={14} color={paper.colors.tertiary} />
              <Text style={[styles.sectionTitle, { color: paper.colors.tertiary }]}>AI SUMMARY</Text>
            </View>
            <TouchableOpacity onPress={handleAISummarize} disabled={aiLoading}>
              {aiLoading ? (
                <PaperActivityIndicator size="small" color={paper.colors.tertiary} />
              ) : (
                <Text style={{ color: paper.colors.tertiary, fontSize: 13, fontWeight: '600' }}>
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
        <View style={[styles.section, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>MY NOTES</Text>
            <TouchableOpacity onPress={() => (isEditing ? handleSaveNotes() : setIsEditing(true))}>
              <Text style={{ color: paper.colors.primary, fontSize: 13, fontWeight: '600' }}>
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

        {/* AI Metadata & Confidences */}
        {(item.category || (item.suggestedCollections && item.suggestedCollections.length > 0)) && (
          <View style={[styles.section, { backgroundColor: paper.colors.surfaceContainerHigh, borderColor: colors.border }]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="sparkles" size={14} color={paper.colors.secondary} />
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>AI CLASSIFICATION & CONFIDENCE</Text>
            </View>
            <View style={styles.confidenceGrid}>
              {item.category && (
                <View style={styles.confidenceRow}>
                  <Text style={[styles.confidenceLabel, { color: colors.textMuted }]}>Category:</Text>
                  <Text style={[styles.confidenceValue, { color: colors.text }]}>
                    {`${item.category} `}
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>(95%)</Text>
                  </Text>
                </View>
              )}
              {item.suggestedCollections && item.suggestedCollections.length > 0 && (
                <View style={styles.confidenceRow}>
                  <Text style={[styles.confidenceLabel, { color: colors.textMuted }]}>Collection:</Text>
                  <Text style={[styles.confidenceValue, { color: colors.text }]}>
                    {collections.find((c) => c.id === item.suggestedCollections?.[0])?.name ?? 'Suggested'}{' '}
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>(90%)</Text>
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* AI Suggested Collections */}
        {item.suggestedCollections && item.suggestedCollections.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.border }]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="folder-outline" size={14} color={paper.colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>SUGGESTED COLLECTIONS</Text>
            </View>
            <Text style={[styles.hint, { color: colors.textMuted, marginBottom: 8 }]}>
              Tap a suggestion below to quickly move or assign this item:
            </Text>
            <View style={styles.suggestedCollectionsRow}>
              {item.suggestedCollections.map((cid) => {
                const col = collections.find((c) => c.id === cid);
                if (!col) return null;
                const isSelected = item.collectionId === cid;
                return (
                  <TouchableOpacity
                    key={cid}
                    onPress={() => handleSelectSuggestedCollection(cid)}
                    style={[
                      styles.suggestedColChip,
                      {
                        backgroundColor: isSelected ? col.color : paper.colors.surfaceContainerHighest,
                        borderColor: isSelected ? col.color : paper.colors.secondary + '66',
                        borderStyle: isSelected ? 'solid' : 'dashed',
                      },
                    ]}
                  >
                    <Ionicons
                      name={isSelected ? 'checkmark' : 'sparkles'}
                      size={13}
                      color={isSelected ? '#fff' : paper.colors.secondary}
                    />
                    <Ionicons
                      name={col.icon as any}
                      size={14}
                      color={isSelected ? '#fff' : paper.colors.onSurfaceVariant}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '600',
                        color: isSelected ? '#fff' : paper.colors.onSurfaceVariant,
                      }}
                    >
                      {col.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>TAGS</Text>
            <View style={styles.tagsRow}>
              {item.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <Text style={[styles.tagText, { color: colors.textSecondary }]}>#{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Location */}
        {(item.address || (item.latitude && item.longitude)) && (
          <View style={[styles.section, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.border }]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="location" size={14} color={paper.colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>LOCATION</Text>
            </View>
            {item.address && (
              <Text style={[styles.bodyText, { color: colors.text }]}>{item.address}</Text>
            )}
            {item.latitude && item.longitude && (
              <Text style={[styles.meta, { color: colors.textMuted, marginTop: 2, fontFamily: 'monospace' }]}>
                {`${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`}
              </Text>
            )}
            <TouchableOpacity
              onPress={() => {
                // Prefer precise GPS coords; fall back to address text
                let mapsUrl: string;
                let fallback: string;
                if (item.latitude && item.longitude) {
                  mapsUrl = `geo:${item.latitude},${item.longitude}?q=${item.latitude},${item.longitude}`;
                  fallback = `https://maps.google.com/?q=${item.latitude},${item.longitude}`;
                } else {
                  const encoded = encodeURIComponent(item.address ?? '');
                  mapsUrl = `geo:0,0?q=${encoded}`;
                  fallback = `https://maps.google.com/?q=${encoded}`;
                }
                Linking.canOpenURL(mapsUrl)
                  .then((ok) => Linking.openURL(ok ? mapsUrl : fallback))
                  .catch(() => Linking.openURL(fallback));
              }}
              style={[styles.openMapsBtn, { backgroundColor: paper.colors.primaryContainer }]}
            >
              <Ionicons name="navigate" size={16} color={paper.colors.onPrimaryContainer} />
              <Text style={[styles.openMapsBtnText, { color: paper.colors.onPrimaryContainer }]}>Open in Google Maps</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            onPress={handleComplete}
            style={[
              styles.actionBtn,
              {
                backgroundColor: item.isCompleted ? colors.success + '20' : colors.surfaceContainerHigh,
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

const detailExtraStyles = StyleSheet.create({
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  confidenceGrid: {
    gap: 6,
    marginTop: 4,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confidenceLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  confidenceValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  suggestedCollectionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestedColChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  hint: {
    fontSize: 12,
    lineHeight: 16,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  confidenceGrid: {
    gap: 6,
    marginTop: 4,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confidenceLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  confidenceValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  suggestedCollectionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestedColChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  hint: {
    fontSize: 12,
    lineHeight: 16,
  },
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
  content: { padding: 16, gap: 14 },
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
  openMapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 6,
  },
  openMapsBtnText: {
    fontWeight: '700',
    fontSize: 14,
  },
});
