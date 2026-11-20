package com.vyd02.rewindtv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private lateinit var web: WebView
    private val pool = Executors.newFixedThreadPool(6)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", Updater.Handler(this))
            .build()

        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = false
            useWideViewPort = false
            textZoom = 100
            setSupportZoom(false)
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
        }
        web.addJavascriptInterface(Bridge(), "Android")
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        setContentView(web)
        web.requestFocus()

        // Grab the newest screen files from GitHub (wait up to 3 seconds), then turn the TV on.
        val ready = java.util.concurrent.CountDownLatch(1)
        pool.execute { Updater.syncWeb(this); ready.countDown() }
        pool.execute {
            ready.await(3, java.util.concurrent.TimeUnit.SECONDS)
            web.post { web.loadUrl("https://appassets.androidplatform.net/assets/index.html") }
            // Then look for a newer APK in the background.
            Thread.sleep(8000)
            Updater.checkApk(this) { msg -> web.post { web.evaluateJavascript("window.RT && RT.toast(${JSONObject.quote(msg)})", null) } }
        }
    }

    /** Keys the WebView does not turn into normal browser keys get passed to the page by name. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val name = when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> "Up"
            KeyEvent.KEYCODE_DPAD_DOWN -> "Down"
            KeyEvent.KEYCODE_DPAD_LEFT -> "Left"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "Right"
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "OK"
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> (event.keyCode - KeyEvent.KEYCODE_0).toString()
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> "ChannelUp"
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> "ChannelDown"
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "PlayPause"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "Rewind"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "FastForward"
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_GUIDE, KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_TV,
            KeyEvent.KEYCODE_DVR, KeyEvent.KEYCODE_PROG_RED -> "Guide"
            KeyEvent.KEYCODE_BACK -> "Back"
            KeyEvent.KEYCODE_LAST_CHANNEL -> "Flashback"
            else -> null
        }
        if (name != null) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                web.evaluateJavascript("window.RT && RT.remote('$name')", null)
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onPause() {
        super.onPause()
        web.evaluateJavascript("window.RT && RT.sleep()", null)
    }

    override fun onResume() {
        super.onResume()
        web.evaluateJavascript("window.RT && RT.wake()", null)
        val apk = Updater.pendingApk
        if (apk != null && (android.os.Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls())) {
            Updater.install(this, apk)
        }
    }

    override fun onDestroy() {
        pool.shutdownNow()
        web.destroy()
        super.onDestroy()
    }

    inner class Bridge {
        /** Fetches a URL off the main thread (avoids CORS) and hands the text back to the page. */
        @JavascriptInterface
        fun get(url: String, id: Int) {
            pool.execute {
                var ok = false
                var body = ""
                try {
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.connectTimeout = 15000
                    c.readTimeout = 30000
                    c.setRequestProperty("User-Agent", "RewindTV/1.0 (Android TV)")
                    body = c.inputStream.bufferedReader().use { it.readText() }
                    ok = c.responseCode in 200..299
                    c.disconnect()
                } catch (e: Exception) {
                    body = e.toString()
                }
                val js = "RT._got($id, $ok, ${JSONObject.quote(body)})"
                web.post { web.evaluateJavascript(js, null) }
            }
        }

        @JavascriptInterface
        fun exit() {
            runOnUiThread { finish() }
        }
    }
}
