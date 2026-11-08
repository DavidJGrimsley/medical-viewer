import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ViroXRSceneNavigator } from '@reactvision/react-viro';
import type { ARSceneContext } from '@/features/ar/ar-session-types';
import { questSessionBridge } from '@/features/ar/quest-session-bridge';
import { GameButton as Button } from '@/ui/game-button';
import { useAppTheme } from '@/theme/provider';
import type { MedicalController } from './medical-controller';
import QuestMedicalScene, { hasActiveQuestSceneMount } from './quest-medical-scene.native';
import { hasQuestCompositor } from './quest-compositor-bridge';

export interface QuestMedicalNavigatorProps {
  context: ARSceneContext;
  controller: MedicalController;
  onExit?: () => void;
}

export default function QuestMedicalNavigator({
  context,
  controller,
  onExit,
}: QuestMedicalNavigatorProps) {
  const { activeColors: colors } = useAppTheme();
  const [showSetupGuidance, setShowSetupGuidance] = useState(false);
  const [uiLayer, setUiLayer] = useState<'viro' | 'compositor'>(() =>
    hasQuestCompositor() ? 'compositor' : 'viro'
  );

  // Register session with the bridge so QuestMedicalScene inside VRActivity can access it
  useEffect(() => {
    questSessionBridge.registerSession({
      sessionId: context.sessionId,
      context,
      controller,
      uiLayer,
    });

    return () => {
      questSessionBridge.clearSession(context.sessionId);
    };
  }, [context, controller, uiLayer]);

  return (
    <ViroXRSceneNavigator
      style={styles.fill}
      vrInitialScene={{ scene: QuestMedicalScene as () => React.JSX.Element }}
      passthroughEnabled={true}
      handTrackingEnabled={true}
      hdrEnabled={false}
      bloomEnabled={false}
      vrModeEnabled={true}
      onExitViro={() => {
        if (!hasActiveQuestSceneMount(context.sessionId)) {
          controller.detach(context.sessionId);
        }
      }}
      renderQuestPanel={(enter) => (
        <View style={[styles.panelContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.panelCard, { backgroundColor: colors.surface }]}>
            <Text style={styles.title}>Medical Viewer</Text>
            <Text style={styles.subtitle}>Meta Quest 3 & 3S Mixed Reality</Text>

            <Text style={styles.body}>
              Explore 3D Anatomy, registered CT/MRI Scan Slices, and interactive 3D Scan Volumes
              with passthrough and tracked hands or Touch controllers.
            </Text>

            <View style={styles.guidanceBox}>
              <Text style={styles.guidanceTitle}>Placement & Space Setup</Text>
              <Text style={styles.guidanceText}>
                Use Place In Front on the spatial console to place specimens immediately anywhere in
                passthrough, or tap a detected Space Setup surface:
              </Text>
              <Text style={styles.guidanceStep}>Settings → Physical Space → Space Setup</Text>
            </View>

            {showSetupGuidance ? (
              <View style={styles.setupDetails}>
                <Text style={styles.detailText}>
                  • Controller rays (trigger click) and Hand tracking (pinch click) share the same
                  actions.
                </Text>
                <Text style={styles.detailText}>
                  • Use Place In Front or tap a highlighted surface to place models; drag the white
                  bar to move the console.
                </Text>
                <Text style={styles.detailText}>
                  • The control panel stays stationary in your room once opened.
                </Text>
              </View>
            ) : null}

            <View style={styles.actionRow}>
              {hasQuestCompositor() ? (
                <Button
                  variant="outlined"
                  color={colors.primary}
                  textColor={colors.primary}
                  label={uiLayer === 'compositor' ? 'UI: Headset layer' : 'UI: Original controls'}
                  onPress={() =>
                    setUiLayer((current) => (current === 'compositor' ? 'viro' : 'compositor'))
                  }
                />
              ) : null}
              <Button
                variant="filled"
                color={colors.primary}
                textColor="#ffffff"
                onPress={enter}
                label="Enter Immersive View"
                accessibilityLabel="Enter Immersive View on Meta Quest"
              />
              <Button
                variant="outlined"
                color={colors.primary}
                textColor={colors.primary}
                onPress={() => setShowSetupGuidance(!showSetupGuidance)}
                label={showSetupGuidance ? 'Hide Guidance' : 'Space Setup Help'}
              />
              {onExit ? (
                <Button
                  variant="outlined"
                  color="#94a3b8"
                  textColor="#cbd5e1"
                  onPress={onExit}
                  label="Exit"
                />
              ) : null}
            </View>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  panelContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  panelCard: {
    width: '100%',
    maxWidth: 620,
    borderRadius: 20,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#38bdf8',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#e2e8f0',
    textAlign: 'center',
  },
  guidanceBox: {
    backgroundColor: '#1e293b88',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  guidanceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fde68a',
  },
  guidanceText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#cbd5e1',
  },
  guidanceStep: {
    fontSize: 13,
    fontWeight: '600',
    color: '#38bdf8',
  },
  setupDetails: {
    backgroundColor: '#0f172a88',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94a3b8',
  },
  actionRow: {
    flexDirection: 'column',
    gap: 10,
    marginTop: 8,
  },
});
