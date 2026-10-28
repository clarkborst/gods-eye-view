#!/usr/bin/env node
/** Exercise real Context/cockpit handoffs using a deterministic live ADS-B fixture. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    const now = Math.floor(Date.now() / 1000);
    if (path === '/api/flights')
      return void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          time: now,
          states: [
            [
              'abc123',
              'LIVE RTM',
              'Netherlands',
              now,
              now,
              4.44,
              51.95,
              1800,
              false,
              100,
              240,
              0,
              null,
              1843,
              '1200',
              false,
              0,
              3,
            ],
          ],
        }),
      });
    if (path === '/api/military')
      return void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ now, ac: [] }),
      });
    return void request.continue();
  });
  await page.goto('http://127.0.0.1:4173/?welcome=0', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__godsEyeView?.dataManager, {
    timeout: 60000,
  });
  await page.evaluate(async () => {
    const app = window.__godsEyeView;
    window.__modeRequests = [];
    app.dataManager.subscribeVisibilityRequests((change) =>
      window.__modeRequests.push({
        layerId: change.layerId,
        enabled: change.enabled,
        origin: change.origin,
      }),
    );
    await app.dataManager.setEnabled('flights', true, { origin: 'user' });
  });
  const openContacts = async () => {
    await page.evaluate(() =>
      window.__godsEyeView.styleManager.setPanelCollapsed(
        'global-context-panel',
        false,
      ),
    );
    await page.click('#global-context-flights-btn');
    await page.waitForFunction(() => {
      const context = window.__godsEyeView.styleManager.getContextModeState();
      return context.mode === 'flights' && !context.changing;
    });
  };
  const enterLiveCockpit = async () => {
    await page.waitForFunction(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('flights')
          .module.hasContact('abc123'),
      { timeout: 60000 },
    );
    assert.equal(
      await page.evaluate(() =>
        window.__godsEyeView.dataManager.layers
          .get('flights')
          .module.trackById('abc123'),
      ),
      true,
    );
    await openContacts();
    await page.waitForFunction(
      () => !document.getElementById('cockpit-entry').hidden,
    );
    await page.click('#cockpit-entry');
    await page.waitForFunction(
      () => window.__godsEyeView.styleManager.cockpitView.active,
    );
    const subject = await page.evaluate(() => {
      const app = window.__godsEyeView,
        info = app.styleManager.cockpitView.readAircraftInfo();
      return {
        id: info?.icao24,
        replay: !!info?.simulated,
        enabled: app.dataManager.isEnabled('simulated-traffic'),
      };
    });
    assert.deepEqual(subject, { id: 'abc123', replay: false, enabled: false });
  };
  await enterLiveCockpit();
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('simulated-traffic', true, {
      origin: 'user',
    }),
  );
  await page.waitForFunction(() => {
    const app = window.__godsEyeView;
    return (
      app.dataManager.isEnabled('simulated-traffic') &&
      !app.styleManager.getContextModeState().changing &&
      !app.styleManager.cockpitView.active
    );
  });
  const liveIds = [
    'flights',
    'military',
    'local-adsb',
    'satellites',
    'rocket-launches',
    'ais-live-vessels',
    'traffic',
    'transit',
    'bikeshare',
  ];
  const blocked = await page.evaluate(async (ids) => {
    const manager = window.__godsEyeView.dataManager;
    const enabled = ids.filter((id) => manager.isEnabled(id));
    const allowed = [];
    for (const id of ids)
      if (await manager.setEnabled(id, true, { origin: 'user' }))
        allowed.push(id);
    return { enabled, allowed };
  }, liveIds);
  assert.deepEqual(blocked, { enabled: [], allowed: [] });
  await openContacts();
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers
      .get('simulated-traffic')
      .module.contacts.trackById('sim:rotterdam:airliner-departure', {
        origin: 'user',
      }),
  );
  await page.waitForFunction(
    () => !document.getElementById('cockpit-entry').hidden,
  );
  await page.click('#cockpit-entry');
  await page.waitForFunction(
    () => window.__godsEyeView.styleManager.cockpitView.active,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__godsEyeView.styleManager.cockpitView.readAircraftInfo()
          ?.simulated,
    ),
    true,
  );
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('simulated-traffic', false, {
      origin: 'user',
    }),
  );
  await page.waitForFunction(() => {
    const app = window.__godsEyeView;
    return (
      !app.dataManager.isEnabled('simulated-traffic') &&
      app.dataManager.isEnabled('flights') &&
      !app.styleManager.getContextModeState().changing &&
      !app.styleManager.cockpitView.active
    );
  });
  await enterLiveCockpit();
  await page.evaluate(async () => {
    const app = window.__godsEyeView;
    app.styleManager.cockpitView.exit();
    await app.styleManager.setContextMode(null);
  });
  assert.deepEqual(
    await page.evaluate(() =>
      window.__modeRequests
        .filter((r) => r.layerId === 'simulated-traffic' && r.enabled)
        .map((r) => r.origin),
    ),
    ['user'],
  );
  assert.equal(
    await page.evaluate(() =>
      window.__godsEyeView.dataManager.isEnabled('simulated-traffic'),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: live cockpit, explicit replay isolation, replay cockpit, return to live cockpit, no Context-triggered replay activation',
  );
} finally {
  await browser.close();
}
