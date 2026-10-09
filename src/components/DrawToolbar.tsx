import React, { useState } from 'react';
import { ChevronDown, PauseCircle, Trash2, GitBranch, X } from 'lucide-react';
import type { EditTool, RouteProject, TransportMode } from '../types';
import { TRANSPORT_OPTIONS, transportInfo } from '../services/presets';

export interface SelectedPoint {
  segIdx: number;
  idx: number;
}

interface DrawToolbarProps {
  project: RouteProject;
  editTool: EditTool;
  activeSegmentIndex: number;
  selectedPoint: SelectedPoint | null;
  onPickTransport: (mode: TransportMode) => void;
  onChangeTransportFrom: (segIdx: number, idx: number, mode: TransportMode) => void;
  onPauseAt: (segIdx: number, idx: number, seconds: number) => void;
  onDeletePoint: (segIdx: number, idx: number) => void;
  onClearSelection: () => void;
}

const TransportMenu: React.FC<{ current: TransportMode; onPick: (m: TransportMode) => void; label: string }> = ({ current, onPick, label }) => {
  const [open, setOpen] = useState(false);
  const info = transportInfo(current);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="h-8 px-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-xs font-semibold text-white flex items-center gap-1.5">
        <span className="text-slate-400 font-medium">{label}</span>
        <span className="text-base leading-none">{info.glyph}</span>
        <span>{info.label}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-50 w-72 rounded-xl bg-[#131a26] border border-white/10 shadow-2xl p-1.5 grid grid-cols-2 gap-1">
            {TRANSPORT_OPTIONS.map((o) => (
              <button
                key={o.mode}
                onClick={() => {
                  setOpen(false);
                  onPick(o.mode);
                }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left ${o.mode === current ? 'bg-rose-500/15 text-white' : 'text-slate-200 hover:bg-white/[0.07]'}`}
              >
                <span className="text-base leading-none">{o.glyph}</span>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const DrawToolbar: React.FC<DrawToolbarProps> = ({ project, editTool, activeSegmentIndex, selectedPoint, onPickTransport, onChangeTransportFrom, onPauseAt, onDeletePoint, onClearSelection }) => {
  const seg = project.segments[activeSegmentIndex];
  if (editTool === 'select' || !seg) return null;
  const sel = selectedPoint ? project.segments[selectedPoint.segIdx] : null;
  const isFirstOfLeg = selectedPoint?.idx === 0;
  const isLastOfLeg = !!sel && selectedPoint?.idx === sel.points.length - 1;
  return (
    <div className="absolute top-3 left-3 right-3 flex flex-col gap-2 items-start pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 px-2 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur border border-white/10 shadow-lg">
        {editTool === 'draw' ? (
          <>
            <TransportMenu current={seg.transportMode} label="Travelling by" onPick={onPickTransport} />
            <span className="text-[11px] text-slate-400 pr-1">
              Pick another transport to start a new leg from the last point · click a point for options · Esc to finish
            </span>
          </>
        ) : (
          <span className="text-[11px] text-slate-300 px-1">Click on the route to place a marker · drag markers to move · Esc to finish</span>
        )}
      </div>

      {selectedPoint && sel && (
        <div className="pointer-events-auto flex items-center gap-2 px-2 py-1.5 rounded-xl bg-amber-500/90 text-slate-950 shadow-lg">
          <span className="text-[11px] font-bold px-1">
            Point {selectedPoint.idx + 1} of “{sel.title}”
          </span>
          {!isFirstOfLeg && (
            <TransportMenu current={sel.transportMode} label="Change transport from here" onPick={(m) => onChangeTransportFrom(selectedPoint.segIdx, selectedPoint.idx, m)} />
          )}
          {isFirstOfLeg && selectedPoint.segIdx > 0 && (
            <TransportMenu current={sel.transportMode} label="This leg travels by" onPick={(m) => onChangeTransportFrom(selectedPoint.segIdx, selectedPoint.idx, m)} />
          )}
          <div className="flex items-center gap-1 h-8 px-2 rounded-lg bg-black/15 text-[11px] font-semibold">
            <PauseCircle className="w-3.5 h-3.5" /> Pause here
            {[0.5, 1, 2, 3, 5].map((s) => (
              <button key={s} onClick={() => onPauseAt(selectedPoint.segIdx, selectedPoint.idx, s)} className="px-1.5 py-0.5 rounded-md hover:bg-black/20 font-mono">
                {s}s
              </button>
            ))}
          </div>
          {!(isLastOfLeg && selectedPoint.segIdx < project.segments.length - 1) && (
            <button onClick={() => onDeletePoint(selectedPoint.segIdx, selectedPoint.idx)} className="h-8 px-2 rounded-lg bg-black/15 hover:bg-black/25 text-[11px] font-semibold flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          <button onClick={onClearSelection} className="h-8 w-8 rounded-lg hover:bg-black/20 flex items-center justify-center" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
          <GitBranch className="hidden" />
        </div>
      )}
    </div>
  );
};
