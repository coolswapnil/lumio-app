/**
 * LumioWidget.kt
 *
 * Android App Widget — Quick-Save Widget for Lumio
 *
 * Displays on the Android home screen as a 2×1 cell widget with:
 *   • "Save to Lumio" button — opens the Lumio save modal directly
 *   • Item count badge — shows how many items are saved
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW TO REGISTER (after `expo prebuild` generates android/ folder):
 *
 * 1. Copy this file to:
 *      android/app/src/main/java/com/lumio/savelater/LumioWidget.kt
 *
 * 2. Create the layout:
 *      android/app/src/main/res/layout/widget_lumio.xml  (see comments below)
 *
 * 3. Create the widget provider XML:
 *      android/app/src/main/res/xml/lumio_widget_info.xml
 *
 * 4. Register in AndroidManifest.xml inside <application>:
 *      <receiver android:name=".LumioWidget" android:exported="true">
 *        <intent-filter>
 *          <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
 *        </intent-filter>
 *        <meta-data
 *          android:name="android.appwidget.provider"
 *          android:resource="@xml/lumio_widget_info" />
 *      </receiver>
 *
 * The CI build script (build-apk.yml) automatically patches these files
 * via the inject-widget.sh step added in v1.1.0.
 * ────────────────────────────────────────────────────────────────────────────
 */
package com.lumio.savelater

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.net.Uri

class LumioWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_lumio)

            // ── "Save" button → opens the save modal via deep link ───────────
            val saveIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("lumio://save")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val savePending = PendingIntent.getActivity(
                context, 0, saveIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_save_btn, savePending)

            // ── App logo → opens Lumio home ──────────────────────────────────
            val openIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("lumio://")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val openPending = PendingIntent.getActivity(
                context, 1, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_logo, openPending)

            // ── Item count from SharedPreferences (updated by RN on every save) ──
            val prefs = context.getSharedPreferences("lumio_widget_prefs", Context.MODE_PRIVATE)
            val count = prefs.getInt("item_count", 0)
            views.setTextViewText(
                R.id.widget_count,
                if (count == 0) "Empty library" else "$count saved"
            )

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
