import { useEffect, useState } from 'react';
import type { ARSceneContext } from './ar-session-types';
import type { MedicalController } from '@/features/medical-viewer/medical-controller';

export interface QuestMedicalSession {
  sessionId: number;
  context: ARSceneContext;
  controller: MedicalController;
  uiLayer?: 'viro' | 'compositor';
}

let activeSession: QuestMedicalSession | null = null;
const sessionListeners = new Set<(session: QuestMedicalSession | null) => void>();

export const questSessionBridge = {
  registerSession(session: QuestMedicalSession): void {
    activeSession = session;
    sessionListeners.forEach((listener) => listener(activeSession));
  },

  clearSession(sessionId?: number): void {
    if (!sessionId || activeSession?.sessionId === sessionId) {
      activeSession = null;
      sessionListeners.forEach((listener) => listener(null));
    }
  },

  getSession(): QuestMedicalSession | null {
    return activeSession;
  },

  subscribe(listener: (session: QuestMedicalSession | null) => void): () => void {
    sessionListeners.add(listener);
    listener(activeSession);
    return () => {
      sessionListeners.delete(listener);
    };
  },
};

/**
 * Hook to consume the current Quest medical session inside VR scenes or panel components.
 */
export function useQuestSession(): QuestMedicalSession | null {
  const [session, setSession] = useState<QuestMedicalSession | null>(() =>
    questSessionBridge.getSession()
  );

  useEffect(() => questSessionBridge.subscribe(setSession), []);

  return session;
}
