import { requireOptionalNativeModule } from 'expo';

interface QuestPanelModule {
  isAvailable(): boolean;
  open(): number;
  status(owner: number): number;
  draw(owner: number, spec: string): void;
  setPose(owner: number, pose: number[]): void;
  hide(owner: number): void;
}

export const questCompositor = requireOptionalNativeModule<QuestPanelModule>('QuestPanel');
export function hasQuestCompositor(): boolean {
  try {
    return questCompositor?.isAvailable() ?? false;
  } catch {
    return false;
  }
}
