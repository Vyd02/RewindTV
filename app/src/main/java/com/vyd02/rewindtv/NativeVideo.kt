package com.vyd02.rewindtv

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.TextureView
import android.widget.FrameLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * Plays video with the TV's own hardware player (ExoPlayer) underneath the
 * see-through web page. The page drives it and gets events back through [emit].
 */
class NativeVideo(ctx: Context, private val emit: (String, Long, Long) -> Unit) {

    val box = FrameLayout(ctx).apply { setBackgroundColor(Color.BLACK); pivotX = 0f; pivotY = 0f }
    private val surface = TextureView(ctx)
    private val main = Handler(Looper.getMainLooper())
    private var videoW = 16; private var videoH = 9; private var pixelRatio = 1f

    private val player: ExoPlayer = ExoPlayer.Builder(ctx)
        .setMediaSourceFactory(
            DefaultMediaSourceFactory(
                DefaultHttpDataSource.Factory()
                    .setUserAgent("RewindTV/1.0 (Android TV)")
                    .setAllowCrossProtocolRedirects(true)
                    .setConnectTimeoutMs(15000)
                    .setReadTimeoutMs(20000)
            )
        )
        .build()

    private var sentMeta = false

    init {
        box.addView(surface, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        player.setVideoTextureView(surface)
        box.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> fitSurface() }
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_READY -> {
                        if (!sentMeta) { sentMeta = true; emit("meta", player.currentPosition, dur()) }
                        if (player.playWhenReady) emit("playing", player.currentPosition, dur())
                    }
                    Player.STATE_BUFFERING -> emit("waiting", player.currentPosition, dur())
                    Player.STATE_ENDED -> emit("ended", player.currentPosition, dur())
                    else -> {}
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) emit("playing", player.currentPosition, dur())
            }
            override fun onPlayerError(error: PlaybackException) { emit("error", 0, 0) }
            override fun onVideoSizeChanged(size: VideoSize) {
                if (size.width > 0 && size.height > 0) {
                    videoW = size.width; videoH = size.height; pixelRatio = size.pixelWidthHeightRatio
                    fitSurface()
                }
            }
        })
        tick()
    }

    private fun dur(): Long = player.duration.let { if (it < 0) 0 else it }

    /** Letterbox the picture inside the box, like the TV would. */
    private fun fitSurface() {
        val bw = box.width; val bh = box.height
        if (bw == 0 || bh == 0) return
        val aspect = videoW * pixelRatio / videoH
        var w = bw; var h = (bw / aspect).toInt()
        if (h > bh) { h = bh; w = (bh * aspect).toInt() }
        val lp = surface.layoutParams as FrameLayout.LayoutParams
        if (lp.width != w || lp.height != h) {
            lp.width = w; lp.height = h; lp.gravity = Gravity.CENTER
            surface.layoutParams = lp
        }
    }

    private fun tick() {
        if (player.isPlaying) emit("time", player.currentPosition, dur())
        main.postDelayed({ tick() }, 500)
    }

    fun load(url: String, startMs: Long) {
        sentMeta = false
        player.setMediaItem(MediaItem.fromUri(url), startMs.coerceAtLeast(0))
        player.prepare()
    }
    fun play() { player.playWhenReady = true; player.play() }
    fun pause() { player.pause() }
    fun stop() { player.stop(); player.clearMediaItems() }
    fun seek(ms: Long) { player.seekTo(ms.coerceAtLeast(0)) }

    /** Move/shrink the picture (fractions of the screen) — used for the guide's preview box. */
    fun rect(x: Float, y: Float, w: Float, h: Float) {
        val parent = box.parent as? android.view.View ?: return
        box.animate()
            .translationX(x * parent.width).translationY(y * parent.height)
            .scaleX(w).scaleY(h)
            .setDuration(450).start()
    }

    fun release() { main.removeCallbacksAndMessages(null); player.release() }
}
