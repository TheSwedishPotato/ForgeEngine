import { Vector3 } from 'three';
import { applyPairCorrection } from '../physics/solver.js';

const _g = new Vector3(), _s = new Vector3(), _c = new Vector3(), _v = new Vector3(), _vs = new Vector3(), _n = new Vector3();

/**
 * Coordinated arm extension.
 *
 * Joint-space PD drives alone move a fast arm along a curved, drooping path:
 * the light forearm snaps straight long before the shoulder can lift the
 * heavier upper arm (real fighters solve this with feed-forward motor
 * control). This constraint supplies that coordination as an *internal*
 * force between the glove and the shoulder: equal and opposite, so the
 * fighter's total momentum is conserved and the recoil is felt by the torso.
 * The force is capped (N) to stay within what an arm can deliver.
 */
export class ReachAssist {
  constructor(hand, handPointLocal, anchorBody, anchorLocal) {
    this.hand = hand;
    this.handPoint = handPointLocal.clone();
    this.anchor = anchorBody;
    this.anchorPoint = anchorLocal.clone();
    this.target = new Vector3();
    this.targetVel = new Vector3();   // world velocity of the target
    this.stiffness = 0;               // N/m
    this.damping = 0;                 // Ns/m
    this.maxForce = 0;                // N
    this.enabled = true;
  }

  solvePosition(h) {
    if (!this.enabled || this.stiffness <= 0) return;
    this.hand.localToWorld(this.handPoint, _g);
    this.anchor.localToWorld(this.anchorPoint, _s);
    _c.subVectors(this.target, _g);
    applyPairCorrection(this.hand, this.anchor, _c, 1 / this.stiffness, h, _g, _s, this.maxForce * h * h);
  }

  solveVelocity(h) {
    if (!this.enabled || this.damping <= 0) return;
    this.hand.localToWorld(this.handPoint, _g);
    this.anchor.localToWorld(this.anchorPoint, _s);
    this.hand.velocityAt(_g, _v);
    this.anchor.velocityAt(_s, _vs);
    // Damp the glove's velocity relative to the moving target.
    _v.sub(this.targetVel);
    const vl = _v.length();
    if (vl < 1e-6) return;
    _n.copy(_v).multiplyScalar(1 / vl);
    const w = this.hand.getInverseMass(_n, _g) + this.anchor.getInverseMass(_n, _s);
    const c = this.damping;
    let dv = (c * h * w * vl) / (1 + c * h * w);
    dv = Math.min(dv, this.maxForce * h * w);
    _c.copy(_n).multiplyScalar(-dv);
    applyPairCorrection(this.hand, this.anchor, _c, 0, h, _g, _s, Infinity, true);
  }
}
