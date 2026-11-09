import {
  canManipulateMedical,
  canManipulateSlices,
  canManipulateVolume,
  medicalStatus,
  type MedicalController,
  type MedicalSnapshot,
} from './medical-controller.ts';
import { MEDICAL_MODELS, hasMedicalLabels } from './medical-models.ts';
import { QUEST_ANATOMY_HEIGHT } from './quest-default-heights.ts';
import {
  DEFAULT_AR_HEIGHT,
  MIN_AR_SCALE,
  MAX_AR_SCALE,
  MIN_AR_HEIGHT,
  MAX_AR_HEIGHT,
} from '../ar/ar-transform.ts';
import {
  panelGeometry,
  rotationSliderValue,
  QUEST_PANEL_SIDEBAR_X,
  QUEST_PANEL_SIDEBAR_WIDTH,
} from './quest-compositor-layout.ts';

export type QuestPanelPage = 'main' | 'appearance' | 'diagnostics';
export interface QuestPanelItem {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font?: number;
  selected?: boolean;
  disabled?: boolean;
  fill?: string;
  color?: string;
  action?: () => void;
}
export interface QuestPanelSlider {
  id: string;
  x: number;
  y: number;
  width: number;
  min: number;
  max: number;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}
interface PanelOptions {
  controller: MedicalController;
  snapshot?: MedicalSnapshot;
  sessionId: number;
  page: QuestPanelPage;
  setPage: (page: QuestPanelPage) => void;
  diagnosticsEnabled: boolean;
  onRecenter: () => void;
  slicePreview?: number | null;
  onPlaceInFront?: () => void;
  onExit?: () => void;
}

export function buildQuestCompositorPanel(options: PanelOptions) {
  const { controller, sessionId, setPage, onPlaceInFront } = options;
  const state = options.snapshot ?? controller.getSnapshot();
  const page = !state.anchorId || state.mode !== 'volume' ? 'main' : options.page;
  const height = state.anchorId ? 680 : 625;
  const geometry = panelGeometry(height);
  const items: QuestPanelItem[] = [];
  const sliders: QuestPanelSlider[] = [];
  const scope = {
    sessionId,
    modelId: state.modelId,
    placementRevision: state.placementRevision,
    loadAttempt: state.loadAttempt,
  };
  const sliceScope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: state.slices.requestId,
  };
  const volumeScope = {
    sessionId,
    placementRevision: state.placementRevision,
    requestId: state.volume.requestId,
  };
  const transform =
    state.mode === 'anatomy' ? state : state.mode === 'slices' ? state.slices : state.volume;
  const canTransform =
    state.mode === 'anatomy'
      ? canManipulateMedical(state)
      : state.mode === 'slices'
        ? canManipulateSlices(state)
        : canManipulateVolume(state);
  const text = (id: string, label: string, y: number, font = 26, x = 500, width = 940) =>
    items.push({ id, label, x, y, width, height: 42, font });
  const button = (
    id: string,
    label: string,
    x: number,
    y: number,
    width: number,
    action: () => void,
    selected = false,
    disabled = false,
    buttonHeight = 62
  ) => items.push({ id, label, x, y, width, height: buttonHeight, action, selected, disabled });
  const changeTransform = (axis: 'scale' | 'height' | 'yaw', value: number) => {
    if (state.mode === 'anatomy') {
      if (axis === 'scale') controller.setScale(scope, value);
      else if (axis === 'height') controller.setHeight(scope, value);
      else controller.setYaw(scope, value);
    } else if (state.mode === 'slices') controller.setPanelTransform(sliceScope, axis, value);
    else controller.setVolumeTransform(volumeScope, axis, value);
  };
  const resetTransform = () => {
    if (state.mode === 'anatomy') {
      controller.setScale(scope, 1);
      controller.setHeight(scope, controller.isQuest ? QUEST_ANATOMY_HEIGHT : DEFAULT_AR_HEIGHT);
      controller.setYaw(scope, 0);
    } else if (state.mode === 'slices') controller.resetPanel(sessionId);
    else controller.resetVolumeTransform(sessionId);
  };
  const stepper = (
    id: string,
    label: string,
    y: number,
    minus: () => void,
    plus: () => void,
    lower = false,
    upper = false,
    minusLabel = '−',
    plusLabel = '+'
  ) => {
    text(`${id}-value`, label, y, 26, 500, 340);
    button(`${id}-minus`, minusLabel, 180, y, 260, minus, false, lower);
    button(`${id}-plus`, plusLabel, 820, y, 260, plus, false, upper);
  };
  const slider = (
    id: string,
    label: string,
    y: number,
    min: number,
    max: number,
    value: number,
    onChange: (value: number) => void,
    disabled: boolean
  ) => {
    const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
    sliders.push({ id, x: 80, y, width: 840, min, max, value, onChange, disabled });
    text(`${id}-value`, label, y - 38);
    items.push({
      id: `${id}-track`,
      label: '',
      x: 500,
      y,
      width: 840,
      height: 12,
      fill: '#334155',
    });
    items.push({
      id: `${id}-fill`,
      label: '',
      x: 80 + Math.max(12, 840 * t) / 2,
      y,
      width: Math.max(12, 840 * t),
      height: 12,
      fill: disabled ? '#475569' : '#0ea5e9',
    });
    items.push({
      id: `${id}-thumb`,
      label: '',
      x: 80 + t * 840,
      y,
      width: 42,
      height: 44,
      fill: disabled ? '#64748b' : '#7dd3fc',
    });
  };

  text(
    'title',
    page === 'main'
      ? 'Medical Viewer'
      : page === 'appearance'
        ? 'Appearance & detail'
        : 'Developer diagnostics',
    40,
    34
  );
  text(
    'status',
    state.anchorId ? medicalStatus(state) || 'Ready' : 'Place in front to begin',
    88,
    23
  );
  if (!state.anchorId) {
    button(
      'place',
      'Place in front',
      500,
      265,
      700,
      () => {
        setPage('main');
        onPlaceInFront?.();
      },
      false,
      !onPlaceInFront || state.tracking !== 'normal'
    );
  } else {
    (['anatomy', 'slices', 'volume'] as const).forEach((mode, index) =>
      button(
        mode,
        ['Anatomy', 'Scan slices', '3D scan'][index],
        175 + index * 325,
        153,
        300,
        () => {
          controller.selectViewerMode(sessionId, mode);
          setPage('main');
        },
        state.mode === mode
      )
    );
    if (page === 'main') {
      if (state.mode === 'anatomy') {
        MEDICAL_MODELS.forEach((model, index) =>
          button(
            model.id,
            model.label,
            137 + index * 242,
            230,
            220,
            () => controller.selectModel(sessionId, model.id),
            state.modelId === model.id,
            !model.available
          )
        );
      } else {
        (['ct', 'mri'] as const).forEach((modality, index) =>
          button(
            modality,
            modality.toUpperCase(),
            340 + index * 320,
            230,
            290,
            () =>
              state.mode === 'slices'
                ? controller.selectModality(sessionId, modality)
                : controller.selectVolumeModality(sessionId, modality),
            (state.mode === 'slices' ? state.slices : state.volume).modality === modality
          )
        );
      }
      stepper(
        'scale',
        `Size ${transform.scale.toFixed(2)}×`,
        state.mode === 'volume' ? 320 : 305,
        () => changeTransform('scale', transform.scale - 0.1),
        () => changeTransform('scale', transform.scale + 0.1),
        !canTransform || transform.scale <= MIN_AR_SCALE,
        !canTransform || transform.scale >= MAX_AR_SCALE
      );
      stepper(
        'height',
        `Height ${Math.round(transform.height * 100)} cm`,
        state.mode === 'volume' ? 410 : 380,
        () => changeTransform('height', transform.height - 0.05),
        () => changeTransform('height', transform.height + 0.05),
        !canTransform || transform.height <= MIN_AR_HEIGHT,
        !canTransform || transform.height >= MAX_AR_HEIGHT,
        'Lower',
        'Raise'
      );
      if (state.mode !== 'slices')
        slider(
          'rotation',
          `Rotation ${Math.round(transform.yaw)}°`,
          state.mode === 'volume'
            ? state.volume.loadStatus === 'error' ||
              state.volume.renderer !== 'shader' ||
              state.volume.debugMode !== 'raymarch'
              ? 525
              : 545
            : 490,
          -180,
          180,
          transform.yaw,
          (value) => changeTransform('yaw', rotationSliderValue(value)),
          !canTransform
        );
      if (state.mode === 'anatomy') {
        if (state.loadStatus !== 'error')
          button(
            'labels',
            `Labels: ${state.labelsVisible ? 'on' : 'off'}`,
            500,
            570,
            900,
            () => controller.toggleLabels(sessionId),
            state.labelsVisible,
            !canManipulateMedical(state) || !hasMedicalLabels(state.modelId)
          );
        if (state.loadStatus === 'error')
          button(
            'retry-anatomy',
            'Retry loading anatomy',
            500,
            570,
            900,
            () => controller.retryLoad(sessionId),
            false,
            false,
            50
          );
      } else if (state.mode === 'slices') {
        const count = controller.getSliceSeries()?.imageCount ?? 0;
        slider(
          'slice',
          `Slice ${Math.round(options.slicePreview ?? state.slices.index) + 1} of ${count}`,
          490,
          0,
          Math.max(0, count - 1),
          options.slicePreview ?? state.slices.index,
          (value) => {
            const current = controller.getSnapshot();
            controller.selectSlice(
              {
                sessionId,
                placementRevision: current.placementRevision,
                requestId: current.slices.requestId,
              },
              Math.round(value)
            );
          },
          count < 2
        );
        [-5, -1, 1, 5].forEach((step, index) =>
          button(
            `slice-step-${step}`,
            ['−5', 'Previous', 'Next', '+5'][index],
            137 + index * 242,
            570,
            220,
            () => controller.selectSlice(sliceScope, state.slices.index + step),
            false,
            step < 0 ? state.slices.index <= 0 : state.slices.index >= count - 1,
            50
          )
        );
      } else {
        if (state.volume.renderer !== 'shader' || state.volume.debugMode !== 'raymarch')
          button(
            'normal-volume',
            'Return to 3D scan',
            500,
            590,
            900,
            () => controller.showVolumeAnatomy(sessionId),
            false,
            false,
            50
          );
        else if (state.volume.loadStatus === 'error')
          button(
            'retry-volume',
            'Retry loading volume',
            500,
            590,
            900,
            () => controller.retryVolumeLoad(sessionId),
            false,
            false,
            50
          );
      }
    } else if (page === 'appearance') {
      (['balanced', 'fast'] as const).forEach((quality, index) =>
        button(
          quality,
          quality === 'balanced' ? 'Balanced detail' : 'Fast rendering',
          255 + index * 490,
          240,
          440,
          () => controller.configureVolume(volumeScope, { quality }),
          state.volume.quality === quality
        )
      );
      if (state.volume.modality === 'ct')
        (['ct-soft-tissue', 'ct-bone'] as const).forEach((preset, index) =>
          button(
            preset,
            preset === 'ct-bone' ? 'Bone' : 'Soft tissue',
            255 + index * 490,
            340,
            440,
            () => controller.setVolumePreset(volumeScope, preset),
            state.volume.appearance.ct.preset === preset
          )
        );
      else text('mri-preset', 'T1 grayscale', 340);
      const opacity = state.volume.appearance[state.volume.modality].opacity;
      stepper(
        'visibility',
        `Visibility ${Math.round(opacity * 50)}%`,
        440,
        () => controller.setVolumeAppearance(volumeScope, 'opacity', opacity - 0.2),
        () => controller.setVolumeAppearance(volumeScope, 'opacity', opacity + 0.2),
        opacity <= 0,
        opacity >= 2
      );
      button('reset-appearance', 'Reset appearance', 500, 510, 900, () =>
        controller.resetVolumeAppearance(sessionId)
      );
      if (state.volume.loadStatus === 'error')
        button(
          'retry-volume',
          'Retry loading volume',
          options.diagnosticsEnabled ? 255 : 500,
          585,
          options.diagnosticsEnabled ? 440 : 900,
          () => controller.retryVolumeLoad(sessionId)
        );
      if (options.diagnosticsEnabled)
        button(
          'open-diagnostics',
          'Diagnostics',
          state.volume.loadStatus === 'error' ? 745 : 500,
          585,
          state.volume.loadStatus === 'error' ? 440 : 900,
          () => setPage('diagnostics')
        );
    } else if (page === 'diagnostics' && options.diagnosticsEnabled) {
      button(
        'raymarch-renderer',
        'Raymarch',
        255,
        240,
        440,
        () => controller.setVolumeRenderer(sessionId, 'shader'),
        state.volume.renderer === 'shader'
      );
      button(
        'stack-unavailable',
        'Stacked slices unavailable',
        745,
        240,
        440,
        () => {},
        false,
        true
      );
      (['magenta', 'samplers', 'uniforms', 'coordinates', 'ray', 'opacity'] as const).forEach(
        (mode, index) =>
          button(
            `diagnostic-${mode}`,
            ['Magenta', '3-sampler', 'Uniforms', 'Coordinates', 'Ray', 'Opacity'][index],
            175 + (index % 3) * 325,
            index < 3 ? 340 : 440,
            300,
            () => controller.setVolumeDebugMode(volumeScope, mode),
            state.volume.debugMode === mode
          )
      );
      button('normal-volume', 'Return to 3D scan', 500, 540, 900, () => {
        controller.showVolumeAnatomy(sessionId);
        setPage('main');
      });
    }
  }
  // The secondary panel shares the compositor texture, with a transparent gap
  // between it and the primary controls. Its top stays aligned with the main panel.
  const sidebarX = QUEST_PANEL_SIDEBAR_X + QUEST_PANEL_SIDEBAR_WIDTH / 2;
  const sidebarWidth = QUEST_PANEL_SIDEBAR_WIDTH - 40;
  const actions: [string, string, () => void, boolean][] = [];
  if (state.anchorId) {
    actions.push(['reset-transform', 'Reset view', resetTransform, !canTransform]);
    actions.push([
      'reposition',
      'Reposition',
      () => {
        setPage('main');
        controller.reposition(sessionId);
      },
      false,
    ]);
    if (state.mode === 'slices')
      actions.push(
        state.slices.loadStatus === 'error'
          ? ['retry-slice', 'Retry slice', () => controller.retrySliceLoad(sessionId), false]
          : ['reset-slice', 'Reset slice', () => controller.resetSlice(sessionId), false]
      );
    if (state.mode === 'volume')
      actions.push([
        'navigation',
        page === 'main' ? 'More controls' : 'Back',
        () =>
          setPage(page === 'main' ? 'appearance' : page === 'diagnostics' ? 'appearance' : 'main'),
        false,
      ]);
  }
  actions.push(['exit', 'Exit VR', () => options.onExit?.(), false]);
  actions.forEach(([id, label, action, disabled], index) =>
    button(id, label, sidebarX, 45 + index * 76, sidebarWidth, action, false, disabled, 58)
  );
  const grabBar: QuestPanelItem = {
    id: 'grab-bar',
    label: '',
    x: 500,
    y: height - 24,
    width: 300,
    height: 12,
    fill: '#ffffff',
  };
  items.push(grabBar);
  return { items, sliders, grabBar, height, ...geometry };
}
