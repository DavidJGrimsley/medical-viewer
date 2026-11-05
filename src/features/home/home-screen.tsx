import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { experiences, showcase } from '@/features/experiences/experience-catalog';
import { useAppTheme } from '@/theme/provider';
import { GameButton } from '@/ui/game-button';
import { GameText } from '@/ui/game-text';
import { useGameWindowDimensions } from '@/ui/use-game-window-dimensions';

export default function HomeScreen() {
  const { activeColors: colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useGameWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const contentWidth =
    measuredWidth ??
    Math.max(1, Math.min(720, width - Math.max(20, insets.left) - Math.max(20, insets.right)));
  return (
    // Keep controls in the RN scroll viewport so visual and touch bounds share
    // one layout during rotation. Each Expo UI control owns its own Host here.
    <ScrollView
      testID="home-scroll"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        alignItems: 'center',
        paddingLeft: Math.max(20, insets.left),
        paddingRight: Math.max(20, insets.right),
        paddingTop: 32,
        paddingBottom: Math.max(32, insets.bottom),
      }}>
      <View
        testID="home-content"
        onLayout={(event) => {
          const current = event.nativeEvent.layout.width;
          if (current > 0) setMeasuredWidth(current);
        }}
        style={{
          width: '100%',
          maxWidth: 720,
          gap: 28,
        }}>
        <View style={{ gap: 12 }}>
          <GameText accessibilityRole="header" color={colors.text} fontSize={30} bold>
            {showcase.name}
          </GameText>
          <GameText color={colors.text} fontSize={16} lineHeight={24}>
            {showcase.description}
          </GameText>
        </View>
        <View style={{ gap: 16 }}>
          {experiences.map((experience) => (
            <GameButton
              key={experience.route}
              testID={`home-${experience.route}`}
              label={experience.title}
              hint={`Open ${experience.title}`}
              color={colors.primary}
              textColor={colors.background}
              fontSize={20}
              width={contentWidth}
              onPress={() => router.navigate(experience.href)}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
