import * as Cesium from 'cesium';
import { aircraftIcon } from '../../data/aircraftIcons.js';
import { classifyAircraft, CLASS_SCALE_2D } from '../../data/aircraftClass.js';
import { screenProjectedRotation } from '../../data/iconOrientation.js';
import { entityCategory } from './scenarios.js';
import { DRONE_ICON } from './icons.js';

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
  eventTarget = globalThis.window,
}) {
  let selectedId = null;
  let proxy = null;
  let handler = null;
  let removeTracked = null;
  let labels = true;
  let iconScale = 1;
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
        : 0;
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
  const api = {
    isSimulationActive: isActive,
    describe,
    style(entity) {
      const viewer = getViewer();
      const time = viewer.clock.currentTime;
      if (entity.label)
        entity.label.show = new Cesium.CallbackProperty(
          () => labels && !(selectedId === entity.id && proxy?.show === false),
          false,
        );
      if (!entity.position || !air(entity, time)) return;
      const drone = entityCategory(entity, time) === 'drone';
      const kind =
        value(entity, 'aircraftClass', time) ||
        classifyAircraft({ typeCode: value(entity, 'typeCode', time) });
      entity.point = undefined;
      entity.billboard = new Cesium.BillboardGraphics({
        image: drone ? DRONE_ICON : aircraftIcon(kind),
        width: 26,
        height: 26,
        scale: new Cesium.CallbackProperty(
          () => iconScale * (drone ? 1 : CLASS_SCALE_2D[kind] || 1),
          false,
        ),
        color: new Cesium.CallbackProperty(
          () =>
            selectedId === entity.id
              ? Cesium.Color.CYAN
              : drone
                ? Cesium.Color.ORANGE
                : Cesium.Color.WHITE,
          false,
        ),
        show: new Cesium.CallbackProperty(
          () => !(selectedId === entity.id && proxy?.show === false),
          false,
        ),
        rotation: new Cesium.CallbackProperty(() => {
          const info = describe(entity);
          return info
            ? screenProjectedRotation(
                viewer.scene,
                info.position,
                info.track,
                0,
              )
            : 0;
        }, false),
        alignedAxis: Cesium.Cartesian3.ZERO,
      });
      if (entity.label)
        entity.label.show = new Cesium.CallbackProperty(
          () => labels && !(selectedId === entity.id && proxy?.show === false),
          false,
        );
    },
    attach() {
      const viewer = getViewer();
      if (viewer.scene?.canvas) {
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((event) => {
          const picked = viewer.scene.pick(event.position)?.id;
          const entity =
            typeof picked === 'string' ? getEntity(picked) : picked;
          if (getEntities().includes(entity))
            api.trackById(entity.id, { origin: 'user' });
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
      removeTracked = viewer.trackedEntityChanged?.addEventListener(
        (entity) => {
          if (
            getEntities().includes(entity) &&
            air(entity, viewer.clock.currentTime)
          )
            api.trackById(entity.id, { origin: 'user' });
        },
      );
    },
    detach() {
      api.stopTracking();
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
        proxy = viewer.entities.add({
          position: entity.position,
          orientation: entity.orientation,
          viewFrom: new Cesium.ConstantProperty(
            new Cesium.Cartesian3(-250, -450, 180),
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
      viewer.trackedEntity = proxy;
      emit('gev:awareness-subject-selected', {
        ...api.getTrackedSubject(),
        origin,
      });
      render.governorRequestRender('simulation-track');
      return true;
    },
    refocusTrackedById(id, options) {
      return api.trackById(id, options);
    },
    stopTracking() {
      if (!proxy) return;
      const viewer = getViewer();
      if (viewer?.trackedEntity === proxy) viewer.trackedEntity = undefined;
      viewer?.entities.remove(proxy);
      const id = selectedId;
      selectedId = null;
      proxy = null;
      emit('gev:awareness-subject-cleared', {
        layerId: 'flights',
        id,
        reason: 'deselect',
      });
      render.governorRequestRender('simulation-untrack');
    },
    setParams(params) {
      if (typeof params.labels === 'boolean') labels = params.labels;
      if (Number.isFinite(params.iconScale))
        iconScale = Math.max(0.5, Math.min(3, params.iconScale));
      render.governorRequestRender('simulation-presentation');
    },
    getParams: () => ({ labels, iconScale }),
  };
  return api;
}
