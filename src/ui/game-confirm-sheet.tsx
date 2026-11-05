import { BottomSheet, Column, Host, RNHostView, ScrollView, Text } from '@expo/ui';
import { Platform, useWindowDimensions } from 'react-native';
import { GameButton } from './game-button';

export function GameConfirmSheet({
  isPresented,
  onDismiss,
  onConfirm,
}: {
  isPresented: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const contentWidth = Math.max(1, Math.min(width - 48, 500));
  const textScale = Platform.OS === 'ios' ? fontScale : 1;
  return (
    <Host colorScheme="dark" seedColor="#93f5c5" style={{ position: 'absolute' }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={['half', 'full']}
        containerColor="#10191f"
        testID="qubit-reset-confirmation">
        <ScrollView>
          <Column
            spacing={16}
            alignment="center"
            style={{ width: contentWidth, paddingVertical: 24 }}>
            <Text textStyle={{ fontSize: 22 * textScale, fontWeight: '600', color: '#f8fafc' }}>
              Submission interrupted
            </Text>
            <Text textStyle={{ fontSize: 16 * textScale, color: '#cbd5e1', textAlign: 'center' }}>
              The service did not confirm the job. It may still run. Start a new round?
            </Text>
            <RNHostView matchContents>
              <GameButton
                testID="qubit-reset-wait"
                label="Wait"
                color="#93f5c5"
                textColor="#e2e8f0"
                variant="outlined"
                width={contentWidth}
                onPress={onDismiss}
              />
            </RNHostView>
            <RNHostView matchContents>
              <GameButton
                testID="qubit-reset-confirm"
                label="Reset Qubit"
                color="#93f5c5"
                textColor="#10231c"
                width={contentWidth}
                onPress={onConfirm}
              />
            </RNHostView>
          </Column>
        </ScrollView>
      </BottomSheet>
    </Host>
  );
}
