import type { MarkerStyle, TransportMode } from '../types';

export interface MarkerIconDef {
  key: string;
  label: string;
  glyph: string;
}

export const MARKER_ICONS: MarkerIconDef[] = [
  { key: 'dot', label: 'Plain', glyph: '' },
  { key: 'flag', label: 'Flag', glyph: '🚩' },
  { key: 'finish', label: 'Finish', glyph: '🏁' },
  { key: 'city', label: 'City', glyph: '🏙️' },
  { key: 'home', label: 'Home', glyph: '🏠' },
  { key: 'hotel', label: 'Hotel', glyph: '🏨' },
  { key: 'camera', label: 'Photo spot', glyph: '📷' },
  { key: 'food', label: 'Food', glyph: '🍽️' },
  { key: 'coffee', label: 'Coffee', glyph: '☕' },
  { key: 'beach', label: 'Beach', glyph: '🏖️' },
  { key: 'mountain', label: 'Mountain', glyph: '⛰️' },
  { key: 'tent', label: 'Camp', glyph: '⛺' },
  { key: 'museum', label: 'Museum', glyph: '🏛️' },
  { key: 'castle', label: 'Castle', glyph: '🏰' },
  { key: 'plane', label: 'Airport', glyph: '✈️' },
  { key: 'train', label: 'Station', glyph: '🚆' },
  { key: 'car', label: 'Car', glyph: '🚗' },
  { key: 'ship', label: 'Harbour', glyph: '⚓' },
  { key: 'bike', label: 'Bike', glyph: '🚴' },
  { key: 'hike', label: 'Hike', glyph: '🥾' },
  { key: 'fuel', label: 'Fuel', glyph: '⛽' },
  { key: 'wrench', label: 'Repair', glyph: '🔧' },
  { key: 'warning', label: 'Trouble', glyph: '⚠️' },
  { key: 'star', label: 'Highlight', glyph: '⭐' },
  { key: 'heart', label: 'Favourite', glyph: '❤️' },
];

export const iconGlyph = (key: string): string => MARKER_ICONS.find((i) => i.key === key)?.glyph ?? '';

export const VEHICLE_GLYPHS: Record<TransportMode, string> = {
  airplane: '✈️',
  propeller: '🛩️',
  sports_car: '🏎️',
  suv: '🚙',
  camper: '🚐',
  bus: '🚌',
  bullet_train: '🚄',
  steam_train: '🚂',
  motorcycle: '🏍️',
  yacht: '🛥️',
  ferry: '⛴️',
  hiker: '🥾',
  bicycle: '🚴',
  helicopter: '🚁',
  balloon: '🎈',
};

export const MARKER_COLORS = ['#e63946', '#f4a261', '#fbbf24', '#2a9d8f', '#38bdf8', '#3b82f6', '#8b5cf6', '#ec4899', '#0f172a', '#ffffff'];

const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

export interface RenderedIcon {
  data: ImageData;
  width: number;
  height: number;
  pixelRatio: number;
  /** anchor for the symbol layer */
  anchor: 'bottom' | 'center';
}

function makeCanvas(w: number, h: number, pr: number) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * pr);
  c.height = Math.round(h * pr);
  // CPU-backed: these canvases are read back with getImageData, which is slow on GPU canvases
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(pr, pr);
  return { c, ctx };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGlyph(ctx: CanvasRenderingContext2D, glyph: string, cx: number, cy: number, size: number) {
  if (!glyph) return;
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(glyph, cx, cy + size * 0.06);
}

function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((x) => x + x).join('') : m;
  const n = parseInt(full.slice(0, 6), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

export function isLightColor(hex: string): boolean {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((x) => x + x).join('') : m;
  const n = parseInt(full.slice(0, 6), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255;
  return lum > 0.7;
}

/** Teardrop pin with a white disc holding an icon. */
function renderPin(color: string, glyph: string, pr: number): RenderedIcon {
  const W = 56;
  const H = 72;
  const { c, ctx } = makeCanvas(W, H, pr);
  const cx = W / 2;
  const r = 20;
  const cy = 24;
  // shadow blob on the ground
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.filter = 'blur(3px)';
  ctx.beginPath();
  ctx.ellipse(cx, H - 6, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // body
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.25, false);
  ctx.lineTo(cx, H - 8);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(color, 18));
  grad.addColorStop(1, shade(color, -28));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = isLightColor(color) ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.25, false);
  ctx.lineTo(cx, H - 8);
  ctx.closePath();
  ctx.stroke();
  // inner disc
  ctx.beginPath();
  ctx.arc(cx, cy, 13.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (glyph) drawGlyph(ctx, glyph, cx, cy, 17);
  else {
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'bottom' };
}

/** Small ring dot (for subtle markers). */
function renderDot(color: string, glyph: string, pr: number): RenderedIcon {
  const S = glyph ? 40 : 28;
  const { c, ctx } = makeCanvas(S, S, pr);
  const cx = S / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(cx, cx, S / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cx, S / 2 - 3, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (glyph) drawGlyph(ctx, glyph, cx, cx, 18);
  else {
    ctx.beginPath();
    ctx.arc(cx, cx, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'center' };
}

/** Flag on a pole. */
function renderFlag(color: string, glyph: string, pr: number): RenderedIcon {
  const W = 52;
  const H = 66;
  const { c, ctx } = makeCanvas(W, H, pr);
  const px = 10;
  // ground shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.filter = 'blur(2.5px)';
  ctx.beginPath();
  ctx.ellipse(px + 2, H - 5, 9, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // pole
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(px, 6);
  ctx.lineTo(px, H - 6);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(px, 6);
  ctx.lineTo(px, H - 6);
  ctx.stroke();
  // flag
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.moveTo(px + 1, 7);
  ctx.lineTo(W - 4, 7);
  ctx.lineTo(W - 12, 20);
  ctx.lineTo(W - 4, 33);
  ctx.lineTo(px + 1, 33);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  if (glyph) drawGlyph(ctx, glyph, px + 16, 20, 15);
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'bottom' };
}

export function renderMarkerIcon(style: MarkerStyle, iconKey: string, color: string, pr = 2): RenderedIcon {
  const glyph = iconGlyph(iconKey);
  switch (style) {
    case 'dot':
    case 'label':
      return renderDot(color, style === 'label' ? '' : glyph, pr);
    case 'flag':
      return renderFlag(color, glyph === '🚩' || glyph === '🏁' ? '' : glyph, pr);
    case 'pin':
    case 'photo':
    default:
      return renderPin(color, glyph, pr);
  }
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!imageCache.has(url)) {
    imageCache.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    );
  }
  return imageCache.get(url)!;
}

/** Polaroid photo card with a short pin underneath. */
export async function renderPhotoMarker(url: string, color: string, pr = 2): Promise<RenderedIcon> {
  const img = await loadImage(url);
  const W = 112;
  const H = 136;
  const { c, ctx } = makeCanvas(W, H, pr);
  // pin stem
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.filter = 'blur(3px)';
  ctx.beginPath();
  ctx.ellipse(W / 2, H - 5, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(W / 2, 100);
  ctx.lineTo(W / 2, H - 6);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#475569';
  ctx.stroke();
  // card
  ctx.save();
  ctx.translate(W / 2, 54);
  ctx.rotate(-0.05);
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, -46, -50, 92, 100, 5);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(W / 2, 54);
  ctx.rotate(-0.05);
  // photo area
  ctx.save();
  roundRect(ctx, -40, -44, 80, 72, 3);
  ctx.clip();
  if (img) {
    const s = Math.max(80 / img.width, 72 / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, -dw / 2, -44 + (72 - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(-40, -44, 80, 72);
    drawGlyph(ctx, '📷', 0, -8, 26);
  }
  ctx.restore();
  // colour tag
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 38, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'bottom' };
}

/** Round badge with the vehicle emoji (used by the "icon" vehicle style). */
export function renderVehicleBadge(mode: TransportMode, color: string, pr = 2): RenderedIcon {
  const S = 52;
  const { c, ctx } = makeCanvas(S, S, pr);
  const cx = S / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cx, 20, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cx, 20, 0, Math.PI * 2);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  drawGlyph(ctx, VEHICLE_GLYPHS[mode], cx, cx, 22);
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'center' };
}

/** Direction chevron that rotates with the bearing. */
export function renderHeadingArrow(color: string, pr = 2): RenderedIcon {
  const S = 64;
  const { c, ctx } = makeCanvas(S, S, pr);
  const cx = S / 2;
  ctx.save();
  ctx.translate(cx, cx);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(8, -19);
  ctx.lineTo(-8, -19);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.restore();
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'center' };
}

/** Soft radial glow used under the moving head. */
export function renderGlow(color: string, pr = 2): RenderedIcon {
  const S = 96;
  const { c, ctx } = makeCanvas(S, S, pr);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, color + 'aa');
  g.addColorStop(0.45, color + '55');
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'center' };
}


// ---------------------------------------------------------------------------
// Top-down vehicle sprites (forward = up). Used by the "icon" vehicle style.
// ---------------------------------------------------------------------------

/** Fill + a top-left highlight / bottom-right shade so flat shapes read as shaded bodies. */
function outlined(ctx: CanvasRenderingContext2D, draw: () => void, fill: string, stroke = 'rgba(15,23,42,0.85)', lw = 1.6) {
  draw();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const g = ctx.createLinearGradient(-26, -30, 26, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g;
  ctx.fillRect(-40, -40, 80, 80);
  // inner rim light
  ctx.lineWidth = lw * 2.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, Math.min(r, w / 2, h / 2));
}

function wheels(ctx: CanvasRenderingContext2D, w: number, len: number, size: [number, number] = [5, 9]) {
  ctx.fillStyle = '#111827';
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      rr(ctx, sx * (w / 2 + 1) - size[0] / 2, sy * (len * 0.3) - size[1] / 2, size[0], size[1], 2);
      ctx.fill();
    }
  }
}

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rr(ctx, x, y, w, h, 3);
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.fill();
}

export function renderVehicleSprite(mode: TransportMode, color: string, pr = 2): RenderedIcon {
  const S = 64;
  const { c, ctx } = makeCanvas(S, S, pr);
  ctx.translate(S / 2, S / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  const light = isLightColor(color) ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.92)';
  switch (mode) {
    case 'sports_car': {
      wheels(ctx, 20, 38);
      outlined(ctx, () => rr(ctx, -10, -20, 20, 40, 7), color);
      glass(ctx, -7.5, -11, 15, 8);
      glass(ctx, -7.5, 8, 15, 6);
      break;
    }
    case 'suv':
    case 'camper': {
      const len = mode === 'camper' ? 46 : 42;
      wheels(ctx, 22, len, [5, 10]);
      outlined(ctx, () => rr(ctx, -11, -len / 2, 22, len, 5), color);
      glass(ctx, -8.5, -len / 2 + 7, 17, 7);
      if (mode === 'camper') {
        rr(ctx, -8, -3, 16, 22, 3);
        ctx.fillStyle = light;
        ctx.fill();
      } else {
        ctx.strokeStyle = light;
        ctx.lineWidth = 1.2;
        for (const y of [-3, 4, 11]) {
          ctx.beginPath();
          ctx.moveTo(-8, y);
          ctx.lineTo(8, y);
          ctx.stroke();
        }
      }
      break;
    }
    case 'bus': {
      const len = 54;
      wheels(ctx, 22, len, [5, 10]);
      outlined(ctx, () => rr(ctx, -11, -len / 2, 22, len, 4), color);
      // windscreen at the front, roof hatch and side window strips
      glass(ctx, -8.5, -len / 2 + 3, 17, 6);
      ctx.fillStyle = light;
      rr(ctx, -6, -6, 12, 7, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(15,23,42,0.45)';
      for (let y = -len / 2 + 12; y < len / 2 - 4; y += 6) {
        rr(ctx, -10, y, 2.2, 4.2, 1);
        ctx.fill();
        rr(ctx, 7.8, y, 2.2, 4.2, 1);
        ctx.fill();
      }
      break;
    }
    case 'motorcycle': {
      ctx.fillStyle = '#111827';
      rr(ctx, -2.5, -19, 5, 10, 2);
      ctx.fill();
      rr(ctx, -2.5, 9, 5, 10, 2);
      ctx.fill();
      outlined(ctx, () => rr(ctx, -5, -10, 10, 22, 4), color);
      ctx.strokeStyle = light;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-11, -8);
      ctx.lineTo(11, -8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = light;
      ctx.fill();
      break;
    }
    case 'bicycle': {
      ctx.fillStyle = '#111827';
      rr(ctx, -2, -18, 4, 11, 2);
      ctx.fill();
      rr(ctx, -2, 7, 4, 11, 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 8);
      ctx.stroke();
      ctx.strokeStyle = light;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-10, -7);
      ctx.lineTo(10, -7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 1, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(15,23,42,0.85)';
      ctx.stroke();
      break;
    }
    case 'hiker': {
      ctx.fillStyle = 'rgba(15,23,42,0.45)';
      for (const [x, y] of [
        [-5, 14],
        [4, 20],
        [-5, 26],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x, y, 2.2, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(0, 4, 12, 7, 0, 0, Math.PI * 2);
        },
        color,
      );
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(0, -2, 6.5, 0, Math.PI * 2);
        },
        light,
        'rgba(15,23,42,0.85)',
        1.4,
      );
      break;
    }
    case 'bullet_train':
    case 'steam_train': {
      const len = 56;
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(-8, -len / 2 + 12);
          ctx.quadraticCurveTo(-8, -len / 2, 0, -len / 2);
          ctx.quadraticCurveTo(8, -len / 2, 8, -len / 2 + 12);
          ctx.lineTo(8, len / 2 - 3);
          ctx.quadraticCurveTo(8, len / 2, 5, len / 2);
          ctx.lineTo(-5, len / 2);
          ctx.quadraticCurveTo(-8, len / 2, -8, len / 2 - 3);
          ctx.closePath();
        },
        color,
      );
      ctx.fillStyle = light;
      if (mode === 'bullet_train') {
        for (let y = -14; y < 24; y += 7) {
          rr(ctx, -5, y, 10, 4, 1.5);
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(0, -18, 3.5, 0, Math.PI * 2);
        ctx.fill();
        rr(ctx, -6.5, 10, 13, 14, 2);
        ctx.fill();
      }
      break;
    }
    case 'airplane':
    case 'propeller': {
      const jet = mode === 'airplane';
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(-3, -4);
          ctx.lineTo(-28, jet ? 12 : 2);
          ctx.lineTo(-28, jet ? 17 : 7);
          ctx.lineTo(-3, 10);
          ctx.lineTo(-3, 18);
          ctx.lineTo(-11, 25);
          ctx.lineTo(-11, 28);
          ctx.lineTo(0, 25);
          ctx.lineTo(11, 28);
          ctx.lineTo(11, 25);
          ctx.lineTo(3, 18);
          ctx.lineTo(3, 10);
          ctx.lineTo(28, jet ? 17 : 7);
          ctx.lineTo(28, jet ? 12 : 2);
          ctx.lineTo(3, -4);
          ctx.closePath();
        },
        color,
      );
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(0, -29);
          ctx.quadraticCurveTo(5.5, -26, 5.5, -16);
          ctx.lineTo(5.5, 22);
          ctx.quadraticCurveTo(5.5, 27, 0, 28);
          ctx.quadraticCurveTo(-5.5, 27, -5.5, 22);
          ctx.lineTo(-5.5, -16);
          ctx.quadraticCurveTo(-5.5, -26, 0, -29);
          ctx.closePath();
        },
        color,
      );
      ctx.fillStyle = light;
      rr(ctx, -3, -24, 6, 5, 2);
      ctx.fill();
      if (!jet) {
        ctx.fillStyle = 'rgba(15,23,42,0.5)';
        ctx.beginPath();
        ctx.ellipse(0, -29, 10, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'helicopter': {
      outlined(ctx, () => rr(ctx, -2.5, 4, 5, 22, 2), color);
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(0, -4, 8, 13, 0, 0, Math.PI * 2);
        },
        color,
      );
      glass(ctx, -5, -14, 10, 7);
      ctx.strokeStyle = 'rgba(15,23,42,0.65)';
      ctx.lineWidth = 2.5;
      for (const a of [0, Math.PI / 2]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 27, -4 + Math.sin(a) * 27);
        ctx.lineTo(-Math.cos(a) * 27, -4 - Math.sin(a) * 27);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, -4, 3, 0, Math.PI * 2);
      ctx.fillStyle = light;
      ctx.fill();
      break;
    }
    case 'balloon': {
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(0, 0, 22, 0, Math.PI * 2);
        },
        color,
      );
      ctx.fillStyle = light;
      for (let i = 0; i < 6; i += 2) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 22, (i * Math.PI) / 3, ((i + 1) * Math.PI) / 3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(15,23,42,0.85)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      rr(ctx, -5, -5, 10, 10, 2);
      ctx.fillStyle = '#8b5e34';
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'yacht':
    case 'ferry': {
      const ferry = mode === 'ferry';
      const w = ferry ? 11 : 9;
      outlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(0, -27);
          ctx.quadraticCurveTo(w, -18, w, -4);
          ctx.lineTo(w, 20);
          ctx.quadraticCurveTo(w, 26, w - 3, 26);
          ctx.lineTo(-w + 3, 26);
          ctx.quadraticCurveTo(-w, 26, -w, 20);
          ctx.lineTo(-w, -4);
          ctx.quadraticCurveTo(-w, -18, 0, -27);
          ctx.closePath();
        },
        color,
      );
      ctx.fillStyle = light;
      if (ferry) {
        rr(ctx, -7, -6, 14, 24, 2);
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(0, 10, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        rr(ctx, -5, -2, 10, 14, 3);
        ctx.fill();
        ctx.strokeStyle = light;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(0, -4);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'center' };
}

/** Approximate on-screen length (px at icon-size 1) of a sprite, to end the line behind it. */
export const SPRITE_LENGTH_PX: Record<TransportMode, number> = {
  airplane: 57,
  propeller: 57,
  sports_car: 40,
  suv: 42,
  camper: 46,
  bus: 54,
  bullet_train: 56,
  steam_train: 56,
  motorcycle: 38,
  yacht: 53,
  ferry: 53,
  hiker: 22,
  bicycle: 36,
  helicopter: 48,
  balloon: 44,
};

/** Small round badge with the transport glyph, shown at the start of a leg while editing. */
export function renderLegBadge(mode: TransportMode, color: string, pr = 2): RenderedIcon {
  const S = 40;
  const { c, ctx } = makeCanvas(S, S, pr);
  const cx = S / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cx, 15, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cx, 15, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  drawGlyph(ctx, VEHICLE_GLYPHS[mode], cx, cx, 16);
  // little pointer
  ctx.beginPath();
  ctx.moveTo(cx - 4, cx + 14);
  ctx.lineTo(cx + 4, cx + 14);
  ctx.lineTo(cx, cx + 19);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'bottom' };
}

/** Soft ground shadow blob (drawn under flying symbols, offset by altitude). */
export function renderGroundShadow(pr = 2): RenderedIcon {
  const S = 64;
  const { c, ctx } = makeCanvas(S, S, pr);
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, 22);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return { data: ctx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height, pixelRatio: pr, anchor: 'center' };
}
