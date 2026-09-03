/**
 * Expo config plugin: Android edge-to-edge support
 *
 * Applies three native changes on every `expo prebuild`:
 *
 * 1. styles.xml — transparent status + nav bars, edge-to-edge theme flags.
 *    Replaces the opaque statusBarColor that Expo generates by default.
 *
 * 2. app/build.gradle — bumps targetSdkVersion to 35 so Android enforces
 *    edge-to-edge natively (API 35 requirement).
 *
 * 3. gradle.properties — sets android.targetSdkVersion=35 so the root
 *    build.gradle ext block picks it up via findProperty().
 *
 * react-native-safe-area-context (already in the project) then reports
 * the correct insets so JS can position content manually.
 */

const { withAndroidStyles, withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins');

// ── 1. styles.xml patch ───────────────────────────────────────────────────
function withEdgeToEdgeStyles(config) {
  return withAndroidStyles(config, (mod) => {
    const styles = mod.modResults;

    // Find the AppTheme style object
    const appTheme = styles.resources.style?.find(
      (s) => s.$.name === 'AppTheme'
    );

    if (!appTheme) return mod;

    // Helper: upsert an <item> inside the style
    function setItem(name, value, extra = {}) {
      if (!appTheme.item) appTheme.item = [];
      const existing = appTheme.item.find((i) => i.$.name === name);
      if (existing) {
        existing._ = value;
        Object.assign(existing.$, extra);
      } else {
        appTheme.item.push({ $: { name, ...extra }, _: value });
      }
    }

    // Remove opaque statusBarColor if present (Expo sets this by default)
    if (appTheme.item) {
      appTheme.item = appTheme.item.filter(
        (i) => i.$.name !== 'android:statusBarColor'
      );
    }

    // Edge-to-edge flags
    setItem('android:windowDrawsSystemBarBackgrounds', 'true');
    setItem('android:statusBarColor', '@android:color/transparent');
    setItem('android:navigationBarColor', '@android:color/transparent');
    setItem('android:windowTranslucentStatus', 'false');
    setItem('android:windowTranslucentNavigation', 'false');
    setItem('android:enforceNavigationBarContrast', 'false', {
      'tools:targetApi': '29',
    });
    setItem('android:enforceStatusBarContrast', 'false', {
      'tools:targetApi': '29',
    });

    return mod;
  });
}

// ── 2. build.gradle patch ─────────────────────────────────────────────────
function withTargetSdk35(config) {
  return withAppBuildGradle(config, (mod) => {
    // Replace targetSdkVersion 34 → 35 (or any earlier version)
    mod.modResults.contents = mod.modResults.contents.replace(
      /targetSdkVersion\s+\d+/g,
      'targetSdkVersion 35'
    );
    return mod;
  });
}

// ── 3. gradle.properties patch ────────────────────────────────────────────
function withGradleTargetSdk35(config) {
  return withGradleProperties(config, (mod) => {
    const props = mod.modResults;
    const existing = props.find(
      (p) => p.type === 'property' && p.key === 'android.targetSdkVersion'
    );
    if (existing) {
      existing.value = '35';
    } else {
      props.push({ type: 'property', key: 'android.targetSdkVersion', value: '35' });
    }
    return mod;
  });
}

// ── Compose all three plugins ─────────────────────────────────────────────
module.exports = function withEdgeToEdge(config) {
  config = withEdgeToEdgeStyles(config);
  config = withTargetSdk35(config);
  config = withGradleTargetSdk35(config);
  return config;
};
