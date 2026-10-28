/** Vehicle categories stay in CZML, independent of the scenario catalog. */
export function entityCategory(entity, time) {
  return String(entity.properties?.vehicleCategory?.getValue(time) || 'other');
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

/** Resolve data paths relative to their owning JSON, preserving deployment bases. */
export function scenarioAssetUrl(path, owner) {
  requireValue(
    typeof path === 'string' && path.trim(),
    'Expected a non-empty asset path',
  );
  const url = new URL(path, owner);
  requireValue(
    ['http:', 'https:'].includes(url.protocol),
    'Assets require HTTP(S) URLs',
  );
  return url.href;
}

/** Validate user-authored metadata; dates and categories remain owned by CZML. */
export function validateScenario(value, url) {
  requireValue(value?.version === 1, 'Unsupported scenario version');
  requireValue(
    typeof value.id === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(value.id),
    'Invalid scenario id',
  );
  requireValue(
    typeof value.name === 'string' && value.name.trim(),
    'Scenario name is required',
  );
  requireValue(
    value.description === undefined || typeof value.description === 'string',
    'Invalid description',
  );
  const view = value.view;
  for (const [key, min, max] of [
    ['longitude', -180, 180],
    ['latitude', -90, 90],
    ['height', 0, Infinity],
  ])
    requireValue(
      Number.isFinite(view?.[key]) && view[key] >= min && view[key] <= max,
      `Invalid view.${key}`,
    );
  for (const [key, min, max] of [
    ['heading', 0, 360],
    ['pitch', -90, 90],
  ])
    requireValue(
      view[key] === undefined ||
        (Number.isFinite(view[key]) && view[key] >= min && view[key] <= max),
      `Invalid view.${key}`,
    );
  requireValue(
    Array.isArray(value.files) && value.files.length > 0,
    'Scenario requires CZML files',
  );
  const files = value.files.map((file) => scenarioAssetUrl(file, url));
  requireValue(new Set(files).size === files.length, 'Duplicate CZML file');
  return {
    id: value.id,
    name: value.name.trim(),
    description: value.description || '',
    view: { ...view },
    files,
  };
}

/** Fetch a complete catalog transactionally; invalid entries never silently vanish. */
export async function loadScenarioCatalog({ fetchImpl, resolveAsset, signal }) {
  const catalogUrl = new URL(
    resolveAsset('/scenarios/catalog.json'),
    globalThis.location?.href || 'http://localhost/',
  ).href;
  const read = async (url) => {
    try {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      signal?.throwIfAborted();
      return value;
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`${url}: ${error.message}`);
    }
  };
  const catalog = await read(catalogUrl);
  requireValue(
    catalog?.version === 1,
    `${catalogUrl}: Unsupported catalog version`,
  );
  requireValue(
    Array.isArray(catalog.scenarios) && catalog.scenarios.length > 0,
    `${catalogUrl}: Catalog requires scenarios`,
  );
  const scenarios = [];
  for (const path of catalog.scenarios) {
    const url = scenarioAssetUrl(path, catalogUrl);
    const value = await read(url);
    try {
      scenarios.push(validateScenario(value, url));
    } catch (error) {
      throw new Error(`${url}: ${error.message}`);
    }
  }
  requireValue(
    new Set(scenarios.map((s) => s.id)).size === scenarios.length,
    `${catalogUrl}: Duplicate scenario id`,
  );
  requireValue(
    scenarios.some((s) => s.id === catalog.defaultScenario),
    `${catalogUrl}: Unknown defaultScenario`,
  );
  signal?.throwIfAborted();
  return { scenarios, defaultScenario: catalog.defaultScenario };
}
