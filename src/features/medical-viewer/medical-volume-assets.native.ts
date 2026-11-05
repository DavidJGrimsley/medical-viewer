import metadata from '../../../assets/medical/volumes/metadata.json';
import { MEDICAL_VOLUME_SOURCES } from '../../../assets/medical/volumes/sources.native';
import { parseMedicalVolumeDataset, VOLUME_ATLASES, type VolumeAtlas } from './medical-volumes';
import type { SliceModality } from './medical-slices';
const parsed = parseMedicalVolumeDataset(metadata);
const valid = parsed.series.every((series) =>
  VOLUME_ATLASES.every((key) => !!MEDICAL_VOLUME_SOURCES[series.modality]?.[key])
);
export const MEDICAL_VOLUME_DATASET = valid
  ? parsed
  : { ...parsed, series: [], error: 'Volume images are missing.' };
export const medicalVolumeSource = (modality: SliceModality, atlas: VolumeAtlas) =>
  MEDICAL_VOLUME_SOURCES[modality]?.[atlas];
