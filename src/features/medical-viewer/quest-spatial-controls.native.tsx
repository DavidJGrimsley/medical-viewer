import { useState, useSyncExternalStore } from 'react';
import {
  useAnySourceHover,
  useAnySourcePressed,
  ViroMaterials,
  ViroNode,
  ViroQuad,
  ViroText,
} from '@reactvision/react-viro';
import { exitVRScene } from '@reactvision/react-viro/dist/components/Utilities/VRModuleOpenXR';
import type { ARSceneContext } from '@/features/ar/ar-session-types';
import {
  canManipulateMedical,
  canManipulateSlices,
  canManipulateVolume,
  DEFAULT_MODEL_HEIGHT,
  MAX_MODEL_HEIGHT,
  MAX_MODEL_SCALE,
  MedicalController,
  medicalStatus,
  MIN_MODEL_HEIGHT,
  MIN_MODEL_SCALE,
} from './medical-controller';
import { type VolumePreset, type VolumeQuality } from './medical-volumes';
import { hasMedicalLabels, type MedicalModelId } from './medical-models';
import type { SliceModality } from './medical-slices';

ViroMaterials.createMaterials({
  questPanelBg: {
    lightingModel: 'Constant',
    diffuseColor: '#0f172aee',
    writesToDepthBuffer: true,
  },
  questPanelBorder: {
    lightingModel: 'Constant',
    diffuseColor: '#334155',
    writesToDepthBuffer: true,
  },
  questBtnIdle: {
    lightingModel: 'Constant',
    diffuseColor: '#1e293bcc',
    writesToDepthBuffer: true,
  },
  questBtnHover: {
    lightingModel: 'Constant',
    diffuseColor: '#38bdf8cc',
    writesToDepthBuffer: true,
  },
  questBtnPressed: {
    lightingModel: 'Constant',
    diffuseColor: '#0284c7',
    writesToDepthBuffer: true,
  },
  questBtnSelected: {
    lightingModel: 'Constant',
    diffuseColor: '#0ea5e9',
    writesToDepthBuffer: true,
  },
  questBtnDisabled: {
    lightingModel: 'Constant',
    diffuseColor: '#33415588',
    writesToDepthBuffer: true,
  },
  questBtnDanger: {
    lightingModel: 'Constant',
    diffuseColor: '#ef4444cc',
    writesToDepthBuffer: true,
  },
  questBtnAccent: {
    lightingModel: 'Constant',
    diffuseColor: '#10b981cc',
    writesToDepthBuffer: true,
  },
});

export interface QuestSpatialButtonProps {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  width?: number;
  height?: number;
  fontSize?: number;
  position?: [number, number, number];
  variant?: 'default' | 'danger' | 'accent';
  testID?: string;
}

export function QuestSpatialButton({
  label,
  onPress,
  selected = false,
  disabled = false,
  width = 0.18,
  height = 0.05,
  fontSize = 14,
  position = [0, 0, 0],
  variant = 'default',
}: QuestSpatialButtonProps) {
  const [hovered, onHover] = useAnySourceHover();
  const [pressed, onClickState] = useAnySourcePressed();

  const material = disabled
    ? 'questBtnDisabled'
    : pressed
      ? 'questBtnPressed'
      : hovered
        ? 'questBtnHover'
        : selected
          ? 'questBtnSelected'
          : variant === 'danger'
            ? 'questBtnDanger'
            : variant === 'accent'
              ? 'questBtnAccent'
              : 'questBtnIdle';

  const textColor = disabled
    ? '#64748b'
    : pressed
      ? '#ffffff'
      : hovered
        ? '#0f172a'
        : selected
          ? '#ffffff'
          : '#f8fafc';

  return (
    <ViroNode
      position={position}
      onHover={disabled ? undefined : onHover}
      onClickState={disabled ? undefined : onClickState}
      onClick={disabled ? undefined : onPress}>
      <ViroQuad width={width} height={height} materials={[material]} />
      <ViroText
        text={label}
        position={[0, 0, 0.002]}
        width={width}
        height={height}
        maxLines={1}
        style={{
          fontFamily: 'sans-serif',
          fontSize,
          fontWeight: selected || hovered ? 'bold' : 'normal',
          color: textColor,
          textAlign: 'center',
          textAlignVertical: 'center',
        }}
      />
    </ViroNode>
  );
}

export interface QuestSpatialControlsProps {
  context: ARSceneContext;
  controller: MedicalController;
  panelPose: { position: [number, number, number]; rotation: [number, number, number] } | null;
  onRecenter: () => void;
}

export function QuestSpatialControls({
  context,
  controller,
  panelPose,
  onRecenter,
}: QuestSpatialControlsProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [transformOpen, setTransformOpen] = useState(false);

  const sessionId = context.sessionId;
  const currentStatus = medicalStatus(state);

  const scope = {
    sessionId,
    modelId: state.modelId,
    placementRevision: state.placementRevision,
    loadAttempt: state.loadAttempt,
  };

  const sliceScope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: state.slices.requestId,
  };

  const volumeScope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: state.volume.requestId,
  };

  const sliceSeries = controller.getSliceSeries();

  const handleExit = () => {
    controller.detach(sessionId);
    exitVRScene();
  };

  if (!panelPose) return null;

  return (
    <ViroNode position={panelPose.position} rotation={panelPose.rotation}>
      {/* Background Panel */}
      <ViroQuad position={[0, 0, -0.005]} width={0.88} height={0.58} materials={['questPanelBg']} />

      {/* Header Bar */}
      <ViroText
        text="Medical Viewer (MR)"
        position={[-0.22, 0.24, 0.002]}
        width={0.4}
        height={0.05}
        style={{
          fontFamily: 'sans-serif',
          fontSize: 18,
          fontWeight: 'bold',
          color: '#38bdf8',
          textAlign: 'left',
          textAlignVertical: 'center',
        }}
      />
      <QuestSpatialButton
        label="Recenter"
        position={[0.2, 0.24, 0.002]}
        width={0.16}
        height={0.045}
        fontSize={13}
        onPress={onRecenter}
      />
      <QuestSpatialButton
        label="Exit VR"
        variant="danger"
        position={[0.36, 0.24, 0.002]}
        width={0.14}
        height={0.045}
        fontSize={13}
        onPress={handleExit}
      />

      {/* Status Line */}
      <ViroText
        text={currentStatus || 'Ready'}
        position={[0, 0.18, 0.002]}
        width={0.84}
        height={0.04}
        style={{
          fontFamily: 'sans-serif',
          fontSize: 13,
          color:
            state.loadStatus === 'error' ||
            state.slices.loadStatus === 'error' ||
            state.volume.loadStatus === 'error'
              ? '#fde68a'
              : '#94a3b8',
          textAlign: 'center',
          textAlignVertical: 'center',
        }}
      />

      {/* Mode Switcher */}
      <ViroNode position={[0, 0.12, 0]}>
        <QuestSpatialButton
          label="Anatomy"
          selected={state.mode === 'anatomy'}
          position={[-0.28, 0, 0.002]}
          width={0.24}
          height={0.05}
          fontSize={15}
          onPress={() => {
            setTransformOpen(false);
            controller.selectViewerMode(sessionId, 'anatomy');
          }}
        />
        <QuestSpatialButton
          label="Scan Slices"
          selected={state.mode === 'slices'}
          position={[0, 0, 0.002]}
          width={0.24}
          height={0.05}
          fontSize={15}
          onPress={() => {
            setTransformOpen(false);
            controller.selectViewerMode(sessionId, 'slices');
          }}
        />
        <QuestSpatialButton
          label="3D Scan"
          selected={state.mode === 'volume'}
          position={[0.28, 0, 0.002]}
          width={0.24}
          height={0.05}
          fontSize={15}
          onPress={() => {
            setTransformOpen(false);
            controller.selectViewerMode(sessionId, 'volume');
          }}
        />
      </ViroNode>

      {/* Sub-Panel: Transform Mode or Representation Mode Controls */}
      {transformOpen ? (
        <ViroNode position={[0, -0.06, 0]}>
          <ViroText
            text="Adjust Placement & Pose"
            position={[0, 0.08, 0.002]}
            width={0.8}
            height={0.03}
            style={{
              fontFamily: 'sans-serif',
              fontSize: 14,
              fontWeight: 'bold',
              color: '#38bdf8',
              textAlign: 'center',
            }}
          />

          {/* Scale adjustments */}
          <ViroNode position={[0, 0.02, 0]}>
            <QuestSpatialButton
              label="Scale -"
              position={[-0.26, 0, 0.002]}
              width={0.16}
              height={0.045}
              disabled={
                state.mode === 'anatomy'
                  ? state.scale <= MIN_MODEL_SCALE
                  : state.mode === 'slices'
                    ? state.slices.scale <= 0.4
                    : state.volume.scale <= 0.4
              }
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setScale(scope, Math.max(MIN_MODEL_SCALE, state.scale - 0.2));
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(
                    sliceScope,
                    'scale',
                    Math.max(0.4, state.slices.scale - 0.2)
                  );
                } else {
                  controller.setVolumeTransform(
                    volumeScope,
                    'scale',
                    Math.max(0.4, state.volume.scale - 0.2)
                  );
                }
              }}
            />
            <ViroText
              text={`Scale: ${(state.mode === 'anatomy' ? state.scale : state.mode === 'slices' ? state.slices.scale : state.volume.scale).toFixed(2)}x`}
              position={[0, 0, 0.002]}
              width={0.24}
              height={0.04}
              style={{
                fontFamily: 'sans-serif',
                fontSize: 14,
                color: '#f8fafc',
                textAlign: 'center',
                textAlignVertical: 'center',
              }}
            />
            <QuestSpatialButton
              label="Scale +"
              position={[0.26, 0, 0.002]}
              width={0.16}
              height={0.045}
              disabled={
                state.mode === 'anatomy'
                  ? state.scale >= MAX_MODEL_SCALE
                  : state.mode === 'slices'
                    ? state.slices.scale >= 3.0
                    : state.volume.scale >= 3.0
              }
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setScale(scope, Math.min(MAX_MODEL_SCALE, state.scale + 0.2));
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(
                    sliceScope,
                    'scale',
                    Math.min(3.0, state.slices.scale + 0.2)
                  );
                } else {
                  controller.setVolumeTransform(
                    volumeScope,
                    'scale',
                    Math.min(3.0, state.volume.scale + 0.2)
                  );
                }
              }}
            />
          </ViroNode>

          {/* Height adjustments */}
          <ViroNode position={[0, -0.04, 0]}>
            <QuestSpatialButton
              label="Lower (-5cm)"
              position={[-0.26, 0, 0.002]}
              width={0.16}
              height={0.045}
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setHeight(scope, Math.max(MIN_MODEL_HEIGHT, state.height - 0.05));
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(
                    sliceScope,
                    'height',
                    Math.max(MIN_MODEL_HEIGHT, state.slices.height - 0.05)
                  );
                } else {
                  controller.setVolumeTransform(
                    volumeScope,
                    'height',
                    Math.max(MIN_MODEL_HEIGHT, state.volume.height - 0.05)
                  );
                }
              }}
            />
            <ViroText
              text={`Height: ${Math.round((state.mode === 'anatomy' ? state.height : state.mode === 'slices' ? state.slices.height : state.volume.height) * 100)}cm`}
              position={[0, 0, 0.002]}
              width={0.24}
              height={0.04}
              style={{
                fontFamily: 'sans-serif',
                fontSize: 14,
                color: '#f8fafc',
                textAlign: 'center',
                textAlignVertical: 'center',
              }}
            />
            <QuestSpatialButton
              label="Raise (+5cm)"
              position={[0.26, 0, 0.002]}
              width={0.16}
              height={0.045}
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setHeight(scope, Math.min(MAX_MODEL_HEIGHT, state.height + 0.05));
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(
                    sliceScope,
                    'height',
                    Math.min(MAX_MODEL_HEIGHT, state.slices.height + 0.05)
                  );
                } else {
                  controller.setVolumeTransform(
                    volumeScope,
                    'height',
                    Math.min(MAX_MODEL_HEIGHT, state.volume.height + 0.05)
                  );
                }
              }}
            />
          </ViroNode>

          {/* Yaw rotation adjustments */}
          <ViroNode position={[0, -0.1, 0]}>
            <QuestSpatialButton
              label="Turn Left"
              position={[-0.26, 0, 0.002]}
              width={0.16}
              height={0.045}
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setYaw(scope, state.yaw - 15);
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(sliceScope, 'yaw', state.slices.yaw - 15);
                } else {
                  controller.setVolumeTransform(volumeScope, 'yaw', state.volume.yaw - 15);
                }
              }}
            />
            <ViroText
              text={`Yaw: ${Math.round(state.mode === 'anatomy' ? state.yaw : state.mode === 'slices' ? state.slices.yaw : state.volume.yaw)}°`}
              position={[0, 0, 0.002]}
              width={0.24}
              height={0.04}
              style={{
                fontFamily: 'sans-serif',
                fontSize: 14,
                color: '#f8fafc',
                textAlign: 'center',
                textAlignVertical: 'center',
              }}
            />
            <QuestSpatialButton
              label="Turn Right"
              position={[0.26, 0, 0.002]}
              width={0.16}
              height={0.045}
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setYaw(scope, state.yaw + 15);
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(sliceScope, 'yaw', state.slices.yaw + 15);
                } else {
                  controller.setVolumeTransform(volumeScope, 'yaw', state.volume.yaw + 15);
                }
              }}
            />
          </ViroNode>

          {/* Reposition & Done */}
          <ViroNode position={[0, -0.16, 0]}>
            <QuestSpatialButton
              label="Reposition"
              position={[-0.24, 0, 0.002]}
              width={0.18}
              height={0.045}
              onPress={() => {
                controller.reposition(sessionId);
              }}
            />
            <QuestSpatialButton
              label="Reset Pose"
              position={[0, 0, 0.002]}
              width={0.18}
              height={0.045}
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setScale(scope, 1.0);
                  controller.setHeight(scope, DEFAULT_MODEL_HEIGHT);
                  controller.setYaw(scope, 0);
                } else if (state.mode === 'slices') {
                  controller.resetPanel(sessionId);
                } else {
                  controller.resetVolumeTransform(sessionId);
                }
              }}
            />
            <QuestSpatialButton
              label="Done"
              variant="accent"
              position={[0.24, 0, 0.002]}
              width={0.18}
              height={0.045}
              onPress={() => setTransformOpen(false)}
            />
          </ViroNode>
        </ViroNode>
      ) : state.mode === 'anatomy' ? (
        <ViroNode position={[0, -0.06, 0]}>
          {/* Anatomy Models Selector Row */}
          <ViroNode position={[0, 0.05, 0]}>
            {(
              [
                ['both', 'Both'],
                ['skull', 'Skull'],
                ['brain', 'Brain'],
                ['half-skull', 'Half Skull'],
              ] as const
            ).map(([modelId, label], i) => (
              <QuestSpatialButton
                key={modelId}
                label={label}
                selected={state.modelId === modelId}
                position={[-0.315 + i * 0.21, 0, 0.002]}
                width={0.19}
                height={0.048}
                fontSize={13}
                onPress={() => controller.selectModel(sessionId, modelId as MedicalModelId)}
              />
            ))}
          </ViroNode>

          {/* Anatomy Actions Row */}
          <ViroNode position={[0, -0.04, 0]}>
            <QuestSpatialButton
              label={state.labelsVisible ? 'Labels: ON' : 'Labels: OFF'}
              selected={state.labelsVisible}
              disabled={!canManipulateMedical(state) || !hasMedicalLabels(state.modelId)}
              position={[-0.22, 0, 0.002]}
              width={0.24}
              height={0.048}
              fontSize={13}
              onPress={() => controller.toggleLabels(sessionId)}
            />
            <QuestSpatialButton
              label="Transform"
              disabled={!state.anchorId}
              position={[0.22, 0, 0.002]}
              width={0.24}
              height={0.048}
              fontSize={13}
              onPress={() => setTransformOpen(true)}
            />
          </ViroNode>

          {state.loadStatus === 'error' ? (
            <ViroNode position={[0, -0.12, 0]}>
              <QuestSpatialButton
                label="Retry Loading Anatomy"
                variant="danger"
                position={[0, 0, 0.002]}
                width={0.34}
                height={0.048}
                onPress={() => controller.retryLoad(sessionId)}
              />
            </ViroNode>
          ) : null}
        </ViroNode>
      ) : state.mode === 'slices' ? (
        <ViroNode position={[0, -0.06, 0]}>
          {/* Modality & Orientation Row */}
          <ViroNode position={[0, 0.06, 0]}>
            {(['mri', 'ct'] as const).map((mod, i) => (
              <QuestSpatialButton
                key={mod}
                label={mod.toUpperCase()}
                selected={state.slices.modality === mod}
                position={[-0.24 + i * 0.22, 0, 0.002]}
                width={0.2}
                height={0.045}
                fontSize={13}
                onPress={() => controller.selectModality(sessionId, mod as SliceModality)}
              />
            ))}
            <ViroText
              text="Axial Series (RAS)"
              position={[0.2, 0, 0.002]}
              width={0.3}
              height={0.04}
              style={{
                fontFamily: 'sans-serif',
                fontSize: 13,
                color: '#94a3b8',
                textAlign: 'center',
                textAlignVertical: 'center',
              }}
            />
          </ViroNode>

          {/* Slice Browsing Row */}
          {sliceSeries ? (
            <ViroNode position={[0, -0.01, 0]}>
              <QuestSpatialButton
                label="<< -5"
                disabled={state.slices.index < 5}
                position={[-0.32, 0, 0.002]}
                width={0.12}
                height={0.045}
                fontSize={12}
                onPress={() =>
                  controller.selectSlice(sliceScope, Math.max(0, state.slices.index - 5))
                }
              />
              <QuestSpatialButton
                label="< Prev"
                disabled={state.slices.index === 0}
                position={[-0.18, 0, 0.002]}
                width={0.13}
                height={0.045}
                fontSize={13}
                onPress={() => controller.selectSlice(sliceScope, state.slices.index - 1)}
              />
              <ViroText
                text={`Slice ${state.slices.index + 1}/${sliceSeries.imageCount}`}
                position={[0.02, 0, 0.002]}
                width={0.22}
                height={0.04}
                style={{
                  fontFamily: 'sans-serif',
                  fontSize: 13,
                  color: '#f8fafc',
                  textAlign: 'center',
                  textAlignVertical: 'center',
                }}
              />
              <QuestSpatialButton
                label="Next >"
                disabled={state.slices.index >= sliceSeries.imageCount - 1}
                position={[0.18, 0, 0.002]}
                width={0.13}
                height={0.045}
                fontSize={13}
                onPress={() => controller.selectSlice(sliceScope, state.slices.index + 1)}
              />
              <QuestSpatialButton
                label="+5 >>"
                disabled={state.slices.index >= sliceSeries.imageCount - 5}
                position={[0.32, 0, 0.002]}
                width={0.12}
                height={0.045}
                fontSize={12}
                onPress={() =>
                  controller.selectSlice(
                    sliceScope,
                    Math.min(sliceSeries.imageCount - 1, state.slices.index + 5)
                  )
                }
              />
            </ViroNode>
          ) : null}

          {/* Slices Actions */}
          <ViroNode position={[0, -0.08, 0]}>
            <QuestSpatialButton
              label="Reset Slice"
              position={[-0.22, 0, 0.002]}
              width={0.22}
              height={0.045}
              fontSize={13}
              onPress={() => controller.resetSlice(sessionId)}
            />
            <QuestSpatialButton
              label="Transform"
              disabled={!canManipulateSlices(state)}
              position={[0.22, 0, 0.002]}
              width={0.22}
              height={0.045}
              fontSize={13}
              onPress={() => setTransformOpen(true)}
            />
          </ViroNode>

          {state.slices.loadStatus === 'error' ? (
            <ViroNode position={[0, -0.15, 0]}>
              <QuestSpatialButton
                label="Retry Loading Slice"
                variant="danger"
                position={[0, 0, 0.002]}
                width={0.34}
                height={0.045}
                onPress={() => controller.retrySliceLoad(sessionId)}
              />
            </ViroNode>
          ) : null}
        </ViroNode>
      ) : (
        /* 3D Scan (Volume) Mode */
        <ViroNode position={[0, -0.06, 0]}>
          {/* Experimental Notice */}
          <ViroText
            text="Experimental 3D Scan Volume (Raymarch)"
            position={[0, 0.08, 0.002]}
            width={0.8}
            height={0.025}
            style={{
              fontFamily: 'sans-serif',
              fontSize: 11,
              color: '#38bdf8',
              textAlign: 'center',
            }}
          />

          {/* Modality & Quality Row */}
          <ViroNode position={[0, 0.04, 0]}>
            {(['mri', 'ct'] as const).map((mod, i) => (
              <QuestSpatialButton
                key={mod}
                label={mod.toUpperCase()}
                selected={state.volume.modality === mod}
                position={[-0.3 + i * 0.2, 0, 0.002]}
                width={0.18}
                height={0.042}
                fontSize={13}
                onPress={() => controller.selectVolumeModality(sessionId, mod as SliceModality)}
              />
            ))}
            {(['balanced', 'fast'] as const).map((q, i) => (
              <QuestSpatialButton
                key={q}
                label={q === 'balanced' ? 'Balanced' : 'Fast'}
                selected={state.volume.quality === q}
                position={[0.12 + i * 0.22, 0, 0.002]}
                width={0.2}
                height={0.042}
                fontSize={12}
                onPress={() =>
                  controller.configureVolume(volumeScope, { quality: q as VolumeQuality })
                }
              />
            ))}
          </ViroNode>

          {/* Presets Row */}
          <ViroNode position={[0, -0.015, 0]}>
            {state.volume.modality === 'mri' ? (
              <QuestSpatialButton
                label="T1 Grayscale"
                selected
                position={[-0.22, 0, 0.002]}
                width={0.24}
                height={0.042}
                fontSize={12}
                onPress={() => {}}
              />
            ) : (
              <>
                {(['ct-soft-tissue', 'ct-bone'] as const).map((preset, i) => (
                  <QuestSpatialButton
                    key={preset}
                    label={preset === 'ct-soft-tissue' ? 'Soft Tissue' : 'Bone'}
                    selected={state.volume.appearance.ct.preset === preset}
                    position={[-0.22 + i * 0.24, 0, 0.002]}
                    width={0.22}
                    height={0.042}
                    fontSize={12}
                    onPress={() => controller.setVolumePreset(volumeScope, preset as VolumePreset)}
                  />
                ))}
              </>
            )}

            {/* Renderer Switcher */}
            <QuestSpatialButton
              label={state.volume.renderer === 'shader' ? 'Raymarch' : 'Stack'}
              selected={state.volume.renderer === 'shader' && state.volume.debugMode === 'raymarch'}
              position={[0.26, 0, 0.002]}
              width={0.22}
              height={0.042}
              fontSize={12}
              onPress={() => {
                if (state.volume.renderer === 'shader' && state.volume.debugMode === 'raymarch') {
                  controller.setVolumeRenderer(sessionId, 'stack');
                } else {
                  controller.setVolumeRenderer(sessionId, 'shader');
                  if (controller.getSnapshot().volume.debugMode !== 'raymarch') {
                    controller.setVolumeDebugMode(volumeScope, 'raymarch');
                  }
                }
              }}
            />
          </ViroNode>

          {/* Opacity & Transform Actions */}
          <ViroNode position={[0, -0.07, 0]}>
            <QuestSpatialButton
              label="Opacity -"
              position={[-0.3, 0, 0.002]}
              width={0.16}
              height={0.042}
              fontSize={12}
              onPress={() => {
                const current = state.volume.appearance[state.volume.modality].opacity;
                controller.setVolumeAppearance(
                  volumeScope,
                  'opacity',
                  Math.max(0.05, current - 0.1)
                );
              }}
            />
            <ViroText
              text={`Opacity: ${Math.round(state.volume.appearance[state.volume.modality].opacity * 100)}%`}
              position={[-0.1, 0, 0.002]}
              width={0.18}
              height={0.04}
              style={{
                fontFamily: 'sans-serif',
                fontSize: 12,
                color: '#f8fafc',
                textAlign: 'center',
                textAlignVertical: 'center',
              }}
            />
            <QuestSpatialButton
              label="Opacity +"
              position={[0.08, 0, 0.002]}
              width={0.16}
              height={0.042}
              fontSize={12}
              onPress={() => {
                const current = state.volume.appearance[state.volume.modality].opacity;
                controller.setVolumeAppearance(
                  volumeScope,
                  'opacity',
                  Math.min(1.0, current + 0.1)
                );
              }}
            />
            <QuestSpatialButton
              label="Transform"
              disabled={!canManipulateVolume(state)}
              position={[0.28, 0, 0.002]}
              width={0.18}
              height={0.042}
              fontSize={12}
              onPress={() => setTransformOpen(true)}
            />
          </ViroNode>

          {state.volume.loadStatus === 'error' ? (
            <ViroNode position={[0, -0.13, 0]}>
              <QuestSpatialButton
                label="Retry Loading Volume"
                variant="danger"
                position={[0, 0, 0.002]}
                width={0.34}
                height={0.042}
                onPress={() => controller.retryVolumeLoad(sessionId)}
              />
            </ViroNode>
          ) : null}
        </ViroNode>
      )}
    </ViroNode>
  );
}
