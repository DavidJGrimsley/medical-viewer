import { useState, useSyncExternalStore } from 'react';
import {
  useAnySourceHover,
  useAnySourcePressed,
  ViroMaterials,
  ViroNode,
  ViroQuad,
  ViroText as NativeViroText,
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

// Viro's native VRTText rasterizes `fontSize` directly as Android Bitmap pixel
// height and maps 1 unit of fontSize to ~0.01m (1cm) at scale = 1.
// Scaling a wrapper ViroNode by 0.025 lets a 13.5mm physical glyph render from
// a 54px bitmap (~3.8x supersampled for Quest 3S's ~20 PPD) with crisp edges.
export const QUEST_TEXT_SCALE = 0.025;
const VIRO_METRES_PER_FONT_UNIT = 0.01;
const MIN_NATIVE_FONT_PX = 36;
const MAX_NATIVE_FONT_PX = 128;

export interface QuestTextProps {
  text: string;
  position?: [number, number, number];
  width: number;
  height: number;
  worldFontSize: number;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  maxLines?: number;
}

export function QuestText({
  text,
  position = [0, 0, 0],
  width,
  height,
  worldFontSize,
  color = '#f8fafc',
  fontWeight = 'normal',
  textAlign = 'center',
  maxLines = 1,
}: QuestTextProps) {
  const nativeFontSize = Math.max(
    MIN_NATIVE_FONT_PX,
    Math.min(
      MAX_NATIVE_FONT_PX,
      Math.round(worldFontSize / (VIRO_METRES_PER_FONT_UNIT * QUEST_TEXT_SCALE))
    )
  );

  return (
    <ViroNode
      position={position}
      scale={[QUEST_TEXT_SCALE, QUEST_TEXT_SCALE, QUEST_TEXT_SCALE]}
      ignoreEventHandling>
      <NativeViroText
        text={text}
        width={width / QUEST_TEXT_SCALE}
        height={height / QUEST_TEXT_SCALE}
        maxLines={maxLines}
        textClipMode="None"
        textLineBreakMode={maxLines === 1 ? 'None' : 'WordWrap'}
        renderingOrder={2}
        ignoreEventHandling
        style={{
          fontFamily: 'sans-serif',
          fontSize: nativeFontSize,
          fontWeight,
          color,
          textAlign,
          textAlignVertical: 'center',
        }}
      />
    </ViroNode>
  );
}

ViroMaterials.createMaterials({
  questPanelBorder: {
    lightingModel: 'Constant',
    diffuseColor: '#334155',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questPanelBg: {
    lightingModel: 'Constant',
    diffuseColor: '#0b1220',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questCardBg: {
    lightingModel: 'Constant',
    diffuseColor: '#111c30',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questDivider: {
    lightingModel: 'Constant',
    diffuseColor: '#1e293b',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderIdle: {
    lightingModel: 'Constant',
    diffuseColor: '#334155',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderActive: {
    lightingModel: 'Constant',
    diffuseColor: '#7dd3fc',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderSelected: {
    lightingModel: 'Constant',
    diffuseColor: '#38bdf8',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderDisabled: {
    lightingModel: 'Constant',
    diffuseColor: '#1e293b',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnIdle: {
    lightingModel: 'Constant',
    diffuseColor: '#1e293b',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnHover: {
    lightingModel: 'Constant',
    diffuseColor: '#0369a1',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnPressed: {
    lightingModel: 'Constant',
    diffuseColor: '#0284c7',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnSelected: {
    lightingModel: 'Constant',
    diffuseColor: '#0ea5e9',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnDisabled: {
    lightingModel: 'Constant',
    diffuseColor: '#172033',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnDanger: {
    lightingModel: 'Constant',
    diffuseColor: '#b91c1c',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnDangerHover: {
    lightingModel: 'Constant',
    diffuseColor: '#dc2626',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnAccent: {
    lightingModel: 'Constant',
    diffuseColor: '#059669',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnAccentHover: {
    lightingModel: 'Constant',
    diffuseColor: '#10b981',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
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
  height = 0.044,
  fontSize = 0.0135,
  position = [0, 0, 0],
  variant = 'default',
  testID,
}: QuestSpatialButtonProps) {
  const [hovered, onHover] = useAnySourceHover();
  const [pressed, onClickState] = useAnySourcePressed();

  const isHovered = !disabled && hovered;
  const isPressed = !disabled && pressed;
  const worldFontSize = fontSize > 0.2 ? fontSize * 0.001 : fontSize;

  const fillMaterial = disabled
    ? 'questBtnDisabled'
    : isPressed
      ? 'questBtnPressed'
      : isHovered
        ? variant === 'danger'
          ? 'questBtnDangerHover'
          : variant === 'accent'
            ? 'questBtnAccentHover'
            : 'questBtnHover'
        : selected
          ? 'questBtnSelected'
          : variant === 'danger'
            ? 'questBtnDanger'
            : variant === 'accent'
              ? 'questBtnAccent'
              : 'questBtnIdle';

  const borderMaterial = disabled
    ? 'questBtnBorderDisabled'
    : isPressed || isHovered
      ? 'questBtnBorderActive'
      : selected
        ? 'questBtnBorderSelected'
        : 'questBtnBorderIdle';

  // Keep text style independent of hover/press so sweeping controller or hand
  // rays across buttons never triggers Android Bitmap re-rasterization in VRTText.
  const textColor = disabled ? '#64748b' : '#f8fafc';
  const fontWeight = selected || variant !== 'default' ? 'bold' : 'normal';

  return (
    <ViroNode position={position}>
      <ViroQuad
        position={[0, 0, -0.001]}
        width={width + 0.005}
        height={height + 0.005}
        materials={[borderMaterial]}
        renderingOrder={0}
        ignoreEventHandling
      />
      <ViroQuad
        testID={testID}
        position={[0, 0, 0.001]}
        width={width}
        height={height}
        materials={[fillMaterial]}
        renderingOrder={1}
        ignoreEventHandling={disabled}
        onHover={disabled ? undefined : onHover}
        onClickState={disabled ? undefined : onClickState}
        onClick={disabled ? undefined : onPress}
      />
      <QuestText
        text={label}
        position={[0, 0, 0.004]}
        width={Math.max(0.04, width - 0.014)}
        height={height}
        worldFontSize={worldFontSize}
        fontWeight={fontWeight}
        color={textColor}
        maxLines={1}
      />
    </ViroNode>
  );
}

export interface QuestSpatialControlsProps {
  context: ARSceneContext;
  controller: MedicalController;
  panelPose: { position: [number, number, number]; rotation: [number, number, number] } | null;
  onRecenter: () => void;
  onPlaceInFront?: () => void;
}

export function QuestSpatialControls({
  context,
  controller,
  panelPose,
  onRecenter,
  onPlaceInFront,
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
  const canTransformPose =
    state.mode === 'anatomy'
      ? canManipulateMedical(state)
      : state.mode === 'slices'
        ? canManipulateSlices(state)
        : canManipulateVolume(state);

  const hasLoadError =
    state.loadStatus === 'error' ||
    state.slices.loadStatus === 'error' ||
    state.volume.loadStatus === 'error';

  const statusText = !state.anchorId
    ? state.tracking === 'initializing'
      ? 'Starting Quest tracking…'
      : 'Use Place In Front or tap a detected room surface.'
    : currentStatus || 'Specimen active · Use controls below';

  const handleExit = () => {
    exitVRScene();
  };

  if (!panelPose) return null;

  return (
    <ViroNode position={panelPose.position} rotation={panelPose.rotation}>
      {/* Decorative Console Frame & Surface (strictly ignoreEventHandling so rotated panel AABBs never swallow rays) */}
      <ViroQuad
        position={[0, 0, -0.008]}
        width={0.92}
        height={0.48}
        materials={['questPanelBorder']}
        renderingOrder={-3}
        ignoreEventHandling
      />
      <ViroQuad
        position={[0, 0, -0.006]}
        width={0.908}
        height={0.468}
        materials={['questPanelBg']}
        renderingOrder={-2}
        ignoreEventHandling
      />
      <ViroQuad
        position={[0, 0.114, -0.004]}
        width={0.86}
        height={0.002}
        materials={['questDivider']}
        renderingOrder={-1}
        ignoreEventHandling
      />
      <ViroQuad
        position={[0, -0.084, -0.004]}
        width={0.86}
        height={0.268}
        materials={['questCardBg']}
        renderingOrder={-1}
        ignoreEventHandling
      />

      {/* Row 1: Header Bar (y = +0.195) */}
      <QuestText
        text="Medical Viewer · Quest MR"
        position={[-0.215, 0.195, 0.004]}
        width={0.41}
        height={0.042}
        worldFontSize={0.019}
        fontWeight="bold"
        color="#38bdf8"
        textAlign="left"
      />
      <QuestSpatialButton
        label="Recenter"
        position={[0.145, 0.195, 0.002]}
        width={0.16}
        height={0.04}
        fontSize={0.013}
        onPress={onRecenter}
      />
      <QuestSpatialButton
        label="Exit VR"
        variant="danger"
        position={[0.335, 0.195, 0.002]}
        width={0.16}
        height={0.04}
        fontSize={0.013}
        onPress={handleExit}
      />

      {/* Row 2: Status & Room-Model-Free Placement Bar (y = +0.140) */}
      {!state.anchorId && onPlaceInFront ? (
        <>
          <QuestText
            text={statusText}
            position={[-0.135, 0.14, 0.004]}
            width={0.55}
            height={0.036}
            worldFontSize={0.0125}
            color={hasLoadError ? '#fde68a' : '#cbd5e1'}
            textAlign="left"
          />
          <QuestSpatialButton
            label="Place In Front"
            variant="accent"
            disabled={state.tracking !== 'normal'}
            position={[0.29, 0.14, 0.002]}
            width={0.25}
            height={0.038}
            fontSize={0.0135}
            onPress={onPlaceInFront}
          />
        </>
      ) : (
        <QuestText
          text={statusText}
          position={[0, 0.14, 0.004]}
          width={0.82}
          height={0.036}
          worldFontSize={0.0125}
          color={hasLoadError ? '#fde68a' : '#94a3b8'}
          textAlign="center"
        />
      )}

      {/* Row 3: Mode Switcher Tabs (y = +0.082) */}
      <ViroNode position={[0, 0.082, 0]}>
        <QuestSpatialButton
          label="Anatomy"
          selected={state.mode === 'anatomy'}
          position={[-0.285, 0, 0.002]}
          width={0.25}
          height={0.044}
          fontSize={0.0145}
          onPress={() => {
            setTransformOpen(false);
            controller.selectViewerMode(sessionId, 'anatomy');
          }}
        />
        <QuestSpatialButton
          label="Scan Slices"
          selected={state.mode === 'slices'}
          position={[0, 0, 0.002]}
          width={0.25}
          height={0.044}
          fontSize={0.0145}
          onPress={() => {
            setTransformOpen(false);
            controller.selectViewerMode(sessionId, 'slices');
          }}
        />
        <QuestSpatialButton
          label="3D Scan"
          selected={state.mode === 'volume'}
          position={[0.285, 0, 0.002]}
          width={0.25}
          height={0.044}
          fontSize={0.0145}
          onPress={() => {
            setTransformOpen(false);
            controller.selectViewerMode(sessionId, 'volume');
          }}
        />
      </ViroNode>

      {/* Sub-Panel Content (y in [-0.218, +0.050]) */}
      {transformOpen ? (
        <ViroNode position={[0, -0.084, 0]}>
          {/* Scale Row (local y = +0.102 -> panel y = +0.018) */}
          <ViroNode position={[0, 0.102, 0]}>
            <QuestSpatialButton
              label="Scale -"
              position={[-0.26, 0, 0.002]}
              width={0.17}
              height={0.04}
              fontSize={0.013}
              disabled={
                !canTransformPose ||
                (state.mode === 'anatomy'
                  ? state.scale <= MIN_MODEL_SCALE
                  : state.mode === 'slices'
                    ? state.slices.scale <= MIN_MODEL_SCALE
                    : state.volume.scale <= MIN_MODEL_SCALE)
              }
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setScale(scope, Math.max(MIN_MODEL_SCALE, state.scale - 0.2));
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(
                    sliceScope,
                    'scale',
                    Math.max(MIN_MODEL_SCALE, state.slices.scale - 0.2)
                  );
                } else {
                  controller.setVolumeTransform(
                    volumeScope,
                    'scale',
                    Math.max(MIN_MODEL_SCALE, state.volume.scale - 0.2)
                  );
                }
              }}
            />
            <QuestText
              text={`Scale: ${(state.mode === 'anatomy' ? state.scale : state.mode === 'slices' ? state.slices.scale : state.volume.scale).toFixed(2)}x`}
              position={[0, 0, 0.004]}
              width={0.3}
              height={0.038}
              worldFontSize={0.0135}
              color="#f8fafc"
            />
            <QuestSpatialButton
              label="Scale +"
              position={[0.26, 0, 0.002]}
              width={0.17}
              height={0.04}
              fontSize={0.013}
              disabled={
                !canTransformPose ||
                (state.mode === 'anatomy'
                  ? state.scale >= MAX_MODEL_SCALE
                  : state.mode === 'slices'
                    ? state.slices.scale >= MAX_MODEL_SCALE
                    : state.volume.scale >= MAX_MODEL_SCALE)
              }
              onPress={() => {
                if (state.mode === 'anatomy') {
                  controller.setScale(scope, Math.min(MAX_MODEL_SCALE, state.scale + 0.2));
                } else if (state.mode === 'slices') {
                  controller.setPanelTransform(
                    sliceScope,
                    'scale',
                    Math.min(MAX_MODEL_SCALE, state.slices.scale + 0.2)
                  );
                } else {
                  controller.setVolumeTransform(
                    volumeScope,
                    'scale',
                    Math.min(MAX_MODEL_SCALE, state.volume.scale + 0.2)
                  );
                }
              }}
            />
          </ViroNode>

          {/* Height Row (local y = +0.046 -> panel y = -0.038) */}
          <ViroNode position={[0, 0.046, 0]}>
            <QuestSpatialButton
              label="Lower (-5cm)"
              position={[-0.26, 0, 0.002]}
              width={0.17}
              height={0.04}
              fontSize={0.0125}
              disabled={!canTransformPose}
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
            <QuestText
              text={`Height: ${Math.round((state.mode === 'anatomy' ? state.height : state.mode === 'slices' ? state.slices.height : state.volume.height) * 100)}cm`}
              position={[0, 0, 0.004]}
              width={0.3}
              height={0.038}
              worldFontSize={0.0135}
              color="#f8fafc"
            />
            <QuestSpatialButton
              label="Raise (+5cm)"
              position={[0.26, 0, 0.002]}
              width={0.17}
              height={0.04}
              fontSize={0.0125}
              disabled={!canTransformPose}
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

          {/* Yaw Row (local y = -0.010 -> panel y = -0.094) */}
          <ViroNode position={[0, -0.01, 0]}>
            <QuestSpatialButton
              label="Turn Left"
              position={[-0.26, 0, 0.002]}
              width={0.17}
              height={0.04}
              fontSize={0.013}
              disabled={!canTransformPose}
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
            <QuestText
              text={`Yaw: ${Math.round(state.mode === 'anatomy' ? state.yaw : state.mode === 'slices' ? state.slices.yaw : state.volume.yaw)}°`}
              position={[0, 0, 0.004]}
              width={0.3}
              height={0.038}
              worldFontSize={0.0135}
              color="#f8fafc"
            />
            <QuestSpatialButton
              label="Turn Right"
              position={[0.26, 0, 0.002]}
              width={0.17}
              height={0.04}
              fontSize={0.013}
              disabled={!canTransformPose}
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

          {/* Actions Row (local y = -0.072 -> panel y = -0.156) */}
          <ViroNode position={[0, -0.072, 0]}>
            {onPlaceInFront ? (
              <>
                <QuestSpatialButton
                  label="Move Here"
                  disabled={state.tracking !== 'normal'}
                  position={[-0.3075, 0, 0.002]}
                  width={0.185}
                  height={0.042}
                  fontSize={0.0125}
                  onPress={onPlaceInFront}
                />
                <QuestSpatialButton
                  label="Reposition"
                  disabled={!state.anchorId}
                  position={[-0.1025, 0, 0.002]}
                  width={0.185}
                  height={0.042}
                  fontSize={0.0125}
                  onPress={() => {
                    setTransformOpen(false);
                    controller.reposition(sessionId);
                  }}
                />
                <QuestSpatialButton
                  label="Reset Pose"
                  disabled={
                    state.mode === 'anatomy' ? !canManipulateMedical(state) : !state.anchorId
                  }
                  position={[0.1025, 0, 0.002]}
                  width={0.185}
                  height={0.042}
                  fontSize={0.0125}
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
                  position={[0.3075, 0, 0.002]}
                  width={0.185}
                  height={0.042}
                  fontSize={0.013}
                  onPress={() => setTransformOpen(false)}
                />
              </>
            ) : (
              <>
                <QuestSpatialButton
                  label="Reposition"
                  disabled={!state.anchorId}
                  position={[-0.25, 0, 0.002]}
                  width={0.21}
                  height={0.042}
                  fontSize={0.013}
                  onPress={() => {
                    setTransformOpen(false);
                    controller.reposition(sessionId);
                  }}
                />
                <QuestSpatialButton
                  label="Reset Pose"
                  disabled={
                    state.mode === 'anatomy' ? !canManipulateMedical(state) : !state.anchorId
                  }
                  position={[0, 0, 0.002]}
                  width={0.21}
                  height={0.042}
                  fontSize={0.013}
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
                  position={[0.25, 0, 0.002]}
                  width={0.21}
                  height={0.042}
                  fontSize={0.013}
                  onPress={() => setTransformOpen(false)}
                />
              </>
            )}
          </ViroNode>
        </ViroNode>
      ) : state.mode === 'anatomy' ? (
        <ViroNode position={[0, -0.084, 0]}>
          {/* Anatomy Model Selector Row (local y = +0.088 -> panel y = +0.004) */}
          <ViroNode position={[0, 0.088, 0]}>
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
                position={[-0.3075 + i * 0.205, 0, 0.002]}
                width={0.185}
                height={0.044}
                fontSize={0.0135}
                onPress={() => controller.selectModel(sessionId, modelId as MedicalModelId)}
              />
            ))}
          </ViroNode>

          {/* Anatomy Actions Row (local y = +0.016 -> panel y = -0.068) */}
          <ViroNode position={[0, 0.016, 0]}>
            <QuestSpatialButton
              label={state.labelsVisible ? 'Labels: ON' : 'Labels: OFF'}
              selected={state.labelsVisible}
              disabled={!canManipulateMedical(state) || !hasMedicalLabels(state.modelId)}
              position={[-0.155, 0, 0.002]}
              width={0.26}
              height={0.044}
              fontSize={0.0135}
              onPress={() => controller.toggleLabels(sessionId)}
            />
            <QuestSpatialButton
              label="Transform"
              disabled={!state.anchorId}
              position={[0.155, 0, 0.002]}
              width={0.26}
              height={0.044}
              fontSize={0.0135}
              onPress={() => setTransformOpen(true)}
            />
          </ViroNode>

          {state.loadStatus === 'error' ? (
            <ViroNode position={[0, -0.058, 0]}>
              <QuestSpatialButton
                label="Retry Loading Anatomy"
                variant="danger"
                position={[0, 0, 0.002]}
                width={0.34}
                height={0.042}
                fontSize={0.013}
                onPress={() => controller.retryLoad(sessionId)}
              />
            </ViroNode>
          ) : null}
        </ViroNode>
      ) : state.mode === 'slices' ? (
        <ViroNode position={[0, -0.084, 0]}>
          {/* Modality & Orientation Row (local y = +0.098 -> panel y = +0.014) */}
          <ViroNode position={[0, 0.098, 0]}>
            {(['mri', 'ct'] as const).map((mod, i) => (
              <QuestSpatialButton
                key={mod}
                label={mod.toUpperCase()}
                selected={state.slices.modality === mod}
                position={[-0.295 + i * 0.215, 0, 0.002]}
                width={0.19}
                height={0.04}
                fontSize={0.0135}
                onPress={() => controller.selectModality(sessionId, mod as SliceModality)}
              />
            ))}
            <QuestText
              text="Axial Series (RAS)"
              position={[0.22, 0, 0.004]}
              width={0.36}
              height={0.036}
              worldFontSize={0.0125}
              color="#94a3b8"
            />
          </ViroNode>

          {/* Slice Browsing Row (local y = +0.036 -> panel y = -0.048) */}
          {sliceSeries ? (
            <ViroNode position={[0, 0.036, 0]}>
              <QuestSpatialButton
                label="<< -5"
                disabled={state.slices.index < 5}
                position={[-0.34, 0, 0.002]}
                width={0.12}
                height={0.04}
                fontSize={0.012}
                onPress={() =>
                  controller.selectSlice(sliceScope, Math.max(0, state.slices.index - 5))
                }
              />
              <QuestSpatialButton
                label="< Prev"
                disabled={state.slices.index === 0}
                position={[-0.195, 0, 0.002]}
                width={0.13}
                height={0.04}
                fontSize={0.0125}
                onPress={() => controller.selectSlice(sliceScope, state.slices.index - 1)}
              />
              <QuestText
                text={`Slice ${state.slices.index + 1}/${sliceSeries.imageCount}`}
                position={[0, 0, 0.004]}
                width={0.22}
                height={0.036}
                worldFontSize={0.013}
                color="#f8fafc"
              />
              <QuestSpatialButton
                label="Next >"
                disabled={state.slices.index >= sliceSeries.imageCount - 1}
                position={[0.195, 0, 0.002]}
                width={0.13}
                height={0.04}
                fontSize={0.0125}
                onPress={() => controller.selectSlice(sliceScope, state.slices.index + 1)}
              />
              <QuestSpatialButton
                label="+5 >>"
                disabled={state.slices.index >= sliceSeries.imageCount - 5}
                position={[0.34, 0, 0.002]}
                width={0.12}
                height={0.04}
                fontSize={0.012}
                onPress={() =>
                  controller.selectSlice(
                    sliceScope,
                    Math.min(sliceSeries.imageCount - 1, state.slices.index + 5)
                  )
                }
              />
            </ViroNode>
          ) : null}

          {/* Slices Actions Row (local y = -0.026 -> panel y = -0.110) */}
          <ViroNode position={[0, -0.026, 0]}>
            <QuestSpatialButton
              label="Reset Slice"
              position={[-0.155, 0, 0.002]}
              width={0.25}
              height={0.04}
              fontSize={0.013}
              onPress={() => controller.resetSlice(sessionId)}
            />
            <QuestSpatialButton
              label="Transform"
              disabled={!state.anchorId}
              position={[0.155, 0, 0.002]}
              width={0.25}
              height={0.04}
              fontSize={0.013}
              onPress={() => setTransformOpen(true)}
            />
          </ViroNode>

          {state.slices.loadStatus === 'error' ? (
            <ViroNode position={[0, -0.084, 0]}>
              <QuestSpatialButton
                label="Retry Loading Slice"
                variant="danger"
                position={[0, 0, 0.002]}
                width={0.34}
                height={0.04}
                fontSize={0.0125}
                onPress={() => controller.retrySliceLoad(sessionId)}
              />
            </ViroNode>
          ) : null}
        </ViroNode>
      ) : (
        /* 3D Scan (Volume) Mode */
        <ViroNode position={[0, -0.084, 0]}>
          {/* Modality & Quality Row (local y = +0.100 -> panel y = +0.016) */}
          <ViroNode position={[0, 0.1, 0]}>
            {(['mri', 'ct'] as const).map((mod, i) => (
              <QuestSpatialButton
                key={mod}
                label={mod.toUpperCase()}
                selected={state.volume.modality === mod}
                position={[-0.3075 + i * 0.205, 0, 0.002]}
                width={0.185}
                height={0.04}
                fontSize={0.013}
                onPress={() => controller.selectVolumeModality(sessionId, mod as SliceModality)}
              />
            ))}
            {(['balanced', 'fast'] as const).map((q, i) => (
              <QuestSpatialButton
                key={q}
                label={q === 'balanced' ? 'Balanced' : 'Fast'}
                selected={state.volume.quality === q}
                position={[0.1025 + i * 0.205, 0, 0.002]}
                width={0.185}
                height={0.04}
                fontSize={0.0125}
                onPress={() =>
                  controller.configureVolume(volumeScope, { quality: q as VolumeQuality })
                }
              />
            ))}
          </ViroNode>

          {/* Presets & Renderer Row (local y = +0.040 -> panel y = -0.044) */}
          <ViroNode position={[0, 0.04, 0]}>
            {state.volume.modality === 'mri' ? (
              <QuestSpatialButton
                label="T1 Grayscale"
                selected
                position={[-0.165, 0, 0.002]}
                width={0.32}
                height={0.04}
                fontSize={0.0125}
                onPress={() => {}}
              />
            ) : (
              <>
                {(['ct-soft-tissue', 'ct-bone'] as const).map((preset, i) => (
                  <QuestSpatialButton
                    key={preset}
                    label={preset === 'ct-soft-tissue' ? 'Soft Tissue' : 'Bone'}
                    selected={state.volume.appearance.ct.preset === preset}
                    position={[-0.28 + i * 0.26, 0, 0.002]}
                    width={0.22}
                    height={0.04}
                    fontSize={0.0125}
                    onPress={() => controller.setVolumePreset(volumeScope, preset as VolumePreset)}
                  />
                ))}
              </>
            )}

            <QuestSpatialButton
              label={state.volume.renderer === 'shader' ? 'Raymarch' : 'Stack'}
              selected={state.volume.renderer === 'shader' && state.volume.debugMode === 'raymarch'}
              position={[state.volume.modality === 'mri' ? 0.215 : 0.26, 0, 0.002]}
              width={state.volume.modality === 'mri' ? 0.25 : 0.24}
              height={0.04}
              fontSize={0.0125}
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

          {/* Opacity & Transform Row (local y = -0.020 -> panel y = -0.104) */}
          <ViroNode position={[0, -0.02, 0]}>
            <QuestSpatialButton
              label="Opacity -"
              position={[-0.315, 0, 0.002]}
              width={0.16}
              height={0.04}
              fontSize={0.0125}
              onPress={() => {
                const current = state.volume.appearance[state.volume.modality].opacity;
                controller.setVolumeAppearance(
                  volumeScope,
                  'opacity',
                  Math.max(0.05, current - 0.1)
                );
              }}
            />
            <QuestText
              text={`Opacity: ${Math.round(state.volume.appearance[state.volume.modality].opacity * 100)}%`}
              position={[-0.115, 0, 0.004]}
              width={0.2}
              height={0.036}
              worldFontSize={0.0125}
              color="#f8fafc"
            />
            <QuestSpatialButton
              label="Opacity +"
              position={[0.085, 0, 0.002]}
              width={0.16}
              height={0.04}
              fontSize={0.0125}
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
              disabled={!state.anchorId}
              position={[0.295, 0, 0.002]}
              width={0.2}
              height={0.04}
              fontSize={0.0125}
              onPress={() => setTransformOpen(true)}
            />
          </ViroNode>

          {state.volume.loadStatus === 'error' ? (
            <ViroNode position={[0, -0.08, 0]}>
              <QuestSpatialButton
                label="Retry Loading Volume"
                variant="danger"
                position={[0, 0, 0.002]}
                width={0.34}
                height={0.038}
                fontSize={0.0125}
                onPress={() => controller.retryVolumeLoad(sessionId)}
              />
            </ViroNode>
          ) : (
            <QuestText
              text="Experimental 3D Scan Volume · Raymarch / Stack"
              position={[0, -0.08, 0.004]}
              width={0.78}
              height={0.028}
              worldFontSize={0.0115}
              color="#64748b"
            />
          )}
        </ViroNode>
      )}
    </ViroNode>
  );
}
