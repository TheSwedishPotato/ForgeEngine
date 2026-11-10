import test from 'node:test';
import assert from 'node:assert/strict';
import { NodePlatform } from '../src/platform/node.js';
import { InputManager, bindingLabel, radialDeadzone, PAD_BUTTONS } from '../src/input/index.js';

const DT = 1 / 60;
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} is not within ${eps} of ${b}`);

function rig(defs = {}, opts = {}) {
  const platform = new NodePlatform();
  const input = new InputManager(platform, opts);
  input.map(defs);
  return { platform, input, step(n = 1) { for (let i = 0; i < n; i++) input.advance(DT); } };
}
/** A standard-mapping controller: axes [lx, ly, rx, ry] and analog button values by name. */
const padState = ({ axes = [0, 0, 0, 0], buttons = {}, index = 0 } = {}) => ({
  index, id: 'Test pad (standard)', mapping: 'standard', axes,
  buttons: PAD_BUTTONS.map((n) => ({ pressed: (buttons[n] ?? 0) >= 0.5, value: buttons[n] ?? 0 })),
});
const WASD = { type: 'vec2', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], stick: 'Pad:ls' };

test('a keyboard button: pressed and released last one step, held persists', () => {
  const { platform, input, step } = rig({ jump: ['Space'] });
  step();
  assert.equal(input.down('jump'), false);
  platform.injectKey('Space', true);
  assert.equal(input.down('jump'), false, 'nothing changes until the next step');
  step();
  assert.ok(input.pressed('jump') && input.down('jump'));
  step();
  assert.ok(!input.pressed('jump') && input.down('jump'));
  platform.injectKey('Space', false);
  step();
  assert.ok(input.released('jump') && !input.down('jump'));
  step();
  assert.ok(!input.released('jump'));
});

test('a tap that starts and ends between two steps is still one press', () => {
  const { platform, input, step } = rig({ use: ['KeyF'] });
  platform.injectKey('KeyF', true); platform.injectKey('KeyF', false);
  step();
  assert.ok(input.pressed('use') && input.down('use'));
  step();
  assert.ok(input.released('use') && !input.down('use'));
});

test('key auto-repeat does not press again', () => {
  const { platform, input, step } = rig({ jump: ['Space'] });
  platform.injectKey('Space', true); step();
  let presses = 0;
  for (let i = 0; i < 10; i++) { platform.emit('key', { code: 'Space', key: ' ', down: true, repeat: true }); step(); if (input.pressed('jump')) presses++; }
  assert.equal(presses, 0);
});

test('several simulation steps in one frame report a press once', () => {
  const { platform, input, step } = rig({ jump: ['Space'] });
  platform.injectKey('Space', true);
  let presses = 0;
  for (let i = 0; i < 4; i++) { step(); if (input.pressed('jump')) presses++; }
  assert.equal(presses, 1);
});

test('chords need every part; Shift and Ctrl mean either side', () => {
  const { platform, input, step } = rig({ save: ['Ctrl+KeyS'], sprint: ['Shift'], plain: ['KeyS'] });
  platform.injectKey('KeyS', true); step();
  assert.ok(!input.down('save') && input.down('plain'));
  platform.injectKey('ControlRight', true); step();
  assert.ok(input.down('save') && input.pressed('save'), 'the chord forms when its last part arrives');
  assert.ok(input.down('plain'), 'a chord does not mute its plain key');
  platform.injectKey('ControlRight', false); step();
  assert.ok(!input.down('save'));
  platform.injectKey('ShiftLeft', true); step();
  assert.ok(input.down('sprint'));
  platform.injectKey('ShiftLeft', false); platform.injectKey('ShiftRight', true); step();
  assert.ok(input.down('sprint'));
});

test('mouse: position, movement fallback, buttons', () => {
  const { platform, input, step } = rig({ fire: ['Mouse0'], aim: ['Mouse2'] });
  platform.injectPointer('move', 100, 100); step();
  assert.equal(input.mouse.dx, 0, 'the first move has nothing to compare with');
  platform.injectPointer('move', 110, 95); step();
  assert.deepEqual([input.mouse.x, input.mouse.y, input.mouse.dx, input.mouse.dy], [110, 95, 10, -5]);
  platform.injectPointer('move', 112, 95); platform.injectPointer('move', 115, 99); step();
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [5, 4], 'movement accumulates until the step');
  step();
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [0, 0]);
  platform.injectPointer('down', 115, 99, { button: 0 }); step();
  assert.ok(input.pressed('fire') && input.mousePressed(0) && input.mouseDown(0));
  platform.injectPointer('down', 115, 99, { button: 2 }); step();
  assert.ok(input.down('fire') && input.pressed('aim'));
  platform.injectPointer('up', 115, 99, { button: 0, buttons: 4 }); step();
  assert.ok(input.released('fire') && input.down('aim') && input.mouseReleased(0));
  platform.injectPointer('up', 115, 99, { button: 2 }); step();
  assert.ok(!input.down('aim'));
});

test('a provided movement delta (pointer lock) wins over positions', () => {
  const { platform, input, step } = rig();
  platform.emit('pointerlock', { locked: true });
  platform.injectPointer('move', 50, 50, { dx: 7, dy: -3 }); step();
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [7, -3]);
  assert.ok(input.pointerLocked);
});

test('the wheel: up is positive, notches are 100 px or 3 lines, each notch is a press', () => {
  const { platform, input, step } = rig({ next: ['WheelDown'], prev: ['WheelUp'] });
  platform.injectWheel(0, 100); step();
  assert.equal(input.mouse.wheel, -1);
  assert.ok(input.pressed('next') && !input.down('prev'));
  platform.injectWheel(0, 100); step();
  assert.ok(input.pressed('next'), 'a second notch on the next step is a new press');
  step();
  assert.ok(!input.down('next'));
  platform.injectWheel(0, -200); step();
  assert.equal(input.mouse.wheel, 2);
  assert.ok(input.pressed('prev'));
  platform.emit('wheel', { dx: 0, dy: 3, mode: 1 }); step();
  assert.equal(input.mouse.wheel, -1, 'line mode: 3 lines per notch');
});

test('losing focus lets go of every key and button', () => {
  const { platform, input, step } = rig({ run: ['KeyR'], fire: ['Mouse0'] });
  platform.injectKey('KeyR', true); platform.injectPointer('down', 0, 0, { button: 0 }); step();
  assert.ok(input.down('run') && input.down('fire'));
  platform.emit('blur', {}); step();
  assert.ok(input.released('run') && input.released('fire') && !input.down('run') && !input.down('fire'));
  platform.injectKey('KeyR', true); step();
  assert.ok(input.pressed('run'), 'keys work again afterwards');
  platform.emit('visibility', { hidden: true }); step();
  assert.ok(!input.down('run'));
});

test('letting go of Cmd releases keys whose keyup macOS never sent', () => {
  const { platform, input, step } = rig({ run: ['KeyW'] });
  platform.injectKey('KeyW', true); platform.injectKey('MetaLeft', true); step();
  assert.ok(input.down('run'));
  platform.injectKey('MetaLeft', false); step();
  assert.ok(!input.down('run'));
});

test('vec2 from the keyboard: forward is +y, diagonals are normalised, opposites cancel', () => {
  const { platform, input, step } = rig({ move: WASD });
  platform.injectKey('KeyW', true); step();
  assert.deepEqual(input.vec2('move'), { x: 0, y: 1 });
  platform.injectKey('KeyD', true); step();
  const v = input.vec2('move');
  near(v.x, Math.SQRT1_2); near(v.y, Math.SQRT1_2); near(Math.hypot(v.x, v.y), 1);
  platform.injectKey('KeyS', true); step();
  assert.deepEqual([input.vec2('move').x, input.vec2('move').y], [1, 0], 'W and S cancel, D remains');
  platform.injectKey('KeyD', false); platform.injectKey('KeyA', true); step();
  assert.equal(input.vec2('move').x, -1);
  assert.ok(input.down('move'));
  platform.injectKey('KeyA', false); platform.injectKey('KeyW', false); platform.injectKey('KeyS', false); step();
  assert.ok(!input.down('move') && input.value('move') === 0);
});

test('radial dead zone: inside is zero, direction kept, rescaled outside, saturates at one', () => {
  assert.deepEqual(radialDeadzone(0.1, -0.1, 0.18), { x: 0, y: 0 });
  const o = radialDeadzone(0.59, 0, 0.18);
  near(o.x, 0.5, 1e-9); assert.equal(o.y, 0);
  const d = radialDeadzone(0.6, 0.8, 0.2);                       // length 1.0 at 53 degrees
  near(Math.hypot(d.x, d.y), 1, 1e-9); near(d.y / d.x, 0.8 / 0.6, 1e-9);
  near(Math.hypot(...Object.values(radialDeadzone(2, 0, 0.2))), 1, 1e-9);
});

test('vec2 from a stick: pushing up is forward; dead zone; sticks and keys combine without exceeding length one', () => {
  const { platform, input, step } = rig({ move: WASD });
  platform.setGamepads([padState({ axes: [0, -1, 0, 0] })]); step();
  assert.deepEqual(input.vec2('move'), { x: 0, y: 1 });
  platform.setGamepads([padState({ axes: [0.1, -0.1, 0, 0] })]); step();
  assert.deepEqual(input.vec2('move'), { x: 0, y: 0 });
  assert.ok(!input.down('move'));
  platform.setGamepads([padState({ axes: [0.59, 0, 0, 0] })]); step();
  near(input.vec2('move').x, 0.5, 1e-6);
  platform.setGamepads([padState({ axes: [Math.SQRT1_2, -Math.SQRT1_2, 0, 0] })]); step();
  near(Math.hypot(input.vec2('move').x, input.vec2('move').y), 1, 1e-6);
  platform.setGamepads([padState({ axes: [0, -1, 0, 0] })]); platform.injectKey('KeyW', true); platform.injectKey('KeyD', true); step();
  near(Math.hypot(input.vec2('move').x, input.vec2('move').y), 1, 1e-9);
  platform.setGamepads([]); platform.injectKey('KeyW', false); platform.injectKey('KeyD', false); step();
  assert.deepEqual(input.vec2('move'), { x: 0, y: 0 });
});

test('gamepad buttons: edges at half travel, analog triggers, a specific controller', () => {
  const { platform, input, step } = rig({ jump: ['Space', 'Pad:a'], aim: ['Pad:lt'], second: ['Pad1:y'] });
  platform.setGamepads([padState({ buttons: { a: 1 } })]); step();
  assert.ok(input.pressed('jump') && input.down('jump'));
  step();
  assert.ok(!input.pressed('jump') && input.down('jump'));
  platform.setGamepads([padState({ buttons: { lt: 0.3 } })]); step();
  assert.ok(input.released('jump') && !input.down('aim'));
  near(input.value('aim'), 0.3);
  platform.setGamepads([padState({ buttons: { lt: 0.8 } })]); step();
  assert.ok(input.pressed('aim')); near(input.value('aim'), 0.8);
  platform.setGamepads([padState({ buttons: { y: 1 }, index: 0 })]); step();
  assert.ok(!input.down('second'), 'controller 0 does not drive a Pad1 binding');
  platform.setGamepads([padState({ buttons: { y: 1 }, index: 1 })]); step();
  assert.ok(input.down('second'));
  assert.equal(input.pad(1).index, 1); assert.equal(input.pad(0), null);
});

test('stick directions work as buttons', () => {
  const { platform, input, step } = rig({ left: ['Pad:lx-'], right: ['Pad:lx+'], down: ['Pad:ly+'] });
  platform.setGamepads([padState({ axes: [-0.9, 0.1, 0, 0] })]); step();
  assert.ok(input.pressed('left') && !input.down('right') && !input.down('down'));
  platform.setGamepads([padState({ axes: [0, 0.9, 0, 0] })]); step();
  assert.ok(input.released('left') && input.down('down'));
});

test('an axis action: keys, wheel, and a stick axis add up and clamp', () => {
  const { platform, input, step } = rig({ zoom: { type: 'axis', positive: ['KeyE'], negative: ['KeyQ'], wheel: true, stick: 'Pad:ry' } });
  platform.injectKey('KeyE', true); step();
  assert.equal(input.axis('zoom'), 1);
  platform.injectKey('KeyQ', true); step();
  assert.equal(input.axis('zoom'), 0);
  platform.injectKey('KeyE', false); step();
  assert.equal(input.axis('zoom'), -1);
  platform.injectKey('KeyQ', false); platform.injectWheel(0, -100); step();
  assert.equal(input.axis('zoom'), 1, 'one notch up');
  platform.injectWheel(0, -500); step();
  assert.equal(input.axis('zoom'), 1, 'clamped');
  platform.setGamepads([padState({ axes: [0, 0, 0, 0.59] })]); step();
  near(input.axis('zoom'), 0.5, 1e-6);
  platform.setGamepads([padState({ axes: [0, 0, 0, -1] })]); step();
  assert.equal(input.axis('zoom'), -1);
  assert.ok(input.down('zoom'));
});

test('look: the mouse counts only while the pointer is locked (default), always, or only while dragging', () => {
  const { platform, input, step } = rig({
    locked: { type: 'look' },
    free: { type: 'look', mouse: 'always', sensitivity: 0.01 },
    drag: { type: 'look', mouse: 'drag', sensitivity: 0.01 },
    flipped: { type: 'look', mouse: 'always', sensitivity: 0.01, invertY: true },
    none: { type: 'look', mouse: false, stick: 'Pad:rs' },
  });
  platform.injectPointer('move', 0, 0); platform.injectPointer('move', 10, -20); step();
  assert.deepEqual(input.look('locked'), { x: 0, y: 0 }, 'not locked');
  near(input.look('free').x, 0.1); near(input.look('free').y, 0.2);
  assert.deepEqual(input.look('drag'), { x: 0, y: 0 }, 'no button down');
  near(input.look('flipped').y, -0.2);
  assert.equal(input.look('none').x, 0);
  platform.injectPointer('down', 10, -20); platform.injectPointer('move', 30, -20); step();
  near(input.look('drag').x, 0.2);
  platform.injectPointer('up', 30, -20); platform.injectPointer('move', 40, -20); step();
  assert.equal(input.look('drag').x, 0);
  platform.emit('pointerlock', { locked: true });
  platform.injectPointer('move', 40, -20, { dx: 100, dy: -50 }); step();
  near(input.look('locked').x, 0.22); near(input.look('locked').y, 0.11);
  platform.setGamepads([padState({ axes: [0, 0, 1, 0] })]); step();
  near(input.look('none').x, 2.8 * DT, 1e-9); assert.equal(input.look('none').y, 0);
  platform.setGamepads([padState({ axes: [0, 0, 0, -1] })]); step();
  assert.equal(input.look('none').x, 0); near(input.look('none').y, 2.8 * DT, 1e-9);        // pushed up looks up
});

test('look from a stick is scaled by the step length', () => {
  const { platform, input } = rig({ look: { type: 'look', stick: 'Pad:rs', stickSpeed: 3 } });
  platform.setGamepads([padState({ axes: [0, 0, 1, 0] })]);
  input.advance(0.01);
  near(input.look('look').x, 0.03, 1e-9);
  input.advance(0.02);
  near(input.look('look').x, 0.06, 1e-9);
});

test('contexts: only the current context and "always" actions respond; switching away releases', () => {
  const { platform, input, step } = rig({ jump: ['Space'] });
  input.map({ confirm: ['Space'] }, 'menu');
  input.map({ screenshot: ['F12'] }, 'always');
  platform.injectKey('Space', true); step();
  assert.ok(input.down('jump') && !input.down('confirm'));
  input.setContext('menu'); step();
  assert.ok(!input.down('jump') && input.released('jump'), 'a held action is released when its context goes away');
  assert.ok(input.down('confirm') && input.pressed('confirm'));
  platform.injectKey('F12', true); step();
  assert.ok(input.pressed('screenshot'));
  input.setContext('default'); step();
  assert.ok(input.down('jump') && input.pressed('jump') && !input.down('confirm'));
});

test('input buffering: a press stays usable for its window until consumed', () => {
  const { platform, input, step } = rig({ jump: ['Space'] });
  assert.equal(input.buffered('jump'), false);
  platform.injectKey('Space', true); step();
  platform.injectKey('Space', false);
  step(5);
  assert.ok(input.buffered('jump', 0.15), 'about 0.08 s later');
  step(5);
  assert.ok(!input.buffered('jump', 0.15), 'about 0.17 s later');
  platform.injectKey('Space', true); step();
  assert.ok(input.buffered('jump'));
  input.consume('jump');
  assert.ok(!input.buffered('jump'));
});

test('hold time is measured in simulation time', () => {
  const { platform, input, step } = rig({ charge: ['Mouse0'] });
  platform.injectPointer('down', 0, 0, { button: 0 }); step();
  near(input.heldTime('charge'), 0);
  step(29);
  near(input.heldTime('charge'), 29 * DT, 1e-9);
  platform.injectPointer('up', 0, 0, { button: 0 }); step();
  assert.ok(input.released('charge'));
  near(input.lastHold('charge'), 30 * DT, 1e-9);
  assert.equal(input.heldTime('charge'), 0);
});

test('rebinding changes what responds, validates, and can be reset', () => {
  const { platform, input, step } = rig({ jump: ['Space'], move: WASD });
  assert.deepEqual(input.bindings('jump'), ['Space']);
  assert.deepEqual(input.conflicts('KeyW'), ['move.up']);
  input.rebind('jump', ['KeyJ', 'Pad:b']);
  platform.injectKey('Space', true); step();
  assert.ok(!input.down('jump'));
  platform.injectKey('Space', false); platform.injectKey('KeyJ', true); step();
  assert.ok(input.pressed('jump'));
  assert.deepEqual(input.conflicts('KeyJ'), ['jump']);
  assert.throws(() => input.rebind('jump', ['Pad:zzz']), /Unknown gamepad control/);
  assert.deepEqual(input.bindings('jump'), ['KeyJ', 'Pad:b'], 'a failed rebind changes nothing');
  assert.throws(() => input.rebind('move', ['ArrowUp']), /which part/);
  input.rebind('move', ['ArrowUp'], 'up');
  platform.injectKey('KeyJ', false); platform.injectKey('ArrowUp', true); step();
  assert.equal(input.vec2('move').y, 1);
  assert.deepEqual(input.bindings('move', 'up'), ['ArrowUp']);
  input.resetBindings();
  assert.deepEqual(input.bindings('jump'), ['Space']);
  assert.deepEqual(input.bindings('move', 'up'), ['KeyW']);
  assert.throws(() => input.down('nope'), /Unknown input action/);
  assert.throws(() => input.map({ bad: { type: 'vec2', stick: 'Pad:a' } }), /not valid as a stick/);
  assert.throws(() => input.map({ bad: ['Ctrl+'] }), /Bad input binding/);
});

test('captureNext resolves with the next input and swallows it', async () => {
  const { platform, input, step } = rig({ jump: ['Space'] });
  let p = input.captureNext();
  assert.ok(input.capturing);
  platform.injectKey('KeyJ', true);
  assert.equal(await p, 'KeyJ');
  assert.ok(!input.capturing);
  platform.emit('key', { code: 'KeyJ', key: 'j', down: true, repeat: true });          // the key is still held: auto-repeat
  platform.injectKey('KeyJ', false);
  step();
  assert.ok(!input.keyDown('KeyJ') && !input.keyPressed('KeyJ'), 'the captured press never reached the game');

  p = input.captureNext(); platform.injectKey('Escape', true);
  assert.equal(await p, null, 'Escape cancels');
  p = input.captureNext({ allowEscape: true }); platform.injectKey('Escape', true);
  assert.equal(await p, 'Escape');

  p = input.captureNext(); platform.injectPointer('down', 0, 0, { button: 2 });
  assert.equal(await p, 'Mouse2');
  p = input.captureNext(); platform.injectWheel(0, 100);
  assert.equal(await p, 'WheelDown');

  p = input.captureNext(); platform.setGamepads([padState({ buttons: { b: 1 } })]); step();
  assert.equal(await p, 'Pad:b');
  platform.setGamepads([padState()]); step();
  p = input.captureNext(); platform.setGamepads([padState({ axes: [-1, 0, 0, 0] })]); step();
  assert.equal(await p, 'Pad:lx-');

  // a new capture cancels the pending one
  const first = input.captureNext(), second = input.captureNext();
  assert.equal(await first, null);
  platform.injectKey('KeyK', true);
  assert.equal(await second, 'KeyK');
  const rebinding = input.captureNext();                  // what a "press a key to rebind" screen does
  platform.injectKey('KeyL', true);
  input.rebind('jump', [await rebinding]);
  assert.deepEqual(input.bindings('jump'), ['KeyL']);
});

test('bindings serialise, load, ignore bad entries, and persist through the platform', () => {
  const a = rig({ jump: ['Space'], move: WASD, look: { type: 'look', sensitivity: 0.003, invertY: true } });
  a.input.rebind('jump', ['KeyJ']); a.input.rebind('move', ['ArrowLeft'], 'left');
  const json = JSON.parse(JSON.stringify(a.input.serialize()));
  assert.equal(json.version, 1);
  assert.deepEqual(json.actions.jump, { bindings: ['KeyJ'] });
  assert.equal(json.actions.look.invertY, true);

  const b = rig({ jump: ['Space'], move: WASD, look: { type: 'look' } });
  b.input.load(json);
  assert.deepEqual(b.input.bindings('jump'), ['KeyJ']);
  assert.deepEqual(b.input.bindings('move', 'left'), ['ArrowLeft']);
  b.platform.injectKey('KeyJ', true); b.step();
  assert.ok(b.input.pressed('jump'));

  b.input.load({ actions: { jump: { bindings: ['Pad:nonsense'] }, vanished: { bindings: ['KeyZ'] }, move: 'junk' } });
  assert.deepEqual(b.input.bindings('jump'), ['KeyJ'], 'a malformed entry is skipped');

  a.input.save();
  const c = new InputManager(a.platform); c.map({ jump: ['Space'] });
  assert.ok(c.restore());
  assert.deepEqual(c.bindings('jump'), ['KeyJ']);
  const d = new InputManager(new NodePlatform()); d.map({ jump: ['Space'] });
  assert.equal(d.restore(), false);
});

test('a recording replays to identical results, ignores live input meanwhile, and then hands control back', () => {
  const defs = { jump: ['Space'], fire: ['Mouse0'], move: WASD, look: { type: 'look', mouse: 'always' }, zoom: { type: 'axis', wheel: true, positive: [], negative: [] } };
  const script = {
    1: (p) => p.injectKey('KeyW', true),
    3: (p) => { p.injectKey('Space', true); p.injectPointer('move', 5, 5); },
    4: (p) => { p.injectKey('Space', false); p.injectPointer('move', 12, 1); },
    6: (p) => { p.injectPointer('down', 12, 1, { button: 0 }); p.injectKey('KeyD', true); },
    8: (p) => { p.setGamepads([padState({ axes: [0.7, -0.2, 0.5, 0], buttons: { a: 1 } })]); p.injectWheel(0, -100); },
    11: (p) => { p.injectKey('KeyW', false); p.injectPointer('up', 12, 1, { button: 0 }); p.setGamepads([]); },
    13: (p) => { p.injectKey('KeyD', false); p.injectKey('Space', true); p.injectKey('Space', false); },
  };
  const sample = (inp) => ({
    jump: [inp.pressed('jump'), inp.down('jump'), inp.released('jump')], fire: [inp.pressed('fire'), inp.down('fire')],
    move: inp.vec2('move'), look: inp.look('look'), zoom: inp.axis('zoom'),
  });
  const src = rig(defs);
  src.step(2);                                           // some history before recording starts
  src.platform.injectKey('ShiftLeft', true); src.step();  // a key held while recording starts
  src.input.startRecording();
  const trace = [];
  for (let n = 1; n <= 16; n++) { script[n]?.(src.platform); src.input.advance(DT); trace.push(sample(src.input)); }
  const rec = JSON.parse(JSON.stringify(src.input.stopRecording()));
  assert.equal(rec.length, 16);
  assert.deepEqual(rec.init.keys, ['ShiftLeft']);
  assert.ok(rec.log.some((e) => e.type === 'pads'));

  const dst = rig({ ...defs, shift: ['Shift'] });
  dst.input.startPlayback(rec);
  assert.ok(dst.input.playing);
  const replay = [];
  for (let n = 1; n <= 16; n++) {
    dst.platform.injectKey('KeyQ', true); dst.platform.injectKey('Space', true);       // live input is ignored
    dst.input.advance(DT); replay.push(sample(dst.input));
    if (n === 1) assert.ok(dst.input.down('shift'), 'a key held at the start of the recording is held in the replay');
  }
  assert.deepEqual(replay, trace);
  dst.input.advance(DT);
  assert.ok(!dst.input.playing, 'playback ended after the recorded length');
  dst.platform.injectKey('KeyW', true); dst.input.advance(DT);
  assert.equal(dst.input.vec2('move').y, 1, 'live input counts again');
});

test('multi-touch: the first finger is the cursor and the button; another finger does not release it', () => {
  const { platform, input, step } = rig({ tap: ['Mouse0'] });
  const touch = (kind, id, x, y, extra = {}) => platform.emit('pointer', { kind, id, button: 0, buttons: kind === 'up' ? 0 : 1, pointerType: 'touch', x, y, dx: 0, dy: 0, ...extra });
  touch('down', 5, 10, 10); step();
  assert.ok(input.pressed('tap'));
  touch('down', 6, 200, 200); step();
  assert.ok(!input.pressed('tap'));
  assert.deepEqual([input.mouse.x, input.mouse.y], [10, 10], 'the second finger does not move the cursor');
  touch('up', 6, 200, 200); step();
  assert.ok(input.down('tap'), 'lifting the second finger leaves the tap held');
  touch('up', 5, 10, 10); step();
  assert.ok(input.released('tap'));
  assert.equal(input.pointers.size, 0);
});

test('lockOnClick asks the platform for pointer lock on a mouse click', () => {
  const platform = new NodePlatform(), calls = [];
  platform.setPointerLock = (on) => calls.push(on);
  const input = new InputManager(platform, { lockOnClick: true });
  platform.injectPointer('down', 5, 5);
  assert.deepEqual(calls, [true]);
  platform.emit('pointerlock', { locked: true });
  platform.injectPointer('up', 5, 5); platform.injectPointer('down', 5, 5);
  assert.deepEqual(calls, [true], 'no second request while locked');
  input.lockPointer(false);
  assert.deepEqual(calls, [true, false]);
});

test('anyPressed reports the first input of any kind; dispose detaches', () => {
  const { platform, input, step } = rig({ jump: ['Space'] });
  step(); assert.ok(!input.anyPressed());
  platform.injectKey('KeyX', true); step(); assert.ok(input.anyPressed());
  step(); assert.ok(!input.anyPressed());
  platform.injectPointer('down', 0, 0); step(); assert.ok(input.anyPressed());
  platform.injectPointer('up', 0, 0); step();
  platform.setGamepads([padState({ buttons: { x: 1 } })]); step(); assert.ok(input.anyPressed());
  platform.setGamepads([]); step();
  input.dispose();
  platform.injectKey('Space', true); step();
  assert.ok(!input.down('jump'));
});

test('binding labels read like a controls screen', () => {
  assert.equal(bindingLabel('Ctrl+KeyS'), 'Ctrl + S');
  assert.equal(bindingLabel('Space'), 'Space');
  assert.equal(bindingLabel('ArrowUp'), '↑');
  assert.equal(bindingLabel('Digit3'), '3');
  assert.equal(bindingLabel('Mouse2'), 'Right Mouse');
  assert.equal(bindingLabel('WheelUp'), 'Wheel ↑');
  assert.equal(bindingLabel('Pad:a'), 'A');
  assert.equal(bindingLabel('Pad:lx-'), 'Left Stick ←');
  assert.equal(bindingLabel('Pad1:ry+'), 'Right Stick ↓');
  assert.equal(bindingLabel('Shift+Mouse0'), 'Shift + Left Mouse');
  assert.equal(bindingLabel('Pad:right'), 'D-pad →');
});

test('fixed-step view: the simulation sees every press and look delta once, whatever the frame rate', () => {
  const { platform, input } = rig({ jump: ['Space'], look: { type: 'look', mouse: 'always', sensitivity: 0.01 }, fire: ['Mouse0'] });
  const frame = () => input.advance(1 / 144);                      // a 144 Hz display on a 60 Hz simulation
  const fixed = () => {
    input.beginFixed();
    const r = { pressed: input.pressed('jump'), released: input.released('jump'), look: input.look('look').x, key: input.keyPressed('Space'), mouse: input.mousePressed(0), any: input.anyPressed(), down: input.down('jump') };
    input.endFixed();
    return r;
  };
  platform.injectKey('Space', true); platform.injectPointer('move', 0, 0); platform.injectPointer('move', 10, 0); platform.injectPointer('down', 10, 0);
  frame();
  assert.ok(input.pressed('jump'), 'the frame view sees the press');
  frame();
  assert.ok(!input.pressed('jump'), 'and no longer on the next frame');
  const s1 = fixed();                                              // the first fixed step after two frames without one
  assert.ok(s1.pressed && s1.key && s1.mouse && s1.any && s1.down);
  near(s1.look, 0.1);
  const s2 = fixed();                                              // a second step in the same frame sees nothing new
  assert.ok(!s2.pressed && !s2.key && !s2.mouse && !s2.any && s2.down);
  assert.equal(s2.look, 0);

  platform.injectKey('Space', false); frame();
  const a = fixed(), b = fixed();
  assert.ok(a.released && !b.released && !a.down);

  platform.injectKey('Space', true); platform.injectKey('Space', false); frame(); frame(); frame();   // a tap, three frames, no step
  const t = fixed();
  assert.ok(t.pressed && t.released, 'a whole tap between two fixed steps is still delivered');
  assert.ok(!fixed().pressed);

  // outside fixed steps everything reads the frame view again
  platform.injectKey('Space', true); frame();
  assert.ok(input.pressed('jump') && input.keyPressed('Space'));
});
