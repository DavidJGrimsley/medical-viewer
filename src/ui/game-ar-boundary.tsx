import { Host, RNHostView, ScrollView } from '@expo/ui';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme/provider';
import type { ARSessionBoundaryProps } from '@/features/ar/ar-session-types';
import { GameStatusPanel } from './game-status-panel';
import { useGameWindowDimensions } from './use-game-window-dimensions';

export default function GameARBoundary(_props: ARSessionBoundaryProps) {
  const { activeColors: colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useGameWindowDimensions();
  const contentWidth = Math.max(1, Math.min(720, width - 40));
  return (
    <Host
      colorScheme="dark"
      seedColor={colors.primary}
      style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView>
        <RNHostView matchContents>
          <View
            style={{
              paddingTop: 32,
              paddingBottom: Math.max(32, insets.bottom),
              width: Math.max(1, width),
              paddingHorizontal: Math.max(0, (width - contentWidth) / 2),
            }}>
            <GameStatusPanel
              title="Camera AR needs a phone"
              message="Open this app in its development build on a supported physical iPhone or Android phone."
              actions={[{ label: 'Home', onPress: () => router.dismissTo('/') }]}
            />
          </View>
        </RNHostView>
      </ScrollView>
    </Host>
  );
}
