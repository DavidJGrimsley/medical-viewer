export type MedicalModelId = 'skull' | 'brain' | 'half-skull' | 'both';
export type MedicalAssetId = 'skull' | 'brain' | 'half-skull';
export type Point3 = [number, number, number];
export const DEFAULT_MEDICAL_MODEL_ID: MedicalModelId = 'both';

export interface MedicalAssetTransform {
  position: Point3;
  rotation: Point3;
  scale: Point3;
}

export interface MedicalAsset {
  id: MedicalAssetId;
  label: string;
  // Null keeps a mode unavailable if a replacement is awaiting alignment.
  transform: MedicalAssetTransform | null;
}

export const MEDICAL_ASSETS: Record<MedicalAssetId, MedicalAsset> = {
  skull: {
    id: 'skull',
    label: 'Skull',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  },
  // All GLBs bake the same skull LPS-to-metres matrix. Identity child transforms
  // preserve the supplied coordinates; the parent moves the pair together.
  brain: {
    id: 'brain',
    label: 'Brain',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  },
  'half-skull': {
    id: 'half-skull',
    label: 'Half Skull',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  },
};

export const MEDICAL_MODEL_ASSETS: Record<MedicalModelId, readonly MedicalAssetId[]> = {
  skull: ['skull'],
  brain: ['brain'],
  'half-skull': ['half-skull'],
  both: ['half-skull', 'brain'],
};

export function isMedicalModelAvailable(
  id: MedicalModelId,
  isAssetAvailable: (assetId: MedicalAssetId) => boolean = (assetId) =>
    MEDICAL_ASSETS[assetId].transform !== null
) {
  return MEDICAL_MODEL_ASSETS[id].every(isAssetAvailable);
}

export const MEDICAL_MODELS = (['skull', 'brain', 'half-skull', 'both'] as const).map((id) => ({
  id,
  label: id === 'both' ? 'Both' : MEDICAL_ASSETS[id].label,
  available: isMedicalModelAvailable(id),
}));

export function hasMedicalLabels(id: MedicalModelId) {
  // The existing calibration belongs only to the full skull.
  return id === 'skull';
}
