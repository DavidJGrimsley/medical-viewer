import { useEffect, useSyncExternalStore } from 'react';
import { Image, NativeModules, TurboModuleRegistry } from 'react-native';
import {
  ViroBox,
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
import { medicalVolumeSource } from './medical-volume-assets.native';
import { VOLUME_ATLASES } from './medical-volumes';
import { volumeExtent, volumeUniforms } from './medical-volume-uniforms';
import { volumeDiagnosticShader, medicalNativeError } from './medical-volume-diagnostics';
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
    let cancelled = false,
      second: number | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!cancelled) controller.finishVolumeBinding(scope, 'ready');
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
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
  return { scope, series, magenta };
}
export default function MedicalVolume({ context, controller }: MedicalSceneProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { volume } = state;
  const dataset = controller.volumeDataset;
  const { scope, series, magenta } = useVolumeRendering({ context, controller }, state);
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
                controller.finishVolumeAtlas(scope, key, event.nativeEvent.success)
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
      {volume.renderer === 'shader' && volume.loadStatus === 'ready' ? (
        <ViroBox
          key={`${scope.sessionId}:${scope.placementRevision}:${scope.requestId}:${volume.debugMode}`}
          width={extent[0]}
          height={extent[2]}
          length={extent[1]}
          // iOS's materials clone omits custom sampler textures; shaderOverrides copies them.
          shaderOverrides={[MATERIAL]}
          onError={(event) => {
            controller.recordVolumeDiagnostic(scope, `Native box: ${medicalNativeError(event)}`);
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
