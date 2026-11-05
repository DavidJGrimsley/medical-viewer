import { Host, type UniversalHostProps } from '@expo/ui';
import type { HostProps } from '@expo/ui/jetpack-compose';

export function GameInputHost({ ignoreSafeArea, ...props }: UniversalHostProps) {
  // SDK 57's Android Host is Compose's Host: its keyboard-inset prop has a
  // different name. The outer KeyboardAvoidingView owns keyboard clearance.
  const androidProps: HostProps = {
    ...props,
    children: props.children,
    ignoreSafeAreaKeyboardInsets: ignoreSafeArea === 'all' || ignoreSafeArea === 'keyboard',
  };
  return <Host {...androidProps} />;
}
