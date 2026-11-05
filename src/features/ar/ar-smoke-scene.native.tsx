import { useRef } from 'react';
import {
  ViroARPlaneSelector,
  ViroARScene,
  ViroBox,
  ViroMaterials,
  ViroTrackingStateConstants,
} from '@reactvision/react-viro';

import type { ARSceneContext } from './ar-session-types';

ViroMaterials.createMaterials({
  xrSurfaceTest: { diffuseColor: '#00c7ff', lightingModel: 'Constant' },
});

export default function ARSmokeScene({
  sceneNavigator,
}: {
  sceneNavigator: { viroAppProps: ARSceneContext };
}) {
  const selector = useRef<ViroARPlaneSelector>(null);
  const selectedPlane = useRef<string | null>(null);
  const context = sceneNavigator.viroAppProps;

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesHorizontal']}
      toneMappingEnabled={false}
      onAnchorFound={(anchor) => selector.current?.handleAnchorFound(anchor)}
      onAnchorUpdated={(anchor) => selector.current?.handleAnchorUpdated(anchor)}
      onAnchorRemoved={(anchor) => {
        if (anchor) selector.current?.handleAnchorRemoved(anchor);
      }}
      onError={context.onError}
      onTrackingUpdated={(state) => {
        if (state === ViroTrackingStateConstants.TRACKING_NORMAL) {
          context.onReady();
          context.onInstruction(
            selectedPlane.current
              ? 'Test marker placed. Restart AR to choose another surface.'
              : 'Move slowly, then tap a highlighted table or floor to place the test marker.'
          );
        } else {
          context.onInstruction('Tracking is limited. Move slowly in a well-lit space.');
        }
      }}>
      <ViroARPlaneSelector
        ref={selector}
        alignment="Horizontal"
        minWidth={0.2}
        minHeight={0.2}
        onPlaneSelected={(plane) => {
          selectedPlane.current = plane.anchorId;
          context.onInstruction('Test marker placed. Restart AR to choose another surface.');
        }}
        onPlaneRemoved={(anchorId) => {
          if (selectedPlane.current !== anchorId) return;
          selectedPlane.current = null;
          context.onInstruction('Surface lost. Scan and tap another highlighted surface.');
        }}>
        <ViroBox
          position={[0, 0.05, 0]}
          width={0.1}
          height={0.1}
          length={0.1}
          materials={['xrSurfaceTest']}
        />
      </ViroARPlaneSelector>
    </ViroARScene>
  );
}
