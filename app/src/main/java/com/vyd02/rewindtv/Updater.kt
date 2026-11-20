package com.vyd02.rewindtv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebResourceResponse
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Two kinds of updates, both pulled from GitHub (Vyd02/RewindTV):
 *  1. The screen itself (channels, look, controls) lives in a few web files. Those are
 *     downloaded on every launch and used right away. No install needed.
 *  2. If a new APK release exists, it's downloaded and the Fire TV install screen pops up.
 */
object Updater {
    private const val RAW = "https://raw.githubusercontent.com/Vyd02/RewindTV/"
    private const val PATH = "/app/src/main/assets/"
    private const val HEAD = "https://api.github.com/repos/Vyd02/RewindTV/commits/main"
    private const val LATEST = "https://api.github.com/repos/Vyd02/RewindTV/releases/latest"
    private val WEB_FILES = listOf("index.html", "style.css", "app.js", "channels.js")

    private fun open(url: String, connect: Int = 4000, read: Int = 8000): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = connect
        c.readTimeout = read
        c.instanceFollowRedirects = true
        c.setRequestProperty("User-Agent", "RewindTV")
        c.setRequestProperty("Cache-Control", "no-cache")
        return c
    }

    private fun webDir(ctx: Context) = File(ctx.filesDir, "web")

    /** Short id of the screen files in use ("" = the ones built into the APK). */
    fun webVersion(ctx: Context): String = File(webDir(ctx), ".sha").let { if (it.isFile) it.readText().take(7) else "" }

    /** Set when this launch pulled down newer screen files than last time. */
    @Volatile var freshWeb = false

    /**
     * Download the newest web files. Asks GitHub for the exact latest commit first, so a
     * cached copy can never be served. Only swaps files in if every one came down OK.
     */
    fun syncWeb(ctx: Context): Boolean {
        val tmp = File(ctx.filesDir, "web_tmp").apply { deleteRecursively(); mkdirs() }
        try {
            val sha = try {
                val c = open(HEAD); c.setRequestProperty("Accept", "application/vnd.github.sha")
                if (c.responseCode == 200) c.inputStream.bufferedReader().use { it.readText().trim() } else "main"
            } catch (e: Exception) { "main" }
            if (sha != "main" && File(webDir(ctx), ".sha").let { it.isFile && it.readText() == sha }) return true
            for (name in WEB_FILES) {
                val c = open(RAW + sha + PATH + name + "?t=" + System.currentTimeMillis() / 60000)
                if (c.responseCode != 200) return false
                val bytes = c.inputStream.use { it.readBytes() }
                if (bytes.size < 50) return false
                File(tmp, name).writeBytes(bytes)
            }
            File(tmp, ".sha").writeText(sha)
            val dir = webDir(ctx)
            val had = dir.isDirectory
            dir.deleteRecursively()
            val ok = tmp.renameTo(dir)
            if (ok && had) freshWeb = true
            return ok
        } catch (e: Exception) {
            return false
        } finally {
            tmp.deleteRecursively()
        }
    }

    /** Serves downloaded web files first, then falls back to the copies built into the APK. */
    class Handler(private val ctx: Context) : WebViewAssetLoader.PathHandler {
        private val bundled = WebViewAssetLoader.AssetsPathHandler(ctx)
        override fun handle(path: String): WebResourceResponse? {
            val f = File(webDir(ctx), path)
            if (path in WEB_FILES && f.isFile) {
                val mime = when {
                    path.endsWith(".html") -> "text/html"
                    path.endsWith(".css") -> "text/css"
                    else -> "application/javascript"
                }
                return WebResourceResponse(mime, "utf-8", FileInputStream(f))
            }
            return bundled.handle(path)
        }
    }

    /** Checks GitHub for a newer APK. Calls [say] with short messages for the screen. */
    fun checkApk(act: Activity, say: (String) -> Unit) {
        try {
            val json = JSONObject(open(LATEST).inputStream.bufferedReader().use { it.readText() })
            val latest = json.getString("tag_name").substringAfterLast('.').toIntOrNull() ?: return
            if (latest <= BuildConfig.VERSION_CODE) return
            val assets = json.getJSONArray("assets")
            var url: String? = null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                if (a.getString("name").endsWith(".apk")) url = a.getString("browser_download_url")
            }
            if (url == null) return

            say("Downloading update…")
            val dir = File(act.cacheDir, "updates").apply { mkdirs() }
            val apk = File(dir, "RewindTV.apk")
            open(url, 10000, 60000).inputStream.use { input -> apk.outputStream().use { input.copyTo(it) } }

            act.runOnUiThread {
                if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
                    say("Allow Rewind TV to install updates, then press BACK")
                    act.startActivity(
                        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.packageName))
                    )
                    pendingApk = apk
                    return@runOnUiThread
                }
                install(act, apk)
            }
        } catch (e: Exception) {
            // No internet or GitHub hiccup: just try again next launch.
        }
    }

    var pendingApk: File? = null

    fun install(act: Activity, apk: File) {
        pendingApk = null
        val uri = FileProvider.getUriForFile(act, act.packageName + ".updates", apk)
        val i = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        act.startActivity(i)
    }
}
