export interface ViroImageCompletionEvent {
  target?: number;
  currentTarget?: number;
  nativeEvent?: {
    success?: boolean | unknown;
    target?: number;
    currentTarget?: number;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/**
 * Pure core image completion adapter for ViroImage onLoadEnd across platforms.
 *
 * Contract:
 * 1. Explicit boolean success/failure is respected on all platforms:
 *    nativeEvent.success === true -> true
 *    nativeEvent.success === false -> false
 * 2. On Android, VRTImage.imageDownloadDidFinish always emits onLoadEndViro with a null
 *    payload; download failures arrive separately through onErrorViro. Any nativeEvent
 *    object without `success` is therefore a completed load (true). Only primitive or
 *    array events/payloads are rejected (false).
 * 3. On iOS (where native VRTImage emits { success: boolean }):
 *    - requires explicit valid boolean success; rejects absent/null/empty/target-only
 *      or malformed payloads as failure (false).
 *
 * Do not whitelist event or payload keys. The renderer adds its own: the SyntheticEvent has
 * _targetInst (a Fiber), and RN 0.86 Fabric mixes `target` and `timeStamp` into every native
 * payload (UIManagerBinding.cpp), so Android delivers { target, timeStamp }. Key whitelists
 * at either level failed every real slice and atlas load on Quest.
 */
export function isViroImageLoadSuccess(event: unknown, platform: string = 'android'): boolean {
  // 1. Absent or null event
  if (event === undefined || event === null) {
    return platform === 'android';
  }

  // 2. Reject unexpected primitive events and arrays
  if (typeof event !== 'object' || Array.isArray(event)) {
    return false;
  }

  // 3. Extract nativeEvent payload
  const hasNativeEvent = 'nativeEvent' in event;
  const nativeEvent = (event as ViroImageCompletionEvent).nativeEvent;

  // 4. Absent or null/undefined nativeEvent
  if (!hasNativeEvent || nativeEvent === null || nativeEvent === undefined) {
    return platform === 'android';
  }

  // 5. Malformed nativeEvent (primitives or arrays)
  if (typeof nativeEvent !== 'object' || Array.isArray(nativeEvent)) {
    return false;
  }

  // 6. Explicit boolean success contract (respected on all platforms)
  if ('success' in nativeEvent) {
    if (typeof nativeEvent.success === 'boolean') {
      return nativeEvent.success;
    }
    // Present but non-boolean success is invalid/malformed
    return false;
  }

  // 7. Without explicit 'success', only Android's null-payload completion is a success
  return platform === 'android';
}
