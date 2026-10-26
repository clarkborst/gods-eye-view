#!/usr/bin/env node
/** Verify the actual simulation UI and CZML movement against the dev server. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (error) => errors.push(error.message));
  const liveRequests = [];
  let checkingSimulation = false;
  page.on('request', (request) => {
    if (
      checkingSimulation &&
      /\/api\/(?:flights|military|vessels|adsbdb)(?:[/?]|$)/.test(request.url())
    )
      liveRequests.push(request.url());
  });
  await page.goto(`${url}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__godsEyeView?.dataManager, {
    timeout: 60_000,
  });
  const original = await page.evaluate(() => {
    const clock = window.__godsEyeView.viewer.clock;
    return {
      step: clock.clockStep,
      range: clock.clockRange,
      rate: clock.multiplier,
      playing: clock.shouldAnimate,
      detection:
        window.__godsEyeView.styleManager.getDetectionState().detectionMode,
    };
  });
  await page.click('[data-collapse-target="data-panel"]');
  const row = '[data-layer-id="simulated-traffic"]';
  const panel = `${row} .simulation-panel`;
  const button = (label) => `${panel} button[aria-label="${label}"]`;
  await page.click(`${row} .data-toggle-btn`);
  await page.waitForFunction(() => {
    const layer =
      window.__godsEyeView.dataManager.layers.get('simulated-traffic');
    return layer.enabled && layer.module.simulation.getState().active;
  });
  const state = () =>
    page.evaluate(() =>
      window.__godsEyeView.dataManager.layers
        .get('simulated-traffic')
        .module.simulation.getState(),
    );
  assert.equal((await state()).vehicles.length, 6);
  assert.equal((await state()).playing, false);
  checkingSimulation = true;
  assert.deepEqual(
    (await state()).categories.map((c) => c.id),
    ['aircraft', 'drone', 'ground-robot'],
  );
  await page.click(`${panel} > button`); // Airport overview.
  await page.waitForFunction(
    () =>
      window.__godsEyeView.viewer.camera.positionCartographic.height < 20000,
  );
  await page.waitForFunction(
    () => {
      const ready = new Set();
      const visit = (primitive) => {
        if (primitive?.ready && primitive.id?.id?.startsWith('sim:rotterdam:'))
          ready.add(primitive.id.id);
        if (
          typeof primitive?.get === 'function' &&
          Number.isInteger(primitive.length)
        ) {
          for (let i = 0; i < primitive.length; i++) visit(primitive.get(i));
        }
      };
      visit(window.__godsEyeView.viewer.scene.primitives);
      return ready.size === 5;
    },
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () => {
      const app = window.__godsEyeView;
      const diagnostic = app.styleManager.getDetectionDiagnostics();
      return (
        diagnostic?.visibleCount > 0 &&
        diagnostic?.demandByLayer?.['simulated-traffic'] > 0 &&
        diagnostic?.labelsByLayer?.['simulated-traffic'] > 0
      );
    },
    { timeout: 30000 },
  );
  const sharedIdentification = await page.evaluate(() => {
    const app = window.__godsEyeView;
    const layer = app.dataManager.layers.get('simulated-traffic').module;
    return {
      count: layer.getDetectableObjects().length,
      mode: app.styleManager.getDetectionState().detectionMode,
      diagnostics: app.styleManager.getDetectionDiagnostics(),
    };
  });
  assert.equal(sharedIdentification.count, 6);
  assert.notEqual(sharedIdentification.mode, 'OFF');
  await page.waitForFunction(
    () =>
      window.__godsEyeView.altitudeLines.getDiagnostics().byLayer[
        'simulated-traffic'
      ] > 0,
  );
  const position = () =>
    page.evaluate(() => {
      const app = window.__godsEyeView;
      const entity = app.viewer.dataSources.getByName(
        'Rotterdam aircraft — SYNTHETIC TEST DATA',
      )[0].entities.values[0];
      const p = entity.position.getValue(app.viewer.clock.currentTime);
      return [p.x, p.y, p.z];
    });
  const before = await position();
  await page.$eval(`${panel} input[type="range"]`, (node) => {
    node.value = '400';
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal((await state()).elapsed, 400);
  assert.notDeepEqual(await position(), before);
  await page.click(button('Play or pause simulation'));
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('simulated-traffic')
        .module.simulation.getState().elapsed > 400.15,
  );
  await page.click(button('Play or pause simulation'));
  const paused = await position();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(await position(), paused);
  await page.click(button('Rewind simulation'));
  const rewindStart = (await state()).elapsed;
  await page.waitForFunction(
    (from) =>
      window.__godsEyeView.dataManager.layers
        .get('simulated-traffic')
        .module.simulation.getState().elapsed <
      from - 0.15,
    {},
    rewindStart,
  );
  await page.click(button('Play or pause simulation'));
  await page.click(button('Fast forward simulation'));
  assert.equal((await state()).rate, 2);
  await page.click(button('Play or pause simulation'));
  await page.select(
    `${panel} select[aria-label="Follow simulated vehicle"]`,
    'sim:rotterdam:airliner-departure',
  );
  assert.equal(
    await page.evaluate(
      () => window.__godsEyeView.viewer.trackedEntity?.gevSimulationId,
    ),
    'sim:rotterdam:airliner-departure',
  );
  // Real canvas gestures must use the same stable follow frame as live traffic.
  const waitForFollow = () =>
    page.waitForFunction(() => {
      const viewer = window.__godsEyeView.viewer;
      const position = viewer.trackedEntity?.position?.getValue(
        viewer.clock.currentTime,
      );
      if (!position) return false;
      const transform = viewer.camera.transform;
      return (
        Math.hypot(
          transform[12] - position.x,
          transform[13] - position.y,
          transform[14] - position.z,
        ) < 2
      );
    });
  await waitForFollow();
  const targetPixel = () =>
    page.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      const position = viewer.trackedEntity.position.getValue(
        viewer.clock.currentTime,
      );
      const pixel = viewer.scene.cartesianToCanvasCoordinates(position);
      const bounds = viewer.scene.canvas.getBoundingClientRect();
      return { x: pixel.x + bounds.left, y: pixel.y + bounds.top };
    });
  const originalRange = await page.evaluate(() => {
    const p = window.__godsEyeView.viewer.camera.position;
    return Math.hypot(p.x, p.y, p.z);
  });
  assert.ok(
    originalRange > 2900,
    'live-style follow distance provides surrounding context',
  );
  // Stop following in place, then select the visible model using the actual canvas.
  const pixel = await targetPixel();
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers
      .get('simulated-traffic')
      .module.contacts.stopTracking(),
  );
  await page.mouse.click(pixel.x, pixel.y);
  await waitForFollow();
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers
      .get('simulated-traffic')
      .module.simulation.seek(420),
  );
  await waitForFollow();
  await page.evaluate(() => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.zoomIn(1000);
    viewer.scene.requestRender();
  });
  const zoomedPixel = await targetPixel();
  await page.mouse.click(zoomedPixel.x, zoomedPixel.y, { count: 2, delay: 40 });
  await waitForFollow();
  await page.waitForFunction(() => {
    const p = window.__godsEyeView.viewer.camera.position;
    return Math.hypot(p.x, p.y, p.z) > 2900;
  });
  // Double-clicking empty canvas releases the transform and the replay selection.
  await page.mouse.click(800, 720, { count: 2, delay: 40 });
  await page.waitForFunction(() => {
    const app = window.__godsEyeView;
    return (
      !app.viewer.trackedEntity &&
      !app.dataManager.layers
        .get('simulated-traffic')
        .module.contacts.getTrackedInfo() &&
      app.viewer.camera.transform[12] === 0
    );
  });
  await page.select(
    `${panel} select[aria-label="Follow simulated vehicle"]`,
    'sim:rotterdam:airliner-departure',
  );
  await page.evaluate(() =>
    window.__godsEyeView.styleManager.setPanelCollapsed(
      'global-context-panel',
      false,
    ),
  );
  await page.click('#global-context-flights-btn');
  await page.waitForFunction(
    () =>
      window.__godsEyeView.styleManager.getContextModeState().mode ===
        'flights' &&
      !window.__godsEyeView.styleManager.getContextModeState().changing,
  );
  const isolation = await page.evaluate(() => {
    const app = window.__godsEyeView;
    return {
      simulation: app.dataManager.isEnabled('simulated-traffic'),
      live: ['flights', 'military', 'local-adsb', 'ais-live-vessels'].filter(
        (id) => app.dataManager.isEnabled(id),
      ),
      snapshot: app.dataManager.layers
        .get('military-awareness')
        .module.getContextSnapshot(),
    };
  });
  assert.equal(isolation.simulation, true);
  assert.deepEqual(isolation.live, []);
  assert.ok(isolation.snapshot);
  for (const id of [
    'sim:rotterdam:airliner-departure',
    'sim:rotterdam:inspection-uav',
  ]) {
    await page.select(
      `${panel} select[aria-label="Follow simulated vehicle"]`,
      id,
    );
    await page.waitForFunction(
      () => !document.getElementById('cockpit-entry').hidden,
    );
    await page.click('#cockpit-entry');
    await page.waitForFunction(
      () => window.__godsEyeView.styleManager.cockpitView.active,
    );
    const cockpit = await page.evaluate(() => {
      const view = window.__godsEyeView.styleManager.cockpitView;
      return {
        id: view.readAircraftInfo()?.icao24,
        simulated: view.readAircraftInfo()?.simulated,
      };
    });
    assert.deepEqual(cockpit, { id, simulated: true });
    if (id === 'sim:rotterdam:airliner-departure') {
      await page.waitForFunction(() => {
        const ticks =
          window.__godsEyeView.styleManager.cockpitView.altitudeRimTicks;
        const visible = ticks.filter((tick) => !tick.hidden);
        return (
          visible.length > 1 &&
          visible.every(
            (tick, i) =>
              i === 0 ||
              tick.getBoundingClientRect().top <
                visible[i - 1].getBoundingClientRect().top,
          )
        );
      });
      const tape = await page.evaluate(() => {
        const app = window.__godsEyeView;
        const view = app.styleManager.cockpitView;
        const info = view.readAircraftInfo();
        const sample = (altitudeM) => {
          view.updateHud({ ...info, altitudeM }, performance.now(), true);
          return view.altitudeRimTicks.map((tick) => ({
            value: tick.querySelector('b').textContent,
            slot: Number(tick.style.getPropertyValue('--slot')),
          }));
        };
        const lower = sample(1000),
          higher = sample(1005);
        view.updateHud(info, performance.now(), true);
        return { lower, higher };
      });
      const sameTick = tape.higher.find(
        (tick) => tick.value === tape.lower[4].value,
      );
      assert.ok(
        sameTick && sameTick.slot < tape.lower[4].slot,
        'increasing altitude moves the same tick downward (negative CSS slot)',
      );
    }
    await page.waitForFunction(
      () =>
        document.getElementById('cockpit-clock').textContent ===
        window.__godsEyeView.styleManager.cockpitView
          .readAircraftInfo()
          .simulationTime.slice(11, 19) +
          'Z',
    );
    assert.equal(
      await page.$eval(
        '[data-context-cohort="military"]',
        (node) => node.hidden,
      ),
      true,
    );
    assert.equal(
      await page.$eval(
        '[data-context-cohort="flights"] small',
        (node) => node.textContent,
      ),
      'CZML · SIMULATION',
    );
    await page.waitForFunction(
      () => window.__godsEyeView.styleManager.cockpitView.cockpitAnchorValid,
    );
    const anchorBefore = await page.evaluate(() => {
      const a = window.__godsEyeView.styleManager.cockpitView.cockpitAnchor;
      return [a.x, a.y, a.z];
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const anchorAfter = await page.evaluate(() => {
      const a = window.__godsEyeView.styleManager.cockpitView.cockpitAnchor;
      return [a.x, a.y, a.z];
    });
    assert.deepEqual(
      anchorAfter,
      anchorBefore,
      'a paused replay must not coast in cockpit',
    );
    if (id === 'sim:rotterdam:airliner-departure') {
      await page.evaluate(() =>
        window.__godsEyeView.dataManager.layers
          .get('simulated-traffic')
          .module.simulation.seek(340),
      );
      await page.waitForFunction(() => {
        const app = window.__godsEyeView;
        const bank =
          app.styleManager.cockpitView.readAircraftInfo()?.rollDegrees || 0;
        const roll =
          ((app.viewer.camera.roll + Math.PI) % (2 * Math.PI)) - Math.PI;
        return (
          bank > 15 && Math.abs(Math.abs(roll) - (bank * Math.PI) / 180) < 0.02
        );
      });
    }
    await page.evaluate(() =>
      window.__godsEyeView.styleManager.cockpitView.exit(),
    );
  }
  await page.evaluate(() =>
    window.__godsEyeView.styleManager.setContextMode(null),
  );
  await page.select(
    `${panel} select[aria-label="Follow simulated vehicle"]`,
    'sim:rotterdam:airliner-departure',
  );
  await page.click(`${panel} .simulation-categories label:first-child input`);
  assert.equal((await state()).categories[0].visible, false);
  assert.equal(
    await page.evaluate(() => window.__godsEyeView.viewer.trackedEntity?.id),
    undefined,
  );
  await page.select(
    `${panel} select[aria-label="Simulation scenario"]`,
    'rotterdam-ground',
  );
  await page.waitForFunction(() => {
    const s = window.__godsEyeView.dataManager.layers
      .get('simulated-traffic')
      .module.simulation.getState();
    return (
      !s.loading && s.scenario === 'rotterdam-ground' && s.vehicles.length === 1
    );
  });
  await page.select(
    `${panel} select[aria-label="Simulation scenario"]`,
    'rotterdam-mixed',
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('simulated-traffic')
        .module.simulation.getState().vehicles.length === 6,
  );
  await page.$eval(`${panel} input[type="range"]`, (node) => {
    node.value = '520';
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click(`${panel} > button`);
  await page.waitForFunction(
    () =>
      window.__godsEyeView.viewer.camera.positionCartographic.height > 13000,
  );
  await page.$eval(row, (node) => {
    const scroller = node.closest('#data-toggles');
    scroller.scrollTop +=
      node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });
  assert.equal(
    await page.$eval(panel, (node) => node.scrollWidth <= node.clientWidth + 1),
    true,
    'transport must fit the narrow layer rail',
  );
  await mkdir('qa-artifacts/simulation', { recursive: true });
  await page.screenshot({ path: 'qa-artifacts/simulation/rotterdam.png' });
  const fixturePosition = await page.evaluate(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('simulated-traffic')
        .module.contacts.getAllPositions()
        .find((row) => row.id.endsWith('airliner-arrival')).position,
  );
  await page.click(`${row} .data-toggle-btn`);
  checkingSimulation = false;
  await page.waitForFunction(
    () => !window.__godsEyeView.dataManager.isEnabled('simulated-traffic'),
  );
  const restored = await page.evaluate(() => {
    const app = window.__godsEyeView;
    const clock = app.viewer.clock;
    return {
      step: clock.clockStep,
      range: clock.clockRange,
      rate: clock.multiplier,
      playing: clock.shouldAnimate,
      detection: app.styleManager.getDetectionState().detectionMode,
      active: app.dataManager.layers
        .get('simulated-traffic')
        .module.simulation.getState().active,
      hold: app.getRenderGovernorDiagnostics().holds.includes('simulation'),
    };
  });
  assert.deepEqual(restored, { ...original, active: false, hold: false });
  const liveAltitude = await page.evaluate((position) => {
    const app = window.__godsEyeView,
      manager = app.dataManager;
    const layer = manager.layers.get('flights').module;
    const originalEnabled = manager.isEnabled,
      originalObjects = layer.getDetectableObjects;
    try {
      manager.isEnabled = (id) =>
        id === 'flights' || originalEnabled.call(manager, id);
      layer.getDetectableObjects = () => [
        { type: 'AIR', sourceId: 'qa-live-altitude', position },
      ];
      app.altitudeLines.update({ force: true });
      return app.altitudeLines.getDiagnostics().byLayer.flights || 0;
    } finally {
      manager.isEnabled = originalEnabled;
      layer.getDetectableObjects = originalObjects;
      app.altitudeLines.update({ force: true });
    }
  }, fixturePosition);
  assert.equal(
    liveAltitude,
    1,
    'the same GPU renderer must accept live traffic positions without starting a feed',
  );
  const destroyed = await page.evaluate(async () => {
    const app = window.__godsEyeView;
    await app.dataManager.setEnabled('simulated-traffic', true, {
      origin: 'user',
    });
    app.dataManager.layers.get('simulated-traffic').module.simulation.play();
    const entry = [...document.scripts].find((script) =>
      /\/src\/main\.js(?:\?|$)/.test(script.src),
    );
    const { application } = await import(entry.src);
    await application.destroy().catch((error) => {
      const describe = (failure) =>
        failure.errors?.map(describe).join('; ') || failure.message;
      throw new Error(describe(error));
    });
    return {
      status: application.getState().status,
      viewerDestroyed: app.viewer.isDestroyed(),
      layers: app.dataManager.layers.size,
      holds: app.getRenderGovernorDiagnostics().holds,
    };
  });
  assert.deepEqual(destroyed, {
    status: 'destroyed',
    viewerDestroyed: true,
    layers: 0,
    holds: [],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(
    liveRequests,
    [],
    'simulation Context must never request live ADS-B/AIS traffic',
  );
  console.log(
    'PASS: canvas follow and double-click reset, altitude tape direction, GLB heading, cockpit bank, live/replay altitude poles, shared identification, replay controls, CZML-only Context, preference restoration and teardown',
  );
} finally {
  await browser.close();
}
