import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput, ActivityIndicator, useTheme as usePaperTheme } from 'react-native-paper';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { getAISettings, saveAISettings, clearAISettings } from '../../src/services/settings';
import { exportAsJSON, exportAsCSV } from '../../src/services/export';
import { AI_PROVIDERS } from '../../src/constants';
import type { AISettings, AIProvider } from '../../src/types';
import { Button } from '../../src/components/Button';

const APPEARANCE_STYLES = [
  { id: 'classic', label: 'Lumio Classic', description: 'Lumio blue and indigo across every device' },
  { id: 'material-you', label: 'Material You', description: 'Wallpaper colors when Android supports them' },
  { id: 'expressive', label: 'Material You Expressive', description: 'Larger shapes, richer surfaces, and motion' },
] as const;

const APPEARANCE_TOGGLES = [
  { key: 'dynamicColors', label: 'Dynamic Colors', description: 'Use wallpaper colors on supported Android devices' },
  { key: 'useThemedIcon', label: 'Use Themed Icon', description: 'Use Lumio’s monochrome adaptive icon when supported' },
  { key: 'amoledBlack', label: 'AMOLED Black Theme', description: 'Use pure black surfaces in dark mode' },
  { key: 'edgeToEdge', label: 'Edge-to-Edge Layout', description: 'Draw safely behind system bars' },
  { key: 'dynamicNavigationBar', label: 'Dynamic Navigation Bar', description: 'Match navigation bar to the active theme' },
  { key: 'dynamicStatusBar', label: 'Dynamic Status Bar', description: 'Match status bar icons to the active theme' },
  { key: 'reduceMotion', label: 'Reduce Motion', description: 'Minimize interface animations' },
  { key: 'compactLayout', label: 'Compact Layout', description: 'Use denser list and content spacing' },
  { key: 'largeTouchTargets', label: 'Large Touch Targets', description: 'Increase controls to at least 56dp' },
  { key: 'highContrast', label: 'Higher Contrast', description: 'Strengthen boundaries for readability' },
] as const;

export default function SettingsScreen() {
  const { colors, settings, updateSettings, layout } = useTheme();
  const paper = usePaperTheme();
  const insets = useSafeAreaInsets();
  const { items, collections } = useData();
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [aiSettings, setAiSettings] = useState<Partial<AISettings>>({
    provider: 'openai',
    apiKey: '',
    model: '',
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAISettings().then((s) => {
      if (s) setAiSettings(s);
    });
  }, []);

  const selectedProvider = AI_PROVIDERS.find((p) => p.id === aiSettings.provider);

  const handleSaveAI = async () => {
    const isLocal = aiSettings.provider === 'local';
    // Local LLM: API key is optional (Ollama doesn't need one)
    if (!isLocal && !aiSettings.apiKey?.trim()) {
      Alert.alert('Missing API Key', 'Please enter your API key.');
      return;
    }
    if (aiSettings.provider === 'watsonx' && !aiSettings.watsonxProjectId?.trim()) {
      Alert.alert('Missing Project ID', 'IBM watsonx requires a Project ID.');
      return;
    }
    setSaving(true);
    await saveAISettings({
      provider: aiSettings.provider as AIProvider,
      apiKey: aiSettings.apiKey ?? '',
      model: aiSettings.model?.trim() || undefined,
      watsonxProjectId: aiSettings.watsonxProjectId,
      watsonxRegion: aiSettings.watsonxRegion,
      localBaseUrl: aiSettings.localBaseUrl,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(format);
    try {
      if (format === 'json') {
        await exportAsJSON(items, collections);
      } else {
        await exportAsCSV(items, collections);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Export failed', msg);
    }
    setExporting(null);
  };

  const handleClearAI = () => {
    Alert.alert('Clear AI Settings', 'Remove your saved API key and provider?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearAISettings();
          setAiSettings({ provider: 'openai', apiKey: '', model: '' });
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text variant="headlineSmall" style={{ color: paper.colors.onSurface }}>Settings</Text>
      </View>

      {/* paddingBottom clears tab bar (52dp) + nav inset + design gap */}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 52 + 24 }]}>
        {/* Appearance */}
        <Text variant="labelSmall" style={[styles.sectionTitle, { color: paper.colors.onSurfaceVariant }]}>APPEARANCE</Text>
        <View style={[styles.card, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant }]}>
          {(['light', 'dark', 'system'] as const).map((mode, i, arr) => (
            <React.Fragment key={mode}>
              <TouchableOpacity
                onPress={() => updateSettings({ theme: mode })}
                style={styles.row}
              >
                <View style={styles.rowLeft}>
                  <Ionicons
                    name={mode === 'light' ? 'sunny' : mode === 'dark' ? 'moon' : 'phone-portrait'}
                    size={20}
                    color={paper.colors.onSurfaceVariant}
                  />
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)} Mode
                  </Text>
                </View>
                {settings.theme === mode && (
                  <Ionicons name="checkmark-circle" size={20} color={paper.colors.primary} />
                )}
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />}
            </React.Fragment>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant, borderRadius: layout.cardRadius }]}>
          <Text variant="labelMedium" style={[styles.appearanceHeading, { color: paper.colors.onSurfaceVariant }]}>THEME STYLE</Text>
          {APPEARANCE_STYLES.map((style, i) => (
            <React.Fragment key={style.id}>
              <TouchableOpacity
                onPress={() => updateSettings({ appearanceStyle: style.id })}
                style={[styles.row, { minHeight: layout.touchTarget }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: settings.appearanceStyle === style.id }}
              >
                <View style={styles.rowLeft}>
                  <Ionicons name={style.id === 'classic' ? 'color-palette' : style.id === 'material-you' ? 'phone-portrait' : 'sparkles'} size={20} color={paper.colors.onSurfaceVariant} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>{style.label}</Text>
                    <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>{style.description}</Text>
                  </View>
                </View>
                {settings.appearanceStyle === style.id && <Ionicons name="checkmark-circle" size={20} color={paper.colors.primary} />}
              </TouchableOpacity>
              {i < APPEARANCE_STYLES.length - 1 && <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />}
            </React.Fragment>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant, borderRadius: layout.cardRadius }]}>
          <Text variant="labelMedium" style={[styles.appearanceHeading, { color: paper.colors.onSurfaceVariant }]}>OPTIONS</Text>
          {APPEARANCE_TOGGLES.map((toggle, i) => (
            <React.Fragment key={toggle.key}>
              <View style={[styles.row, { minHeight: layout.touchTarget }]}>
                <View style={styles.rowLeft}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>{toggle.label}</Text>
                    <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>{toggle.description}</Text>
                  </View>
                </View>
                <Switch
                  value={Boolean(settings[toggle.key])}
                  onValueChange={(value) => updateSettings({ [toggle.key]: value })}
                  trackColor={{ false: colors.surfaceContainerHigh, true: paper.colors.primary }}
                  thumbColor={settings[toggle.key] ? paper.colors.onPrimary : paper.colors.outline}
                  accessibilityLabel={toggle.label}
                />
              </View>
              {i < APPEARANCE_TOGGLES.length - 1 && <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* AI Provider */}
        <Text variant="labelSmall" style={[styles.sectionTitle, { color: paper.colors.onSurfaceVariant }]}>AI PROVIDER</Text>
        <View style={[styles.card, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant }]}>
          {AI_PROVIDERS.map((provider, i, arr) => (
            <React.Fragment key={provider.id}>
              <TouchableOpacity
                onPress={() => setAiSettings((s) => ({ ...s, provider: provider.id, model: '' }))}
                style={styles.row}
              >
                <View style={styles.rowLeft}>
                  <View style={[styles.providerDot, {
                    backgroundColor: aiSettings.provider === provider.id ? paper.colors.primary : paper.colors.surfaceVariant
                  }]} />
                  <View>
                    <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>{provider.name}</Text>
                    <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>{provider.description}</Text>
                  </View>
                </View>
                {aiSettings.provider === provider.id && (
                  <Ionicons name="checkmark-circle" size={20} color={paper.colors.primary} />
                )}
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* API Key */}
        <View style={[styles.card, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant }]}>
          <View style={styles.cardPadding}>
            {/* MD3 TextInput: API Key */}
            <TextInput
              label={`${selectedProvider?.name ?? 'Provider'} API Key`}
              value={aiSettings.apiKey ?? ''}
              onChangeText={(v) => setAiSettings((s) => ({ ...s, apiKey: v }))}
              placeholder={`Enter your ${selectedProvider?.name ?? 'provider'} API key`}
              mode="outlined"
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
              right={
                <TextInput.Icon
                  icon={showKey ? 'eye-off' : 'eye'}
                  onPress={() => setShowKey(!showKey)}
                  color={paper.colors.onSurfaceVariant}
                />
              }
              style={styles.textInput}
            />

            {/* Model */}
            <TextInput
              label="Model (optional — uses default if blank)"
              value={aiSettings.model ?? ''}
              onChangeText={(v) => setAiSettings((s) => ({ ...s, model: v }))}
              placeholder={selectedProvider?.modelPlaceholder ?? 'model-name'}
              mode="outlined"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.textInput, { marginTop: 14 }]}
            />

            {/* watsonx extras */}
            {aiSettings.provider === 'watsonx' && (
              <>
                <TextInput
                  label="Project ID *"
                  value={aiSettings.watsonxProjectId ?? ''}
                  onChangeText={(v) => setAiSettings((s) => ({ ...s, watsonxProjectId: v }))}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.textInput, { marginTop: 14 }]}
                />
                <TextInput
                  label="Region"
                  value={aiSettings.watsonxRegion ?? ''}
                  onChangeText={(v) => setAiSettings((s) => ({ ...s, watsonxRegion: v }))}
                  placeholder="us-south"
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.textInput, { marginTop: 14 }]}
                />
              </>
            )}

            {/* Local LLM / Indus: base URL field */}
            {(aiSettings.provider === 'local' || aiSettings.provider === 'indus') && (
              <>
                <TextInput
                  label={aiSettings.provider === 'local' ? 'Server Base URL' : 'API Base URL'}
                  value={aiSettings.localBaseUrl ?? ''}
                  onChangeText={(v) => setAiSettings((s) => ({ ...s, localBaseUrl: v }))}
                  placeholder={
                    aiSettings.provider === 'local'
                      ? 'http://localhost:11434/v1'
                      : 'https://api.indusai.in/v1'
                  }
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={[styles.textInput, { marginTop: 14 }]}
                />
                {aiSettings.provider === 'local' && (
                  <Text variant="bodySmall" style={[{ color: paper.colors.onSurfaceVariant, marginTop: 6, lineHeight: 18 }]}>
                    Ollama default: http://localhost:11434/v1{'\n'}
                    LM Studio default: http://localhost:1234/v1{'\n'}
                    API key is optional for local servers.
                  </Text>
                )}
              </>
            )}
          </View>

          <View style={styles.aiButtons}>
            <Button
              title={saved ? '✓ Saved!' : 'Save API Key'}
              onPress={handleSaveAI}
              loading={saving}
              style={{ flex: 1 }}
            />
            <Button
              title="Clear"
              onPress={handleClearAI}
              variant="danger"
              style={{ flex: 0 }}
            />
          </View>

          <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, paddingHorizontal: 14, paddingBottom: 14, lineHeight: 16 }}>
            🔒 API keys are stored encrypted on your device and never transmitted externally.
          </Text>
        </View>

        {/* Export / Backup */}
        <Text variant="labelSmall" style={[styles.sectionTitle, { color: paper.colors.onSurfaceVariant }]}>EXPORT & BACKUP</Text>
        <View style={[styles.card, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant }]}>
          <Text variant="bodyMedium" style={[styles.exportDesc, { color: paper.colors.onSurfaceVariant }]}>
            {items.length} item{items.length !== 1 ? 's' : ''} · {collections.length} collection{collections.length !== 1 ? 's' : ''}
          </Text>
          <View style={styles.exportButtons}>
            <TouchableOpacity
              onPress={() => handleExport('json')}
              disabled={!!exporting}
              style={[styles.exportBtn, { backgroundColor: paper.colors.primaryContainer, borderColor: paper.colors.primary }]}
            >
              {exporting === 'json'
                ? <ActivityIndicator size="small" color={paper.colors.onPrimaryContainer} />
                : <Ionicons name="code-download" size={18} color={paper.colors.onPrimaryContainer} />}
              <Text variant="labelLarge" style={{ color: paper.colors.onPrimaryContainer }}>
                {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleExport('csv')}
              disabled={!!exporting}
              style={[styles.exportBtn, { backgroundColor: paper.colors.secondaryContainer, borderColor: paper.colors.secondary }]}
            >
              {exporting === 'csv'
                ? <ActivityIndicator size="small" color={paper.colors.onSecondaryContainer} />
                : <Ionicons name="document-text" size={18} color={paper.colors.onSecondaryContainer} />}
              <Text variant="labelLarge" style={{ color: paper.colors.onSecondaryContainer }}>
                {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text variant="bodySmall" style={[styles.exportNote, { color: paper.colors.onSurfaceVariant }]}>
            JSON backup is fully importable. CSV is spreadsheet-compatible.
          </Text>
        </View>

        {/* About */}
        <Text variant="labelSmall" style={[styles.sectionTitle, { color: paper.colors.onSurfaceVariant }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: paper.colors.surfaceVariant, borderColor: paper.colors.outlineVariant }]}>
          <View style={styles.row}>
            <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Lumio</Text>
            <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant }}>
              v{Constants.expoConfig?.version ?? '—'}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />
          <View style={styles.row}>
            <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Data Storage</Text>
            <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant }}>Local only (SQLite)</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />
          <View style={styles.row}>
            <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Share from any app</Text>
            <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant }}>Share sheet → Lumio</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  content: { padding: 16, gap: 8 },
  sectionTitle: {
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 8,
  },
  appearanceHeading: {
    paddingHorizontal: 14,
    paddingTop: 14,
    letterSpacing: 0.7,
  },
  cardPadding: {
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    minHeight: 56,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  divider: { height: 1, marginHorizontal: 14 },
  providerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  textInput: {
    backgroundColor: 'transparent',
  },
  aiButtons: {
    flexDirection: 'row',
    padding: 14,
    paddingTop: 8,
    gap: 8,
  },
  exportDesc: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  exportButtons: {
    flexDirection: 'row',
    padding: 14,
    paddingTop: 10,
    gap: 10,
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 7,
  },
  exportNote: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    lineHeight: 16,
  },
});
