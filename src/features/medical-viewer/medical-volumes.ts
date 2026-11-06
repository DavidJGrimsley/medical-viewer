import type { SliceModality } from './medical-slices.ts';

export type VolumePreset = 'mri-grayscale' | 'ct-bone' | 'ct-soft-tissue';
export type VolumeQuality = 'balanced' | 'fast';
export type VolumeRenderer = 'stack' | 'shader';
export type VolumeDebugMode =
  | 'magenta'
  | 'samplers'
  | 'high'
  | 'low'
  | 'validity'
  | 'coordinates'
  | 'uniforms'
  | 'ray'
  | 'opacity'
  | 'raymarch';
export const STACK_PLANE_COUNT = 48;
export const VOLUME_DEBUG_LABELS: Record<VolumeDebugMode, string> = {
  magenta: '1 · Magenta (no textures)',
  samplers: '2 · 3-Sampler diagnostic',
  high: '3 · High byte',
  low: '4 · Low byte',
  validity: '5 · Validity',
  coordinates: '6 · Coordinates',
  uniforms: '7 · Uniforms',
  ray: '8 · Ray interval',
  opacity: '9 · Accumulated opacity',
  raymarch: '10 · Ray march (experimental)',
};
export type VolumeAtlas = 'high' | 'low' | 'validity';
export type VolumeBounds = [number, number, number, number, number, number];
export interface VolumeAppearance {
  preset: VolumePreset;
  window: number;
  level: number;
  opacity: number;
}
export interface MedicalVolumeSeries {
  modality: SliceModality;
  scalarOffset: number;
  scalarScale: number;
  scalarRange: [number, number];
  atlases: Record<VolumeAtlas, { filename: string }>;
}
export interface MedicalVolumeDataset {
  boundsRasMm: VolumeBounds;
  dimensions: [number, number, number];
  spacingMm: number;
  atlas: {
    dimensions: [number, number];
    columns: number;
    tileDimensions: [number, number];
    gutter: number;
  };
  series: readonly MedicalVolumeSeries[];
  error: string | null;
}
export const EMPTY_VOLUME_DATASET: MedicalVolumeDataset = {
  boundsRasMm: [0, 1, 0, 1, 0, 1],
  dimensions: [2, 2, 2],
  spacingMm: 1,
  atlas: { dimensions: [4, 4], columns: 1, tileDimensions: [4, 4], gutter: 1 },
  series: [],
  error: null,
};
export const VOLUME_WIDTH_METRES = 0.55;
/** Preserve different controls changed in the same frame; latest event wins per control. */
export class VolumeControlScheduler {
  private frame: number | null = null;
  private pending = new Map<string, () => void>();
  private request: (callback: () => void) => number;
  private cancel: (frame: number) => void;
  constructor(request: (callback: () => void) => number, cancel: (frame: number) => void) {
    this.request = request;
    this.cancel = cancel;
  }
  select(key: string, callback: () => void) {
    this.pending.set(key, callback);
    if (this.frame !== null) return;
    this.frame = this.request(() => {
      this.frame = null;
      const pending = [...this.pending.values()];
      this.pending.clear();
      pending.forEach((update) => update());
    });
  }
  clear() {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.pending.clear();
  }
}
export const DEFAULT_VOLUME_YAW = 135;
export const VOLUME_ATLASES: readonly VolumeAtlas[] = ['high', 'low', 'validity'];
export const VOLUME_PRESETS: Record<
  VolumePreset,
  { label: string; modality: SliceModality; window: number; level: number }
> = {
  'mri-grayscale': { label: 'MRI Grayscale', modality: 'mri', window: 5589, level: 2671.5 },
  'ct-bone': { label: 'CT Bone', modality: 'ct', window: 1800, level: 400 },
  'ct-soft-tissue': { label: 'CT Soft Tissue', modality: 'ct', window: 150, level: 40 },
};
export function defaultVolumeAppearance(modality: SliceModality): VolumeAppearance {
  const preset = modality === 'mri' ? 'mri-grayscale' : 'ct-bone';
  return {
    preset,
    window: VOLUME_PRESETS[preset].window,
    level: VOLUME_PRESETS[preset].level,
    opacity: 1.6,
  };
}
export function initialVolumeCrop(bounds: VolumeBounds): VolumeBounds {
  return [...bounds] as VolumeBounds;
}
export function volumeControlRanges(series: MedicalVolumeSeries, appearance: VolumeAppearance) {
  const [min, max] = series.scalarRange;
  const span = Math.max(1, max - min);
  return {
    window: [1, Math.max(span * 2, appearance.window)] as const,
    level: [min - span, max + span] as const,
  };
}
export function clampVolumeCrop(
  dataset: MedicalVolumeDataset,
  crop: VolumeBounds,
  boundary: number,
  value: number
): VolumeBounds {
  const next = [...crop] as VolumeBounds;
  const lower = boundary % 2 === 0;
  next[boundary] = Math.max(
    lower ? dataset.boundsRasMm[boundary] : crop[boundary - 1] + dataset.spacingMm,
    Math.min(lower ? crop[boundary + 1] - dataset.spacingMm : dataset.boundsRasMm[boundary], value)
  );
  return next;
}
export function parseMedicalVolumeDataset(value: unknown): MedicalVolumeDataset {
  try {
    const data = value as Record<string, any>;
    const vector = (item: unknown, count: number): item is number[] =>
      Array.isArray(item) &&
      item.length === count &&
      item.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (
      !data ||
      data.schemaVersion !== 1 ||
      data.coordinateSystem !== 'RAS mm' ||
      !vector(data.grid?.boundsRasMm, 6) ||
      !vector(data.grid.dimensions, 3) ||
      !data.grid.dimensions.every((x: number) => Number.isInteger(x) && x >= 2 && x <= 256) ||
      !(data.grid.spacingMm > 0) ||
      !Number.isFinite(data.grid.spacingMm) ||
      !vector(data.atlas?.dimensions, 2) ||
      !vector(data.atlas.tileDimensions, 2) ||
      data.atlas.gutter !== 1 ||
      !Number.isInteger(data.atlas.columns) ||
      data.atlas.columns < 1 ||
      !data.atlas.dimensions.every((x: number) => Number.isInteger(x) && x > 0 && x <= 4096) ||
      data.atlas.tileDimensions[0] !== data.grid.dimensions[0] + 2 ||
      data.atlas.tileDimensions[1] !== data.grid.dimensions[1] + 2 ||
      data.atlas.dimensions[0] !== data.atlas.columns * data.atlas.tileDimensions[0] ||
      data.atlas.dimensions[1] !==
        Math.ceil(data.grid.dimensions[2] / data.atlas.columns) * data.atlas.tileDimensions[1] ||
      !Array.isArray(data.series) ||
      !data.series.length
    )
      throw new Error('Invalid volume metadata.');
    for (let axis = 0; axis < 3; axis++) {
      const span = data.grid.boundsRasMm[axis * 2 + 1] - data.grid.boundsRasMm[axis * 2];
      if (Math.abs(span - (data.grid.dimensions[axis] - 1) * data.grid.spacingMm) > 0.001)
        throw new Error('Invalid volume geometry.');
    }
    const seen = new Set<string>();
    const series = data.series.map((item: MedicalVolumeSeries) => {
      if (
        !item ||
        !['ct', 'mri'].includes(item.modality) ||
        seen.has(item.modality) ||
        !vector(item.scalarRange, 2) ||
        item.scalarRange[1] <= item.scalarRange[0] ||
        !Number.isFinite(item.scalarOffset) ||
        !(item.scalarScale > 0) ||
        !Number.isFinite(item.scalarScale) ||
        Math.abs(item.scalarOffset - item.scalarRange[0]) > 0.001 ||
        Math.abs(item.scalarScale * 65535 - (item.scalarRange[1] - item.scalarRange[0])) > 0.001 ||
        VOLUME_ATLASES.some(
          (key) => item.atlases?.[key]?.filename !== `${item.modality}_${key}.png`
        )
      )
        throw new Error('Invalid volume series.');
      seen.add(item.modality);
      return item;
    });
    return {
      boundsRasMm: data.grid.boundsRasMm,
      dimensions: data.grid.dimensions,
      spacingMm: data.grid.spacingMm,
      atlas: data.atlas,
      series,
      error: null,
    };
  } catch (error) {
    return {
      ...EMPTY_VOLUME_DATASET,
      error: error instanceof Error ? error.message : 'Volume data unavailable.',
    };
  }
}
