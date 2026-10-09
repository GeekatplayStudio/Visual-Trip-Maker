import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { loadImage } from '../services/markerIcons';
import { CARD_PHOTO_ASPECT, DEFAULT_CROP, MAX_ZOOM, POLAROID_PHOTO_ASPECT, cropSourceRect, drawCropped, normalizeCrop, type PhotoCrop } from '../services/photoCrop';

interface PhotoEditorProps {
  url: string;
  crop?: PhotoCrop;
  onSave: (crop: PhotoCrop) => void;
  onClose: () => void;
}

const FRAME_W = 480;
const FRAME_H = Math.round(FRAME_W / CARD_PHOTO_ASPECT);
const POL_W = 120;
const POL_H = Math.round(POL_W / POLAROID_PHOTO_ASPECT);

/** Drag to choose what the photo shows, zoom with the slider or the mouse wheel. */
export const PhotoEditor: React.FC<PhotoEditorProps> = ({ url, crop: initial, onSave, onClose }) => {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [crop, setCrop] = useState<PhotoCrop>(initial ?? DEFAULT_CROP);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const polRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: PhotoCrop } | null>(null);

  useEffect(() => {
    let alive = true;
    loadImage(url).then((i) => {
      if (!alive) return;
      if (i) setImg(i);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    if (!img) return;
    for (const [canvas, w, h] of [
      [frameRef.current, FRAME_W, FRAME_H],
      [polRef.current, POL_W, POL_H],
    ] as const) {
      if (!canvas) continue;
      const pr = window.devicePixelRatio || 1;
      canvas.width = w * pr;
      canvas.height = h * pr;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      drawCropped(ctx, img, 0, 0, w, h, crop);
    }
  }, [img, crop]);

  const update = (next: PhotoCrop) => {
    if (img) setCrop(normalizeCrop(img.width, img.height, CARD_PHOTO_ASPECT, next));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !img) return;
    const { sw, sh } = cropSourceRect(img.width, img.height, CARD_PHOTO_ASPECT, d.crop);
    const dx = ((e.clientX - d.x) * sw) / FRAME_W / img.width;
    const dy = ((e.clientY - d.y) * sh) / FRAME_H / img.height;
    update({ ...d.crop, x: d.crop.x - dx, y: d.crop.y - dy });
  };
  const onWheel = (e: React.WheelEvent) => {
    update({ ...crop, zoom: Math.max(1, Math.min(MAX_ZOOM, crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="rounded-2xl bg-[#131a26] border border-white/10 shadow-2xl p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold">Frame the photo</h2>
            <p className="text-xs text-slate-400">Drag to move, scroll or use the slider to zoom.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        {failed ? (
          <div className="text-sm text-red-300" style={{ width: FRAME_W }}>The photo could not be loaded. Check the address, or upload the photo instead.</div>
        ) : (
          <div className="flex gap-4 items-start">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Story card</div>
              <canvas
                ref={frameRef}
                style={{ width: FRAME_W, height: FRAME_H }}
                className="rounded-xl bg-slate-800 cursor-grab active:cursor-grabbing touch-none ring-1 ring-white/10"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onWheel={onWheel}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Photo marker</div>
              <div className="bg-white p-1.5 pb-5 rounded shadow-lg -rotate-2">
                <canvas ref={polRef} style={{ width: POL_W, height: POL_H }} className="block bg-slate-300" />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <ZoomOut className="w-4 h-4 text-slate-400" />
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={(e) => update({ ...crop, zoom: Number(e.target.value) })} className="flex-1" />
          <ZoomIn className="w-4 h-4 text-slate-400" />
          <button onClick={() => update(DEFAULT_CROP)} className="chip flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Reset</button>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="chip">Cancel</button>
          <button
            onClick={() => {
              onSave(crop);
              onClose();
            }}
            disabled={!img}
            className="px-4 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold disabled:opacity-40"
          >
            Use this framing
          </button>
        </div>
      </div>
    </div>
  );
};
