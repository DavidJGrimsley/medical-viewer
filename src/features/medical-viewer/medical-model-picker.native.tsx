import { Host, Picker as UniversalPicker } from '@expo/ui';
import { useWindowDimensions, View } from 'react-native';
import { useMedicalColors } from './medical-ui';
import { MEDICAL_MODELS, type MedicalModelId } from './medical-models';
import AvailabilityPicker from './medical-model-availability';
export function MedicalModelPicker({
  selectedValue,
  onValueChange,
}: {
  selectedValue: MedicalModelId;
  onValueChange: (value: MedicalModelId) => void;
}) {
  const colors = useMedicalColors();
  const { fontScale } = useWindowDimensions();
  if (MEDICAL_MODELS.some((model) => !model.available))
    return <AvailabilityPicker selectedValue={selectedValue} onValueChange={onValueChange} />;
  return (
    <View style={{ width: 140 * fontScale, maxWidth: '100%', minHeight: 44 }}>
      <Host
        matchContents={{ vertical: true }}
        ignoreSafeArea="all"
        colorScheme="dark"
        seedColor={colors.secondary}
        style={{ width: '100%', minHeight: 44 }}>
        <UniversalPicker
          selectedValue={selectedValue}
          onValueChange={onValueChange}
          testID="medical-model-picker">
          {MEDICAL_MODELS.map((model) => (
            <UniversalPicker.Item key={model.id} label={model.label} value={model.id} />
          ))}
        </UniversalPicker>
      </Host>
    </View>
  );
}
