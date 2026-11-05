import { useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const initialWebDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };

/** Keep the first browser render identical to the static export, then measure. */
export function useGameWindowDimensions() {
  const dimensions = useWindowDimensions();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return Platform.OS === 'web' && !hydrated ? initialWebDimensions : dimensions;
}
