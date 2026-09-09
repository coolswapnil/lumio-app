/**
 * Expo Config Plugin: withShareBridge
 *
 * Automatically injects the native Android share-intent extraction bridge and
 * lifecycle methods (onCreate, onNewIntent, rewriteShareIntent, collectAllUrls)
 * into MainActivity.kt during `expo prebuild`.
 *
 * This guarantees that running `expo prebuild --clean` or building in CI will
 * NEVER lose the custom share-handling logic or fall back to default empty
 * MainActivity behavior.
 */

const { withMainActivity } = require('@expo/config-plugins');

const SHARE_IMPORTS = `
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
`;

const SHARE_METHODS = `
    Log.d("Lumio", "MAIN_ACTIVITY_CREATED action=\${intent?.action} data=\${intent?.dataString}")

    if (intent != null) {
      rewriteShareIntent(intent, "onCreate")
    }
`;

const SHARE_BODY = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    Log.d("Lumio", "MAIN_ACTIVITY_ON_NEW_INTENT action=\${intent.action} data=\${intent.dataString}")
    rewriteShareIntent(intent, "onNewIntent")
  }

  /**
   * Rewrites any ACTION_SEND / ACTION_SEND_MULTIPLE intent into an ACTION_VIEW
   * intent carrying a synthetic lumio://share?... URI.
   */
  private fun rewriteShareIntent(intent: Intent, caller: String) {
    val action = intent.action
    val type   = intent.type

    Log.d("Lumio", "SHARE_ROUTE_SOURCE caller=$caller action=$action type=$type data=\${intent.dataString}")

    val isShare = action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE
    if (!isShare) {
      Log.d("Lumio", "SHARE_REWRITE_SKIPPED reason=NOT_ACTION_SEND action=$action")
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

    Log.d("Lumio", "ACTION value=\"\${action ?: "(null)"}\"")
    Log.d("Lumio", "MIME_TYPE value=\"\${type ?: "(null)"}\"")
    Log.d("Lumio", "EXTRA_TEXT value=\"\${extraText?.take(300) ?: "(null)"}\"")
    Log.d("Lumio", "EXTRA_STREAM value=\"\${extraStreamSingle ?: (if (!extraStreamList.isNullOrEmpty()) extraStreamList.joinToString(",") else "(null)")}\"")
    Log.d("Lumio", "EXTRA_SUBJECT value=\"\${extraSubject?.take(200) ?: "(null)"}\"")
    Log.d("Lumio", "EXTRA_TITLE value=\"\${extraTitle?.take(200) ?: "(null)"}\"")
    Log.d("Lumio", "INTENT_DATA value=\"\${intentData?.toString() ?: "(null)"}\"")

    val clip = intent.clipData
    val clipItemCount = clip?.itemCount ?: 0
    Log.d("Lumio", "CLIP_DATA itemCount=$clipItemCount description=\"\${clip?.description?.label ?: "(null)"}\"")
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

      Log.d("Lumio", "CLIP_DATA[$i] uri=\"\${itemUri?.toString() ?: "(null)"}\" text=\"\${itemText?.take(200) ?: "(null)"}\" mime=\"$itemMime\"")
    }

    if (!extraStreamList.isNullOrEmpty()) {
      extraStreamList.forEachIndexed { i, uri ->
        Log.d("Lumio", "EXTRA_STREAM_LIST[$i] uri=\"$uri\"")
      }
    }

    Log.d("Lumio", "PENDING_SHARE_RAW_CAPTURED" +
      " action=$action" +
      " type=$type" +
      " textLen=\${extraText?.length ?: 0}" +
      " clipItems=$clipItemCount" +
      " streamList=\${extraStreamList?.size ?: 0}")

    val collected = collectAllUrls(
      extraText, clip, intentData,
      extraStreamSingle, extraStreamList, extraSubject
    )

    Log.d("Lumio", "SHARE_EXTRACT_RESULT" +
      " urlCount=\${collected.urls.size}" +
      " sources=\"\${collected.sources.joinToString(",")}\"" +
      " text=\"\${collected.primaryText?.take(200) ?: "(null)"}\"")

    if (collected.primaryText == null && collected.urls.isEmpty()) {
      Log.w("Lumio", "SHARE_REWRITE_SKIPPED reason=NO_CONTENT_FOUND caller=$caller" +
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

      Log.d("Lumio", "SHARE_REWRITE_SUCCESS" +
        " urlCount=\${collected.urls.size}" +
        " uri=\"\${syntheticUri.toString().take(300)}\"")
    } catch (e: Exception) {
      Log.e("Lumio", "SHARE_REWRITE_SKIPPED reason=ENCODE_EXCEPTION caller=$caller error=\${e.message}" +
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
          Log.d("Lumio", "$diagEvent url=\"\${clean.take(200)}\" source=$source")
        }
        Log.d("Lumio", "SHARE_EXTRACT url=\"\${clean.take(200)}\" source=$source")
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
    if (!contents.includes('import android.content.ClipData')) {
      contents = contents.replace(
        /(package\s+[\w\.]+)/,
        `$1\n${SHARE_IMPORTS.trim()}`
      );
    }

    // 2. Inject onCreate rewrite call if not already present
    if (!contents.includes('rewriteShareIntent(intent, "onCreate")')) {
      contents = contents.replace(
        /(super\.onCreate\(null\))/,
        `$1\n${SHARE_METHODS}`
      );
    }

    // 3. Inject onNewIntent and helper functions before class closing brace
    if (!contents.includes('rewriteShareIntent(intent: Intent, caller: String)')) {
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
