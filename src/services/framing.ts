/**
 * How each transport is framed and paced on screen. Timing and camera both build on this, so a
 * car, a walk and a flight all move across the frame at the same comfortable pace.
 */
import type { RouteProject, TransportMode } from '../types';

/** Default travel speed per transport (km/h). The per-leg speed setting is compared with this. */
export const DEFAULT_SPEED_KMH: Record<TransportMode, number> = {
  sports_car: 90,
  suv: 70,
  camper: 75,
  bus: 60,
  motorcycle: 90,
  bicycle: 20,
  hiker: 4,
  bullet_train: 250,
  steam_train: 100,
  airplane: 800,
  propeller: 300,
  helicopter: 200,
  balloon: 25,
  yacht: 40,
  ferry: 35,
};

/** Preferred ground width (km across the short side of the frame) for each transport. */
export const VIEW_PREF_KM: Record<TransportMode, number> = {
  hiker: 1.2,
  bicycle: 4,
  motorcycle: 14,
  sports_car: 18,
  suv: 16,
  camper: 18,
  bus: 16,
  steam_train: 40,
  bullet_train: 70,
  yacht: 35,
  ferry: 45,
  helicopter: 20,
  balloon: 8,
  propeller: 250,
  airplane: 1200,
};

/** Closest and widest framing allowed per transport (km). */
export const VIEW_RANGE_KM: Record<TransportMode, [number, number]> = {
  hiker: [0.2, 3],
  bicycle: [0.6, 10],
  motorcycle: [1.5, 35],
  sports_car: [1.5, 40],
  suv: [1.5, 40],
  camper: [1.5, 40],
  bus: [1.5, 40],
  steam_train: [4, 90],
  bullet_train: [6, 160],
  yacht: [3, 120],
  ferry: [4, 140],
  helicopter: [2, 60],
  balloon: [1, 25],
  propeller: [30, 900],
  airplane: [200, 5000],
};

export type Pace = RouteProject['pace'];

/** Seconds the symbol takes to cross the short side of the frame, per pace. */
export const PACE_SECONDS_PER_SCREEN: Record<Pace, number> = { slow: 3.6, normal: 2.4, fast: 1.4 };

/** With a fixed video length, never let the symbol cross the frame faster than this. */
export const MIN_CROSS_SECONDS = 1.0;

/** A leg longer than this many screens is framed gradually wider so the video does not get endless. */
const WIDEN_AFTER_SCREENS = 10;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Framing for a leg from its transport and length (independent of time). */
export function naturalViewKm(mode: TransportMode, lengthKm: number): number {
  const [minKm, maxKm] = VIEW_RANGE_KM[mode] ?? [2, 60];
  let km = VIEW_PREF_KM[mode] ?? 20;
  const screens = lengthKm / km;
  if (screens > WIDEN_AFTER_SCREENS) km *= Math.sqrt(screens / WIDEN_AFTER_SCREENS);
  km = Math.min(km, maxKm);
  // a short leg stays close enough that it does not shrink to a dot
  km = Math.min(km, Math.max(minKm, lengthKm * 1.2));
  return clamp(km, minKm, maxKm);
}

/** How much faster than normal a leg is set to travel (1 = the transport's default speed). */
export function speedFactor(mode: TransportMode, speedKmh: number): number {
  return clamp(speedKmh / (DEFAULT_SPEED_KMH[mode] ?? 60), 0.2, 5);
}
