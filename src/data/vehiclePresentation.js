/** Single source for aircraft detection, cockpit and replay path colors.
 * UAS paths use cyan; UAS detection and cockpit accents use magenta.
 */
export const VEHICLE_PRESENTATION = Object.freeze({
  civil: Object.freeze({
    detection: '#22e0ff',
    cockpit: '#22e0ff',
    path: '#22e0ff',
  }),
  military: Object.freeze({
    detection: '#ffb347',
    cockpit: '#ffb347',
    path: '#ffb347',
  }),
  uas: Object.freeze({
    detection: '#ff00ff',
    cockpit: '#ff00ff',
    path: '#22e0ff',
  }),
});

/** Legacy input aliases remain readable; new data and UI use UAS. */
export function normalizeAircraftKind(kind) {
  return ['drone', 'uav', 'uas'].includes(kind) ? 'uas' : kind;
}

/** UAS presentation takes precedence while military metadata stays intact. */
export function vehicleTier(info = {}) {
  if (
    [info.tier, info.category, info.aircraftClass].some(
      (kind) => normalizeAircraftKind(kind) === 'uas',
    )
  )
    return 'uas';
  return info.military === true ||
    info.tier === 'military' ||
    info.layerId === 'military'
    ? 'military'
    : 'civil';
}

/** Inline accent wins over sensor-theme CSS, including Cyber. */
export function applyCockpitVehiclePresentation(hud, info) {
  if (!hud) return;
  const tier = vehicleTier(info);
  hud.dataset.tier = tier;
  hud.style.setProperty('--cockpit-accent', VEHICLE_PRESENTATION[tier].cockpit);
}
