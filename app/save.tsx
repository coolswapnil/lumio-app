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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import uuid from 'react-native-uuid';
const uuidv4 = () => uuid.v4() as string;
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../src/context/ThemeContext';
import { useData } from '../src/context/DataContext';
import { saveItem } from '../src/database/items';
import { getAISettings } from '../src/services/settings';
import { summarizeItem } from '../src/services/ai';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../src/constants';
import type { ContentType, SavedItem } from '../src/types';
import { Button } from '../src/components/Button';

export default function SaveScreen() {
  const { colors } = useTheme();
  const { collections, refreshAll } = useData();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [contentType, setContentType] = useState<ContentType>('link');
  const [collectionId, setCollectionId] = useState<string | undefined>();
  const [tags, setTags] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // Auto-detect from clipboard on mount
  useEffect(() => {
    Clipboard.getStringAsync().then((text) => {
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        setUrl(text);
        // Auto-detect YouTube
        if (text.includes('youtube.com') || text.includes('youtu.be')) {
          setContentType('video');
        }
      }
    });
  }, []);

  const handleAISummarize = async () => {
    if (!title.trim() && !url.trim()) {
      Alert.alert('Add content first', 'Enter a title or URL before running AI summarization.');
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
        contentType
      );
      if (result.suggestedTitle && !title.trim()) {
        setTitle(result.suggestedTitle);
      }
      if (result.suggestedTags.length > 0 && !tags.trim()) {
        setTags(result.suggestedTags.join(', '));
      }
      if (result.summary && !description.trim()) {
        setDescription(result.summary);
      }
    } catch (err) {
      Alert.alert('AI Error', 'Could not reach the AI provider. Check your API key in Settings.');
    }
    setAiLoading(false);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please enter a title for this item.');
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const item: SavedItem = {
      id: uuidv4() as string,
      title: title.trim(),
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      contentType,
      collectionId,
      tags: tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      notes: notes.trim() || undefined,
      address: address.trim() || undefined,
      isCompleted: false,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await saveItem(item);
    await refreshAll();
    setSaving(false);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: '#3b82f6', fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Save Item</Text>
          <Button title="Save" onPress={handleSave} loading={saving} size="sm" />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Content Type Selector */}
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
                      {
                        backgroundColor: isActive ? config.color : colors.surfaceSecondary,
                        borderColor: isActive ? config.color : colors.border,
                      },
                    ]}
                  >
                    <Ionicons name={config.icon as any} size={14} color={isActive ? '#fff' : colors.textSecondary} />
                    <Text style={[styles.typeChipText, { color: isActive ? '#fff' : colors.textSecondary }]}>
                      {config.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Title */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>TITLE *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What are you saving?"
            placeholderTextColor={colors.placeholder}
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
          />

          {/* URL */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>URL / LINK</Text>
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

          {/* AI Summarize */}
          <TouchableOpacity
            onPress={handleAISummarize}
            disabled={aiLoading}
            style={[styles.aiBtn, { borderColor: '#8b5cf6', backgroundColor: '#8b5cf610' }]}
          >
            {aiLoading ? (
              <ActivityIndicator size="small" color="#8b5cf6" />
            ) : (
              <Ionicons name="sparkles" size={16} color="#8b5cf6" />
            )}
            <Text style={{ color: '#8b5cf6', fontWeight: '600', fontSize: 14 }}>
              {aiLoading ? 'Analyzing…' : 'AI Auto-fill (summarize & tag)'}
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

          {/* Notes */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>PERSONAL NOTES</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Why did you save this? What will you do with it?"
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
            placeholder="recipe, italian, weekend..."
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
                  {
                    backgroundColor: !collectionId ? '#3b82f6' : colors.surfaceSecondary,
                    borderColor: !collectionId ? '#3b82f6' : colors.border,
                  },
                ]}
              >
                <Text style={[styles.typeChipText, { color: !collectionId ? '#fff' : colors.textSecondary }]}>
                  None
                </Text>
              </TouchableOpacity>
              {collections.map((col) => (
                <TouchableOpacity
                  key={col.id}
                  onPress={() => setCollectionId(col.id)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: collectionId === col.id ? col.color : colors.surfaceSecondary,
                      borderColor: collectionId === col.id ? col.color : colors.border,
                    },
                  ]}
                >
                  <Ionicons name={col.icon as any} size={14} color={collectionId === col.id ? '#fff' : colors.textSecondary} />
                  <Text style={[styles.typeChipText, { color: collectionId === col.id ? '#fff' : colors.textSecondary }]}>
                    {col.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Location */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>LOCATION / PLACE</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. Eiffel Tower, Paris or paste from content"
            placeholderTextColor={colors.placeholder}
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
          />
          <Text style={[styles.locationHint, { color: colors.textMuted }]}>
            Copy the place name or address from the video/post and paste it here. You can open it in Google Maps later.
          </Text>
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
  headerTitle: { fontSize: 17, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 60, gap: 8 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  multiline: {
    minHeight: 80,
    paddingTop: 11,
  },
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
  locationHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
});
