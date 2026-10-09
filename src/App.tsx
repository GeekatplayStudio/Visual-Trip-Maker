import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AspectRatio, CameraSettings, EditTool, ExportProgress, ResolutionPreset, RouteProject, RouteSegment, TransportMode, Waypoint } from './types';
import { DEFAULT_CAMERA, PRESET_PROJECTS, createEmptyProject, makeSegment, makeWaypoint, transportInfo, uid } from './services/presets';
import { buildRouteModel, defaultRoutingFor, fetchOSRMRoute, osrmProfileFor, rebuildSegment, snapToRoute, unwrapLng } from './services/geoUtils';
import { audioEngine } from './services/audioEngine';
import { exportVideo, getExportDimensions } from './services/videoExporter';
import { synthesizeSoundtrack } from './services/soundtrack';
import { themeInfo } from './services/mapStyles';
import { closeShot, followBaseZoom, overviewShot } from './services/cameraDirector';
import { Header } from './components/Header';
import { Sidebar, type SidebarTab } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { MapCanvas, type MapFrameApi } from './components/MapCanvas';
import { ExportModal } from './components/ExportModal';
import { HelpModal } from './components/HelpModal';
import { DrawToolbar, type SelectedPoint } from './components/DrawToolbar';

const STORAGE_KEY = 'visual-trip-maker:project:v1';

function loadSavedProject(): RouteProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RouteProject;
    if (!p || !Array.isArray(p.segments) || !Array.isArray(p.waypoints) || !p.camera) return null;
    const legacyTiers = JSON.stringify({ airplane: 'widest', propeller: 'wider', helicopter: 'wider', balloon: 'wider', hiker: 'closer', bicycle: 'closer' });
    const camera = { ...DEFAULT_CAMERA, ...p.camera };
    if (JSON.stringify(camera.zoomPerTransport) === legacyTiers) camera.zoomPerTransport = {};
    return { ...PRESET_PROJECTS.european_voyage, ...p, camera };
  } catch {
    return null;
  }
}

export const App: React.FC = () => {
  const [project, setProjectState] = useState<RouteProject>(() => loadSavedProject() || PRESET_PROJECTS.european_voyage);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editTool, setEditTool] = useState<EditTool>('select');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('route');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [routingBusy, setRoutingBusy] = useState<Set<string>>(new Set());
  const [exportProgress, setExportProgress] = useState<ExportProgress>({ isExporting: false, progressPercent: 0, currentFrame: 0, totalFrames: 0, statusText: '' });

  const apiRef = useRef<MapFrameApi | null>(null);
  const historyRef = useRef<RouteProject[]>([]);
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const [historyLen, setHistoryLen] = useState(0);
  const timeRef = useRef(0);
  const lastUiRef = useRef(0);
  const lastTelRef = useRef<ReturnType<MapFrameApi['renderFrame']> | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const model = useMemo(() => buildRouteModel(project), [project.segments, project.waypoints, project.durationSeconds, project.camera, project.stillAtStart, project.stillAtEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----------------------------------------------------------------- helpers
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  /** Update without undo history (settings, sliders). */
  const setProject = useCallback((updater: (prev: RouteProject) => RouteProject) => setProjectState(updater), []);

  /** Update with undo history (structural edits). */
  const commit = useCallback((updater: (prev: RouteProject) => RouteProject) => {
    setProjectState((prev) => {
      historyRef.current.push(prev);
      if (historyRef.current.length > 60) historyRef.current.shift();
      setHistoryLen(historyRef.current.length);
      return updater(prev);
    });
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    setHistoryLen(historyRef.current.length);
    if (prev) {
      setProjectState(prev);
      showToast('Undone');
    }
  }, [showToast]);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(model.totalSeconds, t));
    timeRef.current = clamped;
    setCurrentTime(clamped);
  }, [model.totalSeconds]);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      if (!p) {
        if (timeRef.current >= model.totalSeconds - 0.01) seek(0);
        setEditTool('select');
      }
      return !p;
    });
  }, [model.totalSeconds, seek]);

  // ------------------------------------------------------------- autosave
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      } catch {
        /* storage full / private mode */
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [project]);

  // keep time within the (possibly shorter) new timeline
  useEffect(() => {
    if (timeRef.current > model.totalSeconds) seek(model.totalSeconds);
  }, [model.totalSeconds, seek]);

  // ------------------------------------------------------------- playback
  useEffect(() => {
    if (!isPlaying) {
      audioEngine.stopEngineSound();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = projectRef.current;
      let t = timeRef.current + dt * p.playbackSpeed;
      let stop = false;
      if (t >= model.totalSeconds) {
        if (p.loop) t = 0;
        else {
          t = model.totalSeconds;
          stop = true;
        }
      }
      timeRef.current = t;
      // the map is drawn every frame; React (timeline text, panels) only ~10 times a second
      if (stop || now - lastUiRef.current > 100) {
        lastUiRef.current = now;
        setCurrentTime(t);
      }
      const tel = apiRef.current?.renderFrame(t);
      lastTelRef.current = tel ?? null;
      if (tel && p.soundEnabled) {
        const seg = p.segments[tel.currentSegmentIndex];
        if (seg) audioEngine.updateEngineSound(seg.transportMode, tel.phase === 'travel', tel.speedKmh);
      }
      if (stop) {
        setCurrentTime(t);
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, model]);

  useEffect(() => {
    audioEngine.setMute(!project.soundEnabled);
    audioEngine.setVolume(project.volume);
  }, [project.soundEnabled, project.volume]);

  // waypoint chime
  const lastCardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      const wp = lastTelRef.current?.activeWaypoint?.id || null;
      if (wp && wp !== lastCardRef.current && projectRef.current.soundEnabled) audioEngine.playWaypointChime();
      lastCardRef.current = wp;
    }, 120);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  // ------------------------------------------------------------- tile precache
  const [precacheState, setPrecacheState] = useState<{ status: 'idle' | 'running' | 'done'; done: number; total: number; key: string }>({ status: 'idle', done: 0, total: 0, key: '' });
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  const precacheAbortRef = useRef<AbortController | null>(null);
  const precacheKey = JSON.stringify([project.segments.map((s) => [s.id, s.coordinates.length, s.transportMode, s.speedKmh]), project.waypoints.map((w) => [w.lng, w.lat, w.dwellTime]), project.camera, project.durationSeconds, project.stillAtStart, project.stillAtEnd, project.mapTheme, project.terrain3D, project.terrainExaggeration, project.hillshade, project.aspectRatio]);

  const runPrecache = useCallback(async (key: string, shouldPause?: () => boolean) => {
    const api = apiRef.current;
    if (!api) return;
    precacheAbortRef.current?.abort();
    const abort = new AbortController();
    precacheAbortRef.current = abort;
    setPrecacheState({ status: 'running', done: 0, total: 0, key });
    try {
      await api.precache({
        signal: abort.signal,
        shouldPause,
        onProgress: (done, total) => {
          if (!abort.signal.aborted) setPrecacheState({ status: 'running', done, total, key });
        },
      });
      if (!abort.signal.aborted) setPrecacheState((p) => ({ ...p, status: 'done', key }));
    } catch (err) {
      console.warn('Precache failed', err);
      if (!abort.signal.aborted) setPrecacheState({ status: 'idle', done: 0, total: 0, key: '' });
    }
  }, []);

  // warm the cache in the background a moment after the trip stops changing (paused during playback)
  useEffect(() => {
    if (exportProgress.isExporting || model.totalKm <= 0) return;
    if (precacheState.key === precacheKey && precacheState.status !== 'idle') return;
    const id = window.setTimeout(() => runPrecache(precacheKey, () => isPlayingRef.current), 1500);
    return () => window.clearTimeout(id);
  }, [precacheKey, model.totalKm, exportProgress.isExporting, precacheState.key, precacheState.status, runPrecache]);

  useEffect(() => () => precacheAbortRef.current?.abort(), []);

  // ------------------------------------------------------------- road routing
  useEffect(() => {
    const pending = project.segments.filter((s) => s.routing === 'road' && !s.roadSnapped && s.points.length >= 2 && !routingBusy.has(s.id));
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      for (const seg of pending) {
        const pointsKey = JSON.stringify(seg.points);
        setRoutingBusy((b) => new Set(b).add(seg.id));
        fetchOSRMRoute(seg.points, osrmProfileFor(seg.transportMode))
          .then(({ coordinates, snapped }) => {
            setProjectState((prev) => {
              const idx = prev.segments.findIndex((s) => s.id === seg.id);
              if (idx < 0) return prev;
              const cur = prev.segments[idx];
              if (JSON.stringify(cur.points) !== pointsKey || cur.routing !== 'road') return prev; // edited meanwhile
              const segs = prev.segments.slice();
              segs[idx] = { ...rebuildSegment(cur, coordinates), roadSnapped: true };
              if (!snapped) showToast('Road routing unavailable, using a smooth curve for that leg.');
              return { ...prev, segments: segs };
            });
          })
          .finally(() => setRoutingBusy((b) => {
            const n = new Set(b);
            n.delete(seg.id);
            return n;
          }));
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [project.segments, routingBusy, showToast]);

  const deletePointRef = useRef<(segIdx: number, idx: number) => void>(() => {});
  const handleDeletePoint = useCallback((segIdx: number, idx: number) => deletePointRef.current(segIdx, idx), []);

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape') {
        if (selectedPoint) {
          setSelectedPoint(null);
          return;
        }
        setEditTool('select');
        setSelectedWaypointId(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPoint) {
        handleDeletePoint(selectedPoint.segIdx, selectedPoint.idx);
        setSelectedPoint(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWaypointId) {
        commit((p) => ({ ...p, waypoints: p.waypoints.filter((w) => w.id !== selectedWaypointId) }));
        setSelectedWaypointId(null);
      } else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(model.totalSeconds);
      else if (e.key === 'd' || e.key === 'D') setEditTool((t) => (t === 'draw' ? 'select' : 'draw'));
      else if (e.key === 'm' || e.key === 'M') setEditTool((t) => (t === 'marker' ? 'select' : 'marker'));
      else if (e.key === 'ArrowLeft') seek(timeRef.current - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'ArrowRight') seek(timeRef.current + (e.shiftKey ? 1 : 1 / 30));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, undo, commit, selectedWaypointId, selectedPoint, seek, model.totalSeconds, handleDeletePoint]);

  // ------------------------------------------------------------- editing
  const updateSegment = useCallback((idx: number, fn: (s: RouteSegment) => RouteSegment, withHistory = true) => {
    (withHistory ? commit : setProject)((p) => {
      if (!p.segments[idx]) return p;
      const segs = p.segments.slice();
      segs[idx] = fn(segs[idx]);
      return { ...p, segments: segs };
    });
  }, [commit, setProject]);

  const handleAddPoint = useCallback((lng: number, lat: number) => {
    updateSegment(activeSegmentIndex, (s) => {
      const prev = s.points[s.points.length - 1] || projectRef.current.segments[activeSegmentIndex - 1]?.points.slice(-1)[0];
      const l = prev ? unwrapLng(prev[0], lng) : lng;
      return rebuildSegment({ ...s, points: [...s.points, [l, lat]], roadSnapped: false });
    });
  }, [activeSegmentIndex, updateSegment]);

  const handleMovePoint = useCallback((segIdx: number, idx: number, lng: number, lat: number) => {
    updateSegment(segIdx, (s) => {
      const ref = s.points[idx - 1] || s.points[idx + 1] || s.points[idx];
      const l = ref ? unwrapLng(ref[0], lng) : lng;
      return rebuildSegment({ ...s, points: s.points.map((p, i) => (i === idx ? [l, lat] : p)), roadSnapped: false });
    });
  }, [updateSegment]);

  useEffect(() => {
    deletePointRef.current = (segIdx: number, idx: number) => {
      updateSegment(segIdx, (s) => rebuildSegment({ ...s, points: s.points.filter((_, i) => i !== idx), roadSnapped: false }));
      setSelectedPoint(null);
    };
  }, [updateSegment]);

  /** New leg from the last point of the current one, travelling by `mode`. */
  const handlePickTransport = useCallback((mode: TransportMode) => {
    const p = projectRef.current;
    const idx = activeSegmentIndex;
    const cur = p.segments[idx];
    if (!cur) return;
    if (cur.transportMode === mode) return;
    if (cur.points.length < 2) {
      // nothing drawn yet on this leg: just change it
      updateSegment(idx, (s) => rebuildSegment({ ...s, transportMode: mode, routing: defaultRoutingFor(mode), speedKmh: transportInfo(mode).speed, roadSnapped: false, altitudeMeters: mode === 'airplane' ? 9000 : mode === 'propeller' ? 2500 : 0 }));
      return;
    }
    const last = cur.points[cur.points.length - 1];
    const palette = ['#e63946', '#f4a261', '#2a9d8f', '#8b5cf6', '#38bdf8', '#ec4899', '#fbbf24'];
    commit((prev) => {
      const seg = makeSegment({ title: `${transportInfo(mode).label} leg`, transportMode: mode, points: [last], color: palette[(prev.segments.length + 1) % palette.length] });
      const segs = prev.segments.slice();
      segs.splice(idx + 1, 0, seg);
      return { ...prev, segments: segs };
    });
    setActiveSegmentIndex(idx + 1);
    setSelectedPoint(null);
    showToast(`New ${transportInfo(mode).label.toLowerCase()} leg starts here. Keep clicking to draw it.`);
  }, [activeSegmentIndex, commit, updateSegment, showToast]);

  /** Split a leg at a point; everything from that point on travels by `mode`. */
  const handleChangeTransportFrom = useCallback((segIdx: number, pointIdx: number, mode: TransportMode) => {
    commit((prev) => {
      const cur = prev.segments[segIdx];
      if (!cur) return prev;
      const segs = prev.segments.slice();
      if (pointIdx <= 0) {
        segs[segIdx] = rebuildSegment({ ...cur, transportMode: mode, routing: defaultRoutingFor(mode), speedKmh: transportInfo(mode).speed, roadSnapped: false });
        return { ...prev, segments: segs };
      }
      const head = rebuildSegment({ ...cur, points: cur.points.slice(0, pointIdx + 1), roadSnapped: false });
      const tail = makeSegment({ title: `${transportInfo(mode).label} leg`, transportMode: mode, points: cur.points.slice(pointIdx), color: cur.color === '#e63946' ? '#2a9d8f' : '#e63946' });
      segs.splice(segIdx, 1, head, tail);
      return { ...prev, segments: segs };
    });
    setActiveSegmentIndex(pointIdx <= 0 ? segIdx : segIdx + 1);
    setSelectedPoint(null);
    showToast(`From here the trip travels by ${transportInfo(mode).label.toLowerCase()}.`);
  }, [commit, showToast]);

  /** A silent pause: a dot marker without label or card. */
  const handlePauseAt = useCallback((segIdx: number, pointIdx: number, seconds: number) => {
    const p = projectRef.current;
    const pt = p.segments[segIdx]?.points[pointIdx];
    if (!pt) return;
    const wp = makeWaypoint({ title: 'Pause', lng: pt[0], lat: pt[1], dwellTime: seconds, revealMode: 'always', markerStyle: 'dot', icon: 'dot', color: themeInfo(p.mapTheme).accent, showCard: false });
    commit((prev) => ({ ...prev, waypoints: [...prev.waypoints, wp] }));
    setSelectedPoint(null);
    showToast(`The line pauses ${seconds}s here. Edit it under Markers.`);
  }, [commit, showToast]);

  const handleAddWaypoint = useCallback((lng: number, lat: number) => {
    const p = projectRef.current;
    const snap = snapToRoute(p, lng, lat);
    const near = snap && model.totalKm > 0 && snap.distKm < Math.max(0.3, model.totalKm * 0.03);
    const theme = themeInfo(p.mapTheme);
    const wp = makeWaypoint({
      title: `Stop ${p.waypoints.length + 1}`,
      lng: near ? snap!.lng : lng,
      lat: near ? snap!.lat : lat,
      color: theme.accent,
      dwellTime: 1.5,
    });
    commit((prev) => ({ ...prev, waypoints: [...prev.waypoints, wp] }));
    setSelectedWaypointId(wp.id);
    setSidebarTab('markers');
    if (!near && model.totalKm > 0) showToast('Marker placed off the route – it will trigger at the nearest point of the line.');
  }, [commit, model.totalKm, showToast]);

  const handleMoveWaypoint = useCallback((id: string, lng: number, lat: number) => {
    commit((p) => ({ ...p, waypoints: p.waypoints.map((w) => (w.id === id ? { ...w, lng, lat } : w)) }));
  }, [commit]);

  const handleSelectWaypoint = useCallback((id: string | null) => {
    setSelectedWaypointId(id);
    if (id) setSidebarTab('markers');
  }, []);

  const handleUpdateWaypoint = useCallback((id: string, patch: Partial<Waypoint>, withHistory = false) => {
    (withHistory ? commit : setProject)((p) => ({ ...p, waypoints: p.waypoints.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  }, [commit, setProject]);

  const handleAddSegment = useCallback(() => {
    commit((p) => {
      const last = p.segments[p.segments.length - 1];
      const lastPoint = last?.points[last.points.length - 1];
      const theme = themeInfo(p.mapTheme);
      const palette = ['#e63946', '#f4a261', '#2a9d8f', '#8b5cf6', '#38bdf8', '#ec4899'];
      const seg = makeSegment({
        title: `Leg ${p.segments.length + 1}`,
        transportMode: 'sports_car',
        points: lastPoint ? [lastPoint] : [],
        color: p.segments.length ? palette[p.segments.length % palette.length] : theme.routeColor,
      });
      return { ...p, segments: [...p.segments, seg] };
    });
    setActiveSegmentIndex(project.segments.length);
    setEditTool('draw');
    setSidebarTab('route');
  }, [commit, project.segments.length]);

  const handleDeleteSegment = useCallback((idx: number) => {
    commit((p) => (p.segments.length <= 1 ? { ...p, segments: [rebuildSegment({ ...p.segments[0], points: [], roadSnapped: false })] } : { ...p, segments: p.segments.filter((_, i) => i !== idx) }));
    setActiveSegmentIndex((i) => Math.max(0, Math.min(i, project.segments.length - 2)));
  }, [commit, project.segments.length]);

  const handleLoadProject = useCallback((p: RouteProject) => {
    historyRef.current = [];
    setHistoryLen(0);
    setIsPlaying(false);
    setEditTool('select');
    setSelectedWaypointId(null);
    setActiveSegmentIndex(0);
    setProjectState({ ...p, id: p.id || uid('project') });
    timeRef.current = 0;
    setCurrentTime(0);
  }, []);

  const handleNewProject = useCallback(() => {
    handleLoadProject(createEmptyProject());
    setEditTool('draw');
    setSidebarTab('route');
    showToast('Click on the map to draw your first leg.');
  }, [handleLoadProject, showToast]);

  const handleReverseRoute = useCallback(() => {
    commit((p) => ({
      ...p,
      segments: p.segments
        .slice()
        .reverse()
        .map((s) => ({ ...rebuildSegment({ ...s, points: s.points.slice().reverse() }, s.coordinates.slice().reverse()), roadSnapped: s.roadSnapped })),
    }));
    setActiveSegmentIndex(0);
    seek(0);
    showToast('Route reversed.');
  }, [commit, seek, showToast]);

  const handleSearchPlace = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      const data = (await res.json()) as { lat: string; lon: string; display_name: string; boundingbox?: string[] }[];
      const hit = data[0];
      if (!hit) {
        showToast(`Nothing found for “${q}”.`);
        return;
      }
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      let zoom = 10;
      if (hit.boundingbox) {
        const [s0, s1, w0, w1] = hit.boundingbox.map(Number);
        const span = Math.max(Math.abs(s1 - s0), Math.abs(w1 - w0));
        zoom = Math.max(4, Math.min(14, Math.log2(360 / Math.max(0.01, span)) - 0.5));
      }
      if (editTool === 'select') setEditTool('draw');
      apiRef.current?.showView({ center: [lng, lat], zoom, bearing: 0, pitch: 0 });
      showToast(hit.display_name.split(',').slice(0, 2).join(','));
    } catch {
      showToast('Place search is not reachable right now.');
    }
  }, [editTool, showToast]);

  // ------------------------------------------------------------- camera shots
  const updateCamera = useCallback((patch: Partial<CameraSettings>) => setProject((p) => ({ ...p, camera: { ...p.camera, ...patch } })), [setProject]);

  const captureShot = useCallback((which: 'startShot' | 'endShot' | 'fixedShot') => {
    const view = apiRef.current?.getView();
    if (!view) return;
    updateCamera({ [which]: view } as Partial<CameraSettings>);
    showToast(which === 'fixedShot' ? 'View saved.' : which === 'startShot' ? 'Start shot saved.' : 'End shot saved.');
  }, [updateCamera, showToast]);

  const showShot = useCallback((shot: CameraSettings['startShot']) => {
    if (shot) apiRef.current?.showView(shot);
  }, []);

  const quickMove = useCallback((kind: 'reveal' | 'finish' | 'pan') => {
    const api = apiRef.current;
    if (!api || model.totalKm <= 0) return;
    const vp = api.getViewport();
    const p = projectRef.current;
    const tilt = p.camera.tilt;
    const near = followBaseZoom(p, model, vp) + 1;
    const whole = overviewShot(model, vp, tilt);
    const first = closeShot(model, 0, near, tilt);
    const last = closeShot(model, model.totalKm, near, tilt);
    if (kind === 'reveal') updateCamera({ startShot: first, endShot: whole });
    else if (kind === 'finish') updateCamera({ startShot: whole, endShot: last });
    else updateCamera({ startShot: first, endShot: last });
    seek(0);
  }, [model, updateCamera, seek]);

  const useCurrentZoom = useCallback(() => {
    const view = apiRef.current?.getView();
    if (view) updateCamera({ zoom: Math.round(view.zoom * 10) / 10, zoomAuto: false });
  }, [updateCamera]);

  // ------------------------------------------------------------- export
  const handleStartExport = async (resolution: ResolutionPreset, fps: number, aspect: AspectRatio, withSound = false) => {
    const api = apiRef.current;
    if (!api) return;
    setIsPlaying(false);
    setEditTool('select');
    setSelectedWaypointId(null);
    setProject((p) => ({ ...p, aspectRatio: aspect }));
    const { width, height } = getExportDimensions(aspect, resolution);
    const abort = new AbortController();
    exportAbortRef.current = abort;
    setExportProgress({ isExporting: true, progressPercent: 0, currentFrame: 0, totalFrames: Math.round(model.totalSeconds * fps), statusText: 'Preparing the stage…' });
    try {
      // let the stage resize to the chosen aspect ratio
      await new Promise((r) => setTimeout(r, 400));
      const canvas = api.getMapCanvas();
      if (!canvas) throw new Error('Map is not ready yet.');
      const cssW = canvas.clientWidth || 1;
      api.setRenderScale(width / cssW);
      await new Promise((r) => setTimeout(r, 100));
      api.renderFrame(0);
      await api.settle(4000);
      // load every tile along the camera path first, so frames don't wait on the network one by one
      const exportKey = JSON.stringify([precacheKey, aspect]);
      if (!(precacheState.status === 'done' && precacheState.key === precacheKey && project.aspectRatio === aspect)) {
        precacheAbortRef.current?.abort();
        const pre = new AbortController();
        precacheAbortRef.current = pre;
        abort.signal.addEventListener('abort', () => pre.abort());
        await api.precache({
          signal: pre.signal,
          onProgress: (done, total) => setExportProgress((p) => ({ ...p, statusText: `Loading map tiles along the route… ${total ? Math.round((done / total) * 100) : 0}%` })),
        });
        if (abort.signal.aborted) throw new Error('Export cancelled.');
        setPrecacheState({ status: 'done', done: 1, total: 1, key: exportKey });
      }
      let audio: { samples: Float32Array; sampleRate: number } | undefined;
      if (withSound) {
        setExportProgress((p) => ({ ...p, statusText: 'Composing the soundtrack…' }));
        await new Promise((r) => setTimeout(r, 30));
        audio = { samples: synthesizeSoundtrack(projectRef.current, model, 48000, projectRef.current.volume || 0.6), sampleRate: 48000 };
      }
      await exportVideo({
        audio,
        width,
        height,
        fps,
        totalSeconds: model.totalSeconds,
        renderFrame: async (t) => {
          api.renderFrame(t);
          await api.settle(1200);
        },
        getSources: () => [api.getMapCanvas(), api.getOverlayCanvas()],
        onProgress: setExportProgress,
        signal: abort.signal,
      });
    } catch (err) {
      console.error(err);
    } finally {
      api.setRenderScale(0);
      await new Promise((r) => setTimeout(r, 50));
      api.renderFrame(timeRef.current);
      exportAbortRef.current = null;
    }
  };

  const cancelExport = () => exportAbortRef.current?.abort();

  // The user frames shots by hand in the camera panel for fixed / start-to-end movement
  const cameraFree = sidebarTab === 'camera' && project.camera.movement !== 'follow' && !isPlaying && !exportProgress.isExporting;

  // ------------------------------------------------------------- layout
  const stageClass =
    project.aspectRatio === '9:16'
      ? 'h-full max-h-full aspect-[9/16] w-auto'
      : project.aspectRatio === '1:1'
        ? 'h-full max-h-full aspect-square w-auto'
        : 'w-full max-w-full aspect-video h-auto max-h-full';

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#0b0f17] text-slate-100">
      <Header
        project={project}
        editTool={editTool}
        onEditToolChange={(t) => {
          setEditTool(t);
          setSelectedPoint(null);
          if (t !== 'select') {
            setIsPlaying(false);
            setSidebarTab(t === 'draw' ? 'route' : 'markers');
          }
        }}
        onUpdateProject={setProject}
        onLoadProject={handleLoadProject}
        onNewProject={handleNewProject}
        onOpenExport={() => setIsExportOpen(true)}
        onUndo={undo}
        canUndo={historyLen > 0}
        onFitRoute={() => apiRef.current?.fitRoute()}
        onToast={showToast}
        onReverseRoute={handleReverseRoute}
        onSearchPlace={handleSearchPlace}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        <Sidebar
          project={project}
          model={model}
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          editTool={editTool}
          onEditToolChange={setEditTool}
          onUpdateProject={setProject}
          onCommitProject={commit}
          activeSegmentIndex={activeSegmentIndex}
          onSelectSegment={(i) => {
            setActiveSegmentIndex(i);
            setSidebarTab('route');
          }}
          onUpdateSegment={updateSegment}
          onAddSegment={handleAddSegment}
          onDeleteSegment={handleDeleteSegment}
          selectedWaypointId={selectedWaypointId}
          onSelectWaypoint={setSelectedWaypointId}
          onUpdateWaypoint={handleUpdateWaypoint}
          onDeleteWaypoint={(id) => {
            commit((p) => ({ ...p, waypoints: p.waypoints.filter((w) => w.id !== id) }));
            if (selectedWaypointId === id) setSelectedWaypointId(null);
          }}
          routingBusy={routingBusy}
          onSeek={seek}
          onUpdateCamera={updateCamera}
          onCaptureShot={captureShot}
          onShowShot={showShot}
          onQuickMove={quickMove}
          onUseCurrentZoom={useCurrentZoom}
          cameraFree={cameraFree}
        />

        <main className="flex-1 min-w-0 flex items-center justify-center bg-[#05080e] p-3 relative">
          <div className={`relative ${stageClass} rounded-xl overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_30px_80px_rgba(0,0,0,0.6)]`}>
            <MapCanvas
              project={project}
              model={model}
              currentTime={currentTime}
              isPlaying={isPlaying}
              editTool={editTool}
              cameraLocked={!cameraFree && editTool === 'select'}
              activeSegmentIndex={activeSegmentIndex}
              selectedWaypointId={selectedWaypointId}
              onApiReady={(api) => {
                apiRef.current = api;
              }}
              onAddPoint={handleAddPoint}
              onMovePoint={handleMovePoint}
              onDeletePoint={handleDeletePoint}
              onSelectPoint={(segIdx, idx) => setSelectedPoint({ segIdx, idx })}
              selectedPoint={selectedPoint}
              onAddWaypoint={handleAddWaypoint}
              onMoveWaypoint={handleMoveWaypoint}
              onSelectWaypoint={handleSelectWaypoint}
              onStyleError={showToast}
            />
            <DrawToolbar
              project={project}
              editTool={editTool}
              activeSegmentIndex={activeSegmentIndex}
              selectedPoint={selectedPoint}
              onPickTransport={handlePickTransport}
              onChangeTransportFrom={handleChangeTransportFrom}
              onPauseAt={handlePauseAt}
              onDeletePoint={handleDeletePoint}
              onClearSelection={() => setSelectedPoint(null)}
            />
            {project.segments.every((s) => s.points.length < 2) && editTool === 'select' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto bg-slate-950/85 backdrop-blur border border-white/10 rounded-2xl p-6 max-w-sm text-center shadow-2xl">
                  <div className="text-lg font-bold">Start your trip</div>
                  <p className="text-sm text-slate-300 mt-1">Draw a route on the map, import a GPX / KML track, or pick a template from the top bar.</p>
                  <button onClick={() => setEditTool('draw')} className="mt-4 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-semibold text-sm">
                    Draw a route
                  </button>
                </div>
              </div>
            )}
          </div>
          {toast && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-slate-800/95 border border-white/10 text-sm shadow-xl animate-in fade-in slide-in-from-bottom-2">
              {toast}
            </div>
          )}
        </main>
      </div>

      <Timeline
        project={project}
        model={model}
        currentTime={currentTime}
        liveTimeRef={timeRef}
        precache={precacheState.key === precacheKey ? precacheState : { status: 'idle', done: 0, total: 0, key: '' }}
        onPrecache={() => runPrecache(precacheKey, () => isPlayingRef.current)}
        isPlaying={isPlaying}
        onSeek={seek}
        onTogglePlay={togglePlay}
        onUpdateProject={setProject}
        onSelectWaypoint={handleSelectWaypoint}
      />

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <ExportModal
        key={`${isExportOpen}-${project.aspectRatio}`}
        isOpen={isExportOpen}
        onClose={() => {
          setIsExportOpen(false);
          if (!exportProgress.isExporting) setExportProgress({ isExporting: false, progressPercent: 0, currentFrame: 0, totalFrames: 0, statusText: '' });
        }}
        aspectRatio={project.aspectRatio}
        totalSeconds={model.totalSeconds}
        onStartExport={handleStartExport}
        onCancel={cancelExport}
        exportProgress={exportProgress}
      />
    </div>
  );
};

export default App;
