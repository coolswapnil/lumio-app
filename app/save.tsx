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
  Animated,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import { generateId } from '../src/utils/uuid';
import { sanitizeText, parseTags, sanitizeUrl, extractSafeUrl, LIMITS } from '../src/utils/validation';
import { logError, getUserMessage } from '../src/utils/errors';
import { useTheme } from '../src/context/ThemeContext';
import { useAppTheme, type AppTheme } from '../src/constants/colors';
import { useData } from '../src/context/DataContext';
import { saveItem } from '../src/database/items';
import { getAISettings } from '../src/services/settings';
import { diagLog } from '../src/services/diagnostics';
import { summarizeItem } from '../src/services/ai';
import {
  fetchPageMetadata,
  formatMetadataForAI,
  detectUrlSource,
  getDisplayHostname,
  suggestContentType,
  URL_SOURCE_LABELS,
  URL_SOURCE_ICONS,
  type PageMetadata,
} from '../src/services/metadata';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../src/constants';
import type { ContentType, SavedItem } from '../src/types';

// ─── Clipboard Banner ────────────────────────────────────────────────────────

interface ClipboardBannerProps {
  clipUrl: string;
  onPaste: () => void;
  onDismiss: () => void;
  isExpressive: boolean;
  paper: AppTheme;
}

function ClipboardBanner({ clipUrl, onPaste, onDismiss, isExpressive, paper }: ClipboardBannerProps) {
  const translateY = useRef(new Animated.Value(-12)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, tension: 90, friction: 10, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  let hostname = clipUrl;
  try { hostname = new URL(clipUrl).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }

  const cardRadius = isExpressive ? 20 : 12;

  return (
    <Animated.View
      style={[
        clipStyles.card,
        {
          backgroundColor: paper.colors.secondaryContainer,
          borderColor: paper.colors.secondary + '55',
          borderRadius: cardRadius,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={`Link detected in clipboard: ${hostname}`}
    >
      {/* Left: icon + text */}
      <View style={clipStyles.body}>
        <View style={[clipStyles.iconWrap, { backgroundColor: paper.colors.secondary + '22', borderRadius: isExpressive ? 12 : 8 }]}>
          <Text style={clipStyles.iconEmoji}>📋</Text>
        </View>
        <View style={clipStyles.textBlock}>
          <Text style={[clipStyles.heading, { color: paper.colors.onSecondaryContainer }]}>
            Link detected in clipboard
          </Text>
          <Text style={[clipStyles.hostname, { color: paper.colors.onSecondaryContainer + 'CC' }]} numberOfLines={1}>
            {hostname}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={clipStyles.actions}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss clipboard suggestion"
          style={({ pressed }) => [
            clipStyles.actionBtn,
            clipStyles.dismissBtn,
            {
              borderColor: paper.colors.outline + '66',
              borderRadius: isExpressive ? 20 : 8,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[clipStyles.actionText, { color: paper.colors.onSecondaryContainer }]}>Dismiss</Text>
        </Pressable>
        <Pressable
          onPress={onPaste}
          accessibilityRole="button"
          accessibilityLabel="Paste clipboard URL"
          style={({ pressed }) => [
            clipStyles.actionBtn,
            clipStyles.pasteBtn,
            {
              backgroundColor: paper.colors.secondary,
              borderRadius: isExpressive ? 20 : 8,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="clipboard-outline" size={13} color={paper.colors.onSecondary} />
          <Text style={[clipStyles.actionText, { color: paper.colors.onSecondary, fontWeight: '700' }]}>Paste</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const clipStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconEmoji: { fontSize: 18 },
  textBlock: { flex: 1 },
  heading: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  hostname: {
    fontSize: 12,
    marginTop: 1,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  dismissBtn: {
    borderWidth: 1,
  },
  pasteBtn: {},
  actionText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

// ─── URL Preview ─────────────────────────────────────────────────────────────

interface UrlPreviewProps {
  url: string;
  colors: ReturnType<typeof useTheme>['colors'];
  paper: AppTheme;
}
function UrlPreview({ url, colors, paper }: UrlPreviewProps) {
  if (!url.trim()) return null;
  let source, hostname;
  try {
    source = detectUrlSource(url);
    hostname = getDisplayHostname(url);
  } catch {
    return null;
  }
  const label = URL_SOURCE_LABELS[source];
  const iconName = URL_SOURCE_ICONS[source] as React.ComponentProps<typeof Ionicons>['name'];
  return (
    <View style={[previewStyles.row, { backgroundColor: paper.colors.surfaceContainerHigh, borderColor: paper.colors.outlineVariant }]}>
      <View style={[previewStyles.iconWrap, { backgroundColor: paper.colors.secondaryContainer }]}>
        <Ionicons name={iconName} size={18} color={paper.colors.onSecondaryContainer} />
      </View>
      <View style={previewStyles.textWrap}>
        <Text style={[previewStyles.label, { color: colors.text }]}>{label}</Text>
        <Text style={[previewStyles.hostname, { color: colors.textSecondary }]} numberOfLines={1}>{hostname}</Text>
      </View>
      <Ionicons name="open-outline" size={14} color={colors.textMuted} />
    </View>
  );
}

const previewStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
    marginTop: 6,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  hostname: { fontSize: 12, marginTop: 1 },
});

// ─── Metadata Status Card ────────────────────────────────────────────────────

interface MetadataCardProps {
  metadata: PageMetadata;
  paper: AppTheme;
  colors: ReturnType<typeof useTheme>['colors'];
}
function MetadataCard({ metadata, paper, colors }: MetadataCardProps) {
  const fields: Array<{ key: string; value: boolean }> = [
    { key: 'Title', value: !!metadata.title },
    { key: 'Description', value: !!metadata.description },
    { key: 'Image', value: !!metadata.image },
  ];
  const found = fields.filter((f) => f.value);
  if (found.length === 0) return null;
  return (
    <View style={[cardStyles.container, { backgroundColor: paper.colors.secondaryContainer, borderColor: paper.colors.secondary + '40' }]}>
      <Text style={[cardStyles.heading, { color: paper.colors.onSecondaryContainer }]}>Source Metadata Found</Text>
      <View style={cardStyles.row}>
        {found.map((f) => (
          <View key={f.key} style={cardStyles.pill}>
            <Ionicons name="checkmark-circle" size={13} color={paper.colors.secondary} />
            <Text style={[cardStyles.pillText, { color: paper.colors.onSecondaryContainer }]}>{f.key}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
  },
  heading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pillText: { fontSize: 12, fontWeight: '500' },
});

// ─── Animated Content Type Chip ──────────────────────────────────────────────

interface TypeChipProps {
  type: ContentType;
  isActive: boolean;
  onPress: () => void;
  paper: AppTheme;
  colors: ReturnType<typeof useTheme>['colors'];
}
function TypeChip({ type, isActive, onPress, paper, colors }: TypeChipProps) {
  const config = CONTENT_TYPE_CONFIG[type];
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.8}
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
          size={15}
          color={isActive ? '#fff' : paper.colors.onSurfaceVariant}
        />
        <Text style={[chipStyles.text, { color: isActive ? '#fff' : paper.colors.onSurfaceVariant }]}>
          {config.label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 24,
    borderWidth: 1,
    gap: 6,
    minHeight: 40,
  },
  text: { fontSize: 13, fontWeight: '600' },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

// ─── Save FAB ────────────────────────────────────────────────────────────────

interface SaveFABProps {
  onPress: () => void;
  loading: boolean;
  isExpressive: boolean;
  paper: AppTheme;
}

function SaveFAB({ onPress, loading, isExpressive, paper }: SaveFABProps) {
  // Spring-in entrance animation
  const scale = useRef(new Animated.Value(0)).current;
  // Callout visibility (expressive only, fades after 2.5 s)
  const calloutOpacity = useRef(new Animated.Value(isExpressive ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      tension: 80,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (isExpressive) {
      const timer = setTimeout(() => {
        Animated.timing(calloutOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Press spring: squeeze down then bounce back
  const pressScale = useRef(new Animated.Value(1)).current;
  const handlePressIn = () =>
    Animated.spring(pressScale, { toValue: 0.92, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const handlePressOut = () =>
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  if (isExpressive) {
    // ── Expressive: squircle FAB (bottom-right) with gradient simulation + callout ──
    return (
      <Animated.View style={[fabStyles.expressiveWrap, { transform: [{ scale }] }]}>
        <Animated.View
          style={[
            fabStyles.callout,
            {
              backgroundColor: paper.colors.inverseSurface,
              opacity: calloutOpacity,
            },
          ]}
        >
          <Text style={[fabStyles.calloutText, { color: paper.colors.inverseOnSurface }]}>Save Item</Text>
          <View style={[fabStyles.calloutArrow, { borderLeftColor: paper.colors.inverseSurface }]} />
        </Animated.View>
        <Pressable
          onPress={loading ? undefined : onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          accessibilityRole="button"
          accessibilityLabel="Save item"
        >
          <Animated.View
            style={[
              fabStyles.expressiveFab,
              {
                backgroundColor: paper.colors.secondary,
                transform: [{ scale: pressScale }],
              },
            ]}
          >
            {/* Gradient simulation: a semi-transparent primary overlay */}
            <View
              style={[
                fabStyles.expressiveFabOverlay,
                { backgroundColor: paper.colors.primary },
              ]}
            />
            {loading ? (
              <Animated.View style={fabStyles.expressiveIcon}>
                <View style={fabStyles.loadingDot} />
              </Animated.View>
            ) : (
              <Ionicons name="checkmark" size={26} color={paper.colors.onSecondary} style={fabStyles.expressiveIcon} />
            )}
          </Animated.View>
        </Pressable>
      </Animated.View>
    );
  }

  // ── Standard: full-width extended FAB ──
  return (
    <Animated.View style={[fabStyles.extWrap, { transform: [{ scale }] }]}>
      <Pressable
        onPress={loading ? undefined : onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel="Save item"
        style={({ pressed }) => [
          fabStyles.extFab,
          { backgroundColor: paper.colors.primary, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <Animated.View
          style={[fabStyles.extFabInner, { transform: [{ scale: pressScale }] }]}
        >
          {loading ? (
            <View style={fabStyles.loadingDot} />
          ) : (
            <Ionicons name="checkmark" size={22} color={paper.colors.onPrimary} />
          )}
          <Text style={[fabStyles.extFabLabel, { color: paper.colors.onPrimary }]}>
            {loading ? 'Saving…' : 'Save Item'}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const fabStyles = StyleSheet.create({
  // ── Extended FAB ──────────────────────────────
  extWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  extFab: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  extFabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  extFabLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── Expressive FAB ────────────────────────────
  expressiveWrap: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    alignItems: 'flex-end',
  },
  callout: {
    position: 'absolute',
    right: 66,
    bottom: 12,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  calloutText: {
    fontSize: 12,
    fontWeight: '600',
  },
  calloutArrow: {
    position: 'absolute',
    right: -6,
    top: '50%',
    marginTop: -5,
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  expressiveFab: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  expressiveFabOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.45,
  },
  expressiveIcon: {
    zIndex: 1,
  },

  // ── Shared ────────────────────────────────────
  loadingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
});

export default function SaveScreen() {
  const { colors, layout } = useTheme();
  const paper = useAppTheme();
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
  const [coords, setCoords] = useState<{ lat: number; lng: number } | undefined>();
  const [locationLoading, setLocationLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [lastMetadata, setLastMetadata] = useState<PageMetadata | null>(null);
  const [metadataFailed, setMetadataFailed] = useState(false);
  // clipboardUrl: URL found in clipboard, null = none or already dismissed for this session
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);

  // Suggest content type when URL changes
  useEffect(() => {
    if (!url.trim()) {
      setLastMetadata(null);
      setMetadataFailed(false);
      return;
    }
    try {
      const source = detectUrlSource(url);
      const suggested = suggestContentType(source);
      if (suggested) setContentType(suggested);
    } catch {
      // invalid URL yet — no-op
    }
  }, [url]);

  // Silently read clipboard and surface banner if a URL is found.
  // No blocking dialog — user stays in control via the inline card.
  useEffect(() => {
    Clipboard.getStringAsync().then((text) => {
      const safeUrl = extractSafeUrl(text ?? '');
      if (safeUrl) setClipboardUrl(safeUrl);
    });
  }, []);

  const handleClipboardPaste = () => {
    if (clipboardUrl) setUrl(clipboardUrl);
    setClipboardUrl(null);
  };

  const handleClipboardDismiss = () => {
    // Remember dismissal for this session — clear state so banner never reappears
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

  const handleAISummarize = async () => {
    if (!title.trim() && !url.trim()) {
      Alert.alert('Add content first', 'Enter a title or URL before analyzing.');
      return;
    }

    diagLog.addEntry('AI_REQUEST_STARTED', 'checking AI settings');
    const aiSettings = await getAISettings();
    if (!aiSettings) {
      diagLog.addEntry('AI_REQUEST_STARTED', 'no AI provider configured');
      Alert.alert('No AI provider available', 'Go to Settings to configure your AI provider and API key.');
      return;
    }
    diagLog.addEntry('AI_REQUEST_STARTED', `provider=${aiSettings.provider} model=${aiSettings.model ?? '(default)'}`);

    setAiLoading(true);
    setLastMetadata(null);
    setMetadataFailed(false);

    try {
      // ── Step 1: Metadata extraction ──────────────────────────────────────
      diagLog.addEntry('METADATA_FOUND', `fetching page metadata for: ${url.trim() || '(no url)'}`);
      const metadata = url.trim() ? await fetchPageMetadata(url) : null;
      if (url.trim() && !metadata) {
        setMetadataFailed(true);
        diagLog.addEntry('METADATA_FOUND', 'extraction failed or returned null');
      } else if (metadata) {
        setLastMetadata(metadata);
        diagLog.addEntry('METADATA_FOUND', `source=${metadata.source} title=${(metadata.title ?? '').slice(0, 80)}`);
      }

      const metadataText = [metadata ? formatMetadataForAI(metadata) : '', description.trim()]
        .filter(Boolean)
        .join('\n');

      // ── Step 2: AI request ────────────────────────────────────────────────
      const aiInputTitle = metadata?.title || title.trim() || url;
      diagLog.addEntry('AI_REQUEST_STARTED', `calling summarizeItem title="${aiInputTitle.slice(0, 80)}" metadataLen=${metadataText.length}`);

      const result = await summarizeItem(
        aiSettings,
        aiInputTitle,
        undefined,
        metadataText || undefined,
        contentType
      );

      diagLog.addEntry('AI_RESPONSE_RECEIVED', `summary="${result.summary.slice(0, 80)}" tags=${result.suggestedTags.length} error=${result.error ?? 'none'}`);

      // ── Step 3: Handle AI failure ─────────────────────────────────────────
      if (result.error) {
        // AI call failed — apply whatever we can from raw metadata so the
        // user still gets value from the metadata extraction that succeeded.
        applyMetadataFallback(metadata);
        diagLog.addEntry('FORM_UPDATE_COMPLETED', 'AI failed — metadata fallback applied');
        Alert.alert('AI analysis failed', result.error);
        return;
      }

      // ── Step 4: Form update ───────────────────────────────────────────────

      let updated = false;
      if (result.suggestedTitle && !title.trim()) { setTitle(result.suggestedTitle); updated = true; }
      if (result.suggestedTags.length > 0 && !tags.trim()) { setTags(result.suggestedTags.join(', ')); updated = true; }
      if (result.summary && !description.trim()) { setDescription(result.summary); updated = true; }

      diagLog.addEntry('FORM_UPDATE_COMPLETED', `fieldsUpdated=${updated} title=${Boolean(result.suggestedTitle)} tags=${result.suggestedTags.length} desc=${Boolean(result.summary)}`);

      // If AI returned a completely empty result (no error, but nothing useful),
      // fall back to filling from metadata so the user isn't left empty-handed.
      if (!updated) {
        diagLog.addEntry('FORM_UPDATE_COMPLETED', 'AI result was empty — metadata fallback applied');
        applyMetadataFallback(metadata);
      }

    } catch (err) {
      logError(err, { screen: 'save', action: 'aiSummarize' });
      applyMetadataFallback(null);
      Alert.alert('AI analysis failed', 'An unexpected error occurred. Check your API key in Settings.');
    } finally {
      setAiLoading(false);
    }
  };

  /**
   * Best-effort form fill from raw page metadata, used when AI is unavailable or returns nothing.
   * Only populates fields that are currently empty — never overwrites user input.
   */
  const applyMetadataFallback = (metadata: import('../src/services/metadata').PageMetadata | null) => {
    if (!metadata) return;
    if (metadata.title && !title.trim()) setTitle(metadata.title);
    if (metadata.description && !description.trim()) setDescription(metadata.description);
    // Derive a tag from the source platform (e.g. "youtube", "instagram")
    if (!tags.trim() && metadata.source && metadata.source !== 'website') {
      setTags(metadata.source);
    }
  };

  const handleSave = async () => {
    const cleanTitle = sanitizeText(title, LIMITS.TITLE);
    if (!cleanTitle) {
      Alert.alert('Title required', 'Please enter a title for this item.');
      return;
    }
    const cleanUrl = url.trim() ? sanitizeUrl(url) : undefined;
    if (url.trim() && !cleanUrl) {
      Alert.alert('Invalid URL', 'Please enter a valid http(s) URL or leave the field empty.');
      return;
    }
    diagLog.addEntry('SAVE_STARTED', `save screen: title="${cleanTitle.slice(0, 80)}" url="${(cleanUrl ?? '').slice(0, 120)}" type=${contentType}`);
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
      diagLog.addEntry('SAVE_COMPLETED', `save screen: id=${item.id} title="${cleanTitle.slice(0, 80)}"`);
      router.back();
    } catch (err) {
      logError(err, { screen: 'save', action: 'saveItem' });
      diagLog.addEntry('SAVE_FAILED', `save screen: ${err instanceof Error ? err.message : String(err)}`);
      Alert.alert('Save failed', getUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const sp = layout.isExpressive ? 24 : 16;  // section padding
  const inputRadius = layout.isExpressive ? 16 : 10;
  const chipRadius = layout.isExpressive ? 24 : 20;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* ── Header ── */}
          <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: sp }]}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Save Item</Text>
            {/* Spacer to keep title centred — Save action moved to FAB */}
            <View style={{ width: 54 }} />
          </View>

          <ScrollView
            contentContainerStyle={[styles.content, { paddingHorizontal: sp, paddingBottom: layout.isExpressive ? 96 : 88, gap: layout.isExpressive ? 4 : 2 }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Content Type ── */}
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

            {/* ── Title ── */}
            <SectionLabel text="TITLE *" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="What are you saving?"
              placeholderTextColor={colors.placeholder}
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
            />

            {/* ── URL / Link ── */}
            <SectionLabel text="URL / LINK" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://..."
              placeholderTextColor={colors.placeholder}
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {/* ── Clipboard banner (shown only when URL field is empty and clipboard has a URL) ── */}
            {clipboardUrl != null && !url.trim() && (
              <ClipboardBanner
                clipUrl={clipboardUrl}
                onPaste={handleClipboardPaste}
                onDismiss={handleClipboardDismiss}
                isExpressive={layout.isExpressive}
                paper={paper}
              />
            )}
            {/* URL platform preview */}
            <UrlPreview url={url} colors={colors} paper={paper} />

            {/* ── Analyze Content button ── */}
            <TouchableOpacity
              onPress={handleAISummarize}
              disabled={aiLoading}
              activeOpacity={0.8}
              style={[
                styles.aiBtn,
                {
                  borderColor: paper.colors.tertiary,
                  backgroundColor: paper.colors.tertiaryContainer + '33',
                  borderRadius: inputRadius,
                  marginTop: layout.isExpressive ? 16 : 10,
                },
              ]}
            >
              {aiLoading ? (
                <PaperActivityIndicator size="small" color={paper.colors.tertiary} />
              ) : (
                <Text style={{ fontSize: 16 }}>✨</Text>
              )}
              <Text style={{ color: paper.colors.onTertiaryContainer, fontWeight: '600', fontSize: 14 }}>
                {aiLoading ? 'Analyzing…' : 'Analyze Content'}
              </Text>
            </TouchableOpacity>

            {/* Metadata status card */}
            {lastMetadata && <MetadataCard metadata={lastMetadata} paper={paper} colors={colors} />}
            {metadataFailed && (
              <View style={[styles.metaFailBanner, { backgroundColor: paper.colors.surfaceContainerHigh, borderColor: paper.colors.outlineVariant, borderRadius: inputRadius }]}>
                <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} />
                <Text style={[styles.metaFailText, { color: colors.textSecondary }]}>
                  Could not extract metadata. You can still save manually.
                </Text>
              </View>
            )}

            {/* ── Description ── */}
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

            {/* ── Notes ── */}
            <SectionLabel text="PERSONAL NOTES" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Why did you save this? What will you do with it?"
              placeholderTextColor={colors.placeholder}
              style={[styles.input, styles.multiline, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* ── Tags ── */}
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

            {/* ── Collection ── */}
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
                    <Ionicons name={col.icon as React.ComponentProps<typeof Ionicons>['name']} size={14} color={collectionId === col.id ? '#fff' : paper.colors.onSurfaceVariant} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: collectionId === col.id ? '#fff' : paper.colors.onSurfaceVariant }}>
                      {col.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* ── Location ── */}
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
                <TouchableOpacity
                  onPress={() => setCoords(undefined)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <Text style={[styles.hint, { color: colors.textMuted, marginTop: 4 }]}>
              Type/paste the place name from the content. GPS coordinates are stored as extra metadata.
            </Text>
          </ScrollView>

          {/* ── Save FAB ── */}
          <SafeAreaView edges={['bottom']} style={layout.isExpressive ? { position: 'absolute', bottom: 0, right: 0 } : undefined}>
            <SaveFAB
              onPress={handleSave}
              loading={saving}
              isExpressive={layout.isExpressive}
              paper={paper}
            />
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Section label helper component ─────────────────────────────────────────

function SectionLabel({ text, colors, topSpacing = 10 }: { text: string; colors: ReturnType<typeof useTheme>['colors']; topSpacing?: number }) {
  return (
    <Text style={[styles.label, { color: colors.textSecondary, marginTop: topSpacing }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
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
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderWidth: 1.5,
    gap: 8,
  },
  metaFailBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginTop: 6,
  },
  metaFailText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
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
  gpsBtnText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
});
