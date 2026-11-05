import { useState, type ComponentProps } from 'react';
import { View } from 'react-native';
import { useAppTheme } from '@/theme/provider';
import { GameARControl, GameARControlWidthContext } from '@/ui/game-ar-control';
import { ARTransformControls } from './ar-transform-controls.native';
import { ARPositionControls } from './ar-position-controls.native';
import type { ARPositionAxis } from './ar-transform';

type EditorProps = Omit<
  ComponentProps<typeof ARTransformControls>,
  'compact' | 'onPosition' | 'positionControl'
> & {
  position: Record<ARPositionAxis, number>;
  onPositionChange: (axis: ARPositionAxis, value: number) => void;
  positioning?: boolean;
  onPositioningChange?: (positioning: boolean) => void;
};

/** Every experience gets Scale, Rotate, XYZ Position, Reposition and Done. */
export function ARTransformEditor({
  position,
  onPositionChange,
  positioning,
  onPositioningChange,
  controlComponent = GameARControl,
  ...props
}: EditorProps) {
  const [localPositioning, setLocalPositioning] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const colors = useAppTheme().colors.dark;
  const seedColor = props.seedColor ?? colors.primary;
  const setPositioning = onPositioningChange ?? setLocalPositioning;
  return (
    <View
      style={{ width: '100%' }}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0) setWidth(next);
      }}>
      <GameARControlWidthContext.Provider value={width}>
        {(positioning ?? localPositioning) ? (
          <ARPositionControls
            position={position}
            disabled={props.disabled}
            testIDPrefix={props.testIDPrefix}
            dense
            stacked={props.stacked}
            fontFamily={props.fontFamily}
            seedColor={seedColor}
            controlComponent={controlComponent}
            onChange={onPositionChange}
            onDone={() => setPositioning(false)}
          />
        ) : (
          <ARTransformControls
            {...props}
            seedColor={seedColor}
            dense
            controlComponent={controlComponent}
            onPosition={() => setPositioning(true)}
          />
        )}
      </GameARControlWidthContext.Provider>
    </View>
  );
}
