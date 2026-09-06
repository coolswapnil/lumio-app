/**
 * save.tsx — "Save Item" screen
 *
 * Two modes:
 *
 * URL MODE (automatic):
 *   User pastes a URL or clipboard URL is detected.
 *   The moment a valid URL is confirmed (800 ms debounce after typing stops,
 *   or instantly on clipboard paste), the URL is enqueued and the screen
 *   navigates back to the library. No button press required. No form to fill.
 *   Background enrichment runs via CaptureQueue; the ProcessingBanner shows
 *   progress.
 *
 * MANUAL MODE (no URL):
 *   Used for ideas, notes, or anything without a link.
 *   Title is required. Optional description, notes, tags, collection, location.
 *   Saved immediately via direct DB write — no background enrichment needed.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import { generateId } from '../src/utils/uuid';
import { sanitizeText, parseTags, sanitizeUrl, extractSafeUrl, isValidUrl, LIMITS } from '../src/utils/validation';
import { logError, getUserMessage } from '../src/utils/errors';
import { useTheme } from '../src/context/ThemeContext';
import { useAppTheme, type AppTheme } from '../src/constants/colors';
import { useData } from '../src/context/DataContext';
import { useCaptureQueue } from '../src/context/CaptureQueueContext';
import { saveItem } from '../src/database/items';
import { diagLog } from '../src/services/diagnostics';
import {
  detectUrlSource,
  detectMediaType,
  getDisplayHostname,
  suggestContentType,
  URL_SOURCE_LABELS,
  URL_SOURCE_ICONS,
  MEDIA_TYPE_LABELS,
  MEDIA_TYPE_ICONS,
  type PageMetadata,
} from '../src/services/metadata';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../src/constants';
import type { ContentType, SavedItem, UrlSource, MediaType } from '../src/types';

// ─── Clipboard Banner ─────────────────────────────────────────────────────────

interface ClipboardBannerProps {
  clipUrl: string;
  onPaste: () => void;
  onDismiss: () => void;
  isExpressive: boolean;
  paper: AppTheme;
}

function ClipboardBanner({ clipUrl, onPaste, onDismiss, isExpressive, paper }: ClipboardBannerProps) {
  const hostname = getDisplayHostname(clipUrl);
  return (
    <View
      style={[
        clipStyles.banner,
        {
          backgroundColor: paper.colors.secondaryContainer,
          borderColor: paper.colors.secondary + '55',
          borderRadius: isExpressive ? 16 : 10,
        },
      ]}
    >
      <Ionicons name="clipboard-outline" size={16} color={paper.colors.onSecondaryContainer} />
      <View style={{ flex: 1 }}>
        <Text style={[clipStyles.label, { color: paper.colors.onSecondaryContainer }]}>
          URL in clipboard
        </Text>
        <Text
          style={[clipStyles.url, { color: paper.colors.secondary }]}
          numberOfLines={1}
        >
          {hostname || clipUrl}
        </Text>
      </View>
      <Pressable
        onPress={onPaste}
        style={[clipStyles.useBtn, { backgroundColor: paper.colors.secondary }]}
        accessibilityRole="button"
        accessibilityLabel="Use clipboard URL"
      >
        <Text style={{ color: paper.colors.onSecondary, fontWeight: '700', fontSize: 12 }}>
          Use
        </Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss clipboard suggestion"
      >
        <Ionicons name="close" size={16} color={paper.colors.onSecondaryContainer} />
      </Pressable>
    </View>
  );
}

const clipStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    gap: 10,
    marginBottom: 6,
  },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  url: { fontSize: 13, fontWeight: '500', marginTop: 1 },
  useBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
});

// ─── URL Preview chip (shown below the URL field) ────────────────────────────

interface UrlPreviewProps {
  url: string;
  source?: UrlSource;
  mediaType?: MediaType;
  colors: ReturnType<typeof useTheme>['colors'];
  paper: AppTheme;
}

function UrlPreview({ url, source, mediaType, colors, paper }: UrlPreviewProps) {
  if (!url.trim()) return null;
  const hostname = getDisplayHostname(url);
  if (!hostname) return null;

  const sourceLabel = source ? (URL_SOURCE_LABELS[source] ?? source) : null;
  const sourceIcon = source ? (URL_SOURCE_ICONS[source] ?? 'globe-outline') : 'globe-outline';
  const mediaLabel = mediaType ? (MEDIA_TYPE_LABELS[mediaType] ?? null) : null;
  const mediaIcon = mediaType ? (MEDIA_TYPE_ICONS[mediaType] ?? null) : null;

  return (
    <View style={[previewStyles.row, { borderColor: colors.border }]}>
      <Ionicons name={sourceIcon as React.ComponentProps<typeof Ionicons>['name']} size={13} color={colors.textSecondary} />
      <Text style={[previewStyles.host, { color: colors.textSecondary }]} numberOfLines={1}>
        {sourceLabel ?? hostname}
      </Text>
      {mediaLabel && mediaIcon ? (
        <>
          <Text style={{ color: colors.border, fontSize: 12 }}>·</Text>
          <Ionicons name={mediaIcon as React.ComponentProps<typeof Ionicons>['name']} size={12} color={colors.textMuted} />
          <Text style={[previewStyles.media, { color: colors.textMuted }]}>{mediaLabel}</Text>
        </>
      ) : null}
    </View>
  );
}

const previewStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 7,
    paddingBottom: 2,
    gap: 5,
    marginTop: 2,
  },
  host: { fontSize: 12, fontWeight: '500', flex: 1 },
  media: { fontSize: 12 },
});

// ─── Type Chip ────────────────────────────────────────────────────────────────

interface TypeChipProps {
  type: ContentType;
  isActive: boolean;
  onPress: () => void;
  paper: AppTheme;
  colors: ReturnType<typeof useTheme>['colors'];
}

function TypeChip({ type, isActive, onPress, paper, colors }: TypeChipProps) {
  const config = CONTENT_TYPE_CONFIG[type];
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        chipStyles.chip,
        {
          backgroundColor: isActive ? config.color : paper.colors.surfaceContainerHigh,
          borderColor: isActive ? config.color : paper.colors.outlineVariant,
        },
      ]}
    >
      <Ionicons
        name={config.icon as React.ComponentProps<typeof Ionicons>['name']}
        size={14}
        color={isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant}
      />
      <Text style={[chipStyles.label, { color: isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant }]}>
        {config.label}
      </Text>
    </TouchableOpacity>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  label: { fontSize: 13, fontWeight: '500' },
});

// ─── Save FAB ─────────────────────────────────────────────────────────────────

interface SaveFABProps {
  onPress: () => void;
  loading: boolean;
  isExpressive: boolean;
  paper: AppTheme;
}

function SaveFABContainer({ onPress, loading, isExpressive, paper }: SaveFABProps) {
  const insets = useSafeAreaInsets();
  const bottomOffset = Math.max(insets.bottom, 16);

  if (isExpressive) {
    return (
      <View
        style={[
          fabStyles.extFabWrap,
          { bottom: bottomOffset + 16 },
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          onPress={onPress}
          disabled={loading}
          style={[fabStyles.extFab, { backgroundColor: paper.colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Save item"
        >
          {loading ? (
            <PaperActivityIndicator size={20} color={paper.colors.onPrimary} />
          ) : (
            <Ionicons name="bookmark" size={22} color={paper.colors.onPrimary} />
          )}
          <Text style={[fabStyles.extFabLabel, { color: paper.colors.onPrimary }]}>Save</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={[fabStyles.fabWrap, { bottom: bottomOffset + 16 }]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        onPress={onPress}
        disabled={loading}
        style={[fabStyles.fab, { backgroundColor: paper.colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel="Save item"
      >
        {loading ? (
          <PaperActivityIndicator size={22} color={paper.colors.onPrimary} />
        ) : (
          <Ionicons name="bookmark" size={24} color={paper.colors.onPrimary} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const fabStyles = StyleSheet.create({
  fabWrap: { position: 'absolute', right: 20, alignItems: 'flex-end' },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  extFabWrap: { position: 'absolute', right: 20, alignItems: 'flex-end' },
  extFab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 20,
    gap: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  extFabLabel: { fontSize: 16, fontWeight: '700' },
});

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ text, colors, topSpacing = 10 }: {
  text: string;
  colors: ReturnType<typeof useTheme>['colors'];
  topSpacing?: number;
}) {
  return (
    <Text style={[styles.label, { color: colors.textSecondary, marginTop: topSpacing }]}>
      {text}
    </Text>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SaveScreen() {
  const { colors, layout } = useTheme();
  const paper = useAppTheme();
  const { collections, refreshAll } = useData();
  const { enqueue } = useCaptureQueue();
  const router = useRouter();

  // ── URL state ─────────────────────────────────────────────────────────────
  const [url, setUrl] = useState('');
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [detectedSource, setDetectedSource] = useState<UrlSource | undefined>();
  const [detectedMediaType, setDetectedMediaType] = useState<MediaType | undefined>();
  // 'idle' | 'queueing' | 'queued'
  const [urlMode, setUrlMode] = useState<'idle' | 'queueing' | 'queued'>('idle');
  const urlEnqueueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEnqueuedUrl = useRef<string>('');

  // ── Manual (no-URL) form state ────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [contentType, setContentType] = useState<ContentType>('idea');
  const [collectionId, setCollectionId] = useState<string | undefined>();
  const [tags, setTags] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | undefined>();
  const [locationLoading, setLocationLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const sp = layout.isExpressive ? 24 : 16;
  const inputRadius = layout.isExpressive ? 16 : 10;
  const chipRadius = layout.isExpressive ? 24 : 20;

  // ── Clipboard check on mount ──────────────────────────────────────────────
  useEffect(() => {
    Clipboard.getStringAsync().then((text) => {
      const safeUrl = extractSafeUrl(text ?? '');
      if (safeUrl) setClipboardUrl(safeUrl);
    });
  }, []);

  // ── URL change: detect source/media, schedule auto-enqueue ───────────────
  useEffect(() => {
    if (urlEnqueueTimer.current) clearTimeout(urlEnqueueTimer.current);

    if (!url.trim()) {
      setDetectedSource(undefined);
      setDetectedMediaType(undefined);
      setUrlMode('idle');
      lastEnqueuedUrl.current = '';
      return;
    }

    // Fast sync source detection (no network)
    try {
      const source = detectUrlSource(url);
      const media = detectMediaType(source, url);
      setDetectedSource(source);
      setDetectedMediaType(media);
      const suggested = suggestContentType(source);
      if (suggested) setContentType(suggested);
    } catch {
      // not yet a valid URL — ignore
    }

    // Debounce: fire enqueue 800 ms after user stops typing
    urlEnqueueTimer.current = setTimeout(() => {
      const trimmed = url.trim();
      if (trimmed && trimmed !== lastEnqueuedUrl.current && isValidUrl(trimmed)) {
        triggerAutoEnqueue(trimmed);
      }
    }, 800);

    return () => {
      if (urlEnqueueTimer.current) clearTimeout(urlEnqueueTimer.current);
    };
  }, [url]); // eslint-disable-line -- intentional: only re-run when url changes

  const triggerAutoEnqueue = useCallback(async (validUrl: string) => {
    if (lastEnqueuedUrl.current === validUrl) return;
    lastEnqueuedUrl.current = validUrl;
    setUrlMode('queueing');
    diagLog.addEntry('SAVE_STARTED', `save screen: auto-enqueue url="${validUrl.slice(0, 120)}"`);
    try {
      await enqueue(validUrl, { titleHint: title.trim() || undefined });
      diagLog.addEntry('SAVE_COMPLETED', `save screen: enqueued url="${validUrl.slice(0, 120)}"`);
      setUrlMode('queued');
      // Brief pause so the user sees "Queued!" then navigate away
      setTimeout(() => router.back(), 600);
    } catch (err) {
      logError(err, { screen: 'save', action: 'autoEnqueue' });
      diagLog.addEntry('SAVE_FAILED', `save screen: ${err instanceof Error ? err.message : String(err)}`);
      lastEnqueuedUrl.current = '';
      setUrlMode('idle');
      Alert.alert('Could not queue URL', getUserMessage(err));
    }
  }, [enqueue, title, router]);

  const handleClipboardPaste = () => {
    if (clipboardUrl) {
      setUrl(clipboardUrl);
      lastEnqueuedUrl.current = '';
    }
    setClipboardUrl(null);
  };

  const handleClipboardDismiss = () => {
    setClipboardUrl(null);
  };

  const handleGetLocation = async () => {
    setLocationLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Location permission is required to capture GPS coordinates.');
      setLocationLoading(false);
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    if (!address.trim()) {
      const geo = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geo.length > 0) {
        const g = geo[0];
        setAddress([g.name, g.city, g.country].filter(Boolean).join(', '));
      }
    }
    setLocationLoading(false);
  };

  // ── Manual save (no-URL path only) ───────────────────────────────────────
  const handleSave = async () => {
    // If there's a URL, the auto-enqueue should have already fired.
    // But as a safety net, re-trigger it if the URL is valid.
    const cleanUrl = url.trim() ? sanitizeUrl(url) : undefined;
    if (cleanUrl) {
      await triggerAutoEnqueue(cleanUrl);
      return;
    }

    const cleanTitle = sanitizeText(title, LIMITS.TITLE);
    if (!cleanTitle) {
      Alert.alert('Title required', 'Please enter a title for this item.');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const item: SavedItem = {
        id: generateId(),
        title: cleanTitle,
        description: sanitizeText(description, LIMITS.DESCRIPTION) || undefined,
        contentType,
        collectionId,
        tags: parseTags(tags),
        notes: sanitizeText(notes, LIMITS.NOTES) || undefined,
        address: sanitizeText(address, LIMITS.ADDRESS) || undefined,
        latitude: coords?.lat,
        longitude: coords?.lng,
        isCompleted: false,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveItem(item);
      await refreshAll();
      diagLog.addEntry('SAVE_COMPLETED', `save screen: direct-save id=${item.id} title="${cleanTitle.slice(0, 80)}"`);
      router.back();
    } catch (err) {
      logError(err, { screen: 'save', action: 'saveItem' });
      diagLog.addEntry('SAVE_FAILED', `save screen: ${err instanceof Error ? err.message : String(err)}`);
      Alert.alert('Save failed', getUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // ── URL mode: queueing / queued splash ────────────────────────────────────
  if (urlMode === 'queueing' || urlMode === 'queued') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <View style={styles.container}>
          <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: sp }]}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Save Item</Text>
            <View style={{ width: 54 }} />
          </View>
          <View style={styles.queueOverlay}>
            {urlMode === 'queueing' ? (
              <PaperActivityIndicator size="large" color={paper.colors.primary} />
            ) : (
              <View style={[styles.queuedIcon, { backgroundColor: colors.success + '20' }]}>
                <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              </View>
            )}
            <Text style={[styles.queuedTitle, { color: colors.text }]}>
              {urlMode === 'queueing' ? 'Queuing…' : 'Queued!'}
            </Text>
            <Text style={[styles.queuedSub, { color: colors.textMuted }]}>
              {urlMode === 'queued'
                ? 'Saved and enriching in the background.\nWatch the status bar below.'
                : 'Saving to library…'}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Normal form ───────────────────────────────────────────────────────────
  const hasUrl = url.trim().length > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* ── Header ── */}
          <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: sp }]}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Save Item</Text>
            <View style={{ width: 54 }} />
          </View>

          <ScrollView
            contentContainerStyle={[styles.content, { paddingHorizontal: sp, paddingBottom: 120, gap: layout.isExpressive ? 4 : 2 }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── URL field — primary input ── */}
            <SectionLabel text="URL / LINK" colors={colors} topSpacing={layout.isExpressive ? 16 : 8} />

            {/* Clipboard suggestion card */}
            {clipboardUrl != null && !url.trim() && (
              <ClipboardBanner
                clipUrl={clipboardUrl}
                onPaste={handleClipboardPaste}
                onDismiss={handleClipboardDismiss}
                isExpressive={layout.isExpressive}
                paper={paper}
              />
            )}

            <TextInput
              value={url}
              onChangeText={(t) => {
                setUrl(t);
                setUrlMode('idle');
                lastEnqueuedUrl.current = '';
              }}
              placeholder="https://…"
              placeholderTextColor={colors.placeholder}
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={!clipboardUrl}
            />

            {/* Source / media type preview chip */}
            <UrlPreview url={url} source={detectedSource} mediaType={detectedMediaType} colors={colors} paper={paper} />

            {/* Auto-enqueue status */}
            {hasUrl && urlMode === 'idle' && (
              <View style={[styles.autoHint, { backgroundColor: paper.colors.primaryContainer + '55', borderRadius: inputRadius }]}>
                <Ionicons name="timer-outline" size={14} color={paper.colors.primary} />
                <Text style={[styles.autoHintText, { color: paper.colors.onPrimaryContainer }]}>
                  Will queue automatically when you stop typing
                </Text>
              </View>
            )}

            {/* ── Divider — below URL, only shown when no URL ── */}
            {!hasUrl && (
              <View style={[styles.divider, { borderColor: colors.border, marginTop: layout.isExpressive ? 24 : 16 }]}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerText, { color: colors.textMuted }]}>or save without a link</Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>
            )}

            {/* ── Manual fields — always shown, used for no-URL saves ── */}
            {!hasUrl && (
              <>
                {/* Content type */}
                <SectionLabel text="CONTENT TYPE" colors={colors} topSpacing={layout.isExpressive ? 16 : 8} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', gap: layout.isExpressive ? 10 : 8 }}>
                    {ALL_CONTENT_TYPES.map((type) => (
                      <TypeChip
                        key={type}
                        type={type}
                        isActive={contentType === type}
                        onPress={() => setContentType(type)}
                        paper={paper}
                        colors={colors}
                      />
                    ))}
                  </View>
                </ScrollView>

                {/* Title */}
                <SectionLabel text="TITLE *" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="What are you saving?"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
                />

                {/* Description */}
                <SectionLabel text="DESCRIPTION" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What is this about?"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, styles.multiline, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                {/* Notes */}
                <SectionLabel text="PERSONAL NOTES" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Why did you save this?"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, styles.multiline, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                {/* Tags */}
                <SectionLabel text="TAGS" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
                <TextInput
                  value={tags}
                  onChangeText={setTags}
                  placeholder="recipe, italian, weekend…"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
                  autoCapitalize="none"
                />
                <Text style={[styles.hint, { color: colors.textMuted }]}>Comma separated</Text>

                {/* Collection */}
                <SectionLabel text="COLLECTION" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', gap: layout.isExpressive ? 10 : 8 }}>
                    <TouchableOpacity
                      onPress={() => setCollectionId(undefined)}
                      style={[
                        chipStyles.chip,
                        { borderRadius: chipRadius,
                          backgroundColor: !collectionId ? paper.colors.primaryContainer : paper.colors.surfaceContainerHigh,
                          borderColor: !collectionId ? paper.colors.primary : paper.colors.outlineVariant },
                      ]}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: !collectionId ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant }}>
                        None
                      </Text>
                    </TouchableOpacity>
                    {collections.map((col) => (
                      <TouchableOpacity
                        key={col.id}
                        onPress={() => setCollectionId(col.id)}
                        style={[
                          chipStyles.chip,
                          { borderRadius: chipRadius,
                            backgroundColor: collectionId === col.id ? col.color : paper.colors.surfaceContainerHigh,
                            borderColor: collectionId === col.id ? col.color : paper.colors.outlineVariant },
                        ]}
                      >
                        <Ionicons name={col.icon as React.ComponentProps<typeof Ionicons>['name']} size={14} color={collectionId === col.id ? paper.colors.onPrimary : paper.colors.onSurfaceVariant} />
                        <Text style={{ fontSize: 13, fontWeight: '600', color: collectionId === col.id ? paper.colors.onPrimary : paper.colors.onSurfaceVariant }}>
                          {col.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Location */}
                <SectionLabel text="LOCATION / PLACE" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  placeholder="e.g. Eiffel Tower, Paris"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
                />
                <TouchableOpacity
                  onPress={handleGetLocation}
                  disabled={locationLoading}
                  style={[styles.gpsBtn, { backgroundColor: paper.colors.surfaceContainerHigh, borderColor: paper.colors.outlineVariant, borderRadius: inputRadius }]}
                >
                  {locationLoading ? (
                    <PaperActivityIndicator size="small" color={paper.colors.onSurfaceVariant} />
                  ) : (
                    <Ionicons name="navigate" size={15} color={coords ? paper.colors.primary : paper.colors.onSurfaceVariant} />
                  )}
                  <Text style={[styles.gpsBtnText, { color: coords ? paper.colors.primary : paper.colors.onSurfaceVariant }]}>
                    {coords ? `GPS: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Capture current GPS coordinates (optional)'}
                  </Text>
                  {coords && (
                    <TouchableOpacity onPress={() => setCoords(undefined)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                <Text style={[styles.hint, { color: colors.textMuted, marginTop: 4 }]}>
                  Type the place name or capture GPS coordinates.
                </Text>
              </>
            )}
          </ScrollView>

          {/* ── Save FAB (only relevant for no-URL saves) ── */}
          {!hasUrl && (
            <SaveFABContainer
              onPress={handleSave}
              loading={saving}
              isExpressive={layout.isExpressive}
              paper={paper}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  content: { paddingTop: 8 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  multiline: {
    minHeight: 80,
    paddingTop: 12,
  },
  autoHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginTop: 6,
  },
  autoHintText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 0,
    marginVertical: 4,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '500' },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    gap: 8,
    marginTop: 6,
  },
  gpsBtnText: { flex: 1, fontSize: 13, fontWeight: '500' },
  queueOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  queuedIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queuedTitle: { fontSize: 24, fontWeight: '800' },
  queuedSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
