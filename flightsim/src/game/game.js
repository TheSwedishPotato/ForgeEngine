/**
 * The game: puts the simulated aeroplane, its 3D model and cockpit, the airfield and the sound together on a Med Engine 3
 * Engine, reads the pilot's keyboard, mouse and gamepad, and moves the camera. It never touches the page: main.js owns the HTML.
 *
 * The simulation runs in the engine's fixed 60 Hz step (four physics sub-steps inside each); drawing interpolates between
 * steps. The world is drawn relative to the aeroplane (a floating origin), so the cockpit stays sharp far from the field.
 */
import { Vector3, Quaternion } from '../../../medengine/src/index.js';
import { Weather, WEATHER_PRESETS } from '../sim/atmosphere.js';
import { Aircraft } from '../sim/aircraft.js';
import { KT, FT, DEG, clamp, wrap360 } from '../sim/util.js';
import { buildWorld, FIELD } from './world.js';
import { buildAirframe } from './airframe.js';
import { buildCockpit } from './cockpit.js';
import { FlightSound } from './sound.js';

export { WEATHER_PRESETS, FIELD };

export function createGame(engine, { start = 'cold', preset = 'Fair, light wind', registration = 'SE-MED' } = {}) {
  const { scene, input, camera } = engine, stage = engine.stage;
  const weather = new Weather({ fieldElev: FIELD.elevFt * FT, latitude: FIELD.latitude, ...WEATHER_PRESETS[preset] });
  const world = buildWorld(weather);
  const ac = new Aircraft({ weather, ground: world.ground, nav: world.nav, magVar: FIELD.magVar });
  const sound = new FlightSound();
  const model = buildAirframe(ac.cfg, { registration });
  const cockpit = buildCockpit(ac, model.root, (n) => sound.fx(n), { registration });
  scene.add(world.group, world.sun, world.sun.target, model.root);
  camera.near = 0.05; camera.far = 90000; camera.fov = 62; camera.updateProjectionMatrix();

  input.map({
    pitch: { type: 'axis', positive: ['ArrowDown', 'KeyS'], negative: ['ArrowUp', 'KeyW'], stick: 'Pad:ly' },      // + is pull
    roll: { type: 'axis', positive: ['ArrowRight', 'KeyD'], negative: ['ArrowLeft', 'KeyA'], stick: 'Pad:lx' },
    yaw: { type: 'axis', positive: ['KeyE', 'KeyX'], negative: ['KeyQ', 'KeyZ'], stick: 'Pad:rx' },
    throttleUp: ['PageUp', 'Equal', 'Pad:rb'], throttleDown: ['PageDown', 'Minus', 'Pad:lb'],
    brake: ['KeyB', 'Space', 'Pad:a'], brakeL: ['Comma'], brakeR: ['Period'],
    flapsDown: ['KeyF', 'BracketRight', 'Pad:down'], flapsUp: ['KeyR', 'BracketLeft', 'Pad:up'],
    trimUp: ['End', 'Numpad1', 'Pad:y'], trimDown: ['Home', 'Numpad7', 'Pad:x'],
    view1: ['Digit1'], view2: ['Digit2'], view3: ['Digit3'], viewReset: ['Digit0', 'Mouse1'],
    pause: ['KeyP'], mouseYoke: ['KeyY'], parkBrake: ['KeyK'], zoomIn: ['KeyV'],
  });

  const S = {
    view: 'cockpit', look: { yaw: 0, pitch: -0.22 }, fov: 68, orbit: { yaw: 0.5, pitch: 0.22, dist: 14 }, head: new Vector3(),
    stick: { x: 0, y: 0 }, keys: { pitch: 0, roll: 0, yaw: 0 }, mouseYoke: false,
    hover: null, active: null, rmb: 0, tip: '', caption: '', captionT: 0, message: '', heard: null, atisLetter: 0,
  };
  const qi = new Quaternion(), qa = new Quaternion(), qb = new Quaternion(), v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3();
  const origin = new Vector3(), camWorld = new Vector3(), Y = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0);
  const tower = world.fromField(62, 205);

  function activeRunway() {                       // into the wind
    const head = weather.windSpeed * Math.cos((weather.windDir - 276) * DEG);
    return head >= -0.5 ? { name: '27', spawn: world.spawn.runway } : { name: '09', spawn: world.spawn.runway09 };
  }
  function reset(kind = start) {
    const at = kind === 'cold' || kind === 'ready' ? world.spawn.ramp : kind === 'runway' ? activeRunway().spawn : world.spawn[kind];
    ac.reset(kind, at);
    S.message = ''; S.stick.x = S.stick.y = 0; S.keys.pitch = S.keys.roll = S.keys.yaw = 0;
    S.kind = kind;
  }
  function setWeather(o) { Object.assign(weather, typeof o === 'string' ? WEATHER_PRESETS[o] : o); weather.step(0); }

  function atis() {
    const kt = Math.round(weather.windSpeed / KT), gust = Math.round((weather.windSpeed + weather.gust) / KT), dir = Math.round(wrap360(weather.windDir - FIELD.magVar) / 10) * 10;
    const cover = weather.cloudCover, base = Math.round(weather.cloudBase / FT / 100) * 100, hh = Math.floor(weather.hour), mm = Math.floor((weather.hour % 1) * 60);
    const letter = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel'.split(' ')[S.atisLetter % 8];
    return `${FIELD.name} information ${letter}. Time ${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}. `
      + `Wind ${kt < 2 ? 'calm' : `${String(dir || 360).padStart(3, '0')} degrees, ${kt} knots${gust - kt >= 5 ? `, gusting ${gust}` : ''}`}. `
      + `${weather.rain > 0.3 ? 'Visibility 6 kilometres in rain. ' : 'Visibility more than 10 kilometres. '}`
      + `${cover < 0.12 ? 'Sky clear' : `${cover < 0.3 ? 'Few' : cover < 0.55 ? 'Scattered' : cover < 0.9 ? 'Broken' : 'Overcast'} clouds at ${base} feet`}. `
      + `Temperature ${Math.round(weather.oat)}, dew point ${Math.round(weather.dewpoint)}. Q N H ${Math.round(weather.qnh / 100)}, altimeter ${(weather.qnh / 3386.389).toFixed(2)}. `
      + `Runway in use ${activeRunway().name}. Advise on first contact you have information ${letter}.`;
  }

  // ------------------------------------------------------------------------------------------------ the 60 Hz step
  function fixedUpdate(dt) {
    if (dt <= 0) return;
    const c = ac.ctl, k = S.keys;
    const ease = (cur, target) => cur + clamp(target - cur, -dt * (target === 0 ? 3.2 : 1.7), dt * (target === 0 ? 3.2 : 1.7));
    k.pitch = ease(k.pitch, input.axis('pitch')); k.roll = ease(k.roll, input.axis('roll')); k.yaw = ease(k.yaw, input.axis('yaw'));
    c.pitch = clamp(k.pitch + S.stick.y, -1, 1); c.roll = clamp(k.roll + S.stick.x, -1, 1); c.yaw = k.yaw;
    ac.eng.throttle = clamp(ac.eng.throttle + ((input.down('throttleUp') ? 1 : 0) - (input.down('throttleDown') ? 1 : 0)) * 0.45 * dt, 0, 1);
    c.trim = clamp(c.trim + ((input.down('trimUp') ? 1 : 0) - (input.down('trimDown') ? 1 : 0)) * 0.12 * dt, -1, 1);
    const both = input.down('brake') ? 1 : 0;
    c.brakeL = Math.max(both, input.down('brakeL') ? 1 : 0); c.brakeR = Math.max(both, input.down('brakeR') ? 1 : 0);
    if (input.pressed('flapsDown')) { c.flapLever = Math.min(3, c.flapLever + 1); sound.fx('click'); }
    if (input.pressed('flapsUp')) { c.flapLever = Math.max(0, c.flapLever - 1); sound.fx('click'); }
    if (input.pressed('parkBrake')) { c.parkBrake = !c.parkBrake; sound.fx('click'); }
    weather.step(dt);
    ac.step(dt);
    if (ac.crashed && !S.message) S.message = ac.crashed;
    const td = ac.gear.touchdown;
    if (td && td.t > 0.5 && td.sink < 0.3) ac.gear.touchdown = null;
    else if (td && td.t > 0.5 && !ac.crashed) { S.caption = `Touchdown at ${Math.round(td.sink / FT * 60)} ft/min`; S.captionT = 5; ac.gear.touchdown = null; }
  }

  // ------------------------------------------------------------------------------------------------ every frame
  function update(dt) {
    const frame = Math.min(engine.stats?.frameMs ? engine.stats.frameMs / 1000 : 1 / 60, 0.1), a = engine.alpha ?? 1;
    // where the aeroplane is drawn: between the last two physics steps
    const p0 = ac.posPrev, p1 = ac.pos, q0 = ac.qPrev, q1 = ac.q;
    const dotq = q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w, sg = dotq < 0 ? -1 : 1;
    qi.set(q0.x + (sg * q1.x - q0.x) * a, q0.y + (sg * q1.y - q0.y) * a, q0.z + (sg * q1.z - q0.z) * a, q0.w + (sg * q1.w - q0.w) * a).normalize();
    v1.set(ac.cg.x, ac.cg.y, ac.cg.z).applyQuaternion(qi);
    origin.set(p0.x + (p1.x - p0.x) * a - v1.x, p0.y + (p1.y - p0.y) * a - v1.y, p0.z + (p1.z - p0.z) * a - v1.z);
    model.root.quaternion.copy(qi);
    world.group.position.set(-origin.x, -origin.y, -origin.z);

    // keys that are not flying controls
    if (input.pressed('view1')) S.view = 'cockpit'; if (input.pressed('view2')) S.view = 'chase'; if (input.pressed('view3')) S.view = 'tower';
    if (input.pressed('viewReset')) { S.look.yaw = 0; S.look.pitch = -0.22; S.fov = 68; S.orbit.yaw = 0.5; S.orbit.pitch = 0.22; S.orbit.dist = 14; }
    if (input.pressed('pause')) engine.paused = !engine.paused;
    if (input.pressed('mouseYoke')) { S.mouseYoke = !S.mouseYoke; input.lockPointer(S.mouseYoke); if (!S.mouseYoke) S.stick.x = S.stick.y = 0; }
    if (S.mouseYoke && !input.pointerLocked && S._locked) { S.mouseYoke = false; S.stick.x = S.stick.y = 0; }
    S._locked = input.pointerLocked;

    // the camera
    const inside = S.view === 'cockpit';
    if (inside) {
      const g = ac.sf, bob = v2.set(-g.x * 0.0035, -(g.y - 9.81) * 0.0035, -g.z * 0.0035);
      const shake = ac.buffet * 0.006 + (ac.gear.onGround ? Math.min(0.004, ac.tas * 0.00008) : 0) + ac.eng.rough * 0.003;
      bob.x = clamp(bob.x, -0.04, 0.04) + (Math.random() - 0.5) * shake; bob.y = clamp(bob.y, -0.05, 0.04) + (Math.random() - 0.5) * shake; bob.z = clamp(bob.z, -0.05, 0.05);
      S.head.lerp(bob, Math.min(1, frame * 9));
      const eye = ac.cfg.eye;
      camera.position.set(eye.x + S.head.x, eye.y + S.head.y, eye.z + S.head.z).applyQuaternion(qi);
      camera.quaternion.copy(qi).multiply(qa.setFromAxisAngle(Y, S.look.yaw)).multiply(qb.setFromAxisAngle(X, S.look.pitch));
      camera.fov = S.fov;
    } else {
      const target = v2.set(0, 1.4, 1.4).applyQuaternion(qi);
      if (S.view === 'chase') {
        const h = ac.heading * DEG + S.orbit.yaw, cp = Math.cos(S.orbit.pitch), d = S.orbit.dist;
        camera.position.set(target.x - Math.sin(h) * cp * d, Math.max(target.y + Math.sin(S.orbit.pitch) * d, 0.3 - origin.y), target.z + Math.cos(h) * cp * d);
        camera.fov = 50;
      } else {
        camera.position.set(tower.x - origin.x, 13.5 - origin.y, tower.z - origin.z);
        camera.fov = clamp(2 * Math.atan(16 / camera.position.distanceTo(target)) / DEG, 2.5, 55);
      }
      camera.lookAt(target.x, target.y, target.z);
    }
    camera.updateProjectionMatrix();
    camWorld.copy(camera.position).add(origin);
    if (stage) stage.shadowFocus = { center: v3.set(0, 1.2, 1.5).applyQuaternion(qi), radius: inside ? 4 : 9 };

    // the mouse: operate the cockpit, look around, or fly with it
    const m = input.mouse, surf = stage?.surface, wheel = Math.sign(m.wheel || 0);
    S.tip = '';
    if (input.pointerLocked) {
      S.stick.x = clamp(S.stick.x + m.dx * 0.0022, -1, 1); S.stick.y = clamp(S.stick.y + m.dy * 0.0022, -1, 1);
      if (input.mousePressed(0) || input.mousePressed(2)) { S.stick.x = S.stick.y = 0; }
    } else if (surf) {
      const w = surf.cssWidth || surf.width, h = surf.cssHeight || surf.height;
      const dir = v1.set((m.x / w) * 2 - 1, -(m.y / h) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      qa.copy(qi).invert();
      const o = v2.copy(camera.position).applyQuaternion(qa), d = v3.copy(dir).applyQuaternion(qa);
      if (!S.active) S.hover = S.rmb > 4 ? null : cockpit.pick(o, d, !inside);
      const k = S.active ?? S.hover;
      if (k) S.tip = cockpit.tip(k);
      if (input.mousePressed(0) && S.hover) { S.active = S.hover; cockpit.press(S.active, 0); }
      if (S.active && input.mouseDown(0) && m.dy) cockpit.drag(S.active, m.dy);
      if (S.active && !input.mouseDown(0)) { cockpit.release(S.active); S.active = null; }
      if (input.mousePressed(2)) S.rmb = 0.001;
      if (input.mouseDown(2) && S.rmb > 0) {
        S.rmb += Math.abs(m.dx) + Math.abs(m.dy);
        if (S.rmb > 4) { if (inside) { S.look.yaw = clamp(S.look.yaw - m.dx * 0.004, -2.6, 2.6); S.look.pitch = clamp(S.look.pitch - m.dy * 0.004, -1.3, 1.3); } else { S.orbit.yaw -= m.dx * 0.006; S.orbit.pitch = clamp(S.orbit.pitch + m.dy * 0.005, -0.2, 1.4); } }
      } else if (S.rmb > 0) { if (S.rmb <= 4 && S.hover) { cockpit.press(S.hover, 2); cockpit.release(S.hover); } S.rmb = 0; }
      if (wheel) { if (S.hover) cockpit.wheel(S.hover, wheel); else if (inside) S.fov = clamp(S.fov - wheel * 4, 18, 95); else S.orbit.dist = clamp(S.orbit.dist * (1 - wheel * 0.12), 5, 400); }
    }
    if (inside && input.down('zoomIn')) camera.fov = 26, camera.updateProjectionMatrix();

    model.update(ac, frame);
    cockpit.update(frame);
    cockpit.group.visible = true;
    world.update(frame, camWorld, stage);
    sound.update(frame, ac, inside, engine.paused);

    // the radio
    const heard = ac.radios.heard;
    if (heard !== S.heard) {
      S.heard = heard; sound.hush();
      if (heard?.kind === 'atis') { const t = atis(); S.caption = `ATIS ${heard.freq.toFixed(3)}: ${t}`; S.captionT = 40; if (ac.radios.com.vol > 0.05) sound.say(t); }
      else if (heard?.kind === 'unicom') { S.caption = `${heard.id} ${heard.freq.toFixed(3)}: frequency quiet`; S.captionT = 4; }
      else if (S.captionT > 6) S.captionT = 0;
    }
    if (S.captionT > 0) { S.captionT -= frame; if (S.captionT <= 0) S.caption = ''; }
  }

  engine.add({ fixedUpdate, update });
  reset(start);

  return {
    ac, weather, world, sound, cockpit, state: S, reset, setWeather, atis, activeRunway,
    setView(v) { S.view = v; }, setTime(h) { weather.hour = h; },
    /** Everything the page shows as text. */
    info() {
      const i = ac.inst, t = ac.telemetry(), wk = Math.round(weather.windSpeed / KT);
      return {
        kias: i.kias, alt: i.altFt, vs: i.vsFpm, hdg: i.dg, rpm: ac.eng.rpm, throttle: ac.eng.throttle, mixture: ac.eng.mixture, flaps: ac.flapDeg, trim: ac.ctl.trim,
        fuelL: ac.fuel.gallons(0), fuelR: ac.fuel.gallons(1), agl: t.agl, g: ac.gLoad, parkBrake: ac.ctl.parkBrake, brake: Math.max(ac.ctl.brakeL, ac.ctl.brakeR),
        wind: `${String(Math.round(wrap360(weather.windDir - FIELD.magVar))).padStart(3, '0')}°/${wk} kt`, onGround: ac.gear.onGround, surface: ac.gear.onGround ? world.ground(ac.pos.x, ac.pos.z).kind : 'air',
        view: S.view, tip: S.tip, mouse: input.mouse, message: S.message, caption: S.caption, paused: engine.paused, mouseYoke: S.mouseYoke, stall: ac.horn > 0.3,
        weightLb: ac.mass / 0.45359237, cg: ac.cgPercentMac, oat: weather.oat, hour: weather.hour + ac.time / 3600,
      };
    },
  };
}
