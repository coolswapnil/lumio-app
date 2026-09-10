/**
 * Expo Config Plugin: withShareBridge
 *
 * Automatically injects the native Android share-intent extraction bridge and
 * lifecycle methods into MainActivity.kt during `expo prebuild`.
 *
 * This guarantees that running `expo prebuild --clean` or building in CI will
 * NEVER lose the custom share-handling logic or fall back to default empty
 * MainActivity behavior.
 *
 * Share reliability contract enforced by this plugin:
 *
 *  1. persistShareToPrefs() — writes intent payload to SharedPreferences
 *     IMMEDIATELY on onCreate/onNewIntent, BEFORE any JS code runs.
 *     This is the deepest fail-safe: the share is safe even if JS crashes.
 *
 *  2. rewriteShareIntent() — converts ACTION_SEND to ACTION_VIEW with a
 *     synthetic lumio://share?... URI so React Native's getInitialURL()
 *     and Linking.addEventListener() can pick it up.
 *
 *  3. backfillRawUriInPrefs() — back-fills the encoded synthetic URI into
 *     the SharedPreferences entry written in step 1.
 *
 * The JS layer (ShareIngestionManager.recoverPendingSharesFromPrefs) drains
 * SharedPreferences on every startup to catch shares that were never promoted
 * to SQLite queue items.
 */

const { withMainActivity } = require('@expo/config-plugins');

const SHARE_IMPORTS = `
import android.content.Context
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
`;

const COMPANION_OBJECT = `
  companion object {
    const val PREFS_NAME = "lumio_pending_shares"
    const val TAG = "Lumio"
  }
`;

const ONCREATE_METHODS = `
    Log.d(TAG, "MAIN_ACTIVITY_CREATED action=\${intent?.action} data=\${intent?.dataString}")

    if (intent != null) {
      persistShareToPrefs(intent, "onCreate")
      rewriteShareIntent(intent, "onCreate")
    }
`;

const SHARE_BODY = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    Log.d(TAG, "MAIN_ACTIVITY_ON_NEW_INTENT action=\${intent.action} data=\${intent.dataString}")
    persistShareToPrefs(intent, "onNewIntent")
    rewriteShareIntent(intent, "onNewIntent")
  }

  /**
   * STEP 1 — Persist the raw share payload to SharedPreferences immediately,
   * before any JS code runs.  This is the unconditional fail-safe write.
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

    Log.d(TAG, "SHARE_PREFS_PERSISTED id=$id caller=$caller" +
      " textLen=\${extraText?.length ?: 0} mime=\${type ?: "(null)"}")
  }

  /**
   * After the synthetic URI is built, back-fill the _raw SharedPreferences
   * key so the JS recovery layer has the full payload.
   */
  private fun backfillRawUriInPrefs(syntheticUri: String) {
    try {
      val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val all = prefs.all
      var latestId: String? = null
      var latestTs = 0L
      for ((key, value) in all) {
        if (key.endsWith("_raw") && value == "__PENDING__") {
          val id = key.removePrefix("pending_share_").removeSuffix("_raw")
          val ts = id.toLongOrNull() ?: 0L
          if (ts > latestTs) {
            latestTs = ts
            latestId = id
          }
        }
      }
      if (latestId != null) {
        prefs.edit()
          .putString("pending_share_\${latestId}_raw", syntheticUri.take(2000))
          .apply()
        Log.d(TAG, "SHARE_PREFS_BACKFILLED id=$latestId uriLen=\${syntheticUri.length}")
      }
    } catch (e: Exception) {
      Log.e(TAG, "SHARE_PREFS_BACKFILL_ERROR error=\${e.message}")
    }
  }

  /**
   * STEP 2 — Rewrite the ACTION_SEND into a synthetic lumio://share URI.
   */
  private fun rewriteShareIntent(intent: Intent, caller: String) {
    val action = intent.action
    val type   = intent.type

    Log.d(TAG, "SHARE_ROUTE_SOURCE caller=$caller action=$action type=$type data=\${intent.dataString}")

    val isShare = action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE
    if (!isShare) {
      Log.d(TAG, "SHARE_REWRITE_SKIPPED reason=NOT_ACTION_SEND action=$action")
      return
    }

    val extraText    = intent.getStringExtra(Intent.EXTRA_TEXT)
    val extraSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    val extraTitle   = intent.getStringExtra(Intent.EXTRA_TITLE)
    val intentData   = intent.data

    val extraStreamSingle: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
    val extraStreamList: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
    }

    Log.d(TAG, "ACTION value=\"\${action ?: "(null)"}\"")
    Log.d(TAG, "MIME_TYPE value=\"\${type ?: "(null)"}\"")
    Log.d(TAG, "EXTRA_TEXT value=\"\${extraText?.take(300) ?: "(null)"}\"")
    Log.d(TAG, "EXTRA_STREAM value=\"\${extraStreamSingle ?: (if (!extraStreamList.isNullOrEmpty()) extraStreamList.joinToString(",") else "(null)")}\"")
    Log.d(TAG, "EXTRA_SUBJECT value=\"\${extraSubject?.take(200) ?: "(null)"}\"")
    Log.d(TAG, "EXTRA_TITLE value=\"\${extraTitle?.take(200) ?: "(null)"}\"")
    Log.d(TAG, "INTENT_DATA value=\"\${intentData?.toString() ?: "(null)"}\"")

    val clip = intent.clipData
    val clipItemCount = clip?.itemCount ?: 0
    Log.d(TAG, "CLIP_DATA itemCount=$clipItemCount description=\"\${clip?.description?.label ?: "(null)"}\"")
    for (i in 0 until clipItemCount) {
      val item = clip!!.getItemAt(i)
      val itemUri = item.uri
      val itemText = item.text?.toString()
      val itemMime = if (itemUri != null) {
        try {
          contentResolver?.getType(itemUri)
        } catch (_: Exception) {
          null
        }
      } else {
        null
      } ?: clip.description?.getMimeType(0) ?: "(null)"

      Log.d(TAG, "CLIP_DATA[$i] uri=\"\${itemUri?.toString() ?: "(null)"}\" text=\"\${itemText?.take(200) ?: "(null)"}\" mime=\"$itemMime\"")
    }

    if (!extraStreamList.isNullOrEmpty()) {
      extraStreamList.forEachIndexed { i, uri ->
        Log.d(TAG, "EXTRA_STREAM_LIST[$i] uri=\"$uri\"")
      }
    }

    Log.d(TAG, "PENDING_SHARE_RAW_CAPTURED" +
      " action=$action" +
      " type=$type" +
      " textLen=\${extraText?.length ?: 0}" +
      " clipItems=$clipItemCount" +
      " streamList=\${extraStreamList?.size ?: 0}")

    val bundle = intent.extras
    if (bundle != null) {
      val keys = bundle.keySet()?.joinToString(",") ?: "(none)"
      Log.d(TAG, "BUNDLE_KEYS keys=\"$keys\"")
    }

    val collected = collectAllUrls(
      extraText, clip, intentData,
      extraStreamSingle, extraStreamList, extraSubject
    )

    Log.d(TAG, "SHARE_EXTRACT_RESULT" +
      " urlCount=\${collected.urls.size}" +
      " sources=\"\${collected.sources.joinToString(",")}\"" +
      " text=\"\${collected.primaryText?.take(200) ?: "(null)"}\"")

    if (collected.primaryText == null && collected.urls.isEmpty()) {
      Log.w(TAG, "SHARE_REWRITE_SKIPPED reason=NO_CONTENT_FOUND caller=$caller" +
        " – all sources null; intent will produce lumio:///")
      return
    }

    try {
      val primaryText = collected.primaryText ?: collected.urls.firstOrNull() ?: ""
      val encodedText    = URLEncoder.encode(primaryText,             StandardCharsets.UTF_8.name())
      val encodedTitle   = if (extraTitle   != null) URLEncoder.encode(extraTitle,   StandardCharsets.UTF_8.name()) else ""
      val encodedSubject = if (extraSubject != null) URLEncoder.encode(extraSubject, StandardCharsets.UTF_8.name()) else ""
      val encodedMime    = if (type         != null) URLEncoder.encode(type,         StandardCharsets.UTF_8.name()) else ""

      val urlsParam = collected.urls
        .take(10)
        .joinToString("|")
        .take(2000)
      val encodedUrls = URLEncoder.encode(urlsParam, StandardCharsets.UTF_8.name())

      val encodedSrc = URLEncoder.encode(
        collected.sources.joinToString(",").take(200),
        StandardCharsets.UTF_8.name()
      )

      val syntheticUri = Uri.parse(
        "lumio://share" +
          "?text=$encodedText" +
          "&title=$encodedTitle" +
          "&subject=$encodedSubject" +
          "&urls=$encodedUrls" +
          "&src=$encodedSrc" +
          "&mime=$encodedMime"
      )
      intent.action = Intent.ACTION_VIEW
      intent.data   = syntheticUri

      backfillRawUriInPrefs(syntheticUri.toString())

      Log.d(TAG, "SHARE_REWRITE_SUCCESS" +
        " urlCount=\${collected.urls.size}" +
        " uri=\"\${syntheticUri.toString().take(300)}\"")
    } catch (e: Exception) {
      Log.e(TAG, "SHARE_REWRITE_SKIPPED reason=ENCODE_EXCEPTION caller=$caller error=\${e.message}" +
        " – intent will produce lumio:///")
    }
  }

  private fun collectAllUrls(
    extraText:       String?,
    clip:            ClipData?,
    intentData:      Uri?,
    streamSingle:    Uri?,
    streamList:      List<Uri>?,
    extraSubject:    String?,
  ): CollectionResult {
    val seen   = LinkedHashSet<String>()
    val sources = mutableListOf<String>()
    var primaryText: String? = null

    fun addUrl(url: String, source: String, diagEvent: String? = null) {
      val clean = url.trim().trimEnd('.', ')', '>')
      if (clean.startsWith("http") && seen.add(clean)) {
        if (sources.lastOrNull() != source) sources.add(source)
        if (diagEvent != null) {
          Log.d(TAG, "$diagEvent url=\"\${clean.take(200)}\" source=$source")
        }
        Log.d(TAG, "SHARE_EXTRACT url=\"\${clean.take(200)}\" source=$source")
      }
    }

    fun extractFromText(text: String, source: String, diagEvent: String? = null) {
      val regex = Regex("""https?://[^\\s<>"{}|\\\\^\`\\[\\]]+""")
      regex.findAll(text).forEach { match ->
        addUrl(match.value, source, diagEvent)
      }
    }

    // 1. EXTRA_TEXT
    if (!extraText.isNullOrBlank()) {
      primaryText = extraText.trim()
      extractFromText(extraText, "EXTRA_TEXT")
    }

    // 2. ClipData text
    if (clip != null) {
      for (i in 0 until clip.itemCount) {
        val item = clip.getItemAt(i)
        val t = item.text?.toString()
        if (!t.isNullOrBlank()) {
          if (primaryText == null) primaryText = t.trim()
          extractFromText(t, "CLIP_DATA_TEXT[$i]", "CLIPDATA_FOUND")
        }
      }
    }

    // 3. ClipData URI
    if (clip != null) {
      for (i in 0 until clip.itemCount) {
        val item = clip.getItemAt(i)
        val u = item.uri?.toString()
        if (!u.isNullOrBlank()) {
          if (primaryText == null) primaryText = u.trim()
          addUrl(u, "CLIP_DATA_URI[$i]", "CLIPDATA_FOUND")
        }
      }
    }

    // 4. Intent.getData()
    if (intentData != null) {
      val d = intentData.toString()
      if (primaryText == null) primaryText = d
      addUrl(d, "INTENT_DATA", "DATA_URI_FOUND")
      addUrl(d, "INTENT_DATA", "INTENT_URI_FOUND")
    }

    // 5. EXTRA_STREAM URI
    if (streamSingle != null) {
      val s = streamSingle.toString()
      if (primaryText == null) primaryText = s
      addUrl(s, "EXTRA_STREAM", "STREAM_URI_FOUND")
    }
    if (!streamList.isNullOrEmpty()) {
      streamList.forEachIndexed { i, uri ->
        val s = uri.toString()
        if (primaryText == null) primaryText = s
        addUrl(s, "EXTRA_STREAM_LIST[$i]", "STREAM_URI_FOUND")
      }
    }

    // 6. EXTRA_SUBJECT
    if (!extraSubject.isNullOrBlank()) {
      if (primaryText == null) primaryText = extraSubject.trim()
      extractFromText(extraSubject, "EXTRA_SUBJECT")
    }

    return CollectionResult(
      urls        = seen.toList(),
      primaryText = primaryText,
      sources     = sources,
    )
  }

  private data class CollectionResult(
    val urls:        List<String>,
    val primaryText: String?,
    val sources:     List<String>,
  )
`;

function withShareBridge(config) {
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

    // 3. Inject onCreate rewrite call if not already present
    if (!contents.includes('persistShareToPrefs(intent, "onCreate")')) {
      contents = contents.replace(
        /(super\.onCreate\(null\))/,
        `$1\n${ONCREATE_METHODS}`
      );
    }

    // 4. Inject onNewIntent and helper functions before class closing brace
    if (!contents.includes('persistShareToPrefs(intent: Intent, caller: String)')) {
      const lastBraceIndex = contents.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        contents =
          contents.slice(0, lastBraceIndex) +
          SHARE_BODY +
          '\n' +
          contents.slice(lastBraceIndex);
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

module.exports = withShareBridge;
