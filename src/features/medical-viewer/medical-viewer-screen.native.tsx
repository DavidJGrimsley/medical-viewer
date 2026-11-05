import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Platform, useWindowDimensions, View } from 'react-native';
import { GameCopy as Text } from '@/ui/game-text';
import { GameProgress } from '@/ui/game-progress';
import { Stack } from 'expo-router/stack';
import ARSessionBoundary from '@/features/ar/ar-session-boundary';
import type { ARActiveOverlayContext } from '@/features/ar/ar-session-types';
import {
  canManipulateMedical,
  MedicalController,
  medicalStatus,
  type MedicalSnapshot,
} from './medical-controller';
import {
  MedicalControl as ARControl,
  MedicalChoiceGroup,
  MedicalWidthProvider,
  useMedicalColors,
} from './medical-ui';
import { MedicalInfoButton, MedicalInfoModal } from './medical-info.native';
import { MedicalModelPicker } from './medical-model-picker.native';
import { MedicalTransformControls } from './medical-transform-controls.native';
import { hasMedicalLabels } from './medical-models';
import { MEDICAL_SLICE_DATASET } from './medical-slice-assets.native';
import { MEDICAL_VOLUME_DATASET } from './medical-volume-assets.native';
import {
  MedicalVolumeControls,
  MedicalVolumeSheet,
  MedicalVolumeTransformControls,
} from './medical-volume-controls.native';
import {
  MedicalPanelTransformControls,
  MedicalSliceControls,
} from './medical-slice-controls.native';

import { router } from 'expo-router';
import { isQuestDevice } from '@/features/ar/quest-device';

const MedicalNavigator = lazy(() => import('./medical-navigator.native'));
const QuestMedicalNavigator = lazy(() => import('./quest-medical-navigator.native'));

function MedicalStatus({ state }: { state: MedicalSnapshot }) {
  const colors = useMedicalColors();
  const status = medicalStatus(state);
  const loading =
    state.mode === 'volume'
      ? ['loading', 'binding'].includes(state.volume.loadStatus)
      : state.mode === 'slices'
        ? state.slices.loadStatus === 'loading'
        : state.loadStatus === 'loading';
  const failed =
    state.mode === 'volume'
      ? ['error', 'missing', 'unsupported'].includes(state.volume.loadStatus)
      : state.mode === 'slices'
        ? ['error', 'missing'].includes(state.slices.loadStatus)
        : state.loadStatus === 'error';
  if (!status) return null;
  return (
    <View style={styles.statusRow}>
      {loading || state.tracking === 'initializing' ? (
        <GameProgress color={colors.primary} label={status} />
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.status, { color: failed ? '#fde68a' : '#e2e8f0' }]}>
        {status}
      </Text>
    </View>
  );
}

function MedicalMainControls({
  context,
  controller,
  state,
  onTransform,
  onRestart,
}: {
  context: ARActiveOverlayContext;
  controller: MedicalController;
  state: MedicalSnapshot;
  stacked: boolean;
  onTransform: () => void;
  onRestart: () => void;
}) {
  return (
    <>
      <View style={styles.controlRow}>
        <MedicalModelPicker
          selectedValue={state.modelId}
          onValueChange={(model) => controller.selectModel(context.sessionId, model)}
        />
        <ARControl
          label="Transform"
          disabled={!state.anchorId}
          testID="medical-transform"
          onPress={onTransform}
        />
      </View>
      <View style={styles.controlRow}>
        <ARControl
          label="Labels"
          selected={state.labelsVisible}
          disabled={!canManipulateMedical(state) || !hasMedicalLabels(state.modelId)}
          accessibilityLabel={state.labelsVisible ? 'Hide anatomy labels' : 'Show anatomy labels'}
          testID="medical-labels"
          onPress={() => controller.toggleLabels(context.sessionId)}
        />
        <ARControl label="Restart AR" testID="medical-restart-ar" onPress={onRestart} />
      </View>
    </>
  );
}

function MedicalRepresentationControls({
  context,
  controller,
  state,
  stacked,
  transformOpen,
  onTransform,
  onDone,
  onRestart,
}: {
  context: ARActiveOverlayContext;
  controller: MedicalController;
  state: MedicalSnapshot;
  stacked: boolean;
  transformOpen: boolean;
  onTransform: () => void;
  onDone: () => void;
  onRestart: () => void;
}) {
  if (state.mode === 'volume')
    return transformOpen ? (
      <MedicalVolumeTransformControls
        controller={controller}
        state={state}
        sessionId={context.sessionId}
        stacked={stacked}
        onDone={onDone}
      />
    ) : (
      <MedicalVolumeControls
        controller={controller}
        state={state}
        sessionId={context.sessionId}
        onTransform={onTransform}
        onRestart={onRestart}
      />
    );
  if (state.mode === 'slices')
    return transformOpen ? (
      <MedicalPanelTransformControls
        controller={controller}
        state={state}
        sessionId={context.sessionId}
        stacked={stacked}
        onDone={onDone}
      />
    ) : (
      <MedicalSliceControls
        controller={controller}
        state={state}
        sessionId={context.sessionId}
        stacked={stacked}
        onTransform={onTransform}
      />
    );
  return transformOpen ? (
    <MedicalTransformControls
      controller={controller}
      state={state}
      scope={{
        sessionId: context.sessionId,
        modelId: state.modelId,
        placementRevision: state.placementRevision,
        loadAttempt: state.loadAttempt,
      }}
      stacked={stacked}
      onDone={onDone}
    />
  ) : (
    <MedicalMainControls
      context={context}
      controller={controller}
      state={state}
      stacked={stacked}
      onTransform={onTransform}
      onRestart={onRestart}
    />
  );
}

export function MedicalControls({
  context,
  controller,
}: {
  context: ARActiveOverlayContext;
  controller: MedicalController;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const colors = useMedicalColors();
  const { width, fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [transformRevision, setTransformRevision] = useState<number | null>(null);
  const availableWidth = Math.max(
    1,
    measuredWidth ? measuredWidth - 24 : Math.min(width - 40, 560) - 24
  );
  const stacked = fontScale > 1.3 || availableWidth < 230;
  const restart = () => {
    if (controller.getSessionId() !== context.sessionId) return;
    controller.restart(context.sessionId);
    context.restartAR();
  };
  return (
    <MedicalWidthProvider width={availableWidth}>
      <View
        testID="medical-controls"
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
        style={[styles.panel, { backgroundColor: colors.surface }]}>
        <MedicalStatus state={state} />
        <MedicalChoiceGroup testID="medical-mode-group">
          <ARControl
            label="Anatomy"
            fontSize={14}
            singleLine
            accessibilityLabel="3D Anatomy"
            selected={state.mode === 'anatomy'}
            testID="medical-mode-anatomy"
            onPress={() => {
              setTransformRevision(null);
              controller.selectViewerMode(context.sessionId, 'anatomy');
            }}
          />
          <ARControl
            label="Slices"
            fontSize={14}
            singleLine
            accessibilityLabel="Scan Slices"
            selected={state.mode === 'slices'}
            testID="medical-mode-slices"
            onPress={() => {
              setTransformRevision(null);
              controller.selectViewerMode(context.sessionId, 'slices');
            }}
          />
          <ARControl
            label="3D Scan"
            fontSize={14}
            singleLine
            selected={state.mode === 'volume'}
            testID="medical-mode-volume"
            onPress={() => {
              setTransformRevision(null);
              controller.selectViewerMode(context.sessionId, 'volume');
            }}
          />
        </MedicalChoiceGroup>
        {(state.mode === 'volume'
          ? state.volume.loadStatus
          : state.mode === 'anatomy'
            ? state.loadStatus
            : state.slices.loadStatus) === 'error' ? (
          <View style={styles.centered}>
            <ARControl
              label="Retry"
              testID="medical-load-retry"
              onPress={() =>
                state.mode === 'volume'
                  ? controller.retryVolumeLoad(context.sessionId)
                  : state.mode === 'anatomy'
                    ? controller.retryLoad(context.sessionId)
                    : controller.retrySliceLoad(context.sessionId)
              }
            />
          </View>
        ) : null}
        <MedicalRepresentationControls
          context={context}
          controller={controller}
          state={state}
          stacked={stacked}
          transformOpen={transformRevision === state.placementRevision && !!state.anchorId}
          onTransform={() => setTransformRevision(state.placementRevision)}
          onDone={() => setTransformRevision(null)}
          onRestart={restart}
        />
        <MedicalVolumeSheet controller={controller} state={state} sessionId={context.sessionId} />
      </View>
    </MedicalWidthProvider>
  );
}

export default function MedicalViewerScreen() {
  const isQuest = isQuestDevice();
  const [controller] = useState(
    () =>
      new MedicalController(undefined, MEDICAL_SLICE_DATASET, MEDICAL_VOLUME_DATASET, {
        defaultVolumeRenderer: isQuest ? 'shader' : 'stack',
      })
  );
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <>
      <Stack.Screen
        options={{
          headerBackButtonDisplayMode: 'minimal',
          headerRight: () =>
            Platform.OS === 'ios' ? null : <MedicalInfoButton onPress={() => setInfoOpen(true)} />,
        }}
      />
      {Platform.OS === 'ios' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="info.circle"
            accessibilityLabel="About the Medical Viewer"
            hidesSharedBackground
            onPress={() => setInfoOpen(true)}
          />
        </Stack.Toolbar>
      ) : null}
      <ARSessionBoundary
        renderNavigator={(context) => (
          <Suspense fallback={null}>
            {isQuest ? (
              <QuestMedicalNavigator
                context={context}
                controller={controller}
                onExit={() => router.dismissTo('/')}
              />
            ) : (
              <MedicalNavigator context={context} controller={controller} />
            )}
          </Suspense>
        )}
        renderActiveOverlay={
          isQuest
            ? undefined
            : (context) => (
                <MedicalControls
                  key={context.sessionId}
                  context={context}
                  controller={controller}
                />
              )
        }
      />
      <MedicalInfoModal isPresented={infoOpen} onDismiss={() => setInfoOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  status: {
    flexShrink: 1,
    textAlign: 'center',
    fontSize: 16,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  panel: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 8,
    borderRadius: 16,
    padding: 12,
  },
  centered: {
    alignItems: 'center',
  },
});
