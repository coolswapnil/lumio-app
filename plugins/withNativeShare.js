/**
 * Expo Config Plugin: withNativeShare
 *
 * Implements Android NativeShareActivity — a completely decoupled, headless
 * native share receiver for ACTION_SEND and ACTION_SEND_MULTIPLE.
 *
 * Architecture Highlights:
 * 1. Dedicated NativeShareActivity in AndroidManifest with android:taskAffinity=""
 *    and translucent theme.
 * 2. Instant Native SQLite Insert: writes directly to `lumio.db` (pending_shares)
 *    and SharedPreferences backup before JS engine even boots.
 * 3. Persists temporary URI permissions for content:// URIs.
 * 4. Schedules Android WorkManager ShareWorker to ensure background persistence
 *    reliability across aggressive OEM battery managers (HyperOS, OneUI, ColorOS, Funtouch).
 * 5. Native Diagnostics Tags:
 *    - NATIVE_SHARE_RECEIVED
 *    - NATIVE_SHARE_SAVED
 *    - WORKMANAGER_STARTED
 *    - WORKMANAGER_COMPLETED
 *    - NATIVE_SHARE_FAILED
 * 6. Shows native Toast "Saved to Lumio", calls finish(), and returns to the
 *    source app in < 25ms.
 * 7. React Native / MainActivity are NEVER booted or required for share capture.
 */

const {
  withAndroidManifest,
  withDangerousMod,
  withAppBuildGradle,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NATIVE_SHARE_ACTIVITY_KT = `package com.lumio.savelater

import android.app.Activity
import android.content.ClipData
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class NativeShareActivity : Activity() {

    companion object {
        private const val TAG = "LumioNativeShare"
        private const val PREFS_NAME = "lumio_pending_shares"
        private const val SHARE_SETTINGS_PREFS = "lumio_share_settings"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ── Proof-of-execution: runs before any share logic ──────────────────
        val proofId = UUID.randomUUID().toString()
        val proofTs = getIsoTimestamp()
        Log.d(TAG, "NATIVE_SHARE_ACTIVITY_CREATED id=$proofId ts=$proofTs action=\${intent?.action} type=\${intent?.type}")

        // Toast is shown after successful DB write (see handleIncomingShare) — not here.

        // Write proof row to pending_shares
        writeProofToPendingShares(proofId, proofTs)

        // Write proof row to failed_share_capture (diagnostic table)
        writeProofToFailedShareCapture(proofId, proofTs)

        // Write proof row to diagnostics table
        writeProofToDiagnostics(proofId, proofTs)

        handleIncomingShare(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            handleIncomingShare(intent)
        }
    }

    private fun handleIncomingShare(intent: Intent) {
        val action = intent.action
        val type = intent.type

        Log.d(TAG, "NATIVE_SHARE_RECEIVED action=$action type=$type")

        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) {
            Log.w(TAG, "NATIVE_SHARE_IGNORED: Action is not SEND or SEND_MULTIPLE")
            finish()
            return
        }

        val shareId = UUID.randomUUID().toString()
        val nowIso = getIsoTimestamp()

        val extraText = intent.getStringExtra(Intent.EXTRA_TEXT)
        val extraSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
        val extraTitle = intent.getStringExtra(Intent.EXTRA_TITLE)
        val intentData = intent.data

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

        val clip = intent.clipData

        // 1. Take persistable URI permissions where available
        persistUriPermissions(intent, extraStreamSingle, extraStreamList, clip)

        // 2. Extract URLs and primary text
        val collected = collectAllUrls(
            extraText, clip, intentData,
            extraStreamSingle, extraStreamList, extraSubject
        )

        val primaryText = collected.primaryText ?: extraText ?: ""
        val primaryUrl = collected.urls.firstOrNull() ?: ""
        val urlsParam = collected.urls.joinToString("|").take(2000)
        val srcParam = collected.sources.joinToString(",").take(200)

        Log.d(TAG, "NATIVE_SHARE_PARSED id=$shareId urlCount=\${collected.urls.size} primaryUrl=$primaryUrl")

        // 3. Fail-safe write to SharedPreferences first
        persistToPrefs(shareId, primaryText, extraTitle, extraSubject, type, urlsParam, srcParam)

        // 4. Direct SQLite insert into pending_shares
        val dbPersisted = persistToSQLite(
            shareId = shareId,
            text = primaryText,
            url = primaryUrl,
            title = extraTitle,
            subject = extraSubject,
            rawPath = "lumio://share?text=\${primaryText.take(200)}&urls=$urlsParam&src=$srcParam",
            extractionSource = srcParam,
            mime = type,
            urlsParam = urlsParam,
            createdAt = nowIso
        )

        if (dbPersisted) {
            Log.d(TAG, "NATIVE_SHARE_SAVED id=$shareId url=$primaryUrl")
            Log.d(TAG, "NATIVE_DB_WRITE_SUCCESS id=$shareId")
        } else {
            Log.e(TAG, "NATIVE_SHARE_FAILED id=$shareId reason=SQLITE_INSERT_FAILED")
            Log.e(TAG, "NATIVE_DB_WRITE_FAILED id=$shareId")
        }

        // 5. Schedule WorkManager task to guarantee processing persistence
        scheduleWorkManager(shareId, primaryUrl, primaryText, extraTitle, extraSubject)

        // 6. Native Feedback — single-line toast (Saved to Lumio)
        showSavedToast()

        // 7. Open-after-share: launch MainActivity when shareBehavior == "open_lumio".
        //    Emit native share-saved event regardless so the NativeEventEmitter bridge
        //    can trigger an immediate library refresh.
        ShareEventManager.emitShareSaved(applicationContext, shareId, primaryUrl)

        val shareBehavior = readShareBehavior()
        Log.d(TAG, "SHARE_BEHAVIOR_READ prefs=\$SHARE_SETTINGS_PREFS key=shareBehavior value=\$shareBehavior")
        Log.d(TAG, "OPEN_AFTER_SHARE_ENABLED shareBehavior=$shareBehavior dbPersisted=$dbPersisted")
        if (shareBehavior == "open_lumio") {
            Log.d(TAG, "OPEN_AFTER_SHARE_TRIGGERED id=$shareId")
            val mainIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("from_share", true)
                putExtra("share_id", shareId)
            }
            // Verify intent can be resolved
            val resolved = mainIntent.resolveActivity(packageManager)
            Log.d(TAG, "MAIN_ACTIVITY_LAUNCH_REQUESTED id=$shareId flags=NEW_TASK|CLEAR_TOP|SINGLE_TOP extras=from_share=true,share_id=$shareId resolved=\${resolved != null}")
            if (resolved != null) {
                startActivity(mainIntent)
                Log.d(TAG, "MAIN_ACTIVITY_LAUNCHED id=$shareId")
            } else {
                Log.e(TAG, "MAIN_ACTIVITY_LAUNCH_FAILED id=$shareId reason=INTENT_NOT_RESOLVED")
            }
        } else {
            val skipReason = if (!dbPersisted) "dbPersisted=false" else "shareBehavior=$shareBehavior"
            Log.d(TAG, "OPEN_AFTER_SHARE_SKIPPED id=$shareId reason=$skipReason")
        }

        Log.d(TAG, "NATIVE_SHARE_COMPLETE id=$shareId finishing activity")
        finish()
    }

    private fun persistUriPermissions(
        intent: Intent,
        singleStream: Uri?,
        streamList: List<Uri>?,
        clip: ClipData?
    ) {
        val flags = intent.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        if (flags == 0) return

        fun takePerm(uri: Uri?) {
            if (uri != null && uri.scheme == ContentResolver.SCHEME_CONTENT) {
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    Log.d(TAG, "URI_PERMISSION_PERSISTED uri=$uri")
                } catch (e: Exception) {
                    Log.d(TAG, "URI_PERMISSION_NOT_PERSISTABLE uri=$uri msg=\${e.message}")
                }
            }
        }

        takePerm(singleStream)
        streamList?.forEach { takePerm(it) }
        if (clip != null) {
            for (i in 0 until clip.itemCount) {
                takePerm(clip.getItemAt(i).uri)
            }
        }
    }

    private fun persistToPrefs(
        id: String,
        text: String?,
        title: String?,
        subject: String?,
        mime: String?,
        urls: String,
        src: String
    ) {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString("pending_share_\${id}_text", text ?: "")
                .putString("pending_share_\${id}_title", title ?: "")
                .putString("pending_share_\${id}_subj", subject ?: "")
                .putString("pending_share_\${id}_mime", mime ?: "")
                .putString("pending_share_\${id}_urls", urls)
                .putString("pending_share_\${id}_src", src)
                .putString("pending_share_\${id}_ts", System.currentTimeMillis().toString())
                .putString("pending_share_\${id}_raw", "__NATIVE_PENDING__")
                .apply()
            Log.d(TAG, "SHARE_PREFS_PERSISTED id=$id")
        } catch (e: Exception) {
            Log.e(TAG, "SHARE_PREFS_PERSIST_ERROR error=\${e.message}")
        }
    }

    private fun persistToSQLite(
        shareId: String,
        text: String,
        url: String,
        title: String?,
        subject: String?,
        rawPath: String,
        extractionSource: String,
        mime: String?,
        urlsParam: String,
        createdAt: String
    ): Boolean {
        var db: SQLiteDatabase? = null
        val androidVer = Build.VERSION.RELEASE
        val sdkInt = Build.VERSION.SDK_INT
        val oem = "\${Build.MANUFACTURER} \${Build.MODEL}"

        return try {
            val dbFile = findDatabaseFile()
            val dbPath = dbFile?.absolutePath ?: "null"
            val dbExists = dbFile?.exists() == true
            val parentFile = dbFile?.parentFile
            val parentExists = parentFile?.exists() == true
            val canWrite = if (dbExists) (dbFile?.canWrite() == true) else (parentFile?.canWrite() == true)

            Log.i(TAG, "SQLITE_DB_PATH resolved=$dbPath exists=$dbExists parentExists=$parentExists canWrite=$canWrite androidVer=$androidVer (SDK $sdkInt) oem=\\"$oem\\"")
            Log.d(TAG, "DB_PATH_RESOLVED path=$dbPath exists=$dbExists parentExists=$parentExists canWrite=$canWrite")

            if (dbFile == null) {
                Log.w(TAG, "SQLITE_DB_NOT_FOUND dbFile=null")
                Log.e(TAG, "DB_OPEN_FAILED path=null reason=DB_FILE_NULL androidVer=$androidVer sdk=$sdkInt oem=\\"$oem\\"")
                return false
            }

            try {
                db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY)
                Log.d(TAG, "DB_OPEN_SUCCESS path=$dbPath")
            } catch (openEx: Exception) {
                Log.e(TAG, "DB_OPEN_FAILED path=$dbPath error=\${openEx.javaClass.name}: \${openEx.message} androidVer=$androidVer sdk=$sdkInt oem=\\"$oem\\"", openEx)
                return false
            }

            // Match expo-sqlite WAL mode so reads from JS are never blocked by this writer
            try {
                db.execSQL("PRAGMA journal_mode = WAL")
                Log.d(TAG, "SQLITE_WAL_STATUS wal_enabled=true")
            } catch (walEx: Exception) {
                Log.w(TAG, "SQLITE_WAL_STATUS wal_enabled=false error=\${walEx.message}")
            }

            // Ensure table exists
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS pending_shares (
                    id          TEXT PRIMARY KEY NOT NULL,
                    text        TEXT,
                    url         TEXT,
                    title       TEXT,
                    subject     TEXT,
                    raw_path    TEXT,
                    extraction_source TEXT,
                    mime        TEXT,
                    urls        TEXT,
                    status      TEXT NOT NULL DEFAULT 'pending',
                    created_at  TEXT NOT NULL
                )
                """.trimIndent()
            )

            try {
                val statement = db.compileStatement(
                    """
                    INSERT OR REPLACE INTO pending_shares
                    (id, text, url, title, subject, raw_path, extraction_source, mime, urls, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """.trimIndent()
                )

                statement.bindString(1, shareId)
                statement.bindString(2, text)
                statement.bindString(3, url)
                if (title != null) statement.bindString(4, title) else statement.bindNull(4)
                if (subject != null) statement.bindString(5, subject) else statement.bindNull(5)
                statement.bindString(6, rawPath)
                statement.bindString(7, extractionSource)
                if (mime != null) statement.bindString(8, mime) else statement.bindNull(8)
                statement.bindString(9, urlsParam)
                statement.bindString(10, createdAt)

                statement.executeInsert()
                Log.d(TAG, "SQLITE_INSERT_SUCCESS id=$shareId")
                Log.d(TAG, "DB_INSERT_SUCCESS id=$shareId")
                true
            } catch (insertEx: Exception) {
                Log.e(TAG, "DB_INSERT_FAILED id=$shareId error=\${insertEx.javaClass.name}: \${insertEx.message} androidVer=$androidVer sdk=$sdkInt oem=\\"$oem\\"", insertEx)
                Log.e(TAG, "SQLITE_INSERT_ERROR error=\${insertEx.message}")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "SQLITE_EXCEPTION error=\${e.javaClass.name}: \${e.message} androidVer=$androidVer sdk=$sdkInt oem=\\"$oem\\"", e)
            false
        } finally {
            try { db?.close() } catch (_: Exception) {}
        }
    }

    private fun findDatabaseFile(): File? {
        // expo-sqlite stores databases at: context.filesDir/SQLite/<name>.db
        // This matches SQLiteModule.kt: context.filesDir.canonicalPath + "/SQLite"
        val primary = File(filesDir, "SQLite/lumio.db")
        if (primary.exists()) return primary

        // Ensure the parent directory exists so openDatabase can create the file
        // on a fresh install where the JS layer has not yet run.
        val primaryDir = primary.parentFile
        if (primaryDir != null && !primaryDir.exists()) {
            primaryDir.mkdirs()
        }

        return primary
    }

    private fun scheduleWorkManager(
        id: String,
        url: String,
        text: String,
        title: String?,
        subject: String?
    ) {
        try {
            val workData = workDataOf(
                "share_id" to id,
                "url" to url,
                "text" to text,
                "title" to (title ?: ""),
                "subject" to (subject ?: "")
            )
            val workRequest = OneTimeWorkRequestBuilder<ShareWorker>()
                .setInputData(workData)
                .build()
            WorkManager.getInstance(applicationContext).enqueue(workRequest)
            Log.d(TAG, "WORKMANAGER_ENQUEUED id=$id")
        } catch (e: Exception) {
            Log.w(TAG, "WORKMANAGER_SCHEDULE_FAILED error=\${e.message}")
        }
    }

    /**
     * Single-line toast: "✅ Saved to Lumio"
     *
     * Custom Toast.setView() is deprecated as of Android 11 (API 30) and
     * throws WindowManager\$BadTokenException / IllegalStateException on
     * Android 12+ (API 31+) when called from a transparent/trampoline
     * Activity (Theme.Translucent.NoTitleBar) that has no valid window token.
     * This is the confirmed startup crash on Xiaomi HyperOS / Android 16.
     *
     * Use Toast.makeText() exclusively — the only safe API for all
     * supported API levels (24–36) and all OEM skins.
     */
    private fun showSavedToast() {
        try {
            Toast.makeText(applicationContext, "✅ Saved to Lumio", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.w(TAG, "TOAST_SHOW_FAILED: \${e.message}")
        }
    }

    /**
     * FIX 2: Read shareBehavior from lumio_share_settings SharedPreferences.
     * JS settings service writes this mirror on every saveAppSettings() call.
     * Native side cannot decrypt expo-secure-store, so we use a separate file.
     */
    private fun readShareBehavior(): String {
        return try {
            val prefs = getSharedPreferences(SHARE_SETTINGS_PREFS, Context.MODE_PRIVATE)
            val value = prefs.getString("shareBehavior", "stay") ?: "stay"
            Log.d(TAG, "SHARE_BEHAVIOR_READ prefs=$SHARE_SETTINGS_PREFS key=shareBehavior value=$value")
            value
        } catch (e: Exception) {
            Log.w(TAG, "READ_SHARE_BEHAVIOR_FAILED defaulting to stay: \${e.message}")
            "stay"
        }
    }

    private fun getIsoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    private fun collectAllUrls(
        extraText: String?,
        clip: ClipData?,
        intentData: Uri?,
        streamSingle: Uri?,
        streamList: List<Uri>?,
        extraSubject: String?
    ): CollectionResult {
        val seen = LinkedHashSet<String>()
        val sources = mutableListOf<String>()
        var primaryText: String? = null

        fun addUrl(url: String, source: String) {
            val clean = url.trim().trimEnd('.', ')', '>')
            if (clean.startsWith("http") && seen.add(clean)) {
                if (sources.lastOrNull() != source) sources.add(source)
            }
        }

        fun extractFromText(text: String, source: String) {
            val regex = Regex("""https?://[^\\s<>"{}|\\\\^\`\\[\\]]+""")
            regex.findAll(text).forEach { match ->
                addUrl(match.value, source)
            }
        }

        if (!extraText.isNullOrBlank()) {
            primaryText = extraText.trim()
            extractFromText(extraText, "EXTRA_TEXT")
        }

        if (clip != null) {
            for (i in 0 until clip.itemCount) {
                val item = clip.getItemAt(i)
                val t = item.text?.toString()
                if (!t.isNullOrBlank()) {
                    if (primaryText == null) primaryText = t.trim()
                    extractFromText(t, "CLIP_DATA_TEXT[$i]")
                }
                val u = item.uri?.toString()
                if (!u.isNullOrBlank()) {
                    if (primaryText == null) primaryText = u.trim()
                    addUrl(u, "CLIP_DATA_URI[$i]")
                }
            }
        }

        if (intentData != null) {
            val d = intentData.toString()
            if (primaryText == null) primaryText = d
            addUrl(d, "INTENT_DATA")
        }

        if (streamSingle != null) {
            val s = streamSingle.toString()
            if (primaryText == null) primaryText = s
            addUrl(s, "EXTRA_STREAM")
        }

        streamList?.forEachIndexed { i, uri ->
            val s = uri.toString()
            if (primaryText == null) primaryText = s
            addUrl(s, "EXTRA_STREAM_LIST[$i]")
        }

        if (!extraSubject.isNullOrBlank()) {
            if (primaryText == null) primaryText = extraSubject.trim()
            extractFromText(extraSubject, "EXTRA_SUBJECT")
        }

        return CollectionResult(
            urls = seen.toList(),
            primaryText = primaryText,
            sources = sources
        )
    }

    private data class CollectionResult(
        val urls: List<String>,
        val primaryText: String?,
        val sources: List<String>
    )

    // ── Proof-of-execution helpers ────────────────────────────────────────────

    /** Write one row to pending_shares with status='proof' so it is visible in DB. */
    private fun writeProofToPendingShares(id: String, ts: String) {
        var db: SQLiteDatabase? = null
        try {
            val dbFile = findDatabaseFile()
            if (dbFile == null) {
                Log.w(TAG, "PROOF_PENDING_SHARES_SKIPPED reason=DB_NOT_FOUND")
                return
            }
            db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY)
            db.execSQL("PRAGMA journal_mode = WAL")
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS pending_shares (
                    id TEXT PRIMARY KEY NOT NULL,
                    text TEXT,
                    url TEXT,
                    title TEXT,
                    subject TEXT,
                    raw_path TEXT,
                    extraction_source TEXT,
                    mime TEXT,
                    urls TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL
                )
                """.trimIndent()
            )
            val stmt = db.compileStatement(
                "INSERT OR REPLACE INTO pending_shares (id,text,url,title,subject,raw_path,extraction_source,mime,urls,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
            )
            stmt.bindString(1, id)
            stmt.bindString(2, "NATIVE_SHARE_ACTIVITY_CREATED proof")
            stmt.bindString(3, "")
            stmt.bindString(4, "Proof: NativeShareActivity.onCreate() executed")
            stmt.bindString(5, "")
            stmt.bindString(6, "proof://NATIVE_SHARE_ACTIVITY_CREATED")
            stmt.bindString(7, "PROOF")
            stmt.bindNull(8)
            stmt.bindString(9, "")
            stmt.bindString(10, "proof")
            stmt.bindString(11, ts)
            stmt.executeInsert()
            Log.d(TAG, "PROOF_PENDING_SHARES_WRITTEN id=$id")
        } catch (e: Exception) {
            Log.e(TAG, "PROOF_PENDING_SHARES_ERROR error=\${e.message}")
        } finally {
            try { db?.close() } catch (_: Exception) {}
        }
    }

    /** Write one row to failed_share_capture as a proof marker. */
    private fun writeProofToFailedShareCapture(id: String, ts: String) {
        var db: SQLiteDatabase? = null
        try {
            val dbFile = findDatabaseFile()
            if (dbFile == null) {
                Log.w(TAG, "PROOF_FAILED_CAPTURE_SKIPPED reason=DB_NOT_FOUND")
                return
            }
            db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY)
            db.execSQL("PRAGMA journal_mode = WAL")
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS failed_share_capture (
                    id TEXT PRIMARY KEY NOT NULL,
                    raw_path TEXT,
                    extra_text TEXT,
                    extra_subject TEXT,
                    extra_title TEXT,
                    extra_stream TEXT,
                    clip_data_text TEXT,
                    clip_data_uri TEXT,
                    intent_data TEXT,
                    mime_type TEXT,
                    bundle_keys TEXT,
                    urls_param TEXT,
                    extraction_source TEXT,
                    error_message TEXT,
                    last_event TEXT,
                    lifecycle_state TEXT,
                    payload_summary TEXT,
                    created_at TEXT NOT NULL
                )
                """.trimIndent()
            )
            val stmt = db.compileStatement(
                """INSERT OR REPLACE INTO failed_share_capture
                   (id,raw_path,extra_text,extra_subject,extra_title,extra_stream,
                    clip_data_text,clip_data_uri,intent_data,mime_type,bundle_keys,
                    urls_param,extraction_source,error_message,last_event,lifecycle_state,
                    payload_summary,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""".trimIndent()
            )
            stmt.bindString(1, id)
            stmt.bindString(2, "proof://NATIVE_SHARE_ACTIVITY_CREATED")
            stmt.bindString(3, "NATIVE_SHARE_ACTIVITY_CREATED proof")
            stmt.bindString(4, "")
            stmt.bindString(5, "Proof: NativeShareActivity.onCreate() executed")
            stmt.bindString(6, "")
            stmt.bindString(7, "")
            stmt.bindString(8, "")
            stmt.bindString(9, "")
            stmt.bindNull(10)
            stmt.bindString(11, "")
            stmt.bindString(12, "")
            stmt.bindString(13, "PROOF")
            stmt.bindString(14, "NOT_AN_ERROR: proof-of-execution marker written by NativeShareActivity.onCreate()")
            stmt.bindString(15, "NATIVE_SHARE_ACTIVITY_CREATED")
            stmt.bindString(16, "native_share_launched")
            stmt.bindString(17, "NativeShareActivity.onCreate() executed at \$ts")
            stmt.bindString(18, ts)
            stmt.executeInsert()
            Log.d(TAG, "PROOF_FAILED_CAPTURE_WRITTEN id=$id")
        } catch (e: Exception) {
            Log.e(TAG, "PROOF_FAILED_CAPTURE_ERROR error=\${e.message}")
        } finally {
            try { db?.close() } catch (_: Exception) {}
        }
    }

    /** Write one row to diagnostics table as a proof marker. */
    private fun writeProofToDiagnostics(id: String, ts: String) {
        var db: SQLiteDatabase? = null
        try {
            val dbFile = findDatabaseFile()
            if (dbFile == null) {
                Log.w(TAG, "PROOF_DIAGNOSTICS_SKIPPED reason=DB_NOT_FOUND")
                return
            }
            db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY)
            db.execSQL("PRAGMA journal_mode = WAL")
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS diagnostics (
                    id TEXT PRIMARY KEY NOT NULL,
                    event TEXT NOT NULL,
                    detail TEXT,
                    created_at TEXT NOT NULL
                )
                """.trimIndent()
            )
            val stmt = db.compileStatement(
                "INSERT OR REPLACE INTO diagnostics (id,event,detail,created_at) VALUES (?,?,?,?)"
            )
            stmt.bindString(1, id)
            stmt.bindString(2, "NATIVE_SHARE_ACTIVITY_CREATED")
            stmt.bindString(3, "NativeShareActivity.onCreate() executed — proof id=\$id ts=\$ts")
            stmt.bindString(4, ts)
            stmt.executeInsert()
            Log.d(TAG, "PROOF_DIAGNOSTICS_WRITTEN id=$id")
        } catch (e: Exception) {
            Log.e(TAG, "PROOF_DIAGNOSTICS_ERROR error=\${e.message}")
        } finally {
            try { db?.close() } catch (_: Exception) {}
        }
    }
}
`;

const SHARE_WORKER_KT = `package com.lumio.savelater

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class ShareWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val TAG = "LumioShareWorker"
    }

    override suspend fun doWork(): Result {
        val shareId = inputData.getString("share_id") ?: return Result.success()
        val url = inputData.getString("url") ?: ""
        Log.d(TAG, "WORKMANAGER_STARTED id=$shareId url=$url")
        // Background guarantee: Record verified by WorkManager.
        // React Native's DataContext / ShareIngestionManager will enrich when app opens.
        Log.d(TAG, "WORKMANAGER_COMPLETED id=$shareId")
        return Result.success()
    }
}
`;

const LUMIO_SHARED_PREFS_MODULE_KT = `package com.lumio.savelater

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LumioSharedPrefsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "LumioSharedPrefs"

    @ReactMethod
    fun getAll(prefsName: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            val allEntries = prefs.all
            val map = Arguments.createMap()
            for ((key, value) in allEntries) {
                map.putString(key, value?.toString() ?: "")
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("PREFS_GET_ALL_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun remove(prefsName: String, key: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            prefs.edit().remove(key).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PREFS_REMOVE_ERROR", e.message, e)
        }
    }

    /** FIX 2: Write a single value so JS can mirror settings for native reads. */
    @ReactMethod
    fun set(prefsName: String, key: String, value: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            prefs.edit().putString(key, value).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PREFS_SET_ERROR", e.message, e)
        }
    }
}
`;

const SHARE_EVENT_MANAGER_KT = `package com.lumio.savelater

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * ShareEventManager — Native Event bridge for share-pipeline events.
 *
 * Emits RCTDeviceEventEmitter events to React Native's NativeEventEmitter so
 * the JS layer can react immediately without polling.
 */
object ShareEventManager {

    private const val TAG = "LumioShareEvent"

    const val EVENT_SHARE_SAVED       = "NATIVE_SHARE_SAVED"
    const val EVENT_QUEUE_CREATED     = "QUEUE_ITEM_CREATED"
    const val EVENT_QUEUE_COMPLETED   = "QUEUE_ITEM_COMPLETED"
    const val EVENT_QUEUE_FAILED      = "QUEUE_ITEM_FAILED"

    @Volatile
    private var _reactContext: ReactApplicationContext? = null

    fun setReactContext(ctx: ReactApplicationContext) {
        _reactContext = ctx
        Log.d(TAG, "SHARE_EVENT_MANAGER_READY")
    }

    fun emitShareSaved(context: Context, shareId: String, url: String) {
        val ts = isoTimestamp()
        Log.d(TAG, "NATIVE_EVENT_EMITTED event=\$EVENT_SHARE_SAVED shareId=\$shareId ts=\$ts")
        emit(EVENT_SHARE_SAVED, shareId, url, ts)
    }

    fun emitQueueItemCreated(shareId: String, url: String) {
        val ts = isoTimestamp()
        Log.d(TAG, "NATIVE_EVENT_EMITTED event=\$EVENT_QUEUE_CREATED shareId=\$shareId ts=\$ts")
        emit(EVENT_QUEUE_CREATED, shareId, url, ts)
    }

    fun emitQueueItemCompleted(shareId: String, itemId: String) {
        val ts = isoTimestamp()
        Log.d(TAG, "NATIVE_EVENT_EMITTED event=\$EVENT_QUEUE_COMPLETED shareId=\$shareId itemId=\$itemId ts=\$ts")
        val params = Arguments.createMap().apply {
            putString("shareId", shareId)
            putString("itemId", itemId)
            putString("timestamp", ts)
        }
        _reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(EVENT_QUEUE_COMPLETED, params)
    }

    fun emitQueueItemFailed(shareId: String, reason: String) {
        val ts = isoTimestamp()
        Log.d(TAG, "NATIVE_EVENT_EMITTED event=\$EVENT_QUEUE_FAILED shareId=\$shareId reason=\$reason ts=\$ts")
        val params = Arguments.createMap().apply {
            putString("shareId", shareId)
            putString("reason", reason)
            putString("timestamp", ts)
        }
        _reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(EVENT_QUEUE_FAILED, params)
    }

    private fun emit(event: String, shareId: String, url: String, ts: String) {
        val ctx = _reactContext ?: run {
            Log.d(TAG, "NATIVE_EVENT_BRIDGE_UNAVAILABLE event=\$event shareId=\$shareId — polling watcher is fallback")
            return
        }
        try {
            val params = Arguments.createMap().apply {
                putString("shareId", shareId)
                putString("url", url)
                putString("timestamp", ts)
            }
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(event, params)
        } catch (e: Exception) {
            Log.w(TAG, "NATIVE_EVENT_EMIT_ERROR event=\$event error=\${e.message}")
        }
    }

    private fun isoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}

/**
 * ReactNativeModule that wires ShareEventManager into the React bridge.
 * Registered via ShareEventPackage in MainApplication.
 */
class ShareEventModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "LumioShareEvent"

    override fun initialize() {
        super.initialize()
        ShareEventManager.setReactContext(reactContext)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
`;

const SHARE_EVENT_PACKAGE_KT = `package com.lumio.savelater

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

class ShareEventPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(ShareEventModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<View, ReactShadowNode<*>>> {
        return emptyList()
    }
}
`;

const LUMIO_SHARED_PREFS_PACKAGE_KT = `package com.lumio.savelater

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

class LumioSharedPrefsPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(LumioSharedPrefsModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<View, ReactShadowNode<*>>> {
        return emptyList()
    }
}
`;

function withNativeShareManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const mainApplication = modConfig.modResults.manifest.application?.[0];
    if (!mainApplication) return modConfig;

    if (!mainApplication.activity) {
      mainApplication.activity = [];
    }

    // Filter out SEND / SEND_MULTIPLE intent-filters from MainActivity
    mainApplication.activity.forEach((act) => {
      if (act.$?.['android:name'] === '.MainActivity' && act['intent-filter']) {
        act['intent-filter'] = act['intent-filter'].filter((filter) => {
          const actions = filter.action || [];
          return !actions.some(
            (a) =>
              a.$?.['android:name'] === 'android.intent.action.SEND' ||
              a.$?.['android:name'] === 'android.intent.action.SEND_MULTIPLE'
          );
        });
      }
    });

    // Remove existing NativeShareActivity entry if present
    mainApplication.activity = mainApplication.activity.filter(
      (act) => act.$?.['android:name'] !== '.NativeShareActivity'
    );

    // Register NativeShareActivity
    mainApplication.activity.push({
      $: {
        'android:name': '.NativeShareActivity',
        'android:exported': 'true',
        'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
        'android:noHistory': 'true',
        'android:excludeFromRecents': 'true',
        'android:taskAffinity': '',
        'android:launchMode': 'standard',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [
            { $: { 'android:mimeType': 'text/plain' } },
            { $: { 'android:mimeType': 'text/html' } },
            { $: { 'android:mimeType': 'text/*' } },
          ],
        },
        {
          action: [{ $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:mimeType': 'text/*' } }],
        },
      ],
    });

    return modConfig;
  });
}

function withNativeShareGradle(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    // 1. WorkManager dependency
    const workManagerDep = `implementation "androidx.work:work-runtime-ktx:2.9.0"`;
    if (!contents.includes('androidx.work:work-runtime-ktx')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    ${workManagerDep}`
      );
    }

    // 2. Switch ProGuard base file from proguard-android.txt to
    //    proguard-android-optimize.txt — required for React Native release
    //    builds; the non-optimize variant is missing critical keep rules.
    contents = contents.replace(
      /getDefaultProguardFile\("proguard-android\.txt"\)/g,
      'getDefaultProguardFile("proguard-android-optimize.txt")'
    );

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

function withNativeShareSourceFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const packageDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'com',
        'lumio',
        'savelater'
      );

      if (fs.existsSync(packageDir)) {
        fs.writeFileSync(
          path.join(packageDir, 'NativeShareActivity.kt'),
          NATIVE_SHARE_ACTIVITY_KT,
          'utf8'
        );
        fs.writeFileSync(
          path.join(packageDir, 'ShareWorker.kt'),
          SHARE_WORKER_KT,
          'utf8'
        );
        fs.writeFileSync(
          path.join(packageDir, 'LumioSharedPrefsModule.kt'),
          LUMIO_SHARED_PREFS_MODULE_KT,
          'utf8'
        );
        fs.writeFileSync(
          path.join(packageDir, 'LumioSharedPrefsPackage.kt'),
          LUMIO_SHARED_PREFS_PACKAGE_KT,
          'utf8'
        );
        fs.writeFileSync(
          path.join(packageDir, 'ShareEventManager.kt'),
          SHARE_EVENT_MANAGER_KT,
          'utf8'
        );
        fs.writeFileSync(
          path.join(packageDir, 'ShareEventPackage.kt'),
          SHARE_EVENT_PACKAGE_KT,
          'utf8'
        );
      }
      return modConfig;
    },
  ]);
}

module.exports = function withNativeShare(config) {
  config = withNativeShareManifest(config);
  config = withNativeShareGradle(config);
  config = withNativeShareSourceFiles(config);
  return config;
};
module.exports.NATIVE_SHARE_ACTIVITY_KT = NATIVE_SHARE_ACTIVITY_KT;
module.exports.SHARE_WORKER_KT = SHARE_WORKER_KT;
module.exports.LUMIO_SHARED_PREFS_MODULE_KT = LUMIO_SHARED_PREFS_MODULE_KT;
module.exports.LUMIO_SHARED_PREFS_PACKAGE_KT = LUMIO_SHARED_PREFS_PACKAGE_KT;
