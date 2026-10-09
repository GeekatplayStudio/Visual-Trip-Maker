import React from 'react';
import { Camera, Loader2, MapPin, Mountain, Palette, PenLine, Plus, Route, Trash2, Crosshair, ChevronUp, ChevronDown } from 'lucide-react';
import type { CameraMovement, CameraSettings, CameraShot, EditTool, LineStyle, MarkerStyle, RouteProject, RouteSegment, RoutingMode, Steadiness, TransportMode, Waypoint, ZoomTier } from '../types';
import { TRANSPORT_OPTIONS } from '../services/presets';
import { MOVEMENT_INFO, legViewKm } from '../services/cameraDirector';
import { THEMES } from '../services/mapStyles';
import { MARKER_COLORS, MARKER_ICONS, iconGlyph } from '../services/markerIcons';
import { FLYING_MODES, rebuildSegment, timelineLayout, type RouteModel } from '../services/geoUtils';

export type SidebarTab = 'route' | 'markers' | 'camera' | 'style';

interface SidebarProps {
  project: RouteProject;
  model: RouteModel;
  tab: SidebarTab;
  onTabChange: (t: SidebarTab) => void;
  editTool: EditTool;
  onEditToolChange: (t: EditTool) => void;
  onUpdateProject: (updater: (prev: RouteProject) => RouteProject) => void;
  onCommitProject: (updater: (prev: RouteProject) => RouteProject) => void;
  activeSegmentIndex: number;
  onSelectSegment: (idx: number) => void;
  onUpdateSegment: (idx: number, fn: (s: RouteSegment) => RouteSegment, withHistory?: boolean) => void;
  onAddSegment: () => void;
  onDeleteSegment: (idx: number) => void;
  selectedWaypointId: string | null;
  onSelectWaypoint: (id: string | null) => void;
  onUpdateWaypoint: (id: string, patch: Partial<Waypoint>, withHistory?: boolean) => void;
  onDeleteWaypoint: (id: string) => void;
  routingBusy: Set<string>;
  onSeek: (t: number) => void;
  onUpdateCamera: (patch: Partial<CameraSettings>) => void;
  onCaptureShot: (which: 'startShot' | 'endShot' | 'fixedShot') => void;
  onShowShot: (shot: CameraShot | undefined) => void;
  onQuickMove: (kind: 'reveal' | 'finish' | 'pan') => void;
  onUseCurrentZoom: () => void;
  cameraFree: boolean;
}

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ on, onChange, label, hint }) => (
  <button onClick={() => onChange(!on)} className="w-full flex items-center justify-between gap-3 py-1.5 text-left">
    <div>
      <div className="text-xs font-semibold text-slate-200">{label}</div>
      {hint && <div className="text-[11px] text-slate-500 leading-snug">{hint}</div>}
    </div>
    <span className={`w-10 h-5.5 rounded-full relative transition-colors shrink-0 ${on ? 'bg-rose-500' : 'bg-white/15'}`}>
      <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }> = ({ label, value, min, max, step, onChange, format }) => (
  <label className="block">
    <div className="flex justify-between text-[11px] mb-1">
      <span className="text-slate-400 font-medium">{label}</span>
      <span className="font-mono text-slate-200">{format ? format(value) : value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
  </label>
);

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, hint, children, action }) => (
  <div className="flex flex-col gap-3">
    <div className="flex items-start justify-between gap-2">
      <div>
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

export const Sidebar: React.FC<SidebarProps> = (p) => {
  const { project, model, tab, onTabChange, editTool, onEditToolChange, onUpdateProject, onCommitProject, activeSegmentIndex, onSelectSegment, onUpdateSegment, onAddSegment, onDeleteSegment, selectedWaypointId, onSelectWaypoint, onUpdateWaypoint, onDeleteWaypoint, routingBusy, onSeek, onUpdateCamera, onCaptureShot, onShowShot, onQuickMove, onUseCurrentZoom, cameraFree } = p;
  const cam = project.camera;
  const usedTransports = Array.from(new Set(project.segments.map((s) => s.transportMode))) as TransportMode[];
  const seg = project.segments[activeSegmentIndex];
  const layout = timelineLayout(model);

  const tabs: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
    { id: 'route', icon: <Route className="w-4 h-4" />, label: 'Route' },
    { id: 'markers', icon: <MapPin className="w-4 h-4" />, label: 'Markers' },
    { id: 'camera', icon: <Camera className="w-4 h-4" />, label: 'Camera' },
    { id: 'style', icon: <Palette className="w-4 h-4" />, label: 'Style' },
  ];

  const setRouting = (idx: number, routing: RoutingMode) =>
    onUpdateSegment(idx, (s) => (routing === 'road' ? { ...s, routing, roadSnapped: false } : rebuildSegment({ ...s, routing, roadSnapped: false })));

  const moveSegment = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= project.segments.length) return;
    onCommitProject((prev) => {
      const segs = prev.segments.slice();
      [segs[idx], segs[j]] = [segs[j], segs[idx]];
      return { ...prev, segments: segs };
    });
    onSelectSegment(j);
  };

  return (
    <aside className="w-[340px] shrink-0 h-full flex flex-col border-r border-white/10 bg-[#0e131c] z-20">
      <div className="grid grid-cols-4 border-b border-white/10">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => onTabChange(t.id)} className={`py-2.5 flex flex-col items-center gap-1 text-[11px] font-semibold transition-colors border-b-2 ${tab === t.id ? 'text-white border-rose-400' : 'text-slate-500 border-transparent hover:text-slate-200'}`}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {/* ------------------------------------------------------------ ROUTE */}
        {tab === 'route' && (
          <>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-slate-400 leading-relaxed">
              <b className="text-slate-200">How it works.</b> Draw one continuous route. While drawing, pick a transport in the <b className="text-slate-200">Travelling by</b> menu above the map: the next points start a new leg (car → plane → taxi → train…). Or click a point and choose <b className="text-slate-200">Change transport from here</b>. Each leg gets its own vehicle, path shape and style, and the video pauses at every change while the camera glides. See Help for more.
            </div>
            <Section
              title="Legs"
              hint="Each leg has its own vehicle, speed and line style."
              action={
                <button onClick={onAddSegment} className="chip flex items-center gap-1 text-rose-200 border-rose-400/40">
                  <Plus className="w-3.5 h-3.5" /> Add leg
                </button>
              }
            >
              <div className="flex flex-col gap-1.5">
                {project.segments.map((s, idx) => {
                  const t = TRANSPORT_OPTIONS.find((o) => o.mode === s.transportMode);
                  const active = idx === activeSegmentIndex;
                  const range = layout.segments.find((x) => x.index === idx);
                  return (
                    <div key={s.id} onClick={() => onSelectSegment(idx)} className={`rounded-xl border p-2.5 cursor-pointer transition-colors flex items-center gap-2.5 ${active ? 'border-rose-400/60 bg-rose-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ background: s.color + '33', boxShadow: `inset 0 0 0 1.5px ${s.color}` }}>
                        {t?.glyph}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-white truncate">{s.title}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {s.lengthKm.toFixed(0)} km · {s.points.length} pts{routingBusy.has(s.id) ? ' · routing…' : ''}
                        </div>
                      </div>
                      {active && (
                        <div className="flex flex-col -my-1">
                          <button className="text-slate-500 hover:text-white p-0.5" onClick={(e) => { e.stopPropagation(); moveSegment(idx, -1); }} title="Move up"><ChevronUp className="w-3.5 h-3.5" /></button>
                          <button className="text-slate-500 hover:text-white p-0.5" onClick={(e) => { e.stopPropagation(); moveSegment(idx, 1); }} title="Move down"><ChevronDown className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {range && (
                        <button className="text-slate-500 hover:text-white p-1" title="Jump to this leg" onClick={(e) => { e.stopPropagation(); onSeek(range.start + 0.05); }}>
                          <Crosshair className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button className="text-slate-500 hover:text-red-400 p-1" title="Delete leg" onClick={(e) => { e.stopPropagation(); onDeleteSegment(idx); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Section>

            {seg && (
              <div className="card flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <input value={seg.title} onChange={(e) => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, title: e.target.value }), false)} className="field font-bold" />
                </div>

                <button
                  onClick={() => onEditToolChange(editTool === 'draw' ? 'select' : 'draw')}
                  className={`w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 border transition-colors ${editTool === 'draw' ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200' : 'bg-white/[0.04] border-white/10 text-white hover:bg-white/[0.08]'}`}
                >
                  <PenLine className="w-4 h-4" />
                  {editTool === 'draw' ? 'Drawing — click the map, Esc when done' : seg.points.length ? 'Edit points on the map' : 'Draw this leg on the map'}
                </button>
                {seg.points.length > 0 && (
                  <button onClick={() => onUpdateSegment(activeSegmentIndex, (s) => rebuildSegment({ ...s, points: [], roadSnapped: false }))} className="text-[11px] text-slate-500 hover:text-red-300 -mt-2 text-left">
                    Clear points
                  </button>
                )}

                <div>
                  <div className="label">Vehicle</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {TRANSPORT_OPTIONS.map((o) => (
                      <button
                        key={o.mode}
                        title={o.label}
                        onClick={() =>
                          onUpdateSegment(activeSegmentIndex, (s) => {
                            const wasFlying = FLYING_MODES.includes(s.transportMode);
                            const isFlying = FLYING_MODES.includes(o.mode);
                            let routing = s.routing;
                            if (o.mode === 'airplane' || o.mode === 'propeller') routing = 'arc';
                            else if (wasFlying && !isFlying) routing = 'curved';
                            else if (s.routing === 'road' && (o.mode === 'yacht' || o.mode === 'ferry' || o.mode === 'bullet_train' || o.mode === 'steam_train' || isFlying)) routing = 'curved';
                            return rebuildSegment({ ...s, transportMode: o.mode, routing, speedKmh: o.speed, roadSnapped: false, altitudeMeters: o.mode === 'airplane' ? 9000 : o.mode === 'propeller' ? 2500 : s.altitudeMeters });
                          })
                        }
                        className={`chip flex flex-col items-center gap-0.5 !px-1 ${seg.transportMode === o.mode ? 'chip-on' : ''}`}
                      >
                        <span className="text-lg leading-none">{o.glyph}</span>
                        <span className="text-[9px] leading-tight truncate w-full text-center">{o.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="label">Path shape</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'road', label: 'Roads', hint: 'Follows real roads (OSRM)' },
                        { id: 'curved', label: 'Smooth', hint: 'Smooth curve through your points' },
                        { id: 'straight', label: 'Straight', hint: 'Straight lines between points' },
                        { id: 'arc', label: 'Flight arc', hint: 'Great-circle arc' },
                      ] as { id: RoutingMode; label: string; hint: string }[]
                    ).map((o) => (
                      <button key={o.id} title={o.hint} onClick={() => setRouting(activeSegmentIndex, o.id)} className={`chip ${seg.routing === o.id ? 'chip-on' : ''}`}>
                        {routingBusy.has(seg.id) && o.id === 'road' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Slider label="Speed (sets how long this leg takes)" value={seg.speedKmh} min={3} max={950} step={1} onChange={(v) => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, speedKmh: v }), false)} format={(v) => `${v} km/h`} />
                {(seg.transportMode === 'airplane' || seg.transportMode === 'propeller') && (
                  <Slider label="Cruise altitude (3D vehicle)" value={seg.altitudeMeters} min={500} max={14000} step={250} onChange={(v) => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, altitudeMeters: v }), false)} format={(v) => `${v} m`} />
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="label">Line colour</div>
                    <div className="flex items-center gap-2">
                      <input type="color" value={seg.color} onChange={(e) => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, color: e.target.value }), false)} />
                      <div className="flex gap-1 flex-wrap">
                        {MARKER_COLORS.slice(0, 8).map((c) => (
                          <button key={c} onClick={() => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, color: c }), false)} className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <Slider label="Width" value={seg.lineWidth} min={2} max={14} step={0.5} onChange={(v) => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, lineWidth: v }), false)} format={(v) => `${v}px`} />
                </div>
                <div className="flex items-center gap-1.5">
                  {(['solid', 'dashed', 'dots'] as LineStyle[]).map((st) => (
                    <button key={st} onClick={() => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, lineStyle: st }), false)} className={`chip flex-1 capitalize ${seg.lineStyle === st ? 'chip-on' : ''}`}>
                      {st}
                    </button>
                  ))}
                  <button onClick={() => onUpdateSegment(activeSegmentIndex, (s) => ({ ...s, glow: !s.glow }), false)} className={`chip flex-1 ${seg.glow ? 'chip-on' : ''}`}>
                    Glow
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ------------------------------------------------------------ MARKERS */}
        {tab === 'markers' && (
          <>
            <Section
              title="Markers"
              hint="Stops along the route. Each can pause the animation and show a story card."
              action={
                <button onClick={() => onEditToolChange(editTool === 'marker' ? 'select' : 'marker')} className={`chip flex items-center gap-1 ${editTool === 'marker' ? 'chip-on' : 'text-rose-200 border-rose-400/40'}`}>
                  <Plus className="w-3.5 h-3.5" /> {editTool === 'marker' ? 'Placing… (Esc)' : 'Place marker'}
                </button>
              }
            >
              {project.waypoints.length === 0 && <p className="text-xs text-slate-500">No markers yet. Click “Place marker”, then click on the route.</p>}
              <div className="flex flex-col gap-1.5">
                {model.anchors
                  .map((a) => project.waypoints.find((w) => w.id === a.waypointId)!)
                  .concat(project.waypoints.filter((w) => !model.anchors.some((a) => a.waypointId === w.id)))
                  .filter(Boolean)
                  .map((wp) => {
                    const selected = wp.id === selectedWaypointId;
                    const range = layout.waypoints.find((x) => x.id === wp.id);
                    return (
                      <div key={wp.id} className={`rounded-xl border transition-colors ${selected ? 'border-rose-400/60 bg-rose-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                        <div className="p-2.5 flex items-center gap-2.5 cursor-pointer" onClick={() => onSelectWaypoint(selected ? null : wp.id)}>
                          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: wp.color + '33', boxShadow: `inset 0 0 0 1.5px ${wp.color}` }}>
                            {iconGlyph(wp.icon) || '•'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-white truncate">{wp.title}</div>
                            <div className="text-[10px] text-slate-500 truncate">{wp.dwellTime > 0 ? `${wp.dwellTime}s pause` : 'no pause'}{wp.subtitle ? ` · ${wp.subtitle}` : ''}</div>
                          </div>
                          {range && (
                            <button className="text-slate-500 hover:text-white p-1" title="Jump to this stop" onClick={(e) => { e.stopPropagation(); onSeek(range.start + 0.05); }}>
                              <Crosshair className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button className="text-slate-500 hover:text-red-400 p-1" title="Delete marker" onClick={(e) => { e.stopPropagation(); onDeleteWaypoint(wp.id); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {selected && (
                          <div className="px-2.5 pb-3 flex flex-col gap-3 border-t border-white/10 pt-3">
                            <input value={wp.title} onChange={(e) => onUpdateWaypoint(wp.id, { title: e.target.value })} className="field font-bold" placeholder="Title" />
                            <input value={wp.subtitle || ''} onChange={(e) => onUpdateWaypoint(wp.id, { subtitle: e.target.value })} className="field" placeholder="Subtitle (optional)" />
                            <div>
                              <div className="label">Marker style</div>
                              <div className="grid grid-cols-5 gap-1.5">
                                {(
                                  [
                                    { id: 'pin', label: 'Pin' },
                                    { id: 'dot', label: 'Dot' },
                                    { id: 'flag', label: 'Flag' },
                                    { id: 'photo', label: 'Photo' },
                                    { id: 'label', label: 'Text' },
                                  ] as { id: MarkerStyle; label: string }[]
                                ).map((o) => (
                                  <button key={o.id} onClick={() => onUpdateWaypoint(wp.id, { markerStyle: o.id })} className={`chip !px-1 ${wp.markerStyle === o.id ? 'chip-on' : ''}`}>
                                    {o.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="label">Icon</div>
                              <div className="grid grid-cols-8 gap-1">
                                {MARKER_ICONS.map((ic) => (
                                  <button key={ic.key} title={ic.label} onClick={() => onUpdateWaypoint(wp.id, { icon: ic.key })} className={`h-8 rounded-lg border text-base flex items-center justify-center ${wp.icon === ic.key ? 'border-rose-400/70 bg-rose-500/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.08]'}`}>
                                    {ic.glyph || <span className="w-2 h-2 rounded-full bg-slate-300" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="label !mb-0">Colour</div>
                              <input type="color" value={wp.color} onChange={(e) => onUpdateWaypoint(wp.id, { color: e.target.value })} />
                              <div className="flex gap-1 flex-wrap">
                                {MARKER_COLORS.map((c) => (
                                  <button key={c} onClick={() => onUpdateWaypoint(wp.id, { color: c })} className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
                                ))}
                              </div>
                            </div>
                            <Slider label="Pause at this stop" value={wp.dwellTime} min={0} max={10} step={0.5} onChange={(v) => onUpdateWaypoint(wp.id, { dwellTime: v })} format={(v) => (v ? `${v}s` : 'none')} />
                            <div className="grid grid-cols-2 gap-1.5">
                              <button onClick={() => onUpdateWaypoint(wp.id, { revealMode: 'on_arrival' })} className={`chip ${wp.revealMode === 'on_arrival' ? 'chip-on' : ''}`}>Pop in on arrival</button>
                              <button onClick={() => onUpdateWaypoint(wp.id, { revealMode: 'always' })} className={`chip ${wp.revealMode === 'always' ? 'chip-on' : ''}`}>Always visible</button>
                            </div>
                            <Toggle on={wp.showCard} onChange={(v) => onUpdateWaypoint(wp.id, { showCard: v })} label="Show story card" hint="Title, subtitle and photo overlay when arriving" />
                            <input value={wp.photoUrl || ''} onChange={(e) => onUpdateWaypoint(wp.id, { photoUrl: e.target.value || undefined })} className="field text-xs" placeholder="Photo URL (optional)" />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </Section>
            <div className="card flex flex-col gap-1">
              <Toggle on={project.showMarkerLabels} onChange={(v) => onUpdateProject((q) => ({ ...q, showMarkerLabels: v }))} label="Labels next to markers" />
              <Toggle on={project.showStoryCards} onChange={(v) => onUpdateProject((q) => ({ ...q, showStoryCards: v }))} label="Story cards" hint="Big card overlay at each stop" />
              <Slider label="Marker size" value={project.markerScale} min={0.6} max={1.8} step={0.1} onChange={(v) => onUpdateProject((q) => ({ ...q, markerScale: v }))} format={(v) => `${v.toFixed(1)}×`} />
            </div>
          </>
        )}

        {/* ------------------------------------------------------------ CAMERA */}
        {tab === 'camera' && (
          <>
            <Section title="Camera" hint={cam.movement === 'follow' ? 'The camera stays with the symbol as it travels.' : cam.movement === 'start_to_end' ? 'The video glides from the start shot to the end shot while the line draws.' : 'The video films exactly this view.'}>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(MOVEMENT_INFO) as CameraMovement[]).map((m) => (
                  <button key={m} onClick={() => onUpdateCamera({ movement: m })} className={`text-left rounded-xl border p-2.5 transition-colors ${cam.movement === m ? 'border-rose-400/60 bg-rose-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                    <div className="text-xs font-bold text-white leading-tight">{MOVEMENT_INFO[m].label}</div>
                    <div className="text-[10px] text-slate-500 leading-snug mt-0.5">{MOVEMENT_INFO[m].desc}</div>
                  </button>
                ))}
              </div>
            </Section>

            {cam.movement === 'follow' && (
              <>
                <div className="card flex flex-col gap-3">
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-400 font-medium">Zoom</span>
                      <span className="font-mono text-slate-200">{cam.zoomAuto ? 'auto' : cam.zoom.toFixed(1)}</span>
                    </div>
                    <input type="range" min={3} max={16} step={0.1} value={cam.zoomAuto ? 9 : cam.zoom} onChange={(e) => onUpdateCamera({ zoom: Number(e.target.value), zoomAuto: false })} className="w-full" />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-0.5"><span>Wide</span><span>Close</span></div>
                    {cam.zoomAuto && <p className="text-[10px] text-slate-500 mt-1.5">Auto frames every leg on its own: walking very close, road vehicles a little further out, trains and boats wider, flights wide. Fast legs in a short video are framed a bit wider so the map does not rush past.</p>}
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => onUpdateCamera({ zoomAuto: true })} className={`chip flex-1 ${cam.zoomAuto ? 'chip-on' : ''}`}>Auto</button>
                      <button onClick={onUseCurrentZoom} className="chip flex-1">Use the map's zoom</button>
                    </div>
                  </div>
                  {usedTransports.length > 0 && (
                    <div>
                      <div className="label">Zoom per transport</div>
                      <div className="flex flex-col gap-1.5">
                        {usedTransports.map((mode) => {
                          const info = TRANSPORT_OPTIONS.find((o) => o.mode === mode);
                          const tier = cam.zoomPerTransport[mode] || 'same';
                          const views = project.segments.map((sg, i) => (sg.transportMode === mode && model.segments[i]?.durationSec > 0 ? legViewKm(project, model, i) : null)).filter((v): v is number => v !== null);
                          const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : Math.round(km).toString());
                          const autoText = cam.zoomAuto && views.length ? `≈ ${fmtKm(Math.min(...views))}${views.length > 1 && Math.max(...views) - Math.min(...views) > 0.5 ? `–${fmtKm(Math.max(...views))}` : ''} km` : '';
                          return (
                            <div key={mode} className="flex items-center gap-2">
                              <span className="w-24 text-[11px] text-slate-300 truncate leading-tight" title={autoText ? `Auto framing: ${autoText} across the frame` : undefined}>
                                {info?.glyph} {info?.label}
                                {autoText && <span className="block text-[9px] text-slate-500 font-mono">{autoText}</span>}
                              </span>
                              <div className="flex-1 grid grid-cols-4 gap-1">
                                {(['closer', 'same', 'wider', 'widest'] as ZoomTier[]).map((z) => (
                                  <button key={z} onClick={() => onUpdateCamera({ zoomPerTransport: { ...cam.zoomPerTransport, [mode]: z } })} className={`chip !px-1 capitalize ${tier === z ? 'chip-on' : ''}`}>{z}</button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1.5">Fine-tunes the framing of each transport. The line pauses where the transport changes while the camera glides in or out.</p>
                    </div>
                  )}
                  <Slider label="Pause at transport changes" value={cam.transitionSeconds} min={0} max={3} step={0.1} onChange={(v) => onUpdateCamera({ transitionSeconds: v })} format={(v) => (v ? `${v.toFixed(1)}s` : 'none')} />
                </div>

                <div className="card flex flex-col gap-3">
                  <div>
                    <div className="label">Start and end</div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                      <span className="text-[11px] text-slate-400">Start</span>
                      <div className="grid grid-cols-2 gap-1">
                        <button onClick={() => onUpdateCamera({ startWhole: false })} className={`chip ${!cam.startWhole ? 'chip-on' : ''}`}>Close</button>
                        <button onClick={() => onUpdateCamera({ startWhole: true })} className={`chip ${cam.startWhole ? 'chip-on' : ''}`}>Whole route</button>
                      </div>
                      <span className="text-[11px] text-slate-400">End</span>
                      <div className="grid grid-cols-2 gap-1">
                        <button onClick={() => onUpdateCamera({ endWhole: false })} className={`chip ${!cam.endWhole ? 'chip-on' : ''}`}>Close</button>
                        <button onClick={() => onUpdateCamera({ endWhole: true })} className={`chip ${cam.endWhole ? 'chip-on' : ''}`}>Whole route</button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5">Whole route opens on the full trip and glides in, or pulls back to it at the end.</p>
                  </div>
                  <div>
                    <div className="label">Which way is up</div>
                    <div className="grid grid-cols-3 gap-1">
                      <button onClick={() => onUpdateCamera({ orientation: 'north_up' })} className={`chip ${cam.orientation === 'north_up' ? 'chip-on' : ''}`}>North up</button>
                      <button onClick={() => onUpdateCamera({ orientation: 'heading' })} className={`chip ${cam.orientation === 'heading' ? 'chip-on' : ''}`}>Direction of travel</button>
                      <button onClick={() => onUpdateCamera({ orientation: 'fixed' })} className={`chip ${cam.orientation === 'fixed' ? 'chip-on' : ''}`}>Fixed angle</button>
                    </div>
                    {cam.orientation === 'fixed' && <div className="mt-2"><Slider label="Map rotation" value={cam.bearing} min={-180} max={180} step={5} onChange={(v) => onUpdateCamera({ bearing: v })} format={(v) => `${v}°`} /></div>}
                  </div>
                  <div>
                    <div className="label">Look ahead</div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['Tip centred', 'A little', 'More'] as const).map((l, i) => (
                        <button key={l} onClick={() => onUpdateCamera({ lookAhead: i as 0 | 1 | 2 })} className={`chip ${cam.lookAhead === i ? 'chip-on' : ''}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="label">Camera steadiness</div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['tight', 'smooth', 'very_smooth'] as Steadiness[]).map((st) => (
                        <button key={st} onClick={() => onUpdateCamera({ steadiness: st })} className={`chip ${cam.steadiness === st ? 'chip-on' : ''}`}>{st === 'very_smooth' ? 'Very smooth' : st[0].toUpperCase() + st.slice(1)}</button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5">Smoother cameras glide through bends instead of following every turn.</p>
                  </div>
                  <Slider label="Tilt" value={cam.tilt} min={0} max={65} step={1} onChange={(v) => onUpdateCamera({ tilt: v })} format={(v) => (v ? `${v}°` : 'flat')} />
                </div>
              </>
            )}

            {cam.movement === 'start_to_end' && (
              <>
                <div className="card flex flex-col gap-2">
                  <div className="label">Quick moves</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => onQuickMove('reveal')} className="chip">Zoom out to reveal</button>
                    <button onClick={() => onQuickMove('finish')} className="chip">Zoom in to finish</button>
                    <button onClick={() => onQuickMove('pan')} className="chip col-span-2">Pan along</button>
                  </div>
                  <p className="text-[10px] text-slate-500">Sets both shots for you. You can fine-tune them after.</p>
                </div>
                <div className="card flex flex-col gap-3">
                  <div className="label">Shots</div>
                  <p className="text-[11px] text-slate-400 -mt-2">Move and zoom the map until the frame shows what you want, then save it.</p>
                  {(['startShot', 'endShot'] as const).map((k) => (
                    <div key={k} className="rounded-xl border border-white/10 p-2.5 flex items-center gap-2">
                      <div className="flex-1">
                        <div className="text-xs font-bold text-white">{k === 'startShot' ? 'Start shot' : 'End shot'}</div>
                        <div className="text-[10px] text-slate-500">{cam[k] ? `zoom ${cam[k]!.zoom.toFixed(1)} · ${Math.round(cam[k]!.bearing)}°` : 'Not set – uses the whole route'}</div>
                      </div>
                      <button onClick={() => onCaptureShot(k)} className="chip chip-on">Use this view</button>
                      <button onClick={() => onShowShot(cam[k])} disabled={!cam[k]} className="chip disabled:opacity-40">Show</button>
                    </div>
                  ))}
                  <div>
                    <div className="label">Movement</div>
                    <div className="grid grid-cols-2 gap-1">
                      <button onClick={() => onUpdateCamera({ easing: 'smooth' })} className={`chip ${cam.easing === 'smooth' ? 'chip-on' : ''}`}>Smooth start and stop</button>
                      <button onClick={() => onUpdateCamera({ easing: 'steady' })} className={`chip ${cam.easing === 'steady' ? 'chip-on' : ''}`}>Steady</button>
                    </div>
                  </div>
                  <Slider label="Tilt (for automatic shots)" value={cam.tilt} min={0} max={65} step={1} onChange={(v) => onUpdateCamera({ tilt: v })} format={(v) => (v ? `${v}°` : 'flat')} />
                </div>
              </>
            )}

            {cam.movement === 'fixed' && (
              <div className="card flex flex-col gap-3">
                <p className="text-[11px] text-slate-400">Move and zoom the map until the frame shows what you want, then save it.</p>
                <div className="rounded-xl border border-white/10 p-2.5 flex items-center gap-2">
                  <div className="flex-1">
                    <div className="text-xs font-bold text-white">View</div>
                    <div className="text-[10px] text-slate-500">{cam.fixedShot ? `zoom ${cam.fixedShot.zoom.toFixed(1)} · ${Math.round(cam.fixedShot.bearing)}°` : 'Not set – frames the whole route'}</div>
                  </div>
                  <button onClick={() => onCaptureShot('fixedShot')} className="chip chip-on">Use this view</button>
                  <button onClick={() => onShowShot(cam.fixedShot)} disabled={!cam.fixedShot} className="chip disabled:opacity-40">Show</button>
                </div>
              </div>
            )}

            {cameraFree && <p className="text-[11px] text-emerald-300/90">The map is free to move while you frame your shots. Press play to see the camera move.</p>}

            <div className="card flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Slider label="Still at start" value={project.stillAtStart} min={0} max={3} step={0.5} onChange={(v) => onUpdateProject((q) => ({ ...q, stillAtStart: v }))} format={(v) => `${v}s`} />
                <Slider label="Still at end" value={project.stillAtEnd} min={0} max={3} step={0.5} onChange={(v) => onUpdateProject((q) => ({ ...q, stillAtEnd: v }))} format={(v) => `${v}s`} />
              </div>
            </div>
          </>
        )}

        {/* ------------------------------------------------------------ STYLE */}
        {tab === 'style' && (
          <>
            <Section title="Basemap" hint="Vector styles are crisp at every zoom and export sharp.">
              <div className="grid grid-cols-2 gap-2">
                {THEMES.map((t) => {
                  const on = project.mapTheme === t.id;
                  return (
                    <button key={t.id} onClick={() => onUpdateProject((q) => ({ ...q, mapTheme: t.id }))} className={`text-left rounded-xl border p-2 transition-colors ${on ? 'border-rose-400/60 bg-rose-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                      <div className="h-9 rounded-lg mb-1.5 overflow-hidden flex">
                        {t.swatch.map((c, i) => (
                          <span key={i} className="flex-1" style={{ background: c }} />
                        ))}
                      </div>
                      <div className="text-xs font-bold text-white">{t.label}</div>
                      <div className="text-[10px] text-slate-500 leading-snug">{t.desc}</div>
                    </button>
                  );
                })}
              </div>
            </Section>
            <div className="card flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-white"><Mountain className="w-4 h-4 text-rose-300" /> Terrain</div>
              <Toggle on={project.terrain3D} onChange={(v) => onUpdateProject((q) => ({ ...q, terrain3D: v }))} label="3D terrain" hint="Real elevation mesh. Shines with satellite + flyover camera." />
              {project.terrain3D && <Slider label="Relief exaggeration" value={project.terrainExaggeration} min={0.5} max={3} step={0.1} onChange={(v) => onUpdateProject((q) => ({ ...q, terrainExaggeration: v }))} format={(v) => `${v.toFixed(1)}×`} />}
              <Toggle on={project.hillshade} onChange={(v) => onUpdateProject((q) => ({ ...q, hillshade: v }))} label="Hillshade" hint="Soft mountain shading on vector maps" />
              <Toggle on={project.showMapLabels} onChange={(v) => onUpdateProject((q) => ({ ...q, showMapLabels: v }))} label="Map labels" hint="Place names and road labels of the basemap" />
            </div>
            <div className="card flex flex-col gap-3">
              <div className="label !mb-0">Symbol at the tip</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'icon', label: 'Flat symbol' },
                    { id: '3d', label: '3D model' },
                    { id: 'none', label: 'None' },
                  ] as { id: RouteProject['vehicleStyle']; label: string }[]
                ).map((o) => (
                  <button key={o.id} onClick={() => onUpdateProject((q) => ({ ...q, vehicleStyle: o.id }))} className={`chip ${project.vehicleStyle === o.id ? 'chip-on' : ''}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <Slider label="Symbol size" value={project.vehicleScale} min={0.5} max={2.5} step={0.1} onChange={(v) => onUpdateProject((q) => ({ ...q, vehicleScale: v }))} format={(v) => `${v.toFixed(1)}×`} />
              <Slider label="Line thickness (all legs)" value={project.lineScale} min={0.5} max={2.5} step={0.1} onChange={(v) => onUpdateProject((q) => ({ ...q, lineScale: v }))} format={(v) => `${v.toFixed(1)}×`} />
              <Toggle on={project.showTrail} onChange={(v) => onUpdateProject((q) => ({ ...q, showTrail: v }))} label="Motion trail" hint="Wake behind boats, contrail behind planes, smoke and dust" />
              <Toggle on={project.showHeadBeacon} onChange={(v) => onUpdateProject((q) => ({ ...q, showHeadBeacon: v }))} label="Pulsing glow under the symbol" />
              <Toggle on={project.showUpcomingRoute} onChange={(v) => onUpdateProject((q) => ({ ...q, showUpcomingRoute: v }))} label="Show the upcoming route faintly" />
              <Toggle on={project.showHud} onChange={(v) => onUpdateProject((q) => ({ ...q, showHud: v }))} label="Distance / speed pill" />
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
