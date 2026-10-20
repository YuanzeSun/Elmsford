// Ambient sound (技术设计 §5, M5), synthesized live with Web Audio — no audio files, nothing to
// download. Two buses: what's outside (muffled by walls when you're indoors, hushed by snow) and
// what's in the room with you. Under everything run beds of filtered noise — rain, wind, water,
// fire, voices — whose levels keep drifting on their own, so nothing is heard to loop. On top,
// sparse events are scheduled a little ahead with some randomness: drops, bubbles, crackles,
// birds, an owl, the mill wheel and its creak, and the parish bell when the village's bells ring.

import type { GameTime } from "@elmsford/core";

export interface SoundScene {
  rain: number;
  wind: number;
  water: number;
  hearth: number;
  /** The mill wheel turning. */
  mill: number;
  /** People talking in the room. */
  voices: number;
  birds: number;
  owl: number;
  /** 0 in the open … 1 behind thick walls. */
  walls: number;
  /** Snow on the ground: the world goes quiet. */
  hush: boolean;
  /** 0 at the church … 1 at the edge of the parish. */
  bellDistance: number;
}

const SILENT: SoundScene = { rain: 0, wind: 0, water: 0, hearth: 0, mill: 0, voices: 0, birds: 0, owl: 0, walls: 0, hush: false, bellDistance: 0.5 };

export type Volume = "low" | "mid" | "high";
export const VOLUMES: [Volume, string][] = [
  ["low", "轻"],
  ["mid", "中"],
  ["high", "响"],
];
const VOLUME_GAIN: Record<Volume, number> = { low: 0.2, mid: 0.38, high: 0.65 };
const VOLUME_KEY = "elmsford.volume";

export function savedVolume(): Volume {
  const v = localStorage.getItem(VOLUME_KEY);
  return v === "low" || v === "high" ? v : "mid";
}

/** Not a round number, so loops of different layers never line up. */
const LOOP_SECONDS = 11.3;
/** How far ahead events are scheduled, and how often the scheduler wakes. */
const HORIZON = 0.3;
const TICK_MS = 100;
/** Seconds for a level to move most of the way to a new scene. */
const SCENE_GLIDE = 2.5;

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * Noise that loops without a seam: the tail is crossfaded into the head (equal power). Each
 * channel is generated separately, so stereo beds are wide.
 */
function noiseBuffer(ctx: BaseAudioContext, color: "white" | "pink" | "brown", channels: 1 | 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * LOOP_SECONDS);
  const fade = Math.floor(ctx.sampleRate * 0.3);
  const buffer = ctx.createBuffer(channels, len, ctx.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "white") raw[i] = w;
      else if (color === "pink") {
        // Paul Kellet's economy filter.
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        raw[i] = b0 + b1 + b2 + w * 0.1848;
      } else {
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last;
      }
    }
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      raw[i] = raw[i]! * Math.sqrt(k) + raw[len + i]! * Math.sqrt(1 - k);
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(raw[i]!));
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (raw[i]! / peak) * 0.9;
  }
  return buffer;
}

/** A small stone room's tail, for the bell to ring in. */
function reverbImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buffer;
}

/** Something that happens now and then: schedules itself at `at`, returns seconds until next time. */
interface Recurring {
  next: number;
  run: (at: number) => number;
}

type Level = Exclude<keyof SoundScene, "hush" | "bellDistance">;

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private outside: GainNode | null = null;
  private walls: BiquadFilterNode | null = null;
  private inside: GainNode | null = null;
  private bellBus: BiquadFilterNode | null = null;
  private white: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private recurring: Recurring[] = [];
  private beds: Partial<Record<"rain" | "waterBed", GainNode>> = {};
  private volume: Volume = savedVolume();
  private scene: SoundScene = SILENT;
  /** Levels gliding toward the scene, so moving somewhere fades rather than cuts. */
  private level: Record<Level, number> = { rain: 0, wind: 0, water: 0, hearth: 0, mill: 0, voices: 0, birds: 0, owl: 0, walls: 0 };
  private lastTick = 0;

  get on() {
    return this.ctx !== null;
  }

  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    // Browsers keep audio off until the page is touched; a sound left on last time waits for it.
    if (ctx.state !== "running") {
      const resume = () => {
        void ctx.resume();
        document.removeEventListener("pointerdown", resume);
        document.removeEventListener("keydown", resume);
      };
      document.addEventListener("pointerdown", resume);
      document.addEventListener("keydown", resume);
    }

    // A gentle limiter at the end, so a storm and a bell together never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.3;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = VOLUME_GAIN[this.volume];
    this.master.connect(limiter);

    this.walls = ctx.createBiquadFilter();
    this.walls.type = "lowpass";
    this.walls.frequency.value = 16000;
    this.walls.Q.value = 0.5;
    this.walls.connect(this.master);
    this.outside = ctx.createGain();
    this.outside.connect(this.walls);
    this.inside = ctx.createGain();
    this.inside.connect(this.master);

    // The bell is outside, and further off it's duller; it always rings with a little room.
    const reverb = ctx.createConvolver();
    reverb.buffer = reverbImpulse(ctx, 3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    reverb.connect(wet).connect(this.outside);
    this.bellBus = ctx.createBiquadFilter();
    this.bellBus.type = "lowpass";
    this.bellBus.frequency.value = 5000;
    this.bellBus.connect(this.outside);
    this.bellBus.connect(reverb);

    this.white = noiseBuffer(ctx, "white", 1);
    const pink = noiseBuffer(ctx, "pink", 2);
    const brown = noiseBuffer(ctx, "brown", 2);

    this.buildRain(pink);
    this.buildWind(brown);
    this.buildWater(brown, pink);
    this.buildHearth(brown);
    this.buildMill();
    this.buildVoices(pink);
    this.buildBirds();
    this.buildOwl();

    this.lastTick = ctx.currentTime;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // Turned on where you already stand: the walls and the bell's distance apply at once.
    this.set(this.scene);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = this.outside = this.inside = null;
    this.walls = this.bellBus = null;
    this.recurring = [];
    this.beds = {};
    for (const k of Object.keys(this.level) as Level[]) this.level[k] = 0;
  }

  setVolume(v: Volume) {
    this.volume = v;
    localStorage.setItem(VOLUME_KEY, v);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(VOLUME_GAIN[v], this.ctx.currentTime, 0.3);
  }

  set(scene: SoundScene) {
    this.scene = scene;
    if (!this.ctx || !this.walls) return;
    // Walls take away the highs; snow takes away a little of everything.
    const cutoff = 16000 * Math.pow(650 / 16000, scene.walls);
    this.walls.frequency.setTargetAtTime(scene.hush ? Math.min(cutoff, 3500) : cutoff, this.ctx.currentTime, 1.2);
    this.bellBus?.frequency.setTargetAtTime(6000 * Math.pow(1500 / 6000, scene.bellDistance), this.ctx.currentTime, 1);
  }

  // ------------------------------------------------------------------ building blocks

  /** A looping bed through some filters, at level 0; returns its gain. */
  private bed(buffer: AudioBuffer, chain: AudioNode[], bus: AudioNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    // Different layers share buffers; starting each somewhere else keeps them unrelated.
    src.start(0, rand(0, buffer.duration));
    let node: AudioNode = src;
    for (const n of chain) node = node.connect(n);
    const g = ctx.createGain();
    g.gain.value = 0;
    node.connect(g).connect(bus);
    return g;
  }

  private filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  private every(run: (at: number) => number) {
    this.recurring.push({ next: this.ctx!.currentTime + rand(0, 0.5), run });
  }

  /** A short burst of noise: drops, crackles, splashes. */
  private burst(at: number, o: { length: number; type: BiquadFilterType; freq: number; q: number; peak: number; pan: number; bus: AudioNode }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white!;
    const f = this.filter(o.type, o.freq, o.q);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(o.peak, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.length);
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    src.connect(f).connect(g).connect(p).connect(o.bus);
    src.start(at, rand(0, this.white!.duration - 1), o.length + 0.05);
  }

  /** A sine (or other) tone with a pitch glide and a quick envelope: bubbles, bird notes, thuds. */
  private tone(at: number, o: { from: number; to: number; length: number; peak: number; pan: number; type?: OscillatorType; attack?: number }) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.from, at);
    osc.frequency.exponentialRampToValueAtTime(o.to, at + o.length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(o.peak, at + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.length);
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    osc.connect(g).connect(p).connect(this.outside!);
    osc.start(at);
    osc.stop(at + o.length + 0.05);
  }

  // ------------------------------------------------------------------ the layers

  /** Rain: a soft hiss of pink noise, and drops — sharp ones near, duller plops from the eaves. */
  private buildRain(pink: AudioBuffer) {
    this.beds.rain = this.bed(pink, [this.filter("highpass", 400), this.filter("lowpass", 6500)], this.outside!);
    this.every((at) => {
      const r = this.level.rain;
      if (r < 0.02) return 0.5;
      const plop = Math.random() < 0.12;
      this.burst(at, {
        length: plop ? rand(0.02, 0.04) : rand(0.003, 0.01),
        type: "bandpass",
        freq: plop ? rand(500, 1200) : rand(1800, 7000),
        q: plop ? 3 : rand(1.2, 3.5),
        peak: r * (plop ? rand(0.06, 0.14) : rand(0.015, 0.07)),
        pan: rand(-0.9, 0.9),
        bus: this.outside!,
      });
      return 1 / (r * 45) * rand(0.3, 1.7);
    });
  }

  /** Wind: low noise that gusts — louder and brighter in a gust — and a thin whistle in strong wind. */
  private buildWind(brown: AudioBuffer) {
    const body = this.filter("bandpass", 400, 0.6);
    const gain = this.bed(brown, [body], this.outside!);
    const pipe = this.filter("bandpass", 800, 14);
    const whistle = this.bed(this.white!, [pipe], this.outside!);
    let gust = 0.4;
    this.every((at) => {
      // A random walk, now and then a sudden gust.
      gust = Math.min(1, Math.max(0, gust + rand(-0.12, 0.12) + (Math.random() < 0.03 ? 0.4 : 0)));
      gust += (0.4 - gust) * 0.05;
      const w = this.level.wind;
      gain.gain.setTargetAtTime(w * 0.6 * (0.3 + 0.7 * gust), at, 0.7);
      body.frequency.setTargetAtTime(180 + gust * 650, at, 0.7);
      whistle.gain.setTargetAtTime(w > 0.4 ? w * 0.05 * Math.max(0, gust - 0.55) / 0.45 : 0, at, 0.5);
      pipe.frequency.setTargetAtTime(650 + gust * 500 + rand(-40, 40), at, 0.5);
      return 0.35;
    });
  }

  /** Running water: a low bed, three bands that babble at their own pace, and the odd bubble. */
  private buildWater(brown: AudioBuffer, pink: AudioBuffer) {
    this.beds.waterBed = this.bed(brown, [this.filter("lowpass", 500)], this.outside!);
    const bands: [number, number, number][] = [
      [320, 1.2, 0.16],
      [750, 2, 0.12],
      [1600, 2.5, 0.07],
    ];
    for (const [freq, q, share] of bands) {
      const g = this.bed(pink, [this.filter("bandpass", freq, q)], this.outside!);
      this.every((at) => {
        g.gain.setTargetAtTime(this.level.water * share * rand(0.25, 1), at, 0.06);
        return rand(0.12, 0.3);
      });
    }
    this.every((at) => {
      const w = this.level.water;
      if (w < 0.03) return 0.5;
      const f = rand(350, 1100);
      this.tone(at, { from: f, to: f * rand(1.6, 2.6), length: rand(0.02, 0.06), peak: 0.03 * w, pan: rand(-0.8, 0.8), attack: 0.003 });
      return (1 / (w * 4)) * rand(0.2, 1.8);
    });
  }

  /** The hearth: a low flickering roar, crackles, and now and then a pop. */
  private buildHearth(brown: AudioBuffer) {
    const roar = this.bed(brown, [this.filter("lowpass", 260)], this.inside!);
    this.every((at) => {
      roar.gain.setTargetAtTime(this.level.hearth * 0.25 * rand(0.55, 1), at, 0.1);
      return rand(0.15, 0.4);
    });
    this.every((at) => {
      const h = this.level.hearth;
      if (h < 0.02) return 0.5;
      const pop = Math.random() < 0.04;
      this.burst(at, {
        length: pop ? 0.03 : rand(0.002, 0.015),
        type: "bandpass",
        freq: pop ? 700 : rand(1500, 6000),
        q: pop ? 1 : 1.5,
        peak: h * (pop ? 0.45 : rand(0.04, 0.25)),
        pan: rand(-0.3, 0.3),
        bus: this.inside!,
      });
      // Crackles come in little runs.
      return Math.random() < 0.3 ? rand(0.02, 0.06) : rand(0.1, 0.5);
    });
  }

  /** The mill: the wheel's paddles slapping the water, a low thud, and the cracked axle creaking. */
  private buildMill() {
    this.every((at) => {
      const m = this.level.mill;
      if (m < 0.03) return 0.5;
      this.tone(at, { from: rand(58, 66), to: 45, length: 0.28, peak: 0.25 * m, pan: 0.2, attack: 0.01 });
      this.burst(at + 0.04, { length: 0.35, type: "bandpass", freq: 900, q: 0.8, peak: 0.07 * m, pan: rand(0, 0.5), bus: this.outside! });
      return rand(1.6, 1.85);
    });
    this.every((at) => {
      const m = this.level.mill;
      if (m < 0.03) return 1;
      const ctx = this.ctx!;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = rand(160, 260);
      const wobble = ctx.createOscillator();
      wobble.frequency.value = rand(7, 11);
      const depth = ctx.createGain();
      depth.gain.value = 14;
      wobble.connect(depth).connect(osc.frequency);
      const f = this.filter("bandpass", 1100, 3);
      const g = ctx.createGain();
      const length = rand(0.3, 0.6);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.02 * m, at + 0.08);
      g.gain.linearRampToValueAtTime(0, at + length);
      osc.connect(f).connect(g).connect(this.outside!);
      for (const o of [osc, wobble]) {
        o.start(at);
        o.stop(at + length + 0.05);
      }
      return rand(6, 15);
    });
  }

  /** Voices in a full room: a few murmurs at speaking pitch, each starting and stopping on its own. */
  private buildVoices(pink: AudioBuffer) {
    const room = this.filter("lowpass", 1800);
    room.connect(this.inside!);
    for (let i = 0; i < 5; i++) {
      const formant = this.filter("bandpass", rand(350, 900), 3);
      const pan = this.ctx!.createStereoPanner();
      pan.pan.value = rand(-0.7, 0.7);
      pan.connect(room);
      const g = this.bed(pink, [formant], pan);
      let talking = Math.random() < 0.5;
      this.every((at) => {
        if (Math.random() < 0.08) talking = !talking;
        // Syllables: the level jumps about while talking, and the voice wanders a little.
        g.gain.setTargetAtTime(talking ? this.level.voices * 0.08 * rand(0.3, 1) : 0, at, 0.04);
        formant.frequency.setTargetAtTime(rand(350, 900), at, 0.2);
        return rand(0.12, 0.3);
      });
    }
  }

  /** Birds: short phrases of rising and falling notes, here and there. A robin sings even in autumn. */
  private buildBirds() {
    this.every((at) => {
      const b = this.level.birds;
      if (b < 0.03) return 1;
      const pan = rand(-0.85, 0.85);
      let t = at;
      for (let n = Math.floor(rand(3, 9)); n > 0; n--) {
        const f = rand(2600, 5200);
        const length = rand(0.05, 0.16);
        this.tone(t, { from: f, to: f * rand(0.7, 1.35), length, peak: 0.035 * b, pan, attack: 0.01 });
        t += length + rand(0.03, 0.12);
      }
      return rand(4, 14) / Math.max(b, this.scene.birds);
    });
  }

  /** A tawny owl: a long hoot, a pause, then the quavering answer. */
  private buildOwl() {
    this.every((at) => {
      const o = this.level.owl;
      if (o < 0.03) return 2;
      const pan = rand(-0.9, 0.9);
      const peak = 0.05 * o;
      this.tone(at, { from: 430, to: 390, length: 0.55, peak, pan, attack: 0.06 });
      const second = at + rand(2.8, 4);
      this.tone(second, { from: 420, to: 410, length: 0.15, peak: peak * 0.7, pan, attack: 0.03 });
      for (let i = 0; i < 5; i++) this.tone(second + 0.5 + i * 0.13, { from: 425 - i * 4, to: 400 - i * 4, length: 0.16 + (i === 4 ? 0.3 : 0), peak: peak * (0.6 + i * 0.08), pan, attack: 0.02 });
      return rand(25, 90) / Math.max(o, this.scene.owl);
    });
  }

  // ------------------------------------------------------------------ running

  private tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const k = Math.min(1, dt / SCENE_GLIDE);
    for (const key of Object.keys(this.level) as Level[]) this.level[key] += (this.scene[key] - this.level[key]) * k;

    this.beds.rain?.gain.setTargetAtTime(this.level.rain * 0.22, now, 0.5);
    this.beds.waterBed?.gain.setTargetAtTime(this.level.water * 0.12, now, 0.5);

    // A tab in the background wakes rarely; skip what was missed rather than play it all at once.
    const horizon = now + HORIZON;
    for (const r of this.recurring) {
      if (r.next < now - 0.5) r.next = now + rand(0, 0.2);
      while (r.next < horizon) r.next += Math.max(0.01, r.run(Math.max(r.next, now)));
    }
  }

  /** The parish bell: strokes of a few inharmonic partials, each a pair slightly apart so it shimmers. */
  bell(strokes = 3) {
    const ctx = this.ctx;
    if (!ctx || !this.bellBus) return;
    const base = 196;
    const partials: [number, number, number][] = [
      // ratio, loudness, seconds to die away
      [0.5, 0.5, 9],
      [1, 0.6, 6],
      [1.2, 0.45, 4.5],
      [1.5, 0.3, 3.5],
      [2, 0.7, 3.2],
      [2.5, 0.25, 2.2],
      [2.67, 0.2, 2],
      [3, 0.2, 1.6],
      [4.1, 0.12, 1],
    ];
    const near = 1 - 0.55 * this.scene.bellDistance;
    for (let s = 0; s < strokes; s++) {
      const at = ctx.currentTime + 0.05 + s * 2.6;
      for (const [ratio, loud, decay] of partials) {
        for (const detune of [-0.6, 0.6]) {
          const osc = ctx.createOscillator();
          osc.frequency.value = base * ratio + detune * ratio;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(0.06 * loud * near, at + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
          osc.connect(g).connect(this.bellBus);
          osc.start(at);
          osc.stop(at + decay + 0.05);
        }
      }
      // The clapper striking: a short bright knock.
      this.burst(at, { length: 0.04, type: "bandpass", freq: 2800, q: 1.5, peak: 0.12 * near, pan: 0, bus: this.bellBus });
    }
  }
}

export const ambience = new Ambience();

/** How thick the walls are where you stand (0 = out in the open). */
const WALLS: Record<string, number> = { player_house: 0.85, alehouse: 0.8, priest_house: 0.85, green_house: 0.85, atwood_cottage: 0.75, church: 0.95 };
const WATER: Record<string, number> = { ford: 1, mill: 0.9, meadow: 0.55, alehouse: 0.35 };
const BIRDS_HERE: Record<string, number> = { north_wood: 1.6, common: 1.2, churchyard: 1.2, meadow: 1.1, east_field: 1, west_field: 1, south_field: 1, manor_road: 1 };
const BELL_DISTANCE: Record<string, number> = {
  church: 0,
  churchyard: 0.1,
  priest_house: 0.1,
  player_house: 0.15,
  green: 0.3,
  green_house: 0.35,
  lane: 0.35,
  alehouse: 0.45,
  atwood_cottage: 0.5,
  ford: 0.55,
  manor_road: 0.6,
  meadow: 0.6,
  common: 0.65,
  mill: 0.7,
  east_field: 0.8,
  west_field: 0.8,
  south_field: 0.8,
  manor: 0.9,
  north_wood: 1,
};
const BIRDS_BY_PERIOD: Record<string, number> = { dawn: 1.2, morning: 1, noon: 0.5, afternoon: 0.55, evening: 0.35 };
const WORKING = new Set(["morning", "noon", "afternoon"]);

function birdSeason(month: number): number {
  if (month >= 3 && month <= 6) return 1;
  if (month <= 8 && month >= 7) return 0.6;
  if (month >= 9 && month <= 11) return 0.4;
  return 0.25;
}

/** What you'd hear standing here, in this weather, at this time of day. */
export function sceneFor(weather: { sky: string; wind: string; tempC: number }, locationId: string, gt: Pick<GameTime, "light" | "period" | "month" | "liturgical">): SoundScene {
  const walls = WALLS[locationId] ?? 0;
  const indoors = walls > 0;
  const hush = weather.sky === "snow";
  const dark = gt.light !== "day";
  const night = gt.period === "night" || gt.period === "deep_night";
  const rain = { drizzle: 0.35, rain: 0.7, storm: 1 }[weather.sky] ?? 0;
  const wind = Math.max(weather.sky === "storm" ? 0.8 : 0, { calm: 0.04, breeze: 0.22, windy: 0.55, gale: 0.95 }[weather.wind] ?? 0.2) * (hush ? 0.5 : 1);
  const wet = { storm: 0, rain: 0.15, drizzle: 0.45, snow: 0.3, fog: 0.6 }[weather.sky] ?? 1;

  // A fire in every house after dark, and on cold days; the alehouse always has its brewing fire.
  const hearth = !indoors || locationId === "church" ? 0 : locationId === "alehouse" ? 0.7 : dark ? 0.8 : weather.tempC < 10 ? 0.45 : 0.15;
  const turning = !gt.liturgical.holyDay && WORKING.has(gt.period);
  const mill = turning ? ({ mill: 1, ford: 0.25, meadow: 0.2 }[locationId] ?? 0) : 0;
  const voices = locationId !== "alehouse" ? 0 : gt.period === "evening" || gt.period === "night" ? 0.8 : gt.period === "afternoon" ? 0.25 : gt.period === "deep_night" ? 0 : 0.1;
  const birds = night ? 0 : (BIRDS_BY_PERIOD[gt.period] ?? 0) * birdSeason(gt.month) * wet * (BIRDS_HERE[locationId] ?? 0.8);
  const owl = night || (gt.period === "evening" && dark) ? Math.min(1, wet * 1.5) * ({ north_wood: 1.5, churchyard: 1.3, common: 1.1 }[locationId] ?? 0.8) : 0;

  return {
    rain,
    wind,
    water: WATER[locationId] ?? 0,
    hearth,
    mill,
    voices,
    birds,
    owl,
    walls,
    hush,
    bellDistance: BELL_DISTANCE[locationId] ?? 0.6,
  };
}
