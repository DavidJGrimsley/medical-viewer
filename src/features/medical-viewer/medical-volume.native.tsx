import { useEffect, useState, useSyncExternalStore } from 'react';
import { Image, NativeModules, TurboModuleRegistry } from 'react-native';
import {
  Viro3DObject,
  ViroImage,
  ViroMaterials,
  ViroNode,
  ViroPolyline,
  type ViroShaderUniform,
} from '@reactvision/react-viro';
import type { MedicalSceneProps } from './medical-scene.native';
import {
  canManipulateVolume,
  type MedicalVolumeScope,
  type MedicalSnapshot,
} from './medical-controller';
import { medicalVolumeSource, MEDICAL_VOLUME_BOX_SOURCE } from './medical-volume-assets.native';
import { VOLUME_ATLASES } from './medical-volumes';
import { volumeExtent, volumeUniforms } from './medical-volume-uniforms';
import { volumeDiagnosticShader, medicalNativeError } from './medical-volume-diagnostics';
import { isViroImageLoadSuccess } from './medical-image-events.native';
import stackMetadata from '../../../assets/medical/stack/metadata.json';
import MedicalVolumeStack from './medical-volume-stack.native';

const MATERIAL = 'medicalVolume';
function uniforms(values: Record<string, number | number[]>): ViroShaderUniform[] {
  return Object.entries(values).map(([name, value]) => ({
    name,
    value,
    type: typeof value === 'number' ? 'float' : value.length === 3 ? 'vec3' : 'vec4',
  }));
}
/** Viro resolves shaderOverrides once, when the proxy mesh finishes loading, and never retries
 * while createMaterials is still decoding atlases; the mesh then keeps its default white material.
 * Android runs every native module call in order on one queue, so an AppState callback queued after
 * createMaterials arrives only once Viro has registered the material and its textures. */
function nativeMaterialQueue() {
  const appState = NativeModules.AppState ?? TurboModuleRegistry.get('AppState');
  return appState && typeof appState.getCurrentAppState === 'function'
    ? (callback: () => void) => appState.getCurrentAppState(callback, callback)
    : null;
}
function useVolumeRendering({ context, controller }: MedicalSceneProps, state: MedicalSnapshot) {
  const { volume } = state;
  const series = controller.getVolumeSeries();
  const dataset = controller.volumeDataset;
  const scope: MedicalVolumeScope = {
    sessionId: context.sessionId,
    placementRevision: state.placementRevision,
    requestId: volume.requestId,
  };
  const magenta = volume.debugMode === 'magenta';
  const shader = volumeDiagnosticShader(
    volume.debugMode,
    stackMetadata.probes[volume.modality],
    dataset.dimensions
  );
  const active =
    volume.renderer === 'shader' &&
    !!state.anchorId &&
    (['binding', 'ready'].includes(volume.loadStatus) ||
      (magenta && volume.loadStatus === 'loading'));
  const pending = ['loading', 'binding'].includes(volume.loadStatus);
  const materialKey = `${scope.sessionId}:${scope.placementRevision}:${scope.requestId}:${volume.modality}:${volume.debugMode}`;
  const [registeredMaterial, setRegisteredMaterial] = useState<string | null>(null);
  const afterMaterialQueue = nativeMaterialQueue();
  const materialReady = !afterMaterialQueue || registeredMaterial === materialKey;
  // Viro's render thread attaches the loaded OBJ with its default white material before the UI
  // thread applies shaderOverrides, so at least one white frame can be drawn. onLoadEnd is
  // dispatched only after the override on Android and iOS, and Viro queues both the material swap
  // and `visible` to the render thread in call order, so the proxy stays hidden until then. The
  // proxy is keyed by materialKey: each key is a fresh mount and therefore a fresh onLoadEnd.
  const [loadedProxy, setLoadedProxy] = useState<string | null>(null);
  const proxyVisible = loadedProxy === materialKey;
  const showProxy = () => setLoadedProxy(materialKey);
  useEffect(() => {
    if (!state.anchorId || !pending) return;
    const timeout = setTimeout(() => {
      controller.recordVolumeDiagnostic(scope, '30-second load/binding deadline exceeded.');
      controller.finishVolumeBinding(scope, 'error');
    }, 30000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controller,
    context.sessionId,
    state.anchorId,
    state.placementRevision,
    volume.requestId,
    pending,
  ]);
  useEffect(() => {
    if (!active || !series) return;
    const manager =
      NativeModules.VRTMaterialManager ?? TurboModuleRegistry.get('VRTMaterialManager');
    if (!manager || typeof manager.updateShaderUniform !== 'function') {
      controller.finishVolumeBinding(scope, 'unsupported');
      return;
    }
    try {
      const textureKeys = new Set(shader.textures);
      const textures: ViroShaderUniform[] = VOLUME_ATLASES.filter((key) =>
        textureKeys.has(key)
      ).map((key) => {
        const resolved = Image.resolveAssetSource(medicalVolumeSource(volume.modality, key));
        if (!resolved?.uri) throw new Error(`Missing ${key} atlas`);
        return {
          name: `u_${key}`,
          type: 'sampler2D',
          value: { ...resolved, format: 'RGBA8', mipmap: false },
        };
      });
      ViroMaterials.createMaterials({
        [MATERIAL]: {
          lightingModel: 'Constant',
          blendMode: 'Alpha',
          cullMode: 'Front',
          writesToDepthBuffer: false,
          readsFromDepthBuffer: true,
          shaderModifiers: {
            [shader.entry]: { uniforms: shader.uniforms, body: shader.body },
          },
          materialUniforms: [
            ...textures,
            ...(!magenta ? uniforms(volumeUniforms(dataset, series, volume)) : []),
          ],
        },
      });
      controller.recordVolumeDiagnostic(
        scope,
        `Native material submitted · ${volume.debugMode} · ${textures.length} sampler(s). Drawing unconfirmed.`
      );
    } catch (error) {
      controller.recordVolumeDiagnostic(scope, `Material creation: ${medicalNativeError(error)}`);
      controller.finishVolumeBinding(scope, 'error');
      ViroMaterials.deleteMaterials([MATERIAL]);
      return;
    }
    let current = true;
    afterMaterialQueue?.(() => {
      if (!current) return;
      setRegisteredMaterial(materialKey);
      controller.recordVolumeDiagnostic(
        scope,
        `Native material registered · ${volume.debugMode}. Attaching volume proxy.`
      );
    });
    return () => {
      current = false;
      setRegisteredMaterial(null);
      setLoadedProxy(null);
      ViroMaterials.deleteMaterials([MATERIAL]);
    };
    // Scalar controls update uniforms below, without recreating texture resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controller,
    context.sessionId,
    state.placementRevision,
    volume.requestId,
    volume.modality,
    volume.debugMode,
    active,
    series,
  ]);
  useEffect(() => {
    if (!active || magenta || !series || volume.loadStatus !== 'ready') return;
    const frame = requestAnimationFrame(() => {
      const current = controller.getSnapshot();
      if (
        current.mode !== 'volume' ||
        current.sessionId !== scope.sessionId ||
        current.placementRevision !== scope.placementRevision ||
        current.volume.requestId !== scope.requestId ||
        current.volume.loadStatus !== 'ready'
      )
        return;
      try {
        for (const uniform of uniforms(volumeUniforms(dataset, series, current.volume)))
          ViroMaterials.updateShaderUniform(MATERIAL, uniform.name, uniform.type, uniform.value);
      } catch (error) {
        controller.recordVolumeDiagnostic(scope, `Uniform update: ${medicalNativeError(error)}`);
        controller.finishVolumeBinding(scope, 'error');
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controller,
    active,
    series,
    volume.appearance,
    volume.crop,
    volume.cropping,
    volume.quality,
    volume.loadStatus,
    volume.requestId,
  ]);
  return { scope, series, magenta, materialKey, materialReady, proxyVisible, showProxy };
}
export default function MedicalVolume({ context, controller }: MedicalSceneProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { volume } = state;
  const dataset = controller.volumeDataset;
  const { scope, series, magenta, materialKey, materialReady, proxyVisible, showProxy } =
    useVolumeRendering({ context, controller }, state);
  if (!state.anchorId || !series) return null;
  const extent = volumeExtent(dataset),
    interactive = canManipulateVolume(state);
  const box = volume.crop.map((value, index) => {
    const axis = Math.floor(index / 2),
      midpoint = (dataset.boundsRasMm[axis * 2] + dataset.boundsRasMm[axis * 2 + 1]) / 2;
    return (
      ((value - midpoint) * extent[axis]) /
      (dataset.boundsRasMm[axis * 2 + 1] - dataset.boundsRasMm[axis * 2])
    );
  });
  const corners = Array.from({ length: 8 }, (_, i): [number, number, number] => [
    box[i & 1],
    box[4 + ((i >> 2) & 1)],
    -box[2 + ((i >> 1) & 1)],
  ]);
  return (
    <ViroNode
      position={[volume.x, volume.height, volume.z]}
      rotation={[0, volume.yaw, 0]}
      scale={[volume.scale, volume.scale, volume.scale]}
      onPinch={
        interactive
          ? (gesture, value) => controller.volumeGesture(scope, 'pinch', gesture, value)
          : undefined
      }
      onRotate={
        interactive
          ? (gesture, value) => controller.volumeGesture(scope, 'rotate', gesture, value)
          : undefined
      }>
      {volume.renderer === 'stack' ? (
        <MedicalVolumeStack context={context} controller={controller} />
      ) : null}
      {volume.renderer === 'shader' && !magenta && volume.loadStatus === 'loading'
        ? VOLUME_ATLASES.map((key) => (
            <ViroImage
              key={`${scope.sessionId}:${scope.placementRevision}:${scope.requestId}:${key}`}
              source={medicalVolumeSource(volume.modality, key)}
              width={0.001}
              height={0.001}
              opacity={0}
              ignoreEventHandling
              mipmap={false}
              format="RGBA8"
              onLoadEnd={(event) =>
                controller.finishVolumeAtlas(scope, key, isViroImageLoadSuccess(event))
              }
              onError={(event) => {
                controller.recordVolumeDiagnostic(
                  scope,
                  `Atlas ${key}: ${medicalNativeError(event)}`
                );
                controller.finishVolumeAtlas(scope, key, false);
              }}
            />
          ))
        : null}
      {volume.renderer === 'shader' &&
      materialReady &&
      (['binding', 'ready'].includes(volume.loadStatus) ||
        (magenta && volume.loadStatus === 'loading')) ? (
        <Viro3DObject
          key={materialKey}
          source={MEDICAL_VOLUME_BOX_SOURCE}
          type="OBJ"
          // iOS's materials clone omits custom sampler textures; shaderOverrides copies them.
          shaderOverrides={[MATERIAL]}
          visible={proxyVisible}
          onLoadStart={() => {
            controller.recordVolumeDiagnostic(scope, 'Volume proxy mesh load started.');
          }}
          onLoadEnd={() => {
            showProxy();
            controller.recordVolumeDiagnostic(
              scope,
              `Volume proxy mesh loaded · ${volume.debugMode}. Drawing unconfirmed.`
            );
            if (volume.loadStatus === 'binding' || (magenta && volume.loadStatus === 'loading')) {
              controller.finishVolumeBinding(scope, 'ready');
            }
          }}
          onError={(event) => {
            controller.recordVolumeDiagnostic(
              scope,
              `Volume proxy mesh: ${medicalNativeError(event)}`
            );
            controller.finishVolumeBinding(scope, 'error');
          }}
        />
      ) : null}
      {volume.cropBoxVisible && volume.cropping
        ? corners.flatMap((point, i) =>
            [1, 2, 4]
              .filter((bit) => (i & bit) === 0)
              .map((bit) => (
                <ViroPolyline
                  key={`${i}:${bit}`}
                  points={[point, corners[i | bit]]}
                  thickness={0.001}
                  materials={['medicalLeader']}
                  ignoreEventHandling
                />
              ))
          )
        : null}
    </ViroNode>
  );
}
