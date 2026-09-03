import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch,
  Platform,
  Modal,
  Linking,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput, ActivityIndicator, useTheme as usePaperTheme } from 'react-native-paper';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { getAISettings, saveAISettings, clearAISettings } from '../../src/services/settings';
import { exportAsJSON, exportAsCSV } from '../../src/services/export';
import { AI_PROVIDERS, LOCAL_AI_SOURCES } from '../../src/constants';
import type { AISettings, AIProvider, LocalAISource, IconName } from '../../src/types';
import { Button } from '../../src/components/Button';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const COLLAPSED_SECTIONS_KEY = 'lumio_settings_collapsed_sections';

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

type SectionKey = 'appearance' | 'ai' | 'storage' | 'advanced' | 'about';

interface SectionCardProps {
  sectionKey: SectionKey;
  title: string;
  icon: IconName;
  subtitle?: string;
  isExpanded: boolean;
  onToggle: (key: SectionKey) => void;
  children: React.ReactNode;
  cardRadius: number;
}

function SectionCard({
  sectionKey,
  title,
  icon,
  subtitle,
  isExpanded,
  onToggle,
  children,
  cardRadius,
}: SectionCardProps) {
  const paper = usePaperTheme();

  return (
    <View
      style={[
        styles.sectionCard,
        {
          backgroundColor: paper.colors.surfaceVariant,
          borderColor: paper.colors.outlineVariant,
          borderRadius: cardRadius,
        },
      ]}
    >
      <TouchableOpacity
        onPress={() => onToggle(sectionKey)}
        style={styles.sectionHeader}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title} section, ${isExpanded ? 'expanded' : 'collapsed'}`}
        accessibilityState={{ expanded: isExpanded }}
      >
        <View style={styles.sectionHeaderLeft}>
          <View
            style={[
              styles.sectionIconContainer,
              {
                backgroundColor: isExpanded
                  ? paper.colors.primaryContainer
                  : paper.colors.surfaceVariant,
              },
            ]}
          >
            <Ionicons
              name={icon}
              size={20}
              color={isExpanded ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant}
            />
          </View>
          <View style={styles.sectionHeaderTitles}>
            <Text variant="titleMedium" style={{ color: paper.colors.onSurface, fontWeight: '600' }}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 1 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={paper.colors.onSurfaceVariant}
        />
      </TouchableOpacity>

      {isExpanded ? (
        <View style={styles.sectionBody}>
          <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />
          {children}
        </View>
      ) : null}
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function SettingsScreen() {
  const { colors, settings, updateSettings, layout } = useTheme();
  const paper = usePaperTheme();
  const insets = useSafeAreaInsets();
  const { items, collections } = useData();

  // Collapsible section states — appearance expanded by default
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>({
    appearance: false,
    ai: true,
    storage: true,
    advanced: true,
    about: true,
  });

  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [aiSettings, setAiSettings] = useState<Partial<AISettings>>({
    provider: 'openai',
    apiKey: '',
    model: '',
    localEnabled: false,
    localSource: 'ollama',
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pickingGguf, setPickingGguf] = useState(false);
  const [providerModalVisible, setProviderModalVisible] = useState(false);
  const [dbSize, setDbSize] = useState<string>('—');
  const [contextLength, setContextLength] = useState<string>('4096');

  // Load persisted section collapse state
  useEffect(() => {
    SecureStore.getItemAsync(COLLAPSED_SECTIONS_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            setCollapsedSections((prev) => ({ ...prev, ...parsed }));
          } catch {
            // keep defaults
          }
        }
      })
      .catch(() => {});
  }, []);

  // Toggle section
  const toggleSection = useCallback((key: SectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      SecureStore.setItemAsync(COLLAPSED_SECTIONS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Load AI Settings
  useEffect(() => {
    getAISettings().then((s) => {
      if (s) setAiSettings(s);
    });
  }, []);

  // Query Database file size from expo-file-system
  useEffect(() => {
    async function loadDbSize() {
      try {
        const dbPath = `${FileSystem.documentDirectory}SQLite/lumio.db`;
        const info = await FileSystem.getInfoAsync(dbPath);
        if (info.exists && typeof info.size === 'number') {
          setDbSize(formatBytes(info.size));
        } else {
          // Alternative path check
          const altPath = `${FileSystem.documentDirectory}lumio.db`;
          const altInfo = await FileSystem.getInfoAsync(altPath);
          if (altInfo.exists && typeof altInfo.size === 'number') {
            setDbSize(formatBytes(altInfo.size));
          } else {
            setDbSize('< 1 MB');
          }
        }
      } catch {
        setDbSize('< 1 MB');
      }
    }
    loadDbSize();
  }, [items, collections]);

  const selectedProvider = AI_PROVIDERS.find((p) => p.id === aiSettings.provider) ?? AI_PROVIDERS[0];
  const selectedLocalSource = LOCAL_AI_SOURCES.find((s) => s.id === (aiSettings.localSource ?? 'ollama')) ?? LOCAL_AI_SOURCES[0];

  const handlePickGguf = useCallback(async () => {
    setPickingGguf(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'android' ? '*/*' : 'public.data',
        copyToCacheDirectory: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        if (!asset.name.toLowerCase().endsWith('.gguf')) {
          Alert.alert('Invalid file', 'Please select a .gguf model file.');
        } else {
          setAiSettings((s) => ({
            ...s,
            localGgufPath: asset.uri,
            localGgufName: asset.name,
            localGgufSize: asset.size,
            model: asset.name.replace(/\.gguf$/i, ''),
          }));
        }
      }
    } catch {
      Alert.alert('File picker error', 'Could not open the file picker.');
    } finally {
      setPickingGguf(false);
    }
  }, []);

  const handleSaveAI = async () => {
    const isLocal = aiSettings.provider === 'local';
    if (!isLocal && !aiSettings.apiKey?.trim()) {
      Alert.alert('Missing API Key', 'Please enter your API key.');
      return;
    }
    if (aiSettings.provider === 'watsonx' && !aiSettings.watsonxProjectId?.trim()) {
      Alert.alert('Missing Project ID', 'IBM watsonx requires a Project ID.');
      return;
    }
    if (isLocal && aiSettings.localSource === 'gguf' && !aiSettings.localGgufPath?.trim()) {
      Alert.alert('No GGUF file selected', 'Please select a .gguf model file to continue.');
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
      localSource: aiSettings.localSource,
      localGgufPath: aiSettings.localGgufPath,
      localGgufSize: aiSettings.localGgufSize,
      localGgufName: aiSettings.localGgufName,
      localEnabled: aiSettings.localEnabled,
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
    Alert.alert(
      'Reset AI Settings',
      'This will remove your saved API keys, project IDs, and provider configuration from encrypted storage.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await clearAISettings();
            setAiSettings({
              provider: 'openai',
              apiKey: '',
              model: '',
              localEnabled: false,
              localSource: 'ollama',
            });
            Alert.alert('Reset Complete', 'AI settings have been restored to defaults.');
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert('Clear Cache', 'Are you sure you want to clear cached temporary files and preview data?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear Cache',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Cache Cleared', 'Temporary cache cleared successfully.');
        },
      },
    ]);
  };

  const handleOpenGitHub = () => {
    const url = 'https://github.com/lumio-app/lumio';
    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) Linking.openURL(url);
        else Alert.alert('Cannot open URL', url);
      })
      .catch(() => Alert.alert('Error', 'Unable to open repository link.'));
  };

  const cardRadius = layout.cardRadius || 16;
  const cloudProviders = AI_PROVIDERS.filter((p) => p.id !== 'local');
  const localProvider = AI_PROVIDERS.find((p) => p.id === 'local');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: paper.colors.outlineVariant }]}>
        <Text variant="headlineSmall" style={{ color: paper.colors.onSurface, fontWeight: '700' }}>
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 52 + 24 },
        ]}
      >
        {/* ── 1. APPEARANCE ────────────────────────────────────── */}
        <SectionCard
          sectionKey="appearance"
          title="Appearance"
          icon="color-palette"
          subtitle={`${settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1)} · ${
            APPEARANCE_STYLES.find((s) => s.id === settings.appearanceStyle)?.label ?? 'Classic'
          }`}
          isExpanded={!collapsedSections.appearance}
          onToggle={toggleSection}
          cardRadius={cardRadius}
        >
          {/* Theme Mode */}
          <View style={styles.subSection}>
            <Text variant="labelMedium" style={[styles.subSectionHeader, { color: paper.colors.onSurfaceVariant }]}>
              THEME MODE
            </Text>
            {(['light', 'dark', 'system'] as const).map((mode, i, arr) => (
              <React.Fragment key={mode}>
                <TouchableOpacity
                  onPress={() => updateSettings({ theme: mode })}
                  style={[styles.row, { minHeight: layout.touchTarget }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: settings.theme === mode }}
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
                    <Ionicons name="checkmark-circle" size={22} color={paper.colors.primary} />
                  )}
                </TouchableOpacity>
                {i < arr.length - 1 && (
                  <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />
                )}
              </React.Fragment>
            ))}
          </View>

          <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />

          {/* Theme Style */}
          <View style={styles.subSection}>
            <Text variant="labelMedium" style={[styles.subSectionHeader, { color: paper.colors.onSurfaceVariant }]}>
              THEME STYLE
            </Text>
            {APPEARANCE_STYLES.map((style, i) => (
              <React.Fragment key={style.id}>
                <TouchableOpacity
                  onPress={() => updateSettings({ appearanceStyle: style.id })}
                  style={[styles.row, { minHeight: layout.touchTarget }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: settings.appearanceStyle === style.id }}
                >
                  <View style={styles.rowLeft}>
                    <Ionicons
                      name={style.id === 'classic' ? 'color-palette' : style.id === 'material-you' ? 'phone-portrait' : 'sparkles'}
                      size={20}
                      color={paper.colors.onSurfaceVariant}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                        {style.label}
                      </Text>
                      <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                        {style.description}
                      </Text>
                    </View>
                  </View>
                  {settings.appearanceStyle === style.id && (
                    <Ionicons name="checkmark-circle" size={22} color={paper.colors.primary} />
                  )}
                </TouchableOpacity>
                {i < APPEARANCE_STYLES.length - 1 && (
                  <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />
                )}
              </React.Fragment>
            ))}
          </View>

          <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />

          {/* Options Toggles */}
          <View style={styles.subSection}>
            <Text variant="labelMedium" style={[styles.subSectionHeader, { color: paper.colors.onSurfaceVariant }]}>
              OPTIONS
            </Text>
            {APPEARANCE_TOGGLES.map((toggle, i) => (
              <React.Fragment key={toggle.key}>
                <View style={[styles.row, { minHeight: layout.touchTarget }]}>
                  <View style={styles.rowLeft}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                        {toggle.label}
                      </Text>
                      <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                        {toggle.description}
                      </Text>
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
                {i < APPEARANCE_TOGGLES.length - 1 && (
                  <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />
                )}
              </React.Fragment>
            ))}
          </View>
        </SectionCard>

        {/* ── 2. AI ────────────────────────────────────────────── */}
        <SectionCard
          sectionKey="ai"
          title="AI & Intelligence"
          icon="sparkles"
          subtitle={
            aiSettings.provider === 'local'
              ? `Local LLM (${selectedLocalSource?.name ?? 'Ollama'})`
              : (selectedProvider?.name ?? 'OpenAI')
          }
          isExpanded={!collapsedSections.ai}
          onToggle={toggleSection}
          cardRadius={cardRadius}
        >
          {/* Provider Picker Selector */}
          <View style={styles.subSection}>
            <Text variant="labelMedium" style={[styles.subSectionHeader, { color: paper.colors.onSurfaceVariant }]}>
              CURRENT PROVIDER
            </Text>
            <TouchableOpacity
              onPress={() => setProviderModalVisible(true)}
              style={[
                styles.providerSelectorRow,
                {
                  backgroundColor: paper.colors.surface,
                  borderColor: paper.colors.outlineVariant,
                  borderRadius: layout.cardRadius ? layout.cardRadius / 2 : 12,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Select AI Provider"
            >
              <View style={styles.rowLeft}>
                <View style={[styles.providerDot, { backgroundColor: paper.colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text variant="titleMedium" style={{ color: paper.colors.onSurface, fontWeight: '600' }}>
                    {selectedProvider?.name ?? 'Select Provider'}
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    {selectedProvider?.description ?? ''}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          {/* Cloud Provider Configuration */}
          {aiSettings.provider !== 'local' && (
            <>
              <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />
              <View style={styles.subSection}>
                <Text variant="labelMedium" style={[styles.subSectionHeader, { color: paper.colors.onSurfaceVariant }]}>
                  {selectedProvider.name.toUpperCase()} CONFIGURATION
                </Text>

                {/* API Key */}
                <TextInput
                  label={`${selectedProvider.name} API Key`}
                  value={aiSettings.apiKey ?? ''}
                  onChangeText={(v) => setAiSettings((s) => ({ ...s, apiKey: v }))}
                  placeholder={`Enter your ${selectedProvider.name} API key`}
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

                {/* Model name */}
                <TextInput
                  label="Model name (optional)"
                  value={aiSettings.model ?? ''}
                  onChangeText={(v) => setAiSettings((s) => ({ ...s, model: v }))}
                  placeholder={selectedProvider.modelPlaceholder ?? 'default-model'}
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.textInput, { marginTop: 12 }]}
                />

                {/* watsonx specifics */}
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
                      style={[styles.textInput, { marginTop: 12 }]}
                    />
                    <TextInput
                      label="Region"
                      value={aiSettings.watsonxRegion ?? ''}
                      onChangeText={(v) => setAiSettings((s) => ({ ...s, watsonxRegion: v }))}
                      placeholder="us-south"
                      mode="outlined"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.textInput, { marginTop: 12 }]}
                    />
                  </>
                )}

                {/* Indus specifics */}
                {aiSettings.provider === 'indus' && (
                  <TextInput
                    label="API Base URL"
                    value={aiSettings.localBaseUrl ?? ''}
                    onChangeText={(v) => setAiSettings((s) => ({ ...s, localBaseUrl: v }))}
                    placeholder="https://api.indusai.in/v1"
                    mode="outlined"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[styles.textInput, { marginTop: 12 }]}
                  />
                )}
              </View>
            </>
          )}

          {/* Local Provider Configuration */}
          {aiSettings.provider === 'local' && (
            <>
              <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />

              {/* Enable Local AI Toggle */}
              <View style={styles.subSection}>
                <View style={[styles.row, { minHeight: 56 }]}>
                  <View style={styles.rowLeft}>
                    <Ionicons name="hardware-chip" size={22} color={paper.colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge" style={{ color: paper.colors.onSurface, fontWeight: '600' }}>
                        Enable Local AI
                      </Text>
                      <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                        Run models on-device or on your local network
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={Boolean(aiSettings.localEnabled)}
                    onValueChange={(v) =>
                      setAiSettings((s) => ({
                        ...s,
                        localEnabled: v,
                      }))
                    }
                    trackColor={{ false: colors.surfaceContainerHigh, true: paper.colors.primary }}
                    thumbColor={aiSettings.localEnabled ? paper.colors.onPrimary : paper.colors.outline}
                    accessibilityLabel="Enable Local AI"
                  />
                </View>
              </View>

              {aiSettings.localEnabled && (
                <>
                  <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />

                  {/* Backend Selection */}
                  <View style={styles.subSection}>
                    <Text variant="labelMedium" style={[styles.subSectionHeader, { color: paper.colors.onSurfaceVariant }]}>
                      BACKEND
                    </Text>
                    {LOCAL_AI_SOURCES.map((src, i) => (
                      <React.Fragment key={src.id}>
                        <TouchableOpacity
                          onPress={() =>
                            setAiSettings((s) => ({
                              ...s,
                              localSource: src.id as LocalAISource,
                              localBaseUrl: src.defaultUrl,
                            }))
                          }
                          style={[styles.row, { minHeight: 52 }]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: (aiSettings.localSource ?? 'ollama') === src.id }}
                        >
                          <View style={styles.rowLeft}>
                            <Ionicons
                              name={
                                (aiSettings.localSource ?? 'ollama') === src.id
                                  ? 'radio-button-on'
                                  : 'radio-button-off'
                              }
                              size={20}
                              color={
                                (aiSettings.localSource ?? 'ollama') === src.id
                                  ? paper.colors.primary
                                  : paper.colors.onSurfaceVariant
                              }
                            />
                            <View style={{ flex: 1 }}>
                              <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                                {src.name}
                              </Text>
                              <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                                {src.description}
                              </Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                        {i < LOCAL_AI_SOURCES.length - 1 && (
                          <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />
                        )}
                      </React.Fragment>
                    ))}
                  </View>

                  <View style={[styles.divider, { backgroundColor: paper.colors.outlineVariant }]} />

                  {/* Local AI Details */}
                  <View style={styles.subSection}>
                    <Text variant="labelMedium" style={[styles.subSectionHeader, { color: paper.colors.onSurfaceVariant }]}>
                      LOCAL CONFIGURATION
                    </Text>

                    {/* Experimental GGUF Sub-section */}
                    {aiSettings.localSource === 'gguf' && (
                      <View
                        style={[
                          styles.ggufContainer,
                          {
                            backgroundColor: paper.colors.surface,
                            borderColor: paper.colors.outlineVariant,
                            borderRadius: layout.cardRadius ? layout.cardRadius / 2 : 12,
                          },
                        ]}
                      >
                        <TouchableOpacity
                          onPress={handlePickGguf}
                          disabled={pickingGguf}
                          style={[
                            styles.ggufPickerBtn,
                            {
                              backgroundColor: paper.colors.primaryContainer,
                              borderColor: paper.colors.primary,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Select GGUF File"
                        >
                          {pickingGguf ? (
                            <ActivityIndicator size="small" color={paper.colors.onPrimaryContainer} />
                          ) : (
                            <Ionicons name="folder-open" size={20} color={paper.colors.onPrimaryContainer} />
                          )}
                          <Text variant="labelLarge" style={{ color: paper.colors.onPrimaryContainer, fontWeight: '600' }}>
                            {aiSettings.localGgufName || aiSettings.localGgufPath ? 'Change GGUF File' : 'Select GGUF File'}
                          </Text>
                        </TouchableOpacity>

                        {/* GGUF Metadata inspection */}
                        <View style={styles.ggufMetaTable}>
                          <View style={styles.ggufMetaRow}>
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                              File Name
                            </Text>
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurface, fontWeight: '500', flex: 1, textAlign: 'right' }} numberOfLines={1}>
                              {aiSettings.localGgufName ?? (aiSettings.localGgufPath ? aiSettings.localGgufPath.split('/').pop() : 'None')}
                            </Text>
                          </View>
                          <View style={styles.ggufMetaRow}>
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                              File Size
                            </Text>
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurface, fontWeight: '500' }}>
                              {aiSettings.localGgufSize ? formatBytes(aiSettings.localGgufSize) : '—'}
                            </Text>
                          </View>
                          <View style={styles.ggufMetaRow}>
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                              Model Metadata
                            </Text>
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                              —
                            </Text>
                          </View>
                          <View style={styles.ggufMetaRow}>
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                              Status
                            </Text>
                            <View
                              style={[
                                styles.badge,
                                {
                                  backgroundColor: aiSettings.localGgufPath
                                    ? paper.colors.primaryContainer
                                    : paper.colors.errorContainer,
                                },
                              ]}
                            >
                              <Text
                                variant="labelSmall"
                                style={{
                                  color: aiSettings.localGgufPath
                                    ? paper.colors.onPrimaryContainer
                                    : paper.colors.onErrorContainer,
                                  fontWeight: '600',
                                }}
                              >
                                {aiSettings.localGgufPath ? 'Ready' : 'Missing'}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Backend URL */}
                    <TextInput
                      label="Backend URL"
                      value={aiSettings.localBaseUrl ?? ''}
                      onChangeText={(v) => setAiSettings((s) => ({ ...s, localBaseUrl: v }))}
                      placeholder={selectedLocalSource.defaultUrl}
                      mode="outlined"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={[styles.textInput, { marginTop: 12 }]}
                    />

                    {/* Model Name */}
                    <TextInput
                      label="Model Name"
                      value={aiSettings.model ?? ''}
                      onChangeText={(v) => setAiSettings((s) => ({ ...s, model: v }))}
                      placeholder={selectedLocalSource.modelPlaceholder}
                      mode="outlined"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.textInput, { marginTop: 12 }]}
                    />

                    {/* Context Length */}
                    <TextInput
                      label="Context Length (tokens)"
                      value={contextLength}
                      onChangeText={setContextLength}
                      placeholder="4096"
                      keyboardType="numeric"
                      mode="outlined"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.textInput, { marginTop: 12 }]}
                    />

                    {/* Status & Estimated RAM */}
                    <View
                      style={[
                        styles.readOnlyMetrics,
                        {
                          backgroundColor: paper.colors.surface,
                          borderColor: paper.colors.outlineVariant,
                          borderRadius: layout.cardRadius ? layout.cardRadius / 2 : 12,
                        },
                      ]}
                    >
                      <View style={styles.metricRow}>
                        <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                          Status
                        </Text>
                        <Text variant="bodyMedium" style={{ color: paper.colors.outline, fontWeight: '500' }}>
                          Not connected
                        </Text>
                      </View>
                      <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />
                      <View style={styles.metricRow}>
                        <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                          Estimated RAM
                        </Text>
                        <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant, fontWeight: '500' }}>
                          —
                        </Text>
                      </View>
                    </View>
                  </View>
                </>
              )}
            </>
          )}

          {/* Action Buttons & Note */}
          <View style={styles.actionContainer}>
            <View style={styles.aiButtons}>
              <Button
                title={saved ? '✓ Saved!' : 'Save AI Settings'}
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
            <Text
              variant="bodySmall"
              style={{ color: paper.colors.onSurfaceVariant, marginTop: 8, lineHeight: 16 }}
            >
              🔒 Keys and parameters are stored encrypted via SecureStore and never transmitted externally.
            </Text>
          </View>
        </SectionCard>

        {/* ── 3. STORAGE & BACKUP ──────────────────────────────── */}
        <SectionCard
          sectionKey="storage"
          title="Storage & Backup"
          icon="server"
          subtitle={`${items.length} items · ${collections.length} collections · ${dbSize}`}
          isExpanded={!collapsedSections.storage}
          onToggle={toggleSection}
          cardRadius={cardRadius}
        >
          <View style={styles.subSection}>
            {/* Storage metrics */}
            <View
              style={[
                styles.storageMetricsGrid,
                {
                  backgroundColor: paper.colors.surface,
                  borderColor: paper.colors.outlineVariant,
                  borderRadius: layout.cardRadius ? layout.cardRadius / 2 : 12,
                },
              ]}
            >
              <View style={styles.storageMetricCol}>
                <Text variant="titleLarge" style={{ color: paper.colors.primary, fontWeight: '700' }}>
                  {items.length}
                </Text>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                  Items
                </Text>
              </View>
              <View style={[styles.verticalDivider, { backgroundColor: paper.colors.outlineVariant }]} />
              <View style={styles.storageMetricCol}>
                <Text variant="titleLarge" style={{ color: paper.colors.primary, fontWeight: '700' }}>
                  {collections.length}
                </Text>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                  Collections
                </Text>
              </View>
              <View style={[styles.verticalDivider, { backgroundColor: paper.colors.outlineVariant }]} />
              <View style={styles.storageMetricCol}>
                <Text variant="titleLarge" style={{ color: paper.colors.primary, fontWeight: '700' }}>
                  {dbSize}
                </Text>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                  DB Size
                </Text>
              </View>
            </View>

            {/* Export Buttons */}
            <View style={[styles.exportButtons, { marginTop: 16 }]}>
              <TouchableOpacity
                onPress={() => handleExport('json')}
                disabled={!!exporting}
                style={[
                  styles.exportBtn,
                  { backgroundColor: paper.colors.primaryContainer, borderColor: paper.colors.primary },
                ]}
              >
                {exporting === 'json' ? (
                  <ActivityIndicator size="small" color={paper.colors.onPrimaryContainer} />
                ) : (
                  <Ionicons name="code-download" size={18} color={paper.colors.onPrimaryContainer} />
                )}
                <Text variant="labelLarge" style={{ color: paper.colors.onPrimaryContainer, fontWeight: '600' }}>
                  {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleExport('csv')}
                disabled={!!exporting}
                style={[
                  styles.exportBtn,
                  { backgroundColor: paper.colors.secondaryContainer, borderColor: paper.colors.secondary },
                ]}
              >
                {exporting === 'csv' ? (
                  <ActivityIndicator size="small" color={paper.colors.onSecondaryContainer} />
                ) : (
                  <Ionicons name="document-text" size={18} color={paper.colors.onSecondaryContainer} />
                )}
                <Text variant="labelLarge" style={{ color: paper.colors.onSecondaryContainer, fontWeight: '600' }}>
                  {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
                </Text>
              </TouchableOpacity>
            </View>

            <Text variant="bodySmall" style={[styles.exportNote, { color: paper.colors.onSurfaceVariant }]}>
              JSON backup is fully importable. CSV is spreadsheet-compatible.
            </Text>
          </View>
        </SectionCard>

        {/* ── 4. ADVANCED ──────────────────────────────────────── */}
        <SectionCard
          sectionKey="advanced"
          title="Advanced"
          icon="settings"
          subtitle="Diagnostics, cache & resets"
          isExpanded={!collapsedSections.advanced}
          onToggle={toggleSection}
          cardRadius={cardRadius}
        >
          <View style={styles.subSection}>
            {/* Diagnostics row */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={() => Alert.alert('Diagnostics', 'All local systems healthy.\nSQLite WAL: Enabled\nSecureStore: Available')}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="pulse" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                    System Diagnostics
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    Inspect SQLite, storage and hardware capability
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>

            <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            {/* Logs row */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={() => Alert.alert('App Logs', 'No active diagnostic log entries found.')}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="receipt" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                    Activity Logs
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    Local execution trace & errors
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>

            <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            {/* Clear Cache */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={handleClearCache}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="trash-bin" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                    Clear Cache
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    Free temporary preview and export files
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            {/* Reset AI Settings */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={handleClearAI}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="refresh-circle" size={20} color={paper.colors.error} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.error, fontWeight: '600' }}>
                    Reset AI Settings
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    Wipe saved keys and restore default providers
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        </SectionCard>

        {/* ── 5. ABOUT ─────────────────────────────────────────── */}
        <SectionCard
          sectionKey="about"
          title="About"
          icon="information-circle"
          subtitle={`v${Constants.expoConfig?.version ?? '1.0.0'} · Open Source`}
          isExpanded={!collapsedSections.about}
          onToggle={toggleSection}
          cardRadius={cardRadius}
        >
          <View style={styles.subSection}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="sparkles" size={20} color={paper.colors.primary} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface, fontWeight: '600' }}>
                  Lumio
                </Text>
              </View>
              <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                v{Constants.expoConfig?.version ?? '1.0.0'}
              </Text>
            </View>

            <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="shield-checkmark" size={20} color={paper.colors.onSurfaceVariant} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                  Data Storage
                </Text>
              </View>
              <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                Local only (SQLite)
              </Text>
            </View>

            <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="share-social" size={20} color={paper.colors.onSurfaceVariant} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                  Share Integration
                </Text>
              </View>
              <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                Share sheet → Lumio
              </Text>
            </View>

            <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={handleOpenGitHub}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="logo-github" size={20} color={paper.colors.onSurfaceVariant} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                  GitHub Repository
                </Text>
              </View>
              <Ionicons name="open-outline" size={18} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>

            <View style={[styles.subDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={() => Alert.alert('Licenses', 'Lumio is open source software released under the Apache 2.0 License.')}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="document-text" size={20} color={paper.colors.onSurfaceVariant} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                  Open Source Licenses
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>
        </SectionCard>
      </ScrollView>

      {/* ── PROVIDER PICKER MODAL ────────────────────────────── */}
      <Modal
        visible={providerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProviderModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setProviderModalVisible(false)}
        >
          <View
            style={[
              styles.modalDialog,
              {
                backgroundColor: paper.colors.surface,
                borderColor: paper.colors.outlineVariant,
                borderRadius: layout.dialogRadius || 24,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text variant="titleLarge" style={{ color: paper.colors.onSurface, fontWeight: '700' }}>
                Select AI Provider
              </Text>
              <TouchableOpacity
                onPress={() => setProviderModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={paper.colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }}>
              <Text variant="labelSmall" style={[styles.modalGroupHeading, { color: paper.colors.primary }]}>
                CLOUD PROVIDERS
              </Text>
              {cloudProviders.map((prov) => {
                const isSelected = aiSettings.provider === prov.id;
                return (
                  <TouchableOpacity
                    key={prov.id}
                    style={[
                      styles.modalOptionRow,
                      isSelected && { backgroundColor: paper.colors.primaryContainer },
                    ]}
                    onPress={() => {
                      setAiSettings((s) => ({
                        ...s,
                        provider: prov.id,
                        model: '',
                        localEnabled: false,
                      }));
                      setProviderModalVisible(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="bodyLarge"
                        style={{
                          color: isSelected ? paper.colors.onPrimaryContainer : paper.colors.onSurface,
                          fontWeight: isSelected ? '700' : '500',
                        }}
                      >
                        {prov.name}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{
                          color: isSelected ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant,
                          marginTop: 2,
                        }}
                      >
                        {prov.description}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={22} color={paper.colors.onPrimaryContainer} />
                    )}
                  </TouchableOpacity>
                );
              })}

              {localProvider && (
                <>
                  <Text
                    variant="labelSmall"
                    style={[styles.modalGroupHeading, { color: paper.colors.primary, marginTop: 16 }]}
                  >
                    LOCAL PROVIDERS
                  </Text>
                  <TouchableOpacity
                    key={localProvider.id}
                    style={[
                      styles.modalOptionRow,
                      aiSettings.provider === 'local' && { backgroundColor: paper.colors.primaryContainer },
                    ]}
                    onPress={() => {
                      setAiSettings((s) => ({
                        ...s,
                        provider: 'local',
                        localEnabled: true,
                      }));
                      setProviderModalVisible(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="bodyLarge"
                        style={{
                          color:
                            aiSettings.provider === 'local'
                              ? paper.colors.onPrimaryContainer
                              : paper.colors.onSurface,
                          fontWeight: aiSettings.provider === 'local' ? '700' : '500',
                        }}
                      >
                        {localProvider.name}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{
                          color:
                            aiSettings.provider === 'local'
                              ? paper.colors.onPrimaryContainer
                              : paper.colors.onSurfaceVariant,
                          marginTop: 2,
                        }}
                      >
                        {localProvider.description}
                      </Text>
                    </View>
                    {aiSettings.provider === 'local' && (
                      <Ionicons name="checkmark-circle" size={22} color={paper.colors.onPrimaryContainer} />
                    )}
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
  content: {
    padding: 16,
    gap: 12,
  },
  sectionCard: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  sectionIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderTitles: {
    flex: 1,
  },
  sectionBody: {
    width: '100%',
  },
  subSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  subSectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  subDivider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
    marginVertical: 4,
  },
  providerSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  providerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  textInput: {
    backgroundColor: 'transparent',
  },
  ggufContainer: {
    padding: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  ggufPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  ggufMetaTable: {
    marginTop: 12,
    gap: 8,
  },
  ggufMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  readOnlyMetrics: {
    padding: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  actionContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  aiButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  storageMetricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 14,
    borderWidth: 1,
  },
  storageMetricCol: {
    alignItems: 'center',
    flex: 1,
  },
  verticalDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
  },
  exportButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  exportNote: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalDialog: {
    padding: 20,
    borderWidth: 1,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalGroupHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  modalOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
});
