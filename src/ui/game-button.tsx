import { Button, Host, Icon, RNHostView, Row, Text } from '@expo/ui';
import type { ComponentProps, ReactElement } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';

export interface GameButtonProps {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  color: string;
  textColor: string;
  fontFamily?: string;
  fontSize?: number;
  disabled?: boolean;
  selected?: boolean;
  hint?: string;
  icon?: ReactElement;
  nativeIcon?: ComponentProps<typeof Icon>['name'];
  iconOnly?: boolean;
  compact?: boolean;
  singleLine?: boolean;
  testID?: string;
  width?: number;
  variant?: 'filled' | 'outlined' | 'text';
}

/** One native button API for the home screen and both games. */
export function GameButton({
  label,
  accessibilityLabel = label,
  onPress,
  color,
  textColor,
  fontFamily,
  fontSize = 16,
  disabled = false,
  selected,
  hint,
  icon,
  nativeIcon,
  iconOnly = false,
  compact = false,
  singleLine = false,
  testID,
  width,
  variant = 'filled',
}: GameButtonProps) {
  const { fontScale } = useWindowDimensions();
  const borderWidth = variant === 'outlined' ? 1 : 0;
  const minimumSize = compact ? 44 : 48;
  const horizontalPadding = compact ? (Platform.OS === 'android' ? 12 : 8) : 16;
  const minimumOuterSize = minimumSize + (compact ? 2 * borderWidth : 0);
  const hasIcon = !!(nativeIcon || icon);
  const iconSize = iconOnly ? 24 : 20;
  const buttonWidth = iconOnly
    ? minimumOuterSize
    : compact && width !== undefined
      ? Math.max(minimumOuterSize, width)
      : width;
  const labelWidth =
    buttonWidth !== undefined
      ? Math.max(1, buttonWidth - 2 * horizontalPadding - 2 * borderWidth - (hasIcon ? 30 : 0))
      : undefined;
  const lines =
    labelWidth && !iconOnly && !singleLine
      ? Math.max(1, Math.ceil((label.length * fontSize * fontScale * 0.6) / labelWidth))
      : 1;
  const height = Math.max(
    minimumOuterSize,
    Math.ceil(fontSize * fontScale * lines * 1.2) + (compact ? 16 : 24)
  );
  const activate = disabled ? undefined : onPress;
  const nativeAccessibility = Platform.OS !== 'web';
  // SDK 57's universal Button has no accessibility label/state props. Group the
  // native control in an accessible RN element, while retaining the web button.
  return (
    <View
      accessible={nativeAccessibility}
      accessibilityRole={nativeAccessibility ? 'button' : undefined}
      accessibilityLabel={nativeAccessibility ? accessibilityLabel : undefined}
      accessibilityHint={nativeAccessibility ? hint : undefined}
      accessibilityState={
        nativeAccessibility
          ? { disabled, ...(selected !== undefined ? { selected } : {}) }
          : undefined
      }
      onAccessibilityTap={nativeAccessibility ? activate : undefined}
      accessibilityActions={
        nativeAccessibility ? (disabled ? [] : [{ name: 'activate' }]) : undefined
      }
      onAccessibilityAction={
        nativeAccessibility
          ? (event) => {
              if (event.nativeEvent.actionName === 'activate') activate?.();
            }
          : undefined
      }
      style={{
        minWidth: minimumOuterSize,
        minHeight: height,
        borderWidth,
        borderColor: color,
        borderRadius: 12,
        ...(buttonWidth !== undefined ? { width: buttonWidth } : {}),
      }}>
      <Host
        matchContents
        ignoreSafeArea="all"
        colorScheme="dark"
        seedColor={color}
        // Propose the button's width to native layout instead of squeezing its label.
        style={buttonWidth !== undefined ? { width: buttonWidth - 2 * borderWidth } : undefined}
        accessibilityElementsHidden={Platform.OS !== 'web'}
        importantForAccessibility={Platform.OS === 'web' ? 'auto' : 'no-hide-descendants'}>
        <Button
          testID={testID}
          disabled={disabled}
          onPress={activate}
          variant="text"
          style={{
            height: height - 2 * borderWidth,
            width: buttonWidth !== undefined ? buttonWidth - 2 * borderWidth : undefined,
            // Compose TextButton adds its own 12dp horizontal content padding.
            paddingHorizontal: iconOnly
              ? 0
              : Platform.OS === 'android'
                ? Math.max(0, horizontalPadding - 12)
                : horizontalPadding,
            borderRadius: 12,
            backgroundColor: variant === 'filled' ? color : 'transparent',
            opacity: disabled ? 0.45 : 1,
          }}>
          <Row
            spacing={iconOnly ? 0 : 6}
            alignment="center"
            style={{ height: height - 2 * borderWidth }}>
            {nativeIcon ? (
              <Icon
                name={nativeIcon}
                size={iconSize}
                color={textColor}
                style={{ width: iconSize, height: iconSize }}
              />
            ) : icon ? (
              <RNHostView matchContents>
                <View
                  style={{
                    minWidth: iconSize,
                    minHeight: iconSize,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  {icon}
                </View>
              </RNHostView>
            ) : null}
            {(!iconOnly || Platform.OS === 'web') && (
              <Text
                numberOfLines={singleLine ? 1 : undefined}
                // Keep an accessible name for icon-only buttons on web.
                style={
                  iconOnly
                    ? { width: 0, height: 0, opacity: 0 }
                    : labelWidth
                      ? { width: labelWidth }
                      : undefined
                }
                textStyle={{
                  fontFamily,
                  // SwiftUI custom fonts scale natively; explicit system sizes do not.
                  fontSize: Platform.OS === 'ios' && !fontFamily ? fontSize * fontScale : fontSize,
                  fontWeight: '600',
                  color: textColor,
                  textAlign: 'center',
                }}>
                {label}
              </Text>
            )}
          </Row>
        </Button>
      </Host>
    </View>
  );
}
