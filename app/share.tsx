/**
 * share.tsx — Android Share-sheet receiver screen
 *
 * When the user shares a URL, text, or file from another app into Lumio
 * (via Android's share sheet), this screen opens as a modal pre-filled
 * with the shared content, ready to save.
 *
 * How it works:
 *  • app.json registers an intent-filter for ACTION_SEND (text/plain, text/html)
 *    via the expo-router deep-link plugin.
 *  • The shared URL/text is passed as a query param: lumio://share?url=...&text=...
 *  • This screen reads those params, pre-populates the save form, and lets the
 *    user confirm + save in one tap.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import uuid from 'react-native-uuid';
const uuidv4 = () => uuid.v4() as string;
import { useTheme } from '../src/context/ThemeContext';
import { useData } from '../src/context/DataContext';
import { saveItem } from '../src/database/items';
import { getAISettings } from '../src/services/settings';
import { summarizeItem } from '../src/services/ai';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../src/constants';
import type { ContentType, SavedItem } from '../src/types';
import { Button } from '../src/components/Button';

/** Guess content type from URL/text heuristics */
function guessContentType(url: string, text: string): ContentType {
  const combined = (url + ' ' + text).toLowerCase();
  if (combined.includes('youtube.com') || combined.includes('youtu.be') || combined.includes('vimeo')) return 'video';
  if (combined.includes('recipe') || combined.includes('ingredient') || combined.includes('cook')) return 'recipe';
  if (combined.includes('amazon') && combined.includes('book')) return 'book';
  if (combined.includes('netflix') || combined.includes('imdb') || combined.includes('movie')) return 'movie';
  if (combined.includes('restaurant') || combined.includes('tripadvisor') || combined.includes('yelp')) return 'restaurant';
  if (combined.includes('maps.google') || combined.includes('place')) return 'place';
  if (combined.includes('github') || combined.includes('npmjs') || combined.includes('tool') || combined.includes('app')) return 'tool';
  if (url.startsWith('http')) return 'link';
  return 'idea';
}

export default function ShareScreen() {
  const { colors } = useTheme();
  const { collections, refreshAll } = useData();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; text?: string; title?: string }>();

  const sharedUrl = params.url ?? '';
  const sharedText = params.text ?? '';
  const sharedTitle = params.title ?? '';

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [contentType, setContentType] = useState<ContentType>('link');
  const [collectionId, setCollectionId] = useState<string | undefined>();
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // Pre-fill from share params
  useEffect(() => {
    const resolvedUrl = sharedUrl || (sharedText?.startsWith('http') ? sharedText : '');
    const resolvedTitle = sharedTitle || (!sharedText?.startsWith('http') ? sharedText : '');

    setUrl(resolvedUrl);
    setTitle(resolvedTitle);
    setContentType(guessContentType(resolvedUrl, sharedText));
  }, []);

  const handleAISummarize = async () => {
    if (!title.trim() && !url.trim()) {
      Alert.alert('Add content first', 'Enter a title or URL before running AI auto-fill.');
      return;
    }
    const aiSettings = await getAISettings();
    if (!aiSettings) {
      Alert.alert('No AI provider', 'Go to Settings to configure your AI provider and API key.');
      return;
    }
    setAiLoading(true);
    try {
      const result = await summarizeItem(
        aiSettings,
        title.trim() || url,
        url.trim() || undefined,
        description.trim() || undefined,
        contentType,
      );
      if (result.suggestedTitle && !title.trim()) setTitle(result.suggestedTitle);
      if (result.suggestedTags.length > 0 && !tags.trim()) setTags(result.suggestedTags.join(', '));
      if (result.summary && !description.trim()) setDescription(result.summary);
    } catch {
      Alert.alert('AI Error', 'Could not reach the AI provider. Check your API key in Settings.');
    }
    setAiLoading(false);
  };

  const handleSave = async () => {
    if (!title.trim() && !url.trim()) {
      Alert.alert('Missing info', 'Please add a title or keep the URL.');
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const item: SavedItem = {
      id: uuidv4(),
      title: title.trim() || url,
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      contentType,
      collectionId,
      tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      isCompleted: false,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await saveItem(item);
    await refreshAll();
    setSaving(false);
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: '#3b82f6', fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Ionicons name="share-social" size={18} color={colors.textSecondary} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>Save Shared Item</Text>
          </View>
          <Button title="Save" onPress={handleSave} loading={saving} size="sm" />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Shared content preview */}
          {(sharedUrl || sharedText) ? (
            <View style={[styles.sharedPreview, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <Ionicons name="arrow-redo" size={14} color={colors.textMuted} />
              <Text style={[styles.sharedPreviewText, { color: colors.textMuted }]} numberOfLines={2}>
                {sharedUrl || sharedText}
              </Text>
            </View>
          ) : null}

          {/* Content type */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>CONTENT TYPE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll}>
            <View style={styles.typeRow}>
              {ALL_CONTENT_TYPES.map((type) => {
                const config = CONTENT_TYPE_CONFIG[type];
                const isActive = contentType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setContentType(type)}
                    style={[
                      styles.typeChip,
                      { backgroundColor: isActive ? config.color : colors.surfaceSecondary, borderColor: isActive ? config.color : colors.border },
                    ]}
                  >
                    <Ionicons name={config.icon as any} size={14} color={isActive ? '#fff' : colors.textSecondary} />
                    <Text style={[styles.typeChipText, { color: isActive ? '#fff' : colors.textSecondary }]}>{config.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* URL */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://..."
            placeholderTextColor={colors.placeholder}
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Title */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>TITLE</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What is this?"
            placeholderTextColor={colors.placeholder}
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
          />

          {/* AI Auto-fill */}
          <TouchableOpacity
            onPress={handleAISummarize}
            disabled={aiLoading}
            style={[styles.aiBtn, { borderColor: '#8b5cf6', backgroundColor: '#8b5cf610' }]}
          >
            {aiLoading ? <ActivityIndicator size="small" color="#8b5cf6" /> : <Ionicons name="sparkles" size={16} color="#8b5cf6" />}
            <Text style={{ color: '#8b5cf6', fontWeight: '600', fontSize: 14 }}>
              {aiLoading ? 'Analyzing…' : 'AI Auto-fill'}
            </Text>
          </TouchableOpacity>

          {/* Description */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>DESCRIPTION</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What is this about?"
            placeholderTextColor={colors.placeholder}
            style={[styles.input, styles.multiline, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Tags */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>TAGS (comma separated)</Text>
          <TextInput
            value={tags}
            onChangeText={setTags}
            placeholder="work, learning, ..."
            placeholderTextColor={colors.placeholder}
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
            autoCapitalize="none"
          />

          {/* Collection */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>COLLECTION</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll}>
            <View style={styles.typeRow}>
              <TouchableOpacity
                onPress={() => setCollectionId(undefined)}
                style={[
                  styles.typeChip,
                  { backgroundColor: !collectionId ? '#3b82f6' : colors.surfaceSecondary, borderColor: !collectionId ? '#3b82f6' : colors.border },
                ]}
              >
                <Text style={[styles.typeChipText, { color: !collectionId ? '#fff' : colors.textSecondary }]}>None</Text>
              </TouchableOpacity>
              {collections.map((col) => (
                <TouchableOpacity
                  key={col.id}
                  onPress={() => setCollectionId(col.id)}
                  style={[
                    styles.typeChip,
                    { backgroundColor: collectionId === col.id ? col.color : colors.surfaceSecondary, borderColor: collectionId === col.id ? col.color : colors.border },
                  ]}
                >
                  <Ionicons name={col.icon as any} size={14} color={collectionId === col.id ? '#fff' : colors.textSecondary} />
                  <Text style={[styles.typeChipText, { color: collectionId === col.id ? '#fff' : colors.textSecondary }]}>{col.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 60, gap: 8 },
  sharedPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    marginBottom: 4,
  },
  sharedPreviewText: { flex: 1, fontSize: 12, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
  multiline: { minHeight: 80, paddingTop: 11 },
  typeScroll: { marginBottom: 4 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  typeChipText: { fontSize: 13, fontWeight: '500' },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 8,
    marginBottom: 4,
  },
});
