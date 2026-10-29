import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VEHICLE_PRESENTATION,
  vehicleTier,
  normalizeAircraftKind,
} from './vehiclePresentation.js';
import { updateHud } from '../ui/cockpitInstruments.js';

test('canonical UAS identity accepts legacy categories and classes with military precedence', () => {
  for (const alias of ['uas', 'drone', 'uav']) {
    assert.equal(normalizeAircraftKind(alias), 'uas');
    assert.equal(vehicleTier({ category: alias, military: true }), 'uas');
    assert.equal(
      vehicleTier({ aircraftClass: alias, layerId: 'military' }),
      'uas',
    );
  }
  assert.equal(vehicleTier({ military: true, layerId: 'flights' }), 'military');
  assert.equal(vehicleTier({}), 'civil');
});

test('cockpit HUD updates accent on each subject switch regardless of historical flights layer', () => {
  const properties = new Map();
  const owner = {
    hud: {
      dataset: {},
      style: { setProperty: (key, value) => properties.set(key, value) },
    },
    speedRimTicks: [],
    altitudeRimTicks: [],
    lastContextUpdateMs: 100,
    updateRoute() {},
  };
  for (const info of [
    { tier: 'civil' },
    { military: true },
    { aircraftClass: 'uas', military: true },
    { tier: 'civil' },
  ]) {
    updateHud.call(owner, { layerId: 'flights', ...info }, 100);
    const tier = vehicleTier(info);
    assert.equal(owner.hud.dataset.tier, tier);
    assert.equal(
      properties.get('--cockpit-accent'),
      VEHICLE_PRESENTATION[tier].cockpit,
    );
  }
});
