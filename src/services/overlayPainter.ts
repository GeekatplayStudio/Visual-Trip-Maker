import type { RouteProject, VehicleTelemetry } from '../types';
import { iconGlyph, loadImage } from './markerIcons';

const FONT = '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
const EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

export interface OverlayPaintInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  project: RouteProject;
  telemetry: VehicleTelemetry;
  accent: string;
  dark: boolean;
}

const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

const photoCache = new Map<string, HTMLImageElement | null>();
export function preloadPhotos(project: RouteProject) {
  for (const wp of project.waypoints) {
    if (wp.photoUrl && !photoCache.has(wp.photoUrl)) {
      photoCache.set(wp.photoUrl, null);
      loadImage(wp.photoUrl).then((img) => photoCache.set(wp.photoUrl!, img));
    }
  }
}

/** Draw story card + HUD. Everything scales with the short side so 4K exports match the preview. */
export function paintOverlay({ ctx, width, height, project, telemetry, accent, dark }: OverlayPaintInput) {
  ctx.clearRect(0, 0, width, height);
  const u = Math.min(width, height) / 720; // scale unit (1 at 720p short side)
  const vertical = project.aspectRatio === '9:16';

  // ---------------------------------------------------------------- story card
  const wp = telemetry.activeWaypoint;
  if (project.showStoryCards && wp && wp.showCard) {
    const p = telemetry.dwellProgress;
    const dwell = wp.dwellTime > 0;
    const inDur = dwell ? Math.min(0.25, 0.4 / Math.max(0.5, wp.dwellTime)) : 0.3;
    const outDur = dwell ? Math.min(0.25, 0.35 / Math.max(0.5, wp.dwellTime)) : 0.3;
    let k = 1;
    if (p < inDur) k = easeOutBack(clamp01(p / inDur));
    else if (p > 1 - outDur) k = 1 - clamp01((p - (1 - outDur)) / outDur);
    if (telemetry.phase === 'done') k = 1;
    const alpha = clamp01(k);
    const scale = 0.9 + 0.1 * Math.min(1.08, k);

    const photo = wp.photoUrl ? photoCache.get(wp.photoUrl) : null;
    const cardW = Math.min(width * 0.86, (vertical ? 300 : 340) * u);
    const pad = 14 * u;
    const photoH = photo ? cardW * 0.56 : 0;
    const titleSize = 17 * u;
    const subSize = 12.5 * u;
    const badgeH = 22 * u;
    const cardH = pad + badgeH + 10 * u + (photo ? photoH + 10 * u : 0) + titleSize * 1.25 + (wp.subtitle ? subSize * 1.5 : 0) + pad;
    const cx = width / 2;
    const top = (vertical ? 70 : 28) * u;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, top + cardH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cardW / 2, -cardH / 2);

    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 28 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.fillStyle = dark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.96)';
    roundRect(ctx, 0, 0, cardW, cardH, 16 * u);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1 * u;
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    ctx.stroke();

    let y = pad;
    // badge
    const glyph = iconGlyph(wp.icon);
    ctx.font = `700 ${11 * u}px ${FONT}`;
    const badgeText = wp.dwellTime > 0 ? `Stop · ${wp.dwellTime} s` : 'Passing by';
    const badgeW = ctx.measureText(badgeText).width + (glyph ? 30 * u : 16 * u);
    roundRect(ctx, pad, y, badgeW, badgeH, badgeH / 2);
    ctx.fillStyle = wp.color || accent;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (glyph) {
      ctx.font = `${12 * u}px ${EMOJI}`;
      ctx.fillText(glyph, pad + 8 * u, y + badgeH / 2 + 0.5 * u);
    }
    ctx.font = `700 ${11 * u}px ${FONT}`;
    ctx.fillText(badgeText, pad + (glyph ? 24 * u : 8 * u), y + badgeH / 2 + 0.5 * u);
    y += badgeH + 10 * u;

    if (photo) {
      ctx.save();
      roundRect(ctx, pad, y, cardW - pad * 2, photoH, 10 * u);
      ctx.clip();
      const dw = cardW - pad * 2;
      const s = Math.max(dw / photo.width, photoH / photo.height);
      const w2 = photo.width * s;
      const h2 = photo.height * s;
      ctx.drawImage(photo, pad + (dw - w2) / 2, y + (photoH - h2) / 2, w2, h2);
      ctx.restore();
      y += photoH + 10 * u;
    }

    ctx.fillStyle = dark ? '#f8fafc' : '#0f172a';
    ctx.font = `800 ${titleSize}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ellipsize(ctx, wp.title, cardW - pad * 2), pad, y + titleSize);
    y += titleSize * 1.25;
    if (wp.subtitle) {
      ctx.fillStyle = dark ? 'rgba(226,232,240,0.85)' : 'rgba(51,65,85,0.9)';
      ctx.font = `500 ${subSize}px ${FONT}`;
      ctx.fillText(ellipsize(ctx, wp.subtitle, cardW - pad * 2), pad, y + subSize);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD
  if (project.showHud && telemetry.totalDistanceKm > 0) {
    const seg = project.segments[telemetry.currentSegmentIndex];
    const h = 44 * u;
    const pad = 14 * u;
    const x = (vertical ? 16 : 22) * u;
    const yb = height - (vertical ? 60 : 24) * u;
    ctx.save();
    ctx.font = `700 ${13 * u}px ${FONT}`;
    const title = ellipsize(ctx, seg?.title || project.name, 220 * u);
    const titleW = ctx.measureText(title).width;
    ctx.font = `600 ${12 * u}px ${FONT}`;
    const stats = `${telemetry.distanceCoveredKm.toFixed(0)} / ${telemetry.totalDistanceKm.toFixed(0)} km${telemetry.speedKmh ? ` · ${telemetry.speedKmh} km/h` : ''}`;
    const statsW = ctx.measureText(stats).width;
    const w = pad * 3 + titleW + statsW + 10 * u;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18 * u;
    ctx.shadowOffsetY = 4 * u;
    ctx.fillStyle = dark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.92)';
    roundRect(ctx, x, yb - h, w, h, h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // colour dot
    ctx.fillStyle = seg?.color || accent;
    ctx.beginPath();
    ctx.arc(x + pad + 2 * u, yb - h / 2, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dark ? '#f8fafc' : '#0f172a';
    ctx.font = `700 ${13 * u}px ${FONT}`;
    ctx.fillText(title, x + pad + 14 * u, yb - h / 2);
    ctx.fillStyle = dark ? 'rgba(203,213,225,0.9)' : 'rgba(71,85,105,0.95)';
    ctx.font = `600 ${12 * u}px ${FONT}`;
    ctx.fillText(stats, x + pad + 14 * u + titleW + 14 * u, yb - h / 2);
    // thin progress underline
    const pw = w - pad * 2;
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    roundRect(ctx, x + pad, yb - 7 * u, pw, 2.5 * u, 1.25 * u);
    ctx.fill();
    ctx.fillStyle = seg?.color || accent;
    roundRect(ctx, x + pad, yb - 7 * u, pw * clamp01(telemetry.progress01), 2.5 * u, 1.25 * u);
    ctx.fill();
    ctx.restore();
  }
}
