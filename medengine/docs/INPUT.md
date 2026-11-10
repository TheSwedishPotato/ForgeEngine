# Input

`engine.input` is an `InputManager`. It turns the platform's keyboard, mouse and gamepad events into **named actions** that a
player can rebind.

```js
input.map({
  jump:   ['Space', 'Pad:a'],                                               // a button: any of these
  attack: { type: 'button', bindings: ['Mouse0', 'Pad:rt'] },
  save:   ['Ctrl+KeyS'],                                                    // a chord
  move:   { type: 'vec2', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], stick: 'Pad:ls' },
  look:   { type: 'look', mouse: 'locked', sensitivity: 0.0022, stick: 'Pad:rs', stickSpeed: 2.8 },
  zoom:   { type: 'axis', positive: ['KeyE'], negative: ['KeyQ'], wheel: true },
});

if (input.pressed('jump')) hero.jump();
const { x, y } = input.vec2('move');      // x right, y forward, length <= 1 (a radial dead zone on sticks)
const look = input.look('look');          // radians since the last read: x right, y up
```

**Reading actions:**

- `down(name)`, `pressed(name)` and `released(name)` for buttons;
- `value(name)` for how far a trigger is pulled;
- `axis(name)` from −1 to 1;
- `vec2(name)` and `look(name)`;
- `heldTime(name)`, and `lastHold(name)` for charge attacks;
- `buffered(name, 0.15)` and `consume(name)`, so a jump pressed just before landing still counts.

**The two cadences:** the engine draws at the display's rate and simulates at 60 Hz. Inside `fixedUpdate`, `pressed()`, `released()`
and `look()` report what happened since the previous fixed step, exactly once. Inside `update` they report what happened
since the previous frame. A tap is never lost and never seen twice.

**Binding names:**

- **Keyboard:** `KeyboardEvent.code` names (`'KeyW'`, `'Space'`, `'ArrowUp'`, `'ShiftLeft'`, `'Digit1'`). `'Shift'`, `'Ctrl'`,
  `'Alt'` and `'Meta'` mean either side.
- **Mouse:** `'Mouse0'` (left), `'Mouse1'` (middle), `'Mouse2'` (right), `'Mouse3'`, `'Mouse4'`, `'WheelUp'` and `'WheelDown'`.
- **Gamepad:** `'Pad:a'`, `'Pad:b'`, `'Pad:x'`, `'Pad:y'`, `'Pad:lb'`, `'Pad:rb'`, `'Pad:lt'`, `'Pad:rt'`, `'Pad:back'`, `'Pad:start'`,
  `'Pad:l3'`, `'Pad:r3'`, the d-pad (`'Pad:up'` ...) and `'Pad:home'`. Stick directions work as buttons (`'Pad:lx+'`, `'Pad:ry-'`).
  `'Pad:lx'` is a whole axis. In `vec2` and `look` actions, whole sticks are `stick: 'Pad:ls'` and `'Pad:rs'`.
  `'Pad1:a'` listens to controller 1 only.
- **Chords:** `'Ctrl+KeyS'`, `'Shift+Mouse0'`.

**Mouse look:** `look.mouse` is `'locked'` (only while the pointer is captured, which needs a click in a browser:
`Engine.create({ input: { lockOnClick: true } })`), `'always'`, `'drag'` (while a button is held) or `false`.

**Contexts:** `input.map(defs, 'menu')` puts actions in a context, and `input.setContext('menu')` switches which ones respond.
Actions in the context `'always'` respond everywhere. The demo uses `'splash'` while its start card is up.

**Rebinding:**

```js
const binding = await input.captureNext();      // the next key, button, wheel notch or stick push: 'KeyJ', 'Pad:b', 'Pad:lx-'
if (binding) input.rebind('jump', [binding]);
input.conflicts('KeyJ');                         // which actions already use it
input.save();                                    // stored with the platform (localStorage in a browser)
input.restore();                                 // at start-up
input.resetBindings();                           // back to what map() said
```

`serialize()` and `load(json)` give the bindings as plain JSON for your own settings file.

**Recording and replay:** `startRecording()` ... `stopRecording()` gives a JSON log of everything the manager was fed.
`startPlayback(log)` replays it, ignoring live input meanwhile. Together with the engine's deterministic `run()` that
reproduces a play session. The tests use it.

**Keys without a keyboard:** `platform.injectKey('KeyW', true)`, `injectPointer(...)`, `injectWheel(...)` and `setGamepads([...])`
feed the same path real devices do. Tests, bots and tutorials use them.

There are no touch controls yet: a phone sees pointer events, but no on-screen stick or buttons are drawn.
