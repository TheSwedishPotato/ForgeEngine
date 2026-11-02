import { Vector3 } from 'three';

/**
 * Weather and time of night for a Med Engine 2 stage: rain (falling streaks, wet surfaces,
 * ripples, haze, the sound of it), wind, and lightning — a flash in the cloud deck that lights
 * the whole scene from the sky for a moment, then thunder after the distance's delay.
 *
 *   weather.set({ rain: 0.8, wind: 0.5, night: 1, overcast: 0.95, lightning: 0.3 })
 *   lightning: average strikes per ten seconds
 */
export class Weather {
  constructor(stage, audio = null) {
    this.stage = stage; this.audio = audio;
    this.state = { rain: 0, wind: 0.3, night: 1, overcast: 0.9, lightning: 0, wetness: null };
    this.target = { ...this.state };
    this.flash = 0;
    this.nextStrike = 4;
    this.baseSun = null;
    this.windDir = new Vector3(1, 0, 0.35).normalize();
    this.onStrike = null;
  }

  set(s, fade = 0) { Object.assign(this.target, s); if (!fade) Object.assign(this.state, this.target); this.fade = fade; }

  /** A strike now (scripted). distance 0 (overhead) .. 1 (far). */
  strike(distance = 0.4) {
    this.flash = 1.0 - distance * 0.5;
    this.flashT = 0;
    const r = this.stage.r;
    const a = Math.random() * Math.PI * 2;
    r.weather.lightningDir = [Math.cos(a), 0.5 + Math.random() * 0.3, Math.sin(a)];
    this.audio?.thunder(distance);
    this.onStrike?.(distance);
  }

  update(dt) {
    const S = this.state, T = this.target, r = this.stage.r;
    const k = this.fade ? Math.min(1, dt / this.fade) : 1;
    for (const key of ['rain', 'wind', 'night', 'overcast', 'lightning']) S[key] += (T[key] - S[key]) * k;
    if (T.wetness != null) S.wetness = T.wetness;
    // lightning
    if (S.lightning > 0) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) { this.strike(0.2 + Math.random() * 0.8); this.nextStrike = (6 + Math.random() * 10) / S.lightning; }
    }
    if (this.flash > 0) {
      this.flashT += dt;
      // a flash flickers: two or three pulses in a quarter second
      const f = this.flashT;
      const pulse = f < 0.06 ? 1 : f < 0.1 ? 0.25 : f < 0.16 ? 0.8 : f < 0.22 ? 0.2 : Math.max(0, 0.6 - (f - 0.22) * 2.5);
      r.weather.lightning = this.flash * pulse;
      if (f > 0.5) { this.flash = 0; r.weather.lightning = 0; }
    } else r.weather.lightning = 0;
    r.weather.night = S.night;
    r.weather.overcast = S.overcast;
    r.rain = S.rain;
    r.wetness = S.wetness ?? Math.min(1, S.rain * 1.4 + (S.rain > 0 ? 0.25 : 0));
    const rain = this.stage.rain;
    if (rain) { rain.intensity = S.rain; rain.wind = [this.windDir.x * S.wind * 3, this.windDir.z * S.wind * 3]; }
    // the flash lights the scene from the sky (the sun slot carries it at night)
    if (this.baseSun === null) this.baseSun = { i: r.sunIntensity, c: r.sunColor.clone() };
    const L = r.weather.lightning;
    r.sunIntensity = this.baseSun.i + L * 9;
    r.sunColor.copy(this.baseSun.c).lerp(new Vector3(0.75, 0.82, 1.0), Math.min(1, L * 2));
    if (L > 0.05) this.stage.r.invalidateEnvironment?.();
    if (this._lastL > 0.05 && L <= 0.05) this.stage.r.invalidateEnvironment?.();
    this._lastL = L;
    this.audio?.ambience?.({ ...(this.ambienceExtra ?? {}), rain: S.rain, wind: S.wind * 0.8 }, 1.5);
  }

  /** Remember the scene's own moon/sun after setting it (so flashes return to it). */
  rebase() { const r = this.stage.r; this.baseSun = { i: r.sunIntensity, c: r.sunColor.clone() }; }
}
