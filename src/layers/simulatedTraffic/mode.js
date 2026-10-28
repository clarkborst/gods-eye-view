import { LIVE_MOVEMENT_LAYERS } from '../../simulationModePolicy.js';
export { LIVE_MOVEMENT_LAYERS } from '../../simulationModePolicy.js';
const msg = (text) => text;
const ORIGIN = 'simulation-mode';
export function createSimulationMode(manager) {
  let active = false;
  let tearingDown = false;
  const restore = new Set();
  const removeGuard = manager.addVisibilityGuard(({ layerId, enabled }) =>
    active && enabled && LIVE_MOVEMENT_LAYERS.includes(layerId)
      ? msg('Exit simulation mode before enabling live movement')
      : null,
  );
  const removeRequests = manager.subscribeVisibilityRequests(
    ({ layerId, enabled, origin }) => {
      // Respect explicit OFF/Clear All while the layer is temporarily suspended.
      if (!enabled && origin !== ORIGIN) restore.delete(layerId);
    },
  );
  const removeActivity = manager.subscribeActivity(({ type }) => {
    if (type === 'destroy-all') tearingDown = true;
  });
  return {
    async enter(signal) {
      if (active) return;
      active = true;
      try {
        for (const id of LIVE_MOVEMENT_LAYERS) {
          signal?.throwIfAborted();
          if (!manager.isEffectivelyEnabled(id)) continue;
          restore.add(id);
          await manager.setEnabled(id, false, { origin: ORIGIN });
          if (manager.isEnabled(id)) throw new Error(`Could not suspend ${id}`);
        }
        signal?.throwIfAborted();
      } catch (error) {
        await this.exit();
        throw error;
      }
    },
    async exit() {
      active = false;
      const ids = [...restore];
      if (tearingDown || manager.isLayerInClearBatch('simulated-traffic')) {
        restore.clear();
        return;
      }
      for (const id of ids) {
        // A newer OFF request during another layer's restoration wins too.
        if (!restore.delete(id)) continue;
        if (manager.layers.has(id))
          await manager.setEnabled(id, true, { origin: ORIGIN });
      }
    },
    async destroy() {
      await this.exit();
      removeGuard();
      removeRequests();
      removeActivity();
    },
  };
}
