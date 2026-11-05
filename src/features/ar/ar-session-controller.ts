import { createStore } from 'zustand/vanilla';

export type ARSupport = 'supported' | 'unsupported' | 'missing-native';
export type ARSessionStatus =
  | 'inactive'
  | 'checking'
  | 'permission'
  | 'requesting'
  | 'denied'
  | 'unsupported'
  | 'missing-native'
  | 'waiting'
  | 'starting'
  | 'running'
  | 'error';

export interface ARSessionSnapshot {
  status: ARSessionStatus;
  sessionId: number;
  instruction: string;
}

export interface ARRuntime {
  checkSupport: () => Promise<ARSupport>;
  hasCameraPermission: () => Promise<boolean>;
  requestCameraPermission: () => Promise<boolean>;
}

interface SessionClock {
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

const defaultClock: SessionClock = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createARSessionCoordinator() {
  const store = createStore<{ owner: object | null; stop: (() => void) | null }>(() => ({
    owner: null,
    stop: null,
  }));

  return {
    getOwner: () => store.getState().owner,
    subscribe: (listener: () => void) => store.subscribe(listener),
    acquire: (owner: object, stop: () => void) => {
      if (store.getState().owner !== null) return false;
      store.setState({ owner, stop });
      return true;
    },
    release: (owner: object) => {
      if (store.getState().owner === owner) store.setState({ owner: null, stop: null });
    },
    endCurrent: () => store.getState().stop?.(),
  };
}

export const arSessionCoordinator = createARSessionCoordinator();

export class ARSessionController {
  private snapshot: ARSessionSnapshot = { status: 'inactive', sessionId: 0, instruction: '' };
  private listeners = new Set<() => void>();
  private active = false;
  private requestId = 0;
  private timer: unknown;
  private unsubscribeOwner: (() => void) | undefined;
  private permissionDenied = false;
  private runtime: ARRuntime;
  private coordinator: ReturnType<typeof createARSessionCoordinator>;
  private clock: SessionClock;

  constructor(runtime: ARRuntime, coordinator = arSessionCoordinator, clock = defaultClock) {
    this.runtime = runtime;
    this.coordinator = coordinator;
    this.clock = clock;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setActive = (active: boolean) => {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.unsubscribeOwner = this.coordinator.subscribe(this.tryMount);
      void this.prepare();
    } else {
      this.invalidate();
      this.unsubscribeOwner?.();
      this.unsubscribeOwner = undefined;
      this.publish('inactive', 'AR is paused.');
      this.coordinator.release(this);
    }
  };

  retry = () => {
    if (this.active && this.snapshot.status !== 'requesting') void this.prepare();
  };

  requestCamera = async () => {
    if (!this.active || !['permission', 'denied'].includes(this.snapshot.status)) return;
    const requestId = ++this.requestId;
    this.publish('requesting', 'Waiting for camera permission.');
    try {
      const granted = await this.runtime.requestCameraPermission();
      if (!this.isCurrent(requestId)) return;
      this.permissionDenied = !granted;
      if (granted) await this.prepare();
      else this.publish('denied', 'Allow camera access in Settings, then return here.');
    } catch {
      if (this.isCurrent(requestId)) this.fail('Camera access could not be checked. Try again.');
    }
  };

  reportReady = (sessionId: number) => {
    if (!this.isLiveSession(sessionId)) return;
    this.clearTimer();
    this.publish('running', this.snapshot.instruction);
  };

  reportInstruction = (sessionId: number, instruction: string) => {
    if (this.isLiveSession(sessionId)) this.publish(this.snapshot.status, instruction);
  };

  reportError = (sessionId: number) => {
    if (this.isLiveSession(sessionId)) this.fail('The AR scene could not load. Try again.');
  };

  private publish(status: ARSessionStatus, instruction: string) {
    if (status === this.snapshot.status && instruction === this.snapshot.instruction) return;
    this.snapshot = { ...this.snapshot, status, instruction };
    this.listeners.forEach((listener) => listener());
  }

  private clearTimer() {
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = undefined;
  }

  private invalidate() {
    this.requestId++;
    this.clearTimer();
  }

  private isCurrent(requestId: number) {
    return this.active && this.requestId === requestId;
  }

  private isLiveSession(sessionId: number) {
    return (
      this.active &&
      this.coordinator.getOwner() === this &&
      this.snapshot.sessionId === sessionId &&
      ['starting', 'running'].includes(this.snapshot.status)
    );
  }

  private fail(instruction: string) {
    this.invalidate();
    this.publish('error', instruction);
    this.coordinator.release(this);
  }

  private prepare = async () => {
    this.invalidate();
    const requestId = this.requestId;
    this.publish('checking', 'Checking this device and camera access.');
    this.coordinator.release(this);
    this.timer = this.clock.schedule(() => {
      if (this.isCurrent(requestId)) this.fail('The device check took too long. Try again.');
    }, 12000);

    try {
      const support = await this.runtime.checkSupport();
      if (!this.isCurrent(requestId)) return;
      if (support !== 'supported') {
        this.clearTimer();
        this.publish(
          support,
          support === 'missing-native'
            ? 'Open this app’s development build on a physical phone.'
            : 'This device does not support camera AR.'
        );
        return;
      }

      const granted = await this.runtime.hasCameraPermission();
      if (!this.isCurrent(requestId)) return;
      this.clearTimer();
      if (!granted) {
        this.publish(
          this.permissionDenied ? 'denied' : 'permission',
          'Camera access is needed to place objects in your surroundings.'
        );
        return;
      }

      this.permissionDenied = false;
      this.publish('waiting', 'Waiting for the previous AR session to finish.');
      this.tryMount();
    } catch {
      if (this.isCurrent(requestId)) this.fail('AR could not start on this device. Try again.');
    }
  };

  private tryMount = () => {
    if (!this.active || this.snapshot.status !== 'waiting') return;
    if (!this.coordinator.acquire(this, () => this.setActive(false))) return;
    this.snapshot = { ...this.snapshot, sessionId: this.snapshot.sessionId + 1 };
    const sessionId = this.snapshot.sessionId;
    this.timer = this.clock.schedule(() => {
      if (this.isLiveSession(sessionId)) {
        this.fail('AR tracking did not start. Try again in a well-lit space.');
      }
    }, 25000);
    this.publish('starting', 'Move your phone slowly to find a table or floor.');
  };
}
