/**
 * Ambient module declarations for packages that ship without TypeScript
 * type declarations.
 */

declare module 'react-native-material-you-colors' {
  /**
   * Returns the Android 12+ Material You dynamic color palette,
   * or null on unsupported platforms/versions.
   */
  export function getMaterialYouColors(): Promise<Record<string, string> | null>;
}
