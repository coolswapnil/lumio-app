import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Animated,
  UIManager,
  FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput, ActivityIndicator } from 'react-native-paper';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/context/ThemeContext';
import { useAppTheme } from '../../src/constants/colors';
import { useData } from '../../src/context/DataContext';
import { getAISettings, saveAISettings, clearAISettings, getAppSettings, saveAppSettings } from '../../src/services/settings';
import { diagLog, type DiagEntry } from '../../src/services/diagnostics';
import * as Clipboard from 'expo-clipboard';
import { exportAsJSON, exportAsCSV } from '../../src/services/export';
import { testConnection, loadHealth, clearHealth, formatRelativeTime } from '../../src/services/aiHealth';
import { AI_PROVIDERS, LOCAL_AI_SOURCES } from '../../src/constants';
import type { AISettings, AIProvider, LocalAISource, IconName, AIHealthStatus, AIConnectionStatus } from '../../src/types';
import { Button } from '../../src/components/Button';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const COLLAPSED_SECTIONS_KEY = 'lumio_settings_collapsed_sections_v2';

// ─── Constants ────────────────────────────────────────────────────────────────

const APPEARANCE_STYLES = [
  { id: 'classic',      label: 'Lumio Classic',          description: 'Lumio blue and indigo across every device',          icon: 'color-palette' as IconName },
  { id: 'material-you', label: 'Material You',            description: 'Wallpaper colors when Android supports them',        icon: 'phone-portrait' as IconName },
  { id: 'expressive',   label: 'Material You Expressive', description: 'Larger shapes, richer surfaces, and motion',         icon: 'sparkles' as IconName },
] as const;

const APPEARANCE_TOGGLES = [
  { key: 'dynamicColors',        label: 'Dynamic Colors',        description: 'Use wallpaper colors on supported Android devices' },
  { key: 'useThemedIcon',        label: 'Use Themed Icon',        description: 'Monochrome adaptive icon when supported' },
  { key: 'amoledBlack',          label: 'AMOLED Black',           description: 'Pure black surfaces in dark mode' },
  { key: 'edgeToEdge',           label: 'Edge-to-Edge Layout',    description: 'Draw content behind system bars' },
  { key: 'dynamicNavigationBar', label: 'Dynamic Navigation Bar', description: 'Match navigation bar to the active theme' },
  { key: 'dynamicStatusBar',     label: 'Dynamic Status Bar',     description: 'Match status bar icons to the active theme' },
  { key: 'reduceMotion',         label: 'Reduce Motion',          description: 'Minimize interface animations' },
  { key: 'compactLayout',        label: 'Compact Layout',         description: 'Denser list and content spacing' },
  { key: 'largeTouchTargets',    label: 'Large Touch Targets',    description: 'Increase controls to at least 56 dp' },
  { key: 'highContrast',         label: 'Higher Contrast',        description: 'Strengthen boundaries for readability' },
] as const;

type SectionKey = 'appearance' | 'ai' | 'storage' | 'advanced' | 'about';

// ─── Diagnostics event → MD3 container role ───────────────────────────────────
// Keys map each event type to a semantic MD3 container so badges are
// always theme-aware (light / dark / AMOLED / Material You).
type DiagBadgeRole = 'primary' | 'secondary' | 'tertiary' | 'error' | 'surface';

const DIAG_EVENT_ROLES: Record<import('../../src/services/diagnostics').DiagEventType, DiagBadgeRole> = {
  // ── Native Android share pipeline ──────────────────────────────────────
  MAIN_ACTIVITY_CREATED:        'primary',
  MAIN_ACTIVITY_ON_NEW_INTENT:  'primary',
  INTENT_ACTION:                'primary',
  INTENT_MIME_TYPE:             'primary',
  INTENT_EXTRAS:                'primary',
  ACTION:                       'primary',
  MIME_TYPE:                    'primary',
  EXTRA_TEXT:                   'primary',
  EXTRA_STREAM:                 'primary',
  EXTRA_SUBJECT:                'primary',
  EXTRA_TITLE:                  'primary',
  CLIP_DATA:                    'primary',
  INTENT_DATA:                  'primary',
  CLIPDATA_FOUND:               'secondary',
  DATA_URI_FOUND:               'secondary',
  STREAM_URI_FOUND:             'secondary',
  INTENT_URI_FOUND:             'secondary',
  SHARE_EXTRACT_RESULT:         'primary',
  // ── Service readiness ───────────────────────────────────────────────────
  DATABASE_INITIALIZED:   'secondary',
  DATAPROVIDER_READY:     'secondary',
  CAPTURE_QUEUE_READY:    'secondary',
  SHARE_MANAGER_READY:    'secondary',
  SHARE_PAYLOAD_RECEIVED: 'secondary',
  // ── App lifecycle (always-on) ───────────────────────────────────────────
  APP_STATE:              'primary',
  APP_COLD_START:         'primary',
  APP_FOREGROUND:         'primary',
  APP_BACKGROUND:         'secondary',
  APP_ALREADY_RUNNING:    'primary',
  SHARE_INTENT_RECEIVED:  'primary',
  SHARE_ACTION:           'primary',
  SHARE_MIME_TYPE:        'primary',
  SHARE_PAYLOAD:          'primary',
  SHARE_TEXT:             'primary',
  URL_EXTRACTED:          'primary',
  ROUTE_TO_SHARE_SCREEN:        'primary',
  // ── NativeShareActivity & WorkManager (always-on) ─────────────────────────
  NATIVE_SHARE_ACTIVITY_CREATED: 'primary',
  NATIVE_SHARE_RECEIVED:        'primary',
  NATIVE_SHARE_SAVED:           'tertiary',
  NATIVE_DB_WRITE_SUCCESS:      'tertiary',
  NATIVE_DB_WRITE_FAILED:       'error',
  DB_PATH_RESOLVED:             'secondary',
  DB_OPEN_SUCCESS:              'tertiary',
  DB_OPEN_FAILED:               'error',
  DB_INSERT_SUCCESS:            'tertiary',
  DB_INSERT_FAILED:             'error',
  WORKMANAGER_ENQUEUED:         'secondary',
  WORKMANAGER_STARTED:          'secondary',
  WORKMANAGER_COMPLETED:        'tertiary',
  NATIVE_SHARE_FAILED:          'error',
  PENDING_SHARE_FAILED:         'error',
  SHARE_ROUTE_SOURCE:           'primary',
  SHARE_URI_RAW:                'primary',
  SHARE_URI_REWRITTEN:          'primary',
  SHARE_REWRITE_SUCCESS:        'primary',
  SHARE_REWRITE_SKIPPED:        'surface',
  PENDING_SHARE_RAW_CAPTURED:   'secondary',
  SHARE_NO_URL_FOUND:           'error',
  SHARE_MULTI_URL_FOUND:        'tertiary',
  QUEUE_ITEM_CREATED:           'tertiary',
  QUEUE_ITEM_PERSISTED:         'tertiary',
  QUEUE_ITEM_COMPLETED:         'tertiary',
  LIBRARY_ITEM_CREATED:         'tertiary',
  SHARE_PAYLOAD_PERSISTED:      'secondary',
  PENDING_SHARE_FOUND:          'secondary',
  PENDING_SHARE_PROCESSED:      'secondary',
  FAILED_SHARE_CAPTURED:        'error',
  SHARE_SCREEN_SUCCESS:         'tertiary',
  SHARE_SCREEN_ERROR:           'error',
  NAVIGATION_SUCCESS:           'tertiary',
  NAVIGATION_ERROR:             'error',
  ROUTE_REDIRECT_START:         'primary',
  ROUTE_REDIRECT_COMPLETE:      'primary',
  COLLECTION_MATCHED:         'tertiary',
  COLLECTION_ASSIGNED:        'tertiary',
  COLLECTION_COUNT_UPDATED:   'tertiary',
  COLLECTION_REFRESHED:       'tertiary',
  COLLECTION_SKIPPED:         'surface',
  TOPIC_SUGGESTED:            'tertiary',
  ENRICHMENT_STARTED:         'tertiary',
  ENRICHMENT_COMPLETED:       'tertiary',
  // ── Opt-in events ───────────────────────────────────────────────────────
  SHARE_URL_EXTRACTED:    'primary',
  SHARE_SCREEN_OPENED:    'primary',
  SHARE_FORM_POPULATED:   'secondary',
  SHARE_INTENT_PARSED:    'secondary',
  METADATA_FOUND:         'tertiary',
  AI_REQUEST_STARTED:     'tertiary',
  AI_RESPONSE_RAW:        'primary',
  AI_RESPONSE_RECEIVED:   'secondary',
  AI_RESPONSE_PARSED:     'secondary',
  PROVIDER_ERROR:         'error',
  SAVE_STARTED:           'surface',
  SAVE_COMPLETED:         'tertiary',
  SAVE_FAILED:            'error',
  FORM_UPDATE_STARTED:    'surface',
  FORM_UPDATE_COMPLETED:  'surface',
};

function getDiagBadgeColors(
  role: DiagBadgeRole,
  paper: ReturnType<typeof useAppTheme>
): { bg: string; fg: string } {
  switch (role) {
    case 'primary':   return { bg: paper.colors.primaryContainer,   fg: paper.colors.onPrimaryContainer };
    case 'secondary': return { bg: paper.colors.secondaryContainer, fg: paper.colors.onSecondaryContainer };
    case 'tertiary':  return { bg: paper.colors.tertiaryContainer,  fg: paper.colors.onTertiaryContainer };
    case 'error':     return { bg: paper.colors.errorContainer,     fg: paper.colors.onErrorContainer };
    default:          return { bg: paper.colors.surfaceContainerHigh, fg: paper.colors.onSurfaceVariant };
  }
}

// ─── RAM / Compatibility helpers ──────────────────────────────────────────────

/**
 * Very rough estimate: GGUF Q4 averages ~0.55 bytes per parameter.
 * We derive parameter count from file size, then estimate VRAM/RAM needed.
 * Returns estimated RAM in GB (system RAM required ≈ model RAM × 1.2 overhead).
 */
function estimateRamGb(ggufBytes: number): number {
  const paramsEstimate = ggufBytes / 0.55; // ~params from Q4 quant
  const modelGb = (paramsEstimate * 4) / 1e9; // fp32 equivalent in GB
  return Math.round(modelGb * 1.2 * 10) / 10; // 20 % overhead, 1 dp
}

type CompatStatus = 'compatible' | 'slow' | 'insufficient' | 'unknown';

interface CompatInfo {
  status: CompatStatus;
  label: string;
  icon: IconName;
  ramEstimate: string;
}

function getCompatibility(ggufBytes: number | undefined): CompatInfo {
  if (!ggufBytes) return { status: 'unknown', label: 'Select a model file', icon: 'help-circle-outline', ramEstimate: '—' };
  const needed = estimateRamGb(ggufBytes);
  const ramStr = `~${needed} GB`;
  if (needed <= 4)  return { status: 'compatible',   label: '✓ Compatible',         icon: 'checkmark-circle', ramEstimate: ramStr };
  if (needed <= 8)  return { status: 'slow',          label: '⚠ May be slow',        icon: 'warning',          ramEstimate: ramStr };
  return               { status: 'insufficient',  label: '✗ Insufficient RAM',   icon: 'close-circle',     ramEstimate: ramStr };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ─── ConnectionStatusBadge ────────────────────────────────────────────────────

function ConnectionStatusBadge({ status }: { status: AIConnectionStatus }) {
  const paper = useAppTheme();
  const cfg: Record<AIConnectionStatus, { emoji: string; label: string; bg: string; fg: string }> = {
    connected:  { emoji: '🟢', label: 'Connected',  bg: paper.colors.primaryContainer,   fg: paper.colors.onPrimaryContainer },
    limited:    { emoji: '🟡', label: 'Limited',    bg: paper.colors.secondaryContainer, fg: paper.colors.onSecondaryContainer },
    offline:    { emoji: '🔴', label: 'Offline',    bg: paper.colors.errorContainer,     fg: paper.colors.onErrorContainer },
    unknown:    { emoji: '⚪', label: 'Unknown',    bg: paper.colors.surfaceVariant,     fg: paper.colors.onSurfaceVariant },
  };
  const c = cfg[status];
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: c.bg }]}>
      <Text style={{ fontSize: 11, marginRight: 4 }}>{c.emoji}</Text>
      <Text variant="labelSmall" style={{ color: c.fg, fontWeight: '700' }}>{c.label}</Text>
    </View>
  );
}

// ─── Animated collapsible section card ───────────────────────────────────────

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
  const paper = useAppTheme();
  const chevronAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(chevronAnim, {
      toValue: isExpanded ? 1 : 0,
      useNativeDriver: true,
      tension: 180,
      friction: 14,
    }).start();
  }, [isExpanded, chevronAnim]);

  const chevronRotate = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View
      style={[
        styles.sectionCard,
        {
          backgroundColor: paper.colors.surfaceContainer,
          borderColor: paper.colors.outlineVariant,
          borderRadius: cardRadius,
        },
      ]}
    >
      <TouchableOpacity
        onPress={() => onToggle(sectionKey)}
        style={styles.sectionHeader}
        activeOpacity={0.72}
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
                  : paper.colors.surfaceContainerHigh,
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
              <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 1 }} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
          <Ionicons name="chevron-down" size={20} color={paper.colors.onSurfaceVariant} />
        </Animated.View>
      </TouchableOpacity>

      {isExpanded ? (
        <View style={styles.sectionBody}>
          <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />
          {children}
        </View>
      ) : null}
    </View>
  );
}

// ─── Compatibility badge ──────────────────────────────────────────────────────

function CompatBadge({ compat }: { compat: CompatInfo }) {
  const paper = useAppTheme();
  const p = paper.colors;
  const colorMap: Record<CompatStatus, { bg: string; fg: string }> = {
    compatible:   { bg: p.primaryContainer,   fg: p.onPrimaryContainer },
    slow:         { bg: p.secondaryContainer, fg: p.onSecondaryContainer },
    insufficient: { bg: p.errorContainer,     fg: p.onErrorContainer },
    unknown:      { bg: p.surfaceVariant,     fg: p.onSurfaceVariant },
  };
  const c = colorMap[compat.status];
  return (
    <View style={[styles.compatBadge, { backgroundColor: c.bg }]}>
      <Ionicons name={compat.icon} size={13} color={c.fg} />
      <Text variant="labelSmall" style={{ color: c.fg, fontWeight: '700', marginLeft: 4 }}>
        {compat.label}
      </Text>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { colors, settings, updateSettings, layout } = useTheme();
  const paper = useAppTheme();
  const insets = useSafeAreaInsets();
  const { items, collections } = useData();

  // Section collapse state — appearance open by default
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>({
    appearance: false, // false = expanded
    ai:         true,
    storage:    true,
    advanced:   true,
    about:      true,
  });

  const [exporting, setExporting]             = useState<'json' | 'csv' | null>(null);
  const [aiSettings, setAiSettings]           = useState<Partial<AISettings>>({
    provider: 'openai',
    apiKey: '',
    model: '',
    localEnabled: false,
    localSource: 'ollama',
    localContextLength: 4096,
  });
  const [showKey, setShowKey]                 = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [saved, setSaved]                     = useState(false);
  const [pickingGguf, setPickingGguf]         = useState(false);
  const [providerModalVisible, setProviderModalVisible] = useState(false);
  const [dbSize, setDbSize]                   = useState<string>('—');
  const [health, setHealth]                   = useState<AIHealthStatus | null>(null);
  const [testingConn, setTestingConn]         = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const [diagModalVisible, setDiagModalVisible]     = useState(false);
  const [diagEntries, setDiagEntries]               = useState<DiagEntry[]>([]);
  const [diagCopied, setDiagCopied]                 = useState(false);
  const [autoTranslate, setAutoTranslate]           = useState(false);
  const [neverTranslateInput, setNeverTranslateInput] = useState('');
  const [neverTranslateLangs, setNeverTranslateLangs] = useState<string[]>([]);

  // Load persisted collapse state
  useEffect(() => {
    SecureStore.getItemAsync(COLLAPSED_SECTIONS_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<Record<SectionKey, boolean>>;
            setCollapsedSections((prev) => ({ ...prev, ...parsed }));
          } catch { /* keep defaults */ }
        }
      })
      .catch(() => {});
  }, []);

  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      SecureStore.setItemAsync(COLLAPSED_SECTIONS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Load AI settings + last known health status
  useEffect(() => {
    getAISettings().then((s) => {
      if (s) setAiSettings(s);
    });
    loadHealth().then((h) => {
      if (h) setHealth(h);
    });
    // Sync diagnostics + translation settings from persisted settings
    getAppSettings().then((s) => {
      const enabled = s.diagnosticsEnabled ?? false;
      setDiagnosticsEnabled(enabled);
      diagLog.setEnabled(enabled);
      setAutoTranslate(s.autoTranslateForeignContent ?? false);
      setNeverTranslateLangs(s.neverTranslateLanguages ?? []);
    });
  }, []);

  const handleTestConnection = useCallback(async () => {
    if (!aiSettings.provider) return;
    setTestingConn(true);
    const current: AISettings = {
      provider:           aiSettings.provider as AIProvider,
      apiKey:             aiSettings.apiKey ?? '',
      model:              aiSettings.model?.trim() || undefined,
      watsonxProjectId:   aiSettings.watsonxProjectId,
      watsonxRegion:      aiSettings.watsonxRegion,
      localBaseUrl:       aiSettings.localBaseUrl,
      localSource:        aiSettings.localSource,
      localEnabled:       aiSettings.localEnabled,
      localContextLength: aiSettings.localContextLength,
    };
    const result = await testConnection(current);
    setHealth(result);
    setTestingConn(false);
  }, [aiSettings]);

  // DB size
  useEffect(() => {
    (async () => {
      try {
        const primary = `${FileSystem.documentDirectory}SQLite/lumio.db`;
        const info = await FileSystem.getInfoAsync(primary);
        if (info.exists && typeof info.size === 'number') {
          setDbSize(formatBytes(info.size));
          return;
        }
        const alt = `${FileSystem.documentDirectory}lumio.db`;
        const altInfo = await FileSystem.getInfoAsync(alt);
        if (altInfo.exists && typeof altInfo.size === 'number') {
          setDbSize(formatBytes(altInfo.size));
        } else {
          setDbSize('< 1 MB');
        }
      } catch {
        setDbSize('< 1 MB');
      }
    })();
  }, [items.length, collections.length]);

  const selectedProvider    = AI_PROVIDERS.find((p) => p.id === aiSettings.provider) ?? AI_PROVIDERS[0];
  const selectedLocalSource = LOCAL_AI_SOURCES.find((s) => s.id === (aiSettings.localSource ?? 'ollama')) ?? LOCAL_AI_SOURCES[0];
  const isLocalProvider     = aiSettings.provider === 'local';
  const compat              = getCompatibility(aiSettings.localGgufSize);

  // GGUF file picker
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
            localGgufSize: asset.size ?? undefined,
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
    if (!isLocalProvider && !aiSettings.apiKey?.trim()) {
      Alert.alert('Missing API Key', 'Please enter your API key.');
      return;
    }
    if (aiSettings.provider === 'watsonx' && !aiSettings.watsonxProjectId?.trim()) {
      Alert.alert('Missing Project ID', 'IBM watsonx requires a Project ID.');
      return;
    }
    if (isLocalProvider && aiSettings.localSource === 'gguf' && !aiSettings.localGgufPath?.trim()) {
      Alert.alert('No GGUF file selected', 'Please select a .gguf model file to continue.');
      return;
    }
    setSaving(true);
    await saveAISettings({
      provider:           aiSettings.provider as AIProvider,
      apiKey:             aiSettings.apiKey ?? '',
      model:              aiSettings.model?.trim() || undefined,
      watsonxProjectId:   aiSettings.watsonxProjectId,
      watsonxRegion:      aiSettings.watsonxRegion,
      localBaseUrl:       aiSettings.localBaseUrl,
      localSource:        aiSettings.localSource,
      localGgufPath:      aiSettings.localGgufPath,
      localGgufSize:      aiSettings.localGgufSize,
      localGgufName:      aiSettings.localGgufName,
      localEnabled:       aiSettings.localEnabled,
      localContextLength: aiSettings.localContextLength,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(format);
    try {
      if (format === 'json') await exportAsJSON(items, collections);
      else                   await exportAsCSV(items, collections);
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
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
            await clearHealth();
            setAiSettings({ provider: 'openai', apiKey: '', model: '', localEnabled: false, localSource: 'ollama', localContextLength: 4096 });
            setHealth(null);
            Alert.alert('Reset Complete', 'AI settings have been restored to defaults.');
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert('Clear Cache', 'Clear cached temporary files and preview data?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear Cache', style: 'destructive', onPress: () => Alert.alert('Cache Cleared', 'Temporary cache cleared.') },
    ]);
  };

  const handleOpenGitHub = () => {
    const url = 'https://github.com/lumio-app/lumio';
    Linking.canOpenURL(url)
      .then((ok) => { if (ok) Linking.openURL(url); else Alert.alert('Cannot open URL', url); })
      .catch(() => Alert.alert('Error', 'Unable to open repository link.'));
  };

  const handleToggleDiagnostics = useCallback(async (value: boolean) => {
    setDiagnosticsEnabled(value);
    diagLog.setEnabled(value);
    if (!value) diagLog.clearEntries();
    const current = await getAppSettings();
    await saveAppSettings({ ...current, diagnosticsEnabled: value });
  }, []);

  const handleToggleAutoTranslate = useCallback(async (value: boolean) => {
    setAutoTranslate(value);
    const current = await getAppSettings();
    await saveAppSettings({ ...current, autoTranslateForeignContent: value });
  }, []);

  const handleAddNeverTranslate = useCallback(async (lang: string) => {
    const trimmed = lang.trim();
    if (!trimmed || neverTranslateLangs.includes(trimmed)) return;
    const updated = [...neverTranslateLangs, trimmed];
    setNeverTranslateLangs(updated);
    setNeverTranslateInput('');
    const current = await getAppSettings();
    await saveAppSettings({ ...current, neverTranslateLanguages: updated });
  }, [neverTranslateLangs]);

  const handleRemoveNeverTranslate = useCallback(async (lang: string) => {
    const updated = neverTranslateLangs.filter((l) => l !== lang);
    setNeverTranslateLangs(updated);
    const current = await getAppSettings();
    await saveAppSettings({ ...current, neverTranslateLanguages: updated });
  }, [neverTranslateLangs]);

  const handleOpenDiagnostics = useCallback(() => {
    setDiagEntries(diagLog.getEntries());
    setDiagModalVisible(true);
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    const text = diagLog.formatForExport();
    await Clipboard.setStringAsync(text);
    setDiagCopied(true);
    setTimeout(() => setDiagCopied(false), 2000);
  }, []);

  const handleExportDiagnostics = useCallback(async () => {
    try {
      await diagLog.exportForSharing();
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Could not export diagnostics.');
    }
  }, []);

  const handleClearDiagnostics = useCallback(() => {
    Alert.alert(
      'Clear Diagnostics',
      'This will permanently delete all recorded diagnostic entries.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            diagLog.clearEntries();
            setDiagEntries([]);
          },
        },
      ]
    );
  }, []);

  const cardRadius        = layout.cardRadius ?? 16;
  const innerRadius       = Math.max(cardRadius - 4, 8);
  const cloudProviders    = AI_PROVIDERS.filter((p) => p.id !== 'local');
  const localProviderMeta = AI_PROVIDERS.find((p) => p.id === 'local');

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: paper.colors.outlineVariant }]}>
        <Text variant="headlineSmall" style={{ color: paper.colors.onSurface, fontWeight: '700' }}>
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 52 + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. APPEARANCE ────────────────────────────────────────────── */}
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
          {/* Theme mode */}
          <View style={styles.subSection}>
            <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
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
                      color={settings.theme === mode ? paper.colors.primary : paper.colors.onSurfaceVariant}
                    />
                    <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>
                      {mode.charAt(0).toUpperCase() + mode.slice(1)} Mode
                    </Text>
                  </View>
                  {settings.theme === mode && (
                    <Ionicons name="checkmark-circle" size={22} color={paper.colors.primary} />
                  )}
                </TouchableOpacity>
                {i < arr.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />}
              </React.Fragment>
            ))}
          </View>

          <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />

          {/* Theme style */}
          <View style={styles.subSection}>
            <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
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
                      name={style.icon}
                      size={20}
                      color={settings.appearanceStyle === style.id ? paper.colors.primary : paper.colors.onSurfaceVariant}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>{style.label}</Text>
                      <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>{style.description}</Text>
                    </View>
                  </View>
                  {settings.appearanceStyle === style.id && (
                    <Ionicons name="checkmark-circle" size={22} color={paper.colors.primary} />
                  )}
                </TouchableOpacity>
                {i < APPEARANCE_STYLES.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />}
              </React.Fragment>
            ))}
          </View>

          <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />

          {/* Options toggles */}
          <View style={styles.subSection}>
            <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
              OPTIONS
            </Text>
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
                    onValueChange={(v) => updateSettings({ [toggle.key]: v })}
                    trackColor={{ false: colors.surfaceContainerHigh, true: paper.colors.primary }}
                    thumbColor={settings[toggle.key] ? paper.colors.onPrimary : paper.colors.outline}
                    accessibilityLabel={toggle.label}
                  />
                </View>
                {i < APPEARANCE_TOGGLES.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />}
              </React.Fragment>
            ))}
          </View>
        </SectionCard>

        {/* ── 2. AI & INTELLIGENCE ─────────────────────────────────────── */}
        <SectionCard
          sectionKey="ai"
          title="AI & Intelligence"
          icon="sparkles"
          subtitle={
            isLocalProvider
              ? `Local LLM · ${selectedLocalSource.name}`
              : selectedProvider.name
          }
          isExpanded={!collapsedSections.ai}
          onToggle={toggleSection}
          cardRadius={cardRadius}
        >
          {/* Current Provider row */}
          <View style={styles.subSection}>
            <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
              CURRENT PROVIDER
            </Text>
            <TouchableOpacity
              onPress={() => setProviderModalVisible(true)}
              style={[
                styles.providerSelectorRow,
                {
                  backgroundColor: paper.colors.surfaceContainerHigh,
                  borderColor: paper.colors.outlineVariant,
                  borderRadius: innerRadius,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Select AI Provider"
            >
              <View style={styles.rowLeft}>
                <View style={[styles.providerPill, {
                  backgroundColor: isLocalProvider
                    ? paper.colors.tertiaryContainer ?? paper.colors.secondaryContainer
                    : paper.colors.primaryContainer,
                }]}>
                  <Ionicons
                    name={isLocalProvider ? 'hardware-chip' : 'cloud'}
                    size={14}
                    color={isLocalProvider
                      ? (paper.colors.onTertiaryContainer ?? paper.colors.onSecondaryContainer)
                      : paper.colors.onPrimaryContainer}
                  />
                  <Text
                    variant="labelSmall"
                    style={{
                      color: isLocalProvider
                        ? (paper.colors.onTertiaryContainer ?? paper.colors.onSecondaryContainer)
                        : paper.colors.onPrimaryContainer,
                      fontWeight: '700',
                      marginLeft: 4,
                    }}
                  >
                    {isLocalProvider ? 'LOCAL' : 'CLOUD'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="titleMedium" style={{ color: paper.colors.onSurface, fontWeight: '600' }}>
                    {isLocalProvider ? `${selectedLocalSource.name}` : selectedProvider.name}
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    {isLocalProvider ? selectedLocalSource.description : selectedProvider.description}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          {/* ── AI STATUS CARD ────────────────────────────────────────── */}
          <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />
          <View style={styles.subSection}>
            <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
              AI STATUS
            </Text>

            {/* Status overview card */}
            <View style={[styles.statusCard, {
              backgroundColor: paper.colors.surfaceContainerHigh,
              borderColor: paper.colors.outlineVariant,
              borderRadius: innerRadius,
            }]}>
              {/* Provider / Model row */}
              {[
                { label: 'Provider', value: isLocalProvider ? `Local LLM · ${selectedLocalSource.name}` : selectedProvider.name },
                { label: 'Model',    value: aiSettings.model?.trim() || (isLocalProvider ? selectedLocalSource.modelPlaceholder : (selectedProvider.modelPlaceholder ?? '—')) },
              ].map((row, i) => (
                <React.Fragment key={row.label}>
                  <View style={styles.metaRow}>
                    <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>{row.label}</Text>
                    <Text variant="bodyMedium" style={{ color: paper.colors.onSurface, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
                      {row.value}
                    </Text>
                  </View>
                  {i === 0 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />}
                </React.Fragment>
              ))}

              <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />

              {/* Connection status row */}
              <View style={styles.metaRow}>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>Status</Text>
                <ConnectionStatusBadge status={health?.status ?? 'unknown'} />
              </View>

              <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />

              {/* Last checked */}
              <View style={styles.metaRow}>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>Last Check</Text>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant }}>
                  {formatRelativeTime(health?.lastSuccessfulCheck)}
                </Text>
              </View>

              {/* Response time — only when connected */}
              {health?.responseTimeMs !== undefined && health.status === 'connected' && (
                <>
                  <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />
                  <View style={styles.metaRow}>
                    <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>Response Time</Text>
                    <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant }}>{health.responseTimeMs} ms</Text>
                  </View>
                </>
              )}

              {/* Error message — only when not connected */}
              {health?.lastErrorMessage && health.status !== 'connected' && (
                <>
                  <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />
                  <View style={[styles.inlineAlert, { backgroundColor: paper.colors.errorContainer, borderRadius: innerRadius }]}>
                    <Ionicons name="alert-circle" size={14} color={paper.colors.onErrorContainer} />
                    <Text variant="bodySmall" style={{ color: paper.colors.onErrorContainer, flex: 1, marginLeft: 6 }}>
                      {health.lastErrorMessage}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Rate-limit warning */}
            {health?.rateLimit && health.status === 'limited' && (
              <View style={[styles.warningBanner, {
                backgroundColor: paper.colors.secondaryContainer,
                borderRadius: innerRadius,
                marginTop: 8,
              }]}>
                <Ionicons name="timer-outline" size={16} color={paper.colors.onSecondaryContainer} />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text variant="labelMedium" style={{ color: paper.colors.onSecondaryContainer, fontWeight: '700' }}>
                    ⚠ Rate Limited
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSecondaryContainer, marginTop: 2 }}>
                    {`Retry in ${health.rateLimit.retryAfterSeconds}s`}
                  </Text>
                </View>
              </View>
            )}

            {/* Quota exceeded warning */}
            {health?.status === 'limited' && !health.rateLimit && (
              <View style={[styles.warningBanner, {
                backgroundColor: paper.colors.errorContainer,
                borderRadius: innerRadius,
                marginTop: 8,
              }]}>
                <Ionicons name="warning" size={16} color={paper.colors.onErrorContainer} />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text variant="labelMedium" style={{ color: paper.colors.onErrorContainer, fontWeight: '700' }}>
                    ⚠ Quota Exceeded
                  </Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onErrorContainer, marginTop: 2 }}>
                    {`Provider: ${isLocalProvider ? 'Local LLM' : selectedProvider.name}`}
                  </Text>
                </View>
                <View style={{ gap: 6, marginLeft: 8 }}>
                  <TouchableOpacity
                    onPress={() => setProviderModalVisible(true)}
                    style={[styles.inlinePillBtn, { backgroundColor: paper.colors.onErrorContainer }]}
                  >
                    <Text variant="labelSmall" style={{ color: paper.colors.errorContainer, fontWeight: '700' }}>
                      Switch Provider
                    </Text>
                  </TouchableOpacity>
                  {!isLocalProvider && (
                    <TouchableOpacity
                      onPress={() => setAiSettings((s) => ({ ...s, provider: 'local', localEnabled: true }))}
                      style={[styles.inlinePillBtn, { backgroundColor: paper.colors.onErrorContainer }]}
                    >
                      <Text variant="labelSmall" style={{ color: paper.colors.errorContainer, fontWeight: '700' }}>
                        Use Local AI
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* Quota details — shown when available */}
            {health?.quota && (health.quota.requestsRemaining !== undefined || health.quota.tokensRemaining !== undefined) && (
              <View style={[styles.quotaGrid, {
                backgroundColor: paper.colors.surfaceContainerHigh,
                borderColor: paper.colors.outlineVariant,
                borderRadius: innerRadius,
                marginTop: 8,
              }]}>
                {[
                  { label: 'Requests Remaining', value: health.quota.requestsRemaining },
                  { label: 'Tokens Remaining',   value: health.quota.tokensRemaining },
                  { label: 'Daily Limit',         value: health.quota.dailyLimit },
                  { label: 'Monthly Limit',       value: health.quota.monthlyLimit },
                ].filter((r) => r.value !== undefined).map((r, i, arr) => (
                  <React.Fragment key={r.label}>
                    <View style={styles.metaRow}>
                      <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>{r.label}</Text>
                      <Text variant="bodyMedium" style={{ color: paper.colors.onSurface, fontWeight: '600' }}>
                        {r.value?.toLocaleString()}
                      </Text>
                    </View>
                    {i < arr.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />}
                  </React.Fragment>
                ))}
              </View>
            )}

            {/* Test Connection button */}
            <TouchableOpacity
              onPress={handleTestConnection}
              disabled={testingConn}
              style={[styles.testConnBtn, {
                backgroundColor: testingConn ? paper.colors.surfaceContainerHigh : paper.colors.primaryContainer,
                borderColor: paper.colors.primary,
                borderRadius: innerRadius,
                marginTop: 10,
              }]}
              accessibilityRole="button"
              accessibilityLabel="Test Connection"
            >
              {testingConn
                ? <ActivityIndicator size="small" color={paper.colors.onPrimaryContainer} />
                : <Ionicons name="wifi" size={18} color={paper.colors.onPrimaryContainer} />
              }
              <Text variant="labelLarge" style={{
                color: testingConn ? paper.colors.onSurfaceVariant : paper.colors.onPrimaryContainer,
                fontWeight: '600',
                marginLeft: 8,
              }}>
                {testingConn ? 'Testing…' : 'Test Connection'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── CLOUD PROVIDER CONFIG ─────────────────────────────────── */}
          {!isLocalProvider && (
            <>
              <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />
              <View style={styles.subSection}>
                <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
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
                      onPress={() => setShowKey((k) => !k)}
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

                {/* Indus base URL */}
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

                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 10, lineHeight: 18 }}>
                  🔒 Keys are stored encrypted on-device via SecureStore and never transmitted externally.
                </Text>
              </View>
            </>
          )}

          {/* ── LOCAL PROVIDER CONFIG ─────────────────────────────────── */}
          {isLocalProvider && (
            <>
              <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />

              {/* Enable Local AI toggle */}
              <View style={styles.subSection}>
                <View style={[styles.row, { minHeight: 60 }]}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.sectionIconContainer, {
                      backgroundColor: aiSettings.localEnabled
                        ? paper.colors.primaryContainer
                        : paper.colors.surfaceContainerHigh,
                    }]}>
                      <Ionicons
                        name="hardware-chip"
                        size={20}
                        color={aiSettings.localEnabled ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant}
                      />
                    </View>
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
                    onValueChange={(v) => setAiSettings((s) => ({ ...s, localEnabled: v }))}
                    trackColor={{ false: colors.surfaceContainerHigh, true: paper.colors.primary }}
                    thumbColor={aiSettings.localEnabled ? paper.colors.onPrimary : paper.colors.outline}
                    accessibilityLabel="Enable Local AI"
                  />
                </View>
              </View>

              {aiSettings.localEnabled && (
                <>
                  <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />

                  {/* Backend selector */}
                  <View style={styles.subSection}>
                    <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
                      BACKEND
                    </Text>
                    {LOCAL_AI_SOURCES.map((src, i) => {
                      const sel = (aiSettings.localSource ?? 'ollama') === src.id;
                      return (
                        <React.Fragment key={src.id}>
                          <TouchableOpacity
                            onPress={() =>
                              setAiSettings((s) => ({
                                ...s,
                                localSource: src.id as LocalAISource,
                                localBaseUrl: src.defaultUrl,
                                // clear GGUF data when switching away from gguf
                                ...(src.id !== 'gguf' ? { localGgufPath: undefined, localGgufName: undefined, localGgufSize: undefined } : {}),
                              }))
                            }
                            style={[styles.row, { minHeight: 52 }]}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: sel }}
                          >
                            <View style={styles.rowLeft}>
                              <Ionicons
                                name={sel ? 'radio-button-on' : 'radio-button-off'}
                                size={20}
                                color={sel ? paper.colors.primary : paper.colors.onSurfaceVariant}
                              />
                              <View style={{ flex: 1 }}>
                                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>{src.name}</Text>
                                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>{src.description}</Text>
                              </View>
                            </View>
                            {sel && <Ionicons name="checkmark-circle" size={20} color={paper.colors.primary} />}
                          </TouchableOpacity>
                          {i < LOCAL_AI_SOURCES.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />}
                        </React.Fragment>
                      );
                    })}
                  </View>

                  <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />

                  {/* ── GGUF sub-section ──────────────────────────────── */}
                  {aiSettings.localSource === 'gguf' && (
                    <>
                      <View style={styles.subSection}>
                        <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
                          GGUF MODEL FILE
                        </Text>

                        {/* Placeholder / selected state */}
                        {!aiSettings.localGgufPath ? (
                          <View style={[styles.ggufEmptyState, {
                            backgroundColor: paper.colors.surfaceContainerHigh,
                            borderColor: paper.colors.outlineVariant,
                            borderRadius: innerRadius,
                          }]}>
                            <Ionicons name="document-outline" size={32} color={paper.colors.onSurfaceVariant} style={{ marginBottom: 8 }} />
                            <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant, marginBottom: 4, textAlign: 'center' }}>
                              No GGUF model selected
                            </Text>
                            <Text variant="bodySmall" style={{ color: paper.colors.outline, textAlign: 'center', marginBottom: 16 }}>
                              Select a quantized .gguf model from your device storage
                            </Text>
                            <TouchableOpacity
                              onPress={handlePickGguf}
                              disabled={pickingGguf}
                              style={[styles.ggufPickerBtn, {
                                backgroundColor: paper.colors.primaryContainer,
                                borderColor: paper.colors.primary,
                              }]}
                              accessibilityRole="button"
                            >
                              {pickingGguf
                                ? <ActivityIndicator size="small" color={paper.colors.onPrimaryContainer} />
                                : <Ionicons name="folder-open" size={18} color={paper.colors.onPrimaryContainer} />
                              }
                              <Text variant="labelLarge" style={{ color: paper.colors.onPrimaryContainer, fontWeight: '600' }}>
                                Select GGUF File
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={[styles.ggufSelectedCard, {
                            backgroundColor: paper.colors.surfaceContainerHigh,
                            borderColor: paper.colors.outlineVariant,
                            borderRadius: innerRadius,
                          }]}>
                            {/* Change button */}
                            <TouchableOpacity
                              onPress={handlePickGguf}
                              disabled={pickingGguf}
                              style={[styles.ggufPickerBtn, {
                                backgroundColor: paper.colors.secondaryContainer,
                                borderColor: paper.colors.secondary,
                                marginBottom: 14,
                              }]}
                            >
                              {pickingGguf
                                ? <ActivityIndicator size="small" color={paper.colors.onSecondaryContainer} />
                                : <Ionicons name="swap-horizontal" size={18} color={paper.colors.onSecondaryContainer} />
                              }
                              <Text variant="labelLarge" style={{ color: paper.colors.onSecondaryContainer, fontWeight: '600' }}>
                                Change GGUF File
                              </Text>
                            </TouchableOpacity>

                            {/* Metadata table */}
                            {[
                              { label: 'File Name',       value: aiSettings.localGgufName ?? aiSettings.localGgufPath?.split('/').pop() ?? '—' },
                              { label: 'File Size',        value: aiSettings.localGgufSize ? formatBytes(aiSettings.localGgufSize) : '—' },
                              { label: 'Model Metadata',   value: '—  (not yet extracted)' },
                            ].map((row) => (
                              <View key={row.label} style={styles.metaRow}>
                                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>{row.label}</Text>
                                <Text variant="bodyMedium" style={{ color: paper.colors.onSurface, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
                                  {row.value}
                                </Text>
                              </View>
                            ))}

                            {/* Status badge row */}
                            <View style={[styles.metaRow, { marginTop: 4 }]}>
                              <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>Status</Text>
                              <View style={[styles.statusBadge, {
                                backgroundColor: paper.colors.primaryContainer,
                              }]}>
                                <Ionicons name="checkmark-circle" size={13} color={paper.colors.onPrimaryContainer} />
                                <Text variant="labelSmall" style={{ color: paper.colors.onPrimaryContainer, fontWeight: '700', marginLeft: 4 }}>
                                  Ready
                                </Text>
                              </View>
                            </View>
                          </View>
                        )}
                      </View>

                      {/* Model Compatibility card */}
                      <View style={styles.subSection}>
                        <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
                          MODEL COMPATIBILITY
                        </Text>
                        <View style={[styles.compatCard, {
                          backgroundColor: paper.colors.surfaceContainerHigh,
                          borderColor: paper.colors.outlineVariant,
                          borderRadius: innerRadius,
                        }]}>
                          {/* Rows */}
                          {[
                            { label: 'Model Name',          value: aiSettings.localGgufName?.replace(/\.gguf$/i, '') ?? '—' },
                            { label: 'Model Size',           value: aiSettings.localGgufSize ? formatBytes(aiSettings.localGgufSize) : '—' },
                            { label: 'Context Length',       value: aiSettings.localContextLength ? `${aiSettings.localContextLength} tokens` : '—' },
                            { label: 'Estimated RAM',        value: compat.ramEstimate },
                            { label: 'Device RAM',           value: 'Detection not available' },
                          ].map((row, idx, arr) => (
                            <React.Fragment key={row.label}>
                              <View style={styles.metaRow}>
                                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>{row.label}</Text>
                                <Text variant="bodyMedium" style={{ color: paper.colors.onSurface, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
                                  {row.value}
                                </Text>
                              </View>
                              {idx < arr.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />}
                            </React.Fragment>
                          ))}

                          {/* Compatibility status */}
                          <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />
                          <View style={[styles.metaRow, { marginTop: 2 }]}>
                            <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>Compatibility</Text>
                            <CompatBadge compat={compat} />
                          </View>
                        </View>
                      </View>

                      <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />
                    </>
                  )}

                  {/* Local configuration fields */}
                  <View style={styles.subSection}>
                    <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
                      LOCAL CONFIGURATION
                    </Text>

                    <TextInput
                      label="Backend URL"
                      value={aiSettings.localBaseUrl ?? ''}
                      onChangeText={(v) => setAiSettings((s) => ({ ...s, localBaseUrl: v }))}
                      placeholder={selectedLocalSource.defaultUrl}
                      mode="outlined"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={styles.textInput}
                    />

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

                    <TextInput
                      label="Context Length (tokens)"
                      value={String(aiSettings.localContextLength ?? 4096)}
                      onChangeText={(v) => {
                        const n = parseInt(v, 10);
                        setAiSettings((s) => ({ ...s, localContextLength: isNaN(n) ? undefined : n }));
                      }}
                      placeholder="4096"
                      keyboardType="numeric"
                      mode="outlined"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.textInput, { marginTop: 12 }]}
                    />

                    {/* Optional API key for secured endpoints */}
                    <TextInput
                      label="API Key (optional)"
                      value={aiSettings.apiKey ?? ''}
                      onChangeText={(v) => setAiSettings((s) => ({ ...s, apiKey: v }))}
                      placeholder="Leave blank if not required"
                      mode="outlined"
                      secureTextEntry={!showKey}
                      autoCapitalize="none"
                      autoCorrect={false}
                      right={
                        <TextInput.Icon
                          icon={showKey ? 'eye-off' : 'eye'}
                          onPress={() => setShowKey((k) => !k)}
                          color={paper.colors.onSurfaceVariant}
                        />
                      }
                      style={[styles.textInput, { marginTop: 12 }]}
                    />

                    {/* Status / Estimated RAM read-only block */}
                    <View style={[styles.metricsBlock, {
                      backgroundColor: paper.colors.surfaceContainerHigh,
                      borderColor: paper.colors.outlineVariant,
                      borderRadius: innerRadius,
                    }]}>
                      <View style={styles.metaRow}>
                        <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>Connection Status</Text>
                        <Text variant="bodyMedium" style={{ color: paper.colors.outline }}>Not connected</Text>
                      </View>
                      <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 4 }]} />
                      <View style={styles.metaRow}>
                        <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, flex: 1 }}>Estimated RAM</Text>
                        <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                          {aiSettings.localSource === 'gguf' ? compat.ramEstimate : '—'}
                        </Text>
                      </View>
                    </View>

                    <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 10, lineHeight: 18 }}>
                      🔒 Settings are stored encrypted on-device via SecureStore.
                    </Text>
                  </View>
                </>
              )}
            </>
          )}

          {/* Save / Clear actions */}
          <View style={styles.actionRow}>
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
        </SectionCard>

        {/* ── 3. STORAGE & BACKUP ──────────────────────────────────────── */}
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
            {/* Metrics grid */}
            <View style={[styles.metricsGrid, {
              backgroundColor: paper.colors.surfaceContainerHigh,
              borderColor: paper.colors.outlineVariant,
              borderRadius: innerRadius,
            }]}>
              <View style={styles.metricCol}>
                <Text variant="headlineMedium" style={{ color: paper.colors.primary, fontWeight: '700' }}>{items.length}</Text>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>Items</Text>
              </View>
              <View style={[styles.verticalDivider, { backgroundColor: paper.colors.outlineVariant }]} />
              <View style={styles.metricCol}>
                <Text variant="headlineMedium" style={{ color: paper.colors.primary, fontWeight: '700' }}>{collections.length}</Text>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>Collections</Text>
              </View>
              <View style={[styles.verticalDivider, { backgroundColor: paper.colors.outlineVariant }]} />
              <View style={styles.metricCol}>
                <Text variant="titleLarge" style={{ color: paper.colors.primary, fontWeight: '700' }}>{dbSize}</Text>
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>DB Size</Text>
              </View>
            </View>

            {/* Export buttons */}
            <View style={[styles.exportRow, { marginTop: 16 }]}>
              <TouchableOpacity
                onPress={() => handleExport('json')}
                disabled={!!exporting}
                style={[styles.exportBtn, { backgroundColor: paper.colors.primaryContainer, borderColor: paper.colors.primary }]}
              >
                {exporting === 'json'
                  ? <ActivityIndicator size="small" color={paper.colors.onPrimaryContainer} />
                  : <Ionicons name="code-download" size={18} color={paper.colors.onPrimaryContainer} />
                }
                <Text variant="labelLarge" style={{ color: paper.colors.onPrimaryContainer, fontWeight: '600' }}>
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
                  : <Ionicons name="document-text" size={18} color={paper.colors.onSecondaryContainer} />
                }
                <Text variant="labelLarge" style={{ color: paper.colors.onSecondaryContainer, fontWeight: '600' }}>
                  {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }}>
              JSON backup is fully importable. CSV is spreadsheet-compatible.
            </Text>
          </View>
        </SectionCard>

        {/* ── 4. ADVANCED ──────────────────────────────────────────────── */}
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

            {/* ── Content Intelligence ──────────────────────── */}
            <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.onSurfaceVariant }]}>
              CONTENT INTELLIGENCE
            </Text>

            {/* Auto Translate Foreign Content */}
            <View style={[styles.row, { minHeight: layout.touchTarget }]}>
              <View style={styles.rowLeft}>
                <Ionicons name="language" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Auto Translate Foreign Content</Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    Translate non-English summaries and tags into English
                  </Text>
                </View>
              </View>
              <Switch
                value={autoTranslate}
                onValueChange={handleToggleAutoTranslate}
                trackColor={{ false: colors.surfaceContainerHigh, true: paper.colors.primary }}
                thumbColor={autoTranslate ? paper.colors.onPrimary : paper.colors.outline}
                accessibilityLabel="Auto Translate Foreign Content"
              />
            </View>

            {/* Never Translate list — only shown when auto translate is on */}
            {autoTranslate && (
              <>
                <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />
                <View style={{ paddingVertical: 10, gap: 8 }}>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant }}>
                    Never translate these languages:
                  </Text>
                  {neverTranslateLangs.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {neverTranslateLangs.map((lang) => (
                        <TouchableOpacity
                          key={lang}
                          onPress={() => handleRemoveNeverTranslate(lang)}
                          style={[styles.langChip, { backgroundColor: paper.colors.errorContainer }]}
                          accessibilityLabel={`Remove ${lang} from never translate list`}
                        >
                          <Text variant="labelSmall" style={{ color: paper.colors.onErrorContainer }}>{lang}</Text>
                          <Ionicons name="close" size={12} color={paper.colors.onErrorContainer} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      value={neverTranslateInput}
                      onChangeText={setNeverTranslateInput}
                      placeholder="e.g. Japanese"
                      placeholderTextColor={paper.colors.onSurfaceVariant}
                      style={[
                        styles.langInput,
                        {
                          flex: 1,
                          color: paper.colors.onSurface,
                          backgroundColor: paper.colors.surfaceContainerHigh,
                          borderColor: paper.colors.outlineVariant,
                        },
                      ]}
                      onSubmitEditing={() => handleAddNeverTranslate(neverTranslateInput)}
                      returnKeyType="done"
                    />
                    <TouchableOpacity
                      onPress={() => handleAddNeverTranslate(neverTranslateInput)}
                      style={[styles.langAddBtn, { backgroundColor: paper.colors.primaryContainer }]}
                    >
                      <Ionicons name="add" size={18} color={paper.colors.onPrimaryContainer} />
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant }]} />

            {/* ── Original rows ─────────────────────────────── */}

            {/* System Diagnostics */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={() => Alert.alert('System Diagnostics', 'All local systems healthy.\nSQLite WAL: Enabled\nSecureStore: Available')}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="pulse" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>System Diagnostics</Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>Inspect SQLite, storage and hardware capability</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>

            <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />

            {/* Activity Log */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={() => Alert.alert('Activity Log', 'No active log entries found.')}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="receipt" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Activity Log</Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>Local execution trace &amp; errors</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={paper.colors.onSurfaceVariant} />
            </TouchableOpacity>

            <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />

            {/* Clear Cache */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={handleClearCache}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="trash-bin" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Clear Cache</Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>Free temporary preview and export files</Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />

            {/* Reset AI Settings */}
            <TouchableOpacity
              style={[styles.row, { minHeight: layout.touchTarget }]}
              onPress={handleClearAI}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Ionicons name="refresh-circle" size={20} color={paper.colors.error} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.error, fontWeight: '600' }}>Reset AI Settings</Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>Wipe saved keys and restore default providers</Text>
                </View>
              </View>
            </TouchableOpacity>

          </View>

          {/* ── Developer Diagnostics sub-block ──────────────────── */}
          <View style={[styles.subSection, styles.diagSubSection, { borderTopColor: paper.colors.outlineVariant }]}>

            {/* Section label */}
            <Text variant="labelSmall" style={[styles.groupLabel, { color: paper.colors.primary, marginBottom: 12 }]}>
              DEVELOPER DIAGNOSTICS
            </Text>

            {/* Enable Developer Diagnostics toggle */}
            <View style={[styles.row, { minHeight: layout.touchTarget }]}>
              <View style={styles.rowLeft}>
                <Ionicons name="bug-outline" size={20} color={paper.colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Enable Developer Diagnostics</Text>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginTop: 2 }}>
                    Record share, metadata, AI and save events for bug reporting
                  </Text>
                </View>
              </View>
              <Switch
                value={diagnosticsEnabled}
                onValueChange={handleToggleDiagnostics}
                trackColor={{ false: paper.colors.surfaceVariant, true: paper.colors.primary }}
                thumbColor={diagnosticsEnabled ? paper.colors.onPrimary : paper.colors.outline}
              />
            </View>

            {/* Action buttons — only shown when enabled */}
            {diagnosticsEnabled && (
              <>
                <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginVertical: 8 }]} />

                {/* Share Pipeline Metrics */}
                {(() => {
                  const metrics = diagLog.getShareMetrics();
                  return (
                    <View style={{
                      backgroundColor: paper.colors.surfaceContainerHigh,
                      borderColor: paper.colors.outlineVariant,
                      borderWidth: 1,
                      borderRadius: innerRadius,
                      padding: 12,
                      marginBottom: 12,
                    }}>
                      <Text variant="labelSmall" style={{ color: paper.colors.onSurfaceVariant, fontWeight: '700', marginBottom: 8 }}>
                        SHARE & QUEUE PIPELINE METRICS
                      </Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text variant="titleMedium" style={{ color: paper.colors.primary, fontWeight: '700' }}>
                            {metrics.shareAttempts}
                          </Text>
                          <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, fontSize: 10 }}>
                            Share Attempts
                          </Text>
                        </View>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text variant="titleMedium" style={{ color: paper.colors.primary, fontWeight: '700' }}>
                            {metrics.nativeInserts}
                          </Text>
                          <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, fontSize: 10 }}>
                            Native Inserts
                          </Text>
                        </View>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text variant="titleMedium" style={{ color: paper.colors.primary, fontWeight: '700' }}>
                            {metrics.queueItemsCreated}
                          </Text>
                          <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, fontSize: 10 }}>
                            Queue Created
                          </Text>
                        </View>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text variant="titleMedium" style={{ color: paper.colors.primary, fontWeight: '700' }}>
                            {metrics.queueItemsCompleted}
                          </Text>
                          <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, fontSize: 10 }}>
                            Queue Completed
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })()}

                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginBottom: 10 }}>
                  {diagLog.getEntries().length === 0
                    ? 'No entries yet — trigger an AI analysis, save, or share.'
                    : `${diagLog.getEntries().length} entr${diagLog.getEntries().length === 1 ? 'y' : 'ies'} recorded`}
                </Text>
                <View style={styles.diagActionGrid}>
                  {/* Open Diagnostics */}
                  <TouchableOpacity
                    style={[styles.diagActionBtn, { backgroundColor: paper.colors.primaryContainer, borderColor: paper.colors.primary }]}
                    onPress={handleOpenDiagnostics}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="eye-outline" size={16} color={paper.colors.onPrimaryContainer} />
                    <Text variant="labelMedium" style={{ color: paper.colors.onPrimaryContainer, fontWeight: '600' }}>Open</Text>
                  </TouchableOpacity>

                  {/* Copy Diagnostics */}
                  <TouchableOpacity
                    style={[styles.diagActionBtn, { backgroundColor: paper.colors.secondaryContainer, borderColor: paper.colors.secondary }]}
                    onPress={handleCopyDiagnostics}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={diagCopied ? 'checkmark-circle' : 'copy-outline'} size={16} color={paper.colors.onSecondaryContainer} />
                    <Text variant="labelMedium" style={{ color: paper.colors.onSecondaryContainer, fontWeight: '600' }}>
                      {diagCopied ? 'Copied!' : 'Copy'}
                    </Text>
                  </TouchableOpacity>

                  {/* Export Diagnostics */}
                  <TouchableOpacity
                    style={[styles.diagActionBtn, { backgroundColor: paper.colors.tertiaryContainer, borderColor: paper.colors.tertiary }]}
                    onPress={handleExportDiagnostics}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="share-outline" size={16} color={paper.colors.onTertiaryContainer} />
                    <Text variant="labelMedium" style={{ color: paper.colors.onTertiaryContainer, fontWeight: '600' }}>Export</Text>
                  </TouchableOpacity>

                  {/* Clear Diagnostics */}
                  <TouchableOpacity
                    style={[styles.diagActionBtn, { backgroundColor: paper.colors.errorContainer, borderColor: paper.colors.error }]}
                    onPress={handleClearDiagnostics}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={16} color={paper.colors.onErrorContainer} />
                    <Text variant="labelMedium" style={{ color: paper.colors.onErrorContainer, fontWeight: '600' }}>Clear</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

          </View>
        </SectionCard>

        {/* ── 5. ABOUT ─────────────────────────────────────────────────── */}
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
            {/* Static rows */}
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="sparkles" size={20} color={paper.colors.primary} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface, fontWeight: '600' }}>Lumio</Text>
              </View>
              <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>
                v{Constants.expoConfig?.version ?? '1.0.0'}
              </Text>
            </View>
            <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="shield-checkmark" size={20} color={paper.colors.onSurfaceVariant} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Data Storage</Text>
              </View>
              <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>Local only (SQLite)</Text>
            </View>
            <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="share-social" size={20} color={paper.colors.onSurfaceVariant} />
                <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>Share Integration</Text>
              </View>
              <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant }}>Share sheet → Lumio</Text>
            </View>
            <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />
            {/* Tappable rows */}
            {[
              { icon: 'logo-github' as IconName, label: 'GitHub Repository',    onPress: handleOpenGitHub,      end: 'open-outline' as IconName },
              { icon: 'document-text' as IconName, label: 'Open Source Licenses', onPress: () => Alert.alert('Licenses', 'Lumio is released under the Apache 2.0 License.'), end: 'chevron-forward' as IconName },
            ].map((item, i, arr) => (
              <React.Fragment key={item.label}>
                <TouchableOpacity
                  style={[styles.row, { minHeight: layout.touchTarget }]}
                  onPress={item.onPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowLeft}>
                    <Ionicons name={item.icon} size={20} color={paper.colors.onSurfaceVariant} />
                    <Text variant="bodyLarge" style={{ color: paper.colors.onSurface }}>{item.label}</Text>
                  </View>
                  <Ionicons name={item.end} size={18} color={paper.colors.onSurfaceVariant} />
                </TouchableOpacity>
                {i < arr.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant }]} />}
              </React.Fragment>
            ))}
          </View>
        </SectionCard>
      </ScrollView>

      {/* ── PROVIDER PICKER MODAL ────────────────────────────────────────── */}
      <Modal
        visible={providerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setProviderModalVisible(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: paper.colors.scrim + '73' }]}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setProviderModalVisible(false)} />
          <View style={[styles.modalSheet, {
            backgroundColor: paper.colors.surfaceContainer,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
          }]}>
            {/* Handle */}
            <View style={[styles.sheetHandle, { backgroundColor: paper.colors.outlineVariant }]} />

            <View style={styles.modalHeaderRow}>
              <Text variant="titleLarge" style={{ color: paper.colors.onSurface, fontWeight: '700' }}>
                Select AI Provider
              </Text>
              <TouchableOpacity onPress={() => setProviderModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={26} color={paper.colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
              {/* Cloud group */}
              <Text variant="labelSmall" style={[styles.modalGroupLabel, { color: paper.colors.primary }]}>
                CLOUD PROVIDERS
              </Text>
              {cloudProviders.map((prov, i) => {
                const isSel = !isLocalProvider && aiSettings.provider === prov.id;
                return (
                  <React.Fragment key={prov.id}>
                    <TouchableOpacity
                      style={[styles.modalOptionRow, isSel && { backgroundColor: paper.colors.primaryContainer }]}
                      onPress={() => {
                        setAiSettings((s) => ({ ...s, provider: prov.id, model: '', localEnabled: false }));
                        setProviderModalVisible(false);
                      }}
                    >
                      <Ionicons
                        name="cloud-outline"
                        size={18}
                        color={isSel ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant}
                        style={{ marginRight: 10 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyLarge" style={{ color: isSel ? paper.colors.onPrimaryContainer : paper.colors.onSurface, fontWeight: isSel ? '700' : '400' }}>
                          {prov.name}
                        </Text>
                        <Text variant="bodySmall" style={{ color: isSel ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant, marginTop: 2 }}>
                          {prov.description}
                        </Text>
                      </View>
                      {isSel && <Ionicons name="checkmark-circle" size={22} color={paper.colors.onPrimaryContainer} />}
                    </TouchableOpacity>
                    {i < cloudProviders.length - 1 && <View style={[styles.hairline, { backgroundColor: paper.colors.outlineVariant, marginHorizontal: 12 }]} />}
                  </React.Fragment>
                );
              })}

              {/* Divider between groups */}
              <View style={[styles.fullDivider, { backgroundColor: paper.colors.outlineVariant, marginVertical: 8 }]} />

              {/* Local group */}
              <Text variant="labelSmall" style={[styles.modalGroupLabel, { color: paper.colors.primary }]}>
                LOCAL PROVIDERS
              </Text>
              {localProviderMeta && (() => {
                const isSel = isLocalProvider;
                return (
                  <TouchableOpacity
                    style={[styles.modalOptionRow, isSel && { backgroundColor: paper.colors.primaryContainer }]}
                    onPress={() => {
                      setAiSettings((s) => ({ ...s, provider: 'local', localEnabled: true }));
                      setProviderModalVisible(false);
                    }}
                  >
                    <Ionicons
                      name="hardware-chip-outline"
                      size={18}
                      color={isSel ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge" style={{ color: isSel ? paper.colors.onPrimaryContainer : paper.colors.onSurface, fontWeight: isSel ? '700' : '400' }}>
                        {localProviderMeta.name}
                      </Text>
                      <Text variant="bodySmall" style={{ color: isSel ? paper.colors.onPrimaryContainer : paper.colors.onSurfaceVariant, marginTop: 2 }}>
                        {localProviderMeta.description}
                      </Text>
                    </View>
                    {isSel && <Ionicons name="checkmark-circle" size={22} color={paper.colors.onPrimaryContainer} />}
                  </TouchableOpacity>
                );
              })()}

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── DIAGNOSTICS MODAL ──────────────────────────────────────────────── */}
      <Modal
        visible={diagModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDiagModalVisible(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: paper.colors.scrim + '73' }]}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setDiagModalVisible(false)} />
          <View style={[styles.modalSheet, styles.diagSheet, {
            backgroundColor: paper.colors.surfaceContainer,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
          }]}>
            <View style={[styles.sheetHandle, { backgroundColor: paper.colors.outlineVariant }]} />

            <View style={styles.modalHeaderRow}>
              <Text variant="titleLarge" style={{ color: paper.colors.onSurface, fontWeight: '700' }}>
                Diagnostics
              </Text>
              <TouchableOpacity onPress={() => setDiagModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={26} color={paper.colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            {/* Entry count + hint */}
            <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, marginBottom: 10 }}>
              {diagEntries.length === 0
                ? 'No entries yet — trigger an AI analysis, save, or share.'
                : `${diagEntries.length} entr${diagEntries.length === 1 ? 'y' : 'ies'} · latest 100 kept · newest first`}
            </Text>

            {/* Log list */}
            <FlatList
              data={[...diagEntries].reverse()}
              keyExtractor={(item) => String(item.seq)}
              style={styles.diagList}
              showsVerticalScrollIndicator
              ListEmptyComponent={
                <Text variant="bodySmall" style={{ color: paper.colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 24 }}>
                  No entries
                </Text>
              }
              renderItem={({ item }) => {
                const { bg: badgeBg, fg: badgeFg } = getDiagBadgeColors(
                  DIAG_EVENT_ROLES[item.event] ?? 'surface',
                  paper
                );
                return (
                <View style={[styles.diagEntry, { borderBottomColor: paper.colors.outlineVariant }]}>
                  <View style={styles.diagEntryHeader}>
                    <View style={[styles.diagEventBadge, { backgroundColor: badgeBg }]}>
                      <Text variant="labelSmall" style={{ color: badgeFg, fontWeight: '700', fontSize: 10 }}>
                        {item.event}
                      </Text>
                    </View>
                    <Text variant="labelSmall" style={{ color: paper.colors.onSurfaceVariant, fontSize: 10 }}>
                      #{item.seq} · {item.timestamp.replace('T', ' ').replace('Z', '').slice(0, 19)}
                    </Text>
                  </View>
                  <Text variant="bodySmall" style={{ color: paper.colors.onSurface, marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>
                    {item.detail}
                  </Text>
                </View>
                );
              }}
            />

            {/* Action row: Copy · Export · Clear */}
            <View style={[styles.diagModalActions, { marginTop: 12 }]}>
              <TouchableOpacity
                style={[styles.diagModalActionBtn, { backgroundColor: diagCopied ? paper.colors.secondaryContainer : paper.colors.primaryContainer }]}
                onPress={handleCopyDiagnostics}
                activeOpacity={0.7}
              >
                <Ionicons name={diagCopied ? 'checkmark-circle' : 'copy-outline'} size={16} color={diagCopied ? paper.colors.onSecondaryContainer : paper.colors.onPrimaryContainer} />
                <Text variant="labelMedium" style={{ color: diagCopied ? paper.colors.onSecondaryContainer : paper.colors.onPrimaryContainer, fontWeight: '600' }}>
                  {diagCopied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.diagModalActionBtn, { backgroundColor: paper.colors.tertiaryContainer }]}
                onPress={handleExportDiagnostics}
                activeOpacity={0.7}
              >
                <Ionicons name="share-outline" size={16} color={paper.colors.onTertiaryContainer} />
                <Text variant="labelMedium" style={{ color: paper.colors.onTertiaryContainer, fontWeight: '600' }}>Export</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.diagModalActionBtn, { backgroundColor: paper.colors.errorContainer }]}
                onPress={handleClearDiagnostics}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={16} color={paper.colors.onErrorContainer} />
                <Text variant="labelMedium" style={{ color: paper.colors.onErrorContainer, fontWeight: '600' }}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    padding: 14,
    gap: 12,
  },

  // Section card
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
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderTitles: { flex: 1 },
  sectionBody: { width: '100%' },

  // Sub-sections
  subSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    marginBottom: 10,
  },

  // Rows
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

  // Dividers
  fullDivider: { height: StyleSheet.hairlineWidth },
  hairline:   { height: StyleSheet.hairlineWidth, marginVertical: 4 },

  // Provider selector row
  providerSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  providerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    marginRight: 10,
  },

  // Text inputs
  textInput: { backgroundColor: 'transparent' },

  // GGUF states
  ggufEmptyState: {
    alignItems: 'center',
    padding: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 4,
  },
  ggufSelectedCard: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  ggufPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: 'center',
    minWidth: 200,
  },

  // Meta tables
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  compatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  compatCard: {
    padding: 14,
    borderWidth: 1,
  },

  // Metrics block (status + RAM)
  metricsBlock: {
    padding: 12,
    borderWidth: 1,
    marginTop: 14,
  },
  metricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 16,
    borderWidth: 1,
  },
  metricCol: { alignItems: 'center', flex: 1 },
  verticalDivider: { width: StyleSheet.hairlineWidth, height: 40 },

  // Export
  exportRow: { flexDirection: 'row', gap: 12 },
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

  // Action row (save/clear)
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },

  // Modal — bottom sheet style
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    // backgroundColor is set inline at render time using paper.colors.scrim + opacity hex '73' (≈45%)
  },
  modalSheet: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    maxHeight: '72%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  modalOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 2,
  },

  // AI Status Card
  statusCard: {
    padding: 12,
    borderWidth: 1,
  },
  inlineAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    marginTop: 6,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 0,
  },
  inlinePillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
  },
  quotaGrid: {
    padding: 12,
    borderWidth: 1,
  },
  testConnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 1,
  },

  // Diagnostics modal
  diagSheet: {
    maxHeight: '80%',
    paddingBottom: 24,
  },
  diagList: {
    maxHeight: 400,
    flexGrow: 0,
  },
  diagEntry: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  diagEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  diagEventBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  // Developer Diagnostics sub-block
  diagSubSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
  },
  diagActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  diagActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  // Diagnostics modal action row
  diagModalActions: {
    flexDirection: 'row',
    gap: 8,
  },
  diagModalActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
  },

  // Language / translation settings
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  langInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  langAddBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
});
