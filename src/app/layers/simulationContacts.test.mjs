import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationContactServices } from './simulationContacts.js';
import { createDependencies } from '../../layers/awareness/dependencies.js';
import { createQueries } from '../../layers/awareness/queries.js';
import { cockpitEntryAllowed } from '../../contextModePolicy.js';

function fixture() {
  let active = false;
  let liveReads = 0;
  const live = Object.freeze({
    getAllPositions() {
      liveReads++;
      return [{ id: 'live-adsb' }];
    },
    getNearby() {
      liveReads++;
      return [{ id: 'live-adsb' }];
    },
    getTrackedInfo() {
      liveReads++;
      return { id: 'live-adsb' };
    },
  });
  const simulation = {
    simulation: {
      getState: () => ({ enabled: active, current: '2026-10-26T10:05:00Z' }),
    },
    getStats: () => ({ count: 5 }),
    contacts: {
      getAllPositions: () => [{ id: 'sim-plane' }, { id: 'sim-drone' }],
      getNearby: () => [{ id: 'sim-drone' }],
      getTrackedInfo: () => ({ id: 'sim-drone', simulated: true }),
    },
  };
  const services = createSimulationContactServices({
    simulation,
    flights: live,
    military: live,
    vessels: live,
    installations: live,
  });
  return {
    services,
    setActive: (value) => {
      active = value;
    },
    liveReads: () => liveReads,
  };
}

test('Context reads CZML contacts exclusively even when disabled live sources retain ADS-B records', () => {
  const f = fixture();
  assert.equal(f.services.flights.getAllPositions()[0].id, 'live-adsb');
  const before = f.liveReads();
  f.setActive(true);
  assert.deepEqual(
    f.services.flights.getAllPositions().map((row) => row.id),
    ['sim-plane', 'sim-drone'],
  );
  assert.equal(f.services.flights.getTrackedInfo().simulated, true);
  for (const source of ['military', 'vessels', 'installations']) {
    assert.deepEqual(f.services[source].getNearby(), []);
    assert.deepEqual(f.services[source].getAllPositions(), []);
    assert.equal(f.services[source].getTrackedInfo(), null);
  }
  assert.equal(
    f.liveReads(),
    before,
    'no live source may be read during replay',
  );
  f.setActive(false);
  assert.equal(f.services.flights.getAllPositions()[0].id, 'live-adsb');
});

test('opening Context during simulation never starts any live dependency or reads its lifecycle stats', async () => {
  const f = fixture();
  f.setActive(true);
  const dataManager = new Proxy(
    {},
    {
      get() {
        throw new Error('Live dependency access');
      },
    },
  );
  const dependencies = createDependencies({
    state: { enabled: true, dataManager },
    services: f.services,
    parts: {},
  });
  await dependencies.enableDependencies();
  const queries = createQueries({
    state: { dataManager },
    services: f.services,
    parts: {},
  });
  const states = queries.collectSourceStates();
  assert.equal(states.flights.stats.count, 2);
  assert.equal(states.military.stats.count, 0);
  assert.equal(states.flights.stats.source, 'CZML · SIMULATION');
  assert.equal(f.liveReads(), 0);
  assert.equal(
    cockpitEntryAllowed({
      contextMode: 'flights',
      simulationEnabled: true,
      flightsEnabled: false,
      militaryEnabled: false,
    }),
    true,
  );
  assert.equal(
    cockpitEntryAllowed({ contextMode: null, simulationEnabled: true }),
    false,
  );
});
