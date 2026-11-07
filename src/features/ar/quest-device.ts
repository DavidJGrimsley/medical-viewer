import { NativeModules, Platform } from 'react-native';

export type AndroidBuildInfo = {
  Manufacturer?: string;
  Brand?: string;
  Model?: string;
};

/**
 * Detects whether the current device is a Meta Quest headset.
 *
 * Uses the authoritative Viro device branding strings from `Platform.constants`
 * (Build.MANUFACTURER, BRAND, MODEL), not `Platform.OS` alone.
 *
 * Quest 1/2/Pro:  Manufacturer="Oculus", Brand="oculus"
 * Quest 3/3S:     Manufacturer="Meta",   Brand="meta"
 */
export function isQuestDevice(): boolean {
  if (Platform.OS !== 'android') return false;
  const constants = (Platform.constants ?? {}) as AndroidBuildInfo;
  const manufacturer = (constants.Manufacturer ?? '').toLowerCase();
  const brand = (constants.Brand ?? '').toLowerCase();
  const model = (constants.Model ?? '').toLowerCase();

  return (
    manufacturer === 'oculus' ||
    manufacturer === 'meta' ||
    brand === 'oculus' ||
    brand === 'meta' ||
    /\bquest\b/.test(model)
  );
}

/**
 * Checks whether this build includes the OpenXR VR native module.
 */
export function hasOpenXRSupport(): boolean {
  return NativeModules.VRModuleOpenXR !== undefined;
}
