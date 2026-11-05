import type { MedicalVolumeSnapshot } from './medical-controller.ts';
import type { MedicalVolumeDataset } from './medical-volumes.ts';
import { volumeExtent } from './medical-volume-uniforms.ts';

export interface StackPlane {
  filename: string;
  ijkZ: number;
  positionRasMm: number;
}
export function stackPlaneGeometry(
  dataset: MedicalVolumeDataset,
  state: MedicalVolumeSnapshot,
  planes: readonly StackPlane[]
) {
  const extent = volumeExtent(dataset);
  const crop = state.cropping ? state.crop : dataset.boundsRasMm;
  const normalized = crop.map(
    (value, i) =>
      (value - dataset.boundsRasMm[i - (i % 2)]) /
      (dataset.boundsRasMm[i - (i % 2) + 1] - dataset.boundsRasMm[i - (i % 2)])
  );
  return planes.map((plane, index) => ({
    index,
    visible: plane.positionRasMm >= crop[4] && plane.positionRasMm <= crop[5],
    width: (normalized[1] - normalized[0]) * extent[0],
    height: (normalized[3] - normalized[2]) * extent[1],
    position: [
      ((normalized[0] + normalized[1]) / 2 - 0.5) * extent[0],
      ((plane.positionRasMm - dataset.boundsRasMm[4]) /
        (dataset.boundsRasMm[5] - dataset.boundsRasMm[4]) -
        0.5) *
        extent[2],
      -((normalized[2] + normalized[3]) / 2 - 0.5) * extent[1],
    ] as [number, number, number],
    // ViroSurface maps top to v0. PNG rows increase A, so reverse v endpoints.
    uv: [normalized[0], normalized[3], normalized[1], normalized[2]],
    renderingOrder: state.stackDescending ? planes.length - index : index + 1,
    opacity: Math.min(1, state.appearance[state.modality].opacity / 2),
  }));
}
