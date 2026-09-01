import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { getAISettings, saveAISettings, clearAISettings } from '../../src/services/settings';
import { exportAsJSON, exportAsCSV } from '../../src/services/export';
import { AI_PROVIDERS } from '../../src/constants';
import type { AISettings, AIProvider } from '../../src/types';
import { Button } from '../../src/components/Button';

export default function SettingsScreen() {
  const { colors, settings, updateSettings } = useTheme();
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Appearance */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>APPEARANCE</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
                    color={colors.icon}
                  />
                  <Text style={[styles.rowLabel, { color: colors.text }]}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)} Mode
                  </Text>
                </View>
                {settings.theme === mode && (
                  <Ionicons name="checkmark-circle" size={20} color="#3b82f6" />
                )}
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* AI Provider */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>AI PROVIDER</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Provider selection */}
          {AI_PROVIDERS.map((provider, i, arr) => (
            <React.Fragment key={provider.id}>
              <TouchableOpacity
                onPress={() => setAiSettings((s) => ({ ...s, provider: provider.id, model: '' }))}
                style={styles.row}
              >
                <View style={styles.rowLeft}>
                  <View style={[styles.providerDot, {
                    backgroundColor: aiSettings.provider === provider.id ? '#3b82f6' : colors.surfaceSecondary
                  }]} />
                  <View>
                    <Text style={[styles.rowLabel, { color: colors.text }]}>{provider.name}</Text>
                    <Text style={[styles.rowSub, { color: colors.textMuted }]}>{provider.description}</Text>
                  </View>
                </View>
                {aiSettings.provider === provider.id && (
                  <Ionicons name="checkmark-circle" size={20} color="#3b82f6" />
                )}
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* API Key */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            {selectedProvider?.name} API Key
          </Text>
          <View style={[styles.keyInput, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
            <TextInput
              value={aiSettings.apiKey}
              onChangeText={(v) => setAiSettings((s) => ({ ...s, apiKey: v }))}
              placeholder={`Enter your ${selectedProvider?.name ?? 'provider'} API key`}
              placeholderTextColor={colors.placeholder}
              style={[styles.keyInputText, { color: colors.text }]}
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowKey(!showKey)}>
              <Ionicons name={showKey ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Model */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Model (optional — uses default if blank)
          </Text>
          <TextInput
            value={aiSettings.model}
            onChangeText={(v) => setAiSettings((s) => ({ ...s, model: v }))}
            placeholder={selectedProvider?.modelPlaceholder ?? 'model-name'}
            placeholderTextColor={colors.placeholder}
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* watsonx extras */}
          {aiSettings.provider === 'watsonx' && (
            <>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                Project ID *
              </Text>
              <TextInput
                value={aiSettings.watsonxProjectId}
                onChangeText={(v) => setAiSettings((s) => ({ ...s, watsonxProjectId: v }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                placeholderTextColor={colors.placeholder}
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                Region
              </Text>
              <TextInput
                value={aiSettings.watsonxRegion}
                onChangeText={(v) => setAiSettings((s) => ({ ...s, watsonxRegion: v }))}
                placeholder="us-south"
                placeholderTextColor={colors.placeholder}
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          {/* Local LLM / Indus: base URL field */}
          {(aiSettings.provider === 'local' || aiSettings.provider === 'indus') && (
            <>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                {aiSettings.provider === 'local' ? 'Server Base URL' : 'API Base URL'}
              </Text>
              <TextInput
                value={aiSettings.localBaseUrl}
                onChangeText={(v) => setAiSettings((s) => ({ ...s, localBaseUrl: v }))}
                placeholder={
                  aiSettings.provider === 'local'
                    ? 'http://localhost:11434/v1'
                    : 'https://api.indusai.in/v1'
                }
                placeholderTextColor={colors.placeholder}
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {aiSettings.provider === 'local' && (
                <Text style={[styles.helpNote, { color: colors.textMuted }]}>
                  Ollama default: http://localhost:11434/v1{'\n'}
                  LM Studio default: http://localhost:1234/v1{'\n'}
                  API key is optional for local servers.
                </Text>
              )}
            </>
          )}

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

          <Text style={[styles.secureNote, { color: colors.textMuted }]}>
            🔒 API keys are stored encrypted on your device and never transmitted externally.
          </Text>
        </View>

        {/* Export / Backup */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>EXPORT & BACKUP</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.exportDesc, { color: colors.textSecondary }]}>
            {items.length} item{items.length !== 1 ? 's' : ''} · {collections.length} collection{collections.length !== 1 ? 's' : ''}
          </Text>
          <View style={styles.exportButtons}>
            <TouchableOpacity
              onPress={() => handleExport('json')}
              disabled={!!exporting}
              style={[styles.exportBtn, { backgroundColor: '#3b82f610', borderColor: '#3b82f6' }]}
            >
              {exporting === 'json'
                ? <ActivityIndicator size="small" color="#3b82f6" />
                : <Ionicons name="code-download" size={18} color="#3b82f6" />}
              <Text style={[styles.exportBtnText, { color: '#3b82f6' }]}>
                {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleExport('csv')}
              disabled={!!exporting}
              style={[styles.exportBtn, { backgroundColor: '#10b98110', borderColor: '#10b981' }]}
            >
              {exporting === 'csv'
                ? <ActivityIndicator size="small" color="#10b981" />
                : <Ionicons name="document-text" size={18} color="#10b981" />}
              <Text style={[styles.exportBtnText, { color: '#10b981' }]}>
                {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.exportNote, { color: colors.textMuted }]}>
            JSON backup is fully importable. CSV is spreadsheet-compatible.
          </Text>
        </View>

        {/* About */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Lumio</Text>
            <Text style={[styles.rowSub, { color: colors.textMuted }]}>
              v{Constants.expoConfig?.version ?? '—'}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Data Storage</Text>
            <Text style={[styles.rowSub, { color: colors.textMuted }]}>Local only (SQLite)</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Share from any app</Text>
            <Text style={[styles.rowSub, { color: colors.textMuted }]}>Share sheet → Lumio</Text>
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
  title: { fontSize: 24, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 100, gap: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  divider: { height: 1, marginHorizontal: 14 },
  providerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  fieldLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, paddingHorizontal: 14, paddingTop: 14 },
  keyInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    margin: 14,
    marginTop: 8,
    gap: 8,
  },
  keyInputText: { flex: 1, fontSize: 14, fontFamily: 'monospace' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginHorizontal: 14,
    marginTop: 8,
    fontFamily: 'monospace',
  },
  aiButtons: {
    flexDirection: 'row',
    padding: 14,
    paddingTop: 16,
    gap: 8,
  },
  secureNote: {
    fontSize: 12,
    paddingHorizontal: 14,
    paddingBottom: 14,
    lineHeight: 16,
  },
  helpNote: {
    fontSize: 11,
    paddingHorizontal: 14,
    paddingBottom: 10,
    lineHeight: 17,
  },
  exportDesc: {
    fontSize: 13,
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
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 7,
  },
  exportBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  exportNote: {
    fontSize: 11,
    paddingHorizontal: 14,
    paddingBottom: 14,
    lineHeight: 16,
  },
});
