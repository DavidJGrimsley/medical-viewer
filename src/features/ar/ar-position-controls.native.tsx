import { Text, View } from 'react-native';
import type { ComponentType } from 'react';
import { ARControl, type ARControlProps } from './ar-control.native';
import { ARTransformSlider } from './ar-transform-controls.native';
import { MAX_AR_HEIGHT, METRES_PER_FOOT, type ARPositionAxis } from './ar-transform';
export type { ARPositionAxis } from './ar-transform';

/** Position offsets in metres, relative to the placed object's axes. */
export function ARPositionControls({
  position,
  disabled,
  testIDPrefix,
  onChange,
  onDone,
  compact = false,
  dense = false,
  stacked = true,
  controlComponent: Control = ARControl,
  fontFamily,
  seedColor,
}: {
  position: Record<ARPositionAxis, number>;
  disabled: boolean;
  testIDPrefix: string;
  onChange: (axis: ARPositionAxis, value: number) => void;
  onDone: () => void;
  compact?: boolean;
  dense?: boolean;
  stacked?: boolean;
  controlComponent?: ComponentType<ARControlProps>;
  fontFamily?: string;
  seedColor?: string;
}) {
  const labels =
    compact || dense
      ? { x: 'Left / right', y: 'Up / down', z: 'Forward / back' }
      : { x: 'X · Left / right', y: 'Y · Up / down', z: 'Z · Forward / back' };
  return (
    <View testID={`${testIDPrefix}-position-controls`} style={{ gap: compact || dense ? 6 : 12 }}>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <View key={axis} style={{ gap: 4 }}>
          <ARTransformSlider
            compact={compact}
            dense={dense}
            labelWidth={dense ? 96 : undefined}
            fontFamily={fontFamily}
            seedColor={seedColor}
            label={labels[axis]}
            value={position[axis]}
            spokenValue={`${(position[axis] / METRES_PER_FOOT).toFixed(1)} feet`}
            min={axis === 'y' ? 0 : -MAX_AR_HEIGHT}
            max={MAX_AR_HEIGHT}
            disabled={disabled}
            stacked={stacked}
            testID={`${testIDPrefix}-position-${axis}`}
            onValueChange={(value) => onChange(axis, value)}
          />
          {!compact && !dense && (
            <Text style={{ fontSize: 14, color: '#cbd5e1' }}>
              {(position[axis] * 100).toFixed(0)} cm
            </Text>
          )}
        </View>
      ))}
      {!compact && (
        <View style={{ alignItems: 'center' }}>
          <Control
            label="Done"
            fontFamily={fontFamily}
            seedColor={seedColor}
            testID={`${testIDPrefix}-position-done`}
            onPress={onDone}
          />
        </View>
      )}
    </View>
  );
}
