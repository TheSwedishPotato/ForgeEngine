import { Vector3 } from 'three';

const _n = new Vector3();

/**
 * Core XPBD correction (Mueller et al. 2020, "Detailed Rigid Body Simulation
 * with Extended Position Based Dynamics").
 *
 * Moves body0 by +corr and body1 by -corr, split by their generalised inverse
 * masses. `corr` is either a positional error (with world points p0/p1) or a
 * rotation vector (no points). `compliance` is the inverse stiffness (m/N or
 * rad/Nm); `maxLambda` optionally caps the constraint impulse so a
 * compliant constraint behaves like an actuator with a force/torque limit.
 *
 * Returns the magnitude of lambda (impulse * h), so force = lambda / h^2.
 */
export function applyPairCorrection(body0, body1, corr, compliance, h, p0 = null, p1 = null, maxLambda = Infinity, velocityLevel = false) {
  const C = corr.length();
  if (C < 1e-12) return 0;
  _n.copy(corr).multiplyScalar(1 / C);
  const w0 = body0 ? body0.getInverseMass(_n, p0) : 0;
  const w1 = body1 ? body1.getInverseMass(_n, p1) : 0;
  const w = w0 + w1;
  if (w === 0) return 0;
  const alpha = velocityLevel ? 0 : compliance / (h * h);
  let lambda = C / (w + alpha);
  if (lambda > maxLambda) lambda = maxLambda;
  _n.multiplyScalar(lambda);
  if (body0) body0.applyCorrection(_n, p0, velocityLevel);
  if (body1) {
    _n.negate();
    body1.applyCorrection(_n, p1, velocityLevel);
  }
  return lambda;
}
