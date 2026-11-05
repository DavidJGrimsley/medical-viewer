import { useEffect, useSyncExternalStore } from 'react';
import { ViroARSceneNavigator } from '@reactvision/react-viro';
import MedicalScene, { type MedicalSceneProps } from './medical-scene.native';

// Viro injects sceneNavigator into the initial scene at runtime.
const initialScene = { scene: MedicalScene as () => React.JSX.Element };

export default function MedicalNavigator({ context, controller }: MedicalSceneProps) {
  const sessionId = useSyncExternalStore(controller.subscribe, controller.getSessionId);
  useEffect(() => {
    controller.attach(context.sessionId);
    return () => controller.detach(context.sessionId);
  }, [context.sessionId, controller]);
  if (sessionId !== context.sessionId) return null;
  return (
    <ViroARSceneNavigator
      style={{ flex: 1 }}
      provider="none"
      autofocus
      initialScene={initialScene}
      viroAppProps={{ context, controller }}
    />
  );
}
