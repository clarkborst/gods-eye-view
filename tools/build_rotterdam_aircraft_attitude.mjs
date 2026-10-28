/** Author standard CZML orientation plus roll telemetry from the example route.
 * Re-run with: node tools/build_rotterdam_aircraft_attitude.mjs
 * Positive roll is a right bank. This is synthetic attitude, not flight data.
 */
import { readFile, writeFile } from 'node:fs/promises';
import * as C from 'cesium';
const file = new URL(
  '../public/scenarios/rotterdam/aircraft.czml',
  import.meta.url,
);
const packets = JSON.parse(await readFile(file, 'utf8'));
for (const entity of packets.slice(1)) {
  const times = entity.position.cartographicDegrees;
  const positions = new C.SampledPositionProperty();
  const epoch = C.JulianDate.fromIso8601(entity.position.epoch);
  const samples = [];
  for (let i = 0; i < times.length; i += 4) {
    const position = C.Cartesian3.fromDegrees(...times.slice(i + 1, i + 4));
    positions.addSample(
      C.JulianDate.addSeconds(epoch, times[i], new C.JulianDate()),
      position,
    );
    samples.push({ t: times[i], position, height: times[i + 3] });
  }
  const turns = [];
  function course(a, b, at) {
    const enu = C.Matrix4.inverseTransformation(
      C.Transforms.eastNorthUpToFixedFrame(at),
      new C.Matrix4(),
    );
    const local = C.Matrix4.multiplyByPointAsVector(
      enu,
      C.Cartesian3.subtract(b, a, new C.Cartesian3()),
      new C.Cartesian3(),
    );
    return C.Math.toDegrees(Math.atan2(local.x, local.y));
  }
  for (let i = 1; i < samples.length - 1; i++) {
    const [a, b, c] = samples.slice(i - 1, i + 2);
    if (Math.min(a.height, b.height, c.height) < 100) continue;
    const delta =
      ((course(b.position, c.position, b.position) -
        course(a.position, b.position, b.position) +
        540) %
        360) -
      180;
    if (Math.abs(delta) > 2)
      turns.push({
        t: b.t,
        bank: C.Math.clamp(delta * 0.7, -25, 25),
        width: Math.min(20, (b.t - a.t) / 3, (c.t - b.t) / 3),
      });
  }
  const bankAt = (t) =>
    turns.reduce(
      (bank, turn) =>
        Math.abs(t - turn.t) < turn.width
          ? bank +
            (turn.bank *
              (1 + Math.cos((Math.PI * (t - turn.t)) / turn.width))) /
              2
          : bank,
      0,
    );
  const quaternion = [],
    roll = [];
  let previous = null;
  for (let second = 0; second <= 1200; second += 5) {
    const t = C.JulianDate.addSeconds(epoch, second, new C.JulianDate());
    const position = positions.getValue(t);
    const a = positions.getValue(
      C.JulianDate.addSeconds(
        epoch,
        Math.max(0, second - 0.5),
        new C.JulianDate(),
      ),
    );
    const b = positions.getValue(
      C.JulianDate.addSeconds(
        epoch,
        Math.min(1200, second + 0.5),
        new C.JulianDate(),
      ),
    );
    let forward = C.Cartesian3.subtract(b, a, new C.Cartesian3());
    if (C.Cartesian3.magnitude(forward) < 0.01) {
      const heading = C.Math.toRadians(entity.properties.heading || 0);
      forward = C.Matrix4.multiplyByPointAsVector(
        C.Transforms.eastNorthUpToFixedFrame(position),
        new C.Cartesian3(Math.sin(heading), Math.cos(heading), 0),
        new C.Cartesian3(),
      );
    }
    C.Cartesian3.normalize(forward, forward);
    const q = C.Quaternion.fromRotationMatrix(
      C.Transforms.rotationMatrixFromPositionVelocity(
        position,
        forward,
        C.Ellipsoid.WGS84,
        new C.Matrix3(),
      ),
    );
    const bank = bankAt(second);
    C.Quaternion.multiply(
      q,
      C.Quaternion.fromAxisAngle(C.Cartesian3.UNIT_X, C.Math.toRadians(bank)),
      q,
    );
    if (previous && C.Quaternion.dot(previous, q) < 0)
      C.Quaternion.negate(q, q);
    previous = C.Quaternion.clone(q);
    quaternion.push(
      second,
      ...[q.x, q.y, q.z, q.w].map((v) => Number(v.toFixed(9))),
    );
    roll.push(second, Number(bank.toFixed(3)));
  }
  entity.orientation = {
    epoch: entity.position.epoch,
    unitQuaternion: quaternion,
    interpolationAlgorithm: 'LINEAR',
    interpolationDegree: 1,
  };
  entity.properties.roll = {
    epoch: entity.position.epoch,
    number: roll,
    interpolationAlgorithm: 'LINEAR',
    interpolationDegree: 1,
  };
}
// Compact attitude arrays keep the authored example readable in code review.
let output = JSON.stringify(packets, null, 2);
for (const key of ['unitQuaternion', 'number'])
  output = output.replace(
    new RegExp('("' + key + '": )\\[([\\s\\d.,eE+\\-]+)\\]', 'g'),
    (_match, prefix, values) =>
      prefix + '[' + values.replace(/\s+/g, ' ').trim() + ']',
  );
await writeFile(file, output + '\n');
