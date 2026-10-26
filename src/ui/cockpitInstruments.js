/** Instrument values, routes and vision controls for the Cockpit controller. */
import { formatNumber, t } from '../i18n/index.js';
import {
  COCKPIT_VISION_MODES,
  normalizeCockpitVisionMode,
} from '../cockpitVisionPolicy.js';
import {
  altitudeRulerCurveInset,
  altitudeRulerTicks,
  bearingBetweenCoordinates,
  cockpitAltitudeDisplayFt,
  cockpitUiUpdateDue,
  compassDivisions,
  formatAltitudeRulerTick,
  formatCompassDivision,
  formatCockpitEmergency,
  formatHeadingReadout,
  formatSpeedRulerTick,
  normalizeHeading,
  relativeBearing,
  speedRulerTicks,
} from '../cockpitMath.js';
import {
  COCKPIT_CONTEXT_UPDATE_MS,
  compassPointLabel,
  formatCockpitCoordinate,
  setCockpitRollingValue,
} from './cockpitPresentation.js';

/** A transponder status name (src/data/aircraftEmergency.js) for the HUD. */
const emergencyLabel = ({ name }) => t(name).toUpperCase();

/** The emergency line in the active language (see cockpitMath.js). */
const LOCALIZED_EMERGENCY = Object.freeze({
  squawk: (parts) =>
    t('SQUAWK {code} · {status}', {
      code: parts.squawk,
      status: emergencyLabel(parts),
    }),
  adsb: (parts) =>
    parts.priority
      ? t('ADS-B PRIORITY · {status}', { status: emergencyLabel(parts) })
      : t('ADS-B EMERGENCY · {status}', { status: emergencyLabel(parts) }),
});

const tapeKeys = new WeakMap();

/** Keep a DOM node attached to a physical tick, rather than its row index.
 * Retained ticks keep their CSS transitions across interval boundaries. Only
 * entering ticks get fresh nodes, so recycling never animates across the tape.
 * Signed keys keep the clamped zero labels near the surface distinct.
 */
export function updateCockpitTape(elements, ticks, formatValue) {
  if (!elements.length) return;
  if (!ticks.length) {
    for (const element of elements) element.hidden = true;
    return;
  }
  const keyOf = (tick) => `${tick.stepFt ?? tick.stepKt}:${tick.key}`;
  const wanted = new Set(ticks.map(keyOf));
  const existing = new Map(
    elements.map((element) => [tapeKeys.get(element), element]),
  );
  const spare = elements.filter(
    (element) => !wanted.has(tapeKeys.get(element)),
  );
  const next = ticks.map((tick) => {
    const key = keyOf(tick);
    let element = existing.get(key);
    if (!element) {
      element = spare.shift();
      // A fresh element has no prior computed position to transition from.
      // Avoid forced layout reads, frame callbacks and cross-tape animations.
      if (tapeKeys.has(element)) {
        const replacement = element.cloneNode(true);
        element.replaceWith(replacement);
        element = replacement;
      }
    }
    element.hidden = false;
    tapeKeys.set(element, key);
    element.style.setProperty('--slot', tick.slot.toFixed(4));
    element.style.setProperty('--depth', tick.depth.toFixed(4));
    element.style.setProperty(
      '--curve',
      altitudeRulerCurveInset(tick.slot).toFixed(5),
    );
    element.classList.toggle('major', tick.major);
    const label = element.querySelector('b');
    if (label) label.textContent = formatValue(tick.valueFt ?? tick.valueKt);
    return element;
  });
  elements.splice(0, elements.length, ...next);
}

export function updateHud(
  info,
  nowMs = performance.now(),
  forceContext = false,
) {
  this.lastAircraftInfo = info;
  const heading = normalizeHeading(this.heading ?? info.track ?? 0);
  if (this.callsign) {
    this.callsign.textContent =
      info.callsign || info.registration || info.icao24 || t('AIRCRAFT');
  }
  const speedKt = Number.isFinite(info.velocityMps)
    ? info.velocityMps * 1.94384
    : null;
  setCockpitRollingValue(this.speed, formatSpeedRulerTick(speedKt), speedKt, {
    immediate: forceContext,
  });
  if (this.speedRim)
    this.speedRim.classList.toggle('unavailable', speedKt === null);
  if (this.speedRimValue)
    this.speedRimValue.textContent = formatSpeedRulerTick(speedKt);
  const speedTicks = speedRulerTicks(speedKt, this.speedRimTicks.length);
  updateCockpitTape(this.speedRimTicks, speedTicks, formatSpeedRulerTick);
  const altitudeFt = cockpitAltitudeDisplayFt(info.altitudeM, info.onGround);
  if (this.altitude) {
    const displayedAltitudeFt = Number.isFinite(altitudeFt)
      ? Math.round(altitudeFt)
      : null;
    setCockpitRollingValue(
      this.altitude,
      displayedAltitudeFt !== null
        ? formatNumber(displayedAltitudeFt)
        : '-----',
      displayedAltitudeFt,
      { immediate: forceContext },
    );
  }
  if (this.altitudeRim)
    this.altitudeRim.classList.toggle('unavailable', altitudeFt === null);
  if (this.altitudeRimValue) {
    this.altitudeRimValue.textContent = formatAltitudeRulerTick(altitudeFt);
  }
  const altitudeTicks = altitudeRulerTicks(
    altitudeFt,
    this.altitudeRimTicks.length,
  );
  updateCockpitTape(
    this.altitudeRimTicks,
    altitudeTicks,
    formatAltitudeRulerTick,
  );
  setCockpitRollingValue(
    this.headingValue,
    String(Math.round(heading) % 360).padStart(3, '0'),
    heading,
    { circularRange: 360, immediate: forceContext },
  );
  if (this.compassTape) {
    const divisions = compassDivisions(heading);
    const signature = divisions.join(',');
    if (signature !== this.lastCompassSignature) {
      this.lastCompassSignature = signature;
      this.compassTape.innerHTML = divisions
        .map((division, index) => {
          const slot = index - 3;
          return `<span class="${slot === 0 ? 'active' : ''}" style="--slot:${slot};--depth:${Math.abs(slot)}">${compassPointLabel(formatCompassDivision(division))}</span>`;
        })
        .join('');
    }
  }
  if (this.clock)
    this.clock.textContent =
      (info.simulationTime || new Date().toISOString()).slice(11, 19) + 'Z';
  if (this.position) {
    const lat = Number.isFinite(info.latitude)
      ? formatCockpitCoordinate(info.latitude, 'N', 'S')
      : '--';
    const lon = Number.isFinite(info.longitude)
      ? formatCockpitCoordinate(info.longitude, 'E', 'W')
      : '--';
    this.position.textContent = `${lat} · ${lon}`;
  }
  if (this.aircraftMeta) {
    const feedState = this.surfaceAcquiring
      ? t('ACQUIRING SURFACE')
      : this.surfaceFallback
        ? t('SURFACE FALLBACK')
        : info.stale
          ? t('STALE FEED')
          : info.simulated
            ? t('Simulated Traffic').toUpperCase()
            : t('LIVE TRACK');
    const aircraftClass = info.simulated
      ? (info.category === 'drone'
          ? t('Aerial drones')
          : t('Aircraft')
        ).toUpperCase()
      : info.layerId === 'military'
        ? t('MILITARY')
        : t('COMMERCIAL');
    const emergency = formatCockpitEmergency(
      info.emergency,
      LOCALIZED_EMERGENCY,
    );
    this.aircraftMeta.textContent = emergency
      ? t('{aircraftClass} · {emergency} · {feedState}', {
          aircraftClass,
          emergency,
          feedState,
        })
      : t('{aircraftClass} · {feedState} · COURSE ALIGNED', {
          aircraftClass,
          feedState,
        });
    this.aircraftMeta.classList.toggle(
      'emergency',
      info.emergency?.severity === 'emergency',
    );
  }
  this.updateRoute(info);
  if (
    forceContext ||
    cockpitUiUpdateDue(
      nowMs,
      this.lastContextUpdateMs,
      COCKPIT_CONTEXT_UPDATE_MS,
    )
  ) {
    this.lastContextUpdateMs = nowMs;
    this.updateLocalPosition(info);
    this.maybeRefreshRegionalBrief(info);
    this.updateContext(info, heading);
  }
  if (this.hud) this.hud.dataset.layer = info.layerId || 'flights';
}

export function updateRoute(info) {
  const origin = info?.route?.origin;
  const destination = info?.route?.destination;
  const validDestination =
    Number.isFinite(destination?.lat) && Number.isFinite(destination?.lon);
  const routeLabel = (airport) =>
    [airport?.code, airport?.name].filter(Boolean).join(' · ') || t('UNKNOWN');
  if (this.routeFrom) this.routeFrom.textContent = routeLabel(origin);
  if (this.routeTo) this.routeTo.textContent = routeLabel(destination);
  if (this.routeStatus) {
    this.routeStatus.textContent = validDestination
      ? t('ARROW · ESTIMATED DIRECTION')
      : t('ROUTE DATA UNAVAILABLE');
  }
  if (this.route) this.route.hidden = !origin && !destination;
  if (
    !validDestination ||
    !Number.isFinite(info?.longitude) ||
    !Number.isFinite(info?.latitude)
  ) {
    this.clearPredictiveRoute();
    return;
  }
  const destinationBearing = bearingBetweenCoordinates(
    info.latitude,
    info.longitude,
    destination.lat,
    destination.lon,
  );
  const relative = relativeBearing(
    destinationBearing,
    this.heading ?? info.track ?? 0,
  );
  if (!Number.isFinite(destinationBearing) || !Number.isFinite(relative)) {
    this.clearPredictiveRoute();
    return;
  }
  if (this.routeDirection) {
    const displayedRelative = Math.max(-120, Math.min(120, relative));
    this.routeDirection.hidden = false;
    this.routeDirection.style.setProperty(
      '--route-angle',
      `${displayedRelative.toFixed(2)}deg`,
    );
  }
  if (this.routeDirectionLabel) {
    this.routeDirectionLabel.textContent = t('DEST {bearing}', {
      bearing: `${formatHeadingReadout(destinationBearing)}°`,
    });
  }
}

export function syncWeatherToggle(enabled) {
  if (!this.weatherToggle) return;
  const active = !!enabled;
  this.weatherToggle.setAttribute('aria-pressed', String(active));
  const weatherLabel = active
    ? t('Disable cockpit weather effects')
    : t('Enable cockpit weather effects');
  this.weatherToggle.setAttribute('aria-label', weatherLabel);
  this.weatherToggle.title = weatherLabel;
  if (this.weatherState) {
    this.weatherState.textContent = active ? t('ON') : t('OFF');
  }
}

export function setVisionMode(mode, { revealParameters = false } = {}) {
  const next = normalizeCockpitVisionMode(mode);
  this.visionMode = next;
  const labels = {
    optical: t('NORMAL'),
    crt: t('CRT'),
    nvg: t('NVG'),
    thermal: t('FLIR'),
    anime: t('ANIME'),
    noir: t('NOIR'),
    snow: t('SNOW'),
  };
  const names = {
    optical: t('Normal'),
    crt: t('CRT'),
    nvg: t('Night vision'),
    thermal: t('Thermal'),
    anime: t('Anime'),
    noir: t('Noir'),
    snow: t('Snow'),
  };
  if (this.visionCurrent) {
    this.visionCurrent.dataset.cockpitVision = next;
    this.visionCurrent.setAttribute(
      'aria-label',
      t('Current cockpit vision style: {style}. Activate for next style.', {
        style: names[next],
      }),
    );
    this.visionCurrent.title = t('Current style: {style} — click for next', {
      style: names[next],
    });
  }
  if (this.visionCurrentLabel)
    this.visionCurrentLabel.textContent = labels[next];
  this.onVisionChange?.(next, this.active, { revealParameters });
}

export function cycleVisionMode(direction = 1) {
  const modes = COCKPIT_VISION_MODES;
  const currentIndex = Math.max(0, modes.indexOf(this.visionMode));
  const step = direction < 0 ? -1 : 1;
  const nextIndex = (currentIndex + step + modes.length) % modes.length;
  this.setVisionMode(modes[nextIndex], { revealParameters: true });
}

export function clearPredictiveRoute() {
  if (this.routeDirection) this.routeDirection.hidden = true;
}
