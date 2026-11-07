/* Diagnostic output tests in the installed Constant GLSL template.
 * Desktop bindings are explicit: these checks cannot confirm iOS binding/drawing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { constantFragment, quadVertex } = require('./viro_shader_harness.cjs');
const {
  volumeDiagnosticShader,
} = require('../../src/features/medical-viewer/medical-volume-diagnostics.ts');

module.exports = async function testVolumeDiagnostics(browser, directory) {
  const metadata = JSON.parse(fs.readFileSync('assets/medical/volumes/metadata.json', 'utf8'));
  const stack = JSON.parse(fs.readFileSync('assets/medical/stack/metadata.json', 'utf8'));
  const results = [];
  for (const series of metadata.series) {
    const probe = stack.probes[series.modality];
    const shaders = Object.fromEntries(
      [
        'magenta',
        'samplers',
        'high',
        'low',
        'validity',
        'coordinates',
        'uniforms',
        'ray',
        'opacity',
        'raymarch',
      ].map((mode) => {
        const shader = volumeDiagnosticShader(mode, probe, metadata.grid.dimensions);
        return [
          mode,
          constantFragment(
            shader.uniforms,
            shader.entry === 'surface' ? shader.body : '',
            shader.entry === 'fragment' ? shader.body : ''
          ),
        ];
      })
    );
    const files = Object.fromEntries(
      ['high', 'low', 'validity'].map((key) => [
        key,
        'data:image/png;base64,' +
          fs
            .readFileSync(path.join('assets/medical/volumes', series.atlases[key].filename))
            .toString('base64'),
      ])
    );
    const page = await browser.newPage();
    try {
      const output = await page.evaluate(
        async ({ metadata, series, shaders, files, vertex }) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 64;
          const gl = canvas.getContext('webgl2');
          if (!gl?.getExtension('EXT_color_buffer_float'))
            throw new Error('WebGL2 float rendering unavailable');
          function program(fragment) {
            const p = gl.createProgram();
            for (const [kind, source] of [
              [gl.VERTEX_SHADER, vertex],
              [gl.FRAGMENT_SHADER, fragment],
            ]) {
              const shader = gl.createShader(kind);
              gl.shaderSource(shader, source);
              gl.compileShader(shader);
              if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(shader));
              gl.attachShader(p, shader);
            }
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS))
              throw new Error(gl.getProgramInfoLog(p));
            return p;
          }
          for (const [i, key] of ['high', 'low', 'validity'].entries()) {
            const image = new Image();
            image.src = files[key];
            await image.decode();
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          }
          gl.activeTexture(gl.TEXTURE3);
          const target = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, target);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 64, 0, gl.RGBA, gl.FLOAT, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error('Incomplete float target');
          gl.viewport(0, 0, 64, 64);
          const spans = metadata.grid.dimensions.map((n) => (n - 1) * metadata.grid.spacingMm);
          const extent = spans.map((n) => (n * 0.55) / Math.max(...spans));
          function settings(p) {
            gl.useProgram(p);
            const u = (name) => gl.getUniformLocation(p, name);
            ['high', 'low', 'validity'].forEach((key, i) => gl.uniform1i(u(`u_${key}`), i));
            gl.uniform3fv(u('u_dimensions'), metadata.grid.dimensions);
            gl.uniform3fv(u('u_extent'), extent);
            gl.uniform4fv(u('u_atlas'), [...metadata.atlas.dimensions, metadata.atlas.columns, 0]);
            gl.uniform4fv(u('u_tile'), [...metadata.atlas.tileDimensions, 1, 0]);
            gl.uniform4fv(u('u_scalar'), [
              series.scalarOffset,
              series.scalarScale,
              0,
              metadata.grid.spacingMm,
            ]);
            gl.uniform3fv(u('u_crop_min'), [0, 0, 0]);
            gl.uniform3fv(u('u_crop_max'), [1, 1, 1]);
            gl.uniform4fv(
              u('u_appearance'),
              series.modality === 'mri' ? [5589, 2671.5, 1, 0] : [1800, 400, 1, 1]
            );
            gl.uniform1f(u('u_samples'), 96);
            gl.uniform1f(u('u_flip_y'), 0);
            gl.uniform3fv(u('camera_position'), [0, 0, 1]);
            gl.uniformMatrix4fv(
              u('model_matrix'),
              false,
              [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            );
            gl.uniform4fv(u('material_diffuse_surface_color'), [1, 1, 1, 1]);
            gl.uniform1f(u('material_diffuse_intensity'), 1);
            gl.uniform1f(u('material_alpha'), 1);
            gl.uniform1f(u('material_alpha_cutoff'), 0);
            return u;
          }
          function pixel(x, y) {
            const data = new Float32Array(4);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, data);
            return Array.from(data);
          }
          const modes = {};
          for (const [mode, source] of Object.entries(shaders)) {
            const p = program(source);
            const u = settings(p);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            modes[mode] = {
              sample: pixel(24, 22),
              reference: pixel(24, 44),
              empty: pixel(24, 5),
              edge: pixel(3, 32),
            };
            if (mode === 'samplers') {
              modes[mode].columns = {
                high: {
                  sample: pixel(24, 22),
                  reference: pixel(24, 44),
                  empty: pixel(24, 5),
                },
                low: {
                  sample: pixel(34, 22),
                  reference: pixel(34, 44),
                  empty: pixel(34, 5),
                },
                validity: {
                  sample: pixel(54, 22),
                  reference: pixel(54, 44),
                  empty: pixel(54, 5),
                },
              };
              modes[mode].statusBar = pixel(32, 58);

              // Intentional sampler swapping: swap u_high and u_low
              gl.uniform1i(u('u_high'), 1);
              gl.uniform1i(u('u_low'), 0);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
              modes[mode].swappedStatusBar = pixel(32, 58);

              // Intentional sampler aliasing: bind u_low to u_high's unit 0
              gl.uniform1i(u('u_high'), 0);
              gl.uniform1i(u('u_low'), 0);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
              modes[mode].aliasedStatusBar = pixel(32, 58);

              // Restore valid sampler bindings
              gl.uniform1i(u('u_high'), 0);
              gl.uniform1i(u('u_low'), 1);
            }
            if (mode === 'uniforms') {
              gl.uniform3fv(u('u_dimensions'), [1, 1, 1]);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
              modes[mode].invalid = pixel(24, 22);
              gl.uniform3fv(u('u_dimensions'), metadata.grid.dimensions);
              gl.uniform3fv(u('u_crop_min'), [0.25, 0.1, 0.2]);
              gl.uniform4fv(u('u_appearance'), [11178, 0, 0, 0]);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
              modes[mode].crop = pixel(48, 32);
              modes[mode].window = pixel(24, 5);
            }
            gl.deleteProgram(p);
          }
          return {
            modality: series.modality,
            compiledModes: Object.keys(modes),
            modes,
            glError: gl.getError(),
          };
        },
        {
          metadata,
          series,
          shaders,
          files,
          vertex: quadVertex(
            'v_surface_position=(model_matrix*vec4((uv.x-.5)*u_extent.x,(uv.y-.5)*u_extent.z,-u_extent.y*.5,1.0)).xyz;'
          ),
        }
      );
      assert.equal(output.glError, 0);
      assert.deepEqual(output.modes.magenta.sample, [1, 0, 1, 1]);
      assert.deepEqual(output.modes.samplers.edge, [1, 0, 1, 1]);
      // Assert all three columns (high, low, validity) for samplers mode
      for (const key of ['high', 'low', 'validity']) {
        const col = output.modes.samplers.columns[key];
        assert.ok(
          Math.abs(col.sample[0] - probe.alphaBytes[key] / 255) < 0.002,
          `${series.modality} samplers ${key} actual ${col.sample[0]}`
        );
        assert.ok(
          Math.abs(col.sample[0] - col.reference[0]) < 0.002,
          `${series.modality} samplers ${key} sample vs reference mismatch ${col.sample[0]} vs ${col.reference[0]}`
        );
        assert.ok(
          col.empty[0] < 0.002,
          `${series.modality} samplers ${key} empty texel ${col.empty[0]}`
        );
      }
      // Assert green comparison bar on valid simultaneous sampler bindings
      assert.deepEqual(
        output.modes.samplers.statusBar,
        [0, 1, 0, 1],
        `${series.modality} samplers comparison bar must be green [0, 1, 0, 1]`
      );
      // Assert red comparison bar on intentional sampler swapping and aliasing
      assert.deepEqual(
        output.modes.samplers.swappedStatusBar,
        [1, 0, 0, 1],
        `${series.modality} samplers comparison bar must turn red [1, 0, 0, 1] on swapped samplers`
      );
      assert.deepEqual(
        output.modes.samplers.aliasedStatusBar,
        [1, 0, 0, 1],
        `${series.modality} samplers comparison bar must turn red [1, 0, 0, 1] on aliased samplers`
      );
      for (const key of ['high', 'low', 'validity']) {
        const mode = output.modes[key];
        assert.deepEqual(mode.edge, [1, 0, 1, 1]);
        assert.ok(
          Math.abs(mode.sample[0] - probe.alphaBytes[key] / 255) < 0.002,
          `${series.modality} ${key} actual ${mode.sample[0]}`
        );
        assert.ok(Math.abs(mode.sample[0] - mode.reference[0]) < 0.002);
        assert.ok(mode.empty[0] < 0.002, `${series.modality} ${key} invalid texel`);
      }
      assert.deepEqual(output.modes.uniforms.sample, [0, 1, 0, 1]);
      assert.deepEqual(output.modes.uniforms.invalid, [1, 0, 0, 1]);
      assert.ok(
        output.modes.uniforms.crop
          .slice(0, 3)
          .every((n, i) => Math.abs(n - [0.25, 0.1, 0.2][i]) < 1e-6)
      );
      assert.equal(output.modes.uniforms.window[0], 1);
      assert.equal(output.modes.ray.sample[1], 1);
      assert.ok(output.modes.coordinates.sample.slice(0, 3).every((n) => n >= 0 && n <= 1));
      results.push(output);
    } finally {
      await page.close();
    }
  }
  fs.writeFileSync(
    path.join(directory, 'diagnostics-proof.json'),
    JSON.stringify({ nativeDrawingVerified: false, results }, null, 2) + '\n'
  );
  return results.map(({ modality, compiledModes, modes }) => ({
    modality,
    compiledModes,
    alphaErrors: Object.fromEntries(
      ['high', 'low', 'validity'].map((key) => [
        key,
        Math.abs(modes[key].sample[0] - modes[key].reference[0]),
      ])
    ),
  }));
};
