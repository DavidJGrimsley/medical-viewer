/* Desktop GPU proof, separate from native iOS acceptance. No new app dependency. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const {
  constantFragment,
  quadVertex,
  checkIosTextureOverrideContract,
} = require('./viro_shader_harness.cjs');
const {
  VOLUME_SHADER_UNIFORMS,
  VOLUME_SHADER_BODY,
  volumeSampleGLSL,
} = require('../../src/features/medical-viewer/medical-volume-shader.ts');

async function main() {
  const iosBindingContract = checkIosTextureOverrideContract();
  const executablePath =
    process.env.MEDICAL_TEST_BROWSER ||
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find(fs.existsSync);
  if (!executablePath)
    throw new Error('Set MEDICAL_TEST_BROWSER to a Chromium browser executable.');
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(
      ({ uniforms, sample, nativeFragment, nativeVertex }) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
        if (!gl || !gl.getExtension('EXT_color_buffer_float'))
          throw new Error('WebGL2 float rendering unavailable.');
        const prefix = `#version 300 es\nprecision highp float; in vec2 uv; out vec4 color; uniform highp vec3 camera_position;
        struct Surface { vec3 position; vec4 diffuse_color; };`;
        const vertex = `#version 300 es\nprecision highp float; out vec2 uv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); uv=p; gl_Position=vec4(p*2.0-1.0,0,1); }`;
        function program(source, vertexSource = vertex) {
          const p = gl.createProgram();
          for (const [kind, code] of [
            [gl.VERTEX_SHADER, vertexSource],
            [gl.FRAGMENT_SHADER, source],
          ]) {
            const shader = gl.createShader(kind);
            gl.shaderSource(shader, code);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
              throw new Error(gl.getShaderInfoLog(shader));
            gl.attachShader(p, shader);
          }
          gl.linkProgram(p);
          if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
          return p;
        }
        const rendering = program(nativeFragment, nativeVertex);
        const sampling = program(
          `${prefix}\n${uniforms}\nuniform highp vec3 probe; void main(){ ${sample} color=vec4(proofValue,proofValid,0,1); }`
        );
        const dims = [7, 5, 4],
          cols = 2,
          tile = [9, 7],
          size = [18, 14];
        const high = new Uint8Array(size[0] * size[1] * 4),
          low = new Uint8Array(high.length),
          valid = new Uint8Array(high.length);
        // Cover both bytes, carries, the full uint16 range, and fractional interpolation.
        const value = (x, y, z) => x + 255 * y + 21503 * z;
        // Input values are coded as integers. Padding duplicates the edge; no tile bleeding.
        for (let z = 0; z < 4; z++)
          for (let y = -1; y <= 5; y++)
            for (let x = -1; x <= 7; x++) {
              const v = value(Math.max(0, Math.min(6, x)), Math.max(0, Math.min(4, y)), z);
              const offset = ((Math.floor(z / cols) * 7 + y + 1) * 18 + (z % cols) * 9 + x + 1) * 4;
              high[offset + 3] = v >> 8;
              low[offset + 3] = v & 255;
              valid[offset + 3] = 255;
            }
        [high, low, valid].forEach((pixels, index) => {
          gl.activeTexture(gl.TEXTURE0 + index);
          const t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.SRGB8_ALPHA8,
            ...size,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        });
        function settings(p) {
          gl.useProgram(p);
          const u = (name) => gl.getUniformLocation(p, name);
          ['high', 'low', 'validity'].forEach((name, i) => gl.uniform1i(u(`u_${name}`), i));
          gl.uniform3fv(u('u_dimensions'), dims);
          gl.uniform4fv(u('u_atlas'), [...size, cols, 0]);
          gl.uniform4fv(u('u_tile'), [...tile, 1, 0]);
          gl.uniform4fv(u('u_scalar'), [0, 1, 0, 1]);
          gl.uniform3fv(u('u_extent'), [0.55, (0.55 * 4) / 6, (0.55 * 3) / 6]);
          gl.uniform3fv(u('u_crop_min'), [0, 0, 0]);
          gl.uniform3fv(u('u_crop_max'), [1, 1, 1]);
          gl.uniform1f(u('u_flip_y'), 0);
          gl.uniform4fv(u('u_appearance'), [346, 173, 1, 0]);
          gl.uniform1f(u('u_samples'), 192);
          gl.uniform3fv(u('camera_position'), [0, 0, 1]);
          gl.uniform1f(u('material_diffuse_intensity'), 1);
          gl.uniform1f(u('material_alpha'), 1);
          gl.uniform1f(u('material_alpha_cutoff'), 0);
          gl.uniform4fv(u('material_diffuse_surface_color'), [1, 1, 1, 1]);
          gl.uniformMatrix4fv(
            u('model_matrix'),
            false,
            [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
          );
          return u;
        }
        const target = gl.createTexture();
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, target);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 64, 0, gl.RGBA, gl.FLOAT, null);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
        gl.viewport(0, 0, 64, 64);
        function pixels() {
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const out = new Float32Array(64 * 64 * 4);
          gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.FLOAT, out);
          return out;
        }
        const u = settings(sampling);
        const checks = [];
        for (const point of [
          [0, 0, 0],
          [1, 1, 1],
          [0.5, 0.5, 0.5],
          [0.23, 0.61, 0.77],
          [1 / 6, 1 / 4, 1 / 3],
        ]) {
          gl.uniform3fv(u('probe'), point);
          const sampled = pixels()[0],
            expected = value(point[0] * 6, point[1] * 4, point[2] * 3);
          checks.push({ point, sampled, expected, error: Math.abs(sampled - expected) });
        }
        const r = settings(rendering);
        // Appearance uses the fixture's actual scalar range.
        gl.uniform4fv(r('u_appearance'), [65535, 32767.5, 1, 0]);
        const full = pixels();
        const angle = 0.73,
          scale = 1.7,
          c = Math.cos(angle) * scale,
          s = Math.sin(angle) * scale;
        gl.uniformMatrix4fv(r('model_matrix'), false, [
          c,
          0,
          -s,
          0,
          0,
          scale,
          0,
          0,
          s,
          0,
          c,
          0,
          1.2,
          0.61,
          -0.8,
          1,
        ]);
        gl.uniform3fv(r('camera_position'), [1.2 + s, 0.61, -0.8 + c]);
        const transformed = pixels();
        const transformError = full.reduce(
          (error, value, i) => Math.max(error, Math.abs(value - transformed[i])),
          0
        );
        gl.uniformMatrix4fv(
          r('model_matrix'),
          false,
          [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        );
        gl.uniform3fv(r('camera_position'), [0, 0, 1]);
        gl.uniform3fv(r('u_crop_min'), [0.5, 0, 0]);
        const crop = pixels();
        gl.uniform3fv(r('camera_position'), [0.2, 0.1, 1]);
        const moved = pixels();
        gl.uniform4fv(r('u_appearance'), [65535, 32767.5, 0, 0]);
        const transparent = pixels();
        gl.uniform4fv(r('u_appearance'), [65535, 32767.5, 1, 0]);
        gl.uniform1f(r('u_samples'), 96);
        const fast = pixels();
        // Homogeneous fixture has a closed-form opacity, independent of ray sample count.
        [high, low].forEach((data, index) => {
          for (let i = 3; i < data.length; i += 4) data[i] = index === 0 ? 0 : 128;
          gl.activeTexture(gl.TEXTURE0 + index);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ...size, gl.RGBA, gl.UNSIGNED_BYTE, data);
        });
        gl.uniform3fv(r('u_crop_min'), [0, 0, 0]);
        gl.uniform3fv(r('camera_position'), [0, 0, 1]);
        gl.uniform4fv(r('u_appearance'), [346, 173, 0.2, 0]);
        const homogeneousFast = pixels();
        gl.uniform1f(r('u_samples'), 192);
        const homogeneousBalanced = pixels();
        const maxQualityAlphaError = homogeneousFast.reduce(
          (error, value, index) =>
            index % 4 === 3 ? Math.max(error, Math.abs(value - homogeneousBalanced[index])) : error,
          0
        );
        const center = (32 * 64 + 32) * 4 + 3;
        const ramp = (128 / 346 - 0.1) / 0.9;
        const density = ramp * ramp * (3 - 2 * ramp) * 0.65;
        const directionLength = Math.hypot(
          0.55 / 128,
          (0.55 * 3) / 6 / 128,
          1 + (0.55 * 4) / 6 / 2
        );
        const pathMm = (4 * directionLength) / (1 + (0.55 * 4) / 6 / 2);
        const expectedAlpha = 1 - Math.pow(1 - density, pathMm * 0.2);
        const total = (data) => data.reduce((a, x, i) => a + (i % 4 === 3 ? x : 0), 0);
        return {
          compiled: true,
          renderer: gl.getParameter(gl.RENDERER),
          maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          nativeConstantTemplate: true,
          transformError,
          checks,
          fullAlpha: total(full),
          croppedAlpha: total(crop),
          transparentAlpha: total(transparent),
          cameraChanges: full.some((x, i) => Math.abs(x - moved[i]) > 0.01),
          fastAlpha: total(fast),
          maxQualityAlphaError,
          cpuOpacityError: Math.abs(expectedAlpha - homogeneousBalanced[center]),
          glError: gl.getError(),
        };
      },
      {
        uniforms: VOLUME_SHADER_UNIFORMS,
        nativeFragment: constantFragment(VOLUME_SHADER_UNIFORMS, VOLUME_SHADER_BODY),
        nativeVertex: quadVertex(
          'v_surface_position=(model_matrix*vec4((uv.x-.5)*u_extent.x,(uv.y-.5)*u_extent.z,-u_extent.y*.5,1.0)).xyz;'
        ),
        sample: volumeSampleGLSL('proof', 'probe'),
      }
    );
    assert.ok(result.compiled);
    assert.equal(result.glError, 0);
    assert.ok(
      result.checks.every(({ error }) => error < 0.02),
      JSON.stringify(result.checks)
    );
    assert.ok(result.fullAlpha > 0);
    assert.ok(result.croppedAlpha > 0 && result.croppedAlpha < result.fullAlpha);
    assert.ok(result.cameraChanges);
    assert.ok(
      result.transformError < 0.001,
      `Model/camera transform error ${result.transformError}`
    );
    assert.equal(result.transparentAlpha, 0);
    assert.ok(result.fastAlpha > 0);
    assert.ok(result.maxQualityAlphaError < 0.0001);
    assert.ok(result.cpuOpacityError < 0.0001);
    result.iosBindingContract = iosBindingContract;
    const directory = path.resolve('.expo/medical-volumes');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'shader-proof.json'),
      JSON.stringify(result, null, 2) + '\n'
    );
    console.log(JSON.stringify(result, null, 2));
    const real = await require('./render_real_volumes.cjs')(
      browser,
      {
        uniforms: VOLUME_SHADER_UNIFORMS,
        body: VOLUME_SHADER_BODY,
        sample: volumeSampleGLSL('proof', 'probe'),
      },
      directory
    );
    console.log(
      JSON.stringify(
        {
          realAssets: real.map(({ modality, checks }) => ({
            modality,
            maxSamplingError: Math.max(...checks.map(({ error }) => error)),
          })),
        },
        null,
        2
      )
    );
    console.log(
      JSON.stringify(
        { diagnostics: await require('./test_volume_diagnostics.cjs')(browser, directory) },
        null,
        2
      )
    );
    console.log(
      JSON.stringify(
        { stackColor: await require('./test_stack_color.cjs')(browser, directory) },
        null,
        2
      )
    );
    console.log(
      JSON.stringify(
        { stackedSlices: await require('./render_stack_preview.cjs')(browser, directory) },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
