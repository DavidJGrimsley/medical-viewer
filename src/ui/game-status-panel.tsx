import { Text, View } from 'react-native';
import { useAppTheme } from '@/theme/provider';
import type { ARStatusPanelModel } from '@/features/ar/ar-session-types';
import { GameButton } from './game-button';
import { GameText } from './game-text';
import { GameProgress } from './game-progress';
import { useGameWindowDimensions } from './use-game-window-dimensions';

export function GameStatusPanel({
  title,
  message,
  loading,
  actions,
  selectableMessage = false,
  compact = false,
  outlinedActions = [],
}: ARStatusPanelModel & {
  selectableMessage?: boolean;
  compact?: boolean;
  outlinedActions?: readonly string[];
}) {
  const { activeColors: colors } = useAppTheme();
  const { width, fontScale } = useGameWindowDimensions();
  const fontSize = compact ? 15 : 16;
  return (
    <View
      style={{
        padding: compact ? 16 : 20,
        gap: compact ? 12 : 16,
        borderRadius: 16,
        backgroundColor: colors.surface,
      }}>
      {loading ? <GameProgress color={colors.primary} label={title} /> : null}
      <GameText color={colors.text} fontSize={22} bold accessibilityRole="header">
        {title}
      </GameText>
      {selectableMessage ? (
        <Text
          selectable
          accessibilityLiveRegion="polite"
          style={{ fontSize: 16, lineHeight: 24, color: colors.text }}>
          {message}
        </Text>
      ) : (
        <GameText color={colors.text} lineHeight={24} accessibilityLiveRegion="polite">
          {message}
        </GameText>
      )}
      <View
        testID="game-status-actions"
        style={{
          gap: compact ? 4 : 12,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {actions?.map((action) => (
          <GameButton
            key={action.label}
            label={action.label}
            color={colors.primary}
            textColor={outlinedActions.includes(action.label) ? colors.text : colors.background}
            variant={outlinedActions.includes(action.label) ? 'outlined' : 'filled'}
            compact={compact}
            singleLine={action.label === 'Back'}
            fontSize={fontSize}
            onPress={action.onPress}
            width={Math.max(
              48,
              Math.min(
                Math.ceil(
                  action.label.length *
                    fontSize *
                    fontScale *
                    (action.label === 'Back' ? 0.75 : compact ? 0.7 : 0.6)
                ) + (compact ? 24 : 32),
                width - 80,
                520
              )
            )}
          />
        ))}
      </View>
    </View>
  );
}
