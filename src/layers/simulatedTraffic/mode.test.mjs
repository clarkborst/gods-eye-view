import test from 'node:test';
import assert from 'node:assert/strict';
import { LayerLifecycle } from '../../data/lifecycle.js';
import { createSimulationMode } from './mode.js';

async function fixture(t) {
  const manager = new LayerLifecycle({});
  for (const id of ['flights', 'traffic', 'earthquakes'])
    manager.register({
      id,
      updateInterval: -1,
      init() {},
      enable() {},
      disable() {},
      update() {},
      destroy() {},
      getStats: () => ({}),
    });
  for (const id of ['flights', 'traffic', 'earthquakes'])
    await manager.setEnabled(id, true);
  const mode = createSimulationMode(manager);
  t.after(async () => {
    await manager.destroyAll();
    await mode.destroy();
  });
  return { manager, mode };
}

test('simulation suspends live movement, prevents competing enables and restores only prior live visibility', async (t) => {
  const { manager, mode } = await fixture(t);
  await mode.enter();
  assert.equal(manager.isEnabled('flights'), false);
  assert.equal(manager.isEnabled('traffic'), false);
  assert.equal(manager.isEnabled('earthquakes'), true);
  assert.equal(
    await manager.setEnabled('flights', true, { origin: 'user' }),
    false,
  );
  await mode.exit();
  assert.equal(manager.isEnabled('flights'), true);
  assert.equal(manager.isEnabled('traffic'), true);
});

test('explicit OFF during simulation cancels restoration and destruction cannot resurrect layers', async (t) => {
  const { manager, mode } = await fixture(t);
  await mode.enter();
  await manager.setEnabled('flights', false, { origin: 'user' });
  await mode.exit();
  assert.equal(manager.isEnabled('flights'), false);
  assert.equal(manager.isEnabled('traffic'), true);
  await mode.enter();
  await manager.destroyAll();
  await mode.exit();
  assert.equal(manager.layers.size, 0);
});

test('an aborted entry rolls back already suspended layers', async (t) => {
  const { manager, mode } = await fixture(t);
  const request = new AbortController();
  const remove = manager.subscribeActivity((change) => {
    if (change.layerId === 'flights' && change.type === 'visibility-settled')
      request.abort();
  });
  await assert.rejects(mode.enter(request.signal), { name: 'AbortError' });
  remove();
  assert.equal(manager.isEnabled('flights'), true);
  assert.equal(manager.isEnabled('traffic'), true);
});

test('Clear All exits simulation without re-enabling previously suspended live layers', async (t) => {
  const { manager, mode } = await fixture(t);
  manager.register({
    id: 'simulated-traffic',
    updateInterval: -1,
    init() {},
    enable: () => mode.enter(),
    disable: () => mode.exit(),
    update() {},
    destroy() {},
    getStats: () => ({}),
  });
  await manager.setEnabled('simulated-traffic', true, { origin: 'user' });
  assert.equal(manager.isEnabled('flights'), false);
  const result = await manager.clearSelectedLayers();
  assert.deepEqual(result.notClearedIds, []);
  assert.equal(manager.isEnabled('flights'), false);
  assert.equal(manager.isEnabled('traffic'), false);
  assert.equal(manager.isEnabled('simulated-traffic'), false);
});

test('a newer OFF request while exit restores another layer cancels the pending restoration', async (t) => {
  const { manager, mode } = await fixture(t);
  await mode.enter();
  const remove = manager.subscribeActivity((change) => {
    if (change.type === 'visibility-settled' && change.layerId === 'flights')
      void manager.setEnabled('traffic', false, { origin: 'user' });
  });
  await mode.exit();
  remove();
  assert.equal(manager.isEnabled('flights'), true);
  assert.equal(manager.isEnabled('traffic'), false);
});
