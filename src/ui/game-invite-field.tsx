import { TextInput, useNativeState, type TextInputRef } from '@expo/ui';
import { useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { GameInputHost } from './game-input-host';

export function GameInviteField({
  value,
  onChange,
  onSubmit,
  maxLength,
  color,
  backgroundColor,
  fontFamily,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  maxLength: number;
  color: string;
  backgroundColor: string;
  fontFamily: string;
  width?: number;
}) {
  const text = useNativeState(value);
  const field = useRef<TextInputRef>(null);
  const lastEdit = useRef(value);
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const fieldWidth = Math.max(1, Math.min(320, width ?? Math.max(180, viewportWidth - 64)));
  useEffect(() => {
    // External changes include deep links and scanning an invitation.
    // Never echo a delayed JS typing event back over newer native keystrokes.
    if (lastEdit.current !== value) {
      lastEdit.current = value;
      text.set(value);
    }
  }, [text, value]);
  return (
    <View style={{ width: fieldWidth }}>
      <GameInputHost
        style={{ width: fieldWidth }}
        matchContents={{ vertical: true }}
        ignoreSafeArea="all"
        colorScheme="dark"
        seedColor={color}>
        <TextInput
          ref={field}
          testID="arena-invite-code"
          value={text}
          onChangeText={(current) => {
            lastEdit.current = current;
            onChange(current);
          }}
          onSubmitEditing={(current) => {
            field.current?.blur();
            onSubmit(current);
          }}
          placeholder="Invite code"
          placeholderTextColor="#9ca3af"
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="join"
          maxLength={maxLength}
          textAlign="center"
          cursorColor={color}
          style={{
            width: fieldWidth,
            backgroundColor,
            height: Math.max(56, 24 * fontScale + 24),
            padding: 10,
            borderRadius: 12,
          }}
          // Both SwiftUI custom fonts and Compose sp follow the user's text size.
          textStyle={{ color, fontFamily, fontSize: 24 }}
        />
      </GameInputHost>
    </View>
  );
}
