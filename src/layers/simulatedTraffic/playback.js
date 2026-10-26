import { ClockRange, ClockStep, JulianDate } from 'cesium';

/** Explicit, reversible ownership of the viewer clock. All categories share it. */
export function createSimulationPlayback({ render, onChange = () => {} }) {
  let viewer = null;
  let saved = null;
  let removeTick = null;
  let loop = false;
  let lastPublish = 0;
  const listeners = new Set();
  const clone = (time) => JulianDate.clone(time);
  const state = () => {
    const clock = viewer?.clock;
    return {
      active: Boolean(saved),
      playing: Boolean(saved && clock.shouldAnimate),
      rate: saved ? clock.multiplier : 1,
      loop,
      start: saved ? JulianDate.toIso8601(clock.startTime) : null,
      stop: saved ? JulianDate.toIso8601(clock.stopTime) : null,
      current: saved ? JulianDate.toIso8601(clock.currentTime) : null,
      duration: saved
        ? JulianDate.secondsDifference(clock.stopTime, clock.startTime)
        : 0,
      elapsed: saved
        ? JulianDate.secondsDifference(clock.currentTime, clock.startTime)
        : 0,
    };
  };
  const publish = () => {
    onChange();
    for (const listener of listeners) listener(state());
  };
  const draw = () => render.governorRequestRender('simulation-seek');
  const syncRender = () => {
    if (saved && viewer.clock.shouldAnimate)
      render.holdContinuousRender('simulation');
    else render.releaseContinuousRender('simulation');
  };
  const api = {
    getState: state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    enter(target, start, stop) {
      if (!JulianDate.lessThan(start, stop))
        throw new Error('Scenario requires a non-empty time interval');
      if (!saved) {
        viewer = target;
        const clock = viewer.clock;
        saved = {
          startTime: clone(clock.startTime),
          stopTime: clone(clock.stopTime),
          currentTime: clone(clock.currentTime),
          multiplier: clock.multiplier,
          clockStep: clock.clockStep,
          clockRange: clock.clockRange,
          shouldAnimate: clock.shouldAnimate,
          canAnimate: clock.canAnimate,
          trackedDataSource: viewer.clockTrackedDataSource,
        };
        viewer.clockTrackedDataSource = undefined;
        removeTick = clock.onTick.addEventListener(() => {
          if (!saved) return;
          if (clock.shouldAnimate) {
            const end = clock.multiplier < 0 ? clock.startTime : clock.stopTime;
            const reached =
              clock.multiplier < 0
                ? JulianDate.lessThanOrEquals(clock.currentTime, end)
                : JulianDate.greaterThanOrEquals(clock.currentTime, end);
            if (reached) {
              if (loop)
                clock.currentTime = clone(
                  clock.multiplier < 0 ? clock.stopTime : clock.startTime,
                );
              else clock.shouldAnimate = false;
              syncRender();
              draw();
              publish();
            }
          }
          if (performance.now() - lastPublish >= 100) {
            lastPublish = performance.now();
            publish();
          }
        });
      }
      const clock = viewer.clock;
      clock.shouldAnimate = false;
      clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
      clock.clockRange = ClockRange.CLAMPED;
      clock.startTime = clone(start);
      clock.stopTime = clone(stop);
      clock.currentTime = clone(start);
      clock.multiplier = 1;
      clock.canAnimate = true;
      syncRender();
      draw();
      publish();
    },
    play() {
      if (!saved) return;
      const clock = viewer.clock;
      if (
        clock.multiplier > 0 &&
        JulianDate.equals(clock.currentTime, clock.stopTime)
      )
        api.seek(0);
      if (
        clock.multiplier < 0 &&
        JulianDate.equals(clock.currentTime, clock.startTime)
      )
        api.seek(state().duration);
      clock.shouldAnimate = true;
      syncRender();
      publish();
    },
    pause() {
      if (!saved) return;
      viewer.clock.shouldAnimate = false;
      syncRender();
      draw();
      publish();
    },
    seek(seconds) {
      if (!saved || !Number.isFinite(seconds)) return;
      const clock = viewer.clock;
      clock.currentTime = JulianDate.addSeconds(
        clock.startTime,
        Math.max(0, Math.min(state().duration, seconds)),
        new JulianDate(),
      );
      draw();
      publish();
    },
    setRate(rate) {
      if (!saved || !Number.isFinite(rate) || rate === 0 || Math.abs(rate) > 64)
        return;
      viewer.clock.multiplier = rate;
      publish();
    },
    setLoop(value) {
      loop = Boolean(value);
      publish();
    },
    exit() {
      if (!saved) return;
      removeTick?.();
      removeTick = null;
      viewer.trackedEntity = undefined;
      const original = saved;
      saved = null;
      const clock = viewer.clock;
      clock.shouldAnimate = false;
      clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
      clock.startTime = original.startTime;
      clock.stopTime = original.stopTime;
      clock.currentTime = original.currentTime;
      clock.multiplier = original.multiplier;
      clock.clockRange = original.clockRange;
      clock.clockStep = original.clockStep;
      clock.canAnimate = original.canAnimate;
      clock.shouldAnimate = original.shouldAnimate;
      viewer.clockTrackedDataSource = original.trackedDataSource;
      syncRender();
      draw();
      viewer = null;
      publish();
    },
    destroy() {
      api.exit();
      listeners.clear();
    },
  };
  return api;
}
