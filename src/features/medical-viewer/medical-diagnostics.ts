/** Developer volume diagnostics (shader test patterns, renderer probes) are not viewer settings.
 * Development builds show them; a release build includes them only when bundled with
 * EXPO_PUBLIC_MEDICAL_DIAGNOSTICS=1 (for example in .env.local). Expo inlines this at bundle time. */
export const MEDICAL_DIAGNOSTICS_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_MEDICAL_DIAGNOSTICS === '1';
