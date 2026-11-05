import type { MedicalVolumeSnapshot } from './medical-controller.ts';
import {
  VOLUME_WIDTH_METRES,
  type MedicalVolumeDataset,
  type MedicalVolumeSeries,
} from './medical-volumes.ts';
export function volumeExtent(dataset: MedicalVolumeDataset): [number, number, number] {
  const spans = [0, 2, 4].map(
    (index) => dataset.boundsRasMm[index + 1] - dataset.boundsRasMm[index]
  );
  return spans.map((span) => (span * VOLUME_WIDTH_METRES) / Math.max(...spans)) as [
    number,
    number,
    number,
  ];
}
export function volumeUniforms(
  dataset: MedicalVolumeDataset,
  series: MedicalVolumeSeries,
  state: MedicalVolumeSnapshot
) {
  const appearance = state.appearance[state.modality];
  const normalize = (values: number[]) =>
    values.map(
      (value, axis) =>
        (value - dataset.boundsRasMm[axis * 2]) /
        (dataset.boundsRasMm[axis * 2 + 1] - dataset.boundsRasMm[axis * 2])
    );
  return {
    u_dimensions: dataset.dimensions,
    u_atlas: [...dataset.atlas.dimensions, dataset.atlas.columns, 0],
    u_tile: [...dataset.atlas.tileDimensions, dataset.atlas.gutter, 0],
    u_scalar: [series.scalarOffset, series.scalarScale, 0, dataset.spacingMm],
    u_extent: volumeExtent(dataset),
    u_crop_min: state.cropping
      ? normalize([state.crop[0], state.crop[2], state.crop[4]])
      : [0, 0, 0],
    u_crop_max: state.cropping
      ? normalize([state.crop[1], state.crop[3], state.crop[5]])
      : [1, 1, 1],
    u_appearance: [
      appearance.window,
      appearance.level,
      appearance.opacity,
      appearance.preset === 'ct-bone' ? 1 : 0,
    ],
    u_samples: state.quality === 'fast' ? 96 : 192,
    // VROImageiOS vImage conversion keeps file rows in upload order (no Y flip).
    u_flip_y: 0,
  };
}
