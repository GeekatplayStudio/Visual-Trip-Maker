import type { CameraSettings, RouteProject, RouteSegment, RoutingMode, TransportMode, Waypoint } from '../types';
import { buildSegmentGeometry, calculatePathLengthKm, defaultRoutingFor } from './geoUtils';
import { DEFAULT_SPEED_KMH } from './framing';
import { themeInfo } from './mapStyles';

let idCounter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const TRANSPORT_OPTIONS: { mode: TransportMode; label: string; glyph: string; speed: number }[] = [
  { mode: 'sports_car', label: 'Car', glyph: '🚗', speed: DEFAULT_SPEED_KMH.sports_car },
  { mode: 'suv', label: '4x4 / SUV', glyph: '🚙', speed: DEFAULT_SPEED_KMH.suv },
  { mode: 'camper', label: 'Camper van', glyph: '🚐', speed: DEFAULT_SPEED_KMH.camper },
  { mode: 'bus', label: 'Bus', glyph: '🚌', speed: DEFAULT_SPEED_KMH.bus },
  { mode: 'motorcycle', label: 'Motorcycle', glyph: '🏍️', speed: DEFAULT_SPEED_KMH.motorcycle },
  { mode: 'bicycle', label: 'Bicycle', glyph: '🚴', speed: DEFAULT_SPEED_KMH.bicycle },
  { mode: 'hiker', label: 'On foot', glyph: '🥾', speed: DEFAULT_SPEED_KMH.hiker },
  { mode: 'bullet_train', label: 'High-speed train', glyph: '🚄', speed: DEFAULT_SPEED_KMH.bullet_train },
  { mode: 'steam_train', label: 'Train', glyph: '🚂', speed: DEFAULT_SPEED_KMH.steam_train },
  { mode: 'airplane', label: 'Plane', glyph: '✈️', speed: DEFAULT_SPEED_KMH.airplane },
  { mode: 'propeller', label: 'Small plane', glyph: '🛩️', speed: DEFAULT_SPEED_KMH.propeller },
  { mode: 'helicopter', label: 'Helicopter', glyph: '🚁', speed: DEFAULT_SPEED_KMH.helicopter },
  { mode: 'balloon', label: 'Balloon', glyph: '🎈', speed: DEFAULT_SPEED_KMH.balloon },
  { mode: 'yacht', label: 'Boat', glyph: '🛥️', speed: DEFAULT_SPEED_KMH.yacht },
  { mode: 'ferry', label: 'Ferry', glyph: '⛴️', speed: DEFAULT_SPEED_KMH.ferry },
];

export const transportInfo = (mode: TransportMode) => TRANSPORT_OPTIONS.find((t) => t.mode === mode) || TRANSPORT_OPTIONS[0];

export function makeSegment(partial: Partial<RouteSegment> & { points: [number, number][]; transportMode: TransportMode }): RouteSegment {
  const routing: RoutingMode = partial.routing || defaultRoutingFor(partial.transportMode);
  const coordinates = partial.coordinates || buildSegmentGeometry(partial.points, routing === 'road' ? 'curved' : routing);
  return {
    id: partial.id || uid('leg'),
    title: partial.title || transportInfo(partial.transportMode).label,
    transportMode: partial.transportMode,
    points: partial.points,
    routing,
    coordinates,
    roadSnapped: false,
    lengthKm: calculatePathLengthKm(coordinates),
    color: partial.color || '#e63946',
    lineWidth: partial.lineWidth ?? 5,
    lineStyle: partial.lineStyle || 'solid',
    glow: partial.glow ?? true,
    speedKmh: partial.speedKmh ?? transportInfo(partial.transportMode).speed,
    altitudeMeters: partial.altitudeMeters ?? (partial.transportMode === 'airplane' ? 9000 : partial.transportMode === 'propeller' ? 2500 : 0),
  };
}

export function makeWaypoint(partial: Partial<Waypoint> & { lng: number; lat: number }): Waypoint {
  return {
    id: partial.id || uid('wp'),
    title: partial.title || 'New stop',
    subtitle: partial.subtitle || '',
    lng: partial.lng,
    lat: partial.lat,
    dwellTime: partial.dwellTime ?? 1.5,
    revealMode: partial.revealMode || 'on_arrival',
    markerStyle: partial.markerStyle || 'pin',
    icon: partial.icon || 'dot',
    color: partial.color || '#e63946',
    photoUrl: partial.photoUrl,
    showCard: partial.showCard ?? true,
  };
}

export const DEFAULT_CAMERA: CameraSettings = {
  movement: 'follow',
  zoom: 9,
  zoomAuto: true,
  zoomPerTransport: {},
  startWhole: true,
  endWhole: true,
  orientation: 'north_up',
  bearing: -20,
  lookAhead: 1,
  steadiness: 'smooth',
  tilt: 0,
  transitionSeconds: 1.2,
  easing: 'smooth',
};

export const DEFAULT_SETTINGS: Omit<RouteProject, 'id' | 'name' | 'segments' | 'waypoints'> = {
  camera: DEFAULT_CAMERA,
  stillAtStart: 0.5,
  stillAtEnd: 1,
  mapTheme: 'light',
  terrain3D: false,
  terrainExaggeration: 1.4,
  hillshade: true,
  showMapLabels: true,
  showUpcomingRoute: true,
  showHeadBeacon: false,
  vehicleStyle: 'icon',
  vehicleScale: 1,
  lineScale: 1,
  showTrail: true,
  markerScale: 1,
  showMarkerLabels: true,
  showStoryCards: true,
  showHud: false,
  aspectRatio: '16:9',
  lengthMode: 'auto',
  pace: 'normal',
  durationSeconds: 16,
  playbackSpeed: 1,
  loop: false,
  soundEnabled: false,
  volume: 0.5,
};

export function createEmptyProject(): RouteProject {
  return {
    ...DEFAULT_SETTINGS,
    id: uid('project'),
    name: 'My trip',
    segments: [makeSegment({ title: 'Leg 1', transportMode: 'sports_car', points: [], color: themeInfo(DEFAULT_SETTINGS.mapTheme).routeColor })],
    waypoints: [],
  };
}

function project(base: Partial<RouteProject> & { id: string; name: string; segments: RouteSegment[]; waypoints: Waypoint[] }): RouteProject {
  return { ...DEFAULT_SETTINGS, ...base };
}

export const PRESET_PROJECTS: Record<string, RouteProject> = {
  european_voyage: project({
    id: 'european_voyage',
    name: 'Grand European Trip',
    mapTheme: 'parchment',
    camera: { ...DEFAULT_CAMERA, orientation: 'north_up', tilt: 0 },
    pace: 'fast',
    durationSeconds: 20,
    waypoints: [
      makeWaypoint({ id: 'wp-london', title: 'London', subtitle: 'Departure from Heathrow', lng: -0.4543, lat: 51.47, dwellTime: 1.5, revealMode: 'always', markerStyle: 'flag', icon: 'flag', color: '#0f172a' }),
      makeWaypoint({ id: 'wp-paris', title: 'Paris', subtitle: 'Onto the TGV', lng: 2.55, lat: 49.0097, dwellTime: 2, markerStyle: 'pin', icon: 'train', color: '#e63946', photoUrl: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&auto=format&fit=crop&q=70' }),
      makeWaypoint({ id: 'wp-zurich', title: 'Zürich', subtitle: 'Picked up the car', lng: 8.5417, lat: 47.3769, dwellTime: 2, markerStyle: 'pin', icon: 'car', color: '#2a9d8f' }),
      makeWaypoint({ id: 'wp-venice', title: 'Venice', subtitle: 'Boarding the boat', lng: 12.338, lat: 45.434, dwellTime: 2.5, markerStyle: 'photo', icon: 'ship', color: '#3b82f6', photoUrl: 'https://images.unsplash.com/photo-1514890547357-a9ee288728e0?w=800&auto=format&fit=crop&q=70' }),
      makeWaypoint({ id: 'wp-dubrovnik', title: 'Dubrovnik', subtitle: 'Journey’s end', lng: 18.0944, lat: 42.6507, dwellTime: 2, markerStyle: 'flag', icon: 'finish', color: '#0f172a' }),
    ],
    segments: [
      makeSegment({ id: 'seg-1', title: 'Flight to Paris', transportMode: 'airplane', routing: 'arc', points: [[-0.4543, 51.47], [2.55, 49.0097]], color: '#8b5cf6', lineStyle: 'dashed', speedKmh: 800, altitudeMeters: 9000 }),
      makeSegment({ id: 'seg-2', title: 'TGV to Zürich', transportMode: 'bullet_train', routing: 'curved', points: [[2.55, 49.0097], [3.8, 48.6], [5.1, 47.9], [6.8, 47.5], [8.5417, 47.3769]], color: '#e63946', speedKmh: 250 }),
      makeSegment({ id: 'seg-3', title: 'Alpine drive to Venice', transportMode: 'sports_car', routing: 'road', points: [[8.5417, 47.3769], [9.38, 46.97], [10.35, 46.5], [11.12, 46.07], [12.338, 45.434]], color: '#f4a261', speedKmh: 100 }),
      makeSegment({ id: 'seg-4', title: 'Adriatic crossing', transportMode: 'yacht', routing: 'curved', points: [[12.338, 45.434], [13.5, 44.8], [15.2, 43.8], [17.1, 43.1], [18.0944, 42.6507]], color: '#38bdf8', lineStyle: 'dots', speedKmh: 40 }),
    ],
  }),

  california_highway_1: project({
    id: 'california_highway_1',
    name: 'Pacific Coast Highway',
    mapTheme: 'satellite',
    terrain3D: true,
    terrainExaggeration: 1.5,
    camera: { ...DEFAULT_CAMERA, orientation: 'heading', tilt: 45, steadiness: 'very_smooth', lookAhead: 2, zoomAuto: false, zoom: 10.5 },
    vehicleStyle: '3d',
    durationSeconds: 18,
    pace: 'fast',
    waypoints: [
      makeWaypoint({ id: 'wp-sf', title: 'San Francisco', subtitle: 'Golden Gate Bridge', lng: -122.4783, lat: 37.8199, dwellTime: 1.5, revealMode: 'always', markerStyle: 'flag', icon: 'flag', color: '#ffffff', photoUrl: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800&auto=format&fit=crop&q=70' }),
      makeWaypoint({ id: 'wp-monterey', title: 'Monterey', subtitle: 'Lunch by the bay', lng: -121.8947, lat: 36.6002, dwellTime: 2, markerStyle: 'pin', icon: 'food', color: '#fbbf24' }),
      makeWaypoint({ id: 'wp-bigsur', title: 'Bixby Creek Bridge', subtitle: 'Big Sur', lng: -121.9018, lat: 36.3714, dwellTime: 2.5, markerStyle: 'photo', icon: 'camera', color: '#fbbf24', photoUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&auto=format&fit=crop&q=70' }),
      makeWaypoint({ id: 'wp-la', title: 'Malibu', subtitle: 'Sunset finish', lng: -118.6775, lat: 34.0353, dwellTime: 2, markerStyle: 'flag', icon: 'finish', color: '#ffffff' }),
    ],
    segments: [
      makeSegment({ id: 'seg-ca-1', title: 'SF to Monterey', transportMode: 'sports_car', routing: 'road', points: [[-122.4783, 37.8199], [-122.46, 37.6], [-122.3, 37.3], [-122.03, 36.97], [-121.8947, 36.6002]], color: '#fde047', speedKmh: 90 }),
      makeSegment({ id: 'seg-ca-2', title: 'Monterey to Big Sur', transportMode: 'sports_car', routing: 'road', points: [[-121.8947, 36.6002], [-121.92, 36.52], [-121.9018, 36.3714]], color: '#fb923c', speedKmh: 60 }),
      makeSegment({ id: 'seg-ca-3', title: 'Big Sur to Malibu', transportMode: 'camper', routing: 'road', points: [[-121.9018, 36.3714], [-121.5, 36.0], [-120.85, 35.37], [-119.7, 34.42], [-118.6775, 34.0353]], color: '#f472b6', speedKmh: 90 }),
    ],
  }),

  japan_fuji_expedition: project({
    id: 'japan_fuji_expedition',
    name: 'Tokyo to Mount Fuji',
    mapTheme: 'outdoor',
    terrain3D: true,
    terrainExaggeration: 1.6,
    camera: { ...DEFAULT_CAMERA, orientation: 'fixed', bearing: -35, tilt: 50, zoomAuto: false, zoom: 10 },
    vehicleStyle: '3d',
    durationSeconds: 16,
    waypoints: [
      makeWaypoint({ id: 'wp-tokyo', title: 'Tokyo Station', subtitle: 'Shinkansen departure', lng: 139.7671, lat: 35.6812, dwellTime: 1.5, revealMode: 'always', markerStyle: 'flag', icon: 'flag', color: '#0f172a' }),
      makeWaypoint({ id: 'wp-hakone', title: 'Hakone', subtitle: 'Onsen and Lake Ashi', lng: 139.0238, lat: 35.2034, dwellTime: 2, markerStyle: 'pin', icon: 'hotel', color: '#dc2626' }),
      makeWaypoint({ id: 'wp-station5', title: 'Fuji 5th Station', subtitle: 'Trailhead, 2,305 m', lng: 138.7308, lat: 35.3672, dwellTime: 2, markerStyle: 'pin', icon: 'hike', color: '#2a9d8f' }),
      makeWaypoint({ id: 'wp-fujisummit', title: 'Mount Fuji summit', subtitle: '3,776 m · sunrise above the clouds', lng: 138.7274, lat: 35.3606, dwellTime: 3, markerStyle: 'photo', icon: 'mountain', color: '#dc2626', photoUrl: 'https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?w=800&auto=format&fit=crop&q=70' }),
    ],
    segments: [
      makeSegment({ id: 'seg-jp-1', title: 'Shinkansen to Odawara', transportMode: 'bullet_train', routing: 'curved', points: [[139.7671, 35.6812], [139.69, 35.62], [139.55, 35.45], [139.3, 35.3], [139.15, 35.25], [139.0238, 35.2034]], color: '#2563eb', speedKmh: 250 }),
      makeSegment({ id: 'seg-jp-2', title: 'Drive to the 5th Station', transportMode: 'suv', routing: 'road', points: [[139.0238, 35.2034], [138.93, 35.26], [138.8, 35.33], [138.7308, 35.3672]], color: '#f59e0b', speedKmh: 50 }),
      makeSegment({ id: 'seg-jp-3', title: 'Summit hike', transportMode: 'hiker', routing: 'curved', points: [[138.7308, 35.3672], [138.7295, 35.3645], [138.7282, 35.3625], [138.7274, 35.3606]], color: '#dc2626', lineStyle: 'dashed', speedKmh: 3 }),
    ],
  }),
};

export const PRESET_LIST = [
  { key: 'european_voyage', label: 'Grand European Trip' },
  { key: 'california_highway_1', label: 'Pacific Coast Highway' },
  { key: 'japan_fuji_expedition', label: 'Tokyo to Mount Fuji' },
];
