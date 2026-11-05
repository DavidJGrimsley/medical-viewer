export const METRES_PER_FOOT = 0.3048;
export const DEFAULT_AR_HEIGHT = 2 * METRES_PER_FOOT;
export const MIN_AR_HEIGHT = 0;
export const MAX_AR_HEIGHT = 5 * METRES_PER_FOOT;
export const MIN_AR_SCALE = 0.5;
export const MAX_AR_SCALE = 3;
export type ARPositionAxis = 'x' | 'y' | 'z';
export const clampAROffset = (value: number) =>
  Math.max(-MAX_AR_HEIGHT, Math.min(MAX_AR_HEIGHT, value));

export const clampARScale = (value: number) =>
  Math.min(MAX_AR_SCALE, Math.max(MIN_AR_SCALE, value));
export const clampARHeight = (value: number) =>
  Math.min(MAX_AR_HEIGHT, Math.max(MIN_AR_HEIGHT, value));
export const normalizeYaw = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
