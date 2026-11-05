import ARSessionBoundary from '@/features/ar/ar-session-boundary';
import type { ARSessionBoundaryProps } from '@/features/ar/ar-session-types';
import { GameStatusPanel } from './game-status-panel';

export default function GameARBoundary(props: ARSessionBoundaryProps) {
  return (
    <ARSessionBoundary {...props} renderStatusPanel={(model) => <GameStatusPanel {...model} />} />
  );
}
