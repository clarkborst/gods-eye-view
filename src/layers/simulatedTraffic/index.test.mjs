import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Clock,
  ClockStep,
  DataSourceCollection,
  EntityCollection,
  JulianDate,
  Cartesian3,
  Event,
  Matrix4,
  TrackingReferenceFrame,
} from 'cesium';
import { createSimulatedTrafficLayer } from './index.js';

// CZML's generic property decoder checks instanceof Image even for strings.
// No image loading/rendering is mocked here; the fixtures use points and labels.
globalThis.Image = class Image {};
const packets = async (file) =>
  JSON.parse(
    await readFile(
      new URL(`../../../public/scenarios/rotterdam/${file}`, import.meta.url),
      'utf8',
    ),
  );
function fixture(t, fetchImpl) {
  const holds = new Set();
  const owners = new Map();
  const viewer = {
    clock: new Clock({
      clockStep: ClockStep.TICK_DEPENDENT,
      shouldAnimate: false,
    }),
    dataSources: new DataSourceCollection(),
    entities: new EntityCollection(),
    scene: {
      preUpdate: new Event(),
      screenSpaceCameraController: { inertiaZoom: 0.8, minimumZoomDistance: 1 },
    },
    isDestroyed: () => false,
    trackedEntityChanged: new Event(),
    camera: {
      flyTo(options) {
        this.lastFlight = options;
      },
      cancelFlight() {},
      position: new Cartesian3(0, -10000, 5000),
      direction: new Cartesian3(0, 1, 0),
      transform: Matrix4.clone(Matrix4.IDENTITY),
      lookAtTransform(transform, offset) {
        Matrix4.clone(transform, this.transform);
        if (offset) Cartesian3.clone(offset, this.position);
      },
    },
  };
  let tracked;
  Object.defineProperty(viewer, 'trackedEntity', {
    get: () => tracked,
    set: (entity) => {
      if (tracked === entity) return;
      tracked = entity;
      viewer.trackedEntityChanged.raiseEvent(entity);
    },
  });
  const layer = createSimulatedTrafficLayer({
    render: {
      holdContinuousRender: (id) => holds.add(id),
      releaseContinuousRender: (id) => holds.delete(id),
      governorRequestRender() {},
    },
    picking: {
      registerPickOwner: (id, owns) => owners.set(id, owns),
      unregisterPickOwner: (id) => owners.delete(id),
    },
    resolveAsset: (url) => url,
    fetchImpl:
      fetchImpl ||
      (async (url) => ({
        ok: true,
        json: () => packets(url.split('/').at(-1)),
      })),
  });
  layer.init(viewer);
  t.after(() => layer.destroy());
  return { layer, api: layer.simulation, viewer, holds, owners };
}

test('real CZML examples load as one paused scenario with dynamic aircraft, drone and ground categories', async (t) => {
  const f = fixture(t);
  await f.layer.enable(f.viewer);
  assert.equal(f.viewer.dataSources.length, 3);
  assert.equal(f.api.getState().duration, 1200);
  assert.equal(f.api.getState().playing, false);
  assert.deepEqual(
    f.api.getState().categories.map((c) => [c.id, c.count]),
    [
      ['aircraft', 3],
      ['drone', 2],
      ['ground-robot', 1],
    ],
  );
  const aircraft = f.viewer.dataSources.get(0).entities.values[0];
  const before = aircraft.position.getValue(f.viewer.clock.currentTime);
  f.api.seek(400);
  const after = aircraft.position.getValue(f.viewer.clock.currentTime);
  assert.ok(Cartesian3.distance(before, after) > 10000);
  f.api.track(aircraft.id);
  assert.equal(f.viewer.trackedEntity.position, aircraft.position);
  assert.equal(f.viewer.trackedEntity.gevSimulationId, aircraft.id);
  f.api.setCategoryVisible('aircraft', false);
  assert.equal(aircraft.show, false);
  assert.equal(f.viewer.trackedEntity, undefined);
  assert.equal(f.viewer.dataSources.get(1).entities.values[0].show, true);
  f.api.setTrails(false);
  assert.equal(aircraft.path.show.getValue(f.viewer.clock.currentTime), false);
  f.api.play();
  assert.ok(f.holds.has('simulation'));
  await f.layer.disable();
  assert.equal(f.owners.size, 0);
  assert.equal(f.holds.size, 0);
  assert.equal(f.viewer.clock.onTick.numberOfListeners, 0);
  for (let i = 0; i < f.viewer.dataSources.length; i++)
    assert.equal(f.viewer.dataSources.get(i).show, false);
  await f.layer.enable(f.viewer);
  assert.equal(
    f.viewer.dataSources.length,
    3,
    're-enable replaces, not duplicates',
  );
});

test('failed replacement retains the previous scenario and reports the error', async (t) => {
  let fail = false;
  const f = fixture(t, async (url) =>
    fail
      ? { ok: false, status: 503 }
      : { ok: true, json: () => packets(url.split('/').at(-1)) },
  );
  await f.layer.enable(f.viewer);
  f.api.seek(200);
  fail = true;
  await assert.rejects(f.api.loadScenario('rotterdam-drones'), /503/);
  assert.equal(f.viewer.dataSources.length, 3);
  assert.equal(f.api.getState().scenario, 'rotterdam-mixed');
  assert.equal(f.api.getState().elapsed, 200);
  assert.match(f.api.getState().error, /503/);
});

test('a late scenario load cannot resurrect a disabled layer or replace a newer scenario', async (t) => {
  let unblock;
  let wait = false;
  const f = fixture(t, async (url) => {
    if (wait) {
      wait = false;
      await new Promise((resolve) => {
        unblock = resolve;
      });
    }
    return { ok: true, json: () => packets(url.split('/').at(-1)) };
  });
  await f.layer.enable(f.viewer);
  wait = true;
  const stale = f.api.loadScenario('rotterdam-drones');
  await f.api.loadScenario('rotterdam-ground');
  unblock();
  assert.equal(await stale, false);
  assert.equal(f.api.getState().scenario, 'rotterdam-ground');
  assert.equal(f.viewer.dataSources.length, 1);
  wait = true;
  const pending = f.api.loadScenario('rotterdam-aircraft');
  await f.layer.disable();
  unblock();
  assert.equal(await pending, false);
  assert.equal(f.api.getState().active, false);
  assert.equal(f.holds.size, 0);
  assert.equal(f.viewer.dataSources.length, 1);
});

test('scenario samples have unique identities, monotonic time and plausible speed envelopes', async () => {
  const ids = new Set();
  for (const file of ['aircraft.czml', 'drones.czml', 'ground.czml']) {
    const data = await packets(file);
    assert.equal(data[0].id, 'document');
    assert.equal(
      data[0].clock.interval,
      '2026-10-26T10:00:00Z/2026-10-26T10:20:00Z',
    );
    for (const entity of data.slice(1)) {
      assert.equal(ids.has(entity.id), false);
      ids.add(entity.id);
      assert.equal(entity.properties.simulated, true);
      const samples = entity.position.cartographicDegrees;
      const limit = { aircraft: 250, drone: 10, 'ground-robot': 3 }[
        entity.properties.vehicleCategory
      ];
      for (let i = 4; i < samples.length; i += 4) {
        const dt = samples[i] - samples[i - 4];
        assert.ok(dt > 0);
        const a = Cartesian3.fromDegrees(...samples.slice(i - 3, i));
        const b = Cartesian3.fromDegrees(...samples.slice(i + 1, i + 4));
        assert.ok(
          Cartesian3.distance(a, b) / dt <= limit,
          `${entity.id} segment ${i / 4} exceeds ${limit}m/s`,
        );
      }
    }
  }
});

test('malformed documents and duplicate IDs fail without taking over the viewer clock', async (t) => {
  const f = fixture(t, async () => ({
    ok: true,
    json: async () => [{ id: 'document', version: '1.0' }],
  }));
  const original = JulianDate.clone(f.viewer.clock.currentTime);
  await assert.rejects(f.layer.enable(f.viewer), /document packet/);
  assert.equal(f.api.getState().active, false);
  assert.equal(f.viewer.dataSources.length, 0);
  assert.ok(JulianDate.equals(f.viewer.clock.currentTime, original));
  const duplicate = fixture(t, async () => ({
    ok: true,
    json: () => packets('aircraft.czml'),
  }));
  await assert.rejects(
    duplicate.layer.enable(duplicate.viewer),
    /Duplicate scenario vehicle ID/,
  );
  assert.equal(duplicate.viewer.dataSources.length, 0);
  assert.equal(duplicate.api.getState().active, false);
});

test('aircraft use existing GLBs, drones use the quadcopter GLB and all contacts use shared identification', async (t) => {
  const f = fixture(t);
  await f.layer.enable(f.viewer);
  const time = f.viewer.clock.currentTime;
  const aircraft = f.viewer.dataSources.get(0).entities.values;
  const drones = f.viewer.dataSources.get(1).entities.values;
  assert.equal(aircraft[0].model.uri.getValue(time), '/models/airplane.glb');
  assert.equal(aircraft[2].model.uri.getValue(time), '/models/citation2.glb');
  assert.equal(drones[0].model.uri.getValue(time), '/models/quadcopter.glb');
  assert.equal(aircraft[0].billboard, undefined);
  assert.equal(aircraft[0].point, undefined);
  assert.ok(f.viewer.dataSources.get(2).entities.values[0].point);
  const identified = f.layer.getDetectableObjects();
  assert.equal(identified.length, 6);
  assert.equal(identified.filter((row) => row.type === 'AIR').length, 5);
  assert.equal(identified[0].sourceId, aircraft[0].id);
  assert.equal(identified[0].id, aircraft[0].name);
  assert.equal(identified[0].metric, 'CZML');
  assert.equal(
    aircraft[0].label.show.getValue(time),
    false,
    'native CZML labels must not duplicate the shared overlay',
  );
  assert.equal(f.layer.getDetectableObjects({ maxCount: 2 }).length, 2);
  assert.equal(f.layer.getDetectableObjects({ maxCount: 0 }).length, 0);
  f.api.setParams({ labels: false, modelScale: 2 });
  assert.ok(
    f.layer
      .getDetectableObjects()
      .every((row) => row.id === '' && row.metric === ''),
  );
  assert.equal(drones[0].model.scale.getValue(time), 2);
  f.api.setParams({ labels: true });
  f.api.seek(300);
  assert.equal(f.layer.contacts.getAllPositions().length, 5);
  assert.equal(f.layer.contacts.trackById(drones[0].id), true);
  const tracked = f.layer.contacts.getTrackedInfo();
  assert.equal(tracked.category, 'drone');
  assert.equal(tracked.simulated, true);
  assert.equal(tracked.simulationTime, '2026-10-26T10:05:00Z');
  assert.ok(tracked.velocityMps >= 0);
  const proxy = f.viewer.trackedEntity;
  assert.equal(f.viewer.entities.contains(proxy), true);
  proxy.show = false; // Cockpit takes ownership and hides its source contact.
  assert.equal(drones[0].model.show.getValue(time), false);
  assert.equal(
    f.layer.getDetectableObjects().some((row) => row.sourceId === drones[0].id),
    false,
  );
  assert.equal(f.layer.contacts.getTrackedInfo().icao24, drones[0].id);
  f.api.seek(500);
  assert.notEqual(f.layer.contacts.getTrackedInfo().latitude, tracked.latitude);
  await f.layer.disable();
  assert.equal(f.viewer.entities.contains(proxy), false);
  assert.deepEqual(f.layer.getDetectableObjects(), []);
});

test('replay frames in ENU, refocuses source double-clicks and releases camera resources on reset', async (t) => {
  const f = fixture(t);
  await f.layer.enable(f.viewer);
  f.api.seek(400);
  const source = f.viewer.dataSources.get(0).entities.values[0];
  f.api.track(source.id);
  const proxy = f.viewer.trackedEntity;
  assert.equal(proxy.trackingReferenceFrame, TrackingReferenceFrame.ENU);
  assert.equal(proxy.point.pixelSize.getValue(f.viewer.clock.currentTime), 1);
  assert.equal(proxy.point.color.getValue(f.viewer.clock.currentTime).alpha, 0);
  f.viewer.scene.preUpdate.raiseEvent();
  assert.ok(Cartesian3.magnitude(f.viewer.camera.position) >= 2900);
  assert.equal(f.viewer.scene.screenSpaceCameraController.inertiaZoom, 0);
  assert.equal(f.viewer.scene.preUpdate.numberOfListeners, 1);
  // Cesium's native double-click switches from the proxy to the picked source.
  f.viewer.camera.position = new Cartesian3(0, -200, 50);
  f.viewer.trackedEntity = source;
  f.viewer.scene.preUpdate.raiseEvent();
  assert.equal(f.viewer.trackedEntity, proxy);
  assert.ok(Cartesian3.magnitude(f.viewer.camera.position) >= 2900);
  assert.equal(f.viewer.scene.preUpdate.numberOfListeners, 1);
  // Empty-space double-click releases Cesium tracking before notifying us.
  f.viewer.trackedEntity = undefined;
  assert.equal(f.layer.contacts.getTrackedInfo(), null);
  assert.equal(f.viewer.entities.contains(proxy), false);
  assert.equal(f.viewer.scene.preUpdate.numberOfListeners, 0);
  assert.equal(f.viewer.scene.screenSpaceCameraController.inertiaZoom, 0.8);
  assert.equal(
    f.viewer.scene.screenSpaceCameraController.minimumZoomDistance,
    1,
  );
});

test('another camera owner clears replay selection without losing its own tracking', async (t) => {
  const f = fixture(t);
  await f.layer.enable(f.viewer);
  f.api.track(f.viewer.dataSources.get(1).entities.values[0].id);
  const proxy = f.viewer.trackedEntity;
  const other = f.viewer.entities.add({
    position: Cartesian3.fromDegrees(4.5, 52, 500),
  });
  f.viewer.trackedEntity = other;
  assert.equal(f.viewer.trackedEntity, other);
  assert.equal(f.layer.contacts.getTrackedInfo(), null);
  assert.equal(f.viewer.entities.contains(proxy), false);
  assert.equal(f.viewer.scene.preUpdate.numberOfListeners, 0);
});

test('cockpit camera handoff retains the hidden replay subject until follow is restored', async (t) => {
  const f = fixture(t);
  await f.layer.enable(f.viewer);
  f.api.track(f.viewer.dataSources.get(1).entities.values[0].id);
  const proxy = f.viewer.trackedEntity;
  proxy.show = false;
  f.viewer.trackedEntity = undefined;
  assert.equal(f.viewer.entities.contains(proxy), true);
  assert.equal(f.layer.contacts.getTrackedInfo().id, proxy.gevSimulationId);
  assert.equal(f.viewer.scene.preUpdate.numberOfListeners, 0);
  proxy.show = true;
  f.viewer.trackedEntity = proxy;
  assert.equal(f.layer.contacts.getTrackedInfo().id, proxy.gevSimulationId);
  f.layer.contacts.stopTracking();
  assert.equal(f.layer.contacts.getTrackedInfo(), null);
});

test('scenario selection automatically frames its location and starts paused at 1x', async (t) => {
  const f = fixture(t);
  await f.layer.enable(f.viewer);
  const expected = Cartesian3.fromDegrees(4.437, 51.956, 14000);
  assert.ok(
    Cartesian3.equalsEpsilon(
      f.viewer.camera.lastFlight.destination,
      expected,
      1e-10,
    ),
  );
  f.api.setRate(8);
  f.api.play();
  f.api.seek(300);
  f.viewer.camera.lastFlight = null;
  await f.api.loadScenario('rotterdam-drones');
  assert.ok(
    Cartesian3.equalsEpsilon(
      f.viewer.camera.lastFlight.destination,
      expected,
      1e-10,
    ),
  );
  assert.equal(f.api.getState().elapsed, 0);
  assert.equal(f.api.getState().playing, false);
  assert.equal(f.api.getState().rate, 1);
  f.api.play();
  assert.equal(f.api.getState().playing, true);
  assert.equal(f.api.getState().rate, 1);
});
