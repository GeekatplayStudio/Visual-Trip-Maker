import React, { useState } from 'react';
import { X } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: 'route',
    title: '1. Draw the route',
    body: (
      <>
        <p>Click <b>Draw route</b> (or press <kbd>D</kbd>) and click on the map to place points. The line follows the shape you chose for the leg: real roads for cars, a flight arc for planes, a smooth curve for boats, trains and walks. You can change the shape per leg in the Route panel.</p>
        <ul>
          <li><b>Drag</b> a point to move it. <b>Right-click</b> a point to delete it.</li>
          <li><b>Click</b> a point to open its menu: change transport from here, pause here, delete.</li>
          <li>Use <b>Find a place</b> in the top bar to fly the map to a city or region before drawing.</li>
          <li>Drop a <b>GPX / KML</b> file from your watch or phone through Project → Import.</li>
          <li>Press <kbd>Esc</kbd> when you are done.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'legs',
    title: '2. Change the transport along the way',
    body: (
      <>
        <p>A trip is one continuous line made of <b>legs</b>. Each leg has its own vehicle, path shape, speed, colour and line style. Say you drive to the airport, fly, take a taxi and then a train:</p>
        <ol>
          <li>Draw the drive with <b>Car</b> selected in the drawing toolbar.</li>
          <li>At the airport, pick <b>Plane</b> in the <b>Travelling by</b> menu. The next points you click start a new leg from the airport, and the line becomes a flight arc.</li>
          <li>At the destination pick <b>Car</b> again for the taxi, then <b>Train</b>, and keep clicking.</li>
        </ol>
        <p>Forgot a change? Click the point where it happens and choose <b>Change transport from here</b>: the leg is split there. A badge with the vehicle appears on the line at the start of every leg while you edit, and the timeline shows one coloured block per leg.</p>
        <p>In the video, the line <b>pauses at every transport change</b> while the camera glides to that transport's zoom (set under Camera → Zoom per transport) and the symbol swaps. Add a marker there if you also want a sign or a story card.</p>
      </>
    ),
  },
  {
    id: 'markers',
    title: '3. Markers, pauses and story cards',
    body: (
      <>
        <p>Click <b>Add marker</b> (<kbd>M</kbd>) and click on the route. A marker can be a pin, dot, flag, polaroid photo or plain text, with an icon and colour. <b>Pop in on arrival</b> keeps it hidden until the line reaches it.</p>
        <p><b>Pause at this stop</b> stops the line for a moment, and <b>Show story card</b> shows a card with title, subtitle and photo. To pause without any sign, click a point of the route and choose <b>Pause here</b>.</p>
      </>
    ),
  },
  {
    id: 'camera',
    title: '4. Camera',
    body: (
      <>
        <ul>
          <li><b>Pace.</b> With <b>Auto length</b> (the default) every vehicle crosses the frame at the same comfortable pace and the video length follows: choose Slow, Normal or Fast below the timeline. <b>Fixed length</b> lets you set the travel time instead; very long legs are then framed wider so they stay readable.</li>
          <li><b>Follow the line</b> keeps the symbol in view. <b>Auto</b> zoom frames every leg on its own: walking very close, cars and buses a little further out, trains and boats wider, flights wide. <b>Zoom per transport</b> fine-tunes it. Choose north-up, direction of travel or a fixed angle, how far the camera looks ahead, how steady it is and the tilt. Start and end on the <b>whole route</b> add an intro zoom-in and an outro pull-back.</li>
          <li><b>Start to end</b> glides between two shots you save from the map. The quick moves set both shots for you.</li>
          <li><b>Fixed view</b> films one saved view.</li>
        </ul>
        <p>The camera is computed from the timeline, so the exported video is exactly what the preview shows.</p>
      </>
    ),
  },
  {
    id: 'look',
    title: '5. Look and sound',
    body: (
      <>
        <p>Pick a basemap in <b>Style</b>; vector maps stay crisp at any zoom and export sharp. Add 3D terrain and hillshade, hide map labels, and choose the symbol at the tip: shaded flat symbol, 3D model or none. <b>Line thickness</b> scales every leg at once; each leg also has its own width and colour in Route.</p>
        <p>Sound: the speaker button in the top bar plays a synthesised engine for the preview. Tick <b>Include sound</b> in the export dialog to render the same sound into the MP4.</p>
      </>
    ),
  },
  {
    id: 'export',
    title: '6. Export',
    body: (
      <>
        <p><b>Export video</b> renders every frame in your browser and encodes an MP4 (H.264) at 720p to 4K, landscape, vertical or square, 24 / 30 / 60 fps. Nothing is uploaded. Keep the tab visible while it renders. Browsers without WebCodecs (Firefox, Safari) get a WebM instead.</p>
        <p>Projects are saved in this browser automatically. Use Project → Save project file to keep a copy, and Open project file to load it again or to open a Map Animator <code>.mapanim</code> file.</p>
      </>
    ),
  },
  {
    id: 'about',
    title: 'About',
    body: (
      <>
        <p><b>Visual Trip Maker</b> turns a route into a smooth animated map video, entirely in your browser.</p>
        <p>© 2026 Geekatplay Studio · Vladimir Chopine. All rights reserved.</p>
        <p>Map data © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap, Esri, OpenTopoMap and Mapzen / AWS Terrain Tiles. Please respect the usage policies of these services.</p>
      </>
    ),
  },
  {
    id: 'keys',
    title: 'Keyboard',
    body: (
      <table className="text-xs">
        <tbody>
          {[
            ['Space', 'play / pause'],
            ['D / M', 'draw route / place marker'],
            ['Esc', 'back to preview, close menus'],
            ['← →', 'step one frame (Shift: one second)'],
            ['Home / End', 'start / end'],
            ['Delete', 'delete the selected marker or point'],
            ['Ctrl+Z', 'undo'],
          ].map(([k, v]) => (
            <tr key={k}>
              <td className="pr-4 py-0.5"><kbd>{k}</kbd></td>
              <td className="py-0.5 text-slate-300">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
];

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const [active, setActive] = useState('route');
  if (!isOpen) return null;
  const section = SECTIONS.find((s) => s.id === active) || SECTIONS[0];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl h-[min(640px,90vh)] rounded-2xl bg-[#131a26] border border-white/10 shadow-2xl flex overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <nav className="w-56 shrink-0 border-r border-white/10 p-3 flex flex-col gap-1 bg-black/20">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-2 py-1">Help</div>
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setActive(s.id)} className={`text-left text-xs px-2.5 py-2 rounded-lg transition-colors ${active === s.id ? 'bg-rose-500/15 text-white' : 'text-slate-300 hover:bg-white/[0.06]'}`}>
              {s.title}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-bold">{section.title}</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
          </div>
          <div className="help-body flex-1 overflow-y-auto px-6 py-4 text-sm text-slate-200 leading-relaxed">{section.body}</div>
        </div>
      </div>
    </div>
  );
};
