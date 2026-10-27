import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSimulationTick } from './simulationPanel.js';

test('short replay ticks show UTC time, including across midnight', () => {
  assert.equal(
    formatSimulationTick(Date.parse('2026-10-26T23:59:59Z'), 1200),
    '23:59:59',
  );
  assert.equal(
    formatSimulationTick(Date.parse('2026-10-27T00:00:01Z'), 1200),
    '00:00:01',
  );
});

test('multi-day replay ticks include dates without growing with the duration', () => {
  assert.equal(
    formatSimulationTick(Date.parse('2026-10-27T12:30:00Z'), 3 * 86400),
    '10-27 12:30',
  );
  assert.equal(
    formatSimulationTick(Date.parse('2027-01-01T12:30:00Z'), 30 * 86400),
    '01-01 12:30',
  );
});

test('multi-year replay ticks retain the year in a bounded label', () => {
  assert.equal(
    formatSimulationTick(Date.parse('2036-10-27T12:30:00Z'), 10 * 366 * 86400),
    '2036-10-27',
  );
});

test('a one-year replay distinguishes matching month/day endpoints by year', () => {
  const duration = 365 * 86400;
  assert.equal(
    formatSimulationTick(Date.parse('2026-10-26T10:00:00Z'), duration),
    '2026-10-26',
  );
  assert.equal(
    formatSimulationTick(Date.parse('2027-10-26T10:00:00Z'), duration),
    '2027-10-26',
  );
});
