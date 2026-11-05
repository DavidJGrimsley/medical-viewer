import { Button, Host, Text as NativeText } from '@expo/ui';
import { Platform, useWindowDimensions, View } from 'react-native';

export interface ARControlProps {
  label: string;
  accessibilityLabel?: string;
  hint?: string;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
  testID: string;
  width?: number;
  fontFamily?: string;
  seedColor?: string;
}

export function ARControl({
  label,
  accessibilityLabel = label,
  hint,
  disabled = false,
  selected,
  onPress,
  testID,
  width,
  fontFamily,
  seedColor = '#93f5c5',
}: ARControlProps) {
  const { fontScale } = useWindowDimensions();
  // Universal Button does not expose accessibility props. The RN parent is its
  // accessibility element; the native button remains the visual/touch control.
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={hint}
      accessibilityState={{ disabled, ...(selected !== undefined ? { selected } : {}) }}
      onAccessibilityTap={disabled ? undefined : onPress}
      accessibilityActions={disabled ? [] : [{ name: 'activate' }]}
      onAccessibilityAction={(event) => {
        if (!disabled && event.nativeEvent.actionName === 'activate') onPress();
      }}
      style={width ? { width } : undefined}>
      <Host
        matchContents
        colorScheme="dark"
        seedColor={seedColor}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Button
          testID={testID}
          disabled={disabled}
          variant={selected ? 'filled' : 'outlined'}
          onPress={disabled ? undefined : onPress}
          style={{
            width,
            height: Math.max(48, 17 * fontScale + 20),
            opacity: disabled ? 0.35 : 1,
          }}>
          <NativeText
            textStyle={{
              fontFamily,
              fontSize: Platform.OS === 'ios' ? 17 * fontScale : 17,
              color: selected ? '#10231c' : '#e2e8f0',
            }}>
            {label}
          </NativeText>
        </Button>
      </Host>
    </View>
  );
}
