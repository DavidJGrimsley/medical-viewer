import { ViroARScene, ViroTrackingStateConstants } from '@reactvision/react-viro';
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

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesHorizontal']}
      toneMappingEnabled={false}
      onCameraTransformUpdate={(camera) =>
        controller.updateVolumeCamera(context.sessionId, camera.forward)
      }
      onError={context.onError}
      onTrackingUpdated={(tracking) => {
        const normal = tracking === ViroTrackingStateConstants.TRACKING_NORMAL;
        controller.setTracking(context.sessionId, normal);
        if (normal) context.onReady();
      }}>
      <MedicalSceneContent context={context} controller={controller} isQuest={false} />
    </ViroARScene>
  );
}
