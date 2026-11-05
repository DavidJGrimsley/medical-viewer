import { createContext, useContext } from 'react';
import { Platform } from 'react-native';
import type { ARControlProps } from '@/features/ar/ar-control.native';
import { useAppTheme } from '@/theme/provider';
import { GameButton } from './game-button';
import { useGameWindowDimensions } from './use-game-window-dimensions';

export const GameARControlWidthContext = createContext<number | null>(null);

/** Compact themed actions for the shared AR transform editor. */
export function GameARControl({
  label,
  onPress,
  disabled,
  testID,
  accessibilityLabel,
  hint,
  fontFamily,
  seedColor,
  width,
}: ARControlProps) {
  const colors = useAppTheme().colors.dark;
  const { width: viewportWidth, fontScale } = useGameWindowDimensions();
  const measuredWidth = useContext(GameARControlWidthContext);
  const outlined = label === 'Reposition';
  const padding = Platform.OS === 'android' ? 24 : 16;
  const naturalWidth =
    Math.ceil((label.length * 15 * (label.length <= 4 ? 0.7 : 0.6) + 4) * fontScale) +
    padding +
    (outlined ? 2 : 0);
  return (
    <GameButton
      label={label}
      accessibilityLabel={accessibilityLabel}
      hint={hint}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      fontFamily={fontFamily}
      fontSize={15}
      compact
      color={seedColor ?? colors.primary}
      textColor={outlined ? colors.text : colors.background}
      variant={outlined ? 'outlined' : 'filled'}
      width={Math.max(
        44,
        Math.min(width ?? naturalWidth, measuredWidth ?? Math.max(44, viewportWidth - 80))
      )}
    />
  );
}
