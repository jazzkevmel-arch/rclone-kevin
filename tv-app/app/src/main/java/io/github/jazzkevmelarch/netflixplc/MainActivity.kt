package io.github.jazzkevmelarch.netflixplc

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.util.Base64
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
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
import androidx.core.content.FileProvider
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Netflix PLC for the TV.
 * The screens and all the player controls (seek bar, frames while seeking, speed, subtitles) are the web page
 * netflix/tv/ on GitHub Pages, in a transparent WebView on top of the video, so they change without
 * reinstalling. This app only plays video with Media3 ExoPlayer (hardware decoding) and does what a web page
 * cannot: send the Drive token header, a muted preview behind the focused title, and self-update.
 *
 * Page to app:  Android.play(json), Android.cmd(op, value), Android.preview(json), Android.stopPreview(),
 *               Android.frame(url, seconds), Android.setToken(t), Android.version()
 * App to page:  window.tvState(pos, dur, playing, buffering), window.tvEnded(), window.tvError(msg),
 *               window.tvFrame(seconds, dataUrl), window.tvBack()
 */
@OptIn(UnstableApi::class)
class MainActivity : Activity() {
    companion object {
        const val HOME = "https://jazzkevmel-arch.github.io/rclone-kevin/netflix/tv/"
        const val RELEASE = "https://api.github.com/repos/jazzkevmel-arch/rclone-kevin/releases/tags/tv-latest"
    }

    private lateinit var web: WebView
    private lateinit var playerView: PlayerView
    private lateinit var previewBox: FrameLayout
    private lateinit var previewView: PlayerView
    private lateinit var offline: TextView
    private var player: ExoPlayer? = null
    private var preview: ExoPlayer? = null
    @Volatile private var token = ""
    private val ui = Handler(Looper.getMainLooper())
    // Frames shown while seeking: read on demand from the video file, one at a time; older requests are skipped.
    private val frames = Executors.newSingleThreadExecutor()
    private var retriever: MediaMetadataRetriever? = null
    private var retrieverUrl = ""
    @Volatile private var wantFrame = -1.0

    // Position for the page's controls and subtitles: 4 times a second while a video is open.
    private val ticker = object : Runnable {
        override fun run() {
            val p = player
            if (p != null && playerView.visibility == View.VISIBLE) {
                val pos = p.currentPosition / 1000.0
                val dur = if (p.duration == C.TIME_UNSET) 0.0 else p.duration / 1000.0
                val buffering = p.playbackState == Player.STATE_BUFFERING
                js("window.tvState && window.tvState($pos, $dur, ${p.isPlaying}, $buffering)")
            }
            ui.postDelayed(this, 250)
        }
    }

    private fun js(code: String) = web.evaluateJavascript(code, null)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bg = Color.rgb(11, 13, 18)
        val root = FrameLayout(this)
        root.setBackgroundColor(bg)
        val full = FrameLayout.LayoutParams.MATCH_PARENT

        playerView = PlayerView(this)
        playerView.useController = false
        playerView.visibility = View.GONE
        playerView.setBackgroundColor(Color.BLACK)
        playerView.subtitleView?.visibility = View.GONE   // the page draws the subtitles

        web = WebView(this)
        web.setBackgroundColor(Color.TRANSPARENT)
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

        // Muted preview of the focused title, drawn over the page's hero area with a fade on its left edge.
        previewView = PlayerView(this)
        previewView.useController = false
        previewView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        previewView.setShutterBackgroundColor(Color.TRANSPARENT)
        previewBox = FrameLayout(this)
        previewBox.visibility = View.GONE
        previewBox.isFocusable = false
        previewBox.addView(previewView, FrameLayout.LayoutParams(full, full))
        val fadeLeft = View(this)
        fadeLeft.background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(bg, Color.TRANSPARENT))
        previewBox.addView(fadeLeft, FrameLayout.LayoutParams(dp(220), full, Gravity.START))
        val fadeBottom = View(this)
        fadeBottom.background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(bg, Color.TRANSPARENT))
        previewBox.addView(fadeBottom, FrameLayout.LayoutParams(full, dp(90), Gravity.BOTTOM))

        offline = TextView(this)
        offline.text = "Sin conexión a internet. Reintentando..."
        offline.setTextColor(Color.WHITE)
        offline.textSize = 22f
        offline.gravity = Gravity.CENTER
        offline.setBackgroundColor(bg)
        offline.visibility = View.GONE

        root.addView(playerView, FrameLayout.LayoutParams(full, full))
        root.addView(web, FrameLayout.LayoutParams(full, full))
        root.addView(previewBox, FrameLayout.LayoutParams(0, 0))
        root.addView(offline, FrameLayout.LayoutParams(full, full))
        setContentView(root)
        web.loadUrl(HOME)
        web.requestFocus()
        ui.post(ticker)
        checkUpdate()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    inner class Bridge {
        @JavascriptInterface
        fun play(json: String) {
            ui.post { startVideo(JSONObject(json)) }
        }

        /** op: pause, resume, toggle, seek (seconds), speed (rate), stop */
        @JavascriptInterface
        fun cmd(op: String, value: Double) {
            ui.post {
                val p = player ?: return@post
                when (op) {
                    "pause" -> p.pause()
                    "resume" -> p.play()
                    "toggle" -> if (p.isPlaying) p.pause() else p.play()
                    "seek" -> p.seekTo((value * 1000).toLong().coerceAtLeast(0))
                    "speed" -> p.playbackParameters = PlaybackParameters(value.toFloat().coerceIn(0.25f, 4f))
                    "stop" -> stopVideo()
                }
            }
        }

        /** json: url, hls, start (s), and the hero box in CSS pixels: x, y, w, h, dpr */
        @JavascriptInterface
        fun preview(json: String) {
            ui.post { startPreview(JSONObject(json)) }
        }

        @JavascriptInterface
        fun stopPreview() {
            ui.post { endPreview() }
        }

        @JavascriptInterface
        fun frame(url: String, sec: Double) {
            wantFrame = sec
            frames.execute { grabFrame(url, sec) }
        }

        @JavascriptInterface
        fun setToken(t: String) {
            token = t
        }

        @JavascriptInterface
        fun version(): Int = packageManager.getPackageInfo(packageName, 0).let {
            @Suppress("DEPRECATION")
            if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toInt() else it.versionCode
        }
    }

    private fun newPlayer(): ExoPlayer {
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
        return ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(withToken)).build()
    }

    private fun item(o: JSONObject): MediaItem {
        val b = MediaItem.Builder().setUri(o.getString("url"))
        if (o.optBoolean("hls")) b.setMimeType(MimeTypes.APPLICATION_M3U8)
        return b.build()
    }

    private fun startVideo(o: JSONObject) {
        endPreview()
        if (o.optString("token").isNotEmpty()) token = o.getString("token")
        val p = player ?: newPlayer().also { np ->
            player = np
            np.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) js("window.tvEnded && window.tvEnded()")
                }

                override fun onPlayerError(error: PlaybackException) {
                    js("window.tvError && window.tvError(${JSONObject.quote(error.errorCodeName)})")
                }
            })
        }
        p.setMediaItem(item(o), (o.optDouble("start", 0.0) * 1000).toLong())
        p.playbackParameters = PlaybackParameters(o.optDouble("speed", 1.0).toFloat())
        p.prepare()
        p.playWhenReady = true
        playerView.player = p
        playerView.visibility = View.VISIBLE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.requestFocus()
    }

    private fun grabFrame(url: String, sec: Double) {
        if (wantFrame != sec) return
        try {
            if (retrieverUrl != url) {
                retriever?.release()
                val r = MediaMetadataRetriever()
                val headers = if (url.contains("googleapis.com")) mapOf("Authorization" to "Bearer $token") else mapOf()
                r.setDataSource(url, headers)
                retriever = r
                retrieverUrl = url
            }
            val us = (sec * 1_000_000).toLong()
            val full = retriever?.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return
            val small = Bitmap.createScaledBitmap(full, 320, 320 * full.height / full.width.coerceAtLeast(1), true)
            val out = ByteArrayOutputStream()
            small.compress(Bitmap.CompressFormat.JPEG, 70, out)
            val data = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            ui.post { js("window.tvFrame && window.tvFrame($sec, 'data:image/jpeg;base64,$data')") }
        } catch (_: Exception) {
            retrieverUrl = ""
        }
    }

    private fun stopVideo() {
        player?.stop()
        player?.clearMediaItems()
        playerView.visibility = View.GONE
        frames.execute { retriever?.release(); retriever = null; retrieverUrl = "" }
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.requestFocus()
    }

    private fun startPreview(o: JSONObject) {
        if (playerView.visibility == View.VISIBLE) return
        val dpr = o.optDouble("dpr", 1.0)
        val lp = FrameLayout.LayoutParams((o.getDouble("w") * dpr).toInt(), (o.getDouble("h") * dpr).toInt())
        lp.leftMargin = (o.getDouble("x") * dpr).toInt()
        lp.topMargin = (o.getDouble("y") * dpr).toInt()
        previewBox.layoutParams = lp
        val p = preview ?: newPlayer().also { preview = it; it.volume = 0f; it.repeatMode = Player.REPEAT_MODE_ONE }
        previewView.player = p
        p.setMediaItem(item(o), (o.optDouble("start", 0.0) * 1000).toLong())
        p.prepare()
        p.playWhenReady = true
        previewBox.alpha = 0f
        previewBox.visibility = View.VISIBLE
        p.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() {
                previewBox.animate().alpha(1f).setDuration(600).start()
                p.removeListener(this)
            }
        })
    }

    private fun endPreview() {
        preview?.stop()
        preview?.clearMediaItems()
        previewBox.visibility = View.GONE
    }

    // ---------- updates: when GitHub has a newer build, offer to install it ----------
    private fun checkUpdate() = thread {
        try {
            val c = URL(RELEASE).openConnection() as HttpURLConnection
            c.setRequestProperty("Accept", "application/vnd.github+json")
            val body = JSONObject(c.inputStream.bufferedReader().readText())
            val latest = Regex("""Versión 1\.(\d+)""").find(body.optString("body"))?.groupValues?.get(1)?.toInt() ?: return@thread
            val assets = body.getJSONArray("assets")
            var apk = ""
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                if (a.getString("name").endsWith(".apk")) apk = a.getString("browser_download_url")
            }
            if (latest > Bridge().version() && apk.isNotEmpty()) ui.post { offerUpdate(apk) }
        } catch (_: Exception) { /* no internet or no release: try next time */ }
    }

    private fun offerUpdate(url: String) {
        AlertDialog.Builder(this)
            .setTitle("Hay una versión nueva de Netflix PLC")
            .setMessage("¿La instalo ahora? Tarda menos de un minuto.")
            .setPositiveButton("Instalar") { _, _ -> download(url) }
            .setNegativeButton("Después", null)
            .show()
    }

    private fun download(url: String) {
        val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return
        val file = File(dir, "NetflixPLC-TV.apk")
        file.delete()
        val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val id = dm.enqueue(DownloadManager.Request(Uri.parse(url)).setDestinationUri(Uri.fromFile(file)).setTitle("Netflix PLC"))
        val done = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return
                unregisterReceiver(this)
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", file)
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(done, filter, Context.RECEIVER_EXPORTED)
        else registerReceiver(done, filter)
    }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        if (e.keyCode == KeyEvent.KEYCODE_BACK) {
            // The page decides: close the video or a menu, go back a screen, or close the app on the home screen.
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
        endPreview()
    }

    override fun onStop() {
        super.onStop()
        js("typeof flush === 'function' && flush()")
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        player?.release()
        preview?.release()
        frames.shutdownNow()
        player = null
        preview = null
        web.destroy()
        super.onDestroy()
    }
}
