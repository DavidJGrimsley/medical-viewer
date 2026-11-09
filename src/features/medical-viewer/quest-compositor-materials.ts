// Viro 3.0.3's Android MaterialManager consumes colorWriteMask as an array.
// The public colorWritesMask (plural, string) type is not handled by that bridge.
export function questCompositorMaterials() {
  const invisible = {
    lightingModel: 'Constant' as const,
    colorWriteMask: ['None'],
    blendMode: 'None' as const,
    diffuseColor: '#000000',
    // OpenXR's per-eye clear resets GL colour writes outside Viro's state cache.
    // If that happens, write transparent black instead of an opaque white quad.
    shaderModifiers: { fragment: '_output_color = vec4(0.0);' },
    readsFromDepthBuffer: true,
  };
  return {
    questCompositorMask: { ...invisible, writesToDepthBuffer: true },
    questCompositorHit: { ...invisible, writesToDepthBuffer: false },
  };
}
