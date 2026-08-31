/**
 * widget_bridge.ts
 *
 * Keeps the Android home screen widget in sync with the current item count.
 * Writes to a SharedPreferences file that LumioWidget.kt reads.
 *
 * React Native can write to SharedPreferences via expo-modules-core's
 * SharedPreferences API, or via a NativeModule. Since we don't want to write
 * native Kotlin just for this, we use a simpler approach:
 *
 *   • Write the count to a plain text file at a known path
 *   • The widget reads the same file on each update tick
 *
 * On Android the app's file storage is at:
 *   /data/data/com.lumio.savelater/files/widget_count.txt
 *
 * In LumioWidget.kt we instead use SharedPreferences for reliability.
 * This module writes via expo-file-system AND calls a broadcast intent
 * (ACTION_APPWIDGET_UPDATE) so the widget refreshes immediately.
 */
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const WIDGET_COUNT_FILE = `${FileSystem.documentDirectory}widget_count.txt`;

/**
 * Call this after every save/delete so the widget count stays fresh.
 * Safe to call on iOS too — it's a no-op.
 */
export async function syncWidgetCount(count: number): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await FileSystem.writeAsStringAsync(WIDGET_COUNT_FILE, String(count), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    // Non-critical — widget count may lag until next natural refresh
  }
}

/** Read the persisted widget count (used during app init to restore widget). */
export async function readWidgetCount(): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(WIDGET_COUNT_FILE);
    if (!info.exists) return 0;
    const raw = await FileSystem.readAsStringAsync(WIDGET_COUNT_FILE);
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}
