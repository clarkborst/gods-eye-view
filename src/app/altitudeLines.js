import * as Cesium from 'cesium';
import {
  registerPickOwner,
  unregisterPickOwner,
} from '../data/pickRegistry.js';

export const ALTITUDE_LINE_LIMIT = 256;
const SOURCES = ['flights', 'military', 'local-adsb', 'simulated-traffic'];

/** Surface-normal segment in ellipsoid metres; never draw an inverted pole. */
export function altitudeLineEndpoints(
  position,
  surfaceHeight,
  result = [new Cesium.Cartesian3(), new Cesium.Cartesian3()],
) {
  const cartographic = Cesium.Cartographic.fromCartesian(position);
  if (
    !cartographic ||
    !Number.isFinite(surfaceHeight) ||
    cartographic.height <= surfaceHeight + 0.5
  )
    return null;
  Cesium.Cartesian3.clone(position, result[1]);
  cartographic.height = surfaceHeight;
  Cesium.Ellipsoid.WGS84.cartographicToCartesian(cartographic, result[0]);
  return result;
}

/** One bounded, application-owned renderer for live and replay altitude poles.
 * It consumes the same displayed positions as identification brackets, so no
 * extra motion model, live feed, per-contact listener or terrain raycast exists.
 */
export function createAltitudeLines({
  viewer,
  manager,
  groundFloor,
  requestRender = () => {},
  createCollection = () => new Cesium.PolylineCollection(),
  createMaterial = () =>
    Cesium.Material.fromType('Color', {
      color: new Cesium.Color(0.25, 0.8, 1, 0.45),
    }),
  now = () => performance.now(),
}) {
  const scene = viewer?.scene;
  if (!scene?.primitives?.add)
    return {
      destroy() {},
      update() {},
      getDiagnostics: () => ({ count: 0, byLayer: {} }),
    };
  const collection = createCollection();
  scene.primitives.add(collection);
  const records = new Map();
  const pool = [];
  let destroyed = false,
    lastUpdate = -Infinity,
    lastWarm = -Infinity;
  let lastClock = null;
  let diagnostic = { count: 0, byLayer: {} };
  registerPickOwner('altitude-lines', (id) => id.startsWith('gev-altitude:'));
  const visible = (position) => {
    if (!scene.cartesianToCanvasCoordinates) return true;
    const screen = scene.cartesianToCanvasCoordinates(position);
    return (
      screen &&
      screen.x >= -16 &&
      screen.y >= -16 &&
      screen.x <=
        (scene.canvas?.clientWidth || scene.canvas?.width || Infinity) + 16 &&
      screen.y <=
        (scene.canvas?.clientHeight || scene.canvas?.height || Infinity) + 16
    );
  };
  const api = {
    update({ force = false } = {}) {
      const clock = viewer.clock;
      const pausedSeek =
        clock &&
        !clock.shouldAnimate &&
        !Cesium.JulianDate.equals(lastClock, clock.currentTime);
      const replay = manager.isEnabled('simulated-traffic');
      if (
        destroyed ||
        (!force && !pausedSeek && !replay && now() - lastUpdate < 100)
      )
        return;
      lastUpdate = now();
      if (clock)
        lastClock = Cesium.JulianDate.clone(
          clock.currentTime,
          lastClock || new Cesium.JulianDate(),
        );
      const candidates = [];
      for (const id of SOURCES) {
        if (!manager.isEnabled(id)) continue;
        const layer = manager.layers.get(id)?.module;
        let items;
        try {
          items = layer?.getDetectableObjects?.({ maxCount: 4096 }) || [];
        } catch {
          continue;
        }
        for (const item of items) {
          if (item.type !== 'AIR' || !item.position || !visible(item.position))
            continue;
          const distance = viewer.camera?.positionWC
            ? Cesium.Cartesian3.distanceSquared(
                viewer.camera.positionWC,
                item.position,
              )
            : 0;
          candidates.push({
            key: `${id}:${item.sourceId || item.id}`,
            layerId: id,
            item,
            rank: item.skipLabel ? -1 : distance,
          });
        }
      }
      candidates.sort((a, b) => a.rank - b.rank);
      const retained = new Set();
      const byLayer = {};
      const warm = [];
      const selected = candidates.slice(0, ALTITUDE_LINE_LIMIT);
      const selectedKeys = new Set(selected.map((candidate) => candidate.key));
      for (const [key, record] of records)
        if (!selectedKeys.has(key)) {
          record.line.show = false;
          pool.push(record.line);
          records.delete(key);
        }
      for (const candidate of selected) {
        const cartographic = Cesium.Cartographic.fromCartesian(
          candidate.item.position,
        );
        if (!cartographic) continue;
        const lat = Cesium.Math.toDegrees(cartographic.latitude),
          lon = Cesium.Math.toDegrees(cartographic.longitude);
        const mesh = groundFloor?.cachedMeshFloor?.(lat, lon);
        const cached = groundFloor?.cachedGroundFloor?.(lat, lon);
        const terrain = scene.globe?.getHeight?.(cartographic);
        const floor = [mesh, cached, terrain, 0].find(Number.isFinite);
        let record = records.get(candidate.key);
        if (!record) {
          const line =
            pool.pop() ||
            collection.add({
              show: false,
              width: 1.25,
              material: createMaterial(),
            });
          record = {
            line,
            buffers: [
              [new Cesium.Cartesian3(), new Cesium.Cartesian3()],
              [new Cesium.Cartesian3(), new Cesium.Cartesian3()],
            ],
            index: 0,
          };
          records.set(candidate.key, record);
        }
        record.index ^= 1;
        const positions = altitudeLineEndpoints(
          candidate.item.position,
          floor,
          record.buffers[record.index],
        );
        record.line.show = Boolean(positions);
        record.line.id = `gev-altitude:${candidate.key}`;
        if (positions) {
          record.line.positions = positions;
          byLayer[candidate.layerId] = (byLayer[candidate.layerId] || 0) + 1;
        }
        retained.add(candidate.key);
        if (!Number.isFinite(cached)) warm.push({ lat, lon });
      }
      for (const [key, record] of records)
        if (!retained.has(key)) {
          record.line.show = false;
          pool.push(record.line);
          records.delete(key);
        }
      diagnostic = {
        count: Object.values(byLayer).reduce((a, b) => a + b, 0),
        byLayer,
      };
      if (
        warm.length &&
        groundFloor?.warmGroundFloor &&
        now() - lastWarm > 2000
      ) {
        lastWarm = now();
        try {
          Promise.resolve(groundFloor.warmGroundFloor(warm))
            .then(() => {
              if (!destroyed) requestRender('altitude-ground-ready');
            })
            .catch(() => {});
        } catch {
          /* Cached/ellipsoid grounding remains available while shutting down. */
        }
      }
    },
    getDiagnostics: () => ({
      ...diagnostic,
      byLayer: { ...diagnostic.byLayer },
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeFrame?.();
      removeActivity?.();
      unregisterPickOwner('altitude-lines');
      scene.primitives.remove(collection);
      records.clear();
      pool.length = 0;
      diagnostic = { count: 0, byLayer: {} };
    },
  };
  const removeFrame = scene.preRender?.addEventListener(() => api.update());
  const removeActivity = manager.subscribeActivity?.((change) => {
    if (change.type === 'destroy-all') api.destroy();
    else if (change.type === 'visibility-settled') {
      api.update({ force: true });
      requestRender('altitude-visibility');
    }
  });
  return api;
}
