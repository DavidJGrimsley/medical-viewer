import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

export type QuestSupportStatus = 'supported' | 'unsupported' | 'missing-native';

export const QUEST_SPATIAL_PERMISSIONS = [
  'horizonos.permission.USE_ANCHOR_API',
  'com.oculus.permission.USE_SCENE',
] as const;

let spatialPermissionRequest: Promise<boolean> | undefined;

export interface QuestRuntime {
  checkSupport: () => Promise<QuestSupportStatus>;
  hasSpatialPermission: () => Promise<boolean>;
  requestSpatialPermission: () => Promise<boolean>;
}

export const nativeQuestRuntime: QuestRuntime = {
  async checkSupport(): Promise<QuestSupportStatus> {
    if (Platform.OS !== 'android') return 'unsupported';
    // OpenXR support is provided by VRModuleOpenXR and VRLauncher
    const hasVRModule = NativeModules.VRModuleOpenXR !== undefined;
    const hasVRLauncher = NativeModules.VRLauncher !== undefined;
    if (!hasVRModule && !hasVRLauncher) return 'missing-native';
    return 'supported';
  },

  async hasSpatialPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const hasAnchor = await PermissionsAndroid.check(
        'horizonos.permission.USE_ANCHOR_API' as any
      );
      if (hasAnchor) return true;
      const hasScene = await PermissionsAndroid.check('com.oculus.permission.USE_SCENE' as any);
      return hasScene;
    } catch {
      return false;
    }
  },

  requestSpatialPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return Promise.resolve(false);

    spatialPermissionRequest ??= (async () => {
      try {
        const results = (await PermissionsAndroid.requestMultiple([
          'horizonos.permission.USE_ANCHOR_API' as any,
          'com.oculus.permission.USE_SCENE' as any,
        ])) as Record<string, string>;
        const anchor =
          results['horizonos.permission.USE_ANCHOR_API'] === PermissionsAndroid.RESULTS.GRANTED;
        const scene =
          results['com.oculus.permission.USE_SCENE'] === PermissionsAndroid.RESULTS.GRANTED;
        return anchor || scene;
      } catch {
        return false;
      } finally {
        spatialPermissionRequest = undefined;
      }
    })();

    return spatialPermissionRequest;
  },
};

/**
 * Adapter implementing ARRuntime for Meta Quest without invoking ARCore or phone camera checks.
 */
export const questARRuntime = {
  checkSupport: () => nativeQuestRuntime.checkSupport(),
  hasCameraPermission: () => nativeQuestRuntime.hasSpatialPermission(),
  requestCameraPermission: () => nativeQuestRuntime.requestSpatialPermission(),
};
