import React, { useRef, useState } from 'react';
import { ArrowLeftRight, CircleHelp, Download, FilePlus2, FolderOpen, Maximize2, Monitor, MousePointer2, PenLine, MapPin, Save, Search, Smartphone, Square, Undo2, Upload, Video, Volume2, VolumeX, ChevronDown } from 'lucide-react';
import type { AspectRatio, EditTool, RouteProject } from '../types';
import { PRESET_LIST, PRESET_PROJECTS, makeSegment, makeWaypoint, uid } from '../services/presets';
import { parseGPX, parseKML } from '../services/geoUtils';
import { themeInfo } from '../services/mapStyles';
import { importMapanim, isMapanimFile } from '../services/mapanimImport';
import { exportPhotos, importPhotos, localizeDataUrl } from '../services/photoStore';

interface HeaderProps {
  project: RouteProject;
  editTool: EditTool;
  onEditToolChange: (tool: EditTool) => void;
  onUpdateProject: (updater: (prev: RouteProject) => RouteProject) => void;
  onLoadProject: (p: RouteProject) => void;
  onNewProject: () => void;
  onOpenExport: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onFitRoute: () => void;
  onToast: (msg: string) => void;
  onReverseRoute: () => void;
  onSearchPlace: (q: string) => void;
  onOpenHelp: () => void;
}

const IconBtn: React.FC<{ title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode; label?: string }> = ({ title, onClick, active, disabled, children, label }) => (
  <button
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={`h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-colors border ${
      active ? 'bg-rose-500/20 border-rose-400/60 text-rose-200' : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.08] hover:text-white'
    } disabled:opacity-40 disabled:cursor-not-allowed`}
  >
    {children}
    {label && <span className="hidden lg:inline">{label}</span>}
  </button>
);

export const Header: React.FC<HeaderProps> = ({ project, editTool, onEditToolChange, onUpdateProject, onLoadProject, onNewProject, onOpenExport, onUndo, canUndo, onFitRoute, onToast, onReverseRoute, onSearchPlace, onOpenHelp }) => {
  const [query, setQuery] = useState('');
  const gpxInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const importTrack = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '');
      const parsed = file.name.toLowerCase().endsWith('.kml') ? parseKML(text) : parseGPX(text);
      if (parsed.coordinates.length < 2) {
        onToast('No track found in that file.');
        return;
      }
      onUpdateProject((prev) => {
        const theme = themeInfo(prev.mapTheme);
        const seg = makeSegment({
          title: file.name.replace(/\.[^.]+$/, ''),
          transportMode: 'sports_car',
          routing: 'straight',
          points: parsed.coordinates,
          coordinates: parsed.coordinates,
          color: theme.routeColor,
          speedKmh: 60,
        });
        const waypoints = parsed.waypoints.map((w, i) => makeWaypoint({ ...w, title: w.title || `Stop ${i + 1}`, lng: w.lng!, lat: w.lat!, color: theme.accent, dwellTime: 1.5 }));
        return { ...prev, name: seg.title, segments: [seg], waypoints: waypoints.length ? waypoints : prev.waypoints };
      });
      onToast(`Imported ${parsed.coordinates.length} track points${parsed.waypoints.length ? ` and ${parsed.waypoints.length} markers` : ''}.`);
    };
    reader.readAsText(file);
  };

  const openJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(async (txt) => {
      try {
        const raw = JSON.parse(txt) as unknown;
        if (isMapanimFile(raw)) {
          const sceneCount = raw.project.scenes.length;
          let sceneIndex = 0;
          if (sceneCount > 1) {
            const answer = window.prompt(`This Map Animator file has ${sceneCount} scenes. Which scene do you want to open? (1-${sceneCount})`, '1');
            if (answer === null) return;
            sceneIndex = Math.max(0, Math.min(sceneCount - 1, (parseInt(answer, 10) || 1) - 1));
          }
          const res = importMapanim(raw, sceneIndex);
          // keep the embedded photos in browser storage instead of inside the project
          const waypoints = await Promise.all(
            res.project.waypoints.map(async (w) => (w.photoUrl?.startsWith('data:') ? { ...w, photoUrl: await localizeDataUrl(w.photoUrl).catch(() => w.photoUrl) } : w)),
          );
          onLoadProject({ ...res.project, waypoints });
          onToast(sceneCount > 1 ? `Imported “${res.sceneName}” from the Map Animator file.` : 'Imported the Map Animator project.');
          return;
        }
        const { photos, ...p } = raw as RouteProject & { photos?: Record<string, string> };
        if (!Array.isArray(p.segments)) throw new Error('bad');
        if (photos) await importPhotos(photos);
        onLoadProject({ ...PRESET_PROJECTS.european_voyage, ...p, id: uid('project') });
        onToast(`Opened “${p.name}”.`);
      } catch {
        onToast('That file is not a Visual Trip Maker (.json) or .mapanim project.');
      }
    });
  };

  const saveJson = async () => {
    // uploaded photos travel inside the project file
    const photos = await exportPhotos(project.waypoints.map((w) => w.photoUrl || ''));
    const data = Object.keys(photos).length ? { ...project, photos } : project;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w-]+/g, '_') || 'trip'}.visualtrip.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <header className="h-14 shrink-0 px-3 flex items-center gap-3 border-b border-white/10 bg-[#0e131c] relative z-30">
      {/* brand + project name */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-orange-400 flex items-center justify-center shadow-lg shadow-rose-500/20">
          <svg viewBox="0 0 64 64" className="w-5 h-5">
            <path d="M12 46 C 22 20, 34 50, 50 18" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
            <circle cx="50" cy="18" r="7" fill="#fff" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold leading-none">Visual Trip Maker</div>
          <input
            value={project.name}
            onChange={(e) => onUpdateProject((p) => ({ ...p, name: e.target.value }))}
            className="bg-transparent text-sm font-bold text-white outline-none w-44 truncate border-b border-transparent focus:border-white/30"
            title="Project name"
          />
        </div>
      </div>

      {/* file menu */}
      <div className="relative">
        <IconBtn title="Project" onClick={() => setMenuOpen((o) => !o)} active={menuOpen}>
          <FolderOpen className="w-4 h-4" />
          <span>Project</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </IconBtn>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-0 top-10 z-50 w-64 rounded-xl bg-[#131a26] border border-white/10 shadow-2xl p-1.5 text-sm">
              <button className="menu-item" onClick={() => { setMenuOpen(false); onNewProject(); }}><FilePlus2 className="w-4 h-4" /> New empty trip</button>
              <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Templates</div>
              {PRESET_LIST.map((p) => (
                <button key={p.key} className="menu-item" onClick={() => { setMenuOpen(false); onLoadProject(PRESET_PROJECTS[p.key]); }}>
                  <span className="w-4 h-4 inline-flex items-center justify-center text-rose-400">★</span> {p.label}
                </button>
              ))}
              <div className="h-px bg-white/10 my-1.5" />
              <button className="menu-item" onClick={() => { setMenuOpen(false); gpxInput.current?.click(); }}><Upload className="w-4 h-4" /> Import GPX / KML track…</button>
              <button className="menu-item" onClick={() => { setMenuOpen(false); jsonInput.current?.click(); }}><FolderOpen className="w-4 h-4" /> Open project file… <span className="text-[10px] text-slate-500 ml-auto">.json · .mapanim</span></button>
              <button className="menu-item" onClick={() => { setMenuOpen(false); saveJson(); }}><Save className="w-4 h-4" /> Save project file</button>
              <div className="h-px bg-white/10 my-1.5" />
              <button className="menu-item" onClick={() => { setMenuOpen(false); onReverseRoute(); }}><ArrowLeftRight className="w-4 h-4" /> Reverse route</button>
            </div>
          </>
        )}
        <input ref={gpxInput} type="file" accept=".gpx,.kml" className="hidden" onChange={importTrack} />
        <input ref={jsonInput} type="file" accept=".json,.mapanim,application/json" className="hidden" onChange={openJson} />
      </div>

      {/* tools */}
      <div className="flex items-center gap-1 pl-3 ml-1 border-l border-white/10">
        <IconBtn title="Select / preview (Esc)" onClick={() => onEditToolChange('select')} active={editTool === 'select'} label="Preview">
          <MousePointer2 className="w-4 h-4" />
        </IconBtn>
        <IconBtn title="Draw route points (D)" onClick={() => onEditToolChange(editTool === 'draw' ? 'select' : 'draw')} active={editTool === 'draw'} label="Draw route">
          <PenLine className="w-4 h-4" />
        </IconBtn>
        <IconBtn title="Place markers (M)" onClick={() => onEditToolChange(editTool === 'marker' ? 'select' : 'marker')} active={editTool === 'marker'} label="Add marker">
          <MapPin className="w-4 h-4" />
        </IconBtn>
        <IconBtn title="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
          <Undo2 className="w-4 h-4" />
        </IconBtn>
        <IconBtn title="Frame the whole route" onClick={onFitRoute}>
          <Maximize2 className="w-4 h-4" />
        </IconBtn>
      </div>

      {/* place search */}
      <form
        className="hidden md:flex items-center h-9 pl-2.5 pr-1 rounded-lg bg-white/[0.03] border border-white/10 focus-within:border-rose-400/60"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchPlace(query);
        }}
      >
        <Search className="w-3.5 h-3.5 text-slate-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a place…" className="bg-transparent outline-none text-xs text-white placeholder:text-slate-500 px-2 w-36" title="Find a city, peak or lake and fly there" />
      </form>

      <div className="flex-1" />

      {/* aspect */}
      <div className="flex items-center bg-white/[0.03] rounded-lg p-0.5 border border-white/10">
        {(['16:9', '9:16', '1:1'] as AspectRatio[]).map((a) => (
          <button
            key={a}
            onClick={() => onUpdateProject((p) => ({ ...p, aspectRatio: a }))}
            title={`Aspect ratio ${a}`}
            className={`h-8 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors ${project.aspectRatio === a ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
          >
            {a === '16:9' && <Monitor className="w-3.5 h-3.5" />}
            {a === '9:16' && <Smartphone className="w-3.5 h-3.5" />}
            {a === '1:1' && <Square className="w-3.5 h-3.5" />}
            {a}
          </button>
        ))}
      </div>

      <IconBtn title="Help and tips" onClick={onOpenHelp}>
        <CircleHelp className="w-4 h-4" />
      </IconBtn>

      <IconBtn title={project.soundEnabled ? 'Mute' : 'Enable sound'} onClick={() => onUpdateProject((p) => ({ ...p, soundEnabled: !p.soundEnabled }))} active={project.soundEnabled}>
        {project.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </IconBtn>

      <button onClick={onOpenExport} className="h-9 px-4 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-rose-500/25 transition-colors">
        <Video className="w-4 h-4" />
        Export video
        <Download className="w-3.5 h-3.5 opacity-70" />
      </button>
    </header>
  );
};
