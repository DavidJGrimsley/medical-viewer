import { useEffect, useState, type ReactNode } from 'react';
import { Host, Slider, Switch } from '@expo/ui';
import { accessibilityLabel, accessibilityValue, frame } from '@expo/ui/swift-ui/modifiers';
import { fillMaxWidth, height, semantics } from '@expo/ui/jetpack-compose/modifiers';
import { StyleSheet, Platform, Text, View, NativeModules, TurboModuleRegistry } from 'react-native';
import Constants from 'expo-constants';
import { version as viroJSVersion } from '@reactvision/react-viro/package.json';
import stackMetadata from '../../../assets/medical/stack/metadata.json';
import { volumeUniforms } from './medical-volume-uniforms';
import { stackPlaneGeometry } from './medical-volume-stack';
import { MedicalControl as ARControl, MedicalChoiceGroup, useMedicalColors } from './medical-ui';
import { MedicalSheet } from './medical-sheet.native';
import { GameCopy } from '@/ui/game-text';
import { ARTransformEditor } from '@/features/ar/ar-transform-editor.native';
import {
  canManipulateVolume,
  type MedicalController,
  type MedicalSnapshot,
} from './medical-controller';
import {
  VOLUME_PRESETS,
  VOLUME_DEBUG_LABELS,
  VolumeControlScheduler,
  volumeControlRanges,
  type VolumePreset,
  type VolumeDebugMode,
} from './medical-volumes';

interface ControlsProps {
  controller: MedicalController;
  state: MedicalSnapshot;
  sessionId: number;
}
function ScanSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const colors = useMedicalColors();
  const spokenValue = `${value.toFixed(1)}`;
  return (
    <View style={styles.field}>
      <Text style={[styles.readout, { fontVariant: ['tabular-nums'] }]}>
        {label}: {spokenValue}
      </Text>
      <Host
        matchContents={{ vertical: true }}
        colorScheme="dark"
        seedColor={colors.primary}
        style={{ width: '100%', minHeight: 44 }}>
        <Slider
          value={value}
          min={min}
          max={Math.max(max, min + step)}
          step={step}
          disabled={disabled || max <= min}
          onValueChange={onChange}
          testID={`medical-volume-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
          modifiers={
            Platform.OS === 'ios'
              ? [
                  frame({ minHeight: 44, maxWidth: Infinity }),
                  accessibilityLabel(label),
                  accessibilityValue(spokenValue),
                ]
              : [
                  fillMaxWidth(),
                  height(44),
                  semantics({ contentDescription: `${label}, ${spokenValue}` }),
                ]
          }
        />
      </Host>
    </View>
  );
}
function ScanToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const colors = useMedicalColors();
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme="dark"
      seedColor={colors.primary}
      style={{ minHeight: 44, width: '100%' }}>
      <Switch
        label={label}
        value={value}
        onValueChange={onChange}
        testID={`medical-volume-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      />
    </Host>
  );
}
function ScanSection({ title, children }: { title: string; children: ReactNode }) {
  const colors = useMedicalColors();
  return (
    <View
      style={[styles.section, { backgroundColor: colors.background, borderColor: colors.surface }]}>
      <GameCopy accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </GameCopy>
      {children}
    </View>
  );
}
export function MedicalVolumeSheet({ controller, state, sessionId }: ControlsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scheduler] = useState(
    () => new VolumeControlScheduler(requestAnimationFrame, cancelAnimationFrame)
  );
  const { volume } = state,
    series = controller.getVolumeSeries();
  const scope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: volume.requestId,
  };
  useEffect(
    () => () => scheduler.clear(),
    [scheduler, sessionId, state.placementRevision, volume.requestId, volume.controlsOpen]
  );
  if (!volume.controlsOpen || state.mode !== 'volume' || !series) return null;
  const appearance = volume.appearance[volume.modality],
    ranges = volumeControlRanges(series, appearance);
  const queue = (key: string, action: () => void) => scheduler.select(key, action);
  const close = () => {
    scheduler.clear();
    controller.openVolumeControls(sessionId, false);
  };
  const labels = [
    'Left boundary (mm)',
    'Right boundary (mm)',
    'Back boundary (mm)',
    'Front boundary (mm)',
    'Bottom boundary (mm)',
    'Top boundary (mm)',
  ];
  const visiblePlanes = stackPlaneGeometry(
    controller.volumeDataset,
    volume,
    stackMetadata.presets[appearance.preset].planes
  ).filter((plane) => plane.visible).length;
  return (
    <MedicalSheet
      title="Scan controls"
      subtitle={`${volume.modality.toUpperCase()} · 3D preview`}
      testID="medical-volume-sheet"
      isPresented
      onDismiss={close}>
      <ScanSection title="Appearance">
        <View style={styles.actions}>
          {(Object.keys(VOLUME_PRESETS) as VolumePreset[])
            .filter((key) => VOLUME_PRESETS[key].modality === volume.modality)
            .map((preset) => (
              <ARControl
                key={preset}
                testID={`medical-volume-preset-${preset}`}
                label={VOLUME_PRESETS[preset].label}
                selected={appearance.preset === preset}
                onPress={() => {
                  scheduler.clear();
                  controller.setVolumePreset(scope, preset);
                }}
              />
            ))}
        </View>
        {volume.renderer === 'shader' ? (
          <>
            <ScanSlider
              label="Window"
              value={appearance.window}
              min={ranges.window[0]}
              max={ranges.window[1]}
              onChange={(value) =>
                queue('window', () => controller.setVolumeAppearance(scope, 'window', value))
              }
            />
            <ScanSlider
              label="Level"
              value={appearance.level}
              min={ranges.level[0]}
              max={ranges.level[1]}
              onChange={(value) =>
                queue('level', () => controller.setVolumeAppearance(scope, 'level', value))
              }
            />
          </>
        ) : null}
        <ScanSlider
          label="Transparency %"
          value={(2 - appearance.opacity) * 50}
          min={0}
          max={100}
          onChange={(value) =>
            queue('opacity', () => controller.setVolumeAppearance(scope, 'opacity', 2 - value / 50))
          }
        />
        <Text style={styles.hint}>Lower transparency makes the tissue easier to see.</Text>
        {volume.renderer === 'shader' ? (
          <>
            <Text style={styles.heading}>Rendering quality</Text>
            <View style={styles.actions}>
              {(['balanced', 'fast'] as const).map((quality) => (
                <ARControl
                  key={quality}
                  testID={`medical-volume-quality-${quality}`}
                  label={quality === 'balanced' ? 'Balanced' : 'Fast'}
                  selected={volume.quality === quality}
                  onPress={() => controller.configureVolume(scope, { quality })}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScanSection>
      <ScanSection title="Crop the scan">
        <ScanToggle
          label="Enable cropping"
          value={volume.cropping}
          onChange={(cropping) => controller.configureVolume(scope, { cropping })}
        />
        <ScanToggle
          label="Show crop box"
          value={volume.cropBoxVisible}
          onChange={(cropBoxVisible) => controller.configureVolume(scope, { cropBoxVisible })}
        />
        {volume.cropping
          ? labels.map((label, index) => (
              <ScanSlider
                key={label}
                label={label}
                value={volume.crop[index]}
                min={
                  index % 2 === 0
                    ? controller.volumeDataset.boundsRasMm[index]
                    : volume.crop[index - 1] + controller.volumeDataset.spacingMm
                }
                max={
                  index % 2 === 0
                    ? volume.crop[index + 1] - controller.volumeDataset.spacingMm
                    : controller.volumeDataset.boundsRasMm[index]
                }
                step={controller.volumeDataset.spacingMm}
                onChange={(value) =>
                  queue(`crop${index}`, () => controller.setVolumeCrop(scope, index, value))
                }
              />
            ))
          : null}
        {volume.renderer === 'stack' && visiblePlanes === 0 ? (
          <Text accessibilityLiveRegion="polite" style={styles.warning}>
            No scan layers in this crop. Widen the bottom/top boundaries or choose Full Scan.
          </Text>
        ) : null}
        <View style={styles.actions}>
          <ARControl
            label="Full Scan"
            testID="medical-volume-reset-crop"
            onPress={() => {
              scheduler.clear();
              controller.resetVolumeCrop(sessionId);
            }}
          />
          <ARControl
            label="Reset Scan"
            testID="medical-volume-reset-scan"
            onPress={() => {
              scheduler.clear();
              controller.resetVolumeScan(sessionId);
            }}
          />
        </View>
      </ScanSection>
      <ARControl
        label="Diagnostics"
        hint={advancedOpen ? 'Hide renderer tests' : 'Show renderer tests'}
        testID="medical-volume-advanced"
        selected={advancedOpen}
        onPress={() => setAdvancedOpen(!advancedOpen)}
      />
      {advancedOpen ? (
        <ScanSection title="Renderer diagnostics">
          <Text style={styles.explanation}>
            The preview uses 48 scan layers. Full volume rendering is still being tested.
          </Text>
          <View style={styles.actions}>
            <ARControl
              testID="medical-renderer-stack"
              label="Scan layers"
              selected={volume.renderer === 'stack'}
              onPress={() => {
                scheduler.clear();
                controller.setVolumeRenderer(sessionId, 'stack');
              }}
            />
            <ARControl
              testID="medical-renderer-shader"
              label="Shader tests"
              selected={volume.renderer === 'shader'}
              onPress={() => {
                scheduler.clear();
                controller.setVolumeRenderer(sessionId, 'shader');
              }}
            />
          </View>
          {volume.renderer === 'shader' ? (
            <MedicalShaderDiagnostics controller={controller} state={state} sessionId={sessionId} />
          ) : (
            <Text style={styles.caption}>{visiblePlanes} / 48 layers in this crop.</Text>
          )}
        </ScanSection>
      ) : null}
    </MedicalSheet>
  );
}
export function MedicalVolumeControls({
  controller,
  state,
  sessionId,
  onTransform,
  onRestart,
}: ControlsProps & { onTransform: () => void; onRestart: () => void }) {
  return (
    <View style={styles.group} testID="medical-volume-controls">
      <Text style={styles.centeredBody} accessibilityLiveRegion="polite">
        {state.volume.renderer === 'stack'
          ? '3D preview · scan layers'
          : `Shader diagnostic · ${VOLUME_DEBUG_LABELS[state.volume.debugMode]} · drawing ${state.volume.magentaConfirmed ? 'magenta confirmed only' : 'unconfirmed'}`}
      </Text>
      {state.volume.loadStatus === 'error' && state.volume.diagnostics.length ? (
        <Text selectable style={styles.errorReadout}>
          {state.volume.diagnostics.at(-1)}
        </Text>
      ) : null}
      <MedicalChoiceGroup testID="medical-volume-modality-group">
        {(['mri', 'ct'] as const).map((modality) => (
          <ARControl
            key={modality}
            label={modality.toUpperCase()}
            singleLine
            selected={state.volume.modality === modality}
            disabled={!controller.getVolumeSeries(modality)}
            testID={`medical-volume-modality-${modality}`}
            onPress={() => controller.selectVolumeModality(sessionId, modality)}
          />
        ))}
      </MedicalChoiceGroup>
      <View style={styles.centeredActions}>
        <ARControl
          label="Controls"
          accessibilityLabel="Scan Controls"
          testID="medical-volume-scan-controls"
          disabled={!controller.getVolumeSeries()}
          onPress={() => controller.openVolumeControls(sessionId, true)}
        />
        <ARControl
          label="Transform"
          testID="medical-volume-transform"
          disabled={!state.anchorId}
          onPress={onTransform}
        />
        <ARControl
          label="Reset"
          accessibilityLabel="Reset Transform"
          testID="medical-volume-reset-transform"
          disabled={!state.anchorId}
          onPress={() => controller.resetVolumeTransform(sessionId)}
        />
        <ARControl label="Restart AR" testID="medical-volume-restart-ar" onPress={onRestart} />
      </View>
    </View>
  );
}
function MedicalShaderDiagnostics({ controller, state, sessionId }: ControlsProps) {
  const { volume } = state;
  const scope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: volume.requestId,
  };
  const probe = stackMetadata.probes[volume.modality];
  const manager = NativeModules.VRTMaterialManager ?? TurboModuleRegistry.get('VRTMaterialManager');
  const series = controller.getVolumeSeries()!;
  return (
    <View style={styles.group}>
      <Text
        selectable
        style={
          styles.readout
        }>{`JS Viro ${viroJSVersion} · iOS/OS ${Platform.Version}\nNative app ${Constants.nativeAppVersion ?? '?'} / build ${Constants.nativeBuildVersion ?? '?'}\nNative Viro version is not exposed. Reference EAS 839c8e3 logs show ViroReact 3.0.3; this panel cannot identify the installed binary.\nMaterial/update API: ${typeof manager?.updateShaderUniform === 'function' ? 'present' : 'missing'}\nSession ${scope.sessionId} · placement ${scope.placementRevision} · request ${scope.requestId}\nAtlas loads: ${JSON.stringify(volume.atlasLoads)}`}</Text>
      <Text style={styles.warning}>
        First close this sheet and inspect the proxy: it must be bright magenta. Asset loading or
        queued materials do not confirm drawing. A white/blank box means stop and return to Stacked
        slices.
      </Text>
      <ARControl
        testID="medical-confirm-magenta"
        label="I see magenta"
        disabled={volume.debugMode !== 'magenta' || volume.loadStatus !== 'ready'}
        selected={volume.magentaConfirmed}
        onPress={() => controller.confirmVolumeMagenta(scope)}
      />
      <View style={styles.actions}>
        {(Object.keys(VOLUME_DEBUG_LABELS) as VolumeDebugMode[]).map((mode) => (
          <ARControl
            key={mode}
            testID={`medical-diagnostic-${mode}`}
            label={VOLUME_DEBUG_LABELS[mode]}
            selected={mode === volume.debugMode}
            disabled={mode !== 'magenta' && !volume.magentaConfirmed}
            onPress={() => controller.setVolumeDebugMode(scope, mode)}
          />
        ))}
      </View>
      <Text
        selectable
        style={
          styles.readout
        }>{`Known atlas IJK ${probe.ijk.join(', ')} · UV ${probe.uv.map((v) => v.toFixed(6)).join(', ')}\nExpected alpha bytes: high ${probe.alphaBytes.high}, low ${probe.alphaBytes.low}, validity ${probe.alphaBytes.validity}\nByte tests: magenta edge; sampled half should match reference half. The invalid-texel band should be black in all byte tests. Validity has two matching white bands.\nCoordinates: R/A/S RGB gradient, camera-origin strip changes while walking.\nUniforms: green left, normalized crop minima RGB right; bottom strip responds to window. Ray: green/cyan intersections; magenta misses. Opacity: grayscale accumulated alpha.\nSubmitted uniforms: ${JSON.stringify(volumeUniforms(controller.volumeDataset, series, volume))}`}</Text>
      <Text selectable style={styles.warning}>
        {volume.diagnostics.join('\n') || 'No diagnostic events yet.'}
      </Text>
      <Text style={styles.caption}>
        Viro 3.0.3 does not forward all core GLSL compilation errors to JavaScript. Native system
        logs are still needed if the proxy fails. Node errors and JS material/update exceptions
        appear above.
      </Text>
    </View>
  );
}
export function MedicalVolumeTransformControls({
  controller,
  state,
  sessionId,
  stacked,
  onDone,
}: ControlsProps & { stacked: boolean; onDone: () => void }) {
  const colors = useMedicalColors();
  const scope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: state.volume.requestId,
  };
  return (
    <ARTransformEditor
      key={`${scope.sessionId}:${scope.placementRevision}:${scope.requestId}`}
      position={{ x: state.volume.x, y: state.volume.height, z: state.volume.z }}
      onPositionChange={(axis, value) => controller.setVolumePosition(scope, axis, value)}
      seedColor={colors.primary}
      controlComponent={ARControl}
      {...state.volume}
      disabled={!canManipulateVolume(state)}
      repositionDisabled={!state.anchorId}
      testIDPrefix="medical-volume"
      stacked={stacked}
      onDone={onDone}
      onScaleChange={(value) => controller.setVolumeTransform(scope, 'scale', value)}
      onYawChange={(value) => controller.setVolumeTransform(scope, 'yaw', value)}
      onHeightChange={(value) => controller.setVolumeTransform(scope, 'height', value)}
      onReposition={() => controller.reposition(sessionId)}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 2,
  },
  readout: {
    fontSize: 14,
    color: '#e2e8f0',
  },
  section: {
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f8fafc',
  },
  caption: {
    fontSize: 14,
    color: '#cbd5e1',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: '#cbd5e1',
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f8fafc',
  },
  warning: {
    fontSize: 16,
    color: '#fde68a',
  },
  explanation: {
    fontSize: 16,
    lineHeight: 24,
    color: '#cbd5e1',
  },
  group: {
    gap: 6,
  },
  centeredBody: {
    textAlign: 'center',
    fontSize: 16,
    color: '#e2e8f0',
  },
  errorReadout: {
    textAlign: 'center',
    fontSize: 14,
    color: '#fde68a',
  },
  centeredActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
});
