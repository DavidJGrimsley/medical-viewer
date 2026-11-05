import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GameButton } from '@/ui/game-button';
import { useGameWindowDimensions } from '@/ui/use-game-window-dimensions';
import { useAppTheme } from '@/theme/provider';
import type { ARControlProps } from '@/features/ar/ar-control.native';

const MedicalWidthContext = createContext<number | null>(null);

export function useMedicalColors() {
  // AR controls share the app's dark palette regardless of the camera image.
  return useAppTheme().colors.dark;
}

export function MedicalWidthProvider({ width, children }: { width: number; children: ReactNode }) {
  return (
    <MedicalWidthContext.Provider value={Math.max(1, width)}>
      {children}
    </MedicalWidthContext.Provider>
  );
}

export function MedicalChoiceGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const { width } = useGameWindowDimensions();
  const measuredWidth = useContext(MedicalWidthContext);
  const availableWidth = measuredWidth ?? Math.max(44, Math.min(width - 64, 520));
  return (
    <View testID={testID} style={styles.choiceGroup}>
      <MedicalWidthProvider width={availableWidth - 2 * styles.choiceGroup.padding}>
        {children}
      </MedicalWidthProvider>
    </View>
  );
}

export function MedicalControl({
  label,
  accessibilityLabel,
  hint,
  selected,
  disabled,
  onPress,
  testID,
  width,
  fontFamily,
  fontSize = 15,
  singleLine = false,
  icon,
  iconOnly = false,
}: ARControlProps & {
  icon?: ReactElement;
  iconOnly?: boolean;
  fontSize?: number;
  singleLine?: boolean;
}) {
  const colors = useMedicalColors();
  const { width: viewportWidth, fontScale } = useGameWindowDimensions();
  const measuredWidth = useContext(MedicalWidthContext);
  const availableWidth = measuredWidth ?? Math.max(44, Math.min(viewportWidth - 64, 520));
  const choice = selected !== undefined;
  const secondaryAction = label === 'Home' || /^(Reset|Restart|Reposition)/.test(label);
  const filled = choice || !secondaryAction;
  const color = choice ? (selected ? colors.secondary : colors.background) : colors.primary;
  // Keep short choices such as Anatomy intact; wrap buttons rather than their labels.
  const glyphWidth = singleLine || label.length <= 4 ? 0.7 : 0.6;
  const naturalWidth =
    Math.ceil((label.length * fontSize * glyphWidth + 4) * fontScale) +
    (Platform.OS === 'android' ? 24 : 16) +
    (filled ? 0 : 2);
  return (
    <GameButton
      label={label}
      accessibilityLabel={accessibilityLabel}
      hint={hint}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      width={iconOnly ? 44 : Math.max(44, Math.min(width ?? naturalWidth, availableWidth))}
      fontFamily={fontFamily}
      fontSize={fontSize}
      compact
      singleLine={singleLine}
      color={color}
      textColor={filled && (!choice || selected) ? colors.background : colors.text}
      variant={filled ? 'filled' : 'outlined'}
      icon={icon}
      iconOnly={iconOnly}
    />
  );
}

const styles = StyleSheet.create({
  choiceGroup: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#3f3f46',
  },
});
