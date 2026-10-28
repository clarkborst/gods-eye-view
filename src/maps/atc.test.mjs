import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as Cesium from 'cesium';
import {
  normalizeAtcSettings,
  orientAtcCamera,
  atcLinePositions,
  createAtcPresentation,
} from './atc.js';

// Cesium inspects browser media constructors when decoding color uniforms.
for (const name of [
  'HTMLCanvasElement',
  'HTMLImageElement',
  'ImageBitmap',
  'OffscreenCanvas',
])
  if (!(name in globalThis)) globalThis[name] = class {};

const data = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [179, 0],
            [-179, 0],
          ],
          [
            [4, 51],
            [5, 52],
          ],
        ],
      },
    },
  ],
};
const fetchImpl = async () => ({ ok: true, json: async () => data });
function fixture() {
  const primitives = new Cesium.PrimitiveCollection();
  const scene = {
    primitives,
    globe: {
      show: false,
      baseColor: Cesium.Color.BLUE,
      enableLighting: true,
      showGroundAtmosphere: true,
      showWaterEffect: true,
    },
    skyAtmosphere: { show: true },
    skyBox: { show: true },
    sun: { show: true },
    moon: { show: true },
    fog: { enabled: true },
    backgroundColor: Cesium.Color.RED,
    requestRender() {},
  };
  return { scene, terrainProvider: { original: true } };
}

test('ATC preferences clamp invalid storage and preserve independent geometry switches', () => {
  assert.deepEqual(
    normalizeAtcSettings({
      color: 'bad',
      width: 99,
      brightness: -2,
      coastlines: false,
      borders: true,
    }),
    {
      color: '#55ff99',
      width: 4,
      brightness: 0.1,
      coastlines: false,
      borders: true,
    },
  );
});

test('antimeridian lines follow the short arc and remain above the ellipsoid', () => {
  const points = atcLinePositions([
    [179, 0],
    [-179, 0],
  ]);
  assert.ok(points.length > 10);
  for (const point of points) {
    const c = Cesium.Cartographic.fromCartesian(point);
    assert.ok(Math.abs(Cesium.Math.toDegrees(c.longitude)) >= 179);
    assert.ok(Math.abs(c.height - 100) < 0.001);
  }
  for (let i = 1; i < points.length; i++)
    assert.ok(Cesium.Cartesian3.distance(points[i], points[i - 1]) <= 20001);
  assert.throws(
    () =>
      atcLinePositions([
        [181, 0],
        [0, 0],
      ]),
    /coordinate/,
  );
});

test('ATC prepares without scene changes, edits lines, restores scene and destroys resources', async () => {
  const viewer = fixture();
  const oldTerrain = viewer.terrainProvider;
  const presentation = await createAtcPresentation(viewer, { fetchImpl });
  assert.equal(viewer.scene.primitives.length, 0);
  presentation.enter(normalizeAtcSettings());
  assert.equal(viewer.scene.primitives.length, 2);
  assert.ok(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
  assert.equal(viewer.scene.skyAtmosphere.show, false);
  assert.equal(viewer.scene.globe.enableLighting, false);
  presentation.setSettings({
    color: '#ffaa00',
    width: 3,
    brightness: 0.5,
    borders: false,
  });
  assert.equal(viewer.scene.primitives.get(0).show, true);
  assert.equal(viewer.scene.primitives.get(1).show, false);
  assert.equal(viewer.scene.primitives.get(0).get(0).width, 3);
  assert.equal(
    viewer.scene.primitives.get(0).get(0).material.uniforms.color.alpha,
    0.5,
  );
  presentation.exit();
  assert.equal(viewer.terrainProvider, oldTerrain);
  assert.equal(viewer.scene.globe.baseColor, Cesium.Color.BLUE);
  assert.equal(viewer.scene.globe.show, false);
  assert.equal(viewer.scene.skyAtmosphere.show, true);
  assert.equal(viewer.scene.primitives.get(0).show, false);
  presentation.enter(normalizeAtcSettings());
  assert.equal(viewer.scene.primitives.length, 2, 'no duplicate collections');
  presentation.destroy();
  presentation.destroy();
  assert.equal(viewer.scene.primitives.length, 0);
  assert.equal(viewer.terrainProvider, oldTerrain);
});

test('missing, invalid and aborted geographic data never mutate the current scene', async () => {
  const viewer = fixture();
  await assert.rejects(
    createAtcPresentation(viewer, {
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    /404/,
  );
  await assert.rejects(
    createAtcPresentation(viewer, {
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }),
    /GeoJSON/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createAtcPresentation(viewer, { signal: controller.signal, fetchImpl }),
    /abort/i,
  );
  assert.equal(viewer.scene.primitives.length, 0);
  assert.equal(viewer.scene.globe.baseColor, Cesium.Color.BLUE);
});

test('both shipped Natural Earth datasets contain valid global line geometry', async () => {
  for (const file of ['coastlines', 'borders']) {
    const value = JSON.parse(
      await readFile(
        new URL(`../../public/maps/atc/${file}.geojson`, import.meta.url),
        'utf8',
      ),
    );
    assert.equal(value.type, 'FeatureCollection');
    assert.ok(value.features.length > 100);
    for (const f of value.features) {
      const lines =
        f.geometry.type === 'LineString'
          ? [f.geometry.coordinates]
          : f.geometry.coordinates;
      for (const line of lines) assert.ok(atcLinePositions(line).length >= 2);
    }
  }
});

for (const hasCenter of [true, false]) {
  test(`ATC camera frames north-up and top-down ${hasCenter ? 'over the current focus' : 'when looking above the horizon'}`, () => {
    const focus = Cesium.Cartesian3.fromDegrees(4.437, 51.956);
    const position = Cesium.Cartesian3.fromDegrees(4, 51, 14000);
    const calls = [];
    const viewer = {
      trackedEntity: { id: 'previous' },
      scene: {
        canvas: { clientWidth: 800, clientHeight: 600 },
        requestRender() {},
      },
      camera: {
        positionWC: position,
        pickEllipsoid(point) {
          assert.deepEqual(point, new Cesium.Cartesian2(400, 300));
          return hasCenter ? focus : undefined;
        },
        cancelFlight() {
          calls.push('cancel');
        },
        lookAtTransform(transform) {
          assert.equal(transform, Cesium.Matrix4.IDENTITY);
          assert.equal(viewer.trackedEntity, undefined);
          calls.push('world');
        },
        setView(options) {
          calls.push('view');
          this.lastView = options;
        },
      },
    };
    orientAtcCamera(viewer);
    assert.deepEqual(calls, ['cancel', 'world', 'view']);
    const view = viewer.camera.lastView;
    assert.deepEqual(view.orientation, {
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    });
    const actual = Cesium.Cartographic.fromCartesian(view.destination);
    const expected = Cesium.Cartographic.fromCartesian(
      hasCenter ? focus : position,
    );
    assert.ok(Math.abs(actual.longitude - expected.longitude) < 1e-10);
    assert.ok(Math.abs(actual.latitude - expected.latitude) < 1e-10);
    const height = hasCenter
      ? Cesium.Cartesian3.distance(position, focus)
      : 14000;
    assert.ok(Math.abs(actual.height - height) < 0.001);
  });
}
