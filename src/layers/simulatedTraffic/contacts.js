import * as Cesium from 'cesium';
import { classifyAircraft } from '../../data/aircraftClass.js';
import { applyTrackedCameraFrame } from '../../data/trackedCamera.js';
import {
  bindTrackingClickGesture,
  isTrackingSelectionGesture,
  isTrackingClickGesture,
} from '../../data/trackingClickGesture.js';
import {
  pickContact,
  resolvePickId,
  isOwnedByOtherLayer,
} from '../../data/pickRegistry.js';
import { entityCategory } from './scenarios.js';
import { simulationModelSpec, simulationModelOrientation } from './models.js';

/** Replay contact adapter for the existing aircraft/Context interface.
 * The historical `flights` identity slot is shared with Context, but every
 * descriptor carries simulated=true and CZML provenance; no ADS-B data is read.
 */
export function createSimulationContacts({
  getViewer,
  getEntities,
  isActive,
  isVisible,
  render,
  resolveAsset = (url) => url,
  eventTarget = globalThis.window,
}) {
  let selectedId = null;
  let proxy = null;
  let handler = null;
  let removeTracked = null;
  let stopCameraFrame = null;
  let labels = true;
  let modelScale = 1;
  const detectionObjects = new Map();
  const air = (entity, time) =>
    ['aircraft', 'drone'].includes(entityCategory(entity, time));
  const value = (entity, key, time) => entity.properties?.[key]?.getValue(time);
  const emit = (type, detail) => {
    if (eventTarget?.dispatchEvent && typeof CustomEvent !== 'undefined')
      eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
  };
  const getEntity = (id) => getEntities().find((entity) => entity.id === id);
  function describe(entity) {
    const viewer = getViewer();
    const time = viewer?.clock.currentTime;
    if (
      !isActive() ||
      !entity?.position ||
      !air(entity, time) ||
      !isVisible(entity) ||
      !entity.isAvailable(time)
    )
      return null;
    const position = entity.position.getValue(time);
    if (!position) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    const start = Cesium.JulianDate.greaterThan(time, viewer.clock.startTime)
      ? Cesium.JulianDate.addSeconds(time, -0.5, new Cesium.JulianDate())
      : time;
    const stop = Cesium.JulianDate.lessThan(time, viewer.clock.stopTime)
      ? Cesium.JulianDate.addSeconds(time, 0.5, new Cesium.JulianDate())
      : time;
    const a = entity.position.getValue(start) || position;
    const b = entity.position.getValue(stop) || position;
    const dt = Cesium.JulianDate.secondsDifference(stop, start);
    const velocityMps = dt > 0 ? Cesium.Cartesian3.distance(a, b) / dt : 0;
    const delta = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3());
    const inverse = Cesium.Matrix4.inverseTransformation(
      Cesium.Transforms.eastNorthUpToFixedFrame(position),
      new Cesium.Matrix4(),
    );
    const local = Cesium.Matrix4.multiplyByPointAsVector(
      inverse,
      delta,
      new Cesium.Cartesian3(),
    );
    const track =
      velocityMps > 0.01
        ? (Cesium.Math.toDegrees(Math.atan2(local.x, local.y)) + 360) % 360
        : Number(value(entity, 'heading', time)) || 0;
    const category = entityCategory(entity, time);
    const aircraftClass =
      category === 'drone'
        ? 'uav'
        : value(entity, 'aircraftClass', time) ||
          classifyAircraft({ typeCode: value(entity, 'typeCode', time) });
    return {
      id: entity.id,
      icao24: entity.id,
      layerId: 'flights',
      sourceLayerId: 'simulated-traffic',
      callsign: entity.name || entity.id,
      label: entity.name || entity.id,
      source: 'CZML · SIMULATION',
      simulated: true,
      category,
      aircraftClass,
      position,
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      altitudeM: cartographic.height,
      velocityMps,
      speedMps: velocityMps,
      speedKts: velocityMps * 1.94384,
      track,
      heading: track,
      rollDegrees: Number(value(entity, 'roll', time)) || 0,
      verticalRateMps:
        dt > 0
          ? (Cesium.Cartographic.fromCartesian(b).height -
              Cesium.Cartographic.fromCartesian(a).height) /
            dt
          : 0,
      stale: false,
      onGround: false,
      simulationTime: Cesium.JulianDate.toIso8601(time),
    };
  }
  function frameCamera() {
    stopCameraFrame?.();
    const viewer = getViewer();
    stopCameraFrame = viewer?.scene?.preUpdate
      ? applyTrackedCameraFrame(viewer, proxy, proxy.viewFrom)
      : null;
  }
  const api = {
    isSimulationActive: isActive,
    describe,
    style(entity) {
      const viewer = getViewer();
      const time = viewer.clock.currentTime;
      // The shared identification overlay owns labels for every replay vehicle.
      if (entity.label) entity.label.show = false;
      if (!entity.position || !air(entity, time)) return;
      const category = entityCategory(entity, time);
      const kind =
        value(entity, 'aircraftClass', time) ||
        classifyAircraft({ typeCode: value(entity, 'typeCode', time) });
      const spec = simulationModelSpec(category, kind);
      entity.point = undefined;
      entity.billboard = undefined;
      entity.orientation = simulationModelOrientation(entity);
      entity.model = new Cesium.ModelGraphics({
        uri: resolveAsset(spec.url),
        scale: new Cesium.CallbackProperty(() => modelScale, false),
        minimumPixelSize: new Cesium.CallbackProperty(
          () => spec.minimumPixelSize * modelScale,
          false,
        ),
        maximumScale: new Cesium.CallbackProperty(
          () => spec.maximumScale * modelScale,
          false,
        ),
        color: new Cesium.CallbackProperty(
          () =>
            selectedId === entity.id ? Cesium.Color.CYAN : Cesium.Color.WHITE,
          false,
        ),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.2,
        show: new Cesium.CallbackProperty(
          () => !(selectedId === entity.id && proxy?.show === false),
          false,
        ),
      });
    },
    getDetectableObjects({ maxCount = Infinity } = {}) {
      if (!isActive() || maxCount <= 0) return [];
      const viewer = getViewer();
      const time = viewer.clock.currentTime;
      const result = [];
      const retained = new Set();
      for (const entity of getEntities()) {
        retained.add(entity.id);
        if (!entity.position || !isVisible(entity) || !entity.isAvailable(time))
          continue;
        const selected =
          selectedId === entity.id || viewer.trackedEntity === entity;
        if (selectedId === entity.id && proxy?.show === false) continue;
        let object = detectionObjects.get(entity.id);
        if (!object) {
          object = { sourceId: entity.id, position: new Cesium.Cartesian3() };
          detectionObjects.set(entity.id, object);
        }
        const position = entity.position.getValue(time, object.position);
        if (!position) continue;
        object.position = position;
        object.id = labels ? entity.name || entity.id : '';
        object.type = air(entity, time) ? 'AIR' : 'VEH';
        object.metric = labels ? 'CZML' : '';
        object.skipLabel = selected;
        result.push(object);
        if (result.length >= maxCount) break;
      }
      for (const id of detectionObjects.keys())
        if (!retained.has(id)) detectionObjects.delete(id);
      return result;
    },
    attach() {
      const viewer = getViewer();
      if (viewer.scene?.canvas) {
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        bindTrackingClickGesture(handler, (event, gesture) => {
          if (!isTrackingSelectionGesture(gesture)) return;
          if (globalThis.document?.body?.classList.contains('cockpit-mode'))
            return;
          const picked = pickContact(viewer.scene, event.position);
          const id = resolvePickId(picked);
          const entity = getEntity(id);
          if (entity) {
            if (selectedId !== entity.id)
              api.trackById(entity.id, { origin: 'user' });
            return;
          }
          if (
            picked?.id === proxy ||
            (id && isOwnedByOtherLayer('simulated-traffic', id))
          )
            return;
          if (isTrackingClickGesture(gesture)) api.stopTracking();
        });
      }
      removeTracked = viewer.trackedEntityChanged?.addEventListener(
        (entity) => {
          if (entity === proxy) return;
          // Cockpit hides the proxy before releasing Cesium's follow camera.
          // Keep the contact alive for first-person telemetry and exit restore.
          if (!entity && proxy?.show === false) {
            stopCameraFrame?.();
            stopCameraFrame = null;
            return;
          }
          if (
            getEntities().includes(entity) &&
            air(entity, viewer.clock.currentTime)
          ) {
            // Cesium's double-click targets the source entity. Reapply the
            // shared follow frame even when this contact was already selected.
            api.refocusTrackedById(entity.id, { origin: 'user' });
          } else if (proxy) {
            // Empty-space double-click and another camera owner both release
            // our selection without clearing the new owner's tracked entity.
            api.stopTracking();
          }
        },
      );
    },
    detach() {
      api.stopTracking();
      detectionObjects.clear();
      handler?.destroy();
      handler = null;
      removeTracked?.();
      removeTracked = null;
    },
    getNearby(center, range, maxCount = 50) {
      if (!center) return [];
      return api
        .getAllPositions()
        .map((info) => ({
          ...info,
          distance: Cesium.Cartesian3.distance(center, info.position),
          distanceM: Cesium.Cartesian3.distance(center, info.position),
        }))
        .filter((info) => info.distance <= range)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxCount);
    },
    getAllPositions(maxCount = Infinity) {
      return getEntities().map(describe).filter(Boolean).slice(0, maxCount);
    },
    hasContact(id) {
      return Boolean(describe(getEntity(id)));
    },
    getTrackedInfo() {
      return selectedId ? describe(getEntity(selectedId)) : null;
    },
    getTrackedSubject() {
      const info = api.getTrackedInfo();
      return info
        ? {
            layerId: 'flights',
            id: info.id,
            label: info.label,
            position: info.position,
            simulated: true,
          }
        : null;
    },
    trackById(id, { origin = 'programmatic' } = {}) {
      const entity = getEntity(id);
      const info = describe(entity);
      if (!info) return false;
      const viewer = getViewer();
      if (selectedId !== id || !proxy) {
        api.stopTracking();
        selectedId = id;
        const followRange = Math.min(
          Math.max(info.altitudeM * 1.1 + 2500, 3000),
          30000,
        );
        proxy = viewer.entities.add({
          position: entity.position,
          trackingReferenceFrame: Cesium.TrackingReferenceFrame.ENU,
          // EntityView only advances when the tracked entity has a ready
          // visualizer bounding sphere. A position-only proxy frames once but
          // never follows. This invisible point supplies it without waiting
          // for the source GLB (and without drawing a duplicate vehicle).
          point: { pixelSize: 1, color: Cesium.Color.TRANSPARENT },
          viewFrom: new Cesium.ConstantProperty(
            new Cesium.Cartesian3(0, -followRange * 0.8, followRange * 0.55),
          ),
        });
        proxy.gevTrackedId = `flights:${id}`;
        proxy.gevDisplayPosition = () =>
          entity.position.getValue(viewer.clock.currentTime);
        proxy.gevSimulationId = id;
        proxy.gevLabelModel = {
          title: info.callsign,
          details: [info.source],
          accent: '#39d0ff',
        };
      }
      proxy.gevSelectionOrigin = origin;
      const changed = viewer.trackedEntity !== proxy;
      viewer.camera.cancelFlight?.();
      viewer.trackedEntity = proxy;
      if (changed) frameCamera();
      emit('gev:awareness-subject-selected', {
        ...api.getTrackedSubject(),
        origin,
      });
      render.governorRequestRender('simulation-track');
      return true;
    },
    refocusTrackedById(id, options) {
      const alreadyTracked =
        selectedId === id && getViewer()?.trackedEntity === proxy;
      const tracked = api.trackById(id, options);
      if (tracked && alreadyTracked) frameCamera();
      return tracked;
    },
    stopTracking() {
      if (!proxy) return;
      const viewer = getViewer();
      const oldProxy = proxy;
      const id = selectedId;
      selectedId = null;
      proxy = null;
      stopCameraFrame?.();
      stopCameraFrame = null;
      if (viewer?.trackedEntity === oldProxy) viewer.trackedEntity = undefined;
      viewer?.entities.remove(oldProxy);
      emit('gev:awareness-subject-cleared', {
        layerId: 'flights',
        id,
        reason: 'deselect',
      });
      render.governorRequestRender('simulation-untrack');
    },
    setParams(params) {
      if (typeof params.labels === 'boolean') labels = params.labels;
      const requestedScale = params.modelScale ?? params.iconScale;
      if (Number.isFinite(requestedScale))
        modelScale = Math.max(0.5, Math.min(3, requestedScale));
      render.governorRequestRender('simulation-presentation');
      render.markDetectionSourcesChanged?.('simulation-presentation');
    },
    getParams: () => ({ labels, modelScale }),
  };
  return api;
}
