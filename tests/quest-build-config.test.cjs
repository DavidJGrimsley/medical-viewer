const assert = require('node:assert/strict');
const { test } = require('node:test');

const baseAppJson = require('../app.json');
const { default: configFactory, isQuestBuildEnv, validateQuestAppId } = require('../app.config.ts');

test('identifies quest build flags correctly from environment', () => {
  assert.equal(isQuestBuildEnv({}), false);
  assert.equal(isQuestBuildEnv({ APP_VARIANT: 'quest' }), true);
  assert.equal(isQuestBuildEnv({ QUEST_BUILD: '1' }), true);
  assert.equal(isQuestBuildEnv({ BUILD_VARIANT: 'quest' }), true);
  assert.equal(isQuestBuildEnv({ QUEST: '1' }), true);
  assert.equal(isQuestBuildEnv({ APP_VARIANT: 'production' }), false);
});

test('validates numeric Meta Quest application ID', () => {
  assert.equal(validateQuestAppId('1234567890123456'), '1234567890123456');
  assert.equal(validateQuestAppId('  9876543210  '), '9876543210');

  assert.throws(
    () => validateQuestAppId(undefined),
    /META_QUEST_APP_ID is required and must be a numeric Meta Application ID string/
  );
  assert.throws(
    () => validateQuestAppId(''),
    /META_QUEST_APP_ID is required and must be a numeric Meta Application ID string/
  );
  assert.throws(
    () => validateQuestAppId('abc-not-numeric'),
    /META_QUEST_APP_ID is required and must be a numeric Meta Application ID string/
  );
});

test('retains standard AR and camera configuration for non-Quest builds', () => {
  const origVariant = process.env.APP_VARIANT;
  const origQuest = process.env.QUEST_BUILD;
  delete process.env.APP_VARIANT;
  delete process.env.QUEST_BUILD;
  delete process.env.QUEST;
  delete process.env.BUILD_VARIANT;

  try {
    const config = configFactory({ config: baseAppJson.expo });
    const viroPlugin = config.plugins.find(
      (p) => Array.isArray(p) && p[0] === '@reactvision/react-viro'
    );
    assert.ok(viroPlugin);
    assert.deepEqual(viroPlugin[1].android.xRMode, ['AR']);
    assert.equal(viroPlugin[1].android.questAppId, undefined);
  } finally {
    if (origVariant) process.env.APP_VARIANT = origVariant;
    if (origQuest) process.env.QUEST_BUILD = origQuest;
  }
});

test('fails with clear error when Quest build is active but META_QUEST_APP_ID is missing', () => {
  const origVariant = process.env.APP_VARIANT;
  const origAppId = process.env.META_QUEST_APP_ID;
  process.env.APP_VARIANT = 'quest';
  delete process.env.META_QUEST_APP_ID;

  try {
    assert.throws(
      () => configFactory({ config: baseAppJson.expo }),
      /Quest configuration error: META_QUEST_APP_ID is required and must be a numeric Meta Application ID string/
    );
  } finally {
    if (origVariant) process.env.APP_VARIANT = origVariant;
    else delete process.env.APP_VARIANT;
    if (origAppId) process.env.META_QUEST_APP_ID = origAppId;
    else delete process.env.META_QUEST_APP_ID;
  }
});

test('configures QUEST mode, target devices, and disables unused capabilities on Quest build', () => {
  const origVariant = process.env.APP_VARIANT;
  const origAppId = process.env.META_QUEST_APP_ID;
  process.env.APP_VARIANT = 'quest';
  process.env.META_QUEST_APP_ID = '1234567890123456';

  try {
    const config = configFactory({ config: baseAppJson.expo });
    const viroPlugin = config.plugins.find(
      (p) => Array.isArray(p) && p[0] === '@reactvision/react-viro'
    );
    assert.ok(viroPlugin);
    assert.deepEqual(viroPlugin[1].android.xRMode, ['QUEST']);
    assert.equal(viroPlugin[1].android.questAppId, '1234567890123456');
    assert.equal(viroPlugin[1].android.questSupportedDevices, 'quest3|quest3s');
    assert.deepEqual(viroPlugin[1].android.questFeatures, {
      colocation: false,
      eyeTracking: false,
      passthroughCamera: false,
    });
  } finally {
    if (origVariant) process.env.APP_VARIANT = origVariant;
    else delete process.env.APP_VARIANT;
    if (origAppId) process.env.META_QUEST_APP_ID = origAppId;
    else delete process.env.META_QUEST_APP_ID;
  }
});
