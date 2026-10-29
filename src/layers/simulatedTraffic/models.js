import * as Cesium from 'cesium';
import { normalizeAircraftKind } from '../../data/vehiclePresentation.js';
import { CLASS_MODEL_REAL, CLASS_MODEL_URL } from '../../data/aircraftClass.js';

/** All bundled models use metres, glTF +Y up and a nose along local -X. */
export function simulationModelSpec(category, aircraftClass) {
  if (normalizeAircraftKind(category) === 'uas')
    return {
      url: '/models/quadcopter.glb',
      minimumPixelSize: 28,
      maximumScale: 256,
    };
  return {
    url:
      CLASS_MODEL_REAL[normalizeAircraftKind(aircraftClass)]?.url ||
      CLASS_MODEL_URL[normalizeAircraftKind(aircraftClass)] ||
      CLASS_MODEL_URL.airliner,
    minimumPixelSize: 40,
    maximumScale: 64,
  };
}

/** Convert vehicle attitude (+X forward, +Z up) to the bundled GLB convention.
 * Cesium applies Y_UP_TO_Z_UP * Z_UP_TO_X_UP internally, making the raw -X
 * nose point along -Y. A +90 degree yaw, not 180, aligns it with velocity.
 * Sampled roll (degrees, positive right bank) keeps heading velocity-aligned.
 */
export function simulationModelOrientation(entity) {
  const roll = entity.properties?.roll;
  const source = roll
    ? new Cesium.VelocityOrientationProperty(entity.position)
    : entity.orientation;
  const noseCorrection = Cesium.Quaternion.fromAxisAngle(
    Cesium.Cartesian3.UNIT_Z,
    Math.PI / 2,
  );
  return new Cesium.CallbackProperty(
    (time, result = new Cesium.Quaternion()) => {
      const orientation = source?.getValue(time, result);
      if (orientation) {
        if (roll) {
          const bank = Cesium.Math.toRadians(Number(roll.getValue(time)) || 0);
          Cesium.Quaternion.multiply(
            orientation,
            Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, bank),
            result,
          );
        }
        return Cesium.Quaternion.multiply(result, noseCorrection, result);
      }
      const position = entity.position?.getValue(time);
      if (!position) return undefined;
      const heading = Number(entity.properties?.heading?.getValue(time)) || 0;
      const angle = Cesium.Math.toRadians(heading);
      const forward = Cesium.Matrix4.multiplyByPointAsVector(
        Cesium.Transforms.eastNorthUpToFixedFrame(position),
        new Cesium.Cartesian3(Math.sin(angle), Math.cos(angle), 0),
        new Cesium.Cartesian3(),
      );
      const rotation = Cesium.Transforms.rotationMatrixFromPositionVelocity(
        position,
        forward,
        Cesium.Ellipsoid.WGS84,
        new Cesium.Matrix3(),
      );
      Cesium.Quaternion.fromRotationMatrix(rotation, result);
      if (roll)
        Cesium.Quaternion.multiply(
          result,
          Cesium.Quaternion.fromAxisAngle(
            Cesium.Cartesian3.UNIT_X,
            Cesium.Math.toRadians(Number(roll.getValue(time)) || 0),
          ),
          result,
        );
      return Cesium.Quaternion.multiply(result, noseCorrection, result);
    },
    false,
  );
}
