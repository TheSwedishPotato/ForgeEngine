# The Director: gameplay camera and film shots

```js
const director = engine.add(new Director(engine));
director.followActor(hero);                           // third person, over the right shoulder
director.cut({ type: 'cu', on: ferryman, angle: 25, lens: 85, move: 'push', dur: 4 }, { blend: 1 });
director.followActor(hero);                           // back to play (it glides there; snap: true jumps)
```

The Director is a system: added to the engine, it moves `engine.camera` in `lateUpdate`, after every actor has taken its pose.
Without an engine, give it a camera (`new Director(stage)` or `new Director(camera)`) and call `director.advance(dt)` yourself.
In Med Engine 2 that method was `update(dt)`.

## The follow camera

`followActor(actor, options)` gives a third-person camera that swings round the actor, looks a little ahead of it, and stops
at walls when there is a physics world: it sweeps a sphere from the actor to the camera.

| Option | Default | |
| --- | --- | --- |
| `dist` | 3.2 | Metres behind the pivot |
| `height` | −0.3 | Metres above the chest that the camera swings round. −0.3 is the hips, which frames the whole body. |
| `shoulder` | 0.45 | Metres to the side; negative for the other shoulder |
| `pitch` | −8 | Degrees; negative looks down |
| `lens` | 28 | Focal length in mm |
| `aim` | 2.5 | Metres ahead of the actor that the camera looks |
| `mode` | `'chase'` | `'chase'` swings behind the actor as it turns; `'orbit'` turns only by `look()` |
| `collide`, `radius` | true, 0.2 | Stop at walls |
| `minPitch`, `maxPitch` | −70, 35 | How far `look()` can tilt |
| `snap` | false | Place the camera at once instead of gliding |
| `handheld` | 0.15 | A camera operator's drift; 0 holds it still |

Med Engine 2's tighter framing, which cropped the legs, is `{ dist: 2.6, height: 0.35, lens: 32 }`.

Turn it with `director.look(right, up)` in radians. For a mouse that is the input manager's look action; for a stick, its
value times `dt` times a speed. `director.yaw` is where the camera faces, so movement can be made relative to it (see the
README). `director.kick(0.5)` shakes the camera for an impact.

## Shots

`director.cut(shot, { blend })` cuts, or blends over `blend` seconds. A shot is called the way a director would call it, and
the camera works out where to stand:

| `type` | Framing |
| --- | --- |
| `ecu`, `cu`, `mcu` | The eyes; the face; head and shoulders |
| `ms`, `mls` | Waist up (the default); knees up |
| `ws`, `ews` | The whole body; the place |
| `ots` | Over `over`'s shoulder onto `on` (`side`, `back`, `shoulder`) |
| `two` | `on` and `with` together (`flip` films from the other side) |
| `pov` | Through `on`'s eyes, looking along `look` |
| `insert` | A hand or an object (`at`, `size`) |
| `free` | `pos` and `target`, placed by hand |

More fields:

- `angle`: degrees round the subject. 0 is in front, 90 its left, −90 its right.
- `height`: metres; low angles are negative.
- `lens`: mm, as a 35 mm full-frame equivalent. Each type has its own default (`LENS`).
- `frame`: how many metres tall the picture is at the subject (`FRAME`).
- `look`, `lookMix`, `lookRoom`: lean toward something, and leave room in front of a profile.
- `focus`, `aperture`, `pull`: written to `stage.lens`. No depth-of-field pass reads them yet.
- `dutch`: roll, in degrees.
- `handheld`: the operator's drift.
- `track: false`: freeze the subjects where they stood at the cut.

Moves run over `dur` seconds, and `amount` scales them:

| Move | |
| --- | --- |
| `push`, `pull` | Dolly in or out |
| `crane`, `drop` | Up or down |
| `truck` | Sideways |
| `orbit` | Round the subject, by `orbit` degrees |
| `track` | Follow a moving subject with a little lag |

A subject can be an actor, an `Object3D`, a point (`Vector3` or `[x, y, z]`), or a function returning one.

`solveShot(shot, t)` gives the camera pose of a shot at time `t` without moving anything, for previews and tests.
`director.manual()` hands the camera back to your code.
