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
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.nio.ByteBuffer

class QuestPanelModule : Module() {
  private var owner = 0
  private var panelBitmap: Bitmap? = null
  private var panelPixels: ByteBuffer? = null
  private fun releaseRaster() {
    panelBitmap?.recycle()
    panelBitmap = null
    panelPixels = null
  }
  private external fun nativeVersion(): Int
  private external fun nativeStatus(): Int
  private external fun nativeDraw(rgba: ByteArray, width: Int, height: Int, heightM: Float)
  private external fun nativePose(pose: FloatArray)
  private external fun nativeHide()

  private fun available(): Boolean = try {
    System.loadLibrary("viro_renderer")
    nativeVersion() == 2
  } catch (_: LinkageError) { false }

  override fun definition() = ModuleDefinition {
    Name("QuestPanel")
    Function("isAvailable") { available() }
    Function("open") { check(available()); nativeHide(); ++owner }
    Function("status") { id: Int -> if (id == owner) nativeStatus() else -1 }
    Function("setPose") { id: Int, values: List<Double> ->
      require(values.size == 7 && values.all { it.isFinite() })
      if (id == owner) nativePose(values.map { it.toFloat() }.toFloatArray())
    }
    Function("hide") { id: Int -> if (id == owner) { if (available()) nativeHide(); releaseRaster() } }
    Function("draw") { id: Int, json: String ->
      if (id != owner) return@Function
      check(available()) { "Quest compositor renderer is not installed" }
      val spec = JSONObject(json)
      val logicalHeight = spec.getDouble("height").toFloat()
      val bodyHeight = spec.getDouble("bodyHeight").toFloat()
      val heightM = spec.getDouble("heightM").toFloat()
      require(logicalHeight in 200f..1500f && bodyHeight in 1f..logicalHeight && heightM.isFinite() && heightM > 0f)
      val pixelHeight = kotlin.math.round(2048f * heightM / 0.92f).toInt()
      if (panelBitmap?.height != pixelHeight) {
        releaseRaster()
        panelBitmap = Bitmap.createBitmap(2048, pixelHeight, Bitmap.Config.ARGB_8888)
        panelPixels = ByteBuffer.allocate(panelBitmap!!.byteCount)
      }
      val bitmap = panelBitmap!!
      val pixels = panelPixels!!
      run {
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        canvas.scale(2048f / 1000f, pixelHeight / logicalHeight)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.rgb(15, 23, 42)
        canvas.drawRoundRect(RectF(0f, 0f, 1000f, bodyHeight), 24f, 24f, paint)
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
        nativeDraw(pixels.array(), bitmap.width, bitmap.height, heightM)
      }
    }
    OnDestroy { if (available()) nativeHide(); releaseRaster() }
  }
}
