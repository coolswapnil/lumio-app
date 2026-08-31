import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Modal,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import uuid from 'react-native-uuid';
const uuidv4 = () => uuid.v4() as string;
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { CollectionCard } from '../../src/components/CollectionCard';
import { saveCollection, deleteCollection } from '../../src/database/collections';
import { COLLECTION_ICONS, COLLECTION_COLORS } from '../../src/constants';
import type { Collection } from '../../src/types';
import { Button } from '../../src/components/Button';

export default function CollectionsScreen() {
  const { colors } = useTheme();
  const { collections, refreshCollections } = useData();
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
    if (!name.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    await saveCollection({
      id: uuidv4() as string,
      name: name.trim(),
      description: description.trim() || undefined,
      icon: selectedIcon,
      color: selectedColor,
      createdAt: now,
      updatedAt: now,
    });
    await refreshCollections();
    setSaving(false);
    setModalVisible(false);
    resetForm();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Collections</Text>
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          style={[styles.addBtn, { backgroundColor: '#3b82f6' }]}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={collections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CollectionCard collection={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No collections yet
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
              Create one to organize your saved items
            </Text>
          </View>
        }
      />

      {/* Create Collection Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setModalVisible(false); resetForm(); }}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => { setModalVisible(false); resetForm(); }}>
              <Text style={{ color: '#3b82f6', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>New Collection</Text>
            <Button title="Create" onPress={handleCreate} loading={saving} size="sm" />
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={{ gap: 20 }}>
            {/* Preview */}
            <View style={styles.previewRow}>
              <View style={[styles.previewIcon, { backgroundColor: selectedColor + '20' }]}>
                <Ionicons name={selectedIcon as any} size={28} color={selectedColor} />
              </View>
              <Text style={[styles.previewName, { color: colors.text }]}>
                {name || 'Collection Name'}
              </Text>
            </View>

            {/* Name */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Travel Plans"
                placeholderTextColor={colors.placeholder}
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                autoFocus
              />
            </View>

            {/* Description */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What will you save here?"
                placeholderTextColor={colors.placeholder}
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
              />
            </View>

            {/* Icon */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.iconGrid}>
                  {COLLECTION_ICONS.map((icon) => (
                    <TouchableOpacity
                      key={icon}
                      onPress={() => setSelectedIcon(icon)}
                      style={[
                        styles.iconOption,
                        {
                          backgroundColor: selectedIcon === icon ? selectedColor + '25' : colors.surfaceSecondary,
                          borderColor: selectedIcon === icon ? selectedColor : 'transparent',
                          borderWidth: 2,
                        },
                      ]}
                    >
                      <Ionicons name={icon as any} size={20} color={selectedIcon === icon ? selectedColor : colors.icon} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Color */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Color</Text>
              <View style={styles.colorGrid}>
                {COLLECTION_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    onPress={() => setSelectedColor(color)}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: color },
                      selectedColor === color && styles.colorSwatchActive,
                    ]}
                  >
                    {selectedColor === color && (
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 24, fontWeight: '800' },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyText: { fontSize: 17, fontWeight: '600', marginTop: 12 },
  emptySubtext: { fontSize: 14, textAlign: 'center' },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
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
  previewName: { fontSize: 18, fontWeight: '700' },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
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
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
});
