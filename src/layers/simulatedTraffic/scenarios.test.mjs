import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScenarioCatalog, validateScenario } from './scenarios.js';

const descriptor = (id = 'tokyo') => ({
  version: 1,
  id,
  name: 'Tokyo replay',
  view: {
    longitude: 139.8,
    latitude: 35.6,
    height: 9000,
    heading: 75,
    pitch: -45,
  },
  files: ['vehicles.czml', '../shared/uas.czml'],
});
function repository(documents, signal) {
  const calls = [];
  return {
    calls,
    load: () =>
      loadScenarioCatalog({
        resolveAsset: () => 'https://example.com/app/scenarios/catalog.json',
        signal,
        fetchImpl: async (url, options) => {
          calls.push([url, options.signal]);
          const value = documents[url.split('/app/scenarios/')[1]];
          return {
            ok: value !== undefined,
            status: 404,
            json: async () => value,
          };
        },
      }),
  };
}
const catalog = {
  version: 1,
  defaultScenario: 'tokyo',
  scenarios: ['tokyo/replay.json'],
};

test('catalog order, global location, authored names and deployment-relative assets are preserved', async () => {
  const controller = new AbortController();
  const repo = repository(
    { 'catalog.json': catalog, 'tokyo/replay.json': descriptor() },
    controller.signal,
  );
  const result = await repo.load();
  assert.equal(result.defaultScenario, 'tokyo');
  assert.equal(result.scenarios[0].name, 'Tokyo replay');
  assert.deepEqual(result.scenarios[0].view, descriptor().view);
  assert.deepEqual(result.scenarios[0].files, [
    'https://example.com/app/scenarios/tokyo/vehicles.czml',
    'https://example.com/app/scenarios/shared/uas.czml',
  ]);
  assert.ok(repo.calls.every(([, signal]) => signal === controller.signal));
});

for (const [name, change, pattern] of [
  [
    'version',
    (d) => {
      d.version = 2;
    },
    /version/,
  ],
  [
    'id',
    (d) => {
      d.id = 'bad id';
    },
    /id/,
  ],
  [
    'name',
    (d) => {
      d.name = ' ';
    },
    /name/,
  ],
  [
    'latitude',
    (d) => {
      d.view.latitude = 91;
    },
    /latitude/,
  ],
  [
    'longitude',
    (d) => {
      d.view.longitude = NaN;
    },
    /longitude/,
  ],
  [
    'height',
    (d) => {
      d.view.height = -1;
    },
    /height/,
  ],
  [
    'pitch',
    (d) => {
      d.view.pitch = 100;
    },
    /pitch/,
  ],
  [
    'empty files',
    (d) => {
      d.files = [];
    },
    /files/,
  ],
  [
    'duplicate files',
    (d) => {
      d.files = ['a.czml', './a.czml'];
    },
    /Duplicate/,
  ],
  [
    'invalid URL',
    (d) => {
      d.files = ['javascript:alert(1)'];
    },
    /HTTP/,
  ],
]) {
  test(`invalid ${name} produces an authoring error`, () => {
    const value = descriptor();
    change(value);
    assert.throws(
      () => validateScenario(value, 'https://example.com/replay.json'),
      pattern,
    );
  });
}

test('catalog rejects duplicates, empty lists, unknown defaults and unsupported versions', async () => {
  for (const [override, pattern] of [
    [{ version: 2 }, /version/],
    [{ scenarios: [] }, /requires scenarios/],
    [{ defaultScenario: 'missing' }, /defaultScenario/],
    [
      { scenarios: ['tokyo/replay.json', 'other.json'] },
      /Duplicate scenario id/,
    ],
  ]) {
    const repo = repository({
      'catalog.json': { ...catalog, ...override },
      'tokyo/replay.json': descriptor(),
      'other.json': descriptor(),
    });
    await assert.rejects(repo.load(), pattern);
  }
});

test('errors identify missing or invalid descriptor files and aborted work cannot commit', async () => {
  await assert.rejects(
    repository({ 'catalog.json': catalog }).load(),
    /tokyo\/replay.json: HTTP 404/,
  );
  await assert.rejects(
    repository({ 'catalog.json': catalog, 'tokyo/replay.json': {} }).load(),
    /tokyo\/replay.json: Unsupported/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    repository(
      { 'catalog.json': catalog, 'tokyo/replay.json': descriptor() },
      controller.signal,
    ).load(),
    /abort/i,
  );
});
