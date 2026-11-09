const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  questCompositorMaterials,
} = require('../src/features/medical-viewer/quest-compositor-materials.ts');

test('compositor surfaces disable colour writes using the bundled Android bridge contract', () => {
  for (const material of Object.values(questCompositorMaterials())) {
    // MaterialManager.createMaterial reads only singular colorWriteMask via getArray.
    // Missing or misspelled properties retain its default ALL mask (the white-panel bug).
    const nativeMask = Array.isArray(material.colorWriteMask) ? material.colorWriteMask : ['All'];
    assert.deepEqual(nativeMask, ['None']);
    assert.equal(material.blendMode, 'None');
    assert.equal(material.shaderModifiers.fragment, '_output_color = vec4(0.0);');
  }
});

test('panel occludes geometry behind it while button hit targets leave depth unchanged', () => {
  const materials = questCompositorMaterials();
  assert.equal(materials.questCompositorMask.writesToDepthBuffer, true);
  assert.equal(materials.questCompositorHit.writesToDepthBuffer, false);
  assert.equal(materials.questCompositorMask.readsFromDepthBuffer, true);
  assert.equal(materials.questCompositorHit.readsFromDepthBuffer, true);
});
