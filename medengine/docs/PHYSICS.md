# Physics

`engine.physics` is a `World`. It steps at the engine's fixed rate (60 Hz, with `substeps` inside), using a sequential-impulse
solver with warm starting and sleeping. Everything is in metres, kilograms and seconds.

```js
import { PlaneCollider, BoxCollider, MeshCollider, RigidBody, BallJoint, Vector3 } from 'medengine';
const world = engine.physics;

world.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));                       // the ground
world.addCollider(new BoxCollider({ center: new Vector3(0, 1, -4), half: new Vector3(3, 1, 0.2) }));
world.addCollider(MeshCollider.fromGeometry(rocks.geometry, rocks.matrixWorld));    // any triangle mesh (static)

const ball = world.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.4 }, mass: 5, position: new Vector3(0, 3, 0), object: ballMesh }));
ball.applyImpulse(new Vector3(0, 0, 10));
const barrel = world.addBody(new RigidBody({ shape: { type: 'capsule', radius: 0.3, length: 0.6 }, mass: 30, object: barrelMesh }));
```

A body given an `object` moves that scene object every step. `new RigidBody()` without a valid `shape` throws.

**Static colliders** are `PlaneCollider`, `BoxCollider` (with a rotation), `SphereCollider`, `CapsuleCollider` and
`MeshCollider` (triangles in a bounding-volume tree, one-sided unless `twoSided`). Each has `friction`, `restitution`, and
`group` and `mask` for filtering: two things collide when `(a.group & b.mask) && (b.group & a.mask)`. Call
`world.refreshColliders()` after moving one.

**Rigid bodies** are spheres and capsules, with `mass`, `friction`, `restitution`, damping, `gravityScale` and filtering. Use
`applyForce` and `applyImpulse(impulse, point)` to push them. Bodies fall asleep when they rest, and a touch or a joint wakes
them.

**Joints:** `BallJoint(a, b, anchor, { axis, coneAngle, twistMin, twistMax, friction })` and `HingeJoint(a, b, anchor, axis,
{ min, max })`. Pin a body to the world with `world.ground`.

**Characters:** `new Character(world, { position, radius, height, stepHeight, slopeLimit, airControl, coyoteTime, pushBodies })`
is a kinematic capsule. Call `character.update(dt, wishVelocity)` in a fixed step. It walks up steps, slides along walls,
stands on slopes up to the limit, pushes loose bodies, jumps (`jump(speed)`, with coyote time), crouches (`setHeight`), and
reports `grounded`, `groundNormal`, `justLanded` and `landingSpeed`. `actor.attachCharacter(world)` does all of this for an
`Actor`.

**Ragdolls:** `new Ragdoll({ root, bones }, world)` builds capsules and joints with anatomical limits over a skeleton.
`activate({ velocity, impulse })` hands the body to physics, `track(dt)` (while animated) gives the limbs their velocity at the
switch, and `lying()` and `snapshotClip()` help the get-up. `Actor.ragdollOn()` and `ragdollOff()` wrap it all.

**Triggers:** `world.addTrigger(collider, { onEnter, onExit, filter })` reports characters, and bodies with
`triggerActivator = true`, entering and leaving a volume.

**Queries:**

```js
const hit = world.raycast(origin, dir, 50, { bodies: true });   // { t, point, normal, collider, body } or null
const blocked = world.overlapSphere(point, 0.3, { ignore: barrel });
const sweep = world.sphereCast(origin, dir, 0.2, 5);             // { t, point, normal, startsInside } or null
```

## Limits

- There is no continuous collision detection: a small, very fast body can pass through a thin wall in one step.
- `sphereCast` is marched in steps of at most half the radius, so it can miss geometry thinner than that. The follow camera
  uses it.
- Rigid bodies are spheres and capsules only. A box-shaped *dynamic* body is a capsule or a few joined bodies.
- Characters do not ride moving platforms.
- The limbs of one ragdoll do not collide with each other, and joint cone limits are symmetric.
- Measured on a 2-vCPU cloud machine: 400 tumbling spheres and capsules take about 2.6 ms per step (`npm run bench -- --scenes physics`).
