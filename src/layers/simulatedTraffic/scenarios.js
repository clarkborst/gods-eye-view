const msg = (text) => text;
const ROTTERDAM_VIEW = Object.freeze({
  longitude: 4.437,
  latitude: 51.956,
  height: 14000,
});
/** Static scenario descriptors. Categories come from CZML, not from this list. */
export const SIMULATION_SCENARIOS = Object.freeze([
  {
    id: 'rotterdam-mixed',
    name: msg('Rotterdam · mixed operations'),
    view: ROTTERDAM_VIEW,
    files: ['aircraft.czml', 'drones.czml', 'ground.czml'],
  },
  {
    id: 'rotterdam-aircraft',
    name: msg('Rotterdam · aircraft'),
    view: ROTTERDAM_VIEW,
    files: ['aircraft.czml'],
  },
  {
    id: 'rotterdam-drones',
    name: msg('Rotterdam · drones'),
    view: ROTTERDAM_VIEW,
    files: ['drones.czml'],
  },
  {
    id: 'rotterdam-ground',
    name: msg('Rotterdam · ground robots'),
    view: ROTTERDAM_VIEW,
    files: ['ground.czml'],
  },
]);

/** A category is arbitrary metadata; adding ground/marine vehicles needs no clock changes. */
export function entityCategory(entity, time) {
  return String(entity.properties?.vehicleCategory?.getValue(time) || 'other');
}
