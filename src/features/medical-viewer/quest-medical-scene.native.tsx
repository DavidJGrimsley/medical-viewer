import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ViroARPlaneSelector,
  ViroARScene,
  ViroNode,
  ViroTrackingStateConstants,
} from '@reactvision/react-viro';
import { VRQuestNavigatorBridge } from '@reactvision/react-viro/dist/components/Utilities/VRQuestNavigatorBridge';
import { exitVRScene } from '@reactvision/react-viro/dist/components/Utilities/VRModuleOpenXR';
import { useQuestSession } from '@/features/ar/quest-session-bridge';
import {
  computeQuestPanelTransform,
  computeSpecimenFromRig,
  rigForGrabBarFacing,
  type CameraPose,
  type Point3,
  type RigPose,
} from '@/features/ar/quest-spatial-math';
import { MedicalSceneContent, QUEST_WORLD_ANCHOR_ID } from './medical-scene-content.native';
import { QuestSpatialControls } from './quest-spatial-controls.native';

const ORIGIN: Point3 = [0, 0, 0];
// Gives React a frame to unmount the scene (hover state, text bitmaps, volume shader)
// before the OpenXR activity is torn down.
const EXIT_TEARDOWN_DELAY_MS = 150;
const DEFAULT_CAMERA_POSE: CameraPose = {
  position: [0, 1.5, 0],
  forward: [0, 0, -1],
  up: [0, 1, 0],
};

// ViroQuestEntryPoint can mount a newly launched VRActivity scene before the
// finishing VRActivity unmounts its old surface. Refcount per sessionId so a
// late unmount from the exiting activity never detaches the newly active scene.
const activeQuestSceneMounts = new Map<number, number>();

export function hasActiveQuestSceneMount(sessionId: number): boolean {
  return (activeQuestSceneMounts.get(sessionId) ?? 0) > 0;
}

export default function QuestMedicalScene() {
  const session = useQuestSession();
  // One rig pose drives both the control panel and the placed specimen so the
  // grab handle moves them together.
  const [rigPose, setRigPose] = useState<RigPose | null>(null);
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCameraRef = useRef<CameraPose | null>(null);
  const selectorRef = useRef<ViroARPlaneSelector>(null);
  const trackingState = useRef<number | null>(null);
  const cameraReady = useRef(false);

  const sessionId = session?.sessionId;
  const controller = session?.controller;
  const context = session?.context;

  // Immersive scene ownership: attach controller on mount, detach when last surface unmounts
  useEffect(() => {
    if (!sessionId || !controller) return;

    const nextCount = (activeQuestSceneMounts.get(sessionId) ?? 0) + 1;
    activeQuestSceneMounts.set(sessionId, nextCount);

    controller.attach(sessionId);
    // Quest default is the atlas-based raymarch shader renderer
    controller.setVolumeRenderer(sessionId, 'shader');

    const unsubscribeError = VRQuestNavigatorBridge.onQuestError(() => {
      context?.onError();
    });

    return () => {
      unsubscribeError();
      if (exitTimer.current) clearTimeout(exitTimer.current);
      const remaining = (activeQuestSceneMounts.get(sessionId) ?? 1) - 1;
      if (remaining <= 0) {
        activeQuestSceneMounts.delete(sessionId);
        controller.detach(sessionId);
      } else {
        activeQuestSceneMounts.set(sessionId, remaining);
      }
    };
  }, [sessionId, controller, context]);

  const handleRecenter = useCallback(() => {
    const pose = latestCameraRef.current ?? DEFAULT_CAMERA_POSE;
    setRigPose(computeQuestPanelTransform(pose));
  }, []);

  const handleMoveRig = useCallback((handleWorld: Point3) => {
    // Moving the rig also turns it to keep facing the wearer so it stays readable.
    const camera = latestCameraRef.current?.position ?? null;
    setRigPose((prev) => (prev ? rigForGrabBarFacing(prev, handleWorld, camera) : prev));
  }, []);

  const handleExit = useCallback(() => {
    if (!controller || exitTimer.current) return;
    controller.clearGestures();
    // Unmount all scene content first, then finish the activity on a later tick.
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      exitVRScene();
      // If the activity did not finish, restore the scene instead of leaving it blank.
      exitTimer.current = setTimeout(() => {
        exitTimer.current = null;
        setExiting(false);
      }, 4000);
    }, EXIT_TEARDOWN_DELAY_MS);
  }, [controller]);

  const handlePlaceInFront = useCallback(() => {
    if (!controller || !context) return;
    const pose = latestCameraRef.current ?? DEFAULT_CAMERA_POSE;
    setRigPose(computeQuestPanelTransform(pose));

    if (controller.getSnapshot().tracking === 'initializing' && cameraReady.current) {
      controller.setTracking(context.sessionId, true);
    }
    if (controller.getSnapshot().anchorId) {
      controller.reposition(context.sessionId);
    }
    selectorRef.current?.reset();
    controller.selectPlane(
      context.sessionId,
      controller.getSnapshot().placementRevision,
      QUEST_WORLD_ANCHOR_ID
    );
  }, [controller, context]);

  if (!session || !controller || !context) {
    return null;
  }

  const worldAnchorPose = rigPose ? computeSpecimenFromRig(rigPose) : null;

  const handleCameraUpdate = (camera: any) => {
    // Quest can report tracking unavailable during startup and then deliver
    // valid poses without a subsequent normal event. A first valid pose can
    // complete startup, but must not override an explicit limited state or a
    // tracking loss after startup.
    if (
      !cameraReady.current &&
      (trackingState.current === null ||
        trackingState.current === ViroTrackingStateConstants.TRACKING_UNAVAILABLE) &&
      Array.isArray(camera.position) &&
      camera.position.length === 3 &&
      camera.position.every(Number.isFinite) &&
      Array.isArray(camera.forward) &&
      camera.forward.length === 3 &&
      camera.forward.every(Number.isFinite) &&
      camera.forward.some((value: number) => value !== 0)
    ) {
      cameraReady.current = true;
      controller.setTracking(context.sessionId, true);
      context.onReady();
    }
    controller.updateVolumeCamera(context.sessionId, camera.forward);

    const pose: CameraPose = {
      position: camera.position,
      forward: camera.forward,
      up: camera.up,
    };
    latestCameraRef.current = pose;

    // Initialize stationary panel pose on first camera update if not already set
    setRigPose((prev) => prev ?? computeQuestPanelTransform(pose));
  };

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesHorizontal']}
      toneMappingEnabled={false}
      onCameraTransformUpdate={handleCameraUpdate}
      onAnchorFound={(anchor) => selectorRef.current?.handleAnchorFound(anchor)}
      onAnchorUpdated={(anchor) => selectorRef.current?.handleAnchorUpdated(anchor)}
      onAnchorRemoved={(anchor) => {
        if (anchor) selectorRef.current?.handleAnchorRemoved(anchor);
      }}
      onError={context.onError}
      onTrackingUpdated={(tracking) => {
        trackingState.current = tracking;
        const normal = tracking === ViroTrackingStateConstants.TRACKING_NORMAL;
        if (normal) cameraReady.current = true;
        controller.setTracking(context.sessionId, normal);
        if (!normal) {
          controller.clearGestures();
        }
        if (normal) context.onReady();
      }}>
      {/* Two static identity ViroNodes isolate dynamic children from VRTARScene.addView:
          VRTNode.onTreeUpdate only attempts ARScene.createAnchoredNode (unsupported on
          VROARSessionOpenXR) when getParent() instanceof VRTARScene, and VRTComponent.addView
          only notifies child + immediate parent. */}
      <ViroNode position={ORIGIN} rotation={ORIGIN}>
        <ViroNode position={ORIGIN} rotation={ORIGIN}>
          {/* 3D Scene Content: Anatomy, Slices, Volume with Plane & World Placement */}
          {exiting ? null : (
            <MedicalSceneContent
              context={context}
              controller={controller}
              isQuest={true}
              selectorRef={selectorRef}
              worldAnchorPose={worldAnchorPose}
            />
          )}

          {/* In-Scene Stationary Spatial Controls */}
          {exiting ? null : (
            <QuestSpatialControls
              context={context}
              controller={controller}
              panelPose={rigPose}
              onRecenter={handleRecenter}
              onPlaceInFront={handlePlaceInFront}
              onExit={handleExit}
              onMoveRig={handleMoveRig}
            />
          )}
        </ViroNode>
      </ViroNode>
    </ViroARScene>
  );
}
