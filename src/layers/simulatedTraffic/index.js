import * as Cesium from 'cesium';
import { createSimulationPlayback } from './playback.js';
import { createSimulationMode } from './mode.js';
import { SIMULATION_SCENARIOS, entityCategory } from './scenarios.js';
import { createSimulationContacts } from './contacts.js';

const msg = (text) => text;

/** CZML entity layer: category-independent playback, visibility and tracking. */
export function createSimulatedTrafficLayer({
  render,
  picking,
  resolveAsset,
  fetchImpl = globalThis.fetch,
}) {
  let viewer = null;
  let mode = null;
  let enabled = false;
  let loading = false;
  let error = null;
  let generation = 0;
  let request = null;
  let sources = [];
  let selectedScenario = SIMULATION_SCENARIOS[0].id;
  let loadedScenario = null;
  let trails = true;
  let categoryVisibility = new Map();
  const listeners = new Set();
  const entities = () => sources.flatMap((source) => source.entities.values);
  const notify = () => {
    for (const listener of listeners) listener(api.getState());
  };
  const playback = createSimulationPlayback({ render, onChange: notify });
  const contacts = createSimulationContacts({
    getViewer: () => viewer,
    getEntities: entities,
    isActive: () => enabled,
    isVisible: (entity) =>
      categoryVisibility.get(
        entityCategory(entity, viewer?.clock.currentTime),
      ) !== false,
    render,
    resolveAsset,
  });
  const removeSource = (source) => {
    if (!viewer?.dataSources.remove(source, true)) source.destroy?.();
  };
  const applyVisibility = () => {
    const time = viewer?.clock.currentTime;
    for (const entity of entities()) {
      entity.show =
        categoryVisibility.get(entityCategory(entity, time)) !== false;
      if (entity.path) entity.path.show = trails;
      if (!entity.show && viewer.trackedEntity === entity)
        viewer.trackedEntity = undefined;
    }
    render.governorRequestRender('simulation-visibility');
    render.markDetectionSourcesChanged?.('simulation-visibility');
    if (!contacts.getTrackedInfo()) contacts.stopTracking();
    notify();
  };
  const api = {
    play: playback.play,
    pause: playback.pause,
    seek: playback.seek,
    setRate: playback.setRate,
    setLoop: playback.setLoop,
    getState() {
      const time = viewer?.clock.currentTime;
      const categories = new Map();
      const vehicles = [];
      for (const entity of entities()) {
        if (!entity.position) continue;
        const id = entityCategory(entity, time);
        categories.set(id, (categories.get(id) || 0) + 1);
        vehicles.push({
          id: entity.id,
          name: entity.name || entity.id,
          category: id,
          visible: entity.show,
        });
      }
      return {
        ...playback.getState(),
        enabled,
        loading,
        error,
        trails,
        scenario: selectedScenario,
        scenarios: SIMULATION_SCENARIOS,
        categories: [...categories].map(([id, count]) => ({
          id,
          count,
          visible: categoryVisibility.get(id) !== false,
        })),
        vehicles,
        trackedId:
          contacts.getTrackedInfo()?.id || viewer?.trackedEntity?.id || '',
        ...contacts.getParams(),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(api.getState());
      return () => listeners.delete(listener);
    },
    async loadScenario(id, { signal } = {}) {
      const scenario = SIMULATION_SCENARIOS.find((item) => item.id === id);
      if (!scenario) throw new Error('Unknown simulation scenario');
      selectedScenario = id;
      if (!enabled) {
        notify();
        return;
      }
      request?.abort();
      const current = new AbortController();
      request = current;
      const abort = () => current.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) current.abort();
      const epoch = ++generation;
      const staged = [];
      loading = true;
      error = null;
      playback.pause();
      notify();
      try {
        for (const file of scenario.files) {
          const url = resolveAsset(`/scenarios/rotterdam/${file}`);
          const response = await fetchImpl(url, { signal: current.signal });
          if (!response.ok) throw new Error(`Scenario HTTP ${response.status}`);
          const packets = await response.json();
          if (
            !Array.isArray(packets) ||
            packets[0]?.id !== 'document' ||
            !packets[0]?.clock?.interval
          )
            throw new Error(
              'CZML requires a document packet with a clock interval',
            );
          const data = await Cesium.CzmlDataSource.load(packets, {
            sourceUri: url,
          });
          staged.push(data);
          if (
            !data.clock ||
            !Cesium.JulianDate.lessThan(
              data.clock.startTime,
              data.clock.stopTime,
            )
          )
            throw new Error('CZML document requires a valid clock interval');
          current.signal.throwIfAborted();
          for (const entity of data.entities.values) {
            if (entity.position && !entity.orientation)
              entity.orientation = new Cesium.VelocityOrientationProperty(
                entity.position,
              );
            contacts.style(entity);
          }
        }
        if (generation !== epoch || !enabled) return false;
        const ids = new Set();
        for (const data of staged)
          for (const entity of data.entities.values) {
            if (ids.has(entity.id))
              throw new Error(`Duplicate scenario vehicle ID: ${entity.id}`);
            ids.add(entity.id);
          }
        const start = staged.reduce(
          (a, s) =>
            Cesium.JulianDate.lessThan(s.clock.startTime, a)
              ? s.clock.startTime
              : a,
          staged[0].clock.startTime,
        );
        const stop = staged.reduce(
          (a, s) =>
            Cesium.JulianDate.greaterThan(s.clock.stopTime, a)
              ? s.clock.stopTime
              : a,
          staged[0].clock.stopTime,
        );
        for (const data of staged) {
          data.show = false;
          await viewer.dataSources.add(data);
          current.signal.throwIfAborted();
          if (generation !== epoch || !enabled) return false;
        }
        // Commit as a unit: a failed replacement leaves the old scenario usable.
        contacts.stopTracking();
        viewer.trackedEntity = undefined;
        for (const data of sources) removeSource(data);
        sources = staged.splice(0);
        loadedScenario = id;
        categoryVisibility = new Map();
        playback.enter(viewer, start, stop);
        for (const data of sources) data.show = true;
        applyVisibility();
        api.overview();
        return true;
      } catch (failure) {
        if (generation === epoch && !current.signal.aborted) {
          selectedScenario = loadedScenario || id;
          error = String(failure.message || failure);
          throw failure;
        }
        return false;
      } finally {
        signal?.removeEventListener('abort', abort);
        for (const data of staged) removeSource(data);
        if (generation === epoch) {
          loading = false;
          request = null;
          notify();
        }
      }
    },
    setCategoryVisible(id, visible) {
      categoryVisibility.set(id, Boolean(visible));
      applyVisibility();
    },
    setTrails(value) {
      trails = Boolean(value);
      applyVisibility();
    },
    track(id) {
      if (!enabled || loading) return;
      if (contacts.trackById(id, { origin: 'user' })) {
        notify();
        return;
      }
      contacts.stopTracking();
      const entity = entities().find((candidate) => candidate.id === id);
      if (entity?.show && entity.isAvailable(viewer.clock.currentTime))
        viewer.trackedEntity = entity;
      else viewer.trackedEntity = undefined;
      render.governorRequestRender('simulation-track');
      notify();
    },
    overview() {
      if (!enabled || !viewer) return;
      contacts.stopTracking();
      viewer.trackedEntity = undefined;
      const view = SIMULATION_SCENARIOS.find(
        (scenario) => scenario.id === loadedScenario,
      )?.view;
      if (!view) return;
      viewer.camera.cancelFlight?.();
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          view.longitude,
          view.latitude,
          view.height,
        ),
        duration: 1.2,
      });
    },
    setParams(params) {
      contacts.setParams(params);
      notify();
    },
  };
  const layer = {
    id: 'simulated-traffic',
    name: msg('Simulated Traffic'),
    icon: '✈',
    source: 'CZML · SIMULATION',
    updateInterval: -1,
    attachDataManager(manager) {
      mode = createSimulationMode(manager);
    },
    init(target) {
      viewer = target;
    },
    async enable(target, { signal } = {}) {
      viewer = target;
      await mode?.enter(signal);
      signal?.throwIfAborted();
      enabled = true;
      await api.loadScenario(selectedScenario, { signal });
      signal?.throwIfAborted();
      contacts.attach();
      picking?.registerPickOwner(layer.id, (id) =>
        entities().some((entity) => entity.id === id),
      );
      notify();
    },
    update() {
      return true;
    },
    async disable() {
      contacts.detach();
      enabled = false;
      ++generation;
      request?.abort();
      request = null;
      loading = false;
      for (const data of sources) data.show = false;
      playback.exit();
      picking?.unregisterPickOwner(layer.id);
      notify();
      await mode?.exit();
    },
    async destroy() {
      await layer.disable();
      for (const data of sources) removeSource(data);
      sources = [];
      await mode?.destroy();
      mode = null;
      playback.destroy();
      listeners.clear();
      viewer = null;
    },
    getStats() {
      return {
        count: entities().filter((e) => e.position).length,
        loading,
        error,
        source: 'CZML · SIMULATION',
      };
    },
    getRowControls() {
      return { simulation: api, chips: [] };
    },
    getDetectableObjects(options) {
      return contacts.getDetectableObjects(options);
    },
    simulation: api,
    contacts,
  };
  return layer;
}
