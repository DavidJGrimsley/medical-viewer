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
