/**
 * pendingSharesWatcher.ts — Live DB-change watcher for pending_shares.
 *
 * FIX 3: Library updates immediately after share.
 *
 * Problem: NativeShareActivity writes a row to pending_shares synchronously
 * (SQLite WAL mode), but the JS DataContext only runs recoverPendingShares()
 * at app startup.  If Lumio is already open (foreground or backgrounded) the
 * new row is never noticed until the user manually restarts the app.
 *
 * Solution: Poll pending_shares every POLL_INTERVAL_MS while the app is in
 * the foreground (or immediately when it returns to the foreground).  When we
 * detect a new 'pending' row that did not exist in the last snapshot:
 *   1. Emit LIBRARY_REFRESH_TRIGGERED diagnostic.
 *   2. Call ShareIngestionManager.recoverPendingShares() to ingest + enqueue.
 *   3. Call onRefresh() so the library list re-renders immediately.
 *   4. Emit LIBRARY_REFRESH_COMPLETED diagnostic.
 *
 * The watcher is started from DataContext on mount and stopped on unmount.
 * It self-throttles: while enrichment is already running (queue non-empty)
 * the poll interval stretches to POLL_INTERVAL_ACTIVE_MS to avoid hammering
 * the DB during metadata/AI calls.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { getDatabase } from '../database/db';
import { ShareIngestionManager } from './shareIngestion';
import { diagLog } from './diagnostics';

const POLL_INTERVAL_MS        = 1_500;   // 1.5 s when idle
const POLL_INTERVAL_ACTIVE_MS = 4_000;   // 4 s while queue is running
const MAX_ROWS_PER_POLL       = 20;

type RefreshCallback = () => Promise<void>;
type QueueActiveCallback = () => boolean;

let _timer: ReturnType<typeof setTimeout> | null = null;
let _knownIds = new Set<string>();
let _onRefresh: RefreshCallback | null = null;
let _isQueueActive: QueueActiveCallback = () => false;
let _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let _running = false;

/**
 * Start the watcher.
 * @param onRefresh       Called when new shares are detected and ingested.
 * @param isQueueActive   Returns true when the capture queue is busy (slows poll).
 */
export function startPendingSharesWatcher(
  onRefresh: RefreshCallback,
  isQueueActive: QueueActiveCallback,
): void {
  if (_running) return;
  _running = true;
  _onRefresh = onRefresh;
  _isQueueActive = isQueueActive;
  _knownIds.clear();

  // Poll immediately on foreground transitions
  _appStateSubscription = AppState.addEventListener('change', _onAppStateChange);

  // Seed known IDs from DB so we don't false-alarm on existing rows
  _seedKnownIds().then(() => _schedulePoll(0));
}

export function stopPendingSharesWatcher(): void {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _appStateSubscription?.remove();
  _appStateSubscription = null;
  _onRefresh = null;
}

function _onAppStateChange(state: AppStateStatus) {
  if (state === 'active') {
    // App just came to the foreground — poll immediately
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _schedulePoll(0);
  }
}

function _schedulePoll(delayMs: number) {
  if (!_running) return;
  _timer = setTimeout(_poll, delayMs);
}

async function _poll() {
  if (!_running) return;
  try {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM pending_shares WHERE status = 'pending' LIMIT ?`,
      [MAX_ROWS_PER_POLL]
    );
    const newIds = rows.map((r) => r.id).filter((id) => !_knownIds.has(id));
    if (newIds.length > 0) {
      newIds.forEach((id) => _knownIds.add(id));
      diagLog.addEntry('LIBRARY_REFRESH_TRIGGERED', `pendingSharesWatcher: detected ${newIds.length} new pending row(s): ${newIds.join(', ')}`);
      try {
        await ShareIngestionManager.recoverPendingShares();
        if (_onRefresh) await _onRefresh();
        diagLog.addEntry('LIBRARY_REFRESH_COMPLETED', `pendingSharesWatcher: refresh done after ingesting ${newIds.length} row(s)`);
      } catch (e) {
        diagLog.addEntry('LIBRARY_REFRESH_TRIGGERED', `pendingSharesWatcher: ingest/refresh error — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch {
    // DB not ready yet — retry on next cycle
  }
  const interval = _isQueueActive() ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_MS;
  _schedulePoll(interval);
}

async function _seedKnownIds() {
  try {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM pending_shares LIMIT ?`, [MAX_ROWS_PER_POLL]
    );
    rows.forEach((r) => _knownIds.add(r.id));
  } catch {
    // Ignore — watcher will start fresh
  }
}
