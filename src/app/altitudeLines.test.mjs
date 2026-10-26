import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cesium';
import {
  altitudeLineEndpoints,
  createAltitudeLines,
  ALTITUDE_LINE_LIMIT,
} from './altitudeLines.js';

function fixture(t) {
  let frame,
    activity,
    disposed = false;
  const lines = [];
  const collection = {
    add: (line) => {
      lines.push(line);
      return line;
    },
  };
  const modules = new Map();
  const enabled = new Set();
  const viewer = {
    clock: new C.Clock(),
    camera: { positionWC: C.Cartesian3.fromDegrees(4.44, 51.95, 15000) },
    scene: {
      primitives: {
        add: () => collection,
        remove: () => {
          disposed = true;
        },
      },
      preRender: {
        addEventListener: (fn) => {
          frame = fn;
          return () => {
            frame = null;
          };
        },
      },
      globe: { getHeight: () => 30 },
    },
  };
  const manager = {
    layers: modules,
    isEnabled: (id) => enabled.has(id),
    subscribeActivity: (fn) => {
      activity = fn;
      return () => {
        activity = null;
      };
    },
  };
  const service = createAltitudeLines({
    viewer,
    manager,
    createCollection: () => collection,
    createMaterial: () => ({}),
    groundFloor: { cachedGroundFloor: () => 43 },
  });
  t.after(() => service.destroy());
  const add = (id, rows) => {
    enabled.add(id);
    modules.set(id, { module: { getDetectableObjects: () => rows } });
  };
  return {
    service,
    add,
    enabled,
    lines,
    frame: () => frame?.(),
    disposed: () => disposed,
    activity: (event) => activity?.(event),
  };
}

test('height lines follow the surface normal and never extend upward from buried contacts', () => {
  const position = C.Cartesian3.fromDegrees(4.44, 51.95, 800);
  const points = altitudeLineEndpoints(position, 43);
  const a = C.Cartographic.fromCartesian(points[0]),
    b = C.Cartographic.fromCartesian(points[1]);
  assert.ok(Math.abs(a.height - 43) < 1e-6);
  assert.ok(Math.abs(b.height - 800) < 1e-6);
  assert.ok(
    Math.abs(a.latitude - b.latitude) < 1e-10 &&
      Math.abs(a.longitude - b.longitude) < 1e-10,
  );
  assert.equal(altitudeLineEndpoints(position, 900), null);
});

test('one renderer covers replay, civil, military and local ADS-B positions and releases disabled sources', (t) => {
  const f = fixture(t);
  for (const id of ['flights', 'military', 'local-adsb', 'simulated-traffic'])
    f.add(id, [
      {
        type: 'AIR',
        sourceId: id,
        position: C.Cartesian3.fromDegrees(4.44, 51.95, 1000),
      },
    ]);
  f.service.update({ force: true });
  assert.equal(f.service.getDiagnostics().count, 4);
  assert.equal(
    new Set(f.lines.map((line) => line.material)).size,
    4,
    'Cesium owns and destroys each polyline material independently',
  );
  assert.equal(f.service.getDiagnostics().byLayer['local-adsb'], 1);
  assert.ok(
    f.lines.every(
      (line) =>
        Math.abs(C.Cartographic.fromCartesian(line.positions[0]).height - 43) <
        1e-5,
    ),
  );
  f.enabled.delete('flights');
  f.service.update({ force: true });
  assert.equal(f.service.getDiagnostics().count, 3);
  assert.equal(f.lines.filter((line) => line.show).length, 3);
  f.activity({ type: 'destroy-all' });
  assert.equal(f.disposed(), true);
  assert.equal(f.service.getDiagnostics().count, 0);
});

test('active line count and geometry allocation stay bounded while the contact set changes', (t) => {
  const f = fixture(t);
  const rows = Array.from({ length: 500 }, (_, i) => ({
    type: 'AIR',
    sourceId: String(i),
    position: C.Cartesian3.fromDegrees(4.44 + i / 10000, 51.95, 1000),
  }));
  f.add('simulated-traffic', rows);
  f.service.update({ force: true });
  assert.equal(f.service.getDiagnostics().count, ALTITUDE_LINE_LIMIT);
  for (const row of rows) row.sourceId += '-new';
  f.service.update({ force: true });
  assert.equal(f.lines.length, ALTITUDE_LINE_LIMIT);
  rows[0].type = 'VEH';
  f.service.update({ force: true });
  assert.ok(
    !f.lines.some(
      (line) => line.show && line.id === 'gev-altitude:simulated-traffic:0-new',
    ),
  );
});
