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
  assert.deepEqual(
    (await state()).categories.map((c) => c.id),
    ['aircraft', 'drone', 'ground-robot'],
  );
  await page.click(`${panel} > button`); // Airport overview.
  await page.waitForFunction(
    () =>
      window.__godsEyeView.viewer.camera.positionCartographic.height < 20000,
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
    await page.evaluate(() => window.__godsEyeView.viewer.trackedEntity?.id),
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
  await page.click(`${row} .data-toggle-btn`);
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
      active: app.dataManager.layers
        .get('simulated-traffic')
        .module.simulation.getState().active,
      hold: app.getRenderGovernorDiagnostics().holds.includes('simulation'),
    };
  });
  assert.deepEqual(restored, { ...original, active: false, hold: false });
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
    await application.destroy();
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
  console.log(
    'PASS: real CZML loading, aircraft/drone/ground categories, UI seeking, pause, reverse, fast-forward, tracking, filters, scenario replacement, clock restoration and active-playback teardown',
  );
} finally {
  await browser.close();
}
