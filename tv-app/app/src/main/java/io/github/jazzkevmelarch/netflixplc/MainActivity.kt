package io.github.jazzkevmelarch.netflixplc

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONObject

/**
 * Netflix PLC for the TV.
 * The screens (rows, course pages, search) are the web page netflix/tv/ on GitHub Pages, shown in a WebView,
 * so they update without reinstalling the app. Videos play here, in the native Media3 ExoPlayer:
 * hardware decoding, fast seeking and the remote's media keys. Google Drive videos need the user's
 * access token, which the page passes in and renews (setToken) during long videos.
 */
@OptIn(UnstableApi::class)
class MainActivity : Activity() {
    companion object {
        const val HOME = "https://jazzkevmel-arch.github.io/rclone-kevin/netflix/tv/"
    }

    private lateinit var web: WebView
    private lateinit var playerView: PlayerView
    private lateinit var title: TextView
    private lateinit var offline: TextView
    private var player: ExoPlayer? = null
    @Volatile private var token = ""
    private val ui = Handler(Looper.getMainLooper())
    // Key codes whose DOWN was handled here, so their UP is not passed on to the player controls.
    private val consumed = HashSet<Int>()

    private val progress = object : Runnable {
        override fun run() {
            report("tvProgress", false)
            ui.postDelayed(this, 5000)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bg = Color.rgb(11, 13, 18)
        val root = FrameLayout(this)
        root.setBackgroundColor(bg)

        title = TextView(this)
        title.setTextColor(Color.WHITE)
        title.textSize = 20f
        title.setShadowLayer(12f, 0f, 0f, Color.BLACK)
        title.setPadding(64, 40, 64, 0)
        title.visibility = View.GONE

        offline = TextView(this)
        offline.text = "Sin conexión a internet. Reintentando..."
        offline.setTextColor(Color.WHITE)
        offline.textSize = 22f
        offline.gravity = Gravity.CENTER
        offline.setBackgroundColor(bg)
        offline.visibility = View.GONE

        web = WebView(this)
        web.setBackgroundColor(bg)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.addJavascriptInterface(Bridge(), "Android")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    offline.visibility = View.VISIBLE
                    ui.postDelayed({ view.loadUrl(HOME) }, 8000)
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (url.startsWith(HOME)) offline.visibility = View.GONE
            }
        }
        web.isFocusable = true
        web.isFocusableInTouchMode = true

        playerView = PlayerView(this)
        playerView.visibility = View.GONE
        playerView.setBackgroundColor(Color.BLACK)
        playerView.setShowSubtitleButton(true)
        playerView.setShowNextButton(false)
        playerView.setShowPreviousButton(false)
        playerView.controllerShowTimeoutMs = 4000
        playerView.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v ->
            title.visibility = if (v == View.VISIBLE) View.VISIBLE else View.GONE
        })

        val full = FrameLayout.LayoutParams.MATCH_PARENT
        root.addView(web, FrameLayout.LayoutParams(full, full))
        root.addView(playerView, FrameLayout.LayoutParams(full, full))
        root.addView(title, FrameLayout.LayoutParams(full, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        root.addView(offline, FrameLayout.LayoutParams(full, full))
        setContentView(root)
        web.loadUrl(HOME)
        web.requestFocus()
    }

    /** Methods the page calls as window.Android.play(...) and window.Android.setToken(...). */
    inner class Bridge {
        @JavascriptInterface
        fun play(json: String) {
            ui.post { startVideo(JSONObject(json)) }
        }

        @JavascriptInterface
        fun setToken(t: String) {
            token = t
        }
    }

    private fun buildPlayer(): ExoPlayer {
        // Adds the Drive token only to Google API requests; the EPLAN streams (Bunny CDN) are public.
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000)
        val withToken = ResolvingDataSource.Factory(http) { spec ->
            if (spec.uri.host == "www.googleapis.com" && token.isNotEmpty())
                spec.withAdditionalHeaders(mapOf("Authorization" to "Bearer $token"))
            else spec
        }
        val p = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(withToken))
            .setSeekBackIncrementMs(10000)
            .setSeekForwardIncrementMs(10000)
            .build()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) closePlayer(true)
            }

            override fun onPlayerError(error: PlaybackException) {
                val msg = JSONObject.quote(error.errorCodeName)
                closePlayer(false)
                web.evaluateJavascript("window.tvError && window.tvError($msg)", null)
            }
        })
        return p
    }

    private fun startVideo(o: JSONObject) {
        if (o.optString("token").isNotEmpty()) token = o.getString("token")
        val p = player ?: buildPlayer().also { player = it }
        val item = MediaItem.Builder().setUri(o.getString("url"))
        if (o.optBoolean("hls")) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        val sub = o.optString("sub")
        if (sub.isNotEmpty()) {
            item.setSubtitleConfigurations(
                listOf(
                    MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub))
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setLanguage("es")
                        .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                        .build()
                )
            )
        }
        p.setMediaItem(item.build(), o.optLong("start", 0))
        p.prepare()
        p.playWhenReady = true
        title.text = o.optString("title")
        playerView.player = p
        playerView.visibility = View.VISIBLE
        playerView.requestFocus()
        playerView.showController()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ui.removeCallbacks(progress)
        ui.postDelayed(progress, 5000)
    }

    /** Sends the position to the page: window.tvProgress(pos, dur, playing) or window.tvClosed(pos, dur, ended). */
    private fun report(fn: String, ended: Boolean) {
        val p = player ?: return
        if (playerView.visibility != View.VISIBLE) return
        val pos = p.currentPosition / 1000.0
        val dur = if (p.duration == C.TIME_UNSET) 0.0 else p.duration / 1000.0
        val third = if (fn == "tvClosed") ended else p.isPlaying
        web.evaluateJavascript("window.$fn && window.$fn($pos, $dur, $third)", null)
    }

    private fun closePlayer(ended: Boolean) {
        if (playerView.visibility != View.VISIBLE) return
        ui.removeCallbacks(progress)
        report("tvClosed", ended)
        player?.stop()
        player?.clearMediaItems()
        playerView.visibility = View.GONE
        title.visibility = View.GONE
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.requestFocus()
    }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        val code = e.keyCode
        if (e.action == KeyEvent.ACTION_UP && consumed.remove(code)) return true
        if (playerView.visibility == View.VISIBLE) {
            if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
                if (e.action == KeyEvent.ACTION_UP) closePlayer(false)
                return true
            }
            // With the controls hidden: left and right jump 10 s and OK pauses or plays, like streaming apps.
            val p = player
            if (p != null && e.action == KeyEvent.ACTION_DOWN && !playerView.isControllerFullyVisible) {
                val handled = when (code) {
                    KeyEvent.KEYCODE_DPAD_LEFT -> { p.seekBack(); true }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> { p.seekForward(); true }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                        if (p.isPlaying) p.pause() else p.play()
                        true
                    }
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> true
                    else -> false
                }
                if (handled) {
                    consumed.add(code)
                    playerView.showController()
                    return true
                }
            }
            return playerView.dispatchKeyEvent(e) || super.dispatchKeyEvent(e)
        }
        if (code == KeyEvent.KEYCODE_BACK) {
            // The page decides: go back inside the app, or close the app on the home screen.
            if (e.action == KeyEvent.ACTION_UP) {
                web.evaluateJavascript("window.tvBack ? String(window.tvBack()) : 'false'") { r ->
                    if (r == null || r.contains("false")) finish()
                }
            }
            return true
        }
        return super.dispatchKeyEvent(e)
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onStop() {
        super.onStop()
        report("tvProgress", false)
        web.evaluateJavascript("typeof flush === 'function' && flush()", null)
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        web.destroy()
        super.onDestroy()
    }
}
