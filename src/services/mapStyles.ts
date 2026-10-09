import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapTheme } from '../types';

export const DEM_SOURCE_ID = 'terrain-dem';
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const DEM_SOURCE: SourceSpecification = {
  type: 'raster-dem',
  tiles: [
    'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
    'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  ],
  tileSize: 256,
  encoding: 'terrarium',
  minzoom: 0,
  maxzoom: 15,
  attribution: 'Terrain: Mapzen / AWS Terrain Tiles',
};

export interface ThemeInfo {
  id: MapTheme;
  label: string;
  desc: string;
  /** small swatch colours for the UI */
  swatch: [string, string, string];
  /** default route colour that reads well on this theme */
  routeColor: string;
  /** colour for the story cards / HUD accent */
  accent: string;
  dark: boolean;
  /** OpenFreeMap vector style URL, or undefined for raster themes */
  vectorUrl?: string;
  kind: 'vector' | 'raster';
  hillshadeShadow: string;
  hillshadeHighlight: string;
  hillshadeAccent: string;
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'light',
    label: 'Minimal light',
    desc: 'Soft greys, quiet labels. Lets the route shine.',
    swatch: ['#f2f3f0', '#c2c8ca', '#d9dad7'],
    routeColor: '#e63946',
    accent: '#e63946',
    dark: false,
    vectorUrl: 'https://tiles.openfreemap.org/styles/positron',
    kind: 'vector',
    hillshadeShadow: '#5a5f66',
    hillshadeHighlight: '#ffffff',
    hillshadeAccent: '#8a9099',
  },
  {
    id: 'dark',
    label: 'Minimal dark',
    desc: 'Charcoal basemap. Great with bright glowing routes.',
    swatch: ['#1b1f23', '#2d3338', '#3d4852'],
    routeColor: '#38bdf8',
    accent: '#38bdf8',
    dark: true,
    vectorUrl: 'https://tiles.openfreemap.org/styles/dark',
    kind: 'vector',
    hillshadeShadow: '#05070a',
    hillshadeHighlight: '#6b7785',
    hillshadeAccent: '#1e2a3a',
  },
  {
    id: 'streets',
    label: 'Streets',
    desc: 'Full detail street map with roads, parks and water.',
    swatch: ['#f8f4f0', '#a8d5a2', '#9ec5e8'],
    routeColor: '#e63946',
    accent: '#e63946',
    dark: false,
    vectorUrl: 'https://tiles.openfreemap.org/styles/liberty',
    kind: 'vector',
    hillshadeShadow: '#4b5563',
    hillshadeHighlight: '#ffffff',
    hillshadeAccent: '#6b7280',
  },
  {
    id: 'bright',
    label: 'Bright',
    desc: 'Vivid, colourful cartography.',
    swatch: ['#f8f8f8', '#b7e0a5', '#a4c8f0'],
    routeColor: '#d946ef',
    accent: '#d946ef',
    dark: false,
    vectorUrl: 'https://tiles.openfreemap.org/styles/bright',
    kind: 'vector',
    hillshadeShadow: '#4b5563',
    hillshadeHighlight: '#ffffff',
    hillshadeAccent: '#6b7280',
  },
  {
    id: 'fiord',
    label: 'Fiord',
    desc: 'Deep blue-teal tones. Moody and cinematic.',
    swatch: ['#1f3b4d', '#2f5466', '#5f8ca3'],
    routeColor: '#fbbf24',
    accent: '#fbbf24',
    dark: true,
    vectorUrl: 'https://tiles.openfreemap.org/styles/fiord',
    kind: 'vector',
    hillshadeShadow: '#06141c',
    hillshadeHighlight: '#8fb3c4',
    hillshadeAccent: '#1f3b4d',
  },
  {
    id: 'parchment',
    label: 'Treasure map',
    desc: 'Buff paper, blue water, brown ink. Old explorer feel.',
    swatch: ['#efe3b8', '#a8cfe4', '#8a6a3c'],
    routeColor: '#b3261e',
    accent: '#b3261e',
    dark: false,
    vectorUrl: 'https://tiles.openfreemap.org/styles/positron',
    kind: 'vector',
    hillshadeShadow: '#5c4322',
    hillshadeHighlight: '#fff6dd',
    hillshadeAccent: '#8a6a3c',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    desc: 'Esri world imagery. Best with 3D terrain and a flyover camera.',
    swatch: ['#2f4a2a', '#5d6b3f', '#1d3550'],
    routeColor: '#fde047',
    accent: '#fde047',
    dark: true,
    kind: 'raster',
    hillshadeShadow: '#0b1329',
    hillshadeHighlight: '#ffffff',
    hillshadeAccent: '#38bdf8',
  },
  {
    id: 'outdoor',
    label: 'Topographic',
    desc: 'OpenTopoMap contours and trails. For hikes.',
    swatch: ['#eef1dc', '#c6d7a6', '#b4c8e0'],
    routeColor: '#dc2626',
    accent: '#dc2626',
    dark: false,
    kind: 'raster',
    hillshadeShadow: '#14532d',
    hillshadeHighlight: '#fef9c3',
    hillshadeAccent: '#4d7c0f',
  },
];

export const themeInfo = (id: MapTheme): ThemeInfo => THEMES.find((t) => t.id === id) || THEMES[0];

const styleCache = new Map<string, StyleSpecification>();

// --- sepia tinting for the "treasure map" theme ---------------------------
function parseColor(c: string): [number, number, number, number] | null {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1];
  m = c.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    const h = +m[1] / 360;
    const s = +m[2] / 100;
    const l = +m[3] / 100;
    const a = m[4] !== undefined ? +m[4] : 1;
    const hue = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let r: number, g: number, b: number;
    if (s === 0) r = g = b = l;
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue(p, q, h + 1 / 3);
      g = hue(p, q, h);
      b = hue(p, q, h - 1 / 3);
    }
    return [r * 255, g * 255, b * 255, a];
  }
  return null;
}

const PAPER = [239, 227, 184];
const INK = [96, 68, 36];
const WATER = [168, 207, 228];
const WATER_DEEP = [120, 170, 200];

function tintTo(c: string, light: number[], dark: number[], gamma = 0.9): string {
  const p = parseColor(c);
  if (!p) return c;
  const [r, g, b, a] = p;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const k = Math.pow(lum, gamma);
  const out = light.map((lv, i) => Math.round(dark[i] + (lv - dark[i]) * k));
  return `rgba(${out[0]},${out[1]},${out[2]},${a})`;
}

function tintValue(v: unknown, light: number[], dark: number[]): unknown {
  if (typeof v === 'string') return tintTo(v, light, dark);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' && parseColor(x) ? tintTo(x, light, dark) : Array.isArray(x) ? tintValue(x, light, dark) : x));
  return v;
}

/** "Treasure map": buff paper, blue water, brown ink. */
function applyParchment(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((l) => {
    const layer = { ...l } as LayerSpecification & { paint?: Record<string, unknown>; 'source-layer'?: string };
    const id = layer.id.toLowerCase();
    const srcLayer = (layer['source-layer'] || '').toLowerCase();
    const isWater = /water|ocean|sea|river|lake/.test(id + ' ' + srcLayer) && layer.type !== 'symbol';
    if (layer.type === 'background') {
      layer.paint = { ...(layer.paint || {}), 'background-color': `rgb(${PAPER.join(',')})` };
      return layer as LayerSpecification;
    }
    if (layer.paint) {
      const paint: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(layer.paint)) {
        if (!/color/.test(k)) {
          paint[k] = v;
          continue;
        }
        if (isWater) paint[k] = layer.type === 'line' ? `rgb(${WATER_DEEP.join(',')})` : `rgb(${WATER.join(',')})`;
        else if (layer.type === 'symbol' && k === 'text-color') paint[k] = 'rgb(77,56,30)';
        else if (layer.type === 'symbol' && k === 'text-halo-color') paint[k] = 'rgba(243,233,200,0.9)';
        else paint[k] = tintValue(v, PAPER, INK);
      }
      if (layer.type === 'line' && !isWater && !('line-opacity' in paint)) paint['line-opacity'] = 0.75;
      layer.paint = paint;
    }
    return layer as LayerSpecification;
  });
  return { ...style, layers };
}

// --------------------------------------------------------------------------

function rasterStyle(theme: ThemeInfo): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  if (theme.id === 'satellite') {
    sources['esri-satellite'] = {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
      maxzoom: 19,
    };
    layers.push({ id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } });
    layers.push({ id: 'base-raster', type: 'raster', source: 'esri-satellite', paint: { 'raster-saturation': 0.05, 'raster-contrast': 0.05 } });
  } else {
    sources['opentopo'] = {
      type: 'raster',
      tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors',
      maxzoom: 17,
    };
    layers.push({ id: 'background', type: 'background', paint: { 'background-color': '#eef1dc' } });
    layers.push({ id: 'base-raster', type: 'raster', source: 'opentopo' });
  }
  sources[DEM_SOURCE_ID] = DEM_SOURCE;
  return { version: 8, glyphs: GLYPHS_URL, sources, layers };
}

/** Resolve the full style spec for a theme (cached). Always contains the DEM source and glyphs. */
export async function loadThemeStyle(id: MapTheme): Promise<StyleSpecification> {
  const theme = themeInfo(id);
  const cached = styleCache.get(id);
  if (cached) return cached;

  let style: StyleSpecification;
  if (theme.kind === 'raster' || !theme.vectorUrl) {
    style = rasterStyle(theme);
  } else {
    const res = await fetch(theme.vectorUrl);
    if (!res.ok) throw new Error(`Failed to load basemap style (${res.status})`);
    style = (await res.json()) as StyleSpecification;
    style = { ...style, sources: { ...style.sources, [DEM_SOURCE_ID]: DEM_SOURCE } };
    if (!style.glyphs) style.glyphs = GLYPHS_URL;
    if (id === 'parchment') style = applyParchment(style);
  }
  styleCache.set(id, style);
  return style;
}

/** Ids of label (symbol) layers in a base style, so we can hide them. */
export function labelLayerIds(style: StyleSpecification): string[] {
  return style.layers.filter((l) => l.type === 'symbol').map((l) => l.id);
}

/** Id of the first symbol layer – route layers are inserted beneath it so labels stay readable. */
export function firstSymbolLayerId(style: StyleSpecification): string | undefined {
  return style.layers.find((l) => l.type === 'symbol')?.id;
}
