import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Download, Loader2, Monitor, Smartphone, Square, Video, X } from 'lucide-react';
import type { AspectRatio, ExportProgress, ResolutionPreset } from '../types';
import { getExportDimensions, hasWebCodecs } from '../services/videoExporter';
import { hasAudioEncoder } from '../services/soundtrack';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  aspectRatio: AspectRatio;
  totalSeconds: number;
  onStartExport: (res: ResolutionPreset, fps: number, aspect: AspectRatio, withSound: boolean) => void;
  onCancel: () => void;
  exportProgress: ExportProgress;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, aspectRatio: initialAspect, totalSeconds, onStartExport, onCancel, exportProgress }) => {
  const [resolution, setResolution] = useState<ResolutionPreset>('1080p');
  const [fps, setFps] = useState(60);
  const [aspect, setAspect] = useState<AspectRatio>(initialAspect);
  const [withSound, setWithSound] = useState(false);
  if (!isOpen) return null;

  const { width, height } = getExportDimensions(aspect, resolution);
  const totalFrames = Math.round(totalSeconds * fps);
  const webcodecs = hasWebCodecs();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-[#131a26] border border-white/10 shadow-2xl p-6 flex flex-col gap-5 relative">
        {!exportProgress.isExporting && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
        )}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-300 flex items-center justify-center"><Video className="w-5 h-5" /></div>
          <div>
            <h2 className="text-lg font-bold">Export video</h2>
            <p className="text-xs text-slate-400">Every frame is rendered and encoded in your browser. Nothing is uploaded.</p>
          </div>
        </div>

        {!exportProgress.isExporting && !exportProgress.downloadUrl && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="label">Format</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '16:9', label: 'Landscape', desc: 'YouTube', icon: <Monitor className="w-4 h-4" /> },
                  { id: '9:16', label: 'Vertical', desc: 'Reels · Shorts · TikTok', icon: <Smartphone className="w-4 h-4" /> },
                  { id: '1:1', label: 'Square', desc: 'Feed', icon: <Square className="w-4 h-4" /> },
                ].map((o) => (
                  <button key={o.id} onClick={() => setAspect(o.id as AspectRatio)} className={`opt ${aspect === o.id ? 'opt-on' : ''}`}>
                    <span className="text-rose-300">{o.icon}</span>
                    <span className="text-xs font-bold text-white">{o.label}</span>
                    <span className="text-[10px] text-slate-400">{o.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label">Resolution</div>
              <div className="grid grid-cols-4 gap-2">
                {(['720p', '1080p', '1440p', '4k'] as ResolutionPreset[]).map((r) => (
                  <button key={r} onClick={() => setResolution(r)} className={`opt !py-2 ${resolution === r ? 'opt-on' : ''}`}>
                    <span className="text-xs font-bold text-white font-mono">{r.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label">Frame rate</div>
              <div className="grid grid-cols-3 gap-2">
                {[24, 30, 60].map((f) => (
                  <button key={f} onClick={() => setFps(f)} className={`opt !py-2 ${fps === f ? 'opt-on' : ''}`}>
                    <span className="text-xs font-bold text-white font-mono">{f} fps</span>
                  </button>
                ))}
              </div>
            </div>
            <label className={`flex items-center gap-3 rounded-xl border border-white/10 p-3 cursor-pointer ${hasAudioEncoder() && webcodecs ? 'bg-white/[0.03]' : 'opacity-50 cursor-not-allowed'}`}>
              <input type="checkbox" checked={withSound} disabled={!hasAudioEncoder() || !webcodecs} onChange={(e) => setWithSound(e.target.checked)} className="accent-rose-500 w-4 h-4" />
              <div>
                <div className="text-xs font-bold text-white">Include sound</div>
                <div className="text-[10px] text-slate-400">Synthesised engine / wind per transport, a whoosh at changes and a chime at every stop, mixed into the MP4.</div>
              </div>
            </label>
            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3 text-xs text-slate-300 flex flex-col gap-1">
              <div className="flex justify-between"><span>Output</span><span className="font-mono text-white">{width} × {height} · {webcodecs ? 'MP4 (H.264)' : 'WebM'}</span></div>
              <div className="flex justify-between"><span>Length</span><span className="font-mono text-white">{totalSeconds.toFixed(1)} s · {totalFrames} frames</span></div>
              {!webcodecs && <div className="text-amber-300 mt-1">This browser has no WebCodecs. The export will be a WebM recorded in real time; use Chrome or Edge for frame-exact MP4.</div>}
            </div>
            <button onClick={() => onStartExport(resolution, fps, aspect, withSound)} className="w-full py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm shadow-lg shadow-rose-500/25">
              Render video
            </button>
          </div>
        )}

        {exportProgress.isExporting && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="relative">
              <Loader2 className="w-12 h-12 text-rose-400 animate-spin" />
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold font-mono">{exportProgress.progressPercent}%</span>
            </div>
            <div>
              <div className="text-sm font-semibold">{exportProgress.statusText}</div>
              <div className="text-xs text-slate-400 font-mono mt-1">frame {exportProgress.currentFrame} / {exportProgress.totalFrames}</div>
            </div>
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-rose-400 transition-all" style={{ width: `${exportProgress.progressPercent}%` }} />
            </div>
            <p className="text-[11px] text-slate-500">Keep this tab visible while rendering. The preview will show each frame as it is captured.</p>
            <button onClick={onCancel} className="text-xs text-slate-400 hover:text-white underline">Cancel</button>
          </div>
        )}

        {exportProgress.downloadUrl && !exportProgress.isExporting && (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center"><CheckCircle className="w-8 h-8" /></div>
            <div>
              <div className="text-base font-bold">Your video is ready</div>
              <div className="text-xs text-slate-400 mt-1">{exportProgress.fileName}</div>
            </div>
            <a href={exportProgress.downloadUrl} download={exportProgress.fileName} className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2">
              <Download className="w-4 h-4" /> Download
            </a>
            <button onClick={onClose} className="text-xs text-slate-400 hover:text-white underline">Back to the editor</button>
          </div>
        )}

        {exportProgress.error && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {exportProgress.error}
          </div>
        )}
      </div>
    </div>
  );
};
