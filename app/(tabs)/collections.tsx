import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  FAB,
  Text,
  TextInput,
  TouchableRipple,
  ActivityIndicator,
} from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { generateId } from '../../src/utils/uuid';
import { sanitizeText, LIMITS } from '../../src/utils/validation';
import { logError, getUserMessage } from '../../src/utils/errors';
import { useTheme } from '../../src/context/ThemeContext';
import { useAppTheme } from '../../src/constants/colors';
import { useData } from '../../src/context/DataContext';
import { CollectionCard } from '../../src/components/CollectionCard';
import { saveCollection } from '../../src/database/collections';
import { COLLECTION_ICONS, COLLECTION_COLORS } from '../../src/constants';
import { Button } from '../../src/components/Button';
import { FlatList } from 'react-native';

// MD3 extended FAB dimensions
const FAB_HEIGHT = 56;
const FAB_MARGIN = 16;
// Tab bar fixed content height — must match _layout.tsx tabBarStyle height base.
// FAB is position:absolute from screen bottom, so it must clear tab bar + nav inset.
const TAB_BAR_HEIGHT = 52;

export default function CollectionsScreen() {
  const { colors } = useTheme();
  const paper = useAppTheme();
  const insets = useSafeAreaInsets();
  const { collections, refreshCollections, refreshAll } = useData();

  // Re-fetch collection counts whenever this tab gains focus (e.g. after
  // assigning an item from item detail and navigating back here).
  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll])
  );
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(COLLECTION_ICONS[0]);
  const [selectedColor, setSelectedColor] = useState(COLLECTION_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName('');
    setDescription('');
    setSelectedIcon(COLLECTION_ICONS[0]);
    setSelectedColor(COLLECTION_COLORS[0]);
  };

  const handleCreate = async () => {
    const cleanName = sanitizeText(name, LIMITS.COLLECTION_NAME);
    if (!cleanName) return;
    setSaving(true);
    try {
    const now = new Date().toISOString();
    await saveCollection({
      id: generateId(),
      name: cleanName,
      description: sanitizeText(description, LIMITS.COLLECTION_DESCRIPTION) || undefined,
      icon: selectedIcon,
      color: selectedColor,
      createdAt: now,
      updatedAt: now,
    });
    await refreshCollections();
    setModalVisible(false);
    resetForm();
    } catch (err) {
      logError(err, { screen: 'collections', action: 'createCollection' });
      Alert.alert('Error', getUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* MD3 Top App Bar */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text variant="headlineSmall" style={{ color: paper.colors.onSurface }}>
          Collections
        </Text>
      </View>

      <FlatList
        data={collections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CollectionCard collection={item} />}
        contentContainerStyle={[
          styles.listContent,
          // Clear space for FAB + tab bar + nav inset so last item is not hidden.
          { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + FAB_HEIGHT + FAB_MARGIN + 8 },
        ]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={52} color={paper.colors.onSurfaceVariant} />
            <Text variant="titleMedium" style={[styles.emptyText, { color: paper.colors.onSurface }]}>
              No collections yet
            </Text>
            <Text variant="bodyMedium" style={{ color: paper.colors.onSurfaceVariant, textAlign: 'center' }}>
              Create one to organize your saved items
            </Text>
          </View>
        }
      />

      {/* MD3 FAB — clears tab bar (TAB_BAR_HEIGHT) + gesture nav inset */}
      <FAB
        icon="plus"
        label="New Collection"
        onPress={() => setModalVisible(true)}
        style={[
          styles.fab,
          {
            backgroundColor: paper.colors.primaryContainer,
            // bottom = nav-bar inset + fixed tab bar content height + design margin
            bottom: insets.bottom + TAB_BAR_HEIGHT + FAB_MARGIN,
          },
        ]}
        color={paper.colors.onPrimaryContainer}
        accessibilityLabel="Create new collection"
      />

      {/* Create Collection Bottom Sheet (Modal) */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setModalVisible(false); resetForm(); }}
      >
        {/* SafeAreaView inside modal so its header clears the status bar on Android */}
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.background }]} edges={['top']}>
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableRipple
              onPress={() => { setModalVisible(false); resetForm(); }}
              borderless
              style={{ borderRadius: 8, padding: 4 }}
            >
              <Text style={{ color: paper.colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableRipple>
            <Text variant="titleMedium" style={{ color: paper.colors.onSurface }}>
              New Collection
            </Text>
            <Button title="Create" onPress={handleCreate} loading={saving} size="sm" />
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={{ gap: 20 }}>
            {/* Preview */}
            <View style={styles.previewRow}>
              <View style={[styles.previewIcon, { backgroundColor: selectedColor + '22' }]}>
                <Ionicons name={selectedIcon as any} size={28} color={selectedColor} />
              </View>
              <Text variant="titleMedium" style={{ color: paper.colors.onSurface }}>
                {name || 'Collection Name'}
              </Text>
            </View>

            {/* Name — MD3 TextInput */}
            <TextInput
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Travel Plans"
              mode="outlined"
              autoFocus
              style={styles.textInput}
            />

            {/* Description — MD3 TextInput */}
            <TextInput
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="What will you save here?"
              mode="outlined"
              style={styles.textInput}
            />

            {/* Icon picker */}
            <View>
              <Text variant="labelLarge" style={[styles.fieldLabel, { color: paper.colors.onSurfaceVariant }]}>
                Icon
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.iconGrid}>
                  {COLLECTION_ICONS.map((icon) => (
                    <TouchableRipple
                      key={icon}
                      onPress={() => setSelectedIcon(icon)}
                      borderless
                      style={[
                        styles.iconOption,
                        {
                          backgroundColor: selectedIcon === icon
                            ? selectedColor + '25'
                            : paper.colors.surfaceContainerHigh,
                          borderWidth: 2,
                          borderColor: selectedIcon === icon ? selectedColor : 'transparent',
                        },
                      ]}
                    >
                      <Ionicons
                        name={icon as any}
                        size={20}
                        color={selectedIcon === icon ? selectedColor : paper.colors.onSurfaceVariant}
                      />
                    </TouchableRipple>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Color picker */}
            <View>
              <Text variant="labelLarge" style={[styles.fieldLabel, { color: paper.colors.onSurfaceVariant }]}>
                Color
              </Text>
              <View style={styles.colorGrid}>
                {COLLECTION_COLORS.map((color) => (
                  <TouchableRipple
                    key={color}
                    onPress={() => setSelectedColor(color)}
                    borderless
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: color },
                      selectedColor === color && styles.colorSwatchActive,
                    ]}
                  >
                    {selectedColor === color ? (
                      <Ionicons name="checkmark" size={14} color={paper.colors.onPrimary} />
                    ) : (
                      <View />
                    )}
                  </TouchableRipple>
                ))}
              </View>
            </View>
          </ScrollView>

          {saving && (
            <View style={[styles.savingOverlay, { backgroundColor: paper.colors.scrim + '26' }]}>
              <ActivityIndicator size="large" color={paper.colors.primary} />
            </View>
          )}
        </SafeAreaView>
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
  listContent: { padding: 16 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyText: { marginTop: 12 },
  fab: {
    position: 'absolute',
    right: 16,
    // bottom is set inline so it can use the insets value
    borderRadius: 16,
  },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalBody: { padding: 16 },
  previewRow: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  previewIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    backgroundColor: 'transparent',
  },
  fieldLabel: {
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  iconGrid: { flexDirection: 'row', gap: 8 },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchActive: {
    transform: [{ scale: 1.15 }],
    elevation: 3,
  },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    // backgroundColor is set inline at render time using paper.colors.scrim + opacity hex '26' (≈15%)
    alignItems: 'center',
    justifyContent: 'center',
  },
});
