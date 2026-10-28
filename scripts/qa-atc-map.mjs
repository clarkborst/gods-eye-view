import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const appUrl = urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${appUrl}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => window.__godsEyeView?.styleManager?.mapStackController,
    { timeout: 60000 },
  );
  await page.click('#control-panel-toggle');
  await page.waitForSelector('[data-map-presentation="atc"]', {
    visible: true,
  });
  const before = await page.evaluate(() => {
    const app = window.__godsEyeView;
    return {
      id: app.styleManager.mapStackController.getActiveId(),
      count: app.viewer.scene.primitives.length,
    };
  });
  const assets = [];
  page.on('request', (request) => {
    if (request.url().includes('/maps/atc/')) assets.push(request.url());
  });
  if (
    await page.$eval('#control-panel', (node) =>
      node.classList.contains('collapsed'),
    )
  )
    await page.click('#control-panel-toggle');
  await page.click('[data-map-presentation="atc"]');
  await page.waitForFunction(
    () =>
      window.__godsEyeView.styleManager.mapStackController.getActiveId() ===
      'atc',
    { timeout: 60000 },
  );
  const state = await page.evaluate(async () => {
    const app = window.__godsEyeView;
    const { viewer, styleManager } = app;
    const Cesium = await import('/node_modules/.vite/deps/cesium.js');
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(10, 50, 4500000),
    });
    viewer.scene.requestRender();
    return {
      imagery: viewer.imageryLayers.length,
      lighting: viewer.scene.globe.enableLighting,
      atmosphere: viewer.scene.skyAtmosphere.show,
      id: styleManager.mapStackController.getActiveId(),
      settingsVisible: !document.getElementById('atc-map-settings').hidden,
      geographicHidden: document
        .getElementById('map-stack-chips')
        .closest('.map-source-section').hidden,
    };
  });
  assert.equal(state.id, 'atc');
  assert.equal(state.imagery, 0);
  assert.equal(state.lighting, false);
  assert.equal(state.atmosphere, false);
  assert.equal(state.settingsVisible, true);
  assert.equal(state.geographicHidden, true);
  assert.equal(assets.length, 2);
  await page.click('[data-atc-color="#55ddff"]');
  await page.$eval('[data-atc-setting="width"]', (input) => {
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(
      () =>
        window.__godsEyeView.styleManager.mapStackController.getState()
          .atcSettings.width,
    ),
    3,
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('gev:atc-map:v1')).color,
    ),
    '#55ddff',
  );
  await page.waitForFunction(
    () => window.__godsEyeView.viewer.scene.frameState.commandList.length > 0,
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await page.screenshot({ path: '/tmp/gev-atc-map.png' });
  await page.click('[data-map-presentation="geographic"]');
  await page.waitForFunction(
    (id) =>
      window.__godsEyeView.styleManager.mapStackController.getActiveId() === id,
    { timeout: 60000 },
    before.id,
  );
  assert.equal(
    await page.evaluate(
      () => document.getElementById('atc-map-settings').hidden,
    ),
    true,
  );
  if (
    await page.$eval('#control-panel', (node) =>
      node.classList.contains('collapsed'),
    )
  )
    await page.click('#control-panel-toggle');
  await page.click('[data-map-presentation="atc"]');
  await page.waitForFunction(
    () =>
      window.__godsEyeView.styleManager.mapStackController.getActiveId() ===
      'atc',
  );
  assert.equal(assets.length, 2, 'cached geometry avoids repeated downloads');
  await page.evaluate(async () => {
    const app = window.__godsEyeView;
    await app.dataManager.setEnabled('simulated-traffic', true, {
      origin: 'user',
    });
  });
  const replay = await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers
      .get('simulated-traffic')
      .module.simulation.getState(),
  );
  assert.equal(replay.vehicles.length, 6);
  assert.equal(
    await page.evaluate(() =>
      window.__godsEyeView.styleManager.mapStackController.getActiveId(),
    ),
    'atc',
  );
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForSelector('#mobile-tab-bar [data-mobile-sheet="more"]', {
    visible: true,
  });
  await page.click('#mobile-tab-bar [data-mobile-sheet="more"]');
  const mobile = await page.$eval('#atc-map-settings', (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  });
  assert.ok(
    mobile.width > 0 && mobile.left >= 0 && mobile.right <= 390,
    'ATC controls fit mobile width',
  );
  // More contains two independently scrolling regions. Check that lower ATC
  // controls can be scrolled into the dock's visible, clickable area.
  await page.$eval('[data-atc-setting="borders"]', (input) =>
    input.scrollIntoView({ block: 'center' }),
  );
  await page.click('[data-atc-setting="borders"]');
  assert.equal(
    await page.evaluate(
      () =>
        window.__godsEyeView.mapStackController.getState().atcSettings.borders,
    ),
    false,
  );
  await page.screenshot({ path: '/tmp/gev-atc-mobile.png' });
  await page.evaluate(async () => {
    const entry = [...document.scripts].find((script) =>
      /\/src\/main\.js(?:\?|$)/.test(script.src),
    );
    const { application } = await import(entry.src);
    await application.destroy();
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'PASS: self-hosted ATC controls, geometry, preferences, geographic restore, caching, replay and teardown',
  );
} finally {
  await browser.close();
}
