export function shouldActivateAR(
  enabled: boolean,
  focused: boolean,
  appState: string | null,
  keepSessionOnInactive = false,
  keepSessionOnBackground = false
) {
  return (
    enabled &&
    focused &&
    (appState === 'active' ||
      (keepSessionOnInactive && appState === 'inactive') ||
      keepSessionOnBackground)
  );
}
