import type { CameraShot, RouteProject, Steadiness } from '../types';
import { END_HOLD_SECONDS, distanceAtTime, sampleAtDistance, timeToTravel, travelStartTime, zoomTierOffset, type RouteModel } from './geoUtils';

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

/** Sensible base zoom for following a route of this size. */
export function autoFollowZoom(model: RouteModel, vp: Viewport): number {
  const whole = overviewShot(model, vp).zoom;
  return clamp(whole + 2.2, 4, 15.5);
}

export function followBaseZoom(project: RouteProject, model: RouteModel, vp: Viewport): number {
  const cam = project.camera;
  return cam.zoomAuto ? autoFollowZoom(model, vp) : clamp(cam.zoom, 1.5, 18);
}

/** Leg used for zoom at a time; transition pauses switch half way so the glide is centred on the pause. */
function zoomSegmentIndex(model: RouteModel, t: number): number {
  const tt = timeToTravel(model, t);
  if (tt.phase === 'dwell' && tt.dwellEvent?.nextSegmentIndex !== undefined) {
    return tt.dwellProgress < 0.5 ? Math.max(0, tt.dwellEvent.nextSegmentIndex - 1) : tt.dwellEvent.nextSegmentIndex;
  }
  return sampleAtDistance(model, distanceAtTime(model, t)).segIdx;
}

interface Sample {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
}

function rawSample(project: RouteProject, model: RouteModel, t: number, baseZoom: number): Sample {
  const tc = clamp(t, 0, model.totalSeconds);
  const km = distanceAtTime(model, tc);
  const s = sampleAtDistance(model, km);
  const segIdx = zoomSegmentIndex(model, tc);
  const seg = project.segments[segIdx];
  const zoom = baseZoom + (seg ? zoomTierOffset(project.camera.zoomPerTransport[seg.transportMode]) : 0);
  return { lng: s.lng, lat: s.lat, zoom, bearing: s.bearing };
}

/** Gaussian-weighted average of route samples around `t`. */
function smoothSample(project: RouteProject, model: RouteModel, t: number, windowSec: number, baseZoom: number): Sample {
  const N = 7;
  let wSum = 0;
  let lng = 0;
  let lat = 0;
  let zoom = 0;
  let sx = 0;
  let sy = 0;
  for (let k = -N; k <= N; k++) {
    const dt = (k / N) * windowSec;
    const w = Math.exp(-(k * k) / (2 * (N / 2.2) * (N / 2.2)));
    const s = rawSample(project, model, t + dt, baseZoom);
    lng += s.lng * w;
    lat += s.lat * w;
    zoom += s.zoom * w;
    const r = (s.bearing * Math.PI) / 180;
    sx += Math.cos(r) * w;
    sy += Math.sin(r) * w;
    wSum += w;
  }
  return { lng: lng / wSum, lat: lat / wSum, zoom: zoom / wSum, bearing: (Math.atan2(sy, sx) * 180) / Math.PI };
}

function followPose(project: RouteProject, model: RouteModel, t: number, vp: Viewport): CameraPose {
  const cam = project.camera;
  const window = STEADINESS_WINDOW[cam.steadiness] ?? 1.5;
  const baseZoom = followBaseZoom(project, model, vp);
  const now = smoothSample(project, model, t, window, baseZoom);

  let bearing = 0;
  if (cam.orientation === 'heading') {
    const back = smoothSample(project, model, t - window * 0.6, window, baseZoom);
    const fwd = smoothSample(project, model, t + window * 0.6, window, baseZoom);
    const dx = fwd.lng - back.lng;
    const dy = fwd.lat - back.lat;
    bearing = Math.abs(dx) + Math.abs(dy) > 1e-7 ? (Math.atan2(dx * Math.cos((now.lat * Math.PI) / 180), dy) * 180) / Math.PI : now.bearing;
  } else if (cam.orientation === 'fixed') {
    bearing = cam.bearing;
  }

  let center: [number, number] = [now.lng, now.lat];
  const la = LOOK_AHEAD_FRACTION[cam.lookAhead] ?? 0;
  if (la > 0) {
    const ahead = smoothSample(project, model, t + Math.max(0.6, window * 0.5), window, baseZoom);
    center = [now.lng + (ahead.lng - now.lng) * la, now.lat + (ahead.lat - now.lat) * la];
  }
  return { center, zoom: clamp(now.zoom, 1.5, 18), pitch: clamp(cam.tilt, 0, 70), bearing };
}

function blend(a: CameraPose, b: CameraPose, k: number): CameraPose {
  return {
    center: [a.center[0] + (b.center[0] - a.center[0]) * k, a.center[1] + (b.center[1] - a.center[1]) * k],
    zoom: a.zoom + (b.zoom - a.zoom) * k,
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
    return blend(a, b, k);
  }

  // follow
  const bearingForWhole = cam.orientation === 'fixed' ? cam.bearing : 0;
  if (model.introSeconds > 0 && t < travelStart) {
    const a = overviewShot(model, vp, cam.tilt, bearingForWhole);
    const b = followPose(project, model, travelStart, vp);
    const k = easeInOutCubic(clamp((t - model.stillAtStart) / model.introSeconds, 0, 1));
    return blend(a, b, k);
  }
  if (model.outroSeconds > 0 && t > travelEnd + END_HOLD_SECONDS) {
    const a = followPose(project, model, travelEnd + END_HOLD_SECONDS, vp);
    const b = overviewShot(model, vp, cam.tilt, bearingForWhole);
    const k = easeInOutCubic(clamp((t - travelEnd - END_HOLD_SECONDS) / model.outroSeconds, 0, 1));
    return blend(a, b, k);
  }
  return followPose(project, model, t, vp);
}
