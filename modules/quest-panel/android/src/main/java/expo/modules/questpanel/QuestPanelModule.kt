package expo.modules.questpanel

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.concurrent.Executors

class QuestPanelModule : Module() {
  @Volatile private var owner = 0
  @Volatile private var drawFailed = false
  private val drawLock = Any()
  private val queueLock = Any()
  private val drawExecutor = Executors.newSingleThreadExecutor()
  private var pendingDraw: Pair<Int, String>? = null
  private var drawRunning = false
  private var panelBitmap: Bitmap? = null
  private var panelPixels: ByteBuffer? = null
  private fun releaseRaster() {
    panelBitmap?.recycle()
    panelBitmap = null
    panelPixels = null
  }
  private external fun nativeVersion(): Int
  private external fun nativeStatus(): Int
  private external fun nativeDraw(rgba: ByteArray, width: Int, height: Int, widthM: Float, heightM: Float)
  private external fun nativePose(pose: FloatArray)
  private external fun nativeHide()

  private fun available(): Boolean = try {
    System.loadLibrary("viro_renderer")
    nativeVersion() == 3
  } catch (_: LinkageError) { false }

  private fun renderPanel(id: Int, json: String) = synchronized(drawLock) {
    if (id != owner) return@synchronized
    check(available()) { "Quest compositor renderer is not installed" }
    val spec = JSONObject(json)
    val logicalHeight = spec.getDouble("height").toFloat()
    val bodyHeight = spec.getDouble("bodyHeight").toFloat()
    val heightM = spec.getDouble("heightM").toFloat()
    val logicalWidth = 1450f
    val pixelWidth = 2970
    val widthM = 0.92f * logicalWidth / 1000f
    require(logicalHeight in 200f..1500f && bodyHeight in 1f..logicalHeight && heightM.isFinite() && heightM > 0f)
    val pixelHeight = kotlin.math.round(2048f * heightM / 0.92f).toInt()
    if (panelBitmap?.height != pixelHeight || panelBitmap?.width != pixelWidth) {
      releaseRaster()
      panelBitmap = Bitmap.createBitmap(pixelWidth, pixelHeight, Bitmap.Config.ARGB_8888)
      panelPixels = ByteBuffer.allocate(panelBitmap!!.byteCount)
    }
    val bitmap = panelBitmap!!
    val pixels = panelPixels!!
    run {
      val canvas = Canvas(bitmap)
      canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
      canvas.scale(pixelWidth / logicalWidth, pixelHeight / logicalHeight)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG)
      paint.color = Color.rgb(15, 23, 42)
      canvas.drawRoundRect(RectF(0f, 0f, 1000f, bodyHeight), 24f, 24f, paint)
      canvas.drawRoundRect(RectF(1040f, 0f, 1450f, 340f), 24f, 24f, paint)
      val items = spec.getJSONArray("items")
      for (i in 0 until items.length()) {
        val item = items.getJSONObject(i)
        val x = item.getDouble("x").toFloat()
        val y = item.getDouble("y").toFloat()
        val w = item.getDouble("width").toFloat()
        val h = item.getDouble("height").toFloat()
        if (item.has("fill")) {
          paint.color = Color.parseColor(item.getString("fill"))
          canvas.drawRoundRect(RectF(x - w / 2, y - h / 2, x + w / 2, y + h / 2), 12f, 12f, paint)
        }
        val rawLabel = item.getString("label")
        if (rawLabel.isEmpty()) continue
        val text = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        text.color = Color.parseColor(item.optString("color", "#f8fafc"))
        text.textSize = item.optDouble("font", 26.0).toFloat()
        text.typeface = if (item.optBoolean("selected")) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        text.textAlign = Paint.Align.CENTER
        val label = TextUtils.ellipsize(rawLabel, text, (w - 24f).coerceAtLeast(0f), TextUtils.TruncateAt.END).toString()
        canvas.drawText(label, x, y - (text.ascent() + text.descent()) / 2f, text)
      }
      pixels.rewind()
      bitmap.copyPixelsToBuffer(pixels)
      nativeDraw(pixels.array(), bitmap.width, bitmap.height, widthM, heightM)
    }
  }

  private fun enqueueDraw(id: Int, json: String) {
    synchronized(queueLock) {
      pendingDraw = id to json
      if (drawRunning) return
      drawRunning = true
      drawExecutor.execute {
        while (true) {
          val next = synchronized(queueLock) {
            val value = pendingDraw
            pendingDraw = null
            if (value == null) drawRunning = false
            value
          } ?: break
          try { renderPanel(next.first, next.second) }
          catch (error: Throwable) {
            if (next.first == owner) drawFailed = true
            Log.e("QuestPanel", "Panel draw failed", error)
            synchronized(queueLock) { pendingDraw = null; drawRunning = false }
            break
          }
        }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("QuestPanel")
    Function("isAvailable") { available() }
    Function("open") { synchronized(drawLock) { check(available()); nativeHide(); drawFailed = false; ++owner } }
    Function("status") { id: Int -> if (id == owner && !drawFailed) nativeStatus() else -1 }
    Function("setPose") { id: Int, values: List<Double> ->
      require(values.size == 7 && values.all { it.isFinite() })
      if (id == owner) nativePose(values.map { it.toFloat() }.toFloatArray())
    }
    Function("hide") { id: Int -> synchronized(drawLock) { if (id == owner) { ++owner; if (available()) nativeHide(); releaseRaster() } } }
    Function("draw") { id: Int, json: String ->
      if (id == owner) enqueueDraw(id, json)
    }
    OnDestroy { synchronized(drawLock) { ++owner; if (available()) nativeHide(); releaseRaster() }; drawExecutor.shutdown() }
  }
}
