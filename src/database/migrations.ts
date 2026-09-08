import { SQLiteDatabase } from 'expo-sqlite';
import { diagLog } from '../services/diagnostics';

/**
 * Pass 1 entries — each user-facing collection name that should be adopted
 * into a system collection ID.  Items FK is updated BEFORE the collections.id
 * to satisfy the foreign-key constraint.
 */
const RENAME_ADOPT_ENTRIES: { name: string; sysId: string }[] = [
  { name: 'Finance',       sysId: 'sys-finance' },
  { name: 'Technology',    sysId: 'sys-technology' },
  { name: 'Learning',      sysId: 'sys-learning' },
  { name: 'Real Estate',   sysId: 'sys-real-estate' },
  { name: 'Travel',        sysId: 'sys-travel' },
  { name: 'Food',          sysId: 'sys-food' },
  { name: 'Entertainment', sysId: 'sys-entertainment' },
  { name: 'Career',        sysId: 'sys-career' },
  { name: 'Research',      sysId: 'sys-research' },
  { name: 'Health',        sysId: 'sys-health' },
  { name: 'Lifestyle',     sysId: 'sys-lifestyle' },
  { name: 'Investing',     sysId: 'sys-finance' },
];

/**
 * Pass 2 entries — legacy alias names whose items should be moved to the
 * canonical system collection.  No collections row update is performed.
 */
const ALIAS_REMAP_ENTRIES: { alias: string; sysId: string }[] = [
  { alias: 'Property & Land Deals', sysId: 'sys-real-estate' },
  { alias: 'Renting & Housing',     sysId: 'sys-real-estate' },
  { alias: 'Real Estate Listings',  sysId: 'sys-real-estate' },
  { alias: 'Dividend Investing',    sysId: 'sys-finance' },
  { alias: 'Stock Market',          sysId: 'sys-finance' },
];

/**
 * Idempotent migration that runs on every startup.
 *
 * Pass 1 — rename-and-adopt: promotes user collections whose name matches a
 * system collection name by rewriting their id and marking them is_system = 1.
 * All saved_items FKs are updated before the collections.id change.
 *
 * Pass 2 — alias remap: moves items that belong to known legacy alias
 * collection names into the canonical system collection.  The collections row
 * itself is not touched.
 */
export async function runLegacyCollectionMigration(db: SQLiteDatabase): Promise<void> {
  // ── Pass 1: rename-and-adopt ───────────────────────────────────────────────
  for (const { name, sysId } of RENAME_ADOPT_ENTRIES) {
    // Step A — update item FKs before the collections.id changes
    try {
      const result = await db.runAsync(
        `UPDATE saved_items SET collection_id = ?
         WHERE collection_id IN (
           SELECT id FROM collections WHERE lower(name) = lower(?) AND id != ?
         )`,
        [sysId, name, sysId]
      );
      if (result.changes > 0) {
        diagLog.addEntry(
          'DATABASE_INITIALIZED',
          `migration pass1 items: name="${name}" → sysId="${sysId}" rows=${result.changes}`
        );
      }
    } catch (e) {
      diagLog.addEntry(
        'DATABASE_INITIALIZED',
        `migration pass1 items error: name="${name}" sysId="${sysId}" err=${String(e)}`
      );
    }

    // Step B — adopt the collection row (id + is_system)
    try {
      const result = await db.runAsync(
        `UPDATE collections SET id = ?, is_system = 1
         WHERE lower(name) = lower(?) AND id != ?`,
        [sysId, name, sysId]
      );
      if (result.changes > 0) {
        diagLog.addEntry(
          'DATABASE_INITIALIZED',
          `migration pass1 collection: name="${name}" → sysId="${sysId}" rows=${result.changes}`
        );
      }
    } catch (e) {
      diagLog.addEntry(
        'DATABASE_INITIALIZED',
        `migration pass1 collection error: name="${name}" sysId="${sysId}" err=${String(e)}`
      );
    }
  }

  // ── Pass 2: alias remap ────────────────────────────────────────────────────
  for (const { alias, sysId } of ALIAS_REMAP_ENTRIES) {
    try {
      const result = await db.runAsync(
        `UPDATE saved_items SET collection_id = ?
         WHERE collection_id IN (
           SELECT id FROM collections WHERE lower(name) = lower(?)
         )`,
        [sysId, alias]
      );
      if (result.changes > 0) {
        diagLog.addEntry(
          'DATABASE_INITIALIZED',
          `migration pass2 alias: alias="${alias}" → sysId="${sysId}" rows=${result.changes}`
        );
      }
    } catch (e) {
      diagLog.addEntry(
        'DATABASE_INITIALIZED',
        `migration pass2 alias error: alias="${alias}" sysId="${sysId}" err=${String(e)}`
      );
    }
  }
}
