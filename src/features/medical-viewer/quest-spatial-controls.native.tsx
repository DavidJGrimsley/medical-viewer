import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  useAnySourceHover,
  useAnySourcePressed,
  ViroMaterials,
  ViroNode,
  ViroPolygon,
  ViroQuad,
  ViroText as NativeViroText,
} from '@reactvision/react-viro';
import type { ARSceneContext } from '@/features/ar/ar-session-types';
import {
  dragToYawDelta,
  QUEST_GRAB_BAR_LOCAL_X,
  QUEST_GRAB_BAR_LOCAL_Y,
  rigLocalToWorld,
  rigWorldToLocalX,
  sliderIndexFromLocalX,
  roundedRectVertices,
  type Point3,
  type RigPose,
} from '@/features/ar/quest-spatial-math';
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
import { QUEST_ANATOMY_HEIGHT } from './quest-default-heights';
import { type VolumePreset, type VolumeQuality } from './medical-volumes';
import { hasMedicalLabels, type MedicalModelId } from './medical-models';
import type { SliceModality } from './medical-slices';
import { MEDICAL_DIAGNOSTICS_ENABLED } from './medical-diagnostics';

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
    diffuseColor: '#48484a',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questPanelBg: {
    lightingModel: 'Constant',
    diffuseColor: '#1c1c1e',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questCardBg: {
    lightingModel: 'Constant',
    diffuseColor: '#2c2c2e',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questDivider: {
    lightingModel: 'Constant',
    diffuseColor: '#3a3a3c',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderIdle: {
    lightingModel: 'Constant',
    diffuseColor: '#48484a',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderActive: {
    lightingModel: 'Constant',
    diffuseColor: '#64d2ff',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderSelected: {
    lightingModel: 'Constant',
    diffuseColor: '#0a84ff',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnBorderDisabled: {
    lightingModel: 'Constant',
    diffuseColor: '#3a3a3c',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnIdle: {
    lightingModel: 'Constant',
    diffuseColor: '#3a3a3c',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnHover: {
    lightingModel: 'Constant',
    diffuseColor: '#0a6fd6',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnPressed: {
    lightingModel: 'Constant',
    diffuseColor: '#0a5fb8',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnSelected: {
    lightingModel: 'Constant',
    diffuseColor: '#0a84ff',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnDisabled: {
    lightingModel: 'Constant',
    diffuseColor: '#232325',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnDanger: {
    lightingModel: 'Constant',
    diffuseColor: '#ff453a',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnDangerHover: {
    lightingModel: 'Constant',
    diffuseColor: '#ff6961',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnAccent: {
    lightingModel: 'Constant',
    diffuseColor: '#30d158',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
  questBtnAccentHover: {
    lightingModel: 'Constant',
    diffuseColor: '#4ae26f',
    writesToDepthBuffer: true,
    readsFromDepthBuffer: true,
  },
});

const NO_HOLES: [number, number][][] = [];
const roundedCache = new Map<string, [number, number][]>();
function cachedRoundedVertices(width: number, height: number, radius: number) {
  const key = `${width.toFixed(4)}:${height.toFixed(4)}:${radius.toFixed(4)}`;
  let vertices = roundedCache.get(key);
  if (!vertices) {
    vertices = roundedRectVertices(width, height, radius);
    roundedCache.set(key, vertices);
  }
  return vertices;
}

export interface QuestRoundedRectProps {
  width: number;
  height: number;
  radius?: number;
  material: string;
  position?: [number, number, number];
  renderingOrder?: number;
  ignoreEventHandling?: boolean;
  [handler: string]: unknown;
}

/** Rounded rectangle built from a ViroPolygon outline; Viro has no native rounded corners. */
export function QuestRoundedRect({
  width,
  height,
  radius = Math.min(width, height) * 0.3,
  material,
  ...rest
}: QuestRoundedRectProps) {
  return (
    <ViroPolygon
      vertices={cachedRoundedVertices(width, height, radius)}
      holes={NO_HOLES}
      materials={[material]}
      {...rest}
    />
  );
}

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
      <QuestRoundedRect
        position={[0, 0, -0.001]}
        width={width + 0.005}
        height={height + 0.005}
        material={borderMaterial}
        renderingOrder={0}
        ignoreEventHandling
      />
      <QuestRoundedRect
        testID={testID}
        position={[0, 0, 0.001]}
        width={width}
        height={height}
        material={fillMaterial}
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

const DIAGNOSTIC_DESCRIPTIONS: Record<string, string> = {
  magenta: 'Magenta · Shader material attachment probe (solid magenta)',
  samplers: '3-Sampler · 2106x1944 atlas dimensions & samples (green = pass)',
  uniforms: 'Uniforms · Bounds, aspect ratio & scalar range (green = pass)',
  coordinates: 'Coords · Object coordinate space mapping (RGB = XYZ volume axes)',
  ray: 'Ray · Ray-box intersection probe (green/cyan bounding rays)',
  opacity: 'Opacity Diag · Alpha transfer function depth ramp diagnostic',
  raymarch: 'Normal Volume · Continuous volumetric raymarching (standard anatomy)',
};

export interface QuestSpatialControlsProps {
  context: ARSceneContext;
  controller: MedicalController;
  panelPose: RigPose | null;
  onRecenter: () => void;
  onPlaceInFront?: () => void;
  /** Called when the user chooses Exit VR; the scene owns the safe teardown sequence. */
  onExit?: () => void;
  /** Called with the new world position of the move handle while it is dragged. */
  onMoveRig?: (handleWorld: Point3, handleLocal?: Point3) => void;
}

const HANDLE_RESET_IDLE_MS = 600;
// Slice slider track, in panel-local metres.
const SLIDER_TRACK_WIDTH = 0.72;
const SLIDER_TRACK_HEIGHT = 0.012;
const SLIDER_THUMB_WIDTH = 0.07;
const SLIDER_CARD_OFFSET_Y = -0.084;

interface QuestDragHandleProps {
  label: string;
  position: Point3;
  rotation: Point3;
  width: number;
  height: number;
  disabled?: boolean;
  onDrag: (dragToPos: Point3, previous: Point3 | null) => void;
}

/**
 * Draggable pill. Viro moves a dragged node natively, so the handle is rendered
 * as a sibling of the panel at a world position derived from the rig; once the
 * drag ends (or goes idle) the node is re-keyed so it snaps back to that
 * derived position instead of keeping a stale native offset.
 */
export function QuestDragHandle({
  label,
  position,
  rotation,
  width,
  height,
  disabled = false,
  onDrag,
}: QuestDragHandleProps) {
  const [resetKey, setResetKey] = useState(0);
  const [hovered, onHover] = useAnySourceHover();
  const previous = useRef<Point3 | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current);
    },
    []
  );

  const reset = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    previous.current = null;
    setResetKey((key) => key + 1);
  };

  const handleDrag = (dragToPos: Point3) => {
    if (disabled || !dragToPos || !dragToPos.every(Number.isFinite)) return;
    onDrag(dragToPos, previous.current);
    previous.current = dragToPos;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(reset, HANDLE_RESET_IDLE_MS);
  };

  const material = disabled ? 'questBtnDisabled' : hovered ? 'questBtnHover' : 'questBtnIdle';

  return (
    <ViroNode key={resetKey} position={position} rotation={rotation}>
      <QuestRoundedRect
        position={[0, 0, -0.001]}
        width={width + 0.005}
        height={height + 0.005}
        radius={height / 2}
        material={hovered && !disabled ? 'questBtnBorderActive' : 'questBtnBorderIdle'}
        renderingOrder={0}
        ignoreEventHandling
      />
      <QuestRoundedRect
        position={[0, 0, 0.001]}
        width={width}
        height={height}
        radius={height / 2}
        material={material}
        renderingOrder={1}
        ignoreEventHandling={disabled}
        dragType="FixedDistance"
        onHover={disabled ? undefined : onHover}
        onDrag={disabled ? undefined : handleDrag}
        onClickState={
          disabled
            ? undefined
            : (clickState: number) => {
                // Viro: 1 = down, 2 = up, 3 = click. Anything past "down" ends the drag.
                if (clickState >= 2) reset();
              }
        }
      />
      <QuestText
        text={label}
        position={[0, 0, 0.004]}
        width={Math.max(0.04, width - 0.02)}
        height={height}
        worldFontSize={0.0125}
        color={disabled ? '#8e8e93' : '#f8fafc'}
        maxLines={1}
      />
    </ViroNode>
  );
}

export function QuestSpatialControls({
  context,
  controller,
  panelPose,
  onPlaceInFront,
  onExit,
  onMoveRig,
}: QuestSpatialControlsProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [transformOpen, setTransformOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    onExit?.();
  };

  // Drag callbacks fire faster than React re-renders, so read a fresh snapshot each call.
  const handleRotateDrag = (dragToPos: Point3, previous: Point3 | null) => {
    if (!previous || !panelPose) return;
    const delta = dragToYawDelta(previous, dragToPos, panelPose.rotation[1]);
    if (!Number.isFinite(delta) || delta === 0) return;
    const snap = controller.getSnapshot();
    if (snap.mode === 'anatomy') {
      controller.setYaw(
        {
          sessionId,
          modelId: snap.modelId,
          placementRevision: snap.placementRevision,
          loadAttempt: snap.loadAttempt,
        },
        snap.yaw + delta
      );
    } else if (snap.mode === 'slices') {
      controller.setPanelTransform(
        { sessionId, placementRevision: snap.placementRevision, requestId: snap.slices.requestId },
        'yaw',
        snap.slices.yaw + delta
      );
    } else {
      controller.setVolumeTransform(
        { sessionId, placementRevision: snap.placementRevision, requestId: snap.volume.requestId },
        'yaw',
        snap.volume.yaw + delta
      );
    }
  };

  if (!panelPose) return null;

  // Before a model exists the only control is one large Place In Front button.
  if (!state.anchorId) {
    return (
      <ViroNode position={panelPose.position} rotation={panelPose.rotation}>
        <QuestSpatialButton
          label="Place In Front"
          variant="accent"
          disabled={!onPlaceInFront || state.tracking !== 'normal'}
          position={[0, 0.4, 0.002]}
          width={0.6}
          height={0.2}
          fontSize={0.04}
          onPress={() => onPlaceInFront?.()}
        />
        <QuestText
          text={statusText}
          position={[0, 0.26, 0.004]}
          width={0.8}
          height={0.04}
          worldFontSize={0.0145}
          color={hasLoadError ? '#fde68a' : '#d1d1d6'}
        />
      </ViroNode>
    );
  }

  // Rows are spread evenly through the card instead of being top-aligned.
  const rowYs = (count: number): number[] => {
    if (count <= 1) return [0];
    const span = Math.min(0.2, 0.12 * (count - 1));
    return Array.from({ length: count }, (_, i) => span / 2 - (i * span) / (count - 1));
  };
  const anatomyRows = rowYs(state.loadStatus === 'error' ? 3 : 2);
  const sliceRowCount = (sliceSeries ? 4 : 2) + (state.slices.loadStatus === 'error' ? 1 : 0);
  const sliceRows = rowYs(sliceRowCount);
  const sliceSliderRow = 2;
  const sliceResetRow = sliceSeries ? 3 : 1;
  const sliderCount = sliceSeries?.imageCount ?? 0;
  const sliderT = sliderCount > 1 ? state.slices.index / (sliderCount - 1) : 0;
  const sliderThumbX = -SLIDER_TRACK_WIDTH / 2 + sliderT * SLIDER_TRACK_WIDTH;
  const showSlider = !transformOpen && state.mode === 'slices' && !!sliceSeries && sliderCount > 1;

  // Drag callbacks fire faster than React re-renders: build the scope from a fresh snapshot.
  const handleSliderDrag = (dragToPos: Point3) => {
    if (!panelPose || sliderCount <= 1) return;
    const index = sliderIndexFromLocalX(
      rigWorldToLocalX(panelPose, dragToPos),
      0,
      SLIDER_TRACK_WIDTH,
      sliderCount
    );
    const snap = controller.getSnapshot();
    if (snap.mode !== 'slices' || snap.slices.index === index) return;
    controller.selectSlice(
      {
        sessionId,
        placementRevision: snap.placementRevision,
        requestId: snap.slices.requestId,
      },
      index
    );
  };
  // A diagnostic or Stack state always shows its banner and Return to 3D Scan, even when the
  // Diagnostics entry point is hidden.
  const isVolumeAdvancedView =
    (MEDICAL_DIAGNOSTICS_ENABLED && advancedOpen) ||
    state.volume.renderer === 'stack' ||
    state.volume.debugMode !== 'raymarch';
  const normalVolumeRows = rowYs(4);
  const advVolumeRows = rowYs(5);

  const moveHandleLocal: Point3 = [QUEST_GRAB_BAR_LOCAL_X, QUEST_GRAB_BAR_LOCAL_Y, 0.012];
  const rotateHandleLocal: Point3 = [0.29, QUEST_GRAB_BAR_LOCAL_Y, 0.012];

  return (
    <>
      <QuestDragHandle
        label="Drag to move"
        position={rigLocalToWorld(panelPose, moveHandleLocal)}
        rotation={panelPose.rotation}
        width={0.52}
        height={0.06}
        onDrag={(pos) => onMoveRig?.(pos)}
      />
      <QuestDragHandle
        label="Drag to rotate"
        position={rigLocalToWorld(panelPose, rotateHandleLocal)}
        rotation={panelPose.rotation}
        width={0.28}
        height={0.06}
        disabled={!canTransformPose}
        onDrag={handleRotateDrag}
      />
      {showSlider ? (
        <QuestDragHandle
          label="< >"
          position={rigLocalToWorld(panelPose, [
            sliderThumbX,
            SLIDER_CARD_OFFSET_Y + sliceRows[sliceSliderRow],
            0.012,
          ])}
          rotation={panelPose.rotation}
          width={SLIDER_THUMB_WIDTH}
          height={0.04}
          onDrag={handleSliderDrag}
        />
      ) : null}
      <ViroNode position={panelPose.position} rotation={panelPose.rotation}>
        {/* Decorative Console Frame & Surface (strictly ignoreEventHandling so rotated panel AABBs never swallow rays) */}
        <QuestRoundedRect
          position={[0, 0.02, -0.008]}
          width={0.92}
          height={0.52}
          radius={0.05}
          material="questPanelBorder"
          renderingOrder={-3}
          ignoreEventHandling
        />
        <QuestRoundedRect
          position={[0, 0.02, -0.006]}
          width={0.908}
          height={0.508}
          radius={0.044}
          material="questPanelBg"
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
        <QuestRoundedRect
          position={[0, -0.084, -0.004]}
          width={0.86}
          height={0.268}
          radius={0.03}
          material="questCardBg"
          renderingOrder={-1}
          ignoreEventHandling
        />

        {/* Row 1: Header. Three equal buttons on the same 3-column grid as the mode tabs
            (centres -0.285 / 0 / +0.285, width 0.25, gap 0.035), so the left and right
            margins to the panel edge match (0.05) and the top margin matches too. */}
        <QuestSpatialButton
          label={transformOpen ? 'Controls' : 'Transform'}
          disabled={!state.anchorId}
          position={[-0.285, 0.208, 0.002]}
          width={0.25}
          height={0.044}
          fontSize={0.0145}
          onPress={() => setTransformOpen((open) => !open)}
        />
        <QuestSpatialButton
          label="Exit VR"
          variant="danger"
          position={[0.285, 0.208, 0.002]}
          width={0.25}
          height={0.044}
          fontSize={0.0145}
          onPress={handleExit}
        />

        {/* Row 2: Status (y = +0.140) */}
        <QuestText
          text={statusText}
          position={[0, 0.14, 0.004]}
          width={0.82}
          height={0.036}
          worldFontSize={0.0125}
          color={hasLoadError ? '#fde68a' : '#98989d'}
          textAlign="center"
        />

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
              setAdvancedOpen(false);
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
              setAdvancedOpen(false);
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
              setAdvancedOpen(false);
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
            {state.mode !== 'slices' && (
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
                    } else {
                      controller.setVolumeTransform(volumeScope, 'yaw', state.volume.yaw - 15);
                    }
                  }}
                />
                <QuestText
                  text={`Yaw: ${Math.round(state.mode === 'anatomy' ? state.yaw : state.volume.yaw)}°`}
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
                    } else {
                      controller.setVolumeTransform(volumeScope, 'yaw', state.volume.yaw + 15);
                    }
                  }}
                />
              </ViroNode>
            )}

            {/* Actions Row (local y = -0.072 -> panel y = -0.156) */}
            <ViroNode position={[0, -0.072, 0]}>
              {onPlaceInFront ? (
                <>
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
                        controller.setHeight(
                          scope,
                          controller.isQuest ? QUEST_ANATOMY_HEIGHT : DEFAULT_MODEL_HEIGHT
                        );
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
                        controller.setHeight(
                          scope,
                          controller.isQuest ? QUEST_ANATOMY_HEIGHT : DEFAULT_MODEL_HEIGHT
                        );
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
            {/* Anatomy Model Selector Row */}
            <ViroNode position={[0, anatomyRows[0], 0]}>
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

            {/* Anatomy Actions Row */}
            <ViroNode position={[0, anatomyRows[1], 0]}>
              <QuestSpatialButton
                label={state.labelsVisible ? 'Labels: ON' : 'Labels: OFF'}
                selected={state.labelsVisible}
                disabled={!canManipulateMedical(state) || !hasMedicalLabels(state.modelId)}
                position={[0, 0, 0.002]}
                width={0.4}
                height={0.044}
                fontSize={0.0135}
                onPress={() => controller.toggleLabels(sessionId)}
              />
            </ViroNode>

            {state.loadStatus === 'error' ? (
              <ViroNode position={[0, anatomyRows[2], 0]}>
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
            {/* Modality & Orientation Row */}
            <ViroNode position={[0, sliceRows[0], 0]}>
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

            {/* Slice Browsing Row */}
            {sliceSeries ? (
              <ViroNode position={[0, sliceRows[1], 0]}>
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

            {/* Slice slider track (the draggable thumb is rendered beside the panel) */}
            {sliceSeries ? (
              <ViroNode position={[0, sliceRows[sliceSliderRow], 0]}>
                <QuestRoundedRect
                  position={[0, 0, 0.001]}
                  width={SLIDER_TRACK_WIDTH}
                  height={SLIDER_TRACK_HEIGHT}
                  radius={SLIDER_TRACK_HEIGHT / 2}
                  material="questBtnIdle"
                  renderingOrder={0}
                  ignoreEventHandling
                />
                <QuestRoundedRect
                  position={[
                    -SLIDER_TRACK_WIDTH / 2 +
                      Math.max(SLIDER_TRACK_HEIGHT, sliderT * SLIDER_TRACK_WIDTH) / 2,
                    0,
                    0.002,
                  ]}
                  width={Math.max(SLIDER_TRACK_HEIGHT, sliderT * SLIDER_TRACK_WIDTH)}
                  height={SLIDER_TRACK_HEIGHT}
                  radius={SLIDER_TRACK_HEIGHT / 2}
                  material="questBtnSelected"
                  renderingOrder={0}
                  ignoreEventHandling
                />
              </ViroNode>
            ) : null}

            {/* Slices Actions Row */}
            <ViroNode position={[0, sliceRows[sliceResetRow], 0]}>
              <QuestSpatialButton
                label="Reset Slice"
                position={[0, 0, 0.002]}
                width={0.4}
                height={0.04}
                fontSize={0.013}
                onPress={() => controller.resetSlice(sessionId)}
              />
            </ViroNode>

            {state.slices.loadStatus === 'error' ? (
              <ViroNode position={[0, sliceRows[sliceResetRow + 1], 0]}>
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
            {isVolumeAdvancedView ? (
              /* Advanced / Diagnostic Sub-Panel */
              <>
                {/* Row 0: Banner / Header + Atomic Return to 3D Scan */}
                <ViroNode position={[0, advVolumeRows[0], 0]}>
                  {state.volume.renderer === 'stack' ? (
                    <>
                      <QuestText
                        text="Experimental Stacked Slices · Unavailable on Quest"
                        position={[-0.14, 0, 0.004]}
                        width={0.54}
                        height={0.034}
                        worldFontSize={0.0115}
                        color="#fde68a"
                      />
                      <QuestSpatialButton
                        label="Return to 3D Scan"
                        variant="accent"
                        position={[0.26, 0, 0.002]}
                        width={0.25}
                        height={0.036}
                        fontSize={0.0125}
                        onPress={() => {
                          setAdvancedOpen(false);
                          controller.showVolumeAnatomy(sessionId);
                        }}
                      />
                    </>
                  ) : state.volume.debugMode !== 'raymarch' ? (
                    <>
                      <QuestText
                        text={`Diagnostic: ${state.volume.debugMode}`}
                        position={[-0.14, 0, 0.004]}
                        width={0.54}
                        height={0.034}
                        worldFontSize={0.012}
                        color="#64d2ff"
                      />
                      <QuestSpatialButton
                        label="Return to 3D Scan"
                        variant="accent"
                        position={[0.26, 0, 0.002]}
                        width={0.25}
                        height={0.036}
                        fontSize={0.0125}
                        onPress={() => {
                          setAdvancedOpen(false);
                          controller.showVolumeAnatomy(sessionId);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <QuestText
                        text="Developer Diagnostics"
                        position={[-0.14, 0, 0.004]}
                        width={0.54}
                        height={0.034}
                        worldFontSize={0.0125}
                        color="#98989d"
                      />
                      <QuestSpatialButton
                        label="Back to Controls"
                        position={[0.26, 0, 0.002]}
                        width={0.25}
                        height={0.036}
                        fontSize={0.0125}
                        onPress={() => setAdvancedOpen(false)}
                      />
                    </>
                  )}
                </ViroNode>

                {/* Row 1: Dataset Modality & Explicit Renderer Selection */}
                <ViroNode position={[0, advVolumeRows[1], 0]}>
                  {(['mri', 'ct'] as const).map((mod, i) => (
                    <QuestSpatialButton
                      key={mod}
                      label={mod.toUpperCase()}
                      selected={state.volume.modality === mod}
                      position={[-0.3075 + i * 0.205, 0, 0.002]}
                      width={0.185}
                      height={0.036}
                      fontSize={0.013}
                      onPress={() =>
                        controller.selectVolumeModality(sessionId, mod as SliceModality)
                      }
                    />
                  ))}
                  <QuestSpatialButton
                    label="Raymarch"
                    selected={state.volume.renderer === 'shader'}
                    position={[0.1025, 0, 0.002]}
                    width={0.185}
                    height={0.036}
                    fontSize={0.0125}
                    onPress={() => {
                      if (state.volume.renderer !== 'shader') {
                        controller.setVolumeRenderer(sessionId, 'shader');
                      }
                    }}
                  />
                  <QuestSpatialButton
                    label="Stacked (Off)"
                    selected={state.volume.renderer === 'stack'}
                    disabled
                    position={[0.3075, 0, 0.002]}
                    width={0.185}
                    height={0.036}
                    fontSize={0.012}
                    onPress={() => {}}
                  />
                </ViroNode>

                {/* Row 2: Diagnostics Row A: Magenta, 3-Sampler, Uniforms, Coords */}
                <ViroNode position={[0, advVolumeRows[2], 0]}>
                  {(
                    [
                      ['magenta', 'Magenta'],
                      ['samplers', '3-Sampler'],
                      ['uniforms', 'Uniforms'],
                      ['coordinates', 'Coords'],
                    ] as const
                  ).map(([mode, label], i) => (
                    <QuestSpatialButton
                      key={mode}
                      label={label}
                      selected={state.volume.debugMode === mode}
                      position={[-0.3075 + i * 0.205, 0, 0.002]}
                      width={0.185}
                      height={0.034}
                      fontSize={0.0125}
                      onPress={() => {
                        if (state.volume.debugMode !== mode) {
                          controller.setVolumeDebugMode(volumeScope, mode);
                        }
                      }}
                    />
                  ))}
                </ViroNode>

                {/* Row 3: Diagnostics Row B: Ray, Opacity Diag, Normal Volume */}
                <ViroNode position={[0, advVolumeRows[3], 0]}>
                  <QuestSpatialButton
                    label="Ray"
                    selected={state.volume.debugMode === 'ray'}
                    position={[-0.27, 0, 0.002]}
                    width={0.24}
                    height={0.034}
                    fontSize={0.0125}
                    onPress={() => {
                      if (state.volume.debugMode !== 'ray') {
                        controller.setVolumeDebugMode(volumeScope, 'ray');
                      }
                    }}
                  />
                  <QuestSpatialButton
                    label="Opacity Diag"
                    selected={state.volume.debugMode === 'opacity'}
                    position={[0, 0, 0.002]}
                    width={0.24}
                    height={0.034}
                    fontSize={0.0125}
                    onPress={() => {
                      if (state.volume.debugMode !== 'opacity') {
                        controller.setVolumeDebugMode(volumeScope, 'opacity');
                      }
                    }}
                  />
                  <QuestSpatialButton
                    label="Normal Volume"
                    selected={
                      state.volume.renderer === 'shader' && state.volume.debugMode === 'raymarch'
                    }
                    position={[0.27, 0, 0.002]}
                    width={0.24}
                    height={0.034}
                    fontSize={0.0125}
                    onPress={() => {
                      setAdvancedOpen(false);
                      controller.showVolumeAnatomy(sessionId);
                    }}
                  />
                </ViroNode>

                {/* Row 4: Plain explanation & expected-output caption */}
                <ViroNode position={[0, advVolumeRows[4], 0]}>
                  {state.volume.renderer === 'stack' ? (
                    <QuestText
                      text="Stacked Slices unavailable on Quest · native material registration race"
                      position={[0, 0, 0.004]}
                      width={0.78}
                      height={0.03}
                      worldFontSize={0.0115}
                      color="#f87171"
                    />
                  ) : (
                    <QuestText
                      text={
                        DIAGNOSTIC_DESCRIPTIONS[state.volume.debugMode] ??
                        'Diagnostic pattern active'
                      }
                      position={[0, 0, 0.004]}
                      width={0.82}
                      height={0.03}
                      worldFontSize={0.011}
                      color="#94a3b8"
                    />
                  )}
                </ViroNode>
              </>
            ) : (
              /* Normal 3D Scan View */
              <>
                {/* Row 0: Modality & Detail (Quality) */}
                <ViroNode position={[0, normalVolumeRows[0], 0]}>
                  {(['mri', 'ct'] as const).map((mod, i) => (
                    <QuestSpatialButton
                      key={mod}
                      label={mod.toUpperCase()}
                      selected={state.volume.modality === mod}
                      position={[-0.3075 + i * 0.205, 0, 0.002]}
                      width={0.185}
                      height={0.04}
                      fontSize={0.013}
                      onPress={() =>
                        controller.selectVolumeModality(sessionId, mod as SliceModality)
                      }
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

                {/* Row 1: Appearance Preset (MRI: static T1 caption; CT: Soft Tissue / Bone) */}
                <ViroNode position={[0, normalVolumeRows[1], 0]}>
                  {state.volume.modality === 'mri' ? (
                    <QuestText
                      text="T1 Grayscale"
                      position={[0, 0, 0.004]}
                      width={0.4}
                      height={0.036}
                      worldFontSize={0.0135}
                      color="#98989d"
                    />
                  ) : (
                    <>
                      {(['ct-soft-tissue', 'ct-bone'] as const).map((preset, i) => (
                        <QuestSpatialButton
                          key={preset}
                          label={preset === 'ct-soft-tissue' ? 'Soft Tissue' : 'Bone'}
                          selected={state.volume.appearance.ct.preset === preset}
                          position={[-0.15 + i * 0.3, 0, 0.002]}
                          width={0.26}
                          height={0.04}
                          fontSize={0.0125}
                          onPress={() =>
                            controller.setVolumePreset(volumeScope, preset as VolumePreset)
                          }
                        />
                      ))}
                    </>
                  )}
                </ViroNode>

                {/* Row 2: Visibility Control (0-100%, monotonic) */}
                <ViroNode position={[0, normalVolumeRows[2], 0]}>
                  <QuestSpatialButton
                    label="Visibility -"
                    position={[-0.26, 0, 0.002]}
                    width={0.2}
                    height={0.038}
                    fontSize={0.0125}
                    onPress={() => {
                      const current = state.volume.appearance[state.volume.modality].opacity;
                      controller.setVolumeAppearance(
                        volumeScope,
                        'opacity',
                        Math.max(0.0, current - 0.2)
                      );
                    }}
                  />
                  <QuestText
                    text={`Visibility: ${Math.round(state.volume.appearance[state.volume.modality].opacity * 50)}%`}
                    position={[0, 0, 0.004]}
                    width={0.24}
                    height={0.036}
                    worldFontSize={0.0135}
                    color="#f8fafc"
                  />
                  <QuestSpatialButton
                    label="Visibility +"
                    position={[0.26, 0, 0.002]}
                    width={0.2}
                    height={0.038}
                    fontSize={0.0125}
                    onPress={() => {
                      const current = state.volume.appearance[state.volume.modality].opacity;
                      controller.setVolumeAppearance(
                        volumeScope,
                        'opacity',
                        Math.min(2.0, current + 0.2)
                      );
                    }}
                  />
                </ViroNode>

                {/* Row 3: Action Row (Reset Appearance or Retry; Diagnostics in developer builds) */}
                <ViroNode position={[0, normalVolumeRows[3], 0]}>
                  {state.volume.loadStatus === 'error' ? (
                    <QuestSpatialButton
                      label="Retry Loading Volume"
                      variant="danger"
                      position={[MEDICAL_DIAGNOSTICS_ENABLED ? -0.15 : 0, 0, 0.002]}
                      width={0.42}
                      height={0.038}
                      fontSize={0.0125}
                      onPress={() => controller.retryVolumeLoad(sessionId)}
                    />
                  ) : (
                    <QuestSpatialButton
                      label="Reset Appearance"
                      position={[MEDICAL_DIAGNOSTICS_ENABLED ? -0.15 : 0, 0, 0.002]}
                      width={0.32}
                      height={0.038}
                      fontSize={0.0125}
                      onPress={() => controller.resetVolumeAppearance(sessionId)}
                    />
                  )}
                  {MEDICAL_DIAGNOSTICS_ENABLED ? (
                    <QuestSpatialButton
                      label="Diagnostics"
                      position={[0.26, 0, 0.002]}
                      width={0.22}
                      height={0.038}
                      fontSize={0.0125}
                      onPress={() => setAdvancedOpen(true)}
                    />
                  ) : null}
                </ViroNode>
              </>
            )}
          </ViroNode>
        )}
      </ViroNode>
    </>
  );
}
