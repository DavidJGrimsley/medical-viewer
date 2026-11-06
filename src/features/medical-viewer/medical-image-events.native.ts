import { Platform } from 'react-native';
import {
  isViroImageLoadSuccess as isViroImageLoadSuccessCore,
  type ViroImageCompletionEvent,
} from './medical-image-events-core.ts';

export type { ViroImageCompletionEvent };

/**
 * Thin React Native platform wrapper for ViroImage completion events.
 * Delegates directly to the pure core implementation, defaulting to Platform.OS.
 */
export function isViroImageLoadSuccess(event: unknown, platform: string = Platform.OS): boolean {
  return isViroImageLoadSuccessCore(event, platform);
}
