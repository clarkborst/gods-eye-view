import * as Cesium from 'cesium';

const STORAGE_KEY = 'gev:atc-map:v1';
const DEFAULTS = Object.freeze({
  color: '#55ff99',
  brightness: 0.7,
  width: 1.5,
  coastlines: true,
  borders: true,
});

/** Clamp editable preferences, including hand-edited browser storage. */
export function normalizeAtcSettings(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const number = (key, min, max) =>
    Number.isFinite(value[key])
      ? Math.max(min, Math.min(max, value[key]))
      : DEFAULTS[key];
  return {
    color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : DEFAULTS.color,
    brightness: number('brightness', 0.1, 1),
    width: number('width', 1, 4),
    coastlines: typeof value.coastlines === 'boolean' ? value.coastlines : true,
    borders: typeof value.borders === 'boolean' ? value.borders : true,
  };
}
export function readAtcSettings() {
  try {
    return normalizeAtcSettings(
      JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}'),
    );
  } catch {
    return normalizeAtcSettings();
  }
}
export function saveAtcSettings(settings) {
  try {
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeAtcSettings(settings)),
    );
  } catch {
    /* optional browser storage */
  }
}

/** Densify each shortest geodesic so no straight chord cuts through the globe.
 * Geodesics and Cartesian positions handle the antimeridian without a world-spanning line.
 */
export function atcLinePositions(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2)
    throw new Error('Invalid ATC line');
  const result = [];
  let previous;
  for (const coordinate of coordinates) {
    const [lon, lat] = coordinate;
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90
    )
      throw new Error('Invalid ATC coordinate');
    const current = Cesium.Cartographic.fromDegrees(lon, lat, 100);
    if (previous && !Cesium.Cartographic.equals(previous, current)) {
      const arc = new Cesium.EllipsoidGeodesic(previous, current);
      const count = Math.max(1, Math.ceil(arc.surfaceDistance / 20000));
      for (let i = 1; i < count; i++) {
        const sample = arc.interpolateUsingFraction(i / count);
        sample.height = 100;
        result.push(Cesium.Ellipsoid.WGS84.cartographicToCartesian(sample));
      }
    }
    result.push(Cesium.Ellipsoid.WGS84.cartographicToCartesian(current));
    previous = current;
  }
  return result;
}

/** Prepare self-hosted boundary geometry without mutating the active map. */
export async function createAtcPresentation(
  viewer,
  { signal, fetchImpl = globalThis.fetch } = {},
) {
  const base = `${import.meta.env?.BASE_URL || '/'}maps/atc/`;
  const groups = {};
  try {
    for (const name of ['coastlines', 'borders']) {
      const url = `${base}${name}.geojson`;
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const data = await response.json();
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features))
        throw new Error(`${url}: Invalid GeoJSON`);
      const collection = new Cesium.PolylineCollection();
      groups[name] = collection;
      for (const feature of data.features) {
        const geometry = feature.geometry;
        const lines =
          geometry?.type === 'LineString'
            ? [geometry.coordinates]
            : geometry?.type === 'MultiLineString'
              ? geometry.coordinates
              : null;
        if (!lines) throw new Error(`${url}: Expected line geometry`);
        for (const line of lines)
          collection.add({ positions: atcLinePositions(line) });
      }
    }
    signal?.throwIfAborted();
  } catch (error) {
    for (const group of Object.values(groups)) group.destroy();
    throw error;
  }
  let attached = false;
  let snapshot = null;
  let destroyed = false;
  const terrain = new Cesium.EllipsoidTerrainProvider();
  const capture = (object, key, value) => {
    if (!object) return;
    snapshot.push([object, key, object[key]]);
    object[key] = value;
  };
  const presentation = {
    enter(settings) {
      if (snapshot) return;
      snapshot = [];
      if (!attached) {
        for (const group of Object.values(groups))
          viewer.scene.primitives.add(group);
        attached = true;
      }
      const scene = viewer.scene;
      capture(viewer, 'terrainProvider', terrain);
      capture(
        scene.globe,
        'baseColor',
        Cesium.Color.fromCssColorString('#020807'),
      );
      capture(scene.globe, 'enableLighting', false);
      capture(scene.globe, 'showGroundAtmosphere', false);
      capture(scene.globe, 'showWaterEffect', false);
      capture(scene.globe, 'show', true);
      capture(scene.skyAtmosphere, 'show', false);
      capture(scene.skyBox, 'show', false);
      capture(scene.sun, 'show', false);
      capture(scene.moon, 'show', false);
      capture(scene.fog, 'enabled', false);
      capture(
        scene,
        'backgroundColor',
        Cesium.Color.fromCssColorString('#020807'),
      );
      presentation.setSettings(settings);
    },
    setSettings(value) {
      const settings = normalizeAtcSettings(value);
      const color = Cesium.Color.fromCssColorString(settings.color).withAlpha(
        settings.brightness,
      );
      for (const [name, group] of Object.entries(groups)) {
        group.show = !!snapshot && settings[name];
        for (let i = 0; i < group.length; i++) {
          const line = group.get(i);
          line.width = settings.width;
          line.material.uniforms.color = color;
        }
      }
      viewer.scene.requestRender?.();
    },
    exit() {
      if (!snapshot) return;
      for (const group of Object.values(groups)) group.show = false;
      for (const [object, key, value] of snapshot.reverse())
        object[key] = value;
      snapshot = null;
    },
    destroy() {
      if (destroyed) return;
      presentation.exit();
      destroyed = true;
      for (const group of Object.values(groups)) {
        if (attached) viewer.scene.primitives.remove(group);
        if (!group.isDestroyed()) group.destroy();
      }
    },
  };
  return presentation;
}
