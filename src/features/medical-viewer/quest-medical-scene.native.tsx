import { useCallback, useEffect, useRef, useState } from 'react';
import { ViroARScene, ViroController, ViroTrackingStateConstants } from '@reactvision/react-viro';
import { VRQuestNavigatorBridge } from '@reactvision/react-viro/dist/components/Utilities/VRQuestNavigatorBridge';
import { useQuestSession } from '@/features/ar/quest-session-bridge';
import {
  computeHeadLockedTransform,
  type CameraPose,
  type Point3,
  type Rotation3,
} from '@/features/ar/quest-spatial-math';
import { MedicalSceneContent } from './medical-scene-content.native';
import { QuestSpatialControls } from './quest-spatial-controls.native';

export default function QuestMedicalScene() {
  const session = useQuestSession();
  const [panelPose, setPanelPose] = useState<{ position: Point3; rotation: Rotation3 } | null>(
    null
  );
  const latestCameraRef = useRef<CameraPose | null>(null);

  const sessionId = session?.sessionId;
  const controller = session?.controller;
  const context = session?.context;

  // Immersive scene ownership: attach controller on mount, detach on unmount
  useEffect(() => {
    if (!sessionId || !controller) return;

    controller.attach(sessionId);
    // Quest default is the atlas-based raymarch shader renderer
    controller.setVolumeRenderer(sessionId, 'shader');

    const unsubscribeError = VRQuestNavigatorBridge.onQuestError(() => {
      context?.onError();
    });

    return () => {
      unsubscribeError();
      controller.detach(sessionId);
    };
  }, [sessionId, controller, context]);

  const handleRecenter = useCallback(() => {
    if (latestCameraRef.current) {
      const updatedPose = computeHeadLockedTransform(latestCameraRef.current, {
        distanceM: 1.15,
        verticalOffsetM: -0.05,
      });
      setPanelPose(updatedPose);
    }
  }, []);

  if (!session || !controller || !context) {
    return null;
  }

  const handleCameraUpdate = (camera: any) => {
    controller.updateVolumeCamera(context.sessionId, camera.forward);

    const pose: CameraPose = {
      position: camera.position,
      forward: camera.forward,
      up: camera.up,
    };
    latestCameraRef.current = pose;

    // Initialize stationary panel pose on first camera update if not already set
    setPanelPose((prev) => {
      if (prev) return prev;
      return computeHeadLockedTransform(pose, {
        distanceM: 1.15,
        verticalOffsetM: -0.05,
      });
    });
  };

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesHorizontal']}
      toneMappingEnabled={false}
      onCameraTransformUpdate={handleCameraUpdate}
      onError={context.onError}
      onTrackingUpdated={(tracking) => {
        const normal = tracking === ViroTrackingStateConstants.TRACKING_NORMAL;
        controller.setTracking(context.sessionId, normal);
        if (!normal) {
          controller.clearGestures();
        }
        if (normal) context.onReady();
      }}>
      {/* 3D Scene Content: Anatomy, Slices, Volume with Plane Selection */}
      <MedicalSceneContent context={context} controller={controller} isQuest={true} />

      {/* In-Scene Stationary Spatial Controls */}
      <QuestSpatialControls
        context={context}
        controller={controller}
        panelPose={panelPose}
        onRecenter={handleRecenter}
      />

      {/* Controller listener for tracking status and safety cleanup */}
      <ViroController
        onControllerStatus={(status) => {
          if (status === 'disconnected') {
            controller.clearGestures();
          }
        }}
      />
    </ViroARScene>
  );
}
