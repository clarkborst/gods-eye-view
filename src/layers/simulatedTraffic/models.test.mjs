import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as Cesium from 'cesium';
import { simulationModelSpec, simulationModelOrientation } from './models.js';

const time = Cesium.JulianDate.fromIso8601('2026-10-26T10:00:00Z');
const direction = (orientation) =>
  Cesium.Matrix3.multiplyByVector(
    Cesium.Matrix3.fromQuaternion(orientation),
    new Cesium.Cartesian3(-1, 0, 0),
    new Cesium.Cartesian3(),
  );

test('model selection reuses the existing aircraft fleet and the original quadcopter', () => {
  assert.equal(
    simulationModelSpec('aircraft', 'bizjet').url,
    '/models/citation2.glb',
  );
  assert.equal(
    simulationModelSpec('aircraft', 'widebody').url,
    '/models/b789.glb',
  );
  assert.equal(
    simulationModelSpec('aircraft', 'unknown').url,
    '/models/airplane.glb',
  );
  assert.equal(
    simulationModelSpec('drone', 'uav').url,
    '/models/quadcopter.glb',
  );
});

test('nose-minus-X models follow sampled velocity and authored attitude is retained', () => {
  const position = new Cesium.SampledPositionProperty();
  const a = Cesium.Cartesian3.fromDegrees(4.44, 51.95, 100);
  const b = Cesium.Cartesian3.fromDegrees(4.441, 51.95, 100);
  position.addSample(time, a);
  position.addSample(
    Cesium.JulianDate.addSeconds(time, 10, new Cesium.JulianDate()),
    b,
  );
  const entity = new Cesium.Entity({
    position,
    orientation: new Cesium.VelocityOrientationProperty(position),
  });
  const orientation = simulationModelOrientation(entity).getValue(
    Cesium.JulianDate.addSeconds(time, 5, new Cesium.JulianDate()),
  );
  const velocity = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  assert.ok(Cesium.Cartesian3.dot(direction(orientation), velocity) > 0.999);
  const authored = Cesium.Quaternion.fromAxisAngle(
    Cesium.Cartesian3.UNIT_Z,
    0.7,
  );
  entity.orientation = new Cesium.ConstantProperty(authored);
  assert.ok(
    Cesium.Quaternion.equals(
      simulationModelOrientation(entity).getValue(time),
      authored,
    ),
  );
});

test('a hovering vehicle has a valid pose with its nose on the authored heading', () => {
  const position = Cesium.Cartesian3.fromDegrees(4.45, 51.95, 75);
  const entity = new Cesium.Entity({ position, properties: { heading: 90 } });
  const pose = simulationModelOrientation(entity).getValue(time);
  const east = Cesium.Matrix4.multiplyByPointAsVector(
    Cesium.Transforms.eastNorthUpToFixedFrame(position),
    Cesium.Cartesian3.UNIT_X,
    new Cesium.Cartesian3(),
  );
  assert.ok(Cesium.Cartesian3.dot(direction(pose), east) > 0.999);
});

test('the quadcopter GLB is self-contained with valid mesh bounds at drone scale', async () => {
  const bytes = await readFile(
    new URL('../../../public/models/quadcopter.glb', import.meta.url),
  );
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const gltf = JSON.parse(
    bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
  );
  assert.ok(
    gltf.meshes.length >= 20,
    'the model must contain its airframe, motors, propellers and cameras',
  );
  assert.ok(gltf.buffers.every((buffer) => !buffer.uri));
  assert.ok((gltf.images || []).every((image) => !image.uri));
  const minimum = new Cesium.Cartesian3(Infinity, Infinity, Infinity);
  const maximum = new Cesium.Cartesian3(-Infinity, -Infinity, -Infinity);
  function visit(index, parent) {
    const node = gltf.nodes[index];
    const local = node.matrix
      ? Cesium.Matrix4.fromArray(node.matrix)
      : Cesium.Matrix4.fromTranslationQuaternionRotationScale(
          Cesium.Cartesian3.fromArray(node.translation || [0, 0, 0]),
          Cesium.Quaternion.unpack(node.rotation || [0, 0, 0, 1]),
          Cesium.Cartesian3.fromArray(node.scale || [1, 1, 1]),
        );
    const matrix = Cesium.Matrix4.multiply(parent, local, new Cesium.Matrix4());
    for (const primitive of gltf.meshes[node.mesh]?.primitives || []) {
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      for (let i = 0; i < 8; i++) {
        const corner = new Cesium.Cartesian3(
          ...[0, 1, 2].map(
            (axis) => (i & (1 << axis) ? accessor.max : accessor.min)[axis],
          ),
        );
        const world = Cesium.Matrix4.multiplyByPoint(
          matrix,
          corner,
          new Cesium.Cartesian3(),
        );
        Cesium.Cartesian3.minimumByComponent(minimum, world, minimum);
        Cesium.Cartesian3.maximumByComponent(maximum, world, maximum);
      }
    }
    for (const child of node.children || []) visit(child, matrix);
  }
  for (const node of gltf.scenes[gltf.scene || 0].nodes)
    visit(node, Cesium.Matrix4.IDENTITY);
  const extent = Cesium.Cartesian3.subtract(
    maximum,
    minimum,
    new Cesium.Cartesian3(),
  );
  assert.ok(extent.x > 0.7 && extent.x < 1.5);
  assert.ok(extent.z > 0.7 && extent.z < 1.5);
  assert.ok(extent.y > 0.2 && extent.y < 0.6, 'glTF Y is the vertical axis');
});
