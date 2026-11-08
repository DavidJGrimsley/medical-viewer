import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ViroMaterials,
  ViroNode,
  ViroQuad,
  useAnySourceHover,
  useAnySourcePressed,
} from '@reactvision/react-viro';
import { rigLocalToWorld, rigWorldToLocalX, type Point3 } from '@/features/ar/quest-spatial-math';
import { MEDICAL_DIAGNOSTICS_ENABLED } from './medical-diagnostics';
import {
  buildQuestCompositorPanel,
  type QuestPanelItem,
  type QuestPanelPage,
} from './quest-compositor-panel';
import type { QuestSpatialControlsProps } from './quest-spatial-controls.native';
import {
  panelItemLocal,
  panelImagePosition,
  sliderValueAtX,
  QUEST_PANEL_WIDTH_M,
  QUEST_PANEL_UNIT_M,
} from './quest-compositor-layout';
import { questCompositor } from './quest-compositor-bridge';
import { questCompositorMaterials } from './quest-compositor-materials';

// The compositor draws the pixels; this depth-only surface cuts a transparent hole
// in the scene for the UI underlay. Geometry in front can still occlude the panel.
ViroMaterials.createMaterials(questCompositorMaterials());

const WIDTH = QUEST_PANEL_WIDTH_M;

// Viro owns the drag only. The visible thumb is drawn in the native panel texture.
function DragTarget({
  position,
  rotation,
  onDrag,
  onDragEnd,
  freezeDuringDrag = false,
  width = 0.06,
  height = 56 * QUEST_PANEL_UNIT_M,
}: {
  position: Point3;
  rotation: Point3;
  onDrag: (world: Point3) => void;
  onDragEnd?: () => void;
  freezeDuringDrag?: boolean;
  width?: number;
  height?: number;
}) {
  const [resetKey, setResetKey] = useState(0);
  const [dragOrigin, setDragOrigin] = useState<Point3 | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reset = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    setDragOrigin(null);
    onDragEnd?.();
    setResetKey((key) => key + 1);
  };
  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current);
    },
    []
  );
  return (
    <ViroNode key={resetKey} position={dragOrigin ?? position} rotation={rotation}>
      <ViroQuad
        width={width}
        height={height}
        materials="questCompositorHit"
        dragType="FixedDistance"
        onDrag={(world) => {
          if (!world.every(Number.isFinite)) return;
          if (freezeDuringDrag && !dragOrigin) setDragOrigin(position);
          onDrag(world);
          if (idle.current) clearTimeout(idle.current);
          idle.current = setTimeout(reset, 600);
        }}
        onClickState={(clickState) => {
          if (clickState >= 2) reset();
        }}
      />
    </ViroNode>
  );
}

function HitTarget({
  item,
  onActivity,
  height,
}: {
  item: QuestPanelItem;
  height: number;
  onActivity: (id: string, value: number) => void;
}) {
  const [hovered, onHover] = useAnySourceHover();
  const [pressed, onClickState] = useAnySourcePressed();
  useEffect(() => {
    onActivity(item.id, pressed ? 2 : hovered ? 1 : 0);
    return () => onActivity(item.id, 0);
  }, [item.id, hovered, pressed, onActivity]);
  return (
    <ViroQuad
      position={panelItemLocal(item, height)}
      width={(item.width / 1000) * WIDTH}
      height={item.height * QUEST_PANEL_UNIT_M}
      materials="questCompositorHit"
      onHover={onHover}
      onClickState={onClickState}
      onClick={item.action}
      renderingOrder={-99}
    />
  );
}

export function QuestCompositorControls({
  context,
  controller,
  panelPose,
  onRecenter,
  onPlaceInFront,
  onExit,
  onMoveRig,
  onRenderFailure,
}: QuestSpatialControlsProps & { onRenderFailure: () => void }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [activity, setActivity] = useState<Record<string, number>>({});
  const onActivity = useCallback((id: string, value: number) => {
    setActivity((previous) => (previous[id] === value ? previous : { ...previous, [id]: value }));
  }, []);
  const [page, setPage] = useState<QuestPanelPage>('main');
  const [slicePreview, setSlicePreview] = useState<number | null>(null);
  const lastSliceUpdate = useRef(0);
  const pendingSlice = useRef<{ value: number; apply: (value: number) => void } | null>(null);
  const sessionId = context.sessionId;
  const { items, sliders, grabBar, height, heightM, bodyHeight, bodyHeightM, bodyCenterY } =
    buildQuestCompositorPanel({
      controller,
      snapshot,
      sessionId,
      page,
      setPage,
      diagnosticsEnabled: MEDICAL_DIAGNOSTICS_ENABLED,
      slicePreview,
      onRecenter,
      onPlaceInFront,
      onExit,
    });
  const spec = JSON.stringify({
    height,
    bodyHeight,
    heightM,
    items: items.map(({ action: _action, ...item }) => ({
      ...item,
      fill: _action
        ? item.disabled
          ? '#1e293b'
          : activity[item.id] === 2
            ? '#0369a1'
            : activity[item.id] === 1
              ? '#334f70'
              : item.selected
                ? '#075985'
                : '#263448'
        : item.fill,
      color: item.disabled ? '#64748b' : (item.color ?? '#f8fafc'),
    })),
  });
  const [px, py, pz] = panelPose ? panelImagePosition(panelPose, height) : [0, 0, 0];
  const yaw = ((panelPose?.rotation[1] ?? 0) * Math.PI) / 360;
  const visible = !!panelPose;
  const owner = useRef(0);
  useEffect(() => {
    const id = questCompositor?.open() ?? 0;
    owner.current = id;
    return () => {
      questCompositor?.hide(id);
    };
  }, []);
  useEffect(() => {
    if (visible)
      questCompositor?.setPose(owner.current, [px, py, pz, 0, Math.sin(yaw), 0, Math.cos(yaw)]);
  }, [visible, px, py, pz, yaw]);
  useEffect(() => {
    if (!visible) return;
    try {
      questCompositor?.draw(owner.current, spec);
    } catch (error) {
      console.error('Quest compositor panel failed', error);
      onRenderFailure();
    }
  }, [visible, spec, onRenderFailure]);
  useEffect(() => {
    const timer = setInterval(() => {
      if ((questCompositor?.status(owner.current) ?? -1) < 0) onRenderFailure();
    }, 1000);
    return () => clearInterval(timer);
  }, [onRenderFailure]);
  const logicalX = (world: Point3) => (rigWorldToLocalX(panelPose!, world) / WIDTH + 0.5) * 1000;
  if (!panelPose) return null;
  const grabLocal = panelItemLocal(grabBar, height, 0.012);
  return (
    <>
      <DragTarget
        position={rigLocalToWorld(panelPose, grabLocal)}
        rotation={panelPose.rotation}
        width={WIDTH * 0.3}
        onDrag={(position) => onMoveRig?.(position, grabLocal)}
      />
      {sliders
        .filter((slider) => !slider.disabled)
        .map((slider) => {
          const thumb = items.find((item) => item.id === slider.id + '-thumb')!;
          return (
            <DragTarget
              key={slider.id}
              freezeDuringDrag
              position={rigLocalToWorld(panelPose, panelItemLocal(thumb, height, 0.014))}
              rotation={panelPose.rotation}
              onDrag={(world) => {
                const value = sliderValueAtX(slider, logicalX(world));
                if (slider.id !== 'slice') {
                  slider.onChange(value);
                  return;
                }
                setSlicePreview(value);
                pendingSlice.current = { value, apply: slider.onChange };
                const now = Date.now();
                if (now - lastSliceUpdate.current >= 100) {
                  slider.onChange(value);
                  lastSliceUpdate.current = now;
                }
              }}
              onDragEnd={() => {
                if (slider.id !== 'slice' || !pendingSlice.current) return;
                pendingSlice.current.apply(pendingSlice.current.value);
                pendingSlice.current = null;
                setSlicePreview(null);
              }}
            />
          );
        })}
      <ViroNode position={panelPose.position} rotation={panelPose.rotation}>
        <ViroQuad
          position={[0, bodyCenterY, 0]}
          width={WIDTH}
          height={bodyHeightM}
          materials="questCompositorMask"
          renderingOrder={-100}
          ignoreEventHandling
        />
        {sliders
          .filter((slider) => !slider.disabled)
          .map((slider) => (
            <ViroQuad
              key={slider.id + '-track-hit'}
              position={panelItemLocal(
                { x: slider.x + slider.width / 2, y: slider.y },
                height,
                0.006
              )}
              width={(slider.width / 1000) * WIDTH}
              height={56 * QUEST_PANEL_UNIT_M}
              materials="questCompositorHit"
              renderingOrder={-99}
              onClick={(world) => slider.onChange(sliderValueAtX(slider, logicalX(world)))}
            />
          ))}
        {items
          .filter((item) => item.action && !item.disabled)
          .map((item) => (
            <HitTarget key={item.id} item={item} height={height} onActivity={onActivity} />
          ))}
      </ViroNode>
    </>
  );
}
