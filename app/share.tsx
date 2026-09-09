/**
 * share.tsx — Android Share-sheet receiver screen
 *
 * When the user shares a URL from another app (Instagram, YouTube, X,
 * LinkedIn, Safari/Chrome) Lumio receives it here via ACTION_SEND or
 * a deep-link intent filter.
 *
 * Behaviour (zero-tap capture):
 *   1. Parse / resolve the shared URL immediately.
 *   2. Enqueue the URL — this persists a skeleton item to SQLite at once.
 *   3. Navigate back to the library tab immediately.
 *   4. Background enrichment runs via the CaptureQueue service:
 *        Source → Thumbnail → Metadata → AI Summary → Tags →
 *        Category → Collections → Location
 *   5. The ProcessingBanner in the root layout shows progress.
 *
 * A minimal "Saving…" splash is shown for the ~300 ms it takes to
 * persist the skeleton, then the screen dismisses itself.
 *
 * The manual form (fallback) is still rendered when there is no URL —
 * e.g. the user navigates to /share directly.
 *
 * ── Reliability notes ─────────────────────────────────────────────────────
 * • The auto-capture effect runs whenever `sharedUrl` or `sharedText` params
 *   change, not just on mount. This handles the cold-start hydration race
 *   where Expo Router delivers params after the first render frame.
 * • A module-level dedup set (`_capturedUrls`) prevents the same URL from
 *   being enqueued twice when the user shares rapidly or taps twice.
 * • All share pipeline events are written to diagLog unconditionally (the
 *   always-on tier) so failures are always traceable in production.
 */

import React, { useState, useEffect, useRef } from 'react';
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
import { ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/context/ThemeContext';
import { useAppTheme } from '../src/constants/colors';
import { useData } from '../src/context/DataContext';
import { useCaptureQueue } from '../src/context/CaptureQueueContext';
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

/**
 * Module-level dedup set.  Lives outside the component so it survives
 * re-renders and even fast-refresh in development.  Cleared when the app
 * process restarts — intentional, as a fresh process should accept any URL.
 *
 * Key: resolved URL string.  Value: timestamp of first enqueue.
 * Entries older than DEDUP_TTL_MS are evicted before each check so the same
 * URL can be re-shared after a reasonable delay.
 */
const _capturedUrls = new Map<string, number>();
const DEDUP_TTL_MS = 5_000; // 5 seconds — prevents rapid double-taps

function isDuplicate(url: string): boolean {
  const now = Date.now();
  // Evict stale entries
  for (const [key, ts] of _capturedUrls) {
    if (now - ts > DEDUP_TTL_MS) _capturedUrls.delete(key);
  }
  if (_capturedUrls.has(url)) return true;
  _capturedUrls.set(url, now);
  return false;
}

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
  return match[0].replace(/[.)>]+$/, '');
}

export default function ShareScreen() {
  const { colors } = useTheme();
  const paper = useAppTheme();
  const { collections, refreshAll } = useData();
  const { enqueue } = useCaptureQueue();
  const router = useRouter();
  const params = useLocalSearchParams();

  // Sanitize all deep-link params before use.
  // params.text is the primary share payload from Android's EXTRA_TEXT
  // (routed here via MainActivity.rewriteShareIntent + +native-intent.ts).
  // params.url is a legacy path kept for backward compatibility.
  // params.subject comes from EXTRA_SUBJECT (some apps send link title there).
  const sharedUrl     = sanitizeUrl(asString(params.url     as string | string[] | undefined));
  const sharedText    = sanitizeText(asString(params.text    as string | string[] | undefined), LIMITS.DESCRIPTION);
  const sharedTitle   = sanitizeText(asString(params.title   as string | string[] | undefined), LIMITS.TITLE);
  const sharedSubject = sanitizeText(asString(params.subject as string | string[] | undefined), LIMITS.TITLE);

  // ── Auto-capture state ────────────────────────────────────────────────────
  // 'idle'     — no URL in params, show manual form
  // 'capturing'— enqueue() in flight (skeleton DB write, ~100–300 ms)
  // 'done'     — item saved, navigating away
  const [autoState, setAutoState] = useState<'idle' | 'capturing' | 'done'>('idle');

  /**
   * Tracks the URL we already dispatched so the effect — which now runs on
   * every param change — does not fire twice for the same URL when React
   * re-renders after enqueue() resolves.
   */
  const lastCapturedUrlRef = useRef<string>('');

  // ── Manual form state (fallback when no URL in params) ───────────────────
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [contentType, setContentType] = useState<ContentType>('link');
  const [collectionId, setCollectionId] = useState<string | undefined>();
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // ── Auto-capture ──────────────────────────────────────────────────────────
  //
  // Run whenever sharedUrl or sharedText change so we catch the case where
  // Expo Router delivers params *after* the initial render (cold-start race).
  //
  // Guards:
  //   • lastCapturedUrlRef  — prevents re-running after state updates cause a
  //                           re-render with identical params.
  //   • isDuplicate()       — module-level 5-second dedup window prevents two
  //                           rapid shares of the same URL both being enqueued.
  //   • autoState !== 'idle' — if we're already capturing, don't start again.
  //
  useEffect(() => {
    // ── Check if a queue item was already created ───────────────────────────
    if (diagLog.hasQueueItemCreated()) {
      diagLog.addEntry('SHARE_SCREEN_SUCCESS', 'Queue item already created — suppressing error dialogs and redirecting');
      setAutoState('done');
      try {
        router.replace('/(tabs)');
        diagLog.addEntry('NAVIGATION_SUCCESS', 'router.replace(/(tabs)) succeeded');
      } catch (navErr) {
        diagLog.addEntry('NAVIGATION_ERROR', `router.replace failed: ${navErr instanceof Error ? navErr.message : String(navErr)}`);
      }
      return;
    }

    // Already capturing or done — nothing to do.
    if (autoState !== 'idle') return;

    const rawText = sharedText ?? '';

    // Log every param received so we can trace the full intent pipeline.
    diagLog.addEntry('SHARE_INTENT_RECEIVED',
      `url="${(sharedUrl ?? '').slice(0, 120)}" text="${rawText.slice(0, 80)}" title="${(sharedTitle ?? '').slice(0, 80)}"`);
    diagLog.addEntry('SHARE_TEXT', `text="${rawText.slice(0, 120)}"`);
    diagLog.addEntry('ROUTE_TO_SHARE_SCREEN', `params received`);

    // ── Resolve URL ───────────────────────────────────────────────────────
    // Priority:
    //   1. params.url  (explicit URL from deep-link)
    //   2. params.text that IS a URL (Android share of a URL)
    //   3. First http URL found inside params.text (Instagram, X etc.)
    let resolvedUrl = sharedUrl ?? '';
    if (!resolvedUrl && rawText) {
      if (rawText.startsWith('http')) {
        resolvedUrl = sanitizeUrl(rawText.trim()) ?? '';
      } else {
        resolvedUrl = sanitizeUrl(extractUrlFromText(rawText)) ?? '';
      }
    }

    diagLog.addEntry('URL_EXTRACTED', `resolvedUrl="${resolvedUrl.slice(0, 120)}"`);

    if (!resolvedUrl) {
      // No URL — fall through to manual form.
      // Use subject or title as a hint if no displayable text is available.
      const resolvedTitle = sharedTitle || sharedSubject || (!rawText.startsWith('http') ? rawText : '');
      setTitle(resolvedTitle);
      setContentType(guessContentType('', rawText));
      return;
    }

    // Since ShareIngestionManager has already persisted and enqueued this URL
    // before we routed to /share, we can bypass auto-capture entirely.
    diagLog.addEntry('SHARE_SCREEN_SUCCESS', `Bypassing ShareScreen auto-capture, already processed url="${resolvedUrl.slice(0, 80)}"`);
    setAutoState('done');
    try {
      router.replace('/(tabs)');
      diagLog.addEntry('NAVIGATION_SUCCESS', 'router.replace(/(tabs)) succeeded');
    } catch (navErr) {
      diagLog.addEntry('NAVIGATION_ERROR', `router.replace failed: ${navErr instanceof Error ? navErr.message : String(navErr)}`);
    }
  // deps: re-run when any share param changes (handles cold-start race).
  }, [sharedUrl, sharedText, sharedSubject]); // eslint-disable-line

  // ── Manual AI auto-fill (fallback form) ──────────────────────────────────
  const handleAISummarize = async () => {
    if (diagLog.hasQueueItemCreated()) {
      diagLog.addEntry('SHARE_SCREEN_SUCCESS', 'Suppressing AI error alert because queue item already exists');
      return;
    }

    if (!title.trim() && !url.trim()) {
      Alert.alert('Add content first', 'Enter a title or URL before running AI auto-fill.');
      return;
    }
    const aiSettings = await getAISettings().catch(() => null);
    if (!aiSettings) {
      if (!diagLog.hasQueueItemCreated()) {
        Alert.alert('No AI provider', 'Go to Settings to configure your AI provider and API key.');
      }
      return;
    }
    setAiLoading(true);
    try {
      const metadata = url.trim() ? await fetchPageMetadata(url).catch(() => null) : null;
      const metadataText = [metadata ? formatMetadataForAI(metadata) : '', description.trim()]
        .filter(Boolean).join('\n');
      const aiInputTitle = metadata?.title || title.trim() || url;
      const result = await summarizeItem(aiSettings, aiInputTitle, undefined, metadataText || undefined, contentType);
      if (result.error) {
        if (!diagLog.hasQueueItemCreated()) {
          diagLog.addEntry('SHARE_SCREEN_ERROR', `AI Error: ${result.error}`);
          Alert.alert('AI Error', result.error);
        }
      } else {
        if (result.suggestedTitle && !title.trim()) setTitle(result.suggestedTitle);
        if (result.suggestedTags.length > 0 && !tags.trim()) setTags(result.suggestedTags.join(', '));
        if (result.summary && !description.trim()) setDescription(result.summary);
      }
    } catch (err) {
      if (!diagLog.hasQueueItemCreated()) {
        diagLog.addEntry('SHARE_SCREEN_ERROR', `AI summarize exception: ${err instanceof Error ? err.message : String(err)}`);
        Alert.alert('AI Error', 'Could not reach the AI provider. Check your API key in Settings.');
      }
    }
    setAiLoading(false);
  };

  // ── Manual save (fallback form) ───────────────────────────────────────────
  const handleSave = async () => {
    if (diagLog.hasQueueItemCreated()) {
      diagLog.addEntry('SHARE_SCREEN_SUCCESS', 'Suppressing save failure dialog because queue item already exists');
      router.replace('/(tabs)');
      return;
    }

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
      diagLog.addEntry('SHARE_SCREEN_SUCCESS', `Manual save completed for item ${item.id}`);
      try {
        router.replace('/(tabs)');
        diagLog.addEntry('NAVIGATION_SUCCESS', 'router.replace(/(tabs)) after manual save succeeded');
      } catch (navErr) {
        diagLog.addEntry('NAVIGATION_ERROR', `router.replace failed: ${navErr instanceof Error ? navErr.message : String(navErr)}`);
      }
    } catch (err) {
      logError(err, { screen: 'share', action: 'saveItem' });
      diagLog.addEntry('SHARE_SCREEN_ERROR', `Manual save error: ${err instanceof Error ? err.message : String(err)}`);
      if (!diagLog.hasQueueItemCreated()) {
        Alert.alert('Save failed', getUserMessage(err));
      } else {
        diagLog.addEntry('SHARE_SCREEN_SUCCESS', 'Suppressed Save failed dialog because QUEUE_ITEM_CREATED was present');
        try {
          router.replace('/(tabs)');
        } catch { /* ignore */ }
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-capture splash ───────────────────────────────────────────────────
  if (autoState === 'capturing' || autoState === 'done') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <View style={styles.container}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Ionicons name="share-social" size={18} color={colors.textSecondary} />
              <Text style={[styles.headerTitle, { color: colors.text }]}>Capturing…</Text>
            </View>
            <View style={{ width: 54 }} />
          </View>
          <View style={styles.captureOverlay}>
            <PaperActivityIndicator size="large" color={paper.colors.primary} />
            <Text style={[styles.captureLabel, { color: colors.text }]}>Saved!</Text>
            <Text style={[styles.captureSub, { color: colors.textMuted }]}>
              Enrichment is running in the background.{'\n'}Check the banner at the bottom of the screen.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Manual fallback form ──────────────────────────────────────────────────
  return (
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
                    <Ionicons name={config.icon as any} size={14} color={isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant} />
                    <Text style={[styles.typeChipText, { color: isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant }]}>{config.label}</Text>
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
                  <Ionicons name={col.icon as any} size={14} color={collectionId === col.id ? paper.colors.onPrimary : paper.colors.onSurfaceVariant} />
                  <Text style={[styles.typeChipText, { color: collectionId === col.id ? paper.colors.onPrimary : paper.colors.onSurfaceVariant }]}>{col.name}</Text>
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
  captureOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  captureLabel: { fontSize: 22, fontWeight: '800' },
  captureSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
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

// ─── Test-only exports ────────────────────────────────────────────────────────
// These three pure helpers are package-private by design; they are exported
// here exclusively to allow unit testing without a React Native runtime.
// Import only from test files — never from production code.
export const _testOnly = {
  extractUrlFromText,
  guessContentType,
  isDuplicate,
  DEDUP_TTL_MS,
  _capturedUrls,
};
