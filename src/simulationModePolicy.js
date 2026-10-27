/** Replay is an explicit layer-owned mode, independent of Context sessions. */
export const SIMULATION_LAYER_ID = 'simulated-traffic';
export const LIVE_MOVEMENT_LAYERS = Object.freeze([
  'flights',
  'military',
  'local-adsb',
  'satellites',
  'rocket-launches',
  'ais-live-vessels',
  'traffic',
  'transit',
  'bikeshare',
]);

export function contextModeOwnedExclusions(
  manager,
  preserveMovementState = false,
) {
  const replay =
    manager.isEffectivelyEnabled?.(SIMULATION_LAYER_ID) ||
    manager.isEnabled?.(SIMULATION_LAYER_ID);
  return [
    SIMULATION_LAYER_ID,
    ...(replay || preserveMovementState ? LIVE_MOVEMENT_LAYERS : []),
  ];
}
