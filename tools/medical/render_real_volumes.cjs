/* Uses the production shader and PNGs; desktop proof only, not an iOS renderer test. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { constantFragment, quadVertex } = require('./viro_shader_harness.cjs');

function alphaPixels(bytes) {
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)),
    alpha = new Uint8Array(width * height),
    stride = width * 4 + 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) alpha[y * width + x] = raw[y * stride + 1 + x * 4 + 3];
  return alpha;
}
function cpuSample(point, metadata, series, channels) {
  const p = point.map((value, i) => value * (metadata.grid.dimensions[i] - 1));
  const lower = p.map(Math.floor),
    fraction = p.map((value, i) => value - lower[i]);
  let code = 0,
    valid = 0;
  for (let corner = 0; corner < 8; corner++) {
    const index = lower.map((value, i) =>
      Math.min(value + ((corner >> i) & 1), metadata.grid.dimensions[i] - 1)
    );
    const weight = fraction.reduce(
      (product, value, i) => product * ((corner >> i) & 1 ? value : 1 - value),
      1
    );
    const [x, y, z] = index,
      { columns, tileDimensions, dimensions } = metadata.atlas;
    const offset =
      (Math.floor(z / columns) * tileDimensions[1] + y + 1) * dimensions[0] +
      (z % columns) * tileDimensions[0] +
      x +
      1;
    code += weight * (channels.high[offset] * 256 + channels.low[offset]);
    valid += (weight * channels.validity[offset]) / 255;
  }
  return {
    value: series.scalarOffset + (series.scalarScale * code) / Math.max(valid, 0.00001),
    valid,
  };
}
module.exports = async function renderRealVolumes(browser, { uniforms, body, sample }, directory) {
  const assetDirectory = path.resolve('assets/medical/volumes');
  const metadata = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'metadata.json'), 'utf8'));
  const results = [];
  for (const series of metadata.series) {
    const files = Object.fromEntries(
      ['high', 'low', 'validity'].map((key) => [
        key,
        fs.readFileSync(path.join(assetDirectory, series.atlases[key].filename)),
      ])
    );
    const channels = Object.fromEntries(
      Object.entries(files).map(([key, bytes]) => [key, alphaPixels(bytes)])
    );
    const points = [
      [0.5, 0.5, 0.5],
      [0.41, 0.62, 0.73],
      [0.12, 0.23, 0.31],
      [0, 0, 0],
      [1, 1, 1],
    ];
    const expected = points.map((point) => cpuSample(point, metadata, series, channels));
    const page = await browser.newPage();
    try {
      const result = await page.evaluate(
        async ({
          metadata,
          series,
          files,
          points,
          uniforms,
          sample,
          nativeFragment,
          nativeVertex,
        }) => {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 320;
          const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
          if (!gl?.getExtension('EXT_color_buffer_float'))
            throw new Error('WebGL2 float target unavailable');
          const vertex = `#version 300 es\nprecision highp float; out vec2 uv; void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
          const prefix = `#version 300 es\nprecision highp float;in vec2 uv;out vec4 color;uniform highp vec3 camera_position;struct Surface{vec3 position;vec4 diffuse_color;};`;
          function program(fragment, vertexSource = vertex) {
            const p = gl.createProgram();
            for (const [kind, source] of [
              [gl.VERTEX_SHADER, vertexSource],
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
          const rendering = program(nativeFragment, nativeVertex),
            sampling = program(
              `${prefix}\n${uniforms}\nuniform highp vec3 probe;void main(){${sample}color=vec4(proofValue,proofValid,0,1);}`
            );
          const textures = [];
          for (const [index, key] of ['high', 'low', 'validity'].entries()) {
            const img = new Image();
            img.src = files[key];
            await img.decode();
            gl.activeTexture(gl.TEXTURE0 + index);
            const texture = gl.createTexture();
            textures.push(texture);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          }
          const { dimensions, spacingMm } = metadata.grid;
          const spans = dimensions.map((value) => (value - 1) * spacingMm),
            extent = spans.map((value) => (value * 0.55) / Math.max(...spans));
          function settings(p) {
            gl.useProgram(p);
            const u = (name) => gl.getUniformLocation(p, name);
            ['high', 'low', 'validity'].forEach((key, i) => gl.uniform1i(u(`u_${key}`), i));
            gl.uniform3fv(u('u_dimensions'), dimensions);
            gl.uniform3fv(u('u_extent'), extent);
            gl.uniform4fv(u('u_atlas'), [...metadata.atlas.dimensions, metadata.atlas.columns, 0]);
            gl.uniform4fv(u('u_tile'), [...metadata.atlas.tileDimensions, 1, 0]);
            gl.uniform4fv(u('u_scalar'), [series.scalarOffset, series.scalarScale, 0, spacingMm]);
            gl.uniform3fv(u('u_crop_min'), [0.5, 0, 0]);
            gl.uniform3fv(u('u_crop_max'), [1, 1, 1]);
            gl.uniform1f(u('u_flip_y'), 0);
            gl.uniform1f(u('u_samples'), 192);
            gl.uniform3fv(u('camera_position'), [-0.85, 0.176, -0.989]);
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
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
          const framebuffer = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
          gl.viewport(0, 0, 1, 1);
          const u = settings(sampling),
            checks = [];
          for (const point of points) {
            gl.uniform3fv(u('probe'), point);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const pixel = new Float32Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
            checks.push({ value: pixel[0], valid: pixel[1] });
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, 320, 320);
          const r = settings(rendering),
            previews = {};
          for (const [name, preset] of Object.entries(metadata.presets).filter(
            ([, preset]) => preset.modality === series.modality
          )) {
            gl.uniform4fv(r('u_appearance'), [
              preset.window,
              preset.level,
              1,
              name === 'ct-bone' ? 1 : 0,
            ]);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            previews[name] = canvas.toDataURL('image/png');
          }
          return { checks, previews, glError: gl.getError() };
        },
        {
          metadata,
          series,
          files: Object.fromEntries(
            Object.entries(files).map(([key, bytes]) => [
              key,
              `data:image/png;base64,${bytes.toString('base64')}`,
            ])
          ),
          points,
          uniforms,
          sample,
          nativeFragment: constantFragment(
            uniforms,
            body,
            '_output_color = vec4(mix(vec3(.035,.055,.075),_output_color.rgb,_output_color.a),1.0);'
          ),
          nativeVertex: quadVertex(`
            vec3 forward=normalize(-camera_position);
            vec3 right=normalize(cross(forward,vec3(0,1,0)));
            vec3 up=cross(right,forward);
            v_surface_position=right*(uv.x-.5)*.72+up*(uv.y-.5)*.72+forward*.6;`),
        }
      );
      assert.equal(result.glError, 0);
      const checks = result.checks.map((actual, i) => ({
        ...actual,
        expected: expected[i],
        error: Math.abs(actual.value - expected[i].value),
      }));
      // Raster decoding is compared with an independent eight-voxel CPU sampler.
      assert.ok(
        checks.every(
          (item) => item.error < 0.02 && Math.abs(item.valid - item.expected.valid) < 0.0001
        ),
        JSON.stringify(checks)
      );
      for (const [name, data] of Object.entries(result.previews))
        fs.writeFileSync(
          path.join(directory, `${name}-shader.png`),
          Buffer.from(data.split(',')[1], 'base64')
        );
      results.push({
        modality: series.modality,
        checks,
        glError: result.glError,
        previews: Object.keys(result.previews),
      });
    } finally {
      await page.close();
    }
  }
  fs.writeFileSync(
    path.join(directory, 'real-shader-proof.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
  return results;
};
