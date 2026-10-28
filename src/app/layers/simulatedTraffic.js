import { createSimulatedTrafficLayer } from '../../layers/simulatedTraffic/index.js';
import * as render from '../../renderGovernor.js';
import * as picking from '../../data/pickRegistry.js';
import { markDetectionSourcesChanged } from '../../data/detection.js';

export function createApplicationSimulatedTraffic({ resolveAsset } = {}) {
  return createSimulatedTrafficLayer({
    render: { ...render, markDetectionSourcesChanged },
    picking,
    resolveAsset:
      resolveAsset ||
      ((url) => `${import.meta.env?.BASE_URL || '/'}${url.replace(/^\//, '')}`),
  });
}
