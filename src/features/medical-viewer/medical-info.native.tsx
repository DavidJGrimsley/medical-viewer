import { Link } from 'expo-router';
import { StyleSheet, Pressable, Text as SelectableText } from 'react-native';
import { GameCopy as Text } from '@/ui/game-text';
import { GameButton } from '@/ui/game-button';
import { MedicalSheet } from './medical-sheet.native';
import { useMedicalColors } from './medical-ui';
import Svg, { Circle, Line } from 'react-native-svg';
import { useAppTheme } from '@/theme/provider';
import provenance from '../../../assets/medical/skull-provenance.json';

export function MedicalInfoButton({ onPress }: { onPress: () => void }) {
  const { activeColors: colors } = useAppTheme();
  return (
    <GameButton
      label="About the Medical Viewer"
      testID="medical-info"
      onPress={onPress}
      color={colors.primary}
      textColor={colors.primary}
      variant="text"
      iconOnly
      compact
      icon={
        <Svg width={26} height={26} viewBox="0 0 26 26" accessible={false}>
          <Circle cx={13} cy={13} r={11} fill="none" stroke={colors.primary} strokeWidth={1.8} />
          <Circle cx={13} cy={8} r={1.2} fill={colors.primary} />
          <Line
            x1={13}
            y1={12}
            x2={13}
            y2={18}
            stroke={colors.primary}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      }
    />
  );
}

export function MedicalInfoModal({
  isPresented,
  onDismiss,
}: {
  isPresented: boolean;
  onDismiss: () => void;
}) {
  const colors = useMedicalColors();
  return (
    <MedicalSheet
      title="Medical Viewer"
      testID="medical-info-modal"
      isPresented={isPresented}
      onDismiss={onDismiss}>
      <Text style={styles.body}>
        Move your phone slowly, then tap a highlighted table or floor. The model starts floating two
        feet above that surface. Pinch to resize it and twist two fingers to rotate it. Labels
        reveals the anatomy markers in Skull mode.
      </Text>
      <Text style={styles.body}>
        Transform opens Scale, Rotate, and Position. Scale ranges from half to three times the
        original size. Position moves left/right and forward/back up to five feet from the placed
        surface, and up/down from surface level to five feet above it. Its Done returns to
        Transform; Transform’s Done returns to the main controls.
      </Text>
      <Text style={styles.body}>
        Reposition, inside Transform, lets you choose another surface while keeping your size,
        rotation, height, and labels. Restart AR starts fresh tracking with the original size and
        orientation, floating two feet above the surface.
      </Text>
      <Text style={styles.body}>
        Choose Skull, Brain, Half Skull, or Both from the dropdown. Both is the default. Changing
        modes keeps your surface, size, rotation, and height. Both moves both models together. Its
        controls become ready only after both models finish loading.
      </Text>
      <Text style={styles.body}>
        Scan Slices shows real axial MRI and CT images on an upright panel. Drag the slice slider or
        use Previous and Next. Switching MRI and CT keeps the nearest physical slice position. Reset
        Slice returns to the middle; Reset Panel restores its size, rotation, and two-foot height.
        The panel and 3D Anatomy keep separate transforms.
      </Text>
      <Text style={styles.body}>
        Images use radiological orientation: patient right is at image left, and anterior is at the
        top. Slice positions are millimetres in the scan RAS coordinate frame. The floating panel is
        a separate view and does not intersect or align with the meshes.
      </Text>
      <Text style={styles.body}>
        3D Scan starts with a preview of the full MRI, made from 48 transparent scan images stacked
        into a head shape. Fine layers can be visible, especially from the side. This is a temporary
        way to show the scan while full volume rendering is being tested. Scan Controls offers
        appearance presets, transparency, and crop boundaries. Lower transparency makes tissue more
        visible. Full Scan restores all crop boundaries; Reset Scan restores the selected scan’s
        appearance and full extent. All three views keep their own size, rotation, and height.
      </Text>
      <Text style={styles.body}>
        The skull and half-skull come from CT segmentation, and the brain from an MRI mask exported
        in 3D Slicer. The models were simplified for mobile viewing while preserving their shared
        coordinates. Both displays the half-skull and brain together. Labels are available only in
        Skull mode.
      </Text>
      <SelectableText selectable style={styles.body}>
        {provenance.attribution}
      </SelectableText>
      <Link href={provenance.collectionReadme as `https://${string}`} asChild>
        <Pressable
          accessibilityRole="link"
          style={({ pressed }) => [styles.link, { opacity: pressed ? 0.5 : 1 }]}>
          <Text style={[styles.linkLabel, { color: colors.primary }]}>
            NLM Additional Head Images ↗
          </Text>
        </Pressable>
      </Link>
      <Text style={styles.body}>
        Educational visualization only. The segmentation and labels are not clinically validated and
        must not be used for diagnosis or treatment.
      </Text>
    </MedicalSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#e2e8f0',
  },
  link: {
    minHeight: 48,
    justifyContent: 'center',
  },
  linkLabel: {
    fontSize: 16,
    color: '#a7f3d0',
  },
});
