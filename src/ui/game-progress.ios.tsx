import { Host } from '@expo/ui';
import { ProgressView } from '@expo/ui/swift-ui';
import { controlSize, frame, tint } from '@expo/ui/swift-ui/modifiers';
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
  const size = large ? 56 : 24;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ width: size, height: size }}>
      <Host matchContents colorScheme="dark" accessibilityElementsHidden>
        <ProgressView
          modifiers={[
            tint(color),
            controlSize(large ? 'large' : 'small'),
            frame({ width: size, height: size }),
          ]}
        />
      </Host>
    </View>
  );
}
