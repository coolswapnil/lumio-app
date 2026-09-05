import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('lumio.db');
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  const database = await getDatabase();

  // Enable WAL mode for better concurrent-read performance.
  await database.execAsync('PRAGMA journal_mode = WAL;');

  // -------------------------------------------------------------------------
  // Core tables — created on first install.
  // -------------------------------------------------------------------------
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT NOT NULL DEFAULT 'folder',
      color TEXT NOT NULL DEFAULT '#3b82f6',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_items (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      url TEXT,
      image_url TEXT,
      content_type TEXT NOT NULL,
      collection_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      address TEXT,
      latitude REAL,
      longitude REAL,
      is_completed INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      ai_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_collection ON saved_items(collection_id);
    CREATE INDEX IF NOT EXISTS idx_items_type ON saved_items(content_type);
    CREATE INDEX IF NOT EXISTS idx_items_favorite ON saved_items(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_items_created ON saved_items(created_at DESC);
  `);

  // -------------------------------------------------------------------------
  // Additive migrations — silently ignored if the column already exists.
  // -------------------------------------------------------------------------
  await runSafe(database, `ALTER TABLE saved_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
  await runSafe(database, `ALTER TABLE collections ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);

  // Smart-categorization fields (content-intelligence update)
  await runSafe(database, `ALTER TABLE saved_items ADD COLUMN source TEXT`);
  await runSafe(database, `ALTER TABLE saved_items ADD COLUMN media_type TEXT`);
  await runSafe(database, `ALTER TABLE saved_items ADD COLUMN category TEXT`);
  await runSafe(database, `ALTER TABLE saved_items ADD COLUMN suggested_collections TEXT NOT NULL DEFAULT '[]'`);

  // -------------------------------------------------------------------------
  // Sync infrastructure tables — offline-first queue, tombstones, metadata.
  // -------------------------------------------------------------------------
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id   TEXT    NOT NULL,
      entity_type TEXT    NOT NULL CHECK(entity_type IN ('item','collection')),
      operation   TEXT    NOT NULL CHECK(operation   IN ('upsert','delete')),
      payload     TEXT,
      enqueued_at TEXT    NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      status      TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','processing','failed','dead')),
      last_error  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status
      ON sync_queue(status, next_retry_at);

    CREATE TABLE IF NOT EXISTS sync_tombstones (
      entity_id   TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('item','collection')),
      deleted_at  TEXT NOT NULL,
      PRIMARY KEY (entity_id, entity_type)
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  // -------------------------------------------------------------------------
  // Seed default collections if none exist.
  // -------------------------------------------------------------------------
  const existing = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM collections'
  );
  if (existing && existing.count === 0) {
    await seedDefaultCollections(database);
  }
}

/** Execute a DDL statement and swallow "duplicate column" errors on upgrades. */
async function runSafe(
  database: SQLite.SQLiteDatabase,
  sql: string
): Promise<void> {
  try {
    await database.execAsync(sql);
  } catch {
    // Duplicate column name is expected on re-open of an existing database.
  }
}

async function seedDefaultCollections(database: SQLite.SQLiteDatabase): Promise<void> {
  const defaults = [
    { id: 'col-finance',    name: 'Finance',     icon: 'cash' as const,       color: '#10b981' },
    { id: 'col-investing',  name: 'Investing',   icon: 'trending-up' as const,color: '#059669' },
    { id: 'col-learning',   name: 'Learning',    icon: 'school' as const,     color: '#3b82f6' },
    { id: 'col-research',   name: 'Research',    icon: 'search' as const,     color: '#6366f1' },
    { id: 'col-career',     name: 'Career',      icon: 'briefcase' as const,  color: '#8b5cf6' },
    { id: 'col-technology', name: 'Technology',  icon: 'hardware-chip' as const, color: '#0ea5e9' },
  ];

  const now = new Date().toISOString();
  for (const col of defaults) {
    await database.runAsync(
      `INSERT OR IGNORE INTO collections (id, name, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [col.id, col.name, col.icon, col.color, now, now]
    );
  }
}
