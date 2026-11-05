import { useState, type ReactNode } from 'react';
import { BottomSheet, Column, Host, RNHostView, ScrollView } from '@expo/ui';
import { frame, onGeometryChange, preferredColorScheme } from '@expo/ui/swift-ui/modifiers';
import { fillMaxHeight, fillMaxWidth, onSizeChanged } from '@expo/ui/jetpack-compose/modifiers';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameText } from '@/ui/game-text';
import { MedicalControl, MedicalWidthProvider, useMedicalColors } from './medical-ui';

/** A measured native sheet with a pinned header and a bounded scrolling body. */
export function MedicalSheet({
  title,
  subtitle,
  testID,
  isPresented,
  onDismiss,
  children,
}: {
  title: string;
  subtitle?: string;
  testID: string;
  isPresented: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const colors = useMedicalColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [sheetSize, setSheetSize] = useState({ width: 0, height: 0 });
  const [headerHeight, setHeaderHeight] = useState(64);
  const measured = Platform.OS === 'web' || sheetSize.width > 0;
  const contentWidth = Math.max(1, Math.min(width, sheetSize.width || width, 560));
  const bodyHeight = Math.max(
    64,
    (sheetSize.height ||
      Math.max(64, (Platform.OS === 'web' ? height * 0.96 : height - insets.top) - 32)) -
      headerHeight
  );
  const measure = (size: { width: number; height: number }) => {
    if (size.width <= 0 || size.height <= 0) return;
    setSheetSize((old) => (old.width === size.width && old.height === size.height ? old : size));
  };
  const layoutModifiers =
    Platform.OS === 'ios'
      ? [
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }),
          onGeometryChange(measure),
        ]
      : [fillMaxWidth(), fillMaxHeight(), onSizeChanged(measure)];
  return (
    <Host colorScheme="dark" seedColor={colors.primary} style={{ position: 'absolute' }}>
      <BottomSheet
        testID={testID}
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={['full']}
        contentPadding={0}
        containerColor={colors.surface}
        modifiers={Platform.OS === 'ios' ? [preferredColorScheme('dark')] : undefined}>
        <Column
          alignment="center"
          spacing={0}
          style={{ width: '100%' }}
          modifiers={layoutModifiers}>
          {Platform.OS === 'web' ? (
            <RNHostView style={{ width: '100%', height: 1 }}>
              <View
                style={{ width: '100%', height: 1 }}
                onLayout={(event) => {
                  const measuredWidth = event.nativeEvent.layout.width;
                  if (measuredWidth > 0)
                    setSheetSize((old) =>
                      old.width === measuredWidth ? old : { ...old, width: measuredWidth }
                    );
                }}
              />
            </RNHostView>
          ) : null}
          {measured ? (
            <>
              <RNHostView matchContents>
                <MedicalWidthProvider width={Math.max(1, contentWidth - 40)}>
                  <View
                    testID={`${testID}-header`}
                    style={[styles.header, { width: contentWidth }]}
                    onLayout={(event) => {
                      if (event.nativeEvent.layout.height > 0)
                        setHeaderHeight(event.nativeEvent.layout.height);
                    }}
                    onAccessibilityEscape={onDismiss}>
                    <View style={styles.headerCopy}>
                      <GameText accessibilityRole="header" fontSize={20} bold color={colors.text}>
                        {title}
                      </GameText>
                      {subtitle ? (
                        <GameText fontSize={14} color={colors.text}>
                          {subtitle}
                        </GameText>
                      ) : null}
                    </View>
                    <MedicalControl label="Done" testID={`${testID}-done`} onPress={onDismiss} />
                  </View>
                </MedicalWidthProvider>
              </RNHostView>
              <ScrollView
                testID={`${testID}-scroll`}
                direction="vertical"
                style={{ width: contentWidth, height: bodyHeight }}>
                <RNHostView matchContents>
                  <MedicalWidthProvider width={Math.max(1, contentWidth - 40)}>
                    <View
                      testID={`${testID}-content`}
                      style={[
                        styles.content,
                        { width: contentWidth, paddingBottom: Math.max(32, insets.bottom) },
                      ]}
                      onAccessibilityEscape={onDismiss}>
                      {children}
                    </View>
                  </MedicalWidthProvider>
                </RNHostView>
              </ScrollView>
            </>
          ) : null}
        </Column>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  content: { gap: 12, paddingHorizontal: 20, paddingTop: 8 },
});
