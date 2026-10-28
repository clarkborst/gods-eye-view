import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextControls } from './contextControls.js';
import { LayerLifecycle } from '../data/lifecycle.js';
import { createSimulationMode } from '../layers/simulatedTraffic/mode.js';
import {
  LIVE_MOVEMENT_LAYERS,
  contextModeOwnedExclusions,
} from '../simulationModePolicy.js';
import {
  contextSnapshotLayerIds,
  contextRestoreLayerIds,
} from '../contextModePolicy.js';

async function fixture(t) {
  const manager = new LayerLifecycle({});
  const requests = [];
  manager.subscribeVisibilityRequests((change) => requests.push(change));
  let replay = false;
  for (const id of [...LIVE_MOVEMENT_LAYERS, 'military-installations'])
    manager.register({
      id,
      updateInterval: -1,
      init() {},
      update() {},
      enable() {},
      disable() {},
      destroy() {},
      getStats: () => ({}),
      setParams() {},
    });
  const mode = createSimulationMode(manager);
  manager.register({
    id: 'simulated-traffic',
    updateInterval: -1,
    init() {},
    update() {},
    async enable() {
      await mode.enter();
      replay = true;
    },
    async disable() {
      replay = false;
      await mode.exit();
    },
    getStats: () => ({}),
  });
  const owned = new Set();
  manager.register({
    id: 'military-awareness',
    updateInterval: -1,
    init() {},
    update() {},
    setParams() {},
    async enable() {
      if (replay) return;
      for (const id of ['flights', 'military'])
        if (!manager.isEnabled(id)) {
          owned.add(id);
          await manager.setEnabled(id, true);
        }
    },
    async disable() {
      for (const id of owned) await manager.setEnabled(id, false);
      owned.clear();
    },
    getStats: () => ({}),
  });
  const controls = new ContextControls({
    elements: {},
    installations: {},
    actions: {
      getCockpit: () => null,
      claimVisualAuthority() {},
      showToast() {},
      setClearBusy() {},
      syncDetection() {},
      scheduleLayout() {},
      refreshRadio() {},
      setPanelCollapsed() {},
    },
  });
  controls.connect(manager);
  t.after(async () => {
    controls.stop();
    controls.disconnect();
    await manager.destroyAll();
    await mode.destroy();
  });
  return { manager, controls, requests };
}

test('Contacts follows the explicit live/replay switch without restoring a stale simulation snapshot', async (t) => {
  const { manager, controls, requests } = await fixture(t);
  await manager.setEnabled('flights', true, { origin: 'user' });
  assert.equal((await controls.setContextMode('flights')).ok, true);
  assert.equal(manager.isEnabled('simulated-traffic'), false);
  await manager.setEnabled('simulated-traffic', true, { origin: 'user' });
  await controls._waitForContextLayerSettlement();
  assert.equal(manager.isEnabled('simulated-traffic'), true);
  assert.ok(LIVE_MOVEMENT_LAYERS.every((id) => !manager.isEnabled(id)));
  assert.equal((await controls.setContextMode('flights')).ok, true);
  assert.ok(LIVE_MOVEMENT_LAYERS.every((id) => !manager.isEnabled(id)));
  await manager.setEnabled('simulated-traffic', false, { origin: 'user' });
  await controls._waitForContextLayerSettlement();
  assert.equal(
    manager.isEnabled('flights'),
    true,
    'pre-replay live selection is retained',
  );
  assert.equal(manager.isEnabled('simulated-traffic'), false);
  assert.equal((await controls.setContextMode('flights')).ok, true);
  assert.equal(manager.isEnabled('flights'), true);
  assert.equal(manager.isEnabled('military'), true);
  assert.equal(manager.isEnabled('simulated-traffic'), false);
  assert.equal((await controls.setContextMode(null)).ok, true);
  assert.equal(manager.isEnabled('simulated-traffic'), false);
  assert.deepEqual(
    requests
      .filter((r) => r.layerId === 'simulated-traffic' && r.enabled)
      .map((r) => r.origin),
    ['user'],
  );
});

test('every live movement source remains blocked until replay is explicitly switched off', async (t) => {
  const { manager, controls } = await fixture(t);
  await manager.setEnabled('simulated-traffic', true, { origin: 'user' });
  for (const id of LIVE_MOVEMENT_LAYERS)
    assert.equal(
      await manager.setEnabled(id, true, { origin: 'user' }),
      false,
      id,
    );
  assert.equal((await controls.setContextMode('flights')).ok, true);
  assert.equal((await controls.setContextMode(null)).ok, true);
  assert.equal(
    manager.isEnabled('simulated-traffic'),
    true,
    'Context exit cannot turn replay off',
  );
  await manager.setEnabled('simulated-traffic', false, { origin: 'user' });
  controls.stop();
  controls.disconnect();
  for (const id of LIVE_MOVEMENT_LAYERS)
    assert.equal(
      await manager.setEnabled(id, true, { origin: 'user' }),
      true,
      id,
    );
});

test('Context cannot turn replay off to enter Space Missions, and the replay switch can leave Space Missions', async (t) => {
  const { manager, controls } = await fixture(t);
  assert.equal((await controls.setContextMode('space-missions')).ok, true);
  await manager.setEnabled('simulated-traffic', true, { origin: 'user' });
  await controls._waitForContextLayerSettlement();
  assert.equal(manager.isEnabled('simulated-traffic'), true);
  assert.equal(controls.getContextModeState().mode, null);
  assert.ok(LIVE_MOVEMENT_LAYERS.every((id) => !manager.isEnabled(id)));
  assert.equal((await controls.setContextMode('space-missions')).ok, false);
  assert.equal(manager.isEnabled('simulated-traffic'), true);
  assert.ok(LIVE_MOVEMENT_LAYERS.every((id) => !manager.isEnabled(id)));
});

test('Context never captures or resurrects the explicit replay toggle, including legacy snapshots', () => {
  assert.deepEqual(
    [...contextSnapshotLayerIds(['flights', 'simulated-traffic'])],
    ['flights'],
  );
  assert.deepEqual(
    [
      ...contextRestoreLayerIds({
        enabledLayerIds: ['simulated-traffic', 'radio'],
        userAdded: ['simulated-traffic'],
      }),
    ],
    ['radio'],
  );
});

test('movement stays protected while replay is entering or leaving', () => {
  for (const [pending, committed] of [
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const excluded = contextModeOwnedExclusions({
      isEffectivelyEnabled: () => pending,
      isEnabled: () => committed,
    });
    assert.ok(LIVE_MOVEMENT_LAYERS.every((id) => excluded.includes(id)));
  }
  assert.deepEqual(
    contextModeOwnedExclusions({
      isEffectivelyEnabled: () => false,
      isEnabled: () => false,
    }),
    ['simulated-traffic'],
  );
});
