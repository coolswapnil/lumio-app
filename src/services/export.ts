/**
 * export.ts — Export / Backup service
 *
 * Supports two formats:
 *   • JSON  — full fidelity, importable back into Lumio
 *   • CSV   — spreadsheet-friendly, fields: id, title, url, type, tags,
 *             description, notes, address, collection, saved_at, completed, favorite
 *
 * Uses expo-sharing to let Android share to Files, Drive, Gmail, etc.
 * Uses expo-file-system to write a temp file before sharing.
 */
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import type { SavedItem, Collection } from '../types';

/** RFC 4180 CSV cell escaping */
function csvCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  // Wrap in quotes if it contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_HEADER = [
  'id', 'title', 'url', 'content_type', 'tags', 'description',
  'notes', 'ai_summary', 'address', 'latitude', 'longitude',
  'collection', 'is_completed', 'is_favorite', 'created_at', 'updated_at',
].join(',');

function itemToCSVRow(item: SavedItem, collections: Collection[]): string {
  const col = collections.find((c) => c.id === item.collectionId);
  return [
    csvCell(item.id),
    csvCell(item.title),
    csvCell(item.url),
    csvCell(item.contentType),
    csvCell(item.tags.join('; ')),
    csvCell(item.description),
    csvCell(item.notes),
    csvCell(item.aiSummary),
    csvCell(item.address),
    csvCell(item.latitude),
    csvCell(item.longitude),
    csvCell(col?.name),
    csvCell(item.isCompleted),
    csvCell(item.isFavorite),
    csvCell(item.createdAt),
    csvCell(item.updatedAt),
  ].join(',');
}

// ─── JSON Export ──────────────────────────────────────────────────────────────

export async function exportAsJSON(
  items: SavedItem[],
  collections: Collection[],
): Promise<void> {
  const payload = {
    appVersion: '1.1.0',
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    collectionCount: collections.length,
    collections,
    items,
  };

  const json = JSON.stringify(payload, null, 2);
  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const fileName = `lumio-backup-${timestamp}.json`;
  const fileUri = `${FileSystem.cacheDirectory ?? ''}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: `Export Lumio backup — ${items.length} items`,
    UTI: 'public.json',
  });
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

export async function exportAsCSV(
  items: SavedItem[],
  collections: Collection[],
): Promise<void> {
  const rows = items.map((item) => itemToCSVRow(item, collections));
  const csv = [CSV_HEADER, ...rows].join('\n');

  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `lumio-export-${timestamp}.csv`;
  const fileUri = `${FileSystem.cacheDirectory ?? ''}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: `Export Lumio library — ${items.length} items`,
    UTI: 'public.comma-separated-values-text',
  });
}

// ─── JSON Import ──────────────────────────────────────────────────────────────

export interface ImportResult {
  itemsImported: number;
  collectionsImported: number;
  errors: string[];
}

/** Parse and validate a Lumio JSON backup. Returns items + collections or throws. */
export function parseBackupJSON(jsonString: string): { items: SavedItem[]; collections: Collection[] } {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data.items)) throw new Error('Invalid backup: missing items array.');
  // Basic schema validation
  for (const item of data.items) {
    if (typeof item.id !== 'string' || typeof item.title !== 'string') {
      throw new Error(`Invalid item in backup: ${JSON.stringify(item).slice(0, 80)}`);
    }
    // Ensure required fields have defaults
    item.tags = Array.isArray(item.tags) ? item.tags : [];
    item.isCompleted = Boolean(item.isCompleted);
    item.isFavorite = Boolean(item.isFavorite);
  }
  return {
    items: data.items as SavedItem[],
    collections: Array.isArray(data.collections) ? (data.collections as Collection[]) : [],
  };
}
