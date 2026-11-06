import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { router } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { AppState, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/provider';

import { nativeARRuntime } from './ar-runtime.native';
import { isQuestDevice } from './quest-device';
import { questARRuntime } from './quest-runtime';
import { shouldActivateAR } from './ar-activation';
import { ARSessionController } from './ar-session-controller';
import type { ARSceneContext, ARSessionBoundaryProps } from './ar-session-types';
import ARStatusPanel from './ar-status-panel';

function subscribeAppState(listener: () => void) {
  const subscription = AppState.addEventListener('change', listener);
  return () => subscription.remove();
}

class SceneErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const NativeNavigator = lazy(() => import('./native-ar-navigator.native'));

function SceneRenderer({
  context,
  renderNavigator,
}: ARSessionBoundaryProps & { context: ARSceneContext }) {
  return renderNavigator ? (
    renderNavigator(context)
  ) : (
    <Suspense fallback={null}>
      <NativeNavigator context={context} />
    </Suspense>
  );
}

export default function ARSessionBoundary({
  renderNavigator,
  renderActiveOverlay,
  renderStatusPanel,
  activeOverlayLayout = 'panel',
  enabled: featureEnabled = true,
  keepSessionOnInactive = false,
  onExit,
  exitLabel = 'Home',
}: ARSessionBoundaryProps) {
  const { activeColors: colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const appState = useSyncExternalStore(subscribeAppState, () => AppState.currentState);
  const isQuest = isQuestDevice();
  // Quest moves the shared React host between panel and immersive activities.
  // AppState briefly reports background for that handoff; unmounting here would
  // relaunch VRActivity and create overlapping OpenXR sessions.
  const enabled = shouldActivateAR(
    featureEnabled,
    focused,
    appState,
    keepSessionOnInactive,
    isQuest
  );
  const runtime = isQuest ? questARRuntime : nativeARRuntime;
  // Quest mounts ViroXRSceneNavigator on a 2D launcher panel first and requests
  // HEADSET_CAMERA / enters OpenXR asynchronously on user action, so phone AR's
  // 25s post-mount camera startup timeout must not tear down the Quest bridge.
  const [controller] = useState(
    () =>
      new ARSessionController(runtime, undefined, undefined, {
        mountTimeoutMs: isQuest ? null : 25000,
      })
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [settingsError, setSettingsError] = useState(false);

  useEffect(() => {
    controller.setActive(enabled);
    return () => controller.setActive(false);
  }, [controller, enabled]);

  const context = useMemo<ARSceneContext>(
    () => ({
      sessionId: snapshot.sessionId,
      onReady: () => controller.reportReady(snapshot.sessionId),
      onInstruction: (instruction) => controller.reportInstruction(snapshot.sessionId, instruction),
      onError: () => controller.reportError(snapshot.sessionId),
    }),
    [controller, snapshot.sessionId]
  );

  const home = () => {
    controller.setActive(false);
    if (onExit) onExit();
    else router.dismissTo('/');
  };
  const openSettings = () => {
    setSettingsError(false);
    void Linking.openSettings().catch(() => setSettingsError(true));
  };
  const mounting = enabled && ['starting', 'running'].includes(snapshot.status);
  const loading = ['checking', 'requesting', 'waiting', 'starting'].includes(snapshot.status);
  const title = isQuest
    ? snapshot.status === 'running'
      ? 'Room space active'
      : snapshot.status === 'denied' || snapshot.status === 'permission'
        ? 'Spatial access'
        : snapshot.status === 'error'
          ? 'Mixed Reality needs another try'
          : snapshot.status === 'unsupported' || snapshot.status === 'missing-native'
            ? 'OpenXR unavailable'
            : snapshot.status === 'inactive'
              ? 'Mixed Reality paused'
              : 'Preparing Mixed Reality'
    : snapshot.status === 'running'
      ? 'Surface test'
      : snapshot.status === 'denied' || snapshot.status === 'permission'
        ? 'Camera access'
        : snapshot.status === 'error'
          ? 'AR needs another try'
          : snapshot.status === 'unsupported' || snapshot.status === 'missing-native'
            ? 'AR unavailable'
            : snapshot.status === 'inactive'
              ? 'AR paused'
              : 'Preparing AR';

  const defaultInstruction = isQuest
    ? 'Planes come from saved Space Setup in Quest Settings.'
    : 'AR starts when this screen is active.';

  const actions = [];
  if (['permission', 'denied'].includes(snapshot.status)) {
    actions.push({
      label: isQuest ? 'Grant spatial permission' : 'Enable camera',
      onPress: () => void controller.requestCamera(),
    });
    actions.push({ label: 'Open Settings', onPress: openSettings });
  }
  if (['error', 'unsupported', 'missing-native', 'running'].includes(snapshot.status)) {
    actions.push({
      label: snapshot.status === 'running' ? (isQuest ? 'Restart Session' : 'Restart AR') : 'Retry',
      onPress: controller.retry,
    });
  }
  actions.push({ label: exitLabel, onPress: home });

  const panelProps = {
    title,
    message:
      settingsError && ['permission', 'denied'].includes(snapshot.status)
        ? isQuest
          ? 'Settings could not open. Allow spatial permissions in Quest device Settings.'
          : 'Settings could not open. Allow camera access in device Settings.'
        : snapshot.instruction || defaultInstruction,
    loading,
    actions,
  };
  const panel = renderStatusPanel ? (
    renderStatusPanel(panelProps)
  ) : (
    <ARStatusPanel {...panelProps} />
  );

  const hasActiveOverlay = mounting && renderActiveOverlay && !isQuest;
  const activeOverlay = hasActiveOverlay
    ? renderActiveOverlay({
        sessionId: snapshot.sessionId,
        status: snapshot.status === 'running' ? 'running' : 'starting',
        instruction: snapshot.instruction,
        home,
        restartAR: controller.retry,
      })
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {mounting ? (
        <SceneErrorBoundary key={snapshot.sessionId} onError={context.onError}>
          <SceneRenderer context={context} renderNavigator={renderNavigator} />
        </SceneErrorBoundary>
      ) : null}
      {hasActiveOverlay && activeOverlayLayout === 'fullscreen' ? (
        activeOverlay
      ) : isQuest && mounting ? null : (
        <View pointerEvents="box-none" style={mounting ? styles.overlay : styles.fill}>
          <ScrollView
            style={mounting ? { maxHeight: '55%', flexGrow: 0 } : styles.fill}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: Math.max(20, insets.bottom),
              paddingLeft: Math.max(20, insets.left),
              paddingRight: Math.max(20, insets.right),
            }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: '100%', maxWidth: 720 }}>
                {hasActiveOverlay ? activeOverlay : panel}
              </View>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { position: 'absolute', inset: 0, justifyContent: 'flex-end' },
});
