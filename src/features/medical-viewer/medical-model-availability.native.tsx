import { useState } from 'react';
import { Button, Host, Text as NativeText } from '@expo/ui';
import { Picker, Text as SwiftUIText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  disabled,
  fixedSize,
  frame,
  pickerStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { DropdownMenu, DropdownMenuItem } from '@expo/ui/jetpack-compose';
import { semantics } from '@expo/ui/jetpack-compose/modifiers';
import { Platform, useWindowDimensions } from 'react-native';
import { useMedicalColors } from './medical-ui';
import { MEDICAL_MODELS, type MedicalModelId } from './medical-models';

export default function AvailabilityPicker({
  selectedValue,
  onValueChange,
}: {
  selectedValue: MedicalModelId;
  onValueChange: (value: MedicalModelId) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { fontScale } = useWindowDimensions();
  const colors = useMedicalColors();
  const selected = MEDICAL_MODELS.find((model) => model.id === selectedValue)!;
  return (
    <Host matchContents colorScheme="dark" seedColor={colors.secondary}>
      {/* Universal Picker lacks disabled items; native menus preserve asset availability. */}
      {Platform.OS === 'ios' ? (
        <Picker
          testID="medical-model-picker"
          selection={selectedValue}
          onSelectionChange={onValueChange}
          modifiers={[
            pickerStyle('menu'),
            fixedSize({ horizontal: true, vertical: false }),
            frame({ minHeight: Math.max(48, 17 * fontScale + 20) }),
            accessibilityLabel('Model'),
          ]}>
          {MEDICAL_MODELS.map((model) => (
            <SwiftUIText key={model.id} modifiers={[tag(model.id), disabled(!model.available)]}>
              {model.available ? model.label : `${model.label} (unavailable)`}
            </SwiftUIText>
          ))}
        </Picker>
      ) : (
        <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
          <DropdownMenu.Trigger>
            <Button
              testID="medical-model-picker"
              variant="text"
              onPress={() => setExpanded(true)}
              style={{ height: Math.max(48, 17 * fontScale + 20) }}
              modifiers={[semantics({ contentDescription: `Model, ${selected.label}` })]}>
              <NativeText textStyle={{ fontSize: 17, color: colors.secondary }}>
                {`${selected.label} ▾`}
              </NativeText>
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Items>
            {MEDICAL_MODELS.map((model) => (
              <DropdownMenuItem
                key={model.id}
                enabled={model.available}
                onClick={
                  model.available
                    ? () => {
                        onValueChange(model.id);
                        setExpanded(false);
                      }
                    : undefined
                }>
                <DropdownMenuItem.Text>
                  <NativeText>
                    {model.available ? model.label : `${model.label} (unavailable)`}
                  </NativeText>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            ))}
          </DropdownMenu.Items>
        </DropdownMenu>
      )}
    </Host>
  );
}
