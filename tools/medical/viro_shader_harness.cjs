/* Compile inside the installed iOS Constant template, including its surface and alpha pipeline.
 * This exercises packaged GLSL resources; it cannot emulate an Apple GPU or the native bridge. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

// Check the actual bridge route before bypassing it with WebGL texture bindings.
// This checks packaged source and scene wiring; it does not execute native iOS code.
function checkIosTextureOverrideContract() {
  const packagePath = require.resolve('@reactvision/react-viro/package.json');
  const bridge = fs.readFileSync(
    path.join(path.dirname(packagePath), 'ios/ViroReact/Views/VRTNode.mm'),
    'utf8'
  );
  const start = bridge.indexOf('- (void)applyShaderOverridesRecursive:');
  assert.ok(start >= 0, 'Installed iOS shader override method is missing');
  const end = bridge.indexOf('\n- (', start + 1);
  const override = bridge.slice(start, end < 0 ? undefined : end);
  assert.match(
    override,
    /for\s*\(const auto &uniform : shaderMaterial->getShaderUniformTextures\(\)\)\s*\{\s*mergedMat->setShaderUniform\(uniform.first, uniform.second\);/,
    'Installed iOS override must explicitly copy sampler textures after cloning'
  );
  for (const type of ['Floats', 'Vec3s', 'Vec4s'])
    assert.ok(override.includes(`getShaderUniform${type}()`));
  assert.ok(override.includes('VRTMergeAuthoredMaterialProperties(mergedMat, shaderMaterial'));
  for (const property of ['BlendMode', 'CullMode', 'WritesToDepthBuffer', 'ReadsFromDepthBuffer'])
    assert.ok(bridge.includes(`dest->set${property}(source->get${property}())`));

  const scene = ts.createSourceFile(
    'medical-volume.native.tsx',
    fs.readFileSync(
      path.join(__dirname, '../../src/features/medical-viewer/medical-volume.native.tsx'),
      'utf8'
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const proxies = [];
  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      (node.tagName.getText(scene) === 'Viro3DObject' || node.tagName.getText(scene) === 'ViroBox')
    )
      proxies.push(node);
    ts.forEachChild(node, visit);
  }
  visit(scene);
  assert.equal(proxies.length, 1);
  const attributes = proxies[0].attributes.properties.map((node) => node.name?.getText(scene));
  assert.ok(attributes.includes('shaderOverrides'), 'Volume proxy must retain custom textures');
  assert.ok(!attributes.includes('materials'), 'iOS materials cloning loses sampler textures');
  return {
    viroVersion: JSON.parse(fs.readFileSync(packagePath, 'utf8')).version,
    boxBinding: 'shaderOverrides',
    explicitSamplerCopy: true,
    authoredRenderProperties: true,
    nativeExecutionVerified: false,
  };
}

function constantFragment(uniforms, body, fragmentBody = '') {
  const framework = path.join(
    path.dirname(require.resolve('@reactvision/react-viro/package.json')),
    'ios/dist/ViroRenderer/ViroKit.framework'
  );
  function resource(name) {
    return fs
      .readFileSync(path.join(framework, `${name}.glsl`), 'utf8')
      .replace(/^#include (\w+)\s*$/gm, (_, include) => resource(include));
  }
  const lines = `${uniforms}\n${body}`.split('\n').map((line) => line.trim());
  const declaration = (line) => /^(uniform |in |out |layout |#include)/.test(line);
  return resource('constant_fsh')
    .replace('#pragma surface_modifier_uniforms', lines.filter(declaration).join('\n'))
    .replace('#pragma surface_modifier_body', lines.filter((line) => !declaration(line)).join('\n'))
    .replace('#pragma fragment_modifier_body', fragmentBody)
    .replace(/^#pragma .*$/gm, '');
}

function quadVertex(surfacePosition) {
  return `#version 300 es
precision highp float;
uniform highp mat4 model_matrix;
uniform highp vec3 u_extent;
uniform highp vec3 camera_position;
flat out int v_instance_id;
out lowp mat3 v_tbn;
out highp vec2 v_texcoord;
out highp vec3 v_surface_position;
out lowp vec4 v_color;
void main() {
  vec2 uv = vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  v_instance_id = 0;
  v_tbn = mat3(1.0);
  v_texcoord = uv;
  v_color = vec4(1.0);
  ${surfacePosition}
  gl_Position = vec4(uv*2.0-1.0,0.0,1.0);
}`;
}

module.exports = { constantFragment, quadVertex, checkIosTextureOverrideContract };
