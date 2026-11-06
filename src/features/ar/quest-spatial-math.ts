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
  const { distanceM = 1.1, verticalOffsetM = -0.46 } = options;
  const [px, py, pz] = pose.position;
  const [hx, hz] = horizontalUnitForward(pose.forward);
  const yawDeg = Math.atan2(hx, hz) * RAD_TO_DEG + 180;

  return {
    position: [px + hx * distanceM, py + verticalOffsetM, pz + hz * distanceM],
    rotation: [0, yawDeg, 0],
  };
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
    specimenVerticalOffsetM = 0.16,
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
