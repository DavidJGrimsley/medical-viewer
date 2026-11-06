import { DEFAULT_AR_HEIGHT } from './ar-transform.ts';

export type Point3 = [number, number, number];
export type Rotation3 = [number, number, number];

export interface CameraPose {
  position: Point3;
  forward: Point3;
  up?: Point3;
}

const RAD_TO_DEG = 180 / Math.PI;

export interface HeadLockedTransformOptions {
  distanceM?: number;
  verticalOffsetM?: number;
}

export interface QuestSpecimenTransformOptions {
  distanceM?: number;
  specimenVerticalOffsetM?: number;
  defaultModelHeightM?: number;
}

function horizontalUnitForward(forward: Point3): [number, number] {
  const [fx, , fz] = forward;
  const length = Math.hypot(fx, fz);
  if (!Number.isFinite(length) || length < 1e-4) {
    return [0, -1];
  }
  return [fx / length, fz / length];
}

/**
 * Computes world position and yaw-only rotation for a panel positioned `distanceM`
 * in front of where the camera is currently looking, facing back toward the wearer.
 *
 * Leaving pitch and roll at 0 keeps the panel upright and legible in mixed reality
 * rather than tilting uncomfortably with head pitch.
 */
export function computeHeadLockedTransform(
  pose: CameraPose,
  options: HeadLockedTransformOptions = {}
): { position: Point3; rotation: Rotation3 } {
  const { distanceM = 1.1, verticalOffsetM = -0.1 } = options;
  const [px, py, pz] = pose.position;
  const [fx, fy, fz] = pose.forward;
  const [ux, uy, uz] = pose.up ?? [0, 1, 0];

  const position: Point3 = [
    px + fx * distanceM + ux * verticalOffsetM,
    py + fy * distanceM + uy * verticalOffsetM,
    pz + fz * distanceM + uz * verticalOffsetM,
  ];

  // Rotate 180 deg so the front of the panel faces back toward the user
  const yawDeg = Math.atan2(fx, fz) * RAD_TO_DEG + 180;

  return {
    position,
    rotation: [0, yawDeg, 0],
  };
}

/**
 * Places the Quest spatial control deck at a pitch-invariant horizontal distance
 * and comfortable desk-level height below sightline, facing back toward the wearer.
 *
 * Projecting camera forward onto the XZ plane prevents head pitch during scene
 * entry or Recenter from stranding controls on the ceiling or floor.
 */
export function computeQuestPanelTransform(
  pose: CameraPose,
  options: HeadLockedTransformOptions = {}
): { position: Point3; rotation: Rotation3 } {
  const { distanceM = 1.1, verticalOffsetM = QUEST_PANEL_VERTICAL_OFFSET_M } = options;
  const [px, py, pz] = pose.position;
  const [hx, hz] = horizontalUnitForward(pose.forward);
  const yawDeg = Math.atan2(hx, hz) * RAD_TO_DEG + 180;

  return {
    position: [px + hx * distanceM, py + verticalOffsetM, pz + hz * distanceM],
    rotation: [0, yawDeg, 0],
  };
}

/** Panel centre sits this far below eye level (lowered from -0.46 so controls are not up high). */
export const QUEST_PANEL_VERTICAL_OFFSET_M = -0.65;
/** Specimen centre floats this far above eye level (lowered from +0.16; its bottom must still clear the panel top). */
export const QUEST_SPECIMEN_VERTICAL_OFFSET_M = 0.04;
/** The specimen sits this much closer to the wearer than the panel. */
export const QUEST_SPECIMEN_TOWARD_WEARER_M = 0.15;
/** Grab bar centre, in panel-local metres below the panel centre. */
export const QUEST_GRAB_BAR_LOCAL_Y = -0.3;
/** Grab bar centre, in panel-local metres right of the panel centre. */
export const QUEST_GRAB_BAR_LOCAL_X = -0.12;
/** Horizontal drag distance (m) that maps to one full turn of the model. */
export const QUEST_ROTATE_METRES_PER_TURN = 0.6;

export interface RigPose {
  position: Point3;
  rotation: Rotation3;
}

/** Rotates a rig-local offset into world space using the rig's yaw (rotation[1], degrees). */
export function rigLocalToWorld(rig: RigPose, local: Point3): Point3 {
  const yaw = (rig.rotation[1] * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [
    rig.position[0] + local[0] * cos + local[2] * sin,
    rig.position[1] + local[1],
    rig.position[2] - local[0] * sin + local[2] * cos,
  ];
}

/** Inverse of rigLocalToWorld for the horizontal (x) axis: where a world point falls along the rig's width. */
export function rigWorldToLocalX(rig: RigPose, world: Point3): number {
  const yaw = (rig.rotation[1] * Math.PI) / 180;
  const dx = world[0] - rig.position[0];
  const dz = world[2] - rig.position[2];
  return dx * Math.cos(yaw) - dz * Math.sin(yaw);
}

/** Maps a position along a slider track (local x) to the nearest slice index. */
export function sliderIndexFromLocalX(
  localX: number,
  trackCentreX: number,
  trackWidth: number,
  count: number
): number {
  if (count <= 1 || !Number.isFinite(localX)) return 0;
  const t = Math.min(1, Math.max(0, (localX - (trackCentreX - trackWidth / 2)) / trackWidth));
  return Math.round(t * (count - 1));
}

/**
 * World anchor for the specimen, derived from the rig so that moving the rig
 * (grab bar) moves panel and model together.
 */
export function computeSpecimenFromRig(
  rig: RigPose,
  defaultModelHeightM: number = DEFAULT_AR_HEIGHT
): RigPose {
  return {
    position: rigLocalToWorld(rig, [
      0,
      QUEST_SPECIMEN_VERTICAL_OFFSET_M - defaultModelHeightM - QUEST_PANEL_VERTICAL_OFFSET_M,
      QUEST_SPECIMEN_TOWARD_WEARER_M,
    ]),
    rotation: rig.rotation,
  };
}

/** New rig position so that the grab bar ends up at `barWorld` (rig yaw is preserved). */
export function rigPositionForGrabBar(rig: RigPose, barWorld: Point3): Point3 {
  const offset = rigLocalToWorld({ position: [0, 0, 0], rotation: rig.rotation }, [
    QUEST_GRAB_BAR_LOCAL_X,
    QUEST_GRAB_BAR_LOCAL_Y,
    0,
  ]);
  return [barWorld[0] - offset[0], barWorld[1] - offset[1], barWorld[2] - offset[2]];
}

/** Yaw (degrees) that turns a rig at `from` so its front faces `target`; null if they coincide horizontally. */
export function yawFacing(from: Point3, target: Point3): number | null {
  const dx = target[0] - from[0];
  const dz = target[2] - from[2];
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 1e-4) return null;
  return Math.atan2(dx, dz) * RAD_TO_DEG;
}

/**
 * Rig pose after dragging the grab bar to `handleWorld`: the bar stays under the
 * pointer and the whole rig (console + specimen) turns to keep facing the wearer,
 * upright with no pitch or roll. Yaw and position depend on each other, so a few
 * fixed-point passes settle them.
 */
export function rigForGrabBarFacing(
  rig: RigPose,
  handleWorld: Point3,
  cameraPosition: Point3 | null
): RigPose {
  let current = rig;
  for (let i = 0; i < 3; i++) {
    const position = rigPositionForGrabBar(current, handleWorld);
    const yaw = cameraPosition ? yawFacing(position, cameraPosition) : null;
    current = { position, rotation: [0, yaw ?? current.rotation[1], 0] };
  }
  return current;
}

/**
 * Converts a drag between two world points into a yaw delta (degrees) using
 * only the component along the rig's right axis. Dragging right turns the
 * front of the model to the right.
 */
export function dragToYawDelta(
  prev: Point3,
  next: Point3,
  rigYawDeg: number,
  metresPerTurn: number = QUEST_ROTATE_METRES_PER_TURN
): number {
  const yaw = (rigYawDeg * Math.PI) / 180;
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const along = (next[0] - prev[0]) * rightX + (next[2] - prev[2]) * rightZ;
  if (!Number.isFinite(along)) return 0;
  return (along / metresPerTurn) * 360;
}

/** Counter-clockwise outline of a rounded rectangle for ViroPolygon (corner radius is clamped). */
export function roundedRectVertices(
  width: number,
  height: number,
  radius: number,
  segmentsPerCorner = 5
): [number, number][] {
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.max(0, Math.min(radius, hw, hh));
  if (r === 0) {
    return [
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
      [-hw, -hh],
    ];
  }
  const corners: [number, number, number][] = [
    [hw - r, -hh + r, -90],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, 90],
    [-hw + r, -hh + r, 180],
  ];
  const points: [number, number][] = [];
  for (const [cx, cy, startDeg] of corners) {
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const a = ((startDeg + (90 * i) / segmentsPerCorner) * Math.PI) / 180;
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return points;
}

/**
 * Computes a world-space anchor pose for Quest room-model-free placement ("Place In Front")
 * so the specimen center (`anchorY + defaultModelHeightM`) floats in clear passthrough
 * view above the spatial control deck and faces the wearer.
 */
export function computeQuestSpecimenTransform(
  pose: CameraPose,
  options: QuestSpecimenTransformOptions = {}
): { position: Point3; rotation: Rotation3 } {
  const {
    distanceM = 0.95,
    specimenVerticalOffsetM = QUEST_SPECIMEN_VERTICAL_OFFSET_M,
    defaultModelHeightM = DEFAULT_AR_HEIGHT,
  } = options;
  const [px, py, pz] = pose.position;
  const [hx, hz] = horizontalUnitForward(pose.forward);
  const yawDeg = Math.atan2(hx, hz) * RAD_TO_DEG + 180;

  return {
    position: [
      px + hx * distanceM,
      py + specimenVerticalOffsetM - defaultModelHeightM,
      pz + hz * distanceM,
    ],
    rotation: [0, yawDeg, 0],
  };
}
