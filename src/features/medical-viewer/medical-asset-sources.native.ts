import type { ImageSourcePropType } from 'react-native';
import type { MedicalAssetId } from './medical-models';

// Literal requires let Metro package the three prepared Slicer-derived binaries.
export const MEDICAL_ASSET_SOURCES: Record<MedicalAssetId, ImageSourcePropType> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  skull: require('../../../assets/medical/skull.glb'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  brain: require('../../../assets/medical/brain.glb'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'half-skull': require('../../../assets/medical/half-skull.glb'),
};
