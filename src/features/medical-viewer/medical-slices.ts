export type MedicalViewerMode = 'anatomy' | 'slices' | 'volume';
export type SliceModality = 'ct' | 'mri';
export type SliceOrientation = 'axial' | 'sagittal' | 'coronal';

export interface MedicalSlice {
  filename: string;
  positionMm: number;
}

export interface MedicalSliceSeries {
  modality: SliceModality;
  orientation: SliceOrientation;
  imageCount: number;
  imageDimensions: [number, number];
  slices: readonly MedicalSlice[];
}

export interface MedicalSliceDataset {
  series: readonly MedicalSliceSeries[];
  error: string | null;
}

export const EMPTY_SLICE_DATASET: MedicalSliceDataset = { series: [], error: null };
export const SLICE_PANEL_WIDTH_METRES = 0.55;

export function parseMedicalSliceDataset(value: unknown): MedicalSliceDataset {
  try {
    if (!value || typeof value !== 'object') throw new Error('Missing scan metadata.');
    const data = value as Record<string, unknown>;
    if (
      data.schemaVersion !== 1 ||
      data.coordinateSystem !== 'RAS mm' ||
      !Array.isArray(data.series)
    )
      throw new Error('Unsupported scan metadata.');
    const keys = new Set<string>();
    const series = data.series.map((entry): MedicalSliceSeries => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid scan series.');
      const item = entry as Record<string, unknown>;
      const { modality, orientation, imageCount, imageDimensions, slices } = item;
      if (
        !['ct', 'mri'].includes(String(modality)) ||
        !['axial', 'sagittal', 'coronal'].includes(String(orientation)) ||
        !Number.isInteger(imageCount) ||
        !Array.isArray(slices) ||
        !slices.length ||
        imageCount !== slices.length ||
        !Array.isArray(imageDimensions) ||
        imageDimensions.length !== 2 ||
        !imageDimensions.every((size) => Number.isInteger(size) && size > 0)
      )
        throw new Error('Invalid scan dimensions or image count.');
      const key = `${modality}:${orientation}`;
      if (keys.has(key)) throw new Error('Duplicate scan series.');
      keys.add(key);
      let previous = -Infinity;
      const images = slices.map((slice, index): MedicalSlice => {
        if (
          !slice ||
          slice.filename !== `${modality}_${orientation}_${String(index).padStart(3, '0')}.png` ||
          typeof slice.positionMm !== 'number' ||
          !Number.isFinite(slice.positionMm) ||
          slice.positionMm <= previous
        )
          throw new Error('Invalid scan filename or physical slice position.');
        previous = slice.positionMm;
        return { filename: slice.filename, positionMm: slice.positionMm };
      });
      return {
        modality: modality as SliceModality,
        orientation: orientation as SliceOrientation,
        imageCount: images.length,
        imageDimensions: imageDimensions as [number, number],
        slices: images,
      };
    });
    return { series, error: null };
  } catch (error) {
    return {
      series: [],
      error: error instanceof Error ? error.message : 'Scan metadata could not be read.',
    };
  }
}

export function clampSliceIndex(value: number, count: number) {
  return Math.max(0, Math.min(count - 1, Math.round(value)));
}

export function middleSliceIndex(count: number) {
  return Math.floor(count / 2);
}

export function nearestSliceIndex(series: MedicalSliceSeries, positionMm: number) {
  let nearest = 0;
  series.slices.forEach((slice, index) => {
    if (
      Math.abs(slice.positionMm - positionMm) <
      Math.abs(series.slices[nearest].positionMm - positionMm)
    )
      nearest = index;
  });
  return nearest;
}

/** Coalesce native slider events while keeping the latest selection, cancelable on exit. */
export class SliceSelectionScheduler {
  private frame: number | null = null;
  private pending: (() => void) | null = null;
  private request: (callback: () => void) => number;
  private cancel: (frame: number) => void;

  constructor(request: (callback: () => void) => number, cancel: (frame: number) => void) {
    this.request = request;
    this.cancel = cancel;
  }

  schedule(action: () => void) {
    this.pending = action;
    if (this.frame !== null) return;
    this.frame = this.request(() => {
      this.frame = null;
      const pending = this.pending;
      this.pending = null;
      pending?.();
    });
  }

  clear() {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.pending = null;
  }
}
