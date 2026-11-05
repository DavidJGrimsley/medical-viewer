import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  Viro3DObject,
  ViroAmbientLight,
  ViroARPlaneSelector,
  ViroDirectionalLight,
  ViroImage,
  ViroMaterials,
  ViroNode,
  ViroPolyline,
  ViroSphere,
  ViroText,
} from '@reactvision/react-viro';
import type { ARSceneContext } from '@/features/ar/ar-session-types';
import type { MedicalController, MedicalScope, MedicalSliceScope } from './medical-controller';
import { canManipulateMedical, canManipulateSlices } from './medical-controller';
import { SLICE_PANEL_WIDTH_METRES } from './medical-slices';
import { medicalSliceSource } from './medical-slice-assets.native';
import {
  hasMedicalLabels,
  MEDICAL_ASSETS,
  MEDICAL_MODEL_ASSETS,
  type Point3,
} from './medical-models';
import { MEDICAL_ASSET_SOURCES } from './medical-asset-sources.native';
import calibration from '../../../assets/medical/skull-labels.json';
import MedicalVolume from './medical-volume.native';

ViroMaterials.createMaterials({
  medicalLabel: { diffuseColor: '#fff1da', lightingModel: 'Constant' },
  medicalLeader: { diffuseColor: '#93f5c5', lightingModel: 'Constant' },
});

export interface MedicalSceneContentProps {
  context: ARSceneContext;
  controller: MedicalController;
  isQuest?: boolean;
  selectorRef?: React.RefObject<ViroARPlaneSelector | null>;
}

function MedicalModels({ context, controller }: MedicalSceneContentProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const scope: MedicalScope = {
    sessionId: context.sessionId,
    modelId: state.modelId,
    placementRevision: state.placementRevision,
    loadAttempt: state.loadAttempt,
  };

  useEffect(() => {
    if (state.loadStatus !== 'loading') return;
    const token = {
      sessionId: context.sessionId,
      modelId: state.modelId,
      placementRevision: state.placementRevision,
      loadAttempt: state.loadAttempt,
    };
    const timeout = setTimeout(() => {
      const current = controller.getSnapshot();
      for (const assetId of MEDICAL_MODEL_ASSETS[token.modelId]) {
        if (current.assetLoads[assetId] === 'loading') controller.finishLoad(token, assetId, false);
      }
    }, 30000);
    return () => clearTimeout(timeout);
  }, [
    controller,
    context.sessionId,
    state.modelId,
    state.loadStatus,
    state.placementRevision,
    state.loadAttempt,
  ]);

  const interactive = canManipulateMedical(state);
  if (!state.anchorId || state.loadStatus === 'error') return null;

  return (
    <ViroNode
      position={[state.x, state.height, state.z]}
      rotation={[0, state.yaw, 0]}
      scale={[state.scale, state.scale, state.scale]}
      onPinch={
        interactive ? (gesture, factor) => controller.pinch(scope, gesture, factor) : undefined
      }
      onRotate={
        interactive ? (gesture, factor) => controller.rotate(scope, gesture, factor) : undefined
      }>
      {MEDICAL_MODEL_ASSETS[state.modelId].map((assetId) => {
        const transform = MEDICAL_ASSETS[assetId].transform;
        if (!transform) return null;
        return (
          <Viro3DObject
            key={`${state.modelId}:${assetId}:${state.placementRevision}:${state.loadAttempt}`}
            source={MEDICAL_ASSET_SOURCES[assetId]}
            type="GLB"
            position={transform.position}
            rotation={transform.rotation}
            scale={transform.scale}
            onLoadEnd={() => controller.finishLoad(scope, assetId, true)}
            onError={() => controller.finishLoad(scope, assetId, false)}
          />
        );
      })}
      {state.loadStatus === 'ready' && state.labelsVisible && hasMedicalLabels(state.modelId)
        ? calibration.labels.map((label) => {
            const position: Point3 = [
              Math.sign(label.position[0]) *
                (Math.abs(label.position[0]) + 0.07 * (1 / state.scale - 1)),
              label.position[1],
              label.position[2],
            ];
            return (
              <ViroNode key={label.name} ignoreEventHandling>
                <ViroSphere
                  radius={0.0015 / state.scale}
                  position={label.anchor as Point3}
                  materials={['medicalLeader']}
                />
                <ViroPolyline
                  points={[label.anchor as Point3, position]}
                  thickness={0.0007 / state.scale}
                  materials={['medicalLeader']}
                />
                <ViroText
                  text={label.name}
                  position={position}
                  width={5}
                  height={1}
                  scale={[0.028 / state.scale, 0.028 / state.scale, 0.028 / state.scale]}
                  transformBehaviors={['billboard']}
                  extrusionDepth={0.004}
                  materials={['medicalLabel', 'medicalLabel', 'medicalLabel']}
                  maxLines={1}
                  textLineBreakMode="None"
                  style={{
                    fontSize: 48,
                    fontWeight: 'bold',
                    color: '#fff1da',
                    textAlign: 'center',
                  }}
                />
              </ViroNode>
            );
          })
        : null}
    </ViroNode>
  );
}

function MedicalSlicePanel({ context, controller }: MedicalSceneContentProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { slices } = state;
  const series = controller.getSliceSeries();
  const source = medicalSliceSource(slices.modality, slices.orientation, slices.index);
  const scope: MedicalSliceScope = {
    sessionId: context.sessionId,
    placementRevision: state.placementRevision,
    requestId: slices.requestId,
  };

  useEffect(() => {
    if (!state.anchorId || slices.loadStatus !== 'loading') return;
    if (source === undefined) {
      controller.finishSliceLoad(scope, false);
      return;
    }
    const timeout = setTimeout(() => controller.finishSliceLoad(scope, false), 30000);
    return () => clearTimeout(timeout);
    // Scope values identify this mounted image request, including Retry and placement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controller,
    context.sessionId,
    state.anchorId,
    state.placementRevision,
    slices.requestId,
    slices.loadStatus,
    source,
  ]);

  if (!state.anchorId || !series || source === undefined) return null;
  const interactive = canManipulateSlices(state);
  const height = (SLICE_PANEL_WIDTH_METRES * series.imageDimensions[1]) / series.imageDimensions[0];

  return (
    <ViroNode
      position={[slices.x, slices.height, slices.z]}
      rotation={[0, slices.yaw, 0]}
      scale={[slices.scale, slices.scale, slices.scale]}
      onPinch={
        interactive
          ? (gesture, factor) => controller.panelGesture(scope, 'pinch', gesture, factor)
          : undefined
      }
      onRotate={
        interactive
          ? (gesture, factor) => controller.panelGesture(scope, 'rotate', gesture, factor)
          : undefined
      }>
      {slices.loadStatus !== 'error' ? (
        <ViroImage
          key={`${scope.sessionId}:${scope.placementRevision}:${scope.requestId}`}
          source={source}
          width={SLICE_PANEL_WIDTH_METRES}
          height={height}
          resizeMode="ScaleToFit"
          mipmap
          onLoadEnd={(event) => controller.finishSliceLoad(scope, event.nativeEvent.success)}
          onError={() => controller.finishSliceLoad(scope, false)}
        />
      ) : null}
      <ViroText
        text={`${slices.modality.toUpperCase()} · ${slices.orientation} · ${slices.index + 1}/${series.imageCount}\nR  ←  A at top  →  L`}
        position={[0, -height / 2 - 0.055, 0.002]}
        width={SLICE_PANEL_WIDTH_METRES / 0.05}
        height={0.09 / 0.05}
        scale={[0.05, 0.05, 0.05]}
        style={{ fontSize: 20, color: '#e2e8f0', textAlign: 'center' }}
      />
    </ViroNode>
  );
}

export function MedicalSceneContent({
  context,
  controller,
  isQuest = false,
  selectorRef: externalSelectorRef,
}: MedicalSceneContentProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const internalSelectorRef = useRef<ViroARPlaneSelector>(null);
  const selector = externalSelectorRef ?? internalSelectorRef;

  useEffect(() => {
    selector.current?.reset();
  }, [selector, state.placementRevision, context.sessionId]);

  return (
    <>
      <ViroAmbientLight color="#ffffff" intensity={550} />
      <ViroDirectionalLight color="#ffffff" intensity={750} direction={[-1, -1, -1]} />
      <ViroARPlaneSelector
        ref={selector}
        alignment="Horizontal"
        minWidth={0.25}
        minHeight={0.25}
        hideOverlayOnSelection
        disableClickSelection={state.tracking !== 'normal' || !!state.anchorId}
        onPlaneSelected={(plane) => {
          controller.selectPlane(context.sessionId, state.placementRevision, plane.anchorId);
          if (!controller.getSnapshot().anchorId) selector.current?.reset();
        }}
        onPlaneRemoved={(id) =>
          controller.losePlane(context.sessionId, state.placementRevision, id)
        }>
        {state.mode === 'anatomy' ? (
          <MedicalModels context={context} controller={controller} isQuest={isQuest} />
        ) : state.mode === 'slices' ? (
          <MedicalSlicePanel context={context} controller={controller} isQuest={isQuest} />
        ) : (
          <MedicalVolume context={context} controller={controller} />
        )}
      </ViroARPlaneSelector>
    </>
  );
}
