import { GameStatusPanel } from '@/ui/game-status-panel';
import type { ARStatusPanelModel } from './ar-session-types';

export default function ARStatusPanel(props: ARStatusPanelModel) {
  return <GameStatusPanel {...props} selectableMessage compact outlinedActions={['Home']} />;
}
