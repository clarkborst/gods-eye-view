/** Route the existing Context aircraft slots to CZML while replay is active.
 * Never fall through to cached live records during simulation, including for
 * sources that have just been disabled but still retain their last snapshot.
 */
export function createSimulationContactServices({
  simulation,
  flights,
  military,
  vessels,
  installations,
}) {
  const active = () => simulation.simulation.getState().enabled;
  const empty = {
    getNearby: () => [],
    getAllPositions: () => [],
    getTrackedSubject: () => null,
    getTrackedInfo: () => null,
    hasContact: () => false,
    trackById: () => false,
    refocusTrackedById: () => false,
    stopTracking() {},
    clearSelection() {},
    setContextAnchor() {},
    getStats: () => ({ count: 0, source: 'CZML · SIMULATION' }),
  };
  const route = (live, replay) =>
    new Proxy(
      {},
      {
        get(_target, key) {
          const owner = active() ? replay : live;
          const value = owner[key];
          return typeof value === 'function' ? value.bind(owner) : value;
        },
      },
    );
  const replay = new Proxy(simulation.contacts, {
    get(target, key) {
      if (key === 'getStats') return () => simulation.getStats();
      return target[key];
    },
  });
  return {
    flights: route(flights, replay),
    military: route(military, empty),
    vessels: route(vessels, empty),
    installations: route(installations, empty),
    simulation,
  };
}
