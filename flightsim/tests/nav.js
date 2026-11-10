// A runway for the tests, without the 3D world: runway 18 along the z axis (threshold at z = -600, far end at z = +600), with an
// ILS laid out the way the airfield's is.
export function buildNav() {
  return {
    vor: [{ id: 'TST', freq: 113.9, x: 400, z: 0, y: 6 }],
    ils: [{ id: 'ITST', freq: 110.3, course: 180, width: 3, angle: 3, loc: { x: 0, z: 750 }, gs: { x: 55, z: -310, y: 0 } }],
    com: [],
  };
}
