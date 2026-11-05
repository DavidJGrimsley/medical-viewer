import type { ReactNode } from 'react';

export interface ARSceneContext {
  sessionId: number;
  onReady: () => void;
  onInstruction: (instruction: string) => void;
  onError: () => void;
}

export interface ARSessionBoundaryProps {
  // Games opt into their universal UI without changing the medical viewer's panel.
  renderStatusPanel?: (model: ARStatusPanelModel) => ReactNode;
  onExit?: () => void;
  exitLabel?: string;
  enabled?: boolean;
  // Keep the native view through temporary OS dialogs; background still tears it down.
  keepSessionOnInactive?: boolean;
  activeOverlayLayout?: 'panel' | 'fullscreen';
  // A feature can supply a Viro or Studio navigator. The boundary owns its lifecycle.
  renderNavigator?: (context: ARSceneContext) => ReactNode;
  // Replace only the mounted-session HUD; permission, unsupported and error UI stay shared.
  renderActiveOverlay?: (context: ARActiveOverlayContext) => ReactNode;
}

export interface ARStatusPanelModel {
  title: string;
  message: string;
  loading?: boolean;
  actions?: { label: string; onPress: () => void }[];
}

export interface ARActiveOverlayContext {
  sessionId: number;
  status: 'starting' | 'running';
  instruction: string;
  home: () => void;
  restartAR: () => void;
}
