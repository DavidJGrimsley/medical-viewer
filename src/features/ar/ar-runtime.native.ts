import { NativeModules, Platform } from 'react-native';

import type { ARRuntime } from './ar-session-controller';

function getViro() {
  // Keep native Viro imports behind the module-availability check.
  return import('@reactvision/react-viro');
}

let permissionRequest: Promise<boolean> | undefined;

export const nativeARRuntime: ARRuntime = {
  async checkSupport() {
    const nativeModule =
      Platform.OS === 'ios' ? NativeModules.VRTARUtils : NativeModules.VRTARSceneNavigatorModule;
    if (!nativeModule) return 'missing-native';

    try {
      const viro = await getViro();
      const result = await viro.isARSupportedOnDevice();
      return result.isARSupported ? 'supported' : 'unsupported';
    } catch (error) {
      if (error instanceof Error && error.message === 'UNSUPPORTED') return 'unsupported';
      throw error;
    }
  },
  async hasCameraPermission() {
    const viro = await getViro();
    const result = await viro.checkPermissions(['camera']);
    return result.camera === true;
  },
  requestCameraPermission() {
    // An iOS permission dialog temporarily backgrounds the app. Share that request
    // across remounts so a quick route switch cannot open a second dialog.
    permissionRequest ??= getViro()
      .then((viro) => viro.requestRequiredPermissions(['camera']))
      .then((result) => result.camera === true)
      .finally(() => {
        permissionRequest = undefined;
      });
    return permissionRequest;
  },
};
