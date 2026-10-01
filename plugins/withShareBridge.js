/**
 * Expo Config Plugin: withShareBridge (Legacy compatibility)
 *
 * NOTE: Android ACTION_SEND / ACTION_SEND_MULTIPLE sharing is now handled
 * directly and decoupled by NativeShareActivity (see plugins/withNativeShare.js).
 *
 * FEATURE FLAG: ENABLE_LEGACY_SHARE_BRIDGE
 * When ENABLE_LEGACY_SHARE_BRIDGE = false (default for this and future releases),
 * MainActivity does NOT intercept or rewrite ACTION_SEND intents.
 * When set to true (fallback for 1 transition release if needed), the legacy
 * in-process intent rewriting is restored.
 */

const { withMainActivity } = require('@expo/config-plugins');

const ENABLE_LEGACY_SHARE_BRIDGE = false;

const SHARE_IMPORTS = `
import android.content.Context
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.util.Log
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
`;

const COMPANION_OBJECT = `
  companion object {
    const val PREFS_NAME = "lumio_pending_shares"
    const val TAG = "Lumio"
    const val ENABLE_LEGACY_SHARE_BRIDGE = ${ENABLE_LEGACY_SHARE_BRIDGE}
  }
`;

const ONCREATE_METHODS_LEGACY = `
    Log.d(TAG, "MAIN_ACTIVITY_CREATED action=\${intent?.action} data=\${intent?.dataString}")

    if (intent != null && ENABLE_LEGACY_SHARE_BRIDGE) {
      persistShareToPrefs(intent, "onCreate")
      rewriteShareIntent(intent, "onCreate")
    }
`;

const ONCREATE_METHODS_DEFAULT = `
    Log.d(TAG, "MAIN_ACTIVITY_CREATED action=\${intent?.action} data=\${intent?.dataString}")
`;

const SHARE_BODY_LEGACY = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    Log.d(TAG, "MAIN_ACTIVITY_ON_NEW_INTENT action=\${intent.action} data=\${intent.dataString}")
    if (ENABLE_LEGACY_SHARE_BRIDGE) {
      persistShareToPrefs(intent, "onNewIntent")
      rewriteShareIntent(intent, "onNewIntent")
    }
  }

  /**
   * LEGACY STEP 1 — Persist the raw share payload to SharedPreferences.
   */
  private fun persistShareToPrefs(intent: Intent, caller: String) {
    val action = intent.action
    val isShare = action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE
    if (!isShare) return

    val type         = intent.type
    val extraText    = intent.getStringExtra(Intent.EXTRA_TEXT)
    val extraSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    val extraTitle   = intent.getStringExtra(Intent.EXTRA_TITLE)

    val id  = System.currentTimeMillis().toString()
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit()
      .putString("pending_share_\${id}_text",  extraText  ?: "")
      .putString("pending_share_\${id}_title", extraTitle  ?: "")
      .putString("pending_share_\${id}_subj",  extraSubject ?: "")
      .putString("pending_share_\${id}_mime",  type ?: "")
      .putString("pending_share_\${id}_ts",    id)
      .putString("pending_share_\${id}_raw",   "__PENDING__")
      .apply()

    Log.d(TAG, "SHARE_PREFS_PERSISTED id=$id caller=$caller textLen=\${extraText?.length ?: 0}")
  }

  /**
   * LEGACY STEP 2 — Rewrite the ACTION_SEND into a synthetic lumio://share URI.
   */
  private fun rewriteShareIntent(intent: Intent, caller: String) {
    val action = intent.action
    val isShare = action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE
    if (!isShare) return

    val extraText    = intent.getStringExtra(Intent.EXTRA_TEXT)
    val extraSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    val extraTitle   = intent.getStringExtra(Intent.EXTRA_TITLE)
    val type         = intent.type

    if (extraText.isNullOrBlank() && extraSubject.isNullOrBlank()) return

    try {
      val primaryText = extraText ?: extraSubject ?: ""
      val encodedText = URLEncoder.encode(primaryText, StandardCharsets.UTF_8.name())
      val syntheticUri = Uri.parse("lumio://share?text=$encodedText&title=\${extraTitle ?: ""}&src=LEGACY_BRIDGE")
      intent.action = Intent.ACTION_VIEW
      intent.data   = syntheticUri
      Log.d(TAG, "LEGACY_SHARE_REWRITE_SUCCESS uri=\${syntheticUri}")
    } catch (e: Exception) {
      Log.e(TAG, "LEGACY_SHARE_REWRITE_FAILED error=\${e.message}")
    }
  }
`;

const SHARE_BODY_DEFAULT = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    Log.d(TAG, "MAIN_ACTIVITY_ON_NEW_INTENT action=\${intent.action} data=\${intent.dataString}")
  }
`;

function withShareBridge(config, options = {}) {
  const isLegacyEnabled = options.enableLegacyShareBridge ?? ENABLE_LEGACY_SHARE_BRIDGE;

  return withMainActivity(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    // 1. Add required imports if not already present
    if (!contents.includes('import android.content.Context')) {
      contents = contents.replace(
        /(package\s+[\w\.]+)/,
        `$1\n${SHARE_IMPORTS.trim()}`
      );
    }

    // 2. Inject companion object (PREFS_NAME + TAG) before the first override
    if (!contents.includes('const val PREFS_NAME')) {
      contents = contents.replace(
        /(class\s+MainActivity\s*:\s*ReactActivity\s*\(\s*\)\s*\{)/,
        `$1\n${COMPANION_OBJECT}`
      );
    }

    // 3. Inject onCreate
    if (!contents.includes('MAIN_ACTIVITY_CREATED')) {
      contents = contents.replace(
        /(super\.onCreate\(null\))/,
        `$1\n${isLegacyEnabled ? ONCREATE_METHODS_LEGACY : ONCREATE_METHODS_DEFAULT}`
      );
    }

    // 4. Inject onNewIntent
    if (!contents.includes('MAIN_ACTIVITY_ON_NEW_INTENT')) {
      const lastBraceIndex = contents.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        contents =
          contents.slice(0, lastBraceIndex) +
          (isLegacyEnabled ? SHARE_BODY_LEGACY : SHARE_BODY_DEFAULT) +
          '\n' +
          contents.slice(lastBraceIndex);
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

module.exports = withShareBridge;
module.exports.ENABLE_LEGACY_SHARE_BRIDGE = ENABLE_LEGACY_SHARE_BRIDGE;
