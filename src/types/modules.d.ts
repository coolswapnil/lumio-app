/** Ambient declarations for packages that ship without TypeScript types. */

import { NativeModules } from 'react-native';

declare module 'react-native' {
  interface NativeModulesStatic {
    /**
     * LumioSharedPrefs — native bridge for reading/removing entries from
     * the lumio_pending_shares SharedPreferences file written by
     * MainActivity.persistShareToPrefs() before any JS code runs.
     *
     * Available on Android only.  On iOS NativeModules.LumioSharedPrefs is
     * undefined — callers must guard with `Platform.OS === 'android'`.
     */
    LumioSharedPrefs: {
      /** Returns all key-value pairs in the named SharedPreferences file. */
      getAll(prefsName: string): Promise<Record<string, string>>;
      /** Removes a single key from the named SharedPreferences file. */
      remove(prefsName: string, key: string): Promise<void>;
    } | undefined;
  }
}
