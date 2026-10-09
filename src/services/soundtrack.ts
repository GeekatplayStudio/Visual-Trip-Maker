/**
 * Offline soundtrack synthesis for the export: engine / wind bed per transport, swells at
 * transport changes and a soft chime at every stop. Pure function of the timeline, so the
 * audio lines up with the frames exactly.
 */
import type { RouteProject, TransportMode } from '../types';
import { interpolateRouteState, type RouteModel } from './geoUtils';

interface Voice {
  /** base pitch of the tonal part (Hz) */
  pitch: number;
  /** how much the tonal part contributes 0..1 */
  tone: number;
  /** noise colour: 0 = bright hiss, 1 = deep rumble */
  rumble: number;
  /** overall loudness 0..1 */
  gain: number;
  /** slow amplitude wobble (Hz), e.g. train clatter */
  wobble: number;
}

const VOICES: Record<TransportMode, Voice> = {
  airplane: { pitch: 110, tone: 0.25, rumble: 0.35, gain: 0.55, wobble: 0 },
  propeller: { pitch: 85, tone: 0.6, rumble: 0.3, gain: 0.5, wobble: 0 },
  helicopter: { pitch: 48, tone: 0.5, rumble: 0.5, gain: 0.55, wobble: 11 },
  balloon: { pitch: 0, tone: 0, rumble: 0.1, gain: 0.18, wobble: 0 },
  sports_car: { pitch: 95, tone: 0.5, rumble: 0.55, gain: 0.45, wobble: 0 },
  suv: { pitch: 70, tone: 0.45, rumble: 0.7, gain: 0.45, wobble: 0 },
  camper: { pitch: 60, tone: 0.45, rumble: 0.75, gain: 0.42, wobble: 0 },
  motorcycle: { pitch: 130, tone: 0.65, rumble: 0.4, gain: 0.45, wobble: 0 },
  bicycle: { pitch: 0, tone: 0, rumble: 0.2, gain: 0.12, wobble: 4 },
  hiker: { pitch: 0, tone: 0, rumble: 0.3, gain: 0.1, wobble: 2 },
  bullet_train: { pitch: 140, tone: 0.3, rumble: 0.45, gain: 0.45, wobble: 6 },
  steam_train: { pitch: 55, tone: 0.3, rumble: 0.7, gain: 0.5, wobble: 3 },
  yacht: { pitch: 65, tone: 0.3, rumble: 0.6, gain: 0.4, wobble: 0.6 },
  ferry: { pitch: 45, tone: 0.35, rumble: 0.8, gain: 0.45, wobble: 0.4 },
};

/** Render the whole soundtrack as interleaved stereo float samples. */
export function synthesizeSoundtrack(project: RouteProject, model: RouteModel, sampleRate = 48000, volume = 0.6): Float32Array {
  const total = model.totalSeconds;
  const n = Math.ceil(total * sampleRate);
  const out = new Float32Array(n * 2);
  if (n <= 0) return out;

  // control track sampled 50×/s, then interpolated per sample
  const ctrlRate = 50;
  const cn = Math.ceil(total * ctrlRate) + 1;
  const ctrlGain = new Float32Array(cn);
  const ctrlPitch = new Float32Array(cn);
  const ctrlTone = new Float32Array(cn);
  const ctrlRumble = new Float32Array(cn);
  const ctrlWobble = new Float32Array(cn);
  const chimes: number[] = [];
  const swells: number[] = [];
  let lastSeg = -1;
  let lastCard: string | null = null;
  for (let i = 0; i < cn; i++) {
    const t = i / ctrlRate;
    const tel = interpolateRouteState(project, model, t);
    const seg = project.segments[tel.currentSegmentIndex];
    const v = VOICES[seg?.transportMode || 'sports_car'];
    const moving = tel.phase === 'travel';
    const idle = tel.phase === 'dwell' ? 0.35 : tel.phase === 'intro' || tel.phase === 'outro' || tel.phase === 'done' ? 0.15 : 0;
    const speed = Math.min(1, (tel.speedKmh || 0) / 300);
    ctrlGain[i] = v.gain * (moving ? 0.75 + 0.25 * speed : idle);
    ctrlPitch[i] = v.pitch * (moving ? 1 + speed * 0.35 : 0.85);
    ctrlTone[i] = v.tone;
    ctrlRumble[i] = v.rumble;
    ctrlWobble[i] = v.wobble;
    if (lastSeg >= 0 && tel.currentSegmentIndex !== lastSeg && moving) swells.push(t);
    lastSeg = tel.currentSegmentIndex;
    const card = tel.activeWaypoint?.id || null;
    if (card && card !== lastCard && tel.activeWaypoint?.dwellTime) chimes.push(t);
    lastCard = card;
  }

  // noise generators
  let brown = 0;
  let lp1 = 0;
  let lp2 = 0;
  let phase = 0;
  let phase2 = 0;
  let gSm = 0;
  let pSm = ctrlPitch[0];
  const smooth = 1 - Math.exp(-1 / (sampleRate * 0.08));
  const chimeFreqs = [659.25, 830.61, 987.77, 1318.5];

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const ci = Math.min(cn - 1, Math.floor(t * ctrlRate));
    const target = ctrlGain[ci];
    gSm += (target - gSm) * smooth;
    pSm += (ctrlPitch[ci] - pSm) * smooth;
    const tone = ctrlTone[ci];
    const rumble = ctrlRumble[ci];
    const wob = ctrlWobble[ci];

    // noise: white → brown-ish via two one-pole filters mixed by `rumble`
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    lp1 += (white - lp1) * 0.08;
    lp2 += (lp1 - lp2) * 0.08;
    const hiss = lp1 * 0.6;
    const noise = brown * 9 * rumble + hiss * (1 - rumble);

    // tonal engine: fundamental + octave + fifth, slightly detuned
    let tonal = 0;
    if (pSm > 1 && tone > 0) {
      phase += (2 * Math.PI * pSm) / sampleRate;
      phase2 += (2 * Math.PI * pSm * 1.503) / sampleRate;
      tonal = Math.sin(phase) * 0.6 + Math.sin(phase * 2.01) * 0.25 + Math.sin(phase2) * 0.15;
      // mild saturation
      tonal = Math.tanh(tonal * 1.6) * 0.5;
    }
    let s = noise * 0.35 * (1 - tone * 0.5) + tonal * tone;
    if (wob > 0) s *= 0.78 + 0.22 * Math.sin(2 * Math.PI * wob * t);
    s *= gSm;

    // swell at transport changes (short whoosh)
    for (const st of swells) {
      const d = t - st;
      if (d >= -0.4 && d < 0.9) {
        const env = Math.exp(-Math.pow((d - 0.15) / 0.3, 2));
        s += hiss * 0.9 * env;
      }
    }
    // chimes
    let ch = 0;
    for (const ct of chimes) {
      const d = t - ct;
      if (d >= 0 && d < 1.8) {
        const env = Math.exp(-d * 2.4) * 0.22;
        for (let k = 0; k < chimeFreqs.length; k++) {
          const on = d - k * 0.07;
          if (on > 0) ch += Math.sin(2 * Math.PI * chimeFreqs[k] * on) * env * Math.exp(-on * 1.2);
        }
      }
    }
    s += ch;

    // fade in / out
    const fade = Math.min(1, t / 0.6, (total - t) / 0.8);
    const v = Math.max(-1, Math.min(1, s * volume * Math.max(0, fade)));
    out[i * 2] = v;
    out[i * 2 + 1] = v;
  }
  return out;
}

export const hasAudioEncoder = () => typeof window !== 'undefined' && 'AudioEncoder' in window && 'AudioData' in window;
