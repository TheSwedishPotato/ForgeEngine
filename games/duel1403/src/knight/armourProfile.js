import { ARMOUR } from '../data/armour.js';

// Outer to inner: what a blow meets first.
const LAYER_ORDER = ['cover', 'head', 'neck', 'plate', 'arms', 'hands', 'legs', 'feet', 'mail', 'under'];

// Zones that live on each anatomical segment type (for contact materials).
export const SEGMENT_ZONES = {
  head: ['skull', 'face', 'nape', 'throat'],
  chest: ['chest', 'back', 'armpit'],
  abdomen: ['belly', 'loins'],
  pelvis: ['groin', 'hips'],
  upperArm: ['shoulder', 'upperArm', 'innerArm'],
  forearm: ['forearm', 'elbow', 'elbowInner'],
  hand: ['hand', 'palm'],
  thigh: ['thigh', 'thighBack'],
  shin: ['knee', 'kneeBack', 'shin', 'calf'],
  foot: ['foot'],
};

const BULK = { plate: 0.009, mail: 0.004, leather: 0.002, cloth: 0.001 };
const padBulk = (n) => Math.min(0.018, 0.0007 * n);

/**
 * Resolves a loadout ({slot: itemId}) into what the physics, damage model
 * and renderer need: masses per segment, added bulk, the layers covering
 * each zone (outermost first), and the helmet's effect on sight and breath.
 */
export function resolveArmour(items) {
  const list = LAYER_ORDER.map((slot) => ARMOUR[items[slot]]).filter(Boolean);
  const massBy = {};
  const zones = {};
  let total = 0;
  for (const it of list) {
    total += it.mass;
    for (const [k, v] of Object.entries(it.massBy ?? {})) massBy[k] = (massBy[k] ?? 0) + v;
    for (const layer of it.layers ?? []) {
      for (const z of layer.zones) {
        (zones[z] ??= []).push({ mat: layer.mat, t: layer.t ?? 0, n: layer.n ?? 0, cover: layer.cover ?? 1, visor: !!layer.visor, item: it });
      }
    }
  }
  // Bulk: how much each segment's outline grows (thickest stack of its zones).
  const bulk = {};
  const outer = {};
  for (const [segType, zs] of Object.entries(SEGMENT_ZONES)) {
    let best = 0, mat = 'skin', matScore = 0;
    for (const z of zs) {
      let b = 0;
      for (const L of zones[z] ?? []) b += L.mat === 'pad' ? padBulk(L.n) : BULK[L.mat] ?? 0;
      best = Math.max(best, b);
      const top = (zones[z] ?? [])[0];
      if (top) {
        const score = top.mat === 'plate' ? 3 : top.mat === 'mail' ? 2 : 1;
        if (score > matScore) { matScore = score; mat = top.mat === 'pad' ? 'cloth' : top.mat; }
      }
    }
    bulk[segType] = best;
    outer[segType] = mat;
  }
  const helmet = ARMOUR[items.head];
  return {
    items: { ...items },
    list,
    total,
    massBy,
    zones,
    bulk,
    outer,
    hasVisor: !!helmet?.visor,
    stiffNeck: !!helmet?.stiffNeck,
    helmet,
    vision(visorDown) {
      if (!helmet) return 1;
      if (helmet.visor && !visorDown) return 0.9;
      return helmet.vision ?? 1;
    },
    breath(visorDown) {
      let b = 0;
      for (const it of list) {
        if (it.slot === 'head' && it.visor && !visorDown) continue;
        b += it.breath ?? 0;
      }
      return Math.min(0.6, b);
    },
    /** Layers protecting a zone, outermost first (visor removed when raised). */
    layersAt(zone, visorDown = true) {
      const L = zones[zone] ?? [];
      return visorDown ? L : L.filter((l) => !l.visor);
    },
  };
}

/**
 * Metabolic cost multiplier for moving in this armour. Jaquet et al. (2016):
 * 39.8 kg of plate raised the cost of walking and running by 66 %; Askew et
 * al. (2012) found most of the excess comes from limb loading and breathing.
 * Limb armour counts more than torso armour.
 */
export function locomotionCost(profile) {
  const m = profile.massBy;
  const limbs = 2 * ((m.thigh ?? 0) + (m.shin ?? 0) + (m.foot ?? 0) + (m.upperArm ?? 0) + (m.forearm ?? 0));
  const trunk = profile.total - limbs;
  const equivalent = trunk + 1.6 * limbs;
  // 49 = the limb-weighted equivalent of a ~40 kg full harness.
  return 1 + 0.66 * (equivalent / 49);
}
