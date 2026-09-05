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
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useCaptureQueue } from '../src/context/CaptureQueueContext';
import { saveItem } from '../src/database/items';
import { getAISettings } from '../src/services/settings';
import { diagLog } from '../src/services/diagnostics';
import { summarizeItem } from '../src/services/ai';
import {
  fetchPageMetadata,
  formatMetadataForAI,
  detectUrlSource,
  detectMediaType,
  getDisplayHostname,
  getExactSourceLabel,
  CATEGORY_CONFIG,
  suggestContentType,
  URL_SOURCE_LABELS,
  URL_SOURCE_ICONS,
  MEDIA_TYPE_LABELS,
  MEDIA_TYPE_ICONS,
  type PageMetadata,
} from '../src/services/metadata';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '../src/constants';
import type { ContentType, SavedItem, ContentCategory, UrlSource, MediaType } from '../src/types';

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
  category?: ContentCategory;
  url?: string;
  suggestedCollectionNames?: string[];
  paper: AppTheme;
  colors: ReturnType<typeof useTheme>['colors'];
}
function MetadataCard({ metadata, category, url, suggestedCollectionNames, paper, colors }: MetadataCardProps) {
  const exactLabel = getExactSourceLabel(metadata.source, metadata.mediaType, url);
  const pills: Array<{ icon: string; label: string }> = [];

  // Exact source label pill
  pills.push({ icon: URL_SOURCE_ICONS[metadata.source] ?? 'globe', label: exactLabel });

  if (metadata.title) pills.push({ icon: 'text', label: 'Title' });
  if (metadata.description) pills.push({ icon: 'document-text', label: 'Description' });
  if (metadata.image) pills.push({ icon: 'image', label: 'Thumbnail' });
  if (metadata.location) {
    const locLabel = [metadata.location.venue, metadata.location.city, metadata.location.country].filter(Boolean).join(', ');
    if (locLabel) pills.push({ icon: 'location', label: locLabel });
  }
  if (category) {
    const catConf = CATEGORY_CONFIG[category];
    pills.push({ icon: 'pricetag', label: `${catConf?.emoji ?? '🏷️'} ${category}` });
  }

  if (pills.length === 0) return null;
  return (
    <View style={[cardStyles.container, { backgroundColor: paper.colors.secondaryContainer, borderColor: paper.colors.secondary + '40' }]}>
      {metadata.image ? (
        <Image
          source={{ uri: metadata.image }}
          style={cardStyles.thumbnail}
          resizeMode="cover"
          accessibilityLabel="Content thumbnail"
        />
      ) : null}
      <Text style={[cardStyles.heading, { color: paper.colors.onSecondaryContainer }]}>Content Detected</Text>
      <View style={cardStyles.row}>
        {pills.map((p) => (
          <View key={p.label} style={cardStyles.pill}>
            <Ionicons name={p.icon as React.ComponentProps<typeof Ionicons>['name']} size={13} color={paper.colors.secondary} />
            <Text style={[cardStyles.pillText, { color: paper.colors.onSecondaryContainer }]}>{p.label}</Text>
          </View>
        ))}
      </View>

      {/* Confidence Indicators */}
      {(category || (suggestedCollectionNames && suggestedCollectionNames.length > 0)) && (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: paper.colors.secondary + '20', gap: 4 }}>
          {category && (
            <Text style={{ fontSize: 12, color: paper.colors.onSecondaryContainer }}>
              Category: <Text style={{ fontWeight: '700' }}>{category}</Text> (95% confidence)
            </Text>
          )}
          {suggestedCollectionNames && suggestedCollectionNames.length > 0 && (
            <Text style={{ fontSize: 12, color: paper.colors.onSecondaryContainer }}>
              Collection: <Text style={{ fontWeight: '700' }}>{suggestedCollectionNames[0]}</Text> (90% confidence)
            </Text>
          )}
        </View>
      )}
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
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: '#0002',
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
          color={isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant}
        />
        <Text style={[chipStyles.text, { color: isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant }]}>
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
  // ── Entrance animations ───────────────────────────────────────────────────
  //
  // M3 Extended FAB: scale spring + label opacity fade-in + pill width expansion
  // ("container morphs open" motion — always applied).
  const scale = useRef(new Animated.Value(0)).current;
  // Label fades in after the pill has mostly expanded
  const labelOpacity = useRef(new Animated.Value(0)).current;
  // Pill padding animates from icon-only width → full label width
  const padAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Phase 1: scale in the pill (quick pop)
    Animated.spring(scale, {
      toValue: 1,
      tension: 100,
      friction: 8,
      useNativeDriver: true,
    }).start();
    // Phase 2 (staggered): expand padding then fade label
    Animated.sequence([
      Animated.delay(80),
      Animated.parallel([
        Animated.spring(padAnim, {
          toValue: 1,
          tension: 70,
          friction: 10,
          useNativeDriver: false, // padding is not a transform — must be false
        }),
        Animated.sequence([
          Animated.delay(60),
          Animated.timing(labelOpacity, {
            toValue: 1,
            duration: 160,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Press spring: squeeze down then bounce back
  const pressScale = useRef(new Animated.Value(1)).current;
  const handlePressIn = () =>
    Animated.spring(pressScale, { toValue: 0.92, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const handlePressOut = () =>
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  // Interpolate padding: 0→1 maps to icon-only (16) → full label (32)
  const animatedPadH = padAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 32],
  });

  const fabBg = isExpressive ? paper.colors.secondary : paper.colors.primary;
  const fabFg = isExpressive ? paper.colors.onSecondary : paper.colors.onPrimary;

  return (
    <Animated.View
      style={[
        fabStyles.wrap,
        { transform: [{ scale }] },
      ]}
    >
      <Pressable
        onPress={loading ? undefined : onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel="Save item"
      >
        <Animated.View
          style={[
            fabStyles.fab,
            {
              backgroundColor: fabBg,
              shadowColor: paper.colors.shadow,
              paddingHorizontal: animatedPadH,
              transform: [{ scale: pressScale }],
            },
          ]}
        >
          {loading ? (
            <View style={[fabStyles.loadingDot, { backgroundColor: fabFg + 'B3' }]} />
          ) : (
            <Ionicons name="checkmark" size={24} color={fabFg} />
          )}
          <Animated.Text
            style={[
              fabStyles.fabLabel,
              { color: fabFg, opacity: labelOpacity },
            ]}
          >
            {loading ? 'Saving…' : 'Save Item'}
          </Animated.Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const fabStyles = StyleSheet.create({
  // ── Wrapper ───────────────────────────────────
  // Always centred — M3 extended FAB sits in the middle of the screen width.
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    alignItems: 'center',
  },

  // ── Pill ──────────────────────────────────────
  // paddingHorizontal is set inline via animation so the pill morphs open on
  // entrance. minWidth ensures the pill is never icon-only at rest.
  fab: {
    height: 56,
    borderRadius: 28,
    minWidth: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'hidden',
  },

  // ── Label ─────────────────────────────────────
  fabLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── Loading indicator ─────────────────────────
  loadingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    // backgroundColor set inline using the theme onPrimary/onSecondary token
  },
});

// ─── SaveFABContainer ────────────────────────────────────────────────────────
//
// Absolutely-positioned shell that:
//   • reads the device bottom safe-area inset (home indicator / nav bar)
//   • places itself above that inset with a 16 pt gap
//   • lets SaveFAB control horizontal alignment internally
//
// Keeping this as a separate component avoids calling useSafeAreaInsets inside
// the heavy SaveScreen render and makes the positioning logic self-contained.
function SaveFABContainer(props: SaveFABProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + 16,
        pointerEvents: 'box-none',
      }}
    >
      <SaveFAB {...props} />
    </View>
  );
}

export default function SaveScreen() {
  const { colors, layout } = useTheme();
  const paper = useAppTheme();
  const { collections, refreshAll } = useData();
  const { enqueue } = useCaptureQueue();
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
  const [aiError, setAiError] = useState<string | null>(null);
  const [lastMetadata, setLastMetadata] = useState<PageMetadata | null>(null);
  const [metadataFailed, setMetadataFailed] = useState(false);
  // clipboardUrl: URL found in clipboard, null = none or already dismissed for this session
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  // Smart-categorization state
  const [detectedSource, setDetectedSource] = useState<UrlSource | undefined>();
  const [detectedMediaType, setDetectedMediaType] = useState<MediaType | undefined>();
  const [detectedCategory, setDetectedCategory] = useState<ContentCategory | undefined>();
  const [suggestedCollectionIds, setSuggestedCollectionIds] = useState<string[]>([]);
  const [thumbnail, setThumbnail] = useState<string | undefined>();

  // Debounce timer ref for auto-enrichment
  const autoEnrichTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track URL that was last enriched to avoid duplicate calls on re-render
  const lastEnrichedUrl = useRef<string>('');

  // Suggest content type + detect source/media when URL changes, then
  // schedule auto-enrichment after a short debounce.
  useEffect(() => {
    if (!url.trim()) {
      setLastMetadata(null);
      setMetadataFailed(false);
      setDetectedSource(undefined);
      setDetectedMediaType(undefined);
      lastEnrichedUrl.current = '';
      if (autoEnrichTimer.current) clearTimeout(autoEnrichTimer.current);
      return;
    }
    try {
      const source = detectUrlSource(url);
      const media = detectMediaType(source, url);
      setDetectedSource(source);
      setDetectedMediaType(media);
      const suggested = suggestContentType(source);
      if (suggested) setContentType(suggested);
    } catch {
      // invalid URL yet — no-op
    }

    // Schedule auto-enrichment 800 ms after the user stops typing
    if (autoEnrichTimer.current) clearTimeout(autoEnrichTimer.current);
    autoEnrichTimer.current = setTimeout(() => {
      const trimmed = url.trim();
      if (trimmed && trimmed !== lastEnrichedUrl.current && !aiLoading) {
        lastEnrichedUrl.current = trimmed;
        handleAISummarize();
      }
    }, 800);

    return () => {
      if (autoEnrichTimer.current) clearTimeout(autoEnrichTimer.current);
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Silently read clipboard and surface banner if a URL is found.
  // No blocking dialog — user stays in control via the inline card.
  useEffect(() => {
    Clipboard.getStringAsync().then((text) => {
      const safeUrl = extractSafeUrl(text ?? '');
      if (safeUrl) setClipboardUrl(safeUrl);
    });
  }, []);

  const handleClipboardPaste = () => {
    if (clipboardUrl) {
      setUrl(clipboardUrl);
      // The URL change will trigger the auto-enrich debounce; clear the
      // lastEnrichedUrl guard so the new URL is always picked up.
      lastEnrichedUrl.current = '';
    }
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
    setAiError(null);
    if (!title.trim() && !url.trim()) {
      setAiError('Enter a title or URL before analyzing.');
      return;
    }

    diagLog.addEntry('AI_REQUEST_STARTED', 'checking AI settings');
    const aiSettings = await getAISettings();
    if (!aiSettings) {
      diagLog.addEntry('AI_REQUEST_STARTED', 'no AI provider configured');
      setAiError('No AI provider configured. Go to Settings → AI to add one.');
      return;
    }
    diagLog.addEntry('AI_REQUEST_STARTED', `provider=${aiSettings.provider} model=${aiSettings.model ?? '(default)'}`);

    setAiLoading(true);
    setLastMetadata(null);
    setMetadataFailed(false);
    setDetectedCategory(undefined);
    setSuggestedCollectionIds([]);

    try {
      // ── Step 1: Source & media recognition (fast — no network) ───────────
      if (url.trim()) {
        try {
          const src = detectUrlSource(url);
          const media = detectMediaType(src, url);
          setDetectedSource(src);
          setDetectedMediaType(media);
          diagLog.addEntry('METADATA_FOUND', `source=${src} mediaType=${media}`);
        } catch {
          // invalid URL at this point — safe to continue
        }
      }

      // ── Step 2: Metadata + thumbnail extraction ───────────────────────────
      diagLog.addEntry('METADATA_FOUND', `fetching page metadata for: ${url.trim() || '(no url)'}`);
      const metadata = url.trim() ? await fetchPageMetadata(url) : null;
      if (url.trim() && !metadata) {
        setMetadataFailed(true);
        diagLog.addEntry('METADATA_FOUND', 'extraction failed or returned null');
      } else if (metadata) {
        setLastMetadata(metadata);
        if (metadata.image) setThumbnail(metadata.image);
        diagLog.addEntry('METADATA_FOUND', `source=${metadata.source} mediaType=${metadata.mediaType} title=${(metadata.title ?? '').slice(0, 80)} hasImage=${!!metadata.image} hasLocation=${!!metadata.location}`);
      }

      const metadataText = [metadata ? formatMetadataForAI(metadata) : '', description.trim()]
        .filter(Boolean)
        .join('\n');

      // ── Step 3: AI request ────────────────────────────────────────────────
      const aiInputTitle = metadata?.title || title.trim() || url;
      const collectionNames = collections.map((c) => c.name);
      diagLog.addEntry('AI_REQUEST_STARTED', `calling summarizeItem title="${aiInputTitle.slice(0, 80)}" metadataLen=${metadataText.length} collections=${collectionNames.length}`);

      const result = await summarizeItem(
        aiSettings,
        aiInputTitle,
        undefined,
        metadataText || undefined,
        contentType,
        collectionNames
      );

      diagLog.addEntry('AI_RESPONSE_RECEIVED', `summary="${result.summary.slice(0, 80)}" tags=${result.suggestedTags.length} category="${result.category ?? ''}" collections=${result.suggestedCollectionNames?.length ?? 0} error=${result.error ?? 'none'}`);

      // ── Step 4: Handle AI failure ─────────────────────────────────────────
      if (result.error) {
        applyMetadataFallback(metadata);
        diagLog.addEntry('FORM_UPDATE_COMPLETED', 'AI failed — metadata fallback applied');
        setAiError(result.error);
        return;
      }

      // ── Step 5: Form update ───────────────────────────────────────────────
      diagLog.addEntry('FORM_UPDATE_STARTED', `suggestedTitle="${(result.suggestedTitle ?? '').slice(0, 80)}" tags=${result.suggestedTags.length} summaryLen=${result.summary.length}`);

      let updated = false;
      if (result.suggestedTitle && !title.trim()) { setTitle(result.suggestedTitle); updated = true; }
      if (result.suggestedTags.length > 0 && !tags.trim()) { setTags(result.suggestedTags.join(', ')); updated = true; }
      if (result.summary && !description.trim()) { setDescription(result.summary); updated = true; }

      // ── Step 6: Category, collections, location ────────────────────────────
      if (result.category) {
        setDetectedCategory(result.category);
        updated = true;
      }

      if (result.suggestedCollectionNames && result.suggestedCollectionNames.length > 0) {
        // Map collection names back to IDs
        const matchedIds = result.suggestedCollectionNames
          .map((name) => collections.find((c) => c.name.toLowerCase() === name.toLowerCase()))
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
          .map((c) => c.id)
          .slice(0, 3);
        if (matchedIds.length > 0) {
          setSuggestedCollectionIds(matchedIds);
          updated = true;
        }
      }

      // Location from AI — prefill address if empty
      if (result.location && !address.trim()) {
        const parts = [result.location.venue, result.location.city, result.location.country].filter(Boolean);
        if (parts.length > 0) { setAddress(parts.join(', ')); updated = true; }
        if (result.location.coordinates && !coords) {
          setCoords({ lat: result.location.coordinates.lat, lng: result.location.coordinates.lng });
        }
      }

      diagLog.addEntry('FORM_UPDATE_COMPLETED', `fieldsUpdated=${updated} title=${Boolean(result.suggestedTitle)} tags=${result.suggestedTags.length} desc=${Boolean(result.summary)} category=${result.category ?? ''}`);

      if (!updated) {
        diagLog.addEntry('FORM_UPDATE_COMPLETED', 'AI result was empty — metadata fallback applied');
        applyMetadataFallback(metadata);
      }

    } catch (err) {
      logError(err, { screen: 'save', action: 'aiSummarize' });
      applyMetadataFallback(null);
      setAiError('An unexpected error occurred. Check your API key in Settings.');
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
    const cleanUrl = url.trim() ? sanitizeUrl(url) : undefined;
    if (url.trim() && !cleanUrl) {
      Alert.alert('Invalid URL', 'Please enter a valid http(s) URL or leave the field empty.');
      return;
    }

    setSaving(true);
    try {
      if (cleanUrl) {
        // ── URL path: enqueue for instant save + background enrichment ───
        // The capture queue persists the item immediately and runs the full
        // enrichment pipeline (metadata, AI summary, tags, category,
        // collections, location) in the background.
        diagLog.addEntry('SAVE_STARTED', `save screen: enqueueing url="${cleanUrl.slice(0, 120)}"`);
        await enqueue(cleanUrl, { titleHint: cleanTitle ?? '' });
        diagLog.addEntry('SAVE_COMPLETED', `save screen: enqueued url="${cleanUrl.slice(0, 120)}"`);
        router.back();
      } else {
        // ── No-URL path: direct save (idea/note without a link) ──────────
        const effectiveTitle = cleanTitle;
        if (!effectiveTitle) {
          Alert.alert('Title required', 'Please enter a title for this item.');
          setSaving(false);
          return;
        }
        const now = new Date().toISOString();
        const item: SavedItem = {
          id: generateId(),
          title: effectiveTitle,
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
        diagLog.addEntry('SAVE_COMPLETED', `save screen: direct-save id=${item.id} title="${effectiveTitle.slice(0, 80)}"`);
        router.back();
      }
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
            contentContainerStyle={[styles.content, { paddingHorizontal: sp, paddingBottom: 120, gap: layout.isExpressive ? 4 : 2 }]}
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
              onChangeText={(t) => { setTitle(t); if (aiError) setAiError(null); }}
              placeholder="What are you saving?"
              placeholderTextColor={colors.placeholder}
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
            />

            {/* ── URL / Link ── */}
            <SectionLabel text="URL / LINK" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
            {/* ── Clipboard suggestion card — shown ABOVE the URL field when clipboard
                has a URL and the field is empty. Non-blocking, session-scoped dismiss. ── */}
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
              onChangeText={(t) => { setUrl(t); if (aiError) setAiError(null); }}
              placeholder="https://..."
              placeholderTextColor={colors.placeholder}
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border, borderRadius: inputRadius }]}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {/* URL platform preview */}
            <UrlPreview url={url} colors={colors} paper={paper} />

            {/* ── Auto-enrichment status indicator ── */}
            {aiLoading && (
              <View
                style={[
                  styles.aiBtn,
                  {
                    borderColor: paper.colors.tertiary,
                    backgroundColor: paper.colors.tertiaryContainer + '33',
                    borderRadius: inputRadius,
                    marginTop: layout.isExpressive ? 16 : 10,
                  },
                ]}
                pointerEvents="none"
              >
                <PaperActivityIndicator size="small" color={paper.colors.tertiary} />
                <Text style={{ color: paper.colors.onTertiaryContainer, fontWeight: '600', fontSize: 14 }}>
                  Analyzing…
                </Text>
              </View>
            )}

            {/* ── Inline AI error — replaces modal Alert ── */}
            {aiError != null && (
              <View style={[styles.aiErrorBanner, { backgroundColor: paper.colors.errorContainer, borderColor: paper.colors.error + '55', borderRadius: inputRadius }]}>
                <Ionicons name="alert-circle-outline" size={15} color={paper.colors.onErrorContainer} />
                <Text style={[styles.aiErrorText, { color: paper.colors.onErrorContainer }]}>{aiError}</Text>
                <Pressable
                  onPress={() => setAiError(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss error"
                >
                  <Ionicons name="close" size={15} color={paper.colors.onErrorContainer} />
                </Pressable>
              </View>
            )}

            {/* Metadata + intelligence status card */}
            {lastMetadata && (
              <MetadataCard
                metadata={lastMetadata}
                category={detectedCategory}
                url={url}
                suggestedCollectionNames={collections.filter(c => suggestedCollectionIds.includes(c.id)).map(c => c.name)}
                paper={paper}
                colors={colors}
              />
            )}
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
                    <Ionicons name={col.icon as React.ComponentProps<typeof Ionicons>['name']} size={14} color={collectionId === col.id ? paper.colors.onPrimary : paper.colors.onSurfaceVariant} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: collectionId === col.id ? paper.colors.onPrimary : paper.colors.onSurfaceVariant }}>
                      {col.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* ── AI-Suggested Collections ── */}
            {suggestedCollectionIds.length > 0 && (
              <>
                <SectionLabel text="SUGGESTED COLLECTIONS" colors={colors} topSpacing={layout.isExpressive ? 20 : 10} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', gap: layout.isExpressive ? 10 : 8 }}>
                    {suggestedCollectionIds.map((cid) => {
                      const col = collections.find((c) => c.id === cid);
                      if (!col) return null;
                      const isActive = collectionId === cid;
                      return (
                        <TouchableOpacity
                          key={cid}
                          onPress={() => setCollectionId(isActive ? undefined : cid)}
                          style={[
                            chipStyles.chip,
                            { borderRadius: chipRadius,
                              backgroundColor: isActive ? col.color : paper.colors.surfaceContainerHigh,
                              borderColor: isActive ? col.color : paper.colors.secondary + '66',
                              borderStyle: 'dashed' as const },
                          ]}
                        >
                          <Ionicons name="sparkles" size={12} color={isActive ? paper.colors.onPrimary : paper.colors.secondary} />
                          <Ionicons name={col.icon as React.ComponentProps<typeof Ionicons>['name']} size={14} color={isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant} />
                          <Text style={{ fontSize: 13, fontWeight: '600', color: isActive ? paper.colors.onPrimary : paper.colors.onSurfaceVariant }}>
                            {col.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
                <Text style={[styles.hint, { color: colors.textMuted }]}>AI suggestions — tap to assign</Text>
              </>
            )}

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
          {/* Positioned absolutely above the bottom safe-area inset so it sits
              flush above the home indicator / navigation bar without overlapping it.
              A 16 pt gap is added between the inset edge and the FAB bottom.     */}
          <SaveFABContainer
            onPress={handleSave}
            loading={saving}
            isExpressive={layout.isExpressive}
            paper={paper}
          />
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
  aiErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginTop: 6,
  },
  aiErrorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
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
