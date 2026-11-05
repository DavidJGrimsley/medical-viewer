import { ViroARSceneNavigator } from '@reactvision/react-viro';

import ARSmokeScene from './ar-smoke-scene.native';
import type { ARSceneContext } from './ar-session-types';

// Viro injects sceneNavigator at runtime, but its initialScene type omits that prop.
const initialScene = { scene: ARSmokeScene as () => React.JSX.Element };

export default function NativeARNavigator({ context }: { context: ARSceneContext }) {
  return (
    <ViroARSceneNavigator
      style={{ flex: 1 }}
      initialScene={initialScene}
      viroAppProps={context}
      provider="none"
      autofocus
    />
  );
}
