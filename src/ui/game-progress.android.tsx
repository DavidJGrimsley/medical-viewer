import { Host } from '@expo/ui';
import { CircularProgressIndicator } from '@expo/ui/jetpack-compose';
import { size } from '@expo/ui/jetpack-compose/modifiers';
import { View } from 'react-native';

export function GameProgress({
  color,
  label,
  large = false,
}: {
  color: string;
  label: string;
  large?: boolean;
}) {
  const diameter = large ? 56 : 24;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ width: diameter, height: diameter }}>
      <Host matchContents colorScheme="dark" importantForAccessibility="no-hide-descendants">
        <CircularProgressIndicator color={color} modifiers={[size(diameter, diameter)]} />
      </Host>
    </View>
  );
}
