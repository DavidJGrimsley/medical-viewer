export function shouldActivateAR(
  enabled: boolean,
  focused: boolean,
  appState: string | null,
  keepSessionOnInactive = false
) {
  return (
    enabled &&
    focused &&
    (appState === 'active' || (keepSessionOnInactive && appState === 'inactive'))
  );
}
