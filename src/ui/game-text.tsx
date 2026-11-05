import { Host, Text } from '@expo/ui';
import { Children, isValidElement, useState, type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

export function GameText({
  children,
  color = '#e2e8f0',
  fontSize = 16,
  fontFamily,
  bold = false,
  centered = false,
  lineHeight,
  accessibilityRole,
  accessibilityLiveRegion,
  style,
  testID,
}: Pick<ViewProps, 'style' | 'accessibilityRole' | 'accessibilityLiveRegion' | 'testID'> & {
  children: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  centered?: boolean;
  lineHeight?: number;
}) {
  const { fontScale } = useWindowDimensions();
  const native = Platform.OS !== 'web';
  const [contentWidth, setContentWidth] = useState(0);
  // SwiftUI custom fonts already scale. Only its fixed system size needs RN scaling.
  const scale = Platform.OS === 'ios' && !fontFamily ? fontScale : 1;
  const scaledLineHeight =
    lineHeight === undefined
      ? undefined
      : Platform.OS === 'ios' && fontFamily
        ? fontSize + Math.max(0, lineHeight - fontSize) * fontScale
        : lineHeight * scale;
  return (
    <View
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityLabel={children}
      accessibilityLiveRegion={accessibilityLiveRegion}
      testID={testID}
      style={[{ width: '100%', flexShrink: 1 }, style]}>
      <View
        // Measure inside the styled wrapper so padding and borders are excluded.
        onLayout={
          native
            ? (event) => setContentWidth(Math.max(0, event.nativeEvent.layout.width))
            : undefined
        }
        style={{ width: '100%', minHeight: native ? Math.ceil(fontSize * fontScale * 1.5) : 0 }}>
        {(!native || contentWidth > 0) && (
          <Host
            matchContents={{ vertical: true }}
            style={{ width: native ? contentWidth : '100%' }}
            ignoreSafeArea="all"
            colorScheme="dark"
            accessibilityElementsHidden={native}
            importantForAccessibility={native ? 'no-hide-descendants' : 'auto'}>
            <Text
              // SwiftUI must have a real width on its very first measurement.
              // A zero-width proposal can otherwise turn a caption into hundreds of lines.
              style={native ? { width: contentWidth } : undefined}
              textStyle={{
                color,
                fontSize: fontSize * scale,
                fontFamily,
                fontWeight: bold ? '600' : 'normal',
                textAlign: centered ? 'center' : 'left',
                lineHeight: scaledLineHeight,
              }}>
              {children}
            </Text>
          </Host>
        )}
      </View>
    </View>
  );
}

function copyText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (isValidElement<{ children?: ReactNode }>(child)) return copyText(child.props.children);
      return typeof child === 'string' || typeof child === 'number' ? String(child) : '';
    })
    .join('');
}

/** Style-compatible bridge for static game copy; selectable/fitted HUD text stays RN. */
export function GameCopy({
  children,
  style,
  accessibilityRole,
  accessibilityLiveRegion,
  testID,
}: Pick<
  TextProps,
  'children' | 'style' | 'accessibilityRole' | 'accessibilityLiveRegion' | 'testID'
>) {
  const { color, fontSize, fontFamily, fontWeight, textAlign, lineHeight, ...box } =
    StyleSheet.flatten(style) ?? {};
  return (
    <GameText
      style={box as ViewStyle}
      color={typeof color === 'string' ? color : undefined}
      fontSize={fontSize}
      fontFamily={fontFamily}
      bold={fontWeight === 'bold' || fontWeight === '600' || fontWeight === '700'}
      centered={textAlign === 'center'}
      lineHeight={lineHeight}
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion={accessibilityLiveRegion}
      testID={testID}>
      {copyText(children)}
    </GameText>
  );
}
