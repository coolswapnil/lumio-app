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
import { ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
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
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/context/ThemeContext';
import { useAppTheme } from '../src/constants/colors';
import { useData } from '../src/context/DataContext';
import { saveItem } from '../src/database/items';
import { getAISettings } from '../src/services/settings';
import { summarizeItem } from '../src/services/ai';
import { fetchPageMetadata, formatMetadataForAI } from '../src/services/metadata';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../src/constants';
import type { ContentType, SavedItem } from '../src/types';
import { Button } from '../src/components/Button';
import { generateId } from '../src/utils/uuid';
import { asString, sanitizeText, parseTags, sanitizeUrl, LIMITS } from '../src/utils/validation';
import { logError, getUserMessage } from '../src/utils/errors';
import { diagLog } from '../src/services/diagnostics';

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

/** Extract the first https?:// URL from a plain-text string (e.g. Instagram share text). */
function extractUrlFromText(text: string): string {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) return '';
  // Trim trailing punctuation that was captured as part of the URL
  return match[0].replace(/[.)>]+$/, '');
}

export default function ShareScreen() {
  const { colors } = useTheme();
  const paper = useAppTheme();
  const { collections, refreshAll } = useData();
  const router = useRouter();
  const params = useLocalSearchParams();

  // Sanitize all deep-link params before use.
  // Note: after the native bridge in MainActivity, ACTION_SEND intents arrive
  // here as lumio://share?url=<extracted-url>&text=<remaining-text>&title=<subject>
  const sharedUrl = sanitizeUrl(asString(params.url as string | string[] | undefined));
  const sharedText = sanitizeText(asString(params.text as string | string[] | undefined), LIMITS.DESCRIPTION);
  const sharedTitle = sanitizeText(asString(params.title as string | string[] | undefined), LIMITS.TITLE);

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [contentType, setContentType] = useState<ContentType>('link');
  const [collectionId, setCollectionId] = useState<string | undefined>();
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // Pre-fill from share params.
  // Covers three entry paths:
  //   1. Deep-link: lumio://share?url=https://...  (browser share, manifest VIEW filter)
  //   2. ACTION_SEND bridge: lumio://share?url=https://instagram.com/reels/...
  //   3. Fallback: url param absent but text param contains a raw URL (e.g. Instagram posts)
  useEffect(() => {
    const rawText = sharedText ?? '';

    diagLog.addEntry('SHARE_INTENT_RECEIVED', `url="${(sharedUrl ?? '').slice(0, 120)}" text="${rawText.slice(0, 80)}" title="${(sharedTitle ?? '').slice(0, 80)}"`);
    diagLog.addEntry('SHARE_ACTION', 'ACTION_SEND or deep-link — received by share screen');
    diagLog.addEntry('SHARE_MIME_TYPE', sharedUrl ? 'url-param (deep-link)' : rawText ? 'text/plain (ACTION_SEND bridge)' : 'unknown');
    diagLog.addEntry('SHARE_TEXT', `rawText="${rawText.slice(0, 120)}"`);

    // If the bridge didn't extract a URL (edge case), attempt JS-side extraction from text
    let resolvedUrl = sharedUrl ?? '';
    if (!resolvedUrl && rawText) {
      if (rawText.startsWith('http')) {
        resolvedUrl = sanitizeUrl(rawText.trim()) ?? '';
      } else {
        const extracted = extractUrlFromText(rawText);
        resolvedUrl = sanitizeUrl(extracted) ?? '';
      }
    }

    diagLog.addEntry('SHARE_URL_EXTRACTED', `resolvedUrl="${resolvedUrl.slice(0, 120)}"`);

    const resolvedTitle = sharedTitle || (!rawText.startsWith('http') ? rawText : '');

    diagLog.addEntry('SHARE_SCREEN_OPENED', `resolvedUrl="${resolvedUrl.slice(0, 120)}" resolvedTitle="${resolvedTitle.slice(0, 80)}"`);

    setUrl(resolvedUrl);
    setTitle(resolvedTitle);
    const guessed = guessContentType(resolvedUrl, rawText);
    setContentType(guessed);

    diagLog.addEntry('SHARE_FORM_POPULATED', `url="${resolvedUrl.slice(0, 120)}" title="${resolvedTitle.slice(0, 80)}" contentType=${guessed}`);
    diagLog.addEntry('SHARE_INTENT_PARSED', `resolvedUrl="${resolvedUrl.slice(0, 120)}" resolvedTitle="${resolvedTitle.slice(0, 80)}" contentType=${guessed}`);
  }, [sharedUrl, sharedText, sharedTitle]);

  const handleAISummarize = async () => {
    if (!title.trim() && !url.trim()) {
      Alert.alert('Add content first', 'Enter a title or URL before running AI auto-fill.');
      return;
    }
    diagLog.addEntry('AI_REQUEST_STARTED', 'share screen: checking AI settings');
    const aiSettings = await getAISettings();
    if (!aiSettings) {
      diagLog.addEntry('AI_REQUEST_STARTED', 'share screen: no AI provider configured');
      Alert.alert('No AI provider', 'Go to Settings to configure your AI provider and API key.');
      return;
    }
    diagLog.addEntry('AI_REQUEST_STARTED', `share screen: provider=${aiSettings.provider} model=${aiSettings.model ?? '(default)'}`);
    setAiLoading(true);
    try {
      diagLog.addEntry('METADATA_FOUND', `share screen: fetching metadata for url="${url.slice(0, 120)}"`);
      const metadata = url.trim() ? await fetchPageMetadata(url) : null;
      if (url.trim() && !metadata) {
        diagLog.addEntry('METADATA_FOUND', 'share screen: extraction failed or returned null');
        Alert.alert('Could not extract metadata', 'AI auto-fill will use the title you provided instead.');
      } else if (metadata) {
        diagLog.addEntry('METADATA_FOUND', `share screen: source=${metadata.source} title="${(metadata.title ?? '').slice(0, 80)}"`);
      }
      const metadataText = [metadata ? formatMetadataForAI(metadata) : '', description.trim()]
        .filter(Boolean)
        .join('\n');
      const aiInputTitle = metadata?.title || title.trim() || url;
      diagLog.addEntry('AI_REQUEST_STARTED', `share screen: calling summarizeItem title="${aiInputTitle.slice(0, 80)}" metadataLen=${metadataText.length}`);
      const result = await summarizeItem(
        aiSettings,
        aiInputTitle,
        undefined,
        metadataText || undefined,
        contentType,
      );
      diagLog.addEntry('AI_RESPONSE_RECEIVED', `share screen: summary="${result.summary.slice(0, 80)}" tags=${result.suggestedTags.length} error=${result.error ?? 'none'}`);
      if (result.error) {
        diagLog.addEntry('PROVIDER_ERROR', `share screen: ${result.error}`);
        Alert.alert('AI Error', result.error);
      } else {
        if (result.suggestedTitle && !title.trim()) setTitle(result.suggestedTitle);
        if (result.suggestedTags.length > 0 && !tags.trim()) setTags(result.suggestedTags.join(', '));
        if (result.summary && !description.trim()) setDescription(result.summary);
        diagLog.addEntry('FORM_UPDATE_COMPLETED', `share screen: title=${Boolean(result.suggestedTitle)} tags=${result.suggestedTags.length} desc=${Boolean(result.summary)}`);
      }
    } catch (err) {
      diagLog.addEntry('PROVIDER_ERROR', `share screen: unexpected error — ${err instanceof Error ? err.message : String(err)}`);
      Alert.alert('AI Error', 'Could not reach the AI provider. Check your API key in Settings.');
    }
    setAiLoading(false);
  };

  const handleSave = async () => {
    const cleanTitle = sanitizeText(title, LIMITS.TITLE) || sanitizeUrl(url);
    if (!cleanTitle) {
      Alert.alert('Missing info', 'Please add a title or a valid URL.');
      return;
    }
    const cleanUrl = url.trim() ? sanitizeUrl(url) : undefined;
    if (url.trim() && !cleanUrl) {
      Alert.alert('Invalid URL', 'Please enter a valid http(s) URL or leave the field empty.');
      return;
    }
    diagLog.addEntry('SAVE_STARTED', `share screen: title="${cleanTitle.slice(0, 80)}" url="${(cleanUrl ?? '').slice(0, 120)}" type=${contentType}`);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const item: SavedItem = {
        id: generateId(),
        title: cleanTitle,
        description: sanitizeText(description, LIMITS.DESCRIPTION) || undefined,
        url: cleanUrl,
        contentType,
        collectionId,
        tags: parseTags(tags),
        isCompleted: false,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveItem(item);
      await refreshAll();
      diagLog.addEntry('SAVE_COMPLETED', `share screen: id=${item.id} title="${cleanTitle.slice(0, 80)}"`);
      router.replace('/(tabs)');
    } catch (err) {
      logError(err, { screen: 'share', action: 'saveItem' });
      diagLog.addEntry('SAVE_FAILED', `share screen: ${err instanceof Error ? err.message : String(err)}`);
      Alert.alert('Save failed', getUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    // SafeAreaView outermost: consumes status-bar inset before KeyboardAvoidingView
    // sees it — prevents the header from overlapping the status bar on Android.
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Cancel</Text>
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
            <View style={[styles.sharedPreview, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.border }]}>
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
                      { backgroundColor: isActive ? config.color : paper.colors.surfaceContainerHigh, borderColor: isActive ? config.color : paper.colors.outlineVariant },
                    ]}
                  >
                    <Ionicons name={config.icon as any} size={14} color={isActive ? '#fff' : paper.colors.onSurfaceVariant} />
                    <Text style={[styles.typeChipText, { color: isActive ? '#fff' : paper.colors.onSurfaceVariant }]}>{config.label}</Text>
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
            style={[styles.aiBtn, { borderColor: paper.colors.tertiary, backgroundColor: paper.colors.tertiaryContainer + '40' }]}
          >
            {aiLoading ? <PaperActivityIndicator size="small" color={paper.colors.tertiary} /> : <Ionicons name="sparkles" size={16} color={paper.colors.tertiary} />}
            <Text style={{ color: paper.colors.onTertiaryContainer, fontWeight: '600', fontSize: 14 }}>
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
                  { backgroundColor: !collectionId ? paper.colors.primaryContainer : paper.colors.surfaceContainerHigh, borderColor: !collectionId ? paper.colors.primary : paper.colors.outlineVariant },
                ]}
              >
                <Text style={[styles.typeChipText, { color: !collectionId ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant }]}>None</Text>
              </TouchableOpacity>
              {collections.map((col) => (
                <TouchableOpacity
                  key={col.id}
                  onPress={() => setCollectionId(col.id)}
                  style={[
                    styles.typeChip,
                    { backgroundColor: collectionId === col.id ? col.color : paper.colors.surfaceContainerHigh, borderColor: collectionId === col.id ? col.color : paper.colors.outlineVariant },
                  ]}
                >
                  <Ionicons name={col.icon as any} size={14} color={collectionId === col.id ? '#fff' : paper.colors.onSurfaceVariant} />
                  <Text style={[styles.typeChipText, { color: collectionId === col.id ? '#fff' : paper.colors.onSurfaceVariant }]}>{col.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
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
    paddingBottom: 14,
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
