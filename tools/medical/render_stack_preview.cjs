/* Standard textured planes only; desktop preview of the fallback, never iOS acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseMedicalVolumeDataset,
} = require('../../src/features/medical-viewer/medical-volumes.ts');
const { MedicalController } = require('../../src/features/medical-viewer/medical-controller.ts');
const { stackPlaneGeometry } = require('../../src/features/medical-viewer/medical-volume-stack.ts');
const {
  STACK_IOS_COLOR_FRAGMENT,
} = require('../../src/features/medical-viewer/medical-stack-color.ts');

module.exports = async function renderStackPreview(browser, directory) {
  const metadata = JSON.parse(fs.readFileSync('assets/medical/stack/metadata.json', 'utf8'));
  const data = parseMedicalVolumeDataset(
    JSON.parse(fs.readFileSync('assets/medical/volumes/metadata.json', 'utf8'))
  );
  const c = new MedicalController(undefined, undefined, data);
  const results = [];
  for (const [preset, series] of Object.entries(metadata.presets)) {
    const state = {
      ...c.getSnapshot().volume,
      modality: series.modality,
      appearance: {
        ...c.getSnapshot().volume.appearance,
        [series.modality]: { ...c.getSnapshot().volume.appearance[series.modality], preset },
      },
    };
    const geometry = stackPlaneGeometry(data, state, series.planes);
    const files = series.planes.map(
      (plane) =>
        'data:image/png;base64,' +
        fs.readFileSync(path.join('assets/medical/stack', plane.filename)).toString('base64')
    );
    const page = await browser.newPage();
    try {
      const result = await page.evaluate(
        async ({ geometry, files, colorCorrection }) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 320;
          const gl = canvas.getContext('webgl2', {
            preserveDrawingBuffer: true,
            premultipliedAlpha: true,
          });
          if (!gl) throw new Error('WebGL2 unavailable');
          const p = gl.createProgram();
          for (const [kind, source] of [
            [
              gl.VERTEX_SHADER,
              `#version 300 es
precision highp float;in vec3 position;in vec2 texcoord;out vec2 uv;uniform mat4 view;
void main(){uv=texcoord;gl_Position=view*vec4(position,1.);}`,
            ],
            [
              gl.FRAGMENT_SHADER,
              `#version 300 es
precision highp float;in vec2 uv;uniform sampler2D image;uniform float opacity;out vec4 color;
void main(){vec4 pixel=texture(image,uv);
vec4 _output_color=vec4(pixel.rgb,pixel.a*opacity);
struct Surface { vec4 diffuse_color; }; Surface _surface; _surface.diffuse_color=pixel;
${colorCorrection}
color=_output_color;}`,
            ],
          ]) {
            const shader = gl.createShader(kind);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
              throw new Error(gl.getShaderInfoLog(shader));
            gl.attachShader(p, shader);
          }
          gl.linkProgram(p);
          if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
          gl.useProgram(p);
          // Orthographic diagonal camera; all planes remain horizontal, no ray marching.
          const normalize = (v) => v.map((n) => n / Math.hypot(...v));
          const cross = (a, b) => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ];
          const forward = normalize([-0.9, 0.6, 1]),
            right = normalize(cross([0, 1, 0], forward)),
            up = cross(forward, right);
          const view = [
            right[0] * 2.6,
            up[0] * 2.6,
            forward[0] * 0.5,
            0,
            right[1] * 2.6,
            up[1] * 2.6,
            forward[1] * 0.5,
            0,
            right[2] * 2.6,
            up[2] * 2.6,
            forward[2] * 0.5,
            0,
            0,
            0,
            0,
            1,
          ];
          gl.uniformMatrix4fv(gl.getUniformLocation(p, 'view'), false, view);
          gl.uniform1i(gl.getUniformLocation(p, 'image'), 0);
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            gl.ONE_MINUS_SRC_ALPHA,
            gl.ONE,
            gl.ONE_MINUS_SRC_ALPHA
          );
          gl.viewport(0, 0, 320, 320);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          for (const plane of geometry.filter((plane) => plane.visible)) {
            const image = new Image();
            image.src = files[plane.index];
            await image.decode();
            gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
            // Match VROImageiOS's premultiplied encoded sRGB upload, rather than
            // silently testing the browser's default straight-alpha conversion.
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const [x, y, z] = plane.position,
              [r0, a1, r1, a0] = plane.uv,
              w = plane.width / 2,
              h = plane.height / 2;
            const vertices = new Float32Array([
              x - w,
              y,
              z - h,
              r0,
              a1,
              x - w,
              y,
              z + h,
              r0,
              a0,
              x + w,
              y,
              z + h,
              r1,
              a0,
              x - w,
              y,
              z - h,
              r0,
              a1,
              x + w,
              y,
              z + h,
              r1,
              a0,
              x + w,
              y,
              z - h,
              r1,
              a1,
            ]);
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
            for (const [name, size, offset] of [
              ['position', 3, 0],
              ['texcoord', 2, 12],
            ]) {
              const attribute = gl.getAttribLocation(p, name);
              gl.enableVertexAttribArray(attribute);
              gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 20, offset);
            }
            gl.uniform1f(gl.getUniformLocation(p, 'opacity'), plane.opacity);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
          }
          const pixels = new Uint8Array(320 * 320 * 4);
          gl.readPixels(0, 0, 320, 320, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let transparent = 0,
            anatomy = 0;
          for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] === 0) transparent++;
            else anatomy++;
          }
          return {
            transparent,
            anatomy,
            glError: gl.getError(),
            png: canvas.toDataURL('image/png'),
          };
        },
        { geometry, files, colorCorrection: STACK_IOS_COLOR_FRAGMENT }
      );
      assert.equal(result.glError, 0);
      assert.ok(
        result.transparent > 320 * 320 * 0.25 && result.anatomy > 500,
        `${preset}: transparent air and visible scan required`
      );
      fs.writeFileSync(
        path.join(directory, `${preset}-stack.png`),
        Buffer.from(result.png.split(',')[1], 'base64')
      );
      results.push({ preset, transparentPixels: result.transparent, scanPixels: result.anatomy });
    } finally {
      await page.close();
    }
  }
  fs.writeFileSync(
    path.join(directory, 'stack-proof.json'),
    JSON.stringify({ nativeDrawingVerified: false, results }, null, 2) + '\n'
  );
  return results;
};
