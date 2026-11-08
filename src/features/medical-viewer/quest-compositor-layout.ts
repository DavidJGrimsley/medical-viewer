import { rigLocalToWorld, type Point3, type RigPose } from '../ar/quest-spatial-math.ts';

export const QUEST_PANEL_WIDTH_M = 0.92;
export const QUEST_PANEL_LOGICAL_WIDTH = 1000;
export const QUEST_PANEL_UNIT_M = 0.52 / 565;
export const QUEST_PANEL_BASE_Y = -0.26;
export const QUEST_PANEL_GRAB_SPACE = 60;

export function panelGeometry(height: number) {
  const bodyHeight = height - QUEST_PANEL_GRAB_SPACE;
  return {
    heightM: height * QUEST_PANEL_UNIT_M,
    bodyHeight,
    bodyHeightM: bodyHeight * QUEST_PANEL_UNIT_M,
    imageCenterY: QUEST_PANEL_BASE_Y + (height / 2 - QUEST_PANEL_GRAB_SPACE) * QUEST_PANEL_UNIT_M,
    bodyCenterY: QUEST_PANEL_BASE_Y + (bodyHeight * QUEST_PANEL_UNIT_M) / 2,
  };
}

export function panelItemLocal(item: { x: number; y: number }, height: number, z = 0.004): Point3 {
  return [
    (item.x / QUEST_PANEL_LOGICAL_WIDTH - 0.5) * QUEST_PANEL_WIDTH_M,
    QUEST_PANEL_BASE_Y + (height - QUEST_PANEL_GRAB_SPACE - item.y) * QUEST_PANEL_UNIT_M,
    z,
  ];
}

export function panelImagePosition(rig: RigPose, height: number): Point3 {
  return rigLocalToWorld(rig, [0, panelGeometry(height).imageCenterY, 0]);
}

export function sliderValueAtX(
  slider: { x: number; width: number; min: number; max: number },
  x: number
) {
  const t = Math.max(0, Math.min(1, (x - slider.x) / slider.width));
  return slider.min + t * (slider.max - slider.min);
}

// Positive 180° and negative 180° have the same orientation. Stay just below
// positive 180 so the controller's yaw normalization doesn't jump the thumb left.
export function rotationSliderValue(value: number) {
  return Math.max(-180, Math.min(179.999, Math.round(value)));
}
