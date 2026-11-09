// App-owned addition to ReactVision/virocore v3.0.3 (MIT).
// Included once, by VROSceneRendererOpenXR.cpp. All XR/GL work stays on its render thread.
#pragma once
#include <jni.h>
#include <mutex>
#include <cstring>
#include <algorithm>
#include <android/log.h>
#include <cmath>

namespace medical_panel {
struct State {
    std::mutex mutex;
    bool visible = false;
    int status = 0;
    uint64_t revision = 0;
    int width = 0, height = 0;
    float widthM = 0.92f, heightM = 0.52f;
    XrPosef pose = {{0, 0, 0, 1}, {0, 0, -1}};
    std::vector<uint8_t> pixels;
};
static State state;
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_questpanel_QuestPanelModule_nativeVersion(JNIEnv *, jobject) { return 2; }

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_questpanel_QuestPanelModule_nativeStatus(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(medical_panel::state.mutex);
    return medical_panel::state.status;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_questpanel_QuestPanelModule_nativeHide(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(medical_panel::state.mutex);
    medical_panel::state.visible = false;
    medical_panel::state.status = 0;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_questpanel_QuestPanelModule_nativePose(JNIEnv *env, jobject, jfloatArray pose) {
    if (env->GetArrayLength(pose) != 7) return;
    float p[7]; env->GetFloatArrayRegion(pose, 0, 7, p);
    std::lock_guard<std::mutex> lock(medical_panel::state.mutex);
    medical_panel::state.pose = {{p[3], p[4], p[5], p[6]}, {p[0], p[1], p[2]}};
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_questpanel_QuestPanelModule_nativeDraw(
        JNIEnv *env, jobject, jbyteArray rgba, jint width, jint height, jfloat widthM, jfloat heightM) {
    if (width < 1 || height < 1 || width > 4096 || height > 4096 ||
        env->GetArrayLength(rgba) != width * height * 4 ||
        !std::isfinite(widthM) || widthM <= 0 || widthM > 2 ||
        !std::isfinite(heightM) || heightM <= 0 || heightM > 2) return;
    std::lock_guard<std::mutex> lock(medical_panel::state.mutex);
    auto &s = medical_panel::state;
    s.width = width; s.height = height;
    s.widthM = widthM; s.heightM = heightM;
    s.pixels.resize(width * height * 4);
    // Canvas has a top-left origin; OpenGL textures have a bottom-left origin.
    for (int y = 0; y < height; ++y) {
        env->GetByteArrayRegion(rgba, y * width * 4, width * 4,
            reinterpret_cast<jbyte *>(s.pixels.data() + (height - y - 1) * width * 4));
    }
    s.visible = true; ++s.revision;
}

class MedicalQuestPanel {
    XrSwapchain _swapchain = XR_NULL_HANDLE;
    std::vector<XrSwapchainImageOpenGLESKHR> _images;
    uint64_t _revision = 0;
    int _width = 0, _height = 0;
    XrCompositionLayerQuad _layer = { XR_TYPE_COMPOSITION_LAYER_QUAD };
public:
    ~MedicalQuestPanel() { if (_swapchain) xrDestroySwapchain(_swapchain); }

    const XrCompositionLayerBaseHeader *prepare(XrSession session, XrSpace space) {
        std::lock_guard<std::mutex> lock(medical_panel::state.mutex);
        auto &s = medical_panel::state;
        if (!s.visible || s.pixels.empty()) return nullptr;
        if (_swapchain && (_width != s.width || _height != s.height)) {
            xrDestroySwapchain(_swapchain); _swapchain = XR_NULL_HANDLE; _revision = 0;
        }
        if (!_swapchain) {
            uint32_t count = 0;
            if (XR_FAILED(xrEnumerateSwapchainFormats(session, 0, &count, nullptr))) return nullptr;
            std::vector<int64_t> formats(count);
            if (XR_FAILED(xrEnumerateSwapchainFormats(session, count, &count, formats.data()))) return nullptr;
            const int64_t format = std::find(formats.begin(), formats.end(), GL_SRGB8_ALPHA8) != formats.end()
                ? GL_SRGB8_ALPHA8 : GL_RGBA8;
            if (std::find(formats.begin(), formats.end(), format) == formats.end()) return nullptr;
            XrSwapchainCreateInfo info = { XR_TYPE_SWAPCHAIN_CREATE_INFO };
            info.usageFlags = XR_SWAPCHAIN_USAGE_SAMPLED_BIT | XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_TRANSFER_DST_BIT;
            info.format = format; info.sampleCount = 1;
            info.width = s.width; info.height = s.height;
            info.faceCount = 1; info.arraySize = 1; info.mipCount = 1;
            if (XR_FAILED(xrCreateSwapchain(session, &info, &_swapchain))) {
                s.status = -1; return nullptr;
            }
            _width = s.width; _height = s.height;
            if (XR_FAILED(xrEnumerateSwapchainImages(_swapchain, 0, &count, nullptr))) {
                xrDestroySwapchain(_swapchain); _swapchain = XR_NULL_HANDLE; return nullptr;
            }
            _images.resize(count, {XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR});
            if (XR_FAILED(xrEnumerateSwapchainImages(_swapchain, count, &count,
                reinterpret_cast<XrSwapchainImageBaseHeader *>(_images.data())))) {
                xrDestroySwapchain(_swapchain); _swapchain = XR_NULL_HANDLE; return nullptr;
            }
        }
        if (_revision != s.revision) {
            uint32_t index = 0;
            XrSwapchainImageAcquireInfo acquire = {XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
            if (XR_FAILED(xrAcquireSwapchainImage(_swapchain, &acquire, &index))) return nullptr;
            XrSwapchainImageWaitInfo wait = {XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
            wait.timeout = XR_INFINITE_DURATION;
            if (XR_FAILED(xrWaitSwapchainImage(_swapchain, &wait))) return nullptr;
            // Preserve Viro's GL state; it owns this context.
            GLint texture = 0, arrayTexture = 0, alignment = 0, unpackBuffer = 0;
            GLint rowLength = 0, skipRows = 0, skipPixels = 0;
            glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);
            glGetIntegerv(GL_TEXTURE_BINDING_2D_ARRAY, &arrayTexture);
            glGetIntegerv(GL_UNPACK_ALIGNMENT, &alignment);
            glGetIntegerv(GL_PIXEL_UNPACK_BUFFER_BINDING, &unpackBuffer);
            glGetIntegerv(GL_UNPACK_ROW_LENGTH, &rowLength);
            glGetIntegerv(GL_UNPACK_SKIP_ROWS, &skipRows);
            glGetIntegerv(GL_UNPACK_SKIP_PIXELS, &skipPixels);
            // Attribute errors to this upload, rather than to an earlier scene draw.
            for (int i = 0; i < 16 && glGetError() != GL_NO_ERROR; ++i) {}
            glBindBuffer(GL_PIXEL_UNPACK_BUFFER, 0);
            glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
            glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
            glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
            glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
            // Quest can return array textures even when swapchain arraySize is one.
            glBindTexture(GL_TEXTURE_2D, _images[index].image);
            GLenum uploadError = glGetError();
            GLenum target = GL_TEXTURE_2D;
            if (uploadError == GL_INVALID_OPERATION) {
                target = GL_TEXTURE_2D_ARRAY;
                glBindTexture(target, _images[index].image);
                uploadError = glGetError();
            }
            if (uploadError == GL_NO_ERROR) {
                if (target == GL_TEXTURE_2D_ARRAY) {
                    glTexSubImage3D(target, 0, 0, 0, 0, _width, _height, 1,
                                    GL_RGBA, GL_UNSIGNED_BYTE, s.pixels.data());
                } else {
                    glTexSubImage2D(target, 0, 0, 0, _width, _height,
                                    GL_RGBA, GL_UNSIGNED_BYTE, s.pixels.data());
                }
                uploadError = glGetError();
            }
            glPixelStorei(GL_UNPACK_ALIGNMENT, alignment);
            glPixelStorei(GL_UNPACK_ROW_LENGTH, rowLength);
            glPixelStorei(GL_UNPACK_SKIP_ROWS, skipRows);
            glPixelStorei(GL_UNPACK_SKIP_PIXELS, skipPixels);
            glBindTexture(GL_TEXTURE_2D, texture);
            glBindTexture(GL_TEXTURE_2D_ARRAY, arrayTexture);
            glBindBuffer(GL_PIXEL_UNPACK_BUFFER, unpackBuffer);
            glFlush();
            XrSwapchainImageReleaseInfo release = {XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
            if (XR_FAILED(xrReleaseSwapchainImage(_swapchain, &release))) return nullptr;
            if (uploadError != GL_NO_ERROR) {
                __android_log_print(ANDROID_LOG_ERROR, "MedicalQuestPanel",
                    "Panel upload failed: GL=0x%x target=0x%x", uploadError, target);
                s.status = -1;
                return nullptr;
            }
            if (_revision == 0) {
                const auto *pixel = s.pixels.data() + ((_height / 2) * _width + _width / 2) * 4;
                __android_log_print(ANDROID_LOG_INFO, "MedicalQuestPanel",
                    "Panel uploaded: %dx%d target=0x%x centerRGBA=%u,%u,%u,%u",
                    _width, _height, target, pixel[0], pixel[1], pixel[2], pixel[3]);
            }
            _revision = s.revision;
        }
        _layer.space = space;
        _layer.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
        _layer.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
        _layer.subImage.swapchain = _swapchain;
        _layer.subImage.imageRect = {{0, 0}, {_width, _height}};
        _layer.pose = s.pose;
        _layer.size = {s.widthM, s.heightM};
        s.status = 1;
        return reinterpret_cast<const XrCompositionLayerBaseHeader *>(&_layer);
    }
};
