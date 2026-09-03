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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { ActivityIndicator as PaperActivityIndicator, useTheme as usePaperTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { generateId } from '../src/utils/uuid';
import { sanitizeText, parseTags, sanitizeUrl, extractSafeUrl, LIMITS } from '../src/utils/validation';
import { logError, getUserMessage } from '../src/utils/errors';
import { useTheme } from '../src/context/ThemeContext';
import { useData } from '../src/context/DataContext';
import { saveItem } from '../src/database/items';
import { getAISettings } from '../src/services/settings';
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
import { Button } from '../src/components/Button';

// ─── URL Preview ─────────────────────────────────────────────────────────────

interface UrlPreviewProps {
  url: string;
  colors: ReturnType<typeof useTheme>['colors'];
  paper: MD3Theme;
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
    <View style={[previewStyles.row, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant }]}>
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
  paper: MD3Theme;
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
  paper: MD3Theme;
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
            backgroundColor: isActive ? config.color : paper.colors.surfaceVariant,
            borderColor: isActive ? config.color : paper.colors.outlineVariant,
          },
        ]}
      >
        <Ionicons
          name={config.icon as React.ComponentProps<typeof Ionicons>['name']}
          size={15}
          color={isActive ? '#fff' : colors.textSecondary}
        />
        <Text style={[chipStyles.text, { color: isActive ? '#fff' : colors.textSecondary }]}>
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

export default function SaveScreen() {
  const { colors, layout } = useTheme();
  const paper = usePaperTheme();
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

  // Ask user before reading clipboard — privacy best practice
  useEffect(() => {
    Alert.alert(
      'Paste from clipboard?',
      'Lumio can pre-fill the URL field with your clipboard contents.',
      [
        { text: 'No thanks', style: 'cancel' },
        {
          text: 'Paste URL',
          onPress: () => {
            Clipboard.getStringAsync().then((text) => {
              const safeUrl = extractSafeUrl(text ?? '');
              if (safeUrl) setUrl(safeUrl);
            });
          },
        },
      ]
    );
  }, []);

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
    const aiSettings = await getAISettings();
    if (!aiSettings) {
      Alert.alert('No AI provider', 'Go to Settings to configure your AI provider and API key.');
      return;
    }
    setAiLoading(true);
    setLastMetadata(null);
    setMetadataFailed(false);
    try {
      const metadata = url.trim() ? await fetchPageMetadata(url) : null;
      if (url.trim() && !metadata) {
        setMetadataFailed(true);
      } else if (metadata) {
        setLastMetadata(metadata);
      }
      const metadataText = [metadata ? formatMetadataForAI(metadata) : '', description.trim()]
        .filter(Boolean)
        .join('\n');
      const result = await summarizeItem(
        aiSettings,
        metadata?.title || title.trim() || url,
        undefined,
        metadataText || undefined,
        contentType
      );
      if (result.suggestedTitle && !title.trim()) setTitle(result.suggestedTitle);
      if (result.suggestedTags.length > 0 && !tags.trim()) setTags(result.suggestedTags.join(', '));
      if (result.summary && !description.trim()) setDescription(result.summary);
    } catch (err) {
      logError(err, { screen: 'save', action: 'aiSummarize' });
      Alert.alert('AI Error', 'Could not reach the AI provider. Check your API key in Settings.');
    }
    setAiLoading(false);
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
      router.back();
    } catch (err) {
      logError(err, { screen: 'save', action: 'saveItem' });
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
            <Button title="Save" onPress={handleSave} loading={saving} size="sm" />
          </View>

          <ScrollView
            contentContainerStyle={[styles.content, { paddingHorizontal: sp, paddingBottom: 80, gap: layout.isExpressive ? 4 : 2 }]}
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
              <View style={[styles.metaFailBanner, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant, borderRadius: inputRadius }]}>
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
                      backgroundColor: !collectionId ? paper.colors.primaryContainer : paper.colors.surfaceVariant,
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
                        backgroundColor: collectionId === col.id ? col.color : paper.colors.surfaceVariant,
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
              style={[styles.gpsBtn, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant, borderRadius: inputRadius }]}
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
