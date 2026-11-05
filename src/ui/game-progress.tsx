import { ActivityIndicator } from 'react-native';

// Web fallback. Native files use Expo UI's platform progress components because
// SDK 57 does not yet export a universal progress indicator.
export function GameProgress({
  color,
  label,
  large = false,
}: {
  color: string;
  label: string;
  large?: boolean;
}) {
  return (
    <ActivityIndicator color={color} accessibilityLabel={label} size={large ? 'large' : 'small'} />
  );
}
