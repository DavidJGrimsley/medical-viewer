import metadata from '../../../assets/medical/slices/metadata.json';
import { medicalSliceSources } from '../../../assets/medical/slices/sources.native';
import { parseMedicalSliceDataset } from './medical-slices';

const parsed = parseMedicalSliceDataset(metadata);
const countsMatch = parsed.series.every(
  (series) =>
    medicalSliceSources[`${series.modality}:${series.orientation}`]?.length === series.imageCount
);

export const MEDICAL_SLICE_DATASET = countsMatch
  ? parsed
  : { series: [], error: 'Scan assets do not match their metadata.' };

export function medicalSliceSource(modality: string, orientation: string, index: number) {
  return medicalSliceSources[`${modality}:${orientation}`]?.[index];
}
