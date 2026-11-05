import { useEffect, useSyncExternalStore, type ComponentProps } from 'react';
import { Platform } from 'react-native';
import { ViroImage, ViroMaterials, ViroQuad } from '@reactvision/react-viro';
import metadata from '../../../assets/medical/stack/metadata.json';
import { MEDICAL_STACK_SOURCES } from '../../../assets/medical/stack/sources.native';
import type { MedicalSceneProps } from './medical-scene.native';
import { stackPlaneGeometry } from './medical-volume-stack';
import { STACK_PLANE_COUNT } from './medical-volumes';
import { medicalNativeError } from './medical-volume-diagnostics';
import { STACK_IOS_COLOR_FRAGMENT } from './medical-stack-color';

const NAMES = Array.from({ length: STACK_PLANE_COUNT }, (_, index) => `medicalStack${index}`);
export default function MedicalVolumeStack({ context, controller }: MedicalSceneProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { volume } = state;
  const preset = volume.appearance[volume.modality].preset;
  const images = MEDICAL_STACK_SOURCES[preset];
  const planes = metadata.presets[preset].planes;
  const scope = {
    sessionId: context.sessionId,
    placementRevision: state.placementRevision,
    requestId: volume.requestId,
  };
  const active = ['binding', 'ready'].includes(volume.loadStatus);
  useEffect(() => {
    if (!state.anchorId || !active) return;
    if (images.length !== STACK_PLANE_COUNT || planes.length !== STACK_PLANE_COUNT) {
      controller.recordVolumeDiagnostic(scope, 'Incomplete stacked slices');
      controller.finishVolumeBinding(scope, 'error');
      return;
    }
    let cancelled = false,
      first: number | undefined,
      second: number | undefined;
    try {
      ViroMaterials.createMaterials(
        Object.fromEntries(
          images.map((source, index) => [
            NAMES[index],
            {
              lightingModel: 'Constant',
              diffuseTexture: { source, mipmap: false, format: 'RGBA8' },
              ...(Platform.OS === 'ios'
                ? { shaderModifiers: { fragment: STACK_IOS_COLOR_FRAGMENT } }
                : {}),
              blendMode: 'Alpha',
              cullMode: 'None',
              writesToDepthBuffer: false,
              readsFromDepthBuffer: true,
            },
          ])
        )
      );
      // Native registration is queued and has no acknowledgement API. Defer geometry
      // mounting across two frames. This cannot acknowledge native registration or drawing.
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          if (!cancelled) controller.finishVolumeBinding(scope, 'ready');
        });
      });
    } catch (error) {
      controller.recordVolumeDiagnostic(scope, `Stack registration: ${String(error)}`);
      controller.finishVolumeBinding(scope, 'error');
    }
    return () => {
      cancelled = true;
      if (first !== undefined) cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
      ViroMaterials.deleteMaterials(NAMES);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controller,
    context.sessionId,
    state.anchorId,
    state.placementRevision,
    volume.requestId,
    preset,
    active,
  ]);
  if (volume.loadStatus === 'loading')
    return (
      <>
        {images.map((source, index) => (
          <ViroImage
            key={`${scope.sessionId}:${scope.placementRevision}:${scope.requestId}:${index}`}
            source={source}
            width={0.001}
            height={0.001}
            opacity={0}
            ignoreEventHandling
            mipmap={false}
            format="RGBA8"
            onLoadEnd={(event) =>
              controller.finishVolumeStackImage(scope, index, event.nativeEvent.success)
            }
            onError={(event) => {
              controller.recordVolumeDiagnostic(
                scope,
                `Plane ${index}: ${medicalNativeError(event)}`
              );
              controller.finishVolumeStackImage(scope, index, false);
            }}
          />
        ))}
      </>
    );
  if (volume.loadStatus !== 'ready') return null;
  return (
    <>
      {stackPlaneGeometry(controller.volumeDataset, volume, planes)
        .filter((plane) => plane.visible)
        .map((plane) => (
          <ViroQuad
            key={`${scope.requestId}:${plane.index}`}
            width={plane.width}
            height={plane.height}
            position={plane.position}
            rotation={[-90, 0, 0]}
            // iOS VRTQuad requires four flat scalars; 3.0.3's TS type incorrectly nests them.
            uvCoordinates={
              plane.uv as unknown as NonNullable<ComponentProps<typeof ViroQuad>['uvCoordinates']>
            }
            materials={[NAMES[plane.index]]}
            opacity={plane.opacity}
            renderingOrder={plane.renderingOrder}
            onError={(event) => {
              controller.recordVolumeDiagnostic(scope, `Stack node: ${medicalNativeError(event)}`);
              controller.finishVolumeBinding(scope, 'error');
            }}
          />
        ))}
    </>
  );
}
