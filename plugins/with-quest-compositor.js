const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withQuestCompositor(config) {
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const root = mod.modRequest.projectRoot;
      const aar = path.join(root, 'native/quest-compositor/viro_renderer-release.aar');
      if (!fs.existsSync(aar)) {
        throw new Error('Quest compositor renderer missing. Run npm run quest:build-ui first.');
      }
      fs.copyFileSync(
        aar,
        path.join(
          root,
          'node_modules/@reactvision/react-viro/android/viro_renderer/viro_renderer-release.aar'
        )
      );
      return mod;
    },
  ]);
};
