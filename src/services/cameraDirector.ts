import type { CameraShot, RouteProject, Steadiness, TransportMode } from '../types';
import { END_HOLD_SECONDS, distanceAtTime, sampleAtDistance, travelStartTime, travelToTimeline, zoomTierOffset, type RouteModel } from './geoUtils';

export interface CameraPose {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface Viewport {
  width: number;
  height: number;
}

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

export const STEADINESS_WINDOW: Record<Steadiness, number> = { tight: 0.45, smooth: 1.5, very_smooth: 3.0 };
export const LOOK_AHEAD_FRACTION = [0, 0.35, 0.7];

export const MOVEMENT_INFO = {
  follow: { label: 'Follow the line', desc: 'Stay with the symbol as it travels.' },
  start_to_end: { label: 'Start to end', desc: 'Glide from one saved view to another while the line draws.' },
  fixed: { label: 'Fixed view', desc: 'Films exactly what is in the frame.' },
} as const;

/** Zoom level that fits the bounds into the viewport (mercator, pitch 0). */
export function fitBoundsZoom(bounds: [number, number, number, number], vp: Viewport, paddingPx = 80): number {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const merc = (lat: number) => {
    const s = Math.sin((clamp(lat, -85, 85) * Math.PI) / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  };
  const dx = Math.max(1e-7, (maxLng - minLng) / 360);
  const dy = Math.max(1e-7, Math.abs(merc(minLat) - merc(maxLat)));
  const availW = Math.max(50, vp.width - paddingPx * 2);
  const availH = Math.max(50, vp.height - paddingPx * 2);
  const z = Math.log2(Math.min(availW / (dx * 512), availH / (dy * 512)));
  return clamp(z, 1.5, 17);
}

/** View that frames the whole route. */
export function overviewShot(model: RouteModel, vp: Viewport, pitch = 0, bearing = 0): CameraShot {
  const b = model.bounds;
  if (!b) return { center: [0, 20], zoom: 2, pitch: 0, bearing: 0 };
  const zoom = fitBoundsZoom(b, vp, Math.min(vp.width, vp.height) * 0.12) + (pitch > 0 ? 0.15 : 0);
  return { center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], zoom, pitch, bearing };
}

/** A close view on a point along the route. */
export function closeShot(model: RouteModel, km: number, zoom: number, pitch = 0, bearing = 0): CameraShot {
  const s = sampleAtDistance(model, km);
  return { center: [s.lng, s.lat], zoom, pitch, bearing };
}

/**
 * How much ground (km across the short side of the frame) each transport is naturally filmed with.
 * Walking is very close, road vehicles a little further out, trains and boats wider, flights wide.
 */
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

/** Seconds the symbol should take to cross the frame; sets the pace-based framing. */
const CROSS_SECONDS = 2.5;
/** Fastest acceptable crossing of the frame, so very long legs in short videos stay readable. */
const MIN_CROSS_SECONDS = 1.0;

/** Visible ground width (km) chosen for a leg from its transport, pace and length. */
export function legViewKm(project: RouteProject, model: RouteModel, segIdx: number): number {
  const seg = project.segments[segIdx];
  const sm = model.segments[segIdx];
  if (!seg || !sm) return 30;
  const [minKm, maxKm] = VIEW_RANGE_KM[seg.transportMode] ?? [2, 60];
  // pace: the frame should be crossed in about CROSS_SECONDS, within the transport's natural range
  const kmPerSec = sm.durationSec > 0 ? sm.lengthKm / sm.durationSec : 0;
  let km = clamp(kmPerSec * CROSS_SECONDS, minKm, maxKm);
  // readability floor: never cross the frame faster than MIN_CROSS_SECONDS, even if that means wider
  km = Math.max(km, kmPerSec * MIN_CROSS_SECONDS);
  // a short leg stays close enough that it does not shrink to a dot
  km = Math.min(km, Math.max(minKm, sm.lengthKm * 1.2));
  return km;
}

/** Zoom that shows `km` across the short side of the viewport at a latitude (512 px tiles). */
export function zoomForViewKm(km: number, lat: number, vp: Viewport): number {
  const px = Math.max(200, Math.min(vp.width, vp.height));
  const z = Math.log2((px * 78271.517 * Math.cos((clamp(lat, -85, 85) * Math.PI) / 180)) / Math.max(10, km * 1000));
  return clamp(z, 1.5, 18);
}

/** Automatic zoom for one leg. */
export function autoLegZoom(project: RouteProject, model: RouteModel, segIdx: number, lat: number, vp: Viewport): number {
  return zoomForViewKm(legViewKm(project, model, segIdx), lat, vp);
}

/** Representative follow zoom (first leg in auto mode), used for quick camera moves. */
export function followBaseZoom(project: RouteProject, model: RouteModel, vp: Viewport, segIdx = 0): number {
  const cam = project.camera;
  if (!cam.zoomAuto) return clamp(cam.zoom, 1.5, 18);
  const s = sampleAtDistance(model, model.segments[segIdx]?.startKm ?? 0);
  return autoLegZoom(project, model, segIdx, s.lat, vp);
}

/** 0..1 with zero velocity and acceleration at both ends. */
const smootherstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));

interface LegSwitch {
  /** timeline time at the middle of the change */
  at: number;
  /** half the duration of the glide */
  half: number;
  from: number;
  to: number;
}

interface FramingSchedule {
  first: number;
  switches: LegSwitch[];
  /** per leg: log2 of the visible ground (km) in auto mode */
  logViewKm: number[];
  /** per leg: zoom tier offset */
  tier: number[];
  /** per leg: log2 of the pace (km per second) */
  logPace: number[];
}

/**
 * Where and how fast the framing changes between legs. A change is centred on the pause at the
 * transport change (or on the leg boundary when there is none), so the camera glides in or out
 * while the line waits.
 */
function framingSchedule(project: RouteProject, model: RouteModel): FramingSchedule {
  const cam = project.camera;
  const legs = model.segments.filter((sm) => sm.durationSec > 0);
  const n = project.segments.length;
  const logViewKm = new Array<number>(n).fill(Math.log2(30));
  const tier = new Array<number>(n).fill(0);
  const logPace = new Array<number>(n).fill(0);
  for (const sm of legs) {
    const seg = project.segments[sm.index];
    logViewKm[sm.index] = Math.log2(legViewKm(project, model, sm.index));
    tier[sm.index] = seg ? zoomTierOffset(cam.zoomPerTransport[seg.transportMode]) : 0;
    logPace[sm.index] = Math.log2(Math.max(1e-4, sm.lengthKm / sm.durationSec));
  }
  const switches: LegSwitch[] = [];
  for (let j = 1; j < legs.length; j++) {
    const next = legs[j];
    const ev = model.dwellEvents.find((e) => e.nextSegmentIndex === next.index);
    if (ev) {
      const start = travelToTimeline(model, ev.travelTime);
      switches.push({ at: start + ev.dwell / 2, half: Math.max(0.45, ev.dwell / 2 + 0.25), from: legs[j - 1].index, to: next.index });
    } else {
      switches.push({ at: travelToTimeline(model, next.startTime), half: 0.6, from: legs[j - 1].index, to: next.index });
    }
  }
  // big changes of framing (car to walking, walking to plane) get a longer glide
  for (const sw of switches) {
    const levels = Math.abs((logViewKm[sw.to] + -tier[sw.to]) - (logViewKm[sw.from] + -tier[sw.from]));
    sw.half = Math.max(sw.half, 0.35 * levels);
  }
  // neighbouring glides must not overlap
  for (let i = 0; i < switches.length; i++) {
    const prevGap = i > 0 ? switches[i].at - switches[i - 1].at : Infinity;
    const nextGap = i < switches.length - 1 ? switches[i + 1].at - switches[i].at : Infinity;
    switches[i].half = Math.max(0.15, Math.min(switches[i].half, prevGap / 2, nextGap / 2));
  }
  return { first: legs[0]?.index ?? 0, switches, logViewKm, tier, logPace };
}

/** Per-leg value at a time, gliding smoothly across every leg change. */
function legValueAt(sched: FramingSchedule, values: number[], t: number): number {
  let v = values[sched.first] ?? 0;
  for (const sw of sched.switches) {
    const k = smootherstep((t - (sw.at - sw.half)) / (2 * sw.half));
    if (k > 0) v += ((values[sw.to] ?? 0) - (values[sw.from] ?? 0)) * k;
  }
  return v;
}

/** Follow-camera zoom at a time and latitude. */
function zoomAt(project: RouteProject, sched: FramingSchedule, t: number, lat: number, vp: Viewport): number {
  const cam = project.camera;
  const base = cam.zoomAuto ? zoomForViewKm(Math.pow(2, legValueAt(sched, sched.logViewKm, t)), lat, vp) : cam.zoom;
  return clamp(base + legValueAt(sched, sched.tier, t), 1.5, 18);
}

interface Sample {
  lng: number;
  lat: number;
  bearing: number;
}

function rawSample(model: RouteModel, t: number): Sample {
  const s = sampleAtDistance(model, distanceAtTime(model, clamp(t, 0, model.totalSeconds)));
  return { lng: s.lng, lat: s.lat, bearing: s.bearing };
}

/** Gaussian-weighted average of route positions around `t`. */
function smoothSample(model: RouteModel, t: number, windowSec: number): Sample {
  const N = 7;
  let wSum = 0;
  let lng = 0;
  let lat = 0;
  let sx = 0;
  let sy = 0;
  for (let k = -N; k <= N; k++) {
    const w = Math.exp(-(k * k) / (2 * (N / 2.2) * (N / 2.2)));
    const s = rawSample(model, t + (k / N) * windowSec);
    lng += s.lng * w;
    lat += s.lat * w;
    const r = (s.bearing * Math.PI) / 180;
    sx += Math.cos(r) * w;
    sy += Math.sin(r) * w;
    wSum += w;
  }
  return { lng: lng / wSum, lat: lat / wSum, bearing: (Math.atan2(sy, sx) * 180) / Math.PI };
}

/** Ground width (km) across the short side of the frame at a zoom. */
function viewKmAtZoom(zoom: number, lat: number, vp: Viewport): number {
  const px = Math.max(200, Math.min(vp.width, vp.height));
  return (px * 78271.517 * Math.cos((clamp(lat, -85, 85) * Math.PI) / 180)) / Math.pow(2, zoom) / 1000;
}

function followPose(project: RouteProject, model: RouteModel, t: number, vp: Viewport): CameraPose {
  const cam = project.camera;
  const window = STEADINESS_WINDOW[cam.steadiness] ?? 1.5;
  const sched = framingSchedule(project, model);

  const here = rawSample(model, t);
  const zoom = zoomAt(project, sched, t, here.lat, vp);

  // Position smoothing and look-ahead are limited to a share of the visible ground, so a fast leg
  // filmed close does not drag the camera away from the symbol on bends.
  const pace = Math.pow(2, legValueAt(sched, sched.logPace, t)); // km per second, glides between legs
  const viewKm = viewKmAtZoom(zoom, here.lat, vp);
  const posWindow = clamp(Math.min(window, (0.3 * viewKm) / pace), 0.12, window);
  const now = smoothSample(model, t, posWindow);

  let bearing = 0;
  if (cam.orientation === 'heading') {
    const turnWindow = clamp(Math.min(window, (1.2 * viewKm) / pace), 0.3, window);
    const back = smoothSample(model, t - turnWindow * 0.6, turnWindow);
    const fwd = smoothSample(model, t + turnWindow * 0.6, turnWindow);
    const dx = fwd.lng - back.lng;
    const dy = fwd.lat - back.lat;
    bearing = Math.abs(dx) + Math.abs(dy) > 1e-7 ? (Math.atan2(dx * Math.cos((now.lat * Math.PI) / 180), dy) * 180) / Math.PI : now.bearing;
  } else if (cam.orientation === 'fixed') {
    bearing = cam.bearing;
  }

  let center: [number, number] = [now.lng, now.lat];
  const la = LOOK_AHEAD_FRACTION[cam.lookAhead] ?? 0;
  if (la > 0) {
    const aheadSec = Math.min(Math.max(0.6, window * 0.5), (0.5 * viewKm) / pace);
    const ahead = smoothSample(model, t + aheadSec, posWindow);
    center = [now.lng + (ahead.lng - now.lng) * la, now.lat + (ahead.lat - now.lat) * la];
  }
  return { center, zoom, pitch: clamp(cam.tilt, 0, 70), bearing };
}

/**
 * Glide between two views. The centre moves in proportion to the change of scale, so the screen
 * pans at an even pace instead of whipping across while still zoomed in.
 */
function glide(a: CameraPose, b: CameraPose, k: number): CameraPose {
  const zoom = a.zoom + (b.zoom - a.zoom) * k;
  let u = k;
  if (Math.abs(b.zoom - a.zoom) > 0.05) {
    const sa = Math.pow(2, -a.zoom);
    const sb = Math.pow(2, -b.zoom);
    u = clamp((Math.pow(2, -zoom) - sa) / (sb - sa), 0, 1);
  }
  return {
    center: [a.center[0] + (b.center[0] - a.center[0]) * u, a.center[1] + (b.center[1] - a.center[1]) * u],
    zoom,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
    bearing: lerpAngle(a.bearing, b.bearing, k),
  };
}

/** Deterministic camera pose for a timeline time. */
export function computeCameraPose(project: RouteProject, model: RouteModel, time: number, vp: Viewport): CameraPose {
  const cam = project.camera;
  const t = clamp(time, 0, model.totalSeconds);
  const travelStart = travelStartTime(model);
  const travelEnd = model.totalSeconds - model.stillAtEnd - model.outroSeconds - END_HOLD_SECONDS;

  if (cam.movement === 'fixed') {
    return cam.fixedShot ?? overviewShot(model, vp, cam.tilt);
  }

  if (cam.movement === 'start_to_end') {
    const a = cam.startShot ?? overviewShot(model, vp, cam.tilt);
    const b = cam.endShot ?? overviewShot(model, vp, cam.tilt);
    const span = Math.max(0.1, travelEnd + END_HOLD_SECONDS * 0.5 - travelStart);
    let k = clamp((t - travelStart) / span, 0, 1);
    if (cam.easing === 'smooth') k = easeInOutCubic(k);
    return glide(a, b, k);
  }

  // follow
  const bearingForWhole = cam.orientation === 'fixed' ? cam.bearing : 0;
  if (model.introSeconds > 0 && t < travelStart) {
    const a = overviewShot(model, vp, cam.tilt, bearingForWhole);
    const b = followPose(project, model, travelStart, vp);
    const k = easeInOutSine(clamp((t - model.stillAtStart) / model.introSeconds, 0, 1));
    return glide(a, b, k);
  }
  if (model.outroSeconds > 0 && t > travelEnd + END_HOLD_SECONDS) {
    const a = followPose(project, model, travelEnd + END_HOLD_SECONDS, vp);
    const b = overviewShot(model, vp, cam.tilt, bearingForWhole);
    const k = easeInOutSine(clamp((t - travelEnd - END_HOLD_SECONDS) / model.outroSeconds, 0, 1));
    return glide(a, b, k);
  }
  return followPose(project, model, t, vp);
}
