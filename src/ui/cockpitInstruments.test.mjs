import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateCockpitCompass,
  updateCockpitTape,
} from './cockpitInstruments.js';
import { altitudeRulerTicks, speedRulerTicks } from '../cockpitMath.js';

function tape() {
  const attached = new Set();
  function element() {
    const label = { textContent: '' };
    const properties = new Map();
    const node = {
      hidden: false,
      label,
      properties,
      style: { setProperty: (key, value) => properties.set(key, value) },
      classList: { toggle() {} },
      querySelector: () => label,
      cloneNode: () => element(),
      replaceWith(replacement) {
        attached.delete(node);
        attached.add(replacement);
      },
    };
    return node;
  }
  const elements = Array.from({ length: 9 }, () => element());
  elements.forEach((node) => attached.add(node));
  return { elements, attached };
}

for (const [name, ticks, before, boundary, after] of [
  ['altitude', altitudeRulerTicks, 34999, 35000, 35001],
  ['speed', speedRulerTicks, 239.9, 240, 240.1],
]) {
  test(`${name} ticks retain their node, label and forward movement across a tick boundary`, () => {
    const { elements, attached } = tape();
    updateCockpitTape(elements, ticks(before), String);
    const prior = new Map(
      elements.map((node) => [node.label.textContent, node]),
    );
    const center = prior.get(String(boundary));
    const oldSlot = Number(center.properties.get('--slot'));
    updateCockpitTape(elements, ticks(after), String);
    assert.equal(
      elements.find((node) => node.label.textContent === String(boundary)),
      center,
    );
    assert.ok(
      Number(center.properties.get('--slot')) < oldSlot,
      'same tick moves down continuously as the reading increases',
    );
    assert.equal(
      elements.filter((node) => [...prior.values()].includes(node)).length,
      8,
    );
    assert.equal(attached.size, 9, 'only the outgoing edge tick is replaced');
    for (const node of elements) {
      if ([...prior.values()].includes(node))
        assert.equal(
          prior.get(node.label.textContent),
          node,
          'retained labels never change to another value',
        );
    }
    // Descending/decelerating through the boundary is equally continuous.
    const lowerSlot = Number(center.properties.get('--slot'));
    updateCockpitTape(elements, ticks(before), String);
    assert.equal(
      elements.find((node) => node.label.textContent === String(boundary)),
      center,
    );
    assert.ok(Number(center.properties.get('--slot')) > lowerSlot);
    assert.equal(attached.size, 9);
  });
}

test('zero-clamped labels retain distinct signed tick identities', () => {
  const { elements, attached } = tape();
  updateCockpitTape(elements, altitudeRulerTicks(0), String);
  assert.equal(
    elements.filter((node) => node.label.textContent === '0').length,
    5,
  );
  const old = [...elements];
  updateCockpitTape(elements, altitudeRulerTicks(1), String);
  assert.deepEqual(elements, old);
  assert.equal(attached.size, 9);
});

test('rescaling and seeking replace entering ticks without animating old labels to new values', () => {
  const { elements, attached } = tape();
  updateCockpitTape(elements, speedRulerTicks(99), String);
  const old = [...elements];
  updateCockpitTape(elements, speedRulerTicks(101), String);
  assert.ok(elements.every((node) => !old.includes(node)));
  assert.equal(attached.size, 9);
  updateCockpitTape(elements, speedRulerTicks(500), String);
  assert.equal(attached.size, 9);
  updateCockpitTape(elements, [], String);
  assert.ok(elements.every((node) => node.hidden));
  updateCockpitTape(elements, speedRulerTicks(500), String);
  assert.ok(elements.every((node) => !node.hidden));
  updateCockpitTape([], speedRulerTicks(0), String);
});

function compassTape() {
  const children = [];
  return {
    children,
    ownerDocument: {
      createElement() {
        const node = tape().elements[0];
        node.dataset = {};
        node.remove = () => children.splice(children.indexOf(node), 1);
        return node;
      },
    },
    appendChild(node) {
      children.push(node);
    },
  };
}

for (const [before, after, bearing] of [
  [10, 11, 30],
  [14.9, 15.1, 30],
  [359.9, 0.1, 0],
  [0.1, 359.9, 0],
]) {
  test(`heading tape moves continuously from ${before} to ${after}`, () => {
    const tape = compassTape();
    updateCockpitCompass(tape, before);
    const node = tape.children.find(
      (child) => Number(child.dataset.bearing) === bearing,
    );
    const slot = Number(node.properties.get('--slot'));
    const label = node.textContent;
    updateCockpitCompass(tape, after);
    assert.ok(
      tape.children.includes(node),
      'physical bearing retains its DOM node',
    );
    assert.equal(node.textContent, label);
    const movement = Number(node.properties.get('--slot')) - slot;
    const headingDelta = ((after - before + 540) % 360) - 180;
    assert.ok(Math.abs(movement + headingDelta / 30) < 0.00011);
    assert.equal(tape.children.length, 7);
    assert.equal(
      new Set(tape.children.map((child) => child.dataset.bearing)).size,
      7,
    );
  });
}
