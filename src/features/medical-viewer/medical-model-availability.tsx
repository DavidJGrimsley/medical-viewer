import { Host, Picker } from '@expo/ui';
import { View } from 'react-native';
import { useMedicalColors } from './medical-ui';
import { MEDICAL_MODELS, type MedicalModelId } from './medical-models';

// The web menu includes only available assets; native menus show disabled entries.
export default function AvailabilityPicker({
  selectedValue,
  onValueChange,
}: {
  selectedValue: MedicalModelId;
  onValueChange: (value: MedicalModelId) => void;
}) {
  const colors = useMedicalColors();
  return (
    <View style={{ width: 192, maxWidth: '100%', minHeight: 48 }}>
      <Host
        matchContents={{ vertical: true }}
        colorScheme="dark"
        seedColor={colors.secondary}
        style={{ width: 192, minHeight: 48 }}>
        <Picker
          selectedValue={selectedValue}
          onValueChange={onValueChange}
          testID="medical-model-picker">
          {MEDICAL_MODELS.filter((model) => model.available).map((model) => (
            <Picker.Item key={model.id} label={model.label} value={model.id} />
          ))}
        </Picker>
      </Host>
    </View>
  );
}
