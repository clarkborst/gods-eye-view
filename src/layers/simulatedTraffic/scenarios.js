const msg = (text) => text;
/** Static scenario descriptors. Categories come from CZML, not from this list. */
export const SIMULATION_SCENARIOS = Object.freeze([
  {
    id: 'rotterdam-mixed',
    name: msg('Rotterdam · mixed operations'),
    files: ['aircraft.czml', 'drones.czml', 'ground.czml'],
  },
  {
    id: 'rotterdam-aircraft',
    name: msg('Rotterdam · aircraft'),
    files: ['aircraft.czml'],
  },
  {
    id: 'rotterdam-drones',
    name: msg('Rotterdam · drones'),
    files: ['drones.czml'],
  },
  {
    id: 'rotterdam-ground',
    name: msg('Rotterdam · ground robots'),
    files: ['ground.czml'],
  },
]);

/** A category is arbitrary metadata; adding ground/marine vehicles needs no clock changes. */
export function entityCategory(entity, time) {
  return String(entity.properties?.vehicleCategory?.getValue(time) || 'other');
}
