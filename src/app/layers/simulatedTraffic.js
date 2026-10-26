import { createSimulatedTrafficLayer } from '../../layers/simulatedTraffic/index.js';
import * as render from '../../renderGovernor.js';
import * as picking from '../../data/pickRegistry.js';

export function createApplicationSimulatedTraffic({ resolveAsset } = {}) {
  return createSimulatedTrafficLayer({
    render,
    picking,
    resolveAsset:
      resolveAsset ||
      ((url) => `${import.meta.env?.BASE_URL || '/'}${url.replace(/^\//, '')}`),
  });
}
