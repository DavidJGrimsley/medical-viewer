import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/provider';

import ARStatusPanel from './ar-status-panel';
import type { ARSessionBoundaryProps } from './ar-session-types';

export default function ARSessionBoundary(_props: ARSessionBoundaryProps) {
  const { activeColors: colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingTop: 32,
        paddingBottom: Math.max(32, insets.bottom),
      }}
      style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ width: '100%', maxWidth: 720 }}>
        <ARStatusPanel
          title="Camera AR needs a phone"
          message="Open this app in its development build on a supported physical iPhone or Android phone."
          actions={[{ label: 'Home', onPress: () => router.dismissTo('/') }]}
        />
      </View>
    </ScrollView>
  );
}
