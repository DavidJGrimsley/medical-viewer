import { useEffect, useState } from 'react';
import { Host, Slider } from '@expo/ui';
import { accessibilityLabel, accessibilityValue, frame } from '@expo/ui/swift-ui/modifiers';
import { fillMaxWidth, height, semantics } from '@expo/ui/jetpack-compose/modifiers';
import { StyleSheet, Platform, Text, View } from 'react-native';
import { MedicalControl as ARControl, MedicalChoiceGroup, useMedicalColors } from './medical-ui';
import { ARTransformEditor } from '@/features/ar/ar-transform-editor.native';
import {
  canManipulateSlices,
  type MedicalController,
  type MedicalSnapshot,
} from './medical-controller';
import { SliceSelectionScheduler } from './medical-slices';

export function MedicalSliceControls({
  controller,
  state,
  sessionId,
  onTransform,
}: {
  controller: MedicalController;
  state: MedicalSnapshot;
  sessionId: number;
  stacked: boolean;
  onTransform: () => void;
}) {
  const colors = useMedicalColors();
  const [scheduler] = useState(
    () => new SliceSelectionScheduler(requestAnimationFrame, cancelAnimationFrame)
  );
  const { slices } = state;
  const series = controller.getSliceSeries();
  const scope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: slices.requestId,
  };
  useEffect(
    () => () => scheduler.clear(),
    [scheduler, sessionId, slices.modality, slices.orientation, state.placementRevision]
  );
  return (
    <View style={styles.group} testID="medical-slice-controls">
      <MedicalChoiceGroup testID="medical-slice-modality-group">
        {(['mri', 'ct'] as const).map((modality) => (
          <ARControl
            key={modality}
            label={modality.toUpperCase()}
            singleLine
            selected={slices.modality === modality}
            disabled={!controller.getSliceSeries(modality)}
            testID={`medical-modality-${modality}`}
            onPress={() => {
              scheduler.clear();
              controller.selectModality(sessionId, modality);
            }}
          />
        ))}
      </MedicalChoiceGroup>
      {series ? (
        <>
          <Text
            selectable

            style={[styles.centeredBody, { fontVariant: ['tabular-nums'] }]}>
            Slice {slices.index + 1} / {series.imageCount} ·{' '}
            {series.slices[slices.index].positionMm.toFixed(1)} mm (RAS S)
          </Text>
          <Host
            matchContents={{ vertical: true }}
            colorScheme="dark"
            seedColor={colors.primary}
            style={{ minHeight: 44, width: '100%' }}>
            <Slider
              testID="medical-slice-slider"
              value={slices.index}
              min={0}
              max={Math.max(1, series.imageCount - 1)}
              step={1}
              disabled={series.imageCount <= 1}
              onValueChange={(index) =>
                scheduler.schedule(() => controller.selectSlice(scope, index))
              }
              modifiers={
                Platform.OS === 'ios'
                  ? [
                      frame({ minHeight: 44, maxWidth: Infinity }),
                      accessibilityLabel('Scan slice'),
                      accessibilityValue(`${slices.index + 1} of ${series.imageCount}`),
                    ]
                  : [
                      fillMaxWidth(),
                      height(44),
                      semantics({
                        contentDescription: `Scan slice ${slices.index + 1} of ${series.imageCount}`,
                      }),
                    ]
              }
            />
          </Host>
          <View style={styles.controlRow}>
            <ARControl
              label="Previous"
              disabled={slices.index === 0}
              testID="medical-slice-previous"
              onPress={() => {
                scheduler.clear();
                controller.selectSlice(scope, slices.index - 1);
              }}
            />
            <ARControl
              label="Next"
              disabled={slices.index === series.imageCount - 1}
              testID="medical-slice-next"
              onPress={() => {
                scheduler.clear();
                controller.selectSlice(scope, slices.index + 1);
              }}
            />
            <ARControl
              label="Reset"
              accessibilityLabel="Reset Slice"
              testID="medical-slice-reset"
              onPress={() => {
                scheduler.clear();
                controller.resetSlice(sessionId);
              }}
            />
          </View>
        </>
      ) : null}
      <View style={styles.controlRow}>
        <ARControl
          label="Transform"
          disabled={!canManipulateSlices(state)}
          testID="medical-panel-transform"
          onPress={onTransform}
        />
        <ARControl
          label="Reset Panel"
          disabled={!state.anchorId}
          testID="medical-panel-reset"
          onPress={() => controller.resetPanel(sessionId)}
        />
      </View>
      <Text style={styles.centeredCaption}>
        Axial view · Patient right at image left · Anterior at top
      </Text>
    </View>
  );
}

export function MedicalPanelTransformControls({
  controller,
  state,
  sessionId,
  stacked,
  onDone,
}: {
  controller: MedicalController;
  state: MedicalSnapshot;
  sessionId: number;
  stacked: boolean;
  onDone: () => void;
}) {
  const colors = useMedicalColors();
  const scope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: state.slices.requestId,
  };
  return (
    <ARTransformEditor
      key={`${scope.sessionId}:${scope.placementRevision}:${scope.requestId}`}
      position={{ x: state.slices.x, y: state.slices.height, z: state.slices.z }}
      onPositionChange={(axis, value) => controller.setPanelPosition(scope, axis, value)}
      seedColor={colors.primary}
      controlComponent={ARControl}
      testIDPrefix="medical-panel"
      scale={state.slices.scale}
      yaw={state.slices.yaw}
      height={state.slices.height}
      pinching={state.slices.pinching}
      rotating={state.slices.rotating}
      disabled={!canManipulateSlices(state)}
      repositionDisabled={!state.anchorId}
      stacked={stacked}
      onScaleChange={(value) => controller.setPanelTransform(scope, 'scale', value)}
      onYawChange={(value) => controller.setPanelTransform(scope, 'yaw', value)}
      onHeightChange={(value) => controller.setPanelTransform(scope, 'height', value)}
      onReposition={() => controller.reposition(sessionId)}
      onDone={onDone}
    />
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 6,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  centeredBody: {
    textAlign: 'center',
    fontSize: 16,
    color: '#e2e8f0',
  },
  centeredCaption: {
    textAlign: 'center',
    fontSize: 14,
    color: '#cbd5e1',
  },
});
