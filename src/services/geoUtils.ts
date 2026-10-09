import * as turf from '@turf/turf';
import type {
  RouteProject,
  RouteSegment,
  RoutingMode,
  TransportMode,
  VehicleTelemetry,
  Waypoint,
  WaypointAnchor,
} from '../types';

export const INTRO_SECONDS = 2.6;
export const OUTRO_SECONDS = 2.6;
export const END_HOLD_SECONDS = 0.8;

export const FLYING_MODES: TransportMode[] = ['airplane', 'propeller', 'helicopter', 'balloon'];
export const WATER_MODES: TransportMode[] = ['yacht', 'ferry'];
export const ROAD_MODES: TransportMode[] = ['sports_car', 'suv', 'camper', 'bus', 'motorcycle', 'bicycle', 'hiker'];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Bring `lng` onto the world copy closest to `ref`, so routes across the date line stay continuous. */
export function unwrapLng(ref: number, lng: number): number {
  let l = lng;
  while (l - ref > 180) l -= 360;
  while (l - ref < -180) l += 360;
  return l;
}

/** Normalise a sequence so consecutive longitudes never jump by more than 180°. */
export function unwrapCoordinates(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const c of coords) {
    const prev = out[out.length - 1];
    out.push(prev ? [unwrapLng(prev[0], c[0]), c[1]] : [c[0], c[1]]);
  }
  return out;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Shortest great-circle arc (spherical interpolation), longitudes unwrapped so it never splits at ±180°. */
export function generateGreatCircleArc(start: [number, number], end: [number, number], numPoints: number = 80): [number, number][] {
  const lng1 = start[0] * D2R;
  const lat1 = start[1] * D2R;
  const lng2 = end[0] * D2R;
  const lat2 = end[1] * D2R;
  const x1 = Math.cos(lat1) * Math.cos(lng1);
  const y1 = Math.cos(lat1) * Math.sin(lng1);
  const z1 = Math.sin(lat1);
  const x2 = Math.cos(lat2) * Math.cos(lng2);
  const y2 = Math.cos(lat2) * Math.sin(lng2);
  const z2 = Math.sin(lat2);
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [start, [start[0], start[1]]];
  const pts: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const a = Math.sin((1 - f) * omega) / Math.sin(omega);
    const b = Math.sin(f * omega) / Math.sin(omega);
    const x = a * x1 + b * x2;
    const y = a * y1 + b * y2;
    const z = a * z1 + b * z2;
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D;
    const lng = Math.atan2(y, x) * R2D;
    const prev = pts[pts.length - 1];
    pts.push([prev ? unwrapLng(prev[0], lng) : unwrapLng(start[0], lng), lat]);
  }
  pts[0] = [start[0], start[1]];
  pts[pts.length - 1] = [unwrapLng(start[0], end[0]), end[1]];
  return pts;
}

/** Catmull-Rom spline through the control points. */
export function smoothCoordinates(coords: [number, number][], subdivisions: number = 8): [number, number][] {
  if (coords.length < 3) return coords.slice();
  const result: [number, number][] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    for (let j = 0; j < subdivisions; j++) {
      const t = j / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      const lng =
        0.5 *
        (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const lat =
        0.5 *
        (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      result.push([lng, lat]);
    }
  }
  result.push(coords[coords.length - 1]);
  return result;
}

/** Remove consecutive duplicates / near-duplicates (within ~1 m). */
export function dedupeCoordinates(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - c[0]) > 1e-5 || Math.abs(last[1] - c[1]) > 1e-5) out.push([c[0], c[1]]);
  }
  return out;
}

/** Reduce very dense tracks (GPX) to keep per-frame work small. */
export function simplifyTrack(coords: [number, number][], toleranceDeg = 0.00005): [number, number][] {
  if (coords.length < 50) return coords;
  try {
    const simplified = turf.simplify(turf.lineString(coords), { tolerance: toleranceDeg, highQuality: false });
    return simplified.geometry.coordinates as [number, number][];
  } catch {
    return coords;
  }
}

export function calculatePathLengthKm(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += turf.distance(coords[i - 1], coords[i], { units: 'kilometers' });
  }
  return km;
}

/** Build the drawn geometry of a leg from its control points (synchronous modes only). */
export function buildSegmentGeometry(points: [number, number][], routing: RoutingMode): [number, number][] {
  const pts = unwrapCoordinates(dedupeCoordinates(points));
  if (pts.length < 2) return pts;
  switch (routing) {
    case 'curved':
      return smoothCoordinates(pts, 10);
    case 'arc': {
      const out: [number, number][] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const arc = generateGreatCircleArc(pts[i], pts[i + 1], 64);
        out.push(...(i === 0 ? arc : arc.slice(1)));
      }
      return out;
    }
    case 'road':
    case 'straight':
    default:
      return pts;
  }
}

/** Return a copy of the segment with coordinates & length rebuilt from its points. */
export function rebuildSegment(seg: RouteSegment, overrideCoords?: [number, number][]): RouteSegment {
  const coordinates = overrideCoords ? dedupeCoordinates(overrideCoords) : buildSegmentGeometry(seg.points, seg.routing);
  return { ...seg, coordinates, lengthKm: calculatePathLengthKm(coordinates) };
}

export function defaultRoutingFor(mode: TransportMode): RoutingMode {
  if (FLYING_MODES.includes(mode) && mode !== 'helicopter' && mode !== 'balloon') return 'arc';
  if (ROAD_MODES.includes(mode) && mode !== 'hiker') return 'road';
  return 'curved';
}

export function osrmProfileFor(mode: TransportMode): 'driving' | 'walking' | 'cycling' {
  if (mode === 'hiker') return 'walking';
  if (mode === 'bicycle') return 'cycling';
  return 'driving';
}

/** Fetch a road-following route from the public OSRM demo server. Falls back to a curve. */
export async function fetchOSRMRoute(
  points: [number, number][],
  profile: 'driving' | 'walking' | 'cycling' = 'driving',
): Promise<{ coordinates: [number, number][]; snapped: boolean }> {
  const pts = dedupeCoordinates(points);
  if (pts.length < 2) return { coordinates: pts, snapped: false };
  try {
    // OSRM demo rejects very long coordinate lists; thin control points if needed.
    const limited = pts.length > 90 ? pts.filter((_, i) => i % Math.ceil(pts.length / 90) === 0 || i === pts.length - 1) : pts;
    const norm = (l: number) => ((((l + 180) % 360) + 360) % 360) - 180;
    const coordString = limited.map((c) => `${norm(c[0]).toFixed(6)},${c[1].toFixed(6)}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coordString}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined;
    if (coords && coords.length >= 2) {
      // OSRM returns every road vertex; thin it relative to the leg length (≈ 20 m per 100 km, min 5 m)
      const km = calculatePathLengthKm(coords);
      const tol = Math.max(0.00004, Math.min(0.0006, km * 0.0000018));
      const shift = Math.round((pts[0][0] - coords[0][0]) / 360) * 360;
      const shifted = shift ? coords.map((c) => [c[0] + shift, c[1]] as [number, number]) : coords;
      return { coordinates: simplifyTrack(unwrapCoordinates(shifted), tol), snapped: true };
    }
  } catch (err) {
    console.warn('Road routing failed, using a smooth curve instead.', err);
  }
  return { coordinates: smoothCoordinates(pts, 10), snapped: false };
}

// ---------------------------------------------------------------------------
// Route model: cumulative distances, anchors, timeline
// ---------------------------------------------------------------------------

interface SegmentModel {
  index: number;
  coords: [number, number][];
  /** cumulative km at each vertex, cum[0] = 0 */
  cum: number[];
  lengthKm: number;
  startKm: number;
  /** travel time (seconds, excluding pauses) at which this leg starts */
  startTime: number;
  durationSec: number;
}

export interface DwellEvent {
  kind: 'marker' | 'transition';
  waypoint: Waypoint | null;
  /** set when the pause sits where a new leg starts: the zoom glides and the symbol swaps half way through it */
  nextSegmentIndex?: number;
  distanceKm: number;
  /** travel-time (without pauses) at which the head reaches this point */
  travelTime: number;
  dwell: number;
}

export interface RouteModel {
  segments: SegmentModel[];
  totalKm: number;
  anchors: WaypointAnchor[];
  /** all pauses in route order */
  dwellEvents: DwellEvent[];
  travelSeconds: number;
  totalDwellSeconds: number;
  stillAtStart: number;
  introSeconds: number;
  outroSeconds: number;
  stillAtEnd: number;
  /** full length of the animation in seconds */
  totalSeconds: number;
  bounds: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
}

const ZOOM_TIER_OFFSET: Record<string, number> = { closer: 1, same: 0, wider: -1.5, widest: -3 };
export const zoomTierOffset = (tier?: string) => ZOOM_TIER_OFFSET[tier || 'same'] ?? 0;

export function buildRouteModel(project: RouteProject): RouteModel {
  const segments: SegmentModel[] = [];
  let startKm = 0;
  for (let i = 0; i < project.segments.length; i++) {
    const seg = project.segments[i];
    const coords = seg.coordinates.length >= 2 ? seg.coordinates : seg.coordinates.length === 1 ? [seg.coordinates[0], seg.coordinates[0]] : [];
    const cum: number[] = [0];
    for (let j = 1; j < coords.length; j++) {
      cum.push(cum[j - 1] + turf.distance(coords[j - 1], coords[j], { units: 'kilometers' }));
    }
    const lengthKm = cum[cum.length - 1] || 0;
    segments.push({ index: i, coords, cum, lengthKm, startKm, startTime: 0, durationSec: 0 });
    startKm += lengthKm;
  }
  const totalKm = startKm;

  // Speed-weighted time allocation: time share ∝ length / speed
  const travelSeconds = Math.max(1, project.durationSeconds);
  const weights = segments.map((s) => (s.lengthKm > 0 ? s.lengthKm / Math.max(1, project.segments[s.index].speedKmh) : 0));
  const wSum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  segments.forEach((s, i) => {
    const share = wSum > 0 ? weights[i] / wSum : s.lengthKm > 0 ? 1 / segments.length : 0;
    s.startTime = t;
    s.durationSec = share * travelSeconds;
    t += s.durationSec;
  });

  // Waypoint anchors: project each marker onto the route
  const anchors: WaypointAnchor[] = [];
  if (totalKm > 0) {
    for (const wp of project.waypoints) {
      let best: { km: number; lng: number; lat: number; d: number } | null = null;
      for (const s of segments) {
        if (s.coords.length < 2) continue;
        try {
          const snapped = turf.nearestPointOnLine(turf.lineString(s.coords), [wp.lng, wp.lat], { units: 'kilometers' });
          const d = snapped.properties.dist ?? Infinity;
          if (!best || d < best.d) {
            best = {
              km: s.startKm + Math.min(s.lengthKm, snapped.properties.location ?? 0),
              lng: snapped.geometry.coordinates[0],
              lat: snapped.geometry.coordinates[1],
              d,
            };
          }
        } catch {
          /* ignore */
        }
      }
      if (best) anchors.push({ waypointId: wp.id, distanceKm: best.km, lng: best.lng, lat: best.lat });
    }
  }
  anchors.sort((a, b) => a.distanceKm - b.distanceKm);

  const wpById = new Map(project.waypoints.map((w) => [w.id, w]));
  const boundaryEps = Math.max(0.3, totalKm * 0.004);
  const boundaryAfter = (km: number): number | undefined => {
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].lengthKm > 0 && segments[i - 1].lengthKm > 0 && Math.abs(segments[i].startKm - km) < boundaryEps) return i;
    }
    return undefined;
  };
  const dwellEvents: DwellEvent[] = anchors
    .filter((a) => (wpById.get(a.waypointId)?.dwellTime || 0) > 0)
    .map((a) => ({
      kind: 'marker' as const,
      waypoint: wpById.get(a.waypointId)!,
      nextSegmentIndex: boundaryAfter(a.distanceKm),
      distanceKm: a.distanceKm,
      travelTime: distanceToTravelTime(segments, a.distanceKm),
      dwell: Math.max(0, wpById.get(a.waypointId)!.dwellTime || 0),
    }));

  // Transport-change transitions: the line pauses while the camera glides to the next leg's framing
  const cam = project.camera;
  const transition = cam.movement === 'follow' ? Math.max(0, cam.transitionSeconds || 0) : 0;
  if (transition > 0) {
    for (let i = 1; i < segments.length; i++) {
      const prev = project.segments[i - 1];
      const next = project.segments[i];
      if (segments[i].lengthKm <= 0 || segments[i - 1].lengthKm <= 0) continue;
      const changes =
        prev.transportMode !== next.transportMode ||
        zoomTierOffset(cam.zoomPerTransport[prev.transportMode]) !== zoomTierOffset(cam.zoomPerTransport[next.transportMode]);
      if (!changes) continue;
      const km = segments[i].startKm;
      // a marker pause at the same spot already gives the camera time
      const covered = dwellEvents.some((e) => e.kind === 'marker' && e.nextSegmentIndex === i && e.dwell >= transition * 0.8);
      if (covered) continue;
      dwellEvents.push({ kind: 'transition', waypoint: null, nextSegmentIndex: i, distanceKm: km, travelTime: distanceToTravelTime(segments, km), dwell: transition });
    }
  }
  dwellEvents.sort((a, b) => a.travelTime - b.travelTime || (a.kind === 'marker' ? -1 : 1));
  const totalDwellSeconds = dwellEvents.reduce((a, e) => a + e.dwell, 0);

  const stillAtStart = Math.max(0, project.stillAtStart || 0);
  const stillAtEnd = Math.max(0, project.stillAtEnd || 0);
  const introSeconds = cam.movement === 'follow' && cam.startWhole ? INTRO_SECONDS : 0;
  const outroSeconds = cam.movement === 'follow' && cam.endWhole ? OUTRO_SECONDS : 0;
  const totalSeconds = stillAtStart + introSeconds + travelSeconds + totalDwellSeconds + END_HOLD_SECONDS + outroSeconds + stillAtEnd;

  let bounds: RouteModel['bounds'] = null;
  const all = segments.flatMap((s) => s.coords);
  for (const w of project.waypoints) all.push([w.lng, w.lat]);
  if (all.length) {
    bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of all) {
      bounds[0] = Math.min(bounds[0], c[0]);
      bounds[1] = Math.min(bounds[1], c[1]);
      bounds[2] = Math.max(bounds[2], c[0]);
      bounds[3] = Math.max(bounds[3], c[1]);
    }
  }

  return { segments, totalKm, anchors, dwellEvents, travelSeconds, totalDwellSeconds, stillAtStart, introSeconds, outroSeconds, stillAtEnd, totalSeconds, bounds };
}

function distanceToTravelTime(segments: SegmentModel[], km: number): number {
  for (const s of segments) {
    if (s.lengthKm <= 0) continue;
    if (km <= s.startKm + s.lengthKm || s === segments[segments.length - 1]) {
      const f = Math.min(1, Math.max(0, (km - s.startKm) / s.lengthKm));
      return s.startTime + f * s.durationSec;
    }
  }
  return 0;
}

function travelTimeToDistance(segments: SegmentModel[], tt: number): { km: number; segIdx: number } {
  let last: SegmentModel | null = null;
  for (const s of segments) {
    if (s.durationSec <= 0) continue;
    last = s;
    if (tt <= s.startTime + s.durationSec) {
      const f = Math.min(1, Math.max(0, (tt - s.startTime) / s.durationSec));
      return { km: s.startKm + f * s.lengthKm, segIdx: s.index };
    }
  }
  if (last) return { km: last.startKm + last.lengthKm, segIdx: last.index };
  return { km: 0, segIdx: 0 };
}

/** Start of the travel part on the timeline (after the start hold and the intro). */
export const travelStartTime = (model: RouteModel) => model.stillAtStart + model.introSeconds;

/** Timeline time at which the head arrives at a travel-time (pauses before it included). */
export function travelToTimeline(model: RouteModel, travelTime: number): number {
  let consumed = 0;
  for (const e of model.dwellEvents) if (e.travelTime < travelTime - 1e-6) consumed += e.dwell;
  return travelStartTime(model) + travelTime + consumed;
}

/** Timeline-time → travel-time, taking pauses into account. */
export function timeToTravel(model: RouteModel, time: number): {
  travelTime: number;
  phase: VehicleTelemetry['phase'];
  dwellEvent: DwellEvent | null;
  dwellProgress: number;
  phaseProgress: number; // progress inside intro/outro
} {
  const { introSeconds, travelSeconds, dwellEvents, outroSeconds, stillAtStart } = model;
  if (time < stillAtStart + introSeconds) {
    const p = introSeconds > 0 ? Math.max(0, time - stillAtStart) / introSeconds : 1;
    return { travelTime: 0, phase: 'intro', dwellEvent: null, dwellProgress: 0, phaseProgress: p };
  }
  const t = time - stillAtStart - introSeconds;
  let consumed = 0;
  for (const ev of dwellEvents) {
    const arrival = ev.travelTime + consumed;
    if (t < arrival) break;
    if (t < arrival + ev.dwell) {
      return { travelTime: ev.travelTime, phase: 'dwell', dwellEvent: ev, dwellProgress: (t - arrival) / ev.dwell, phaseProgress: 0 };
    }
    consumed += ev.dwell;
  }
  const travel = t - consumed;
  if (travel <= travelSeconds) return { travelTime: travel, phase: 'travel', dwellEvent: null, dwellProgress: 0, phaseProgress: 0 };
  const after = travel - travelSeconds;
  if (after <= END_HOLD_SECONDS) return { travelTime: travelSeconds, phase: 'done', dwellEvent: null, dwellProgress: 0, phaseProgress: 0 };
  const outroT = after - END_HOLD_SECONDS;
  if (outroSeconds > 0 && outroT < outroSeconds) return { travelTime: travelSeconds, phase: 'outro', dwellEvent: null, dwellProgress: 0, phaseProgress: outroT / outroSeconds };
  return { travelTime: travelSeconds, phase: 'done', dwellEvent: null, dwellProgress: 0, phaseProgress: 1 };
}

/** Position / bearing at a distance along the whole route (binary search). */
export function sampleAtDistance(model: RouteModel, km: number): { lng: number; lat: number; bearing: number; segIdx: number; segFraction: number } {
  const segs = model.segments.filter((s) => s.coords.length >= 2);
  if (segs.length === 0) return { lng: 0, lat: 0, bearing: 0, segIdx: 0, segFraction: 0 };
  const clampKm = Math.max(0, Math.min(model.totalKm, km));
  let seg = segs[segs.length - 1];
  for (const s of segs) {
    if (clampKm <= s.startKm + s.lengthKm) {
      seg = s;
      break;
    }
  }
  const local = Math.max(0, Math.min(seg.lengthKm, clampKm - seg.startKm));
  const { cum, coords } = seg;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= local) lo = mid;
    else hi = mid;
  }
  const a = coords[lo];
  const b = coords[Math.min(coords.length - 1, lo + 1)];
  const span = cum[hi] - cum[lo];
  const f = span > 0 ? (local - cum[lo]) / span : 0;
  const lng = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  let bearing = span > 0 ? turf.bearing(a, b) : 0;
  if (!Number.isFinite(bearing)) bearing = 0;
  return { lng, lat, bearing, segIdx: seg.index, segFraction: seg.lengthKm > 0 ? local / seg.lengthKm : 0 };
}

/** Index of the leg the head is on for a timeline time; during a transition pause, the leg about to start. */
export function segmentIndexAtTime(model: RouteModel, time: number): number {
  const tt = timeToTravel(model, time);
  if (tt.phase === 'dwell' && tt.dwellEvent?.nextSegmentIndex !== undefined) return tt.dwellEvent.nextSegmentIndex;
  return travelTimeToDistance(model.segments, tt.travelTime).segIdx;
}

export function flightAltitude(segFraction: number, maxAltitude: number): number {
  return Math.max(0, Math.sin(segFraction * Math.PI) * maxAltitude);
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Full vehicle / playback state at a timeline time. */
export function interpolateRouteState(project: RouteProject, model: RouteModel, time: number): VehicleTelemetry {
  const empty: VehicleTelemetry = {
    time,
    totalTime: model.totalSeconds,
    phase: 'done',
    lng: 0,
    lat: 0,
    altitudeMeters: 0,
    bearing: 0,
    pitch: 0,
    roll: 0,
    speedKmh: 0,
    progress01: 0,
    distanceCoveredKm: 0,
    totalDistanceKm: 0,
    currentSegmentIndex: 0,
    activeWaypoint: null,
    inTransition: false,
    dwellProgress: 0,
    reachedWaypointIds: [],
    reachedAges: {},
  };
  if (model.totalKm <= 0) {
    const firstCoord = project.segments[0]?.coordinates[0];
    const firstWp = project.waypoints[0];
    if (firstCoord) {
      empty.lng = firstCoord[0];
      empty.lat = firstCoord[1];
    } else if (firstWp) {
      empty.lng = firstWp.lng;
      empty.lat = firstWp.lat;
    }
    return empty;
  }

  const tt = timeToTravel(model, time);
  const { km } = travelTimeToDistance(model.segments, tt.travelTime);
  const here = sampleAtDistance(model, km);
  const inTransition = tt.phase === 'dwell' && tt.dwellEvent?.kind === 'transition';
  // at a stop where a new leg starts, the symbol switches to the next transport half way through the pause
  const currentSegmentIndex =
    tt.phase === 'dwell' && tt.dwellEvent?.nextSegmentIndex !== undefined && tt.dwellProgress > 0.5 ? tt.dwellEvent.nextSegmentIndex : here.segIdx;

  // Smooth bearing by looking slightly ahead & behind
  const look = Math.max(0.02, model.totalKm * 0.004);
  const ahead = sampleAtDistance(model, Math.min(model.totalKm, km + look));
  const behind = sampleAtDistance(model, Math.max(0, km - look));
  let bearing = turf.bearing([behind.lng, behind.lat], [ahead.lng, ahead.lat]);
  if (!Number.isFinite(bearing) || (behind.lng === ahead.lng && behind.lat === ahead.lat)) bearing = here.bearing;

  const seg = project.segments[currentSegmentIndex] || project.segments[here.segIdx];
  const mode = seg?.transportMode || 'sports_car';

  let altitude = 0;
  let pitch = 0;
  let roll = 0;
  const frac = currentSegmentIndex !== here.segIdx ? 0 : here.segFraction;
  if (mode === 'airplane' || mode === 'propeller') {
    altitude = flightAltitude(frac, seg.altitudeMeters || 9000);
    pitch = Math.cos(frac * Math.PI) * 10;
  } else if (mode === 'helicopter') {
    altitude = 300 + Math.sin(frac * Math.PI) * 300;
    pitch = 6;
  } else if (mode === 'balloon') {
    altitude = 500 + Math.sin(frac * Math.PI) * 300;
  }

  const far = sampleAtDistance(model, Math.min(model.totalKm, km + look * 4));
  const turn = angleDiff(bearing, turf.bearing([here.lng, here.lat], [far.lng, far.lat]));
  if (mode === 'airplane' || mode === 'propeller') roll = Math.max(-30, Math.min(30, turn * 1.2));
  else if (mode === 'motorcycle' || mode === 'bicycle') roll = Math.max(-22, Math.min(22, turn * 1.0));
  else if (mode === 'sports_car') roll = Math.max(-5, Math.min(5, turn * 0.3));

  const reachedWaypointIds: string[] = [];
  const reachedAges: Record<string, number> = {};
  let activeWaypoint: Waypoint | null = null;
  let dwellProgress = 0;
  const wpById = new Map(project.waypoints.map((w) => [w.id, w]));

  for (const a of model.anchors) {
    const wp = wpById.get(a.waypointId);
    if (!wp) continue;
    const arrivalTime = travelToTimeline(model, distanceToTravelTime(model.segments, a.distanceKm));
    const reached = wp.revealMode === 'always' ? true : time >= arrivalTime - 0.01 || a.distanceKm <= 0.0001;
    if (reached) {
      reachedWaypointIds.push(wp.id);
      reachedAges[wp.id] = wp.revealMode === 'always' ? 99 : Math.max(0, time - arrivalTime);
    }
  }
  if (tt.phase === 'dwell' && tt.dwellEvent?.kind === 'marker' && tt.dwellEvent.waypoint) {
    activeWaypoint = tt.dwellEvent.waypoint;
    dwellProgress = tt.dwellProgress;
  } else if (tt.phase === 'travel') {
    // While travelling, show the card of a marker we are within a short time window of passing
    for (const a of model.anchors) {
      const wp = wpById.get(a.waypointId);
      if (!wp || wp.dwellTime > 0) continue;
      const at = distanceToTravelTime(model.segments, a.distanceKm);
      const win = 0.9;
      if (tt.travelTime >= at && tt.travelTime <= at + win) {
        activeWaypoint = wp;
        dwellProgress = (tt.travelTime - at) / win;
      }
    }
  }
  if (tt.phase === 'done' && tt.phaseProgress === 0 && model.anchors.length) {
    const lastAnchor = model.anchors[model.anchors.length - 1];
    if (lastAnchor.distanceKm >= model.totalKm - 0.001) activeWaypoint = wpById.get(lastAnchor.waypointId) || null;
  }

  return {
    time,
    totalTime: model.totalSeconds,
    phase: tt.phase,
    lng: here.lng,
    lat: here.lat,
    altitudeMeters: Math.round(altitude),
    bearing,
    pitch,
    roll,
    speedKmh: tt.phase === 'travel' ? Math.round(seg?.speedKmh || 0) : 0,
    progress01: model.totalKm > 0 ? km / model.totalKm : 0,
    distanceCoveredKm: Math.round(km * 10) / 10,
    totalDistanceKm: Math.round(model.totalKm * 10) / 10,
    currentSegmentIndex,
    activeWaypoint,
    inTransition,
    dwellProgress,
    reachedWaypointIds,
    reachedAges,
  };
}

export interface TimelineLayout {
  travelStart: number;
  outroStart: number;
  total: number;
  segments: { index: number; start: number; end: number }[];
  waypoints: { id: string; start: number; end: number }[];
  transitions: { start: number; end: number }[];
}

/** Timeline-time ranges of legs and pauses (for the scrubber UI). */
export function timelineLayout(model: RouteModel): TimelineLayout {
  const segments = model.segments
    .filter((s) => s.durationSec > 0)
    .map((s) => ({ index: s.index, start: travelToTimeline(model, s.startTime + 1e-5), end: travelToTimeline(model, s.startTime + s.durationSec) }));
  const waypoints = model.dwellEvents
    .filter((e) => e.kind === 'marker' && e.waypoint)
    .map((e) => {
      const start = travelToTimeline(model, e.travelTime);
      return { id: e.waypoint!.id, start, end: start + e.dwell };
    });
  const transitions = model.dwellEvents
    .filter((e) => e.kind === 'transition')
    .map((e) => {
      const start = travelToTimeline(model, e.travelTime);
      return { start, end: start + e.dwell };
    });
  return { travelStart: travelStartTime(model), outroStart: model.totalSeconds - model.outroSeconds - model.stillAtEnd, total: model.totalSeconds, segments, waypoints, transitions };
}

/** Distance along the route for a timeline time – used by the camera director. */
export function distanceAtTime(model: RouteModel, time: number): number {
  const tt = timeToTravel(model, time);
  return travelTimeToDistance(model.segments, tt.travelTime).km;
}

/** Nearest point on the route to a lng/lat (for placing markers). */
export function snapToRoute(project: RouteProject, lng: number, lat: number): { lng: number; lat: number; distKm: number } | null {
  let best: { lng: number; lat: number; distKm: number } | null = null;
  for (const seg of project.segments) {
    if (seg.coordinates.length < 2) continue;
    try {
      const p = turf.nearestPointOnLine(turf.lineString(seg.coordinates), [lng, lat], { units: 'kilometers' });
      const d = p.properties.dist ?? Infinity;
      if (!best || d < best.distKm) best = { lng: p.geometry.coordinates[0], lat: p.geometry.coordinates[1], distKm: d };
    } catch {
      /* ignore */
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------

export function parseGPX(gpxString: string): { coordinates: [number, number][]; waypoints: Partial<Waypoint>[] } {
  const xml = new DOMParser().parseFromString(gpxString, 'text/xml');
  const coordinates: [number, number][] = [];
  const pts = xml.getElementsByTagName('trkpt').length ? xml.getElementsByTagName('trkpt') : xml.getElementsByTagName('rtept');
  for (let i = 0; i < pts.length; i++) {
    const lat = parseFloat(pts[i].getAttribute('lat') || '');
    const lon = parseFloat(pts[i].getAttribute('lon') || '');
    if (Number.isFinite(lat) && Number.isFinite(lon)) coordinates.push([lon, lat]);
  }
  const waypoints: Partial<Waypoint>[] = [];
  const wpts = xml.getElementsByTagName('wpt');
  for (let i = 0; i < wpts.length; i++) {
    const lat = parseFloat(wpts[i].getAttribute('lat') || '');
    const lon = parseFloat(wpts[i].getAttribute('lon') || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    waypoints.push({
      title: wpts[i].getElementsByTagName('name')[0]?.textContent || `Stop ${i + 1}`,
      subtitle: wpts[i].getElementsByTagName('desc')[0]?.textContent || '',
      lng: lon,
      lat,
    });
  }
  return { coordinates: simplifyTrack(unwrapCoordinates(dedupeCoordinates(coordinates))), waypoints };
}

export function parseKML(kmlString: string): { coordinates: [number, number][]; waypoints: Partial<Waypoint>[] } {
  const xml = new DOMParser().parseFromString(kmlString, 'text/xml');
  const coordinates: [number, number][] = [];
  const waypoints: Partial<Waypoint>[] = [];
  const lines = [...xml.getElementsByTagName('LineString'), ...xml.getElementsByTagName('gx:Track')];
  for (const line of lines) {
    const raw = line.getElementsByTagName('coordinates')[0]?.textContent?.trim() || '';
    for (const p of raw.split(/\s+/)) {
      const parts = p.split(',');
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) coordinates.push([lng, lat]);
    }
    for (const c of line.getElementsByTagName('gx:coord')) {
      const parts = (c.textContent || '').trim().split(/\s+/);
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) coordinates.push([lng, lat]);
    }
  }
  const placemarks = xml.getElementsByTagName('Placemark');
  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];
    const point = pm.getElementsByTagName('Point')[0];
    if (!point) continue;
    const parts = (point.getElementsByTagName('coordinates')[0]?.textContent?.trim() || '').split(',');
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    waypoints.push({ title: pm.getElementsByTagName('name')[0]?.textContent || `Point ${i + 1}`, lng, lat });
  }
  return { coordinates: simplifyTrack(unwrapCoordinates(dedupeCoordinates(coordinates))), waypoints };
}
