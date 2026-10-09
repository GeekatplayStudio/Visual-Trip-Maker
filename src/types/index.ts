export type TransportMode =
  | 'airplane'
  | 'propeller'
  | 'sports_car'
  | 'suv'
  | 'camper'
  | 'bullet_train'
  | 'steam_train'
  | 'motorcycle'
  | 'yacht'
  | 'ferry'
  | 'hiker'
  | 'bicycle'
  | 'helicopter'
  | 'balloon';

/** How the control points of a leg are turned into the drawn geometry. */
export type RoutingMode = 'straight' | 'curved' | 'arc' | 'road';

export type CameraMovement = 'follow' | 'start_to_end' | 'fixed';
export type ZoomTier = 'closer' | 'same' | 'wider' | 'widest';
export type Orientation = 'north_up' | 'heading' | 'fixed';
export type Steadiness = 'tight' | 'smooth' | 'very_smooth';

export interface CameraShot {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface CameraSettings {
  movement: CameraMovement;
  // --- follow the line
  /** Base zoom when following. Ignored while `zoomAuto` is on. */
  zoom: number;
  zoomAuto: boolean;
  /** Relative framing per transport, compared with `zoom`. */
  zoomPerTransport: Partial<Record<TransportMode, ZoomTier>>;
  /** Open on the whole route and glide in. */
  startWhole: boolean;
  /** Pull back to the whole route at the end. */
  endWhole: boolean;
  orientation: Orientation;
  /** Bearing used when orientation is 'fixed'. */
  bearing: number;
  /** 0 = tip centred, 1 = a little, 2 = more. */
  lookAhead: 0 | 1 | 2;
  steadiness: Steadiness;
  /** Degrees, 0 = flat. */
  tilt: number;
  /** Seconds the line pauses at a transport change while the camera glides to the new zoom. */
  transitionSeconds: number;
  // --- start to end
  startShot?: CameraShot;
  endShot?: CameraShot;
  easing: 'smooth' | 'steady';
  // --- fixed
  fixedShot?: CameraShot;
}

export type MapTheme =
  | 'streets' // OpenFreeMap Liberty (vector)
  | 'bright' // OpenFreeMap Bright (vector)
  | 'light' // OpenFreeMap Positron (vector, minimal light)
  | 'dark' // OpenFreeMap Dark (vector, minimal dark)
  | 'fiord' // OpenFreeMap Fiord (vector, blue/teal)
  | 'satellite' // Esri World Imagery (raster)
  | 'outdoor' // OpenTopoMap (raster)
  | 'parchment'; // Positron tinted sepia

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type ResolutionPreset = '720p' | '1080p' | '1440p' | '4k';

export type MarkerStyle =
  | 'pin' // coloured teardrop pin with an icon
  | 'dot' // small ring dot with a label
  | 'flag' // start / finish flag
  | 'photo' // polaroid photo card
  | 'label'; // text only

export type VehicleStyle = '3d' | 'icon' | 'none';

export type LineStyle = 'solid' | 'dashed' | 'dots';

export interface Waypoint {
  id: string;
  title: string;
  subtitle?: string;
  lng: number;
  lat: number;
  /** Seconds the animation pauses at this marker. */
  dwellTime: number;
  revealMode: 'always' | 'on_arrival';
  markerStyle: MarkerStyle;
  /** Key from MARKER_ICONS, e.g. 'city', 'camera', 'plane'. */
  icon: string;
  /** Marker colour (hex). */
  color: string;
  photoUrl?: string;
  /** Show a story card overlay when the head reaches this marker. */
  showCard: boolean;
}

export interface RouteSegment {
  id: string;
  title: string;
  transportMode: TransportMode;
  /** User-edited control points [lng, lat]. */
  points: [number, number][];
  routing: RoutingMode;
  /** Derived geometry built from `points` + `routing`. */
  coordinates: [number, number][];
  /** True once `coordinates` came back from the road router for the current points. */
  roadSnapped?: boolean;
  lengthKm: number;
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  glow: boolean;
  /** Nominal speed, used to weight how much of the total duration this leg takes. */
  speedKmh: number;
  /** Cruise altitude for flying modes. */
  altitudeMeters: number;
}

export interface RouteProject {
  id: string;
  name: string;
  segments: RouteSegment[];
  waypoints: Waypoint[];

  camera: CameraSettings;
  /** Seconds to hold the first frame. */
  stillAtStart: number;
  /** Seconds to hold the last frame. */
  stillAtEnd: number;

  // Look
  mapTheme: MapTheme;
  terrain3D: boolean;
  terrainExaggeration: number;
  hillshade: boolean;
  showMapLabels: boolean;
  showUpcomingRoute: boolean;
  showHeadBeacon: boolean;
  vehicleStyle: VehicleStyle;
  vehicleScale: number; // 0.5 .. 2
  /** Multiplies every leg's line width. 0.5 .. 2.5 */
  lineScale: number;
  /** Motion trail behind the symbol (wake, contrail, smoke, dust). */
  showTrail: boolean;
  markerScale: number; // 0.6 .. 1.6
  showMarkerLabels: boolean;
  showStoryCards: boolean;
  showHud: boolean;

  // Playback
  aspectRatio: AspectRatio;
  durationSeconds: number; // travel time, excluding dwell pauses and intro/outro
  playbackSpeed: number;
  loop: boolean;
  soundEnabled: boolean;
  volume: number;
}

/** Distance along the whole route at which each waypoint sits. */
export interface WaypointAnchor {
  waypointId: string;
  distanceKm: number;
  /** Snapped point on the route. */
  lng: number;
  lat: number;
}

export interface VehicleTelemetry {
  /** Seconds, including intro/outro and dwell pauses. */
  time: number;
  totalTime: number;
  phase: 'intro' | 'travel' | 'dwell' | 'outro' | 'done';
  lng: number;
  lat: number;
  altitudeMeters: number;
  bearing: number;
  pitch: number;
  roll: number;
  speedKmh: number;
  /** 0..1 fraction of the total distance covered. */
  progress01: number;
  distanceCoveredKm: number;
  totalDistanceKm: number;
  currentSegmentIndex: number;
  /** Waypoint currently dwelt at (or just reached). */
  activeWaypoint: Waypoint | null;
  /** True while the line is paused for a transport-change camera glide. */
  inTransition: boolean;
  /** 0..1 progress through the dwell at the active waypoint. */
  dwellProgress: number;
  /** Ids of waypoints whose anchor has been passed. */
  reachedWaypointIds: string[];
  /** Per reached waypoint, seconds since it was reached (for pop-in animation). */
  reachedAges: Record<string, number>;
}

export interface ExportProgress {
  isExporting: boolean;
  progressPercent: number;
  currentFrame: number;
  totalFrames: number;
  statusText: string;
  downloadUrl?: string;
  fileName?: string;
  error?: string;
}

export type EditTool = 'select' | 'draw' | 'marker';
