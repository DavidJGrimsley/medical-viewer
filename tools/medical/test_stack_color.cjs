/* Exercise the installed Constant shader with iOS-style premultiplied sRGB bytes.
 * A desktop regression for the photographed dark stack, not physical iOS acceptance.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { constantFragment, quadVertex } = require('./viro_shader_harness.cjs');
const {
  STACK_IOS_COLOR_FRAGMENT,
} = require('../../src/features/medical-viewer/medical-stack-color.ts');

module.exports = async function testStackColor(browser, directory) {
  const source = (fragment) =>
    constantFragment(
      'uniform sampler2D diffuse_texture;',
      '_surface.diffuse_color *= texture(diffuse_texture, _surface.diffuse_texcoord);',
      fragment
    );
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(
      ({ corrected, original, vertex }) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error('WebGL2 unavailable');
        function program(fragment) {
          const p = gl.createProgram();
          for (const [type, code] of [
            [gl.VERTEX_SHADER, vertex],
            [gl.FRAGMENT_SHADER, fragment],
          ]) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, code);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
              throw new Error(gl.getShaderInfoLog(shader));
            gl.attachShader(p, shader);
          }
          gl.linkProgram(p);
          if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
          gl.useProgram(p);
          gl.uniform4f(gl.getUniformLocation(p, 'material_diffuse_surface_color'), 1, 1, 1, 1);
          gl.uniform1f(gl.getUniformLocation(p, 'material_diffuse_intensity'), 1);
          return p;
        }
        const fixed = program(corrected),
          old = program(original);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        function draw(p, opacity) {
          gl.useProgram(p);
          gl.uniform1f(gl.getUniformLocation(p, 'material_alpha'), opacity);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const pixel = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return Array.from(pixel);
        }
        const probes = [];
        for (const alpha of [0, 26, 56, 102]) {
          for (const gray of [32, 128, 255]) {
            const rgb = Math.round((gray * alpha) / 255);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.SRGB8_ALPHA8,
              1,
              1,
              0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              new Uint8Array([rgb, rgb, rgb, alpha])
            );
            for (const opacity of [0, 0.4, 0.8, 1]) {
              const actual = draw(fixed, opacity),
                before = draw(old, opacity);
              probes.push({
                alpha,
                gray,
                opacity,
                actual,
                before,
                expectedRGB: alpha ? Math.round(linear(rgb / alpha) * 255) : 0,
                expectedAlpha: Math.round(alpha * opacity),
              });
            }
          }
        }
        return { probes, glError: gl.getError() };
      },
      {
        corrected: source(STACK_IOS_COLOR_FRAGMENT),
        original: source(''),
        vertex: quadVertex('v_surface_position = vec3(0.0);'),
      }
    );
    assert.equal(result.glError, 0);
    for (const probe of result.probes) {
      for (const value of probe.actual.slice(0, 3))
        assert.ok(Math.abs(value - probe.expectedRGB) <= 1, JSON.stringify(probe));
      assert.ok(Math.abs(probe.actual[3] - probe.expectedAlpha) <= 1, JSON.stringify(probe));
    }
    const white = result.probes.find((p) => p.alpha === 56 && p.gray === 255 && p.opacity === 0.8);
    assert.ok(
      white.actual[0] > white.before[0] * 10,
      'Recover bright tissue from the native alpha darkening'
    );
    const proof = {
      nativeDrawingVerified: false,
      checkedProbes: result.probes.length,
      brightTissueBefore: white.before,
      brightTissueCorrected: white.actual,
    };
    fs.writeFileSync(
      path.join(directory, 'stack-color-proof.json'),
      JSON.stringify(proof, null, 2) + '\n'
    );
    return proof;
  } finally {
    await page.close();
  }
};
