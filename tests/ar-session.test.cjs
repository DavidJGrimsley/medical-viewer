const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ARSessionController,
  createARSessionCoordinator,
} = require('../src/features/ar/ar-session-controller.ts');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(overrides = {}, coordinator = createARSessionCoordinator()) {
  const pending = new Map();
  const calls = { support: 0, checkCamera: 0, requestCamera: 0 };
  const permissions = { granted: true };
  const clock = {
    schedule(callback, delay) {
      const handle = Symbol('timer');
      pending.set(handle, { callback, delay });
      return handle;
    },
    cancel: (handle) => pending.delete(handle),
  };
  const runtime = {
    async checkSupport() {
      calls.support++;
      return 'supported';
    },
    async hasCameraPermission() {
      calls.checkCamera++;
      return permissions.granted;
    },
    async requestCameraPermission() {
      calls.requestCamera++;
      permissions.granted = true;
      return true;
    },
    ...overrides,
  };
  const controller = new ARSessionController(runtime, coordinator, clock);
  return { controller, coordinator, pending, calls, permissions };
}

test('checks camera without prompting and waits for explicit permission', async () => {
  const h = harness();
  h.permissions.granted = false;
  h.controller.setActive(true);
  await flush();
  assert.equal(h.controller.getSnapshot().status, 'permission');
  assert.equal(h.calls.requestCamera, 0);
  assert.equal(h.coordinator.getOwner(), null);
  assert.equal(h.pending.size, 0);
  await h.controller.requestCamera();
  assert.equal(h.controller.getSnapshot().status, 'starting');
  assert.equal(h.calls.requestCamera, 1);
  h.controller.setActive(false);
});

for (const support of ['unsupported', 'missing-native']) {
  test(`${support} never requests camera or claims a navigator`, async () => {
    const h = harness({ checkSupport: async () => support });
    h.controller.setActive(true);
    await flush();
    assert.equal(h.controller.getSnapshot().status, support);
    assert.equal(h.calls.checkCamera, 0);
    assert.equal(h.calls.requestCamera, 0);
    assert.equal(h.coordinator.getOwner(), null);
    assert.equal(h.pending.size, 0);
    h.controller.setActive(false);
  });
}

test('denied permission remains recoverable and is rechecked after Settings', async () => {
  const h = harness({ requestCameraPermission: async () => false });
  h.permissions.granted = false;
  h.controller.setActive(true);
  await flush();
  await h.controller.requestCamera();
  assert.equal(h.controller.getSnapshot().status, 'denied');
  h.controller.setActive(false);
  h.permissions.granted = true;
  h.controller.setActive(true);
  await flush();
  assert.equal(h.controller.getSnapshot().status, 'starting');
  h.controller.setActive(false);
});

test('Home/background during a device check ignores its late response', async () => {
  const support = deferred();
  const h = harness({ checkSupport: () => support.promise });
  h.controller.setActive(true);
  assert.equal(h.controller.getSnapshot().status, 'checking');
  h.controller.setActive(false);
  support.resolve('supported');
  await flush();
  assert.equal(h.controller.getSnapshot().status, 'inactive');
  assert.equal(h.calls.checkCamera, 0);
  assert.equal(h.coordinator.getOwner(), null);
  assert.equal(h.pending.size, 0);
});

test('permission dialog backgrounding ignores old callbacks and resumes from actual permission', async () => {
  const permission = deferred();
  const h = harness({ requestCameraPermission: () => permission.promise });
  h.permissions.granted = false;
  h.controller.setActive(true);
  await flush();
  const request = h.controller.requestCamera();
  h.controller.setActive(false);
  permission.resolve(true);
  await request;
  assert.equal(h.controller.getSnapshot().status, 'inactive');
  h.permissions.granted = true;
  h.controller.setActive(true);
  await flush();
  assert.equal(h.controller.getSnapshot().status, 'starting');
  h.controller.setActive(false);
});

test('two screens can own only one navigator and hand off on teardown', async () => {
  const coordinator = createARSessionCoordinator();
  const first = harness({}, coordinator);
  const second = harness({}, coordinator);
  first.controller.setActive(true);
  await flush();
  const staleSession = first.controller.getSnapshot().sessionId;
  second.controller.setActive(true);
  await flush();
  assert.equal(coordinator.getOwner(), first.controller);
  assert.equal(second.controller.getSnapshot().status, 'waiting');
  first.controller.setActive(false);
  assert.equal(coordinator.getOwner(), second.controller);
  assert.equal(second.controller.getSnapshot().status, 'starting');
  first.controller.reportReady(staleSession);
  assert.equal(first.controller.getSnapshot().status, 'inactive');
  coordinator.endCurrent();
  assert.equal(second.controller.getSnapshot().status, 'inactive');
  assert.equal(coordinator.getOwner(), null);
  assert.equal(first.pending.size + second.pending.size, 0);
});

test('restarting invalidates old scene callbacks', async () => {
  const h = harness();
  h.controller.setActive(true);
  await flush();
  const oldId = h.controller.getSnapshot().sessionId;
  h.controller.retry();
  await flush();
  const newId = h.controller.getSnapshot().sessionId;
  assert.ok(newId > oldId);
  h.controller.reportError(oldId);
  h.controller.reportInstruction(oldId, 'stale scene');
  h.controller.reportReady(oldId);
  assert.equal(h.controller.getSnapshot().status, 'starting');
  assert.notEqual(h.controller.getSnapshot().instruction, 'stale scene');
  h.controller.reportReady(newId);
  assert.equal(h.controller.getSnapshot().status, 'running');
  assert.equal(h.pending.size, 0);
  h.controller.setActive(false);
});

test('scene failure releases the camera and Retry starts a new session', async () => {
  const h = harness();
  h.controller.setActive(true);
  await flush();
  const oldId = h.controller.getSnapshot().sessionId;
  h.controller.reportError(oldId);
  assert.equal(h.controller.getSnapshot().status, 'error');
  assert.equal(h.coordinator.getOwner(), null);
  assert.equal(h.pending.size, 0);
  h.controller.retry();
  await flush();
  assert.equal(h.controller.getSnapshot().status, 'starting');
  assert.ok(h.controller.getSnapshot().sessionId > oldId);
  h.controller.setActive(false);
});

test('a hung device check times out and ignores a late successful response', async () => {
  const support = deferred();
  const h = harness({ checkSupport: () => support.promise });
  h.controller.setActive(true);
  const timer = [...h.pending.values()][0];
  assert.equal(timer.delay, 12000);
  timer.callback();
  assert.equal(h.controller.getSnapshot().status, 'error');
  support.resolve('supported');
  await flush();
  assert.equal(h.controller.getSnapshot().status, 'error');
  assert.equal(h.coordinator.getOwner(), null);
  h.controller.setActive(false);
});

test('a hung scene times out, releases camera ownership, and ignores its late readiness', async () => {
  const h = harness();
  h.controller.setActive(true);
  await flush();
  const id = h.controller.getSnapshot().sessionId;
  const timer = [...h.pending.values()][0];
  assert.equal(timer.delay, 25000);
  timer.callback();
  h.controller.reportReady(id);
  assert.equal(h.controller.getSnapshot().status, 'error');
  assert.equal(h.coordinator.getOwner(), null);
  assert.equal(h.pending.size, 0);
  h.controller.setActive(false);
});

test('duplicate activation and permission taps do not duplicate requests', async () => {
  const permission = deferred();
  let requests = 0;
  const h = harness({
    requestCameraPermission: () => {
      requests++;
      return permission.promise;
    },
  });
  h.permissions.granted = false;
  h.controller.setActive(true);
  h.controller.setActive(true);
  await flush();
  const request = h.controller.requestCamera();
  await h.controller.requestCamera();
  assert.equal(requests, 1);
  assert.equal(h.calls.support, 1);
  permission.reject(new Error('native request failed'));
  await request;
  assert.equal(h.controller.getSnapshot().status, 'error');
  h.controller.setActive(false);
  h.controller.retry();
  assert.equal(h.controller.getSnapshot().status, 'inactive');
});

test('background/resume releases the session and uses a fresh scene identity', async () => {
  const h = harness();
  h.controller.setActive(true);
  await flush();
  const oldId = h.controller.getSnapshot().sessionId;
  h.controller.reportReady(oldId);
  h.controller.setActive(false);
  assert.equal(h.coordinator.getOwner(), null);
  h.controller.setActive(true);
  await flush();
  assert.ok(h.controller.getSnapshot().sessionId > oldId);
  h.controller.reportError(oldId);
  assert.equal(h.controller.getSnapshot().status, 'starting');
  h.controller.setActive(false);
});

test('immediate scene readiness cancels the startup timeout', async () => {
  const h = harness();
  const unsubscribe = h.controller.subscribe(() => {
    const snapshot = h.controller.getSnapshot();
    if (snapshot.status === 'starting') h.controller.reportReady(snapshot.sessionId);
  });
  h.controller.setActive(true);
  await flush();
  assert.equal(h.controller.getSnapshot().status, 'running');
  assert.equal(h.pending.size, 0);
  unsubscribe();
  h.controller.setActive(false);
});
