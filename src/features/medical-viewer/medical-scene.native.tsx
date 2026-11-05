import { useRef } from 'react';
import {
  ViroARPlaneSelector,
  ViroARScene,
  ViroTrackingStateConstants,
} from '@reactvision/react-viro';
import type { ARSceneContext } from '@/features/ar/ar-session-types';
import type { MedicalController } from './medical-controller';
import { MedicalSceneContent } from './medical-scene-content.native';

export interface MedicalSceneProps {
  context: ARSceneContext;
  controller: MedicalController;
}

export default function MedicalScene({
  sceneNavigator,
}: {
  sceneNavigator: { viroAppProps: MedicalSceneProps };
}) {
  const { context, controller } = sceneNavigator.viroAppProps;
  const selectorRef = useRef<ViroARPlaneSelector>(null);

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesHorizontal']}
      toneMappingEnabled={false}
      onCameraTransformUpdate={(camera) =>
        controller.updateVolumeCamera(context.sessionId, camera.forward)
      }
      onAnchorFound={(anchor) => selectorRef.current?.handleAnchorFound(anchor)}
      onAnchorUpdated={(anchor) => selectorRef.current?.handleAnchorUpdated(anchor)}
      onAnchorRemoved={(anchor) => {
        if (anchor) selectorRef.current?.handleAnchorRemoved(anchor);
      }}
      onError={context.onError}
      onTrackingUpdated={(tracking) => {
        const normal = tracking === ViroTrackingStateConstants.TRACKING_NORMAL;
        controller.setTracking(context.sessionId, normal);
        if (normal) context.onReady();
      }}>
      <MedicalSceneContent
        context={context}
        controller={controller}
        isQuest={false}
        selectorRef={selectorRef}
      />
    </ViroARScene>
  );
}
