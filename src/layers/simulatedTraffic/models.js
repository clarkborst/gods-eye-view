import * as Cesium from 'cesium';
import { CLASS_MODEL_REAL, CLASS_MODEL_URL } from '../../data/aircraftClass.js';

/** All bundled models use metres, glTF +Y up and a nose along local -X. */
export function simulationModelSpec(category, aircraftClass) {
  if (category === 'drone')
    return {
      url: '/models/quadcopter.glb',
      minimumPixelSize: 28,
      maximumScale: 256,
    };
  return {
    url:
      CLASS_MODEL_REAL[aircraftClass]?.url ||
      CLASS_MODEL_URL[aircraftClass] ||
      CLASS_MODEL_URL.airliner,
    minimumPixelSize: 40,
    maximumScale: 64,
  };
}

/** Adapt Cesium's velocity frame (+X forward) to the bundled model convention.
 * Explicit CZML attitude is retained. A stationary vehicle uses authored heading
 * in degrees (north=0) rather than an undefined velocity orientation.
 */
export function simulationModelOrientation(entity) {
  const source = entity.orientation;
  const derived = source instanceof Cesium.VelocityOrientationProperty;
  const noseCorrection = Cesium.Quaternion.fromAxisAngle(
    Cesium.Cartesian3.UNIT_Z,
    Math.PI,
  );
  return new Cesium.CallbackProperty(
    (time, result = new Cesium.Quaternion()) => {
      const orientation = source?.getValue(time, result);
      if (orientation)
        return derived
          ? Cesium.Quaternion.multiply(orientation, noseCorrection, result)
          : orientation;
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
      return Cesium.Quaternion.multiply(result, noseCorrection, result);
    },
    false,
  );
}
