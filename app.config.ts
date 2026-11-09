import type { ConfigContext, ExpoConfig } from 'expo/config';

export function isQuestBuildEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.APP_VARIANT === 'quest' ||
    env.QUEST_BUILD === '1' ||
    env.BUILD_VARIANT === 'quest' ||
    env.QUEST === '1'
  );
}

export function validateQuestAppId(appId: string | undefined): string {
  const trimmed = appId?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    throw new Error(
      'Quest configuration error: META_QUEST_APP_ID is required and must be a numeric Meta Application ID string (e.g. "1234567890123456").'
    );
  }
  return trimmed;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const isQuest = isQuestBuildEnv();
  let plugins = config.plugins ?? [];

  if (isQuest) {
    if (process.env.QUEST_COMPOSITOR_UI === '1') plugins.push('./plugins/with-quest-compositor');
    const questAppId = validateQuestAppId(process.env.META_QUEST_APP_ID);
    let foundViro = false;

    plugins = plugins.map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === '@reactvision/react-viro') {
        foundViro = true;
        const viroOptions = plugin[1] || {};
        return [
          '@reactvision/react-viro',
          {
            ...viroOptions,
            android: {
              ...viroOptions.android,
              xRMode: ['QUEST'],
              questAppId,
              questSupportedDevices: 'quest3|quest3s',
              questFeatures: {
                colocation: false,
                eyeTracking: false,
                passthroughCamera: false,
              },
            },
          },
        ];
      }
      return plugin;
    });

    if (!foundViro) {
      plugins.push([
        '@reactvision/react-viro',
        {
          android: {
            xRMode: ['QUEST'],
            questAppId,
            questSupportedDevices: 'quest3|quest3s',
            questFeatures: {
              colocation: false,
              eyeTracking: false,
              passthroughCamera: false,
            },
          },
          ios: {
            cameraUsagePermission:
              'Medical Viewer uses the camera to place its AR experience in your surroundings.',
          },
          provider: 'none',
        },
      ]);
    }
  }

  return {
    ...config,
    name: config.name!,
    slug: config.slug!,
    plugins: ['expo-asset', ...plugins],
  };
};
