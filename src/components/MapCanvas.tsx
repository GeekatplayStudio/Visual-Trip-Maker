import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import * as THREE from 'three';
import type { CameraShot, EditTool, RouteProject, TransportMode, VehicleTelemetry } from '../types';
import { create3DVehicle, type Vehicle3DInstance } from '../services/threeVehicles';
import { FLYING_MODES, WATER_MODES, interpolateRouteState, sampleAtDistance, type RouteModel } from '../services/geoUtils';
import { computeCameraPose, type CameraPose } from '../services/cameraDirector';
import { DEM_SOURCE_ID, firstSymbolLayerId, labelLayerIds, loadThemeStyle, themeInfo } from '../services/mapStyles';
import { SPRITE_LENGTH_PX, renderGlow, renderGroundShadow, renderLegBadge, renderMarkerIcon, renderPhotoMarker, renderVehicleSprite } from '../services/markerIcons';
import { paintOverlay, preloadPhotos } from '../services/overlayPainter';

export interface MapFrameApi {
  /** Synchronously update route, markers, vehicle, camera and overlay for a timeline time. */
  renderFrame: (time: number) => VehicleTelemetry;
  /** Resolves once the map has rendered and all tiles for the view are loaded (or after the timeout). */
  settle: (timeoutMs?: number) => Promise<void>;
  getMapCanvas: () => HTMLCanvasElement | null;
  getOverlayCanvas: () => HTMLCanvasElement | null;
  /** Render scale used for export; 0 restores the device pixel ratio. */
  setRenderScale: (scale: number) => void;
  fitRoute: () => void;
  /** Current map view (for saving camera shots). */
  getView: () => CameraShot | null;
  /** Fly the map to a shot (camera must be unlocked). */
  showView: (shot: CameraShot) => void;
  getViewport: () => { width: number; height: number };
  /**
   * Walk the camera path on a hidden twin map so every tile the video needs is in the browser cache.
   * Resolves when done or aborted.
   */
  precache: (opts: PrecacheOptions) => Promise<void>;
}

export interface PrecacheOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** While this returns true the walk waits (e.g. during playback). */
  shouldPause?: () => boolean;
}

interface MapCanvasProps {
  project: RouteProject;
  model: RouteModel;
  currentTime: number;
  isPlaying: boolean;
  editTool: EditTool;
  /** When false the director does not drive the map, so the user can frame shots by hand. */
  cameraLocked: boolean;
  activeSegmentIndex: number;
  selectedWaypointId: string | null;
  onApiReady: (api: MapFrameApi) => void;
  onAddPoint: (lng: number, lat: number) => void;
  onMovePoint: (segIdx: number, pointIdx: number, lng: number, lat: number) => void;
  onDeletePoint: (segIdx: number, pointIdx: number) => void;
  onSelectPoint: (segIdx: number, pointIdx: number) => void;
  selectedPoint: { segIdx: number; idx: number } | null;
  onAddWaypoint: (lng: number, lat: number) => void;
  onMoveWaypoint: (id: string, lng: number, lat: number) => void;
  onSelectWaypoint: (id: string | null) => void;
  onStyleError?: (message: string) => void;
}

const SRC = {
  upcoming: 'src-route-upcoming',
  traveled: 'src-route-traveled',
  head: 'src-route-head',
  markers: 'src-markers',
  current: 'src-route-current',
  vertices: 'src-edit-vertices',
  controlLine: 'src-edit-control-line',
  badges: 'src-leg-badges',
  trail: 'src-trail',
  shadow: 'src-vehicle-shadow',
};
const LYR = {
  upcomingCasing: 'route-upcoming-casing',
  upcoming: 'route-upcoming',
  traveledGlow: 'route-traveled-glow',
  traveledCasing: 'route-traveled-casing',
  traveled: 'route-traveled',
  headGlow: 'route-head-glow',
  headRing: 'route-head-ring',
  headDot: 'route-head-dot',
  currentGlow: 'route-current-glow',
  currentCasing: 'route-current-casing',
  current: 'route-current',
  three: 'vehicle-3d',
  markers: 'markers',
  controlLine: 'edit-control-line',
  vertices: 'edit-vertices',
  verticesHalo: 'edit-vertices-halo',
  badges: 'leg-badges',
  trailLine: 'trail-line',
  trailPuff: 'trail-puff',
  vehicleShadow: 'vehicle-shadow',
  hillshade: 'terrain-hillshade',
};

const emptyFC = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

/** Initial great-circle bearing (degrees clockwise from north) from a to b. */
function bearingBetween(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const r = Math.PI / 180;
  const p1 = a.lat * r;
  const p2 = b.lat * r;
  const dl = (b.lng - a.lng) * r;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// MapLibre uses 512 px tiles: the world is 512 * 2^zoom px wide.
const metersPerPixel = (lat: number, zoom: number) => (78271.517 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

/** Target on-screen length (px) for each 3D model. */
const VEHICLE_PX: Record<TransportMode, number> = {
  airplane: 74,
  propeller: 60,
  sports_car: 46,
  suv: 48,
  camper: 50,
  bus: 58,
  bullet_train: 86,
  steam_train: 70,
  motorcycle: 40,
  yacht: 70,
  ferry: 72,
  hiker: 34,
  bicycle: 36,
  helicopter: 54,
  balloon: 54,
};

export const MapCanvas: React.FC<MapCanvasProps> = (props) => {
  const { project, model, currentTime, isPlaying, editTool, cameraLocked, activeSegmentIndex, selectedWaypointId, selectedPoint, onApiReady } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleReadyRef = useRef(false);
  const loadedThemeRef = useRef<string | null>(null);
  const baseLabelLayersRef = useRef<string[]>([]);
  const renderScaleRef = useRef(0);

  // latest props for use inside imperative callbacks
  const projectRef = useRef(project);
  const modelRef = useRef(model);
  const timeRef = useRef(currentTime);
  const isPlayingRef = useRef(isPlaying);
  const editToolRef = useRef(editTool);
  const cameraLockedRef = useRef(cameraLocked);
  const activeSegRef = useRef(activeSegmentIndex);
  const selectedWpRef = useRef(selectedWaypointId);
  const selectedPointRef = useRef(selectedPoint);
  const propsRef = useRef(props);
  projectRef.current = project;
  modelRef.current = model;
  timeRef.current = currentTime;
  isPlayingRef.current = isPlaying;
  editToolRef.current = editTool;
  cameraLockedRef.current = cameraLocked;
  activeSegRef.current = activeSegmentIndex;
  selectedWpRef.current = selectedWaypointId;
  selectedPointRef.current = selectedPoint;
  propsRef.current = props;

  // Three.js
  const threeRef = useRef<{ scene: THREE.Scene; camera: THREE.Camera; renderer: THREE.WebGLRenderer; spriteScene: THREE.Scene; spriteMesh: THREE.Mesh } | null>(null);
  const vehicleRef = useRef<Vehicle3DInstance | null>(null);
  const vehicleModeRef = useRef<TransportMode | null>(null);
  const vehicleLengthRef = useRef(1);
  const vehicleTfRef = useRef({ lng: 0, lat: 0, alt: 0, bearing: 0, pitch: 0, roll: 0, scale: 1, visible: false });
  const lastFrameTimeRef = useRef<number | null>(null);
  // flat vehicle symbol, drawn in the WebGL layer so it moves in the same frame as the camera
  const spriteTfRef = useRef({ lng: 0, lat: 0, alt: 0, bearing: 0, sizeM: 1, key: '', visible: false });
  const spriteTexRef = useRef<Map<string, THREE.Texture>>(new Map());
  // last data sent to the map worker, to skip unchanged updates
  const sentRef = useRef<{ doneKey: string; markers: string; headEmpty: boolean; trailEmpty: boolean; overlayDirty: boolean }>({ doneKey: '', markers: '', headEmpty: false, trailEmpty: false, overlayDirty: true });

  // marker images
  const imagesRef = useRef<Set<string>>(new Set());
  const pendingPhotoRef = useRef<Set<string>>(new Set());

  // editing
  const dragRef = useRef<{ kind: 'vertex'; segIdx: number; idx: number; startX: number; startY: number; moved: boolean } | { kind: 'marker'; id: string; startX: number; startY: number; moved: boolean } | null>(null);

  // ------------------------------------------------------------------ helpers
  const getMap = () => (styleReadyRef.current ? mapRef.current : null);

  const ensureImage = (map: maplibregl.Map, id: string, make: () => ReturnType<typeof renderMarkerIcon>) => {
    if (map.hasImage(id)) return;
    const icon = make();
    map.addImage(id, { width: icon.width, height: icon.height, data: icon.data.data }, { pixelRatio: icon.pixelRatio });
    imagesRef.current.add(id);
  };

  const markerImageId = (style: string, icon: string, color: string) => `mk:${style}:${icon}:${color}`;

  const syncMarkerImages = (map: maplibregl.Map, proj: RouteProject) => {
    for (const wp of proj.waypoints) {
      if (wp.markerStyle === 'photo' && wp.photoUrl) {
        const id = `photo:${wp.photoUrl}:${wp.color}`;
        if (!map.hasImage(id) && !pendingPhotoRef.current.has(id)) {
          pendingPhotoRef.current.add(id);
          renderPhotoMarker(wp.photoUrl, wp.color).then((icon) => {
            pendingPhotoRef.current.delete(id);
            const m = mapRef.current;
            if (!m || !styleReadyRef.current || m.hasImage(id)) return;
            m.addImage(id, { width: icon.width, height: icon.height, data: icon.data.data }, { pixelRatio: icon.pixelRatio });
            syncMarkerData(m, projectRef.current, null);
          });
        }
        // fallback pin while loading
        ensureImage(map, markerImageId('pin', wp.icon, wp.color), () => renderMarkerIcon('pin', wp.icon, wp.color));
      } else {
        ensureImage(map, markerImageId(wp.markerStyle, wp.icon, wp.color), () => renderMarkerIcon(wp.markerStyle, wp.icon, wp.color));
      }
    }
    const accent = themeInfo(proj.mapTheme).accent;
    ensureImage(map, `glow:${accent}`, () => renderGlow(accent));
    ensureImage(map, 'ground-shadow', () => renderGroundShadow());
    for (const seg of proj.segments) {
      ensureImage(map, `badge:${seg.transportMode}:${seg.color}`, () => renderLegBadge(seg.transportMode, seg.color));
    }
  };

  const syncMarkerData = (map: maplibregl.Map, proj: RouteProject, tel: VehicleTelemetry | null) => {
    const src = map.getSource(SRC.markers) as GeoJSONSource | undefined;
    if (!src) return;
    const selected = selectedWpRef.current;
    const features: GeoJSON.Feature[] = proj.waypoints.map((wp) => {
      let img = markerImageId(wp.markerStyle, wp.icon, wp.color);
      let anchor: 'bottom' | 'center' = wp.markerStyle === 'dot' || wp.markerStyle === 'label' ? 'center' : 'bottom';
      if (wp.markerStyle === 'photo' && wp.photoUrl) {
        const pid = `photo:${wp.photoUrl}:${wp.color}`;
        img = map.hasImage(pid) ? pid : markerImageId('pin', wp.icon, wp.color);
      }
      let pop = 1;
      if (tel && editToolRef.current === 'select') {
        if (!tel.reachedWaypointIds.includes(wp.id)) pop = 0;
        else {
          const age = tel.reachedAges[wp.id] ?? 99;
          const k = Math.min(1, age / 0.45);
          pop = k >= 1 ? 1 : 1 + 1.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2) + Math.pow(k - 1, 3); // easeOutBack-ish
          pop = Math.max(0.001, pop);
        }
      }
      const isPhoto = img.startsWith('photo:');
      const textOffset = anchor === 'center' ? [1.0, 0] : isPhoto ? [0, 0.6] : [0.9, -2.2];
      const textAnchor = anchor === 'center' ? 'left' : isPhoto ? 'top' : 'left';
      return {
        type: 'Feature',
        id: wp.id,
        properties: {
          id: wp.id,
          img,
          anchor,
          pop,
          title: wp.title,
          subtitle: wp.subtitle || '',
          textOffset,
          textAnchor,
          selected: selected === wp.id ? 1 : 0,
          label: proj.showMarkerLabels && wp.markerStyle !== 'photo' ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: [wp.lng, wp.lat] },
      };
    });
    const key = JSON.stringify(features);
    if (key === sentRef.current.markers) return;
    sentRef.current.markers = key;
    src.setData({ type: 'FeatureCollection', features });
  };

  const syncUpcomingRoute = (map: maplibregl.Map, proj: RouteProject) => {
    const src = map.getSource(SRC.upcoming) as GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature[] = proj.segments
      .filter((s) => s.coordinates.length >= 2)
      .map((s) => ({ type: 'Feature', properties: { color: s.color, width: s.lineWidth }, geometry: { type: 'LineString', coordinates: s.coordinates } }));
    src.setData({ type: 'FeatureCollection', features });
    map.setLayoutProperty(LYR.upcoming, 'visibility', proj.showUpcomingRoute ? 'visible' : 'none');
    map.setLayoutProperty(LYR.upcomingCasing, 'visibility', proj.showUpcomingRoute ? 'visible' : 'none');
    // leg badges: the transport at the start of every leg (edit mode only)
    const bsrc = map.getSource(SRC.badges) as GeoJSONSource | undefined;
    if (bsrc) {
      const editing = editToolRef.current !== 'select';
      bsrc.setData({
        type: 'FeatureCollection',
        features: editing
          ? proj.segments
              .filter((sg) => sg.coordinates.length >= 1)
              .map((sg, i) => ({ type: 'Feature', properties: { img: `badge:${sg.transportMode}:${sg.color}`, idx: i, active: i === activeSegRef.current ? 1 : 0 }, geometry: { type: 'Point', coordinates: sg.coordinates[0] } }))
          : [],
      });
    }
  };

  const syncEditLayers = (map: maplibregl.Map, proj: RouteProject) => {
    const vsrc = map.getSource(SRC.vertices) as GeoJSONSource | undefined;
    const csrc = map.getSource(SRC.controlLine) as GeoJSONSource | undefined;
    if (!vsrc || !csrc) return;
    const tool = editToolRef.current;
    const seg = proj.segments[activeSegRef.current];
    if (tool === 'select' || !seg) {
      vsrc.setData(emptyFC());
      csrc.setData(emptyFC());
      return;
    }
    const sp = selectedPointRef.current;
    vsrc.setData({
      type: 'FeatureCollection',
      features: seg.points.map((p, i) => ({
        type: 'Feature',
        properties: { segIdx: activeSegRef.current, idx: i, color: seg.color, isEnd: i === seg.points.length - 1 ? 1 : 0, selected: sp && sp.segIdx === activeSegRef.current && sp.idx === i ? 1 : 0 },
        geometry: { type: 'Point', coordinates: p },
      })),
    });
    csrc.setData(
      seg.points.length >= 2 && seg.routing !== 'straight'
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: seg.points } }] }
        : emptyFC(),
    );
  };

  const applyTerrain = (map: maplibregl.Map, proj: RouteProject) => {
    if (!map.getSource(DEM_SOURCE_ID)) return;
    const theme = themeInfo(proj.mapTheme);
    try {
      if (proj.terrain3D) map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: proj.terrainExaggeration });
      else map.setTerrain(null);
    } catch (e) {
      console.warn('terrain', e);
    }
    const showHill = proj.hillshade && (proj.terrain3D || theme.kind === 'vector');
    if (!map.getLayer(LYR.hillshade)) {
      map.addLayer(
        {
          id: LYR.hillshade,
          type: 'hillshade',
          source: DEM_SOURCE_ID,
          layout: { visibility: showHill ? 'visible' : 'none' },
          paint: {
            'hillshade-exaggeration': theme.kind === 'vector' ? 0.28 : 0.45,
            'hillshade-shadow-color': theme.hillshadeShadow,
            'hillshade-highlight-color': theme.hillshadeHighlight,
            'hillshade-accent-color': theme.hillshadeAccent,
            'hillshade-illumination-direction': 335,
          },
        },
        LYR.upcomingCasing,
      );
    } else {
      map.setLayoutProperty(LYR.hillshade, 'visibility', showHill ? 'visible' : 'none');
      map.setPaintProperty(LYR.hillshade, 'hillshade-shadow-color', theme.hillshadeShadow);
      map.setPaintProperty(LYR.hillshade, 'hillshade-highlight-color', theme.hillshadeHighlight);
      map.setPaintProperty(LYR.hillshade, 'hillshade-accent-color', theme.hillshadeAccent);
      map.setPaintProperty(LYR.hillshade, 'hillshade-exaggeration', theme.kind === 'vector' ? 0.28 : 0.45);
    }
    try {
      if (proj.terrain3D && theme.kind === 'raster') {
        map.setSky({ 'sky-color': theme.dark ? '#0b1d33' : '#9fd0ff', 'horizon-color': theme.dark ? '#1f3550' : '#e2f0ff', 'fog-color': theme.dark ? '#0f1b2d' : '#dfe9f3', 'atmosphere-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.8 });
      } else {
        map.setSky({ 'atmosphere-blend': 0 });
      }
    } catch {
      /* older styles */
    }
  };

  const applyLabels = (map: maplibregl.Map, proj: RouteProject) => {
    for (const id of baseLabelLayersRef.current) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', proj.showMapLabels ? 'visible' : 'none');
    }
  };

  // ------------------------------------------------------------- overlay layers
  const addOverlayLayers = (map: maplibregl.Map, style: StyleSpecification, proj: RouteProject) => {
    const theme = themeInfo(proj.mapTheme);
    const beforeLabels = firstSymbolLayerId(style);
    const darkCasing = theme.dark;
    const casingColor = darkCasing ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.95)';

    sentRef.current = { doneKey: '', markers: '', headEmpty: false, trailEmpty: false, overlayDirty: true };
    map.addSource(SRC.upcoming, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.traveled, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.current, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.head, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.markers, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.vertices, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.controlLine, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.badges, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.trail, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.shadow, { type: 'geojson', data: emptyFC() });

    // Planned (not yet travelled) route: faint dashed
    map.addLayer(
      {
        id: LYR.upcomingCasing,
        type: 'line',
        source: SRC.upcoming,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': casingColor, 'line-width': ['+', ['*', ['get', 'width'], proj.lineScale], 3], 'line-opacity': 0.35 },
      },
      beforeLabels,
    );
    map.addLayer(
      {
        id: LYR.upcoming,
        type: 'line',
        source: SRC.upcoming,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['*', ['get', 'width'], 0.55 * proj.lineScale], 'line-opacity': 0.5, 'line-dasharray': [0.2, 2.4] },
      },
      beforeLabels,
    );

    // Travelled route: finished legs (updated only when a leg completes) and the current leg (every
    // frame), drawn as glow, casing and core layers interleaved so the joint between them is seamless.
    const travelledLayers: [string, string, string][] = [
      [LYR.traveledGlow, LYR.traveledCasing, LYR.traveled],
      [LYR.currentGlow, LYR.currentCasing, LYR.current],
    ];
    const travelledSources = [SRC.traveled, SRC.current];
    for (let i = 0; i < 2; i++) {
      map.addLayer(
        {
          id: travelledLayers[i][0],
          type: 'line',
          source: travelledSources[i],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': ['*', ['get', 'width'], 3.2 * proj.lineScale], 'line-opacity': ['case', ['get', 'glow'], 0.28, 0], 'line-blur': 10 },
        },
        beforeLabels,
      );
    }
    for (let i = 0; i < 2; i++) {
      map.addLayer(
        {
          id: travelledLayers[i][1],
          type: 'line',
          source: travelledSources[i],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': casingColor, 'line-width': ['+', ['*', ['get', 'width'], proj.lineScale], 4], 'line-opacity': 0.9 },
        },
        beforeLabels,
      );
    }
    for (let i = 0; i < 2; i++) {
      map.addLayer(
        {
          id: travelledLayers[i][2],
          type: 'line',
          source: travelledSources[i],
          layout: { 'line-cap': ['case', ['==', ['get', 'style'], 'solid'], 'round', 'butt'], 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['*', ['get', 'width'], proj.lineScale],
            'line-dasharray': ['case', ['==', ['get', 'style'], 'dashed'], ['literal', [2, 1.6]], ['==', ['get', 'style'], 'dots'], ['literal', [0.1, 1.9]], ['literal', [1, 0]]],
          },
        },
        beforeLabels,
      );
    }

    // Motion trails: contrail / wake lines and smoke / dust / foam puffs
    map.addLayer({
      id: LYR.trailLine,
      type: 'line',
      source: SRC.trail,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'], 'line-blur': ['get', 'blur'] },
    });
    map.addLayer({
      id: LYR.trailPuff,
      type: 'circle',
      source: SRC.trail,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius'], 'circle-opacity': ['get', 'opacity'], 'circle-blur': 0.7, 'circle-pitch-alignment': 'map' },
    });
    map.addLayer({
      id: LYR.vehicleShadow,
      type: 'symbol',
      source: SRC.shadow,
      layout: { 'icon-image': 'ground-shadow', 'icon-size': ['get', 'size'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'map' },
      paint: { 'icon-opacity': ['get', 'opacity'] },
    });

    // Head beacon
    map.addLayer({
      id: LYR.headGlow,
      type: 'symbol',
      source: SRC.head,
      layout: { 'icon-image': ['get', 'glow'], 'icon-size': ['get', 'glowSize'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: { 'icon-opacity': 0.9 },
    });
    map.addLayer({
      id: LYR.headRing,
      type: 'circle',
      source: SRC.head,
      paint: { 'circle-radius': ['get', 'ring'], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'ringOpacity'], 'circle-pitch-alignment': 'map' },
    });
    map.addLayer({
      id: LYR.headDot,
      type: 'circle',
      source: SRC.head,
      paint: { 'circle-radius': 5.5, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' },
    });


    // 3D vehicle
    addThreeLayer(map);

    // Markers (always above everything)
    map.addLayer({
      id: LYR.markers,
      type: 'symbol',
      source: SRC.markers,
      layout: {
        'icon-image': ['get', 'img'],
        'icon-anchor': ['get', 'anchor'],
        'icon-size': ['*', ['get', 'pop'], proj.markerScale],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'viewport',
        'text-field': ['case', ['==', ['get', 'label'], 1], ['format', ['get', 'title'], {}, ['case', ['==', ['get', 'subtitle'], ''], '', '\n'], {}, ['get', 'subtitle'], { 'font-scale': 0.82, 'text-font': ['literal', ['Noto Sans Regular']] }], ''],
        'text-font': ['Noto Sans Bold'],
        'text-size': 13 * proj.markerScale,
        'text-anchor': ['get', 'textAnchor'],
        'text-offset': ['get', 'textOffset'],
        'text-justify': 'left',
        'text-max-width': 14,
        'text-line-height': 1.25,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-pitch-alignment': 'viewport',
        'text-optional': true,
        'symbol-sort-key': ['-', 0, ['get', 'selected']],
      },
      paint: {
        'text-color': theme.dark ? '#ffffff' : '#0f172a',
        'text-halo-color': theme.dark ? 'rgba(2,6,23,0.85)' : 'rgba(255,255,255,0.9)',
        'text-halo-width': 1.6,
        'text-halo-blur': 0.4,
        'text-opacity': ['min', 1, ['*', ['get', 'pop'], 1.5]],
        'icon-opacity': ['min', 1, ['*', ['get', 'pop'], 2]],
      },
    });

    // Edit handles
    map.addLayer({
      id: LYR.controlLine,
      type: 'line',
      source: SRC.controlLine,
      paint: { 'line-color': theme.dark ? '#ffffff' : '#0f172a', 'line-width': 1, 'line-opacity': 0.35, 'line-dasharray': [2, 2] },
    });
    map.addLayer({
      id: LYR.verticesHalo,
      type: 'circle',
      source: SRC.vertices,
      paint: { 'circle-radius': 11, 'circle-color': ['get', 'color'], 'circle-opacity': 0.25, 'circle-pitch-alignment': 'map' },
    });
    map.addLayer({
      id: LYR.vertices,
      type: 'circle',
      source: SRC.vertices,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 8, ['==', ['get', 'isEnd'], 1], 7, 5.5],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#f59e0b', '#ffffff'],
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', ['get', 'color']],
        'circle-stroke-width': 2.5,
        'circle-pitch-alignment': 'map',
      },
    });
    map.addLayer({
      id: LYR.badges,
      type: 'symbol',
      source: SRC.badges,
      layout: { 'icon-image': ['get', 'img'], 'icon-size': ['case', ['==', ['get', 'active'], 1], 1, 0.85], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport', 'icon-offset': [0, -22] },
      paint: { 'icon-opacity': ['case', ['==', ['get', 'active'], 1], 1, 0.75] },
    });
  };

  const addThreeLayer = (map: maplibregl.Map) => {
    const layer: maplibregl.CustomLayerInterface = {
      id: LYR.three,
      type: 'custom',
      renderingMode: '3d',
      onAdd: (_m: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) => {
        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        const sun = new THREE.DirectionalLight(0xffffff, 3.2);
        sun.position.set(-60, 140, 90);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0xdbeafe, 1.2);
        fill.position.set(80, 40, -60);
        scene.add(fill);
        scene.add(new THREE.AmbientLight(0xffffff, 1.6));
        scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 1.0));
        const renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        renderer.autoClear = false;
        // flat symbol: a unit quad lying on the map, textured with the vehicle sprite
        const spriteScene = new THREE.Scene();
        const spriteMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
        );
        spriteMesh.frustumCulled = false;
        spriteScene.add(spriteMesh);
        threeRef.current = { scene, camera, renderer, spriteScene, spriteMesh };
        // re-attach vehicle after a style switch
        vehicleModeRef.current = null;
        syncVehicleModel(projectRef.current, timeRef.current);
      },
      onRemove: () => {
        if (vehicleRef.current && threeRef.current) threeRef.current.scene.remove(vehicleRef.current.group);
        threeRef.current = null;
      },
      render: (_gl: WebGLRenderingContext | WebGL2RenderingContext, args: unknown) => {
        const three = threeRef.current;
        const tf = vehicleTfRef.current;
        const sp = spriteTfRef.current;
        if (!three || (!tf.visible && !sp.visible)) return;
        const a = args as { modelViewProjectionMatrix?: ArrayLike<number>; defaultProjectionData?: { mainMatrix: ArrayLike<number> } };
        const mvp = a.defaultProjectionData?.mainMatrix ?? a.modelViewProjectionMatrix;
        if (!mvp) return;
        const viewProj = new THREE.Matrix4().fromArray(Array.from(mvp));
        three.renderer.resetState();
        if (sp.visible) {
          const tex = spriteTexRef.current.get(sp.key);
          if (tex) {
            const mat = three.spriteMesh.material as THREE.MeshBasicMaterial;
            if (mat.map !== tex) {
              mat.map = tex;
              mat.needsUpdate = true;
            }
            const coord = maplibregl.MercatorCoordinate.fromLngLat([sp.lng, sp.lat], sp.alt);
            const s = coord.meterInMercatorCoordinateUnits() * sp.sizeM;
            const l = new THREE.Matrix4()
              .makeTranslation(coord.x, coord.y, coord.z)
              .scale(new THREE.Vector3(s, -s, s))
              .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(-sp.bearing)));
            three.camera.projectionMatrix = viewProj.clone().multiply(l);
            three.renderer.render(three.spriteScene, three.camera);
          }
        }
        if (tf.visible) {
          const coord = maplibregl.MercatorCoordinate.fromLngLat([tf.lng, tf.lat], tf.alt);
          const s = coord.meterInMercatorCoordinateUnits() * tf.scale;
          const theta = THREE.MathUtils.degToRad(180 - tf.bearing);
          const l = new THREE.Matrix4()
            .makeTranslation(coord.x, coord.y, coord.z)
            .scale(new THREE.Vector3(s, -s, s))
            .multiply(new THREE.Matrix4().makeRotationZ(theta))
            .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
            .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-tf.pitch)))
            .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(tf.roll)));
          three.camera.projectionMatrix = viewProj.multiply(l);
          three.renderer.render(three.scene, three.camera);
        }
      },
    };
    map.addLayer(layer);
  };

  const spriteTexture = (mode: TransportMode, color: string): string => {
    const key = `${mode}:${color}`;
    if (!spriteTexRef.current.has(key)) {
      const icon = renderVehicleSprite(mode, color);
      const canvas = document.createElement('canvas');
      canvas.width = icon.width;
      canvas.height = icon.height;
      canvas.getContext('2d')!.putImageData(icon.data, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      spriteTexRef.current.set(key, tex);
    }
    return key;
  };

  const syncVehicleModel = (proj: RouteProject, time: number) => {
    const three = threeRef.current;
    if (!three) return;
    const tel = interpolateRouteState(proj, modelRef.current, time);
    const seg = proj.segments[tel.currentSegmentIndex] || proj.segments[0];
    const mode = seg?.transportMode || 'sports_car';
    if (vehicleModeRef.current !== mode || !vehicleRef.current) {
      if (vehicleRef.current) {
        three.scene.remove(vehicleRef.current.group);
        vehicleRef.current.dispose();
      }
      const inst = create3DVehicle(mode);
      // The procedural models use shiny PBR materials; without an environment map those render almost black.
      inst.group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) {
            std.metalness = Math.min(std.metalness, 0.15);
            std.roughness = Math.max(std.roughness, 0.55);
          }
        }
      });
      three.scene.add(inst.group);
      const box = new THREE.Box3().setFromObject(inst.group);
      const size = new THREE.Vector3();
      box.getSize(size);
      vehicleLengthRef.current = Math.max(1, Math.max(size.x, size.z));
      vehicleRef.current = inst;
      vehicleModeRef.current = mode;
    }
  };

  // ------------------------------------------------------------ per-frame
  const renderFrame = (time: number): VehicleTelemetry => {
    const map = mapRef.current;
    const proj = projectRef.current;
    const mdl = modelRef.current;
    const tel = interpolateRouteState(proj, mdl, time);
    timeRef.current = time;
    if (!map || !styleReadyRef.current) return tel;

    const theme = themeInfo(proj.mapTheme);
    const vp = { width: map.getContainer().clientWidth || 1280, height: map.getContainer().clientHeight || 720 };
    const locked = cameraLockedRef.current;
    let zoom = map.getZoom();
    let pose: ReturnType<typeof computeCameraPose> | null = null;
    if (locked) {
      pose = computeCameraPose(proj, mdl, time, vp);
      zoom = pose.zoom;
    }
    const segNow = proj.segments[tel.currentSegmentIndex];
    // end the line at the back of the symbol instead of running through it
    let km = tel.distanceKm;
    if (proj.vehicleStyle === 'icon' && segNow && tel.phase !== 'intro') {
      const trimPx = SPRITE_LENGTH_PX[segNow.transportMode] * 0.3 * proj.vehicleScale;
      const trimKm = (metersPerPixel(tel.lat, zoom) * trimPx) / 1000;
      km = Math.max(0, km - trimKm);
    }

    // travelled geometry: finished legs only when that set changes, the current leg every frame
    const doneSrc = map.getSource(SRC.traveled) as GeoJSONSource | undefined;
    const curSrc = map.getSource(SRC.current) as GeoJSONSource | undefined;
    if (doneSrc && curSrc) {
      const legFeature = (sm: (typeof mdl.segments)[number], coords: [number, number][]): GeoJSON.Feature => {
        const sg = proj.segments[sm.index];
        return { type: 'Feature', properties: { color: sg.color, width: sg.lineWidth, style: sg.lineStyle, glow: sg.glow }, geometry: { type: 'LineString', coordinates: coords } };
      };
      const done: GeoJSON.Feature[] = [];
      let current: GeoJSON.Feature | null = null;
      for (const sm of mdl.segments) {
        if (sm.coords.length < 2 || sm.lengthKm <= 0) continue;
        const local = km - sm.startKm;
        if (local <= 0) break;
        if (local >= sm.lengthKm) {
          done.push(legFeature(sm, sm.coords));
          continue;
        }
        let lo = 0;
        let hi = sm.cum.length - 1;
        while (lo < hi - 1) {
          const mid = (lo + hi) >> 1;
          if (sm.cum[mid] <= local) lo = mid;
          else hi = mid;
        }
        const a = sm.coords[lo];
        const b = sm.coords[hi];
        const span = sm.cum[hi] - sm.cum[lo];
        const f = span > 0 ? (local - sm.cum[lo]) / span : 0;
        const coords = sm.coords.slice(0, lo + 1);
        coords.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
        current = legFeature(sm, coords);
        break;
      }
      const doneKey = `${done.length}`;
      if (doneKey !== sentRef.current.doneKey) {
        sentRef.current.doneKey = doneKey;
        doneSrc.setData({ type: 'FeatureCollection', features: done });
      }
      curSrc.setData({ type: 'FeatureCollection', features: current ? [current] : [] });
    }

    // camera
    if (pose) map.jumpTo({ center: pose.center, zoom: pose.zoom, pitch: pose.pitch, bearing: pose.bearing });

    // head beacon
    const head = map.getSource(SRC.head) as GeoJSONSource | undefined;
    const seg = proj.segments[tel.currentSegmentIndex];
    const color = seg?.color || theme.accent;
    // Heading from the vehicle's own length on the road (rear to front, like its axles), measured at
    // the current zoom, so it follows bends exactly and ignores wiggles shorter than the vehicle.
    let heading = tel.bearing;
    if (seg && mdl.totalKm > 0) {
      const lengthPx = (proj.vehicleStyle === '3d' ? VEHICLE_PX[seg.transportMode] : SPRITE_LENGTH_PX[seg.transportMode] * 0.9) * proj.vehicleScale;
      const halfKm = (metersPerPixel(tel.lat, zoom) * lengthPx * 0.5) / 1000;
      const rear = sampleAtDistance(mdl, tel.distanceKm - halfKm);
      const front = sampleAtDistance(mdl, tel.distanceKm + halfKm);
      if (Math.abs(front.lng - rear.lng) + Math.abs(front.lat - rear.lat) > 1e-9) heading = bearingBetween(rear, front);
    }
    const moving = tel.phase === 'travel' || tel.phase === 'dwell' || tel.phase === 'done';
    const headVisible = proj.showHeadBeacon && mdl.totalKm > 0;
    if (head && (headVisible || !sentRef.current.headEmpty)) {
      sentRef.current.headEmpty = !headVisible;
      const pulse = (Math.sin(time * 4.2) + 1) / 2;
      head.setData(
        proj.showHeadBeacon && mdl.totalKm > 0
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: { color, glow: `glow:${theme.accent}`, glowSize: 0.55 + pulse * 0.25, ring: 9 + pulse * 7, ringOpacity: 0.35 - pulse * 0.25 },
                  geometry: { type: 'Point', coordinates: [tel.lng, tel.lat] },
                },
              ],
            }
          : emptyFC(),
      );
    }

    // motion trail behind the symbol
    const trailSrc = map.getSource(SRC.trail) as GeoJSONSource | undefined;
    const shadowSrc = map.getSource(SRC.shadow) as GeoJSONSource | undefined;
    if (trailSrc && shadowSrc) {
      const feats: GeoJSON.Feature[] = [];
      const shadowFeats: GeoJSON.Feature[] = [];
      const show = proj.showTrail && proj.vehicleStyle !== 'none' && seg && tel.phase === 'travel' && mdl.totalKm > 0;
      if (show && seg) {
        const mode = seg.transportMode;
        const mpp = metersPerPixel(tel.lat, zoom);
        const pxKm = (px: number) => (mpp * px) / 1000; // px → km at this zoom
        const headKm = tel.distanceKm;
        const behind = (px: number) => sampleAtDistance(mdl, Math.max(0, headKm - pxKm(px)));
        const flying = FLYING_MODES.includes(mode);
        const water = WATER_MODES.includes(mode);
        const sizeF = proj.vehicleScale;
        if (flying && (mode === 'airplane' || mode === 'propeller')) {
          // contrail: fading white line, starts a little behind the tail
          const steps = 6;
          const len = 110 * sizeF;
          for (let i = 0; i < steps; i++) {
            const a = behind(26 * sizeF + (len * i) / steps);
            const b = behind(26 * sizeF + (len * (i + 1)) / steps);
            feats.push({ type: 'Feature', properties: { color: '#ffffff', width: 3.2 * sizeF * (1 - i / steps) + 0.8, opacity: 0.85 * (1 - i / steps), blur: 1.5 + i }, geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } });
          }
        } else if (water) {
          // wake: two diverging foam lines + a few foam dots
          const rad = ((heading + 180) * Math.PI) / 180; // pointing backwards
          const perp = rad + Math.PI / 2;
          const degPerPx = (mpp / 111320) ; // approx deg lat per px
          const cosLat = Math.cos((tel.lat * Math.PI) / 180);
          for (const side of [-1, 1]) {
            const coords: [number, number][] = [];
            for (let i = 0; i <= 5; i++) {
              const back = (22 + i * 16) * sizeF;
              const spread = side * i * 4.2 * sizeF;
              const dx = Math.sin(rad) * back + Math.sin(perp) * spread;
              const dy = Math.cos(rad) * back + Math.cos(perp) * spread;
              coords.push([tel.lng + (dx * degPerPx) / cosLat, tel.lat + dy * degPerPx]);
            }
            feats.push({ type: 'Feature', properties: { color: '#ffffff', width: 2.2 * sizeF, opacity: 0.7, blur: 1 }, geometry: { type: 'LineString', coordinates: coords } });
          }
          for (let i = 0; i < 5; i++) {
            const a = behind((20 + i * 14) * sizeF);
            feats.push({ type: 'Feature', properties: { color: '#ffffff', radius: (5 - i * 0.6) * sizeF, opacity: 0.45 * (1 - i / 6) }, geometry: { type: 'Point', coordinates: [a.lng, a.lat] } });
          }
        } else if (mode === 'steam_train') {
          for (let i = 0; i < 7; i++) {
            const a = behind((-6 + i * 11) * sizeF);
            const puff = (Math.sin(time * 9 + i * 1.7) + 1) / 2;
            feats.push({ type: 'Feature', properties: { color: theme.dark ? '#cbd5e1' : '#64748b', radius: (3 + i * 1.6 + puff) * sizeF, opacity: 0.5 * (1 - i / 7) }, geometry: { type: 'Point', coordinates: [a.lng, a.lat] } });
          }
        } else if (mode === 'sports_car' || mode === 'suv' || mode === 'camper' || mode === 'motorcycle' || mode === 'bicycle') {
          for (let i = 0; i < 5; i++) {
            const a = behind((18 + i * 9) * sizeF);
            feats.push({ type: 'Feature', properties: { color: theme.dark ? '#94a3b8' : '#a8a29e', radius: (2 + i * 1.1) * sizeF, opacity: 0.35 * (1 - i / 5) }, geometry: { type: 'Point', coordinates: [a.lng, a.lat] } });
          }
        } else if (mode === 'hiker') {
          for (let i = 1; i <= 4; i++) {
            const a = behind((14 + i * 10) * sizeF);
            feats.push({ type: 'Feature', properties: { color: theme.dark ? '#e2e8f0' : '#475569', radius: 1.8 * sizeF, opacity: 0.5 * (1 - i / 5) }, geometry: { type: 'Point', coordinates: [a.lng, a.lat] } });
          }
        }
        if (flying) {
          // ground shadow offset "south-west" of the symbol, bigger and fainter when higher
          const alt = Math.min(1, (tel.altitudeMeters || 0) / 9000);
          const degPerPx = mpp / 111320;
          const cosLat = Math.cos((tel.lat * Math.PI) / 180);
          const off = (8 + alt * 22) * sizeF;
          shadowFeats.push({ type: 'Feature', properties: { size: (0.7 + alt * 0.9) * sizeF, opacity: 0.6 - alt * 0.35 }, geometry: { type: 'Point', coordinates: [tel.lng - (off * degPerPx) / cosLat, tel.lat - off * degPerPx] } });
        }
      }
      const empty = feats.length === 0 && shadowFeats.length === 0;
      if (!(empty && sentRef.current.trailEmpty)) {
        trailSrc.setData({ type: 'FeatureCollection', features: feats });
        shadowSrc.setData({ type: 'FeatureCollection', features: shadowFeats });
      }
      sentRef.current.trailEmpty = empty;
    }

    // vehicle
    if (proj.vehicleStyle === 'icon' && seg && mdl.totalKm > 0) {
      const ground = proj.terrain3D ? map.queryTerrainElevation([tel.lng, tel.lat]) || 0 : 0;
      spriteTfRef.current = {
        lng: tel.lng,
        lat: tel.lat,
        alt: ground,
        bearing: heading,
        sizeM: metersPerPixel(tel.lat, zoom) * 64 * 0.9 * proj.vehicleScale,
        key: spriteTexture(seg.transportMode, seg.color),
        visible: true,
      };
    } else {
      spriteTfRef.current.visible = false;
    }
    if (proj.vehicleStyle === '3d' && seg && mdl.totalKm > 0) {
      syncVehicleModel(proj, time);
      const ground = proj.terrain3D ? map.queryTerrainElevation([tel.lng, tel.lat]) || 0 : 0;
      const mpp = metersPerPixel(tel.lat, zoom);
      const px = VEHICLE_PX[seg.transportMode] * proj.vehicleScale;
      vehicleTfRef.current = {
        lng: tel.lng,
        lat: tel.lat,
        alt: tel.altitudeMeters + ground,
        bearing: heading,
        pitch: tel.pitch,
        roll: tel.roll,
        scale: (mpp * px) / vehicleLengthRef.current,
        visible: true,
      };
      const last = lastFrameTimeRef.current;
      const dt = last === null ? 1 / 60 : Math.max(0, Math.min(0.1, time - last));
      vehicleRef.current?.updateAnimation(dt, tel.speedKmh, tel.roll, moving && tel.phase === 'travel');
    } else {
      vehicleTfRef.current.visible = false;
    }
    lastFrameTimeRef.current = time;

    syncMarkerData(map, proj, tel);
    map.triggerRepaint();

    // overlay (story cards / HUD)
    const ov = overlayRef.current;
    const needsOverlay = (proj.showStoryCards && !!tel.activeWaypoint?.showCard) || (proj.showHud && tel.totalDistanceKm > 0);
    if (ov && (needsOverlay || sentRef.current.overlayDirty)) {
      const ctx = ov.getContext('2d');
      if (ctx) paintOverlay({ ctx, width: ov.width, height: ov.height, project: proj, telemetry: tel, accent: theme.accent, dark: theme.dark });
      sentRef.current.overlayDirty = needsOverlay;
    }
    return tel;
  };

  const sizeOverlay = () => {
    const ov = overlayRef.current;
    const map = mapRef.current;
    if (!ov || !map) return;
    const c = map.getCanvas();
    if (ov.width !== c.width || ov.height !== c.height) {
      ov.width = c.width;
      ov.height = c.height;
      sentRef.current.overlayDirty = true;
    }
  };

  const settle = (timeoutMs = 1500) =>
    new Promise<void>((resolve) => {
      const map = mapRef.current;
      if (!map) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        map.off('idle', finish);
        requestAnimationFrame(() => resolve());
      };
      const t = setTimeout(finish, timeoutMs);
      map.once('idle', () => {
        clearTimeout(t);
        finish();
      });
      map.triggerRepaint();
    });

  /** Camera poses that together cover every tile the video will show. */
  const precachePoses = (proj: RouteProject, mdl: RouteModel, vp: { width: number; height: number }): CameraPose[] => {
    const poses: CameraPose[] = [];
    const short = Math.min(vp.width, vp.height);
    const mercY = (lat: number) => {
      const sn = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
      return 0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI);
    };
    const moved = (a: CameraPose, b: CameraPose) => {
      const world = 512 * Math.pow(2, Math.max(a.zoom, b.zoom));
      const dx = ((b.center[0] - a.center[0]) / 360) * world;
      const dy = (mercY(b.center[1]) - mercY(a.center[1])) * world;
      const db = Math.abs(((b.bearing - a.bearing + 540) % 360) - 180);
      return Math.hypot(dx, dy) > short * 0.3 || Math.abs(b.zoom - a.zoom) > 0.35 || db > 15 || Math.abs(b.pitch - a.pitch) > 6;
    };
    let last: CameraPose | null = null;
    for (let t = 0; t <= mdl.totalSeconds + 1e-6; t += 0.1) {
      const p = computeCameraPose(proj, mdl, Math.min(t, mdl.totalSeconds), vp);
      if (!last || moved(last, p)) {
        poses.push(p);
        last = p;
      }
    }
    const end = computeCameraPose(proj, mdl, mdl.totalSeconds, vp);
    if (last && moved(last, end)) poses.push(end);
    return poses;
  };

  const precache = async ({ onProgress, signal, shouldPause }: PrecacheOptions) => {
    const main = mapRef.current;
    const proj = projectRef.current;
    const mdl = modelRef.current;
    if (!main || mdl.totalKm <= 0) return;
    const cont = main.getContainer();
    const vp = { width: cont.clientWidth || 1280, height: cont.clientHeight || 720 };
    const poses = precachePoses(proj, mdl, vp);
    if (!poses.length) return;
    onProgress?.(0, poses.length);
    const style = await loadThemeStyle(proj.mapTheme);
    if (signal?.aborted) return;

    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${vp.width}px`, height: `${vp.height}px`, pointerEvents: 'none' });
    document.body.appendChild(host);
    const first = poses[0];
    const twin = new maplibregl.Map({
      container: host,
      style,
      center: first.center,
      zoom: first.zoom,
      pitch: first.pitch,
      bearing: first.bearing,
      maxPitch: 80,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio: 1,
      cancelPendingTileRequestsWhileZooming: false,
    });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const waitIdle = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          twin.off('idle', done);
          resolve();
        }, ms);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        twin.once('idle', done);
        twin.triggerRepaint();
      });
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 15000);
        twin.once('load', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (signal?.aborted) return;
      if (proj.terrain3D) twin.setTerrain({ source: DEM_SOURCE_ID, exaggeration: proj.terrainExaggeration });
      else if (proj.hillshade && twin.getSource(DEM_SOURCE_ID)) twin.addLayer({ id: 'precache-hillshade', type: 'hillshade', source: DEM_SOURCE_ID });
      await waitIdle(4000);
      onProgress?.(1, poses.length);
      for (let i = 1; i < poses.length; i++) {
        while (shouldPause?.() && !signal?.aborted) await sleep(250);
        if (signal?.aborted) return;
        const p = poses[i];
        twin.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
        await waitIdle(3000);
        onProgress?.(i + 1, poses.length);
      }
    } finally {
      twin.remove();
      host.remove();
    }
  };

  const fitRoute = () => {
    const map = mapRef.current;
    const b = modelRef.current.bounds;
    if (!map || !b) return;
    const pad = Math.min(map.getContainer().clientWidth, map.getContainer().clientHeight) * 0.12;
    map.fitBounds([b[0], b[1], b[2], b[3]], { padding: pad, pitch: 0, bearing: 0, duration: 600, maxZoom: 16 });
  };

  // ----------------------------------------------------------------- init map
  useEffect(() => {
    if (!containerRef.current) return;
    const spriteTextures = spriteTexRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#111827' } }] },
      center: [10, 47],
      zoom: 4,
      pitch: 0,
      bearing: 0,
      maxPitch: 80,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
      fadeDuration: 0,
      maxTileCacheZoomLevels: 10,
      cancelPendingTileRequestsWhileZooming: false,
    });
    mapRef.current = map;

    map.on('styleimagemissing', (e: { id: string }) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    // ---- interaction
    const hitLayers = () => [LYR.markers, LYR.vertices].filter((l) => map.getLayer(l));
    type Hit = maplibregl.MapGeoJSONFeature;
    map.on('click', (e: MapMouseEvent) => {
      if (!styleReadyRef.current) return;
      const tool = editToolRef.current;
      const p = propsRef.current;
      const hits = map.queryRenderedFeatures(e.point, { layers: hitLayers() });
      const marker = hits.find((h: Hit) => h.layer.id === LYR.markers);
      if (marker) {
        p.onSelectWaypoint(String(marker.properties?.id));
        return;
      }
      if (hits.some((h: Hit) => h.layer.id === LYR.vertices)) return;
      if (tool === 'draw') p.onAddPoint(e.lngLat.lng, e.lngLat.lat);
      else if (tool === 'marker') p.onAddWaypoint(e.lngLat.lng, e.lngLat.lat);
      else p.onSelectWaypoint(null);
    });
    map.on('contextmenu', (e: MapMouseEvent) => {
      if (!styleReadyRef.current || editToolRef.current !== 'draw') return;
      const hits = map.queryRenderedFeatures(e.point, { layers: [LYR.vertices].filter((l) => map.getLayer(l)) });
      if (hits[0]) {
        e.preventDefault();
        propsRef.current.onDeletePoint(Number(hits[0].properties?.segIdx), Number(hits[0].properties?.idx));
      }
    });
    map.on('mousedown', (e: MapMouseEvent) => {
      if (!styleReadyRef.current || e.originalEvent.button !== 0) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: hitLayers() });
      const v = hits.find((h: Hit) => h.layer.id === LYR.vertices);
      const m = hits.find((h: Hit) => h.layer.id === LYR.markers);
      if (v) dragRef.current = { kind: 'vertex', segIdx: Number(v.properties?.segIdx), idx: Number(v.properties?.idx), startX: e.point.x, startY: e.point.y, moved: false };
      else if (m && editToolRef.current !== 'draw') dragRef.current = { kind: 'marker', id: String(m.properties?.id), startX: e.point.x, startY: e.point.y, moved: false };
      else return;
      e.preventDefault();
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    });
    map.on('mousemove', (e: MapMouseEvent) => {
      const d = dragRef.current;
      if (!d) {
        if (!styleReadyRef.current) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: hitLayers() });
        const tool = editToolRef.current;
        map.getCanvas().style.cursor = hits.length ? 'grab' : tool === 'select' ? '' : 'crosshair';
        return;
      }
      if (!d.moved && Math.hypot(e.point.x - d.startX, e.point.y - d.startY) < 4) return;
      d.moved = true;
      if (d.kind === 'vertex') {
        // live preview of the handle
        const src = map.getSource(SRC.vertices) as GeoJSONSource | undefined;
        const seg = projectRef.current.segments[d.segIdx];
        if (src && seg) {
          const pts = seg.points.map((p, i) => (i === d.idx ? ([e.lngLat.lng, e.lngLat.lat] as [number, number]) : p));
          src.setData({ type: 'FeatureCollection', features: pts.map((p, i) => ({ type: 'Feature', properties: { segIdx: d.segIdx, idx: i, color: seg.color, isEnd: i === pts.length - 1 ? 1 : 0 }, geometry: { type: 'Point', coordinates: p } })) });
        }
      } else {
        const src = map.getSource(SRC.markers) as GeoJSONSource | undefined;
        const data = (src as unknown as { _data?: GeoJSON.FeatureCollection })?._data;
        if (src && data && data.type === 'FeatureCollection') {
          src.setData({ ...data, features: data.features.map((f) => (f.properties?.id === d.id ? { ...f, geometry: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] } } : f)) });
        }
      }
    });
    const endDrag = (e: MapMouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
      if (!d.moved) {
        if (d.kind === 'vertex') propsRef.current.onSelectPoint(d.segIdx, d.idx);
        return;
      }
      if (d.kind === 'vertex') propsRef.current.onMovePoint(d.segIdx, d.idx, e.lngLat.lng, e.lngLat.lat);
      else propsRef.current.onMoveWaypoint(d.id, e.lngLat.lng, e.lngLat.lat);
    };
    map.on('mouseup', endDrag);
    map.on('mouseout', (e: MapMouseEvent) => dragRef.current && endDrag(e));

    const ro = new ResizeObserver(() => {
      map.resize();
      sizeOverlay();
      if (styleReadyRef.current) renderFrame(timeRef.current);
    });
    ro.observe(containerRef.current);

    onApiReady({
      renderFrame,
      settle,
      getMapCanvas: () => mapRef.current?.getCanvas() || null,
      getOverlayCanvas: () => overlayRef.current,
      setRenderScale: (scale: number) => {
        renderScaleRef.current = scale;
        const m = mapRef.current;
        if (!m) return;
        m.setPixelRatio(scale > 0 ? scale : window.devicePixelRatio || 1);
        m.resize();
        sizeOverlay();
      },
      fitRoute,
      precache,
      getView: () => {
        const m = mapRef.current;
        if (!m) return null;
        const c = m.getCenter();
        return { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
      },
      showView: (shot: CameraShot) => mapRef.current?.easeTo({ center: shot.center, zoom: shot.zoom, bearing: shot.bearing, pitch: shot.pitch, duration: 600 }),
      getViewport: () => ({ width: mapRef.current?.getContainer().clientWidth || 1280, height: mapRef.current?.getContainer().clientHeight || 720 }),
    });

    return () => {
      ro.disconnect();
      vehicleRef.current?.dispose();
      vehicleRef.current = null;
      spriteTextures.forEach((t) => t.dispose());
      spriteTextures.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------- theme switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const theme = project.mapTheme;
    styleReadyRef.current = false;
    loadThemeStyle(theme)
      .then((style) => {
        if (cancelled || !mapRef.current) return;
        baseLabelLayersRef.current = labelLayerIds(style);
        const onLoad = () => {
          if (cancelled || !mapRef.current) return;
          const m = mapRef.current;
          const proj = projectRef.current;
          imagesRef.current.clear();
          addOverlayLayers(m, style, proj);
          applyTerrain(m, proj);
          applyLabels(m, proj);
          syncMarkerImages(m, proj);
          syncUpcomingRoute(m, proj);
          syncEditLayers(m, proj);
          styleReadyRef.current = true;
          loadedThemeRef.current = theme;
          sizeOverlay();
          renderFrame(timeRef.current);
          if (editToolRef.current !== 'select' && !isPlayingRef.current && loadedThemeRef.current === null) fitRoute();
        };
        map.once('style.load', onLoad);
        map.setStyle(style, { diff: false });
      })
      .catch((err) => {
        console.error(err);
        propsRef.current.onStyleError?.(`Could not load the "${themeInfo(theme).label}" basemap. Check your internet connection.`);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.mapTheme]);

  // ------------------------------------------------------------- terrain/labels
  useEffect(() => {
    const map = getMap();
    if (!map) return;
    applyTerrain(map, project);
    renderFrame(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.terrain3D, project.terrainExaggeration, project.hillshade]);

  useEffect(() => {
    const map = getMap();
    if (!map) return;
    applyLabels(map, project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.showMapLabels]);

  // ------------------------------------------------------------- data changes
  useEffect(() => {
    preloadPhotos(project);
    const map = getMap();
    if (!map) return;
    syncMarkerImages(map, project);
    syncUpcomingRoute(map, project);
    syncEditLayers(map, project);
    if (map.getLayer(LYR.markers)) {
      map.setLayoutProperty(LYR.markers, 'icon-size', ['*', ['get', 'pop'], project.markerScale]);
      map.setLayoutProperty(LYR.markers, 'text-size', 13 * project.markerScale);
    }
    if (map.getLayer(LYR.traveled)) {
      const ls = project.lineScale || 1;
      for (const [glow, casing, core] of [[LYR.traveledGlow, LYR.traveledCasing, LYR.traveled], [LYR.currentGlow, LYR.currentCasing, LYR.current]]) {
        map.setPaintProperty(core, 'line-width', ['*', ['get', 'width'], ls]);
        map.setPaintProperty(casing, 'line-width', ['+', ['*', ['get', 'width'], ls], 4]);
        map.setPaintProperty(glow, 'line-width', ['*', ['get', 'width'], 3.2 * ls]);
      }
      map.setPaintProperty(LYR.upcoming, 'line-width', ['*', ['get', 'width'], 0.55 * ls]);
      map.setPaintProperty(LYR.upcomingCasing, 'line-width', ['+', ['*', ['get', 'width'], ls], 3]);
    }
    // build every leg's flat symbol now, not mid-playback when the leg starts
    for (const sg of project.segments) spriteTexture(sg.transportMode, sg.color);
    vehicleModeRef.current = null; // re-evaluate the model (transport mode may have changed)
    sentRef.current.doneKey = '';
    sentRef.current.markers = '';
    sentRef.current.overlayDirty = true;
    renderFrame(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.segments, project.waypoints, project.markerScale, project.showMarkerLabels, project.showUpcomingRoute, project.showHeadBeacon, project.vehicleStyle, project.vehicleScale, project.lineScale, project.showTrail, model]);

  // camera / overlay settings – just re-render the current frame
  useEffect(() => {
    if (!getMap()) return;
    renderFrame(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.camera, project.stillAtStart, project.stillAtEnd, project.showStoryCards, project.showHud, project.aspectRatio, selectedWaypointId]);

  // edit tool
  useEffect(() => {
    const map = getMap();
    if (!map) return;
    syncEditLayers(map, project);
    map.getCanvas().style.cursor = editTool === 'select' ? '' : 'crosshair';
    if (editTool === 'select') renderFrame(timeRef.current);
    else if (model.bounds && !isPlaying) {
      // give the user a calm, editable view
      map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTool, activeSegmentIndex]);

  useEffect(() => {
    if (cameraLocked && getMap()) renderFrame(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraLocked]);

  useEffect(() => {
    const map = getMap();
    if (!map) return;
    syncEditLayers(map, project);
    syncUpcomingRoute(map, project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoint, editTool]);

  // scrubbing while paused (playback drives renderFrame directly through the api)
  useEffect(() => {
    if (!isPlaying && getMap()) renderFrame(currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, isPlaying]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas ref={overlayRef} className="pointer-events-none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
};
