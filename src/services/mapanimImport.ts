/**
 * Import of `.mapanim` project files (format "map-animator-project").
 * Routes are stored as cubic Bézier anchors in Web Mercator [0..1] space with leg changes on anchors.
 */
import type { CameraSettings, MarkerStyle, RouteProject, TransportMode, Waypoint } from '../types';
import { DEFAULT_CAMERA, DEFAULT_SETTINGS, makeSegment, makeWaypoint, uid } from './presets';
import { calculatePathLengthKm, dedupeCoordinates } from './geoUtils';

interface MAAnchor {
  x: number;
  y: number;
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  mode?: string;
  leg?: { mode?: string };
}
interface MAStyle {
  color?: string;
  width?: number;
  dash?: string;
  head?: string;
  glow?: boolean;
}
interface MAShot {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
}
interface MAMarker {
  id?: string;
  kind?: string;
  x: number;
  y: number;
  text?: string;
  sub?: string;
  show?: string;
  photo?: { id: string };
  pause?: boolean;
  pauseLen?: number;
}
interface MAScene {
  id?: string;
  name?: string;
  anchors?: MAAnchor[];
  firstLeg?: { mode?: string };
  cameraMode?: string;
  shots?: { start?: MAShot; end?: MAShot };
  camera?: MAShot;
  view?: MAShot;
  easing?: string;
  tilt?: number;
  holdStart?: number;
  holdEnd?: number;
  mapStyle?: string;
  mapLabels?: boolean;
  terrain?: boolean;
  style?: MAStyle;
  modeStyles?: Record<string, MAStyle>;
  follow?: { zoom?: number | null; orient?: string; lookAhead?: number; steadiness?: number };
  speed?: number;
  markers?: MAMarker[];
  symbols3d?: boolean;
}
interface MAFile {
  format: string;
  version?: number;
  project: { name?: string; aspect?: string; fps?: number; scenes: MAScene[] };
  photos?: Record<string, unknown>;
}

export const isMapanimFile = (obj: unknown): obj is MAFile =>
  !!obj && typeof obj === 'object' && (obj as MAFile).format === 'map-animator-project' && Array.isArray((obj as MAFile).project?.scenes);

const mercToLngLat = (x: number, y: number): [number, number] => {
  const lng = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lng, lat];
};

const TRANSPORT: Record<string, TransportMode> = {
  car: 'sports_car',
  'car-caravan': 'camper',
  caravan: 'camper',
  motorhome: 'camper',
  'motor-home': 'camper',
  bus: 'bus',
  truck: 'camper',
  'tuk-tuk': 'suv',
  tuktuk: 'suv',
  motorcycle: 'motorcycle',
  atv: 'suv',
  '4wd': 'suv',
  snowmobile: 'suv',
  bicycle: 'bicycle',
  walk: 'hiker',
  run: 'hiker',
  horse: 'hiker',
  train: 'bullet_train',
  boat: 'yacht',
  sailboat: 'yacht',
  kayak: 'yacht',
  swim: 'yacht',
  'sail-ship': 'ferry',
  sailship: 'ferry',
  plane: 'airplane',
  helicopter: 'helicopter',
  drone: 'propeller',
  balloon: 'balloon',
  'hot-air-balloon': 'balloon',
  paraglider: 'propeller',
  'hang-glider': 'propeller',
  hangglider: 'propeller',
  paramotor: 'propeller',
  line: 'sports_car',
  plain: 'sports_car',
};
const transportFor = (mode?: string): TransportMode => TRANSPORT[(mode || '').toLowerCase()] || 'sports_car';

const MAP_THEME: Record<string, RouteProject['mapTheme']> = {
  classic: 'streets',
  light: 'light',
  dark: 'dark',
  fiord: 'fiord',
  satellite: 'satellite',
  offroad: 'outdoor',
  treasure: 'parchment',
  atlas: 'parchment',
  nautical: 'parchment',
  parchment: 'parchment',
  mars: 'satellite',
};

function markerStyleFor(kind?: string): MarkerStyle {
  switch ((kind || '').toLowerCase()) {
    case 'photo':
      return 'photo';
    case 'flag':
    case 'finish':
    case 'banner':
    case 'start':
      return 'flag';
    case 'parchment':
    case 'standing':
    case 'plaque':
      return 'label';
    default:
      return 'pin';
  }
}
function iconFor(kind?: string): string {
  switch ((kind || '').toLowerCase()) {
    case 'camp':
      return 'tent';
    case 'hotel':
      return 'hotel';
    case 'flag':
    case 'finish':
      return 'finish';
    case 'banner':
    case 'start':
      return 'flag';
    case 'summit':
      return 'mountain';
    case 'photo':
      return 'camera';
    default:
      return 'dot';
  }
}

/** Sample the cubic Bézier chain between two anchors. */
function bezierCoords(a: MAAnchor, b: MAAnchor, steps: number): [number, number][] {
  const p0 = [a.x, a.y];
  const p1 = [a.x + (a.ox || 0), a.y + (a.oy || 0)];
  const p2 = [b.x + (b.ix || 0), b.y + (b.iy || 0)];
  const p3 = [b.x, b.y];
  const out: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
    out.push(mercToLngLat(x, y));
  }
  return out;
}

export interface ImportResult {
  project: RouteProject;
  sceneCount: number;
  sceneName: string;
}

/** Convert one scene of a Map Animator file into a project. */
export function importMapanim(file: MAFile, sceneIndex = 0): ImportResult {
  const scenes = file.project.scenes;
  const scene = scenes[Math.max(0, Math.min(scenes.length - 1, sceneIndex))];
  const anchors = scene.anchors || [];
  const photos = (file.photos || {}) as Record<string, unknown>;

  // --- legs
  const legs: { mode: string; anchors: MAAnchor[] }[] = [];
  let cur: { mode: string; anchors: MAAnchor[] } = { mode: scene.firstLeg?.mode || 'line', anchors: [] };
  anchors.forEach((a, i) => {
    if (i > 0 && a.leg?.mode) {
      cur.anchors.push(a); // the change point ends the previous leg and starts the next
      legs.push(cur);
      cur = { mode: a.leg.mode, anchors: [a] };
    } else {
      cur.anchors.push(a);
    }
  });
  if (cur.anchors.length) legs.push(cur);

  const styleFor = (mode: string): MAStyle => scene.modeStyles?.[mode] || scene.style || {};
  const segments = legs
    .filter((l) => l.anchors.length >= 2)
    .map((l, i) => {
      const coords: [number, number][] = [mercToLngLat(l.anchors[0].x, l.anchors[0].y)];
      for (let k = 0; k < l.anchors.length - 1; k++) coords.push(...bezierCoords(l.anchors[k], l.anchors[k + 1], 24));
      const points = l.anchors.map((a) => mercToLngLat(a.x, a.y));
      const st = styleFor(l.mode);
      const mode = transportFor(l.mode);
      const seg = makeSegment({
        title: `Leg ${i + 1} · ${l.mode}`,
        transportMode: mode,
        routing: 'curved',
        points,
        coordinates: dedupeCoordinates(coords),
        color: st.color || '#e63946',
        lineWidth: Math.max(2, Math.min(14, st.width || 6)),
        lineStyle: st.dash === 'dashed' ? 'dashed' : st.dash === 'dotted' ? 'dots' : 'solid',
        glow: !!st.glow,
      });
      return { ...seg, lengthKm: calculatePathLengthKm(seg.coordinates) };
    });

  // --- markers
  const waypoints: Waypoint[] = (scene.markers || []).map((m, i) => {
    const [lng, lat] = mercToLngLat(m.x, m.y);
    let photoUrl: string | undefined;
    const ph = m.photo?.id ? photos[m.photo.id] : undefined;
    if (typeof ph === 'string') photoUrl = ph.startsWith('data:') ? ph : `data:image/jpeg;base64,${ph}`;
    else if (ph && typeof ph === 'object') {
      const o = ph as { data?: string; dataUrl?: string; url?: string; src?: string };
      photoUrl = o.dataUrl || o.url || o.src || (o.data ? (o.data.startsWith('data:') ? o.data : `data:image/jpeg;base64,${o.data}`) : undefined);
    }
    return makeWaypoint({
      title: m.text || `Sign ${i + 1}`,
      subtitle: m.sub || '',
      lng,
      lat,
      dwellTime: m.pause ? m.pauseLen || 2 : 0,
      revealMode: m.show === 'always' ? 'always' : 'on_arrival',
      markerStyle: photoUrl ? 'photo' : markerStyleFor(m.kind),
      icon: iconFor(m.kind),
      color: m.kind === 'summit' ? '#dc2626' : '#2a9d8f',
      photoUrl,
      showCard: true,
    });
  });

  // --- camera
  const f = scene.follow || {};
  const camMode = scene.cameraMode || 'follow';
  const toShot = (s?: MAShot) => (s ? { center: s.center, zoom: s.zoom, bearing: s.bearing || 0, pitch: s.pitch || 0 } : undefined);
  const camera: CameraSettings = {
    ...DEFAULT_CAMERA,
    movement: camMode === 'shots' ? 'start_to_end' : camMode === 'fixed' ? 'fixed' : 'follow',
    zoom: typeof f.zoom === 'number' ? f.zoom : 9,
    zoomAuto: typeof f.zoom !== 'number',
    orientation: f.orient === 'heading' ? 'heading' : 'north_up',
    lookAhead: (f.lookAhead || 0) <= 0.01 ? 0 : (f.lookAhead || 0) < 0.25 ? 1 : 2,
    steadiness: (f.steadiness ?? 0.6) < 0.35 ? 'tight' : (f.steadiness ?? 0.6) > 0.8 ? 'very_smooth' : 'smooth',
    tilt: Math.max(0, Math.min(65, scene.tilt || 0)),
    easing: scene.easing === 'steady' ? 'steady' : 'smooth',
    startShot: toShot(scene.shots?.start),
    endShot: toShot(scene.shots?.end),
    fixedShot: toShot(scene.camera || scene.view),
    startWhole: false,
    endWhole: false,
  };

  const totalKm = segments.reduce((a, s) => a + s.lengthKm, 0);
  // Map Animator derives the length from a speed dial; approximate a similar pace.
  const speed = scene.speed || 0.18;
  const durationSeconds = Math.max(6, Math.min(60, Math.round((8 + totalKm / 150) * (0.18 / Math.max(0.05, speed)))));

  const project: RouteProject = {
    ...DEFAULT_SETTINGS,
    id: uid('project'),
    name: scenes.length > 1 ? `${file.project.name || 'Imported trip'} – ${scene.name || `Scene ${sceneIndex + 1}`}` : file.project.name || 'Imported trip',
    segments: segments.length ? segments : [makeSegment({ title: 'Leg 1', transportMode: 'sports_car', points: [] })],
    waypoints,
    camera,
    stillAtStart: scene.holdStart ?? 0.5,
    stillAtEnd: scene.holdEnd ?? 1.5,
    mapTheme: MAP_THEME[(scene.mapStyle || '').toLowerCase()] || 'light',
    terrain3D: !!scene.terrain,
    showMapLabels: scene.mapLabels !== false,
    vehicleStyle: scene.symbols3d ? 'icon' : 'icon',
    aspectRatio: file.project.aspect === '9:16' ? '9:16' : file.project.aspect === '1:1' ? '1:1' : '16:9',
    lengthMode: 'auto',
    pace: speed > 0.25 ? 'fast' : speed < 0.12 ? 'slow' : 'normal',
    durationSeconds,
  };
  return { project, sceneCount: scenes.length, sceneName: scene.name || `Scene ${sceneIndex + 1}` };
}
