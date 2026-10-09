import React, { useEffect, useMemo, useRef } from 'react';
import { CheckCircle2, Loader2, Pause, Play, Repeat, SkipBack, SkipForward } from 'lucide-react';
import type { RouteProject } from '../types';
import { timelineLayout, type RouteModel } from '../services/geoUtils';
import { iconGlyph } from '../services/markerIcons';
import { transportInfo } from '../services/presets';

interface TimelineProps {
  project: RouteProject;
  model: RouteModel;
  currentTime: number;
  /** Exact playback time, read every animation frame while playing. */
  liveTimeRef: React.RefObject<number>;
  precache: { status: 'idle' | 'running' | 'done'; done: number; total: number };
  onPrecache: () => void;
  isPlaying: boolean;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onUpdateProject: (updater: (prev: RouteProject) => RouteProject) => void;
  onSelectWaypoint: (id: string) => void;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenth = Math.floor((s % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenth}`;
};

export const Timeline: React.FC<TimelineProps> = ({ project, model, currentTime: stateTime, liveTimeRef, precache, onPrecache, isPlaying, onSeek, onTogglePlay, onUpdateProject, onSelectWaypoint }) => {
  const currentTime = isPlaying ? (liveTimeRef.current ?? stateTime) : stateTime;
  const playheadRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => timelineLayout(model), [model]);
  const total = Math.max(0.1, model.totalSeconds);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / total) * 100))}%`;

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(((clientX - r.left) / r.width) * total);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromEvent(e.clientX);
    const move = (ev: PointerEvent) => seekFromEvent(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // while playing, move the playhead every frame without re-rendering React
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const loop = () => {
      const tNow = liveTimeRef.current ?? 0;
      const p = pct(tNow);
      if (playheadRef.current) playheadRef.current.style.left = p;
      if (fillRef.current) fillRef.current.style.width = p;
      if (clockRef.current) clockRef.current.textContent = fmt(tNow);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, total]);

  const wpById = new Map(project.waypoints.map((w) => [w.id, w]));
  const extras = model.stillAtStart + model.stillAtEnd + model.introSeconds + model.outroSeconds;

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#0e131c] px-4 py-2.5 flex flex-col gap-2 z-20">
      <div className="flex items-center gap-3">
        <span ref={clockRef} className="font-mono text-xs font-bold text-white w-16 tabular-nums">{fmt(currentTime)}</span>
        <div ref={barRef} onPointerDown={onPointerDown} className="relative flex-1 h-9 cursor-pointer select-none touch-none">
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-3 rounded-full bg-white/[0.06] border border-white/10 overflow-hidden">
            {layout.travelStart > 0 && <div className="absolute top-0 bottom-0 bg-white/10" style={{ left: 0, width: pct(layout.travelStart) }} title="Start hold / intro" />}
            {layout.segments.map((s) => (
              <div key={s.index} className="absolute top-0 bottom-0 opacity-70 flex items-center justify-center overflow-hidden text-[9px] leading-none" style={{ left: pct(s.start), width: pct(s.end - s.start), background: project.segments[s.index]?.color }} title={`${project.segments[s.index]?.title} · ${transportInfo(project.segments[s.index]?.transportMode || 'sports_car').label}`}>
                <span>{transportInfo(project.segments[s.index]?.transportMode || 'sports_car').glyph}</span>
              </div>
            ))}
            {layout.transitions.map((tr, i) => (
              <div key={i} className="absolute top-0 bottom-0 bg-white/40" style={{ left: pct(tr.start), width: pct(tr.end - tr.start), backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 2px, rgba(0,0,0,0.35) 2px 4px)' }} title={`Camera glide · ${(tr.end - tr.start).toFixed(1)}s`} />
            ))}
            {layout.waypoints.map((w) => (
              <div key={w.id} className="absolute top-0 bottom-0 bg-white/80" style={{ left: pct(w.start), width: pct(w.end - w.start) }} title={`${wpById.get(w.id)?.title} · ${(w.end - w.start).toFixed(1)}s pause`} />
            ))}
            {layout.outroStart < total && <div className="absolute top-0 bottom-0 bg-white/10" style={{ left: pct(layout.outroStart), right: 0 }} title="Outro / end hold" />}
            <div ref={fillRef} className="absolute top-0 bottom-0 left-0 bg-white/25" style={{ width: pct(currentTime) }} />
          </div>
          {layout.waypoints.map((w) => {
            const wp = wpById.get(w.id);
            if (!wp) return null;
            return (
              <button
                key={w.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectWaypoint(w.id);
                  onSeek(w.start + 0.05);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute -top-0.5 -translate-x-1/2 w-5 h-5 rounded-full border-2 border-[#0e131c] flex items-center justify-center text-[10px] hover:scale-125 transition-transform"
                style={{ left: pct(w.start), background: wp.color }}
                title={wp.title}
              >
                <span className="leading-none">{iconGlyph(wp.icon) || ''}</span>
              </button>
            );
          })}
          <div ref={playheadRef} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-900 shadow pointer-events-none" style={{ left: pct(currentTime) }} />
        </div>
        <span className="font-mono text-xs text-slate-400 w-16 text-right tabular-nums">{fmt(total)}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => onSeek(0)} className="tl-btn" title="Back to start (Home)"><SkipBack className="w-4 h-4" /></button>
          <button onClick={onTogglePlay} className="w-10 h-10 rounded-full bg-white text-slate-900 flex items-center justify-center hover:scale-105 transition-transform shadow-lg" title="Play / pause (Space)">
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>
          <button onClick={() => onSeek(total)} className="tl-btn" title="Jump to end (End)"><SkipForward className="w-4 h-4" /></button>
          <button onClick={() => onUpdateProject((p) => ({ ...p, loop: !p.loop }))} className={`tl-btn ${project.loop ? '!text-rose-300 !bg-rose-500/15' : ''}`} title="Loop playback"><Repeat className="w-4 h-4" /></button>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={onPrecache}
            disabled={precache.status === 'running'}
            className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white disabled:hover:text-slate-400"
            title="Map tiles along the camera path are loaded in the background so playback and export run smoothly. Click to load them again."
          >
            {precache.status === 'running' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" /> Preparing map {precache.total ? Math.round((precache.done / precache.total) * 100) : 0}%
              </>
            ) : precache.status === 'done' ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Map ready
              </>
            ) : (
              <>Prepare map</>
            )}
          </button>
          <label className="flex items-center gap-2 text-slate-400">
            Travel time
            <input type="range" min={4} max={90} step={1} value={project.durationSeconds} onChange={(e) => onUpdateProject((p) => ({ ...p, durationSeconds: Number(e.target.value) }))} className="w-32" />
            <input
              type="number"
              min={2}
              max={600}
              value={project.durationSeconds}
              onChange={(e) => onUpdateProject((p) => ({ ...p, durationSeconds: Math.max(2, Math.min(600, Number(e.target.value) || 2)) }))}
              className="w-14 bg-white/[0.04] border border-white/10 rounded-md px-1.5 py-1 text-white font-mono text-xs text-right"
            />
            s
          </label>
          <span className="text-slate-500 hidden md:inline">
            + {model.totalDwellSeconds.toFixed(1)}s pauses{extras > 0 ? ` + ${extras.toFixed(1)}s start/end` : ''} = <b className="text-slate-300">{total.toFixed(1)}s</b>
          </span>
          <div className="flex items-center bg-white/[0.03] p-0.5 rounded-lg border border-white/10">
            {[0.5, 1, 2].map((s) => (
              <button key={s} onClick={() => onUpdateProject((p) => ({ ...p, playbackSpeed: s }))} className={`px-2 py-1 rounded-md font-mono text-[11px] font-semibold ${project.playbackSpeed === s ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`} title="Preview speed (does not affect the export)">
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
