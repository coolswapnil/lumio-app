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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { ActivityIndicator as PaperActivityIndicator, useTheme as usePaperTheme } from 'react-native-paper';
import { generateId } from '../src/utils/uuid';
import { sanitizeText, parseTags, sanitizeUrl, extractSafeUrl, LIMITS } from '../src/utils/validation';
import { logError, getUserMessage } from '../src/utils/errors';
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
  const paper = usePaperTheme();
  const insets = useSafeAreaInsets();
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
              if (safeUrl) {
                setUrl(safeUrl);
                if (safeUrl.includes('youtube.com') || safeUrl.includes('youtu.be')) {
                  setContentType('video');
                }
              }
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
    // Auto reverse-geocode to fill address if empty
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header — padded for status bar when presented as modal */}
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top > 0 ? insets.top : 14 }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Cancel</Text>
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
                        backgroundColor: isActive ? config.color : paper.colors.surfaceVariant,
                        borderColor: isActive ? config.color : paper.colors.outlineVariant,
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
            style={[styles.aiBtn, { borderColor: paper.colors.tertiary, backgroundColor: paper.colors.tertiaryContainer + '40' }]}
          >
            {aiLoading ? (
              <PaperActivityIndicator size="small" color={paper.colors.tertiary} />
            ) : (
              <Ionicons name="sparkles" size={16} color={paper.colors.tertiary} />
            )}
            <Text style={{ color: paper.colors.onTertiaryContainer, fontWeight: '600', fontSize: 14 }}>
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
                    backgroundColor: !collectionId ? paper.colors.primaryContainer : paper.colors.surfaceVariant,
                    borderColor: !collectionId ? paper.colors.primary : paper.colors.outlineVariant,
                  },
                ]}
              >
                <Text style={[styles.typeChipText, { color: !collectionId ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant }]}>
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
                      backgroundColor: collectionId === col.id ? col.color : paper.colors.surfaceVariant,
                      borderColor: collectionId === col.id ? col.color : paper.colors.outlineVariant,
                    },
                  ]}
                >
                  <Ionicons name={col.icon as any} size={14} color={collectionId === col.id ? '#fff' : paper.colors.onSurfaceVariant} />
                  <Text style={[styles.typeChipText, { color: collectionId === col.id ? '#fff' : paper.colors.onSurfaceVariant }]}>
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
          {/* GPS capture button */}
          <TouchableOpacity
            onPress={handleGetLocation}
            disabled={locationLoading}
            style={[styles.gpsBtn, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant }]}
          >
            {locationLoading ? (
              <PaperActivityIndicator size="small" color={paper.colors.onSurfaceVariant} />
            ) : (
              <Ionicons name="navigate" size={15} color={coords ? paper.colors.primary : paper.colors.onSurfaceVariant} />
            )}
            <Text style={[styles.gpsBtnText, { color: coords ? paper.colors.primary : paper.colors.onSurfaceVariant }]}>
              {coords
                ? `GPS: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                : 'Capture current GPS coordinates (optional)'}
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
          <Text style={[styles.locationHint, { color: colors.textMuted }]}>
            Type/paste the place name from the content. GPS coordinates are stored as extra metadata.
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
    paddingBottom: 14,
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
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
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
