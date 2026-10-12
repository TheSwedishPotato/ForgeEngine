/**
 * The Pullman cars' plans as plain data (no rendering), shared by the 3D cars and the passenger
 * model: the body's dimensions, the windows on each side, partitions and corridors, the seats,
 * the lamps and the vestibule doors.
 *
 * Vehicle coordinates: x forward, y up from the rail head, z right. The car is 25.3 m over
 * the buffers; its truck centres are 9.0 m either side of the middle.
 */
export const BODY = {
  half: 1.46, wall: 0.085,
  sill: 1.02, floor: 1.32, belt: 1.92, winTop: 2.87, eaves: 3.30, clerBase: 3.56, clerTop: 3.82, roofTop: 4.02,
  bodyHalf: 12.0,                    // end walls at x = +-12.0 (the vestibule ends)
  vest: 1.15,                        // vestibule length
  truck: 9.0, axle: 1.675, wheelR: 0.457,
  buffer: { y: 1.06, z: 0.875 },
};

// ---------------------------------------------------------------------------------------------
// layouts: what is along each side and inside, by car type (x from the front, + toward the front)

const winSaloon = (n, x0, pitch, w = 0.8) => Array.from({ length: n }, (_, i) => ({ x: x0 - i * pitch, w, y0: BODY.belt, y1: BODY.winTop }));

export const LAYOUTS = {
  parlor: () => {
    const saloon = winSaloon(14, 8.55, 1.1);
    return {
      right: [...saloon, { x: 10.0, w: 0.5, y0: 2.2, y1: 2.8, frosted: true }, { x: -7.45, w: 0.85, y0: BODY.belt, y1: BODY.winTop }, { x: -8.75, w: 0.85, y0: BODY.belt, y1: BODY.winTop }, { x: -10.2, w: 0.5, y0: 2.2, y1: 2.8, frosted: true }],
      left: [...saloon, { x: 9.95, w: 0.7, y0: BODY.belt, y1: BODY.winTop }, { x: -7.45, w: 0.7, y0: BODY.belt, y1: BODY.winTop }, { x: -8.75, w: 0.7, y0: BODY.belt, y1: BODY.winTop }, { x: -10.2, w: 0.7, y0: BODY.belt, y1: BODY.winTop }],
      partitions: [
        { x: 9.1, z0: -0.62, z1: BODY.half, door: null }, { x: 10.85, z0: -BODY.half, z1: BODY.half, door: [-0.4, 0.4] },
        { x: -6.6, z0: -0.62, z1: BODY.half, door: null }, { x: -9.6, z0: -BODY.half, z1: BODY.half, door: [-1.3, -0.65] }, { x: -10.85, z0: -BODY.half, z1: BODY.half, door: [-0.4, 0.4] },
      ],
      corridors: [{ x0: 9.1, x1: 10.85, z: -0.62 }, { x0: -9.6, x1: -6.6, z: -0.62 }],
      chairs: saloon.flatMap((w) => [{ x: w.x, z: 0.86, yaw: 0 }, { x: w.x, z: -0.86, yaw: 0 }]),
      sofas: [{ x: -9.25, z: 0.45, yaw: Math.PI / 2, w: 1.5 }],
      tables: [],
      lamps: [-7.8, -4.4, -1.1, 2.2, 5.5, 8.6],
    };
  },
  diner: () => {
    const dining = winSaloon(9, 6.6, 1.32, 0.95);
    return {
      right: [...dining, { x: -8.2, w: 0.55, y0: 2.2, y1: 2.8, frosted: true }, { x: -9.6, w: 0.55, y0: 2.2, y1: 2.8, frosted: true }],
      left: [...dining, { x: -8.2, w: 0.7, y0: BODY.belt, y1: BODY.winTop }, { x: -9.6, w: 0.7, y0: BODY.belt, y1: BODY.winTop }],
      partitions: [{ x: 7.4, z0: -BODY.half, z1: BODY.half, door: [-0.35, 0.35] }, { x: -4.6, z0: -0.62, z1: BODY.half, door: null }, { x: -10.85, z0: -BODY.half, z1: BODY.half, door: [-1.1, -0.45] }],
      corridors: [{ x0: -10.85, x1: -4.6, z: -0.62 }],
      chairs: dining.flatMap((w, i) => (w.x > -4.4 ? [{ x: w.x + 0.42, z: 1.0, yaw: -Math.PI / 2 }, { x: w.x - 0.42, z: 1.0, yaw: Math.PI / 2 }, { x: w.x + 0.42, z: -1.0, yaw: -Math.PI / 2 }, { x: w.x - 0.42, z: -1.0, yaw: Math.PI / 2 }] : [])),
      sofas: [],
      tables: dining.filter((w) => w.x > -4.4).flatMap((w) => [{ x: w.x, z: 1.0, w: 0.9, d: 0.8 }, { x: w.x, z: -1.0, w: 0.9, d: 0.8 }]),
      lamps: [-3.5, -0.4, 2.7, 5.8],
      kitchen: { x0: -10.85, x1: -4.6 },
    };
  },
  sleeper: () => {
    const comps = Array.from({ length: 9 }, (_, i) => 9.4 - i * 2.15);
    return {
      right: comps.map((x) => ({ x, w: 0.9, y0: BODY.belt, y1: BODY.winTop })),
      left: comps.map((x) => ({ x, w: 0.6, y0: BODY.belt + 0.05, y1: BODY.winTop })),
      partitions: [{ x: 10.85, z0: -BODY.half, z1: BODY.half, door: [-1.3, -0.6] }, ...comps.map((x) => ({ x: x - 1.075, z0: -0.45, z1: BODY.half, door: null })), { x: 10.48, z0: -0.45, z1: BODY.half, door: null }],
      corridors: [{ x0: -10.85, x1: 10.48, z: -0.45, doors: comps }],
      chairs: [],
      sofas: comps.map((x) => ({ x: x - 0.75, z: 0.5, yaw: Math.PI / 2, w: 1.75, berth: true })),
      tables: [],
      lamps: [-6, 0, 6],
    };
  },
  observation: () => {
    const lounge = winSaloon(8, -1.0, 1.15, 0.85);
    return {
      right: [{ x: 9.6, w: 0.85, y0: BODY.belt, y1: BODY.winTop }, { x: 7.4, w: 0.85, y0: BODY.belt, y1: BODY.winTop }, { x: 5.2, w: 0.85, y0: BODY.belt, y1: BODY.winTop }, ...lounge],
      left: [{ x: 9.6, w: 0.6, y0: BODY.belt, y1: BODY.winTop }, { x: 7.4, w: 0.6, y0: BODY.belt, y1: BODY.winTop }, { x: 5.2, w: 0.6, y0: BODY.belt, y1: BODY.winTop }, ...lounge],
      partitions: [{ x: 10.85, z0: -BODY.half, z1: BODY.half, door: [-1.3, -0.6] }, { x: 8.5, z0: -0.45, z1: BODY.half, door: null }, { x: 6.3, z0: -0.45, z1: BODY.half, door: null }, { x: 4.1, z0: -0.45, z1: BODY.half, door: null }, { x: 0.0, z0: -BODY.half, z1: BODY.half, door: [-1.3, -0.6] }],
      corridors: [{ x0: 0.0, x1: 10.85, z: -0.45, doors: [9.6, 7.4, 5.2] }],
      chairs: lounge.flatMap((w) => [{ x: w.x, z: 0.95, yaw: -Math.PI / 2 + 0.4 }, { x: w.x, z: -0.95, yaw: Math.PI / 2 - 0.4 }]),
      sofas: [{ x: 8.9, z: 0.5, yaw: Math.PI / 2, w: 1.6 }, { x: 6.7, z: 0.5, yaw: Math.PI / 2, w: 1.6 }, { x: 4.5, z: 0.5, yaw: Math.PI / 2, w: 1.6 }],
      tables: [],
      lamps: [-9.5, -6.5, -3.5, 2.5, 7.5],
      openRear: true,
    };
  },
};

/** The vestibule doors (x of their centres), both sides; the observation car's rear is its open platform. */
export function doorsOf(L) {
  const xe = BODY.bodyHalf;
  return [xe - BODY.vest / 2, -(xe - BODY.vest / 2)].filter((x) => !(L.openRear && x < 0));
}

/** Where the aisle runs at x (z), from the layout's corridors (else down the middle). */
export function aisleZ(L, x) {
  for (const c of L.corridors ?? []) if (x >= Math.min(c.x0, c.x1) && x <= Math.max(c.x0, c.x1)) return c.z;
  return 0;
}

