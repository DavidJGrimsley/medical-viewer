import {
  DEFAULT_MEDICAL_MODEL_ID,
  hasMedicalLabels,
  isMedicalModelAvailable,
  MEDICAL_ASSETS,
  MEDICAL_MODEL_ASSETS,
  MEDICAL_MODELS,
  type MedicalAssetId,
  type MedicalModelId,
} from './medical-models.ts';
import {
  clampAROffset,
  clampARHeight,
  clampARScale,
  DEFAULT_AR_HEIGHT,
  normalizeYaw,
} from '../ar/ar-transform.ts';
import {
  clampSliceIndex,
  EMPTY_SLICE_DATASET,
  middleSliceIndex,
  nearestSliceIndex,
  type MedicalSliceDataset,
  type MedicalViewerMode,
  type SliceModality,
  type SliceOrientation,
} from './medical-slices.ts';
import {
  clampVolumeCrop,
  defaultVolumeAppearance,
  DEFAULT_VOLUME_YAW,
  EMPTY_VOLUME_DATASET,
  initialVolumeCrop,
  VOLUME_ATLASES,
  VOLUME_PRESETS,
  STACK_PLANE_COUNT,
  volumeControlRanges,
  type MedicalVolumeDataset,
  type VolumeAppearance,
  type VolumeAtlas,
  type VolumeBounds,
  type VolumePreset,
  type VolumeQuality,
  type VolumeRenderer,
  type VolumeDebugMode,
} from './medical-volumes.ts';
export {
  DEFAULT_AR_HEIGHT as DEFAULT_MODEL_HEIGHT,
  MIN_AR_HEIGHT as MIN_MODEL_HEIGHT,
  MAX_AR_HEIGHT as MAX_MODEL_HEIGHT,
  MIN_AR_SCALE as MIN_MODEL_SCALE,
  MAX_AR_SCALE as MAX_MODEL_SCALE,
  normalizeYaw,
} from '../ar/ar-transform.ts';

export interface MedicalControllerOptions {
  defaultVolumeRenderer?: VolumeRenderer;
  defaultVolumeDebugMode?: VolumeDebugMode;
  isQuest?: boolean;
}

export interface MedicalScope {
  sessionId: number;
  modelId: MedicalModelId;
  placementRevision: number;
  loadAttempt: number;
}

export interface MedicalSliceScope {
  sessionId: number;
  placementRevision: number;
  requestId: number;
}

export interface MedicalSliceSnapshot {
  modality: SliceModality;
  orientation: SliceOrientation;
  index: number;
  requestId: number;
  loadStatus: 'idle' | 'missing' | 'loading' | 'ready' | 'error';
  scale: number;
  yaw: number;
  height: number;
  x: number;
  z: number;
  pinching: boolean;
  rotating: boolean;
}

export type MedicalVolumeScope = MedicalSliceScope;
export interface MedicalVolumeSnapshot {
  renderer: VolumeRenderer;
  debugMode: VolumeDebugMode;
  magentaConfirmed: boolean;
  diagnostics: readonly string[];
  stackLoads: Record<number, boolean>;
  stackDescending: boolean;
  modality: SliceModality;
  appearance: Record<SliceModality, VolumeAppearance>;
  crop: VolumeBounds;
  cropping: boolean;
  cropBoxVisible: boolean;
  quality: VolumeQuality;
  requestId: number;
  loadStatus: 'idle' | 'missing' | 'loading' | 'binding' | 'ready' | 'error' | 'unsupported';
  atlasLoads: Partial<Record<VolumeAtlas, boolean>>;
  controlsOpen: boolean;
  scale: number;
  yaw: number;
  height: number;
  x: number;
  z: number;
  pinching: boolean;
  rotating: boolean;
}

export interface MedicalSnapshot {
  mode: MedicalViewerMode;
  slices: MedicalSliceSnapshot;
  volume: MedicalVolumeSnapshot;
  sessionId: number | null;
  modelId: MedicalModelId;
  tracking: 'initializing' | 'normal' | 'limited';
  anchorId: string | null;
  placementRevision: number;
  loadAttempt: number;
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  assetLoads: Partial<Record<MedicalAssetId, 'loading' | 'ready' | 'error'>>;
  scale: number;
  yaw: number;
  height: number;
  x: number;
  z: number;
  labelsVisible: boolean;
  pinching: boolean;
  rotating: boolean;
}

export function canManipulateMedical(state: MedicalSnapshot) {
  return (
    state.mode === 'anatomy' &&
    state.sessionId !== null &&
    !!state.anchorId &&
    state.tracking === 'normal' &&
    state.loadStatus === 'ready'
  );
}

export function canManipulateSlices(state: MedicalSnapshot) {
  return (
    state.mode === 'slices' &&
    state.sessionId !== null &&
    !!state.anchorId &&
    state.tracking === 'normal' &&
    state.slices.loadStatus === 'ready'
  );
}
export function canManipulateVolume(state: MedicalSnapshot) {
  return (
    state.mode === 'volume' &&
    state.sessionId !== null &&
    !!state.anchorId &&
    state.tracking === 'normal' &&
    state.volume.loadStatus === 'ready' &&
    !state.volume.controlsOpen
  );
}

export function medicalStatus(state: MedicalSnapshot) {
  if (state.mode === 'volume') {
    if (state.volume.loadStatus === 'missing')
      return '3D scan data unavailable. Anatomy and Scan Slices are still available.';
    if (state.volume.loadStatus === 'unsupported')
      return 'The shader API is unavailable. Open Scan Controls and choose Stacked slices.';
    if (state.volume.loadStatus === 'error')
      return '3D scan could not load. Try Retry or another modality.';
    if (state.tracking === 'initializing') return 'Finding a surface…';
    if (state.tracking === 'limited') return 'Tracking limited. Move slowly in good light.';
    if (!state.anchorId) return 'Tap a highlighted surface to place the 3D scan.';
    if (['loading', 'binding'].includes(state.volume.loadStatus)) return 'Loading 3D scan…';
    return '';
  }
  if (state.mode === 'slices') {
    if (state.slices.loadStatus === 'missing')
      return 'Scan images unavailable. 3D Anatomy is still available.';
    if (state.slices.loadStatus === 'error')
      return `${state.slices.modality.toUpperCase()} slice could not load. Try another slice or Retry.`;
    if (state.tracking === 'initializing') return 'Finding a surface…';
    if (state.tracking === 'limited') return 'Tracking limited. Move slowly in good light.';
    if (!state.anchorId) return 'Tap a highlighted surface to place the scan panel.';
    if (state.slices.loadStatus === 'loading') return 'Loading scan slice…';
    return '';
  }
  const model = MEDICAL_MODELS.find((model) => model.id === state.modelId)!;
  if (state.loadStatus === 'error') {
    const failed = MEDICAL_MODEL_ASSETS[state.modelId]
      .filter((id) => state.assetLoads[id] === 'error')
      .map((id) => MEDICAL_ASSETS[id].label);
    return `${failed.join(' and ') || model.label} could not load.`;
  }
  if (state.tracking === 'initializing') return 'Finding a surface…';
  if (state.tracking === 'limited') return 'Tracking limited. Move slowly in good light.';
  if (!state.anchorId)
    return state.modelId === 'both'
      ? 'Tap a highlighted surface to place the half-skull and brain.'
      : `Tap a highlighted surface to place the ${model.label.toLowerCase()}.`;
  if (state.loadStatus === 'loading')
    return state.modelId === 'both'
      ? 'Loading half-skull and brain…'
      : `Loading ${model.label.toLowerCase()}…`;
  return '';
}

export class MedicalController {
  private snapshot: MedicalSnapshot = {
    mode: 'anatomy',
    volume: {
      renderer: 'stack',
      debugMode: 'magenta',
      magentaConfirmed: false,
      diagnostics: [],
      stackLoads: {},
      stackDescending: false,
      modality: 'mri',
      appearance: { mri: defaultVolumeAppearance('mri'), ct: defaultVolumeAppearance('ct') },
      crop: initialVolumeCrop(EMPTY_VOLUME_DATASET.boundsRasMm),
      cropping: true,
      cropBoxVisible: false,
      quality: 'balanced',
      requestId: 0,
      loadStatus: 'idle',
      atlasLoads: {},
      controlsOpen: false,
      scale: 1,
      yaw: DEFAULT_VOLUME_YAW,
      height: DEFAULT_AR_HEIGHT,
      x: 0,
      z: 0,
      pinching: false,
      rotating: false,
    },
    slices: {
      modality: 'mri',
      orientation: 'axial',
      index: 0,
      requestId: 0,
      loadStatus: 'idle',
      scale: 1,
      yaw: 0,
      height: DEFAULT_AR_HEIGHT,
      x: 0,
      z: 0,
      pinching: false,
      rotating: false,
    },
    sessionId: null,
    modelId: DEFAULT_MEDICAL_MODEL_ID,
    tracking: 'initializing',
    anchorId: null,
    placementRevision: 0,
    loadAttempt: 0,
    loadStatus: 'idle',
    assetLoads: {},
    scale: 1,
    yaw: 0,
    height: DEFAULT_AR_HEIGHT,
    x: 0,
    z: 0,
    labelsVisible: false,
    pinching: false,
    rotating: false,
  };
  private listeners = new Set<() => void>();
  private pinchStart: number | null = null;
  private rotationStart: number | null = null;
  private slicePinchStart: number | null = null;
  private sliceRotationStart: number | null = null;
  private volumePinchStart: number | null = null;
  private volumeRotationStart: number | null = null;
  private readonly isAssetAvailable: (assetId: MedicalAssetId) => boolean;
  readonly sliceDataset: MedicalSliceDataset;
  readonly volumeDataset: MedicalVolumeDataset;
  readonly isQuest: boolean;

  constructor(
    isAssetAvailable?: ((assetId: MedicalAssetId) => boolean) | MedicalControllerOptions,
    sliceDataset: MedicalSliceDataset = EMPTY_SLICE_DATASET,
    volumeDataset: MedicalVolumeDataset = EMPTY_VOLUME_DATASET,
    options: MedicalControllerOptions = {}
  ) {
    const opts =
      isAssetAvailable && typeof isAssetAvailable === 'object' ? isAssetAvailable : options;
    const assetCheck = typeof isAssetAvailable === 'function' ? isAssetAvailable : undefined;
    this.isAssetAvailable = assetCheck ?? ((assetId) => MEDICAL_ASSETS[assetId].transform !== null);
    this.sliceDataset = sliceDataset;
    this.volumeDataset = volumeDataset;
    this.isQuest = Boolean(opts.isQuest ?? opts.defaultVolumeRenderer === 'shader');
    if (this.isQuest) {
      this.snapshot.volume.renderer = opts.defaultVolumeRenderer ?? 'shader';
      this.snapshot.volume.debugMode = opts.defaultVolumeDebugMode ?? 'raymarch';
      this.snapshot.volume.magentaConfirmed = true;
    } else {
      if (opts.defaultVolumeRenderer) {
        this.snapshot.volume.renderer = opts.defaultVolumeRenderer;
      }
      if (opts.defaultVolumeDebugMode) {
        this.snapshot.volume.debugMode = opts.defaultVolumeDebugMode;
      }
    }
    this.snapshot.volume.crop = initialVolumeCrop(volumeDataset.boundsRasMm);
    const series =
      this.getSliceSeries() ?? sliceDataset.series.find((item) => item.orientation === 'axial');
    if (series)
      this.snapshot.slices = {
        ...this.snapshot.slices,
        modality: series.modality,
        index: middleSliceIndex(series.imageCount),
      };
    if (!isMedicalModelAvailable(DEFAULT_MEDICAL_MODEL_ID, this.isAssetAvailable)) {
      this.snapshot = {
        ...this.snapshot,
        modelId:
          MEDICAL_MODELS.find((model) => isMedicalModelAvailable(model.id, this.isAssetAvailable))
            ?.id ?? DEFAULT_MEDICAL_MODEL_ID,
      };
    }
  }

  getSnapshot = () => this.snapshot;
  getSessionId = () => this.snapshot.sessionId;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(change: Partial<MedicalSnapshot>) {
    if (
      Object.entries(change).every(
        ([key, value]) => this.snapshot[key as keyof MedicalSnapshot] === value
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private live(sessionId: number) {
    return this.snapshot.sessionId === sessionId;
  }
  private current(scope: MedicalScope) {
    return (
      this.snapshot.mode === 'anatomy' &&
      this.live(scope.sessionId) &&
      scope.modelId === this.snapshot.modelId &&
      scope.placementRevision === this.snapshot.placementRevision &&
      scope.loadAttempt === this.snapshot.loadAttempt
    );
  }
  clearGestures() {
    this.pinchStart = this.rotationStart = null;
    this.slicePinchStart = this.sliceRotationStart = null;
    this.volumePinchStart = this.volumeRotationStart = null;
  }
  getSliceSeries = (
    modality = this.snapshot.slices.modality,
    orientation = this.snapshot.slices.orientation
  ) =>
    this.sliceDataset.series.find(
      (series) => series.modality === modality && series.orientation === orientation
    );

  private sliceUpdate(change: Partial<MedicalSliceSnapshot>) {
    return { ...this.snapshot.slices, ...change };
  }
  private sliceLoad(placed = !!this.snapshot.anchorId): MedicalSliceSnapshot {
    return this.sliceUpdate({
      requestId: this.snapshot.slices.requestId + 1,
      loadStatus: !this.getSliceSeries() ? 'missing' : placed ? 'loading' : 'idle',
      pinching: false,
      rotating: false,
    });
  }
  private currentSlice(scope: MedicalSliceScope) {
    return (
      this.snapshot.mode === 'slices' &&
      this.live(scope.sessionId) &&
      scope.placementRevision === this.snapshot.placementRevision &&
      scope.requestId === this.snapshot.slices.requestId
    );
  }

  selectViewerMode(sessionId: number, mode: MedicalViewerMode) {
    if (
      !this.live(sessionId) ||
      !['anatomy', 'slices', 'volume'].includes(mode) ||
      mode === this.snapshot.mode
    )
      return;
    this.clearGestures();
    this.publish({
      mode,
      loadAttempt: this.snapshot.loadAttempt + 1,
      loadStatus: mode === 'anatomy' && this.snapshot.anchorId ? 'loading' : 'idle',
      assetLoads: mode === 'anatomy' && this.snapshot.anchorId ? this.loadingAssets() : {},
      slices: this.sliceLoad(mode === 'slices' && !!this.snapshot.anchorId),
      volume: this.volumeLoad(mode === 'volume' && !!this.snapshot.anchorId, mode === 'volume'),
      pinching: false,
      rotating: false,
    });
  }

  selectSlice(scope: MedicalSliceScope, index: number) {
    if (!this.currentSlice(scope) || !Number.isFinite(index)) return;
    const series = this.getSliceSeries();
    if (!series) return;
    const next = clampSliceIndex(index, series.imageCount);
    if (next === this.snapshot.slices.index) return;
    this.clearGestures();
    this.publish({ slices: { ...this.sliceLoad(), index: next } });
  }

  selectModality(sessionId: number, modality: SliceModality) {
    if (
      !this.live(sessionId) ||
      this.snapshot.mode !== 'slices' ||
      modality === this.snapshot.slices.modality
    )
      return;
    const target = this.getSliceSeries(modality);
    if (!target) return;
    const source = this.getSliceSeries();
    const position = source?.slices[this.snapshot.slices.index]?.positionMm;
    this.clearGestures();
    this.publish({
      slices: {
        ...this.sliceLoad(),
        modality,
        index:
          position === undefined
            ? middleSliceIndex(target.imageCount)
            : nearestSliceIndex(target, position),
        loadStatus: this.snapshot.anchorId ? 'loading' : 'idle',
      },
    });
  }

  resetSlice(sessionId: number) {
    if (!this.live(sessionId) || this.snapshot.mode !== 'slices') return;
    const series = this.getSliceSeries();
    if (series)
      this.selectSlice(
        {
          sessionId,
          placementRevision: this.snapshot.placementRevision,
          requestId: this.snapshot.slices.requestId,
        },
        middleSliceIndex(series.imageCount)
      );
  }

  finishSliceLoad(scope: MedicalSliceScope, success: boolean) {
    if (
      !this.currentSlice(scope) ||
      !this.snapshot.anchorId ||
      (success
        ? this.snapshot.slices.loadStatus !== 'loading'
        : !['loading', 'ready'].includes(this.snapshot.slices.loadStatus))
    )
      return;
    if (!success) this.clearGestures();
    this.publish({
      slices: this.sliceUpdate({
        loadStatus: success ? 'ready' : 'error',
        ...(!success ? { pinching: false, rotating: false } : {}),
      }),
    });
  }

  retrySliceLoad(sessionId: number) {
    if (
      !this.live(sessionId) ||
      this.snapshot.mode !== 'slices' ||
      !this.snapshot.anchorId ||
      this.snapshot.slices.loadStatus !== 'error'
    )
      return;
    this.publish({ slices: this.sliceLoad() });
  }

  resetPanel(sessionId: number) {
    if (!this.live(sessionId) || this.snapshot.mode !== 'slices') return;
    this.clearGestures();
    this.publish({
      slices: this.sliceUpdate({
        scale: 1,
        yaw: 0,
        height: DEFAULT_AR_HEIGHT,
        x: 0,
        z: 0,
        pinching: false,
        rotating: false,
      }),
    });
  }

  setPanelTransform(
    scope: MedicalSliceScope,
    axis: 'scale' | 'yaw' | 'height' | 'x' | 'z',
    value: number
  ) {
    if (
      !this.currentSlice(scope) ||
      !canManipulateSlices(this.snapshot) ||
      !Number.isFinite(value) ||
      !['scale', 'yaw', 'height', 'x', 'z'].includes(axis) ||
      (axis === 'scale' && this.snapshot.slices.pinching) ||
      (axis === 'yaw' && this.snapshot.slices.rotating)
    )
      return;
    this.publish({
      slices: this.sliceUpdate({
        [axis]:
          axis === 'scale'
            ? clampARScale(value)
            : axis === 'height'
              ? clampARHeight(value)
              : axis === 'x' || axis === 'z'
                ? clampAROffset(value)
                : normalizeYaw(value),
      }),
    });
  }

  setPanelPosition(scope: MedicalSliceScope, axis: 'x' | 'y' | 'z', value: number) {
    if (!['x', 'y', 'z'].includes(axis)) return;
    this.setPanelTransform(scope, axis === 'y' ? 'height' : axis, value);
  }

  panelGesture(scope: MedicalSliceScope, kind: 'pinch' | 'rotate', gesture: number, value: number) {
    if (
      !this.currentSlice(scope) ||
      !canManipulateSlices(this.snapshot) ||
      ![1, 2, 3].includes(gesture)
    )
      return;
    const flag = kind === 'pinch' ? 'pinching' : 'rotating';
    if (!Number.isFinite(value) || (kind === 'pinch' && value <= 0)) {
      if (gesture === 3) {
        if (kind === 'pinch') this.slicePinchStart = null;
        else this.sliceRotationStart = null;
        this.publish({ slices: this.sliceUpdate({ [flag]: false }) });
      }
      return;
    }
    if (gesture === 1) {
      if (kind === 'pinch') this.slicePinchStart = this.snapshot.slices.scale;
      else this.sliceRotationStart = this.snapshot.slices.yaw;
    }
    const start = kind === 'pinch' ? this.slicePinchStart : this.sliceRotationStart;
    if (start === null) return;
    this.publish({
      slices: this.sliceUpdate({
        ...(kind === 'pinch'
          ? { scale: clampARScale(start * value) }
          : { yaw: normalizeYaw(start - value) }),
        [flag]: gesture !== 3,
      }),
    });
    if (gesture === 3) {
      if (kind === 'pinch') this.slicePinchStart = null;
      else this.sliceRotationStart = null;
    }
  }
  private loadingAssets(modelId = this.snapshot.modelId): MedicalSnapshot['assetLoads'] {
    return Object.fromEntries(MEDICAL_MODEL_ASSETS[modelId].map((id) => [id, 'loading']));
  }

  getVolumeSeries = (modality = this.snapshot.volume.modality) =>
    this.volumeDataset.series.find((series) => series.modality === modality);
  private volumeUpdate(change: Partial<MedicalVolumeSnapshot>) {
    return { ...this.snapshot.volume, ...change };
  }
  private volumeLoad(placed = !!this.snapshot.anchorId, active = this.snapshot.mode === 'volume') {
    return this.volumeUpdate({
      requestId: this.snapshot.volume.requestId + 1,
      loadStatus: !active
        ? 'idle'
        : !this.getVolumeSeries()
          ? 'missing'
          : placed
            ? 'loading'
            : 'idle',
      atlasLoads: {},
      stackLoads: {},
      magentaConfirmed: this.isQuest ? true : false,
      debugMode:
        this.snapshot.volume.renderer === 'shader'
          ? this.isQuest
            ? 'raymarch'
            : 'magenta'
          : this.snapshot.volume.debugMode,
      diagnostics: [],
      controlsOpen: false,
      pinching: false,
      rotating: false,
    });
  }
  private currentVolume(scope: MedicalVolumeScope) {
    return (
      this.snapshot.mode === 'volume' &&
      this.live(scope.sessionId) &&
      scope.placementRevision === this.snapshot.placementRevision &&
      scope.requestId === this.snapshot.volume.requestId
    );
  }
  setVolumeRenderer(sessionId: number, renderer: VolumeRenderer) {
    if (!this.live(sessionId) || !['stack', 'shader'].includes(renderer)) return;
    this.clearGestures();
    const isQuest = this.isQuest;
    this.publish({
      volume: {
        ...this.volumeLoad(),
        renderer,
        debugMode:
          renderer === 'shader'
            ? isQuest
              ? 'raymarch'
              : 'magenta'
            : this.snapshot.volume.debugMode,
        magentaConfirmed: isQuest,
        controlsOpen: !isQuest && this.snapshot.mode === 'volume',
      },
    });
  }
  confirmVolumeMagenta(scope: MedicalVolumeScope) {
    if (
      !this.currentVolume(scope) ||
      this.snapshot.volume.renderer !== 'shader' ||
      this.snapshot.volume.debugMode !== 'magenta' ||
      this.snapshot.volume.loadStatus !== 'ready'
    )
      return;
    this.publish({ volume: this.volumeUpdate({ magentaConfirmed: true }) });
  }
  setVolumeDebugMode(scope: MedicalVolumeScope, debugMode: VolumeDebugMode) {
    if (
      !this.currentVolume(scope) ||
      this.snapshot.volume.renderer !== 'shader' ||
      ![
        'magenta',
        'high',
        'low',
        'validity',
        'coordinates',
        'uniforms',
        'ray',
        'opacity',
        'raymarch',
      ].includes(debugMode) ||
      (debugMode !== 'magenta' && !this.snapshot.volume.magentaConfirmed)
    )
      return;
    this.publish({
      volume: {
        ...this.volumeLoad(),
        debugMode,
        magentaConfirmed: this.snapshot.volume.magentaConfirmed,
        controlsOpen: !this.isQuest,
      },
    });
  }
  recordVolumeDiagnostic(scope: MedicalVolumeScope, message: string) {
    if (!this.currentVolume(scope)) return;
    const text = message.slice(0, 400);
    if (this.snapshot.volume.diagnostics.at(-1) === text) return;
    this.publish({
      volume: this.volumeUpdate({
        diagnostics: [...this.snapshot.volume.diagnostics.slice(-7), text],
      }),
    });
  }
  updateVolumeCamera(sessionId: number, forward: number[]) {
    if (
      !this.live(sessionId) ||
      this.snapshot.mode !== 'volume' ||
      this.snapshot.volume.renderer !== 'stack' ||
      forward.length !== 3 ||
      !forward.every(Number.isFinite) ||
      Math.abs(forward[1]) < 0.05
    )
      return;
    const stackDescending = forward[1] > 0;
    if (stackDescending !== this.snapshot.volume.stackDescending)
      this.publish({ volume: this.volumeUpdate({ stackDescending }) });
  }
  finishVolumeStackImage(scope: MedicalVolumeScope, index: number, success: boolean) {
    if (
      !this.currentVolume(scope) ||
      !this.snapshot.anchorId ||
      this.snapshot.volume.renderer !== 'stack' ||
      this.snapshot.volume.loadStatus !== 'loading' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= STACK_PLANE_COUNT
    )
      return;
    const stackLoads = { ...this.snapshot.volume.stackLoads, [index]: success };
    this.publish({
      volume: this.volumeUpdate({
        stackLoads,
        loadStatus: !success
          ? 'error'
          : Object.keys(stackLoads).length === STACK_PLANE_COUNT
            ? 'binding'
            : 'loading',
      }),
    });
  }
  selectVolumeModality(sessionId: number, modality: SliceModality) {
    if (
      !this.live(sessionId) ||
      this.snapshot.mode !== 'volume' ||
      !['mri', 'ct'].includes(modality) ||
      modality === this.snapshot.volume.modality ||
      !this.getVolumeSeries(modality)
    )
      return;
    this.clearGestures();
    this.publish({
      volume: {
        ...this.volumeLoad(),
        modality,
        loadStatus: this.snapshot.anchorId ? 'loading' : 'idle',
      },
    });
  }
  finishVolumeAtlas(scope: MedicalVolumeScope, atlas: VolumeAtlas, success: boolean) {
    if (
      !this.currentVolume(scope) ||
      this.snapshot.volume.renderer !== 'shader' ||
      !this.snapshot.anchorId ||
      !VOLUME_ATLASES.includes(atlas) ||
      this.snapshot.volume.loadStatus !== 'loading'
    )
      return;
    const atlasLoads = { ...this.snapshot.volume.atlasLoads, [atlas]: success };
    this.publish({
      volume: this.volumeUpdate({
        atlasLoads,
        loadStatus: !success
          ? 'error'
          : VOLUME_ATLASES.every((key) => atlasLoads[key])
            ? 'binding'
            : 'loading',
      }),
    });
  }
  finishVolumeBinding(scope: MedicalVolumeScope, result: 'ready' | 'error' | 'unsupported') {
    if (
      !this.currentVolume(scope) ||
      !this.snapshot.anchorId ||
      !['loading', 'binding', ...(result === 'error' ? ['ready'] : [])].includes(
        this.snapshot.volume.loadStatus
      )
    )
      return;
    if (
      result === 'ready' &&
      this.snapshot.volume.loadStatus !== 'binding' &&
      !(
        this.snapshot.volume.renderer === 'shader' &&
        this.snapshot.volume.debugMode === 'magenta' &&
        this.snapshot.volume.loadStatus === 'loading'
      )
    )
      return;
    if (result !== 'ready') this.clearGestures();
    this.publish({
      volume: this.volumeUpdate({
        loadStatus: result,
        ...(result !== 'ready' ? { pinching: false, rotating: false } : {}),
      }),
    });
  }
  retryVolumeLoad(sessionId: number) {
    if (
      !this.live(sessionId) ||
      this.snapshot.mode !== 'volume' ||
      !this.snapshot.anchorId ||
      this.snapshot.volume.loadStatus !== 'error'
    )
      return;
    this.publish({ volume: this.volumeLoad() });
  }
  openVolumeControls(sessionId: number, controlsOpen: boolean) {
    if (!this.live(sessionId) || this.snapshot.mode !== 'volume') return;
    this.clearGestures();
    this.publish({ volume: this.volumeUpdate({ controlsOpen, pinching: false, rotating: false }) });
  }
  setVolumePreset(scope: MedicalVolumeScope, preset: VolumePreset) {
    if (
      !this.currentVolume(scope) ||
      VOLUME_PRESETS[preset]?.modality !== this.snapshot.volume.modality
    )
      return;
    const { window, level } = VOLUME_PRESETS[preset];
    this.publish({
      volume: this.volumeUpdate({
        ...(this.snapshot.volume.renderer === 'stack'
          ? {
              requestId: this.snapshot.volume.requestId + 1,
              stackLoads: {},
              loadStatus: this.snapshot.anchorId ? ('loading' as const) : ('idle' as const),
            }
          : {}),
        appearance: {
          ...this.snapshot.volume.appearance,
          [this.snapshot.volume.modality]: { preset, window, level, opacity: 1 },
        },
      }),
    });
  }
  setVolumeAppearance(
    scope: MedicalVolumeScope,
    key: 'window' | 'level' | 'opacity',
    value: number
  ) {
    if (
      !this.currentVolume(scope) ||
      (this.snapshot.volume.renderer === 'stack' && key !== 'opacity') ||
      !['window', 'level', 'opacity'].includes(key) ||
      !Number.isFinite(value)
    )
      return;
    const series = this.getVolumeSeries();
    if (!series) return;
    const appearance = this.snapshot.volume.appearance[this.snapshot.volume.modality];
    const range = key === 'opacity' ? [0, 2] : volumeControlRanges(series, appearance)[key];
    const next = Math.max(range[0], Math.min(range[1], value));
    this.publish({
      volume: this.volumeUpdate({
        appearance: {
          ...this.snapshot.volume.appearance,
          [this.snapshot.volume.modality]: { ...appearance, [key]: next },
        },
      }),
    });
  }
  setVolumeCrop(scope: MedicalVolumeScope, boundary: number, value: number) {
    if (
      !this.currentVolume(scope) ||
      !Number.isInteger(boundary) ||
      boundary < 0 ||
      boundary > 5 ||
      !Number.isFinite(value)
    )
      return;
    this.publish({
      volume: this.volumeUpdate({
        crop: clampVolumeCrop(this.volumeDataset, this.snapshot.volume.crop, boundary, value),
      }),
    });
  }
  configureVolume(
    scope: MedicalVolumeScope,
    change: { cropping?: boolean; cropBoxVisible?: boolean; quality?: VolumeQuality }
  ) {
    if (!this.currentVolume(scope)) return;
    const update: Partial<MedicalVolumeSnapshot> = {};
    if (typeof change.cropping === 'boolean') update.cropping = change.cropping;
    if (typeof change.cropBoxVisible === 'boolean') update.cropBoxVisible = change.cropBoxVisible;
    if (change.quality === 'balanced' || change.quality === 'fast') update.quality = change.quality;
    this.publish({ volume: this.volumeUpdate(update) });
  }
  resetVolumeCrop(sessionId: number) {
    if (!this.live(sessionId) || this.snapshot.mode !== 'volume') return;
    this.publish({
      volume: this.volumeUpdate({ crop: [...this.volumeDataset.boundsRasMm] as VolumeBounds }),
    });
  }
  resetVolumeScan(sessionId: number) {
    if (!this.live(sessionId) || this.snapshot.mode !== 'volume') return;
    this.publish({
      volume: this.volumeUpdate({
        ...(this.snapshot.volume.renderer === 'stack'
          ? {
              requestId: this.snapshot.volume.requestId + 1,
              stackLoads: {},
              loadStatus: this.snapshot.anchorId ? ('loading' as const) : ('idle' as const),
            }
          : {}),
        crop: initialVolumeCrop(this.volumeDataset.boundsRasMm),
        cropping: true,
        appearance: {
          ...this.snapshot.volume.appearance,
          [this.snapshot.volume.modality]: defaultVolumeAppearance(this.snapshot.volume.modality),
        },
      }),
    });
  }
  resetVolumeTransform(sessionId: number) {
    if (!this.live(sessionId) || this.snapshot.mode !== 'volume') return;
    this.clearGestures();
    this.publish({
      volume: this.volumeUpdate({
        scale: 1,
        yaw: DEFAULT_VOLUME_YAW,
        height: DEFAULT_AR_HEIGHT,
        x: 0,
        z: 0,
        pinching: false,
        rotating: false,
      }),
    });
  }
  setVolumeTransform(
    scope: MedicalVolumeScope,
    axis: 'scale' | 'yaw' | 'height' | 'x' | 'z',
    value: number
  ) {
    if (
      !this.currentVolume(scope) ||
      !canManipulateVolume(this.snapshot) ||
      !Number.isFinite(value) ||
      !['scale', 'yaw', 'height', 'x', 'z'].includes(axis) ||
      (axis === 'scale' && this.snapshot.volume.pinching) ||
      (axis === 'yaw' && this.snapshot.volume.rotating)
    )
      return;
    this.publish({
      volume: this.volumeUpdate({
        [axis]:
          axis === 'scale'
            ? clampARScale(value)
            : axis === 'height'
              ? clampARHeight(value)
              : axis === 'x' || axis === 'z'
                ? clampAROffset(value)
                : normalizeYaw(value),
      }),
    });
  }
  setVolumePosition(scope: MedicalVolumeScope, axis: 'x' | 'y' | 'z', value: number) {
    if (!['x', 'y', 'z'].includes(axis)) return;
    this.setVolumeTransform(scope, axis === 'y' ? 'height' : axis, value);
  }
  volumeGesture(
    scope: MedicalVolumeScope,
    kind: 'pinch' | 'rotate',
    gesture: number,
    value: number
  ) {
    if (
      !this.currentVolume(scope) ||
      !canManipulateVolume(this.snapshot) ||
      ![1, 2, 3].includes(gesture)
    )
      return;
    const flag = kind === 'pinch' ? 'pinching' : 'rotating';
    if (!Number.isFinite(value) || (kind === 'pinch' && value <= 0)) {
      if (gesture === 3) {
        if (kind === 'pinch') this.volumePinchStart = null;
        else this.volumeRotationStart = null;
        this.publish({ volume: this.volumeUpdate({ [flag]: false }) });
      }
      return;
    }
    if (gesture === 1) {
      if (kind === 'pinch') this.volumePinchStart = this.snapshot.volume.scale;
      else this.volumeRotationStart = this.snapshot.volume.yaw;
    }
    const start = kind === 'pinch' ? this.volumePinchStart : this.volumeRotationStart;
    if (start === null) return;
    this.publish({
      volume: this.volumeUpdate({
        ...(kind === 'pinch'
          ? { scale: clampARScale(start * value) }
          : { yaw: normalizeYaw(start - value) }),
        [flag]: gesture !== 3,
      }),
    });
    if (gesture === 3) {
      if (kind === 'pinch') this.volumePinchStart = null;
      else this.volumeRotationStart = null;
    }
  }

  attach(sessionId: number) {
    if (this.live(sessionId)) return;
    this.clearGestures();
    this.publish({
      sessionId,
      tracking: 'initializing',
      anchorId: null,
      placementRevision: this.snapshot.placementRevision + 1,
      loadStatus: 'idle',
      assetLoads: {},
      slices: this.sliceLoad(false),
      volume: this.volumeLoad(false),
      pinching: false,
      rotating: false,
    });
  }
  detach(sessionId: number) {
    if (!this.live(sessionId)) return;
    this.clearGestures();
    this.publish({
      sessionId: null,
      anchorId: null,
      placementRevision: this.snapshot.placementRevision + 1,
      loadStatus: 'idle',
      assetLoads: {},
      slices: this.sliceLoad(false),
      volume: this.volumeLoad(false),
      pinching: false,
      rotating: false,
    });
  }
  restart(sessionId: number) {
    if (!this.live(sessionId)) return;
    this.publish({
      scale: 1,
      yaw: 0,
      height: DEFAULT_AR_HEIGHT,
      x: 0,
      z: 0,
      slices: this.sliceUpdate({ scale: 1, yaw: 0, height: DEFAULT_AR_HEIGHT, x: 0, z: 0 }),
      volume: this.volumeUpdate({
        scale: 1,
        yaw: DEFAULT_VOLUME_YAW,
        height: DEFAULT_AR_HEIGHT,
        x: 0,
        z: 0,
      }),
    });
    this.detach(sessionId);
  }
  setTracking(sessionId: number, normal: boolean) {
    if (!this.live(sessionId)) return;
    if (!normal) this.clearGestures();
    this.publish({
      tracking: normal ? 'normal' : 'limited',
      ...(!normal ? { pinching: false, rotating: false } : {}),
      ...(!normal ? { volume: this.volumeUpdate({ pinching: false, rotating: false }) } : {}),
      ...(!normal ? { slices: this.sliceUpdate({ pinching: false, rotating: false }) } : {}),
    });
  }
  selectModel(sessionId: number, modelId: MedicalModelId) {
    if (
      !this.live(sessionId) ||
      this.snapshot.mode !== 'anatomy' ||
      modelId === this.snapshot.modelId ||
      !isMedicalModelAvailable(modelId, this.isAssetAvailable)
    )
      return;
    this.clearGestures();
    this.publish({
      modelId,
      loadAttempt: this.snapshot.loadAttempt + 1,
      loadStatus: this.snapshot.anchorId ? 'loading' : 'idle',
      assetLoads: this.snapshot.anchorId ? this.loadingAssets(modelId) : {},
      labelsVisible: hasMedicalLabels(modelId) && this.snapshot.labelsVisible,
      pinching: false,
      rotating: false,
    });
  }
  selectPlane(sessionId: number, revision: number, anchorId: string) {
    if (
      !this.live(sessionId) ||
      revision !== this.snapshot.placementRevision ||
      this.snapshot.anchorId ||
      this.snapshot.tracking !== 'normal' ||
      !anchorId
    )
      return;
    this.publish({
      anchorId,
      loadStatus: this.snapshot.mode === 'anatomy' ? 'loading' : 'idle',
      loadAttempt: this.snapshot.loadAttempt + 1,
      assetLoads: this.snapshot.mode === 'anatomy' ? this.loadingAssets() : {},
      slices: this.sliceLoad(true),
      volume: this.volumeLoad(true),
    });
  }
  losePlane(sessionId: number, revision: number, anchorId: string) {
    if (
      !this.live(sessionId) ||
      revision !== this.snapshot.placementRevision ||
      anchorId !== this.snapshot.anchorId
    )
      return;
    this.reposition(sessionId);
  }
  reposition(sessionId: number) {
    if (!this.live(sessionId) || !this.snapshot.anchorId) return;
    this.clearGestures();
    this.publish({
      anchorId: null,
      placementRevision: this.snapshot.placementRevision + 1,
      loadStatus: 'idle',
      assetLoads: {},
      slices: this.sliceLoad(false),
      volume: this.volumeLoad(false),
      pinching: false,
      rotating: false,
    });
  }
  finishLoad(scope: MedicalScope, assetId: MedicalAssetId, success: boolean) {
    if (
      !this.current(scope) ||
      !this.snapshot.anchorId ||
      !MEDICAL_MODEL_ASSETS[this.snapshot.modelId].includes(assetId) ||
      (success &&
        (this.snapshot.loadStatus !== 'loading' ||
          this.snapshot.assetLoads[assetId] !== 'loading')) ||
      (!success &&
        (this.snapshot.loadStatus === 'idle' || this.snapshot.assetLoads[assetId] === 'error'))
    )
      return;
    const assetLoads: MedicalSnapshot['assetLoads'] = {
      ...this.snapshot.assetLoads,
      [assetId]: success ? 'ready' : 'error',
    };
    if (!success) this.clearGestures();
    this.publish({
      assetLoads,
      loadStatus: !success
        ? 'error'
        : MEDICAL_MODEL_ASSETS[this.snapshot.modelId].every((id) => assetLoads[id] === 'ready')
          ? 'ready'
          : 'loading',
      ...(!success ? { pinching: false, rotating: false } : {}),
    });
  }
  retryLoad(sessionId: number) {
    if (!this.live(sessionId) || !this.snapshot.anchorId || this.snapshot.loadStatus !== 'error')
      return;
    this.publish({
      loadStatus: 'loading',
      loadAttempt: this.snapshot.loadAttempt + 1,
      assetLoads: this.loadingAssets(),
    });
  }
  toggleLabels(sessionId: number) {
    if (
      this.live(sessionId) &&
      hasMedicalLabels(this.snapshot.modelId) &&
      canManipulateMedical(this.snapshot)
    )
      this.publish({ labelsVisible: !this.snapshot.labelsVisible });
  }
  setScale(scope: MedicalScope, value: number) {
    if (
      !this.current(scope) ||
      !canManipulateMedical(this.snapshot) ||
      this.snapshot.pinching ||
      !Number.isFinite(value)
    )
      return;
    this.publish({ scale: clampARScale(value) });
  }
  setYaw(scope: MedicalScope, value: number) {
    if (
      !this.current(scope) ||
      !canManipulateMedical(this.snapshot) ||
      this.snapshot.rotating ||
      !Number.isFinite(value)
    )
      return;
    this.publish({ yaw: normalizeYaw(value) });
  }
  setHeight(scope: MedicalScope, value: number) {
    if (!this.current(scope) || !canManipulateMedical(this.snapshot) || !Number.isFinite(value))
      return;
    this.publish({ height: clampARHeight(value) });
  }
  setPosition(scope: MedicalScope, axis: 'x' | 'y' | 'z', value: number) {
    if (
      !this.current(scope) ||
      !canManipulateMedical(this.snapshot) ||
      !Number.isFinite(value) ||
      !['x', 'y', 'z'].includes(axis)
    )
      return;
    this.publish({
      [axis === 'y' ? 'height' : axis]: axis === 'y' ? clampARHeight(value) : clampAROffset(value),
    });
  }
  pinch(scope: MedicalScope, gesture: number, factor: number) {
    if (
      !this.current(scope) ||
      !canManipulateMedical(this.snapshot) ||
      ![1, 2, 3].includes(gesture)
    )
      return;
    if (!Number.isFinite(factor) || factor <= 0) {
      if (gesture === 3) {
        this.pinchStart = null;
        this.publish({ pinching: false });
      }
      return;
    }
    if (gesture === 1) {
      this.pinchStart = this.snapshot.scale;
      this.publish({ pinching: true });
    }
    if (this.pinchStart === null) return;
    this.publish({ scale: clampARScale(this.pinchStart * factor) });
    if (gesture === 3) {
      this.pinchStart = null;
      this.publish({ pinching: false });
    }
  }
  rotate(scope: MedicalScope, gesture: number, degrees: number) {
    if (
      !this.current(scope) ||
      !canManipulateMedical(this.snapshot) ||
      ![1, 2, 3].includes(gesture)
    )
      return;
    if (!Number.isFinite(degrees)) {
      if (gesture === 3) {
        this.rotationStart = null;
        this.publish({ rotating: false });
      }
      return;
    }
    if (gesture === 1) {
      this.rotationStart = this.snapshot.yaw;
      this.publish({ rotating: true });
    }
    if (this.rotationStart === null) return;
    this.publish({ yaw: normalizeYaw(this.rotationStart - degrees) });
    if (gesture === 3) {
      this.rotationStart = null;
      this.publish({ rotating: false });
    }
  }
}
