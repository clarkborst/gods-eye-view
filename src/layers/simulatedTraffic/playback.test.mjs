import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock, ClockRange, ClockStep, JulianDate } from 'cesium';
import { createSimulationPlayback } from './playback.js';

const date = (value) => JulianDate.fromIso8601(value);
function fixture(t) {
  const holds = new Set();
  let requests = 0;
  const clock = new Clock({
    startTime: date('2026-01-01T00:00:00Z'),
    stopTime: date('2026-01-02T00:00:00Z'),
    currentTime: date('2026-01-01T12:00:00Z'),
    multiplier: 2,
    clockStep: ClockStep.TICK_DEPENDENT,
    clockRange: ClockRange.UNBOUNDED,
    shouldAnimate: false,
  });
  const originalSource = { name: 'original' };
  const viewer = { clock, clockTrackedDataSource: originalSource };
  const playback = createSimulationPlayback({
    render: {
      holdContinuousRender: (id) => holds.add(id),
      releaseContinuousRender: (id) => holds.delete(id),
      governorRequestRender: () => requests++,
    },
  });
  t.after(() => playback.destroy());
  return {
    playback,
    clock,
    viewer,
    holds,
    originalSource,
    requests: () => requests,
    enter: () =>
      playback.enter(
        viewer,
        date('2026-10-26T10:00:00Z'),
        date('2026-10-26T10:20:00Z'),
      ),
  };
}

test('clock takeover starts paused, seeks clamp and render, and restores every original policy field', (t) => {
  const f = fixture(t);
  f.enter();
  assert.equal(f.playback.getState().playing, false);
  assert.equal(f.clock.clockStep, ClockStep.SYSTEM_CLOCK_MULTIPLIER);
  assert.equal(f.viewer.clockTrackedDataSource, undefined);
  f.playback.seek(340.5);
  assert.equal(f.playback.getState().elapsed, 340.5);
  f.playback.seek(-50);
  assert.equal(f.playback.getState().elapsed, 0);
  f.playback.seek(2000);
  assert.equal(f.playback.getState().elapsed, 1200);
  f.playback.seek(NaN);
  assert.equal(f.playback.getState().elapsed, 1200);
  assert.ok(f.requests() >= 4);
  f.playback.exit();
  assert.equal(
    JulianDate.toIso8601(f.clock.currentTime),
    '2026-01-01T12:00:00Z',
  );
  assert.equal(f.clock.clockStep, ClockStep.TICK_DEPENDENT);
  assert.equal(f.clock.clockRange, ClockRange.UNBOUNDED);
  assert.equal(f.clock.multiplier, 2);
  assert.equal(f.clock.shouldAnimate, false);
  assert.equal(f.viewer.clockTrackedDataSource, f.originalSource);
  assert.equal(f.holds.size, 0);
  assert.equal(f.clock.onTick.numberOfListeners, 0);
});

test('forward/reverse play owns a render hold; both boundaries pause and looping works in both directions', (t) => {
  const f = fixture(t);
  f.enter();
  f.playback.play();
  assert.ok(f.holds.has('simulation'));
  f.clock.currentTime = JulianDate.clone(f.clock.stopTime);
  f.clock.onTick.raiseEvent(f.clock);
  assert.equal(f.playback.getState().playing, false);
  assert.equal(f.holds.size, 0);
  f.playback.setRate(-4);
  f.playback.play();
  assert.equal(f.clock.multiplier, -4);
  f.clock.currentTime = JulianDate.clone(f.clock.startTime);
  f.clock.onTick.raiseEvent(f.clock);
  assert.equal(f.playback.getState().playing, false);
  f.playback.setLoop(true);
  f.playback.play();
  f.clock.currentTime = JulianDate.clone(f.clock.startTime);
  f.clock.onTick.raiseEvent(f.clock);
  assert.equal(f.playback.getState().elapsed, 1200);
  assert.equal(f.playback.getState().playing, true);
  f.playback.setRate(8);
  f.clock.onTick.raiseEvent(f.clock);
  assert.equal(f.playback.getState().elapsed, 0);
  f.playback.pause();
  assert.equal(f.holds.size, 0);
  for (const rate of [0, 65, Infinity, NaN]) f.playback.setRate(rate);
  assert.equal(f.playback.getState().rate, 8);
});

test('replacement intervals preserve the first saved clock and subscriptions can be removed', (t) => {
  const f = fixture(t);
  let updates = 0;
  const remove = f.playback.subscribe(() => updates++);
  f.enter();
  f.playback.play();
  f.playback.enter(
    f.viewer,
    date('2027-01-01T00:00:00Z'),
    date('2027-01-01T01:00:00Z'),
  );
  assert.equal(f.playback.getState().duration, 3600);
  assert.equal(f.playback.getState().playing, false);
  assert.equal(f.clock.onTick.numberOfListeners, 1);
  remove();
  const count = updates;
  f.playback.exit();
  assert.equal(updates, count);
  assert.equal(
    JulianDate.toIso8601(f.clock.currentTime),
    '2026-01-01T12:00:00Z',
  );
  assert.throws(
    () => f.playback.enter(f.viewer, f.clock.stopTime, f.clock.startTime),
    /non-empty/,
  );
});
